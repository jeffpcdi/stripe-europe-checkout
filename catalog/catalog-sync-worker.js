'use strict';

const crypto = require('crypto');
const store = require('../ads-catalog-store');
const provider = require('../ads-provider');
const adsOps = require('../ads-ops-store');
const gateway = require('./catalog-tiktok-gateway');
const { serializeCatalogError } = require('./catalog-domain');

const workerId = 'catalog-sync-' + crypto.randomBytes(4).toString('hex');
let timer = null;
let busy = false;
let connectorCheckedAt = 0;
const CONNECTOR_REFRESH_MS = 60 * 1000;
const auditCheckedAt = new Map();
const AUDIT_REFRESH_MS = 60 * 1000;

// O lote pode chegar antes de a tool remota confirmar o contrato de criação
// de catálogo. Nesse caso, mantemos o feed e os produtos locais preservados e
// só recolocamos o job na fila quando a confirmação for explícita.
async function refreshWaitingConnectorConfirmations() {
  if (!store.enabled || !provider.enabled
    || typeof provider.getCatalogCapabilities !== 'function'
    || typeof store.promoteSyncRunsAwaitingConnectorConfirmation !== 'function') return 0;
  const now = Date.now();
  if (now - connectorCheckedAt < CONNECTOR_REFRESH_MS) return 0;
  connectorCheckedAt = now;
  try {
    const capabilities = await provider.getCatalogCapabilities();
    if (!capabilities || !capabilities.catalogCreate) return 0;
    const promoted = await store.promoteSyncRunsAwaitingConnectorConfirmation(20);
    return Array.isArray(promoted) ? promoted.length : 0;
  } catch (_) {
    // Indisponibilidade transitória não falha o lote: a próxima janela
    // consulta a capacidade novamente e retoma sem intervenção manual.
    return 0;
  }
}

// O upload aceito não significa que os itens já apareceram no Catalog Manager.
// Consultamos em baixa frequência os syncs cujo último estado é
// `processing_tiktok`; quando os números surgem, a auditoria e o run são
// atualizados automaticamente. Assim, um lote não depende da dashboard aberta.
async function refreshPendingTikTokAudits() {
  if (!store.enabled || !provider.enabled
    || typeof store.listCatalogsAwaitingTikTokAudit !== 'function'
    || typeof provider.getTikTokCatalogOverview !== 'function') return 0;
  const catalogs = await store.listCatalogsAwaitingTikTokAudit(5);
  const now = Date.now();
  let refreshed = 0;
  for (const catalog of catalogs) {
    const key = String(catalog && catalog.id || '');
    if (!key || now - (auditCheckedAt.get(key) || 0) < AUDIT_REFRESH_MS) continue;
    auditCheckedAt.set(key, now);
    try {
      const audit = await provider.getTikTokCatalogOverview(catalog.bcId, catalog.tiktokCatalogId);
      await store.setAudit(catalog.accountId, catalog.advertiserId, catalog.id, audit);
      const total = Number(audit && audit.total) || 0;
      const auditAttempts = Math.max(0, Number(catalog.syncProgress && catalog.syncProgress.auditAttempts) || 0) + 1;
      if (catalog.syncRunId) {
        await store.updateSyncRun(catalog.accountId, catalog.syncRunId, 'completed', {
          stage: total > 0 ? 'reviewed_tiktok' : 'processing_tiktok',
          progress: {
            ...(catalog.syncProgress || {}), audit, auditAttempts,
            lastAuditAt: new Date().toISOString(),
          },
        });
      }
      refreshed += 1;
    } catch (_) {
      // O próprio TikTok pode levar minutos para disponibilizar a auditoria.
      // Mantemos o estado processando e tentamos novamente no próximo ciclo.
    }
  }
  return refreshed;
}

