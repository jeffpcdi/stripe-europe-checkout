// ads-provider.js — camada de leitura do TikTok Ads sobre o Pipeboard MCP.
//
// Este módulo é a ÚNICA fronteira entre o shape que o dashboard espera e o
// protocolo MCP do Pipeboard. As rotas (ads-routes.js) NÃO devem falar com o
// pipeboard-mcp diretamente — elas chamam este provider, que:
//   • resolve o advertiser_id (env default + seleção persistida por conta);
//   • mapeia os payloads REAIS do Pipeboard (capturados via /api/ads/diag em
//     docs/pipeboard-tools.md) para o formato do painel;
//   • cacheia leituras com TTL curto (o Pipeboard cobra por chamada e a lista
//     de advertisers só traz IDs — nomes exigem 1 chamada/conta).
//
// Contratos do Pipeboard que moldam este arquivo:
//   • múltiplos advertisers autorizados. list_tiktok_advertisers
//     devolve { total_advertisers, advertiser_ids:[...] } — só IDs, sem nome.
//     Nome/moeda/status vêm de get_tiktok_advertiser_info (1 chamada/id) →
//     enriquecimento é preguiçoso e cacheado; nunca 155 de uma vez.
//   • Não há OAuth/SocialAccount/profile: "conectado" = chave presente no
//     servidor + advertiser resolvido.

const pipeboard = require('./pipeboard-mcp');
const config = require('./config');
const net = require('net');
const { SPARK_GOALS, TIKTOK_MIN_BUDGET } = require('./ads-contracts');
const { TIKTOK_PIXEL_EVENTS } = require('./catalog/catalog-domain');
const {
  MAX_CAMPAIGN_NAME_LENGTH,
  MAX_NAME_ATTEMPTS,
  nextAvailableCampaignName,
  isCampaignNameConflict,
} = require('./catalog/catalog-campaign-safety');
const { isPublicDownloadHostname } = require('./ads-storage');

// ── Estado por conta (multi-tenant) ──────────────────────────────────────────
// Guardado em config.get(accountId).pipeboardAds = { advertiserId }.
// Substitui o zernioAds { profileId, accountId, advertiserId, identity } — aqui
// só precisamos do advertiser selecionado; não há profile/SocialAccount.
const ENV_DEFAULT_ADVERTISER = String(process.env.TIKTOK_ADVERTISER_ID || '').trim();

function getState(accountId) {
  const cfg = config.get(accountId) || {};
  return Object.assign({ advertiserId: '' }, cfg.pipeboardAds || {});
}

function setState(accountId, patch) {
  const cur = getState(accountId);
  const next = Object.assign({}, cur, patch || {});
  config.set(accountId, { pipeboardAds: next });
  return next;
}

// ── Cache de leitura (TTL curto, isolado do cache do zernio) ──────────────────
const cache = new Map(); // chave → { at, ttl, data }
function cacheGet(key) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.data;
  cache.delete(key);
  return null;
}
function cacheSet(key, data, ttlMs) {
  cache.set(key, { at: Date.now(), ttl: ttlMs, data });
  if (cache.size > 800) {
    const oldest = [...cache.keys()].slice(0, 150);
    oldest.forEach((k) => cache.delete(k));
  }
  return data;
}
function cacheBust(prefix) {
  [...cache.keys()].forEach((k) => { if (k.startsWith(prefix)) cache.delete(k); });
}

// ── Normalização de status do advertiser ─────────────────────────────────────
// O TikTok devolve status do advertiser como STATUS_ENABLE / STATUS_DISABLE /
// STATUS_PENDING_CONFIRM / STATUS_LIMITED / STATUS_PUNISH (banido) etc. Mapeamos
// para o vocabulário do painel: approved | banned | limited | in_review |
// unknown. (ads-ops-store.normalizeAccountStatus cobre os status de conta de
// anúncio do endpoint antigo; aqui tratamos o enum do advertiser_info.)
const ADV_STATUS_MAP = {
  STATUS_ENABLE: 'approved',
  STATUS_ACTIVE: 'approved',
  STATUS_DISABLE: 'limited',
  STATUS_LIMIT: 'limited',
  STATUS_LIMITED: 'limited',
  STATUS_PENDING_CONFIRM: 'in_review',
  STATUS_PENDING: 'in_review',
  STATUS_CONFIRM_FAIL: 'limited',
  STATUS_PUNISH: 'banned',
  STATUS_PENALTY: 'banned',
  STATUS_CANCEL: 'banned',
};
function normalizeAdvertiserStatus(raw) {
  const s = String(raw || '').trim().toUpperCase();
  if (!s) return 'unknown';
  return ADV_STATUS_MAP[s] || 'unknown';
}

// ── Advertisers ───────────────────────────────────────────────────────────────
// Lista crua de IDs (barato: 1 chamada). `fresh` ignora o cache (usado pelo
// "Verificar novamente" da tela de conexão — o botão precisa refletir um
// vínculo recém-feito no Pipeboard, não um cache antigo).
async function listAdvertiserIds(opts = {}) {
  const ck = 'advids';
  if (!opts.fresh) {
    const hit = cacheGet(ck);
    if (hit) return hit;
  }
  const out = await pipeboard.callTool('list_tiktok_advertisers', {});
  const ids = (out && Array.isArray(out.advertiser_ids) ? out.advertiser_ids : []).map(String);
  // Lista VAZIA quase sempre é transitória (conta recém-vinculada no Pipeboard
  // ainda propagando, ou resposta parcial da API). Cachear "0 advertisers" por
  // 5min deixava a tela "Conecte sua conta" travada mesmo depois de vincular —
  // TTL curto no vazio faz o painel reconhecer a conexão em segundos.
  return cacheSet(ck, ids, ids.length ? 5 * 60 * 1000 : 15 * 1000);
}

// Info detalhada de UM advertiser (nome, moeda, status…). Cache 5min por id.
// Este é o único jeito de obter o nome — por isso é chamado sob demanda.
async function getAdvertiserInfo(advertiserId) {
  const id = String(advertiserId || '').trim();
  if (!id) return null;
  const ck = 'advinfo:' + id;
  const hit = cacheGet(ck);
  if (hit) return hit;
  const out = await pipeboard.callTool('get_tiktok_advertiser_info', { advertiser_id: id });
  const a = (out && out.advertiser) || {};
  const raw = String(a.status || '');
  const info = {
    id,
    name: String(a.name || '') || id,
    company: String(a.company || ''),
    currency: String(a.currency || 'USD'),
    country: String(a.country || ''),
    timezone: String(a.display_timezone || a.timezone || ''),
    // A API de criação interpreta horários no fuso efetivo da conta
    // (`timezone`). `display_timezone` é apenas o nome amigável mostrado no
    // Ads Manager e pode ter uma regra de horário de verão diferente.
    deliveryTimezone: String(a.timezone || a.display_timezone || ''),
    role: String(a.role || ''),
    rawStatus: raw,
    healthStatus: normalizeAdvertiserStatus(raw),
  };
  return cacheSet(ck, info, 5 * 60 * 1000);
}

// Resolve qual advertiser usar para a conta:
//   1) seleção persistida (config.pipeboardAds.advertiserId) se ainda existir;
//   2) env TIKTOK_ADVERTISER_ID (default global de deploy);
//   3) o primeiro da lista autorizada.
// Retorna '' se não houver nenhum advertiser autorizado.
async function resolveAdvertiserId(accountId, opts = {}) {
  const ids = await listAdvertiserIds(opts);
  if (!ids.length) return '';
  const idSet = new Set(ids);
  const saved = getState(accountId).advertiserId;
  if (saved && idSet.has(saved)) return saved;
  if (ENV_DEFAULT_ADVERTISER && idSet.has(ENV_DEFAULT_ADVERTISER)) return ENV_DEFAULT_ADVERTISER;
  return ids[0];
}

// Lista advertisers para o SELETOR da UI. Sem enriquecer nomes por padrão
// (155 chamadas seria caro/lento); a UI pede uma página enriquecida sob demanda.
// enrich: nº máximo de infos a resolver nesta chamada (default 0 = só IDs).
async function listAdvertisers(accountId, { enrich = 0, only = null } = {}) {
  const ids = await listAdvertiserIds();
  const selected = await resolveAdvertiserId(accountId);
  const toEnrich = new Set();
  if (selected) toEnrich.add(selected); // o selecionado sempre vem com nome
  if (Array.isArray(only)) for (const i of only) if (ids.includes(String(i))) toEnrich.add(String(i));
  for (const id of ids) {
    if (toEnrich.size >= (enrich || 0) + 1) break; // +1 = o selecionado
    toEnrich.add(id);
  }
  const infoById = {};
  await Promise.all([...toEnrich].map(async (id) => {
    try { infoById[id] = await getAdvertiserInfo(id); } catch (_) { /* ignora falha individual */ }
  }));
  return {
    total: ids.length,
    selectedId: selected,
    advertisers: ids.map((id) => {
      const info = infoById[id];
      return info || { id, name: id, currency: '', country: '', rawStatus: '', healthStatus: 'unknown', enriched: false };
    }).map((a) => Object.assign({ enriched: true }, a)),
  };
}

// ── Status da integração ──────────────────────────────────────────────────────
// "conectado" = chave presente + ao menos 1 advertiser autorizado resolvido.
async function getStatus(accountId, opts = {}) {
  if (!pipeboard.enabled) return { enabled: false, connected: false };
  let advertiserId = '';
  try {
    advertiserId = await resolveAdvertiserId(accountId, opts);
  } catch (err) {
    // chave inválida / MCP fora do ar → tratamos como "habilitado, sem conexão"
    return { enabled: true, connected: false, error: String((err && err.message) || err).slice(0, 200) };
  }
  if (!advertiserId) return { enabled: true, connected: false };
  let advertiser = null;
  try { advertiser = await getAdvertiserInfo(advertiserId); } catch (_) { /* segue sem info */ }
  return {
    enabled: true,
    connected: true,
    advertiserId,
    advertiser: advertiser || { id: advertiserId, name: advertiserId, healthStatus: 'unknown' },
  };
}

// Grava a seleção de advertiser da UI (valida que pertence à lista autorizada).
async function selectAdvertiser(accountId, advertiserId) {
  const id = String(advertiserId || '').trim();
  const ids = await listAdvertiserIds();
  if (!ids.includes(id)) {
    const err = new Error('Advertiser não autorizado para esta chave');
    err.status = 403;
    throw err;
  }
  setState(accountId, { advertiserId: id });
  cacheBust('tree:' + accountId);
  return getStatus(accountId);
}

