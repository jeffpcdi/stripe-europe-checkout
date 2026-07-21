'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const routes = fs.readFileSync(path.join(root, 'ads-routes.js'), 'utf8');
const storeSource = fs.readFileSync(path.join(root, 'ads-catalog-store.js'), 'utf8');
const api = fs.readFileSync(path.join(root, 'dashboard/lib/api.ts'), 'utf8');
const manager = fs.readFileSync(path.join(root, 'dashboard/components/ads/catalog-manager.tsx'), 'utf8');
const types = fs.readFileSync(path.join(root, 'dashboard/lib/types.ts'), 'utf8');

// Contrato estrutural: a migração é aditiva/anulável e todos os handlers de
// catálogo passam pela validação do advertiser antes de acessar o store.
assert.match(storeSource, /ALTER TABLE ads_catalogs ADD COLUMN IF NOT EXISTS advertiser_id text/);
assert.match(storeSource, /ads_catalogs_account_advertiser_idx/);
assert.match(storeSource, /SET advertiser_id = \$\{advertiserId\}[\s\S]*advertiser_id IS NULL/);
assert.match(storeSource, /advertiserId: row\.advertiser_id \|\| null/);
assert.match(storeSource, /WHERE account_id = \$\{accountId\} AND advertiser_id = \$\{advertiserId\}/);

