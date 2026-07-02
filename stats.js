const fs = require('fs');
const path = require('path');
const db = require('./db');

// ── Store de estatísticas ──────────────────────────────────────────────────
// REMODELADO: o estado agora vive EM MEMÓRIA (fonte quente) e é persistido:
//   1. no Neon (write-through assíncrono, fonte de verdade durável);
//   2. em arquivo JSON local (snapshot debounced, apenas fallback/diagnóstico).
// Antes, cada evento lia e regravava o arquivo inteiro de forma síncrona —
// O(n) por hit e propenso a corrupção sob concorrência. Agora cada operação
// é O(1) em memória e o disco é tocado no máximo 1x por segundo.
const DATA_DIR = path.join(__dirname, 'data');
const FILE = path.join(DATA_DIR, 'stats.json');

const VARIANTS = ['stripe', 'cooud'];

// Cache quente (o banco Neon guarda o histórico completo, sem limite).
const MAX_EVENTS = 3000; // mantém os últimos N eventos no feed local
const MAX_LEADS = 8000;  // mantém os últimos N leads rastreados no cache local

// Conversão que chega muito depois do lead = provável "Recuperar Prejuízo" do Cooud
// (o gateway re-tenta cobranças recusadas/abandonadas para "recuperar" a venda).
const RECOVERY_LATE_MS = 60 * 60 * 1000; // 1 hora

const FLUSH_MS = 1000; // debounce do snapshot em disco

function emptyVariant() {
  return { assignments: 0, clicks: 0, conversions: 0, revenue: {} };
}

function emptyState() {
  const variants = {};
  VARIANTS.forEach((v) => { variants[v] = emptyVariant(); });
  return { variants, events: [], leads: [], updatedAt: null };
}

function newId(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ── Estado em memória + índice de leads por id (busca O(1)) ───────────────
let state = null;
let leadIndex = new Map(); // id -> lead (referência ao objeto em state.leads)

function rebuildIndex() {
  leadIndex = new Map();
  (state.leads || []).forEach((l) => { if (l && l.id) leadIndex.set(l.id, l); });
}

function loadFromDisk() {
  const s = emptyState();
  try {
    if (fs.existsSync(FILE)) {
      const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      VARIANTS.forEach((v) => {
        if (raw.variants && raw.variants[v]) {
          s.variants[v] = Object.assign(emptyVariant(), raw.variants[v]);
          if (!s.variants[v].revenue) s.variants[v].revenue = {};
        }
      });
      s.events = Array.isArray(raw.events) ? raw.events : [];
      s.leads = Array.isArray(raw.leads) ? raw.leads : [];
      s.updatedAt = raw.updatedAt || null;
    }
  } catch (err) {
    console.error('[stats] Erro ao ler snapshot, iniciando vazio:', err.message);
  }
  return s;
}

function ensureLoaded() {
  if (state) return;
  state = loadFromDisk();
  rebuildIndex();
}

// ── Snapshot em disco (assíncrono + debounced; nunca bloqueia requests) ────
let flushTimer = null;
let flushing = false;
let dirtyAgain = false;

function flushToDisk() {
  if (flushing) { dirtyAgain = true; return; }
  flushing = true;
  const payload = JSON.stringify(state);
  const tmp = FILE + '.tmp';
  fs.mkdir(DATA_DIR, { recursive: true }, () => {
    // grava em arquivo temporário + rename atômico (evita snapshot corrompido)
    fs.writeFile(tmp, payload, (err) => {
      if (err) { console.error('[stats] Erro ao gravar snapshot:', err.message); flushing = false; return; }
      fs.rename(tmp, FILE, (err2) => {
        flushing = false;
        if (err2) console.error('[stats] Erro no rename do snapshot:', err2.message);
        if (dirtyAgain) { dirtyAgain = false; scheduleFlush(); }
      });
    });
  });
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => { flushTimer = null; flushToDisk(); }, FLUSH_MS);
}

function markDirty() {
  ensureLoaded();
  state.updatedAt = new Date().toISOString();
  scheduleFlush();
}

// Flush final no shutdown para não perder o último segundo de dados.
function flushSync() {
  try {
    if (!state) return;
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(state));
  } catch (_) {}
}

