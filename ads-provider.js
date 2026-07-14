// ads-provider.js — camada de leitura do TikTok Ads sobre o Pipeboard MCP.
//
// [Gate 2 da migração Zernio → Pipeboard]
// Este módulo é a ÚNICA fronteira entre o shape que o dashboard espera e o
// protocolo MCP do Pipeboard. As rotas (ads-routes.js) NÃO devem falar com o
// pipeboard-mcp diretamente — elas chamam este provider, que:
//   • resolve o advertiser_id (env default + seleção persistida por conta);
//   • mapeia os payloads REAIS do Pipeboard (capturados via /api/ads/diag em
//     docs/pipeboard-tools.md) para o formato do painel;
//   • cacheia leituras com TTL curto (o Pipeboard cobra por chamada e a lista
//     de advertisers só traz IDs — nomes exigem 1 chamada/conta).
//
// DESCOBERTAS DO GATE 1 que moldam este arquivo:
//   • 155 advertisers autorizados (NÃO conta única). list_tiktok_advertisers
//     devolve { total_advertisers, advertiser_ids:[...] } — só IDs, sem nome.
//     Nome/moeda/status vêm de get_tiktok_advertiser_info (1 chamada/id) →
//     enriquecimento é preguiçoso e cacheado; nunca 155 de uma vez.
//   • Não há OAuth/SocialAccount/profile: "conectado" = chave presente no
//     servidor + advertiser resolvido.
//
// Este gate é aditivo: o módulo existe e é testável isoladamente, mas ainda
// NÃO está plugado nas rotas (isso é o Gate 3). Assim o gate é reversível.

const pipeboard = require('./pipeboard-mcp');
const config = require('./config');

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

async function getCampaigns(advertiserId, { pageSize = 100 } = {}) {
  const id = String(advertiserId);
  const out = await pipeboard.callTool('get_tiktok_campaigns', { advertiser_id: id, page: 1, page_size: pageSize });
  return (out.campaigns || []).map(mapCampaign);
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
//     childStatus?, platformCampaignStatus, reviewStatus, adCount, adSetCount,
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

  // filtro de status aplicado sobre o conjunto completo cacheado
  let campaigns = base.campaigns;
  if (statusFilter) campaigns = campaigns.filter((c) => c.status === statusFilter || c.childStatus === statusFilter);
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
  // cache
  cacheBust,
  cacheGet,
  cacheSet,
  // helpers expostos p/ teste
  _internals: { normalizeAdvertiserStatus, mapCampaign, mapAdGroup, mapAd, mapInsightRow },
};