// ── Árvore de campanhas ────────────────────────────────────────────────────────
// Mapeia get_tiktok_campaigns/adgroups/ads para o shape do painel.
// operation_status ENABLE/DISABLE → status ativo/pausado; a UI usa isso.
function textField() {
  for (const value of arguments) {
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return '';
}

function mapCampaign(c) {
  const row = c || {};
  return {
    id: textField(row.campaign_id, row.id),
    name: textField(row.campaign_name, row.name),
    status: textField(row.operation_status, row.status),   // ENABLE | DISABLE
    secondaryStatus: textField(row.secondary_status),
    objective: textField(row.objective_type, row.objective),
    catalogId: textField(row.catalog_id, row.catalogId, row.product_catalog_id),
    productSource: textField(row.product_source, row.productSource),
    shoppingAdsType: textField(row.shopping_ads_type, row.shoppingAdsType),
    budget: Number(row.budget || 0),
    budgetMode: textField(row.budget_mode, row.budgetMode),
    budgetOptimizeOn: row.budget_optimize_on === true || row.budgetOptimizeOn === true,
    campaignType: textField(row.campaign_type, row.campaignType),
    createTime: textField(row.create_time, row.createTime),
    modifyTime: textField(row.modify_time, row.modifyTime),
  };
}
function mapAdGroup(g) {
  const row = g || {};
  return {
    id: textField(row.adgroup_id, row.id),
    campaignId: textField(row.campaign_id, row.campaignId),
    name: textField(row.adgroup_name, row.name),
    status: textField(row.operation_status, row.status),        // ENABLE | DISABLE
    secondaryStatus: textField(row.secondary_status), // ADGROUP_STATUS_*
    catalogId: textField(row.catalog_id, row.catalogId, row.product_catalog_id),
    productSource: textField(row.product_source, row.productSource),
    shoppingAdsType: textField(row.shopping_ads_type, row.shoppingAdsType),
    promotionType: textField(row.promotion_type, row.promotionType),
    shoppingAdsRetargetingType: textField(row.shopping_ads_retargeting_type, row.shoppingAdsRetargetingType),
    // Catálogo usa catalog_authorized_bc_id. store_authorized_bc_id é o
    // contrato de TikTok Shop e não comprova autorização do catálogo.
    catalogAuthorizedBcId: textField(row.catalog_authorized_bc_id, row.catalogAuthorizedBcId),
    storeAuthorizedBcId: textField(row.store_authorized_bc_id, row.storeAuthorizedBcId),
    budget: Number(row.budget || 0),
    budgetMode: textField(row.budget_mode, row.budgetMode),
    optimizationGoal: textField(row.optimization_goal, row.optimizationGoal),
    pixelId: textField(row.pixel_id, row.pixelId),
    optimizationEvent: textField(row.optimization_event, row.optimizationEvent),
    bidType: textField(row.bid_type, row.bidType),
    bidPrice: Number(row.bid_price || row.bidPrice || 0),
    conversionBidPrice: Number(row.conversion_bid_price || row.conversionBidPrice || 0),
    deliveryMode: textField(row.delivery_mode, row.deliveryMode),
    pacing: textField(row.pacing, row.pacing_mode, row.pacingMode),
    billingEvent: textField(row.billing_event, row.billingEvent),
    placementType: textField(row.placement_type, row.placementType),
    placements: Array.isArray(row.placements) ? row.placements.map(String) : [],
    targeting: row.targeting && typeof row.targeting === 'object'
      ? row.targeting
      : Array.isArray(row.location_ids) ? { location_ids: row.location_ids.map(String) } : null,
    scheduleType: textField(row.schedule_type, row.scheduleType),
    scheduleStartTime: textField(row.schedule_start_time, row.scheduleStartTime),
    scheduleEndTime: textField(row.schedule_end_time, row.scheduleEndTime),
    createTime: textField(row.create_time, row.createTime),
    modifyTime: textField(row.modify_time, row.modifyTime),
  };
}
function mapAd(a) {
  const row = a || {};
  return {
    id: textField(row.ad_id, row.id),
    adgroupId: textField(row.adgroup_id, row.adgroupId),
    campaignId: textField(row.campaign_id, row.campaignId),
    name: textField(row.ad_name, row.name),
    status: textField(row.operation_status, row.status),        // ENABLE | DISABLE
    secondaryStatus: textField(row.secondary_status), // AD_STATUS_*
    catalogId: textField(row.catalog_id, row.catalogId, row.product_catalog_id),
    websiteType: textField(row.website_type, row.websiteType),
    destinationPageType: textField(row.destination_page_type, row.destinationPageType),
    adFormat: textField(row.ad_format, row.adFormat),
    verticalVideoStrategy: textField(row.vertical_video_strategy, row.verticalVideoStrategy),
    productsType: textField(row.products_type, row.productsType),
    productSpecificType: textField(row.product_specific_type, row.productSpecificType),
    productIds: (Array.isArray(row.product_ids) ? row.product_ids : Array.isArray(row.productIds) ? row.productIds : []).map(String),
    skuIds: (Array.isArray(row.sku_ids) ? row.sku_ids : Array.isArray(row.skuIds) ? row.skuIds : []).map(String),
    productSetId: textField(row.product_set_id, row.productSetId),
    itemGroupIds: (Array.isArray(row.item_group_ids) ? row.item_group_ids : Array.isArray(row.itemGroupIds) ? row.itemGroupIds : []).map(String),
    musicId: textField(row.music_id, row.musicId),
    catalogVideoTemplateId: textField(row.catalog_video_template_id, row.catalogVideoTemplateId),
    adText: textField(row.ad_text, row.adText),
    callToAction: textField(row.call_to_action, row.callToAction),
    identityId: textField(row.identity_id, row.identityId),
    identityType: textField(row.identity_type, row.identityType),
    identityBcId: textField(row.identity_authorized_bc_id, row.identity_bc_id, row.identityBcId),
    darkPostStatus: textField(row.dark_post_status, row.darkPostStatus),
    videoId: textField(row.video_id, row.videoId),
    imageIds: Array.isArray(row.image_ids) ? row.image_ids.map(String) : Array.isArray(row.imageIds) ? row.imageIds.map(String) : [],
    landingPageUrl: textField(row.landing_page_url, row.landingPageUrl, row.landing_url, row.landingUrl),
    trackingPixelId: textField(row.tracking_pixel_id, row.trackingPixelId),
    utmParams: Array.isArray(row.utm_params) ? row.utm_params : [],
    deeplinkUtmParams: Array.isArray(row.deeplink_utm_params) ? row.deeplink_utm_params : [],
    createTime: textField(row.create_time, row.createTime),
    modifyTime: textField(row.modify_time, row.modifyTime),
  };
}

function equalsEnum(actual, expected) {
  return String(actual || '').trim().toUpperCase() === String(expected || '').trim().toUpperCase();
}

function pausedReadback(entity) {
  const pausedValues = [
    'DISABLE', 'DISABLED', 'PAUSED', 'STATUS_DISABLE', 'STATUS_PAUSED',
    'CAMPAIGN_STATUS_DISABLE', 'ADGROUP_STATUS_DISABLE', 'AD_STATUS_DISABLE',
  ];
  const status = String(entity && entity.status || '').trim().toUpperCase();
  // operation_status é a fonte de verdade quando vem na leitura. Um status
  // ENABLE não pode ser mascarado por um secondary_status transitório.
  if (status) return pausedValues.includes(status);
  return pausedValues.includes(String(entity && entity.secondaryStatus || '').trim().toUpperCase());
}

function activeReadback(entity) {
  const activeValues = [
    'ENABLE', 'ENABLED', 'ACTIVE', 'STATUS_ENABLE', 'STATUS_ACTIVE',
    'CAMPAIGN_STATUS_ENABLE', 'ADGROUP_STATUS_ENABLE', 'AD_STATUS_ENABLE',
  ];
  // Para ativação, somente operation_status (mapeado em `status`) confirma a
  // intenção operacional. secondary_status pode continuar em análise sem
  // significar que o nível está pausado pelo usuário.
  return activeValues.includes(String(entity && entity.status || '').trim().toUpperCase());
}

function verifyCatalogHierarchyActivation(input) {
  const value = input || {};
  const ids = value.ids || {};
  const campaign = value.campaign || {};
  const adGroup = value.adGroup || {};
  const ad = value.ad || {};
  const hierarchy = Boolean(
    String(campaign.id || '') === String(ids.campaignId || '')
    && String(adGroup.id || '') === String(ids.adGroupId || '')
    && String(adGroup.campaignId || '') === String(ids.campaignId || '')
    && String(ad.id || '') === String(ids.adId || '')
    && String(ad.adgroupId || '') === String(ids.adGroupId || '')
    && String(ad.campaignId || '') === String(ids.campaignId || ''),
  );
  const active = activeReadback(campaign) && activeReadback(adGroup) && activeReadback(ad);
  return {
    complete: hierarchy && active,
    hierarchy,
    active,
    checks: {
      campaign: { id: campaign.id || null, status: campaign.status || null, secondaryStatus: campaign.secondaryStatus || null },
      adGroup: { id: adGroup.id || null, status: adGroup.status || null, secondaryStatus: adGroup.secondaryStatus || null },
      ad: { id: ad.id || null, status: ad.status || null, secondaryStatus: ad.secondaryStatus || null },
    },
  };
}

// Uma resposta de criação com três IDs não prova que o TikTok montou a
// campanha pedida. Esta checagem exige, na leitura posterior, a cadeia inteira
// e o contrato Product Link: catálogo correto no conjunto/anúncio, vídeo
// vertical, cada nível pausado e nenhuma URL manual. A leitura de campanhas do
// TikTok não devolve os campos de catálogo; por isso objetivo+status são a
// prova possível nesse nível, enquanto os dois níveis inferiores fecham a
// semântica de catálogo sem inferir dados ausentes.
function verifyCatalogProductLinkHierarchy(input) {
  const value = input || {};
  const expected = value.expected || {};
  const campaign = value.campaign || {};
  const adGroup = value.adGroup || {};
  const ad = value.ad || {};
  const ids = {
    campaign: textField(expected.campaignId), adGroup: textField(expected.adGroupId), ad: textField(expected.adId),
  };
  const catalogId = textField(expected.catalogId);
  const shoppingAdsType = textField(expected.shoppingAdsType);
  const bcId = textField(expected.bcId);
  const itemGroupIds = (Array.isArray(expected.itemGroupIds) ? expected.itemGroupIds : []).map(String).sort();
  const readItemGroupIds = (Array.isArray(ad.itemGroupIds) ? ad.itemGroupIds : []).map(String).sort();
  const skuIds = (Array.isArray(expected.skuIds) ? expected.skuIds : []).map(String).sort();
  const readSkuIds = (Array.isArray(ad.skuIds) ? ad.skuIds : []).map(String).sort();
  const locationIds = (Array.isArray(expected.locationIds) ? expected.locationIds : []).map(String).sort();
  const readTargeting = adGroup.targeting && typeof adGroup.targeting === 'object' ? adGroup.targeting : {};
  const readLocationIds = (Array.isArray(readTargeting.location_ids)
    ? readTargeting.location_ids
    : Array.isArray(readTargeting.locationIds) ? readTargeting.locationIds : []).map(String).sort();
  const readPlacements = (Array.isArray(adGroup.placements) ? adGroup.placements : []).map(String).sort();
  const expectsBidDelivery = Boolean(expected.bidStrategy || expected.deliveryMode);
  const expectedBidStrategy = textField(expected.bidStrategy) || 'lowest_cost';
  const expectedBidAmount = Number(expected.bidAmount || 0);
  const expectedDeliveryMode = textField(expected.deliveryMode) || 'standard';
  const readDeliveryMode = textField(adGroup.deliveryMode).toUpperCase();
  const readPacing = textField(adGroup.pacing).toUpperCase();
  const acceleratedReadback = readDeliveryMode.includes('ACCELERATED') || readPacing.includes('FAST') || readPacing.includes('ACCELERATED');
  const standardReadback = !acceleratedReadback && (
    readDeliveryMode.includes('STANDARD') || readPacing.includes('SMOOTH') || readPacing.includes('STANDARD')
  );
  const bidDelivery = !expectsBidDelivery || Boolean(
    (expectedBidStrategy === 'cost_cap'
      ? equalsEnum(adGroup.bidType, 'BID_TYPE_CUSTOM')
        && expectedBidAmount > 0
        && Math.abs(Number(adGroup.conversionBidPrice || 0) - expectedBidAmount) < 0.000001
      : equalsEnum(adGroup.bidType, 'BID_TYPE_NO_BID')
        && !(Number(adGroup.bidPrice || 0) > 0)
        && !(Number(adGroup.conversionBidPrice || 0) > 0))
    && (expectedDeliveryMode === 'accelerated' ? acceleratedReadback : standardReadback)
  );
  const hierarchy = Boolean(
    ids.campaign && ids.adGroup && ids.ad
    && campaign.id === ids.campaign
    && adGroup.id === ids.adGroup && adGroup.campaignId === ids.campaign
    && ad.id === ids.ad && ad.adgroupId === ids.adGroup && ad.campaignId === ids.campaign,
  );
  const productLink = Boolean(
    equalsEnum(campaign.objective, 'PRODUCT_SALES')
    && adGroup.catalogId === catalogId
    && equalsEnum(adGroup.productSource, 'CATALOG')
    && equalsEnum(adGroup.shoppingAdsType, shoppingAdsType)
    && equalsEnum(adGroup.promotionType, 'WEBSITE')
    && equalsEnum(adGroup.shoppingAdsRetargetingType, 'OFF')
    && adGroup.catalogAuthorizedBcId === bcId
    && ad.catalogId === catalogId,
  );
  const targeting = Boolean(
    adGroup.pixelId === textField(expected.pixelId)
    && equalsEnum(adGroup.optimizationEvent, expected.pixelEvent)
    && equalsEnum(adGroup.optimizationGoal, 'CONVERT')
    && equalsEnum(adGroup.billingEvent, 'OCPM')
    && equalsEnum(adGroup.placementType, 'PLACEMENT_TYPE_NORMAL')
    && JSON.stringify(readPlacements) === JSON.stringify(['PLACEMENT_TIKTOK'])
    && (!locationIds.length || JSON.stringify(readLocationIds) === JSON.stringify(locationIds))
  );
  const identity = Boolean(
    ad.identityId === textField(expected.identityId)
    && equalsEnum(ad.identityType, expected.identityType || 'BC_AUTH_TT')
    && ad.identityBcId === textField(expected.identityBcId || bcId)
    // O readback atual não ecoa dark_post_status. Quando vier, precisa ser ON;
    // quando omitido, a criação aceita + identidade BC_AUTH_TT comprovam que
    // o TikTok aceitou o dark post enviado no request.
    && (!ad.darkPostStatus || equalsEnum(ad.darkPostStatus, expected.darkPostStatus || 'ON'))
  );
  const creative = Boolean(
    equalsEnum(ad.adFormat, expected.adFormat)
    && equalsEnum(ad.verticalVideoStrategy, expected.verticalVideoStrategy)
    && equalsEnum(ad.productSpecificType, expected.productSpecificType)
    && (!expected.productSetId || ad.productSetId === textField(expected.productSetId))
    && (!itemGroupIds.length || JSON.stringify(readItemGroupIds) === JSON.stringify(itemGroupIds))
    && (!skuIds.length || JSON.stringify(readSkuIds) === JSON.stringify(skuIds))
    && (!expected.videoId || ad.videoId === textField(expected.videoId))
    && (!expected.imageId || ad.imageIds.includes(textField(expected.imageId)))
    && (!expected.adText || ad.adText === textField(expected.adText))
    && (!expected.callToAction || equalsEnum(ad.callToAction, expected.callToAction))
  );
  const noManualUrl = !textField(ad.landingPageUrl);
  const paused = pausedReadback(campaign) && pausedReadback(adGroup) && pausedReadback(ad);
  return {
    complete: hierarchy && productLink && targeting && bidDelivery && identity && creative && noManualUrl && paused,
    hierarchy,
    productLink,
    targeting,
    bidDelivery,
    identity,
    creative,
    noManualUrl,
    paused,
    checks: {
      campaign: { id: campaign.id || null, status: campaign.status || null, catalogId: campaign.catalogId || null, productSource: campaign.productSource || null, shoppingAdsType: campaign.shoppingAdsType || null },
      adGroup: { id: adGroup.id || null, campaignId: adGroup.campaignId || null, status: adGroup.status || null, catalogId: adGroup.catalogId || null, catalogAuthorizedBcId: adGroup.catalogAuthorizedBcId || null, promotionType: adGroup.promotionType || null, shoppingAdsRetargetingType: adGroup.shoppingAdsRetargetingType || null, pixelId: adGroup.pixelId || null, optimizationEvent: adGroup.optimizationEvent || null, bidType: adGroup.bidType || null, bidPrice: adGroup.bidPrice || 0, conversionBidPrice: adGroup.conversionBidPrice || 0, deliveryMode: adGroup.deliveryMode || null, pacing: adGroup.pacing || null },
      ad: { id: ad.id || null, adgroupId: ad.adgroupId || null, status: ad.status || null, catalogId: ad.catalogId || null, landingPageUrl: ad.landingPageUrl || null, adFormat: ad.adFormat || null, verticalVideoStrategy: ad.verticalVideoStrategy || null, productSpecificType: ad.productSpecificType || null, itemGroupIds: ad.itemGroupIds || [], skuIds: ad.skuIds || [], productSetId: ad.productSetId || null, videoId: ad.videoId || null, imageIds: ad.imageIds || [], identityType: ad.identityType || null, identityBcId: ad.identityBcId || null },
    },
  };
}

function paginationInfo(value) {
  const out = value || {};
  const info = out.page_info || out.pageInfo || (out.data && (out.data.page_info || out.data.pageInfo)) || {};
  return {
    page: Number(info.page || info.current_page || 0),
    pageSize: Number(info.page_size || info.pageSize || 0),
    totalPage: Number(info.total_page || info.totalPage || 0),
    totalNumber: Number(info.total_number || info.totalNumber || 0),
  };
}

// As contas reais passam facilmente do limite de uma página (a conta usada na
// validação tinha 1.272 anúncios). Uma leitura parcial é perigosa: apaga itens
// do espelho e faz a automação decidir sobre uma árvore incompleta. Este helper
// pagina até o total declarado pelo TikTok e, na ausência de page_info, só
// continua enquanto a página vier cheia. O teto evita loop em resposta ruim.
async function listAllPages(toolName, baseArgs, keys, opts = {}) {
  const pageSize = Math.max(1, Number(opts.pageSize) || 100);
  const maxPages = Math.max(1, Math.min(200, Number(opts.maxPages) || 100));
  const rows = [];
  let page = 1;
  while (page <= maxPages) {
    const out = await pipeboard.callTool(toolName, { ...baseArgs, page, page_size: pageSize });
    const current = firstArray(out, keys);
    rows.push(...current);
    const info = paginationInfo(out);
    if (info.totalPage > 0) {
      if (page >= info.totalPage) break;
    } else if (info.totalNumber > 0) {
      if (rows.length >= info.totalNumber) break;
    } else if (current.length < pageSize) {
      break;
    }
    if (!current.length) break;
    page += 1;
  }
  return rows;
}

async function getCampaigns(advertiserId, { pageSize = 100, campaignIds } = {}) {
  const id = String(advertiserId);
  const wanted = Array.isArray(campaignIds) && campaignIds.length
    ? new Set(campaignIds.map(String))
    : null;
  // Ao contrário das tools de ad group/anúncio, get_tiktok_campaigns não
  // aceita campaign_ids. Enviar esse campo era inócuo no MCP e fazia a
  // verificação pós-criação consultar a página errada. Buscamos uma página
  // ampla e filtramos localmente.
  const rows = (await listAllPages(
    'get_tiktok_campaigns',
    { advertiser_id: id },
    ['campaigns', 'campaign_list', 'list', 'data'],
    { pageSize: wanted ? 1000 : pageSize },
  )).map(mapCampaign);
  return wanted ? rows.filter((campaign) => wanted.has(String(campaign.id))) : rows;
}
async function getAdGroups(advertiserId, campaignIds, { pageSize = 500 } = {}) {
  const id = String(advertiserId);
  const args = { advertiser_id: id };
  if (Array.isArray(campaignIds) && campaignIds.length) args.campaign_ids = campaignIds.map(String);
  return (await listAllPages(
    'get_tiktok_adgroups', args, ['adgroups', 'ad_groups', 'adgroup_list', 'list', 'data'], { pageSize },
  )).map(mapAdGroup);
}
async function getAds(advertiserId, { campaignIds, adgroupIds, pageSize = 500 } = {}) {
  const id = String(advertiserId);
  const args = { advertiser_id: id };
  if (Array.isArray(campaignIds) && campaignIds.length) args.campaign_ids = campaignIds.map(String);
  if (Array.isArray(adgroupIds) && adgroupIds.length) args.adgroup_ids = adgroupIds.map(String);
  return (await listAllPages(
    'get_tiktok_ads', args, ['ads', 'ad_list', 'list', 'data'], { pageSize },
  )).map(mapAd);
}

// Árvore completa campanha → adgroup → ad. Cache 60s por (conta, advertiser).
async function getTree(accountId, advertiserId) {
  const id = String(advertiserId || (await resolveAdvertiserId(accountId)));
  if (!id) return { advertiserId: '', campaigns: [] };
  const ck = 'tree:' + accountId + ':' + id;
  const hit = cacheGet(ck);
  if (hit) return hit;
  const [campaigns, adgroups, ads] = await Promise.all([
    getCampaigns(id),
    getAdGroups(id),
    getAds(id),
  ]);
  const adsByGroup = new Map();
  for (const ad of ads) {
    if (!adsByGroup.has(ad.adgroupId)) adsByGroup.set(ad.adgroupId, []);
    adsByGroup.get(ad.adgroupId).push(ad);
  }
  const groupsByCampaign = new Map();
  for (const g of adgroups) {
    g.ads = adsByGroup.get(g.id) || [];
    if (!groupsByCampaign.has(g.campaignId)) groupsByCampaign.set(g.campaignId, []);
    groupsByCampaign.get(g.campaignId).push(g);
  }
  const tree = campaigns.map((c) => Object.assign({}, c, { adgroups: groupsByCampaign.get(c.id) || [] }));
  return cacheSet(ck, { advertiserId: id, campaigns: tree }, 60 * 1000);
}

// ── Insights (métricas) ─────────────────────────────────────────────────────────
// get_tiktok_insights: data_level AUCTION_ADVERTISER/CAMPAIGN/ADGROUP/AD,
// start_date/end_date YYYY-MM-DD. Retorna linhas com metrics + dimensions.
// Mapeamos as métricas nucleares que o painel usa (spend, impressions, clicks,
// conversions, e derivadas). Números vêm como string do TikTok → Number().
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
// Shape REAL (Gate 1): { dimensions:{campaign_id|adgroup_id|ad_id|stat_time_day},
//   metrics:{ spend, impressions, clicks, conversion, cpc, cpm, ctr,
//             cost_per_conversion, reach, frequency } }. Números vêm como
// string ("0.00") → num(). Não há coluna de RECEITA no report BASIC; ROAS/
// receita atribuída vêm de outra fonte (attribution) — não inventamos aqui.
function mapInsightRow(row) {
  const m = (row && row.metrics) || {};
  const d = (row && row.dimensions) || {};
  const spend = num(m.spend);
  const impressions = num(m.impressions);
  const clicks = num(m.clicks);
  const conversions = num(m.conversion ?? m.conversions);
  return {
    dimensions: d,
    spend,
    impressions,
    clicks,
    conversions,
    reach: num(m.reach),
    // preferimos as métricas derivadas que o TikTok já entrega (evita divisão
    // por zero e bate com o painel do TikTok); caímos no cálculo se ausentes.
    ctr: m.ctr != null ? num(m.ctr) : (impressions ? clicks / impressions : 0),
    cpc: m.cpc != null ? num(m.cpc) : (clicks ? spend / clicks : 0),
    cpm: m.cpm != null ? num(m.cpm) : (impressions ? (spend / impressions) * 1000 : 0),
    cpa: m.cost_per_conversion != null ? num(m.cost_per_conversion) : (conversions ? spend / conversions : 0),
    raw: m,
  };
}

// dimensão obrigatória por nível — get_tiktok_insights EXIGE dimensions.
// (descoberto no Gate 1: chamada sem dimensions dá erro 40002.)
const LEVEL_DEFAULT_DIMENSION = {
  AUCTION_ADVERTISER: ['advertiser_id'],
  AUCTION_CAMPAIGN: ['campaign_id'],
  AUCTION_ADGROUP: ['adgroup_id'],
  AUCTION_AD: ['ad_id'],
};

async function getInsights(advertiserId, { level = 'AUCTION_CAMPAIGN', startDate, endDate, dimensions } = {}) {
  const id = String(advertiserId);
  const dims = (Array.isArray(dimensions) && dimensions.length)
    ? dimensions
    : (LEVEL_DEFAULT_DIMENSION[level] || ['campaign_id']);
  const out = await pipeboard.callTool('get_tiktok_insights', {
    advertiser_id: id,
    data_level: level,
    start_date: startDate,
    end_date: endDate,
    dimensions: dims,
  });
  const rows = Array.isArray(out.metrics) ? out.metrics : [];
  return {
    rows: rows.map(mapInsightRow),
    totalRows: num(out.total_rows),
    raw: out,
  };
}

// ── Árvore no SHAPE do dashboard (contrato do frontend) ──────────────────────
// O frontend (AdsTreeResponse em dashboard/lib/types.ts) espera:
//   campaign: { platformCampaignId, campaignName, status(AdsNodeStatus),
//     childStatus?, campaignKind('auction'|'smart_plus'), platformCampaignStatus,
//     reviewStatus, adCount, adSetCount,
//     budget:{amount,type}, currency, metrics(AdsMetrics), platformAdAccountId,
//     adSets:[{ platformAdSetId, adSetName, status, budget, metrics, ads:[
//       { platformAdId, name, status, budget, metrics, creative, rejectionReason }]}] }
// Este é o mapeamento que substitui o /ads/tree da Zernio (Gate 3).

// operation_status (ENABLE/DISABLE) + secondary_status (enum TikTok) → AdsNodeStatus.
// O secondary_status é a fonte real de revisão/rejeição; quando ausente, cai no
// operation_status. Substring com ordem cuidadosa (DELETE/REJECT antes de ENABLE).
function tiktokStatusToNode(operationStatus, secondaryStatus) {
  const sec = String(secondaryStatus || '').toUpperCase();
  const op = String(operationStatus || '').toUpperCase();
  if (sec) {
    if (sec.includes('DELETE')) return 'cancelled';
    if (sec.includes('REJECT') || sec.includes('DENY') || sec.includes('AUDIT_DENY')) return 'rejected';
    if (sec.includes('AUDIT') || sec.includes('REAUDIT') || sec.includes('REVIEW')) return 'pending_review';
    if (sec.includes('BALANCE') || sec.includes('EXCEED') || sec.includes('ERROR')) return 'error';
    // *_CAMPAIGN_DISABLE / *_ADGROUP_DISABLE / *_ADVERTISER_* / *_DISABLE → pausado
    if (sec.includes('DISABLE') || sec.includes('PAUSE') || sec.includes('NOT_START') || sec.includes('SUSPEND')) return 'paused';
    if (sec.includes('DELIVERY_OK') || sec.includes('LIVE') || sec.includes('ENABLE') || sec.includes('AVAILABLE')) return 'active';
  }
  if (op === 'ENABLE') return 'active';
  if (op === 'DISABLE') return 'paused';
  return 'paused';
}

// reviewStatus da CAMPANHA derivado dos secondary_status dos anúncios filhos:
// qualquer rejeitado → rejected; qualquer em análise → in_review; todos ok →
// approved; senão null. (Contrato: 'in_review'|'approved'|'rejected'|'with_issues')
function deriveReviewStatus(adNodes) {
  if (!adNodes.length) return null;
  let anyReject = false, anyReview = false, anyOk = false, anyErr = false;
  for (const s of adNodes) {
    if (s === 'rejected') anyReject = true;
    else if (s === 'pending_review') anyReview = true;
    else if (s === 'active') anyOk = true;
    else if (s === 'error') anyErr = true;
  }
  if (anyReject) return 'rejected';
  if (anyReview) return 'in_review';
  if (anyErr) return 'with_issues';
  if (anyOk) return 'approved';
  return null;
}

function budgetObj(amount, mode) {
  const m = String(mode || '').toUpperCase();
  const type = m.includes('TOTAL') || m.includes('LIFETIME') ? 'lifetime' : 'daily';
  return { amount: Number(amount || 0), type };
}

// Índice metrics por id (campaign_id/adgroup_id/ad_id) para um nível de insight.
async function insightsById(advertiserId, level, dimKey, startDate, endDate) {
  const { rows } = await getInsights(advertiserId, { level, startDate, endDate, dimensions: [dimKey] });
  const map = new Map();
  for (const r of rows) {
    const id = String((r.dimensions || {})[dimKey] || '');
    if (!id) continue;
    map.set(id, {
      impressions: r.impressions,
      clicks: r.clicks,
      spend: r.spend,
      ctr: r.ctr,
      cpm: r.cpm,
      cpc: r.cpc,
      conversions: r.conversions,
      reach: r.reach,
    });
  }
  return map;
}

const EMPTY_METRICS = { impressions: 0, clicks: 0, spend: 0, ctr: 0, cpm: 0, cpc: 0, conversions: 0, reach: 0 };

async function getDashboardTree(accountId, opts = {}) {
  const advertiserId = String(opts.advertiserId || (await resolveAdvertiserId(accountId)));
  if (!advertiserId) return { campaigns: [], pagination: { page: 1, limit: 100, total: 0, pages: 0 } };

  const iso = (d) => d.toISOString().slice(0, 10);
  const today = new Date();
  const yearAgo = new Date(today.getTime() - 365 * 864e5);
  const fromDate = /^\d{4}-\d{2}-\d{2}$/.test(String(opts.fromDate || '')) ? opts.fromDate : iso(yearAgo);
  const toDate = /^\d{4}-\d{2}-\d{2}$/.test(String(opts.toDate || '')) ? opts.toDate : iso(today);
  const statusFilter = ['active', 'paused', 'pending_review', 'error', 'completed', 'cancelled', 'rejected'].includes(opts.status) ? opts.status : undefined;

  const ck = 'dashtree:' + accountId + ':' + advertiserId + ':' + fromDate + ':' + toDate;
  let base = opts.fresh ? null : cacheGet(ck);
  if (!base) {
    const [campaigns, adgroups, ads, cMet, gMet, aMet, advInfo] = await Promise.all([
      getCampaigns(advertiserId),
      getAdGroups(advertiserId),
      getAds(advertiserId),
      insightsById(advertiserId, 'AUCTION_CAMPAIGN', 'campaign_id', fromDate, toDate).catch(() => new Map()),
      insightsById(advertiserId, 'AUCTION_ADGROUP', 'adgroup_id', fromDate, toDate).catch(() => new Map()),
      insightsById(advertiserId, 'AUCTION_AD', 'ad_id', fromDate, toDate).catch(() => new Map()),
      getAdvertiserInfo(advertiserId).catch(() => null),
    ]);
    const currency = (advInfo && advInfo.currency) || 'USD';

    const adsByGroup = new Map();
    for (const ad of ads) {
      const node = {
        platformAdId: ad.id,
        name: ad.name,
        campaignKind: 'auction',
        campaignId: ad.campaignId,
        adGroupId: ad.adgroupId,
        status: tiktokStatusToNode(ad.status, ad.secondaryStatus),
        platformStatus: ad.status,
        secondaryStatus: ad.secondaryStatus,
        catalogId: ad.catalogId || undefined,
        websiteType: ad.websiteType || undefined,
        adFormat: ad.adFormat || undefined,
        budget: null,
        metrics: aMet.get(ad.id) || Object.assign({}, EMPTY_METRICS),
        creative: {
          body: ad.adText || '',
          linkUrl: ad.landingPageUrl || '',
          videoUrl: ad.videoId ? ('tiktok:video:' + ad.videoId) : '',
          imageUrl: (ad.imageIds && ad.imageIds[0]) ? ('tiktok:image:' + ad.imageIds[0]) : '',
        },
        rejectionReason: tiktokStatusToNode(ad.status, ad.secondaryStatus) === 'rejected' ? ad.secondaryStatus : undefined,
        createdAt: ad.createTime || undefined,
      };
      if (!adsByGroup.has(ad.adgroupId)) adsByGroup.set(ad.adgroupId, []);
      adsByGroup.get(ad.adgroupId).push(node);
    }

    const setsByCampaign = new Map();
    for (const g of adgroups) {
      const gAds = adsByGroup.get(g.id) || [];
      const node = {
        platformAdSetId: g.id,
        adSetName: g.name,
        name: g.name,
        campaignKind: 'auction',
        campaignId: g.campaignId,
        status: tiktokStatusToNode(g.status, g.secondaryStatus),
        platformStatus: g.status,
        secondaryStatus: g.secondaryStatus,
        budget: budgetObj(g.budget, g.budgetMode),
        pixelId: g.pixelId || undefined,
        optimizationEvent: g.optimizationEvent || undefined,
        optimizationGoal: g.optimizationGoal || undefined,
        metrics: gMet.get(g.id) || Object.assign({}, EMPTY_METRICS),
        ads: gAds,
      };
      if (!setsByCampaign.has(g.campaignId)) setsByCampaign.set(g.campaignId, []);
      setsByCampaign.get(g.campaignId).push(node);
    }

    const campaignsOut = campaigns.map((c) => {
      const adSets = setsByCampaign.get(c.id) || [];
      const allAdStatuses = adSets.flatMap((s) => (s.ads || []).map((a) => a.status));
      const platformStatus = c.status; // ENABLE | DISABLE (operation_status cru)
      const ownStatus = tiktokStatusToNode(c.status, '');
      // reviewStatus vem dos anúncios; se a campanha está "active" mas os anúncios
      // divergem, preservamos o status próprio em childStatus (igual ao legado).
      const review = deriveReviewStatus(allAdStatuses);
      const budgetOwner = c.budgetOptimizeOn || Number(c.budget) > 0 ? 'campaign' : 'adgroup';
      let status = ownStatus;
      let childStatus;
      if (ownStatus === 'active' && review === 'in_review') { status = 'pending_review'; childStatus = ownStatus; }
      else if (ownStatus === 'active' && review === 'rejected') { status = 'rejected'; childStatus = ownStatus; }
      return {
        platformCampaignId: c.id,
        campaignName: c.name,
        status,
        childStatus,
        // Origem da campanha: 'auction' (leilão padrão) vs 'smart_plus' (mescladas
        // pelo ads-sync). O motor de automação usa este campo para rotear a ação
        // de status ao provider certo e pular ajustes de orçamento no Smart+.
        campaignKind: 'auction',
        budgetOwner,
        budgetOptimizeOn: c.budgetOptimizeOn,
        platformCampaignStatus: platformStatus,
        reviewStatus: review,
        adCount: allAdStatuses.length,
        adSetCount: adSets.length,
        budget: budgetObj(c.budget, c.budgetMode),
        currency,
        metrics: cMet.get(c.id) || Object.assign({}, EMPTY_METRICS),
        platformAdAccountId: advertiserId,
        platformAdAccountName: (advInfo && advInfo.name) || null,
        adSets,
      };
    });

    base = { campaigns: campaignsOut, backfillPending: false, pagination: { page: 1, limit: 100, total: campaignsOut.length, pages: 1 } };
    cacheSet(ck, base, 15 * 1000);
  }

  // filtro de status aplicado sobre o conjunto completo cacheado. 'approved'
  // (Validadas) filtra por reviewStatus — dimensão de revisão, não de entrega.
  let campaigns = base.campaigns;
  if (opts.status === 'approved') campaigns = campaigns.filter((c) => c.reviewStatus === 'approved');
  // Filtros são mutuamente exclusivos pelo status apresentado na UI. O
  // childStatus é diagnóstico da plataforma e não uma segunda categoria.
  else if (statusFilter) campaigns = campaigns.filter((c) => c.status === statusFilter);
  // ordenação
  const sort = ['newest', 'oldest', 'spend_desc', 'spend_asc'].includes(opts.sort) ? opts.sort : 'newest';
  campaigns = campaigns.slice().sort((a, b) => {
    if (sort === 'spend_desc') return (b.metrics.spend || 0) - (a.metrics.spend || 0);
    if (sort === 'spend_asc') return (a.metrics.spend || 0) - (b.metrics.spend || 0);
    // newest/oldest por adCount não faz sentido; usamos platformCampaignId (crescente ~ ordem de criação)
    const cmp = String(a.platformCampaignId).localeCompare(String(b.platformCampaignId));
    return sort === 'oldest' ? cmp : -cmp;
  });
  return Object.assign({}, base, { campaigns: campaigns, pagination: Object.assign({}, base.pagination, { total: campaigns.length }) });
}

// ══ Escrita / mutações (Gate 4) ══════════════════════════════════════════════
// A dashboard fala 'active'|'paused'|'deleted' e budget {amount,type}. O TikTok
// fala operation_status (ENABLE|DISABLE|DELETE) e budget_mode. Traduzimos aqui,
// mantendo a fronteira: rotas nunca montam payload de plataforma na mão.
function badRequest(msg, status) {
  const e = new Error(msg);
  e.status = status || 400;
  return e;
}

// 'active'|'paused'|'deleted' (+ sinônimos) → ENABLE|DISABLE|DELETE.
function toOperationStatus(status) {
  const s = String(status || '').toLowerCase();
  if (['active', 'enable', 'enabled', 'resume', 'resumed'].includes(s)) return 'ENABLE';
  if (['paused', 'pause', 'disable', 'disabled'].includes(s)) return 'DISABLE';
  if (['deleted', 'delete', 'cancel', 'cancelled'].includes(s)) return 'DELETE';
  return null;
}

// 'daily'|'lifetime' → BUDGET_MODE_DAY|BUDGET_MODE_TOTAL.
function toBudgetMode(type) {
  return String(type || '').toLowerCase() === 'lifetime' ? 'BUDGET_MODE_TOTAL' : 'BUDGET_MODE_DAY';
}

function normIds(ids, max) {
  const arr = (Array.isArray(ids) ? ids : [ids]).map((x) => String(x || '').trim().slice(0, 60)).filter(Boolean);
  return arr.slice(0, max || 50);
}

// Status em lote — campanhas.
async function setCampaignStatus(advertiserId, campaignIds, status) {
  const adv = String(advertiserId || '').trim();
  if (!adv) throw badRequest('advertiserId é obrigatório');
  const op = toOperationStatus(status);
  if (!op) throw badRequest('status deve ser active, paused ou deleted');
  const ids = normIds(campaignIds);
  if (!ids.length) throw badRequest('Nenhuma campanha informada');
  return pipeboard.callTool('update_tiktok_campaign_status', { advertiser_id: adv, campaign_ids: ids, operation_status: op });
}

// Status em lote — ad groups.
async function setAdGroupStatus(advertiserId, adGroupIds, status) {
  const adv = String(advertiserId || '').trim();
  if (!adv) throw badRequest('advertiserId é obrigatório');
  const op = toOperationStatus(status);
  if (!op) throw badRequest('status deve ser active, paused ou deleted');
  const ids = normIds(adGroupIds);
  if (!ids.length) throw badRequest('Nenhum ad group informado');
  return pipeboard.callTool('update_tiktok_adgroup_status', { advertiser_id: adv, adgroup_ids: ids, operation_status: op });
}

// Status em lote — anúncios.
async function setAdStatus(advertiserId, adIds, status) {
  const adv = String(advertiserId || '').trim();
  if (!adv) throw badRequest('advertiserId é obrigatório');
  const op = toOperationStatus(status);
  if (!op) throw badRequest('status deve ser active, paused ou deleted');
  const ids = normIds(adIds);
  if (!ids.length) throw badRequest('Nenhum anúncio informado');
  return pipeboard.callTool('update_tiktok_ad_status', { advertiser_id: adv, ad_ids: ids, operation_status: op });
}

async function pauseCatalogHierarchyBestEffort(advertiserId, ids) {
  const adv = String(advertiserId || '').trim();
  const value = ids || {};
  // O pai é pausado primeiro para cortar qualquer possibilidade de entrega;
  // os filhos são então reconciliados em paralelo.
  if (value.campaignId) {
    try { await setCampaignStatus(adv, [value.campaignId], 'paused'); } catch (_) { /* best-effort */ }
  }
  await Promise.allSettled([
    value.adGroupId ? setAdGroupStatus(adv, [value.adGroupId], 'paused') : Promise.resolve(),
    value.adId ? setAdStatus(adv, [value.adId], 'paused') : Promise.resolve(),
  ]);
}

// A criação continua transacional: os três níveis nascem pausados, são lidos
// e validados, e só então este passo os habilita de baixo para cima. A campanha
// (pai) é a última a ficar ENABLE. Qualquer falha volta tudo para pausa e pode
// ser repetida com segurança pelo worker, pois updates de status são idempotentes.
async function activateCatalogCampaignHierarchy(advertiserId, ids) {
  const adv = String(advertiserId || '').trim();
  const value = {
    campaignId: String(ids && ids.campaignId || '').trim(),
    adGroupId: String(ids && ids.adGroupId || '').trim(),
    adId: String(ids && ids.adId || '').trim(),
  };
  if (!adv || !value.campaignId || !value.adGroupId || !value.adId) {
    const err = stepError('activate', 'A hierarquia completa é obrigatória antes da ativação.', value, 400);
    err.code = 'CATALOG_ACTIVATION_IDS_REQUIRED';
    err.retryable = false;
    throw err;
  }
  try {
    await setAdStatus(adv, [value.adId], 'active');
    await setAdGroupStatus(adv, [value.adGroupId], 'active');
    await setCampaignStatus(adv, [value.campaignId], 'active');
    cacheBust('tree:');

    let verification = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const [campaigns, adGroups, ads] = await Promise.all([
        getCampaigns(adv, { pageSize: 100, campaignIds: [value.campaignId] }),
        getAdGroups(adv, [value.campaignId], { pageSize: 100 }),
        getAds(adv, { campaignIds: [value.campaignId], adgroupIds: [value.adGroupId], pageSize: 100 }),
      ]);
      verification = verifyCatalogHierarchyActivation({
        ids: value,
        campaign: campaigns.find((item) => String(item.id) === value.campaignId),
        adGroup: adGroups.find((item) => String(item.id) === value.adGroupId),
        ad: ads.find((item) => String(item.id) === value.adId),
      });
      if (verification.complete) {
        return {
          complete: true,
          active: true,
          requestedAt: new Date().toISOString(),
          verification,
        };
      }
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1200));
    }
    const err = stepError(
      'activate',
      'A estrutura foi validada, mas o TikTok ainda não confirmou os três níveis como ativos.',
      value,
      502,
    );
    err.code = 'CATALOG_ACTIVATION_NOT_CONFIRMED';
    err.retryable = true;
    err.safeAutomaticRetry = true;
    err.activation = verification;
    throw err;
  } catch (err) {
    await pauseCatalogHierarchyBestEffort(adv, value);
    if (!err.step) err.step = 'activate';
    if (!err.code) err.code = 'CATALOG_ACTIVATION_FAILED';
    const permanentStatus = [400, 401, 403, 404, 409, 422].includes(Number(err.status));
    if (permanentStatus && err.code !== 'CATALOG_ACTIVATION_NOT_CONFIRMED') err.retryable = false;
    else if (err.retryable !== false) err.retryable = true;
    // Alterar status é idempotente: timeout pode ser retomado sem duplicar a
    // campanha, o conjunto ou o anúncio.
    if (err.retryable !== false) err.safeAutomaticRetry = true;
    err.createdIds = value;
    err.userMessage = err.userMessage || 'A campanha foi mantida pausada enquanto a dashboard tenta ativá-la novamente.';
    err.suggestedAction = err.suggestedAction || 'Nenhuma ação manual é necessária; a dashboard repetirá a ativação com a mesma hierarquia.';
    throw err;
  }
}

// Atualiza campanha (orçamento e/ou nome). budget: {amount,type}.
async function updateCampaign(advertiserId, campaignId, patch) {
  const adv = String(advertiserId || '').trim();
  const cid = String(campaignId || '').trim();
  if (!adv || !cid) throw badRequest('advertiserId e campaignId são obrigatórios');
  const args = { advertiser_id: adv, campaign_id: cid };
  const p = patch || {};
  if (p.name) args.campaign_name = String(p.name).slice(0, 512);
  if (p.budget && Number(p.budget.amount) > 0) {
    args.budget = Number(p.budget.amount);
    args.budget_mode = toBudgetMode(p.budget.type);
  }
  if (args.campaign_name === undefined && args.budget === undefined) throw badRequest('Nada para atualizar');
  return pipeboard.callTool('update_tiktok_campaign', args);
}

// Atualiza ad group (orçamento e/ou nome).
async function updateAdGroup(advertiserId, adGroupId, patch) {
  const adv = String(advertiserId || '').trim();
  const gid = String(adGroupId || '').trim();
  if (!adv || !gid) throw badRequest('advertiserId e adGroupId são obrigatórios');
  const args = { advertiser_id: adv, adgroup_id: gid };
  const p = patch || {};
  if (p.name) args.adgroup_name = String(p.name).slice(0, 512);
  if (p.budget && Number(p.budget.amount) > 0) {
    args.budget = Number(p.budget.amount);
    args.budget_mode = toBudgetMode(p.budget.type);
  }
  if (args.adgroup_name === undefined && args.budget === undefined) throw badRequest('Nada para atualizar');
  return pipeboard.callTool('update_tiktok_adgroup', args);
}