async function processRun(row) {
  const accountId = String(row.account_id);
  const advertiserId = String(row.advertiser_id || '');
  const runId = String(row.id);
  const payload = row.payload || {};
  let catalog = advertiserId ? await store.getCatalog(accountId, advertiserId, row.catalog_id) : null;
  if (!catalog) {
    await store.updateSyncRun(accountId, runId, 'failed', {
      stage: 'failed', error: { code: 'CATALOG_NOT_FOUND', userMessage: 'Catálogo não encontrado.', retryable: false },
    });
    return null;
  }
  try {
    await store.updateSyncRun(accountId, runId, 'running', { stage: 'connecting_catalog', workerId });
    const createAndLinkCatalog = async () => {
      const created = await provider.createTikTokCatalog(payload.bcId, {
        name: catalog.name, catalogType: catalog.catalogType, currency: catalog.currency, country: catalog.country,
      });
      const remote = await gateway.verifyCatalogLink(provider, {
        bcId: payload.bcId, catalogId: created.catalogId, attempts: 3, delayMs: 750,
      });
      catalog = await store.linkTikTokCatalog(accountId, advertiserId, catalog.id, {
        tiktokCatalogId: created.catalogId, bcId: payload.bcId, verified: true, remoteSnapshot: remote,
      });
    };
    if (!catalog.tiktokCatalogId) {
      await createAndLinkCatalog();
    } else {
      // Verifica em toda sincronização. Um ID salvo pode ter sido excluído ou
      // pertencer ao Business Center anterior; nesse caso recriamos somente o
      // catálogo remoto e preservamos catálogo, produtos e feed locais.
      try {
        const remote = await gateway.verifyCatalogLink(provider, {
          bcId: payload.bcId, catalogId: catalog.tiktokCatalogId,
        });
        catalog = await store.linkTikTokCatalog(accountId, advertiserId, catalog.id, {
          tiktokCatalogId: catalog.tiktokCatalogId, bcId: payload.bcId, verified: true, remoteSnapshot: remote,
        });
      } catch (err) {
        if (err && err.code === 'CATALOG_NOT_FOUND_IN_BC') {
          await createAndLinkCatalog();
        } else {
          throw err;
        }
      }
    }

    await store.updateSyncRun(accountId, runId, 'running', {
      stage: 'uploading_products', workerId,
      progress: { published: payload.published || 0, skipped: payload.skipped || 0, tiktokCatalogId: catalog.tiktokCatalogId },
    });
    await provider.uploadTikTokCatalogProducts(catalog.bcId, catalog.tiktokCatalogId, payload.feedUrl, 'CSV');
    catalog = await store.markSynced(accountId, advertiserId, catalog.id);

    await store.updateSyncRun(accountId, runId, 'running', { stage: 'auditing_products', workerId });
    let audit = null;
    try {
      audit = await provider.getTikTokCatalogOverview(catalog.bcId, catalog.tiktokCatalogId);
      catalog = await store.setAudit(accountId, advertiserId, catalog.id, audit);
    } catch (_) { /* o upload do TikTok pode continuar processando */ }

    await store.appendPublication(accountId, advertiserId, catalog.id, {
      kind: 'tiktok', status: 'success', published: payload.published, skipped: payload.skipped,
      feedUrl: payload.feedUrl, tiktokCatalogId: catalog.tiktokCatalogId, audit,
    });
    const completed = await store.updateSyncRun(accountId, runId, 'completed', {
      stage: 'processing_tiktok', progress: {
        published: payload.published || 0, skipped: payload.skipped || 0,
        tiktokCatalogId: catalog.tiktokCatalogId, audit,
      },
    });
    await adsOps.appendAuditEvent(accountId, {
      actorType: 'user', actorId: accountId, action: 'catalog_sync.completed',
      targetType: 'catalog', targetId: catalog.id, jobId: runId,
      afterState: { tiktokCatalogId: catalog.tiktokCatalogId, audit },
      reason: 'Envio do catálogo aceito pelo TikTok; aguardando confirmação dos produtos',
    }).catch(() => {});
    return completed;
  } catch (err) {
    const structured = serializeCatalogError(err, 'sync_tiktok');
    if (err && err.code === 'CATALOG_CREATE_CONNECTOR_CONFIRMATION_REQUIRED') {
      await store.updateSyncRun(accountId, runId, 'waiting_connector_confirmation', {
        stage: 'waiting_connector_confirmation', error: structured, release: true,
      });
      return null;
    }
    if (advertiserId) await store.appendPublication(accountId, advertiserId, row.catalog_id, {
      kind: 'tiktok', status: 'error', feedUrl: payload.feedUrl, error: structured.userMessage,
    }).catch(() => {});
    await store.updateSyncRun(accountId, runId, 'failed', { stage: structured.stage, error: structured });
    return null;
  }
}

async function tick() {
  if (busy || !store.enabled || !provider.enabled) return;
  busy = true;
  try {
    await refreshWaitingConnectorConfirmations();
    await refreshPendingTikTokAudits();
    const row = await store.claimNextSyncRun(workerId);
    if (row) await processRun(row);
  } catch (err) {
    console.warn('[catalog-sync-worker] tick falhou:', String(err && err.message || err).slice(0, 240));
  } finally {
    busy = false;
  }
}

function start(intervalMs) {
  if (timer || !store.enabled) return false;
  const ms = Math.max(1000, Number(intervalMs) || 2000);
  timer = setInterval(() => { tick().catch(() => {}); }, ms);
  if (timer.unref) timer.unref();
  setTimeout(() => { tick().catch(() => {}); }, 50).unref();
  return true;
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = {
  start, stop, tick, processRun,
  _internals: { refreshWaitingConnectorConfirmations, refreshPendingTikTokAudits },
};
