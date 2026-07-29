'use strict';

const crypto = require('crypto');
const store = require('../ads-catalog-store');
const provider = require('../ads-provider');
const adsOps = require('../ads-ops-store');
const adsSync = require('../ads-sync');
const { serializeCatalogError, computeReadiness, catalogError } = require('./catalog-domain');

const workerId = 'catalog-campaign-' + crypto.randomBytes(4).toString('hex');
let timer = null;
let busy = false;
const reviewCheckedAt = new Map();
const REVIEW_REFRESH_MS = 60 * 1000;
let connectorCheckedAt = 0;
const CONNECTOR_REFRESH_MS = 60 * 1000;

function hasVerifiedProductLinkHierarchy(result) {
  const value = result || {};
  const verification = value.verification || {};
  return Boolean(
    value.campaignId && value.adGroupId && value.adId
    && verification.complete === true
    && verification.hierarchy === true
    && verification.productLink === true
    && verification.noManualUrl === true
    && verification.paused === true,
  );
}

// Um job preparado pelo lote não pode sequer entrar na etapa de auditoria do
// catálogo enquanto o conector não provar que entende Product Link. A leitura
// da capacidade é limitada; o provider já possui cache próprio dos schemas.
async function refreshWaitingConnectorConfirmations() {
  if (!store.enabled || !provider.enabled
    || typeof provider.getCatalogCapabilities !== 'function'
    || typeof store.promoteCampaignRunsAwaitingConnectorConfirmation !== 'function') return 0;
  const now = Date.now();
  if (now - connectorCheckedAt < CONNECTOR_REFRESH_MS) return 0;
  connectorCheckedAt = now;
  try {
    const capabilities = await provider.getCatalogCapabilities();
    if (!capabilities || !capabilities.catalogSingleVideoCampaign) return 0;
    const promoted = await store.promoteCampaignRunsAwaitingConnectorConfirmation(20);
    return Array.isArray(promoted) ? promoted.length : 0;
  } catch (_) {
    // Não transforma indisponibilidade transitória em falha de campanha: o
    // lote continua em espera e o próximo ciclo tenta confirmar novamente.
    return 0;
  }
}

async function waitForCatalogReview(accountId, row) {
  const advertiserId = String(row.advertiser_id || '');
  const catalog = await store.getCatalog(accountId, advertiserId, row.catalog_id);
  if (!catalog) {
    throw catalogError('CATALOG_NOT_FOUND', 'Catálogo não encontrado.', { status: 404, retryable: false });
  }
  const products = await store.listProducts(accountId, advertiserId, catalog.id);
  const readiness = computeReadiness(catalog, products, { advertiserId });
  if (!readiness.readyForCampaign) {
    await store.updateCampaignRun(accountId, row.id, 'waiting_catalog_review', {
      stage: 'waiting_catalog_review', release: true,
    });
    return null;
  }
  return {
    catalog,
    spec: { ...(row.spec || {}), catalogId: catalog.tiktokCatalogId, bcId: catalog.bcId },
  };
}

// Atualiza lentamente só os catálogos que possuem campanha aguardando análise.
// Uma chamada por catálogo/minuto evita poll agressivo e elimina a dependência
// da tela aberta para iniciar automaticamente as campanhas pausadas do lote.
async function refreshWaitingCatalogReviews() {
  if (!store.enabled || !provider.enabled || typeof store.listCatalogsAwaitingCampaignReview !== 'function') return 0;
  const catalogs = await store.listCatalogsAwaitingCampaignReview(5);
  const now = Date.now();
  let refreshed = 0;
  for (const catalog of catalogs) {
    const key = String(catalog.id || '');
    if (!key || now - (reviewCheckedAt.get(key) || 0) < REVIEW_REFRESH_MS) continue;
    reviewCheckedAt.set(key, now);
    try {
      const audit = await provider.getTikTokCatalogOverview(catalog.bcId, catalog.tiktokCatalogId);
      await store.setAudit(catalog.accountId, catalog.advertiserId, catalog.id, audit);
      refreshed += 1;
    } catch (_) {
      // A sync ou o Catalog Manager pode ainda estar processando. Mantemos o
      // run em espera e tentamos novamente depois, sem marcar falha parcial.
    }
  }
  return refreshed;
}

