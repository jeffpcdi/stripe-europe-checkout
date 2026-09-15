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
    // Proteção de tráfego contra bots e automação
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
      checkWebview: true,
      checkCoherence: true,
      checkEntropy: true,
      // Página segura GLOBAL de fallback: usada quando um link protegido não tem
      // destino alternativo próprio. Se vazia, o sistema serve /_safe.
      defaultWhitePage: '',
      // Item 254: camada de velocity (anti device-farm). N acessos do MESMO IP
      // ao MESMO link dentro da janela → white. Preset seguro: 12 acessos/60s
      // (folga para família no mesmo Wi-Fi; barra rajada de automação).
      velocityLimit: 12,     // acessos permitidos na janela (3–100)
      velocityWindowSec: 60  // janela em segundos (10–600)
    },
    // Links protegidos (entidade própria, servidos em /c/:slug). Cada link
    // carrega SUA própria configuração de proteção (interruptor, sensibilidade,
    // camadas de detecção) + offer/white page + allowlists de país e idioma.
    // [{ slug, nome, offerUrl, whitePageUrl, enabled, sensitivity, threshold,
    //    deadlineMs, blockDatacenter, ..., paises, idiomas, criadoEm, updatedAt }]
    cloakLinks: [],
    // API pública read-only (/api/v1/summary?token=...)
    // Item 419: scope controla o que o token expõe — 'stats' (só agregados)
    // ou 'stats+leads' (agregados + lista de leads mascarada).
    api: { token: '', scope: 'stats' },
    // Notificações Web Push nativas (canal principal no iPhone/PWA).
    // subs: aparelhos inscritos [{id, endpoint, keys:{p256dh,auth}, ua, createdAt}]
    // preferences: três escolhas claras em vez de uma matriz por evento.
    // funMode é opt-in; o padrão direto reduz ruído nas mensagens.
    webPush: {
      subs: [],
      funMode: false,
      preferences: { sales: true, risks: true, automation: true }
    },
    // Custos usados pelo cálculo de lucro líquido. Valores exatos recebidos
    // no webhook sempre têm prioridade; estes defaults cobrem gateways que não
    // informam a tarifa/imposto por transação.
    profitability: {
      gatewayFeePct: 0,
      gatewayFixedFeeCents: 0,
      taxPct: 0,
      productCostPct: 0,
      productCostFixedCents: 0,
      gatewayOverrides: {}
    },
    // Fontes de vídeo conectadas. Tokens OAuth nunca vivem neste JSON; apenas
    // preferências não sensíveis (pasta e comportamento de rascunho).
    cloudVideo: {
      googleDrive: { enabled: false, folderId: '', advertiserId: '' },
      dropbox: { enabled: false, folderPath: '', advertiserId: '' }
    },
    lastDailyReport: '',
    updatedAt: null
  };
}

// ── Cache em memória: accountId → cfg ──────────────────────────────────────
const cache = new Map();
// Hot routing indexes. Public requests must not scan every tenant on each hit.
// Duplicate legacy cloak slugs are marked ambiguous (null) and fail closed on
// the shared host; custom domains remain account-scoped.
const domainOwners = new Map();
const cloakSlugOwners = new Map();
function rebuildRoutingIndexes() {
  domainOwners.clear(); cloakSlugOwners.clear();
  for (const [key, cfg] of cache) {
    if (key === LEGACY_KEY) continue;
    for (const d of (cfg.customDomains || [])) {
      if (!d || !d.host) continue;
      const h = String(d.host).toLowerCase();
      if (!domainOwners.has(h)) domainOwners.set(h, key);
      else if (domainOwners.get(h) !== key) domainOwners.set(h, null);
    }
    for (const l of (cfg.cloakLinks || [])) {
      if (!l || !l.slug) continue;
      const slug = String(l.slug).toLowerCase();
      if (!cloakSlugOwners.has(slug)) cloakSlugOwners.set(slug, key);
      else if (cloakSlugOwners.get(slug) !== key) cloakSlugOwners.set(slug, null);
    }
  }
}
let hydrated = false;

