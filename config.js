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
    // daily: relatório-resumo do dia anterior (enviado na virada do dia).
    pushcut: {
      url: '',
      events: { sale: true, failed: true, refund: true, dispute: true, checkout: false, daily: false }
    },
    // Encurtador rastreável (/l/:slug): [{slug, nome, url, clicks, createdAt}]
    shortlinks: [],
    // Domínios personalizados plugados via DNS (CNAME → app). Servem os links
    // /go/, /l/ e o tracker /t.js no domínio do usuário para uso nos anúncios.
    // [{host, verificado, verificadoEm, criadoEm}]
    customDomains: [],
    // Anotações do gráfico de tendência: [{d:'YYYY-MM-DD', text}]
    notes: [],
    // API pública read-only (/api/v1/summary?token=...) — token gerado sob demanda
    api: { token: '' },
    // Controle do relatório diário (último dia já reportado, 'YYYY-MM-DD')
    lastDailyReport: '',
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
    { sale: true, failed: true, refund: true, dispute: true, checkout: false, daily: false },
    pc.events || {}
  );
  pc.events = {
    sale: ev.sale !== false,
    failed: ev.failed !== false,
    refund: ev.refund !== false,
    dispute: ev.dispute !== false,
    checkout: ev.checkout === true,
    daily: ev.daily === true
  };
  next.pushcut = pc;

  // Sanitização dos novos blocos (garante formatos previsíveis)
  if (!Array.isArray(next.shortlinks)) next.shortlinks = [];
  next.shortlinks = next.shortlinks.slice(0, 100).map((s) => ({
    slug: String(s.slug || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 60),
    nome: String(s.nome || '').slice(0, 80),
    url: String(s.url || '').slice(0, 500),
    clicks: Math.max(0, parseInt(s.clicks, 10) || 0),
    createdAt: s.createdAt || new Date().toISOString()
  })).filter((s) => s.slug && /^https?:\/\//i.test(s.url));
  if (!Array.isArray(next.customDomains)) next.customDomains = [];
  next.customDomains = next.customDomains.slice(0, 20).map((d) => ({
    host: String(d.host || '').toLowerCase().replace(/[^a-z0-9.-]/g, '').slice(0, 253),
    verificado: d.verificado === true,
    verificadoEm: d.verificadoEm || null,
    criadoEm: d.criadoEm || new Date().toISOString()
  })).filter((d) => d.host && /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(d.host));
  if (!Array.isArray(next.notes)) next.notes = [];
  next.notes = next.notes.slice(0, 200).map((n) => ({
    d: String(n.d || '').slice(0, 10),
    text: String(n.text || '').slice(0, 200)
  })).filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n.d) && n.text);
  next.api = { token: String((next.api || {}).token || '').slice(0, 64) };
  next.lastDailyReport = String(next.lastDailyReport || '').slice(0, 10);

  next.updatedAt = new Date().toISOString();
  cfg = next;
  persist();
  return Object.assign({}, next);
}

module.exports = { get, set, defaults, hydrate };
