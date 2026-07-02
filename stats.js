const fs = require('fs');
const path = require('path');
const db = require('./db');

// Store simples baseado em arquivo JSON. Suficiente para o teste A/B + funil.
// OBS: no Railway o filesystem é efêmero (reseta a cada deploy). Para histórico
// permanente, migrar depois para um banco (ex.: Neon).
const DATA_DIR = path.join(__dirname, 'data');
const FILE = path.join(DATA_DIR, 'stats.json');

const VARIANTS = ['stripe', 'cooud'];

function emptyVariant() {
  return { assignments: 0, clicks: 0, conversions: 0, revenue: {} };
}

// Cache quente em arquivo (o banco Neon guarda o histórico completo, sem limite).
const MAX_EVENTS = 3000; // mantém os últimos N eventos no feed local
const MAX_LEADS = 8000;  // mantém os últimos N leads rastreados no cache local

// Conversão que chega muito depois do lead = provável "Recuperar Prejuízo" do Cooud
// (o gateway re-tenta cobranças recusadas/abandonadas para "recuperar" a venda).
const RECOVERY_LATE_MS = 60 * 60 * 1000; // 1 hora

function emptyState() {
  const variants = {};
  VARIANTS.forEach((v) => { variants[v] = emptyVariant(); });
  return { variants, events: [], leads: [], updatedAt: null };
}

function ensureFile() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, JSON.stringify(emptyState(), null, 2));
  } catch (err) {
    console.error('[stats] Erro ao criar arquivo:', err.message);
  }
}

function read() {
  ensureFile();
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    const state = emptyState();
    VARIANTS.forEach((v) => {
      if (raw.variants && raw.variants[v]) {
        state.variants[v] = Object.assign(emptyVariant(), raw.variants[v]);
        if (!state.variants[v].revenue) state.variants[v].revenue = {};
      }
    });
    state.events = Array.isArray(raw.events) ? raw.events : [];
    state.leads = Array.isArray(raw.leads) ? raw.leads : [];
    state.updatedAt = raw.updatedAt || null;
    return state;
  } catch (err) {
    console.error('[stats] Erro ao ler stats, retornando vazio:', err.message);
    return emptyState();
  }
}

