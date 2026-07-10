const fs = require('fs');
const path = require('path');
const db = require('./db');
const redis = require('./redis');

// ── Configuração editável pela dashboard — POR CONTA (multi-tenant) ────────
// Cada conta tem sua própria config (pushcut, shortlinks, domínios, cloak,
// api token…). O cache vive em memória (Map accountId → cfg) e é persistido:
//   1. no Neon (tabela config, key = accountId — durável);
//   2. em arquivo local (snapshot de fallback, um mapa com todas as contas).
// A chave 'main' é o legado pré-multi-tenant; claimLegacyData() a converte
// para a conta do primeiro admin no registro.
const DATA_DIR = path.join(__dirname, 'data');
const FILE = path.join(DATA_DIR, 'config.json');
const LEGACY_KEY = 'main';

function defaults() {
  return {
    // Notificações Pushcut — configuradas pela aba Configurações da dash.
    pushcut: {
      url: '',
      events: { sale: true, failed: true, refund: true, dispute: true, checkout: false, daily: false }
    },
    // Encurtador rastreável (/l/:slug): [{slug, nome, url, clicks, createdAt}]
    shortlinks: [],
    // Domínios personalizados plugados via DNS (CNAME → app).
    // [{host, verificado, verificadoEm, criadoEm}]
    customDomains: [],
    // Anotações do gráfico de tendência: [{d:'YYYY-MM-DD', text}]
    notes: [],
    // Filtro de revisores TikTok Ads (cloaking)
    cloak: {
      enabled: true,
      sensitivity: 'balanced',      // 'strict' | 'balanced' | 'loose'
      threshold: 40,
      deadlineMs: 120,
      blockDatacenter: true,
      blockHeadless: true,
      checkHeaders: true,
      requireJsChallenge: true,
      checkWebgl: true,
      checkTimezone: true,
      checkBehavior: true,
      blockZhLang: true,
      // White page GLOBAL de fallback: usada quando um link protegido não tem
      // white page própria. Se vazia, o sistema serve uma página neutra embutida
      // (/_safe) — assim NENHUM bot chega à offer, mesmo sem white configurada.
      defaultWhitePage: ''
    },
    // Links de cloaking (entidade própria, servidos em /c/:slug). Cada link
    // carrega SUA própria configuração de proteção (interruptor, sensibilidade,
    // camadas de detecção) + offer/white page + allowlists de país e idioma.
    // [{ slug, nome, offerUrl, whitePageUrl, enabled, sensitivity, threshold,
    //    deadlineMs, blockDatacenter, ..., paises, idiomas, criadoEm, updatedAt }]
    cloakLinks: [],
    // API pública read-only (/api/v1/summary?token=...)
    api: { token: '' },
    lastDailyReport: '',
    updatedAt: null
  };
}

// ── Cache em memória: accountId → cfg ──────────────────────────────────────
const cache = new Map();
let hydrated = false;

function mergeDefaults(stored) {
  const base = defaults();
  const out = Object.assign({}, base, stored || {});
  out.cloak = Object.assign({}, base.cloak, (stored && stored.cloak) || {});
  out.pushcut = Object.assign({}, base.pushcut, (stored && stored.pushcut) || {});
  return out;
}

// Snapshot local: { accountId: cfg, ... } (fallback quando o Neon falha)
function loadDiskMap() {
  try {
    if (fs.existsSync(FILE)) {
      const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      // formato antigo (config única, sem mapa): trata como legado 'main'
      if (raw && typeof raw === 'object' && !raw.__isMap) {
        if (raw.pushcut || raw.cloak || raw.customDomains) return { [LEGACY_KEY]: raw };
      }
      if (raw && raw.__isMap && raw.data && typeof raw.data === 'object') return raw.data;
    }
  } catch (err) {
    console.error('[config] Erro ao ler config do disco:', err.message);
  }
  return {};
}

let persistTimer = null;
function persistDisk() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const data = {};
    cache.forEach((v, k) => { data[k] = v; });
    fs.mkdir(DATA_DIR, { recursive: true }, () => {
      fs.writeFile(FILE, JSON.stringify({ __isMap: true, data }, null, 2), (err) => {
        if (err) console.error('[config] Erro ao gravar config:', err.message);
      });
    });
  }, 500);
  if (persistTimer.unref) persistTimer.unref();
}