function mergeDefaults(stored) {
  const base = defaults();
  const out = Object.assign({}, base, stored || {});
  out.cloak = Object.assign({}, base.cloak, (stored && stored.cloak) || {});
  out.pushcut = Object.assign({}, base.pushcut, (stored && stored.pushcut) || {});
  out.webPush = Object.assign({}, base.webPush, (stored && stored.webPush) || {});
  out.profitability = Object.assign({}, base.profitability, (stored && stored.profitability) || {});
  out.cloudVideo = {
    googleDrive: Object.assign({}, base.cloudVideo.googleDrive, stored && stored.cloudVideo && stored.cloudVideo.googleDrive || {}),
    dropbox: Object.assign({}, base.cloudVideo.dropbox, stored && stored.cloudVideo && stored.cloudVideo.dropbox || {})
  };
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
          // Linhas internas (ex.: '_webpush' = chaves VAPID) não são contas.
          if (String(row.key).startsWith('_')) return;
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
          if (r.provider) out.provider = r.provider;
          if (r.providerNote) out.providerNote = r.providerNote;
          if (r.dns && typeof r.dns === 'object') out.dns = r.dns;
          if (r.status) out.status = r.status;
          if (r.sslStatus) out.sslStatus = r.sslStatus;
          if (r.lastCheckedAt) out.lastCheckedAt = r.lastCheckedAt;
          if (r.lastError) out.lastError = r.lastError;
          if (r.retryCount) out.retryCount = r.retryCount;
          if (r.nextCheckAt) out.nextCheckAt = r.nextCheckAt;
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
  rebuildRoutingIndexes();
}

