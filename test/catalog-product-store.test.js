'use strict';
// Integração SQL em Postgres local (PGlite), sem Neon nem credenciais reais.
// CATALOG_TEST_PGLITE_PATH deve apontar para o pacote instalado fora do app.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { PGlite } = require(process.env.CATALOG_TEST_PGLITE_PATH || '@electric-sql/pglite');
const domain = require('../catalog/catalog-product-automation');
const root = path.join(__dirname, '..');
const localRequire = createRequire(path.join(root, 'ads-catalog-store.js'));

async function main() {
  const db = new PGlite();
  const sql = async (parts, ...values) => {
    const query = parts.reduce((text, part, index) => text + (index ? '$' + index : '') + part, '');
    return (await db.query(query, values)).rows;
  };
  const sandbox = { module: { exports: {} }, URL, console, process: { env: { DATABASE_URL: 'postgres://isolated/local' } },
    require: name => name === '@neondatabase/serverless' ? { neon: () => sql } : localRequire(name) };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'ads-catalog-store.js'), 'utf8'), sandbox);
  const store = sandbox.module.exports;
  const input = domain.normalizeInput({ url: 'https://loja.example/produto', idempotencyKey: 'repeat', creatives: [{ name: 'Primeiro', url: 'https://app.example/1.mp4' }] });
  const plan = domain.buildPlan(input, { product: { title: 'Produto', description: 'Descrição', brand: 'Marca', price: '19.90', currency: 'BRL', image_link: 'https://loja.example/p.jpg' } });
  try {
    await store.ensureSchema();
    const [a, b] = await Promise.all([store.createProductCatalog('acc', 'adv', input, plan), store.createProductCatalog('acc', 'adv', input, plan)]);
    assert.equal(a.id, b.id, 'concorrência reutiliza o mesmo catálogo');
    assert.equal((await db.query('SELECT * FROM ads_catalogs')).rows.length, 1);
    assert.equal((await store.listProducts('acc', 'adv', a.id)).length, 4);
    assert.equal(a.creatives.length, 1);
    assert.equal(a.automation.sourceUrl, input.url);
    await assert.rejects(store.createProductCatalog('acc', 'adv', { ...input, fingerprint: 'outro' }, plan), err => err.code === 'CATALOG_REQUEST_CONFLICT');
    assert.equal(await store.getCatalog('acc', 'outro-adv', a.id), null);
    assert.equal(await store.getCatalog('outro-acc', 'adv', a.id), null);
    const batch = domain.normalizeCreatives(Array.from({ length: 49 }, (_, i) => ({ name: 'Vídeo ' + i, url: `https://app.example/add-${i}.mp4` })));
    await Promise.all(batch.map(item => store.addCatalogCreatives('acc', 'adv', a.id, [item])));
    await store.addCatalogCreatives('acc', 'adv', a.id, [batch[0]]);
    assert.equal((await store.getCatalog('acc', 'adv', a.id)).creatives.length, 50);
    await assert.rejects(store.addCatalogCreatives('acc', 'adv', a.id, domain.normalizeCreatives([{ url: 'https://app.example/extra.mp4' }])), err => err.code === 'CATALOG_CREATIVES_LIMIT');
    await assert.rejects(store.addCatalogCreatives('acc', 'other', a.id, []), err => err.code === 'CATALOG_NOT_FOUND');
    await store.removeCatalogCreative('acc', 'adv', a.id, batch[0].id);
    await store.removeCatalogCreative('acc', 'adv', a.id, batch[0].id);
    assert.equal((await store.getCatalog('acc', 'adv', a.id)).creatives.length, 49);
    const orderInput = domain.normalizeInput({ url: input.url, idempotencyKey: 'order' });
    const ordered = await store.createProductCatalog('acc', 'adv', orderInput, plan);
    const later = domain.normalizeCreatives([{ url: 'https://app.example/later.mp4', sortOrder: 2 }]);
    const retry = domain.normalizeCreatives([{ url: 'https://app.example/retry.mp4', sortOrder: 1 }]);
    await store.addCatalogCreatives('acc', 'adv', ordered.id, later);
    await store.addCatalogCreatives('acc', 'adv', ordered.id, retry);
    assert.equal((await store.getCatalog('acc', 'adv', ordered.id)).creatives[0].sortOrder, 1, 'retry recupera posição original');
    await store.deleteCatalog('acc', 'adv', ordered.id);
    await store.setCatalogSyncIssue('acc', 'adv', a.id, { code: 'TEST', message: 'Motivo' });
    assert.equal((await store.getCatalog('acc', 'adv', a.id)).automation.syncIssue.message, 'Motivo');
    const products = await store.listProducts('acc', 'adv', a.id);
    await assert.rejects(store.bulkUpsertProducts('acc', 'adv', a.id, [products[0].data, { ...products[1].data, link: 'https://loja.example/outro' }]), err => err.code === 'CATALOG_SINGLE_PRODUCT_URL');
    assert.equal((await store.listProducts('acc', 'adv', a.id))[1].data.link, input.url);
    // Uma falha no INSERT dos produtos reverte também o catálogo pai.
    await db.exec("ALTER TABLE ads_catalog_products ADD CONSTRAINT reject_broken CHECK (data->>'title' <> 'Falha proposital')");
    const brokenInput = domain.normalizeInput({ ...input, idempotencyKey: 'atomic' });
    const broken = { ...plan, products: plan.products.map(row => ({ ...row, title: 'Falha proposital' })) };
    await assert.rejects(store.createProductCatalog('acc', 'adv', brokenInput, broken), /reject_broken/);
    assert.equal((await db.query('SELECT * FROM ads_catalogs')).rows.length, 1, 'rollback remove preparação parcial');
    console.log('catalog-product-store: Postgres confirmou atomicidade, idempotência, concorrência, limite e isolamento');
  } finally { await db.close(); }
}
main().catch(err => { console.error(err); process.exitCode = 1; });