// Hidrata TODAS as configs do Neon no boot (banco vence sobre o arquivo).
// Regra de ouro (correção de persistência): erro de leitura NUNCA semeia
// o banco — só usamos o snapshot local sem tocar no Neon.
async function hydrate() {
  try {
    const res = await db.loadAllConfigs();
    if (res && res.ok) {
      (res.data || []).forEach((row) => {
        if (row && row.key && row.data && typeof row.data === 'object') {
          cache.set(row.key, mergeDefaults(row.data));
        }
      });
      hydrated = true;
      console.log('[config] ' + cache.size + ' config(s) de conta hidratada(s) do Neon.');
    } else {
      const disk = loadDiskMap();
      Object.keys(disk).forEach((k) => cache.set(k, mergeDefaults(disk[k])));
      console.warn('[config] Falha ao ler configs do Neon — usando snapshot local, banco intocado.');
    }
  } catch (err) {
    console.error('[config] Erro ao hidratar config:', err.message);
  }

  // ── Reconciliação dos espelhos duráveis (itens 241/242/245/249) ─────────
  // A tabela custom_domains (ou o snapshot Redis, se o Neon falhou) devolve
  // domínios que porventura não estejam na config; accounts.currency devolve
  // a moeda da conta. Tudo só em MEMÓRIA (seed) — leitura nunca semeia escrita.
  try {
    let rows = null;
    const res = await db.loadCustomDomains(null);
    if (res && res.ok) rows = res.data;
    if (!rows && redis.enabled) rows = await redis.loadDomainSnapshot(); // fallback: Neon fora
    if (rows && rows.length) {
      const byAcc = {};
      rows.forEach((r) => {
        if (!r || !r.host || !r.accountId) return;
        (byAcc[r.accountId] = byAcc[r.accountId] || []).push(r);
      });
      let restaurados = 0;
      Object.keys(byAcc).forEach((accId) => {
        const cfg = cache.has(accId) ? cache.get(accId) : defaults();
        const atuais = Array.isArray(cfg.customDomains) ? cfg.customDomains : [];
        const faltantes = byAcc[accId].filter((r) => !atuais.some((d) => d.host === r.host)).map((r) => {
          const out = {
            host: r.host,
            verificado: r.verificado === true,
            verificadoEm: r.verificadoEm || null,
            criadoEm: r.criadoEm || new Date().toISOString()
          };
          if (['checkout', 'cloaker', 'ambos'].includes(r.uso)) out.uso = r.uso;
          if (r.providerId) out.providerId = r.providerId;
          if (r.dns && typeof r.dns === 'object') out.dns = r.dns;
          return out;
        });
        if (faltantes.length) {
          restaurados += faltantes.length;
          seed(accId, { customDomains: atuais.concat(faltantes) });
        }
      });
      if (restaurados) console.log('[config] ' + restaurados + ' domínio(s) restaurado(s) do espelho durável.');
    }
  } catch (err) {
    console.error('[config] Erro ao reconciliar domínios duráveis:', err.message);
  }

  // Moeda por conta (accounts.currency) — só preenche quando a config ainda
  // não tem defaultCurrency (a config, editável, tem precedência).
  try {
    const curRes = await db.loadAccountCurrencies();
    if (curRes && curRes.ok) {
      (curRes.data || []).forEach((r) => {
        const cur = String((r && r.currency) || '').toUpperCase();
        if (!r || !r.id || !/^[A-Z]{3}$/.test(cur)) return;
        const cfg = cache.has(r.id) ? cache.get(r.id) : defaults();
        const s = cfg.settings || {};
        if (!s.defaultCurrency) {
          seed(r.id, { settings: Object.assign({}, s, { defaultCurrency: cur }) });
        }
      });
    }
  } catch (err) {
    console.error('[config] Erro ao hidratar moedas das contas:', err.message);
  }
}

// Config de uma conta (sempre retorna algo; cria default em memória se nova).
function get(accountId) {
  const key = accountId || LEGACY_KEY;
  if (!cache.has(key)) cache.set(key, defaults());
  // cópia rasa defensiva — chamadores não devem mutar o cache por referência
  return Object.assign({}, cache.get(key));
}