const catalogSection = routes.slice(routes.indexOf("app.get('/api/ads/catalogs/spec'"));
const handlers = [...catalogSection.matchAll(/app\.(?:get|post|put|delete)\('(\/api\/ads\/catalogs[^']*)'/g)];
assert.strictEqual(handlers.length, 26, 'todas as 26 rotas do fluxo v2 de catálogo continuam registradas');
for (let index = 0; index < handlers.length; index++) {
  const start = handlers[index].index;
  const end = index + 1 < handlers.length ? handlers[index + 1].index : catalogSection.indexOf('\n};', start);
  const body = catalogSection.slice(start, end);
  assert.match(body, /catalogAdvertiserId\(req\)|prepareCatalogCampaign\(req\)|enqueueCatalogCampaign/, `${handlers[index][1]} valida advertiser explícito`);
}
assert.match(catalogSection, /catalogStore\.listCatalogs\(req\.account\.id, advertiserId\)/);
assert.match(catalogSection, /catalogStore\.listProducts\(req\.account\.id, advertiserId,/);
assert.match(catalogSection, /catalogStore\.setFeedUrl\(accountId, advertiserId,/);
assert.match(storeSource, /ads_catalog_sync_runs[\s\S]*advertiser_id text/);
assert.match(storeSource, /listCampaignRuns\(accountId, advertiserId,/);

// Contrato do cliente: troca de advertiser muda a chave SWR e todas as
// mutações/downloads usam o helper que inclui adAccountId na URL.
assert.match(api, /function adsCatalogApiUrl[\s\S]*adAccountId=/);
assert.match(api, /useAdsCatalogs\(active: boolean, adAccountId: string\)/);
assert.match(api, /keepPreviousData: false/);
assert.match(manager, /useAdsCatalogs\(true, advertiserId\)/);
assert.match(manager, /useAdsCatalogDetail\(catalogId, advertiserId\)/);
assert.match(manager, /adsCatalogImportCsv\(catalogId, advertiserId, text\)/);
assert.match(manager, /href=\{adsCatalogApiUrl\(/);
assert.doesNotMatch(manager, /(?:fetch|apiSend)\(`?\/api\/ads\/catalogs/);
assert.match(types, /export interface AdsCatalog \{[\s\S]*advertiserId: string/);

// Exercita a estratégia de compatibilidade com um Neon em memória: o catálogo
// legado mantém ID/conteúdo, é atribuído uma única vez e nunca aparece no
// segundo advertiser.
const previousUrl = process.env.DATABASE_URL;
process.env.DATABASE_URL = 'postgres://catalog-scope.test/mock';

const neonPath = require.resolve('@neondatabase/serverless');
const storePath = require.resolve('../ads-catalog-store');
const originalNeon = require.cache[neonPath];
const rows = [
  row('cat_legacy', 'acc_1', null, 'Legado'),
  row('cat_a', 'acc_1', 'adv_a', 'Conta A'),
  row('cat_b', 'acc_1', 'adv_b', 'Conta B'),
];

function row(id, accountId, advertiserId, name) {
  return {
    id,
    account_id: accountId,
    advertiser_id: advertiserId,
    name,
    currency: 'BRL',
    feed_blob_url: id === 'cat_legacy' ? 'https://feed.example/legacy.csv' : null,
    feed_published_at: null,
    product_count: id === 'cat_legacy' ? 3 : 0,
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-01T00:00:00.000Z',
  };
}

async function sql(strings, ...values) {
  const query = strings.join('?').replace(/\s+/g, ' ').trim();
  if (/^(CREATE|ALTER) /.test(query)) return [];
  if (query.startsWith('UPDATE ads_catalogs SET catalog_type =')) return [];
  if (query.startsWith('UPDATE ads_catalog_sync_runs AS run SET advertiser_id =')) return [];
  if (query.startsWith('UPDATE ads_catalogs SET advertiser_id = ?')) {
    const [advertiserId, accountId] = values;
    const claimed = [];
    for (const catalog of rows) {
      if (catalog.account_id === accountId && catalog.advertiser_id == null) {
        catalog.advertiser_id = advertiserId;
        claimed.push({ id: catalog.id });
      }
    }
    return claimed;
  }
  if (query.includes('FROM ads_catalogs WHERE account_id = ? AND advertiser_id = ? ORDER BY')) {
    const [accountId, advertiserId] = values;
    return rows.filter((catalog) => catalog.account_id === accountId && catalog.advertiser_id === advertiserId);
  }
  if (query.includes('FROM ads_catalogs WHERE account_id = ? AND advertiser_id = ? AND id = ? LIMIT 1')) {
    const [accountId, advertiserId, catalogId] = values;
    return rows.filter((catalog) => catalog.account_id === accountId && catalog.advertiser_id === advertiserId && catalog.id === catalogId);
  }
  if (query.startsWith('INSERT INTO ads_catalogs')) {
    const [id, accountId, advertiserId, name, currency, catalogType, country] = values;
    const catalog = row(id, accountId, advertiserId, name);
    catalog.currency = currency;
    catalog.catalog_type = catalogType;
    catalog.country = country;
    rows.push(catalog);
    return [catalog];
  }
  throw new Error('SQL não previsto no teste: ' + query);
}

require.cache[neonPath] = {
  id: neonPath,
  filename: neonPath,
  loaded: true,
  exports: { neon: () => sql },
};
delete require.cache[storePath];
const store = require('../ads-catalog-store');

(async () => {
  const accountA = await store.listCatalogs('acc_1', 'adv_a');
  assert.deepStrictEqual(accountA.map((catalog) => catalog.id).sort(), ['cat_a', 'cat_legacy']);
  assert.strictEqual(accountA.find((catalog) => catalog.id === 'cat_legacy').feedUrl, 'https://feed.example/legacy.csv');
  assert.strictEqual(accountA.find((catalog) => catalog.id === 'cat_legacy').productCount, 3);
  assert.ok(accountA.every((catalog) => catalog.advertiserId === 'adv_a'));

  const accountB = await store.listCatalogs('acc_1', 'adv_b');
  assert.deepStrictEqual(accountB.map((catalog) => catalog.id), ['cat_b']);
  assert.strictEqual(await store.getCatalog('acc_1', 'adv_b', 'cat_legacy'), null);

  const created = await store.createCatalog('acc_1', 'adv_b', { name: 'Novo B', currency: 'EUR' });
  assert.strictEqual(created.advertiserId, 'adv_b');
  assert.strictEqual(created.currency, 'EUR');

  console.log('ads-catalog-scope.test.js OK — legado preservado e catálogos/produtos/feeds isolados por advertiser');
})().finally(() => {
  delete require.cache[storePath];
  if (originalNeon) require.cache[neonPath] = originalNeon;
  else delete require.cache[neonPath];
  if (previousUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousUrl;
}).catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
