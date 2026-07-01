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

function emptyState() {
  const variants = {};
  VARIANTS.forEach((v) => { variants[v] = emptyVariant(); });
  return { variants, updatedAt: null };
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

function getStats() {
  const state = read();
  // calcula métricas derivadas
  const out = { variants: {}, updatedAt: state.updatedAt };
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
  return out;
}

function reset() { write(emptyState()); }

module.exports = { VARIANTS, recordAssignment, recordClick, recordConversion, getStats, reset };