function set(accountId, patch) {
  const key = accountId || LEGACY_KEY;
  const cur = cache.has(key) ? cache.get(key) : defaults();
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

  // Sanitização dos demais blocos (garante formatos previsíveis)
  if (!Array.isArray(next.shortlinks)) next.shortlinks = [];
  next.shortlinks = next.shortlinks.slice(0, 100).map((s) => ({
    slug: String(s.slug || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 60),
    nome: String(s.nome || '').slice(0, 80),
    url: String(s.url || '').slice(0, 500),
    clicks: Math.max(0, parseInt(s.clicks, 10) || 0),
    createdAt: s.createdAt || new Date().toISOString()
  })).filter((s) => s.slug && /^https?:\/\//i.test(s.url));
  if (!Array.isArray(next.customDomains)) next.customDomains = [];
  next.customDomains = next.customDomains.slice(0, 20).map((d) => {
    const out = {
      host: String(d.host || '').toLowerCase().replace(/[^a-z0-9.-]/g, '').slice(0, 253),
      verificado: d.verificado === true,
      verificadoEm: d.verificadoEm || null,
      criadoEm: d.criadoEm || new Date().toISOString()
    };
    // Uso do domínio: onde ele vale (checkout, cloaker ou ambos). O sanitizador
    // PRECISA preservar este campo, senão a escolha do lojista some no save.
    if (['checkout', 'cloaker', 'ambos'].includes(d.uso)) out.uso = d.uso;
    // id do domínio na hospedagem (Railway) — usado para consultar/remover via API
    if (d.providerId) out.providerId = String(d.providerId).slice(0, 80);
    // Registros DNS salvos no cadastro — o tutorial da dashboard reexibe
    // as instruções sem depender de nova chamada à hospedagem.
    if (d.dns && typeof d.dns === 'object') out.dns = d.dns;
    return out;
  }).filter((d) => d.host && /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(d.host));
  if (!Array.isArray(next.notes)) next.notes = [];
  next.notes = next.notes.slice(0, 200).map((n) => ({
    d: String(n.d || '').slice(0, 10),
    text: String(n.text || '').slice(0, 200)
  })).filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n.d) && n.text);
  next.api = { token: String((next.api || {}).token || '').slice(0, 64) };
  next.lastDailyReport = String(next.lastDailyReport || '').slice(0, 10);

  // Sanitização do bloco Cloak (filtro de revisores TikTok)
  {
    const d = defaults().cloak;
    const c = Object.assign({}, d, next.cloak || {});
    const sens = ['strict', 'balanced', 'loose', 'custom'].includes(c.sensitivity) ? c.sensitivity : 'balanced';
    const boolOr = (v, def) => (typeof v === 'boolean' ? v : def);
    // White page global de fallback: aceita apenas https:// válido; qualquer
    // outra coisa vira '' (o servidor cai na página neutra embutida /_safe).
    const validHttps = (u) => /^https:\/\/[^\s]+\.[^\s]+/i.test(String(u || '').trim());
    next.cloak = {
      enabled:            boolOr(c.enabled, true),
      sensitivity:        sens,
      threshold:          Math.max(10, Math.min(90, Math.round(Number(c.threshold) || 40))),
      deadlineMs:         Math.max(40, Math.min(500, Math.round(Number(c.deadlineMs) || 120))),
      blockDatacenter:    boolOr(c.blockDatacenter, true),
      blockHeadless:      boolOr(c.blockHeadless, true),
      checkHeaders:       boolOr(c.checkHeaders, true),
      requireJsChallenge: boolOr(c.requireJsChallenge, true),
      checkWebgl:         boolOr(c.checkWebgl, true),
      checkTimezone:      boolOr(c.checkTimezone, true),
      checkBehavior:      boolOr(c.checkBehavior, true),
      blockZhLang:        boolOr(c.blockZhLang, true),
      defaultWhitePage:   validHttps(c.defaultWhitePage) ? String(c.defaultWhitePage).trim().slice(0, 500) : ''
    };
  }

  // Sanitização dos links de cloaking (entidade /c/:slug)
  {
    const validHttps = (u) => /^https:\/\/[^\s]+\.[^\s]+/i.test(String(u || '').trim());
    const slugify = (s) => String(s || '')
      .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    const boolOr = (v, def) => (typeof v === 'boolean' ? v : def);
    if (!Array.isArray(next.cloakLinks)) next.cloakLinks = [];
    const seen = {};
    next.cloakLinks = next.cloakLinks.slice(0, 100).map((l) => {
      l = l || {};
      const sens = ['strict', 'balanced', 'loose', 'custom'].includes(l.sensitivity) ? l.sensitivity : 'balanced';
      return {
        slug:               slugify(l.slug || l.nome),
        nome:               String(l.nome || l.slug || '').slice(0, 80),
        // Domínio personalizado (só o hostname; vazio = domínio padrão).
        dominio: (function (d) {
          d = String(d || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
          return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d) ? d.slice(0, 120) : '';
        })(l.dominio),
        offerUrl:           validHttps(l.offerUrl) ? String(l.offerUrl).trim().slice(0, 500) : '',
        whitePageUrl:       validHttps(l.whitePageUrl) ? String(l.whitePageUrl).trim().slice(0, 500) : '',
        enabled:            boolOr(l.enabled, true),
        // Gates de intenção (default LIGADO, inclusive para links antigos).
        mobileOnly:         boolOr(l.mobileOnly, true),
        requireAdClick:     boolOr(l.requireAdClick, true),
        paisPreset:         ['all', 'br', 'latam', 'eu', 'custom'].includes(l.paisPreset) ? l.paisPreset : '',
        sensitivity:        sens,
        threshold:          Math.max(10, Math.min(90, Math.round(Number(l.threshold) || 40))),
        deadlineMs:         Math.max(40, Math.min(500, Math.round(Number(l.deadlineMs) || 120))),
        blockDatacenter:    boolOr(l.blockDatacenter, true),
        blockHeadless:      boolOr(l.blockHeadless, true),
        checkHeaders:       boolOr(l.checkHeaders, true),
        requireJsChallenge: boolOr(l.requireJsChallenge, true),
        checkWebgl:         boolOr(l.checkWebgl, true),
        checkTimezone:      boolOr(l.checkTimezone, true),
        checkBehavior:      boolOr(l.checkBehavior, true),
        blockZhLang:        boolOr(l.blockZhLang, true),
        paises: (Array.isArray(l.paises) ? l.paises : [])
          .map((c) => String(c || '').trim().toUpperCase())
          .filter((c) => /^[A-Z]{2}$/.test(c)).filter((c, i, a) => a.indexOf(c) === i).slice(0, 40),
        idiomas: (Array.isArray(l.idiomas) ? l.idiomas : [])
          .map((c) => String(c || '').trim().toLowerCase().split('-')[0])
          .filter((c) => /^[a-z]{2}$/.test(c)).filter((c, i, a) => a.indexOf(c) === i).slice(0, 20),
        criadoEm: l.criadoEm || new Date().toISOString(),
        updatedAt: l.updatedAt || new Date().toISOString()
      };
    }).filter((l) => {
      if (!l.slug || seen[l.slug]) return false; // slug obrigatório e único
      seen[l.slug] = 1; return true;
    });
  }

  next.updatedAt = new Date().toISOString();

  // ── Write-through DURÁVEL de domínios (itens 241/245/252) ────────────────
  // Além do jsonb da config, cada domínio é espelhado de forma ASSÍNCRONA
  // (padrão stats.js — nunca bloqueia o request) na tabela custom_domains do
  // Neon e no snapshot Redis. Remoções propagam para os dois espelhos.
  if (patch && Object.prototype.hasOwnProperty.call(patch, 'customDomains')) {
    const before = Array.isArray(cur.customDomains) ? cur.customDomains : [];
    const after = next.customDomains;
    setImmediate(() => {
      try {
        after.forEach((d) => {
          db.upsertCustomDomain(key, d);
          if (redis.enabled) redis.saveDomainSnapshot(key, d.host, Object.assign({ accountId: key }, d));
        });
        before
          .filter((d) => !after.some((n) => n.host === d.host))
          .forEach((d) => {
            db.deleteCustomDomain(key, d.host);
            if (redis.enabled) redis.deleteDomainSnapshot(key, d.host);
          });
      } catch (err) { console.error('[config] write-through de domínios:', err.message); }
    });
  }

  cache.set(key, next);
  db.saveConfig(key, next);
  persistDisk();
  return Object.assign({}, next);
}

