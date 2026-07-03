const fs = require('fs');
const path = require('path');
const db = require('./db');

// ── Configuração editável pela dashboard ──────────────────────────────────
// REMODELADO: a config agora vive em memória (leitura O(1), sem I/O por
// request) e é persistida em dois níveis:
//   1. Neon (durável — sobrevive a deploys/reinícios);
//   2. arquivo local (snapshot de fallback).
// Antes, cada get()/pickVariant()/nextRotationUrl() relia o arquivo do disco.
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

// ── Cache em memória ───────────────────────────────────────────────────────
let cfg = null;

function loadFromDisk() {
  try {
    if (fs.existsSync(FILE)) {
      return Object.assign(defaults(), JSON.parse(fs.readFileSync(FILE, 'utf8')));
    }
  } catch (err) {
    console.error('[config] Erro ao ler config do disco:', err.message);
  }
  return defaults();
}

function ensureLoaded() {
  if (!cfg) cfg = loadFromDisk();
  return cfg;
}

// Persiste (assíncrono, não bloqueia a request): arquivo local + Neon.
function persist() {
  const snapshot = JSON.stringify(cfg, null, 2);
  fs.mkdir(DATA_DIR, { recursive: true }, () => {
    fs.writeFile(FILE, snapshot, (err) => {
      if (err) console.error('[config] Erro ao gravar config:', err.message);
    });
  });
  db.saveConfig(cfg);
}

// Hidrata do Neon no boot (banco vence sobre o arquivo efêmero).
async function hydrate() {
  try {
    const persisted = await db.loadConfig();
    if (persisted && typeof persisted === 'object') {
      cfg = Object.assign(defaults(), persisted);
      console.log('[config] Config hidratada do Neon.');
    } else {
      ensureLoaded();
      // primeira execução com banco: semeia o Neon com o estado atual
      if (db.enabled) db.saveConfig(cfg);
    }
  } catch (err) {
    console.error('[config] Erro ao hidratar config:', err.message);
    ensureLoaded();
  }
}

function get() {
  // cópia rasa defensiva — chamadores não devem mutar o cache por referência
  return Object.assign({}, ensureLoaded());
}

function set(patch) {
  const cur = ensureLoaded();
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
  cfg = next;
  persist();
  return Object.assign({}, next);
}

// Hash FNV-1a → número estável em [0,100). Mesmo visitante = mesmo bucket.
function bucketOf(id) {
  let h = 0x811c9dc5;
  const s = String(id);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h % 100;
}

// Decide a variante para um visitante, conforme a config atual.
// REFINADO: split determinístico por hash do visitorId — o mesmo visitante
// SEMPRE cai na mesma variante (mesmo se limpar o cookie ab_variant), e a
// distribuição real converge para o % configurado sem a variância do
// Math.random() em amostras pequenas. Sem visitorId, cai no sorteio aleatório.
function pickVariant(visitorId) {
  const c = ensureLoaded();
  if (c.mode === 'stripe_only') return 'stripe';
  const roll = visitorId ? bucketOf(visitorId) : Math.random() * 100;
  return roll < c.stripePct ? 'stripe' : 'cooud';
}

// Retorna a próxima URL "decoy" da rotação (round-robin) e persiste o índice.
// É o que aparece na Stripe no lugar da tt_url real. Se a rotação estiver
// desligada ou o pool vazio, retorna null (o chamador decide o fallback).
function nextRotationUrl() {
  const c = ensureLoaded();
  if (c.rotateTtUrl === false) return null;
  const pool = Array.isArray(c.rotateUrls) && c.rotateUrls.length ? c.rotateUrls : DEFAULT_ROTATE_URLS;
  const idx = Number.isFinite(Number(c._rotIndex)) ? Number(c._rotIndex) : 0;
  const url = pool[((idx % pool.length) + pool.length) % pool.length];
  c._rotIndex = (idx + 1) % pool.length;
  persist();
  return url;
}

module.exports = { get, set, pickVariant, nextRotationUrl, defaults, hydrate };
