'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const routes = fs.readFileSync(path.join(root, 'ads-routes.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const storeSource = fs.readFileSync(path.join(root, 'ads-catalog-store.js'), 'utf8');
const api = fs.readFileSync(path.join(root, 'dashboard/lib/api.ts'), 'utf8');
const manager = fs.readFileSync(path.join(root, 'dashboard/components/ads/catalog-manager.tsx'), 'utf8');
const types = fs.readFileSync(path.join(root, 'dashboard/lib/types.ts'), 'utf8');
const batchDialog = fs.readFileSync(path.join(root, 'dashboard/components/ads/catalog-batch-dialog.tsx'), 'utf8');
const batchPlanSource = fs.readFileSync(path.join(root, 'dashboard/lib/catalog-batch-plan.ts'), 'utf8');

// O parser é um módulo puro da dashboard; transpilamos sem montar React/Next
// para validar os formatos de planilha no teste Node.
const typescript = require(path.join(root, 'dashboard/node_modules/typescript'));
function loadBatchParser() {
  const transpiled = typescript.transpileModule(batchPlanSource, {
    compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2022 },
  }).outputText;
  const sandbox = { module: { exports: {} } };
  sandbox.exports = sandbox.module.exports;
  require('vm').runInNewContext(transpiled, sandbox, { filename: 'catalog-batch-parser.ts' });
  return sandbox.module.exports;
}
const batchParser = loadBatchParser();

const semicolonPlan = batchParser.buildCatalogBatchPlan([
  'catalogo;sku;titulo;preco;link;imagem;marca;campanha;orcamento',
  'Loja Verão;SKU-001;Camiseta;79,90;https://loja.example/camiseta;https://cdn.example/camiseta.jpg;Marca Real;Verão;1.000,00',
].join('\n'), 'BRL');
assert.strictEqual(semicolonPlan.catalogs.length, 1, 'CSV separado por ponto e vírgula forma um catálogo');
assert.strictEqual(semicolonPlan.catalogs[0].products[0].data.price, '79.90 BRL', 'preço pt-BR continua normalizado');
assert.strictEqual(semicolonPlan.catalogs[0].campaigns[0].budgetAmount, 1000, 'orçamento pt-BR com milhar vira número');
assert.strictEqual(batchParser.parseDelimited('a,b\nc,d')[0].length, 2, 'CSV separado por vírgula continua aceito');
assert.strictEqual(batchParser.parseDelimited('a\tb\nc\td')[0].length, 2, 'TSV continua aceito');

// Contrato estrutural: a migração é aditiva/anulável e todos os handlers de
// catálogo passam pela validação do advertiser antes de acessar o store.
assert.match(storeSource, /ALTER TABLE ads_catalogs ADD COLUMN IF NOT EXISTS advertiser_id text/);
assert.match(storeSource, /ads_catalogs_account_advertiser_idx/);
assert.match(storeSource, /SET advertiser_id = \$\{advertiserId\}[\s\S]*advertiser_id IS NULL/);
assert.match(storeSource, /advertiserId: row\.advertiser_id \|\| null/);
assert.match(storeSource, /WHERE account_id = \$\{accountId\} AND advertiser_id = \$\{advertiserId\}/);