// Config de uma conta (sempre retorna algo; cria default em memória se nova).
// A config é JSON puro; clone profundo impede que um chamador altere um bloco
// aninhado (cloak/webPush/domains) por referência ANTES da persistência.
function cloneConfig(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function get(accountId) {
  const key = accountId || LEGACY_KEY;
  if (!cache.has(key)) cache.set(key, defaults());
  return cloneConfig(cache.get(key));
}

// Constrói + sanitiza a próxima config SEM tocar no cache nem em I/O.
// Isto permite ao caminho durável gravar primeiro e só então publicar em memória.
function prepareSet(accountId, patch) {
  const key = accountId || LEGACY_KEY;
  const cur = cache.has(key) ? cache.get(key) : defaults();
  const next = Object.assign({}, cur, patch || {});

  // Sanitização do bloco Pushcut
  const pc = Object.assign({}, next.pushcut || {});
  const url = String(pc.url || '').trim();
  pc.url = /^https:\/\/api\.pushcut\.io\/.+/i.test(url) ? url.slice(0, 300) : '';
  const ev = Object.assign(
    { sale: true, failed: true, refund: true, dispute: true, checkout: false, daily: false, login: false, watchdog: false },
    pc.events || {}
  );
  pc.events = {
    sale: ev.sale !== false,
    failed: ev.failed !== false,
    refund: ev.refund !== false,
    dispute: ev.dispute !== false,
    checkout: ev.checkout === true,
    daily: ev.daily === true,
    login: ev.login === true,
    watchdog: ev.watchdog === true
  };
  next.pushcut = pc;

  // Sanitização do bloco Web Push (aparelhos + preferências simples)
  {
    const wp = Object.assign({ subs: [], funMode: false }, next.webPush || {});
    if (!Array.isArray(wp.subs)) wp.subs = [];
    wp.subs = wp.subs.slice(0, 10).map((s) => ({
      id: String((s && s.id) || '').slice(0, 40),
      endpoint: String((s && s.endpoint) || '').slice(0, 600),
      keys: {
        p256dh: String((s && s.keys && s.keys.p256dh) || '').slice(0, 200),
        auth: String((s && s.keys && s.keys.auth) || '').slice(0, 100)
      },
      ua: String((s && s.ua) || '').slice(0, 120),
      createdAt: (s && s.createdAt) || new Date().toISOString()
    })).filter((s) => /^https:\/\//i.test(s.endpoint) && s.keys.p256dh && s.keys.auth);
    wp.funMode = wp.funMode === true;
    const pref = Object.assign({ sales: true, risks: true, automation: true }, wp.preferences || {});
    wp.preferences = {
      sales: pref.sales !== false,
      risks: pref.risks !== false,
      automation: pref.automation !== false
    };
    next.webPush = wp;
  }

  // Custos do lucro líquido. Percentuais são sempre números positivos e os
  // overrides ficam restritos a provedores conhecidos/nomes simples.
  {
    const raw = Object.assign({}, defaults().profitability, next.profitability || {});
    const clampPct = (value) => Math.max(0, Math.min(100, Number(value) || 0));
    const clampCents = (value) => Math.max(0, Math.min(100000000, Math.round(Number(value) || 0)));
    const gatewayOverrides = {};
    const source = raw.gatewayOverrides && typeof raw.gatewayOverrides === 'object' ? raw.gatewayOverrides : {};
    Object.keys(source).slice(0, 30).forEach((gatewayKey) => {
      const slug = String(gatewayKey).toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 30);
      if (!slug) return;
      gatewayOverrides[slug] = {
        feePct: clampPct(source[gatewayKey] && source[gatewayKey].feePct),
        fixedFeeCents: clampCents(source[gatewayKey] && source[gatewayKey].fixedFeeCents),
      };
    });
    next.profitability = {
      gatewayFeePct: clampPct(raw.gatewayFeePct),
      gatewayFixedFeeCents: clampCents(raw.gatewayFixedFeeCents),
      taxPct: clampPct(raw.taxPct),
      productCostPct: clampPct(raw.productCostPct),
      productCostFixedCents: clampCents(raw.productCostFixedCents),
      gatewayOverrides,
    };
  }

  // Preferências não secretas dos conectores de arquivos.
  {
    const source = next.cloudVideo && typeof next.cloudVideo === 'object' ? next.cloudVideo : {};
    const gd = source.googleDrive || {};
    const dbx = source.dropbox || {};
    next.cloudVideo = {
      googleDrive: {
        enabled: gd.enabled === true,
        folderId: String(gd.folderId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 160),
        advertiserId: String(gd.advertiserId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120),
      },
      dropbox: {
        enabled: dbx.enabled === true,
        folderPath: String(dbx.folderPath || '').trim().replace(/\.\./g, '').slice(0, 500),
        advertiserId: String(dbx.advertiserId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120),
      },
    };
  }

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
    // id/provedor do domínio na hospedagem — usados para consultar/remover via API.
    if (d.providerId) out.providerId = String(d.providerId).slice(0, 80);
    if (d.provider) out.provider = String(d.provider).slice(0, 40);
    if (d.providerNote) out.providerNote = String(d.providerNote).slice(0, 500);
    // Estado operacional do provisionamento. Esses campos são atualizados por
    // /api/domains/verify e PRECISAM sobreviver ao config.set; antes o
    // sanitizador os descartava, então a UI voltava para "aguardando conexão"
    // mesmo depois de o provider reportar pending_ssl/error/active.
    if (['pending_dns', 'pending_ssl', 'active', 'error'].includes(d.status)) out.status = d.status;
    if (d.sslStatus != null) out.sslStatus = String(d.sslStatus).slice(0, 80) || null;
    if (d.lastCheckedAt) out.lastCheckedAt = String(d.lastCheckedAt).slice(0, 40);
    if (d.lastError != null) out.lastError = String(d.lastError).slice(0, 500) || null;
    out.retryCount = Math.max(0, Math.min(20, Math.round(Number(d.retryCount) || 0)));
    if (d.nextCheckAt) out.nextCheckAt = String(d.nextCheckAt).slice(0, 40);
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
  next.api = {
    token: String((next.api || {}).token || '').slice(0, 64),
    // Item 419: escopo do token público — default conservador ('stats').
    scope: ['stats', 'stats+leads'].includes((next.api || {}).scope) ? next.api.scope : 'stats'
  };
  next.lastDailyReport = String(next.lastDailyReport || '').slice(0, 10);

  // ── Sanitização do bloco settings (itens 422/423/424/425/429/430) ────────
  {
    const s = Object.assign({}, next.settings || {});
    const out = {};
    // moeda (item 147, preservada)
    if (/^[A-Z]{3}$/.test(String(s.defaultCurrency || '').toUpperCase())) {
      out.defaultCurrency = String(s.defaultCurrency).toUpperCase();
    }
    // Item 422: fuso da conta (IANA válido; vazio = America/Sao_Paulo)
    if (s.timezone) {
      try { new Intl.DateTimeFormat('en', { timeZone: String(s.timezone) }); out.timezone = String(s.timezone).slice(0, 60); }
      catch (_) { /* fuso inválido é descartado */ }
    }
    // Item 423/271: meta de receita mensal em centavos (0 = sem meta)
    const goal = Math.round(Number(s.revenueGoal) || 0);
    if (goal > 0) out.revenueGoal = Math.min(goal, 100000000000); // teto 1 bi de centavos
    // Item 424/325: webhook de saída por venda aprovada (https obrigatório)
    if (/^https:\/\/[^\s]+\.[^\s]+/i.test(String(s.outboundWebhook || '').trim())) {
      out.outboundWebhook = String(s.outboundWebhook).trim().slice(0, 500);
    }
    // Item 425/324: retenção LGPD em dias (0 = desligado; mínimo 30 para
    // ninguém anonimizar leads de ontem por engano)
    const lgpd = Math.round(Number(s.lgpdDays) || 0);
    if (lgpd >= 30) out.lgpdDays = Math.min(lgpd, 3650);
    // Item 430: hora (0–23, fuso da conta) a partir da qual o resumo diário
    // pode ser enviado
    const drh = Math.round(Number(s.dailyReportHour));
    if (Number.isFinite(drh) && drh >= 0 && drh <= 23) out.dailyReportHour = drh;
    if (typeof s.dailyReportEnabled === 'boolean') out.dailyReportEnabled = s.dailyReportEnabled;
    const whatsappTo = String(s.whatsappTo || '').replace(/\D/g, '').slice(0, 20);
    if (whatsappTo.length >= 8) out.whatsappTo = whatsappTo;
    // Modelo da venda na notificação nativa. `pushcutTemplate` é aceito só
    // para migrar configurações já existentes sem perder a mensagem do usuário.
    const notificationTemplate = s.notificationTemplate || s.pushcutTemplate;
    if (typeof notificationTemplate === 'string' && notificationTemplate.trim()) {
      out.notificationTemplate = notificationTemplate.trim().slice(0, 300);
    }
    next.settings = out;
  }

  // Sanitização do bloco de proteção de tráfego
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
      shadowMode:         boolOr(c.shadowMode, false),
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
      checkWebview:       boolOr(c.checkWebview, true),
      checkCoherence:     boolOr(c.checkCoherence, true),
      checkEntropy:       boolOr(c.checkEntropy, true),
      defaultWhitePage:   validHttps(c.defaultWhitePage) ? String(c.defaultWhitePage).trim().slice(0, 500) : '',
      // Item 254: limites de velocity com clamp seguro — nunca deixa o usuário
      // se auto-bloquear (mínimo 3) nem desligar a proteção por engano (máx 100).
      velocityLimit:      Math.max(3, Math.min(100, Math.round(Number(c.velocityLimit) || 12))),
      velocityWindowSec:  Math.max(10, Math.min(600, Math.round(Number(c.velocityWindowSec) || 60))),
      autoBlockEnabled:  boolOr(c.autoBlockEnabled, false),
      autoBlockThreshold: Math.max(3, Math.min(100, Math.round(Number(c.autoBlockThreshold) || 8))),
      autoBlockWindowMin: Math.max(5, Math.min(1440, Math.round(Number(c.autoBlockWindowMin) || 30))),
      autoBlockTtlHours: Math.max(1, Math.min(720, Math.round(Number(c.autoBlockTtlHours) || 24))),
      capiBotSignalEnabled: boolOr(c.capiBotSignalEnabled, false)
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
        shadowMode:         boolOr(l.shadowMode, false),
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
        checkWebview:       boolOr(l.checkWebview, true),
        checkCoherence:     boolOr(l.checkCoherence, true),
        checkEntropy:       boolOr(l.checkEntropy, true),
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

  return {
    key,
    cur,
    next,
    domainsTouched: !!(patch && Object.prototype.hasOwnProperty.call(patch, 'customDomains')),
  };
}

async function syncDomainMirrors(prepared) {
  if (!prepared.domainsTouched) return;
  const key = prepared.key;
  const before = Array.isArray(prepared.cur.customDomains) ? prepared.cur.customDomains : [];
  const after = Array.isArray(prepared.next.customDomains) ? prepared.next.customDomains : [];
  const removed = before.filter((d) => !after.some((n) => n.host === d.host));

  // O JSON da tabela config é a fonte primária. Estes espelhos existem para
  // lookup rápido/reconciliação e são atualizados só DEPOIS do commit primário.
  const tasks = [];
  if (db.enabled) {
    after.forEach((d) => tasks.push(db.upsertCustomDomain(key, d).then((ok) => {
      if (!ok) throw new Error('falha ao espelhar domínio ' + d.host + ' no Neon');
    })));
    removed.forEach((d) => tasks.push(db.deleteCustomDomain(key, d.host).then((ok) => {
      if (!ok) throw new Error('falha ao remover espelho do domínio ' + d.host + ' no Neon');
    })));
  }
  if (redis.enabled) {
    after.forEach((d) => tasks.push(Promise.resolve(redis.saveDomainSnapshot(key, d.host, Object.assign({ accountId: key }, d)))));
    removed.forEach((d) => tasks.push(Promise.resolve(redis.deleteDomainSnapshot(key, d.host))));
  }
  if (tasks.length) await Promise.all(tasks);
}

// Snapshot local imediato/atômico usado como camada durável quando não há Neon.
// O cache só é publicado DEPOIS que rename() confirma o arquivo completo.
async function persistDiskEntryNow(key, next) {
  const data = {};
  cache.forEach((v, k) => { data[k] = v; });
  data[key] = next;
  await fs.promises.mkdir(DATA_DIR, { recursive: true });
  const tmp = FILE + '.tmp-' + process.pid + '-' + Date.now();
  await fs.promises.writeFile(tmp, JSON.stringify({ __isMap: true, data }, null, 2));
  await fs.promises.rename(tmp, FILE);
}

// Compatibilidade para caminhos antigos/background: mantém write-through
// assíncrono. Rotas de mutação da dashboard devem usar setDurable().
function set(accountId, patch) {
  const prepared = prepareSet(accountId, patch);
  cache.set(prepared.key, prepared.next);
  rebuildRoutingIndexes();
  void db.saveConfig(prepared.key, prepared.next);
  persistDisk();
  setImmediate(() => {
    syncDomainMirrors(prepared).catch((err) => console.error('[config] write-through de domínios:', err.message));
  });
  return cloneConfig(prepared.next);
}

const durableQueues = new Map();

async function setDurableNow(accountId, patch, options) {
  const key = accountId || LEGACY_KEY;
  const expectedUpdatedAt = options && options.expectedUpdatedAt ? String(options.expectedUpdatedAt) : '';

  // O mutex abaixo cobre concorrência dentro deste processo. Em produção pode
  // haver mais de uma instância; por isso cada tentativa usa CAS no Neon com o
  // `updatedAt` da versão lida. Mutações internas sem revisão explícita podem
  // reaplicar o patch sobre a versão mais nova; edições da dashboard falham em
  // 409 para nunca sobrescrever silenciosamente o trabalho de outra aba.
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = cache.has(key) ? cache.get(key) : defaults();
    if (expectedUpdatedAt && current.updatedAt && String(current.updatedAt) !== expectedUpdatedAt) {
      const err = new Error('A configuração foi alterada em outra aba. Atualize os dados e tente novamente.');
      err.code = 'CONFIG_REVISION_CONFLICT';
      err.status = 409;
      err.currentUpdatedAt = current.updatedAt;
      throw err;
    }

    const resolvedPatch = typeof patch === 'function' ? patch(cloneConfig(current)) : patch;
    const prepared = prepareSet(key, resolvedPatch);
    if (db.enabled) {
      const baseVersion = prepared.cur && prepared.cur.updatedAt ? String(prepared.cur.updatedAt) : '';
      let persisted;
      if (baseVersion && typeof db.saveConfigVersioned === 'function') {
        persisted = await db.saveConfigVersioned(prepared.key, prepared.next, baseVersion);
      } else {
        // Compatibilidade com configs antigas sem `updatedAt`: a primeira
        // gravação promove o snapshot para o protocolo versionado.
        persisted = { ok: await db.saveConfig(prepared.key, prepared.next), conflict: false };
      }

      if (!persisted.ok && persisted.conflict) {
        const fresh = await db.loadConfig(prepared.key);
        if (!fresh || !fresh.ok) {
          const err = new Error('Não foi possível confirmar a versão atual da configuração.');
          err.code = 'CONFIG_PERSIST_FAILED';
          err.status = 503;
          throw err;
        }
        if (fresh.data) {
          cache.set(prepared.key, fresh.data);
          rebuildRoutingIndexes();
        }
        if (expectedUpdatedAt) {
          const latest = fresh.data && fresh.data.updatedAt ? String(fresh.data.updatedAt) : '';
          const err = new Error('A configuração foi alterada em outra aba. Atualize os dados e tente novamente.');
          err.code = 'CONFIG_REVISION_CONFLICT';
          err.status = 409;
          err.currentUpdatedAt = latest || null;
          throw err;
        }
        // Worker/reconciliador: refaz o merge sobre o snapshot vencedor.
        continue;
      }
      if (!persisted.ok) {
        const err = new Error('Não foi possível confirmar a configuração no banco de dados.');
        err.code = 'CONFIG_PERSIST_FAILED';
        err.status = 503;
        throw err;
      }
    } else {
      try {
        await persistDiskEntryNow(prepared.key, prepared.next);
      } catch (cause) {
        const err = new Error('Não foi possível confirmar a configuração no armazenamento local.');
        err.code = 'CONFIG_PERSIST_FAILED';
        err.status = 503;
        err.cause = cause;
        throw err;
      }
    }

    // Só agora a leitura quente passa a enxergar a nova versão.
    cache.set(prepared.key, prepared.next);
    rebuildRoutingIndexes();
    if (db.enabled) persistDisk();

    try {
      await syncDomainMirrors(prepared);
    } catch (err) {
      // O commit primário já foi confirmado. Não fazemos rollback mentiroso de
      // cache: no boot a tabela config vence os espelhos. Registramos para reparo.
      console.error('[config] espelho de domínios após commit:', err.message);
    }
    return cloneConfig(prepared.next);
  }

  const err = new Error('A configuração mudou durante a atualização. Tente novamente.');
  err.code = 'CONFIG_REVISION_CONFLICT';
  err.status = 409;
  throw err;
}

