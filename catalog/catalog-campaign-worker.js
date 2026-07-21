'use strict';

const crypto = require('crypto');
const store = require('../ads-catalog-store');
const provider = require('../ads-provider');
const adsOps = require('../ads-ops-store');
const adsSync = require('../ads-sync');
const { serializeCatalogError } = require('./catalog-domain');

const workerId = 'catalog-campaign-' + crypto.randomBytes(4).toString('hex');
let timer = null;
let busy = false;

async function processRun(row) {
  const accountId = String(row.account_id);
  const runId = String(row.id);
  const spec = row.spec || {};
  try {
    const result = await provider.createCatalogCampaign(row.advertiser_id, spec, {
      resume: row.created_ids || {},
      onProgress: async ({ stage, createdIds }) => {
        await store.updateCampaignRun(accountId, runId, 'running', { stage, createdIds, workerId });
      },
    });
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

module.exports = { start, stop, tick, processRun };
