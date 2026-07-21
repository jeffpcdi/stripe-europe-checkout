'use strict';

const crypto = require('crypto');
const store = require('../ads-catalog-store');
const provider = require('../ads-provider');
const adsOps = require('../ads-ops-store');
const gateway = require('./catalog-tiktok-gateway');
const { serializeCatalogError, catalogError } = require('./catalog-domain');

const workerId = 'catalog-sync-' + crypto.randomBytes(4).toString('hex');
let timer = null;
let busy = false;
let connectorCheckedAt = 0;
const CONNECTOR_REFRESH_MS = 60 * 1000;
const auditCheckedAt = new Map();
const AUDIT_REFRESH_MS = 60 * 1000;
const AUDIT_MAX_ATTEMPTS = 8;
const AUDIT_BACKOFF_MS = Object.freeze([
  60 * 1000,
  2 * 60 * 1000,
  5 * 60 * 1000,
  10 * 60 * 1000,
  20 * 60 * 1000,
  30 * 60 * 1000,
  60 * 60 * 1000,
]);

function safeSerializable(value) {
  if (value == null) return null;
  try { return JSON.parse(JSON.stringify(value)); }
  catch (_) { return String(value).slice(0, 1000); }
}

function deepField(value, keys, depth) {
  if (value == null || (depth || 0) > 5) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = deepField(item, keys, (depth || 0) + 1);
      if (found != null && found !== '') return found;
    }
    return null;
  }
  if (typeof value !== 'object') return null;
  for (const key of keys) {
    if (value[key] != null && value[key] !== '') return value[key];
  }
  for (const child of Object.values(value)) {
    const found = deepField(child, keys, (depth || 0) + 1);
    if (found != null && found !== '') return found;
  }
  return null;
}

function normalizeUploadReceipt(response, receivedAt) {
  const raw = safeSerializable(response);
  const jobId = deepField(raw, ['job_id', 'jobId'], 0);
  const taskId = deepField(raw, ['task_id', 'taskId'], 0);
  const uploadId = deepField(raw, ['upload_id', 'uploadId', 'product_file_id'], 0);
  const requestId = deepField(raw, ['request_id', 'requestId', 'log_id'], 0);
  return {
    receivedAt,
    provable: Boolean(jobId || taskId || uploadId || requestId),
    jobId: jobId == null ? null : String(jobId),
    taskId: taskId == null ? null : String(taskId),
    uploadId: uploadId == null ? null : String(uploadId),
    requestId: requestId == null ? null : String(requestId),
    fileFormat: String(deepField(raw, ['file_format', 'fileFormat'], 0) || 'CSV'),
    response: raw,
  };
}

function auditDelayMs(attempts) {
  const index = Math.max(0, Math.min(AUDIT_BACKOFF_MS.length - 1, Number(attempts || 1) - 1));
  return AUDIT_BACKOFF_MS[index];
}

function nextAuditAt(attempts, now) {
  return new Date((Number(now) || Date.now()) + auditDelayMs(attempts)).toISOString();
}

function auditTimeoutError(attempts, lastError) {
  return {
    code: 'CATALOG_UPLOAD_NOT_VISIBLE',
    stage: 'auditing_products',
    message: String(lastError || 'O overview do TikTok continuou sem produtos após o upload.').slice(0, 500),
    userMessage: 'O TikTok não confirmou nenhum produto depois de ' + attempts + ' verificações. O envio não foi marcado como concluído.',
    retryable: true,
    suggestedAction: 'Corrija os campos obrigatórios do feed (incluindo marca), confirme a URL pública e retome a sincronização.',
  };
}

async function readRemoteFeedsDiagnostic(catalog) {
  const checkedAt = new Date().toISOString();
  if (typeof provider.getTikTokCatalogFeeds !== 'function') {
    return { supported: false, checkedAt };
  }
  try {
    const result = await provider.getTikTokCatalogFeeds(catalog.bcId, catalog.tiktokCatalogId);
    const feeds = Array.isArray(result && result.feeds) ? result.feeds : [];
    return {
      supported: true,
      checkedAt,
      total: Number(result && result.total) || 0,
      // Zero feeds é legítimo no upload direto. Guardamos uma amostra somente
      // para diagnóstico, sem transformar este endpoint em fonte de verdade.
      sample: feeds.slice(0, 10).map((feed) => ({
        id: String(deepField(feed, ['feed_id', 'feedId', 'id'], 0) || ''),
        status: String(deepField(feed, ['status', 'feed_status'], 0) || ''),
      })),
    };
  } catch (err) {
    return { supported: true, checkedAt, error: String(err && err.message || err).slice(0, 500) };
  }
}

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

