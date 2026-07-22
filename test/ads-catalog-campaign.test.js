'use strict';
// Contrato Catalog Carousel/Product Link: preflight completo antes de escrita,
// hierarquia pausada, item_group_id por produto e leitura final sem URL manual.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const provider = require('../ads-provider');

let n = 0;
function ok(cond, label) { assert.ok(cond, label); n += 1; console.log('  ✓ ' + label); }
async function throws(fn, status, label, code) {
  try { await fn(); ok(false, label + ' (deveria lançar)'); }
  catch (err) {
    assert.strictEqual(err.status, status, label + ' status=' + err.status);
    if (code) assert.strictEqual(err.code, code, label + ' code=' + err.code);
    n += 1; console.log('  ✓ ' + label);
  }
}

function schemaTool(name, fields, required) {
  return {
    name,
    inputSchema: {
      properties: Array.isArray(fields) ? Object.fromEntries(fields.map((field) => [field, {}])) : fields,
      ...(required ? { required } : {}),
    },
  };
}

const readbackTools = ['get_tiktok_campaigns', 'get_tiktok_adgroups', 'get_tiktok_ads'].map((name) => schemaTool(name, []));

async function catalogCapabilitiesForSchemas(tools) {
  const providerPath = require.resolve('../ads-provider.js');
  const pipeboardPath = require.resolve('../pipeboard-mcp.js');
  const savedProvider = require.cache[providerPath];
  const savedPipeboard = require.cache[pipeboardPath];
  try {
    require.cache[pipeboardPath] = {
      id: pipeboardPath, filename: pipeboardPath, loaded: true,
      exports: { enabled: true, listTools: async () => ({ tools }) },
    };
    delete require.cache[providerPath];
    return await require(providerPath).getCatalogCapabilities({ force: true });
  } finally {
    delete require.cache[providerPath];
    if (savedProvider) require.cache[providerPath] = savedProvider;
    if (savedPipeboard) require.cache[pipeboardPath] = savedPipeboard;
    else delete require.cache[pipeboardPath];
  }
}

function completeSchemas() {
  const campaign = Object.fromEntries([
    'advertiser_id', 'campaign_name', 'objective_type', 'product_source', 'shopping_ads_type',
    'catalog_id', 'operation_status', 'budget_mode', 'budget',
  ].map((field) => [field, {}]));
  campaign.objective_type = { enum: ['PRODUCT_SALES'] };
  campaign.product_source = { description: 'Use CATALOG for Product Sales.' };
  campaign.shopping_ads_type = { description: 'Live value: CATALOG_LISTING_ADS.' };
  campaign.operation_status = { enum: ['ENABLE', 'DISABLE'] };

  const adgroup = Object.fromEntries([
    'advertiser_id', 'campaign_id', 'adgroup_name', 'promotion_type', 'shopping_ads_type',
    'shopping_ads_retargeting_type', 'product_source', 'catalog_id', 'catalog_authorized_bc_id',
    'optimization_goal', 'billing_event', 'schedule_start_time', 'schedule_end_time', 'targeting',
    'operation_status', 'pixel_id', 'optimization_event', 'budget_mode', 'budget', 'bid_type', 'bid_price',
  ].map((field) => [field, {}]));
  adgroup.promotion_type = { enum: ['WEBSITE'] };
  adgroup.shopping_ads_type = { description: 'Catalog carousel uses CATALOG_LISTING_ADS.' };
  adgroup.shopping_ads_retargeting_type = { description: 'OFF is prospecting.' };
  adgroup.product_source = { description: 'Use CATALOG.' };
  adgroup.optimization_goal = { enum: ['CONVERT'] };
  adgroup.billing_event = { enum: ['OCPM'] };
  adgroup.operation_status = { enum: ['DISABLE'] };
  adgroup.optimization_event = { description: 'Events: ON_WEB_ORDER, INITIATE_ORDER.' };

  const ad = Object.fromEntries([
    'advertiser_id', 'adgroup_id', 'ad_name', 'ad_format', 'catalog_id', 'product_specific_type', 'item_group_ids',
    'product_set_id', 'music_id', 'ad_text', 'status', 'call_to_action', 'identity_id',
    'identity_type', 'identity_authorized_bc_id', 'dark_post_status', 'landing_page_url',
  ].map((field) => [field, {}]));
  ad.ad_format = { enum: ['CATALOG_CAROUSEL'] };
  ad.product_specific_type = { enum: ['ALL', 'PRODUCT_SET', 'CUSTOMIZED_PRODUCTS'] };
  ad.status = { enum: ['PAUSED'] };
  ad.identity_type = { enum: ['BC_AUTH_TT'] };
  ad.dark_post_status = { enum: ['ON'] };
  const music = schemaTool('list_tiktok_commercial_music', ['advertiser_id', 'music_scene', 'search_type', 'filtering']);
  return [
    schemaTool('create_tiktok_campaign', campaign, ['advertiser_id', 'campaign_name', 'objective_type']),
    schemaTool('create_tiktok_adgroup', adgroup, ['advertiser_id', 'campaign_id', 'adgroup_name', 'optimization_goal', 'targeting', 'schedule_start_time']),
    schemaTool('create_tiktok_ad', ad, ['advertiser_id', 'adgroup_id', 'ad_name', 'ad_text', 'identity_id', 'identity_type']),
    music,
    ...readbackTools,
  ];
}