// ── Contadores de variante (A/B) ──────────────────────────────────────────
function bump(variant, field, by) {
  if (!VARIANTS.includes(variant)) return;
  ensureLoaded();
  state.variants[variant][field] = (state.variants[variant][field] || 0) + (by || 1);
  markDirty();
  db.upsertVariant(variant, state.variants[variant]);
}

function recordAssignment(variant) { bump(variant, 'assignments', 1); }
function recordClick(variant) { bump(variant, 'clicks', 1); }

function recordConversion(variant, amountCents, currency) {
  if (!VARIANTS.includes(variant)) return;
  ensureLoaded();
  const v = state.variants[variant];
  v.conversions = (v.conversions || 0) + 1;
  const cur = (currency || 'eur').toUpperCase();
  v.revenue[cur] = (v.revenue[cur] || 0) + (amountCents || 0);
  markDirty();
  db.upsertVariant(variant, v);
}

// ── Feed de eventos (venda, recusa, reembolso, disputa, lead, etc.) ───────
function logEvent(type, data) {
  ensureLoaded();
  const entry = Object.assign({
    id: newId('evt'),
    type: type || 'info',
    at: new Date().toISOString()
  }, data || {});
  state.events.unshift(entry);
  if (state.events.length > MAX_EVENTS) state.events.length = MAX_EVENTS;
  markDirty();
  db.insertEvent(entry);
  return entry;
}

// ── Leads ──────────────────────────────────────────────────────────────────
function findLead(id) {
  if (!id) return null;
  ensureLoaded();
  return leadIndex.get(id) || null;
}

function addLead(lead) {
  state.leads.unshift(lead);
  leadIndex.set(lead.id, lead);
  if (state.leads.length > MAX_LEADS) {
    const removed = state.leads.splice(MAX_LEADS);
    removed.forEach((l) => { if (l && l.id) leadIndex.delete(l.id); });
  }
  return lead;
}

// ── FUNIL: entrada de um visitante no site (topo do funil) ────────────────
function recordVisit(data) {
  data = data || {};
  ensureLoaded();
  let lead = findLead(data.id);
  const nowIso = new Date().toISOString();
  if (!lead) {
    lead = addLead({
      id: data.id || newId('ld'),
      at: nowIso,
      stage: 'visit',
      status: 'pending',
      gateway: null,
      ip: data.ip || null,
      ua: data.ua || null,
      referer: data.referer || null,
      country: data.country || null,
      countryName: data.countryName || null,
      city: data.city || null,
      landing: data.landing || null,
      ttclid: data.ttclid || null,
      utm: data.utm || {}
    });
  } else {
    // enriquece dados que faltavam
    ['ip', 'ua', 'referer', 'country', 'countryName', 'city', 'ttclid'].forEach((k) => {
      if (!lead[k] && data[k]) lead[k] = data[k];
    });
    if (data.utm && (!lead.utm || !lead.utm.source) && data.utm.source) lead.utm = data.utm;
    lead.lastSeen = nowIso;
  }
  markDirty();
  db.upsertLead(lead);
  return lead;
}

// ── FUNIL: lead chegou a um checkout (stripe|cooud) ───────────────────────
function recordCheckoutEntry(id, gateway, data) {
  data = data || {};
  ensureLoaded();
  let lead = findLead(id);
  const nowIso = new Date().toISOString();
  if (!lead) {
    lead = addLead({
      id: id || newId('ld'),
      at: nowIso,
      stage: 'checkout',
      status: 'pending',
      gateway: gateway || null,
      ip: data.ip || null,
      ua: data.ua || null,
      referer: data.referer || null,
      country: data.country || null,
      countryName: data.countryName || null,
      city: data.city || null,
      ttclid: data.ttclid || null,
      utm: data.utm || {}
    });
  } else {
    if (lead.stage !== 'purchased') lead.stage = 'checkout';
    lead.gateway = gateway || lead.gateway;
    ['ip', 'ua', 'referer', 'country', 'countryName', 'city', 'ttclid'].forEach((k) => {
      if (!lead[k] && data[k]) lead[k] = data[k];
    });
    if (data.utm && data.utm.source && (!lead.utm || !lead.utm.source)) lead.utm = data.utm;
  }
  lead.checkoutAt = nowIso;
  if (data.expectedAmount) { lead.expectedAmount = data.expectedAmount; lead.expectedCurrency = data.expectedCurrency; }
  // histórico de checkouts que o lead entrou
  lead.checkoutHits = (lead.checkoutHits || []);
  lead.checkoutHits.push({ gateway, at: nowIso });
  if (lead.checkoutHits.length > 10) lead.checkoutHits = lead.checkoutHits.slice(-10);
  markDirty();
  db.upsertLead(lead);
  return lead;
}

