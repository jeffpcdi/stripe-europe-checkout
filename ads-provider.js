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
const { SPARK_GOALS } = require('./ads-contracts');

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
// Lista crua de IDs (barato: 1 chamada). Cache 5min.
async function listAdvertiserIds() {
  const ck = 'advids';
  const hit = cacheGet(ck);
  if (hit) return hit;
  const out = await pipeboard.callTool('list_tiktok_advertisers', {});
  const ids = (out && Array.isArray(out.advertiser_ids) ? out.advertiser_ids : []).map(String);
  return cacheSet(ck, ids, 5 * 60 * 1000);
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
async function resolveAdvertiserId(accountId) {
  const ids = await listAdvertiserIds();
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
async function getStatus(accountId) {
  if (!pipeboard.enabled) return { enabled: false, connected: false };
  let advertiserId = '';
  try {
    advertiserId = await resolveAdvertiserId(accountId);
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
function mapCampaign(c) {
  return {
    id: String(c.campaign_id || ''),
    name: String(c.campaign_name || ''),
    status: String(c.operation_status || ''),   // ENABLE | DISABLE
    objective: String(c.objective_type || ''),
    budget: Number(c.budget || 0),
    budgetMode: String(c.budget_mode || ''),
    campaignType: String(c.campaign_type || ''),
    createTime: String(c.create_time || ''),
    modifyTime: String(c.modify_time || ''),
  };
}
function mapAdGroup(g) {
  return {
    id: String(g.adgroup_id || ''),
    campaignId: String(g.campaign_id || ''),
    name: String(g.adgroup_name || ''),
    status: String(g.operation_status || ''),        // ENABLE | DISABLE
    secondaryStatus: String(g.secondary_status || ''), // ADGROUP_STATUS_*
    budget: Number(g.budget || 0),
    budgetMode: String(g.budget_mode || ''),
    optimizationGoal: String(g.optimization_goal || ''),
    createTime: String(g.create_time || ''),
    modifyTime: String(g.modify_time || ''),
  };
}
function mapAd(a) {
  return {
    id: String(a.ad_id || ''),
    adgroupId: String(a.adgroup_id || ''),
    campaignId: String(a.campaign_id || ''),
    name: String(a.ad_name || ''),
    status: String(a.operation_status || ''),        // ENABLE | DISABLE
    secondaryStatus: String(a.secondary_status || ''), // AD_STATUS_*
    adFormat: String(a.ad_format || ''),
    adText: String(a.ad_text || ''),
    videoId: String(a.video_id || ''),
    imageIds: Array.isArray(a.image_ids) ? a.image_ids.map(String) : [],
    landingPageUrl: String(a.landing_page_url || ''),
    createTime: String(a.create_time || ''),
    modifyTime: String(a.modify_time || ''),
  };
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
  const args = { advertiser_id: id, page: 1, page_size: wanted ? 1000 : pageSize };
  const out = await pipeboard.callTool('get_tiktok_campaigns', args);
  const rows = (out.campaigns || []).map(mapCampaign);
  return wanted ? rows.filter((campaign) => wanted.has(String(campaign.id))) : rows;
}
async function getAdGroups(advertiserId, campaignIds, { pageSize = 500 } = {}) {
  const id = String(advertiserId);
  const args = { advertiser_id: id, page: 1, page_size: pageSize };
  if (Array.isArray(campaignIds) && campaignIds.length) args.campaign_ids = campaignIds.map(String);
  const out = await pipeboard.callTool('get_tiktok_adgroups', args);
  return (out.adgroups || out.ad_groups || []).map(mapAdGroup);
}
async function getAds(advertiserId, { campaignIds, adgroupIds, pageSize = 500 } = {}) {
  const id = String(advertiserId);
  const args = { advertiser_id: id, page: 1, page_size: pageSize };
  if (Array.isArray(campaignIds) && campaignIds.length) args.campaign_ids = campaignIds.map(String);
  if (Array.isArray(adgroupIds) && adgroupIds.length) args.adgroup_ids = adgroupIds.map(String);
  const out = await pipeboard.callTool('get_tiktok_ads', args);
  return (out.ads || []).map(mapAd);
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
        status: tiktokStatusToNode(ad.status, ad.secondaryStatus),
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
        status: tiktokStatusToNode(g.status, g.secondaryStatus),
        budget: budgetObj(g.budget, g.budgetMode),
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
  else if (statusFilter) campaigns = campaigns.filter((c) => c.status === statusFilter || c.childStatus === statusFilter);
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
  traffic: { objective: 'TRAFFIC', optimizationGoal: 'CLICK' },
  awareness: { objective: 'REACH', optimizationGoal: 'REACH' },
  video_views: { objective: 'VIDEO_VIEWS', optimizationGoal: 'VIDEO_VIEW' },
  engagement: { objective: 'ENGAGEMENT', optimizationGoal: 'ENGAGED_VIEW' },
  lead_generation: { objective: 'LEAD_GENERATION', optimizationGoal: 'LEAD_GENERATION' },
  conversions: { objective: 'WEB_CONVERSIONS', optimizationGoal: 'CONVERT' },
  // app_promotion exige app_id (via /app/list/) que a UI não coleta ainda —
  // rejeitado com mensagem clara em vez de chutar.
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

const TIKTOK_MIN_BUDGET = 50;

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
  return /could not acquire ip/i.test(message) || (/40002/.test(message) && /try again later|temporar/i.test(message));
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

// Identidade do anúncio — a doc do create_tiktok_ad PROÍBE chutar: tem de vir
// de get_tiktok_identities. Para anúncio regular (vídeo enviado, não-Spark):
//   CUSTOMIZED_USER (clássica; criação de novas está deprecated mas as
//   existentes seguem utilizáveis) > BC_AUTH_TT (exige identity_bc_id e
//   dark_post_status ON). TT_USER/AUTH_CODE são Spark-only (exigem post).
async function pickAdIdentity(advertiserId) {
  const out = await pipeboard.callTool('get_tiktok_identities', { advertiser_id: advertiserId });
  const list = firstArray(out, ['identities', 'identity_list', 'list', 'data']);
  const byType = (t) => list.find((i) => String(i.identity_type || '').toUpperCase() === t && (i.identity_id || i.id));
  const custom = byType('CUSTOMIZED_USER');
  if (custom) return { identityId: String(custom.identity_id || custom.id), identityType: 'CUSTOMIZED_USER' };
  const bc = byType('BC_AUTH_TT');
  if (bc) {
    return {
      identityId: String(bc.identity_id || bc.id), identityType: 'BC_AUTH_TT',
      identityBcId: String(bc.identity_authorized_bc_id || bc.bc_id || deepPluck(bc, 'bc_id') || '') || undefined,
      darkPost: true,
    };
  }
  throw stepError('identity', 'Nenhuma identidade utilizável para anúncio regular neste advertiser (é preciso uma identidade CUSTOMIZED_USER existente ou BC_AUTH_TT). TT_USER/AUTH_CODE servem só para Spark Ads.', null, 409);
}

// Upload por URL + polling canônico: get_tiktok_video_info a cada ~5s até
// displayable. O TikTok deduplica por md5 — re-upload do mesmo arquivo devolve
// o mesmo video_id (idempotência de graça no retry).
async function uploadVideoAndWait(advertiserId, videoUrl, createdIds) {
  const up = await pipeboard.callTool('upload_tiktok_video', {
    advertiser_id: advertiserId, video_url: videoUrl, wait_for_processing_seconds: 60,
  });
  const videoId = String(deepPluck(up, 'video_id') || '');
  if (!videoId) throw stepError('upload', 'Upload do vídeo não retornou video_id', createdIds);
  if (deepPluck(up, 'displayable') === true) return videoId;
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const info = await pipeboard.callTool('get_tiktok_video_info', { advertiser_id: advertiserId, video_ids: [videoId] });
    const vids = firstArray(info, ['videos', 'video_list', 'list', 'data']);
    const v = vids.find((x) => String(x.video_id || x.id || '') === videoId) || vids[0];
    if (v && (v.displayable === true || /READY|SUCCEED/i.test(String(v.status || v.video_status || '')))) return videoId;
  }
  throw stepError('upload', 'Vídeo enviado (video_id ' + videoId + ') mas não ficou processado/displayable a tempo — tente de novo em instantes (o re-upload reaproveita o mesmo vídeo)', createdIds);
}

async function uploadImage(advertiserId, imageUrl, createdIds) {
  const url = String(imageUrl || '').trim();
  if (!/^https:\/\/[^\s]+/.test(url)) throw stepError('cover', 'A capa do vídeo precisa ser uma URL https pública', createdIds, 400);
  const out = await pipeboard.callTool('upload_tiktok_image', {
    advertiser_id: advertiserId,
    image_url: url,
  });
  const imageId = String(deepPluck(out, 'image_id') || deepPluck(out, 'web_uri') || '');
  if (!imageId) throw stepError('cover', 'Upload da capa não retornou image_id', createdIds);
  return imageId;
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
  const bid = { bid_type: 'BID_TYPE_NO_BID' };
  if (s.bidStrategy === 'cost_cap' && Number(s.bidAmount) > 0) {
    bid.bid_type = 'BID_TYPE_CUSTOM';
    // CONVERT + OCPM usa conversion_bid_price; demais objetivos usam bid_price.
    if (s.goal === 'conversions' || s.goal === 'lead_generation') bid.conversion_bid_price = Number(s.bidAmount);
    else bid.bid_price = Number(s.bidAmount);
  }
  return { cbo, campaign, adgroup, bid };
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

  const [campsOut, agsOut, adsOut] = await Promise.all([
    pipeboard.callTool('get_tiktok_campaigns', { advertiser_id: adv, page: 1, page_size: 1000 }),
    pipeboard.callTool('get_tiktok_adgroups', { advertiser_id: adv, campaign_ids: [cid], page: 1, page_size: 1000 }),
    pipeboard.callTool('get_tiktok_ads', { advertiser_id: adv, campaign_ids: [cid], page: 1, page_size: 1000 }),
  ]);
  const campaign = firstArray(campsOut, ['campaigns', 'campaign_list', 'list', 'data'])
    .find((c) => String(c.campaign_id || c.id || '') === cid);
  if (!campaign) throw stepError('capture', 'Campanha de origem ' + cid + ' não encontrada neste advertiser', null, 404);
  const adGroups = firstArray(agsOut, ['adgroups', 'adgroup_list', 'list', 'data']);
  if (!adGroups.length) throw stepError('capture', 'A campanha de origem não tem nenhum ad group — nada a duplicar', null, 422);
  const ads = firstArray(adsOut, ['ads', 'ad_list', 'list', 'data']);
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
    optimization_goal: String(srcAg.optimization_goal || 'CLICK'),
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
  if (mode && mode !== 'BUDGET_MODE_INFINITE') {
    // adgroup NÃO aceita DYNAMIC_DAILY (enum do create só tem DAY/TOTAL/INFINITE)
    args.budget_mode = mode === 'BUDGET_MODE_DYNAMIC_DAILY_BUDGET' ? 'BUDGET_MODE_DAY' : mode;
    if (mode === 'BUDGET_MODE_DYNAMIC_DAILY_BUDGET') warnings.push('Orçamento dinâmico do grupo convertido para diário fixo (não suportado na recriação)');
    if (budgetOverride) args.budget = clampTikTokBudget(budgetOverride, warnings, 'Orçamento do grupo');
    else if (Number(srcAg.budget) > 0) args.budget = clampTikTokBudget(srcAg.budget, warnings, 'Orçamento do grupo');
  } else if (budgetOverride) {
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
  if (srcAg.optimization_event) args.optimization_event = String(srcAg.optimization_event);
  if (srcAg.promotion_type) args.promotion_type = String(srcAg.promotion_type);
  if (srcAg.promotion_target_type) args.promotion_target_type = String(srcAg.promotion_target_type);
  if (srcAg.placement_type) args.placement_type = String(srcAg.placement_type);
  if (Array.isArray(srcAg.placements) && srcAg.placements.length) args.placements = srcAg.placements;
  return args;
}

// Recria a campanha capturada. newName é o nome da CÓPIA (já com sufixo).
// opts.resume/opts.onProgress: mesma mecânica idempotente do createFullAd —
// progresso = { campaignId, adGroups: {srcId: newId}, ads: {srcId: newId} }.
// opts.overrides (F4 — variações): { budgetAmount?, adText? } aplicado por
// cima da origem em CADA grupo/anúncio da variação.
async function recreateCampaign(advertiserId, capture, newName, opts) {
  const adv = String(advertiserId || '').trim();
  const o = opts || {};
  const overrides = (o.overrides && typeof o.overrides === 'object') ? o.overrides : {};
  const resume = (o.resume && typeof o.resume === 'object') ? o.resume : {};
  const report = typeof o.onProgress === 'function' ? o.onProgress : async () => {};
  const src = capture.campaign;
  const warnings = [];
  const progress = {
    campaignId: String(resume.campaignId || '') || null,
    adGroups: { ...(resume.adGroups || {}) },
    ads: { ...(resume.ads || {}) },
  };

  const [info, fallbackIdentity] = await Promise.all([
    getAdvertiserInfo(adv),
    pickAdIdentity(adv).catch(() => null),
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
      objective_type: String(src.objective_type || src.objective || 'TRAFFIC'),
    };
    const srcMode = String(src.budget_mode || '');
    // Preflight 40002: DYNAMIC_DAILY só entra se o objetivo for de conversão/
    // vendas (onde se sabe que existe); fora disso converte já no preflight.
    if (srcMode === 'BUDGET_MODE_DYNAMIC_DAILY_BUDGET' && !/CONVERSIONS|PRODUCT_SALES|SHOP_PURCHASES|APP_PROMOTION/.test(campArgs.objective_type)) {
      campArgs.budget_mode = 'BUDGET_MODE_DAY';
      if (Number(src.budget) > 0) campArgs.budget = clampTikTokBudget(src.budget, warnings, 'Orçamento da campanha');
      warnings.push('Orçamento dinâmico diário convertido para diário fixo (objetivo ' + campArgs.objective_type + ' não o suporta — preflight 40002)');
    } else if (srcMode && srcMode !== 'BUDGET_MODE_INFINITE') {
      campArgs.budget_mode = srcMode;
      if (Number(src.budget) > 0) campArgs.budget = clampTikTokBudget(src.budget, warnings, 'Orçamento da campanha');
    }
    if (src.budget_optimize_on === true) campArgs.budget_optimize_on = true;
    if (src.pixel_id) { campArgs.pixel_id = String(src.pixel_id); if (src.optimization_event) campArgs.optimization_event = String(src.optimization_event); }
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
    let fallbackLocationIds = [];
    for (const srcAg of capture.adGroups) {
      const t = extractTargeting(srcAg);
      if (Array.isArray(t.location_ids) && t.location_ids.length) { fallbackLocationIds = t.location_ids; break; }
    }

    // 2) Ad groups (todos) — cada um gravado no progresso ao nascer.
    for (const srcAg of capture.adGroups) {
      const srcAgId = String(srcAg.adgroup_id || srcAg.id || '');
      if (progress.adGroups[srcAgId]) continue; // já criado numa tentativa anterior
      const agArgs = buildAdGroupCopyArgs(adv, progress.campaignId, srcAg, info && info.timezone, warnings, overrides, fallbackLocationIds);
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
      if (vid) adArgs.video_id = vid;
      else if (Array.isArray(imgs) && imgs.length) adArgs.image_ids = imgs;
      else { warnings.push('Anúncio ' + srcAdId + ' ignorado: origem não expõe video_id/image_ids'); continue; }
      // Identidade: a da origem se exposta; senão a utilizável da conta.
      const srcIdentityId = String(srcAd.identity_id || '');
      const srcIdentityType = String(srcAd.identity_type || '').toUpperCase();
      if (srcIdentityId && srcIdentityType && srcIdentityType !== 'TT_USER' && srcIdentityType !== 'AUTH_CODE') {
        adArgs.identity_id = srcIdentityId;
        adArgs.identity_type = srcIdentityType;
        if (srcAd.identity_authorized_bc_id) adArgs.identity_authorized_bc_id = String(srcAd.identity_authorized_bc_id);
        if (srcIdentityType === 'BC_AUTH_TT') {
          if (srcAd.identity_bc_id) adArgs.identity_bc_id = String(srcAd.identity_bc_id);
          adArgs.dark_post_status = 'ON';
        }
      } else if (fallbackIdentity) {
        adArgs.identity_id = fallbackIdentity.identityId;
        adArgs.identity_type = fallbackIdentity.identityType;
        if (fallbackIdentity.identityBcId) adArgs.identity_bc_id = fallbackIdentity.identityBcId;
        if (fallbackIdentity.darkPost) adArgs.dark_post_status = 'ON';
        if (srcIdentityType === 'TT_USER' || srcIdentityType === 'AUTH_CODE') warnings.push('Anúncio ' + srcAdId + ' era Spark (identidade não copiável) — recriado com a identidade padrão da conta');
      } else { warnings.push('Anúncio ' + srcAdId + ' ignorado: nenhuma identidade utilizável'); continue; }
      if (srcAd.landing_page_url) adArgs.landing_page_url = String(srcAd.landing_page_url).slice(0, 500);
      if (srcAd.call_to_action) adArgs.call_to_action = String(srcAd.call_to_action);
      else if (srcAd.call_to_action_id) adArgs.call_to_action_id = String(srcAd.call_to_action_id);
      if (Array.isArray(srcAd.utm_params) && srcAd.utm_params.length) adArgs.utm_params = srcAd.utm_params;
      if (Array.isArray(srcAd.deeplink_utm_params) && srcAd.deeplink_utm_params.length) adArgs.deeplink_utm_params = srcAd.deeplink_utm_params;
      const adOut = await callTikTokWriteWithRetry('create_tiktok_ad', adArgs, () => warnings.push('Instabilidade temporária do TikTok ao criar o anúncio — nova tentativa automática'));
      const newAdId = String(deepPluck(adOut, 'ad_id') || '');
      if (!newAdId) throw stepError('ad', 'create_tiktok_ad não retornou ad_id na duplicação', progress);
      progress.ads[srcAdId] = newAdId;
      await report({ ...progress });
    }

    cacheBust('tree:');
    return {
      campaignId: progress.campaignId,
      adGroupIds: Object.values(progress.adGroups),
      adIds: Object.values(progress.ads),
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
  const budgetAmount = Number(s.budgetAmount);
  if (!(budgetAmount > 0)) throw badRequest('Orçamento inválido');
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
// Center (bc_id): o TikTok prende catálogos ao BC, não ao advertiser. Não há
// tool para LISTAR os BCs, então o bc_id é resolvido de: seleção persistida na
// conta (config.pipeboardAds.bcId) → env TIKTOK_BC_ID/PIPEBOARD_BC_ID.
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

function getBusinessCenterId(accountId) {
  const st = getState(accountId);
  return String(st.bcId || '').trim() || ENV_DEFAULT_BC;
}
function businessCenterFromEnv(accountId) {
  // true quando o bc_id efetivo vem só do env (a conta não gravou o seu).
  return !String(getState(accountId).bcId || '').trim() && !!ENV_DEFAULT_BC;
}
function setBusinessCenterId(accountId, bcId) {
  const clean = String(bcId || '').trim().slice(0, 40);
  setState(accountId, { bcId: clean });
  return clean;
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
    approved: num('approved', 'approved_count', 'pass', 'pass_count', 'available'),
    pending: num('pending', 'pending_count', 'processing', 'in_review', 'reviewing'),
    rejected: num('disapproved', 'rejected', 'rejected_count', 'fail', 'fail_count', 'unavailable'),
    total: num('total', 'total_count', 'product_count'),
    raw: out,
  };
}

let catalogCapabilitiesCache = null;

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
    catalogAudit: false,
    catalogLinkVerify: false,
    manualCatalogCampaign: false,
    productSets: false,
    catalogVideoTemplates: false,
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
    const hasFields = (name, required) => {
      const present = fields(name);
      return required.every((field) => present.has(field));
    };
    const catalogCreate = hasFields('create_tiktok_catalog', ['bc_id', 'name', 'catalog_type', 'catalog_conf']);
    const catalogUpload = byName.has('upload_tiktok_catalog_products');
    const catalogAudit = byName.has('get_tiktok_catalog_overview');
    const catalogLinkVerify = byName.has('get_tiktok_catalogs');
    const campaignFields = hasFields('create_tiktok_campaign', ['advertiser_id', 'campaign_name', 'objective_type', 'catalog_id', 'shopping_ads_type']);
    const adgroupFields = hasFields('create_tiktok_adgroup', ['advertiser_id', 'campaign_id', 'catalog_id', 'shopping_ads_type', 'product_source', 'store_authorized_bc_id']);
    const adFields = hasFields('create_tiktok_ad', ['advertiser_id', 'adgroup_id', 'catalog_id', 'catalog_video_template_id']);
    const manualCatalogCampaign = campaignFields && adgroupFields && adFields;
    const value = {
      catalogCreate,
      catalogUpload,
      catalogAudit,
      catalogLinkVerify,
      manualCatalogCampaign,
      productSets: false,
      catalogVideoTemplates: false,
      note: manualCatalogCampaign
        ? 'Campanhas de catálogo estão disponíveis pelos schemas atuais do Pipeboard.'
        : 'O Pipeboard atual não expõe todos os campos de Product Sales nas tools genéricas. Crie a campanha no TikTok Ads Manager para evitar campanha parcial.',
    };
    catalogCapabilitiesCache = { value, expiresAt: now + 5 * 60 * 1000 };
    return value;
  } catch (_) {
    return unavailable;
  }
}

// Cria um catálogo no TikTok. Devolve { catalogId, raw }.
async function createTikTokCatalog(bcId, { name, catalogType, currency, country } = {}) {
  const bc = String(bcId || '').trim();
  if (!bc) throw badRequest('Business Center (bc_id) é obrigatório para criar o catálogo no TikTok', 422);
  const nm = String(name || '').trim().slice(0, 200);
  if (!nm) throw badRequest('Nome do catálogo é obrigatório');
  const capabilities = await getCatalogCapabilities();
  if (!capabilities.catalogCreate) {
    const err = badRequest('A criação automática de catálogo não é suportada pelo schema atual do Pipeboard. Crie o catálogo no TikTok Catalog Manager e conecte o Catalog ID nesta dashboard.', 501);
    err.code = 'CATALOG_CREATE_UNSUPPORTED';
    err.userMessage = err.message;
    err.suggestedAction = 'Crie o catálogo no TikTok Catalog Manager e use Conexão TikTok para validar o Catalog ID e o Business Center.';
    err.retryable = false;
    throw err;
  }
  const cur = String(currency || '').trim().toUpperCase().slice(0, 8);
  const region = String(country || '').trim().toUpperCase().slice(0, 4);
  const args = {
    bc_id: bc,
    name: nm,
    catalog_type: normalizeCatalogType(catalogType),
  };
  // A API atual do TikTok (catalog/create) exige o objeto catalog_conf com
  // region_code + currency — os campos soltos currency/country foram
  // descontinuados. Mantemos os soltos também por compat com versões antigas
  // da tool do Pipeboard (args extras são repassados sem erro).
  args.catalog_conf = {
    region_code: region || (cur === 'BRL' ? 'BR' : 'US'),
    currency: cur || (region === 'BR' ? 'BRL' : 'USD'),
  };
  if (cur) args.currency = cur;
  if (region) args.country = region;
  let out;
  try {
    out = await pipeboard.callTool('create_tiktok_catalog', args);
  } catch (err) {
    const msg = String(err && err.message || '');
    // BUG conhecido do Pipeboard: a tool create_tiktok_catalog descarta o
    // catalog_conf (schema desatualizado) e o TikTok rejeita com
    // "catalog_conf: Missing data for required field". Não há como corrigir do
    // nosso lado da chamada — então REUTILIZAMOS um catálogo com o mesmo nome
    // que já exista no Business Center (criado manualmente uma única vez no
    // TikTok Catalog Manager). O upload de produtos segue automático.
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
      throw badRequest(
        'A criação automática de catálogo está temporariamente indisponível (bug no Pipeboard: a tool não envia o catalog_conf que o TikTok agora exige). ' +
        'Contorno: crie UMA VEZ um catálogo chamado "' + nm + '" no TikTok Catalog Manager (Business Center) e clique em "Publicar no TikTok" de novo — a dashboard vai reutilizá-lo e subir os produtos automaticamente.',
        502
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

// Overview de auditoria dos produtos (aprovados/pendentes/reprovados).
async function getTikTokCatalogOverview(bcId, catalogId) {
  const bc = String(bcId || '').trim();
  const cid = String(catalogId || '').trim();
  if (!bc || !cid) throw badRequest('bc_id e catalog_id são obrigatórios');
  const out = await pipeboard.callTool('get_tiktok_catalog_overview', { bc_id: bc, catalog_id: cid });
  return normalizeCatalogOverview(out);
}

// Lista os catálogos existentes no Business Center (cache curto).
async function listTikTokCatalogs(bcId) {
  const bc = String(bcId || '').trim();
  if (!bc) throw badRequest('Business Center (bc_id) é obrigatório', 422);
  const ck = 'catalogs:' + bc;
  const hit = cacheGet(ck);
  if (hit) return hit;
  const out = await pipeboard.callTool('get_tiktok_catalogs', { bc_id: bc, page: 1, page_size: 50 });
  const list = firstArray(out, ['catalogs', 'catalog_list', 'list', 'data']);
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
  const id = String(c.campaign_id || c.id || '');
  return {
    campaignId: id,
    name: String(c.campaign_name || c.name || id),
    objective: String(c.objective_type || ''),
    budget: Number(c.budget || 0),
    budgetMode: String(c.budget_mode || ''),
    status: tiktokStatusToNode(c.operation_status, c.secondary_status),
    rawStatus: String(c.operation_status || ''),
    secondaryStatus: String(c.secondary_status || ''),
  };
}

function mapSmartPlusAd(a) {
  const id = String(a.smart_plus_ad_id || a.ad_id || a.id || '');
  const node = tiktokStatusToNode(a.operation_status, a.secondary_status);
  return {
    adId: id,
    name: String(a.ad_name || a.name || id),
    campaignId: String(a.campaign_id || ''),
    status: node,
    rejected: node === 'rejected',
    rejectionReason: node === 'rejected' ? (String(a.secondary_status || '') || 'Reprovado pelo TikTok') : undefined,
  };
}

async function listSmartPlusCampaigns(advertiserId) {
  const adv = String(advertiserId || '').trim();
  if (!adv) throw badRequest('advertiserId é obrigatório');
  const out = await pipeboard.callTool('get_tiktok_smart_plus_campaigns', { advertiser_id: adv, page: 1, page_size: 50 });
  return firstArray(out, ['campaigns', 'campaign_list', 'list', 'data']).map(mapSmartPlusCampaign);
}

async function listSmartPlusAds(advertiserId, opts = {}) {
  const adv = String(advertiserId || '').trim();
  if (!adv) throw badRequest('advertiserId é obrigatório');
  const out = await pipeboard.callTool('get_tiktok_smart_plus_ads', { advertiser_id: adv, page: 1, page_size: 100 });
  let list = firstArray(out, ['ads', 'ad_list', 'list', 'data']).map(mapSmartPlusAd);
  const cid = String(opts.campaignId || '').trim();
  if (cid) list = list.filter((a) => !a.campaignId || a.campaignId === cid);
  return list;
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

async function appealSmartPlusAd(advertiserId, adId, reason) {
  const adv = String(advertiserId || '').trim();
  const id = String(adId || '').trim();
  if (!adv || !id) throw badRequest('advertiserId e o ID do anúncio Smart+ são obrigatórios');
  const args = { advertiser_id: adv, smart_plus_ad_id: id };
  const r = String(reason || '').trim();
  if (r) args.appeal_reason = r.slice(0, 500);
  return pipeboard.callTool('appeal_tiktok_smart_plus_ad', args);
}

// Mapa objetivo (UI) → campos reais do Smart+ (schemas confirmados via MCP).
// Foco no funil de site do gestor de tráfego: conversões (pixel) e tráfego.
const SMART_PLUS_GOALS = {
  conversions: { objective: 'WEB_CONVERSIONS', promotion: 'WEBSITE', optimization: 'CONVERT', billing: 'OCPM', salesDestination: 'WEBSITE' },
  traffic: { objective: 'TRAFFIC', promotion: 'WEBSITE', optimization: 'CLICK', billing: 'CPC' },
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
  if (!g) throw badRequest('Objetivo Smart+ não suportado: "' + s.goal + '" (use conversions ou traffic)');
  if (!/^https:\/\/[^\s]+/.test(String(s.videoUrl || ''))) throw badRequest('Vídeo (URL https) é obrigatório');
  if (!/^https:\/\/[^\s]+/.test(String(s.coverUrl || ''))) throw badRequest('Capa do vídeo (URL https) é obrigatória para Smart+');
  if (!/^https:\/\/[^\s]+/.test(String(s.linkUrl || ''))) throw badRequest('Link de destino (URL https) é obrigatório para Smart+');
  const budget = Number(s.budgetAmount);
  if (!(budget > 0)) throw badRequest('Orçamento total inválido');
  if (s.goal === 'conversions' && !/^\d{5,30}$/.test(String(s.pixelId || ''))) {
    throw badRequest('Conversões exigem o Pixel ID NUMÉRICO do TikTok');
  }
  if (s.goal === 'conversions' && !/^[A-Z_]{3,40}$/.test(String(s.customEventType || ''))) {
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
    if (s.goal === 'conversions') {
      agArgs.pixel_id = String(s.pixelId);
      if (s.customEventType) agArgs.optimization_event = String(s.customEventType).toUpperCase();
    }
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

// ── Campanha de catálogo (DPA / Catalog Listing Ads) ────────────────────────
// Lança uma campanha de vendas de produto (PRODUCT_SALES) a partir de um catálogo
// já sincronizado no TikTok — "todos os produtos" (o TikTok gera o criativo do
// catálogo, sem vídeo/âncora manual). MVP de menor risco que tira o gestor do Ads
// Manager. Mesmo molde à prova de órfãos do createFullAd/createSmartPlusCampaign:
// tudo nasce PAUSED; falha no meio pausa a campanha e reporta o passo.
//
// ⚠️ O Pipeboard não tem tool dedicada de campanha de catálogo — usa as genéricas
// create_tiktok_campaign/adgroup/ad com os campos de catálogo. Se a API recusar
// algum campo, o erro carrega o passo + createdIds e o parcial fica pausado.
//
// spec V2: inclui o escopo de produtos, identidade, pixel e template que o
// fluxo funcional do Ads Manager exige. `opts.resume` + `opts.onProgress`
// tornam a composição retomável por um worker durável.
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

  const countries = (Array.isArray(s.countries) && s.countries.length ? s.countries : (s.country ? [s.country] : ['BR']));
  // O export que funciona no Ads Manager identifica o conjunto como Video
  // Shopping Ads e o anúncio como Catalog video. Os overrides permitem ajustar
  // o enum sem release caso o schema do Pipeboard mude novamente.
  const SHOPPING_TYPE = String(process.env.TIKTOK_CATALOG_SHOPPING_TYPE || 'VIDEO_SHOPPING_ADS').trim();
  const AD_FORMAT = String(process.env.TIKTOK_CATALOG_AD_FORMAT || 'CATALOG_VIDEO').trim();
  const explicitIdentity = s.identityId && s.identityType ? {
    identityId: String(s.identityId), identityType: String(s.identityType).toUpperCase(),
    identityBcId: s.identityBcId ? String(s.identityBcId) : undefined,
  } : null;
  const [info, identity, regions] = await Promise.all([
    getAdvertiserInfo(adv),
    explicitIdentity || pickAdIdentity(adv).catch(() => null),
    resolveLocationIds(adv, countries, 'PRODUCT_SALES'),
  ]);
  const warnings = [];
  if (regions.missingCountries.length) warnings.push('Países sem região no TikTok (ignorados): ' + regions.missingCountries.join(', '));
  const plan = resolveBudgetPlan(s);
  const createdIds = { ...((options && options.resume) || {}) };
  const report = async (stage) => {
    if (typeof options.onProgress === 'function') await options.onProgress({ stage, createdIds: { ...createdIds } });
  };

  // 1) Campanha PRODUCT_SALES (catálogo)
  const campArgs = {
    advertiser_id: adv,
    campaign_name: String(s.name).slice(0, 512),
    objective_type: 'PRODUCT_SALES',
    shopping_ads_type: SHOPPING_TYPE,
    catalog_id: catalogId,
    operation_status: 'DISABLE',
  };
  if (plan.cbo) {
    campArgs.budget_mode = plan.campaign.budget_mode;
    campArgs.budget = plan.campaign.budget;
    campArgs.budget_optimize_on = true;
  }
  let campaignId = String(createdIds.campaignId || '');
  try {
    await report('creating_campaign');
    if (!campaignId) {
      const campOut = await callTikTokWriteWithRetry('create_tiktok_campaign', campArgs, () => warnings.push('Instabilidade temporária do TikTok ao criar a campanha — nova tentativa automática'));
      campaignId = String(deepPluck(campOut, 'campaign_id') || '');
      if (!campaignId) throw stepError('campaign', 'create_tiktok_campaign não retornou campaign_id');
      createdIds.campaignId = campaignId;
      await report('creating_adgroup');
    }

    // 2) Ad group — fonte = catálogo. O pixel é um identificador opaco: alguns
    // exports usam código alfanumérico, portanto não aplicamos regex numérica.
    const agArgs = {
      advertiser_id: adv,
      campaign_id: campaignId,
      adgroup_name: String(s.name).slice(0, 500) + ' — grupo 1',
      shopping_ads_type: SHOPPING_TYPE,
      product_source: 'CATALOG',
      catalog_id: catalogId,
      store_authorized_bc_id: bcId,
      optimization_goal: 'CONVERT',
      billing_event: 'OCPM',
      schedule_start_time: advertiserLocalTime(info && info.timezone),
      targeting: { location_ids: regions.locationIds },
      operation_status: 'DISABLE',
    };
    if (s.pixelId) agArgs.pixel_id = String(s.pixelId);
    if (s.pixelEvent) agArgs.optimization_event = String(s.pixelEvent);
    if (plan.adgroup.budget_mode) agArgs.budget_mode = plan.adgroup.budget_mode;
    if (plan.adgroup.budget != null) agArgs.budget = plan.adgroup.budget;
    Object.assign(agArgs, plan.bid);
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

    // 3) Anúncio de catálogo. Produto/template/identidade são parte do contrato,
    // em vez de depender de defaults invisíveis do Ads Manager.
    const adArgs = {
      advertiser_id: adv,
      adgroup_id: adGroupId,
      ad_name: String(s.name).slice(0, 500),
      ad_format: AD_FORMAT,
      catalog_id: catalogId,
      website_type: 'PRODUCT_LINK',
      destination_page_type: 'WEBSITE',
      status: 'PAUSED',
    };
    const productScope = ['all', 'product_set', 'specific'].includes(s.productScope) ? s.productScope : 'all';
    adArgs.products_type = productScope === 'specific' ? 'SPECIFIC_PRODUCTS' : productScope === 'product_set' ? 'PRODUCT_SET' : 'ALL_PRODUCTS';
    if (productScope === 'specific') adArgs.product_ids = (Array.isArray(s.productIds) ? s.productIds : []).map(String).filter(Boolean).slice(0, 20);
    if (productScope === 'product_set' && s.productSetId) adArgs.product_set_id = String(s.productSetId);
    if (s.catalogVideoTemplateId) adArgs.catalog_video_template_id = String(s.catalogVideoTemplateId);
    if (s.text) adArgs.ad_text = String(s.text).slice(0, 100);
    if (s.callToAction) adArgs.call_to_action = String(s.callToAction).toUpperCase();
    if (identity && identity.identityId) {
      adArgs.identity_id = identity.identityId;
      adArgs.identity_type = identity.identityType;
      if (identity.identityBcId) adArgs.identity_bc_id = identity.identityBcId;
      if (identity.identityType === 'BC_AUTH_TT') adArgs.dark_post_status = 'ON';
    }
    await report('creating_ad');
    if (!createdIds.adId) {
      const adOut = await callTikTokWriteWithRetry('create_tiktok_ad', adArgs, () => warnings.push('Instabilidade temporária do TikTok ao criar o anúncio — nova tentativa automática'));
      const adId = String(deepPluck(adOut, 'ad_id') || '');
      if (!adId) throw stepError('ad', 'create_tiktok_ad não retornou ad_id para o anúncio de catálogo', createdIds);
      createdIds.adId = adId;
    }

    // Não declaramos sucesso com apenas um campaign_id. A leitura imediata
    // pode ter atraso eventual; tentamos três vezes antes de sinalizar verify.
    await report('verifying_entities');
    let verified = false;
    for (let attempt = 0; attempt < 3 && !verified; attempt += 1) {
      try {
        const [campaigns, adGroups, ads] = await Promise.all([
          getCampaigns(adv, { pageSize: 100, campaignIds: [campaignId] }),
          getAdGroups(adv, [campaignId], { pageSize: 100 }),
          getAds(adv, { campaignIds: [campaignId], adgroupIds: [adGroupId], pageSize: 100 }),
        ]);
        verified = campaigns.some((item) => String(item.id) === String(campaignId))
          && adGroups.some((item) => String(item.id) === String(adGroupId))
          && ads.some((item) => String(item.id) === String(createdIds.adId));
      } catch (_) { /* consistência eventual / leitura best-effort */ }
      if (!verified && attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1200));
    }
    if (!verified) {
      const err = stepError('verify', 'Os IDs foram criados, mas a hierarquia completa ainda não apareceu na leitura do TikTok', createdIds, 502);
      err.retryable = true;
      throw err;
    }

    warnings.push('Campanha de catálogo criada em PAUSA — ative em Campanhas quando estiver pronta');
    cacheBust('tree:');
    await report('ready_paused');
    return { ...createdIds, name: s.name, warnings };
  } catch (err) {
    // Órfã não pode ficar entregável: pausa best-effort e devolve o passo.
    if (campaignId) {
      try { await setCampaignStatus(adv, [campaignId], 'paused'); } catch (_) { /* best-effort */ }
    }
    if (!err.step) err.step = campaignId ? 'adgroup' : 'campaign';
    err.createdIds = createdIds;
    throw err;
  }
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
  updateCampaign,
  updateAdGroup,
  updateAd,
  // criação composta (F1)
  createFullAd,
  // duplicação composta (F3)
  captureCampaign,
  recreateCampaign,
  // Spark Ads (F5)
  listSparkIdentities,
  listIdentityVideos,
  createSparkAd,
  // catálogos (TikTok Shopping / DPA)
  getBusinessCenterId,
  businessCenterFromEnv,
  setBusinessCenterId,
  createTikTokCatalog,
  uploadTikTokCatalogProducts,
  getTikTokCatalogOverview,
  listTikTokCatalogs,
  updateTikTokCatalogName,
  getCatalogCapabilities,
  createCatalogCampaign,
  CATALOG_TYPES,
  // direcionamento (leitura p/ a criação)
  listInterestCategories,
  // Smart+ (gestão + appeal de anúncio + criação composta)
  listSmartPlusCampaigns,
  listSmartPlusAds,
  setSmartPlusCampaignStatus,
  appealSmartPlusAd,
  createSmartPlusCampaign,
  // cache
  cacheBust,
  cacheGet,
  cacheSet,
  // helpers expostos p/ teste
  _internals: { normalizeAdvertiserStatus, mapCampaign, mapAdGroup, mapAd, mapInsightRow, toOperationStatus, toBudgetMode, deepPluck, firstArray, ageGroupsFor, advertiserLocalTime, resolveLocationIds, pickAdIdentity, resolveBudgetPlan, GOAL_MAP, createCatalogCampaign, listInterestCategories, getCatalogCapabilities },
};
