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

function emptyState() {
  const variants = {};
  VARIANTS.forEach((v) => { variants[v] = emptyVariant(); });
  return { variants, events: [], updatedAt: null };
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
  return out;
}

function reset() { write(emptyState()); }

module.exports = { VARIANTS, recordAssignment, recordClick, recordConversion, logEvent, getStats, reset };
