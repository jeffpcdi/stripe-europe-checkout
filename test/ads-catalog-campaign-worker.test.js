'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

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
  console.log('catalog-campaign-worker — transporte não pode congelar a confirmação');
  {
    const transport = fs.readFileSync(path.join(__dirname, '..', 'pipeboard-mcp.js'), 'utf8');
    ok(/async function responseText\(res\)/.test(transport), 'corpo MCP possui leitura protegida');
    ok(/clearTimeout\(res && res\.__pipeboardTimer\)/.test(transport), 'timeout só é limpo depois do corpo');
    ok(!/clearTimeout\(timer\);\s*return res;/.test(transport), 'headers não desarmam o timeout prematuramente');
  }

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
        async getCatalog() { return catalog({ approved: 4, pending: 0 }); },
        async listProducts() { return [{ valid: true, updatedAt: '2026-07-21T10:00:00.000Z' }]; },
        async updateCampaignRun(_acc, _run, status, patch) { updates.push({ status, patch }); return { status, ...patch }; },
      },
      provider: {
        enabled: true,
        async getCatalogCapabilities() { return { catalogSingleVideoCampaign: false }; },
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
        async getCatalogCapabilities() { calls.capabilities += 1; return { catalogSingleVideoCampaign: true }; },
      },
    });
    try {
      eq(await harness.worker.refreshWaitingConnectorConfirmations(), 2, 'dois jobs preparados são promovidos para a revisão');
      eq(calls.capabilities, 1, 'capacidade é lida uma vez');
      eq(calls.promote, 1, 'promoção atômica é acionada uma vez');
    } finally { harness.restore(); }
  }

  console.log('catalog-campaign-worker — capa é retomada automaticamente sem reenviar vídeo');
  {
    const updates = [];
    const harness = withWorker({
      store: {
        enabled: true,
        async getCatalog() { return catalog({ approved: 4, pending: 0 }); },
        async listProducts() { return [{ valid: true, updatedAt: '2026-07-21T10:00:00.000Z' }]; },
        async updateCampaignRun(_acc, _run, status, patch) { updates.push({ status, patch }); return { status, ...patch }; },
      },
      provider: {
        enabled: true,
        async getCatalogCapabilities() { return { catalogSingleVideoCampaign: true }; },
        async createCatalogCampaign() {
          const error = new Error('capa ainda não propagou');
          error.step = 'cover';
          error.retryable = true;
          error.createdIds = { videoId: 'video_preservado' };
          throw error;
        },
      },
    });
    try {
      await harness.worker.processRun({
        id: 'run_cover', account_id: 'acc_1', advertiser_id: 'adv_1', catalog_id: 'cat_1',
        asset_attempts: 0, verify_attempts: 5,
        created_ids: { videoId: 'video_preservado' }, spec: {},
      });
      eq(updates.at(-1).status, 'retrying', 'capa transitória volta para a fila em vez de virar parcial');
      eq(updates.at(-1).patch.stage, 'cover', 'etapa de capa permanece explícita');
      eq(updates.at(-1).patch.createdIds.videoId, 'video_preservado', 'videoId é reutilizado');
      eq(updates.at(-1).patch.assetAttempts, 1, 'tentativa de asset fica persistida separadamente');
      ok(!Object.prototype.hasOwnProperty.call(updates.at(-1).patch, 'verifyAttempts'), 'retry da capa não consome tentativas de readback');
      ok(Boolean(updates.at(-1).patch.nextRetryAt), 'retry recebe backoff durável');

      await harness.worker.processRun({
        id: 'run_cover_exhausted', account_id: 'acc_1', advertiser_id: 'adv_1', catalog_id: 'cat_1',
        asset_attempts: 6, verify_attempts: 0,
        created_ids: { videoId: 'video_preservado' }, spec: {},
      });
      eq(updates.at(-1).status, 'partial', 'somente o limite de assets esgotado exige ação manual');
      ok(/Clique em Retomar/.test(updates.at(-1).patch.error.suggestedAction), 'limite esgotado não promete outro retry automático');
    } finally { harness.restore(); }
  }

  console.log('catalog-campaign-worker — só repete escritas inequivocamente seguras');
  {
    const updates = [];
    let mode = 'rate_limit';
    const harness = withWorker({
      store: {
        enabled: true,
        async getCatalog() { return catalog({ approved: 4, pending: 0 }); },
        async listProducts() { return [{ valid: true, updatedAt: '2026-07-21T10:00:00.000Z' }]; },
        async updateCampaignRun(_acc, _run, status, patch) { updates.push({ status, patch }); return { status, ...patch }; },
      },
      provider: {
        enabled: true,
        async getCatalogCapabilities() { return { catalogSingleVideoCampaign: true }; },
        async createCatalogCampaign() {
          const error = new Error(mode === 'rate_limit'
            ? 'TikTok rate limit: too many requests'
            : 'Pipeboard MCP: tempo limite excedido');
          error.step = 'campaign';
          error.retryable = true;
          error.safeAutomaticRetry = mode === 'rate_limit';
          error.createdIds = { videoId: 'video_1', coverImageId: 'cover_1', campaignName: 'Campanha 01' };
          throw error;
        },
      },
    });
    try {
      await harness.worker.processRun({
        id: 'run_rate_limit', account_id: 'acc_1', advertiser_id: 'adv_1', catalog_id: 'cat_1',
        creation_attempts: 0, created_ids: { videoId: 'video_1', coverImageId: 'cover_1' }, spec: {},
      });
      eq(updates.at(-1).status, 'retrying', 'rate limit anterior à escrita recebe retry automático');
      eq(updates.at(-1).patch.creationAttempts, 1, 'tentativa de criação tem contador próprio');
      ok(Boolean(updates.at(-1).patch.nextRetryAt), 'retry seguro recebe backoff durável');

      mode = 'timeout';
      await harness.worker.processRun({
        id: 'run_timeout', account_id: 'acc_1', advertiser_id: 'adv_1', catalog_id: 'cat_1',
        creation_attempts: 0, created_ids: { videoId: 'video_1', coverImageId: 'cover_1' }, spec: {},
      });
      eq(updates.at(-1).status, 'partial', 'timeout ambíguo não repete create cegamente');
      ok(!Object.prototype.hasOwnProperty.call(updates.at(-1).patch, 'creationAttempts'), 'timeout não consome nem agenda tentativa insegura');
    } finally { harness.restore(); }
  }

  console.log('catalog-campaign-worker — hidrata catálogo remoto antes de criar');
  {
    const updates = [];
    const created = [];
    const harness = withWorker({
      store: {
        enabled: true,
        async getCatalog() { return catalog({ approved: 4, pending: 0 }); },
        async listProducts() { return [{ valid: true, updatedAt: '2026-07-21T10:00:00.000Z' }]; },
        async updateCampaignRun(_acc, _run, status, patch) { updates.push({ status, patch }); return { status, ...patch }; },
      },
      provider: {
        enabled: true,
        async getCatalogCapabilities() { return { catalogSingleVideoCampaign: true }; },
        async createCatalogCampaign(advertiserId, spec, options) {
          created.push({ advertiserId, spec });
          await options.onProgress({ stage: 'creating_campaign', createdIds: { campaignId: 'camp_1' } });
          return {
            campaignId: 'camp_1', adGroupId: 'group_1', adId: 'ad_1',
            verification: { complete: true, hierarchy: true, productLink: true, targeting: true, identity: true, creative: true, noManualUrl: true, paused: true },
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

  console.log('catalog-campaign-worker — confirmação tardia é retomada sem duplicação');
  {
    const updates = [];
    const harness = withWorker({
      store: {
        enabled: true,
        async getCatalog() { return catalog({ approved: 4, pending: 0 }); },
        async listProducts() { return [{ valid: true, updatedAt: '2026-07-21T10:00:00.000Z' }]; },
        async updateCampaignRun(_acc, _run, status, patch) { updates.push({ status, patch }); return { status, ...patch }; },
      },
      provider: {
        enabled: true,
        async getCatalogCapabilities() { return { catalogSingleVideoCampaign: true }; },
        async createCatalogCampaign() {
          return { campaignId: 'camp_unsafe', adGroupId: 'group_unsafe', adId: 'ad_unsafe', verification: { complete: false, hierarchy: true } };
        },
      },
    });
    try {
      await harness.worker.processRun({ id: 'run_inconclusive', account_id: 'acc_1', advertiser_id: 'adv_1', catalog_id: 'cat_1', verify_attempts: 0, spec: {} });
      eq(updates.at(-1).status, 'waiting_tiktok_confirmation', 'resultado inconclusivo aguarda o readback sem recriar');
      eq(updates.at(-1).patch.stage, 'verifying_entities', 'etapa continua na verificação');
      eq(updates.at(-1).patch.error.code, 'CATALOG_PRODUCT_LINK_NOT_VERIFIED', 'erro preserva o motivo semântico');
      eq(updates.at(-1).patch.createdIds.adId, 'ad_unsafe', 'IDs existentes são preservados para pausa/retomada segura');
      eq(updates.at(-1).patch.verifyAttempts, 1, 'tentativa de confirmação fica persistida');
      ok(Boolean(updates.at(-1).patch.nextRetryAt), 'próxima leitura recebe backoff durável');

      await harness.worker.processRun({ id: 'run_exhausted', account_id: 'acc_1', advertiser_id: 'adv_1', catalog_id: 'cat_1', verify_attempts: 6, spec: {} });
      eq(updates.at(-1).status, 'partial', 'só esgota em parcial depois do limite de confirmações');
      eq(updates.at(-1).patch.stage, 'verify', 'falha final continua atribuída à verificação');
    } finally { harness.restore(); }
  }

  console.log('catalog-campaign-worker — Pixel pendente fica salvo até haver evento real');
  {
    const updates = [];
    const harness = withWorker({
      store: {
        enabled: true,
        async getCatalog() { return catalog({ approved: 4, pending: 0 }); },
        async listProducts() { return [{ valid: true, updatedAt: '2026-07-21T10:00:00.000Z' }]; },
        async updateCampaignRun(_acc, _run, status, patch) { updates.push({ status, patch }); return { status, ...patch }; },
      },
      provider: {
        enabled: true,
        async getCatalogCapabilities() { return { catalogSingleVideoCampaign: true }; },
        async createCatalogCampaign() {
          const error = new Error('Pixel ativo, mas Compra ainda não reconhecida');
          error.code = 'CATALOG_PURCHASE_EVENT_NOT_READY';
          error.step = 'pixel';
          error.retryable = true;
          throw error;
        },
      },
    });
    try {
      await harness.worker.processRun({ id: 'run_pixel', account_id: 'acc_1', advertiser_id: 'adv_1', catalog_id: 'cat_1', spec: {} });
      eq(updates.at(-1).status, 'waiting_pixel_purchase', 'ausência de Compra não vira falha do run');
      eq(updates.at(-1).patch.stage, 'waiting_pixel_purchase', 'estado de espera fica explícito');
      ok(Boolean(updates.at(-1).patch.nextRetryAt), 'worker agenda nova consulta automática do Pixel');
      eq(updates.at(-1).patch.release, true, 'lock é liberado enquanto aguarda o Pixel');
    } finally { harness.restore(); }
  }

  console.log('catalog-campaign-worker — ativa somente depois do readback pausado');
  {
    const updates = [];
    let activations = 0;
    const hierarchy = {
      campaignId: 'camp_active', adGroupId: 'group_active', adId: 'ad_active',
      verification: { complete: true, hierarchy: true, productLink: true, targeting: true, identity: true, creative: true, noManualUrl: true, paused: true },
    };
    const harness = withWorker({
      store: {
        enabled: true,
        async getCatalog() { return catalog({ approved: 4, pending: 0 }); },
        async listProducts() { return [{ valid: true, updatedAt: '2026-07-21T10:00:00.000Z' }]; },
        async updateCampaignRun(_acc, _run, status, patch) { updates.push({ status, patch }); return { status, ...patch }; },
      },
      provider: {
        enabled: true,
        async getCatalogCapabilities() { return { catalogSingleVideoCampaign: true }; },
        async createCatalogCampaign() { return hierarchy; },
        async activateCatalogCampaignHierarchy() {
          activations += 1;
          return { complete: true, active: true, verification: { complete: true, hierarchy: true, active: true } };
        },
      },
    });
    try {
      await harness.worker.processRun({
        id: 'run_active', account_id: 'acc_1', advertiser_id: 'adv_1', catalog_id: 'cat_1',
        spec: { autoActivate: true }, created_ids: {},
      });
      eq(activations, 1, 'ativação é chamada uma vez após a validação pausada');
      ok(updates.some((update) => update.patch.stage === 'activating'), 'etapa de ativação aparece antes da conclusão');
      eq(updates.at(-1).status, 'completed', 'run conclui somente após confirmação ativa');
      eq(updates.at(-1).patch.stage, 'ready_active', 'resultado final informa hierarquia ativa');
      ok(updates.at(-1).patch.result.activation.complete === true, 'readback ativo fica persistido');
    } finally { harness.restore(); }
  }

  console.log('catalog-campaign-worker — falha de ativação é retomável sem recriar');
  {
    const updates = [];
    const hierarchy = {
      campaignId: 'camp_retry', adGroupId: 'group_retry', adId: 'ad_retry',
      verification: { complete: true, hierarchy: true, productLink: true, targeting: true, identity: true, creative: true, noManualUrl: true, paused: true },
    };
    const harness = withWorker({
      store: {
        enabled: true,
        async getCatalog() { return catalog({ approved: 4, pending: 0 }); },
        async listProducts() { return [{ valid: true, updatedAt: '2026-07-21T10:00:00.000Z' }]; },
        async updateCampaignRun(_acc, _run, status, patch) { updates.push({ status, patch }); return { status, ...patch }; },
      },
      provider: {
        enabled: true,
        async getCatalogCapabilities() { return { catalogSingleVideoCampaign: true }; },
        async createCatalogCampaign() { return hierarchy; },
        async activateCatalogCampaignHierarchy() {
          const error = new Error('readback ainda não propagou');
          error.code = 'CATALOG_ACTIVATION_NOT_CONFIRMED';
          error.step = 'activate';
          error.retryable = true;
          error.safeAutomaticRetry = true;
          error.createdIds = { campaignId: 'camp_retry', adGroupId: 'group_retry', adId: 'ad_retry' };
          throw error;
        },
      },
    });
    try {
      await harness.worker.processRun({
        id: 'run_activation_retry', account_id: 'acc_1', advertiser_id: 'adv_1', catalog_id: 'cat_1',
        activation_attempts: 0, spec: { autoActivate: true }, created_ids: {},
      });
      eq(updates.at(-1).status, 'retrying', 'ativação transitória volta para a fila');
      eq(updates.at(-1).patch.stage, 'activating', 'retry preserva a etapa de ativação');
      eq(updates.at(-1).patch.activationAttempts, 1, 'ativação possui contador separado');
      ok(Boolean(updates.at(-1).patch.nextRetryAt), 'ativação recebe backoff durável');
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