// Edita um anúncio EXISTENTE sem recriar: texto, CTA, link de destino e nome.
// Usa update_tiktok_ad (patch rápido). Só campos textuais/CTA/URL — troca de
// vídeo/criativo é outro fluxo (exige upload). O link recebe atribuição UTM.
async function updateAd(advertiserId, adId, patch) {
  const adv = String(advertiserId || '').trim();
  const aid = String(adId || '').trim();
  if (!adv || !aid) throw badRequest('advertiserId e adId são obrigatórios');
  const p = patch || {};
  const args = { advertiser_id: adv, ad_id: aid };
  if (p.name != null && String(p.name).trim()) args.ad_name = String(p.name).trim().slice(0, 512);
  if (p.text != null) args.ad_text = String(p.text).slice(0, 100);
  if (p.linkUrl != null && /^https?:\/\//.test(String(p.linkUrl))) args.landing_page_url = String(p.linkUrl).slice(0, 500);
  if (p.callToAction != null && /^[A-Z_]{3,30}$/.test(String(p.callToAction))) args.call_to_action = String(p.callToAction);
  if (args.ad_name === undefined && args.ad_text === undefined && args.landing_page_url === undefined && args.call_to_action === undefined) {
    throw badRequest('Nada para atualizar no anúncio');
  }
  const r = await pipeboard.callTool('update_tiktok_ad', args);
  cacheBust('tree:');
  return r;
}

// ══════════════════════════════════════════════════════════════════���������═════════
// F1 — Criação de campanha completa (campaign → adgroup → upload → ad).
// A Zernio tinha um endpoint único /ads/create; no Pipeboard é uma COMPOSIÇÃO
// de 4-6 tools. Toda escrita passa por aqui — rotas nunca chamam callTool.
// Erros carregam e.step ('regions'|'identity'|'campaign'|'adgroup'|'upload'|'ad')
// e e.createdIds (o que já existe na plataforma) p/ a rota reportar com precisão
// e nada ficar gastando: falha após criar campanha → pausamos a campanha órfã.
// ════════════════════════════════════════════════════════════════════════════

// goal do frontend → objetivo TikTok + optimization_goal do adgroup.
// Enum de objetivos confirmado ao vivo no dump do tools/list (2026-05-07).
const GOAL_MAP = {
  conversions: { objective: 'WEB_CONVERSIONS', optimizationGoal: 'CONVERT' },
};

// Busca profunda de um campo em respostas do MCP (create retorna campaign_id
// em posições que variam: raiz, .data, .campaign…). Determinístico e raso (3 níveis).
function deepPluck(obj, key, depth) {
  if (!obj || typeof obj !== 'object' || (depth || 0) > 3) return undefined;
  if (obj[key] !== undefined && obj[key] !== null && obj[key] !== '') return obj[key];
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v && typeof v === 'object') {
      const found = deepPluck(v, key, (depth || 0) + 1);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

// Primeiro array encontrado na resposta (regions/identities vêm embrulhados
// com nomes variados: .regions, .identity_list, .list, .data.list…).
function firstArray(obj, keys) {
  if (Array.isArray(obj)) return obj;
  function findArray(value, key, depth) {
    if (!value || typeof value !== 'object' || depth > 6) return null;
    if (Array.isArray(value[key]) && value[key].length) return value[key];
    // Algumas tools repetem o mesmo envelope (ex. interest_categories.
    // interest_categories). Não pare no primeiro objeto com o nome pedido:
    // continue procurando até encontrar o array real.
    for (const child of Object.values(value)) {
      if (!child || typeof child !== 'object') continue;
      const found = findArray(child, key, depth + 1);
      if (found) return found;
    }
    return null;
  }
  for (const k of keys) {
    const found = findArray(obj, k, 0);
    if (found) return found;
  }
  return [];
}

function stepError(step, msg, createdIds, status) {
  const e = badRequest(msg, status || 502);
  e.step = step;
  if (createdIds) e.createdIds = createdIds;
  return e;
}

function clampTikTokBudget(value, warnings, label) {
  const amount = Number(value);
  if (!(amount > 0)) return amount;
  if (amount >= TIKTOK_MIN_BUDGET) return amount;
  if (Array.isArray(warnings)) {
    warnings.push((label || 'Orçamento') + ' ajustado de ' + amount + ' para ' + TIKTOK_MIN_BUDGET + ' (mínimo aceito pelo TikTok)');
  }
  return TIKTOK_MIN_BUDGET;
}

function isTransientTikTokWriteError(err) {
  const message = String(err && err.message || '');
  return Number(err && err.status) === 429
    || /could not acquire ip/i.test(message)
    || (/40002/.test(message) && /try again later|temporar/i.test(message));
}

async function callTikTokWriteWithRetry(toolName, args, onRetry) {
  const delays = [600, 1800, 3600];
  let lastError;
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    try {
      return await pipeboard.callTool(toolName, args);
    } catch (err) {
      lastError = err;
      if (!isTransientTikTokWriteError(err) || attempt >= delays.length) throw err;
      if (attempt === 0 && typeof onRetry === 'function') onRetry();
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }
  throw lastError;
}

async function catalogCampaignNames(advertiserId) {
  try {
    const campaigns = await getCampaigns(advertiserId, { pageSize: 1000 });
    return campaigns.map((campaign) => String(campaign && campaign.name || '').trim()).filter(Boolean);
  } catch (_) {
    // A listagem é uma proteção antecipada. Se ela estiver indisponível, a
    // escrita continua protegida pelo tratamento específico de nome duplicado
    // devolvido pelo próprio TikTok.
    return [];
  }
}

async function createUniqueCatalogCampaignEntity(advertiserId, requestedName, baseArgs, options) {
  const opts = options || {};
  const warnings = Array.isArray(opts.warnings) ? opts.warnings : [];
  const requested = String(requestedName || '').trim().slice(0, MAX_CAMPAIGN_NAME_LENGTH);
  const existing = Array.isArray(opts.existingNames)
    ? opts.existingNames.slice()
    : await catalogCampaignNames(advertiserId);
  const initial = String(opts.initialName || '').trim().slice(0, MAX_CAMPAIGN_NAME_LENGTH);
  let effective = initial && !existing.some((name) => normalizedCampaignName(name) === normalizedCampaignName(initial))
    ? initial
    : nextAvailableCampaignName(requested, existing, MAX_CAMPAIGN_NAME_LENGTH);
  if (effective !== requested && opts.announceInitialRename !== false) {
    warnings.push('Nome "' + requested + '" já existia — campanha renomeada automaticamente para "' + effective + '"');
  }
  if (typeof opts.onName === 'function') await opts.onName(effective);

  let lastError;
  for (let attempt = 0; attempt < MAX_NAME_ATTEMPTS; attempt += 1) {
    try {
      const output = await callTikTokWriteWithRetry(
        'create_tiktok_campaign',
        { ...baseArgs, campaign_name: effective },
        opts.onTransientRetry,
      );
      return { output, name: effective };
    } catch (err) {
      lastError = err;
      if (!isCampaignNameConflict(err)) throw err;
      existing.push(effective);
      const next = nextAvailableCampaignName(requested, existing, MAX_CAMPAIGN_NAME_LENGTH);
      warnings.push('O nome "' + effective + '" foi ocupado durante a criação — nova tentativa automática como "' + next + '"');
      effective = next;
      if (typeof opts.onName === 'function') await opts.onName(effective);
    }
  }
  if (lastError) {
    lastError.code = 'CATALOG_CAMPAIGN_NAME_EXHAUSTED';
    lastError.userMessage = 'Não foi possível reservar um nome de campanha disponível.';
    lastError.suggestedAction = 'Tente novamente; a dashboard consultará os nomes atuais antes de criar.';
    lastError.retryable = true;
  }
  throw lastError || stepError('campaign', 'Não foi possível reservar um nome de campanha disponível');
}

function normalizedCampaignName(value) {
  return String(value || '').trim().normalize('NFKC').toLocaleLowerCase('pt-BR');
}

function assertAdvertiserCanCreateCatalogCampaign(info) {
  const status = String(info && info.healthStatus || 'unknown');
  if (!['banned', 'limited', 'in_review'].includes(status)) return;
  const err = stepError(
    'campaign',
    status === 'banned'
      ? 'A conta de anúncio está suspensa no TikTok.'
      : status === 'in_review'
        ? 'A conta de anúncio ainda está em análise no TikTok.'
        : 'A conta de anúncio está limitada no TikTok.',
    null,
    409,
  );
  err.code = status === 'banned'
    ? 'CATALOG_ACCOUNT_SUSPENDED'
    : status === 'in_review' ? 'CATALOG_ACCOUNT_IN_REVIEW' : 'CATALOG_ACCOUNT_LIMITED';
  err.userMessage = err.message;
  err.retryable = false;
  err.suggestedAction = 'Escolha uma conta aprovada ou resolva o estado da conta antes de criar. Nenhum recurso foi enviado.';
  throw err;
}

// ISO country codes → location_ids do TikTok. O TikTok NÃO aceita "PT"/"BR"
// direto — exige os IDs de get_tiktok_targeting_regions. Cache 24h por
// advertiser+objetivo (a lista de países não muda no dia a dia).
async function resolveLocationIds(advertiserId, countries, objectiveType) {
  const ck = 'regions:' + advertiserId + ':' + objectiveType;
  let regions = cacheGet(ck);
  if (!regions) {
    const out = await pipeboard.callTool('get_tiktok_targeting_regions', {
      advertiser_id: advertiserId, objective_type: objectiveType, level_range: 'TO_COUNTRY',
    });
    regions = firstArray(out, ['regions', 'region_info', 'list', 'data']);
    if (!regions.length) throw stepError('regions', 'TikTok não retornou regiões de segmentação para este advertiser/objetivo');
    cacheSet(ck, regions, 24 * 60 * 60 * 1000);
  }
  const wanted = new Set((countries || []).map((c) => String(c).toUpperCase()));
  const ids = [];
  const found = new Set();
  for (const r of regions) {
    const code = String(r.region_code || r.country_code || r.code || '').toUpperCase();
    const id = String(r.location_id || r.region_id || r.id || '');
    if (id && wanted.has(code) && !found.has(code)) { ids.push(id); found.add(code); }
  }
  const missing = [...wanted].filter((c) => !found.has(c));
  if (!ids.length) throw stepError('regions', 'Nenhum dos países pedidos (' + [...wanted].join(', ') + ') está disponível como região de segmentação neste advertiser', null, 400);
  return { locationIds: ids, missingCountries: missing };
}

// Categorias de interesse p/ o direcionamento na criação. Leitura pura
// (get_tiktok_interest_categories) com cache 24h por advertiser — a lista é
// grande e estável. Devolve [{id,name}] achatado para o seletor da dashboard.
async function listInterestCategories(advertiserId) {
  const adv = String(advertiserId || '').trim();
  if (!adv) throw badRequest('advertiserId é obrigatório');
  const ck = 'interests:' + adv;
  let out = cacheGet(ck);
  if (!out) {
    const raw = await pipeboard.callTool('get_tiktok_interest_categories', { advertiser_id: adv });
    const list = firstArray(raw, ['interest_categories', 'categories', 'list', 'data']);
    out = list.map((c) => ({
      id: String(c.interest_category_id || c.id || c.value || ''),
      name: String(c.name || c.interest_category_name || c.label || ''),
    })).filter((c) => c.id && c.name);
    cacheSet(ck, out, 24 * 60 * 60 * 1000);
  }
  return out;
}

// Pixels reais do advertiser. O TikTok usa dois identificadores diferentes:
// pixel_code (alfanumérico, salvo na aba Conversões) e pixel_id (numérico,
// exigido na criação do ad group). Esta leitura é a ponte segura entre ambos.
async function listTikTokPixels(advertiserId) {
  const adv = String(advertiserId || '').trim();
  if (!adv) throw badRequest('advertiserId é obrigatório');
  const ck = 'pixels:' + adv;
  let out = cacheGet(ck);
  if (!out) {
    const raw = await pipeboard.callTool('list_tiktok_pixels', { advertiser_id: adv });
    const list = firstArray(raw, ['pixels', 'pixel_list', 'list', 'data']);
    out = list.map((pixel) => ({
      id: String(pixel.pixel_id || pixel.id || '').trim(),
      code: String(pixel.pixel_code || pixel.code || '').trim(),
      name: String(pixel.pixel_name || pixel.name || pixel.pixel_code || 'Pixel TikTok').trim(),
      status: String(pixel.status || pixel.pixel_status || 'UNKNOWN').trim(),
      purchaseCount: Math.max(0, Number(pixel.purchase_count || pixel.complete_payment_count || pixel.purchases_30d) || 0),
    })).filter((pixel) => /^\d{5,30}$/.test(pixel.id));
    cacheSet(ck, out, 5 * 60 * 1000);
  }
  return out;
}

// Identidade do anúncio — a doc do create_tiktok_ad PROÍBE chutar: tem de vir
// de get_tiktok_identities. Para criação automática regular/Smart+/catálogo,
// só BC_AUTH_TT é elegível: o schema atual do conector marca CUSTOMIZED_USER
// como rejeitável. TT_USER/AUTH_CODE são Spark-only (exigem post). Falhar
// fechado é melhor que criar uma estrutura pausada que jamais passa da revisão.
function identityIdOf(row) {
  return String((row && (row.identity_id || row.id)) || '').trim();
}

function identityBcIdOf(row) {
  return String((row && (
    row.identity_authorized_bc_id || row.identity_bc_id || row.bc_id || deepPluck(row, 'bc_id')
  )) || '').trim();
}

function darkPostDisabled(row) {
  const value = String((row && (row.dark_post_status || row.darkPostStatus)) || '').trim().toUpperCase();
  return ['OFF', 'DISABLE', 'DISABLED', 'FALSE', '0'].includes(value);
}

function falseLike(value) {
  if (value === false || value === 0) return true;
  return ['FALSE', '0', 'NO', 'OFF', 'DISABLE', 'DISABLED'].includes(String(value == null ? '' : value).trim().toUpperCase());
}

function identityUnavailable(row) {
  const status = textField(
    row && row.identity_status,
    row && row.authorization_status,
    row && row.status,
  ).toUpperCase();
  return Boolean(status && /REVOK|UNAVAIL|EXPIRE|DISABLE|INVALID|DENIED|NO_ACCESS|UNAUTHORIZED/.test(status));
}

function usableBcIdentity(row) {
  return String((row && row.identity_type) || '').toUpperCase() === 'BC_AUTH_TT'
    && Boolean(identityIdOf(row))
    && Boolean(identityBcIdOf(row))
    && !darkPostDisabled(row)
    && !identityUnavailable(row)
    && !falseLike(row && (row.can_push_video ?? row.canPushVideo));
}

function bcIdentityPayload(row) {
  const displayName = textField(row && row.display_name, row && row.identity_name, row && row.nickname);
  const username = textField(
    row && row.username,
    row && row.unique_id,
    row && row.user_name,
    row && row.tiktok_username,
  );
  const avatarUrl = textField(
    row && row.profile_image,
    row && row.avatar_icon_web_uri,
    row && row.avatar_url,
    row && row.image_url,
  );
  return {
    identityId: identityIdOf(row),
    identityType: 'BC_AUTH_TT',
    identityBcId: identityBcIdOf(row),
    darkPost: true,
    displayName: displayName || undefined,
    username: username || undefined,
    avatarUrl: avatarUrl || undefined,
    available: true,
    canPushVideo: true,
  };
}

async function listAdIdentityCandidates(advertiserId, requiredBcId) {
  const out = await pipeboard.callTool('get_tiktok_identities', { advertiser_id: advertiserId });
  const list = firstArray(out, ['identities', 'identity_list', 'list', 'data']);
  const wantedBcId = String(requiredBcId || '').trim();
  const eligible = list.filter((row) => usableBcIdentity(row)
    && (!wantedBcId || identityBcIdOf(row) === wantedBcId));
  // Identidades sem nome continuam válidas no contrato, mas o TikTok pode
  // mantê-las na listagem depois que o acesso à conta foi revogado. Uma
  // identidade com perfil resolvido é tentada primeiro.
  eligible.sort((a, b) => {
    const namedA = Boolean(textField(a.display_name, a.identity_name, a.username));
    const namedB = Boolean(textField(b.display_name, b.identity_name, b.username));
    return Number(namedB) - Number(namedA);
  });
  return eligible.map(bcIdentityPayload);
}

// Lista pública do seletor de catálogo: somente perfis resolvidos do mesmo BC.
// Identidades sem nome continuam disponíveis como fallback automático, mas não
// viram opções opacas na interface.
async function listCatalogAdIdentities(advertiserId, requiredBcId) {
  const adv = String(advertiserId || '').trim();
  const bcId = String(requiredBcId || '').trim();
  if (!adv) throw badRequest('advertiserId é obrigatório');
  if (!bcId) throw badRequest('Business Center do catálogo é obrigatório');
  const candidates = await listAdIdentityCandidates(adv, bcId);
  return candidates.filter((identity) => Boolean(identity.displayName || identity.username));
}

async function pickAdIdentity(advertiserId, requiredBcId) {
  const candidates = await listAdIdentityCandidates(advertiserId, requiredBcId);
  if (candidates.length) return candidates[0];
  const wantedBcId = String(requiredBcId || '').trim();
  throw stepError(
    'identity',
    wantedBcId
      ? 'Nenhuma identidade BC_AUTH_TT elegível pertence ao mesmo Business Center ' + wantedBcId + ' do catálogo. Autorize a identidade nesse BC com dark post habilitado.'
      : 'Nenhuma identidade BC_AUTH_TT elegível foi encontrada para criar anúncio. Conecte uma identidade autorizada ao Business Center com dark post habilitado; CUSTOMIZED_USER, TT_USER e AUTH_CODE não são escolhidos automaticamente.',
    null,
    409,
  );
}

function catalogMusicRows(out) {
  return firstArray(out, ['music', 'tracks', 'music_list', 'list', 'data']);
}

function isUserMusic(row) {
  const values = [];
  if (row && row.source) values.push(row.source);
  if (row && Array.isArray(row.sources)) values.push(...row.sources);
  return values.map((value) => String(value || '').toUpperCase()).includes('USER');
}

// CATALOG_CAROUSEL exige uma faixa enviada pelo próprio anunciante. A busca é
// feita antes da primeira escrita para nunca deixar campanha/conjunto órfãos.
// Quando há uma única opção, a dashboard a escolhe automaticamente.
async function pickCatalogCarouselMusic(advertiserId, requestedMusicId) {
  const adv = String(advertiserId || '').trim();
  const requested = String(requestedMusicId || '').trim();
  const args = requested
    ? { advertiser_id: adv, search_type: 'SEARCH_BY_MUSIC_ID', filtering: { music_ids: [requested] }, page: 1, page_size: 100 }
    : { advertiser_id: adv, music_scene: 'CATALOG_CAROUSEL', search_type: 'SEARCH_BY_SOURCE', filtering: { sources: ['USER'] }, page: 1, page_size: 100 };
  const out = await pipeboard.callTool('list_tiktok_commercial_music', args);
  const rows = catalogMusicRows(out);
  const eligible = rows.filter((row) => String(row && (row.music_id || row.id) || '').trim() && isUserMusic(row));
  const selected = requested
    ? eligible.find((row) => String(row.music_id || row.id) === requested)
    : eligible[0];
  if (!selected) {
    const err = stepError(
      'creative',
      requested
        ? 'A música selecionada não está disponível como faixa própria para Catalog Carousel.'
        : 'Esta conta ainda não tem uma música própria elegível para Catalog Carousel.',
      null,
      422,
    );
    err.code = 'CATALOG_CAROUSEL_MUSIC_REQUIRED';
    err.userMessage = err.message;
    err.retryable = false;
    err.suggestedAction = 'No TikTok Ads Manager, envie uma faixa própria em Video Editor → Áudio → Uploads. Depois volte: a dashboard selecionará a música automaticamente.';
    throw err;
  }
  return {
    musicId: String(selected.music_id || selected.id),
    name: String(selected.name || selected.music_name || 'Música própria'),
  };
}

// Upload por URL + polling canônico: get_tiktok_video_info a cada ~5s até
// displayable. O TikTok deduplica por md5 — re-upload do mesmo arquivo devolve
// o mesmo video_id (idempotência de graça no retry).
async function uploadVideoAndWait(advertiserId, videoUrl, createdIds) {
  let up;
  try {
    up = await pipeboard.callTool('upload_tiktok_video', {
      advertiser_id: advertiserId, video_url: videoUrl, wait_for_processing_seconds: 60,
    });
  } catch (err) {
    throw assetStepError(err, 'upload', createdIds);
  }
  const videoId = String(deepPluck(up, 'video_id') || '');
  if (!videoId) throw stepError('upload', 'Upload do vídeo não retornou video_id', createdIds);
  // Preserve o ID assim que o TikTok o devolver. Se o processamento ou a capa
  // atrasarem, o worker retoma este mesmo vídeo em vez de enviá-lo novamente.
  if (createdIds && typeof createdIds === 'object') createdIds.videoId = videoId;
  if (deepPluck(up, 'displayable') === true) return videoId;
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    let info;
    try {
      info = await pipeboard.callTool('get_tiktok_video_info', { advertiser_id: advertiserId, video_ids: [videoId] });
    } catch (err) {
      throw assetStepError(err, 'upload', createdIds);
    }
    const vids = firstArray(info, ['videos', 'video_list', 'list', 'data']);
    const asset = inspectUploadedVideoAsset(vids, videoId);
    if (asset.displayable) return videoId;
  }
  throw stepError('upload', 'Vídeo enviado (video_id ' + videoId + ') mas não ficou processado/displayable a tempo — tente de novo em instantes (o re-upload reaproveita o mesmo vídeo)', createdIds);
}

// Fronteira pública usada pelo sincronizador Google Drive/Dropbox. Faz apenas
// upload do asset e aguarda o processamento do TikTok; não cria campanha nem
// anúncio, portanto o arquivo aparece como criativo reutilizável/rascunho.
async function uploadVideoAsset(advertiserId, videoUrl) {
  const createdIds = {};
  const videoId = await uploadVideoAndWait(String(advertiserId || ''), String(videoUrl || ''), createdIds);
  return { videoId, displayable: true };
}

function assetStepError(value, step, createdIds) {
  const err = value instanceof Error ? value : new Error(String(value || 'Falha no asset do TikTok'));
  if (!err.step) err.step = step;
  if (createdIds && typeof createdIds === 'object') err.createdIds = createdIds;
  return err;
}

function safeImageUrl(value, options) {
  const opts = options || {};
  let raw = String(value || '').trim();
  if (!raw || /[\u0000-\u0020\u007f]/.test(raw)) return '';
  if (raw.startsWith('//')) raw = 'http:' + raw;
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    const hostname = parsed.hostname.toLowerCase();
    const ipHost = hostname.replace(/^\[|\]$/g, '');
    if (hostname.endsWith('.') || parsed.username || parsed.password || parsed.port || net.isIP(ipHost)
      || !isPublicDownloadHostname(hostname)) return '';
    const trustedTikTokCdn = hostname === 'tiktokcdn.com' || hostname.endsWith('.tiktokcdn.com');
    if (opts.tikTokGenerated && !trustedTikTokCdn) return '';
    if (parsed.protocol === 'http:' && !(opts.tikTokGenerated && trustedTikTokCdn)) return '';
    if (parsed.protocol === 'http:') parsed.protocol = 'https:';
    parsed.hash = '';
    return parsed.toString();
  } catch (_) {
    return '';
  }
}

// O endpoint real do TikTok devolve algumas capas automáticas como
// http://*.tiktokcdn.com, embora o mesmo recurso aceite TLS. O upload de imagem
// exige HTTPS. Como esta URL vem da plataforma, aceitamos somente o domínio
// observado do TikTok — inclusive quando o host aparente resolve para IP
// privado por serviços como nip.io.
function normalizeTikTokCoverUrl(value) {
  return safeImageUrl(value, { tikTokGenerated: true });
}

function normalizePublicImageUrl(value) {
  return safeImageUrl(value);
}

function inspectUploadedVideoAsset(rows, videoId) {
  const list = Array.isArray(rows) ? rows : [];
  const wanted = String(videoId || '');
  const matching = list.find((item) => (
    String(item && (item.video_id || item.id) || '') === wanted
  ));
  // Alguns envelopes do conector removem o ID quando há uma única resposta.
  // Nunca use uma linha identificada de outro vídeo como fallback.
  const onlyIdless = list.length === 1
    && !String(list[0] && (list[0].video_id || list[0].id) || '')
    ? list[0]
    : null;
  const row = matching || onlyIdless;
  if (!row) return { row: null, displayable: false, coverUrl: '' };
  return {
    row,
    // O contrato de get_tiktok_video_info define displayable=true como o
    // sinal canônico. Status textual nunca pode sobrepor false.
    displayable: row.displayable === true,
    coverUrl: normalizeTikTokCoverUrl(
      String(row.video_cover_url || row.cover_url || row.thumbnail_url || '').trim(),
    ),
  };
}

async function uploadImage(advertiserId, imageUrl, createdIds, options) {
  const automatic = Boolean(options && options.tikTokGenerated);
  const url = automatic ? normalizeTikTokCoverUrl(imageUrl) : normalizePublicImageUrl(imageUrl);
  if (!url) {
    throw stepError(
      'cover',
      automatic
        ? 'O TikTok não devolveu uma URL pública válida no próprio CDN para a capa automática'
        : 'A capa do vídeo precisa ser uma URL HTTPS pública',
      createdIds,
      automatic ? 502 : 400,
    );
  }
  let out;
  try {
    out = await pipeboard.callTool('upload_tiktok_image', {
      advertiser_id: advertiserId,
      image_url: url,
    });
  } catch (err) {
    throw assetStepError(err, 'cover', createdIds);
  }
  const imageId = String(deepPluck(out, 'image_id') || deepPluck(out, 'web_uri') || '');
  if (!imageId) throw stepError('cover', 'Upload da capa não retornou image_id', createdIds);
  return imageId;
}

async function getUploadedVideoAsset(advertiserId, videoId, createdIds) {
  let videoReady = false;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let out;
    try {
      out = await pipeboard.callTool('get_tiktok_video_info', {
        advertiser_id: advertiserId,
        video_ids: [String(videoId)],
        page: 1,
        page_size: 10,
      });
    } catch (err) {
      throw assetStepError(err, 'cover', createdIds);
    }
    const rows = firstArray(out, ['videos', 'video_list', 'list', 'data']);
    const asset = inspectUploadedVideoAsset(rows, videoId);
    videoReady = videoReady || asset.displayable;
    if (asset.row && asset.displayable && asset.coverUrl) {
      return {
        videoId: String(asset.row.video_id || asset.row.id || videoId),
        coverUrl: asset.coverUrl,
        displayable: true,
      };
    }
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  if (!videoReady) {
    throw stepError('upload', 'O vídeo já foi enviado, mas o TikTok ainda está processando o arquivo. A dashboard tentará novamente com o mesmo vídeo.', createdIds, 502);
  }
  throw stepError('cover', 'O TikTok processou o vídeo, mas ainda não devolveu uma capa automática pública. A dashboard tentará novamente com o mesmo vídeo.', createdIds, 502);
}

function pixelEventRows(out, pixelId) {
  const pixels = firstArray(out, ['list', 'pixels', 'pixel_list', 'data']);
  const row = pixels.find((item) => String(item && (item.pixel_id || item.id) || '') === String(pixelId)) || pixels[0];
  return Array.isArray(row && row.statistics) ? row.statistics : [];
}

function pixelEventCount(row) {
  const value = row || {};
  // total_count deveria ser a soma, mas alguns readbacks retornam zero nele e
  // o valor correto em server/browser. O maior contador evita falso negativo
  // sem somar o mesmo evento duas vezes.
  return Math.max(
    Number(value.total_count) || 0,
    Number(value.server_event_total_count) || 0,
    Number(value.browser_event_total_count) || 0,
  );
}

function receivedPixelEvents(out, pixelId) {
  const received = new Set();
  for (const row of pixelEventRows(out, pixelId)) {
    if (pixelEventCount(row) <= 0) continue;
    const eventName = String(row && (row.pixel_event_type || row.event_type || row.event) || '').trim().toUpperCase();
    if (!eventName) continue;
    if (['PURCHASE', 'COMPLETE_PAYMENT', 'COMPLETEPAYMENT'].includes(eventName)) {
      // O endpoint de criação aceita enums do Ads Manager, não o nome CAPI.
      received.add('SHOPPING');
      received.add('ON_WEB_ORDER');
    } else {
      received.add(eventName);
    }
  }
  return received;
}

async function inspectCatalogPurchaseEvent(advertiserId, pixelId, requestedEvent) {
  const adv = String(advertiserId || '').trim();
  const pixel = String(pixelId || '').trim();
  const requestedRaw = String(requestedEvent || '').trim().toUpperCase();
  const requested = ['SHOPPING', 'ON_WEB_ORDER'].includes(requestedRaw) ? requestedRaw : '';
  const end = new Date();
  const endDate = end.toISOString().slice(0, 10);
  const recentStart = new Date(end.getTime() - (6 * 24 * 60 * 60 * 1000)).toISOString().slice(0, 10);
  const recentOut = await pipeboard.callTool('get_tiktok_pixel_event_stats', {
    advertiser_id: adv,
    pixel_ids: [pixel],
    start_date: recentStart,
    end_date: endDate,
  });
  const recent = receivedPixelEvents(recentOut, pixel);
  const recentActivity = recent.size > 0;
  const recentPurchase = [requested, 'SHOPPING', 'ON_WEB_ORDER'].find((eventName) => eventName && recent.has(eventName));
  if (recentActivity && recentPurchase) {
    return { ready: true, event: recentPurchase, recentActivity: true, purchaseWindowDays: 7 };
  }
  if (!recentActivity) {
    return { ready: false, event: null, recentActivity: false, purchaseWindowDays: 0, reason: 'pixel_inactive' };
  }

  // O TikTok considera o Pixel ativo quando recebe qualquer evento recente.
  // Para Product Sales ainda precisamos provar que Compra existe no histórico;
  // ampliamos apenas essa descoberta para 30 dias, sem fabricar conversão.
  const historyStart = new Date(end.getTime() - (29 * 24 * 60 * 60 * 1000)).toISOString().slice(0, 10);
  const historyOut = await pipeboard.callTool('get_tiktok_pixel_event_stats', {
    advertiser_id: adv,
    pixel_ids: [pixel],
    start_date: historyStart,
    end_date: endDate,
  });
  const history = receivedPixelEvents(historyOut, pixel);
  const historicalPurchase = [requested, 'SHOPPING', 'ON_WEB_ORDER'].find((eventName) => eventName && history.has(eventName));
  if (historicalPurchase) {
    return { ready: true, event: historicalPurchase, recentActivity: true, purchaseWindowDays: 30 };
  }
  return { ready: false, event: null, recentActivity: true, purchaseWindowDays: 30, reason: 'purchase_missing' };
}

// A Events API recebe `Purchase`, mas o enum de otimização exposto pelo Ads
// Manager varia por conta. Na conta real auditada ele aparece como SHOPPING.
// O Pixel precisa ter atividade real nos últimos sete dias. O enum de Compra
// pode vir do histórico real de 30 dias, porque o TikTok mantém o evento
// configurado mesmo quando a última venda ficou fora da janela curta.
async function resolveCatalogPurchaseEvent(advertiserId, pixelId, requestedEvent) {
  let inspection;
  try {
    inspection = await inspectCatalogPurchaseEvent(advertiserId, pixelId, requestedEvent);
  } catch (err) {
    const status = Number(err && err.status) || 0;
    if (status === 429 || status >= 500 || err && err.retryable === true) {
      err.code = 'CATALOG_PIXEL_STATUS_UNAVAILABLE';
      err.step = 'pixel';
      err.retryable = true;
      err.userMessage = 'O TikTok ainda não respondeu à verificação do Pixel.';
      err.suggestedAction = 'A solicitação ficará salva e a dashboard consultará o mesmo Pixel novamente em segundo plano.';
    }
    throw err;
  }
  if (inspection.ready && inspection.event) return inspection.event;
  const inactive = inspection.reason === 'pixel_inactive';
  const err = stepError(
    'pixel',
    inactive
      ? 'O Pixel selecionado ainda não recebeu atividade nos últimos 7 dias.'
      : 'O Pixel está ativo, mas o TikTok ainda não reconheceu uma Compra real para otimização.',
    null,
    422,
  );
  err.code = 'CATALOG_PURCHASE_EVENT_NOT_READY';
  err.userMessage = err.message;
  err.retryable = true;
  err.suggestedAction = inactive
    ? 'Mantenha o script da dashboard instalado. A criação será retomada automaticamente assim que o TikTok registrar atividade real do Pixel.'
    : 'A criação ficará aguardando e será retomada automaticamente assim que uma Compra real chegar pelo script da dashboard.';
  throw err;
}

