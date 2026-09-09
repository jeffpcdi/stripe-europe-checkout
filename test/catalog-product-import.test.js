'use strict';
const assert = require('node:assert/strict');
const domain = require('../catalog/catalog-product-automation');
const { importProductCatalog } = require('../catalog/catalog-product-import');
const inspect = require('../ads-catalog-inspect');

const product = { title: 'Produto real', description: 'Descrição real', brand: 'Marca real', price: '99.90', currency: 'BRL', image_link: '/produto.jpg' };
const videos = Array.from({ length: 10 }, (_, index) => ({ name: `Vídeo ${index + 1}`, url: `https://app.example/uploads/acc/video-${index}.mp4` }));
const body = { url: 'https://loja.example/produto', creatives: videos, idempotencyKey: 'primeira-tentativa' };

async function main() {
  const input = domain.normalizeInput(body);
  const plan = domain.buildPlan(input, { product, finalUrl: body.url });
  assert.equal(plan.valid, true);
  assert.equal(plan.products.length, 4, '10 vídeos reutilizam quatro itens');
  assert.equal(new Set(plan.products.map(item => item.sku_id)).size, 4);
  assert.equal(new Set(plan.products.map(item => item.item_group_id)).size, 4);
  assert.ok(plan.products.every(item => item.link === body.url && item.title === product.title && item.price === '99.90 BRL'));
  assert.equal(plan.products[0].image_link, 'https://loja.example/produto.jpg');
  assert.deepEqual(domain.buildPlan(input, { product }).products, plan.products, 'SKUs estáveis em nova tentativa');
  assert.equal(domain.normalizeCreatives([...videos, videos[0]]).length, 10, 'vídeo repetido não duplica vínculo');
  assert.throws(() => domain.normalizeCreatives(Array(51).fill(videos[0])), /50/);
  for (const url of ['http://loja.example/p', 'https://localhost/p', 'https://127.0.0.1/p', 'https://user:password@loja.example/p', 'file:///tmp/a']) {
    assert.throws(() => domain.normalizeInput({ url }), /HTTPS/);
  }
  const missing = domain.buildPlan(input, { product: { ...product, brand: '' } });
  assert.ok(missing.errors.some(item => item.field === 'brand'));
  assert.equal(domain.buildPlan(domain.normalizeInput({ ...body, product: { brand: 'Marca corrigida' } }), { product }).product.brand, 'Marca corrigida');
  const html = '<meta property="og:site_name" content="Loja"><meta property="og:image" content="/imagem.png">';
  assert.equal(inspect.extractProduct(html, body.url).brand, '', 'nome da loja não inventa a marca');
  assert.equal(inspect.extractProduct(html, body.url).image_link, 'https://loja.example/imagem.png');

  const rows = new Map();
  let inspections = 0, created = 0, syncAttempts = 0, blocked = true;
  const key = (account, advertiser, id) => [account, advertiser, id].join(':');
  const store = {
    getProductCatalogRequest: async (account, advertiser, request) => [...rows.values()].find(row => row.account === account && row.advertiser === advertiser && row.batchKey === request),
    createProductCatalog: async (account, advertiser, input, plan) => {
      created++;
      const catalog = { id: 'cat-' + created, account, advertiser, batchKey: input.batchKey, productCount: plan.products.length, creatives: input.creatives, automation: { requestFingerprint: input.fingerprint } };
      rows.set(key(account, advertiser, catalog.id), catalog);
      return catalog;
    },
    setCatalogSyncIssue: async (account, advertiser, id, issue) => { rows.get(key(account, advertiser, id)).automation.syncIssue = issue; },
    getCatalog: async (account, advertiser, id) => rows.get(key(account, advertiser, id)),
  };
  const options = { accountId: 'acc', advertiserId: 'adv', body, store,
    inspect: async () => { inspections++; return { product }; },
    validateCreatives: async () => {},
    startSync: async () => { syncAttempts++; if (blocked) throw Object.assign(new Error('Conecte o TikTok.'), { code: 'PIPEBOARD_DISABLED' }); return { id: 'sync-1' }; },
  };
  let result = await importProductCatalog(options);
  assert.equal(result.syncStarted, false);
  assert.equal(result.catalog.productCount, 4);
  assert.equal(result.catalog.creatives.length, 10);
  assert.equal(result.catalog.automation.syncIssue.code, 'PIPEBOARD_DISABLED');
  blocked = false;
  result = await importProductCatalog(options);
  assert.equal(result.syncStarted, true);
  assert.equal(result.syncIssue, null);
  assert.equal(created, 1, 'retomada reaproveita catálogo salvo');
  assert.equal(inspections, 1, 'retomada independe da página externa');
  assert.equal(syncAttempts, 2);
  await assert.rejects(importProductCatalog({ ...options, body: { ...body, url: 'https://loja.example/outro' } }), err => err.code === 'CATALOG_REQUEST_CONFLICT');
  await importProductCatalog({ ...options, advertiserId: 'adv-2' });
  assert.equal(created, 2, 'outra conta de anúncios possui escopo independente');
  await assert.rejects(importProductCatalog({ ...options, body: { ...body, idempotencyKey: 'incompleto' }, inspect: async () => ({ product: { ...product, brand: '' } }) }), err => err.code === 'CATALOG_PRODUCT_INCOMPLETE' && err.fields.some(item => item.field === 'brand'));
  await assert.rejects(importProductCatalog({ ...options, body: { ...body, idempotencyKey: 'arquivo-invalido' }, validateCreatives: async () => { throw new Error('Arquivo de outra conta'); } }), /outra conta/);
  assert.equal(created, 2, 'falhas de validação não deixam catálogo parcial');
  console.log('catalog-product-import: quatro itens, dez vídeos, dados reais, isolamento, retomada e erros OK');
}
main().catch(err => { console.error(err); process.exitCode = 1; });
