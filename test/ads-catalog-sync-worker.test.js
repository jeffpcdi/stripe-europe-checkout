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
const syncPromotions = [];
const pendingAuditCatalogs = [];
const auditRefreshes = [];
let created = 0;
let overviewCalls = 0;
let overview = { approved: 0, pending: 4, rejected: 0, total: 4 };

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
    async promoteSyncRunsAwaitingConnectorConfirmation(limit) {
      syncPromotions.push(limit);
      return [{ id: 'run_waiting' }];
    },
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
      auditRefreshes.push(audit);
      return { ...localCatalog, tiktokCatalogId: '7999000000000000001', bcId: localCatalog.bcId, linkStatus: 'verified', audit };
    },
    async listCatalogsAwaitingTikTokAudit() { return pendingAuditCatalogs.slice(); },
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
    async getCatalogCapabilities() { return { catalogCreate: true }; },
    async createTikTokCatalog() { created += 1; return { catalogId: '7999000000000000001' }; },
    async uploadTikTokCatalogProducts(bcId, catalogId, feedUrl) { uploads.push({ bcId, catalogId, feedUrl }); },
    async getTikTokCatalogOverview() { overviewCalls += 1; return overview; },
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

  // Se a criação remota ainda não estiver confirmada, o lote não falha nem
  // pede ação manual: permanece aguardando e o worker o promove depois.
  updates.length = 0;
  uploads.length = 0;
  publications.length = 0;
  localCatalog.tiktokCatalogId = '';
  require.cache[providerPath].exports.createTikTokCatalog = async () => {
    const error = new Error('aguardando contrato do conector');
    error.code = 'CATALOG_CREATE_CONNECTOR_CONFIRMATION_REQUIRED';
    error.userMessage = error.message;
    error.retryable = true;
    throw error;
  };
  await worker.processRun({
    id: 'run_waiting', account_id: 'acc_1', advertiser_id: 'adv_1', catalog_id: 'cat_local',
    payload: { bcId: localCatalog.bcId, feedUrl: 'https://example.com/feed.csv', published: 4, skipped: 0 },
  });
  assert.strictEqual(updates.at(-1).status, 'waiting_connector_confirmation');
  assert.strictEqual(updates.at(-1).patch.release, true);
  assert.strictEqual(uploads.length, 0, 'não sobe produto enquanto a criação remota aguarda confirmação');

  await worker._internals.refreshWaitingConnectorConfirmations();
  assert.deepStrictEqual(syncPromotions, [20], 'capacidade confirmada promove a sincronização automaticamente');

  // Sem campanha dependente e sem tela aberta, o worker também atualiza a
  // auditoria do catálogo. Quando o TikTok finalmente expõe os produtos, o run
  // sai de "processando" para um snapshot explícito de análise.
  pendingAuditCatalogs.push({
    id: 'cat_audit', accountId: 'acc_1', advertiserId: 'adv_1',
    tiktokCatalogId: '7999000000000000001', bcId: localCatalog.bcId,
    syncRunId: 'sync_audit', syncProgress: { published: 4, tiktokCatalogId: '7999000000000000001' },
  });
  overview = { approved: 3, pending: 1, rejected: 0, total: 4 };
  const refreshed = await worker._internals.refreshPendingTikTokAudits();
  assert.strictEqual(refreshed, 1, 'auditoria pendente é consultada automaticamente');
  assert.strictEqual(overviewCalls >= 2, true, 'consulta o overview após a publicação inicial');
  assert.deepStrictEqual(auditRefreshes.at(-1), overview, 'persiste os números retornados pelo TikTok');
  assert.strictEqual(updates.at(-1).patch.stage, 'reviewed_tiktok', 'run registra que a análise ficou disponível');
  assert.strictEqual(updates.at(-1).patch.progress.audit.approved, 3, 'snapshot preserva produtos aprovados');
  assert.strictEqual(await worker._internals.refreshPendingTikTokAudits(), 0, 'não consulta o mesmo catálogo duas vezes no intervalo');

  pendingAuditCatalogs.push({
    id: 'cat_empty', accountId: 'acc_1', advertiserId: 'adv_1',
    tiktokCatalogId: '7999000000000000002', bcId: localCatalog.bcId,
    syncRunId: 'sync_empty', syncProgress: { published: 4, auditAttempts: 2 },
  });
  overview = { approved: 0, pending: 0, rejected: 0, total: 0 };
  assert.strictEqual(await worker._internals.refreshPendingTikTokAudits(), 1, 'catálogo remoto vazio continua em auditoria automática');
  assert.strictEqual(updates.at(-1).patch.stage, 'processing_tiktok', 'zero produtos não é mascarado como revisão concluída');
  assert.strictEqual(updates.at(-1).patch.progress.auditAttempts, 3, 'tentativas de auditoria ficam visíveis para diagnóstico');
  assert.strictEqual(updates.at(-1).patch.progress.audit.total, 0, 'snapshot registra o zero retornado pelo TikTok');
  console.log('ads-catalog-sync-worker.test.js OK — vínculo remoto ausente é recriado; espera do conector é retomada sem ação manual');
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