async function processRun(row) {
  const accountId = String(row.account_id);
  const runId = String(row.id);
  try {
    const ready = await waitForCatalogReview(accountId, row);
    if (!ready) return null;
    const capabilities = await provider.getCatalogCapabilities();
    if (!capabilities.catalogSingleVideoCampaign) {
      await store.updateCampaignRun(accountId, runId, 'waiting_connector_confirmation', {
        stage: 'waiting_connector_confirmation', release: true,
      });
      return null;
    }
    const spec = ready.spec;
    const result = await provider.createCatalogCampaign(row.advertiser_id, spec, {
      resume: row.created_ids || {},
      onProgress: async ({ stage, createdIds }) => {
        await store.updateCampaignRun(accountId, runId, 'running', { stage, createdIds, workerId });
      },
    });
    if (!hasVerifiedProductLinkHierarchy(result)) {
      throw catalogError(
        'CATALOG_PRODUCT_LINK_NOT_VERIFIED',
        'A criação retornou IDs, mas não confirmou a campanha Product Link nos três níveis, pausada e sem URL manual.',
        {
          status: 502, stage: 'verify', retryable: true,
          createdIds: {
            campaignId: result && result.campaignId,
            adGroupId: result && result.adGroupId,
            adId: result && result.adId,
          },
          suggestedAction: 'Aguarde a leitura do TikTok estabilizar e retome somente quando o conector confirmar Product Link, catálogo e status dos três níveis.',
        },
      );
    }
    const completed = await store.updateCampaignRun(accountId, runId, 'completed', {
      stage: 'ready_paused', createdIds: result, result,
    });
    await adsOps.appendAuditEvent(accountId, {
      actorType: 'user', actorId: accountId, action: 'catalog_campaign.completed',
      targetType: 'campaign', targetId: result.campaignId, advertiserId: row.advertiser_id,
      jobId: runId, afterState: result, reason: 'Campanha de catálogo criada e verificada (PAUSADA)',
      metadata: { catalogId: row.catalog_id },
    }).catch(() => {});
    adsSync.syncAfterWrite(accountId, row.advertiser_id);
    return completed;
  } catch (err) {
    const createdIds = (err && err.createdIds) || row.created_ids || {};
    const structured = serializeCatalogError(err, err && err.step);
    const status = Object.keys(createdIds).length ? 'partial' : 'failed';
    await store.updateCampaignRun(accountId, runId, status, {
      stage: structured.stage || status, createdIds, error: structured,
    });
    await adsOps.appendAuditEvent(accountId, {
      actorType: 'system', actorId: workerId, action: 'catalog_campaign.failed',
      targetType: 'campaign', targetId: createdIds.campaignId || null,
      advertiserId: row.advertiser_id, jobId: runId, afterState: createdIds,
      reason: structured.userMessage, metadata: { catalogId: row.catalog_id, error: structured },
    }).catch(() => {});
    return null;
  }
}

async function tick() {
  if (busy || !store.enabled || !provider.enabled) return;
  busy = true;
  try {
    await refreshWaitingConnectorConfirmations();
    await refreshWaitingCatalogReviews();
    if (typeof store.promoteCampaignRunsAwaitingReview === 'function') {
      await store.promoteCampaignRunsAwaitingReview(20);
    }
    const row = await store.claimNextCampaignRun(workerId);
    if (row) await processRun(row);
  } catch (err) {
    console.warn('[catalog-campaign-worker] tick falhou:', String(err && err.message || err).slice(0, 240));
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
  start, stop, tick, processRun, refreshWaitingConnectorConfirmations,
  refreshWaitingCatalogReviews, waitForCatalogReview,
  _internals: { hasVerifiedProductLinkHierarchy },
};
