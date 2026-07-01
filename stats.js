const fs = require('fs');
const path = require('path');

// Store simples baseado em arquivo JSON. Suficiente para o teste A/B inicial.
// OBS: no Railway o filesystem é efêmero (reseta a cada deploy). Para histórico
// permanente, migrar depois para um banco (ex.: Neon).
const DATA_DIR = path.join(__dirname, 'data');
const FILE = path.join(DATA_DIR, 'stats.json');

const VARIANTS = ['stripe', 'cooud'];

function emptyVariant() {
  return { assignments: 0, clicks: 0, conversions: 0, revenue: {} };
}

const MAX_EVENTS = 300; // mantém os últimos N eventos no feed
const MAX_LEADS = 500;  // mantém os últimos N leads rastreados

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
    // merge defensivo (garante estrutura mesmo se o arquivo for antigo)
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
}

// Registra um evento no feed (venda, recusa, reembolso, disputa, etc.)
// type: 'sale' | 'failed' | 'refund' | 'dispute' | 'info'
function logEvent(type, data) {
  const state = read();
  const entry = Object.assign({
    id: 'evt_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    type: type || 'info',
    at: new Date().toISOString()
  }, data || {});
  state.events.unshift(entry); // mais recente primeiro
  if (state.events.length > MAX_EVENTS) state.events.length = MAX_EVENTS;
  write(state);
}

// Registra um LEAD enviado a um gateway externo (ex.: Cooud) no momento do redirect.
// É a peça central do anti-desvio: sabemos exatamente quantas pessoas mandamos.
function recordLead(lead) {
  const state = read();
  const entry = Object.assign({
    at: new Date().toISOString(),
    gateway: 'cooud',
    status: 'pending'
  }, lead || {});
  if (!entry.id) entry.id = 'ld_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  state.leads.unshift(entry);
  if (state.leads.length > MAX_LEADS) state.leads.length = MAX_LEADS;
  write(state);
  return entry;
}

// Concilia uma venda reportada pelo gateway externo com o lead que originamos.
// Se não houver lead correspondente, cria um registro "órfão" (venda que o Cooud
// reportou sem termos enviado o lead — sinal de possível atribuição indevida).
function matchCooudConversion(data) {
  data = data || {};
  const state = read();
  const cur = (data.currency || 'eur').toUpperCase();
  const amount = data.amountCents || 0;
  const nowIso = new Date().toISOString();

  let lead = null;
  if (data.leadId) lead = state.leads.find((l) => l.id === data.leadId);

  if (lead) {
    if (lead.status === 'converted') {
      lead.duplicateReports = (lead.duplicateReports || 0) + 1; // Cooud reportou 2x o mesmo lead
    } else {
      lead.status = 'converted';
    }
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
      status: 'converted',
      orphan: true,
      convertedAt: nowIso,
      reportedAmount: amount,
      reportedCurrency: cur,
      customer: data.customer || null,
      email: data.email || null,
      ref: data.ref || null
    };
    state.leads.unshift(lead);
    if (state.leads.length > MAX_LEADS) state.leads.length = MAX_LEADS;
  }

  // ── Detecção de práticas do gateway Cooud (Smart Capture / Recuperar Prejuízo) ──
  // Flags explícitas (se o webhook do Cooud enviar) têm prioridade; senão usa heurística.
  let capture = data.smartCapture === true;
  let recovery = data.recovery === true;
  let captureExtra = 0;

  // Smart Capture: cobrou valor acima do esperado (order bump / captura extra) ou reporte duplicado
  if (!lead.orphan && lead.expectedAmount && amount > lead.expectedAmount) {
    capture = true;
    captureExtra = amount - lead.expectedAmount;
  }
  if (lead.duplicateReports) capture = true;

  // Recuperar Prejuízo: conversão que chegou muito depois do envio do lead
  const ageMs = new Date(lead.convertedAt).getTime() - new Date(lead.at).getTime();
  lead.conversionAgeMs = lead.orphan ? null : ageMs;
  if (!lead.orphan && ageMs > RECOVERY_LATE_MS) recovery = true;

  lead.smartCapture = capture;
  lead.recovery = recovery;
  lead.captureExtra = captureExtra;

  // contabiliza conversão/receita da variante cooud (fonte única — não usar recordConversion junto)
  const v = state.variants.cooud;
  v.conversions = (v.conversions || 0) + 1;
  v.revenue[cur] = (v.revenue[cur] || 0) + amount;

  write(state);
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
    if (!isOrphan) sent++; // leads que NÓS geramos e enviamos
    if (l.duplicateReports) duplicates += l.duplicateReports;

    if (l.status === 'converted') {
      const rc = l.reportedCurrency || 'EUR';
      reportedRev[rc] = (reportedRev[rc] || 0) + (l.reportedAmount || 0);
      if (l.expectedAmount) {
        const ec = l.expectedCurrency || 'EUR';
        expectedRev[ec] = (expectedRev[ec] || 0) + l.expectedAmount;
        // valor reportado menor que o preço esperado → possível subnotificação
        if (rc === ec && (l.reportedAmount || 0) < l.expectedAmount) valueMismatch++;
      }
      // práticas do gateway
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
  // calcula métricas derivadas por variante
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

  // totais globais para o painel de visão geral
  const revenue = {};
  let sales = 0, failed = 0, refunds = 0, disputes = 0;
  VARIANTS.forEach((v) => {
    const rev = out.variants[v].revenue || {};
    Object.keys(rev).forEach((cur) => { revenue[cur] = (revenue[cur] || 0) + rev[cur]; });
  });
  (state.events || []).forEach((e) => {
    if (e.type === 'sale') sales++;
    else if (e.type === 'failed') failed++;
    else if (e.type === 'refund') refunds++;
    else if (e.type === 'dispute') disputes++;
  });
  const totalAttempts = sales + failed;
  out.totals = {
    revenue,
    sales,
    failed,
    refunds,
    disputes,
    approvalRate: totalAttempts ? +((sales / totalAttempts) * 100).toFixed(1) : 0
  };

  // Conciliação Cooud + lista de leads recentes (para o painel anti-desvio)
  out.cooud = cooudReconciliation(state.leads || []);
  out.cooud.stripeConvRate = out.variants.stripe ? out.variants.stripe.conversionRate : 0;
  out.leads = (state.leads || []).slice(0, 120);
  return out;
}

function reset() { write(emptyState()); }

module.exports = {
  VARIANTS, recordAssignment, recordClick, recordConversion,
  logEvent, recordLead, matchCooudConversion, getStats, reset
};
