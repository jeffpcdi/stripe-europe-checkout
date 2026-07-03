// ── Multi-pixel store — 1 arquivo por pixel (pixels/*.json) ───────────────
// A fonte de verdade são os arquivos JSON no diretório pixels/. Cada arquivo
// é um pixel COMPLETO e independente (código, token, eventos, rotas), então
// funciona mesmo sem a dashboard: basta criar/editar o arquivo. A dashboard é
// só uma conveniência que escreve esses arquivos. Também espelhamos no Neon
// (backup durável) porque o filesystem de deploy pode ser efêmero.
const fs = require('fs');
const path = require('path');
const db = require('./db');

const DIR = path.join(__dirname, 'pixels');
let cache = [];        // lista de pixels carregados
let byRoute = null;    // memo simples invalidado a cada reload

function ensureDir() {
  try { if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true }); }
  catch (e) { console.error('[pixels] não consegui criar diretório:', e.message); }
}

// slug seguro para nome de arquivo
function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || ('pixel-' + Date.now());
}

// normaliza um objeto de pixel vindo de arquivo/dashboard
function normalize(slug, raw) {
  raw = raw || {};
  const ev = raw.events || {};
  return {
    slug,
    name: raw.name || slug,
    pixelCode: String(raw.pixelCode || '').trim(),
    accessToken: String(raw.accessToken || '').trim(),
    testEventCode: String(raw.testEventCode || '').trim(),
    active: raw.active !== false,
    // rotas: '*' = todas; senão prefixos (ex.: '/checkout', '/s1')
    routes: Array.isArray(raw.routes) && raw.routes.length ? raw.routes : ['*'],
    events: {
      ViewContent: ev.ViewContent !== false,
      InitiateCheckout: ev.InitiateCheckout !== false,
      // meio do funil (webhook universal: pagamento em processamento)
      AddPaymentInfo: ev.AddPaymentInfo !== false,
      CompletePayment: ev.CompletePayment !== false,
      // eventos opcionais (upsell mapeia p/ CompletePayment)
      AddToCart: ev.AddToCart === true
    },
    updatedAt: raw.updatedAt || new Date().toISOString()
  };
}

function fileFor(slug) { return path.join(DIR, slug + '.json'); }

// Lê todos os arquivos do diretório para a memória.
function loadFromDisk() {
  ensureDir();
  const out = [];
  let files = [];
  try { files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')); }
  catch (e) { console.error('[pixels] readdir:', e.message); }
  for (const f of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
      out.push(normalize(f.replace(/\.json$/, ''), raw));
    } catch (e) {
      console.error('[pixels] arquivo inválido ' + f + ':', e.message);
    }
  }
  cache = out;
  byRoute = null;
  return out;
}

// Escreve o arquivo do pixel no disco (sem tocar no banco).
function writeFile(slug, cfg) {
  ensureDir();
  fs.writeFileSync(fileFor(slug), JSON.stringify(cfg, null, 2));
}

// ── Boot: carrega do disco; se vazio, tenta re-hidratar do banco; e migra
// o pixel legado das variáveis de ambiente para pixels/default.json. ──────
async function init() {
  loadFromDisk();

  // Re-hidrata do banco se o FS estiver vazio (deploy efêmero).
  if (!cache.length && db.enabled) {
    try {
      const rows = await db.loadPixels();
      if (rows && rows.length) {
        rows.forEach((r) => {
          const n = normalize(r.slug, r);
          writeFile(n.slug, n);
        });
        loadFromDisk();
        console.log('[pixels] ' + cache.length + ' pixel(s) re-hidratado(s) do banco.');
      }
    } catch (e) { console.error('[pixels] rehydrate:', e.message); }
  }

  // Migração do pixel único legado (compatibilidade).
  if (!cache.length) {
    const legacyCode = process.env.TIKTOK_PIXEL_CODE;
    const legacyToken = process.env.TIKTOK_ACCESS_TOKEN;
    if (legacyCode) {
      const n = normalize('default', {
        name: 'Pixel principal',
        pixelCode: legacyCode,
        accessToken: legacyToken || '',
        active: true,
        routes: ['*']
      });
      writeFile('default', n);
      if (db.enabled) db.upsertPixel('default', n);
      loadFromDisk();
      console.log('[pixels] pixel legado migrado para pixels/default.json');
    }
  }

  // Observa o diretório para hot-reload quando arquivos mudam manualmente.
  try {
    fs.watch(DIR, { persistent: false }, () => {
      clearTimeout(init._t);
      init._t = setTimeout(() => { loadFromDisk(); }, 200);
    });
  } catch (_) { /* fs.watch pode não existir em alguns ambientes */ }

  console.log('[pixels] pronto — ' + cache.length + ' pixel(s) ativo(s).');
  return cache.length;
}

// ── API pública ───────────────────────────────────────────────────────────
function list() { return cache.slice(); }

// Pixels ativos que se aplicam a uma rota (path).
// Memoizado por rota — é chamado em TODO page view (/px.js) e em cada disparo
// de evento; o memo é invalidado automaticamente quando loadFromDisk roda.
function forRoute(routePath) {
  const p = (routePath || '/').split('?')[0];
  if (!byRoute) byRoute = new Map();
  if (byRoute.has(p)) return byRoute.get(p);
  const out = cache.filter((px) => {
    if (!px.active || !px.pixelCode) return false;
    if (px.routes.indexOf('*') >= 0) return true;
    return px.routes.some((r) => r === p || (r !== '/' && p.indexOf(r) === 0));
  });
  if (byRoute.size < 200) byRoute.set(p, out); // limite defensivo contra rotas dinâmicas
  return out;
}

// Pixels ativos que aceitam um evento específico numa rota.
function forEvent(eventName, routePath) {
  return forRoute(routePath).filter((px) => px.events && px.events[eventName]);
}

function get(slug) { return cache.find((p) => p.slug === slug) || null; }

// Cria/atualiza um pixel: escreve arquivo + espelha no banco.
async function save(input) {
  const slug = input.slug ? slugify(input.slug) : slugify(input.name);
  const existing = get(slug);
  const cfg = normalize(slug, { ...(existing || {}), ...input, slug });
  cfg.updatedAt = new Date().toISOString();
  writeFile(slug, cfg);
  loadFromDisk();
  if (db.enabled) await db.upsertPixel(slug, cfg);
  return get(slug);
}

async function remove(slug) {
  slug = slugify(slug);
  try { if (fs.existsSync(fileFor(slug))) fs.unlinkSync(fileFor(slug)); }
  catch (e) { console.error('[pixels] remove:', e.message); }
  loadFromDisk();
  if (db.enabled) await db.deletePixel(slug);
  return true;
}

module.exports = {
  init, list, forRoute, forEvent, get, save, remove, slugify, reload: loadFromDisk, DIR
};