// Semeadura em memória (só boot): mescla dados dos espelhos duráveis
// (custom_domains / accounts.currency) no cache SEM persistir — regra de ouro:
// erro/reconciliação de LEITURA nunca dispara escrita no banco.
function seed(accountId, patch) {
  const key = accountId || LEGACY_KEY;
  const cur = cache.has(key) ? cache.get(key) : defaults();
  cache.set(key, Object.assign({}, cur, patch || {}));
}

// Resolve a conta dona de um domínio personalizado (Host → accountId).
// Usado pelas rotas públicas (/go, /t.js, /l) para atribuir o tráfego à
// conta certa quando servido por um domínio do usuário.
function accountForDomain(host) {
  const h = String(host || '').toLowerCase().replace(/:\d+$/, '');
  if (!h) return null;
  for (const [key, cfg] of cache) {
    if (key === LEGACY_KEY) continue;
    if ((cfg.customDomains || []).some((d) => d.host === h)) return key;
  }
  return null;
}

// Lista os accountIds com config carregada (diagnóstico/varreduras).
function accountIds() {
  return Array.from(cache.keys()).filter((k) => k !== LEGACY_KEY);
}

// Migração: move a config legada 'main' (memória) para a conta do admin.
function migrateLegacyTo(accountId) {
  if (!accountId || !cache.has(LEGACY_KEY)) return;
  if (!cache.has(accountId)) {
    cache.set(accountId, cache.get(LEGACY_KEY));
    db.saveConfig(accountId, cache.get(accountId));
  }
  cache.delete(LEGACY_KEY);
  persistDisk();
}

module.exports = { get, set, seed, defaults, hydrate, accountForDomain, accountIds, migrateLegacyTo };
