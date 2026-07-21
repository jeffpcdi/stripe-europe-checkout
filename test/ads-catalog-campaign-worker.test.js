'use strict';

const assert = require('assert');

const workerPath = require.resolve('../catalog/catalog-campaign-worker');
const storePath = require.resolve('../ads-catalog-store');
const providerPath = require.resolve('../ads-provider');
const opsPath = require.resolve('../ads-ops-store');
const syncPath = require.resolve('../ads-sync');

let assertions = 0;
function ok(value, label) {
  assert.ok(value, label);
  assertions += 1;
  console.log('  ✓ ' + label);
}
function eq(actual, expected, label) {
  assert.strictEqual(actual, expected, label + ' → esperado ' + expected + ', veio ' + actual);
  assertions += 1;
  console.log('  ✓ ' + label);
}

function catalog(audit) {
  return {
    id: 'cat_1', accountId: 'acc_1', advertiserId: 'adv_1',
    tiktokCatalogId: '123456789', bcId: '987654321', linkStatus: 'verified',
    audit, syncedAt: '2026-07-21T10:00:00.000Z', updatedAt: '2026-07-21T10:00:00.000Z',
  };
}

function withWorker(stubs) {
  const saved = new Map([
    [workerPath, require.cache[workerPath]], [storePath, require.cache[storePath]],
    [providerPath, require.cache[providerPath]], [opsPath, require.cache[opsPath]], [syncPath, require.cache[syncPath]],
  ]);
  function set(id, exports) {
    require.cache[id] = { id, filename: id, loaded: true, exports };
  }
  set(storePath, stubs.store);
  set(providerPath, stubs.provider);
  set(opsPath, { appendAuditEvent: async () => {} });
  set(syncPath, { syncAfterWrite() {} });
  delete require.cache[workerPath];
  const worker = require(workerPath);
  return {
    worker,
    restore() {
      delete require.cache[workerPath];
      for (const [id, previous] of saved) {
        if (previous) require.cache[id] = previous;
        else delete require.cache[id];
      }
    },
  };
}

