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
const RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000, 120_000, 300_000];

function hasVerifiedProductLinkHierarchy(result) {
  const value = result || {};
  const verification = value.verification || {};
  return Boolean(
    value.campaignId && value.adGroupId && value.adId
    && verification.complete === true
    && verification.hierarchy === true
    && verification.productLink === true
    && verification.targeting === true
    && verification.identity === true
    && verification.creative === true
    && verification.noManualUrl === true
    && verification.paused === true,
  );
}

function hasVerifiedActiveHierarchy(result) {
  const activation = result && result.activation || {};
  const verification = activation.verification || {};
  return Boolean(
    activation.complete === true
    && activation.active === true
    && verification.complete === true
    && verification.hierarchy === true
    && verification.active === true,
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
    let result = await provider.createCatalogCampaign(row.advertiser_id, spec, {
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
    if (spec.autoActivate === true) {
      await store.updateCampaignRun(accountId, runId, 'running', {
        stage: 'activating', createdIds: result, workerId,
      });
      const activation = await provider.activateCatalogCampaignHierarchy(row.advertiser_id, {
        campaignId: result.campaignId,
        adGroupId: result.adGroupId,
        adId: result.adId,
      });
      result = { ...result, activation };
      if (!hasVerifiedActiveHierarchy(result)) {
        throw catalogError(
          'CATALOG_ACTIVATION_NOT_VERIFIED',
          'A hierarquia foi criada, mas o TikTok ainda não confirmou os três níveis como ativos.',
          {
            status: 502, stage: 'activate', retryable: true,
            createdIds: {
              campaignId: result.campaignId,
              adGroupId: result.adGroupId,
              adId: result.adId,
            },
            suggestedAction: 'Nenhuma ação manual é necessária; a dashboard repetirá a ativação com a mesma hierarquia.',
          },
        );
      }
    }
    const activated = spec.autoActivate === true;
    const completed = await store.updateCampaignRun(accountId, runId, 'completed', {
      stage: activated ? 'ready_active' : 'ready_paused', createdIds: result, result,
      assetAttempts: 0, creationAttempts: 0, verifyAttempts: 0, activationAttempts: 0, nextRetryAt: null,
    });
    await adsOps.appendAuditEvent(accountId, {
      actorType: 'user', actorId: accountId, action: 'catalog_campaign.completed',
      targetType: 'campaign', targetId: result.campaignId, advertiserId: row.advertiser_id,
      jobId: runId, afterState: result,
      reason: activated
        ? 'Campanha de catálogo criada, verificada e ativada'
        : 'Campanha de catálogo criada e verificada (PAUSADA)',
      metadata: { catalogId: row.catalog_id },
    }).catch(() => {});
    adsSync.syncAfterWrite(accountId, row.advertiser_id);
    return completed;
  } catch (err) {
    const createdIds = (err && err.createdIds) || row.created_ids || {};
    const structured = serializeCatalogError(err, err && err.step);
    const failedStage = String(structured.stage || err && err.step || '').toLowerCase();
    if (['CATALOG_PURCHASE_EVENT_NOT_READY', 'CATALOG_PIXEL_STATUS_UNAVAILABLE'].includes(structured.code)) {
      await store.updateCampaignRun(accountId, runId, 'waiting_pixel_purchase', {
        stage: 'waiting_pixel_purchase', createdIds, error: structured,
        nextRetryAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        release: true,
      });
      return null;
    }
    // Vídeo e capa são assets idempotentes. Falhas transitórias nessa fase
    // nunca devem exigir outro upload nem intervenção do usuário: o videoId é
    // preservado e o mesmo run volta com backoff antes de criar a campanha.
    const assetPending = !createdIds.campaignId
      && structured.retryable !== false
      && ['upload', 'cover'].includes(failedStage);
    if (assetPending) {
      const assetAttempt = Math.max(0, Number(row.asset_attempts) || 0) + 1;
      const assetDelay = RETRY_DELAYS_MS[assetAttempt - 1];
      if (assetDelay != null) {
        await store.updateCampaignRun(accountId, runId, 'retrying', {
          stage: failedStage, createdIds, error: structured,
          assetAttempts: assetAttempt,
          nextRetryAt: new Date(Date.now() + assetDelay).toISOString(),
          release: true,
        });
        return null;
      }
      structured.suggestedAction = 'As tentativas automáticas terminaram. Clique em Retomar para reutilizar o mesmo vídeo e tentar novamente.';
    }
    // Somente recusas inequivocamente anteriores à escrita (rate limit,
    // agenda inválida e indisponibilidade declarada pelo TikTok) podem repetir
    // um create automaticamente. Timeout/rede são ambíguos e ficam fora para
    // nunca duplicar uma entidade que talvez tenha sido criada sem resposta.
    const expectedIdMissing = (failedStage === 'campaign' && !createdIds.campaignId)
      || (failedStage === 'adgroup' && createdIds.campaignId && !createdIds.adGroupId)
      || (failedStage === 'ad' && createdIds.campaignId && createdIds.adGroupId && !createdIds.adId);
    const creationPending = structured.safeAutomaticRetry === true && expectedIdMissing;
    if (creationPending) {
      const creationAttempt = Math.max(0, Number(row.creation_attempts) || 0) + 1;
      const creationDelay = RETRY_DELAYS_MS[creationAttempt - 1];
      if (creationDelay != null) {
        await store.updateCampaignRun(accountId, runId, 'retrying', {
          stage: failedStage, createdIds, error: structured,
          creationAttempts: creationAttempt,
          nextRetryAt: new Date(Date.now() + creationDelay).toISOString(),
          release: true,
        });
        return null;
      }
      structured.suggestedAction = 'As tentativas automáticas seguras terminaram. Retome para revalidar os dados antes de uma nova criação.';
    }
    const hierarchyCreated = Boolean(createdIds.campaignId && createdIds.adGroupId && createdIds.adId);
    const verificationPending = hierarchyCreated
      && structured.retryable !== false
      && failedStage === 'verify';
    if (verificationPending) {
      const verifyAttempt = Math.max(0, Number(row.verify_attempts) || 0) + 1;
      const verifyDelay = RETRY_DELAYS_MS[verifyAttempt - 1];
      if (verifyDelay != null) {
        await store.updateCampaignRun(accountId, runId, 'waiting_tiktok_confirmation', {
          stage: 'verifying_entities', createdIds, error: structured,
          verifyAttempts: verifyAttempt,
          nextRetryAt: new Date(Date.now() + verifyDelay).toISOString(),
          release: true,
        });
        return null;
      }
    }
    const activationPending = hierarchyCreated
      && structured.retryable !== false
      && failedStage === 'activate';
    if (activationPending) {
      const activationAttempt = Math.max(0, Number(row.activation_attempts) || 0) + 1;
      // Updates de status são idempotentes. Depois do backoff inicial, uma
      // indisponibilidade transitória continua em 5 min sem recriar nenhuma
      // entidade; erros permanentes já chegam com retryable=false.
      const activationDelay = RETRY_DELAYS_MS[Math.min(activationAttempt - 1, RETRY_DELAYS_MS.length - 1)];
      await store.updateCampaignRun(accountId, runId, 'retrying', {
        stage: 'activating', createdIds, error: structured,
        activationAttempts: activationAttempt,
        nextRetryAt: new Date(Date.now() + activationDelay).toISOString(),
        release: true,
      });
      return null;
    }
    const status = Object.keys(createdIds).length ? 'partial' : 'failed';
    await store.updateCampaignRun(accountId, runId, status, {
      stage: structured.stage || status, createdIds, error: structured,
      nextRetryAt: null,
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
  _internals: { hasVerifiedProductLinkHierarchy, hasVerifiedActiveHierarchy },
};
