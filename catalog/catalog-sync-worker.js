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

async function processRun(row) {
  const accountId = String(row.account_id);
  const runId = String(row.id);
  const payload = row.payload || {};
  let catalog = await store.getCatalog(accountId, row.catalog_id);
  if (!catalog) {
    await store.updateSyncRun(accountId, runId, 'failed', {
      stage: 'failed', error: { code: 'CATALOG_NOT_FOUND', userMessage: 'Catálogo não encontrado.', retryable: false },
    });
    return null;
  }
  try {
    await store.updateSyncRun(accountId, runId, 'running', { stage: 'connecting_catalog', workerId });
    if (!catalog.tiktokCatalogId) {
      const created = await provider.createTikTokCatalog(payload.bcId, {
        name: catalog.name, catalogType: catalog.catalogType, currency: catalog.currency, country: catalog.country,
      });
      const remote = await gateway.verifyCatalogLink(provider, {
        bcId: payload.bcId, catalogId: created.catalogId, attempts: 3, delayMs: 750,
      });
      catalog = await store.linkTikTokCatalog(accountId, catalog.id, {
        tiktokCatalogId: created.catalogId, bcId: payload.bcId, verified: true, remoteSnapshot: remote,
      });
    } else if (catalog.linkStatus !== 'verified') {
      const remote = await gateway.verifyCatalogLink(provider, { bcId: catalog.bcId || payload.bcId, catalogId: catalog.tiktokCatalogId });
      catalog = await store.linkTikTokCatalog(accountId, catalog.id, {
        tiktokCatalogId: catalog.tiktokCatalogId, bcId: catalog.bcId || payload.bcId, verified: true, remoteSnapshot: remote,
      });
    }

    await store.updateSyncRun(accountId, runId, 'running', {
      stage: 'uploading_products', workerId,
      progress: { published: payload.published || 0, skipped: payload.skipped || 0, tiktokCatalogId: catalog.tiktokCatalogId },
    });
    await provider.uploadTikTokCatalogProducts(catalog.bcId, catalog.tiktokCatalogId, payload.feedUrl, 'CSV');
    catalog = await store.markSynced(accountId, catalog.id);

    await store.updateSyncRun(accountId, runId, 'running', { stage: 'auditing_products', workerId });
    let audit = null;
    try {
      audit = await provider.getTikTokCatalogOverview(catalog.bcId, catalog.tiktokCatalogId);
      catalog = await store.setAudit(accountId, catalog.id, audit);
    } catch (_) { /* o upload do TikTok pode continuar processando */ }

    await store.appendPublication(accountId, catalog.id, {
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
      reason: 'Catálogo publicado no TikTok',
    }).catch(() => {});
    return completed;
  } catch (err) {
    const structured = serializeCatalogError(err, 'sync_tiktok');
    await store.appendPublication(accountId, row.catalog_id, {
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

module.exports = { start, stop, tick, processRun };
