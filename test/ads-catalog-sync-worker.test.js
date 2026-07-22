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
const unconfirmed = [];
let created = 0;
let overviewCalls = 0;
let overview = { approved: 0, pending: 4, rejected: 0, total: 4 };
let uploadResponse = { job_id: 'job_1', feed_log_id: 'feed_log_1', file_format: 'CSV' };
let uploadStatus = {
  feedLogId: 'feed_log_1', processStatus: 'SUCCESS', processing: false,
  succeeded: true, failed: false, errorCount: 0, warningCount: 0,
};
let remoteFeeds = { total: 0, feeds: [], raw: { total_feeds: 0 } };
let productRows = Array.from({ length: 4 }, (_, index) => ({
  id: 'prod_' + index, valid: true,
  data: { sku_id: 'sku_' + index, brand: 'Marca real' },
}));

const localCatalog = {
  id: 'cat_local', advertiserId: 'adv_1', name: 'Catálogo preservado',
  catalogType: 'ECOM', currency: 'BRL', country: 'BR',
  tiktokCatalogId: '7662123486130784016', bcId: '7550683248272228369',
  linkStatus: 'error', productCount: 4,
};
const deletedRemoteCatalogId = localCatalog.tiktokCatalogId;

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
    async listProducts(_accountId, advertiserId) {
      assert.strictEqual(advertiserId, 'adv_1');
      return productRows;
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
    async markSyncUnconfirmed(accountId, advertiserId, catalogId) {
      unconfirmed.push({ accountId, advertiserId, catalogId });
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
    async getCatalogCapabilities() {
      return {
        catalogCreate: true, catalogUpload: true, catalogUploadStatus: true,
        catalogAudit: true, catalogLinkVerify: true,
      };
    },
    async createTikTokCatalog() { created += 1; return { catalogId: '7999000000000000001' }; },
    async uploadTikTokCatalogProducts(bcId, catalogId, feedUrl) {
      uploads.push({ bcId, catalogId, feedUrl });
      return uploadResponse;
    },
    async getTikTokCatalogOverview() { overviewCalls += 1; return overview; },
    async getTikTokCatalogUploadStatus() { return uploadStatus; },
    async getTikTokCatalogFeeds() { return remoteFeeds; },
  },
};