function write(state) {
  ensureFile();
  try {
    state.updatedAt = new Date().toISOString();
    fs.writeFileSync(FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error('[stats] Erro ao gravar stats:', err.message);
  }
}

function bump(variant, field, by) {
  if (!VARIANTS.includes(variant)) return;
  const state = read();
  state.variants[variant][field] = (state.variants[variant][field] || 0) + (by || 1);
  write(state);
  db.upsertVariant(variant, state.variants[variant]);
}

function recordAssignment(variant) { bump(variant, 'assignments', 1); }
function recordClick(variant) { bump(variant, 'clicks', 1); }

function recordConversion(variant, amountCents, currency) {
  if (!VARIANTS.includes(variant)) return;
  const state = read();
  const v = state.variants[variant];
  v.conversions = (v.conversions || 0) + 1;
  const cur = (currency || 'eur').toUpperCase();
  v.revenue[cur] = (v.revenue[cur] || 0) + (amountCents || 0);
  write(state);
  db.upsertVariant(variant, v);
}

// Registra um evento no feed (venda, recusa, reembolso, disputa, lead, etc.)
function logEvent(type, data) {
  const state = read();
  const entry = Object.assign({
    id: 'evt_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    type: type || 'info',
    at: new Date().toISOString()
  }, data || {});
  state.events.unshift(entry);
  if (state.events.length > MAX_EVENTS) state.events.length = MAX_EVENTS;
  write(state);
  db.insertEvent(entry);
  return entry;
}

function findLead(state, id) {
  if (!id) return null;
  return state.leads.find((l) => l.id === id) || null;
}

// ── FUNIL: registra a entrada de um visitante no site (topo do funil) ──
// Todo visitante é um lead. Upsert por visitor id.
function recordVisit(data) {
  data = data || {};
  const state = read();
  let lead = findLead(state, data.id);
  const nowIso = new Date().toISOString();
  if (!lead) {
    lead = {
      id: data.id || ('ld_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)),
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
    };
    state.leads.unshift(lead);
    if (state.leads.length > MAX_LEADS) state.leads.length = MAX_LEADS;
    write(state);
  } else {
    // enriquece dados que faltavam
    let changed = false;
    ['ip', 'ua', 'referer', 'country', 'countryName', 'city', 'ttclid'].forEach((k) => {
      if (!lead[k] && data[k]) { lead[k] = data[k]; changed = true; }
    });
    if (data.utm && (!lead.utm || !lead.utm.source) && data.utm.source) { lead.utm = data.utm; changed = true; }
    lead.lastSeen = nowIso;
    if (changed) write(state); else write(state);
  }
  db.upsertLead(lead);
  return lead;
}

// ── FUNIL: registra que o lead chegou a um checkout (stripe|cooud) ──
function recordCheckoutEntry(id, gateway, data) {
  data = data || {};
  const state = read();
  let lead = findLead(state, id);
  const nowIso = new Date().toISOString();
  if (!lead) {
    lead = {
      id: id || ('ld_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)),
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
    };
    state.leads.unshift(lead);
    if (state.leads.length > MAX_LEADS) state.leads.length = MAX_LEADS;
  } else {
    if (lead.stage !== 'purchased') lead.stage = 'checkout';
    lead.gateway = gateway || lead.gateway;
    // enriquece geo/tracking se veio agora
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
  write(state);
  db.upsertLead(lead);
  return lead;
}

// Guarda dados de tracking sensíveis (ex.: tt_url REAL) no lead, no servidor.
// Nunca vão para a metadata da Stripe — só usados no TikTok Events API (CAPI).
function attachTracking(id, patch) {
  if (!id || !patch) return null;
  const state = read();
  let lead = findLead(state, id);
  const nowIso = new Date().toISOString();
  if (!lead) {
    lead = {
      id, at: nowIso, stage: 'checkout', status: 'pending', gateway: 'stripe', utm: {}
    };
    state.leads.unshift(lead);
    if (state.leads.length > MAX_LEADS) state.leads.length = MAX_LEADS;
  }
  if (patch.ttUrl) lead.ttUrl = String(patch.ttUrl).slice(0, 500);
  if (patch.ttclid && !lead.ttclid) lead.ttclid = patch.ttclid;
  if (patch.ttp) lead.ttp = patch.ttp;
  write(state);
  db.upsertLead(lead);
  return lead;
}

// Recupera um lead por id (usado no webhook para obter a tt_url real).
function getLead(id) {
  if (!id) return null;
  return findLead(read(), id);
}

// ── Conversão do Stripe (nativo) ──
function markPurchased(id, data) {
  data = data || {};
  const state = read();
  let lead = findLead(state, id);
  const nowIso = new Date().toISOString();
  const cur = (data.currency || 'eur').toUpperCase();
  const amount = data.amountCents || 0;
  if (!lead) {
    lead = {
      id: id || ('pi_' + Date.now().toString(36)),
      at: nowIso,
      stage: 'purchased',
      status: 'converted',
      gateway: 'stripe',
      utm: {}
    };
    state.leads.unshift(lead);
    if (state.leads.length > MAX_LEADS) state.leads.length = MAX_LEADS;
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
  write(state);
  db.upsertLead(lead);
  return lead;
}

// ── Conversão do gateway externo (Cooud) + conciliação anti-desvio ──
function matchCooudConversion(data) {
  data = data || {};
  const state = read();
  const cur = (data.currency || 'eur').toUpperCase();
  const amount = data.amountCents || 0;
  const nowIso = new Date().toISOString();

  let lead = findLead(state, data.leadId);

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
    lead = {
      id: data.leadId || ('orphan_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
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
    };
    state.leads.unshift(lead);
    if (state.leads.length > MAX_LEADS) state.leads.length = MAX_LEADS;
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

  write(state);
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

function getStats() {
  const state = read();
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
  return out;
}

function reset() {
  write(emptyState());
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
    const state = read();
    // Banco vence sobre o arquivo efêmero (que costuma estar vazio no boot).
    if (persisted.leads && persisted.leads.length) state.leads = persisted.leads.slice(0, MAX_LEADS);
    if (persisted.events && persisted.events.length) state.events = persisted.events.slice(0, MAX_EVENTS);
    VARIANTS.forEach((v) => {
      if (persisted.variants && persisted.variants[v]) {
        state.variants[v] = Object.assign(emptyVariant(), persisted.variants[v]);
        if (!state.variants[v].revenue) state.variants[v].revenue = {};
      }
    });
    write(state);
    console.log('[stats] Hidratado do Neon: ' + (state.leads.length) + ' leads, ' + (state.events.length) + ' eventos.');
  } catch (err) {
    console.error('[stats] Erro ao hidratar do Neon:', err.message);
  }
}

module.exports = {
  VARIANTS, recordAssignment, recordClick, recordConversion,
  logEvent, recordVisit, recordCheckoutEntry, markPurchased,
  attachTracking, getLead, matchCooudConversion, getStats, reset, hydrate
};
