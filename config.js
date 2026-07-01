const fs = require('fs');
const path = require('path');

// Configuração editável pela dashboard (persistida em arquivo).
// OBS: no Railway o filesystem é efêmero; para persistência real migrar p/ DB.
const DATA_DIR = path.join(__dirname, 'data');
const FILE = path.join(DATA_DIR, 'config.json');

const DEFAULT_EXTERNAL_URL = process.env.COOUD_CHECKOUT_URL
  || 'https://checkout.cooud.com/01KVQSV545NN7APJN3RQMGSASV';

// Pool padrão de URLs "decoy" mostradas no painel da Stripe (rotacionadas).
// A URL real (com ttclid/parâmetros) NUNCA é gravada na metadata da Stripe;
// fica apenas no nosso servidor e é usada no TikTok Events API (CAPI).
const DEFAULT_ROTATE_URLS = [
  'https://tiktok.com/',
  'https://www.tiktok.com/foryou',
  'https://www.tiktok.com/discover',
  'https://vm.tiktok.com/',
  'https://www.tiktok.com/@user'
];

function defaults() {
  return {
    mode: 'ab',                 // 'ab' (divide tráfego) | 'stripe_only' (100% Stripe)
    stripePct: 50,              // % do tráfego para o Stripe (resto vai p/ externo)
    externalName: 'Cooud',      // nome do gateway externo (rótulo)
    externalUrl: DEFAULT_EXTERNAL_URL,
    rotateTtUrl: true,          // rotaciona a tt_url exibida na Stripe (oculta a real)
    rotateUrls: DEFAULT_ROTATE_URLS.slice(),
    _rotIndex: 0,               // índice interno round-robin da rotação
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

  // Rotação da tt_url
  next.rotateTtUrl = next.rotateTtUrl !== false;
  // Aceita array ou texto (uma URL por linha). Mantém só URLs http(s) válidas.
  let pool = next.rotateUrls;
  if (typeof pool === 'string') pool = pool.split(/[\n,]/);
  if (!Array.isArray(pool)) pool = cur.rotateUrls || [];
  pool = pool.map((u) => String(u || '').trim())
             .filter((u) => /^https?:\/\/.+/i.test(u))
             .map((u) => u.slice(0, 500))
             .slice(0, 50);
  next.rotateUrls = pool.length ? pool : (cur.rotateUrls && cur.rotateUrls.length ? cur.rotateUrls : DEFAULT_ROTATE_URLS.slice());
  // preserva índice interno
  next._rotIndex = Number.isFinite(Number(cur._rotIndex)) ? Number(cur._rotIndex) : 0;

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

// Retorna a próxima URL "decoy" da rotação (round-robin) e persiste o índice.
// É o que aparece na Stripe no lugar da tt_url real. Se a rotação estiver
// desligada ou o pool vazio, retorna null (o chamador decide o fallback).
function nextRotationUrl() {
  ensureFile();
  let c;
  try { c = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (_) { c = defaults(); }
  c = Object.assign(defaults(), c);
  if (c.rotateTtUrl === false) return null;
  const pool = Array.isArray(c.rotateUrls) && c.rotateUrls.length ? c.rotateUrls : DEFAULT_ROTATE_URLS;
  const idx = Number.isFinite(Number(c._rotIndex)) ? Number(c._rotIndex) : 0;
  const url = pool[((idx % pool.length) + pool.length) % pool.length];
  c._rotIndex = (idx + 1) % pool.length;
  try { fs.writeFileSync(FILE, JSON.stringify(c, null, 2)); } catch (err) {
    console.error('[config] Erro ao persistir índice de rotação:', err.message);
  }
  return url;
}

module.exports = { get, set, pickVariant, nextRotationUrl, defaults };