async function main() {
  console.log('catalog-campaign-worker — espera a revisão sem criar anúncio');
  {
    const updates = [];
    const harness = withWorker({
      store: {
        enabled: true,
        async getCatalog() { return catalog({ approved: 0, pending: 1 }); },
        async listProducts() { return [{ valid: true, updatedAt: '2026-07-21T10:00:00.000Z' }]; },
        async updateCampaignRun(_acc, _run, status, patch) { updates.push({ status, patch }); return {}; },
      },
      provider: {
        enabled: true,
        async getCatalogCapabilities() { throw new Error('não deve consultar o conector antes da revisão'); },
      },
    });
    try {
      await harness.worker.processRun({ id: 'run_wait', account_id: 'acc_1', advertiser_id: 'adv_1', catalog_id: 'cat_1', spec: {} });
      eq(updates.length, 1, 'run é atualizado uma vez');
      eq(updates[0].status, 'waiting_catalog_review', 'run fica aguardando aprovação');
      eq(updates[0].patch.release, true, 'lock é liberado durante a revisão');
    } finally { harness.restore(); }
  }

  console.log('catalog-campaign-worker — conector pendente não vira falha');
  {
    const updates = [];
    let creates = 0;
    const harness = withWorker({
      store: {
        enabled: true,
        async getCatalog() { return catalog({ approved: 2, pending: 0 }); },
        async listProducts() { return [{ valid: true, updatedAt: '2026-07-21T10:00:00.000Z' }]; },
        async updateCampaignRun(_acc, _run, status, patch) { updates.push({ status, patch }); return { status, ...patch }; },
      },
      provider: {
        enabled: true,
        async getCatalogCapabilities() { return { manualCatalogCampaign: false }; },
        async createCatalogCampaign() { creates += 1; return {}; },
      },
    });
    try {
      await harness.worker.processRun({ id: 'run_connector', account_id: 'acc_1', advertiser_id: 'adv_1', catalog_id: 'cat_1', spec: {} });
      eq(creates, 0, 'não chama a criação enquanto Product Link não estiver confirmado');
      eq(updates.length, 1, 'run recebe uma transição de espera');
      eq(updates[0].status, 'waiting_connector_confirmation', 'run aguarda o conector em vez de falhar');
      eq(updates[0].patch.release, true, 'lock é liberado enquanto aguarda o conector');
    } finally { harness.restore(); }
  }

  console.log('catalog-campaign-worker — conector confirmado promove a fila preparada');
  {
    const calls = { capabilities: 0, promote: 0 };
    const harness = withWorker({
      store: {
        enabled: true,
        async promoteCampaignRunsAwaitingConnectorConfirmation() { calls.promote += 1; return [{ id: 'run_1' }, { id: 'run_2' }]; },
      },
      provider: {
        enabled: true,
        async getCatalogCapabilities() { calls.capabilities += 1; return { manualCatalogCampaign: true }; },
      },
    });
    try {
      eq(await harness.worker.refreshWaitingConnectorConfirmations(), 2, 'dois jobs preparados são promovidos para a revisão');
      eq(calls.capabilities, 1, 'capacidade é lida uma vez');
      eq(calls.promote, 1, 'promoção atômica é acionada uma vez');
    } finally { harness.restore(); }
  }

  console.log('catalog-campaign-worker — hidrata catálogo remoto antes de criar');
  {
    const updates = [];
    const created = [];
    const harness = withWorker({
      store: {
        enabled: true,
        async getCatalog() { return catalog({ approved: 2, pending: 0 }); },
        async listProducts() { return [{ valid: true, updatedAt: '2026-07-21T10:00:00.000Z' }]; },
        async updateCampaignRun(_acc, _run, status, patch) { updates.push({ status, patch }); return { status, ...patch }; },
      },
      provider: {
        enabled: true,
        async getCatalogCapabilities() { return { manualCatalogCampaign: true }; },
        async createCatalogCampaign(advertiserId, spec, options) {
          created.push({ advertiserId, spec });
          await options.onProgress({ stage: 'creating_campaign', createdIds: { campaignId: 'camp_1' } });
          return {
            campaignId: 'camp_1', adGroupId: 'group_1', adId: 'ad_1',
            verification: { complete: true, hierarchy: true, productLink: true, noManualUrl: true, paused: true },
          };
        },
      },
    });
    try {
      await harness.worker.processRun({
        id: 'run_ready', account_id: 'acc_1', advertiser_id: 'adv_1', catalog_id: 'cat_1',
        created_ids: {}, spec: { name: 'Lote', destination: 'PRODUCT_LINK', catalogId: 'errado', bcId: 'errado' },
      });
      eq(created.length, 1, 'provider é chamado depois da revisão');
      eq(created[0].spec.catalogId, '123456789', 'ID remoto atual substitui qualquer valor antigo');
      eq(created[0].spec.bcId, '987654321', 'Business Center atual é usado');
      eq(created[0].spec.destination, 'PRODUCT_LINK', 'destino Product Link é preservado');
      ok(!Object.prototype.hasOwnProperty.call(created[0].spec, 'landing_page_url'), 'spec não ganha URL manual');
      eq(updates.at(-1).status, 'completed', 'run só conclui após provider retornar hierarquia');
    } finally { harness.restore(); }
  }

  console.log('catalog-campaign-worker — IDs sem confirmação Product Link ficam parciais');
  {
    const updates = [];
    const harness = withWorker({
      store: {
        enabled: true,
        async getCatalog() { return catalog({ approved: 2, pending: 0 }); },
        async listProducts() { return [{ valid: true, updatedAt: '2026-07-21T10:00:00.000Z' }]; },
        async updateCampaignRun(_acc, _run, status, patch) { updates.push({ status, patch }); return { status, ...patch }; },
      },
      provider: {
        enabled: true,
        async getCatalogCapabilities() { return { manualCatalogCampaign: true }; },
        async createCatalogCampaign() {
          return { campaignId: 'camp_unsafe', adGroupId: 'group_unsafe', adId: 'ad_unsafe', verification: { complete: false, hierarchy: true } };
        },
      },
    });
    try {
      await harness.worker.processRun({ id: 'run_inconclusive', account_id: 'acc_1', advertiser_id: 'adv_1', catalog_id: 'cat_1', spec: {} });
      eq(updates.at(-1).status, 'partial', 'resultado inconclusivo não é marcado como concluído');
      eq(updates.at(-1).patch.stage, 'verify', 'falha é atribuída à verificação');
      eq(updates.at(-1).patch.error.code, 'CATALOG_PRODUCT_LINK_NOT_VERIFIED', 'erro preserva o motivo semântico');
      eq(updates.at(-1).patch.createdIds.adId, 'ad_unsafe', 'IDs existentes são preservados para pausa/retomada segura');
    } finally { harness.restore(); }
  }

  console.log('catalog-campaign-worker — auditoria em segundo plano é limitada');
  {
    const calls = { audit: 0, set: 0 };
    const waitingCatalog = catalog({ approved: 0, pending: 1 });
    const harness = withWorker({
      store: {
        enabled: true,
        async listCatalogsAwaitingCampaignReview() { return [waitingCatalog]; },
        async setAudit() { calls.set += 1; },
      },
      provider: {
        enabled: true,
        async getTikTokCatalogOverview() { calls.audit += 1; return { approved: 1, pending: 0 }; },
      },
    });
    try {
      eq(await harness.worker.refreshWaitingCatalogReviews(), 1, 'primeira consulta atualiza a auditoria');
      eq(await harness.worker.refreshWaitingCatalogReviews(), 0, 'consulta repetida respeita intervalo');
      eq(calls.audit, 1, 'TikTok é consultado uma vez no intervalo');
      eq(calls.set, 1, 'snapshot de auditoria é persistido');
    } finally { harness.restore(); }
  }

  console.log('\nads-catalog-campaign-worker: ' + assertions + ' asserts OK');
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