// O retorno do upload não significa que os itens apareceram no Catalog Manager.
// Consultamos com backoff persistido os syncs em `waiting_tiktok_processing`.
// O run só conclui quando o overview mostra produtos; zero repetido termina em
// erro retomável, em vez de manter polling infinito ou exibir falso sucesso.
async function refreshPendingTikTokAudits() {
  if (!store.enabled || !provider.enabled
    || typeof store.listCatalogsAwaitingTikTokAudit !== 'function'
    || typeof provider.getTikTokCatalogOverview !== 'function') return 0;
  const catalogs = await store.listCatalogsAwaitingTikTokAudit(5);
  const now = Date.now();
  let refreshed = 0;
  for (const catalog of catalogs) {
    const progress = catalog && catalog.syncProgress || {};
    const key = [catalog && catalog.accountId, catalog && catalog.advertiserId, catalog && catalog.id].join(':');
    const dueAt = Date.parse(String(progress.nextAuditAt || '')) || 0;
    if (!catalog || !catalog.id || dueAt > now || now - (auditCheckedAt.get(key) || 0) < AUDIT_REFRESH_MS) continue;
    auditCheckedAt.set(key, now);
    const previousAttempts = Math.max(0, Number(progress.auditAttempts) || 0);
    if (previousAttempts >= AUDIT_MAX_ATTEMPTS) {
      const structured = auditTimeoutError(previousAttempts, progress.lastAuditError);
      if (typeof store.markSyncUnconfirmed === 'function') {
        await store.markSyncUnconfirmed(catalog.accountId, catalog.advertiserId, catalog.id);
      }
      if (catalog.syncRunId) {
        await store.updateSyncRun(catalog.accountId, catalog.syncRunId, 'failed', {
          stage: structured.stage, error: structured,
          progress: { ...progress, auditAttempts: previousAttempts, timedOutAt: new Date().toISOString() },
        });
      }
      await store.appendPublication(catalog.accountId, catalog.advertiserId, catalog.id, {
        kind: 'tiktok', status: 'error', feedUrl: progress.feedUrl,
        tiktokCatalogId: catalog.tiktokCatalogId, error: structured.userMessage,
      }).catch(() => {});
      refreshed += 1;
      continue;
    }
    let audit = null;
    let lastAuditError = null;
    try {
      audit = await provider.getTikTokCatalogOverview(catalog.bcId, catalog.tiktokCatalogId);
    } catch (err) {
      lastAuditError = String(err && err.message || err).slice(0, 500);
    }
    const auditAttempts = previousAttempts + 1;
    const checkedAt = new Date().toISOString();
    const updatedProgress = {
      ...progress,
      audit: audit || progress.audit || null,
      auditAttempts,
      lastAuditAt: checkedAt,
      lastAuditError,
    };
    const total = Number(audit && audit.total) || 0;
    if (total > 0) {
      await store.setAudit(catalog.accountId, catalog.advertiserId, catalog.id, audit);
      if (catalog.syncRunId) {
        await store.updateSyncRun(catalog.accountId, catalog.syncRunId, 'completed', {
          stage: 'reviewed_tiktok', progress: { ...updatedProgress, confirmedAt: checkedAt },
        });
      }
      await store.appendPublication(catalog.accountId, catalog.advertiserId, catalog.id, {
        kind: 'tiktok', status: 'success', published: progress.published, skipped: progress.skipped,
        feedUrl: progress.feedUrl, tiktokCatalogId: catalog.tiktokCatalogId, audit,
      }).catch(() => {});
    } else if (auditAttempts >= AUDIT_MAX_ATTEMPTS) {
      const structured = auditTimeoutError(auditAttempts, lastAuditError);
      if (typeof store.markSyncUnconfirmed === 'function') {
        await store.markSyncUnconfirmed(catalog.accountId, catalog.advertiserId, catalog.id);
      }
      if (catalog.syncRunId) {
        await store.updateSyncRun(catalog.accountId, catalog.syncRunId, 'failed', {
          stage: structured.stage, error: structured,
          progress: { ...updatedProgress, timedOutAt: checkedAt },
        });
      }
      await store.appendPublication(catalog.accountId, catalog.advertiserId, catalog.id, {
        kind: 'tiktok', status: 'error', feedUrl: progress.feedUrl,
        tiktokCatalogId: catalog.tiktokCatalogId, error: structured.userMessage,
      }).catch(() => {});
    } else if (catalog.syncRunId) {
      await store.updateSyncRun(catalog.accountId, catalog.syncRunId, 'waiting_tiktok_processing', {
        stage: 'processing_tiktok', release: true,
        progress: { ...updatedProgress, nextAuditAt: nextAuditAt(auditAttempts, now) },
      });
    }
    refreshed += 1;
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
    // `valid` é reavaliado pelo store contra a spec atual. Isso impede que um
    // run antigo continue enviando registros persistidos antes de `brand` se
    // tornar obrigatório e garante que o CSV público não seja só cabeçalho.
    const products = typeof store.listProducts === 'function'
      ? await store.listProducts(accountId, advertiserId, catalog.id)
      : [];
    const validProducts = products.filter((product) => product && product.valid);
    if (typeof store.listProducts === 'function' && !validProducts.length) {
      throw catalogError(
        'CATALOG_NO_VALID_PRODUCTS',
        'Nenhum produto válido pode ser enviado ao TikTok.',
        {
          status: 422, stage: 'validating_products', retryable: false,
          suggestedAction: 'Corrija os campos obrigatórios do produto, incluindo a marca real, e publique novamente.',
        },
      );
    }
    const publishedCount = typeof store.listProducts === 'function'
      ? validProducts.length : Number(payload.published) || 0;
    const skippedCount = typeof store.listProducts === 'function'
      ? Math.max(0, products.length - validProducts.length) : Number(payload.skipped) || 0;
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
      progress: {
        published: publishedCount, skipped: skippedCount,
        feedUrl: payload.feedUrl, tiktokCatalogId: catalog.tiktokCatalogId,
      },
    });
    const uploadedAt = new Date().toISOString();
    const uploadResponse = await provider.uploadTikTokCatalogProducts(
      catalog.bcId, catalog.tiktokCatalogId, payload.feedUrl, 'CSV',
    );
    const uploadReceipt = normalizeUploadReceipt(uploadResponse, uploadedAt);
    const remoteFeeds = await readRemoteFeedsDiagnostic(catalog);
    catalog = await store.markSynced(accountId, advertiserId, catalog.id);

    await store.updateSyncRun(accountId, runId, 'running', { stage: 'auditing_products', workerId });
    let audit = null;
    let lastAuditError = null;
    try {
      audit = await provider.getTikTokCatalogOverview(catalog.bcId, catalog.tiktokCatalogId);
    } catch (err) {
      lastAuditError = String(err && err.message || err).slice(0, 500);
    }
    const checkedAt = new Date().toISOString();
    const progress = {
      published: publishedCount,
      skipped: skippedCount,
      feedUrl: payload.feedUrl,
      tiktokCatalogId: catalog.tiktokCatalogId,
      uploadReceipt,
      remoteFeeds,
      audit,
      auditAttempts: 1,
      firstAuditAt: checkedAt,
      lastAuditAt: checkedAt,
      lastAuditError,
    };
    if (Number(audit && audit.total) > 0) {
      catalog = await store.setAudit(accountId, advertiserId, catalog.id, audit);
      await store.appendPublication(accountId, advertiserId, catalog.id, {
        kind: 'tiktok', status: 'success', published: publishedCount, skipped: skippedCount,
        feedUrl: payload.feedUrl, tiktokCatalogId: catalog.tiktokCatalogId, audit,
      });
      const completed = await store.updateSyncRun(accountId, runId, 'completed', {
        stage: 'reviewed_tiktok', progress: { ...progress, confirmedAt: checkedAt },
      });
      await adsOps.appendAuditEvent(accountId, {
        actorType: 'user', actorId: accountId, action: 'catalog_sync.completed',
        targetType: 'catalog', targetId: catalog.id, jobId: runId,
        afterState: { tiktokCatalogId: catalog.tiktokCatalogId, audit, uploadReceipt },
        reason: 'Produtos confirmados pelo overview do TikTok após o upload',
      }).catch(() => {});
      return completed;
    }

    // `job_id:null` e overview zerado são o caso observado em produção. O
    // retorno é preservado para diagnóstico, mas não vira sucesso definitivo.
    await store.appendPublication(accountId, advertiserId, catalog.id, {
      kind: 'tiktok', status: 'processing', published: publishedCount, skipped: skippedCount,
      feedUrl: payload.feedUrl, tiktokCatalogId: catalog.tiktokCatalogId, audit,
      error: lastAuditError || (!uploadReceipt.provable ? 'Upload sem recibo identificável; aguardando produtos no overview.' : null),
    });
    const waiting = await store.updateSyncRun(accountId, runId, 'waiting_tiktok_processing', {
      stage: 'processing_tiktok', release: true,
      progress: { ...progress, nextAuditAt: nextAuditAt(1) },
    });
    await adsOps.appendAuditEvent(accountId, {
      actorType: 'user', actorId: accountId, action: 'catalog_sync.waiting_tiktok',
      targetType: 'catalog', targetId: catalog.id, jobId: runId,
      afterState: { tiktokCatalogId: catalog.tiktokCatalogId, audit, uploadReceipt, remoteFeeds },
      reason: 'Upload enviado; aguardando o overview confirmar produtos',
    }).catch(() => {});
    return waiting;
  } catch (err) {
    const structured = serializeCatalogError(err, 'sync_tiktok');
    if (err && err.code === 'CATALOG_CREATE_CONNECTOR_CONFIRMATION_REQUIRED') {
      await store.updateSyncRun(accountId, runId, 'waiting_connector_confirmation', {
        stage: 'waiting_connector_confirmation', error: structured, release: true,
      });
      return null;
    }
    if (err && err.code === 'CATALOG_NO_VALID_PRODUCTS'
      && typeof store.markSyncUnconfirmed === 'function') {
      await store.markSyncUnconfirmed(accountId, advertiserId, row.catalog_id).catch(() => {});
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
  _internals: {
    refreshWaitingConnectorConfirmations,
    refreshPendingTikTokAudits,
    normalizeUploadReceipt,
    auditDelayMs,
    nextAuditAt,
    auditTimeoutError,
    AUDIT_MAX_ATTEMPTS,
  },
};