// Guarda dados de tracking sensíveis (ex.: tt_url REAL) no lead, no servidor.
// Nunca vão para a metadata da Stripe — só usados no TikTok Events API (CAPI).
function attachTracking(id, patch) {
  if (!id || !patch) return null;
  ensureLoaded();
  let lead = findLead(id);
  const nowIso = new Date().toISOString();
  if (!lead) {
    lead = addLead({ id, at: nowIso, stage: 'checkout', status: 'pending', gateway: 'stripe', utm: {} });
  }
  if (patch.ttUrl) lead.ttUrl = String(patch.ttUrl).slice(0, 500);
  if (patch.ttclid && !lead.ttclid) lead.ttclid = patch.ttclid;
  if (patch.ttp) lead.ttp = patch.ttp;
  markDirty();
  db.upsertLead(lead);
  return lead;
}

// Recupera um lead por id (usado no webhook para obter a tt_url real).
function getLead(id) {
  return findLead(id);
}

// ── Conversão do Stripe (nativo) ──────────────────────────────────────────
function markPurchased(id, data) {
  data = data || {};
  ensureLoaded();
  let lead = findLead(id);
  const nowIso = new Date().toISOString();
  const cur = (data.currency || 'eur').toUpperCase();
  const amount = data.amountCents || 0;
  if (!lead) {
    lead = addLead({
      id: id || newId('pi'),
      at: nowIso,
      stage: 'purchased',
      status: 'converted',
      gateway: 'stripe',
      utm: {}
    });
  }
  lead.stage = 'purchased';
  lead.status = 'converted';
  lead.gateway = 'stripe';
  lead.convertedAt = nowIso;
  lead.reportedAmount = amount;
  lead.reportedCurrency = cur;
  lead.customer = data.customer || lead.customer || null;
  lead.email = data.email || lead.email || null;
  lead.card = data.card || lead.card || null;
  lead.ref = data.ref || lead.ref || null;
  if (lead.checkoutAt) lead.conversionAgeMs = new Date(nowIso).getTime() - new Date(lead.checkoutAt).getTime();
  markDirty();
  db.upsertLead(lead);
  return lead;
}

// ── Conversão do gateway externo (Cooud) + conciliação anti-desvio ────────
function matchCooudConversion(data) {
  data = data || {};
  ensureLoaded();
  const cur = (data.currency || 'eur').toUpperCase();
  const amount = data.amountCents || 0;
  const nowIso = new Date().toISOString();

  let lead = findLead(data.leadId);

  if (lead) {
    if (lead.status === 'converted') {
      lead.duplicateReports = (lead.duplicateReports || 0) + 1;
    } else {
      lead.status = 'converted';
    }
    lead.stage = 'purchased';
    lead.gateway = 'cooud';
    lead.convertedAt = nowIso;
    lead.reportedAmount = amount;
    lead.reportedCurrency = cur;
    lead.customer = data.customer || lead.customer || null;
    lead.email = data.email || lead.email || null;
    lead.ref = data.ref || lead.ref || null;
    lead.orphan = false;
  } else {
    lead = addLead({
      id: data.leadId || newId('orphan'),
      at: nowIso,
      gateway: 'cooud',
      stage: 'purchased',
      status: 'converted',
      orphan: true,
      convertedAt: nowIso,
      reportedAmount: amount,
      reportedCurrency: cur,
      customer: data.customer || null,
      email: data.email || null,
      ref: data.ref || null,
      utm: {}
    });
  }

  // ── Detecção de práticas do Cooud (Smart Capture / Recuperar Prejuízo) ──
  let capture = data.smartCapture === true;
  let recovery = data.recovery === true;
  let captureExtra = 0;
  if (!lead.orphan && lead.expectedAmount && amount > lead.expectedAmount) {
    capture = true;
    captureExtra = amount - lead.expectedAmount;
  }
  if (lead.duplicateReports) capture = true;
  const baseTime = lead.checkoutAt || lead.at;
  const ageMs = new Date(lead.convertedAt).getTime() - new Date(baseTime).getTime();
  lead.conversionAgeMs = lead.orphan ? null : ageMs;
  if (!lead.orphan && ageMs > RECOVERY_LATE_MS) recovery = true;
  lead.smartCapture = capture;
  lead.recovery = recovery;
  lead.captureExtra = captureExtra;

  const v = state.variants.cooud;
  v.conversions = (v.conversions || 0) + 1;
  v.revenue[cur] = (v.revenue[cur] || 0) + amount;

  markDirty();
  db.upsertLead(lead);
  db.upsertVariant('cooud', v);
  return lead;
}

