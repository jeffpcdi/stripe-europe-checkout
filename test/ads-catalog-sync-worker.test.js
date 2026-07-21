'use strict';

const assert = require('assert');
const path = require('path');

const root = path.join(__dirname, '..');
const storePath = require.resolve(path.join(root, 'ads-catalog-store.js'));
const providerPath = require.resolve(path.join(root, 'ads-provider.js'));
const gatewayPath = require.resolve(path.join(root, 'catalog', 'catalog-tiktok-gateway.js'));
const opsPath = require.resolve(path.join(root, 'ads-ops-store.js'));
const workerPath = require.resolve(path.join(root, 'catalog', 'catalog-sync-worker.js'));

const updates = [];
const links = [];
const uploads = [];
const publications = [];
let created = 0;

const localCatalog = {
  id: 'cat_local', advertiserId: 'adv_1', name: 'Catálogo preservado',
  catalogType: 'ECOM', currency: 'BRL', country: 'BR',
  tiktokCatalogId: '7662123486130784016', bcId: '7550683248272228369',
  linkStatus: 'error', productCount: 4,
};

require.cache[storePath] = {
  id: storePath, filename: storePath, loaded: true,
  exports: {
    enabled: true,
    async getCatalog(accountId, advertiserId, catalogId) {
      assert.strictEqual(accountId, 'acc_1');
      assert.strictEqual(advertiserId, 'adv_1');
      assert.strictEqual(catalogId, 'cat_local');
      return { ...localCatalog };
    },
    async updateSyncRun(_accountId, _runId, status, patch) { updates.push({ status, patch }); return { status, ...patch }; },
    async linkTikTokCatalog(_accountId, advertiserId, _catalogId, link) {
      assert.strictEqual(advertiserId, 'adv_1');
      links.push(link);
      return { ...localCatalog, tiktokCatalogId: link.tiktokCatalogId, bcId: link.bcId, linkStatus: 'verified' };
    },
    async markSynced(_accountId, advertiserId, _catalogId) {
      assert.strictEqual(advertiserId, 'adv_1');
      return { ...localCatalog, tiktokCatalogId: '7999000000000000001', bcId: localCatalog.bcId, linkStatus: 'verified' };
    },
    async setAudit(_accountId, advertiserId, _catalogId, audit) {
      assert.strictEqual(advertiserId, 'adv_1');
      return { ...localCatalog, tiktokCatalogId: '7999000000000000001', bcId: localCatalog.bcId, linkStatus: 'verified', audit };
    },
    async appendPublication(_accountId, advertiserId, _catalogId, event) {
      assert.strictEqual(advertiserId, 'adv_1');
      publications.push(event);
    },
  },
};

require.cache[providerPath] = {
  id: providerPath, filename: providerPath, loaded: true,
  exports: {
    enabled: true,
    async createTikTokCatalog() { created += 1; return { catalogId: '7999000000000000001' }; },
    async uploadTikTokCatalogProducts(bcId, catalogId, feedUrl) { uploads.push({ bcId, catalogId, feedUrl }); },
    async getTikTokCatalogOverview() { return { approved: 0, pending: 4, rejected: 0, total: 4 }; },
  },
};

require.cache[gatewayPath] = {
  id: gatewayPath, filename: gatewayPath, loaded: true,
  exports: {
    async verifyCatalogLink(_provider, { catalogId }) {
      if (catalogId === localCatalog.tiktokCatalogId) {
        const error = new Error('O catálogo não foi encontrado neste Business Center.');
        error.code = 'CATALOG_NOT_FOUND_IN_BC';
        throw error;
      }
      return { id: catalogId, name: localCatalog.name, currency: 'BRL', country: 'BR', productCount: 0 };
    },
  },
};

require.cache[opsPath] = {
  id: opsPath, filename: opsPath, loaded: true,
  exports: { async appendAuditEvent() {} },
};

delete require.cache[workerPath];
const worker = require(workerPath);

(async () => {
  await worker.processRun({
    id: 'run_1', account_id: 'acc_1', advertiser_id: 'adv_1', catalog_id: 'cat_local',
    payload: { bcId: localCatalog.bcId, feedUrl: 'https://example.com/feed.csv', published: 4, skipped: 0 },
  });

  assert.strictEqual(created, 1, 'recria somente o catálogo remoto ausente');
  assert.strictEqual(links.length, 1, 'grava o novo vínculo uma vez');
  assert.strictEqual(links[0].tiktokCatalogId, '7999000000000000001');
  assert.deepStrictEqual(uploads[0], {
    bcId: localCatalog.bcId,
    catalogId: '7999000000000000001',
    feedUrl: 'https://example.com/feed.csv',
  });
  assert.strictEqual(publications.at(-1).status, 'success');
  assert.strictEqual(updates.at(-1).status, 'completed');
  assert.ok(updates.some((entry) => entry.patch.stage === 'connecting_catalog'));
  console.log('ads-catalog-sync-worker.test.js OK — vínculo remoto ausente é recriado sem perder o catálogo local');
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
