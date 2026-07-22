'use strict';
/*
 * ads-provider (catálogos) — camada que cria/sobe catálogos no TikTok via
 * Pipeboard. As tools de catálogo exigem bc_id e URLs públicas; validar isso
 * ANTES de chamar a rede evita erros crus do TikTok e chamadas desperdiçadas.
 * Este teste cobre só os caminhos puros/validação (nenhuma chamada MCP real).
 */
const assert = require('assert');
const provider = require('../ads-provider');

let n = 0;
function ok(cond, label) { assert.ok(cond, label); n++; console.log('  ✓ ' + label); }
function eq(a, b, label) { assert.strictEqual(a, b, label + ' → esperado ' + b + ', veio ' + a); n++; console.log('  ✓ ' + label); }

async function throws(fn, status, label) {
  try { await fn(); ok(false, label + ' (deveria lançar)'); }
  catch (e) { eq(e.status, status, label); }
}

console.log('CATALOG_TYPES — enum do TikTok');
{
  ok(Array.isArray(provider.CATALOG_TYPES), 'é um array');
  ok(provider.CATALOG_TYPES.includes('ECOM'), 'inclui ECOM (e-commerce)');
  ok(!provider.CATALOG_TYPES.includes('PRODUCT_CATALOG'), 'não usa mais o legado PRODUCT_CATALOG');
}

console.log('Business Center — persistência por conta + advertiser');
{
  eq(provider.getBusinessCenterId('cat-test-acc'), '', 'conta nova não tem BC');
  provider.setBusinessCenterId('cat-test-acc', '  7012345678901234567  ');
  eq(provider.getBusinessCenterId('cat-test-acc'), '7012345678901234567', 'BC salvo e com trim');
  eq(provider.businessCenterFromEnv('cat-test-acc'), false, 'não veio do env (a conta gravou o seu)');
  // contas são isoladas
  eq(provider.getBusinessCenterId('cat-test-outra'), '', 'BC é por conta (não vaza)');
  provider.setBusinessCenterId('cat-test-acc', 'adv-a', '7011111111111111111');
  provider.setBusinessCenterId('cat-test-acc', 'adv-b', '7022222222222222222');
  eq(provider.getBusinessCenterId('cat-test-acc', 'adv-a'), '7011111111111111111', 'BC específico do advertiser A');
  eq(provider.getBusinessCenterId('cat-test-acc', 'adv-b'), '7022222222222222222', 'BC específico do advertiser B');
  eq(provider.getBusinessCenterId('cat-test-acc', 'adv-legado'), '7012345678901234567', 'advertiser sem valor usa o BC legado preservado');
}

console.log('createTikTokCatalog — validação antes da rede');
(async () => {
  await throws(() => provider.createTikTokCatalog('', { name: 'Loja' }), 422, 'sem bc_id → 422');
  await throws(() => provider.createTikTokCatalog('7012345678901234567', { name: '' }), 400, 'sem nome → 400');

  console.log('uploadTikTokCatalogProducts — exige args e URL https pública');
  await throws(() => provider.uploadTikTokCatalogProducts('', 'cat1', 'https://x/f.csv'), 400, 'sem bc/catalog → 400');
  await throws(() => provider.uploadTikTokCatalogProducts('7012345678901234567', 'cat1', 'ftp://x/f.csv'), 400, 'URL não-https → 400');

  console.log('getTikTokCatalogUploadStatus — feed_log é a prova do upload atual');
  await throws(() => provider.getTikTokCatalogUploadStatus('7012345678901234567', 'cat1', ''), 400, 'sem feed_log_id → 400');
  const partialUpload = provider._internals.normalizeCatalogUploadStatus({
    feed_log_id: 'log_1', process_status: 'SUCCESS', add_count: 6,
    error_count: 4, warn_count: 1,
    feed_log_data: { error_affected_products: [{ field: 'brand', issue: 'missing' }] },
  });
  eq(partialUpload.failed, true, 'SUCCESS com erro por produto não vira sucesso');
  eq(partialUpload.succeeded, false, 'ingestão parcial fica inconclusiva para sincronização');
  eq(partialUpload.errors.length, 1, 'preserva diagnóstico acionável do produto');

  console.log('getTikTokCatalogOverview — exige bc_id e catalog_id');
  await throws(() => provider.getTikTokCatalogOverview('', ''), 400, 'sem ids → 400');

  console.log('getTikTokCatalogUploadStatus — exige bc_id, catalog_id e feed_log_id');
  await throws(() => provider.getTikTokCatalogUploadStatus('7012345678901234567', 'cat1', ''), 400, 'sem feed_log_id → 400');
  {
    const nz = provider._internals.normalizeCatalogUploadStatus;
    const okUp = nz({ process_status: 'SUCCESS', added: '10', updated: '0', error_count: '0', feed_log_data: [] });
    eq(okUp.status, 'success', 'SUCCESS → status success');
    eq(okUp.added, 10, 'added parseado como número');
    const failUp = nz({ process_status: 'FAIL', add_count: 3, error_count: 2, feed_log_data: [
      { sku_id: 'SKU1', message: 'brand ausente' },
      { item_id: 'SKU2', error: 'preço inválido' },
    ] });
    eq(failUp.status, 'failed', 'FAIL → status failed');
    eq(failUp.errorCount, 2, 'errorCount lido');
    eq(failUp.sampleErrors.length, 2, 'erros por produto capturados');
    eq(failUp.sampleErrors[0].sku, 'SKU1', 'sku do 1º erro');
    eq(failUp.sampleErrors[0].message, 'brand ausente', 'motivo do 1º erro');
    const proc = nz({ process_status: 'processing' });
    eq(proc.status, 'processing', 'processing preservado');
    const unk = nz({});
    eq(unk.status, 'unknown', 'sem status → unknown');
  }

  console.log('getTikTokCatalogFeeds — leitura diagnóstica não confunde zero com falha');
  await throws(() => provider.getTikTokCatalogFeeds('', ''), 400, 'feeds sem ids → 400');
  const emptyFeeds = provider._internals.normalizeCatalogFeeds({ total_feeds: 0, feeds: [] });
  eq(emptyFeeds.total, 0, 'zero feeds é preservado como diagnóstico');
  eq(emptyFeeds.feeds.length, 0, 'lista vazia não ganha feed sintético');

  console.log('listTikTokCatalogs — pagina TODAS as páginas (catálogo além da 1ª não some)');
  {
    const pipeboard = require('../pipeboard-mcp');
    const orig = pipeboard.callTool;
    const pagesSeen = [];
    pipeboard.callTool = async (name, args) => {
      pagesSeen.push(args.page);
      if (name !== 'get_tiktok_catalogs') return {};
      if (args.page === 1) return { catalogs: Array.from({ length: 50 }, (_, i) => ({ catalog_id: 'p1_' + i, catalog_name: 'c' + i })) };
      if (args.page === 2) return { catalogs: [{ catalog_id: 'alvo7662', catalog_name: 'está na 2ª página' }] };
      return { catalogs: [] };
    };
    try {
      const list = await provider.listTikTokCatalogs('7099999999999999999');
      eq(list.length, 51, 'agrega página 1 (50 cheia) + página 2 (1)');
      ok(list.some((c) => (c.catalog_id || c.id) === 'alvo7662'), 'acha o catálogo que estava na 2ª página');
      ok(pagesSeen.includes(2), 'consultou a página 2 (não parou na 1ª cheia)');
    } finally { pipeboard.callTool = orig; }
  }

  console.log('\nads-catalog-tiktok: ' + n + ' asserts OK');
})().catch((e) => { console.error(e); process.exit(1); });