// "YYYY-MM-DD HH:MM:SS" no fuso do ADVERTISER (exigência do schedule_start_time).
function advertiserLocalTime(timezone, date) {
  // O schema atual exige pelo menos 30 minutos de antecedência. Usamos 45
  // para absorver latência do upload, fila e diferença de relógio do TikTok.
  const d = date || new Date(Date.now() + 45 * 60 * 1000);
  try {
    const s = new Intl.DateTimeFormat('sv-SE', {
      timeZone: timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).format(d);
    return s.replace('T', ' ');
  } catch (_) {
    return new Date(d).toISOString().slice(0, 19).replace('T', ' ');
  }
}

// ageMin/ageMax → buckets do TikTok.
const AGE_BUCKETS = [
  { id: 'AGE_13_17', min: 13, max: 17 }, { id: 'AGE_18_24', min: 18, max: 24 },
  { id: 'AGE_25_34', min: 25, max: 34 }, { id: 'AGE_35_44', min: 35, max: 44 },
  { id: 'AGE_45_54', min: 45, max: 54 }, { id: 'AGE_55_100', min: 55, max: 100 },
];
function ageGroupsFor(ageMin, ageMax) {
  const lo = Number(ageMin) || 13; const hi = Number(ageMax) || 100;
  const out = AGE_BUCKETS.filter((b) => b.max >= lo && b.min <= hi).map((b) => b.id);
  return out.length && out.length < AGE_BUCKETS.length ? out : undefined; // todos = não segmenta
}

// Cinto extra da retomada (F2): se o crash aconteceu APÓS criar a campanha mas
// ANTES de gravar o progresso, o resume não sabe dela. Antes de recriar, lista
// as campanhas e casa o NOME exato — se já existe, reaproveita o id em vez de
// duplicar. Falha da listagem NÃO bloqueia (é cinto, não trava).
async function findCampaignIdByName(advertiserId, name) {
  try {
    const out = await pipeboard.callTool('get_tiktok_campaigns', {
      advertiser_id: advertiserId, page: 1, page_size: 1000,
    });
    const list = firstArray(out, ['campaigns', 'campaign_list', 'list', 'data']);
    const hit = list.find((c) => String(c.campaign_name || c.name || '') === String(name));
    return hit ? String(hit.campaign_id || hit.id || '') || null : null;
  } catch (_) { return null; }
}

// Orquestração completa. spec (já validado pela rota):
//   { name, goal, videoUrl, budgetAmount, budgetType, endDate?, body?, linkUrl?,
//     callToAction?, countries?, languages?, ageMin?, ageMax?,
//     promotedObject? { pixelId, customEventType }, status? 'paused'|'active' }
// SEMPRE cria o anúncio PAUSED e só liga no fim se spec.status==='active' —
// nada entra em delivery no meio da composição.
//
// opts (F2 — retomada idempotente p/ a fila at-least-once do bulk):
//   resume      — { campaignId?, adGroupId?, videoId?, adId? } já criados numa
//                 tentativa anterior; cada passo com ID presente é PULADO.
//   onProgress  — async (createdIds) => {}: chamado após CADA passo criar algo,
//                 ANTES do próximo. O caller persiste (Neon) p/ o retry retomar.
//   dedupeByName — true: antes de criar a campanha (sem resume dela), procura
//                 nome exato na plataforma e reaproveita (janela crash-antes-
//                 de-gravar). Só o bulk usa; a rota interativa não precisa.
// ── Plano de orçamento + lance (ABO/CBO/bid) ────────────────────────────────
// Pura: mapeia a escolha do gestor para os campos do TikTok, tanto no nível
// campanha (CBO) quanto ad group (ABO, padrão), mais a estratégia de lance.
//   budgetOptimization: 'campaign' (CBO) | 'adgroup' (ABO, padrão)
//   bidStrategy:        'lowest_cost' (máx. entrega, padrão) | 'cost_cap' (teto)
//   bidAmount:          número > 0 quando cost_cap (custo-alvo por resultado)
//   deliveryMode:       'standard' (padrão) | 'accelerated'
// CBO ⇒ orçamento vai na CAMPANHA (budget_optimize_on) e o ad group fica
// INFINITE; ABO ⇒ orçamento no ad group (comportamento histórico).
function resolveBudgetPlan(spec) {
  const s = spec || {};
  const cbo = s.budgetOptimization === 'campaign';
  const lifetime = s.budgetType === 'lifetime';
  const budgetMode = lifetime ? 'BUDGET_MODE_TOTAL' : 'BUDGET_MODE_DAY';
  const amount = Number(s.budgetAmount);
  const campaign = {};
  const adgroup = {};
  if (cbo) {
    campaign.budget_mode = budgetMode;
    campaign.budget = amount;
    campaign.budget_optimize_on = true;
    adgroup.budget_mode = 'BUDGET_MODE_INFINITE'; // CBO gerencia no nível campanha
  } else {
    adgroup.budget_mode = budgetMode;
    adgroup.budget = amount;
  }
  const bidStrategy = s.bidStrategy === 'cost_cap' ? 'cost_cap' : 'lowest_cost';
  const bidAmount = Number(s.bidAmount);
  if (bidStrategy === 'cost_cap' && !(bidAmount > 0)) {
    throw badRequest('Custo-alvo exige um valor de lance maior que zero');
  }
  const requestedDeliveryMode = String(s.deliveryMode || 'standard').trim().toLowerCase();
  if (!['standard', 'accelerated'].includes(requestedDeliveryMode)) {
    throw badRequest('Modo de entrega inválido — use standard ou accelerated');
  }
  if (requestedDeliveryMode === 'accelerated' && cbo) {
    throw badRequest('Entrega acelerada só está disponível com orçamento no conjunto (ABO)');
  }
  if (requestedDeliveryMode === 'accelerated' && bidStrategy !== 'cost_cap') {
    throw badRequest('Entrega acelerada exige estratégia cost_cap com custo-alvo');
  }
  const bid = { bid_type: 'BID_TYPE_NO_BID' };
  if (bidStrategy === 'cost_cap') {
    bid.bid_type = 'BID_TYPE_CUSTOM';
    // CONVERT + OCPM usa conversion_bid_price; demais objetivos usam bid_price.
    const conversionOcpm = (String(s.optimizationGoal || '').trim().toUpperCase() === 'CONVERT'
      && String(s.billingEvent || '').trim().toUpperCase() === 'OCPM')
      || s.goal === 'conversions' || s.goal === 'lead_generation';
    if (conversionOcpm) bid.conversion_bid_price = bidAmount;
    else bid.bid_price = bidAmount;
  }
  return {
    cbo, campaign, adgroup, bid,
    bidStrategy,
    bidAmount: bidStrategy === 'cost_cap' ? bidAmount : undefined,
    deliveryMode: requestedDeliveryMode,
    delivery: { delivery_mode: requestedDeliveryMode === 'accelerated' ? 'ACCELERATED' : 'STANDARD' },
  };
}

async function createFullAd(advertiserId, spec, opts) {
  const adv = String(advertiserId || '').trim();
  if (!adv) throw badRequest('advertiserId é obrigatório');
  const s = spec || {};
  const o = opts || {};
  const resume = (o.resume && typeof o.resume === 'object') ? o.resume : {};
  const report = typeof o.onProgress === 'function' ? o.onProgress : async () => {};
  const goal = GOAL_MAP[s.goal];
  if (!goal) throw badRequest('Objetivo "' + s.goal + '" ainda não suportado na criação via Pipeboard' + (s.goal === 'app_promotion' ? ' (exige app_id, que a UI ainda não coleta)' : ''));
  if (!(Number(s.budgetAmount) >= TIKTOK_MIN_BUDGET)) {
    throw badRequest('O orçamento mínimo aceito pelo TikTok é ' + TIKTOK_MIN_BUDGET);
  }
  if (s.budgetType === 'lifetime') {
    const endDate = /^\d{4}-\d{2}-\d{2}/.test(String(s.endDate || '')) ? String(s.endDate).slice(0, 10) : '';
    const endAt = endDate ? new Date(endDate + 'T23:59:59Z').getTime() : NaN;
    if (!endDate || !Number.isFinite(endAt) || endAt <= Date.now() + 60 * 60 * 1000) {
      throw badRequest('Orçamento total exige uma data de término futura');
    }
  }
  const pixelGoal = s.goal === 'conversions' || s.goal === 'lead_generation';
  if (pixelGoal) {
    const pixelId = String((s.promotedObject || {}).pixelId || '').trim();
    const evt = String((s.promotedObject || {}).customEventType || '').trim();
    if (!/^\d{5,30}$/.test(pixelId)) throw badRequest('Este objetivo exige o Pixel ID numérico do TikTok');
    if (!evt) throw badRequest('Este objetivo exige o evento de otimização do Pixel (customEventType)');
  }
  const warnings = [];
  const createdIds = {};
  const plan = resolveBudgetPlan(s); // ABO/CBO + estratégia de lance

  // Item já completo numa tentativa anterior (crash entre o fim e o ack da
  // fila): devolve direto, zero chamadas de escrita.
  if (resume.adId && resume.campaignId) {
    return { campaignId: String(resume.campaignId), adGroupId: String(resume.adGroupId || ''), videoId: String(resume.videoId || ''), adId: String(resume.adId), name: s.name, warnings: ['Retomado: item já estava completo de uma tentativa anterior'], resumed: true };
  }

  // Pré-requisitos ANTES de criar qualquer coisa (falha barata, zero órfãos):
  const [info, identity, regions] = await Promise.all([
    getAdvertiserInfo(adv),
    pickAdIdentity(adv),
    resolveLocationIds(adv, (s.countries && s.countries.length ? s.countries : ['PT']), goal.objective),
  ]);
  if (regions.missingCountries.length) warnings.push('Países sem região equivalente no TikTok (ignorados): ' + regions.missingCountries.join(', '));

  // 1) Campanha — orçamento fica no ADGROUP (padrão sem CBO); campanha INFINITE.
  let campaignId = String(resume.campaignId || '');
  if (campaignId) {
    warnings.push('Retomado: campanha ' + campaignId + ' reaproveitada da tentativa anterior');
  } else {
    if (o.dedupeByName) {
      const existing = await findCampaignIdByName(adv, String(s.name).slice(0, 512));
      if (existing) { campaignId = existing; warnings.push('Campanha "' + s.name + '" já existia na plataforma (crash antes de gravar progresso?) — reaproveitada em vez de duplicar'); }
    }
    if (!campaignId) {
      const campArgs = {
        advertiser_id: adv,
        campaign_name: String(s.name).slice(0, 512),
        objective_type: goal.objective,
      };
      // CBO: orçamento + budget_optimize_on vivem na campanha (plan.campaign
      // fica vazio em ABO, então nada muda no caminho padrão).
      Object.assign(campArgs, plan.campaign);
      if (pixelGoal) {
        campArgs.pixel_id = String(s.promotedObject.pixelId);
        campArgs.optimization_event = String(s.promotedObject.customEventType).toUpperCase();
      }
      const campOut = await pipeboard.callTool('create_tiktok_campaign', campArgs);
      campaignId = String(deepPluck(campOut, 'campaign_id') || '');
      if (!campaignId) throw stepError('campaign', 'create_tiktok_campaign não retornou campaign_id');
    }
  }
  createdIds.campaignId = campaignId;
  await report({ ...createdIds });

  try {
    // 2) Ad group — targeting/orçamento/agenda.
    let adGroupId = String(resume.adGroupId || '');
    if (!adGroupId) {
      const targeting = { location_ids: regions.locationIds };
      const ages = ageGroupsFor(s.ageMin, s.ageMax);
      if (ages) targeting.age_groups = ages;
      if (Array.isArray(s.languages) && s.languages.length) targeting.languages = s.languages;
      // Gênero: 'all'/ausente = não segmenta (o TikTok assume UNLIMITED).
      if (s.gender === 'male') targeting.gender = 'GENDER_MALE';
      else if (s.gender === 'female') targeting.gender = 'GENDER_FEMALE';
      // Interesses: IDs numéricos de get_tiktok_interest_categories.
      if (Array.isArray(s.interestIds) && s.interestIds.length) targeting.interest_category_ids = s.interestIds.map(String);
      const agArgs = {
        advertiser_id: adv,
        campaign_id: campaignId,
        adgroup_name: String(s.name).slice(0, 500) + ' — grupo 1',
        optimization_goal: goal.optimizationGoal,
        schedule_start_time: advertiserLocalTime(info && info.timezone),
        targeting,
      };
      // Posicionamento: automático (default) ou lista específica (nível ad group).
      if (Array.isArray(s.placements) && s.placements.length) {
        agArgs.placement_type = 'PLACEMENT_TYPE_NORMAL';
        agArgs.placements = s.placements.map(String);
      } else {
        agArgs.placement_type = 'PLACEMENT_TYPE_AUTOMATIC';
      }
      // Orçamento: em ABO vem no ad group; em CBO fica INFINITE (gerido na
      // campanha). Lance: NO_BID (máx. entrega) ou CUSTOM (teto de custo).
      if (plan.adgroup.budget_mode) agArgs.budget_mode = plan.adgroup.budget_mode;
      if (plan.adgroup.budget != null) agArgs.budget = plan.adgroup.budget;
      Object.assign(agArgs, plan.bid);
      // Orçamento total (em qualquer nível) exige janela de término no ad group.
      if (s.budgetType === 'lifetime' && s.endDate) {
        agArgs.schedule_end_time = String(s.endDate).slice(0, 10) + ' 23:59:59';
      }
      if (pixelGoal) {
        agArgs.pixel_id = String(s.promotedObject.pixelId);
        agArgs.optimization_event = String(s.promotedObject.customEventType).toUpperCase();
      }
      if (s.goal === 'lead_generation') {
        // O Pipeboard não expõe formulários instantâneos. O caminho suportado
        // é geração de leads no site, com Pixel e placement exclusivo TikTok.
        agArgs.optimization_goal = 'CONVERT';
        agArgs.promotion_type = 'LEAD_GENERATION';
        agArgs.promotion_target_type = 'EXTERNAL_WEBSITE';
        agArgs.placement_type = 'PLACEMENT_TYPE_NORMAL';
        agArgs.placements = ['PLACEMENT_TIKTOK'];
        agArgs.billing_event = 'OCPM';
      }
      const agOut = await pipeboard.callTool('create_tiktok_adgroup', agArgs);
      adGroupId = String(deepPluck(agOut, 'adgroup_id') || '');
      if (!adGroupId) throw stepError('adgroup', 'create_tiktok_adgroup não retornou adgroup_id', createdIds);
    }
    createdIds.adGroupId = adGroupId;
    await report({ ...createdIds });

    // 3) Vídeo (URL pública do Blob → TikTok; dedupe por md5 no retry).
    const videoId = String(resume.videoId || '') || await uploadVideoAndWait(adv, String(s.videoUrl), createdIds);
    createdIds.videoId = videoId;
    await report({ ...createdIds });

    // 4) Anúncio — SEMPRE nasce PAUSED.
    const adArgs = {
      advertiser_id: adv,
      adgroup_id: adGroupId,
      ad_name: String(s.name).slice(0, 500),
      ad_format: 'SINGLE_VIDEO',
      ad_text: String(s.body || s.name).slice(0, 100),
      video_id: videoId,
      identity_id: identity.identityId,
      identity_type: identity.identityType,
      status: 'PAUSED',
    };
    if (identity.identityBcId) adArgs.identity_bc_id = identity.identityBcId;
    if (identity.darkPost) adArgs.dark_post_status = 'ON';
    if (s.linkUrl) adArgs.landing_page_url = String(s.linkUrl).slice(0, 500);
    if (s.callToAction) adArgs.call_to_action = String(s.callToAction);
    const adOut = await pipeboard.callTool('create_tiktok_ad', adArgs);
    const adId = String(deepPluck(adOut, 'ad_id') || '');
    if (!adId) throw stepError('ad', 'create_tiktok_ad não retornou ad_id', createdIds);
    createdIds.adId = adId;
    await report({ ...createdIds });

    // 5) Só liga no fim, se pedido. Default: fica tudo PAUSED p/ revisão humana.
    if (String(s.status || 'paused') === 'active') {
      await setAdStatus(adv, [adId], 'active');
    } else {
      warnings.push('Criado em PAUSED — ative na dashboard quando estiver pronto');
    }
    cacheBust('tree:');
    return { ...createdIds, name: s.name, warnings };
  } catch (err) {
    // Campanha órfã NÃO pode ficar entregável: pausa best-effort e devolve
    // o step + o que já foi criado p/ a rota reportar com precisão.
    try { await setCampaignStatus(adv, [campaignId], 'paused'); } catch (_) { /* best-effort */ }
    if (!err.step) err.step = 'adgroup';
    err.createdIds = createdIds;
    throw err;
  }
}

// ═══════════════════════════════════════════════════���═���═���═���══════════════════
// F3 — Duplicação de campanha na MESMA conta (composição: não há tool nativa).
// captureCampaign lê a origem COMPLETA (4 calls, cache 10min — capturar 1× por
// job mesmo com N cópias) e recreateCampaign recria com allowlist de campos:
// IDs/timestamps/métricas ficam de fora por construção (só copiamos o que é
// input válido de create_*). Criativos: MESMA conta ⇒ reaproveita video_id/
// image_ids da origem (zero re-upload). Tudo nasce PAUSED.
// ════════════════════════════════════════════════════════════════════════════

async function captureCampaign(advertiserId, campaignId) {
  const adv = String(advertiserId || '').trim();
  const cid = String(campaignId || '').trim();
  if (!adv || !cid) throw badRequest('advertiserId e campaignId são obrigatórios');
  const ck = 'dupcap:' + adv + ':' + cid;
  const cached = cacheGet(ck);
  if (cached) return cached;

  // Smart+ também aparece nos endpoints genéricos, mas aquelas linhas são
  // criativos agregados e não podem ser recriadas como leilão comum. Detecta a
  // origem pelo endpoint dedicado e captura a hierarquia própria.
  try {
    const smartCampaigns = await listSmartPlusCampaigns(adv, { campaignIds: [cid] });
    const smartCampaign = smartCampaigns.find((item) => item.campaignId === cid);
    if (smartCampaign) {
      const [adGroups, ads] = await Promise.all([
        listSmartPlusAdGroups(adv, { campaignIds: [cid] }),
        listSmartPlusAds(adv, { campaignIds: [cid] }),
      ]);
      if (!adGroups.length) throw stepError('capture', 'A campanha Smart+ de origem não tem grupo de anúncios legível', null, 422);
      const capture = { campaignKind: 'smart_plus', campaign: smartCampaign, adGroups, ads };
      cacheSet(ck, capture, 10 * 60 * 1000);
      return capture;
    }
  } catch (err) {
    // O endpoint genérico também devolve Smart+, mas o marca como campanha
    // regular. Se a leitura dedicada falhar, seguir adiante poderia recriar um
    // Smart+ como leilão comum e perder toda a hierarquia. Falha fechada.
    if (err && err.step === 'capture') throw err;
    const safe = stepError('capture', 'Não foi possível confirmar se a campanha é Smart+. A duplicação foi interrompida sem criar nada; atualize a conexão e tente novamente.', null, 503);
    safe.code = 'SMART_PLUS_CLASSIFICATION_UNAVAILABLE';
    throw safe;
  }

  const [campaignRows, adGroups, ads] = await Promise.all([
    listAllPages('get_tiktok_campaigns', { advertiser_id: adv }, ['campaigns', 'campaign_list', 'list', 'data'], { pageSize: 100 }),
    listAllPages('get_tiktok_adgroups', { advertiser_id: adv, campaign_ids: [cid] }, ['adgroups', 'ad_groups', 'adgroup_list', 'list', 'data'], { pageSize: 500 }),
    listAllPages('get_tiktok_ads', { advertiser_id: adv, campaign_ids: [cid] }, ['ads', 'ad_list', 'list', 'data'], { pageSize: 500 }),
  ]);
  const campaign = campaignRows.find((c) => String(c.campaign_id || c.id || '') === cid);
  if (!campaign) throw stepError('capture', 'Campanha de origem ' + cid + ' não encontrada neste advertiser', null, 404);
  if (!adGroups.length) throw stepError('capture', 'A campanha de origem não tem nenhum ad group — nada a duplicar', null, 422);
  const capture = { campaign, adGroups, ads };
  cacheSet(ck, capture, 10 * 60 * 1000);
  return capture;
}

// Preflight do erro 40002: DYNAMIC_DAILY_BUDGET só é aceito em alguns objetivos.
// A lista exata não é pública — então: preflight converte quando o objetivo é
// sabidamente incompatível E há um fallback de retry se o TikTok recusar mesmo
// assim. Nunca falha silenciosa: toda conversão vira warning no resultado.
function is40002DynamicBudget(err) {
  const msg = String((err && err.message) || '');
  return /dynamic\s+daily\s+budget/i.test(msg) || (/40002/.test(msg) && /budget[_\s-]*mode/i.test(msg));
}

// Campos de segmentação copiáveis. O create_tiktok_adgroup os quer aninhados
// sob `targeting`, mas o get_tiktok_adgroups os devolve ACHATADOS no topo do
// objeto do grupo — daí reconstruímos de ambos os formatos (a causa do erro
// "targeting is required with at least location_ids" na duplicação).
const TARGETING_KEYS = [
  'location_ids', 'age_groups', 'gender', 'languages',
  'interest_category_ids', 'interest_keyword_ids',
  'action_category_ids', 'action_scene', 'action_days',
  'operating_systems', 'device_model_ids', 'device_price_ranges',
  'network_types', 'carrier_ids', 'min_android_version', 'ios14_targeting',
  'audience_ids', 'excluded_audience_ids', 'saved_audience_id',
  'spending_power', 'household_income', 'zipcode_ids', 'isp_ids',
  'included_pangle_audience_package_ids', 'excluded_pangle_audience_package_ids',
];

// Reconstrói o objeto `targeting` a partir do grupo de origem, aceitando tanto o
// formato aninhado (srcAg.targeting.*) quanto o achatado (srcAg.*). Normaliza
// location_ids para array de strings não vazias.
function extractTargeting(srcAg) {
  const nested = (srcAg.targeting && typeof srcAg.targeting === 'object') ? srcAg.targeting : {};
  const t = {};
  for (const k of TARGETING_KEYS) {
    const v = nested[k] !== undefined ? nested[k] : srcAg[k];
    if (v === undefined || v === null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    t[k] = v;
  }
  if (t.location_ids != null && !Array.isArray(t.location_ids)) t.location_ids = [t.location_ids];
  if (Array.isArray(t.location_ids)) t.location_ids = t.location_ids.map(String).filter(Boolean);
  return t;
}

// Campo a campo do que É copiável de um adgroup de origem (allowlist).
// overrides (F4 — variações): { budgetAmount? } aplicado por cima da origem.
// fallbackLocationIds: usado quando este grupo específico não trouxe regiões
// (mas outro grupo da campanha trouxe) — evita o erro de targeting vazio.
function buildAdGroupCopyArgs(adv, newCampaignId, srcAg, timezone, warnings, overrides, fallbackLocationIds) {
  const targeting = extractTargeting(srcAg);
  if (!Array.isArray(targeting.location_ids) || !targeting.location_ids.length) {
    if (Array.isArray(fallbackLocationIds) && fallbackLocationIds.length) {
      targeting.location_ids = fallbackLocationIds.slice();
      warnings.push('Grupo "' + String(srcAg.adgroup_name || srcAg.name || '') + '" sem região na origem — herdou as regiões de outro grupo da campanha');
    } else {
      throw stepError('adgroup', 'Não foi possível ler as regiões de segmentação (location_ids) do ad group de origem — a duplicação exige pelo menos uma região', null, 422);
    }
  }
  const args = {
    advertiser_id: adv,
    campaign_id: newCampaignId,
    adgroup_name: String(srcAg.adgroup_name || srcAg.name || 'grupo').slice(0, 500),
    optimization_goal: String(srcAg.optimization_goal || srcAg.optimizationGoal),
    targeting,
  };
  // schedule no passado NÃO é copiável: recalcula p/ agora (+10min)
  const srcStart = String(srcAg.schedule_start_time || '');
  const startMs = Date.parse(srcStart.replace(' ', 'T'));
  if (Number.isFinite(startMs) && startMs > Date.now()) args.schedule_start_time = srcStart;
  else {
    args.schedule_start_time = advertiserLocalTime(timezone);
    if (srcStart) warnings.push('Início da veiculação estava no passado — recalculado para agora');
  }
  if (srcAg.schedule_end_time) {
    const endMs = Date.parse(String(srcAg.schedule_end_time).replace(' ', 'T'));
    if (Number.isFinite(endMs) && endMs > Date.now()) args.schedule_end_time = String(srcAg.schedule_end_time);
  }
  const mode = String(srcAg.budget_mode || '');
  const budgetOverride = Number((overrides || {}).budgetAmount) > 0 ? Number(overrides.budgetAmount) : 0;
  if ((overrides || {}).campaignBudgetOwner) {
    // CBO: a campanha é a única dona do orçamento. Um budget legado ainda
    // presente no readback do grupo não pode ser reenviado e cobrado duas vezes.
    args.budget_mode = 'BUDGET_MODE_INFINITE';
  } else if (mode && mode !== 'BUDGET_MODE_INFINITE') {
    // adgroup NÃO aceita DYNAMIC_DAILY (enum do create só tem DAY/TOTAL/INFINITE)
    args.budget_mode = mode === 'BUDGET_MODE_DYNAMIC_DAILY_BUDGET' ? 'BUDGET_MODE_DAY' : mode;
    if (mode === 'BUDGET_MODE_DYNAMIC_DAILY_BUDGET') warnings.push('Orçamento dinâmico do grupo convertido para diário fixo (não suportado na recriação)');
    if (budgetOverride) args.budget = clampTikTokBudget(budgetOverride, warnings, 'Orçamento do grupo');
    else if (Number(srcAg.budget) > 0) args.budget = clampTikTokBudget(srcAg.budget, warnings, 'Orçamento do grupo');
  } else if (budgetOverride && !(overrides || {}).campaignBudgetOwner) {
    // Origem sem orçamento no grupo (INFINITE/CBO) mas a variação pede um:
    // vira orçamento diário fixo no grupo.
    args.budget_mode = 'BUDGET_MODE_DAY';
    args.budget = clampTikTokBudget(budgetOverride, warnings, 'Orçamento do grupo');
  } else {
    // CBO (orçamento na campanha) ou origem sem budget_mode capturado: o grupo
    // herda o orçamento da campanha. O create_tiktok_adgroup EXIGE budget_mode
    // SEMPRE (senão erro 40002 "budget_mode is required") → INFINITE. Sem isto,
    // duplicar campanha CBO quebrava.
    args.budget_mode = 'BUDGET_MODE_INFINITE';
  }
  const bidType = String(srcAg.bid_type || '');
  if (bidType) {
    args.bid_type = bidType;
    if (bidType === 'BID_TYPE_CUSTOM') {
      if (Number(srcAg.conversion_bid_price) > 0) args.conversion_bid_price = Number(srcAg.conversion_bid_price);
      else if (Number(srcAg.bid_price) > 0) args.bid_price = Number(srcAg.bid_price);
    }
  }
  if (srcAg.billing_event) args.billing_event = String(srcAg.billing_event);
  args.pixel_id = String(srcAg.pixel_id || srcAg.pixelId);
  args.optimization_event = 'ON_WEB_ORDER';
  if (srcAg.promotion_type) args.promotion_type = String(srcAg.promotion_type);
  if (srcAg.promotion_target_type) args.promotion_target_type = String(srcAg.promotion_target_type);
  if (srcAg.placement_type) args.placement_type = String(srcAg.placement_type);
  if (Array.isArray(srcAg.placements) && srcAg.placements.length) args.placements = srcAg.placements;
  for (const key of ['catalog_id', 'catalog_authorized_bc_id', 'product_source', 'store_id', 'store_authorized_bc_id', 'shopping_ads_type', 'shopping_ads_retargeting_type']) {
    if (srcAg[key] !== undefined && srcAg[key] !== null && String(srcAg[key]).trim()) args[key] = srcAg[key];
  }
  if (Number(srcAg.shopping_ads_retargeting_actions_days) > 0) args.shopping_ads_retargeting_actions_days = Number(srcAg.shopping_ads_retargeting_actions_days);
  args.operation_status = 'DISABLE';
  return args;
}

function cloneJson(value, fallback) {
  try { return JSON.parse(JSON.stringify(value)); } catch (_) { return fallback; }
}

// Product Sales exige product_specific_type no anúncio, inclusive em
// SINGLE_VIDEO. O GET do conector ainda pode omitir o campo; nesse caso a
// própria seleção de produtos da origem permite reconstruí-lo sem chute:
// SKU/produto explícito = CUSTOMIZED_PRODUCTS, Product Set/SPUs = PRODUCT_SET
// e catálogo sem recorte = ALL.
function productSpecificTypeForCopy(srcAd) {
  const explicit = String(srcAd.product_specific_type || srcAd.productSpecificType || '').trim().toUpperCase();
  if (['ALL', 'PRODUCT_SET', 'CUSTOMIZED_PRODUCTS'].includes(explicit)) return { value: explicit, inferred: false };
  const skuIds = Array.isArray(srcAd.sku_ids) ? srcAd.sku_ids : Array.isArray(srcAd.skuIds) ? srcAd.skuIds : [];
  const productIds = Array.isArray(srcAd.product_ids) ? srcAd.product_ids : Array.isArray(srcAd.productIds) ? srcAd.productIds : [];
  if (skuIds.length || productIds.length) return { value: 'CUSTOMIZED_PRODUCTS', inferred: true };
  const itemGroupIds = Array.isArray(srcAd.item_group_ids) ? srcAd.item_group_ids : Array.isArray(srcAd.itemGroupIds) ? srcAd.itemGroupIds : [];
  if (srcAd.product_set_id || srcAd.productSetId || itemGroupIds.length) return { value: 'PRODUCT_SET', inferred: true };
  if (srcAd.catalog_id || srcAd.catalogId) return { value: 'ALL', inferred: true };
  return { value: '', inferred: false };
}

// A dashboard é exclusivamente de vendas/conversão. Duplicação não pode
// inventar TRAFFIC/CLICK quando o readback do conector vem incompleto: isso
// produziria uma campanha válida na API, porém com semântica errada. Toda a
// hierarquia é validada antes da primeira escrita remota.
function duplicationPreflightError(code, message) {
  const err = stepError('preflight', message, null, 422);
  err.code = code;
  err.retryable = false;
  return err;
}

function normalizeDuplicableObjective(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) {
    throw duplicationPreflightError(
      'DUPLICATION_OBJECTIVE_UNAVAILABLE',
      'O TikTok não devolveu o objetivo da campanha. Nada foi criado para evitar transformar a origem em outro tipo de campanha.',
    );
  }
  if (raw === 'CONVERSIONS') return 'WEB_CONVERSIONS';
  if (raw === 'CATALOG_SALES') return 'PRODUCT_SALES';
  if (raw === 'WEB_CONVERSIONS' || raw === 'PRODUCT_SALES') return raw;
  throw duplicationPreflightError(
    'DUPLICATION_OBJECTIVE_UNSUPPORTED',
    'A ROI-NADOS duplica somente campanhas de Conversão e Product Sales. O objetivo da origem é ' + raw + '.',
  );
}

function validateConversionGroup(group, label, warnings) {
  const optimizationGoal = String(group.optimization_goal || group.optimizationGoal || '').trim().toUpperCase();
  if (!['CONVERT', 'VALUE'].includes(optimizationGoal)) {
    throw duplicationPreflightError(
      'DUPLICATION_OPTIMIZATION_UNSUPPORTED',
      label + ' não expôs uma otimização de conversão válida (CONVERT/VALUE).',
    );
  }
  const pixelId = String(group.pixel_id || group.pixelId || '').trim();
  if (!/^\d{5,30}$/.test(pixelId)) {
    throw duplicationPreflightError(
      'DUPLICATION_PIXEL_UNAVAILABLE',
      label + ' não devolveu o Pixel ID numérico usado na origem.',
    );
  }
  const event = String(group.optimization_event || group.optimizationEvent || '').trim().toUpperCase();
  if (event !== 'ON_WEB_ORDER' && Array.isArray(warnings)) {
    warnings.push(
      label + (event ? ' usava o evento ' + event : ' não devolveu o evento de otimização')
      + ' — a cópia será normalizada para Compra (ON_WEB_ORDER)',
    );
  }
}

function validateRegularDuplicationCapture(capture, objectiveType, warnings) {
  const groups = Array.isArray(capture && capture.adGroups) ? capture.adGroups : [];
  const ads = Array.isArray(capture && capture.ads) ? capture.ads : [];
  if (!groups.length) throw duplicationPreflightError('DUPLICATION_EMPTY_ADGROUPS', 'A origem não possui conjuntos legíveis para duplicar.');
  if (!ads.length) throw duplicationPreflightError('DUPLICATION_EMPTY_ADS', 'A origem não possui anúncios legíveis para duplicar.');
  const groupIds = new Set(groups.map((group) => String(group.adgroup_id || group.id || '')).filter(Boolean));
  let fallbackLocationIds = [];
  for (const group of groups) {
    const label = 'O conjunto "' + String(group.adgroup_name || group.name || group.adgroup_id || '') + '"';
    validateConversionGroup(group, label, warnings);
    const targeting = extractTargeting(group);
    if (!fallbackLocationIds.length && Array.isArray(targeting.location_ids) && targeting.location_ids.length) {
      fallbackLocationIds = targeting.location_ids;
    }
  }
  if (!fallbackLocationIds.length) {
    throw duplicationPreflightError('DUPLICATION_TARGETING_UNAVAILABLE', 'Nenhum conjunto da origem devolveu as regiões de segmentação (location_ids).');
  }
  for (const ad of ads) {
    const adId = String(ad.ad_id || ad.id || '');
    if (!groupIds.has(String(ad.adgroup_id || ''))) {
      throw duplicationPreflightError('DUPLICATION_HIERARCHY_INVALID', 'O anúncio ' + adId + ' não pertence a um conjunto legível da origem.');
    }
    const catalogId = String(ad.catalog_id || ad.catalogId || '');
    const videoId = String(ad.video_id || deepPluck(ad, 'video_id') || '');
    const imageIds = ad.image_ids || deepPluck(ad, 'image_ids');
    if (!catalogId && !videoId && !(Array.isArray(imageIds) && imageIds.length)) {
      throw duplicationPreflightError('DUPLICATION_CREATIVE_UNAVAILABLE', 'O anúncio ' + adId + ' não devolveu vídeo, imagem ou catálogo reutilizável.');
    }
    if (catalogId && !productSpecificTypeForCopy(ad).value) {
      throw duplicationPreflightError('DUPLICATION_PRODUCT_SCOPE_UNAVAILABLE', 'O anúncio de catálogo ' + adId + ' não devolveu o escopo de produtos.');
    }
  }
  if (objectiveType === 'PRODUCT_SALES' && !ads.some((ad) => String(ad.catalog_id || ad.catalogId || '').trim())) {
    throw duplicationPreflightError('DUPLICATION_CATALOG_UNAVAILABLE', 'A campanha Product Sales não devolveu o catálogo usado nos anúncios.');
  }
  return fallbackLocationIds;
}

function validateSmartDuplicationCapture(capture, warnings) {
  const groups = Array.isArray(capture && capture.adGroups) ? capture.adGroups : [];
  const ads = Array.isArray(capture && capture.ads) ? capture.ads : [];
  if (!groups.length) throw duplicationPreflightError('DUPLICATION_EMPTY_ADGROUPS', 'A origem Smart+ não possui conjuntos legíveis para duplicar.');
  if (!ads.length) throw duplicationPreflightError('DUPLICATION_EMPTY_ADS', 'A origem Smart+ não possui asset groups legíveis para duplicar.');
  const groupIds = new Set(groups.map((group) => String(group.adGroupId || '')).filter(Boolean));
  for (const group of groups) {
    validateConversionGroup(group, 'O conjunto Smart+ "' + String(group.name || group.adGroupId || '') + '"', warnings);
    const targeting = group.targetingSpec && typeof group.targetingSpec === 'object' ? group.targetingSpec : {};
    if (!Array.isArray(targeting.location_ids) || !targeting.location_ids.length) {
      throw duplicationPreflightError('DUPLICATION_TARGETING_UNAVAILABLE', 'O conjunto Smart+ "' + String(group.name || group.adGroupId || '') + '" não devolveu location_ids.');
    }
  }
  for (const ad of ads) {
    if (!groupIds.has(String(ad.adGroupId || ''))) {
      throw duplicationPreflightError('DUPLICATION_HIERARCHY_INVALID', 'O asset group Smart+ ' + String(ad.adId || '') + ' não pertence a um conjunto legível.');
    }
    const creativeList = Array.isArray(ad.creativeList) ? ad.creativeList : [];
    if (!creativeList.some((item) => item && item.creative_info)) {
      throw duplicationPreflightError('DUPLICATION_CREATIVE_UNAVAILABLE', 'O asset group Smart+ "' + String(ad.name || ad.adId || '') + '" não devolveu criativos reutilizáveis.');
    }
  }
}

// Auditoria real e somente leitura usada pela UI antes de criar o job. Ela
// consulta a hierarquia atual do TikTok, verifica objetivo, Pixel, Compra,
// targeting, criativos, identidade e contrato de catálogo. Nenhum create/update
// é chamado aqui.
async function preflightCampaignDuplication(advertiserId, campaignId) {
  const adv = String(advertiserId || '').trim();
  const cid = String(campaignId || '').trim();
  if (!adv || !cid) throw badRequest('advertiserId e campaignId são obrigatórios');
  const capture = await captureCampaign(adv, cid);
  const warnings = [];
  const source = capture.campaign || {};
  const objectiveType = normalizeDuplicableObjective(source.objective || source.objective_type);
  const smart = capture.campaignKind === 'smart_plus';
  if (smart) {
    validateSmartDuplicationCapture(capture, warnings);
    if (!(source.budgetOptimizeOn || Number(source.budget) > 0)) {
      const err = duplicationPreflightError(
        'SMART_PLUS_ABO_DUPLICATION_UNSUPPORTED',
        'O conector atual exige orçamento no nível campanha ao criar Smart+. A origem é ABO; nada foi criado para evitar convertê-la silenciosamente em CBO.',
      );
      err.status = 409;
      throw err;
    }
    if (String(source.budgetMode || '') !== 'BUDGET_MODE_TOTAL') {
      const err = duplicationPreflightError(
        'SMART_PLUS_BUDGET_MODE_UNSUPPORTED',
        'A origem Smart+ usa ' + String(source.budgetMode || 'um modo não informado') + '. O conector atual só confirma recriação fiel com orçamento TOTAL; nada foi criado.',
      );
      err.status = 409;
      throw err;
    }
  } else {
    validateRegularDuplicationCapture(capture, objectiveType, warnings);
    const catalogAds = (capture.ads || []).filter((ad) => String(ad.catalog_id || ad.catalogId || '').trim());
    if (objectiveType === 'PRODUCT_SALES' || catalogAds.length) {
      const capabilities = await getCatalogCapabilities();
      if (!capabilities.productSpecificType) {
        const err = stepError(
          'preflight',
          'O conector ainda não encaminha product_specific_type. Nada foi criado.',
          null,
          409,
        );
        err.code = 'PRODUCT_SALES_DUPLICATION_CONNECTOR_UNSUPPORTED';
        err.retryable = true;
        throw err;
      }
    }
    if ((capture.ads || []).some((ad) => !usableBcIdentity(ad))) await pickAdIdentity(adv);
  }
  const budgetOwner = smart
    ? (source.budgetOptimizeOn || Number(source.budget) > 0 ? 'campaign' : 'adgroup')
    : (source.budget_optimize_on === true || Number(source.budget) > 0 ? 'campaign' : 'adgroup');
  const productScopes = smart ? [] : [...new Set((capture.ads || [])
    .map((ad) => productSpecificTypeForCopy(ad).value)
    .filter(Boolean))];
  return {
    ok: true,
    advertiserId: adv,
    campaignId: cid,
    campaignKind: smart ? 'smart_plus' : 'auction',
    objectiveType,
    budgetOwner,
    adGroups: (capture.adGroups || []).length,
    ads: (capture.ads || []).length,
    productScopes,
    normalizedEvent: 'ON_WEB_ORDER',
    warnings,
  };
}

function smartScheduleValue(value, timezone, fallbackDate) {
  const raw = String(value || '');
  const parsed = Date.parse(raw.replace(' ', 'T'));
  if (Number.isFinite(parsed) && parsed > Date.now() + 30 * 60 * 1000) return raw;
  return advertiserLocalTime(timezone, fallbackDate);
}

// Duplicação Smart+ usa a hierarquia dedicada. Recriar a linha genérica
// AUCTION_AD perderia asset groups, textos e variações. Todos os três níveis
// nascem DISABLE e são pausados novamente no final como cinto de segurança.
async function recreateSmartPlusCampaign(advertiserId, capture, newName, opts) {
  const adv = String(advertiserId || '').trim();
  const value = opts || {};
  const overrides = value.overrides && typeof value.overrides === 'object' ? value.overrides : {};
  const resume = value.resume && typeof value.resume === 'object' ? value.resume : {};
  const report = typeof value.onProgress === 'function' ? value.onProgress : async () => {};
  const source = capture.campaign || {};
  const warnings = [];
  const objectiveType = normalizeDuplicableObjective(source.objective || source.objective_type);
  validateSmartDuplicationCapture(capture, warnings);
  const progress = {
    campaignId: String(resume.campaignId || '') || null,
    adGroups: { ...(resume.adGroups || {}) },
    ads: { ...(resume.ads || {}) },
  };
  const info = await getAdvertiserInfo(adv).catch(() => null);
  const campaignBudgetOwner = source.budgetOptimizeOn || Number(source.budget) > 0;
  if (!campaignBudgetOwner) {
    const err = duplicationPreflightError(
      'SMART_PLUS_ABO_DUPLICATION_UNSUPPORTED',
      'O conector atual exige orçamento no nível campanha ao criar Smart+. A origem é ABO; nada foi criado para evitar convertê-la silenciosamente em CBO.',
    );
    err.status = 409;
    throw err;
  }
  if (String(source.budgetMode || '') !== 'BUDGET_MODE_TOTAL') {
    const err = duplicationPreflightError(
      'SMART_PLUS_BUDGET_MODE_UNSUPPORTED',
      'A origem Smart+ usa ' + String(source.budgetMode || 'um modo não informado') + '. O conector atual só confirma recriação fiel com orçamento TOTAL; nada foi criado.',
    );
    err.status = 409;
    throw err;
  }

  if (!progress.campaignId && value.dedupeByName) {
    const existing = (await listSmartPlusCampaigns(adv)).find((item) => item.name === String(newName).slice(0, 512));
    if (existing) {
      progress.campaignId = existing.campaignId;
      warnings.push('Cópia Smart+ "' + newName + '" já existia e foi retomada');
    }
  }
  if (!progress.campaignId) {
    const args = {
      advertiser_id: adv,
      campaign_name: String(newName).slice(0, 512),
      objective_type: objectiveType,
      operation_status: 'DISABLE',
    };
    const campaignBudget = Number(overrides.budgetAmount) > 0 && campaignBudgetOwner
      ? Number(overrides.budgetAmount) : Number(source.budget || 0);
    if (campaignBudgetOwner) {
      // Smart+ ABO aparece no readback com BUDGET_MODE_INFINITE na campanha,
      // mas reenviar esse modo no create gera TikTok 40002. Em ABO, campanha
      // não recebe budget_mode/budget; o orçamento pertence ao conjunto.
      args.budget_mode = 'BUDGET_MODE_TOTAL';
      args.budget = clampTikTokBudget(campaignBudget, warnings, 'Orçamento Smart+');
      args.budget_optimize_on = true;
    }
    if (source.salesDestination) args.sales_destination = source.salesDestination;
    if (source.campaignType) args.campaign_type = source.campaignType;
    if (source.catalogEnabled) args.catalog_enabled = true;
    if (source.catalogType) args.catalog_type = source.catalogType;
    if (source.isPromotionalCampaign) args.is_promotional_campaign = true;
    const out = await callTikTokWriteWithRetry('create_tiktok_smart_plus_campaign', args, () => warnings.push('Instabilidade temporária ao criar a campanha Smart+ — nova tentativa automática'));
    progress.campaignId = String(deepPluck(out, 'campaign_id') || '');
    if (!progress.campaignId) throw stepError('campaign', 'A criação Smart+ não retornou campaign_id', progress);
  }
  await report({ ...progress });

  try {
    for (const group of capture.adGroups || []) {
      const sourceId = String(group.adGroupId || '');
      if (!sourceId || progress.adGroups[sourceId]) continue;
      const targeting = cloneJson(group.targetingSpec || {}, {});
      delete targeting.smart_audience_enabled;
      delete targeting.smart_interest_behavior_enabled;
      if (!Array.isArray(targeting.location_ids) || !targeting.location_ids.length) {
        throw stepError('adgroup', 'O grupo Smart+ "' + group.name + '" não expôs location_ids; a cópia foi interrompida antes de publicar', progress, 422);
      }
      const start = smartScheduleValue(group.scheduleStartTime, info && info.timezone);
      const end = smartScheduleValue(group.scheduleEndTime, info && info.timezone, new Date(Date.now() + 7 * 864e5));
      const args = {
        advertiser_id: adv,
        campaign_id: progress.campaignId,
        adgroup_name: String(group.name || 'Grupo Smart+').slice(0, 512),
        promotion_type: group.promotionType || 'WEBSITE',
        targeting_spec: targeting,
        schedule_type: 'SCHEDULE_START_END',
        schedule_start_time: start,
        schedule_end_time: end,
        optimization_goal: group.optimizationGoal,
        billing_event: group.billingEvent || 'OCPM',
        operation_status: 'DISABLE',
      };
      if (!campaignBudgetOwner) {
        const groupBudget = Number(overrides.budgetAmount) > 0 ? Number(overrides.budgetAmount) : Number(group.budget || 0);
        if (group.budgetMode) args.budget_mode = group.budgetMode;
        if (groupBudget > 0) args.budget = clampTikTokBudget(groupBudget, warnings, 'Orçamento do grupo Smart+');
      }
      if (group.bidType) args.bid_type = group.bidType;
      if (group.bidPrice > 0) args.bid_price = group.bidPrice;
      if (group.conversionBidPrice > 0) args.conversion_bid_price = group.conversionBidPrice;
      if (group.minBudget > 0) args.min_budget = group.minBudget;
      if (group.roasBid > 0) args.roas_bid = group.roasBid;
      if (group.pixelId) args.pixel_id = group.pixelId;
      // A cópia sempre otimiza para Compra, inclusive quando a origem legada
      // devolve SHOPPING/INITIATE_ORDER ou omite o evento no readback.
      args.optimization_event = 'ON_WEB_ORDER';
      if (group.placementType) args.placement_type = group.placementType;
      if (group.placements.length) args.placements = group.placements;
      if (group.dayparting) args.dayparting = group.dayparting;
      if (group.productSource) args.product_source = group.productSource;
      if (group.promotionTargetType) args.promotion_target_type = group.promotionTargetType;
      if (group.promotionWebsiteType) args.promotion_website_type = group.promotionWebsiteType;
      for (const [target, fieldValue] of [
        ['app_id', group.appId],
        ['catalog_id', group.catalogId],
        ['catalog_authorized_bc_id', group.catalogAuthorizedBcId],
        ['custom_conversion_id', group.customConversionId],
        ['identity_authorized_bc_id', group.identityAuthorizedBcId],
        ['identity_id', group.identityId],
        ['identity_type', group.identityType],
        ['deep_bid_type', group.deepBidType],
        ['deep_funnel_event_source', group.deepFunnelEventSource],
        ['deep_funnel_event_source_id', group.deepFunnelEventSourceId],
        ['deep_funnel_optimization_event', group.deepFunnelOptimizationEvent],
        ['deep_funnel_optimization_status', group.deepFunnelOptimizationStatus],
      ]) {
        if (fieldValue !== undefined && fieldValue !== null && String(fieldValue).trim()) args[target] = fieldValue;
      }
      for (const [target, fieldValue] of [
        ['attribution_event_count', group.attributionEventCount],
        ['click_attribution_window', group.clickAttributionWindow],
        ['engaged_view_attribution_window', group.engagedViewAttributionWindow],
        ['view_attribution_window', group.viewAttributionWindow],
        ['deep_cpabid', group.deepCpaBid],
      ]) {
        if (Number(fieldValue) > 0) args[target] = Number(fieldValue);
      }
      args.comment_disabled = group.commentDisabled;
      args.share_disabled = group.shareDisabled;
      args.video_download_disabled = group.videoDownloadDisabled;
      args.suggestion_audience_enabled = group.suggestionAudienceEnabled;
      if (group.targetingOptimizationMode) args.targeting_optimization_mode = group.targetingOptimizationMode;
      const out = await callTikTokWriteWithRetry('create_tiktok_smart_plus_adgroup', args, () => warnings.push('Instabilidade temporária ao criar o grupo Smart+ — nova tentativa automática'));
      const id = String(deepPluck(out, 'adgroup_id') || '');
      if (!id) throw stepError('adgroup', 'A criação Smart+ não retornou adgroup_id', progress);
      progress.adGroups[sourceId] = id;
      await report({ ...progress });
    }

    for (const ad of capture.ads || []) {
      const sourceId = String(ad.adId || '');
      if (!sourceId || progress.ads[sourceId]) continue;
      const groupId = progress.adGroups[String(ad.adGroupId || '')];
      if (!groupId) { warnings.push('Asset group Smart+ ' + sourceId + ' ignorado: grupo pai não foi mapeado'); continue; }
      const creativeList = (ad.creativeList || []).map((item) => ({
        creative_info: cloneJson(item && item.creative_info, null),
      })).filter((item) => item.creative_info);
      if (!creativeList.length) throw stepError('ad', 'O asset group Smart+ "' + ad.name + '" não expôs criativos reutilizáveis', progress, 422);
      const args = {
        advertiser_id: adv,
        adgroup_id: groupId,
        ad_name: String(ad.name || newName).slice(0, 512),
        creative_list: creativeList,
        operation_status: 'DISABLE',
      };
      const adTextList = cloneJson(ad.adTextList || [], []);
      if (overrides.adText) {
        args.ad_text_list = adTextList.length
          ? [{ ...adTextList[0], ad_text: String(overrides.adText).slice(0, 100) }, ...adTextList.slice(1)]
          : [{ ad_text: String(overrides.adText).slice(0, 100) }];
      } else if (adTextList.length) args.ad_text_list = adTextList;
      for (const [target, sourceKey] of [
        ['landing_page_url_list', 'landingPageUrlList'],
        ['call_to_action_list', 'callToActionList'],
        ['deeplink_list', 'deeplinkList'],
        ['page_list', 'pageList'],
        ['interactive_add_on_list', 'interactiveAddOnList'],
      ]) {
        const list = cloneJson(ad[sourceKey] || [], []);
        if (list.length) args[target] = list;
      }
      if (ad.adConfiguration && Object.keys(ad.adConfiguration).length) args.ad_configuration = cloneJson(ad.adConfiguration, {});
      const out = await callTikTokWriteWithRetry('create_tiktok_smart_plus_ad', args, () => warnings.push('Instabilidade temporária ao criar o anúncio Smart+ — nova tentativa automática'));
      const id = String(deepPluck(out, 'smart_plus_ad_id') || deepPluck(out, 'ad_id') || '');
      if (!id) throw stepError('ad', 'A criação Smart+ não retornou smart_plus_ad_id', progress);
      progress.ads[sourceId] = id;
      await report({ ...progress });
    }

    await setSmartPlusCampaignStatus(adv, [progress.campaignId], 'paused');
    const groupIds = Object.values(progress.adGroups);
    const adIds = Object.values(progress.ads);
    if (groupIds.length) await setSmartPlusAdGroupStatus(adv, groupIds, 'paused');
    if (adIds.length) await setSmartPlusAdStatus(adv, adIds, 'paused');
    return { campaignId: progress.campaignId, adGroupIds: groupIds, adIds, name: newName, warnings, campaignKind: 'smart_plus' };
  } catch (err) {
    if (progress.campaignId) {
      try { await setSmartPlusCampaignStatus(adv, [progress.campaignId], 'paused'); } catch (_) { /* best-effort */ }
    }
    if (!err.step) err.step = 'adgroup';
    err.createdIds = progress;
    throw err;
  }
}

// Recria a campanha capturada. newName é o nome da CÓPIA (já com sufixo).
// opts.resume/opts.onProgress: mesma mecânica idempotente do createFullAd —
// progresso = { campaignId, adGroups: {srcId: newId}, ads: {srcId: newId} }.
// opts.overrides (F4 — variações): { budgetAmount?, adText? } aplicado por
// cima da origem em CADA grupo/anúncio da variação.
async function recreateCampaign(advertiserId, capture, newName, opts) {
  if (capture && capture.campaignKind === 'smart_plus') {
    return recreateSmartPlusCampaign(advertiserId, capture, newName, opts);
  }
  const adv = String(advertiserId || '').trim();
  const o = opts || {};
  const overrides = (o.overrides && typeof o.overrides === 'object') ? o.overrides : {};
  const resume = (o.resume && typeof o.resume === 'object') ? o.resume : {};
  const report = typeof o.onProgress === 'function' ? o.onProgress : async () => {};
  const src = capture.campaign;
  const warnings = [];
  const objectiveType = normalizeDuplicableObjective(src && (src.objective_type || src.objective));
  const fallbackLocationIds = validateRegularDuplicationCapture(capture, objectiveType, warnings);
  const campaignBudgetOwner = src.budget_optimize_on === true || Number(src.budget) > 0;
  const progress = {
    campaignId: String(resume.campaignId || '') || null,
    adGroups: { ...(resume.adGroups || {}) },
    ads: { ...(resume.ads || {}) },
  };

  // Product Sales exige product_specific_type em cada anúncio. O conector
  // precisa declarar o campo porque versões que não o declaram também o
  // descartam silenciosamente antes de chamar o TikTok (40002 no último
  // nível). Falhamos antes da campanha para não deixar estrutura parcial.
  if (objectiveType === 'PRODUCT_SALES') {
    const capabilities = await getCatalogCapabilities();
    if (!capabilities.productSpecificType) {
      const err = stepError(
        'preflight',
        'O conector ainda não encaminha o escopo de produtos exigido pelo TikTok para duplicar Product Sales. Nada foi criado; tente novamente após a atualização do Pipeboard.',
        null,
        409,
      );
      err.code = 'PRODUCT_SALES_DUPLICATION_CONNECTOR_UNSUPPORTED';
      err.retryable = true;
      throw err;
    }
  }

  // Se algum anúncio não trouxer uma identidade BC válida, a identidade de
  // fallback é pré-validada ANTES de criar a campanha. Assim uma cópia de
  // Spark/CUSTOMIZED_USER sem BC autorizado falha fechada, sem deixar órfão.
  const needsFallbackIdentity = (capture.ads || []).some((ad) => !usableBcIdentity(ad));
  const [info, fallbackIdentity] = await Promise.all([
    getAdvertiserInfo(adv),
    needsFallbackIdentity ? pickAdIdentity(adv) : Promise.resolve(null),
  ]);

  // 1) Campanha
  if (!progress.campaignId) {
    if (o.dedupeByName) {
      const existing = await findCampaignIdByName(adv, String(newName).slice(0, 512));
      if (existing) { progress.campaignId = existing; warnings.push('Cópia "' + newName + '" já existia (retomada pós-crash) — reaproveitada'); }
    }
  }
  if (!progress.campaignId) {
    const campArgs = {
      advertiser_id: adv,
      campaign_name: String(newName).slice(0, 512),
      objective_type: objectiveType,
      operation_status: 'DISABLE',
    };
    const srcMode = String(src.budget_mode || '');
    // Preflight 40002: DYNAMIC_DAILY só entra se o objetivo for de conversão/
    // vendas (onde se sabe que existe); fora disso converte já no preflight.
    if (srcMode === 'BUDGET_MODE_DYNAMIC_DAILY_BUDGET' && !/CONVERSIONS|PRODUCT_SALES|SHOP_PURCHASES|APP_PROMOTION/.test(campArgs.objective_type)) {
      campArgs.budget_mode = 'BUDGET_MODE_DAY';
      if (Number(overrides.budgetAmount) > 0 && campaignBudgetOwner) campArgs.budget = clampTikTokBudget(overrides.budgetAmount, warnings, 'Orçamento da campanha');
      else if (Number(src.budget) > 0) campArgs.budget = clampTikTokBudget(src.budget, warnings, 'Orçamento da campanha');
      warnings.push('Orçamento dinâmico diário convertido para diário fixo (objetivo ' + campArgs.objective_type + ' não o suporta — preflight 40002)');
    } else if (srcMode && srcMode !== 'BUDGET_MODE_INFINITE') {
      campArgs.budget_mode = srcMode;
      if (Number(overrides.budgetAmount) > 0 && campaignBudgetOwner) campArgs.budget = clampTikTokBudget(overrides.budgetAmount, warnings, 'Orçamento da campanha');
      else if (Number(src.budget) > 0) campArgs.budget = clampTikTokBudget(src.budget, warnings, 'Orçamento da campanha');
    }
    if (src.budget_optimize_on === true) campArgs.budget_optimize_on = true;
    if (src.pixel_id) { campArgs.pixel_id = String(src.pixel_id); campArgs.optimization_event = 'ON_WEB_ORDER'; }
    for (const key of ['campaign_type', 'catalog_id', 'product_source', 'shopping_ads_type']) {
      if (src[key] !== undefined && src[key] !== null && String(src[key]).trim()) campArgs[key] = src[key];
    }
    let campOut;
    try {
      campOut = await callTikTokWriteWithRetry('create_tiktok_campaign', campArgs, () => warnings.push('Instabilidade temporária do TikTok ao criar a campanha — nova tentativa automática'));
    } catch (err) {
      // Fallback 40002: o TikTok recusou o modo dinâmico → retry ÚNICO com DAY.
      if (is40002DynamicBudget(err) && campArgs.budget_mode === 'BUDGET_MODE_DYNAMIC_DAILY_BUDGET') {
        campArgs.budget_mode = 'BUDGET_MODE_DAY';
        warnings.push('TikTok recusou orçamento dinâmico (40002) — recriada com orçamento diário fixo');
        campOut = await callTikTokWriteWithRetry('create_tiktok_campaign', campArgs, () => warnings.push('Instabilidade temporária do TikTok ao criar a campanha — nova tentativa automática'));
      } else { err.step = err.step || 'campaign'; throw err; }
    }
    progress.campaignId = String(deepPluck(campOut, 'campaign_id') || '');
    if (!progress.campaignId) throw stepError('campaign', 'create_tiktok_campaign não retornou campaign_id na duplicação');
  }
  await report({ ...progress });

  try {
    // Regiões de fallback: primeiro grupo da campanha que trouxe location_ids.
    // Se um grupo específico vier sem região (dados parciais do GET), herda
    // estas em vez de falhar a cópia inteira.
    // 2) Ad groups (todos) — cada um gravado no progresso ao nascer.
    for (const srcAg of capture.adGroups) {
      const srcAgId = String(srcAg.adgroup_id || srcAg.id || '');
      if (progress.adGroups[srcAgId]) continue; // já criado numa tentativa anterior
      const agArgs = buildAdGroupCopyArgs(adv, progress.campaignId, srcAg, info && info.timezone, warnings, { ...overrides, campaignBudgetOwner }, fallbackLocationIds);
      const agOut = await callTikTokWriteWithRetry('create_tiktok_adgroup', agArgs, () => warnings.push('TikTok não conseguiu alocar a criação do grupo — nova tentativa automática'));
      const newAgId = String(deepPluck(agOut, 'adgroup_id') || '');
      if (!newAgId) throw stepError('adgroup', 'create_tiktok_adgroup não retornou adgroup_id na duplicação', progress);
      progress.adGroups[srcAgId] = newAgId;
      await report({ ...progress });
    }

    // 3) Ads — reaproveita video_id/image_ids da origem (mesma conta); SEMPRE PAUSED.
    for (const srcAd of capture.ads) {
      const srcAdId = String(srcAd.ad_id || srcAd.id || '');
      if (progress.ads[srcAdId]) continue;
      const srcAgId = String(srcAd.adgroup_id || '');
      const newAgId = progress.adGroups[srcAgId];
      if (!newAgId) { warnings.push('Anúncio ' + srcAdId + ' ignorado: ad group de origem não mapeado'); continue; }
      const adArgs = {
        advertiser_id: adv,
        adgroup_id: newAgId,
        ad_name: String(srcAd.ad_name || srcAd.name || newName).slice(0, 500),
        ad_format: String(srcAd.ad_format || 'SINGLE_VIDEO'),
        ad_text: String(overrides.adText || srcAd.ad_text || srcAd.title || newName).slice(0, 100),
        status: 'PAUSED',
      };
      const vid = String(srcAd.video_id || deepPluck(srcAd, 'video_id') || '');
      const imgs = srcAd.image_ids || deepPluck(srcAd, 'image_ids');
      const catalogId = String(srcAd.catalog_id || '');
      if (vid) adArgs.video_id = vid;
      else if (Array.isArray(imgs) && imgs.length) adArgs.image_ids = imgs;
      else if (!catalogId) { warnings.push('Anúncio ' + srcAdId + ' ignorado: origem não expõe video_id/image_ids'); continue; }
      // Uma cópia nunca reaproveita CUSTOMIZED_USER automaticamente. Só uma
      // identidade BC_AUTH_TT verificável pode acompanhar o anúncio de origem;
      // Spark e identidades legadas caem na BC_AUTH_TT selecionada da conta.
      const srcIdentityType = String(srcAd.identity_type || '').toUpperCase();
      const identity = usableBcIdentity(srcAd) ? bcIdentityPayload(srcAd) : fallbackIdentity;
      if (!identity) {
        throw stepError('identity', 'Nenhuma identidade BC_AUTH_TT elegível para recriar o anúncio ' + srcAdId + '. A cópia foi interrompida antes de publicar o anúncio.', progress, 409);
      }
      adArgs.identity_id = identity.identityId;
      adArgs.identity_type = identity.identityType;
      adArgs.identity_bc_id = identity.identityBcId;
      adArgs.dark_post_status = 'ON';
      if (!usableBcIdentity(srcAd)) {
        const sourceIdentityLabel = ['TT_USER', 'AUTH_CODE'].includes(srcIdentityType)
          ? 'identidade Spark (' + srcIdentityType + ')'
          : 'identidade ' + (srcIdentityType || 'não identificada');
        warnings.push('Anúncio ' + srcAdId + ' usava ' + sourceIdentityLabel + ' — recriado com a identidade BC autorizada da conta');
      }
      const isProductLink = catalogId && (
        String(srcAd.website_type || '').toUpperCase() === 'PRODUCT_LINK'
        || String(srcAd.ad_format || '').toUpperCase() === 'CATALOG_CAROUSEL'
      );
      if (srcAd.landing_page_url && !isProductLink) adArgs.landing_page_url = String(srcAd.landing_page_url).slice(0, 500);
      if (srcAd.call_to_action) adArgs.call_to_action = String(srcAd.call_to_action);
      else if (srcAd.call_to_action_id) adArgs.call_to_action_id = String(srcAd.call_to_action_id);
      if (Array.isArray(srcAd.utm_params) && srcAd.utm_params.length) adArgs.utm_params = srcAd.utm_params;
      if (Array.isArray(srcAd.deeplink_utm_params) && srcAd.deeplink_utm_params.length) adArgs.deeplink_utm_params = srcAd.deeplink_utm_params;
      if (catalogId) adArgs.catalog_id = catalogId;
      if (catalogId) {
        const productSpecific = productSpecificTypeForCopy(srcAd);
        if (!productSpecific.value) {
          throw stepError('ad', 'O anúncio de catálogo ' + srcAdId + ' não expôs o escopo de produtos exigido pelo TikTok', progress, 422);
        }
        adArgs.product_specific_type = productSpecific.value;
        if (productSpecific.inferred) warnings.push('Escopo de produtos do anúncio ' + srcAdId + ' reconstruído como ' + productSpecific.value + ' a partir da seleção salva');
      }
      if (Array.isArray(srcAd.item_group_ids) && srcAd.item_group_ids.length) adArgs.item_group_ids = srcAd.item_group_ids.map(String);
      if (srcAd.product_set_id) adArgs.product_set_id = String(srcAd.product_set_id);
      if (Array.isArray(srcAd.sku_ids) && srcAd.sku_ids.length) adArgs.sku_ids = srcAd.sku_ids.map(String);
      if (Array.isArray(srcAd.product_ids) && srcAd.product_ids.length) adArgs.product_ids = srcAd.product_ids.map(String);
      if (srcAd.music_id) adArgs.music_id = String(srcAd.music_id);
      if (srcAd.shopping_ads_deeplink_type) adArgs.shopping_ads_deeplink_type = String(srcAd.shopping_ads_deeplink_type);
      if (srcAd.shopping_ads_fallback_type) adArgs.shopping_ads_fallback_type = String(srcAd.shopping_ads_fallback_type);
      if (srcAd.shopping_ads_video_package_id) adArgs.shopping_ads_video_package_id = String(srcAd.shopping_ads_video_package_id);
      const adOut = await callTikTokWriteWithRetry('create_tiktok_ad', adArgs, () => warnings.push('Instabilidade temporária do TikTok ao criar o anúncio — nova tentativa automática'));
      const newAdId = String(deepPluck(adOut, 'ad_id') || '');
      if (!newAdId) throw stepError('ad', 'create_tiktok_ad não retornou ad_id na duplicação', progress);
      progress.ads[srcAdId] = newAdId;
      await report({ ...progress });
    }

    // Os creates já receberam DISABLE/PAUSED. Repetimos pelo endpoint de
    // status: se um default do TikTok ignorar o estado inicial, a cópia ainda
    // termina integralmente pausada antes de o job ser concluído.
    await setCampaignStatus(adv, [progress.campaignId], 'paused');
    const duplicatedGroupIds = Object.values(progress.adGroups);
    const duplicatedAdIds = Object.values(progress.ads);
    if (duplicatedGroupIds.length) await setAdGroupStatus(adv, duplicatedGroupIds, 'paused');
    if (duplicatedAdIds.length) await setAdStatus(adv, duplicatedAdIds, 'paused');
    cacheBust('tree:');
    return {
      campaignId: progress.campaignId,
      adGroupIds: duplicatedGroupIds,
      adIds: duplicatedAdIds,
      name: newName,
      warnings,
    };
  } catch (err) {
    // Cópia parcial NUNCA fica entregável: pausa best-effort e devolve progresso.
    try { await setCampaignStatus(adv, [progress.campaignId], 'paused'); } catch (_) { /* best-effort */ }
    if (!err.step) err.step = 'adgroup';
    err.createdIds = progress;
    throw err;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// F5 — Spark Ads (impulsionar post orgânico existente).
// O MCP NÃO tem conversão "Spark Code → tiktok_item_id" (verificado no dump
// completo dos 74 tools). O fluxo documentado é: get_tiktok_identities →
// get_tiktok_identity_videos → create_tiktok_ad com tiktok_item_id.
// Identidades AUTH_CODE são criadores cujo Spark Code JÁ foi resgatado no
// TikTok Ads Manager — os posts deles aparecem no mesmo seletor. Colar código
// cru não é suportado: a rota explica como resgatar (422 honesto).
// ════════════════════════════════════════════════════════════════════════════

// Identidades utilizáveis para Spark (TT_USER preferida > AUTH_CODE > BC_AUTH_TT).
async function listSparkIdentities(advertiserId) {
  const adv = String(advertiserId || '').trim();
  if (!adv) throw badRequest('advertiserId é obrigatório');
  const out = await pipeboard.callTool('get_tiktok_identities', { advertiser_id: adv });
  const list = firstArray(out, ['identities', 'identity_list', 'list', 'data']);
  const RANK = { TT_USER: 0, AUTH_CODE: 1, BC_AUTH_TT: 2 };
  return list
    .map((i) => ({
      identityId: String(i.identity_id || i.id || ''),
      identityType: String(i.identity_type || '').toUpperCase(),
      displayName: String(i.display_name || i.identity_name || i.username || '') || undefined,
      avatarUrl: String(i.profile_image || i.avatar_icon_web_uri || i.avatar_url || '') || undefined,
      bcId: String(i.identity_authorized_bc_id || i.bc_id || '') || undefined,
    }))
    .filter((i) => i.identityId && RANK[i.identityType] !== undefined)
    .sort((a, b) => RANK[a.identityType] - RANK[b.identityType]);
}

// Posts (vídeos orgânicos) de uma identidade — é daqui que sai o tiktok_item_id.
async function listIdentityVideos(advertiserId, identityId, identityType, bcId) {
  const adv = String(advertiserId || '').trim();
  const type = String(identityType || '').toUpperCase();
  if (!adv || !identityId) throw badRequest('advertiserId e identityId são obrigatórios');
  if (!['TT_USER', 'AUTH_CODE', 'BC_AUTH_TT'].includes(type)) throw badRequest('identityType deve ser TT_USER, AUTH_CODE ou BC_AUTH_TT');
  const args = { advertiser_id: adv, identity_id: String(identityId), identity_type: type };
  if (type === 'BC_AUTH_TT') {
    if (!bcId) throw badRequest('identityType BC_AUTH_TT exige o Business Center (bcId)');
    args.identity_authorized_bc_id = String(bcId);
  }
  const out = await pipeboard.callTool('get_tiktok_identity_videos', args);
  const list = firstArray(out, ['videos', 'video_list', 'items', 'list', 'data']);
  return list.map((v) => ({
    itemId: String(v.item_id || v.tiktok_item_id || v.video_id || v.id || ''),
    text: String(v.text || v.title || v.video_title || '') || undefined,
    coverUrl: String(v.video_cover_url || v.cover_url || v.thumbnail_url || '') || undefined,
    createTime: v.create_time || v.created_at || undefined,
    duration: Number(v.duration) || undefined,
  })).filter((v) => v.itemId);
}

// Campanha Spark completa: campaign → adgroup → create_tiktok_ad com
// identity + tiktok_item_id (SEM upload — o criativo é o post orgânico).
// Mesmos guarda-corpos da F1: pré-requisitos antes de criar, tudo nasce
// PAUSED, falha parcial pausa a campanha órfã e propaga step + createdIds.
async function createSparkAd(advertiserId, spec) {
  const adv = String(advertiserId || '').trim();
  if (!adv) throw badRequest('advertiserId é obrigatório');
  const s = spec || {};
  if (!String(s.name || '').trim()) throw badRequest('Nome da campanha é obrigatório');
  if (!SPARK_GOALS.has(s.goal)) throw badRequest('Objetivo "' + s.goal + '" não suportado para Spark Ads');
  const goal = GOAL_MAP[s.goal];
  const pixelId = String(s.pixelId || '').trim();
  if (!/^\d{5,30}$/.test(pixelId)) throw badRequest('Spark de conversão exige um Pixel TikTok vinculado');
  const pixelEvent = String(s.customEventType || 'ON_WEB_ORDER').trim().toUpperCase();
  if (pixelEvent !== 'ON_WEB_ORDER') throw badRequest('Spark de conversão usa Compra concluída (ON_WEB_ORDER)');
  if (!/^https:\/\/[^\s]+/.test(String(s.linkUrl || ''))) throw badRequest('Spark de conversão exige a URL HTTPS de destino');
  const budgetAmount = Number(s.budgetAmount);
  if (!(budgetAmount >= TIKTOK_MIN_BUDGET)) throw badRequest('O orçamento mínimo aceito pelo TikTok é ' + TIKTOK_MIN_BUDGET);
  let endDate;
  if (s.budgetType === 'lifetime') {
    endDate = /^\d{4}-\d{2}-\d{2}/.test(String(s.endDate || '')) ? String(s.endDate).slice(0, 10) : '';
    const endAt = endDate ? new Date(endDate + 'T23:59:59Z').getTime() : NaN;
    if (!endDate || !Number.isFinite(endAt) || endAt <= Date.now() + 60 * 60 * 1000) {
      throw badRequest('Orçamento total exige uma data de término futura (endDate)');
    }
  }
  const identityId = String(s.identityId || '').trim();
  const identityType = String(s.identityType || '').toUpperCase();
  const itemId = String(s.itemId || '').trim();
  if (!identityId || !itemId) throw badRequest('identityId e itemId (post) são obrigatórios — selecione a identidade e o vídeo');
  if (!['TT_USER', 'AUTH_CODE', 'BC_AUTH_TT'].includes(identityType)) throw badRequest('identityType deve ser TT_USER, AUTH_CODE ou BC_AUTH_TT');
  if (identityType === 'BC_AUTH_TT' && !s.bcId) throw badRequest('identityType BC_AUTH_TT exige o Business Center (bcId)');
  const warnings = [];
  const createdIds = {};

  const [info, regions] = await Promise.all([
    getAdvertiserInfo(adv),
    resolveLocationIds(adv, (s.countries && s.countries.length ? s.countries : ['PT']), goal.objective),
  ]);
  if (regions.missingCountries.length) warnings.push('Países sem região equivalente no TikTok (ignorados): ' + regions.missingCountries.join(', '));

  const campOut = await pipeboard.callTool('create_tiktok_campaign', {
    advertiser_id: adv,
    campaign_name: String(s.name).slice(0, 512),
    objective_type: goal.objective,
  });
  const campaignId = String(deepPluck(campOut, 'campaign_id') || '');
  if (!campaignId) throw stepError('campaign', 'create_tiktok_campaign não retornou campaign_id');
  createdIds.campaignId = campaignId;

  try {
    const adgroupArgs = {
      advertiser_id: adv,
      campaign_id: campaignId,
      adgroup_name: String(s.name).slice(0, 500) + ' — grupo 1',
      optimization_goal: goal.optimizationGoal,
      budget_mode: s.budgetType === 'lifetime' ? 'BUDGET_MODE_TOTAL' : 'BUDGET_MODE_DAY',
      budget: budgetAmount,
      schedule_start_time: advertiserLocalTime(info && info.timezone),
      targeting: { location_ids: regions.locationIds },
      bid_type: 'BID_TYPE_NO_BID',
      pixel_id: pixelId,
      optimization_event: pixelEvent,
    };
    if (endDate) adgroupArgs.schedule_end_time = endDate + ' 23:59:59';
    const agOut = await pipeboard.callTool('create_tiktok_adgroup', adgroupArgs);
    const adGroupId = String(deepPluck(agOut, 'adgroup_id') || '');
    if (!adGroupId) throw stepError('adgroup', 'create_tiktok_adgroup não retornou adgroup_id', createdIds);
    createdIds.adGroupId = adGroupId;

    const adArgs = {
      advertiser_id: adv,
      adgroup_id: adGroupId,
      ad_name: String(s.name).slice(0, 500),
      ad_format: 'SINGLE_VIDEO',
      ad_text: String(s.body || s.name).slice(0, 100),
      identity_id: identityId,
      identity_type: identityType,
      tiktok_item_id: itemId,
      status: 'PAUSED',
    };
    if (identityType === 'BC_AUTH_TT') { adArgs.identity_bc_id = String(s.bcId); adArgs.dark_post_status = 'ON'; }
    if (s.linkUrl) adArgs.landing_page_url = String(s.linkUrl).slice(0, 500);
    if (s.callToAction) adArgs.call_to_action = String(s.callToAction);
    const adOut = await pipeboard.callTool('create_tiktok_ad', adArgs);
    const adId = String(deepPluck(adOut, 'ad_id') || '');
    if (!adId) throw stepError('ad', 'create_tiktok_ad não retornou ad_id', createdIds);
    createdIds.adId = adId;

    warnings.push('Criado em PAUSED — ative na dashboard quando estiver pronto');
    cacheBust('tree:');
    return { ...createdIds, itemId, name: s.name, warnings };
  } catch (err) {
    try { await setCampaignStatus(adv, [campaignId], 'paused'); } catch (_) { /* best-effort */ }
    if (!err.step) err.step = 'adgroup';
    err.createdIds = createdIds;
    throw err;
  }
}

// ── Catálogos de produtos (TikTok Shopping / Dynamic Product Ads) ────────────
// Fronteira sobre as tools de catálogo do Pipeboard. Todas exigem o Business
// Center (bc_id): o TikTok prende catálogos ao BC, não ao advertiser. O ID é
// resolvido da seleção persistida e, quando ela não existe, das identidades
// BC_AUTH_TT que o próprio TikTok devolve para a conta de anúncios.
const ENV_DEFAULT_BC = String(process.env.TIKTOK_BC_ID || process.env.PIPEBOARD_BC_ID || '').trim();
// Tipos aceitos pelo TikTok em create_tiktok_catalog (API atual). O antigo
// PRODUCT_CATALOG/HOTEL_CATALOG/... foi descontinuado — mapeamos os legados
// para os novos valores para não quebrar catálogos já gravados no banco.
const CATALOG_TYPES = ['ECOM', 'HOTEL', 'FLIGHT', 'AUTO_VEHICLE', 'AUTO_MODEL', 'COMIC', 'DESTINATION', 'ENTERTAINMENT', 'HOME_LISTING', 'MINI_SERIES', 'RECRUITMENT'];
const LEGACY_CATALOG_TYPES = { PRODUCT_CATALOG: 'ECOM', HOTEL_CATALOG: 'HOTEL', FLIGHT_CATALOG: 'FLIGHT', VEHICLE_CATALOG: 'AUTO_VEHICLE' };
function normalizeCatalogType(value) {
  const t = String(value || '').trim().toUpperCase();
  if (LEGACY_CATALOG_TYPES[t]) return LEGACY_CATALOG_TYPES[t];
  return CATALOG_TYPES.includes(t) ? t : 'ECOM';
}

function getBusinessCenterId(accountId, advertiserId) {
  const st = getState(accountId);
  const scope = String(advertiserId || '').trim();
  const scoped = st.bcByAdvertiser && typeof st.bcByAdvertiser === 'object' ? st.bcByAdvertiser : {};
  if (scope && String(scoped[scope] || '').trim()) return String(scoped[scope]).trim();
  return String(st.bcId || '').trim() || ENV_DEFAULT_BC;
}
function businessCenterFromEnv(accountId, advertiserId) {
  // true quando o bc_id efetivo vem só do env (nem o escopo nem o legado gravaram).
  const st = getState(accountId);
  const scope = String(advertiserId || '').trim();
  const scoped = st.bcByAdvertiser && typeof st.bcByAdvertiser === 'object' ? st.bcByAdvertiser : {};
  return !(scope && String(scoped[scope] || '').trim()) && !String(st.bcId || '').trim() && !!ENV_DEFAULT_BC;
}
function setBusinessCenterId(accountId, advertiserId, bcId) {
  // Compatibilidade com chamadas antigas setBusinessCenterId(accountId, bcId).
  if (bcId === undefined) {
    bcId = advertiserId;
    advertiserId = '';
  }
  const clean = String(bcId || '').trim().slice(0, 40);
  const scope = String(advertiserId || '').trim().slice(0, 120);
  if (!scope) setState(accountId, { bcId: clean });
  else {
    const st = getState(accountId);
    const bcByAdvertiser = Object.assign({}, st.bcByAdvertiser && typeof st.bcByAdvertiser === 'object' ? st.bcByAdvertiser : {});
    if (clean) bcByAdvertiser[scope] = clean;
    else delete bcByAdvertiser[scope];
    setState(accountId, { bcByAdvertiser });
  }
  return clean;
}

async function listCatalogBusinessCenters(advertiserId) {
  const adv = String(advertiserId || '').trim();
  if (!adv) throw badRequest('advertiserId é obrigatório');
  const out = await pipeboard.callTool('get_tiktok_identities', { advertiser_id: adv });
  const rows = firstArray(out, ['identities', 'identity_list', 'items', 'list', 'data']);
  const centers = new Map();
  for (const row of rows) {
    if (String(row.identity_type || '').trim().toUpperCase() !== 'BC_AUTH_TT') continue;
    const id = textField(row.identity_authorized_bc_id, row.identity_bc_id, row.bc_id);
    if (!/^\d{6,30}$/.test(id)) continue;
    const current = centers.get(id) || { id, identityCount: 0, labels: [] };
    current.identityCount += 1;
    const label = textField(row.display_name, row.identity_name, row.username);
    if (label && !current.labels.includes(label)) current.labels.push(label);
    centers.set(id, current);
  }
  return Array.from(centers.values()).map((center) => ({
    id: center.id,
    identityCount: center.identityCount,
    label: center.labels.join(', ') || undefined,
  }));
}

// Normaliza o overview de auditoria (get_tiktok_catalog_overview). Os nomes de
// campo variam entre versões da API — plucka defensivamente aprovados/pendentes/
// reprovados/total de qualquer forma que venham.
function normalizeCatalogOverview(out) {
  const num = (...cands) => {
    for (const c of cands) { const v = deepPluck(out, c); if (v !== undefined && v !== null && v !== '') return Number(v) || 0; }
    return 0;
  };
  return {
    // O endpoint vivo do Pipeboard devolve approved_products/pending_products/
    // disapproved_products/total_products. Mantemos os aliases de versões
    // anteriores, mas nunca zeramos uma auditoria válida só por trocar o nome
    // do campo no conector.
    approved: num('approved', 'approved_count', 'approved_products', 'pass', 'pass_count', 'available'),
    pending: num('pending', 'pending_count', 'pending_products', 'processing', 'in_review', 'reviewing'),
    rejected: num('disapproved', 'disapproved_products', 'rejected', 'rejected_count', 'fail', 'fail_count', 'unavailable'),
    total: num('total', 'total_count', 'total_products', 'product_count'),
    raw: out,
  };
}

// Leitura diagnóstica dos feeds remotos. O upload direto por arquivo usa
// `/catalog/product/file/` e pode legitimamente não criar um feed recorrente;
// portanto `total=0` nunca é tratado sozinho como falha de publicação.
function normalizeCatalogFeeds(out) {
  const feeds = firstArray(out, ['feeds', 'feed_list', 'catalog_feeds', 'list']);
  const totalValue = deepPluck(out, 'total') ?? deepPluck(out, 'total_count') ?? deepPluck(out, 'total_feeds');
  return {
    total: totalValue == null || totalValue === '' ? feeds.length : Number(totalValue) || 0,
    feeds,
    raw: out,
  };
}

let catalogCapabilitiesCache = null;
const CATALOG_CAPABILITIES_TTL_MS = 60 * 1000;

// A automação de catálogo usa um contrato central diferente da criação comum.
// Só a liberamos quando o schema MCP confirma os campos que tornam Product Link
// inequívoco nos três níveis. O formato principal é SINGLE_VIDEO com áudio
// embutido; vídeo e capa são enviados pela dashboard e o campo obrigatório
// `vertical_video_strategy` precisa existir no conector antes da 1ª escrita.
const CATALOG_CAMPAIGN_SCHEMA_FIELDS = {
  campaign: [
    'advertiser_id', 'campaign_name', 'objective_type', 'product_source',
    'shopping_ads_type', 'catalog_id', 'operation_status', 'budget_mode', 'budget',
  ],
  adgroup: [
    'advertiser_id', 'campaign_id', 'adgroup_name', 'promotion_type',
    'shopping_ads_type', 'shopping_ads_retargeting_type', 'product_source',
    'catalog_id', 'catalog_authorized_bc_id', 'optimization_goal',
    'billing_event', 'placement_type', 'placements',
    'schedule_start_time', 'schedule_end_time', 'targeting',
    'operation_status', 'pixel_id', 'optimization_event', 'budget_mode', 'budget',
    'bid_type', 'delivery_mode',
  ],
  ad: [
    'advertiser_id', 'adgroup_id', 'ad_name', 'ad_format', 'catalog_id',
    'product_specific_type', 'item_group_ids', 'product_set_id', 'ad_text', 'status',
    'vertical_video_strategy', 'video_id', 'image_ids', 'call_to_action',
    'identity_id', 'identity_type', 'identity_authorized_bc_id', 'dark_post_status',
  ],
};

const CATALOG_CAMPAIGN_GUARANTEED_FIELDS = {
  campaign: ['advertiser_id', 'campaign_name', 'objective_type', 'product_source', 'shopping_ads_type', 'catalog_id', 'operation_status'],
  adgroup: [
    'advertiser_id', 'campaign_id', 'adgroup_name', 'promotion_type', 'shopping_ads_type',
    'shopping_ads_retargeting_type', 'product_source',
    'catalog_id', 'catalog_authorized_bc_id', 'optimization_goal', 'billing_event',
    'placement_type', 'placements', 'schedule_start_time', 'targeting', 'operation_status', 'pixel_id',
    'optimization_event', 'budget_mode', 'budget', 'bid_type', 'delivery_mode',
  ],
  ad: [
    'advertiser_id', 'adgroup_id', 'ad_name', 'ad_format', 'catalog_id',
    'product_specific_type', 'ad_text', 'status', 'vertical_video_strategy',
    'video_id', 'image_ids', 'call_to_action',
    'identity_id', 'identity_type', 'identity_authorized_bc_id', 'dark_post_status',
  ],
};

// As tools do Pipeboard mudam independentemente deste repositório. Ter uma
// função JS com o nome certo não significa que o schema MCP aceite os campos
// necessários. Este preflight lê os schemas reais e só libera fluxos que
// conseguem chegar até o fim sem criar estruturas parciais no TikTok.
async function getCatalogCapabilities({ force = false } = {}) {
  const now = Date.now();
  if (!force && catalogCapabilitiesCache && catalogCapabilitiesCache.expiresAt > now) {
    return catalogCapabilitiesCache.value;
  }
  const unavailable = {
    catalogCreate: false,
    catalogUpload: false,
    catalogUploadStatus: false,
    catalogAudit: false,
    catalogFeedRead: false,
    catalogLinkVerify: false,
    manualCatalogCampaign: false,
    catalogSingleVideoCampaign: false,
    catalogCarouselMusic: false,
    automaticVideoCover: false,
    automaticPurchaseEvent: false,
    catalogCostCap: false,
    catalogAcceleratedDelivery: false,
    bidStrategies: ['lowest_cost'],
    deliveryModes: ['standard'],
    productSpecificType: false,
    productSets: false,
    specificProducts: false,
    catalogVideoTemplates: false,
    adText: false,
    callToAction: false,
    optimizationEvents: [],
    callToActions: [],
    structuralReadback: false,
    shoppingAdsType: null,
    adFormat: null,
    blockers: ['PIPEBOARD_CAPABILITIES_UNAVAILABLE'],
    note: 'Não foi possível confirmar as capacidades atuais do Pipeboard.',
  };
  if (!pipeboard.enabled || typeof pipeboard.listTools !== 'function') return unavailable;
  try {
    const listed = await pipeboard.listTools();
    const tools = Array.isArray(listed && listed.tools) ? listed.tools : [];
    const byName = new Map(tools.map((tool) => [String(tool && tool.name || ''), tool]));
    const fields = (name) => {
      const tool = byName.get(name) || {};
      const schema = tool.inputSchema || tool.input_schema || {};
      return new Set(Object.keys(schema.properties || {}));
    };
    const fieldSchema = (name, field) => {
      const tool = byName.get(name) || {};
      const schema = tool.inputSchema || tool.input_schema || {};
      const properties = schema && schema.properties && typeof schema.properties === 'object'
        ? schema.properties : {};
      return properties[field] || null;
    };
    const toolSchema = (name) => {
      const tool = byName.get(name) || {};
      return tool.inputSchema || tool.input_schema || {};
    };
    // A simples presença de um campo não prova que a tool aceita o valor
    // necessário: um schema amplo poderia rejeitá-lo depois de criar campanha
    // e ad group. Exigimos declaração explícita por enum/const ou, nos campos
    // pass-through documentados pelo Pipeboard, pela descrição da própria tool.
    const supportsSchemaValue = (schema, expected, depth = 0) => {
      if (!schema || typeof schema !== 'object' || depth > 8) return false;
      const wanted = String(expected).trim().toUpperCase();
      if (schema.const != null && String(schema.const).trim().toUpperCase() === wanted) return true;
      if (Array.isArray(schema.enum) && schema.enum.some((value) => String(value).trim().toUpperCase() === wanted)) return true;
      return ['anyOf', 'oneOf', 'allOf'].some((key) => Array.isArray(schema[key])
        && schema[key].some((child) => supportsSchemaValue(child, wanted, depth + 1)));
    };
    const schemaValues = (schema, depth = 0, out = new Set()) => {
      if (!schema || typeof schema !== 'object' || depth > 8) return out;
      if (schema.const != null) out.add(String(schema.const).trim().toUpperCase());
      if (Array.isArray(schema.enum)) schema.enum.forEach((value) => out.add(String(value).trim().toUpperCase()));
      ['anyOf', 'oneOf', 'allOf'].forEach((key) => {
        if (Array.isArray(schema[key])) schema[key].forEach((child) => schemaValues(child, depth + 1, out));
      });
      return out;
    };
    // Alguns campos do Pipeboard são pass-through: o schema documenta o valor
    // aceito na descrição, pois é o TikTok que valida o enum. Exigimos a token
    // exata na documentação da própria tool; texto genérico não libera nada.
    const supportsDeclaredValue = (schema, expected) => {
      if (supportsSchemaValue(schema, expected)) return true;
      const token = String(expected || '').trim().toUpperCase();
      const description = String(schema && schema.description || '').toUpperCase();
      return Boolean(token && description.split(/[^A-Z0-9_]+/).includes(token));
    };
    const hasFields = (name, required) => {
      const present = fields(name);
      return required.every((field) => present.has(field));
    };
    const hasNestedFields = (name, field, required) => {
      const schema = fieldSchema(name, field);
      const present = new Set(Object.keys(schema && schema.properties || {}));
      return required.every((nested) => present.has(nested));
    };
    const requiredFieldsAreGuaranteed = (name, guaranteed) => {
      const required = new Set();
      const visit = (schema, depth = 0) => {
        if (!schema || typeof schema !== 'object' || depth > 8) return;
        if (Array.isArray(schema.required)) schema.required.forEach((field) => required.add(String(field)));
        ['anyOf', 'oneOf', 'allOf'].forEach((key) => {
          if (Array.isArray(schema[key])) schema[key].forEach((child) => visit(child, depth + 1));
        });
      };
      visit(toolSchema(name));
      const sent = new Set(guaranteed);
      return Array.from(required).every((field) => sent.has(field));
    };
    const catalogCreate = hasFields('create_tiktok_catalog', ['bc_id', 'name', 'catalog_type', 'catalog_conf'])
      && hasNestedFields('create_tiktok_catalog', 'catalog_conf', ['region_code', 'currency'])
      && supportsDeclaredValue(fieldSchema('create_tiktok_catalog', 'catalog_type'), 'ECOM');
    const catalogUploadSubmit = hasFields('upload_tiktok_catalog_products', ['bc_id', 'catalog_id', 'file_url', 'file_format']);
    const catalogUploadStatus = hasFields('get_tiktok_catalog_upload_status', ['bc_id', 'catalog_id', 'feed_log_id']);
    // O recibo de envio sozinho não confirma ingestão. Só anunciamos
    // sincronização quando o conector também expõe o status do feed_log.
    const catalogUpload = catalogUploadSubmit && catalogUploadStatus;
    const catalogAudit = hasFields('get_tiktok_catalog_overview', ['bc_id', 'catalog_id']);
    const catalogFeedRead = hasFields('get_tiktok_catalog_feeds', ['bc_id', 'catalog_id']);
    const catalogLinkVerify = hasFields('get_tiktok_catalogs', ['bc_id']);
    const campaignFields = hasFields('create_tiktok_campaign', CATALOG_CAMPAIGN_SCHEMA_FIELDS.campaign);
    const adgroupFields = hasFields('create_tiktok_adgroup', CATALOG_CAMPAIGN_SCHEMA_FIELDS.adgroup);
    const adgroupInputFields = fields('create_tiktok_adgroup');
    const adFields = hasFields('create_tiktok_ad', CATALOG_CAMPAIGN_SCHEMA_FIELDS.ad);
    const adInputFields = fields('create_tiktok_ad');
    const structuralReadback = ['get_tiktok_campaigns', 'get_tiktok_adgroups', 'get_tiktok_ads']
      .every((name) => byName.has(name));
    const requiredFieldsCompatible = requiredFieldsAreGuaranteed('create_tiktok_campaign', CATALOG_CAMPAIGN_GUARANTEED_FIELDS.campaign)
      && requiredFieldsAreGuaranteed('create_tiktok_adgroup', CATALOG_CAMPAIGN_GUARANTEED_FIELDS.adgroup)
      && requiredFieldsAreGuaranteed('create_tiktok_ad', CATALOG_CAMPAIGN_GUARANTEED_FIELDS.ad);
    const shoppingType = 'VIDEO';
    const adFormat = 'SINGLE_VIDEO';
    const automaticVideoCover = hasFields('upload_tiktok_video', ['advertiser_id', 'video_url'])
      && hasFields('get_tiktok_video_info', ['advertiser_id', 'video_ids'])
      && hasFields('upload_tiktok_image', ['advertiser_id', 'image_url']);
    const automaticPurchaseEvent = hasFields('get_tiktok_pixel_event_stats', ['advertiser_id', 'pixel_ids', 'start_date', 'end_date']);
    const catalogCarouselMusic = false;
    const supportsPassThroughValue = (schema, expected) => {
      if (supportsDeclaredValue(schema, expected)) return true;
      const description = String(schema && schema.description || '').toUpperCase();
      return Boolean(expected && /FORWARDED AS-IS|REPASSAD[OA] COMO|TIKTOK VALIDATES/.test(description));
    };
    // Não basta o campo existir: o schema precisa aceitar os valores que esta
    // implementação realmente envia. Sem isso, um enum incompatível poderia
    // liberar a campanha, criar o primeiro nível e falhar no seguinte.
    const campaignSemantics = [
      ['objective_type', 'PRODUCT_SALES'],
      ['product_source', 'CATALOG'],
      ['shopping_ads_type', shoppingType],
      ['operation_status', 'DISABLE'],
    ].every(([field, expected]) => field === 'shopping_ads_type'
      ? supportsPassThroughValue(fieldSchema('create_tiktok_campaign', field), expected)
      : supportsDeclaredValue(fieldSchema('create_tiktok_campaign', field), expected));
    const adgroupSemantics = [
      ['promotion_type', 'WEBSITE'],
      ['shopping_ads_type', shoppingType],
      ['shopping_ads_retargeting_type', 'OFF'],
      ['product_source', 'CATALOG'],
      ['optimization_goal', 'CONVERT'],
      ['billing_event', 'OCPM'],
      ['placement_type', 'PLACEMENT_TYPE_NORMAL'],
      ['placements', 'PLACEMENT_TIKTOK'],
      ['operation_status', 'DISABLE'],
      ['bid_type', 'BID_TYPE_NO_BID'],
      ['delivery_mode', 'STANDARD'],
    ].every(([field, expected]) => field === 'shopping_ads_type'
      ? supportsPassThroughValue(fieldSchema('create_tiktok_adgroup', field), expected)
      : supportsDeclaredValue(fieldSchema('create_tiktok_adgroup', field), expected));
    const adSemantics = [
      ['ad_format', adFormat],
      ['vertical_video_strategy', 'SINGLE_VIDEO'],
      ['product_specific_type', 'ALL'],
      ['status', 'PAUSED'],
      ['identity_type', 'BC_AUTH_TT'],
      ['dark_post_status', 'ON'],
    ].every(([field, expected]) => field === 'vertical_video_strategy'
      // O schema vivo enumera os valores aceitos na descrição do campo. Só
      // aceitamos o token exato SINGLE_VIDEO; texto genérico/pass-through não
      // libera a primeira escrita da hierarquia.
      ? supportsDeclaredValue(fieldSchema('create_tiktok_ad', field), expected)
      : supportsSchemaValue(fieldSchema('create_tiktok_ad', field), expected));
    const catalogSingleVideoCampaign = campaignFields && adgroupFields && adFields
      && campaignSemantics && adgroupSemantics && adSemantics
      && requiredFieldsCompatible && structuralReadback
      && automaticVideoCover && automaticPurchaseEvent;
    const catalogCostCap = catalogSingleVideoCampaign
      && adgroupInputFields.has('conversion_bid_price')
      && supportsDeclaredValue(fieldSchema('create_tiktok_adgroup', 'bid_type'), 'BID_TYPE_CUSTOM');
    const catalogAcceleratedDelivery = catalogCostCap
      && supportsDeclaredValue(fieldSchema('create_tiktok_adgroup', 'delivery_mode'), 'ACCELERATED');
    // Alias mantido para clientes antigos; agora significa exatamente o fluxo
    // SINGLE_VIDEO/Product Link validado, não o carousel antigo.
    const manualCatalogCampaign = catalogSingleVideoCampaign;
    const optimizationEventSchema = fieldSchema('create_tiktok_adgroup', 'optimization_event');
    const optimizationEvents = Array.from(new Set([
      ...Array.from(schemaValues(optimizationEventSchema)),
      // O campo é pass-through e o TikTok valida o enum. A autorização real
      // vem de get_tiktok_pixel_event_stats, não de uma lista desatualizada na
      // descrição do schema.
      ...(adgroupFields ? TIKTOK_PIXEL_EVENTS : []),
    ]));
    const callToActions = Array.from(schemaValues(fieldSchema('create_tiktok_ad', 'call_to_action')));
    const blockers = [];
    if (!catalogCreate) blockers.push('CATALOG_CREATE_SCHEMA_INCOMPLETE');
    if (!campaignFields || !campaignSemantics) blockers.push('CATALOG_CAMPAIGN_SCHEMA_INCOMPLETE');
    if (!adgroupFields || !adgroupSemantics) blockers.push('CATALOG_ADGROUP_SCHEMA_INCOMPLETE');
    if (!adFields || !adSemantics) blockers.push('CATALOG_AD_SCHEMA_INCOMPLETE');
    if (!requiredFieldsCompatible) blockers.push('CATALOG_REQUIRED_FIELDS_UNSUPPORTED');
    if (!structuralReadback) blockers.push('CATALOG_READBACK_UNAVAILABLE');
    if (!automaticVideoCover) blockers.push('CATALOG_VIDEO_COVER_UNAVAILABLE');
    if (!automaticPurchaseEvent) blockers.push('CATALOG_PURCHASE_EVENT_UNAVAILABLE');
    const value = {
      catalogCreate,
      catalogUpload,
      catalogUploadStatus,
      catalogAudit,
      catalogFeedRead,
      catalogLinkVerify,
      manualCatalogCampaign,
      catalogSingleVideoCampaign,
      catalogCarouselMusic,
      automaticVideoCover,
      automaticPurchaseEvent,
      catalogCostCap,
      catalogAcceleratedDelivery,
      bidStrategies: catalogCostCap ? ['lowest_cost', 'cost_cap'] : ['lowest_cost'],
      deliveryModes: catalogAcceleratedDelivery ? ['standard', 'accelerated'] : ['standard'],
      productSpecificType: adInputFields.has('product_specific_type'),
      structuralReadback,
      shoppingAdsType: manualCatalogCampaign ? shoppingType : null,
      adFormat: manualCatalogCampaign ? adFormat : null,
      blockers,
      productSets: adInputFields.has('product_set_id'),
      specificProducts: adInputFields.has('item_group_ids'),
      catalogVideoTemplates: false,
      adText: adInputFields.has('ad_text'),
      callToAction: adInputFields.has('call_to_action'),
      optimizationEvents,
      callToActions,
      note: manualCatalogCampaign
        ? 'Vídeo de catálogo com áudio próprio, capa automática, Compra e Link individual de cada produto está disponível.'
        : 'A criação de vídeo de catálogo está temporariamente indisponível. Nenhuma estrutura parcial ou URL global será criada.',
    };
    catalogCapabilitiesCache = { value, expiresAt: now + CATALOG_CAPABILITIES_TTL_MS };
    return value;
  } catch (_) {
    return unavailable;
  }
}

function catalogCreationAwaitingConnectorError(message) {
  const err = badRequest(
    message || 'O catálogo foi preparado e aguarda a confirmação do conector para concluir a criação automática.',
    409
  );
  err.code = 'CATALOG_CREATE_CONNECTOR_CONFIRMATION_REQUIRED';
  err.userMessage = err.message;
  err.suggestedAction = 'Mantenha o lote salvo: a dashboard retomará a sincronização automaticamente quando o conector confirmar o contrato do catálogo.';
  err.retryable = true;
  return err;
}

// Cria um catálogo no TikTok. Devolve { catalogId, raw }.
async function createTikTokCatalog(bcId, { name, catalogType, currency, country } = {}) {
  const bc = String(bcId || '').trim();
  if (!bc) throw badRequest('Business Center (bc_id) é obrigatório para criar o catálogo no TikTok', 422);
  const nm = String(name || '').trim().slice(0, 200);
  if (!nm) throw badRequest('Nome do catálogo é obrigatório');
  const capabilities = await getCatalogCapabilities();
  if (!capabilities.catalogCreate) {
    throw catalogCreationAwaitingConnectorError();
  }
  const cur = String(currency || '').trim().toUpperCase();
  const region = String(country || '').trim().toUpperCase();
  if (cur && !/^[A-Z]{3}$/.test(cur)) {
    throw badRequest('Moeda do catálogo inválida — use o código ISO de 3 letras (ex.: BRL)');
  }
  if (region && !/^[A-Z]{2}$/.test(region)) {
    throw badRequest('Região do catálogo inválida — use o código ISO de 2 letras (ex.: BR)');
  }
  const effectiveRegion = region || (cur === 'BRL' ? 'BR' : 'US');
  const effectiveCurrency = cur || (effectiveRegion === 'BR' ? 'BRL' : 'USD');
  const args = {
    bc_id: bc,
    name: nm,
    catalog_type: normalizeCatalogType(catalogType),
    catalog_conf: {
      region_code: effectiveRegion,
      currency: effectiveCurrency,
    },
  };
  // A API atual do TikTok (catalog/create) exige o objeto catalog_conf com
  // region_code + currency. Ele é a única fonte de verdade regional do
  // request; não enviamos aliases soltos que poderiam divergir.
  let out;
  try {
    out = await pipeboard.callTool('create_tiktok_catalog', args);
  } catch (err) {
    const msg = String(err && err.message || '');
    // Se a tool rejeitar catalog_conf, ainda tentamos reutilizar um catálogo
    // remoto com o mesmo nome. Sem um vínculo confiável, o job entra em espera
    // para nova confirmação do conector — nunca convertemos isso numa URL
    // manual ou exigimos uma etapa manual do usuário.
    if (/catalog_conf/i.test(msg)) {
      let existing = null;
      try {
        cacheBust('catalogs:' + bc);
        const list = await listTikTokCatalogs(bc);
        const want = nm.toLowerCase();
        existing = (list || []).find((c) => {
          const cn = String(c.catalog_name || c.name || '').trim().toLowerCase();
          return cn && cn === want;
        }) || null;
      } catch (_) { /* lista é best-effort; cai no erro orientativo abaixo */ }
      const existingId = existing ? String(existing.catalog_id || existing.id || '') : '';
      if (existingId) return { catalogId: existingId, raw: existing, reused: true };
      throw catalogCreationAwaitingConnectorError(
        'O catálogo foi preparado e a criação automática aguarda a confirmação do conector para a configuração regional. A sincronização continuará automaticamente quando essa confirmação estiver disponível.'
      );
    }
    throw err;
  }
  const catalogId = String(deepPluck(out, 'catalog_id') || '');
  if (!catalogId) throw badRequest('O TikTok não retornou o catalog_id ao criar o catálogo', 502);
  cacheBust('catalogs:' + bc);
  return { catalogId, raw: out };
}

// Sobe produtos ao catálogo via URL pública (o feed CSV publicado no Blob).
async function uploadTikTokCatalogProducts(bcId, catalogId, fileUrl, fileFormat) {
  const bc = String(bcId || '').trim();
  const cid = String(catalogId || '').trim();
  if (!bc || !cid) throw badRequest('bc_id e catalog_id são obrigatórios');
  if (!/^https:\/\/[^\s]+/.test(String(fileUrl || ''))) throw badRequest('file_url público (https) é obrigatório');
  return pipeboard.callTool('upload_tiktok_catalog_products', {
    bc_id: bc, catalog_id: cid, file_url: String(fileUrl), file_format: fileFormat === 'XML' ? 'XML' : 'CSV',
  });
}

function normalizeCatalogUploadStatus(out) {
  const raw = out || {};
  const processStatus = String(deepPluck(raw, 'process_status') || deepPluck(raw, 'status') || '').trim().toUpperCase();
  const number = (field) => Math.max(0, Number(deepPluck(raw, field)) || 0);
  const numberFrom = (...fields) => {
    for (const field of fields) {
      const value = deepPluck(raw, field);
      if (value !== undefined && value !== null && value !== '') return Math.max(0, Number(value) || 0);
    }
    return 0;
  };
  const affected = (field) => {
    const value = deepPluck(raw, field);
    return Array.isArray(value) ? value.slice(0, 50).map((entry) => {
      const item = entry && typeof entry === 'object' ? entry : {};
      const products = Array.isArray(item.affected_product_item_list)
        ? item.affected_product_item_list.slice(0, 5).map((product) => ({
          index: Number(product && product.index) || null,
          skuId: textField(product && product.sku_id, product && product.skuId),
          title: textField(product && product.title).slice(0, 120),
        })) : [];
      return {
        field: textField(item.field).slice(0, 120),
        issue: textField(item.issue).slice(0, 300),
        suggestion: textField(item.suggestion).slice(0, 300),
        affectedProductCount: Math.max(0, Number(item.affected_product_count) || products.length),
        products,
      };
    }) : [];
  };
  const errorCount = number('error_count');
  const failed = ['FAIL', 'FAILED'].includes(processStatus) || errorCount > 0;
  const succeeded = processStatus === 'SUCCESS' && !failed;
  const rawErrors = firstArray(raw, ['feed_log_data', 'errors', 'error_list', 'details', 'data']);
  const sampleErrors = rawErrors.slice(0, 10).map((entry) => {
    const item = entry && typeof entry === 'object' ? entry : {};
    return {
      sku: textField(item.sku_id, item.item_id, item.id).slice(0, 80) || undefined,
      message: textField(item.message, item.error, item.reason, item.errmsg).slice(0, 200) || undefined,
    };
  }).filter((entry) => entry.sku || entry.message);
  return {
    feedLogId: String(deepPluck(raw, 'feed_log_id') || ''),
    feedId: String(deepPluck(raw, 'feed_id') || ''),
    processStatus,
    processing: !['SUCCESS', 'FAIL', 'FAILED'].includes(processStatus),
    succeeded,
    failed,
    status: succeeded ? 'success' : failed ? 'failed' : processStatus ? 'processing' : 'unknown',
    addCount: numberFrom('add_count', 'added_count', 'added'),
    updateCount: numberFrom('update_count', 'updated_count', 'updated'),
    deleteCount: numberFrom('delete_count', 'deleted_count', 'deleted'),
    added: numberFrom('added', 'add_count', 'added_count'),
    updated: numberFrom('updated', 'update_count', 'updated_count'),
    deleted: numberFrom('deleted', 'delete_count', 'deleted_count'),
    errorCount,
    warningCount: number('warn_count'),
    errors: affected('error_affected_products'),
    warnings: affected('warn_affected_products'),
    sampleErrors,
  };
}

// O upload é assíncrono. feed_log_id identifica exatamente o arquivo
// enviado e evita confundir produtos antigos do overview com o lote atual.
async function getTikTokCatalogUploadStatus(bcId, catalogId, feedLogId) {
  const bc = String(bcId || '').trim();
  const cid = String(catalogId || '').trim();
  const logId = String(feedLogId || '').trim();
  if (!bc || !cid || !logId) throw badRequest('bc_id, catalog_id e feed_log_id são obrigatórios');
  const out = await pipeboard.callTool('get_tiktok_catalog_upload_status', {
    bc_id: bc, catalog_id: cid, feed_log_id: logId,
  });
  return normalizeCatalogUploadStatus(out);
}

// Overview de auditoria dos produtos (aprovados/pendentes/reprovados).
async function getTikTokCatalogOverview(bcId, catalogId) {
  const bc = String(bcId || '').trim();
  const cid = String(catalogId || '').trim();
  if (!bc || !cid) throw badRequest('bc_id e catalog_id são obrigatórios');
  const out = await pipeboard.callTool('get_tiktok_catalog_overview', { bc_id: bc, catalog_id: cid });
  return normalizeCatalogOverview(out);
}

// Lista feeds remotos apenas para diagnóstico. Zero feeds é compatível com o
// upload direto de arquivo e não substitui a confirmação por overview.
async function getTikTokCatalogFeeds(bcId, catalogId) {
  const bc = String(bcId || '').trim();
  const cid = String(catalogId || '').trim();
  if (!bc || !cid) throw badRequest('bc_id e catalog_id são obrigatórios');
  const out = await pipeboard.callTool('get_tiktok_catalog_feeds', { bc_id: bc, catalog_id: cid });
  return normalizeCatalogFeeds(out);
}

// Lista os catálogos existentes no Business Center (cache curto).
async function listTikTokCatalogs(bcId) {
  const bc = String(bcId || '').trim();
  if (!bc) throw badRequest('Business Center (bc_id) é obrigatório', 422);
  const ck = 'catalogs:' + bc;
  const hit = cacheGet(ck);
  if (hit) return hit;
  // Pagina TODAS as páginas: a verificação de vínculo procura o catálogo pelo
  // ID exato, então um catálogo além da 1ª página levava a um falso
  // "catálogo não encontrado neste Business Center". Teto de 20 páginas × 50
  // (1000 catálogos) como salvaguarda contra loop infinito.
  const PAGE_SIZE = 50;
  const list = [];
  for (let page = 1; page <= 20; page += 1) {
    const out = await pipeboard.callTool('get_tiktok_catalogs', { bc_id: bc, page, page_size: PAGE_SIZE });
    const chunk = firstArray(out, ['catalogs', 'catalog_list', 'list', 'data']);
    if (Array.isArray(chunk) && chunk.length) list.push(...chunk);
    if (!Array.isArray(chunk) || chunk.length < PAGE_SIZE) break;
  }
  return cacheSet(ck, list, 60 * 1000);
}

// Renomeia um catálogo já criado no TikTok (mantém o vínculo em sincronia).
async function updateTikTokCatalogName(bcId, catalogId, name) {
  const bc = String(bcId || '').trim();
  const cid = String(catalogId || '').trim();
  const nm = String(name || '').trim().slice(0, 200);
  if (!bc || !cid) throw badRequest('bc_id e catalog_id são obrigatórios');
  if (!nm) throw badRequest('Novo nome é obrigatório');
  const r = await pipeboard.callTool('update_tiktok_catalog', { bc_id: bc, catalog_id: cid, name: nm });
  cacheBust('catalogs:' + bc);
  return r;
}

// ── Smart+ (campanhas automatizadas do TikTok) ──────────────────────────────
// Smart+ é o tipo de campanha em que o TikTok automatiza targeting, lance,
// orçamento, criativo e posicionamento. Aqui gerimos (listar/pausar/escalar) e
// recorremos de anúncios reprovados — o ÚNICO appeal com API é o de anúncio
// Smart+ (appeal_tiktok_smart_plus_ad); conta suspensa não tem API de recurso.
function mapSmartPlusCampaign(c) {
  const row = c || {};
  const id = String(row.campaign_id || row.id || '');
  return {
    campaignId: id,
    name: String(row.campaign_name || row.name || id),
    objective: String(row.objective_type || ''),
    budget: Number(row.budget || 0),
    budgetMode: String(row.budget_mode || ''),
    budgetOptimizeOn: row.budget_optimize_on === true,
    smartPlusAdgroupMode: String(row.smart_plus_adgroup_mode || ''),
    salesDestination: String(row.sales_destination || ''),
    campaignType: String(row.campaign_type || ''),
    catalogEnabled: row.catalog_enabled === true,
    catalogType: String(row.catalog_type || ''),
    isPromotionalCampaign: row.is_promotional_campaign === true,
    status: tiktokStatusToNode(row.operation_status, row.secondary_status),
    rawStatus: String(row.operation_status || ''),
    secondaryStatus: String(row.secondary_status || ''),
    createTime: String(row.create_time || ''),
    modifyTime: String(row.modify_time || ''),
  };
}

function mapSmartPlusAdGroup(g) {
  const row = g || {};
  const id = String(row.adgroup_id || row.smart_plus_adgroup_id || row.id || '');
  return {
    adGroupId: id,
    name: String(row.adgroup_name || row.name || id),
    campaignId: String(row.campaign_id || ''),
    campaignName: String(row.campaign_name || ''),
    status: tiktokStatusToNode(row.operation_status, row.secondary_status),
    rawStatus: String(row.operation_status || ''),
    secondaryStatus: String(row.secondary_status || ''),
    budget: Number(row.budget || 0),
    budgetMode: String(row.budget_mode || ''),
    bidType: String(row.bid_type || ''),
    bidPrice: Number(row.bid_price || 0),
    conversionBidPrice: Number(row.conversion_bid_price || 0),
    minBudget: Number(row.min_budget || 0),
    roasBid: Number(row.roas_bid || 0),
    billingEvent: String(row.billing_event || ''),
    appId: String(row.app_id || ''),
    catalogId: String(row.catalog_id || ''),
    catalogAuthorizedBcId: String(row.catalog_authorized_bc_id || ''),
    customConversionId: String(row.custom_conversion_id || ''),
    identityAuthorizedBcId: String(row.identity_authorized_bc_id || ''),
    identityId: String(row.identity_id || ''),
    identityType: String(row.identity_type || ''),
    promotionType: String(row.promotion_type || ''),
    promotionTargetType: String(row.promotion_target_type || ''),
    promotionWebsiteType: String(row.promotion_website_type || ''),
    productSource: String(row.product_source || ''),
    optimizationGoal: String(row.optimization_goal || ''),
    optimizationEvent: String(row.optimization_event || ''),
    pixelId: String(row.pixel_id || ''),
    attributionEventCount: Number(row.attribution_event_count || 0),
    clickAttributionWindow: Number(row.click_attribution_window || 0),
    engagedViewAttributionWindow: Number(row.engaged_view_attribution_window || 0),
    viewAttributionWindow: Number(row.view_attribution_window || 0),
    deepBidType: String(row.deep_bid_type || ''),
    deepCpaBid: Number(row.deep_cpabid || 0),
    deepFunnelEventSource: String(row.deep_funnel_event_source || ''),
    deepFunnelEventSourceId: String(row.deep_funnel_event_source_id || ''),
    deepFunnelOptimizationEvent: String(row.deep_funnel_optimization_event || ''),
    deepFunnelOptimizationStatus: String(row.deep_funnel_optimization_status || ''),
    pacing: String(row.pacing || ''),
    placementType: String(row.placement_type || ''),
    placements: Array.isArray(row.placements) ? row.placements.map(String) : [],
    targetingSpec: row.targeting_spec && typeof row.targeting_spec === 'object' ? row.targeting_spec : {},
    scheduleType: String(row.schedule_type || ''),
    scheduleStartTime: String(row.schedule_start_time || ''),
    scheduleEndTime: String(row.schedule_end_time || ''),
    dayparting: String(row.dayparting || ''),
    commentDisabled: row.comment_disabled === true,
    shareDisabled: row.share_disabled === true,
    videoDownloadDisabled: row.video_download_disabled === true,
    suggestionAudienceEnabled: row.suggestion_audience_enabled === true,
    targetingOptimizationMode: String(row.targeting_optimization_mode || ''),
    createTime: String(row.create_time || ''),
    modifyTime: String(row.modify_time || ''),
  };
}

function mapSmartPlusAd(a) {
  const row = a || {};
  const id = String(row.smart_plus_ad_id || row.ad_id || row.id || '');
  const node = tiktokStatusToNode(row.operation_status, row.secondary_status);
  const creativeList = Array.isArray(row.creative_list) ? row.creative_list : [];
  // Na API real, AUCTION_AD reporta `smart_plus_creative_id`; o
  // `ad_material_id` é um identificador de biblioteca e não aparece nas
  // métricas. Preferi-lo junto causaria risco de soma dupla se isso mudar.
  // Usa material apenas como fallback para conectores antigos.
  const smartCreativeIds = creativeList.map((item) => String((item && item.smart_plus_creative_id) || '')).filter(Boolean);
  const materialMetricIds = creativeList.map((item) => String((item && item.ad_material_id) || '')).filter(Boolean);
  const metricEntityIds = [...new Set(smartCreativeIds.length ? smartCreativeIds : materialMetricIds)];
  return {
    adId: id,
    smartPlusAdId: id,
    name: String(row.ad_name || row.name || id),
    campaignId: String(row.campaign_id || ''),
    campaignName: String(row.campaign_name || ''),
    adGroupId: String(row.adgroup_id || ''),
    adGroupName: String(row.adgroup_name || ''),
    status: node,
    rawStatus: String(row.operation_status || ''),
    secondaryStatus: String(row.secondary_status || ''),
    rejected: node === 'rejected',
    rejectionReason: node === 'rejected' ? (String(row.secondary_status || '') || 'Reprovado pelo TikTok') : undefined,
    creativeList,
    materialIds: creativeList.map((item) => String((item && item.ad_material_id) || '')).filter(Boolean),
    metricEntityIds,
    landingPageUrlList: Array.isArray(row.landing_page_url_list) ? row.landing_page_url_list : [],
    adTextList: Array.isArray(row.ad_text_list) ? row.ad_text_list : [],
    callToActionList: Array.isArray(row.call_to_action_list) ? row.call_to_action_list : [],
    deeplinkList: Array.isArray(row.deeplink_list) ? row.deeplink_list : [],
    pageList: Array.isArray(row.page_list) ? row.page_list : [],
    interactiveAddOnList: Array.isArray(row.interactive_add_on_list) ? row.interactive_add_on_list : [],
    adConfiguration: row.ad_configuration && typeof row.ad_configuration === 'object' ? row.ad_configuration : {},
    createTime: String(row.create_time || ''),
    modifyTime: String(row.modify_time || ''),
  };
}

async function listSmartPlusCampaigns(advertiserId, opts = {}) {
  const adv = String(advertiserId || '').trim();
  if (!adv) throw badRequest('advertiserId é obrigatório');
  const filtering = {};
  if (Array.isArray(opts.campaignIds) && opts.campaignIds.length) filtering.campaign_ids = opts.campaignIds.map(String);
  const args = { advertiser_id: adv, ...(Object.keys(filtering).length ? { filtering } : {}) };
  let list = (await listAllPages(
    'get_tiktok_smart_plus_campaigns', args, ['campaigns', 'campaign_list', 'list', 'data'], { pageSize: 100 },
  )).map(mapSmartPlusCampaign);
  if (filtering.campaign_ids) {
    const wanted = new Set(filtering.campaign_ids);
    list = list.filter((item) => wanted.has(item.campaignId));
  }
  return list;
}

async function listSmartPlusAdGroups(advertiserId, opts = {}) {
  const adv = String(advertiserId || '').trim();
  if (!adv) throw badRequest('advertiserId é obrigatório');
  const filtering = {};
  if (Array.isArray(opts.campaignIds) && opts.campaignIds.length) filtering.campaign_ids = opts.campaignIds.map(String);
  if (Array.isArray(opts.adGroupIds) && opts.adGroupIds.length) filtering.adgroup_ids = opts.adGroupIds.map(String);
  const args = { advertiser_id: adv, ...(Object.keys(filtering).length ? { filtering } : {}) };
  let list = (await listAllPages(
    'get_tiktok_smart_plus_adgroups', args, ['adgroups', 'ad_groups', 'adgroup_list', 'list', 'data'], { pageSize: 100 },
  )).map(mapSmartPlusAdGroup);
  if (filtering.campaign_ids) {
    const wanted = new Set(filtering.campaign_ids);
    list = list.filter((item) => wanted.has(item.campaignId));
  }
  if (filtering.adgroup_ids) {
    const wanted = new Set(filtering.adgroup_ids);
    list = list.filter((item) => wanted.has(item.adGroupId));
  }
  return list;
}

async function listSmartPlusAds(advertiserId, opts = {}) {
  const adv = String(advertiserId || '').trim();
  if (!adv) throw badRequest('advertiserId é obrigatório');
  const filtering = {};
  if (opts.campaignId) filtering.campaign_ids = [String(opts.campaignId)];
  if (Array.isArray(opts.campaignIds) && opts.campaignIds.length) filtering.campaign_ids = opts.campaignIds.map(String);
  if (Array.isArray(opts.adGroupIds) && opts.adGroupIds.length) filtering.adgroup_ids = opts.adGroupIds.map(String);
  if (Array.isArray(opts.adIds) && opts.adIds.length) filtering.smart_plus_ad_ids = opts.adIds.map(String);
  const args = { advertiser_id: adv, ...(Object.keys(filtering).length ? { filtering } : {}) };
  let list = (await listAllPages(
    'get_tiktok_smart_plus_ads', args, ['ads', 'ad_list', 'list', 'data'], { pageSize: 100 },
  )).map(mapSmartPlusAd);
  const cid = String(opts.campaignId || '').trim();
  if (cid) list = list.filter((a) => !a.campaignId || a.campaignId === cid);
  return list;
}

// Árvore Smart+ completa. A API padrão também devolve linhas de criativo
// Smart+, mas com semântica de AUCTION_AD; por isso o sync substitui os IDs
// coincidentes por estes nós, que preservam campanha → grupo → asset group.
async function getSmartPlusDashboardTree(advertiserId, currency) {
  const adv = String(advertiserId || '').trim();
  if (!adv) throw badRequest('advertiserId é obrigatório');
  let resolvedCurrency = String(currency || '').trim();
  if (!resolvedCurrency) {
    const info = await getAdvertiserInfo(adv).catch(() => null);
    resolvedCurrency = String((info && info.currency) || 'USD');
  }
  const [campaigns, adGroups, ads] = await Promise.all([
    listSmartPlusCampaigns(adv),
    listSmartPlusAdGroups(adv),
    listSmartPlusAds(adv),
  ]);
  const adsByGroup = new Map();
  for (const ad of ads) {
    const firstText = ad.adTextList[0] || {};
    const firstUrl = ad.landingPageUrlList[0] || {};
    const firstCreative = ad.creativeList[0] || {};
    const creativeInfo = firstCreative.creative_info && typeof firstCreative.creative_info === 'object' ? firstCreative.creative_info : {};
    const node = {
      platformAdId: ad.adId,
      smartPlusAdId: ad.adId,
      campaignKind: 'smart_plus',
      campaignId: ad.campaignId,
      adGroupId: ad.adGroupId,
      name: ad.name,
      status: ad.status,
      platformStatus: ad.rawStatus,
      secondaryStatus: ad.secondaryStatus,
      budget: null,
      metrics: Object.assign({}, EMPTY_METRICS),
      metricEntityIds: ad.metricEntityIds,
      materialIds: ad.materialIds,
      creative: {
        body: String(firstText.ad_text || firstText.text || ''),
        linkUrl: String(firstUrl.landing_page_url || firstUrl.url || ''),
        videoUrl: String(creativeInfo.video_id || creativeInfo.videoId || ''),
        imageUrl: String(creativeInfo.image_id || creativeInfo.imageId || ''),
      },
      rejectionReason: ad.rejectionReason,
      createdAt: ad.createTime || undefined,
    };
    if (!adsByGroup.has(ad.adGroupId)) adsByGroup.set(ad.adGroupId, []);
    adsByGroup.get(ad.adGroupId).push(node);
  }
  const groupsByCampaign = new Map();
  for (const group of adGroups) {
    const node = {
      platformAdSetId: group.adGroupId,
      adSetName: group.name,
      name: group.name,
      campaignKind: 'smart_plus',
      campaignId: group.campaignId,
      status: group.status,
      platformStatus: group.rawStatus,
      secondaryStatus: group.secondaryStatus,
      budget: budgetObj(group.budget, group.budgetMode),
      pixelId: group.pixelId || undefined,
      optimizationEvent: group.optimizationEvent || undefined,
      optimizationGoal: group.optimizationGoal || undefined,
      metrics: Object.assign({}, EMPTY_METRICS),
      ads: adsByGroup.get(group.adGroupId) || [],
    };
    if (!groupsByCampaign.has(group.campaignId)) groupsByCampaign.set(group.campaignId, []);
    groupsByCampaign.get(group.campaignId).push(node);
  }
  return campaigns.map((campaign) => {
    const sets = groupsByCampaign.get(campaign.campaignId) || [];
    const adStatuses = sets.flatMap((set) => (set.ads || []).map((ad) => ad.status));
    const review = deriveReviewStatus(adStatuses);
    const ownStatus = campaign.status;
    let status = ownStatus;
    let childStatus;
    if (ownStatus === 'active' && review === 'in_review') { status = 'pending_review'; childStatus = ownStatus; }
    else if (ownStatus === 'active' && review === 'rejected') { status = 'rejected'; childStatus = ownStatus; }
    const budgetOwner = campaign.budgetOptimizeOn || Number(campaign.budget) > 0 ? 'campaign' : 'adgroup';
    return {
      platformCampaignId: campaign.campaignId,
      campaignName: campaign.name,
      status,
      childStatus,
      campaignKind: 'smart_plus',
      budgetOwner,
      budgetOptimizeOn: campaign.budgetOptimizeOn,
      smartPlusAdgroupMode: campaign.smartPlusAdgroupMode,
      platformCampaignStatus: campaign.rawStatus,
      reviewStatus: review,
      objective: campaign.objective,
      adCount: adStatuses.length,
      adSetCount: sets.length,
      budget: budgetObj(campaign.budget, campaign.budgetMode),
      currency: resolvedCurrency,
      metrics: Object.assign({}, EMPTY_METRICS),
      platformAdAccountId: adv,
      adSets: sets,
    };
  });
}

async function setSmartPlusCampaignStatus(advertiserId, ids, status) {
  const adv = String(advertiserId || '').trim();
  const arr = (Array.isArray(ids) ? ids : [ids]).map((x) => String(x || '').trim()).filter(Boolean);
  if (!adv) throw badRequest('advertiserId é obrigatório');
  if (!arr.length) throw badRequest('Nenhuma campanha Smart+ informada');
  const op = status === 'active' ? 'ENABLE' : status === 'paused' ? 'DISABLE' : status === 'deleted' ? 'DELETE' : '';
  if (!op) throw badRequest('status deve ser active, paused ou deleted');
  const r = await pipeboard.callTool('update_tiktok_smart_plus_campaign_status', { advertiser_id: adv, campaign_ids: arr, operation_status: op });
  cacheBust('tree:');
  return r;
}

async function setSmartPlusAdGroupStatus(advertiserId, ids, status) {
  const adv = String(advertiserId || '').trim();
  const arr = normIds(ids);
  const op = toOperationStatus(status);
  if (!adv || !arr.length) throw badRequest('Advertiser e grupo(s) Smart+ são obrigatórios');
  if (!op) throw badRequest('status deve ser active, paused ou deleted');
  const out = await pipeboard.callTool('update_tiktok_smart_plus_adgroup_status', { advertiser_id: adv, adgroup_ids: arr, operation_status: op });
  cacheBust('tree:');
  return out;
}

async function setSmartPlusAdStatus(advertiserId, ids, status) {
  const adv = String(advertiserId || '').trim();
  const arr = normIds(ids);
  const op = toOperationStatus(status);
  if (!adv || !arr.length) throw badRequest('Advertiser e anúncio(s) Smart+ são obrigatórios');
  if (!op) throw badRequest('status deve ser active, paused ou deleted');
  const out = await pipeboard.callTool('update_tiktok_smart_plus_ad_status', { advertiser_id: adv, smart_plus_ad_ids: arr, operation_status: op });
  cacheBust('tree:');
  return out;
}

async function updateSmartPlusCampaign(advertiserId, campaignId, patch) {
  const adv = String(advertiserId || '').trim();
  const cid = String(campaignId || '').trim();
  if (!adv || !cid) throw badRequest('Advertiser e campanha Smart+ são obrigatórios');
  const value = patch || {};
  const args = { advertiser_id: adv, campaign_id: cid };
  if (value.name && String(value.name).trim()) args.campaign_name = String(value.name).trim().slice(0, 512);
  if (value.budget && Number(value.budget.amount) > 0) args.budget = Number(value.budget.amount);
  if (args.campaign_name === undefined && args.budget === undefined) throw badRequest('Nada para atualizar na campanha Smart+');
  return pipeboard.callTool('update_tiktok_smart_plus_campaign', args);
}

async function updateSmartPlusAdGroup(advertiserId, adGroupId, patch) {
  const adv = String(advertiserId || '').trim();
  const gid = String(adGroupId || '').trim();
  if (!adv || !gid) throw badRequest('Advertiser e grupo Smart+ são obrigatórios');
  const value = patch || {};
  const args = { advertiser_id: adv, adgroup_id: gid };
  if (value.name && String(value.name).trim()) args.adgroup_name = String(value.name).trim().slice(0, 512);
  if (value.budget && Number(value.budget.amount) > 0) args.budget = Number(value.budget.amount);
  for (const key of ['bid_price', 'conversion_bid_price', 'min_budget', 'roas_bid']) {
    if (Number(value[key]) > 0) args[key] = Number(value[key]);
  }
  if (args.adgroup_name === undefined && args.budget === undefined
    && args.bid_price === undefined && args.conversion_bid_price === undefined
    && args.min_budget === undefined && args.roas_bid === undefined) {
    throw badRequest('Nada para atualizar no grupo Smart+');
  }
  return pipeboard.callTool('update_tiktok_smart_plus_adgroup', args);
}

async function updateSmartPlusAd(advertiserId, adId, patch) {
  const adv = String(advertiserId || '').trim();
  const aid = String(adId || '').trim();
  if (!adv || !aid) throw badRequest('Advertiser e anúncio Smart+ são obrigatórios');
  const value = patch || {};
  const args = { advertiser_id: adv, smart_plus_ad_id: aid };
  if (value.name && String(value.name).trim()) args.ad_name = String(value.name).trim().slice(0, 512);
  if (Array.isArray(value.creativeList)) args.creative_list = value.creativeList;
  if (Array.isArray(value.landingPageUrlList)) args.landing_page_url_list = value.landingPageUrlList;
  if (Array.isArray(value.adTextList)) args.ad_text_list = value.adTextList;
  if (Array.isArray(value.callToActionList)) args.call_to_action_list = value.callToActionList;
  if (value.adConfiguration && typeof value.adConfiguration === 'object') args.ad_configuration = value.adConfiguration;
  if (Object.keys(args).length === 2) throw badRequest('Nada para atualizar no anúncio Smart+');
  return pipeboard.callTool('update_tiktok_smart_plus_ad', args);
}

async function setSmartPlusAdMaterialStatus(advertiserId, adId, materialIds, status) {
  const adv = String(advertiserId || '').trim();
  const aid = String(adId || '').trim();
  const ids = normIds(materialIds);
  const op = toOperationStatus(status);
  if (!adv || !aid || !ids.length) throw badRequest('Advertiser, anúncio e materiais Smart+ são obrigatórios');
  if (!['ENABLE', 'DISABLE'].includes(op)) throw badRequest('status do material deve ser active ou paused');
  return pipeboard.callTool('update_tiktok_smart_plus_ad_material_status', {
    advertiser_id: adv, smart_plus_ad_id: aid, ad_material_ids: ids, operation_status: op,
  });
}

async function appealSmartPlusAd(advertiserId, adId, reason, attachments) {
  const adv = String(advertiserId || '').trim();
  const id = String(adId || '').trim();
  if (!adv || !id) throw badRequest('advertiserId e o ID do anúncio Smart+ são obrigatórios');
  const args = { advertiser_id: adv, smart_plus_ad_id: id };
  const r = String(reason || '').trim();
  if (r) args.appeal_reason = r.slice(0, 2000);
  const list = (Array.isArray(attachments) ? attachments : []).map((item) => String(item || '').trim()).filter(Boolean).slice(0, 20);
  if (list.length) args.attachment_list = list;
  return pipeboard.callTool('appeal_tiktok_smart_plus_ad', args);
}

// Mapa objetivo (UI) → campos reais do Smart+ (schemas confirmados via MCP).
// Foco no funil de site do gestor de tráfego: conversões (pixel) e tráfego.
const SMART_PLUS_GOALS = {
  conversions: { objective: 'WEB_CONVERSIONS', promotion: 'WEBSITE', optimization: 'CONVERT', billing: 'OCPM', salesDestination: 'WEBSITE' },
};

// Cria uma campanha Smart+ completa (campanha → ad group → vídeo → asset group).
// Smart+ usa orçamento TOTAL no nível campanha (o TikTok liga budget_optimize_on
// sozinho); o ad group exige janela com término. Tudo nasce PAUSADO (DISABLE) —
// nada veicula até revisão humana. Falha no meio pausa a campanha e reporta o
// passo (mesmo padrão à prova de órfãos do createFullAd).
async function createSmartPlusCampaign(advertiserId, spec) {
  const adv = String(advertiserId || '').trim();
  if (!adv) throw badRequest('advertiserId é obrigatório');
  const s = spec || {};
  const g = SMART_PLUS_GOALS[s.goal];
  if (!g) throw badRequest('Smart+ no ROI-NADOS aceita somente conversão');
  if (!/^https:\/\/[^\s]+/.test(String(s.videoUrl || ''))) throw badRequest('Vídeo (URL https) é obrigatório');
  if (!/^https:\/\/[^\s]+/.test(String(s.coverUrl || ''))) throw badRequest('Capa do vídeo (URL https) é obrigatória para Smart+');
  if (!/^https:\/\/[^\s]+/.test(String(s.linkUrl || ''))) throw badRequest('Link de destino (URL https) é obrigatório para Smart+');
  const budget = Number(s.budgetAmount);
  if (!(budget >= TIKTOK_MIN_BUDGET)) throw badRequest('O orçamento mínimo aceito pelo TikTok é ' + TIKTOK_MIN_BUDGET + ' no total');
  if (!/^\d{5,30}$/.test(String(s.pixelId || ''))) {
    throw badRequest('Conversões exigem o Pixel ID NUMÉRICO do TikTok');
  }
  if (String(s.customEventType || '').toUpperCase() !== 'ON_WEB_ORDER') {
    throw badRequest('Conversões exigem o evento de otimização do Pixel');
  }
  const endDate = /^\d{4}-\d{2}-\d{2}/.test(String(s.endDate || '')) ? String(s.endDate).slice(0, 10) : null;
  if (!endDate) throw badRequest('Smart+ usa orçamento total — informe a data de término (endDate)');
  const endAt = new Date(endDate + 'T23:59:59Z').getTime();
  if (!Number.isFinite(endAt) || endAt <= Date.now() + 60 * 60 * 1000) {
    throw badRequest('A data de término da Smart+ precisa estar no futuro');
  }

  const [info, identity, regions] = await Promise.all([
    getAdvertiserInfo(adv),
    pickAdIdentity(adv),
    resolveLocationIds(adv, (s.countries && s.countries.length ? s.countries : ['BR']), g.objective),
  ]);
  const warnings = [];
  if (regions.missingCountries.length) warnings.push('Países sem região no TikTok (ignorados): ' + regions.missingCountries.join(', '));
  const createdIds = {};

  // 1) Campanha Smart+ (DISABLE)
  const campArgs = {
    advertiser_id: adv,
    campaign_name: String(s.name).slice(0, 512),
    objective_type: g.objective,
    budget_mode: 'BUDGET_MODE_TOTAL',
    budget,
    operation_status: 'DISABLE',
  };
  if (g.salesDestination) campArgs.sales_destination = g.salesDestination;
  const campOut = await pipeboard.callTool('create_tiktok_smart_plus_campaign', campArgs);
  const campaignId = String(deepPluck(campOut, 'campaign_id') || '');
  if (!campaignId) throw stepError('campaign', 'create_tiktok_smart_plus_campaign não retornou campaign_id');
  createdIds.campaignId = campaignId;

  try {
    // 2) Ad group Smart+ (targeting automático; janela obrigatória p/ TOTAL)
    const agArgs = {
      advertiser_id: adv,
      campaign_id: campaignId,
      adgroup_name: String(s.name).slice(0, 500) + ' — grupo 1',
      promotion_type: g.promotion,
      targeting_spec: { location_ids: regions.locationIds },
      schedule_type: 'SCHEDULE_START_END',
      schedule_start_time: advertiserLocalTime(info && info.timezone),
      schedule_end_time: endDate + ' 23:59:59',
      optimization_goal: g.optimization,
      billing_event: g.billing,
      targeting_optimization_mode: 'AUTOMATIC',
      operation_status: 'DISABLE',
    };
    agArgs.pixel_id = String(s.pixelId);
    agArgs.optimization_event = 'ON_WEB_ORDER';
    if (identity.identityId) {
      agArgs.identity_id = identity.identityId;
      agArgs.identity_type = identity.identityType;
      if (identity.identityBcId) agArgs.identity_authorized_bc_id = identity.identityBcId;
    }
    const agOut = await pipeboard.callTool('create_tiktok_smart_plus_adgroup', agArgs);
    const adGroupId = String(deepPluck(agOut, 'adgroup_id') || '');
    if (!adGroupId) throw stepError('adgroup', 'create_tiktok_smart_plus_adgroup não retornou adgroup_id', createdIds);
    createdIds.adGroupId = adGroupId;

    // 3) Vídeo + capa. O schema Smart+ exige image_info mesmo para vídeo.
    const videoId = await uploadVideoAndWait(adv, String(s.videoUrl), createdIds);
    createdIds.videoId = videoId;
    const coverId = await uploadImage(adv, String(s.coverUrl), createdIds);
    createdIds.coverId = coverId;

    // 4) Asset group (anúncio) — identidade DENTRO do creative_info (schema real)
    const creativeInfo = {
      ad_format: 'SINGLE_VIDEO',
      video_info: { video_id: videoId },
      image_info: [{ web_uri: coverId }],
    };
    if (identity.identityId) {
      creativeInfo.identity_id = identity.identityId;
      creativeInfo.identity_type = identity.identityType;
      if (identity.identityBcId) creativeInfo.identity_authorized_bc_id = identity.identityBcId;
      if (identity.darkPost) creativeInfo.dark_post_status = 'ON';
    }
    const adArgs = {
      advertiser_id: adv,
      adgroup_id: adGroupId,
      ad_name: String(s.name).slice(0, 500),
      creative_list: [{ creative_info: creativeInfo }],
      operation_status: 'DISABLE',
    };
    if (s.body) adArgs.ad_text_list = [{ ad_text: String(s.body).slice(0, 100) }];
    if (s.callToAction) adArgs.call_to_action_list = [{ call_to_action: String(s.callToAction) }];
    if (s.linkUrl) adArgs.landing_page_url_list = [{ landing_page_url: String(s.linkUrl).slice(0, 500) }];
    const adOut = await pipeboard.callTool('create_tiktok_smart_plus_ad', adArgs);
    const adId = String(deepPluck(adOut, 'smart_plus_ad_id') || deepPluck(adOut, 'ad_id') || '');
    if (!adId) throw stepError('ad', 'create_tiktok_smart_plus_ad não retornou o ID do anúncio', createdIds);
    createdIds.adId = adId;

    warnings.push('Criado PAUSADO — ative na aba Smart+ quando estiver pronto');
    cacheBust('tree:');
    return { ...createdIds, name: s.name, warnings };
  } catch (err) {
    // Órfã não pode ficar entregável: pausa best-effort e devolve o passo.
    try { await setSmartPlusCampaignStatus(adv, [campaignId], 'paused'); } catch (_) { /* best-effort */ }
    if (!err.step) err.step = 'adgroup';
    err.createdIds = createdIds;
    throw err;
  }
}

// ── Campanha de catálogo (VSA / Product Link) ───────────────────────────────
// Compõe PRODUCT_SALES em três níveis apenas quando o schema do Pipeboard
// confirma Product Link. O destino NÃO é uma URL do anúncio: é o campo `link`
// de cada produto do catálogo. Tudo nasce pausado e a leitura final precisa
// confirmar a mesma semântica antes de a fila marcar sucesso.
//
// Não há uma tool dedicada VSA no Pipeboard atual; quando ela existir ou os
// schemas genéricos declararem todo o contrato, esta composição continua a
// proteger contra órfãos (pausa a campanha se uma etapa ou a verificação falhar).
// `opts.resume` + `opts.onProgress` tornam a composição retomável por worker.
async function createCatalogCampaign(advertiserId, spec, opts) {
  const adv = String(advertiserId || '').trim();
  if (!adv) throw badRequest('advertiserId é obrigatório');
  const s = spec || {};
  const options = opts || {};
  const catalogId = String(s.catalogId || '').trim();
  if (!catalogId) throw badRequest('catalogId (do TikTok) é obrigatório — sincronize o catálogo primeiro');
  const bcId = String(s.bcId || '').trim();
  if (!bcId) throw badRequest('bcId (Business Center) é obrigatório para campanha de catálogo');
  if (!String(s.name || '').trim()) throw badRequest('Nome da campanha é obrigatório');
  const budget = Number(s.budgetAmount);
  if (!(budget >= TIKTOK_MIN_BUDGET)) throw badRequest('O orçamento mínimo aceito pelo TikTok é ' + TIKTOK_MIN_BUDGET + ' por dia');
  if (s.budgetType === 'lifetime' && !/^\d{4}-\d{2}-\d{2}/.test(String(s.endDate || ''))) {
    throw badRequest('Orçamento total exige data de término (endDate)');
  }
  // Product Sales otimiza CONVERT com cobrança OCPM. Fixar essa semântica no
  // plano impede que Cost Cap use bid_price (clique) no lugar do campo
  // obrigatório conversion_bid_price (compra).
  const plan = resolveBudgetPlan(Object.assign({}, s, {
    goal: 'conversions', optimizationGoal: 'CONVERT', billingEvent: 'OCPM',
  }));
  const pixelId = String(s.pixelId || '').trim();
  if (!/^\d{6,30}$/.test(pixelId)) {
    throw badRequest('Pixel ID numérico do TikTok é obrigatório para optimization_goal=CONVERT');
  }
  const rawPixelEvent = String(s.pixelEvent || '').trim().toUpperCase();
  const requestedPixelEvent = rawPixelEvent === 'PURCHASE' ? '' : rawPixelEvent;
  if (requestedPixelEvent && !TIKTOK_PIXEL_EVENTS.includes(requestedPixelEvent)) {
    throw badRequest('Evento de otimização do Pixel TikTok inválido');
  }
  const videoUrl = String(s.videoUrl || '').trim();
  if (!/^https:\/\/[^\s]+$/i.test(videoUrl)) {
    throw badRequest('Envie um vídeo MP4 ou MOV antes de criar a campanha de catálogo');
  }
  const capabilities = await getCatalogCapabilities();
  if (!capabilities.catalogSingleVideoCampaign) {
    throw catalogCreationAwaitingConnectorError('O conector ainda não aceita o vídeo Product Link completo (vertical_video_strategy). Nenhuma estrutura foi criada.');
  }
  if (plan.bidStrategy === 'cost_cap' && capabilities.catalogCostCap !== true) {
    const err = catalogCreationAwaitingConnectorError('O conector ainda não confirmou Cost Cap com custo por conversão para campanhas de catálogo. Nenhuma estrutura foi criada.');
    err.code = 'CATALOG_COST_CAP_CONNECTOR_UNSUPPORTED';
    throw err;
  }
  if (plan.deliveryMode === 'accelerated' && capabilities.catalogAcceleratedDelivery !== true) {
    const err = catalogCreationAwaitingConnectorError('O conector ainda não confirmou entrega acelerada para campanhas de catálogo. Nenhuma estrutura foi criada.');
    err.code = 'CATALOG_ACCELERATED_DELIVERY_CONNECTOR_UNSUPPORTED';
    throw err;
  }
  const pixelEvent = await resolveCatalogPurchaseEvent(adv, pixelId, requestedPixelEvent);
  if (Array.isArray(capabilities.optimizationEvents)
    && !capabilities.optimizationEvents.includes(pixelEvent)) {
    throw badRequest('O schema atual do conector não aceita o evento ' + pixelEvent + ' nesta campanha de catálogo.', 409);
  }
  const productScope = ['all', 'product_set', 'specific'].includes(s.productScope) ? s.productScope : 'all';
  if (productScope === 'specific' && !capabilities.specificProducts) {
    throw badRequest('O conector Product Link ainda não confirmou seleção de produtos específicos.', 409);
  }
  if (productScope === 'product_set' && !capabilities.productSets) {
    throw badRequest('O conector Product Link ainda não confirmou Product Set.', 409);
  }
  const requestedCta = String(s.callToAction || '').trim().toUpperCase();
  if (requestedCta && (!capabilities.callToAction
    || (Array.isArray(capabilities.callToActions) && capabilities.callToActions.length
      && !capabilities.callToActions.includes(requestedCta)))) {
    throw badRequest('O schema atual do conector não aceita o CTA ' + requestedCta + ' nesta campanha de catálogo.', 409);
  }

  const countries = (Array.isArray(s.countries) && s.countries.length ? s.countries : (s.country ? [s.country] : ['BR']));
  const SHOPPING_TYPE = 'VIDEO';
  const AD_FORMAT = 'SINGLE_VIDEO';
  const itemGroupIds = (Array.isArray(s.itemGroupIds) ? s.itemGroupIds : Array.isArray(s.productIds) ? s.productIds : [])
    .map((value) => String(value || '').trim()).filter(Boolean).slice(0, 100);
  if (productScope === 'specific' && !itemGroupIds.length) {
    throw badRequest('O catálogo não possui item_group_id para montar os cards. Sincronize os produtos novamente antes de criar a campanha.', 422);
  }
  if (productScope === 'product_set' && !String(s.productSetId || '').trim()) {
    throw badRequest('Selecione um Product Set antes de criar a campanha.', 422);
  }
  let explicitIdentity = null;
  if (s.identityId || s.identityType || s.identityBcId) {
    const row = {
      identity_id: String(s.identityId || ''),
      identity_type: String(s.identityType || '').toUpperCase(),
      identity_bc_id: String(s.identityBcId || ''),
    };
    if (!usableBcIdentity(row)) {
      throw badRequest('Campanha de catálogo só aceita uma identidade BC_AUTH_TT com Business Center autorizado. CUSTOMIZED_USER não é elegível para criação automática.');
    }
    explicitIdentity = bcIdentityPayload(row);
    if (explicitIdentity.identityBcId !== bcId) {
      throw badRequest('A identidade selecionada pertence a outro Business Center. Use uma identidade BC_AUTH_TT autorizada no mesmo BC do catálogo.');
    }
  }
  const warnings = [];
  // Todos os pré-requisitos de campanha terminam antes da primeira criação.
  // Falta de identidade, região, vídeo, capa ou evento não gera campanha órfã.
  const [info, liveIdentityCandidates, regions] = await Promise.all([
    getAdvertiserInfo(adv),
    listAdIdentityCandidates(adv, bcId),
    resolveLocationIds(adv, countries, 'PRODUCT_SALES'),
  ]);
  assertAdvertiserCanCreateCatalogCampaign(info);
  let identityCandidates = liveIdentityCandidates;
  if (explicitIdentity) {
    const selectedIdentity = liveIdentityCandidates.find((candidate) => (
      candidate.identityId === explicitIdentity.identityId
      && candidate.identityType === explicitIdentity.identityType
      && candidate.identityBcId === explicitIdentity.identityBcId
    ));
    if (!selectedIdentity) {
      const err = badRequest(
        'O perfil escolhido não está mais disponível neste Business Center. Atualize a lista e selecione outro perfil antes de criar as campanhas.',
        409,
      );
      err.code = 'CATALOG_IDENTITY_NOT_AVAILABLE';
      err.userMessage = err.message;
      err.retryable = false;
      throw err;
    }
    // Uma escolha explícita nunca pode cair silenciosamente em outro perfil.
    identityCandidates = [selectedIdentity];
  }
  if (!identityCandidates.length) {
    await pickAdIdentity(adv, bcId); // lança o erro orientativo padronizado
  }
  let identity = identityCandidates[0];
  if (regions.missingCountries.length) warnings.push('Países sem região no TikTok (ignorados): ' + regions.missingCountries.join(', '));
  const createdIds = { ...((options && options.resume) || {}) };
  if (createdIds.identityId) {
    const resumedIdentity = identityCandidates.find((candidate) => candidate.identityId === String(createdIds.identityId));
    if (resumedIdentity) identity = resumedIdentity;
  }
  const report = async (stage) => {
    if (typeof options.onProgress === 'function') await options.onProgress({ stage, createdIds: { ...createdIds } });
  };
  let campaignId = String(createdIds.campaignId || '');
  try {
    let effectiveCampaignName = String(createdIds.campaignName || '').trim();
    let campaignNamesBeforeCreate = null;
    if (!campaignId) {
      const existingNames = await catalogCampaignNames(adv);
      campaignNamesBeforeCreate = existingNames;
      const requestedName = String(s.name).trim().slice(0, MAX_CAMPAIGN_NAME_LENGTH);
      effectiveCampaignName = nextAvailableCampaignName(
        effectiveCampaignName || requestedName,
        existingNames,
        MAX_CAMPAIGN_NAME_LENGTH,
      );
      if (effectiveCampaignName !== requestedName) {
        warnings.push('Nome "' + requestedName + '" já existia — reservado automaticamente como "' + effectiveCampaignName + '"');
      }
      createdIds.campaignName = effectiveCampaignName;
      await report('validating');
    }
    if (!createdIds.videoId) {
      await report('upload');
      createdIds.videoId = await uploadVideoAndWait(adv, videoUrl, createdIds);
    }
    if (!createdIds.coverImageId) {
      await report('cover');
      const videoAsset = await getUploadedVideoAsset(adv, createdIds.videoId, createdIds);
      createdIds.coverImageId = await uploadImage(adv, videoAsset.coverUrl, createdIds, { tikTokGenerated: true });
    }

    // 1) Campanha PRODUCT_SALES (catálogo)
    const campArgs = {
      advertiser_id: adv,
      objective_type: 'PRODUCT_SALES',
      product_source: 'CATALOG',
      shopping_ads_type: SHOPPING_TYPE,
      catalog_id: catalogId,
      operation_status: 'DISABLE',
    };
    if (plan.cbo) {
      campArgs.budget_mode = plan.campaign.budget_mode;
      campArgs.budget = plan.campaign.budget;
      campArgs.budget_optimize_on = true;
    }
    await report('creating_campaign');
    if (!campaignId) {
      const created = await createUniqueCatalogCampaignEntity(
        adv,
        String(s.name),
        campArgs,
        {
          warnings,
          existingNames: campaignNamesBeforeCreate,
          initialName: effectiveCampaignName,
          announceInitialRename: false,
          onName: async (name) => {
            effectiveCampaignName = name;
            createdIds.campaignName = name;
            await report('creating_campaign');
          },
          onTransientRetry: () => warnings.push('Instabilidade temporária do TikTok ao criar a campanha — nova tentativa automática'),
        },
      );
      const campOut = created.output;
      effectiveCampaignName = created.name;
      createdIds.campaignName = effectiveCampaignName;
      campaignId = String(deepPluck(campOut, 'campaign_id') || '');
      if (!campaignId) throw stepError('campaign', 'create_tiktok_campaign não retornou campaign_id');
      createdIds.campaignId = campaignId;
      await report('creating_adgroup');
    }

    // 2) Ad group — fonte = catálogo. `CONVERT` exige pixel e evento; a camada
    // de domínio e esta defesa final impedem criar campanha órfã antes da
    // rejeição inevitável do ad group.
    const agArgs = {
      advertiser_id: adv,
      campaign_id: campaignId,
      adgroup_name: String(effectiveCampaignName || s.name).slice(0, 500) + ' — grupo 1',
      promotion_type: 'WEBSITE',
      shopping_ads_type: SHOPPING_TYPE,
      shopping_ads_retargeting_type: 'OFF',
      product_source: 'CATALOG',
      catalog_id: catalogId,
      catalog_authorized_bc_id: bcId,
      optimization_goal: 'CONVERT',
      billing_event: 'OCPM',
      placement_type: 'PLACEMENT_TYPE_NORMAL',
      placements: ['PLACEMENT_TIKTOK'],
      schedule_start_time: advertiserLocalTime(info && (info.deliveryTimezone || info.timezone)),
      targeting: { location_ids: regions.locationIds },
      operation_status: 'DISABLE',
    };
    agArgs.pixel_id = pixelId;
    agArgs.optimization_event = pixelEvent;
    if (plan.adgroup.budget_mode) agArgs.budget_mode = plan.adgroup.budget_mode;
    if (plan.adgroup.budget != null) agArgs.budget = plan.adgroup.budget;
    Object.assign(agArgs, plan.bid);
    Object.assign(agArgs, plan.delivery);
    if (s.budgetType === 'lifetime' && s.endDate) agArgs.schedule_end_time = String(s.endDate).slice(0, 10) + ' 23:59:59';
    await report('creating_adgroup');
    if (!createdIds.adGroupId) {
      const agOut = await callTikTokWriteWithRetry('create_tiktok_adgroup', agArgs, () => warnings.push('TikTok não conseguiu alocar a criação do grupo — nova tentativa automática'));
      const adGroupId = String(deepPluck(agOut, 'adgroup_id') || '');
      if (!adGroupId) throw stepError('adgroup', 'create_tiktok_adgroup não retornou adgroup_id (verifique catálogo, BC, pixel e tipo de Shopping Ads)', createdIds);
      createdIds.adGroupId = adGroupId;
      await report('creating_ad');
    }
    const adGroupId = createdIds.adGroupId;

    // 3) Vídeo de catálogo. O áudio vem no arquivo enviado, a capa é extraída
    // automaticamente e cada produto continua usando seu próprio Link. Não
    // existe landing_page_url no anúncio.
    const adArgs = {
      advertiser_id: adv,
      adgroup_id: adGroupId,
      ad_name: String(effectiveCampaignName || s.name).slice(0, 500),
      ad_format: AD_FORMAT,
      vertical_video_strategy: 'SINGLE_VIDEO',
      video_id: createdIds.videoId,
      image_ids: [createdIds.coverImageId],
      catalog_id: catalogId,
      product_specific_type: productScope === 'all'
        ? 'ALL'
        : productScope === 'specific' ? 'CUSTOMIZED_PRODUCTS' : 'PRODUCT_SET',
      ad_text: String(s.text || 'Confira os produtos disponíveis').slice(0, 100),
      call_to_action: requestedCta || 'SHOP_NOW',
      status: 'PAUSED',
    };
    if (productScope === 'specific') adArgs.sku_ids = itemGroupIds;
    if (productScope === 'product_set' && s.productSetId) adArgs.product_set_id = String(s.productSetId);
    await report('creating_ad');
    if (!createdIds.adId) {
      let adOut = null;
      let lastIdentityError = null;
      const candidates = identityCandidates.slice(0, 8);
      for (let index = 0; index < candidates.length; index += 1) {
        identity = candidates[index];
        adArgs.identity_id = identity.identityId;
        adArgs.identity_type = identity.identityType;
        adArgs.identity_authorized_bc_id = identity.identityBcId;
        adArgs.dark_post_status = 'ON';
        try {
          adOut = await callTikTokWriteWithRetry('create_tiktok_ad', adArgs, () => warnings.push('Instabilidade temporária do TikTok ao criar o anúncio — nova tentativa automática'));
          break;
        } catch (err) {
          const identityUnavailable = /NO LONGER HAVE ACCESS|RE-APPLY FOR ACCESS|SELECT A NEW IDENTITY/i.test(String(err && err.message || ''));
          if (!identityUnavailable || index === candidates.length - 1) {
            if (!err.step) err.step = 'ad';
            throw err;
          }
          lastIdentityError = err;
          warnings.push('Uma identidade perdeu acesso; a dashboard tentou outra identidade autorizada do mesmo Business Center');
        }
      }
      if (!adOut && lastIdentityError) {
        if (!lastIdentityError.step) lastIdentityError.step = 'ad';
        throw lastIdentityError;
      }
      const adId = String(deepPluck(adOut, 'ad_id') || '');
      if (!adId) throw stepError('ad', 'create_tiktok_ad não retornou ad_id para o anúncio de catálogo', createdIds);
      createdIds.adId = adId;
      createdIds.identityId = identity.identityId;
    }

    // Não declaramos sucesso com apenas três IDs. A leitura imediata precisa
    // confirmar campanha → conjunto → anúncio, Product Link, ausência de URL
    // manual e estado pausado. Se algum campo não vier do conector, é falha de
    // verificação, não uma licença para assumir que a campanha está correta.
    await report('verifying_entities');
    let verified = false;
    let verification = null;
    for (let attempt = 0; attempt < 3 && !verified; attempt += 1) {
      try {
        const [campaigns, adGroups, ads] = await Promise.all([
          getCampaigns(adv, { pageSize: 100, campaignIds: [campaignId] }),
          getAdGroups(adv, [campaignId], { pageSize: 100 }),
          getAds(adv, { campaignIds: [campaignId], adgroupIds: [adGroupId], pageSize: 100 }),
        ]);
        const campaign = campaigns.find((item) => String(item.id) === String(campaignId));
        const adGroup = adGroups.find((item) => String(item.id) === String(adGroupId));
        const ad = ads.find((item) => String(item.id) === String(createdIds.adId));
        verification = verifyCatalogProductLinkHierarchy({
          campaign, adGroup, ad,
          expected: {
            campaignId, adGroupId, adId: createdIds.adId,
            catalogId, bcId, shoppingAdsType: SHOPPING_TYPE,
            pixelId, pixelEvent,
            locationIds: regions.locationIds,
            // Specs persistidos antes destes controles não tinham os campos.
            // Mantemos a leitura histórica compatível; toda criação nova vem
            // normalizada pelo domínio e confirma lance + entrega no readback.
            ...(Object.prototype.hasOwnProperty.call(s, 'bidStrategy')
              || Object.prototype.hasOwnProperty.call(s, 'deliveryMode') ? {
                bidStrategy: plan.bidStrategy,
                bidAmount: plan.bidAmount,
                deliveryMode: plan.deliveryMode,
              } : {}),
            adFormat: AD_FORMAT,
            verticalVideoStrategy: 'SINGLE_VIDEO',
            productSpecificType: adArgs.product_specific_type,
            itemGroupIds: adArgs.item_group_ids || [],
            skuIds: adArgs.sku_ids || [],
            productSetId: adArgs.product_set_id || '',
            videoId: adArgs.video_id,
            imageId: adArgs.image_ids[0],
            adText: adArgs.ad_text || '',
            callToAction: adArgs.call_to_action || '',
            identityId: identity.identityId,
            identityType: identity.identityType,
            identityBcId: identity.identityBcId,
            darkPostStatus: 'ON',
          },
        });
        verified = verification.complete;
      } catch (_) { /* consistência eventual / leitura best-effort */ }
      if (!verified && attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1200));
    }
    if (!verified) {
      const err = stepError('verify', 'Os IDs foram criados, mas o TikTok ainda não confirmou a hierarquia Product Link completa, pausada e sem URL manual', createdIds, 502);
      err.retryable = true;
      err.verification = verification;
      err.suggestedAction = 'Aguarde a propagação e confira se o conector devolve catálogo, Product Link e status dos três níveis antes de retomar.';
      throw err;
    }

    warnings.push('Vídeo de catálogo criado e confirmado em PAUSA — o áudio vem do criativo e cada produto usa seu Link');
    cacheBust('tree:');
    await report('ready_paused');
    return {
      ...createdIds,
      name: effectiveCampaignName || s.name,
      requestedName: String(s.name),
      warnings,
      verification,
    };
  } catch (err) {
    // Órfã não pode ficar entregável: reconcilia os três níveis em pausa
    // best-effort antes de devolver o passo ao worker.
    if (campaignId) await pauseCatalogHierarchyBestEffort(adv, { ...createdIds, campaignId });
    if (!err.step) err.step = campaignId ? 'adgroup' : 'campaign';
    err.createdIds = createdIds;
    throw err;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Públicos Personalizados & Lookalike (Remarketing & Escala)
// ════════════════════════════════════════════════════════════════════════════

async function listCustomAudiences(advertiserId, opts = {}) {
  const adv = String(advertiserId || '').trim();
  if (!adv) return [];
  const ck = 'audiences:' + adv + ':' + (opts.page || 1);
  if (!opts.fresh) {
    const hit = cacheGet(ck);
    if (hit) return hit;
  }
  const out = await pipeboard.callTool('list_tiktok_custom_audiences', {
    advertiser_id: adv,
    page: Number(opts.page || 1),
    page_size: Number(opts.pageSize || 50),
  });
  const list = firstArray(out, ['custom_audiences', 'list', 'audiences', 'data']) || [];
  const mapped = list.map((item) => ({
    id: String(item.custom_audience_id || item.id || ''),
    name: String(item.name || item.custom_audience_name || 'Público'),
    type: String(item.audience_type || item.type || 'PIXEL'),
    size: Number(item.cover_num || item.audience_size || item.size || 0),
    status: String(item.status || (item.is_valid ? 'ready' : 'processing')),
    isValid: Boolean(item.is_valid ?? true),
    createTime: item.create_time || item.created_at || null,
  }));
  return cacheSet(ck, mapped, 60 * 1000);
}

async function createCustomAudience(advertiserId, data = {}) {
  const adv = String(advertiserId || '').trim();
  if (!adv) throw badRequest('advertiserId é obrigatório');
  const name = String(data.name || '').trim().slice(0, 128);
  if (!name) throw badRequest('Nome do público é obrigatório');
  
  const audienceType = String(data.audienceType || 'PIXEL').toUpperCase();
  const retention = Math.min(Math.max(Number(data.retentionDays || 30), 1), 365);
  
  let ruleSpec = data.ruleSpec;
  if (!ruleSpec) {
    const eventName = data.event || 'Purchase';
    ruleSpec = {
      inclusion_rule_set: {
        operator: 'OR',
        rules: [
          {
            event: eventName,
            retention_in_days: retention,
            ...(data.pixelId ? {
              filter: {
                field: 'pixel_id',
                operator: 'EQUALS',
                value: String(data.pixelId),
              }
            } : {})
          },
        ],
      },
    };
  }

  const args = {
    advertiser_id: adv,
    custom_audience_name: name,
    audience_type: audienceType,
    retention_in_days: retention,
    is_auto_refresh: true,
  };
  if (ruleSpec) args.rule_spec = ruleSpec;

  const out = await pipeboard.callTool('create_tiktok_custom_audience', args);
  cacheBust('audiences:' + adv);
  return out;
}

async function createLookalikeAudience(advertiserId, data = {}) {
  const adv = String(advertiserId || '').trim();
  if (!adv) throw badRequest('advertiserId é obrigatório');
  const name = String(data.name || '').trim().slice(0, 128);
  const sourceId = String(data.sourceAudienceId || '').trim();
  if (!name || !sourceId) throw badRequest('Nome e público semente são obrigatórios');

  const out = await pipeboard.callTool('create_tiktok_lookalike_audience', {
    advertiser_id: adv,
    custom_audience_name: name,
    source_audience_id: sourceId,
    lookalike_spec: {
      location_ids: Array.isArray(data.locationIds) && data.locationIds.length ? data.locationIds : ['BR'],
      lookalike_type: String(data.lookalikeType || 'BALANCE'),
    },
  });
  cacheBust('audiences:' + adv);
  return out;
}

async function deleteCustomAudiences(advertiserId, audienceIds) {
  const adv = String(advertiserId || '').trim();
  const ids = Array.isArray(audienceIds) ? audienceIds.map(String) : [String(audienceIds)];
  if (!adv || !ids.length) throw badRequest('advertiserId e IDs são obrigatórios');
  const out = await pipeboard.callTool('delete_tiktok_custom_audiences', {
    advertiser_id: adv,
    custom_audience_ids: ids,
  });
  cacheBust('audiences:' + adv);
  return out;
}

module.exports = {
  enabled: pipeboard.enabled,
  // estado
  getState,
  setState,
  // advertisers
  listAdvertiserIds,
  getAdvertiserInfo,
  resolveAdvertiserId,
  listAdvertisers,
  selectAdvertiser,
  // status
  getStatus,
  // públicos (Remarketing / Lookalike)
  listCustomAudiences,
  createCustomAudience,
  createLookalikeAudience,
  deleteCustomAudiences,
  // árvore
  getCampaigns,
  getAdGroups,
  getAds,
  getTree,
  getDashboardTree,
  // insights
  getInsights,
  // escrita (Gate 4)
  setCampaignStatus,
  setAdGroupStatus,
  setAdStatus,
  activateCatalogCampaignHierarchy,
  updateCampaign,
  updateAdGroup,
  updateAd,
  // criação composta (F1)
  createFullAd,
  uploadVideoAsset,
  // duplicação composta (F3)
  captureCampaign,
  preflightCampaignDuplication,
  recreateCampaign,
  // Spark Ads (F5)
  listSparkIdentities,
  listIdentityVideos,
  createSparkAd,
  // catálogos (TikTok Shopping / DPA)
  getBusinessCenterId,
  businessCenterFromEnv,
  setBusinessCenterId,
  listCatalogBusinessCenters,
  createTikTokCatalog,
  uploadTikTokCatalogProducts,
  getTikTokCatalogUploadStatus,
  getTikTokCatalogOverview,
  getTikTokCatalogFeeds,
  listTikTokCatalogs,
  updateTikTokCatalogName,
  getCatalogCapabilities,
  listCatalogAdIdentities,
  resolveCatalogPurchaseEvent,
  resolveCatalogCarouselMusic: pickCatalogCarouselMusic,
  createCatalogCampaign,
  CATALOG_TYPES,
  // direcionamento (leitura p/ a criação)
  listInterestCategories,
  listTikTokPixels,
  // Smart+ (gestão + appeal de anúncio + criação composta)
  listSmartPlusCampaigns,
  listSmartPlusAdGroups,
  listSmartPlusAds,
  getSmartPlusDashboardTree,
  setSmartPlusCampaignStatus,
  setSmartPlusAdGroupStatus,
  setSmartPlusAdStatus,
  setSmartPlusAdMaterialStatus,
  updateSmartPlusCampaign,
  updateSmartPlusAdGroup,
  updateSmartPlusAd,
  appealSmartPlusAd,
  createSmartPlusCampaign,
  // cache
  cacheBust,
  cacheGet,
  cacheSet,
  // helpers expostos p/ teste
  _internals: { normalizeAdvertiserStatus, mapCampaign, mapAdGroup, mapAd, mapSmartPlusCampaign, mapSmartPlusAdGroup, mapSmartPlusAd, paginationInfo, listAllPages, mapInsightRow, toOperationStatus, toBudgetMode, deepPluck, firstArray, ageGroupsFor, advertiserLocalTime, resolveLocationIds, pickAdIdentity, listAdIdentityCandidates, listCatalogAdIdentities, usableBcIdentity, bcIdentityPayload, pickCatalogCarouselMusic, uploadVideoAndWait, uploadImage, getUploadedVideoAsset, inspectUploadedVideoAsset, normalizePublicImageUrl, normalizeTikTokCoverUrl, pixelEventRows, pixelEventCount, receivedPixelEvents, inspectCatalogPurchaseEvent, resolveCatalogPurchaseEvent, resolveBudgetPlan, GOAL_MAP, createCatalogCampaign, createUniqueCatalogCampaignEntity, assertAdvertiserCanCreateCatalogCampaign, listInterestCategories, getCatalogCapabilities, normalizeCatalogOverview, normalizeCatalogFeeds, normalizeCatalogUploadStatus, verifyCatalogProductLinkHierarchy, verifyCatalogHierarchyActivation, activeReadback, pausedReadback },
};
