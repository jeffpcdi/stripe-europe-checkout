'use strict';

const assert = require('assert');
const executor = require('../catalog/catalog-batch-executor');

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

function product(skuId) {
  return {
    data: {
      sku_id: skuId,
      title: 'Produto ' + skuId,
      link: 'https://loja.example/' + skuId,
    },
  };
}

function catalog(key, products, campaigns) {
  return {
    key,
    name: 'Catálogo ' + key,
    currency: 'BRL',
    country: 'BR',
    catalogType: 'ECOM',
    products: products || [],
    campaigns: campaigns || [],
  };
}

async function main() {
console.log('catalog-batch-executor — bloqueia URL manual antes de qualquer efeito');
{
  const calls = [];
  const result = await executor.executeCatalogBatch({
    catalogs: [catalog('manual', [product('sku-manual')], [{
      name: 'Não pode',
      creative: { landing_page_url_list: [{ landing_page_url: 'https://manual.example' }] },
    }])],
  }, {
    async createCatalog() { calls.push('create'); return { id: 'cat-manual' }; },
    async upsertProduct() { calls.push('product'); return { id: 'prod-manual' }; },
    async enqueueCampaign() { calls.push('campaign'); return { id: 'run-manual' }; },
  }, { queueCampaigns: true });

  eq(result.ok, false, 'plano com URL manual falha');
  eq(result.results[0].status, 'failed', 'catálogo inválido não inicia');
  eq(result.results[0].error.stage, 'validation', 'falha acontece na pré-validação');
  ok(result.results[0].validationErrors.some((error) => error.code === 'CAMPAIGN_AD_LEVEL_URL_FORBIDDEN'), 'erro Product Link é explícito');
  eq(calls.length, 0, 'nenhuma dependência recebe uma URL manual');
}

console.log('catalog-batch-executor — defesa repete bloqueio em URL profunda');
{
  const calls = [];
  const nested = {};
  let cursor = nested;
  for (let index = 0; index < 12; index += 1) {
    cursor.creative = {};
    cursor = cursor.creative;
  }
  cursor.deeplink = 'https://manual.example/deep';
  const result = await executor.executeCatalogBatch({
    catalogs: [catalog('profunda', [product('sku-profunda')], [{ name: 'Sem URL', ...nested }])],
  }, {
    async createCatalog() { calls.push('create'); return { id: 'cat-profunda' }; },
    async upsertProduct() { calls.push('product'); return { id: 'prod-profunda' }; },
  }, {});
  eq(result.ok, false, 'a defesa recusa URL escondida');
  ok(result.results[0].validationErrors.some((error) => error.field.endsWith('.deeplink')), 'campo profundo é identificado');
  eq(calls.length, 0, 'nenhuma escrita é chamada depois da defesa profunda');
}

console.log('catalog-batch-executor — falha de produto interrompe somente o catálogo dono');
{
  const calls = [];
  const result = await executor.executeCatalogBatch({
    catalogs: [
      catalog('falha', [product('sku-ok'), product('sku-falha'), product('sku-nao-roda')], [{ name: 'Não deve enfileirar' }]),
      catalog('continua', [product('sku-continuar')], [{ name: 'Pode enfileirar' }]),
    ],
  }, {
    async createCatalog(_ctx, input) {
      calls.push('create:' + input.name);
      return { id: input.name };
    },
    async upsertProduct(_ctx, _catalog, item) {
      calls.push('product:' + item.data.sku_id);
      if (item.data.sku_id === 'sku-falha') {
        const error = new Error('Produto recusado pelo store de teste.');
        error.code = 'PRODUCT_REJECTED';
        throw error;
      }
      return { id: item.data.sku_id };
    },
    async enqueueSync(_ctx, localCatalog) {
      calls.push('sync:' + localCatalog.id);
      return { id: 'sync-' + localCatalog.id };
    },
    async enqueueCampaign(_ctx, localCatalog, campaign) {
      calls.push('campaign:' + localCatalog.id + ':' + campaign.destination);
      return { id: 'camp-' + localCatalog.id };
    },
  }, { queueSync: true, queueCampaigns: true, concurrency: 1 });

  eq(result.ok, false, 'o lote mostra que uma parte falhou');
  eq(result.results[0].status, 'failed', 'primeiro catálogo falha');
  eq(result.results[0].products.upserted, 1, 'produto anterior é preservado');
  eq(result.results[0].products.skipped, 1, 'produto posterior é pulado');
  eq(result.results[0].campaigns.skipped, 1, 'campanha do catálogo com erro é pulada');
  ok(!calls.some((call) => call === 'sync:Catálogo falha'), 'sincronização não ocorre após falha de produto');
  ok(!calls.some((call) => call === 'campaign:Catálogo falha:PRODUCT_LINK'), 'campanha não ocorre após falha de produto');
  eq(result.results[1].status, 'completed', 'outro catálogo continua normalmente');
  eq(result.results[1].campaigns.queued, 1, 'campanha do outro catálogo é enfileirada');
  ok(calls.some((call) => call === 'campaign:Catálogo continua:PRODUCT_LINK'), 'destino enviado é Product Link');
}

console.log('catalog-batch-executor — sucesso múltiplo mantém ordem e limite de concorrência');
{
  const calls = [];
  let activeCreates = 0;
  let peakCreates = 0;
  const result = await executor.executeCatalogBatch({
    catalogs: [
      catalog('um', [product('sku-um')], [{ name: 'Campanha um' }]),
      catalog('dois', [product('sku-dois')], [{ name: 'Campanha dois' }]),
      catalog('tres', [product('sku-tres')], [{ name: 'Campanha três' }]),
    ],
  }, {
    async createCatalog(_ctx, input) {
      activeCreates += 1;
      peakCreates = Math.max(peakCreates, activeCreates);
      await new Promise((resolve) => setTimeout(resolve, input.name.includes('um') ? 18 : 4));
      activeCreates -= 1;
      calls.push('create:' + input.name);
      return { id: input.name.toLowerCase().replace(/\s+/g, '-') };
    },
    async upsertProduct(_ctx, localCatalog, item) {
      calls.push('product:' + localCatalog.id + ':' + item.data.sku_id);
      return { id: item.data.sku_id };
    },
    async enqueueSync(_ctx, localCatalog) {
      calls.push('sync:' + localCatalog.id);
      return { id: 'sync-' + localCatalog.id };
    },
    async enqueueCampaign(_ctx, localCatalog, campaign, dependency) {
      calls.push('campaign:' + localCatalog.id + ':' + campaign.destination);
      ok(!Object.prototype.hasOwnProperty.call(campaign, 'landingPageUrl'), 'payload de campanha não recebe URL manual');
      eq(campaign.destination, 'PRODUCT_LINK', 'campaigna criada com Product Link');
      ok(!!dependency.syncRun, 'campanha recebe referência da sincronização enfileirada');
      return { id: 'campaign-' + localCatalog.id };
    },
  }, { queueSync: true, queueCampaigns: true, concurrency: 2, batchId: 'teste-multiplo' });

  eq(result.ok, true, 'todos os catálogos são concluídos');
  assert.deepStrictEqual(result.results.map((item) => item.key), ['um', 'dois', 'tres']);
  assertions += 1; console.log('  ✓ resultados preservam a ordem do plano');
  eq(result.summary.catalogs.completed, 3, 'resumo conta três catálogos concluídos');
  eq(result.summary.products.upserted, 3, 'resumo conta todos os produtos');
  eq(result.summary.sync.queued, 3, 'sincronização é enfileirada para cada catálogo');
  eq(result.summary.campaigns.queued, 3, 'campanhas são enfileiradas para cada catálogo');
  ok(peakCreates <= 2, 'concorrência de catálogos respeita o limite configurado');
  eq(calls.filter((call) => call.startsWith('campaign:')).length, 3, 'três chamadas de campanha são feitas');
}

console.log('\ncatalog-batch-executor: ' + assertions + ' asserts OK');
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
