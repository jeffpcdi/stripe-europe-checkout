'use strict';
// Contrato SINGLE_VIDEO/Product Link: preflight completo antes de escrita,
// áudio embutido, capa automática e leitura final sem URL manual.
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
  campaign.shopping_ads_type = { description: 'Forwarded as-is — TikTok validates.' };
  campaign.operation_status = { enum: ['ENABLE', 'DISABLE'] };

  const adgroup = Object.fromEntries([
    'advertiser_id', 'campaign_id', 'adgroup_name', 'promotion_type', 'shopping_ads_type',
    'shopping_ads_retargeting_type', 'product_source', 'catalog_id', 'catalog_authorized_bc_id',
    'optimization_goal', 'billing_event', 'placement_type', 'placements',
    'schedule_start_time', 'schedule_end_time', 'targeting',
    'operation_status', 'pixel_id', 'optimization_event', 'budget_mode', 'budget', 'bid_type', 'bid_price',
  ].map((field) => [field, {}]));
  adgroup.promotion_type = { enum: ['WEBSITE'] };
  adgroup.shopping_ads_type = { description: 'Forwarded as-is — TikTok validates.' };
  adgroup.shopping_ads_retargeting_type = { description: 'OFF is prospecting.' };
  adgroup.product_source = { description: 'Use CATALOG.' };
  adgroup.optimization_goal = { enum: ['CONVERT'] };
  adgroup.billing_event = { enum: ['OCPM'] };
  adgroup.placement_type = { enum: ['PLACEMENT_TYPE_NORMAL'] };
  adgroup.placements = { type: 'array', description: 'Explicit values include PLACEMENT_TIKTOK.' };
  adgroup.operation_status = { enum: ['DISABLE'] };
  adgroup.optimization_event = { description: 'Event name forwarded to TikTok.' };

  const ad = Object.fromEntries([
    'advertiser_id', 'adgroup_id', 'ad_name', 'ad_format', 'catalog_id', 'product_specific_type', 'item_group_ids',
    'product_set_id', 'ad_text', 'status', 'call_to_action', 'vertical_video_strategy', 'video_id', 'image_ids', 'identity_id',
    'identity_type', 'identity_authorized_bc_id', 'dark_post_status', 'landing_page_url',
  ].map((field) => [field, {}]));
  ad.ad_format = { enum: ['SINGLE_VIDEO'] };
  ad.vertical_video_strategy = { enum: ['SINGLE_VIDEO'] };
  ad.product_specific_type = { enum: ['ALL', 'PRODUCT_SET', 'CUSTOMIZED_PRODUCTS'] };
  ad.status = { enum: ['PAUSED'] };
  ad.identity_type = { enum: ['BC_AUTH_TT'] };
  ad.dark_post_status = { enum: ['ON'] };
  return [
    schemaTool('create_tiktok_catalog', {
      bc_id: {}, name: {},
      catalog_type: { description: 'Current TikTok values: ECOM, HOTEL, FLIGHT, AUTO_VEHICLE.' },
      catalog_conf: { type: 'object', properties: { region_code: {}, currency: {} } },
    }, ['bc_id', 'name', 'catalog_type']),
    schemaTool('create_tiktok_campaign', campaign, ['advertiser_id', 'campaign_name', 'objective_type']),
    schemaTool('create_tiktok_adgroup', adgroup, ['advertiser_id', 'campaign_id', 'adgroup_name', 'optimization_goal', 'targeting', 'schedule_start_time']),
    schemaTool('create_tiktok_ad', ad, ['advertiser_id', 'adgroup_id', 'ad_name', 'ad_text', 'identity_id', 'identity_type']),
    schemaTool('upload_tiktok_video', ['advertiser_id', 'video_url']),
    schemaTool('get_tiktok_video_info', ['advertiser_id', 'video_ids']),
    schemaTool('upload_tiktok_image', ['advertiser_id', 'image_url']),
    schemaTool('get_tiktok_pixel_event_stats', ['advertiser_id', 'pixel_ids', 'start_date', 'end_date']),
    ...readbackTools,
  ];
}