(async () => {
  console.log('Provider — validação local antes da rede');
  const base = { catalogId: 'cat_1', bcId: 'bc_1', name: 'Catálogo X', budgetAmount: 50 };
  await throws(() => provider.createCatalogCampaign('', base), 400, 'exige advertiser');
  await throws(() => provider.createCatalogCampaign('123', { ...base, catalogId: '' }), 400, 'exige catalogId');
  await throws(() => provider.createCatalogCampaign('123', { ...base, bcId: '' }), 400, 'exige Business Center');
  await throws(() => provider.createCatalogCampaign('123', { ...base, name: '' }), 400, 'exige nome');
  await throws(() => provider.createCatalogCampaign('123', { ...base, budgetAmount: 49.99 }), 400, 'exige orçamento mínimo');
  await throws(() => provider.createCatalogCampaign('123', base), 400, 'exige Pixel ID');
  await throws(() => provider.createCatalogCampaign('123', { ...base, pixelId: '7550683248272228369', pixelEvent: 'INVALID' }), 400, 'rejeita evento inventado');

  console.log('Provider — composição Catalog Carousel');
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'ads-provider.js'), 'utf8');
    const body = src.match(/async function createCatalogCampaign[\s\S]*?\n}\n/)[0];
    ok(/objective_type: 'PRODUCT_SALES'/.test(body), 'usa PRODUCT_SALES');
    ok(/CATALOG_LISTING_ADS/.test(body), 'usa CATALOG_LISTING_ADS');
    ok(/promotion_type: 'WEBSITE'/.test(body), 'usa promotion_type WEBSITE');
    ok(/shopping_ads_retargeting_type: 'OFF'/.test(body), 'prospecting usa retargeting OFF');
    ok(/CATALOG_CAROUSEL/.test(body), 'usa CATALOG_CAROUSEL');
    ok(/product_specific_type/.test(body), 'envia o escopo de produtos exigido pelo TikTok');
    ok(/item_group_ids/.test(body), 'propaga item_group_ids do feed');
    ok(/music_id: catalogMusic\.musicId/.test(body), 'música elegível é resolvida antes da escrita');
    ok(/identity_authorized_bc_id/.test(body), 'envia o BC autorizado da identidade');
    ok(!/landing_page_url\s*:/.test(body), 'não envia URL manual');
    ok(!/website_type: 'PRODUCT_LINK'/.test(body), 'não envia campo legado website_type');
    ok(/operation_status: 'DISABLE'/.test(body) && /status: 'PAUSED'/.test(body), 'três níveis nascem pausados');
    ok(/setCampaignStatus\(adv, \[campaignId\], 'paused'\)/.test(body), 'falha parcial pausa a campanha');
    ok(/verifyCatalogProductLinkHierarchy/.test(body), 'sucesso exige readback completo');
  }

  console.log('Provider — leitura dos três níveis');
  {
    const { mapCampaign, mapAdGroup, mapAd, verifyCatalogProductLinkHierarchy } = provider._internals;
    const expected = {
      campaignId: 'camp_1', adGroupId: 'group_1', adId: 'ad_1', catalogId: 'catalog_1',
      bcId: 'bc_1', shoppingAdsType: 'CATALOG_LISTING_ADS', pixelId: 'pixel_1', pixelEvent: 'ON_WEB_ORDER',
      adFormat: 'CATALOG_CAROUSEL', productSpecificType: 'PRODUCT_SET', itemGroupIds: ['sku-1', 'sku-2'], musicId: 'music_1',
      identityId: 'identity_1', identityType: 'BC_AUTH_TT', identityBcId: 'bc_1', darkPostStatus: 'ON',
      adText: 'Confira os produtos', callToAction: 'SHOP_NOW',
    };
    const campaign = mapCampaign({ campaign_id: 'camp_1', objective_type: 'PRODUCT_SALES', catalog_id: 'catalog_1', product_source: 'CATALOG', shopping_ads_type: 'CATALOG_LISTING_ADS', operation_status: 'DISABLE' });
    const adGroup = mapAdGroup({ adgroup_id: 'group_1', campaign_id: 'camp_1', catalog_id: 'catalog_1', product_source: 'CATALOG', shopping_ads_type: 'CATALOG_LISTING_ADS', promotion_type: 'WEBSITE', shopping_ads_retargeting_type: 'OFF', catalog_authorized_bc_id: 'bc_1', pixel_id: 'pixel_1', optimization_event: 'ON_WEB_ORDER', operation_status: 'DISABLE' });
    const ad = mapAd({ ad_id: 'ad_1', adgroup_id: 'group_1', campaign_id: 'camp_1', catalog_id: 'catalog_1', ad_format: 'CATALOG_CAROUSEL', product_specific_type: 'PRODUCT_SET', item_group_ids: ['sku-2', 'sku-1'], music_id: 'music_1', ad_text: 'Confira os produtos', call_to_action: 'SHOP_NOW', identity_id: 'identity_1', identity_type: 'BC_AUTH_TT', identity_authorized_bc_id: 'bc_1', dark_post_status: 'ON', operation_status: 'DISABLE' });
    const verified = verifyCatalogProductLinkHierarchy({ campaign, adGroup, ad, expected });
    ok(verified.complete, 'aceita hierarquia correta, pausada e sem URL manual');
    const withUrl = verifyCatalogProductLinkHierarchy({ campaign, adGroup, ad: { ...ad, landingPageUrl: 'https://global.test' }, expected });
    ok(!withUrl.complete && !withUrl.noManualUrl, 'URL global invalida a confirmação');
    const wrongProducts = verifyCatalogProductLinkHierarchy({ campaign, adGroup, ad: { ...ad, itemGroupIds: ['outro'] }, expected });
    ok(!wrongProducts.complete && !wrongProducts.creative, 'item_group_ids divergentes invalidam a confirmação');
    const active = verifyCatalogProductLinkHierarchy({ campaign: { ...campaign, status: 'ENABLE' }, adGroup, ad, expected });
    ok(!active.complete && !active.paused, 'exige os três níveis pausados');
  }

  console.log('Provider — música e identidade falham antes da escrita');
  {
    const pipeboard = require('../pipeboard-mcp');
    const original = pipeboard.callTool;
    try {
      pipeboard.callTool = async (name) => name === 'get_tiktok_identities'
        ? { identities: [
          { identity_id: 'wrong', identity_type: 'BC_AUTH_TT', identity_authorized_bc_id: 'bc_2' },
          { identity_id: 'right', identity_type: 'BC_AUTH_TT', identity_authorized_bc_id: 'bc_1' },
        ] }
        : { music: [] };
      const identity = await provider._internals.pickAdIdentity('adv', 'bc_1');
      ok(identity.identityId === 'right' && identity.identityBcId === 'bc_1', 'identidade respeita o BC do catálogo');
      await throws(() => provider._internals.pickCatalogCarouselMusic('adv'), 422, 'ausência de música gera erro acionável', 'CATALOG_CAROUSEL_MUSIC_REQUIRED');
      pipeboard.callTool = async () => ({ music: [{ music_id: 'm1', name: 'Faixa', sources: ['USER'] }] });
      const music = await provider._internals.pickCatalogCarouselMusic('adv');
      ok(music.musicId === 'm1', 'seleciona automaticamente música USER elegível');
    } finally { pipeboard.callTool = original; }
  }

  console.log('Provider — capability exige contrato completo');
  {
    const partial = await catalogCapabilitiesForSchemas(completeSchemas().filter((tool) => tool.name !== 'list_tiktok_commercial_music'));
    ok(!partial.manualCatalogCampaign, 'sem busca de música não libera criação');
    const complete = await catalogCapabilitiesForSchemas(completeSchemas());
    ok(complete.manualCatalogCampaign, 'schema atual completo libera Catalog Carousel');
    ok(complete.adFormat === 'CATALOG_CAROUSEL' && complete.shoppingAdsType === 'CATALOG_LISTING_ADS', 'expõe os formatos confirmados');
    ok(complete.productSpecificType && complete.specificProducts && complete.productSets && !complete.catalogVideoTemplates, 'expõe escopo/item_group_ids/Product Set e remove template legado');
    ok(complete.optimizationEvents.includes('ON_WEB_ORDER'), 'evento Compra documentado é reconhecido');
    const wrong = completeSchemas();
    wrong.find((tool) => tool.name === 'create_tiktok_ad').inputSchema.properties.ad_format = { enum: ['SINGLE_VIDEO'] };
    const incompatible = await catalogCapabilitiesForSchemas(wrong);
    ok(!incompatible.manualCatalogCampaign, 'enum incompatível não cria estrutura parcial');
  }

  console.log('Rota e interface — preflight simples');
  {
    const routes = fs.readFileSync(path.join(__dirname, '..', 'ads-routes.js'), 'utf8');
    ok(/resolveCatalogCarouselMusic/.test(routes), 'preflight valida música antes de enfileirar');
    ok(/item_group_id \|\| product\.data\.sku_id/.test(routes), 'rota usa item_group_id com fallback automático do SKU');
    ok(/CATALOG_ITEM_GROUP_IDS_REQUIRED/.test(routes), 'sem identificadores bloqueia antes da escrita');
    ok(/killSwitchActive/.test(routes) && /isDryRun/.test(routes), 'mantém kill switch e modo teste');
    const wizard = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'components', 'ads', 'catalog-campaign-wizard.tsx'), 'utf8');
    ok(/Todos os produtos aprovados entram automaticamente/.test(wizard), 'wizard remove seleção manual de IDs da tela principal');
    ok(/Não existe URL manual no anúncio/.test(wizard), 'interface explica Product Link sem poluição');
    ok(!/Catalog Video Template ID/.test(wizard), 'remove template de vídeo legado');
  }

  console.log('\nads-catalog-campaign: ' + n + ' asserts OK');
})().catch((err) => { console.error(err); process.exit(1); });