// Métricas de conciliação do Cooud (anti-desvio)
function cooudReconciliation(leads) {
  const list = (leads || []).filter((l) => l.gateway === 'cooud');
  let sent = 0, matched = 0, orphans = 0, pending = 0, duplicates = 0, valueMismatch = 0;
  let smartCapture = 0, recovery = 0;
  const expectedRev = {}, reportedRev = {}, captureExtraRev = {}, recoveryRev = {};

  list.forEach((l) => {
    const isOrphan = !!l.orphan;
    if (!isOrphan) sent++;
    if (l.duplicateReports) duplicates += l.duplicateReports;

    if (l.status === 'converted') {
      const rc = l.reportedCurrency || 'EUR';
      reportedRev[rc] = (reportedRev[rc] || 0) + (l.reportedAmount || 0);
      if (l.expectedAmount) {
        const ec = l.expectedCurrency || 'EUR';
        expectedRev[ec] = (expectedRev[ec] || 0) + l.expectedAmount;
        if (rc === ec && (l.reportedAmount || 0) < l.expectedAmount) valueMismatch++;
      }
      if (l.smartCapture) {
        smartCapture++;
        if (l.captureExtra) captureExtraRev[rc] = (captureExtraRev[rc] || 0) + l.captureExtra;
      }
      if (l.recovery) {
        recovery++;
        recoveryRev[rc] = (recoveryRev[rc] || 0) + (l.reportedAmount || 0);
      }
      if (isOrphan) orphans++; else matched++;
    } else {
      pending++;
    }
  });

  const totalReported = matched + orphans;
  const convRate = sent ? +((matched / sent) * 100).toFixed(2) : 0;
  return {
    sent, matched, orphans, pending, duplicates, valueMismatch,
    smartCapture, recovery, captureExtraRev, recoveryRev,
    totalReported, convRate, expectedRev, reportedRev
  };
}

// ── Snapshot agregado para a dashboard ─────────────────────────────────────
// Cache curto: /api/stats é chamado em polling; evita reagregar a cada hit.
let statsCache = null;
let statsCacheAt = 0;
const STATS_CACHE_MS = 2000;