(async () => {
  console.log('Provider — validação local antes da rede');
  const base = { catalogId: 'cat_1', bcId: 'bc_1', name: 'Catálogo X', budgetAmount: 50, videoUrl: 'https://cdn.test/video.mp4' };
  await throws(() => provider.createCatalogCampaign('', base), 400, 'exige advertiser');
  await throws(() => provider.createCatalogCampaign('123', { ...base, catalogId: '' }), 400, 'exige catalogId');
  await throws(() => provider.createCatalogCampaign('123', { ...base, bcId: '' }), 400, 'exige Business Center');
  await throws(() => provider.createCatalogCampaign('123', { ...base, name: '' }), 400, 'exige nome');
  await throws(() => provider.createCatalogCampaign('123', { ...base, budgetAmount: 49.99 }), 400, 'exige orçamento mínimo');
  await throws(() => provider.createCatalogCampaign('123', base), 400, 'exige Pixel ID');
  await throws(() => provider.createCatalogCampaign('123', { ...base, pixelId: '7550683248272228369', pixelEvent: 'INVALID' }), 400, 'rejeita evento inventado');
  await throws(() => provider.createCatalogCampaign('123', { ...base, pixelId: '7550683248272228369', videoUrl: '' }), 400, 'exige vídeo');

  console.log('Provider — capa automática segura');
  {
    const { normalizePublicImageUrl, normalizeTikTokCoverUrl } = provider._internals;
    const signed = 'http://p16-common-sign.tiktokcdn.com/capa.image?x-signature=a%2Fb';
    const secure = normalizeTikTokCoverUrl(signed);
    ok(secure.startsWith('https://p16-common-sign.tiktokcdn.com/capa.image?'), 'URL HTTP do CDN TikTok é elevada para HTTPS');
    ok(new URL(secure).search === new URL(signed).search, 'assinatura da capa é preservada byte a byte');
    ok(normalizeTikTokCoverUrl('//p16-common-sign.tiktokcdn.com/capa.jpg') === 'https://p16-common-sign.tiktokcdn.com/capa.jpg', 'URL protocol-relative do TikTok ganha HTTPS');
    ok(normalizeTikTokCoverUrl('https://cdn.test/capa.jpg') === '', 'capa automática fora do CDN TikTok é rejeitada');
    ok(normalizePublicImageUrl('https://cdn.test/capa.jpg') === 'https://cdn.test/capa.jpg', 'capa manual HTTPS do Smart+ permanece compatível');
    ok(normalizeTikTokCoverUrl('http://cdn.test/capa.jpg') === '', 'HTTP arbitrário não é elevado');
    ok(normalizeTikTokCoverUrl('https://127.0.0.1.nip.io/capa.jpg') === '', 'host público sintético para loopback é rejeitado na capa automática');
    ok(normalizeTikTokCoverUrl('https://169.254.169.254.nip.io/meta') === '', 'host público sintético para metadata é rejeitado na capa automática');
    ok(normalizeTikTokCoverUrl('http://tiktokcdn.com.evil.test/capa.jpg') === '', 'sufixo falso de TikTok é rejeitado');
    ok(normalizeTikTokCoverUrl('http://p16-common-sign.tiktokcdn.com./capa.jpg') === '', 'hostname ambíguo com ponto final é rejeitado');
    ok(normalizeTikTokCoverUrl('http://127.0.0.1/capa.jpg') === '', 'loopback nunca vira capa pública');
    ok(normalizeTikTokCoverUrl('http://169.254.169.254/meta') === '', 'rede privada nunca chega ao uploader');
    ok(normalizeTikTokCoverUrl('https://[::ffff:127.0.0.1]/capa.jpg') === '', 'IPv6 mapeado para loopback é rejeitado');
    ok(normalizeTikTokCoverUrl('https://[::ffff:169.254.169.254]/meta') === '', 'IPv6 mapeado para link-local é rejeitado');
    ok(normalizeTikTokCoverUrl('https://[2001:db8::1]/capa.jpg') === '', 'todo IP literal IPv6 é rejeitado');
    ok(normalizeTikTokCoverUrl('data:image/png;base64,abc') === '', 'protocolo não HTTP é rejeitado');
    ok(normalizeTikTokCoverUrl('https://user:pass@cdn.test/capa.jpg') === '', 'credenciais embutidas são rejeitadas');
    ok(normalizeTikTokCoverUrl('https://cdn.test:8443/capa.jpg') === '', 'porta não padrão é rejeitada');
    ok(normalizeTikTokCoverUrl('http://p16-common-sign.tiktokcdn.com/capa.jpg\nignorado') === '', 'controles e espaços não entram na URL assinada');

    const { inspectUploadedVideoAsset } = provider._internals;
    const processing = inspectUploadedVideoAsset([{
      video_id: 'video_1', displayable: false, status: 'NOT_READY',
      video_cover_url: signed,
    }], 'video_1');
    ok(!processing.displayable && Boolean(processing.coverUrl), 'capa não antecipa vídeo ainda em processamento');
    const divergent = inspectUploadedVideoAsset([{
      video_id: 'outro_video', displayable: true,
      video_cover_url: signed,
    }], 'video_1');
    ok(!divergent.row, 'resposta de outro vídeo nunca é usada como fallback');
    const ready = inspectUploadedVideoAsset([{
      video_id: 'video_1', displayable: true,
      video_cover_url: signed,
    }], 'video_1');
    ok(ready.displayable && ready.coverUrl.startsWith('https://'), 'vídeo correto só avança quando estiver pronto e com capa segura');
  }

  console.log('Provider — falha de transporte mantém a etapa retomável');
  {
    const pipeboard = require('../pipeboard-mcp');
    const original = pipeboard.callTool;
    try {
      pipeboard.callTool = async () => {
        const error = new Error('gateway temporariamente indisponível');
        error.status = 502;
        throw error;
      };
      for (const [label, call, expectedStep] of [
        ['upload do vídeo', () => provider._internals.uploadVideoAndWait('adv_1', 'https://cdn.test/video.mp4', {}), 'upload'],
        ['consulta da capa', () => provider._internals.getUploadedVideoAsset('adv_1', 'video_1', { videoId: 'video_1' }), 'cover'],
        ['upload da imagem', () => provider._internals.uploadImage('adv_1', 'https://cdn.test/capa.jpg', { videoId: 'video_1' }), 'cover'],
      ]) {
        try {
          await call();
          ok(false, label + ' deveria falhar');
        } catch (error) {
          ok(error.step === expectedStep, label + ' preserva a etapa ' + expectedStep);
          ok(error.createdIds && (expectedStep !== 'cover' || error.createdIds.videoId === 'video_1'), label + ' preserva IDs para retry');
        }
      }
      await throws(
        () => provider._internals.uploadImage('adv_1', 'http://cdn.test/capa.jpg', {}),
        400,
        'capa manual do Smart+ continua erro de validação, não erro transitório',
      );
    } finally {
      pipeboard.callTool = original;
    }
  }

  console.log('Provider — composição vídeo de catálogo');
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'ads-provider.js'), 'utf8');
    const body = src.match(/async function createCatalogCampaign[\s\S]*?\n}\n/)[0];
    ok(/objective_type: 'PRODUCT_SALES'/.test(body), 'usa PRODUCT_SALES');
    ok(/const SHOPPING_TYPE = 'VIDEO'/.test(body), 'usa shopping_ads_type VIDEO');
    ok(/promotion_type: 'WEBSITE'/.test(body), 'usa promotion_type WEBSITE');
    ok(/shopping_ads_retargeting_type: 'OFF'/.test(body), 'prospecting usa retargeting OFF');
    ok(/placement_type: 'PLACEMENT_TYPE_NORMAL'/.test(body) && /placements: \['PLACEMENT_TIKTOK'\]/.test(body), 'envia placement explícito exigido pelo TikTok');
    ok(/const AD_FORMAT = 'SINGLE_VIDEO'/.test(body), 'usa SINGLE_VIDEO');
    ok(/vertical_video_strategy: 'SINGLE_VIDEO'/.test(body), 'envia a estratégia vertical obrigatória');
    ok(/await report\('upload'\)/.test(body) && /await report\('cover'\)/.test(body), 'progresso mostra upload e capa durante a primeira tentativa');
    ok(/video_id: createdIds\.videoId/.test(body), 'envia o vídeo processado');
    ok(/image_ids: \[createdIds\.coverImageId\]/.test(body), 'envia a capa automática');
    ok(/product_specific_type/.test(body), 'envia o escopo de produtos exigido pelo TikTok');
    ok(/sku_ids/.test(body), 'propaga SKUs quando o escopo é específico');
    ok(!/music_id:/.test(body), 'não exige música separada do criativo');
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
      bcId: 'bc_1', shoppingAdsType: 'VIDEO', pixelId: 'pixel_1', pixelEvent: 'SHOPPING',
      locationIds: ['3469034'],
      adFormat: 'SINGLE_VIDEO', verticalVideoStrategy: 'SINGLE_VIDEO', productSpecificType: 'ALL',
      videoId: 'video_1', imageId: 'image_1',
      identityId: 'identity_1', identityType: 'BC_AUTH_TT', identityBcId: 'bc_1', darkPostStatus: 'ON',
      adText: 'Confira os produtos', callToAction: 'SHOP_NOW',
    };
    // A leitura de campanha real não ecoa catálogo/shopping type.
    const campaign = mapCampaign({ campaign_id: 'camp_1', objective_type: 'PRODUCT_SALES', operation_status: 'DISABLE' });
    const adGroup = mapAdGroup({ adgroup_id: 'group_1', campaign_id: 'camp_1', catalog_id: 'catalog_1', product_source: 'CATALOG', shopping_ads_type: 'VIDEO', promotion_type: 'WEBSITE', shopping_ads_retargeting_type: 'OFF', catalog_authorized_bc_id: 'bc_1', pixel_id: 'pixel_1', optimization_event: 'SHOPPING', optimization_goal: 'CONVERT', billing_event: 'OCPM', placement_type: 'PLACEMENT_TYPE_NORMAL', placements: ['PLACEMENT_TIKTOK'], location_ids: ['3469034'], operation_status: 'DISABLE' });
    const ad = mapAd({ ad_id: 'ad_1', adgroup_id: 'group_1', campaign_id: 'camp_1', catalog_id: 'catalog_1', ad_format: 'SINGLE_VIDEO', vertical_video_strategy: 'SINGLE_VIDEO', product_specific_type: 'ALL', video_id: 'video_1', image_ids: ['image_1'], ad_text: 'Confira os produtos', call_to_action: 'SHOP_NOW', identity_id: 'identity_1', identity_type: 'BC_AUTH_TT', identity_authorized_bc_id: 'bc_1', operation_status: 'DISABLE' });
    const verified = verifyCatalogProductLinkHierarchy({ campaign, adGroup, ad, expected });
    ok(verified.complete, 'aceita hierarquia correta, pausada e sem URL manual');
    const withUrl = verifyCatalogProductLinkHierarchy({ campaign, adGroup, ad: { ...ad, landingPageUrl: 'https://global.test' }, expected });
    ok(!withUrl.complete && !withUrl.noManualUrl, 'URL global invalida a confirmação');
    const wrongVideo = verifyCatalogProductLinkHierarchy({ campaign, adGroup, ad: { ...ad, videoId: 'outro' }, expected });
    ok(!wrongVideo.complete && !wrongVideo.creative, 'vídeo divergente invalida a confirmação');
    const wrongDarkPost = verifyCatalogProductLinkHierarchy({ campaign, adGroup, ad: { ...ad, darkPostStatus: 'OFF' }, expected });
    ok(!wrongDarkPost.complete && !wrongDarkPost.identity, 'dark post divergente invalida a confirmação quando o readback o informa');
    const active = verifyCatalogProductLinkHierarchy({ campaign: { ...campaign, status: 'ENABLE' }, adGroup, ad, expected });
    ok(!active.complete && !active.paused, 'exige os três níveis pausados');
  }

  console.log('Provider — Compra real e identidade falham antes da escrita');
  {
    const pipeboard = require('../pipeboard-mcp');
    const original = pipeboard.callTool;
    try {
      pipeboard.callTool = async (name) => name === 'get_tiktok_identities'
        ? { identities: [
          { identity_id: 'wrong', identity_type: 'BC_AUTH_TT', identity_authorized_bc_id: 'bc_2' },
          { identity_id: 'stale', identity_type: 'BC_AUTH_TT', identity_authorized_bc_id: 'bc_1' },
          { identity_id: 'right', identity_type: 'BC_AUTH_TT', identity_authorized_bc_id: 'bc_1', display_name: 'Perfil válido' },
        ] }
        : { list: [{ pixel_id: 'pixel_1', statistics: [{ pixel_event_type: 'SHOPPING', total_count: 1 }] }] };
      const identity = await provider._internals.pickAdIdentity('adv', 'bc_1');
      ok(identity.identityId === 'right' && identity.identityBcId === 'bc_1', 'identidade respeita o BC e prioriza perfil resolvido');
      const eventName = await provider._internals.resolveCatalogPurchaseEvent('adv', 'pixel_1');
      ok(eventName === 'SHOPPING', 'usa o evento de Compra que o Pixel realmente recebeu');
      pipeboard.callTool = async () => ({ list: [{ pixel_id: 'pixel_1', statistics: [] }] });
      await throws(() => provider._internals.resolveCatalogPurchaseEvent('adv', 'pixel_1'), 422, 'Pixel sem Compra bloqueia antes da campanha', 'CATALOG_PURCHASE_EVENT_NOT_READY');
    } finally { pipeboard.callTool = original; }
  }

  console.log('Provider — capability exige contrato completo');
  {
    const partial = completeSchemas();
    delete partial.find((tool) => tool.name === 'create_tiktok_ad').inputSchema.properties.vertical_video_strategy;
    const missingVertical = await catalogCapabilitiesForSchemas(partial);
    ok(!missingVertical.catalogSingleVideoCampaign, 'sem vertical_video_strategy não libera criação');
    const complete = await catalogCapabilitiesForSchemas(completeSchemas());
    ok(complete.catalogSingleVideoCampaign && complete.manualCatalogCampaign, 'schema completo libera vídeo Product Link');
    ok(complete.catalogCreate, 'ECOM com catalog_conf regional libera criação de catálogo');
    ok(complete.adFormat === 'SINGLE_VIDEO' && complete.shoppingAdsType === 'VIDEO', 'expõe os formatos confirmados');
    ok(complete.automaticVideoCover && complete.automaticPurchaseEvent, 'capa e evento são automáticos');
    ok(complete.optimizationEvents.includes('SHOPPING'), 'evento SHOPPING é reconhecido');
    const wrong = completeSchemas();
    wrong.find((tool) => tool.name === 'create_tiktok_ad').inputSchema.properties.ad_format = { enum: ['CATALOG_CAROUSEL'] };
    const incompatible = await catalogCapabilitiesForSchemas(wrong);
    ok(!incompatible.manualCatalogCampaign, 'enum incompatível não cria estrutura parcial');
    const missingPlacement = completeSchemas();
    delete missingPlacement.find((tool) => tool.name === 'create_tiktok_adgroup').inputSchema.properties.placements;
    const placementBlocked = await catalogCapabilitiesForSchemas(missingPlacement);
    ok(!placementBlocked.catalogSingleVideoCampaign, 'schema sem placement explícito falha antes da campanha');
    const described = completeSchemas();
    described.find((tool) => tool.name === 'create_tiktok_ad').inputSchema.properties.vertical_video_strategy = {
      type: 'string',
      description: 'Valores aceitos pelo TikTok: SINGLE_VIDEO, CATALOG_VIDEOS e UNSET.',
    };
    const describedComplete = await catalogCapabilitiesForSchemas(described);
    ok(describedComplete.catalogSingleVideoCampaign, 'token SINGLE_VIDEO explícito na descrição libera o schema vivo');
    const generic = completeSchemas();
    generic.find((tool) => tool.name === 'create_tiktok_ad').inputSchema.properties.vertical_video_strategy = {
      type: 'string', description: 'Forwarded as-is — TikTok validates.',
    };
    const genericBlocked = await catalogCapabilitiesForSchemas(generic);
    ok(!genericBlocked.catalogSingleVideoCampaign, 'descrição genérica não libera vertical_video_strategy');
  }

  console.log('Rota e interface — preflight simples');
  {
    const routes = fs.readFileSync(path.join(__dirname, '..', 'ads-routes.js'), 'utf8');
    ok(/resolveCatalogPurchaseEvent/.test(routes), 'preflight valida o evento real do Pixel antes de enfileirar');
    ok(/normalized\.productScope === 'all'/.test(routes) && /normalized\.itemGroupIds = \[\]/.test(routes), 'escopo ALL usa a lista remota aprovada sem reconstruir IDs locais');
    ok(/normalized\.productScope === 'specific'.+!normalized\.itemGroupIds\.length/.test(routes), 'somente seleção específica exige identificadores locais');
    ok(/killSwitchActive/.test(routes) && /isDryRun/.test(routes), 'mantém kill switch e modo teste');
    const wizard = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'components', 'ads', 'catalog-campaign-wizard.tsx'), 'utf8');
    const dialog = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'components', 'ads', 'catalog-quick-campaigns-dialog.tsx'), 'utf8');
    ok(/Todos os produtos aprovados usam o próprio Link/.test(wizard), 'wizard remove seleção manual de IDs da tela principal');
    ok(/adsUpload\(file, 'video'\)/.test(dialog), 'modal único envia o vídeo sem depender do Ads Manager');
    ok(/O mesmo vídeo com áudio será usado/.test(dialog), 'interface explica que o áudio vem do criativo');
    ok(/Cada produto usa o próprio Link/.test(dialog), 'interface explica Product Link sem poluição');
    ok(/Criar campanhas/.test(wizard) && !/Criar lote/.test(wizard) && !/Nova campanha/.test(wizard), 'wizard expõe uma única entrada de criação');
    ok(!/Catalog Video Template ID/.test(wizard), 'remove template de vídeo legado');
  }

  console.log('\nads-catalog-campaign: ' + n + ' asserts OK');
})().catch((err) => { console.error(err); process.exit(1); });
