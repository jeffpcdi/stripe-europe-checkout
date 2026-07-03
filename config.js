const fs = require('fs');
const path = require('path');
const db = require('./db');

// ── Configuração editável pela dashboard ──────────────────────────────────
// A config vive em memória (leitura O(1), sem I/O por request) e é
// persistida em dois níveis:
//   1. Neon (durável — sobrevive a deploys/reinícios);
//   2. arquivo local (snapshot de fallback).
// Hoje guarda as notificações Pushcut; novos blocos de config do SaaS
// entram aqui no mesmo padrão.
const DATA_DIR = path.join(__dirname, 'data');
const FILE = path.join(DATA_DIR, 'config.json');

function defaults() {
  return {
    // Notificações Pushcut — configuradas pela aba Configurações da dash.
    // url: webhook completo do app Pushcut; events: quais eventos notificam.
    pushcut: {
      url: '',
      events: { sale: true, failed: true, refund: true, dispute: true, checkout: false }
    },
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

  // Sanitização do bloco Pushcut
  const pc = Object.assign({}, next.pushcut || {});
  const url = String(pc.url || '').trim();
  pc.url = /^https:\/\/api\.pushcut\.io\/.+/i.test(url) ? url.slice(0, 300) : '';
  const ev = Object.assign(
    { sale: true, failed: true, refund: true, dispute: true, checkout: false },
    pc.events || {}
  );
  pc.events = {
    sale: ev.sale !== false,
    failed: ev.failed !== false,
    refund: ev.refund !== false,
    dispute: ev.dispute !== false,
    checkout: ev.checkout === true
  };
  next.pushcut = pc;

  next.updatedAt = new Date().toISOString();
  cfg = next;
  persist();
  return Object.assign({}, next);
}

module.exports = { get, set, defaults, hydrate };