// Serializa mutações por conta. Duas requests simultâneas deixam de fazer
// read-modify-write em paralelo e perder blocos diferentes da mesma config.
function setDurable(accountId, patch, options) {
  const key = accountId || LEGACY_KEY;
  const previous = durableQueues.get(key) || Promise.resolve();
  const operation = previous.catch(() => {}).then(() => setDurableNow(key, patch, options || {}));
  durableQueues.set(key, operation);
  operation.finally(() => {
    if (durableQueues.get(key) === operation) durableQueues.delete(key);
  }).catch(() => {});
  return operation;
}

// Semeadura em memória (só boot): mescla dados dos espelhos duráveis
// (custom_domains / accounts.currency) no cache SEM persistir — regra de ouro:
// erro/reconciliação de LEITURA nunca dispara escrita no banco.
function seed(accountId, patch) {
  const key = accountId || LEGACY_KEY;
  const cur = cache.has(key) ? cache.get(key) : defaults();
  cache.set(key, Object.assign({}, cur, patch || {}));
  rebuildRoutingIndexes();
}

// Resolve a conta dona de um domínio personalizado (Host → accountId).
// Usado pelas rotas públicas (/go, /t.js, /l) para atribuir o tráfego à
// conta certa quando servido por um domínio do usuário.
function accountForDomain(host) {
  const h = String(host || '').toLowerCase().replace(/:\d+$/, '');
  if (!h) return null;
  return domainOwners.get(h) || null;
}

// Resolve /c/:slug no host compartilhado sem varrer todas as contas. Slug
// legado duplicado retorna null (ambíguo) e a rota responde 404 fail-closed.
function accountForCloakSlug(slug) {
  const s = String(slug || '').toLowerCase();
  if (!s) return null;
  return cloakSlugOwners.get(s) || null;
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
  rebuildRoutingIndexes();
  persistDisk();
}

module.exports = { get, set, setDurable, seed, defaults, hydrate, accountForDomain, accountForCloakSlug, accountIds, migrateLegacyTo, rebuildRoutingIndexes };