const catalogSection = routes.slice(routes.indexOf("app.get('/api/ads/catalogs/spec'"));
const handlers = [...catalogSection.matchAll(/app\.(?:get|post|put|delete)\('(\/api\/ads\/catalogs[^']*)'/g)];
assert.strictEqual(handlers.length, 29, 'todas as 29 rotas do fluxo de catálogo, incluindo lote e campaign-batch, continuam registradas');
for (let index = 0; index < handlers.length; index++) {
  const start = handlers[index].index;
  const end = index + 1 < handlers.length ? handlers[index + 1].index : catalogSection.indexOf('\n};', start);
  const body = catalogSection.slice(start, end);
  assert.match(body, /catalogAdvertiserId\(req\)|prepareCatalogCampaign\(req\)|enqueueCatalogCampaign|previewCatalogBatch\(req\)/, `${handlers[index][1]} valida advertiser explícito`);
}
assert.match(catalogSection, /catalogStore\.listCatalogs\(req\.account\.id, advertiserId\)/);
assert.match(catalogSection, /catalogStore\.listProducts\(req\.account\.id, advertiserId,/);
assert.match(catalogSection, /catalogStore\.setFeedUrl\(accountId, advertiserId,/);
assert.match(storeSource, /ads_catalog_sync_runs[\s\S]*advertiser_id text/);
assert.match(storeSource, /listCampaignRuns\(accountId, advertiserId,/);
assert.match(catalogSection, /app\.post\('\/api\/ads\/catalogs\/batch\/preview'/);
assert.match(catalogSection, /app\.post\('\/api\/ads\/catalogs\/batch'/);
assert.match(catalogSection, /catalogBatchExecutor\.executeCatalogBatch/);
assert.match(catalogSection, /waiting_connector_confirmation/);
assert.match(catalogSection, /batchCampaignSpecErrors/);
assert.match(storeSource, /promoteCampaignRunsAwaitingConnectorConfirmation/);

// A chave de idempotência dos runs precisa ser única também por advertiser.
// Testa o helper real e confirma que os três pontos de escrita das rotas o
// aplicam antes de persistir sync/campaign runs.
const registerAdsRoutes = require('../ads-routes');
const scopedKey = registerAdsRoutes.scopedCatalogRunIdempotencyKey;
assert.strictEqual(typeof scopedKey, 'function');
assert.strictEqual(scopedKey('adv_a', 'mesma-chave'), scopedKey('adv_a', 'mesma-chave'));
assert.notStrictEqual(scopedKey('adv_a', 'mesma-chave'), scopedKey('adv_b', 'mesma-chave'));
assert.ok(scopedKey('adv_a', 'x'.repeat(200)).length <= 200);
const minErrors = registerAdsRoutes.catalogBatchMinimumErrors({ catalogs: [{
  key: 'curto', products: Array.from({ length: 3 }, () => ({ data: { availability: 'in stock' } })), campaigns: [{ name: 'Campanha' }],
}] });
assert.strictEqual(minErrors.length, 1, 'lote com campanha e só três produtos é bloqueado no preview');
assert.strictEqual(minErrors[0].code, 'CATALOG_CAMPAIGN_MIN_PRODUCTS_REQUIRED');
assert.strictEqual(registerAdsRoutes.catalogBatchMinimumErrors({ catalogs: [{
  key: 'pronto', products: Array.from({ length: 4 }, () => ({ data: { availability: 'in stock' } })), campaigns: [{ name: 'Campanha' }],
}] }).length, 0, 'quatro produtos válidos passam pela barreira inicial');
const batchCampaignBase = {
  key: 'pixel', name: 'Catálogo Pixel', currency: 'BRL', country: 'BR',
  products: Array.from({ length: 4 }, () => ({ data: { availability: 'in stock' } })),
  campaigns: [{ name: 'Campanha', budgetAmount: 50 }],
};
const missingPixel = registerAdsRoutes.catalogBatchCampaignSpecErrors({ catalogs: [batchCampaignBase] });
assert.ok(missingPixel.some((error) => error.code === 'CATALOG_PIXEL_REQUIRED'), 'preview em massa exige pixel antes de criar qualquer catálogo');
const withPixel = registerAdsRoutes.catalogBatchCampaignSpecErrors({ catalogs: [{
  ...batchCampaignBase,
  campaigns: [{ name: 'Campanha', budgetAmount: 50, pixelId: '7550683248272228369' }],
}] });
assert.strictEqual(withPixel.length, 0, 'lote com quatro produtos e pixel válido passa pelo contrato de campanha');
assert.match(catalogSection, /idempotencyKey: scopedCatalogRunIdempotencyKey\([\s\S]*?catalog-batch-sync/);
assert.match(catalogSection, /idempotencyKey: scopedCatalogRunIdempotencyKey\([\s\S]*?catalog-batch-campaign/);
assert.match(catalogSection, /const idempotencyKey = scopedCatalogRunIdempotencyKey\(\s*advertiserId/);
assert.match(catalogSection, /const key = scopedCatalogRunIdempotencyKey\(\s*prepared\.advertiserId/);

// O parser do lote vem antes do global de 200 KB, preservando o limite global
// e permitindo o máximo anunciado de 1.500 produtos.
const batchParserAt = server.indexOf("app.use('/api/ads/catalogs/batch', express.json({ limit: '25mb' }));");
const globalParserAt = server.indexOf('app.use(express.json({');
assert.ok(batchParserAt >= 0 && batchParserAt < globalParserAt, 'parser ampliado do lote é montado antes do parser global');
const batchProduct = (index) => ({ data: {
  sku_id: 'sku-' + index,
  title: 'Produto ' + index,
  description: 'Descrição ' + index,
  availability: 'in stock',
  condition: 'new',
  price: '50.00 BRL',
  link: 'https://loja.example/produto-' + index,
  image_link: 'https://cdn.example/imagem-' + index + '.jpg',
  brand: 'Marca ' + index,
} });
const fullBatch = { catalogs: [{ key: 'lote', name: 'Lote', products: Array.from({ length: 1500 }, (_, index) => batchProduct(index)) }] };
assert.ok(Buffer.byteLength(JSON.stringify(fullBatch)) > 200 * 1024, 'lote válido de 1.500 produtos ultrapassa o limite global de 200 KB');
assert.ok(Buffer.byteLength(JSON.stringify(fullBatch)) < 25 * 1024 * 1024, 'lote válido de 1.500 produtos cabe no parser específico');

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
assert.match(types, /waiting_connector_confirmation/);
assert.match(batchDialog, /Preparar campanhas Product Link pausadas/);
assert.doesNotMatch(batchDialog, /checked=\{scheduleCampaigns\} disabled=/);

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