require.cache[gatewayPath] = {
  id: gatewayPath, filename: gatewayPath, loaded: true,
  exports: {
    async verifyCatalogLink(_provider, { catalogId }) {
      if (catalogId === deletedRemoteCatalogId) {
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
  assert.strictEqual(worker._internals.syncCapabilitiesReady({
    catalogCreate: true, catalogUpload: true, catalogUploadStatus: true,
    catalogAudit: true, catalogLinkVerify: true,
  }), true, 'contrato completo libera a sincronização');
  assert.strictEqual(worker._internals.syncCapabilitiesReady({
    catalogCreate: true, catalogUpload: false, catalogUploadStatus: true,
    catalogAudit: true, catalogLinkVerify: true,
  }), false, 'status sem upload não promove o job');
  assert.strictEqual(worker._internals.syncCapabilitiesReady({
    catalogCreate: true, catalogUpload: true, catalogUploadStatus: true,
    catalogAudit: false, catalogLinkVerify: true,
  }), false, 'upload sem auditoria não pode declarar sincronização');
  assert.strictEqual(worker._internals.syncCapabilitiesReady({
    catalogCreate: false, catalogUpload: true, catalogUploadStatus: true,
    catalogAudit: true, catalogLinkVerify: true,
  }, { requireCreate: false }), true, 'catálogo já vinculado não depende da tool de criação');
  assert.strictEqual(
    worker._internals.uploadReceiptMismatchError(new Error("Invalid value for 'feed_id': Not matched with the Catalog.")).code,
    'CATALOG_UPLOAD_RECEIPT_MISMATCH',
    'recibo de outro catálogo falha imediatamente em vez de aguardar overview antigo',
  );
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
  assert.strictEqual(updates.at(-1).patch.stage, 'reviewed_tiktok');
  assert.strictEqual(updates.at(-1).patch.progress.uploadReceipt.jobId, 'job_1', 'recibo do upload fica persistido');
  assert.strictEqual(updates.at(-1).patch.progress.uploadReceipt.feedLogId, 'feed_log_1', 'feed_log_id identifica o upload confirmado');
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

  // Um run antigo não pode confiar no valid=true persistido. O store real
  // revalida a marca e o worker encerra antes de tocar o TikTok se nada restar.
  updates.length = 0;
  uploads.length = 0;
  publications.length = 0;
  productRows = [{ id: 'prod_sem_marca', valid: false, errors: [{ field: 'brand', message: 'obrigatório' }], data: { sku_id: 'sem-marca' } }];
  await worker.processRun({
    id: 'run_invalid', account_id: 'acc_1', advertiser_id: 'adv_1', catalog_id: 'cat_local',
    payload: { bcId: localCatalog.bcId, feedUrl: 'https://example.com/feed.csv', published: 1, skipped: 0 },
  });
  assert.strictEqual(uploads.length, 0, 'produto legado inválido não é reenviado');
  assert.strictEqual(updates.at(-1).status, 'failed');
  assert.strictEqual(updates.at(-1).patch.error.code, 'CATALOG_NO_VALID_PRODUCTS');
  assert.strictEqual(unconfirmed.at(-1).catalogId, 'cat_local', 'falha de validação remove a falsa marca de sincronizado');
  productRows = Array.from({ length: 4 }, (_, index) => ({
    id: 'prod_' + index, valid: true, data: { sku_id: 'sku_' + index, brand: 'Marca real' },
  }));

  // O recibo pode estar presente e o processamento continuar assíncrono. O
  // overview antigo não antecipa o sucesso enquanto o feed_log está pendente.
  updates.length = 0;
  uploads.length = 0;
  publications.length = 0;
  localCatalog.tiktokCatalogId = '7999000000000000001';
  require.cache[providerPath].exports.createTikTokCatalog = async () => {
    created += 1;
    return { catalogId: '7999000000000000001' };
  };
  uploadResponse = { job_id: null, feed_log_id: 'feed_log_processing', file_format: 'CSV' };
  uploadStatus = {
    feedLogId: 'feed_log_processing', processStatus: 'PROCESSING', processing: true,
    succeeded: false, failed: false, errorCount: 0, warningCount: 0,
  };
  remoteFeeds = { total: 0, feeds: [], raw: { total_feeds: 0 } };
  overview = { approved: 0, pending: 0, rejected: 0, total: 0 };
  await worker.processRun({
    id: 'run_zero', account_id: 'acc_1', advertiser_id: 'adv_1', catalog_id: 'cat_local',
    payload: { bcId: localCatalog.bcId, feedUrl: 'https://example.com/feed.csv', published: 4, skipped: 0 },
  });
  assert.strictEqual(publications.at(-1).status, 'processing', 'upload inconclusivo é registrado como processando');
  assert.strictEqual(updates.at(-1).status, 'waiting_tiktok_processing', 'run não recebe sucesso definitivo');
  assert.strictEqual(updates.at(-1).patch.release, true, 'espera libera o lock do worker');
  assert.strictEqual(updates.at(-1).patch.progress.uploadReceipt.provable, true, 'feed_log_id torna o upload verificável mesmo sem job_id');
  assert.deepStrictEqual(updates.at(-1).patch.progress.uploadReceipt.response, uploadResponse, 'resposta crua do upload é preservada');
  assert.strictEqual(updates.at(-1).patch.progress.remoteFeeds.total, 0, 'zero feeds é guardado sem bloquear por si só');
  assert.ok(Date.parse(updates.at(-1).patch.progress.nextAuditAt) > Date.now(), 'próxima consulta usa backoff persistido');

  // SUCCESS com erros por produto é falha retomável, nunca sincronização
  // concluída só porque o overview ainda contém produtos antigos.
  updates.length = 0;
  publications.length = 0;
  uploadResponse = { feed_log_id: 'feed_log_partial', file_format: 'CSV' };
  uploadStatus = {
    feedLogId: 'feed_log_partial', processStatus: 'SUCCESS', processing: false,
    succeeded: false, failed: true, errorCount: 2, warningCount: 0,
    errors: [{ field: 'brand', issue: 'missing' }],
  };
  overview = { approved: 20, pending: 0, rejected: 0, total: 20 };
  await worker.processRun({
    id: 'run_partial', account_id: 'acc_1', advertiser_id: 'adv_1', catalog_id: 'cat_local',
    payload: { bcId: localCatalog.bcId, feedUrl: 'https://example.com/feed.csv', published: 4, skipped: 0 },
  });
  assert.strictEqual(updates.at(-1).status, 'failed', 'erros do feed_log bloqueiam sucesso apesar de produtos antigos no overview');
  assert.strictEqual(updates.at(-1).patch.error.code, 'CATALOG_UPLOAD_REJECTED');
  assert.strictEqual(updates.at(-1).patch.progress.uploadStatus.errorCount, 2);

  // O TikTok pode devolver FAILED sem error_count nem motivo (por exemplo,
  // quando não conseguiu baixar o arquivo). A mensagem não deve inventar
  // "0 erros de produto" nem mandar o usuário editar campos ao acaso.
  updates.length = 0;
  publications.length = 0;
  uploadResponse = { feed_log_id: 'feed_log_failed_without_reason', file_format: 'CSV' };
  uploadStatus = {
    feedLogId: 'feed_log_failed_without_reason', processStatus: 'FAILED', processing: false,
    succeeded: false, failed: true, errorCount: 0, warningCount: 0,
    errors: [{ field: '', issue: '', suggestion: '', affectedProductCount: 1, products: [] }],
  };
  await worker.processRun({
    id: 'run_failed_without_reason', account_id: 'acc_1', advertiser_id: 'adv_1', catalog_id: 'cat_local',
    payload: { bcId: localCatalog.bcId, feedUrl: 'https://example.com/feed.csv', published: 4, skipped: 0 },
  });
  assert.strictEqual(updates.at(-1).status, 'failed');
  assert.match(updates.at(-1).patch.error.message, /status FAILED sem informar a causa/);
  assert.match(updates.at(-1).patch.error.suggestedAction, /URL do feed é pública/);

  // Sem campanha dependente e sem tela aberta, o worker também atualiza a
  // auditoria do catálogo. Quando o TikTok finalmente expõe os produtos, o run
  // sai de "processando" para um snapshot explícito de análise.
  pendingAuditCatalogs.push({
    id: 'cat_audit', accountId: 'acc_1', advertiserId: 'adv_1',
    tiktokCatalogId: '7999000000000000001', bcId: localCatalog.bcId,
    syncRunId: 'sync_audit', syncProgress: {
      published: 4, tiktokCatalogId: '7999000000000000001',
      uploadReceipt: { feedLogId: 'feed_log_audit' },
    },
  });
  uploadStatus = {
    feedLogId: 'feed_log_audit', processStatus: 'SUCCESS', processing: false,
    succeeded: true, failed: false, errorCount: 0, warningCount: 1,
  };
  overview = { approved: 3, pending: 1, rejected: 0, total: 4 };
  const refreshed = await worker._internals.refreshPendingTikTokAudits();
  assert.strictEqual(refreshed, 1, 'auditoria pendente é consultada automaticamente');
  assert.strictEqual(overviewCalls >= 2, true, 'consulta o overview após a publicação inicial');
  assert.deepStrictEqual(auditRefreshes.at(-1), overview, 'persiste os números retornados pelo TikTok');
  assert.strictEqual(updates.at(-1).patch.stage, 'reviewed_tiktok', 'run registra que a análise ficou disponível');
  assert.strictEqual(updates.at(-1).patch.progress.audit.approved, 3, 'snapshot preserva produtos aprovados');
  assert.strictEqual(publications.at(-1).status, 'success', 'sucesso só é registrado depois de produtos visíveis');
  assert.strictEqual(await worker._internals.refreshPendingTikTokAudits(), 0, 'não consulta o mesmo catálogo duas vezes no intervalo');

  pendingAuditCatalogs.push({
    id: 'cat_empty', accountId: 'acc_1', advertiserId: 'adv_1',
    tiktokCatalogId: '7999000000000000002', bcId: localCatalog.bcId,
    syncRunId: 'sync_empty', syncProgress: { published: 4, auditAttempts: 2, uploadReceipt: { feedLogId: 'feed_log_empty' } },
  });
  overview = { approved: 0, pending: 0, rejected: 0, total: 0 };
  assert.strictEqual(await worker._internals.refreshPendingTikTokAudits(), 1, 'catálogo remoto vazio continua em auditoria automática');
  assert.strictEqual(updates.at(-1).status, 'waiting_tiktok_processing', 'zero produtos permanece em espera explícita');
  assert.strictEqual(updates.at(-1).patch.stage, 'processing_tiktok', 'zero produtos não é mascarado como revisão concluída');
  assert.strictEqual(updates.at(-1).patch.progress.auditAttempts, 3, 'tentativas de auditoria ficam visíveis para diagnóstico');
  assert.strictEqual(updates.at(-1).patch.progress.audit.total, 0, 'snapshot registra o zero retornado pelo TikTok');

  const callsBeforeTimeout = overviewCalls;
  pendingAuditCatalogs.push({
    id: 'cat_timeout', accountId: 'acc_1', advertiserId: 'adv_1',
    tiktokCatalogId: '7999000000000000003', bcId: localCatalog.bcId,
    syncRunId: 'sync_timeout',
    syncProgress: { published: 4, auditAttempts: worker._internals.AUDIT_MAX_ATTEMPTS, feedUrl: 'https://example.com/feed.csv' },
  });
  assert.strictEqual(await worker._internals.refreshPendingTikTokAudits(), 1, 'espera acima do limite é encerrada');
  assert.strictEqual(overviewCalls, callsBeforeTimeout, 'limite evita nova chamada remota inútil');
  assert.strictEqual(updates.at(-1).status, 'failed', 'timeout vira falha retomável, não polling infinito');
  assert.strictEqual(updates.at(-1).patch.error.code, 'CATALOG_UPLOAD_NOT_VISIBLE');
  assert.strictEqual(updates.at(-1).patch.error.retryable, true);
  assert.deepStrictEqual(unconfirmed.at(-1), { accountId: 'acc_1', advertiserId: 'adv_1', catalogId: 'cat_timeout' }, 'timeout limpa a falsa marca de sincronizado no mesmo escopo');
  console.log('ads-catalog-sync-worker.test.js OK — vínculo remoto ausente é recriado; espera do conector é retomada sem ação manual');
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