function getStats() {
  const now = Date.now();
  if (statsCache && (now - statsCacheAt) < STATS_CACHE_MS) return statsCache;
  ensureLoaded();
  const out = { variants: {}, events: state.events || [], updatedAt: state.updatedAt };

  VARIANTS.forEach((v) => {
    const d = state.variants[v];
    const base = d.assignments || 0;
    out.variants[v] = {
      assignments: base,
      clicks: d.clicks || 0,
      conversions: d.conversions || 0,
      conversionRate: base ? +((d.conversions / base) * 100).toFixed(2) : 0,
      revenue: d.revenue || {}
    };
  });

  // ── Totais globais ──
  const revenue = {};
  VARIANTS.forEach((v) => {
    const rev = out.variants[v].revenue || {};
    Object.keys(rev).forEach((cur) => { revenue[cur] = (revenue[cur] || 0) + rev[cur]; });
  });
  let sales = 0, failed = 0, refunds = 0, disputes = 0;
  (state.events || []).forEach((e) => {
    if (e.type === 'sale') sales++;
    else if (e.type === 'failed') failed++;
    else if (e.type === 'refund') refunds++;
    else if (e.type === 'dispute') disputes++;
  });
  const totalAttempts = sales + failed;
  out.totals = {
    revenue, sales, failed, refunds, disputes,
    approvalRate: totalAttempts ? +((sales / totalAttempts) * 100).toFixed(1) : 0
  };

  // ── Funil (todos os leads) ──
  const leads = state.leads || [];
  const realLeads = leads.filter((l) => !l.orphan); // leads que originamos
  const visits = realLeads.length;
  const reachedCheckout = realLeads.filter((l) => l.stage === 'checkout' || l.stage === 'purchased').length;
  const purchased = realLeads.filter((l) => l.stage === 'purchased').length;
  const byGateway = { stripe: { checkout: 0, purchased: 0 }, cooud: { checkout: 0, purchased: 0 } };
  realLeads.forEach((l) => {
    if (l.gateway && byGateway[l.gateway]) {
      if (l.stage === 'checkout' || l.stage === 'purchased') byGateway[l.gateway].checkout++;
      if (l.stage === 'purchased') byGateway[l.gateway].purchased++;
    }
  });
  out.funnel = {
    visits,
    reachedCheckout,
    purchased,
    visitToCheckout: visits ? +((reachedCheckout / visits) * 100).toFixed(1) : 0,
    checkoutToPurchase: reachedCheckout ? +((purchased / reachedCheckout) * 100).toFixed(1) : 0,
    overall: visits ? +((purchased / visits) * 100).toFixed(1) : 0,
    byGateway
  };

  // ── Países (geo dos leads) ──
  const countryMap = {};
  realLeads.forEach((l) => {
    if (!l.country) return;
    if (!countryMap[l.country]) countryMap[l.country] = { code: l.country, name: l.countryName || l.country, count: 0, purchased: 0 };
    countryMap[l.country].count++;
    if (l.stage === 'purchased') countryMap[l.country].purchased++;
  });
  out.countries = Object.values(countryMap).sort((a, b) => b.count - a.count);

  // ── Cooud (anti-desvio) + leads recentes ──
  out.cooud = cooudReconciliation(leads);
  out.cooud.stripeConvRate = out.variants.stripe ? out.variants.stripe.conversionRate : 0;
  out.leads = leads.slice(0, 3000); // envia histórico amplo p/ filtros de vários dias

  statsCache = out;
  statsCacheAt = now;
  return out;
}

function invalidateStatsCache() { statsCache = null; }

function reset() {
  state = emptyState();
  rebuildIndex();
  invalidateStatsCache();
  markDirty();
  flushToDisk();
  db.reset();
}

// ── Hidratação do cache a partir do Neon (chamado no boot) ────────────────
// Faz o banco ser a fonte de verdade após um deploy/reinício: o arquivo local
// é efêmero, então recarregamos leads/eventos/variantes do Postgres.
async function hydrate() {
  try {
    await db.init();
    if (!db.enabled) return;
    const persisted = await db.loadState(MAX_LEADS, MAX_EVENTS);
    if (!persisted) return;
    ensureLoaded();
    // Banco vence sobre o arquivo efêmero (que costuma estar vazio no boot).
    if (persisted.leads && persisted.leads.length) state.leads = persisted.leads.slice(0, MAX_LEADS);
    if (persisted.events && persisted.events.length) state.events = persisted.events.slice(0, MAX_EVENTS);
    VARIANTS.forEach((v) => {
      if (persisted.variants && persisted.variants[v]) {
        state.variants[v] = Object.assign(emptyVariant(), persisted.variants[v]);
        if (!state.variants[v].revenue) state.variants[v].revenue = {};
      }
    });
    rebuildIndex();
    invalidateStatsCache();
    markDirty();
    console.log('[stats] Hidratado do Neon: ' + state.leads.length + ' leads, ' + state.events.length + ' eventos.');
  } catch (err) {
    console.error('[stats] Erro ao hidratar do Neon:', err.message);
  }
}

// Garante snapshot final ao encerrar o processo (deploy/restart).
process.once('SIGTERM', flushSync);
process.once('SIGINT', flushSync);
process.once('beforeExit', flushSync);

module.exports = {
  VARIANTS, recordAssignment, recordClick, recordConversion,
  logEvent, recordVisit, recordCheckoutEntry, markPurchased,
  attachTracking, getLead, matchCooudConversion, getStats, reset, hydrate
};
