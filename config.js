const fs = require('fs');
const path = require('path');

// Configuração editável pela dashboard (persistida em arquivo).
// OBS: no Railway o filesystem é efêmero; para persistência real migrar p/ DB.
const DATA_DIR = path.join(__dirname, 'data');
const FILE = path.join(DATA_DIR, 'config.json');

const DEFAULT_EXTERNAL_URL = process.env.COOUD_CHECKOUT_URL
  || 'https://checkout.cooud.com/01KVQSV545NN7APJN3RQMGSASV';

function defaults() {
  return {
    mode: 'ab',                 // 'ab' (divide tráfego) | 'stripe_only' (100% Stripe)
    stripePct: 50,              // % do tráfego para o Stripe (resto vai p/ externo)
    externalName: 'Cooud',      // nome do gateway externo (rótulo)
    externalUrl: DEFAULT_EXTERNAL_URL,
    updatedAt: null
  };
}

function ensureFile() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, JSON.stringify(defaults(), null, 2));
  } catch (err) {
    console.error('[config] Erro ao criar arquivo:', err.message);
  }
}

function get() {
  ensureFile();
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return Object.assign(defaults(), raw);
  } catch (err) {
    console.error('[config] Erro ao ler config:', err.message);
    return defaults();
  }
}

function set(patch) {
  const cur = get();
  const next = Object.assign({}, cur, patch || {});

  // Sanitização
  next.mode = next.mode === 'stripe_only' ? 'stripe_only' : 'ab';
  let pct = Number(next.stripePct);
  if (!Number.isFinite(pct)) pct = 50;
  next.stripePct = Math.max(0, Math.min(100, Math.round(pct)));
  next.externalName = String(next.externalName || 'Cooud').slice(0, 40);

  // Valida URL externa (mantém a anterior se inválida)
  const url = String(next.externalUrl || '').trim();
  if (/^https?:\/\/.+/i.test(url)) next.externalUrl = url.slice(0, 500);
  else next.externalUrl = cur.externalUrl;

  next.updatedAt = new Date().toISOString();
  ensureFile();
  try {
    fs.writeFileSync(FILE, JSON.stringify(next, null, 2));
  } catch (err) {
    console.error('[config] Erro ao gravar config:', err.message);
  }
  return next;
}

// Decide a variante para um novo visitante, conforme a config atual.
function pickVariant() {
  const c = get();
  if (c.mode === 'stripe_only') return 'stripe';
  return (Math.random() * 100 < c.stripePct) ? 'stripe' : 'cooud';
}

module.exports = { get, set, pickVariant, defaults };
