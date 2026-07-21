'use strict';
/*
 * Lançar a hierarquia completa VSA Product Link pela dashboard.
 * O composto valida TUDO antes de tocar a rede (advertiser/catalogId/bcId/nome/
 * orçamento) e a rota respeita os guardrails (kill switch, dry-run) + exige o
 * catálogo já sincronizado. Sem chave da API, a criação real fica no runbook.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const provider = require('../ads-provider');

let n = 0;
function ok(cond, label) { assert.ok(cond, label); n++; console.log('  ✓ ' + label); }
async function throws(fn, status, label) {
  try { await fn(); ok(false, label + ' (deveria lançar)'); }
  catch (e) { assert.strictEqual(e.status, status, label + ' status=' + e.status); n++; console.log('  ✓ ' + label); }
}

function schemaTool(name, fieldNames) {
  return {
    name,
    inputSchema: {
      properties: Array.isArray(fieldNames)
        ? Object.fromEntries(fieldNames.map((field) => [field, {}]))
        : fieldNames,
    },
  };
}

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
    const isolatedProvider = require(providerPath);
    return await isolatedProvider.getCatalogCapabilities({ force: true });
  } finally {
    delete require.cache[providerPath];
    if (savedProvider) require.cache[providerPath] = savedProvider;
    if (savedPipeboard) require.cache[pipeboardPath] = savedPipeboard;
    else delete require.cache[pipeboardPath];
  }
}

(async () => {
  console.log('Provider — validação antes da rede (createCatalogCampaign)');
  // Receita Smart+ validada ao vivo: catálogo + Product Link (o Link de cada
  // produto vem do catálogo, não de URL global) + vídeo do gestor por campanha.
  const base = {
    catalogId: '7662123486130784016', catalogBcId: '7550683248272228369', name: 'Catálogo X',
    budgetAmount: 50, pixelId: '7664608179090620423', videoId: 'v10033g50000abc',
    coverImageId: 'tos-alisg-p/cover', landingPageUrl: 'https://loja.example/pages/produto-1',
    identityId: 'bda0f384-c67e', identityType: 'BC_AUTH_TT',
  };
  await throws(() => provider.createCatalogCampaign('', base), 400, 'exige advertiser');
  await throws(() => provider.createCatalogCampaign('123', { ...base, catalogId: '' }), 400, 'exige catalogId do TikTok');
  await throws(() => provider.createCatalogCampaign('123', { ...base, catalogBcId: '', bcId: '' }), 400, 'exige Business Center do catálogo');
  await throws(() => provider.createCatalogCampaign('123', { ...base, name: '' }), 400, 'exige nome');
  await throws(() => provider.createCatalogCampaign('123', { ...base, budgetAmount: 4.99 }), 400, 'exige orçamento mínimo');
  await throws(() => provider.createCatalogCampaign('123', { ...base, pixelId: '' }), 400, 'exige Pixel ID para CONVERT antes de tocar a rede');
  await throws(() => provider.createCatalogCampaign('123', { ...base, videoId: '' }), 400, 'exige vídeo do anúncio (criativo por campanha)');
  await throws(() => provider.createCatalogCampaign('123', { ...base, coverImageId: '' }), 400, 'exige capa do vídeo');
  await throws(() => provider.createCatalogCampaign('123', { ...base, landingPageUrl: 'http://inseguro' }), 400, 'Product Link precisa ser https (derivado do Link do produto)');

  console.log('Provider — receita Smart+ Product Link (validada ao vivo)');
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'ads-provider.js'), 'utf8');
    ok(typeof provider.createCatalogCampaign === 'function', 'createCatalogCampaign exportado');
    ok(typeof provider.listInterestCategories === 'function', 'listInterestCategories exportado');
    const body = src.match(/async function createCatalogCampaign[\s\S]*?\n}\n/)[0];
    ok(/create_tiktok_smart_plus_campaign/.test(body), 'campanha via Smart+ (único caminho de catálogo na API)');
    ok(/objective_type: 'WEB_CONVERSIONS'/.test(body) && /catalog_enabled: true/.test(body) && /catalog_type: 'ECOMMERCE'/.test(body), 'campanha catalog_enabled ECOMMERCE');
    ok(/create_tiktok_smart_plus_adgroup/.test(body) && /promotion_type: 'WEBSITE'/.test(body), 'grupo Smart+ promotion WEBSITE');
    ok(/catalog_authorized_bc_id/.test(body) && /product_source: 'CATALOG'/.test(body), 'grupo usa catalog_authorized_bc_id + product_source CATALOG');
    ok(/bid_type: 'BID_TYPE_NO_BID'/.test(body) && /optimization_event: optimizationEvent/.test(body), 'grupo NO_BID + evento de otimização');
    ok(/ad_format: 'SINGLE_VIDEO'/.test(body) && /video_info: \{ video_id: videoId \}/.test(body), 'anúncio de VÍDEO (criativo do gestor, com áudio)');
    ok(/catalog_media_settings: \['VIDEO'\]/.test(body), 'usa o vídeo do produto do catálogo (sem música)');
    ok(/product_info_enabled: 'CATALOG'/.test(body), 'Product Link: cada produto usa o seu próprio Link');
    ok(/landing_page_url_list: \[\{ landing_page_url: landing \}\]/.test(body), 'URL base derivada do Link do produto (nunca URL global digitada)');
    ok(/operation_status: 'DISABLE'/.test(body), 'nasce pausada');
    ok(/setSmartPlusCampaignStatus\(adv, \[campaignId\], 'paused'\)/.test(body), 'órfã é pausada no catch (à prova de órfãos)');
    ok(/stepError\('adgroup'/.test(body), 'reporta o passo em falha de ad group');
  }

  console.log('Provider — leitura dos três níveis não aceita falso positivo');
  {
    const { mapCampaign, mapAdGroup, mapAd, verifyCatalogProductLinkHierarchy } = provider._internals;
    const expected = { campaignId: 'camp_1', adGroupId: 'group_1', adId: 'ad_1', catalogId: 'catalog_1', bcId: 'bc_1', shoppingAdsType: 'VIDEO_SHOPPING_ADS' };
    const campaign = mapCampaign({ campaign_id: 'camp_1', objective_type: 'PRODUCT_SALES', catalog_id: 'catalog_1', shopping_ads_type: 'VIDEO_SHOPPING_ADS', operation_status: 'DISABLE' });
    const adGroup = mapAdGroup({ adgroup_id: 'group_1', campaign_id: 'camp_1', catalog_id: 'catalog_1', product_source: 'CATALOG', shopping_ads_type: 'VIDEO_SHOPPING_ADS', store_authorized_bc_id: 'bc_1', operation_status: 'DISABLE' });
    const ad = mapAd({ ad_id: 'ad_1', adgroup_id: 'group_1', campaign_id: 'camp_1', catalog_id: 'catalog_1', website_type: 'PRODUCT_LINK', destination_page_type: 'WEBSITE', operation_status: 'DISABLE' });
    const verified = verifyCatalogProductLinkHierarchy({ campaign, adGroup, ad, expected });
    assert.strictEqual(verified.complete, true, 'hierarquia Product Link pausada e sem URL manual é aceita');
    n++; console.log('  ✓ aceita somente a hierarquia Product Link completa');
    const withUrl = verifyCatalogProductLinkHierarchy({ campaign, adGroup, ad: { ...ad, landingPageUrl: 'https://nao-deveria-existir.test' }, expected });
    assert.strictEqual(withUrl.complete, false, 'URL manual no anúncio invalida a confirmação');
    assert.strictEqual(withUrl.noManualUrl, false, 'diagnóstico identifica URL manual');
    n += 2; console.log('  ✓ URL manual impede falso positivo');
    const active = verifyCatalogProductLinkHierarchy({ campaign: { ...campaign, status: 'ENABLE' }, adGroup, ad, expected });
    assert.strictEqual(active.complete, false, 'campanha ativa não é aceita como criação segura');
    assert.strictEqual(active.paused, false, 'diagnóstico exige os três níveis pausados');
    n += 2; console.log('  ✓ exige pausa confirmada nos três níveis');
    const conflicting = verifyCatalogProductLinkHierarchy({ campaign, adGroup: { ...adGroup, status: 'ENABLE', secondaryStatus: 'ADGROUP_STATUS_DISABLE' }, ad, expected });
    assert.strictEqual(conflicting.complete, false, 'status primário ativo não é mascarado por secondary_status');
    assert.strictEqual(conflicting.paused, false, 'leitura contraditória permanece inconclusiva');
    n += 2; console.log('  ✓ não aceita status contraditório como pausa');
  }

  console.log('Provider — schema só libera Product Link com contrato completo');
  {
    const partial = await catalogCapabilitiesForSchemas([
      schemaTool('create_tiktok_campaign', ['advertiser_id', 'campaign_name', 'objective_type', 'catalog_id', 'shopping_ads_type']),
      schemaTool('create_tiktok_adgroup', ['advertiser_id', 'campaign_id', 'catalog_id', 'shopping_ads_type', 'product_source', 'store_authorized_bc_id']),
      schemaTool('create_tiktok_ad', ['advertiser_id', 'adgroup_id', 'catalog_id', 'catalog_video_template_id']),
    ]);
    assert.strictEqual(partial.manualCatalogCampaign, false, 'schema parcial não pode criar campanha sem Product Link');
    n++; console.log('  ✓ schema parcial mantém a criação automática bloqueada');

    const genericDestination = await catalogCapabilitiesForSchemas([
      schemaTool('create_tiktok_campaign', [
        'advertiser_id', 'campaign_name', 'objective_type', 'shopping_ads_type', 'catalog_id',
        'operation_status', 'budget_mode', 'budget', 'budget_optimize_on',
      ]),
      schemaTool('create_tiktok_adgroup', [
        'advertiser_id', 'campaign_id', 'adgroup_name', 'shopping_ads_type', 'product_source',
        'catalog_id', 'store_authorized_bc_id', 'optimization_goal', 'billing_event',
        'schedule_start_time', 'schedule_end_time', 'targeting', 'operation_status', 'pixel_id',
        'optimization_event', 'budget_mode', 'budget', 'bid_type', 'bid_price',
      ]),
      schemaTool('create_tiktok_ad', [
        'advertiser_id', 'adgroup_id', 'ad_name', 'ad_format', 'catalog_id', 'website_type',
        'destination_page_type', 'status', 'products_type', 'product_ids', 'product_set_id',
        'catalog_video_template_id', 'ad_text', 'call_to_action', 'identity_id', 'identity_type',
        'identity_bc_id', 'dark_post_status',
      ]),
    ]);
    assert.strictEqual(genericDestination.manualCatalogCampaign, false, 'campos genéricos não confirmam Product Link sem enum/const');
    n++; console.log('  ✓ schema genérico não libera Product Link sem valor semântico');

    const campaignSemanticFields = Object.fromEntries([
      'advertiser_id', 'campaign_name', 'objective_type', 'shopping_ads_type', 'catalog_id',
      'operation_status', 'budget_mode', 'budget', 'budget_optimize_on',
    ].map((field) => [field, {}]));
    campaignSemanticFields.objective_type = { enum: ['PRODUCT_SALES'] };
    campaignSemanticFields.shopping_ads_type = { enum: ['VIDEO_SHOPPING_ADS'] };
    campaignSemanticFields.operation_status = { enum: ['DISABLE'] };
    const adgroupSemanticFields = Object.fromEntries([
      'advertiser_id', 'campaign_id', 'adgroup_name', 'shopping_ads_type', 'product_source',
      'catalog_id', 'store_authorized_bc_id', 'optimization_goal', 'billing_event',
      'schedule_start_time', 'schedule_end_time', 'targeting', 'operation_status', 'pixel_id',
      'optimization_event', 'budget_mode', 'budget', 'bid_type', 'bid_price',
    ].map((field) => [field, {}]));
    adgroupSemanticFields.shopping_ads_type = { enum: ['VIDEO_SHOPPING_ADS'] };
    adgroupSemanticFields.product_source = { enum: ['CATALOG'] };
    adgroupSemanticFields.optimization_goal = { enum: ['CONVERT'] };
    adgroupSemanticFields.billing_event = { enum: ['OCPM'] };
    adgroupSemanticFields.operation_status = { enum: ['DISABLE'] };
    adgroupSemanticFields.optimization_event = { enum: ['ON_WEB_ORDER', 'INITIATE_ORDER'] };
    const productLinkAdFields = Object.fromEntries([
      'advertiser_id', 'adgroup_id', 'ad_name', 'ad_format', 'catalog_id', 'website_type',
      'destination_page_type', 'status', 'products_type', 'product_ids', 'product_set_id',
      'catalog_video_template_id', 'ad_text', 'call_to_action', 'identity_id', 'identity_type',
      'identity_bc_id', 'dark_post_status',
    ].map((field) => [field, {}]));
    productLinkAdFields.website_type = { type: 'string', enum: ['PRODUCT_LINK', 'SHOP_NOW'] };
    productLinkAdFields.destination_page_type = { oneOf: [{ const: 'WEBSITE' }] };
    productLinkAdFields.ad_format = { enum: ['CATALOG_VIDEO'] };
    productLinkAdFields.status = { enum: ['PAUSED'] };
    productLinkAdFields.products_type = { enum: ['ALL_PRODUCTS', 'SPECIFIC_PRODUCTS', 'PRODUCT_SET'] };
    const complete = await catalogCapabilitiesForSchemas([
      schemaTool('create_tiktok_campaign', campaignSemanticFields),
      schemaTool('create_tiktok_adgroup', adgroupSemanticFields),
      schemaTool('create_tiktok_ad', productLinkAdFields),
    ]);
    assert.strictEqual(complete.manualCatalogCampaign, true, 'schema completo libera a criação Product Link');
    n++; console.log('  ✓ schema completo libera Product Link');

    const wrongCampaignEnums = {
      ...campaignSemanticFields,
      objective_type: { enum: ['TRAFFIC'] },
    };
    const semanticallyIncompatible = await catalogCapabilitiesForSchemas([
      schemaTool('create_tiktok_campaign', wrongCampaignEnums),
      schemaTool('create_tiktok_adgroup', adgroupSemanticFields),
      schemaTool('create_tiktok_ad', productLinkAdFields),
    ]);
    assert.strictEqual(semanticallyIncompatible.manualCatalogCampaign, false, 'campos presentes com enum incompatível não liberam criação parcial');
    n++; console.log('  ✓ schema com enums incompatíveis permanece bloqueado');

    const noTemplateFields = { ...productLinkAdFields };
    delete noTemplateFields.product_ids;
    delete noTemplateFields.product_set_id;
    delete noTemplateFields.catalog_video_template_id;
    delete noTemplateFields.ad_text;
    delete noTemplateFields.call_to_action;
    const noTemplate = await catalogCapabilitiesForSchemas([
      schemaTool('create_tiktok_campaign', campaignSemanticFields),
      schemaTool('create_tiktok_adgroup', adgroupSemanticFields),
      schemaTool('create_tiktok_ad', noTemplateFields),
    ]);
    assert.strictEqual(noTemplate.manualCatalogCampaign, true, 'Product Link não depende de template, texto ou URL no anúncio');
    assert.strictEqual(noTemplate.catalogVideoTemplates, false, 'template continua opcional quando o schema não o oferece');
    n += 2; console.log('  ✓ Product Link não exige template de vídeo');
  }

  console.log('Rota — guardrails e pré-requisitos');
  {
    const routes = fs.readFileSync(path.join(__dirname, '..', 'ads-routes.js'), 'utf8');
    ok(/app\.post\('\/api\/ads\/catalogs\/:catalogId\/campaign'/.test(routes), 'POST /catalogs/:id/campaign registrado');
    const body = (routes.match(/async function prepareCatalogCampaign[\s\S]*?app\.post\('\/api\/ads\/catalogs\/:catalogId\/campaign-runs[^\n]*/) || [''])[0];
    ok(/killSwitchActive/.test(body), 'respeita kill switch (Pausar tudo)');
    ok(/isDryRun/.test(body), 'respeita Modo teste (dry-run)');
    ok(/CATALOG_LINK_NOT_VERIFIED/.test(body), 'exige vínculo remoto verificado');
    ok(/createCampaignRun/.test(body), 'enfileira um job durável e idempotente');
    ok(/auditSimulated/.test(body), 'dry-run audita a simulação');
    ok(/PRODUCT_LINK_CONNECTOR_CONFIRMATION_REQUIRED/.test(routes), 'rota não degrada Product Link para URL global');
    const worker = fs.readFileSync(path.join(__dirname, '..', 'catalog', 'catalog-campaign-worker.js'), 'utf8');
    ok(/provider\.createCatalogCampaign/.test(worker), 'worker chama o composto do provider');
    ok(/waiting_connector_confirmation/.test(worker), 'job preparado aguarda confirmação sem falhar nem usar URL global');
    ok(/status = Object\.keys\(createdIds\)\.length \? 'partial' : 'failed'/.test(worker), 'falha parcial preserva IDs criados');
    // interesses (Parte A, leitura)
    ok(/app\.get\('\/api\/ads\/targeting\/interests'/.test(routes), 'GET /targeting/interests registrado');
    ok(/listInterestCategories/.test(routes), 'rota de interesses chama o provider');
    const wizard = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'components', 'ads', 'catalog-campaign-wizard.tsx'), 'utf8');
    ok(/Modo VSA Product Link em validação/.test(wizard) && /não troca por URL global/.test(wizard), 'UI não troca Product Link por URL manual');
    const genericWizard = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'components', 'ads', 'create-ad-panel.tsx'), 'utf8');
    ok(!/Informe o Catalog Video Template ID/.test(genericWizard) && !/catalogVideoTemplateId/.test(genericWizard), 'wizard geral também não exige template para Product Link');
    const tree = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'components', 'ads', 'campaign-tree.tsx'), 'utf8');
    ok(/function isProductLinkAd/.test(tree) && /Link do catálogo/.test(tree), 'árvore identifica Product Link e não mostra URL global');
    const editDialog = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'components', 'ads', 'ad-edit-dialog.tsx'), 'utf8');
    ok(/const productLink/.test(editDialog) && /!productLink && linkUrl/.test(editDialog), 'editor não envia URL quando o anúncio usa Product Link');
    ok(/Anúncio Product Link usa o Link de cada produto do catálogo/.test(routes) && /await pipeboard\.getAds\(advertiserId/.test(routes), 'API revalida e bloqueia URL manual para anúncio Product Link');
  }

  console.log('CSV pronto + publish honesto (fallback do 502)');
  {
    const routes = fs.readFileSync(path.join(__dirname, '..', 'ads-routes.js'), 'utf8');
    const csvBody = (routes.match(/export\.csv'[\s\S]*?buildCatalogCsv\(products\)/) || [''])[0];
    ok(/all\.filter\(\(p\) => p\.valid\)/.test(csvBody), 'export.csv serve só produtos válidos (import-ready)');
    ok(/all=1|\.all \|\| ''\) === '1'/.test(csvBody), 'export.csv aceita ?all=1 para debug (todos)');
    const worker = fs.readFileSync(path.join(__dirname, '..', 'catalog', 'catalog-sync-worker.js'), 'utf8');
    ok(/appendPublication[\s\S]*status: 'error'/.test(worker), 'worker persiste a razão real da falha de sincronização');
  }

  console.log('\nads-catalog-campaign: ' + n + ' asserts OK');
})().catch((e) => { console.error(e); process.exit(1); });
