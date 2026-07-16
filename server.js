// ── Carrega variáveis de ambiente de arquivos .env (Node puro não faz isso) ─
// Necessário para o DATABASE_URL do Neon e demais chaves em dev/preview.
(() => {
  const fsEnv = require('fs');
  const pathEnv = require('path');
  ['.env.development.local', '.env.local', '.env'].forEach((file) => {
    const p = pathEnv.join(__dirname, file);
    if (!fsEnv.existsSync(p)) return;
    try {
      fsEnv.readFileSync(p, 'utf8').split('\n').forEach((line) => {
        const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (!m) return;
        let val = m[2];
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (process.env[m[1]] === undefined) process.env[m[1]] = val;
      });
    } catch (_) { /* ignora arquivo ilegível */ }
  });
})();

const express = require('express');
const compression = require('compression'); // gzip/brotli nas respostas (HTML gigante da dashboard + JSON do polling)
const path = require('path');
const ttEvents = require('./tiktok-events');
const pixelStore = require('./pixel-store');
const { sendPushcut } = require('./pushcut');
const stats = require('./stats');
const presence = require('./presence');
const { injectPulse } = require('./pulse-client');
const config = require('./config');
const geoip = require('geoip-lite');
const fs = require('fs');
const DASHBOARD_HTML = require('./dashboard-view');
const LP_HTML = require('./lp-view');
const linkStore = require('./link-store');
const uaTools = require('./ua');
const botFilter = require('./bot-filter');
const cloakTestProfiles = require('./cloak-test-profiles'); // item 165/208: simulador de perfis
const TRACKER_JS = require('./tracker-view');
const auth = require('./auth');
 const gatewayStore = require('./gateway-store');
 const { normalizeConversion } = require('./conversion-normalize');
 const { buildUtm } = require('./utm-macros');
 const db = require('./db');
const redis = require('./redis'); // contadores de decisão do cloaker (offer/white)
const { loginPage, registerPage } = require('./auth-view');

// ── Resolução da conta para tráfego PÚBLICO (multi-tenant) ────────────────
// Rotas públicas (/go, /t.js, /px.js, /l, /px.gif, /api/track) não têm sessão.
// Descobrimos a conta dona do tráfego por: (1) domínio personalizado do Host;
// (2) conta padrão (o admin / única conta) como fallback. Assim, quem tem uma
// só conta funciona sem configurar domínio, e quem tem várias isola pelo
// domínio que serve cada funil.
let _defaultAccountId = null;
async function refreshDefaultAccount() {
  try { _defaultAccountId = await db.getFirstAccountId(); }
  catch (_) { _defaultAccountId = null; }
}
function publicAccountId(req) {
  try {
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    const byDomain = config.accountForDomain(host);
    if (byDomain) return byDomain;
  } catch (_) {}
  return _defaultAccountId;
}

// Lê um cookie do request (parse simples, sem dependência extra)
function readCookie(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  const found = raw.split(';').map((c) => c.trim()).find((c) => c.startsWith(name + '='));
  return found ? decodeURIComponent(found.split('=').slice(1).join('=')) : null;
}

// ── Helpers do rastreamento TikTok (event_id determinístico + dedup) ─────
// Chave por hora (UTC): o mesmo lead na mesma hora gera o MESMO event_id no
// navegador e no servidor → o TikTok deduplica automaticamente.
function hourKey(d) {
  const t = d || new Date();
  return t.toISOString().slice(0, 13).replace(/[-T]/g, ''); // yyyymmddhh
}
// Dedup em memória: evita re-disparar o mesmo event_id via CAPI (beacon do
// navegador + middleware podem gerar o mesmo id). TTL de 2h.
// Dedup de event_id: Redis quando disponível (sobrevive a restarts, multi-instância),
// Map em memória como fallback ultra-rápido sem dependência externa.
const rdb = require('./redis');
const _seenPx = new Map();
// Item 225: contador de eventos deduplicados (beacon + middleware). Deixa
// claro que o disparo "faltando" foi na verdade evitado de propósito.
const _dedupStats = { deduped: 0, since: Date.now() };
async function seenPixelEvent(eventId) {
  // Redis primeiro: SET NX com TTL de 2h — garante dedup entre instâncias
  if (rdb.enabled) {
    const seen = await rdb.seenEventId(eventId);
    if (seen) _dedupStats.deduped++;
    return seen;
  }
  // fallback memória local
  const now = Date.now();
  if (_seenPx.size > 5000) {
    for (const [k, ts] of _seenPx) { if (now - ts > 2 * 3600e3) _seenPx.delete(k); }
  }
  if (_seenPx.has(eventId)) { _dedupStats.deduped++; return true; }
  _seenPx.set(eventId, now);
  return false;
}
// URL completa do request (para o campo page.url do TikTok)
function fullUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  return host ? proto + '://' + host + req.originalUrl : null;
}

// Nomes de países (ISO-2 → PT) para exibição amigável
const COUNTRY_NAMES = {
  PT: 'Portugal', BR: 'Brasil', ES: 'Espanha', FR: 'França', DE: 'Alemanha',
  GB: 'Reino Unido', IE: 'Irlanda', IT: 'Itália', NL: 'Países Baixos', BE: 'Bélgica',
  CH: 'Suíça', AT: 'Áustria', US: 'Estados Unidos', CA: 'Canadá', MX: 'México',
  PL: 'Polónia', SE: 'Suécia', NO: 'Noruega', DK: 'Dinamarca', FI: 'Finlândia',
  LU: 'Luxemburgo', GR: 'Grécia', RO: 'Roménia', CZ: 'Chéquia', HU: 'Hungria',
  AU: 'Austrália', AE: 'Emirados Árabes', AO: 'Angola', MZ: 'Moçambique', CV: 'Cabo Verde'
};

// Geo-IP → { country, countryName, city }
function geoLookup(ip) {
  try {
    const clean = String(ip || '').replace('::ffff:', '');
    if (!clean || clean === '127.0.0.1' || clean === '::1') return {};
    const g = geoip.lookup(clean);
    if (!g) return {};
    return { country: g.country, countryName: COUNTRY_NAMES[g.country] || g.country, city: g.city || null };
  } catch (_) { return {}; }
}

// Identificador estável de visitante (cookie v_id). Cria se não existir.
function getOrAssignVisitor(req, res) {
  let id = readCookie(req, 'v_id');
  if (!id) {
    id = 'ld_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    res.setHeader('Set-Cookie', `v_id=${id};Path=/;Max-Age=7776000;SameSite=Lax`); // 90 dias
  }
  return id;
}

// Permite múltiplos Set-Cookie sem sobrescrever
function appendCookie(res, cookie) {
  const prev = res.getHeader('Set-Cookie');
  if (!prev) res.setHeader('Set-Cookie', cookie);
  else res.setHeader('Set-Cookie', [].concat(prev, cookie));
}

// Formata valor monetário (ex.: 12,97 €)
function fmtMoney(amount, currency) {
  return new Intl.NumberFormat('pt-PT', {
    style: 'currency',
    currency: (currency || 'eur').toUpperCase()
  }).format((amount || 0) / 100);
}

// Formata data/hora no fuso de Lisboa
function fmtDate(unixSeconds) {
  return new Intl.DateTimeFormat('pt-PT', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Lisbon'
  }).format(new Date((unixSeconds || Date.now() / 1000) * 1000));
}

// IP privado / reservado / loopback (nunca serve para geo)
function isPrivateIp(ip) {
  const c = String(ip || '').replace('::ffff:', '').trim();
  if (!c) return true;
  if (c === '::1' || c === '127.0.0.1' || c.startsWith('127.')) return true;
  if (c.startsWith('10.') || c.startsWith('192.168.')) return true;
  if (c.startsWith('169.254.')) return true;                 // link-local
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(c)) return true;     // 172.16.0.0/12
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(c)) return true; // 100.64/10 CGNAT
  if (c.startsWith('fc') || c.startsWith('fd') || c.startsWith('fe80')) return true; // ULA/link-local IPv6
  return false;
}

// IP real do cliente. Atrás do Cloudflare usa CF-Connecting-IP; senão pega o
// primeiro IP PÚBLICO da cadeia X-Forwarded-For; por fim cai no socket.
function clientIp(req) {
  const h = req.headers || {};
  const cf = h['cf-connecting-ip'];
  if (cf && !isPrivateIp(cf)) return String(cf).trim();
  const real = h['x-real-ip'];
  if (real && !isPrivateIp(real)) return String(real).trim();
  const fwd = h['x-forwarded-for'];
  if (fwd) {
    const chain = String(fwd).split(',').map(s => s.trim()).filter(Boolean);
    const pub = chain.find(ip => !isPrivateIp(ip));
    if (pub) return pub;
    if (chain[0]) return chain[0];
  }
  return req.socket?.remoteAddress || req.ip || '';
}

// Geo confiável a partir da requisição: usa o país exato fornecido pela borda
// (edge) da plataforma de hospedagem — Vercel, Cloudflare ou proxies genéricos —
// e só recorre ao geoip-lite offline como último fallback. Isto evita a
// localização errada (ex.: tudo aparecer nos EUA) causada por bancos de
// geo-IP offline desatualizados.
function decodeHdr(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  try { return decodeURIComponent(s); } catch (_) { return s; }
}
function geoFromReq(req) {
  const h = req.headers || {};
  // Ordem de confiança: Vercel → Cloudflare → proxies genéricos
  const cc = String(
    h['x-vercel-ip-country'] || h['cf-ipcountry'] ||
    h['x-country-code'] || h['x-geo-country'] || ''
  ).toUpperCase().trim();
  // XX = desconhecido, T1 = rede Tor — nesses casos ignora o header e cai no fallback
  if (cc && cc !== 'XX' && cc !== 'T1' && cc.length === 2) {
    const city =
      decodeHdr(h['x-vercel-ip-city']) ||
      decodeHdr(h['cf-ipcity']) ||
      decodeHdr(h['x-geo-city']) || null;
    return { country: cc, countryName: COUNTRY_NAMES[cc] || cc, city: city };
  }
  return geoLookup(clientIp(req));
}

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────────
// Compressão gzip: o HTML da dashboard tem ~340 KB e cai para ~55 KB comprimido.
// Também comprime as respostas JSON do polling (/api/stats a cada 12s).
// Threshold de 1 KB: respostas minúsculas (px.gif, 204s) não pagam o custo do gzip.
app.use(
  compression({
    threshold: 1024,
    filter: (req, res) => {
      // /dashboard é proxy pro Next, que já faz a própria compressão em
      // streaming — comprimir de novo bufferiza e quebra o RSC streaming.
      if (req.originalUrl.startsWith('/dashboard') && req.query.legacy !== '1') return false;
      return compression.filter(req, res);
    },
  }),
);
// rawBody: necessário para verificar assinaturas HMAC de webhooks (Stripe,
// Kiwify) — o HMAC é calculado sobre os bytes originais, não o JSON re-serializado
// Item 471: limites de body EXPLÍCITOS contra payload bomb. O backup da conta
// (leads + eventos) pode legitimamente passar de 100kb, então /api/backup/import
// ganha um parser próprio de 5mb ANTES do parser global de 200kb (webhooks
// reais de gateway têm poucos KB — 200kb já é folga generosa).
app.use('/api/backup/import', express.json({ limit: '5mb' }));
app.use(express.json({
  limit: '200kb',
  verify: (req, _res, buf) => { req.rawBody = buf ? buf.toString('utf8') : ''; }
}));
// sendBeacon cross-origin manda JSON como text/plain (evita preflight CORS)
// — parseia de volta para objeto nas rotas de rastreamento
app.use(express.text({ type: 'text/plain', limit: '50kb' }));
app.use((req, _res, next) => {
  if (typeof req.body === 'string' && req.body.length) {
    try { req.body = JSON.parse(req.body); } catch (_) { req.body = {}; }
  }
  next();
});

// Item 438: headers de segurança. Os dois primeiros são seguros em QUALQUER
// resposta (inclusive px.gif e páginas de funil embutidas em iframe):
//  - nosniff: impede o browser de "adivinhar" content-type (defesa XSS/MIME).
//  - Referrer-Policy: não vaza a URL completa (com querystring/UTMs) para
//    terceiros ao clicar em links externos.
// X-Frame-Options só entra em páginas HTML DO APP (não-funil, não-domínio
// personalizado): as páginas públicas de funil PRECISAM poder ser embutidas.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  const p = req.path || '';
  const isPublicFunnel = isCustomDomain(req) ||
    p.startsWith('/go/') || p.startsWith('/c/') || p.startsWith('/l/') ||
    p === '/px.gif' || p === '/px.js' || p === '/t.js' || /^\/px\//.test(p);
  if (!isPublicFunnel && !p.startsWith('/api')) {
    // Painel/landing: nunca embutível (clickjacking) e sem preview de DNS.
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
  }
  next();
});

// Item 437 (CSRF): valida a origem em mutações do painel. O cookie de sessão
// é SameSite=Lax, o que já barra POSTs cross-site na maioria dos casos; esta é
// a segunda camada. POSTs para /api que ENVIAM cookie de sessão precisam vir do
// próprio host. Webhooks de gateway (/hook, /api/conversion) e tracking público
// (sem cookie) são isentos — chegam de origens externas legítimas.
// Prefixos relativos ao mount '/api' (req.path chega sem o '/api' aqui).
// /client-error é write-only, rate-limited e sem efeito sensível — isento para
// o sendBeacon de unload (que pode chegar sem Origin) nunca ser descartado.
const CSRF_EXEMPT_PREFIX = ['/track', '/px/', '/cloakcheck', '/conversion', '/pulse', '/client-error'];
app.use('/api', (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const p = req.path || '';
  if (CSRF_EXEMPT_PREFIX.some((pre) => p.startsWith(pre))) return next();
  // Só exige origem casada quando há cookie de sessão no request (é uma ação
  // do painel autenticado). Sem cookie, não há CSRF de sessão a proteger.
  const hasSession = /(?:^|;\s*)dash_session=/.test(req.headers.cookie || '');
  if (!hasSession) return next();
  const origin = req.headers.origin || '';
  if (!origin) return next(); // same-origin server-side / sendBeacon sem Origin
  try {
    const originHost = new URL(origin).host.toLowerCase().replace(/:\d+$/, '');
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '')
      .split(',')[0].trim().toLowerCase().replace(/:\d+$/, '');
    if (originHost && host && originHost !== host) {
      return res.status(403).json({ error: 'origem não permitida' });
    }
  } catch (_) { /* Origin malformado: deixa passar p/ não travar clientes legítimos */ }
  next();
});

// CORS headers para todas as rotas API (GET + POST + OPTIONS)
app.use('/api', (req, res, next) => {
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── Guard de domínio personalizado ───────────────────────────────────
// Os domínios personalizados dos lojistas servem APENAS o funil público
// (tracking, cloaker, checkout, pixel, webhook). O app do SaaS — landing,
// dashboard, login, register, páginas legais e TODAS as APIs de gestão —
// fica acessível SÓ no host principal. Num domínio personalizado, qualquer
// rota fora da allowlist responde 404 puro (nem revela que ali há um painel).
// Allowlist (não denylist) de propósito: rota nova nasce bloqueada no domínio
// do lojista até ser explicitamente liberada aqui.
const CUSTOM_ALLOW_EXACT = new Set([
  '/_safe', '/__domain-check', '/healthz',
  '/t.js', '/px.js', '/px.gif',
  '/api/track', '/api/px/event', '/api/cloakcheck', '/api/conversion'
]);
const CUSTOM_ALLOW_PREFIX = ['/go/', '/c/', '/l/', '/hook/', '/assets/'];
function allowedOnCustomDomain(p) {
  if (CUSTOM_ALLOW_EXACT.has(p)) return true;
  if (/^\/px\/[^/]+\.js$/.test(p)) return true;              // /px/:token.js
  for (const pre of CUSTOM_ALLOW_PREFIX) if (p.startsWith(pre)) return true;
  return false;
}
// Hosts que NUNCA são tratados como personalizados (salvaguarda contra lockout
// do painel caso o apex principal seja adicionado por engano a uma conta).
const PRIMARY_HOSTS = new Set(
  [process.env.PRIMARY_HOST, process.env.RAILWAY_PUBLIC_DOMAIN]
    .filter(Boolean).map((h) => String(h).toLowerCase().replace(/:\d+$/, ''))
);
function isCustomDomain(req) {
  try {
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '')
      .split(',')[0].trim().toLowerCase().replace(/:\d+$/, '');
    if (!host || PRIMARY_HOSTS.has(host)) return false;      // host principal
    return !!config.accountForDomain(host);                  // achou conta dona → personalizado
  } catch (_) { return false; }
}
app.use((req, res, next) => {
  if (!isCustomDomain(req)) return next();                   // host principal: app completo
  if (allowedOnCustomDomain(req.path)) return next();        // rota pública do funil
  return res.status(404).type('text/plain').send('Not found'); // 404 puro
});

// ── Rastreio de funil: todo visitante (page view HTML) vira um lead ──
app.use(async (req, res, next) => {
  try {
    if (req.method !== 'GET') return next();
    const p = req.path || '';
    if (p.startsWith('/api') || p.startsWith('/assets') || p.startsWith('/go/')
        || p.startsWith('/c/') || p.startsWith('/__dev') || p === '/dashboard') return next();
    const accept = req.headers.accept || '';
    if (!accept.includes('text/html')) return next();          // só navegações
    if (/\.[a-z0-9]{2,5}$/i.test(p) && !p.endsWith('.html')) return next(); // ignora assets

    // Bots (crawlers do TikTok/Google, monitoramento, curl) nunca viram lead
    // nem disparam CAPI — poluiriam o funil e o Event Match Quality do pixel.
    const uaRaw = String(req.headers['user-agent'] || '');
    if (uaTools.isBot(uaRaw)) return next();

    const hadCookie = !!readCookie(req, 'v_id');
    const id = getOrAssignVisitor(req, res);
    const acc = publicAccountId(req);
    if (!hadCookie) {                                          // 1 lead por visitante
      const geo = geoFromReq(req);
      const q = req.query || {};
      const dev = uaTools.parse(uaRaw);
      stats.recordVisit({
        id,
        acc,
        ip: clientIp(req),
        ua: uaRaw.slice(0, 300),
        device: dev.device, os: dev.os, browser: dev.browser,
        referer: req.headers['referer'] || null,
        landing: p,
        country: geo.country, countryName: geo.countryName, city: geo.city,
        ttclid: q.ttclid || null,
        utm: buildUtm({
          source: q.utm_source, medium: q.utm_medium,
          campaign: q.utm_campaign, content: q.utm_content, term: q.utm_term
        })
      });
      stats.logEvent('visit', {
        acc,
        title: 'Novo lead no funil',
        landing: p,
        country: geo.countryName || geo.country || null,
        ref: id
      });

      // ── TikTok CAPI: ViewContent server-side (cobre até quem bloqueia JS).
      // event_id determinístico = mesmo id que o pixel do navegador → dedup.
      const evId = 'ViewContent.' + id + '.' + hourKey();
      if (!(await seenPixelEvent(evId))) {
        // enriquece com ttclid/_ttp/email já salvos no lead (visitas anteriores)
        // — quanto mais sinal de identidade, maior o Event Match Quality
        let leadVc = null;
        try { leadVc = stats.getLead(id); } catch (_) {}
        ttEvents.dispatchToAll('ViewContent', {
          eventId: evId,
          leadId: id,
          ip: clientIp(req),
          userAgent: uaRaw.slice(0, 500),
          ttclid: q.ttclid || (leadVc && leadVc.ttclid) || null,
          ttp: (leadVc && leadVc.ttp) || null,
          email: (leadVc && leadVc.email) || undefined,
          phone: (leadVc && leadVc.phone) || undefined,
          url: fullUrl(req)
        }, p).catch(() => {});
      }
    } else {
      // visitante recorrente: só registra o passo na jornada (páginas internas)
      stats.recordVisit({ id, landing: p });
    }
  } catch (_) { /* nunca bloquear navegação */ }
  next();
});

// ── Rastreamento universal para páginas EXTERNAS ─────────────────────
// Qualquer arquivo/página fora deste servidor (presell, VSL, landing em
// outro domínio) inclui <script src="https://DOMINIO/t.js" defer></script>
// e passa a: registrar o lead no funil, disparar ViewContent na CAPI e
// decorar os links /go/ com o vid — rastreando TODO o trajeto do lead
// até a entrada do checkout, sem depender de cookie cross-site.
const VID_RE = /^ld_[a-z0-9]{6,30}$/i;

// Itens 417/439: helper de auditoria — grava ação sensível na trilha da conta
// com IP mascarado (último octeto/fim do IPv6 ofuscado). Fire-and-forget:
// auditoria nunca pode quebrar a ação que está auditando.
function maskReqIp(req) {
  const ip = clientIp(req);
  if (!ip) return null;
  return ip.includes(':') ? ip.split(':').slice(0, 3).join(':') + ':…' : ip.replace(/\.\d+$/, '.xxx');
}
function audit(req, accId, action, detail) {
  if (!accId) return;
  try { db.insertAudit(accId, action, detail || null, maskReqIp(req)).catch(() => {}); }
  catch (_) { /* melhor-esforço */ }
}

// ── Anti-abuso: rate limit por IP nos endpoints públicos ─────────────
// Janela deslizante em memória (60s). Protege os números do funil e o
// sinal do pixel contra bots agressivos, spy tools e cliques inflados.
// Limites folgados para humanos (SPA que troca de rota muito fica longe).
const RL_BUCKETS = new Map(); // 'ip|chave' -> { n, resetAt }
function rateLimited(ip, key, max) {
  const now = Date.now();
  const k = ip + '|' + key;
  let b = RL_BUCKETS.get(k);
  if (!b || now > b.resetAt) { b = { n: 0, resetAt: now + 60e3 }; RL_BUCKETS.set(k, b); }
  b.n++;
  return b.n > max;
}
// varredura periódica para o Map não crescer sem limite
const rlSweep = setInterval(() => {
  const now = Date.now();
  RL_BUCKETS.forEach((b, k) => { if (now > b.resetAt) RL_BUCKETS.delete(k); });
}, 120e3);
if (rlSweep.unref) rlSweep.unref();

// ── Item 181: contrato unificado de erro da API ──────────��──────────────────
// Todas as rotas de Gestão devem responder erros como
//   { ok:false, error, code, hint }
// onde `error` é o quê aconteceu, `code` é estável para lógica no front e
// `hint` é a orientação pt-BR do que fazer. O helper de front (lib/api) lê
// esses campos e monta a mensagem. Mantém retrocompatibilidade: quem ainda
// responde só { error } continua funcionando.
function apiError(res, status, error, code, hint) {
  return res.status(status).json({ ok: false, error, code: code || undefined, hint: hint || undefined });
}

// Reconstrói o objeto de sinais do browser a partir do lead persistido pelo
// /api/cloakcheck, para alimentar botFilter.judge() no /go/ e no /c/ sem repetir
// o mapeamento em dois lugares. Inclui os sinais 2026 (webview, coerência, entropia).
function buildCloakChallengeData(lead0) {
  const l = lead0 || {};
  const num = (v) => (typeof v === 'number' ? v : NaN);
  return {
    webgl: l.cloakWebgl || '', tz: l.cloakTz || '', fp: l.cloakFp || '',
    dt: num(l.cloakDt), beh: num(l.cloakBeh),
    wv: l.cloakWv || '', hasChrome: num(l.cloakHasChrome),
    plat: l.cloakPlat || '', dm: num(l.cloakDm), hc: num(l.cloakHc),
    lang: l.cloakLang || '', tp: num(l.cloakTp),
    sw: num(l.cloakSw), sh: num(l.cloakSh),
    ent: num(l.cloakEnt), nt: num(l.cloakNt)
  };
}

app.get('/t.js', (req, res) => {
  res.set({
    'Content-Type': 'application/javascript; charset=utf-8',
    'Cache-Control': 'no-store',   // sem cache: cada request tem o token único do visitante
    'Access-Control-Allow-Origin': '*'
  });
  // Emite um challenge token personalizado por visitante e injeta o snippet
  // de verificação no tracker — quando o browser executa e devolve o token
  // ao /api/cloakcheck, confirma que há JS real rodando (não headless).
  const vid = readCookie(req, 'v_id') || '';
  const challengeToken = vid ? botFilter.issueChallengeToken(vid) : '';
  const snippet = vid ? botFilter.challengeSnippet(vid, challengeToken) : '';
  res.send(TRACKER_JS + (snippet ? '\n' + snippet : ''));
});

// Item 209: telemetria mínima do challenge JS — se NENHUM beacon chega, o
// snippet /t.js não está instalado nas páginas e as camadas D–H ficam inertes.
const _challengeBeacon = { count: 0, lastAt: 0 };

// Recebe a resposta do JS challenge enviada pelo snippet do /t.js.
// Valida o token HMAC e persiste todos os sinais do browser (WebGL renderer,
// timezone IANA, biometria comportamental, canvas hash, timing) no lead,
// para que o judge() na próxima visita ao /go/:slug use os dados enriquecidos.
app.post('/api/cloakcheck', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const b   = req.body || {};
  const vid = typeof b.vid === 'string' ? b.vid.slice(0, 60) : '';
  const tok = typeof b.tok === 'string' ? b.tok.slice(0, 80) : '';
  if (!vid || !tok) return res.status(204).end();

  const cv = botFilter.verifyChallengeToken(vid, tok);

  // Persiste sinais do browser — mesmo em falha guarda o que veio
  // (ex.: webgl SwiftShader com token expirado ainda é útil no /go/)
  const patch = {
    cloakChallenge:   cv.ok ? 'ok' : 'fail',
    cloakChallengeAt: new Date().toISOString()
  };
  if (typeof b.webgl === 'string' && b.webgl) patch.cloakWebgl = b.webgl.slice(0, 80);
  if (typeof b.tz    === 'string' && b.tz)    patch.cloakTz    = b.tz.slice(0, 60);
  if (typeof b.fp    === 'string' && b.fp)    patch.cloakFp    = b.fp.slice(0, 24);
  if (typeof b.dt    === 'number')             patch.cloakDt    = b.dt;
  if (typeof b.beh   === 'number')             patch.cloakBeh   = b.beh;
  // Novos sinais 2026: integridade de webview, coerência de ambiente, entropia
  if (typeof b.wv    === 'string')             patch.cloakWv    = b.wv.slice(0, 12);
  if (typeof b.hasChrome === 'number')         patch.cloakHasChrome = b.hasChrome;
  if (typeof b.plat  === 'string' && b.plat)   patch.cloakPlat  = b.plat.slice(0, 20);
  if (typeof b.dm    === 'number')             patch.cloakDm    = b.dm;
  if (typeof b.hc    === 'number')             patch.cloakHc    = b.hc;
  if (typeof b.lang  === 'string' && b.lang)   patch.cloakLang  = b.lang.slice(0, 10);
  if (typeof b.tp    === 'number')             patch.cloakTp    = b.tp;
  if (typeof b.sw    === 'number')             patch.cloakSw    = b.sw;
  if (typeof b.sh    === 'number')             patch.cloakSh    = b.sh;
  if (typeof b.ent   === 'number')             patch.cloakEnt   = b.ent;
  if (typeof b.nt    === 'number')             patch.cloakNt    = b.nt;

  try { stats.attachTracking(vid, patch); } catch (_) {}

  // Item 209: marca que o snippet /t.js ESTÁ instalado e devolvendo o challenge.
  // Sem nenhum beacon, as camadas D–H (WebGL, timezone, comportamento, entropia)
  // ficam inertes — o /api/cloak/stats usa isso para avisar o usuário.
  _challengeBeacon.count++;
  _challengeBeacon.lastAt = Date.now();

  // Beacon revelou headless (WebGL de software) mesmo tendo passado a 1ª visita
  // só por headers → grava veredito sticky de bot para a PRÓXIMA visita ir à
  // white sem depender do judge. Fecha a janela do "primeiro acesso limpo".
  if (typeof b.webgl === 'string' && /SwiftShader|llvmpipe|Mesa|VMware|VirtualBox/i.test(b.webgl)) {
    redis.setStickyBot(vid, { at: Date.now(), score: 100, sig: ['webgl:software-renderer'] }).catch(() => {});
  }
  // UA declara webview in-app da TikTok mas o browser NÃO expõe nenhum global de
  // webview (iw/aw/jb) → UA falsificada por revisor num Chrome comum. Sticky bot.
  if (uaTools.isInAppTikTok(String(req.headers['user-agent'] || '')) && typeof b.wv === 'string' && !b.wv) {
    redis.setStickyBot(vid, { at: Date.now(), score: 100, sig: ['webview:ua-spoof'] }).catch(() => {});
  }
  res.status(204).end();
});

// Fallback SEM JavaScript: <noscript><img src="https://DOMINIO/px.gif"></noscript>
// Leads com JS bloqueado/quebrado deixam de ser invisíveis: o pixel de imagem
// registra a visita com um id derivado de IP+UA+dia (estável no dia, sem cookie).
const PX_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
app.get('/px.gif', (req, res) => {
  res.set({
    'Content-Type': 'image/gif',
    'Cache-Control': 'no-store, no-cache, must-revalidate', // cada view conta
    'Access-Control-Allow-Origin': '*'
  });
  res.end(PX_GIF);                                 // responde já; processa depois
  try {
    if (rateLimited(clientIp(req), 'pxgif', 30)) return;
    const uaRaw = String(req.headers['user-agent'] || '');
    if (uaTools.isBot(uaRaw)) return;
    // vid explícito (?vid=) ou fingerprint diário de IP+UA (prefixo nojs)
    let vid = VID_RE.test(String(req.query.vid || '')) ? String(req.query.vid) : null;
    if (!vid) {
      const day = new Date().toISOString().slice(0, 10);
      vid = 'ld_nojs' + crypto.createHash('sha256')
        .update(clientIp(req) + '|' + uaRaw + '|' + day).digest('hex').slice(0, 16);
    }
    const geo = geoFromReq(req);
    const dev = uaTools.parse(uaRaw);
    const acc = publicAccountId(req);
    const ref = typeof req.headers.referer === 'string' ? req.headers.referer.slice(0, 300) : null;
    let landing = 'externa (sem JS)';
    try { if (ref) landing = new URL(ref).pathname.slice(0, 200); } catch (_) {}
    stats.recordVisit({
      id: vid, acc, ip: clientIp(req), ua: uaRaw.slice(0, 300),
      device: dev.device, os: dev.os, browser: dev.browser,
      referer: ref, landing,
      country: geo.country, countryName: geo.countryName, city: geo.city
    });
    // ViewContent com o mesmo esquema de dedup por hora
    const evId = 'ViewContent.' + vid + '.' + hourKey();
    seenPixelEvent(evId).then((seen) => {
      if (seen) return;
      ttEvents.dispatchToAll('ViewContent', {
        eventId: evId, leadId: vid, ip: clientIp(req),
        userAgent: uaRaw.slice(0, 500), url: ref || undefined
      }, landing, acc).catch((err) =>
        console.error('[server] ViewContent (pixel img) dispatch falhou:', err && err.message, '| vid=', vid, '| acc=', acc));
    }).catch((err) =>
      console.error('[server] ViewContent seenPixelEvent falhou:', err && err.message, '| vid=', vid));
  } catch (err) { console.error('[server] ViewContent (pixel img) erro inesperado:', err && err.message); }
});

// Endpoint público chamado pelo snippet (sendBeacon/fetch, sem cookies).
// A identidade vem do vid explícito — validado com regex estrita.
// ── Item 561: erros de front visíveis no backend ────────────────────────────
// window.onerror/unhandledrejection do dashboard reportam para cá (sendBeacon).
// Sem isso, erro client-side é invisível para o operador. Log estruturado no
// stdout (aparece no log da plataforma) + buffer dos últimos 50 em memória.
const _clientErrors = [];
app.post('/api/client-error', (req, res) => {
  res.json({ ok: true }); // responde já; nunca bloqueia o navegador
  try {
    if (rateLimited(clientIp(req), 'clienterr', 10)) return; // anti-flood
    const b = req.body || {};
    const entry = {
      at: new Date().toISOString(),
      message: String(b.message || '').slice(0, 300),
      stack: String(b.stack || '').slice(0, 800),
      url: String(b.url || '').slice(0, 200),
      ua: String(req.headers['user-agent'] || '').slice(0, 160)
    };
    if (!entry.message) return;
    _clientErrors.push(entry);
    if (_clientErrors.length > 50) _clientErrors.shift();
    console.error('[client-error]', entry.message, '|', entry.url, '|', entry.stack.split('\n')[0] || '');
  } catch (_) { /* melhor-esforço */ }
});
// Leitura pelo painel (admin logado) — últimos erros para diagnóstico rápido.
app.get('/api/client-error', dashboardAuth, (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ errors: _clientErrors.slice().reverse() });
});

app.post('/api/track', async (req, res) => {
  res.json({ ok: true });                          // responde já; processa depois
  try {
    const b = req.body || {};
    const vid = VID_RE.test(String(b.vid || '')) ? String(b.vid) : null;
    if (!vid) return;
    if (rateLimited(clientIp(req), 'track', 120)) return; // bot martelando: ignora
    checkDailyReport();                            // carona no tráfego (sem cron)
    checkEventArchive();                            // item 448: arquiva eventos antigos (máx 1x/h)
    checkSalesWatchdog();                           // item 464: alerta de zero vendas (máx 1x/h)
    checkLgpdSweep();                               // item 324/425: anonimização LGPD (máx 1x/h)
    const uaRaw = String(req.headers['user-agent'] || '');
    if (uaTools.isBot(uaRaw)) return;              // bots não viram lead nem CAPI

    // Clique em elemento marcado (data-track="nome"): só um passo na jornada
    if (typeof b.click === 'string' && b.click) {
      stats.recordClickStep(vid, b.click);
      return;
    }

    // Advanced Matching do snippet: email/telefone digitados em formulários
    // da página externa. Valida no servidor e amarra ao lead — email+phone
    // são os sinais de identidade que mais sobem a saúde dos disparos.
    if ((typeof b.email === 'string' && b.email) || (typeof b.phone === 'string' && b.phone)) {
      const em = typeof b.email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(b.email.trim())
        ? b.email.trim().toLowerCase().slice(0, 320) : undefined;
      const phDigits = typeof b.phone === 'string' ? b.phone.replace(/\D/g, '') : '';
      const ph = phDigits.length >= 8 && phDigits.length <= 15 ? String(b.phone).trim().slice(0, 30) : undefined;
      if (em || ph) { try { stats.attachTracking(vid, { email: em, phone: ph }); } catch (_) {} }
      return;                                      // payload só de identidade: não conta page view
    }

    const geo = geoFromReq(req);
    const dev = uaTools.parse(uaRaw);
    const acc = publicAccountId(req);
    const utm = (b.utm && typeof b.utm === 'object') ? b.utm : {};
    const pageUrl = typeof b.url === 'string' ? b.url.slice(0, 500) : null;
    let landing = pageUrl, site = null;
    try {
      const u = new URL(pageUrl);
      landing = u.pathname.slice(0, 200);
      site = u.hostname.slice(0, 100);             // separa funis/produtos por domínio
    } catch (_) {}

    // lead já existia? (evita "novo lead" duplicado a cada page view)
    let existed = false;
    try { existed = !!stats.getLead(vid); } catch (_) {}

    // registra/enriquece o lead no funil (mesma trilha do middleware interno)
    stats.recordVisit({
      id: vid,
      acc,
      ip: clientIp(req),
      ua: uaRaw.slice(0, 300),
      device: dev.device, os: dev.os, browser: dev.browser,
      referer: typeof b.referrer === 'string' ? b.referrer.slice(0, 300) : null,
      landing: landing || 'externa',
      site,
      country: geo.country, countryName: geo.countryName, city: geo.city,
      ttclid: typeof b.ttclid === 'string' ? b.ttclid.slice(0, 500) : null,
      utm: buildUtm(utm)
    });
    // _ttp do pixel TikTok da página externa — sobe o Event Match Quality
    if (typeof b.ttp === 'string' && b.ttp) {
      try { stats.attachTracking(vid, { ttp: b.ttp.slice(0, 500) }); } catch (_) {}
    }
    if (!existed) {
      stats.logEvent('visit', {
        acc,
        title: 'Novo lead em página externa',
        landing: landing || 'externa',
        country: geo.countryName || geo.country || null,
        ref: vid
      });
    }

    // ViewContent server-side com dedup por hora (mesmo esquema do interno)
    const evId = 'ViewContent.' + vid + '.' + hourKey();
    if (!(await seenPixelEvent(evId))) {
      let lead = null;
      try { lead = stats.getLead(vid); } catch (_) {}
      ttEvents.dispatchToAll('ViewContent', {
        eventId: evId,
        leadId: vid,
        ip: clientIp(req),
        userAgent: uaRaw.slice(0, 500),
        ttclid: (typeof b.ttclid === 'string' && b.ttclid) || (lead && lead.ttclid) || null,
        ttp: (typeof b.ttp === 'string' && b.ttp) || (lead && lead.ttp) || null,
        email: (lead && lead.email) || undefined,
        phone: (lead && lead.phone) || undefined,
        url: pageUrl
      }, landing || 'externa', acc).catch(() => {});
    }
  } catch (_) { /* rastreamento nunca derruba o servidor */ }
});

// Item 484: liveness probe do Railway — sem auth, sem I/O, resposta mínima.
// Só confirma que o PROCESSO está de pé e respondendo. O health rico (com
// estado de Neon/Redis) continua em /api/health, autenticado. Separar evita
// que uma dependência lenta derrube o container por "unhealthy".
app.get('/healthz', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.status(200).type('text/plain').send('ok');
});

// ── Página neutra de segurança (/_safe) ──────────────────────────────
// Fallback FINAL do cloaker: quando um bot/revisor é detectado e o link não
// tem white page própria nem white page global configurada, ele cai AQUI —
// nunca na offer. Conteúdo institucional inofensivo, sem redirect nem oferta,
// para que a revisão do anúncio veja uma página legítima e neutra.
// Regra: HTML por concatenação, sem crase nem ${} (convenção do projeto).
app.get('/_safe', (req, res) => {
  res.set('Cache-Control', 'no-store');
  var html =
    '<!doctype html><html lang="pt"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex,nofollow">' +
    '<title>Informacoes</title>' +
    '<style>body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;' +
    'background:#f5f6f8;color:#1a1a2e;line-height:1.6}' +
    '.wrap{max-width:680px;margin:0 auto;padding:48px 24px}' +
    'h1{font-size:26px;margin:0 0 12px}h2{font-size:18px;margin:28px 0 8px}' +
    'p{margin:0 0 14px;color:#3a3a4a}footer{margin-top:40px;font-size:13px;color:#8a8a9a}' +
    'a{color:#2b59ff;text-decoration:none}</style></head><body><div class="wrap">' +
    '<h1>Central de Informacoes</h1>' +
    '<p>Bem-vindo. Esta pagina reune informacoes gerais sobre os nossos servicos, ' +
    'politicas de utilizacao e formas de contacto.</p>' +
    '<h2>Sobre</h2>' +
    '<p>Trabalhamos para oferecer uma experiencia clara, segura e transparente. ' +
    'O conteudo desta area e meramente informativo.</p>' +
    '<h2>Privacidade</h2>' +
    '<p>Respeitamos a sua privacidade e tratamos os dados de acordo com a ' +
    'legislacao aplicavel. Nao recolhemos informacoes sem consentimento.</p>' +
    '<h2>Contacto</h2>' +
    '<p>Para questoes ou esclarecimentos, utilize os canais de apoio habituais.</p>' +
    '<footer>&copy; ' + new Date().getFullYear() + ' &middot; Todos os direitos reservados.</footer>' +
    '</div></body></html>';
  res.status(200).send(html);
});

// Itens 500/501: página de erro amigável para links públicos inexistentes ou
// desativados. Um 404 de texto cru numa campanha paga = abandono garantido.
// HTML por concatenação, sem crase (convenção das views públicas).
function linkErrorPage(res, status) {
  res.set('Cache-Control', 'no-store');
  var html =
    '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex,nofollow">' +
    '<title>Link indisponivel</title>' +
    '<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;' +
    'padding:24px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;' +
    'background:radial-gradient(1000px 500px at 50% -10%,#0b1220 0,#04050a 60%);color:#f8fafc;line-height:1.6}' +
    '.box{max-width:420px;text-align:center}' +
    '.icon{width:56px;height:56px;margin:0 auto 20px;border-radius:14px;display:flex;align-items:center;' +
    'justify-content:center;background:rgba(148,163,184,.1);border:1px solid #1e2438;font-size:28px}' +
    'h1{font-size:22px;margin:0 0 10px;font-weight:700}' +
    'p{margin:0;color:#94a3b8;font-size:15px}</style></head><body><div class="box">' +
    '<div class="icon" aria-hidden="true">&#128279;</div>' +
    '<h1>Este link nao esta disponivel</h1>' +
    '<p>O endereco pode ter expirado, sido desativado ou digitado incorretamente. ' +
    'Se voce chegou por um anuncio, tente novamente mais tarde.</p>' +
    '</div></body></html>';
  res.status(status || 404).send(html);
}

// ── Links de Checkout externos (/go/:slug) ───────────────────────────
// O checkout NÃO vive neste projeto: cada link aponta para URLs externas
// do usuário (qualquer gateway). Este redirect é o ponto de rastreamento:
// registra o clique, dispara InitiateCheckout na CAPI e repassa o leadId
// para o checkout externo — a conversão volta pelo webhook universal.
app.get('/go/:slug', async (req, res) => {
  // resolve por conta: domínio personalizado → conta dona; senão 1º match
  const link = linkStore.resolve(req.params.slug, publicAccountId(req));
  if (!link || !link.ativo || link.arquivado || !link.variantes.length) {
    return linkErrorPage(res, 404); // itens 500/501: página amigável; 531: arquivado = indisponível
  }
  const acc = link.acc || publicAccountId(req); // conta dona do link
  const q = req.query || {};

  const uaRaw = String(req.headers['user-agent'] || '');

  // ── Filtro multicamadas: bot / revisor de anúncio TikTok ──────────────
  // Config vem da aba "Filtro de Bots" da dashboard (config.get().cloak).
  // Primeiro: UAs de crawlers conhecidos — resposta imediata sem custo.
  // Segundo: motor de score assíncrono (ASN + headers + JS challenge).
  // Se urlWhitePage estiver configurada, revisores vão pra ela.
  // Se não houver white page, revisores são redirecionados para a variante
  // normal (comportamento anterior — não bloqueia o anúncio de ser aprovado).
  const cloakCfg  = config.get(acc).cloak || {};
  // FAIL-SAFE: white page sempre existe. Preferência: white do próprio link →
  // white global da conta → página neutra embutida /_safe. Assim NENHUM bot
  // chega à offer, mesmo em links sem white configurada.
  const safePage = link.urlWhitePage || cloakCfg.defaultWhitePage || '/_safe';

  // Interruptor mestre da conta liga/desliga o cloaking. Como há sempre um
  // destino seguro (safePage), não dependemos mais de white page por link.
  const cloakOn = cloakCfg.enabled !== false;

  // Registra a decisão (offer/white + motivo) nos contadores do painel.
  const bumpDecision = (decision, reason) => {
    try { redis.bumpCloakDecision(acc, link.slug, decision, reason); } catch (_) {}
  };

  if (uaTools.isBot(uaRaw)) {
    // Crawlers / preview de apps: vão para a página segura (nunca à offer).
    stats.logEvent('info', {
      acc,
      title: '[cloak] bot UA → ' + (cloakOn ? 'white' : 'offer'),
      gateway: 'link:' + link.slug,
      ref: String(uaRaw).slice(0, 80)
    });
    if (cloakOn) { bumpDecision('white', 'bot-ua'); return res.redirect(302, safePage); }
    bumpDecision('offer', null);
    return res.redirect(302, link.variantes[0].url);
  }

  // Rajada do mesmo IP+UA (spy tool / clique inflado). A chave inclui o UA
  // para não punir usuários reais atrás de CGNAT (operadoras móveis põem
  // milhares de pessoas no mesmo IP — tráfego TikTok é quase todo mobile).
  if (rateLimited(clientIp(req) + '|' + uaRaw.slice(0, 60), 'go', 30)) {
    if (cloakOn) { bumpDecision('white', 'rate-limit'); return res.redirect(302, safePage); }
    // Fallback SEM contar clique, mas preservando atribuição e dispositivo:
    // respeita urlMobile, repassa a query original (UTMs/ttclid) e, se o
    // visitante já tem cookie v_id, anexa o lead_id para o checkout conciliar.
    const v0 = link.variantes[0];
    const rlDev = uaTools.parse(uaRaw);
    const rlBase = (rlDev.device !== 'desktop' && v0.urlMobile) ? v0.urlMobile : v0.url;
    const rlParams = new URLSearchParams(req.originalUrl.includes('?') ? req.originalUrl.split('?')[1] : '');
    const rlVid = (q.vid && VID_RE.test(String(q.vid))) ? String(q.vid) : readCookie(req, 'v_id');
    if (rlVid) { rlParams.set('lead_id', rlVid); rlParams.set('client_reference_id', rlVid); }
    const rlQs = rlParams.toString();
    return res.redirect(302, rlBase + (rlQs ? (rlBase.includes('?') ? '&' : '?') + rlQs : ''));
  }

  // ── Gate geográfico (allowlist por país) — INSTANTÂNEO, sem DNS ────────
  // País vem dos headers da edge (Vercel/Cloudflare), então essa checagem é
  // ~0ms e roda ANTES do motor de score. Se o link tem allowlist e o visitante
  // está fora dela, vai direto para a white page — sem custo de análise.
  if (cloakOn && Array.isArray(link.paises) && link.paises.length) {
    const cc = String(geoFromReq(req).country || '').toUpperCase();
    if (!cc || link.paises.indexOf(cc) < 0) {
      stats.logEvent('info', {
        acc,
        title: '[cloak] país ' + (cc || '??') + ' fora da allowlist → white',
        gateway: 'link:' + link.slug,
        ref: clientIp(req)
      });
      bumpDecision('white', 'pais');
      return res.redirect(302, safePage);
    }
  }

  // ── Gate de idioma (allowlist) — INSTANTÂNEO, via Accept-Language ───────
  // Lê o idioma primário do navegador (ex.: "pt-BR,pt;q=0.9" → "pt"). Se o
  // link tem allowlist de idiomas e o visitante está fora dela, vai direto
  // para a white page — mesmo tratamento do gate de país, sem custo de DNS.
  if (cloakOn && Array.isArray(link.idiomas) && link.idiomas.length) {
    const primaryLang = String(req.headers['accept-language'] || '')
      .split(',')[0].split('-')[0].trim().toLowerCase();
    if (!primaryLang || link.idiomas.indexOf(primaryLang) < 0) {
      stats.logEvent('info', {
        acc,
        title: '[cloak] idioma ' + (primaryLang || '??') + ' fora da allowlist → white',
        gateway: 'link:' + link.slug,
        ref: clientIp(req)
      });
      bumpDecision('white', 'idioma');
      return res.redirect(302, safePage);
    }
  }

  // v_id do visitante (para veredito sticky). Lido uma vez e reusado.
  const cloakVid = readCookie(req, 'v_id') || '';

  // ── Veredito STICKY (só bot) ──────────────────────────────────────────────
  // Se este visitante JÁ foi condenado numa visita anterior (sinais fortes:
  // WebGL software, ASN datacenter…), vai direto à white sem re-rodar o judge.
  // Consistência: o mesmo revisor nunca vê ora offer, ora white. Nunca cacheamos
  // 'real', então um bot jamais fica preso como usuário real (fail-safe).
  if (cloakOn && cloakVid) {
    const sticky = await redis.getStickyBot(cloakVid).catch(() => null);
    if (sticky) {
      bumpDecision('white', 'sticky');
      return res.redirect(302, safePage);
    }
  }

  // Motor de score só roda com cloaking ativo — economiza o DNS lookup de ASN
  let judgment = { verdict: 'real', score: 0, signals: [] };
  if (cloakOn) {
    // Recupera sinais do browser já coletados pelo /api/cloakcheck (challenge JS).
    // Esses sinais — WebGL renderer, timezone, biometria, timing — enriquecem
    // o judge() e aumentam a precisão sem adicionar latência no /go/.
    const filterVid = readCookie(req, 'v_id') || '';
    const lead0     = (() => { try { return stats.getLead(filterVid) || {}; } catch (_) { return {}; } })();

    // Reconstrói o token de challenge a partir do estado persistido do lead:
    // 'ok' → reemite token válido (confirma ao judge que browser passou); 'fail' → string
    // vazia (penaliza); null/undefined → primeiro acesso, sem token ainda.
    const challengeToken = lead0.cloakChallenge === 'ok'
      ? botFilter.issueChallengeToken(filterVid)
      : (lead0.cloakChallenge === 'fail' ? '' : null);

    // Monta o objeto challengeData com todos os sinais do browser persistidos
    const challengeData = buildCloakChallengeData(lead0);

    const filterReq = Object.assign(Object.create(req), { geoCountry: geoFromReq(req).country || '' });
    judgment = await botFilter
      .judge(filterReq, filterVid, challengeToken, challengeData, cloakCfg)
      .catch(() => ({ verdict: 'real', score: 0, signals: [] }));
  }

  // Loga o julgamento para análise na dashboard (aba Atividade)
  if (judgment.verdict === 'bot') {
    stats.logEvent('info', {
      acc,
      title: '[cloak] score=' + judgment.score + ' → white | ' + judgment.signals.slice(0, 4).join(', '),
      gateway: 'link:' + link.slug,
      ref: clientIp(req)
    });
    // FAIL-SAFE: bot detectado SEMPRE vai para a página segura, nunca à offer.
    bumpDecision('white', 'score');
    // Memoriza o veredito por visitante: próximas visitas curto-circuitam sem
    // re-rodar o judge (mais barato) e sem oscilar. Só para score alto/forte.
    if (cloakVid && judgment.score >= (judgment.threshold || 40)) {
      redis.setStickyBot(cloakVid, { at: Date.now(), score: judgment.score, sig: (judgment.signals || []).slice(0, 3) }).catch(() => {});
    }
    return res.redirect(302, safePage);
  }

  // Passou por todos os gates → usuário real seguindo para a offer.
  if (cloakOn) bumpDecision('offer', null);

  // Costura de identidade: se veio de página externa com snippet /t.js,
  // o link chega decorado com ?vid=ld_… — usa ESSE id (o mesmo lead que
  // viu a página) e grava no cookie para unificar dali em diante.
  let visitorId;
  if (q.vid && VID_RE.test(String(q.vid))) {
    visitorId = String(q.vid);
    if (readCookie(req, 'v_id') !== visitorId) {
      appendCookie(res, `v_id=${visitorId};Path=/;Max-Age=7776000;SameSite=Lax`);
    }
  } else {
    visitorId = getOrAssignVisitor(req, res);
  }

  // Variante sticky por cookie (respeita pesos na primeira atribuição)
  const cookieName = 'ab_' + link.slug;
  let variant = link.variantes.find((v) => v.id === readCookie(req, cookieName));
  if (!variant) {
    variant = linkStore.pickVariant(link, visitorId);
    appendCookie(res, `${cookieName}=${variant.id};Path=/;Max-Age=2592000;SameSite=Lax`);
  }

  linkStore.recordClick(acc, link.slug, variant.id);

  const geo = geoFromReq(req);
  const dev = uaTools.parse(uaRaw);
  // Funil: lead entrou num checkout (gateway = slug do link)
  stats.recordCheckoutEntry(visitorId, 'link:' + link.slug, {
    acc,
    ip: clientIp(req),
    ua: uaRaw.slice(0, 300),
    device: dev.device, os: dev.os, browser: dev.browser,
    referer: req.headers['referer'] || null,
    country: geo.country, countryName: geo.countryName, city: geo.city,
    ttclid: q.ttclid || null,
    utm: buildUtm({
      source: q.utm_source, medium: q.utm_medium,
      campaign: q.utm_campaign, content: q.utm_content, term: q.utm_term
    })
  });
  // guarda o link/variante no lead — atribuição da conversão no webhook universal
  try { stats.attachTracking(visitorId, { acc, linkSlug: link.slug, linkVariant: variant.id }); } catch (_) {}

  // TikTok CAPI: InitiateCheckout server-side (checkout externo não tem pixel nosso).
  // Este disparo acontece DEPOIS dos gates de bot/país, então só pessoas reais
  // que seguem para a offer geram evento — o pixel fica sincronizado com o filtro.
  try {
    const lead = stats.getLead(visitorId) || {};
    const evId = 'InitiateCheckout.' + visitorId + '.' + hourKey();
    if (!(await seenPixelEvent(evId))) {
      const payload = {
        eventId: evId,
        leadId: visitorId,
        email: lead.email || undefined,
        phone: lead.phone || undefined,
        ip: clientIp(req),
        userAgent: uaRaw.slice(0, 500),
        ttclid: q.ttclid || lead.ttclid || null,
        ttp: lead.ttp || null,
        url: fullUrl(req)
      };
      // "Pixel do link vence": se o link tem um pixel escolhido e ele está
      // ativo, dispara só nele; senão cai no comportamento por rota (todos os
      // pixels que casam /go/<slug>).
      const linkPixel = link.pixelSlug ? pixelStore.get(acc, link.pixelSlug) : null;
      if (linkPixel && linkPixel.active && linkPixel.pixelCode && linkPixel.events && linkPixel.events.InitiateCheckout !== false) {
        ttEvents.sendToPixel(linkPixel, Object.assign({ event: 'InitiateCheckout' }, payload)).catch(() => {});
      } else {
        ttEvents.dispatchToAll('InitiateCheckout', payload, '/go/' + link.slug, acc).catch(() => {});
      }
    }
  } catch (_) { /* rastreamento nunca bloqueia o redirect */ }

  stats.logEvent('lead', {
    acc,
    title: 'Clique no link de checkout "' + link.nome + '"',
    gateway: 'link:' + link.slug,
    variant: variant.nome,
    country: geo.countryName || geo.country || null,
    ref: visitorId
  });

  // Repassa query original + injeta identificadores de conciliação
  const params = new URLSearchParams(req.originalUrl.includes('?') ? req.originalUrl.split('?')[1] : '');
  params.set('lead_id', visitorId);
  params.set('client_reference_id', visitorId);
  // Atribuição por parâmetro ecoado: Kiwify/PerfectPay e afins NÃO devolvem
  // lead_id/client_reference_id no webhook — devolvem src/sck/s1 (o vid ecoado).
  // Injeta o vid nesses campos SÓ quando o lojista não os definiu, preservando
  // a atribuição manual existente. Ver tabela de gateways no CLAUDE.md.
  ['src', 'sck', 's1'].forEach((k) => { if (!params.get(k)) params.set(k, visitorId); });
  // Filtro por dispositivo: celular/tablet vai para urlMobile (se definida),
  // computador vai para a URL principal da variante
  const baseUrl = (dev.device !== 'desktop' && variant.urlMobile) ? variant.urlMobile : variant.url;
  const dest = baseUrl + (baseUrl.includes('?') ? '&' : '?') + params.toString();
  return res.redirect(302, dest);
});

// ── Links de cloaking (/c/:slug) ───────────────────────────────��─────
// Roteia pessoas reais → offer; bots/revisores → white page. Usa a config
// de proteção DO PRÓPRIO link (não a global): cada link tem seu interruptor,
// sensibilidade e camadas de detecção.
function resolveCloakEntry(req) {
  const slug = _ckSlugify(req.params.slug);
  if (!slug) return null;
  const pref = publicAccountId(req);
  const tryAcc = (acc) => {
    const e = (config.get(acc).cloakLinks || []).find((l) => l.slug === slug);
    return e ? { acc, entry: e } : null;
  };
  if (pref) { const r = tryAcc(pref); if (r) return r; }
  for (const acc of config.accountIds()) { const r = tryAcc(acc); if (r) return r; }
  return null;
}

app.get('/c/:slug', async (req, res) => {
  const found = resolveCloakEntry(req);
  if (!found || !found.entry.offerUrl) return linkErrorPage(res, 404); // itens 500/501
  const { acc, entry } = found;
  const offer = entry.offerUrl;
  // FAIL-SAFE: white do próprio link → white global da conta → /_safe embutida.
  const acctCloak = config.get(acc).cloak || {};
  const white = entry.whitePageUrl || acctCloak.defaultWhitePage || '/_safe';
  const uaRaw = String(req.headers['user-agent'] || '');
  // Interruptor do link liga/desliga o cloaking; o destino seguro sempre existe.
  const cloakOn = entry.enabled !== false;

  // Registra a decisão (offer/white + motivo) nos contadores do painel e,
  // separadamente, no log das últimas N decisões (item 170) — IP mascarado,
  // sem PII. `score` é opcional (só o gate de score o conhece).
  const bumpDecision = (decision, reason, score, signals) => {
    try { redis.bumpCloakDecision(acc, 'cloak:' + entry.slug, decision, reason); } catch (_) {}
    try {
      redis.pushCloakDecision(acc, 'cloak:' + entry.slug, {
        decision, reason, score,
        signals, // Item 212: top sinais do judge nesta decisão (para calibrar camadas)
        ip: clientIp(req),
        ua: uaRaw,
        country: (geoFromReq(req).country || ''),
      });
    } catch (_) {}
  };

  // preserva a query original (UTMs/ttclid) no destino final
  const go = (url) => {
    const qs = req.originalUrl.includes('?') ? req.originalUrl.split('?')[1] : '';
    return res.redirect(302, url + (qs ? (url.includes('?') ? '&' : '?') + qs : ''));
  };
  // Igual ao go(), mas garante o vid na query do destino. O tracker (/t.js) dá
  // preferência ao ?vid= da URL, então a página de destino (offer) amarra os
  // sinais do browser a ESTE visitante mesmo em outro domínio (cookie não cruza).
  const goWithVid = (url, vid) => {
    const params = new URLSearchParams(req.originalUrl.includes('?') ? req.originalUrl.split('?')[1] : '');
    if (vid && !params.get('vid')) params.set('vid', vid);
    const qs = params.toString();
    return res.redirect(302, url + (qs ? (url.includes('?') ? '&' : '?') + qs : ''));
  };

  // Crawler conhecido → página segura (nunca à offer)
  if (uaTools.isBot(uaRaw)) {
    stats.logEvent('info', { acc, title: '[cloak] bot UA → ' + (cloakOn ? 'white' : 'offer'), gateway: 'cloak:' + entry.slug, ref: String(uaRaw).slice(0, 80) });
    if (cloakOn) { bumpDecision('white', 'bot-ua'); return go(white); }
    bumpDecision('offer', null);
    return go(offer);
  }

  // ── Sinais de dispositivo e de ORIGEM do clique (calculados uma vez) ��─────
  const dev = uaTools.parse(uaRaw);
  const isMobile = dev.device === 'mobile' || dev.device === 'tablet';
  const q = req.query || {};
  const ref = String(req.headers['referer'] || req.headers['referrer'] || '');
  const ttclidRaw = typeof q.ttclid === 'string' ? q.ttclid.trim() : '';
  // ttclid REAL do TikTok é uma string longa (base64-like). Um "?ttclid=abc"
  // colado à mão não passa: exigimos comprimento e charset plausíveis.
  const validTtclid = /^[A-Za-z0-9._-]{20,}$/.test(ttclidRaw);
  const isWebview = uaTools.isInAppTikTok(uaRaw);
  // Prova de que o acesso veio de um anúncio REAL do TikTok:
  //  a) webview interno do app (musical_ly/BytedanceWebview…), OU
  //  b) ttclid VÁLIDO na URL (o TikTok anexa no clique do anúncio), OU
  //  c) referrer de domínio do TikTok.
  // Copiar/colar o link num navegador comum não tem NENHUM desses → white.
  const fromTikTok = isWebview || /tiktok|ttwebview|musical_ly|bytedance|tiktokcdn/i.test(ref);
  // Modo AGRESSIVO (sensibilidade strict): exige WEBVIEW real do app — ttclid
  // sozinho não basta (revisor cola o link no Chrome com o ttclid capturado).
  const aggressive = entry.sensitivity === 'strict';
  const adClickOk = aggressive ? isWebview : (fromTikTok || validTtclid);

  // ── Identidade do visitante (habilita sticky + atribuição no destino) ──────
  // O /c não assinava cookie; sem um id estável, o veredito sticky e os sinais
  // 2026 coletados na página de destino (via /t.js → /api/cloakcheck) não podiam
  // ser amarrados a este visitante. Costura: usa ?vid válido (encurtador/clique)
  // ou gera um novo, gravando o cookie ANTES do redirect.
  let cloakVid = readCookie(req, 'v_id') || '';
  if (q.vid && VID_RE.test(String(q.vid))) {
    cloakVid = String(q.vid);
    if (readCookie(req, 'v_id') !== cloakVid) appendCookie(res, 'v_id=' + cloakVid + ';Path=/;Max-Age=7776000;SameSite=Lax');
  } else if (!cloakVid) {
    cloakVid = 'ld_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    appendCookie(res, 'v_id=' + cloakVid + ';Path=/;Max-Age=7776000;SameSite=Lax');
  }

  // ── Veredito STICKY (só bot) — mesmo comportamento do /go/ ─────────────────
  // Visitante já condenado antes (score alto OU o beacon /api/cloakcheck flagrou
  // WebGL de software / webview falsificada) vai direto à white, sem re-rodar o
  // judge e sem oscilar offer↔white. Nunca cacheamos 'real' (fail-safe).
  if (cloakOn && cloakVid) {
    const sticky = await redis.getStickyBot(cloakVid).catch(() => null);
    if (sticky) {
      stats.logEvent('info', { acc, title: '[cloak] sticky bot → white', gateway: 'cloak:' + entry.slug, ref: clientIp(req) });
      bumpDecision('white', 'sticky');
      return go(white);
    }
  }

  // Gate "apenas celular" (default LIGADO): desktop/notebook nunca vê a offer.
  if (cloakOn && entry.mobileOnly !== false && !isMobile) {
    stats.logEvent('info', { acc, title: '[cloak] ' + (dev.device || 'desktop') + ' (não-celular) → white', gateway: 'cloak:' + entry.slug, ref: dev.device || 'desktop' });
    bumpDecision('white', 'mobile');
    return go(white);
  }

  // Gate do ANÚNCIO (default LIGADO): sem prova de clique real no anúncio do
  // TikTok, vai para a white. É isto que faz "colar o link no navegador" cair
  // na white — só quem realmente clicou no anúncio (webview OU ttclid) segue.
  if (cloakOn && entry.requireAdClick !== false && !adClickOk) {
    stats.logEvent('info', { acc, title: '[cloak] ' + (aggressive ? 'sem webview do app (agressivo)' : 'sem prova de clique no anúncio') + ' → white', gateway: 'cloak:' + entry.slug, ref: (ref || 'sem-referer').slice(0, 80) });
    bumpDecision('white', 'anuncio');
    return go(white);
  }

  // Anti-replay + velocity (sempre que o cloaking está ligado). O revisor que
  // captura a URL reusa o MESMO ttclid de outra rede/dispositivo; e device farms
  // martelam o link várias vezes por minuto. Ambos caem na white. Sem Redis, o
  // redis.js usa fallback em memória (single-instance) — melhor que não barrar.
  if (cloakOn) {
    try {
      const ip = clientIp(req);
      // ASN só com Redis: evita o custo de DNS no caminho quente quando não há
      // Redis. Sem ASN, o contexto do ttclid usa só o tipo de device (ainda barra
      // reuso do mesmo ttclid entre celular/desktop).
      const asn = redis.enabled ? ((await botFilter.lookupASN(ip).catch(() => ({ asn: 0 }))).asn || 0) : 0;
      // 1) ttclid de uso único: contexto = ASN + tipo de device do 1º clique
      if (entry.requireAdClick !== false && validTtclid) {
        const ctx = asn + ':' + (isMobile ? 'm' : 'd');
        const tc = await redis.checkTtclidContext(ttclidRaw, ctx).catch(() => ({ reused: false }));
        if (tc.reused) {
          stats.logEvent('info', { acc, title: '[cloak] ttclid reusado de outro contexto → white', gateway: 'cloak:' + entry.slug, ref: ip });
          bumpDecision('white', 'ttclid-replay');
          redis.bumpTtclidReplay(acc).catch(() => {}); // Item 203: contador durável de replays barrados
          return go(white);
        }
      }
      // 2) velocity por IP: N acessos na janela ao mesmo link = automação/farm.
      // Item 254: limiar e janela configuráveis por conta (preset seguro 12/60s).
      const vcfg = config.get(acc).cloak || {};
      const vLimit = vcfg.velocityLimit || 12;
      const vWin = vcfg.velocityWindowSec || 60;
      const vip = await redis.bumpVelocity('c:' + entry.slug + ':ip', ip, vWin).catch(() => 0);
      if (vip > vLimit) {
        stats.logEvent('info', { acc, title: '[cloak] velocity IP=' + vip + '/' + vWin + 's → white', gateway: 'cloak:' + entry.slug, ref: ip });
        bumpDecision('white', 'velocity');
        return go(white);
      }
    } catch (_) { /* Redis instável nunca bloqueia o usuário legítimo */ }
  }

  // Gate geográfico (instantâneo, sem DNS)
  if (cloakOn && Array.isArray(entry.paises) && entry.paises.length) {
    const cc = String(geoFromReq(req).country || '').toUpperCase();
    if (!cc || entry.paises.indexOf(cc) < 0) {
      stats.logEvent('info', { acc, title: '[cloak] país ' + (cc || '??') + ' fora da allowlist → white', gateway: 'cloak:' + entry.slug, ref: clientIp(req) });
      bumpDecision('white', 'pais');
      return go(white);
    }
  }
  // Gate de idioma (instantâneo, via Accept-Language)
  if (cloakOn && Array.isArray(entry.idiomas) && entry.idiomas.length) {
    const lang = String(req.headers['accept-language'] || '').split(',')[0].split('-')[0].trim().toLowerCase();
    if (!lang || entry.idiomas.indexOf(lang) < 0) {
      stats.logEvent('info', { acc, title: '[cloak] idioma ' + (lang || '??') + ' fora da allowlist → white', gateway: 'cloak:' + entry.slug, ref: clientIp(req) });
      bumpDecision('white', 'idioma');
      return go(white);
    }
  }

  // Motor de score — recebe a config do PRÓPRIO link como cloakCfg
  if (cloakOn) {
    const lead0 = (() => { try { return stats.getLead(cloakVid) || {}; } catch (_) { return {}; } })();
    const challengeToken = lead0.cloakChallenge === 'ok'
      ? botFilter.issueChallengeToken(cloakVid)
      : (lead0.cloakChallenge === 'fail' ? '' : null);
    const challengeData = buildCloakChallengeData(lead0);
    const filterReq = Object.assign(Object.create(req), { geoCountry: geoFromReq(req).country || '' });
    const j = await botFilter.judge(filterReq, cloakVid, challengeToken, challengeData, entry)
      .catch(() => ({ verdict: 'real', score: 0, signals: [] }));
    if (j.verdict === 'bot') {
      stats.logEvent('info', { acc, title: '[cloak] score=' + j.score + ' → white | ' + (j.signals || []).slice(0, 4).join(', '), gateway: 'cloak:' + entry.slug, ref: clientIp(req) });
      bumpDecision('white', 'score', j.score, (j.signals || []).slice(0, 5));
      // Memoriza o veredito por visitante (só score alto/forte): próximas visitas
      // curto-circuitam no gate sticky acima, sem re-rodar o judge.
      if (cloakVid && j.score >= (j.threshold || 40)) {
        redis.setStickyBot(cloakVid, { at: Date.now(), score: j.score, sig: (j.signals || []).slice(0, 3) }).catch(() => {});
      }
      return go(white);
    }
  }
  if (cloakOn) bumpDecision('offer', null);
  // Encaminha o vid ao destino para o tracker da offer amarrar os sinais do
  // browser a ESTE visitante (habilita sticky/atribuição sem cookie de terceiros).
  return goWithVid(offer, cloakVid);
});

// ── Encurtador rastreável (/l/:slug) ─────�����������������───────────────────────────
// Substitui bit.ly nos criativos: o clique vira lead no funil (landing
// "l:slug"), o vid viaja para o destino e o funil começa no clique do
// anúncio — não na primeira página com snippet.
function bumpShortlinkClick(acc, slug) {
  // rate limit de 20/min por IP mantém o volume de escrita sob controle
  const cfg = config.get(acc);
  const sl = (cfg.shortlinks || []).map((s) => s.slug === slug ? { ...s, clicks: (s.clicks || 0) + 1 } : s);
  config.set(acc, { shortlinks: sl });
}
app.get('/l/:slug', (req, res) => {
  const slug = String(req.params.slug || '').toLowerCase();
  const acc = publicAccountId(req);
  const item = (config.get(acc).shortlinks || []).find((s) => s.slug === slug);
  if (!item) return res.status(404).send('Link não encontrado');
  const uaRaw = String(req.headers['user-agent'] || '');
  if (uaTools.isBot(uaRaw)) return res.redirect(302, item.url); // preview de app: só redireciona
  if (rateLimited(clientIp(req), 'shortlink', 20)) return res.redirect(302, item.url);

  // identidade: cookie existente ou novo vid — viaja na URL para o destino
  let vid;
  const q = req.query || {};
  if (q.vid && VID_RE.test(String(q.vid))) vid = String(q.vid);
  else vid = getOrAssignVisitor(req, res);

  try {
    const geo = geoFromReq(req);
    const dev = uaTools.parse(uaRaw);
    stats.recordVisit({
      id: vid,
      acc,
      ip: clientIp(req), ua: uaRaw.slice(0, 300),
      device: dev.device, os: dev.os, browser: dev.browser,
      referer: req.headers['referer'] || null,
      landing: 'l:' + slug,
      country: geo.country, countryName: geo.countryName, city: geo.city,
      ttclid: typeof q.ttclid === 'string' ? q.ttclid.slice(0, 500) : null,
      utm: buildUtm({
        source: q.utm_source, medium: q.utm_medium,
        campaign: q.utm_campaign, content: q.utm_content, term: q.utm_term
      })
    });
    bumpShortlinkClick(acc, slug);
  } catch (_) { /* rastreamento nunca bloqueia o redirect */ }

  // repassa a query original + injeta o vid (o t.js do destino adota)
  const params = new URLSearchParams(req.originalUrl.includes('?') ? req.originalUrl.split('?')[1] : '');
  params.set('vid', vid);
  const dest = item.url + (item.url.includes('?') ? '&' : '?') + params.toString();
  return res.redirect(302, dest);
});

// CRUD do encurtador (dashboard) — escopado à conta logada
app.get('/api/shortlinks', dashboardAuth, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ shortlinks: config.get(req.account.id).shortlinks || [] });
});
app.post('/api/shortlinks', dashboardAuth, (req, res) => {
  const b = req.body || {};
  const slug = String(b.slug || b.nome || '').toLowerCase().trim()
    .replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 60);
  const url = String(b.url || '').trim();
  if (!slug) return res.status(400).json({ error: 'slug inválido' });
  if (!/^https?:\/\/.+/i.test(url)) return res.status(400).json({ error: 'URL inválida — use http(s)://' });
  const list = (config.get(req.account.id).shortlinks || []).filter((s) => s.slug !== slug);
  list.unshift({ slug, nome: String(b.nome || slug).slice(0, 80), url: url.slice(0, 500), clicks: 0, createdAt: new Date().toISOString() });
  config.set(req.account.id, { shortlinks: list });
  res.json({ ok: true, shortlink: list[0] });
});
app.delete('/api/shortlinks/:slug', dashboardAuth, (req, res) => {
  const slug = String(req.params.slug || '').toLowerCase();
  config.set(req.account.id, { shortlinks: (config.get(req.account.id).shortlinks || []).filter((s) => s.slug !== slug) });
  res.json({ ok: true });
});

// ── Anotações do gráfico de tendência (por conta) ────────────────────
app.get('/api/notes', dashboardAuth, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ notes: config.get(req.account.id).notes || [] });
});
app.post('/api/notes', dashboardAuth, (req, res) => {
  const b = req.body || {};
  const d = String(b.d || '').slice(0, 10);
  const text = String(b.text || '').trim().slice(0, 200);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return res.status(400).json({ error: 'data inválida (YYYY-MM-DD)' });
  if (!text) return res.status(400).json({ error: 'texto vazio' });
  const notes = (config.get(req.account.id).notes || []).filter((n) => n.d !== d); // 1 nota por dia
  notes.push({ d, text });
  notes.sort((a, b2) => a.d < b2.d ? -1 : 1);
  config.set(req.account.id, { notes });
  res.json({ ok: true });
});
app.delete('/api/notes/:d', dashboardAuth, (req, res) => {
  config.set(req.account.id, { notes: (config.get(req.account.id).notes || []).filter((n) => n.d !== String(req.params.d)) });
  res.json({ ok: true });
});

// ── API pública read-only (token, por conta) ─────────────────────────
// Para planilhas (IMPORTDATA), widgets e BI externo — sem expor a dash.
// Item 418: rotação do token da API pública — revoga o atual e gera um novo.
// Quem usava a URL antiga (planilha, BI…) para de funcionar na hora; a UI
// avisa antes com confirmação. Auditado como ação sensível.
app.post('/api/public-token/rotate', dashboardAuth, (req, res) => {
  if (rateLimited('tokrot|' + req.account.id, 'tokrot', 5)) {
    return res.status(429).json({ ok: false, error: 'Muitas rotações. Aguarde um minuto.' });
  }
  const token = crypto.randomBytes(24).toString('hex');
  config.set(req.account.id, { api: { token } });
  audit(req, req.account.id, 'token_api_rotacionado', 'Token da API pública revogado e regenerado');
  res.json({ ok: true, token });
});

app.get('/api/public-token', dashboardAuth, (req, res) => {
  let cfg = config.get(req.account.id);
  let token = (cfg.api || {}).token;
  if (!token) {
    token = crypto.randomBytes(24).toString('hex');
    config.set(req.account.id, { api: { token } });
  }
  res.set('Cache-Control', 'no-store');
  res.json({ token });
});
app.get('/api/v1/summary', (req, res) => {
  res.set('Cache-Control', 'no-store');
  // token → conta dona: procura em todas as contas (token é único por conta)
  const provided = String(req.query.token || '');
  let tokenAcc = null;
  if (provided) {
    for (const accId of config.accountIds()) {
      const t = (config.get(accId).api || {}).token;
      if (t && safeEqual(provided, t)) { tokenAcc = accId; break; }
    }
  }
  if (!tokenAcc) return res.status(401).json({ error: 'token inválido' });
  if (rateLimited(clientIp(req), 'pubapi', 30)) return res.status(429).json({ error: 'rate limit' });
  const s = stats.getStats(tokenAcc);
  const now = Date.now();
  function within(iso, ms) { const t = new Date(iso).getTime(); return isFinite(t) && (now - t) <= ms; }
  function agg(ms) {
    const leads = (s.leads || []).filter((l) => !l.orphan && (ms == null || within(l.at, ms)));
    const bought = leads.filter((l) => l.stage === 'purchased');
    const rev = bought.reduce((a, l) => a + (l.reportedAmount || l.expectedAmount || 0), 0);
    return {
      leads: leads.length,
      sales: bought.length,
      revenueCents: rev,
      conversion: leads.length ? Math.round(bought.length / leads.length * 1000) / 10 : 0
    };
  }
  const out = { today: agg(24 * 3600e3), last7d: agg(7 * 86400e3), total: agg(null), ts: new Date().toISOString() };
  // Item 419: com escopo 'stats+leads' o token também recebe os últimos
  // leads — SEMPRE mascarados (nunca e-mail/telefone completos).
  if ((config.get(tokenAcc).api || {}).scope === 'stats+leads') {
    const maskEmail = (e) => {
      const s = String(e || ''); const i = s.indexOf('@');
      return i > 1 ? s[0] + '***' + s.slice(i) : (s ? s[0] + '***' : null);
    };
    out.leads = (s.leads || []).filter((l) => !l.orphan).slice(-100).reverse().map((l) => ({
      at: l.at, stage: l.stage || null, country: l.country || null,
      amountCents: l.reportedAmount || l.expectedAmount || 0,
      email: maskEmail(l.email), gateway: l.gateway || null
    }));
  }
  res.json(out);
});

// Item 419: alternar o escopo do token público (stats | stats+leads).
app.post('/api/public-token/scope', dashboardAuth, (req, res) => {
  const scope = String((req.body || {}).scope || '');
  if (!['stats', 'stats+leads'].includes(scope)) {
    return res.status(400).json({ ok: false, error: "Escopo inválido — use 'stats' ou 'stats+leads'." });
  }
  const api = Object.assign({}, config.get(req.account.id).api || {}, { scope });
  config.set(req.account.id, { api });
  audit(req, req.account.id, 'token_api_escopo', 'Escopo do token público: ' + scope);
  res.json({ ok: true, scope });
});

// ── Relatório diário via Pushcut ──────────────�������─────────────────────
// Sem cron confiável em serverless: verificação barata "pegando carona"
// no tráfego (track/conversão). Na primeira request após a virada do dia
// (UTC), envia o resumo de ONTEM — no máximo 1x, guardado na config.
let dailyCheckBusy = false;
function checkDailyReport() {
  if (dailyCheckBusy) return;
  dailyCheckBusy = true;
  try {
    // Uma verificação por conta: cada usuário tem seu Pushcut e seu resumo.
    for (const accId of config.accountIds()) checkDailyReportFor(accId);
  } finally { dailyCheckBusy = false; }
}

// Item 464: watchdog de anomalia — "zero vendas em X horas" quando o histórico
// diz que deveria haver. Detecta gateway quebrado/webhook caído ANTES do dono
// perceber no extrato. Opt-in (events.watchdog), roda de carona no tráfego
// (máx 1 verificação/h por processo) e avisa no máximo 1x por 12h por conta.
const WATCHDOG_WINDOW_H = 6;      // janela sem vendas que dispara o alerta
const WATCHDOG_MIN_WEEK = 14;     // mínimo de vendas nos últimos 7d p/ ter baseline (≥2/dia)
let lastWatchdogSweep = 0;
const watchdogNotified = new Map(); // accId → ts do último alerta
function checkSalesWatchdog() {
  const now = Date.now();
  if (now - lastWatchdogSweep < 3600e3) return;
  lastWatchdogSweep = now;
  for (const accId of config.accountIds()) {
    try {
      const pc = (config.get(accId).pushcut || {});
      if (!pc.url || (pc.events || {}).watchdog !== true) continue;
      if (now - (watchdogNotified.get(accId) || 0) < 12 * 3600e3) continue; // anti-spam
      const s = stats.getStats(accId);
      const sales = (s.events || []).filter((e) => e.type === 'sale');
      const weekSales = sales.filter((e) => now - new Date(e.at).getTime() < 7 * 86400e3);
      if (weekSales.length < WATCHDOG_MIN_WEEK) continue; // sem baseline, sem alarme falso
      const recent = sales.some((e) => now - new Date(e.at).getTime() < WATCHDOG_WINDOW_H * 3600e3);
      if (recent) continue;
      watchdogNotified.set(accId, now);
      stats.logEvent('info', {
        acc: accId,
        title: '[watchdog] Nenhuma venda nas últimas ' + WATCHDOG_WINDOW_H + 'h (média recente: ' +
          Math.round(weekSales.length / 7) + '/dia) — verifique gateway e webhook'
      });
      sendPushcut('Aprovada', {
        title: 'Algo pode estar quebrado',
        text: 'Nenhuma venda nas últimas ' + WATCHDOG_WINDOW_H + 'h, mas a média da semana é ~' +
          Math.round(weekSales.length / 7) + '/dia. Vale conferir o gateway e o webhook.',
        sound: 'system'
      }, accId).catch(() => {});
    } catch (_) { /* watchdog nunca derruba a request que pegou a carona */ }
  }
}

// Item 448: arquivamento de eventos antigos "pegando carona no tráfego"
// (mesmo padrão do relatório diário, sem cron). No máximo 1x/hora, move um
// lote de eventos além da retenção (padrão 90 dias) para events_archive.
// Não bloqueia o request: dispara async e ignora o resultado.
const EVENT_RETENTION_DAYS = Math.max(7, Math.min(3650, Number(process.env.EVENT_RETENTION_DAYS) || 90));
// Fase 6: janela reprocessada a cada sweep. 35d cobre o maior período fixo da
// UI (30d) com folga para fuso/limites de dia. Recompute idempotente da janela.
const DAILY_ROLLUP_DAYS = Math.max(2, Math.min(400, Number(process.env.DAILY_ROLLUP_DAYS) || 35));
let lastArchiveSweep = 0;
let archiveSweepBusy = false;
function checkEventArchive() {
  const now = Date.now();
  if (archiveSweepBusy || (now - lastArchiveSweep) < 3600e3) return;
  archiveSweepBusy = true;
  lastArchiveSweep = now;
  db.archiveOldEvents(EVENT_RETENTION_DAYS, 2000)
    .then((n) => { if (n > 0) console.log('[stats] arquivados ' + n + ' evento(s) antigos (> ' + EVENT_RETENTION_DAYS + 'd)'); })
    .catch(() => {})
    // Fase 6: logo após arquivar, recomputa o rollup diário (idempotente) para
    // os últimos 35 dias — inclui eventos recém-movidos ao arquivo. Encadeado no
    // MESMO gancho horário para não criar outro timer nem outra varredura.
    .then(() => db.aggregateDaily(DAILY_ROLLUP_DAYS))
    .then((rows) => { if (rows > 0) console.log('[stats] rollup diário atualizado (' + rows + ' linha(s), ' + DAILY_ROLLUP_DAYS + 'd)'); })
    .catch((err) => { console.error('[stats] aggregateDaily falhou:', err && err.message); })
    .finally(() => { archiveSweepBusy = false; });
}
// Item 324/425 (LGPD): anonimização automática de leads antigos, pegando
// carona no tráfego (padrão do arquivamento — sem cron). Máx. 1 varredura/h
// por processo; cada conta com lgpdDays configurado tem os leads além da
// janela anonimizados (e-mail/telefone/nome removidos) no banco e na memória.
let lastLgpdSweep = 0;
let lgpdSweepBusy = false;
function checkLgpdSweep() {
  const now = Date.now();
  if (lgpdSweepBusy || (now - lastLgpdSweep) < 3600e3) return;
  lgpdSweepBusy = true;
  lastLgpdSweep = now;
  (async () => {
    for (const accId of config.accountIds()) {
      try {
        const days = Number((config.get(accId).settings || {}).lgpdDays) || 0;
        if (days < 30) continue;
        const n = await db.anonymizeOldLeads(accId, days, 500);
        const m = stats.anonymizeOldLeads(accId, days); // espelho em memória
        if (n > 0 || m > 0) {
          stats.logEvent('info', { acc: accId, title: '[lgpd] ' + Math.max(n, m) + ' lead(s) além de ' + days + ' dias anonimizado(s)' });
        }
      } catch (_) { /* LGPD nunca derruba a request que pegou a carona */ }
    }
  })().finally(() => { lgpdSweepBusy = false; });
}

// Item 295 (bug): o relatório diário cortava o dia em UTC — vendas das 21h à
// meia-noite de Brasília caíam no dia "seguinte" e o resumo vinha errado.
// brDay converte qualquer timestamp para o dia calendário de Brasília.
const BR_DAY_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
});
function brDay(d) {
  const t = d instanceof Date ? d : new Date(d);
  return isNaN(t.getTime()) ? String(d).slice(0, 10) : BR_DAY_FMT.format(t);
}
// Item 422: fuso configurável por conta — o corte de dia e o horário do
// resumo passam a respeitar settings.timezone (fallback: Brasília).
function accountTz(accId) {
  const tz = (config.get(accId).settings || {}).timezone;
  return tz || 'America/Sao_Paulo';
}
function accDay(accId, d) {
  const t = d instanceof Date ? d : new Date(d);
  if (isNaN(t.getTime())) return String(d).slice(0, 10);
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: accountTz(accId), year: 'numeric', month: '2-digit', day: '2-digit' }).format(t);
  } catch (_) { return BR_DAY_FMT.format(t); }
}
function accHour(accId) {
  try {
    return parseInt(new Intl.DateTimeFormat('en-GB', { timeZone: accountTz(accId), hour: '2-digit', hour12: false }).format(new Date()), 10);
  } catch (_) { return new Date().getUTCHours(); }
}
function checkDailyReportFor(accId) {
  const cfg = config.get(accId);
  const pc = cfg.pushcut || {};
  if (!pc.url || !(pc.events || {}).daily) return;
  const today = accDay(accId, new Date());
  if (cfg.lastDailyReport === today) return;
  // Item 430: hora mínima configurável — o resumo só sai depois da hora
  // escolhida (no fuso da conta). Default 0h = comportamento antigo.
  const minHour = Math.max(0, Math.min(23, Number((cfg.settings || {}).dailyReportHour) || 0));
  if (accHour(accId) < minHour) return;
  try {
    // Item 422: o corte de "ontem" também respeita o fuso da conta.
    const yKey = accDay(accId, new Date(Date.now() - 86400e3));
    const s = stats.getStats(accId);
    const dayLeads = (s.leads || []).filter((l) => !l.orphan && accDay(accId, l.at) === yKey);
    const sales = (s.events || []).filter((e) => e.type === 'sale' && accDay(accId, e.at) === yKey);
    const rev = sales.reduce((a, e) => a + (e.amount || 0), 0);
    const conv = dayLeads.length ? Math.round(sales.length / dayLeads.length * 1000) / 10 : 0;
    // anteontem, para comparação
    const y2Key = accDay(accId, new Date(Date.now() - 2 * 86400e3));
    const sales2 = (s.events || []).filter((e) => e.type === 'sale' && accDay(accId, e.at) === y2Key);
    const rev2 = sales2.reduce((a, e) => a + (e.amount || 0), 0);
    const cur = (sales[0] && sales[0].currency) || 'EUR';
    const delta = rev2 > 0 ? Math.round((rev - rev2) / rev2 * 100) : null;
    config.set(accId, { lastDailyReport: today }); // marca ANTES do envio: nunca duplica
    sendPushcut('Aprovada', {
      title: 'Resumo de ' + yKey.split('-').reverse().join('/'),
      text: 'Receita: ' + (rev / 100).toFixed(2) + ' ' + cur +
        (delta != null ? ' (' + (delta >= 0 ? '+' : '') + delta + '% vs anterior)' : '') +
        '\nVendas: ' + sales.length + ' · Leads: ' + dayLeads.length + ' · Conversão: ' + conv + '%',
      sound: 'system'
    }, accId).catch(() => {});
  } catch (_) {}
}

// ── Auth simples (Basic Auth) para a dashboard ───────────────────────
// Comparação em tempo constante (crypto.timingSafeEqual) — evita timing
// attacks que a comparação com === permitia.
const crypto = require('crypto');
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
// Guards de sessão (multi-usuário). dashboardAuth protege as APIs (401 JSON)
// e popula req.account; pageAuth protege páginas HTML (redireciona a /login).
// Declarados como function (hoisted) — são usados por rotas definidas ANTES
// deste ponto do arquivo.
const _apiGuard = auth.requireAuth({ api: true });
const _pageGuard = auth.requireAuth();
function dashboardAuth(req, res, next) { return _apiGuard(req, res, next); }
function pageAuth(req, res, next) { return _pageGuard(req, res, next); }

// ── Status público (diagnóstico de deploy — sem auth) ─────────────────────
// Use em produção (ex.: Railway) para checar se as variáveis essenciais estão
// configuradas ANTES de tentar registrar/logar. Não expõe segredos.
app.get('/api/status', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const rdb = require('./redis');
  res.json({
    ok: db.enabled,               // precisa ser true para registro/login funcionarem
    db: db.enabled,               // DATABASE_URL configurada?
    redis: !!(rdb && rdb.enabled),// UPSTASH_* configurada? (opcional)
    // Item 47: rota é pública — sem citar plataforma de hospedagem interna.
    hint: db.enabled ? undefined : 'DATABASE_URL ausente: configure a connection string do banco nas variáveis de ambiente do servidor.'
  });
});

// ── Rotas de autenticação (registro / login / logout) ───────────────���─────
app.get('/login', auth.optionalAuth(), (req, res) => {
  if (req.account) return res.redirect('/dashboard');
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(loginPage());
});
app.get('/register', auth.optionalAuth(), (req, res) => {
  if (req.account) return res.redirect('/dashboard');
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(registerPage());
});

// ── Acesso rápido para desenvolvimento (NUNCA em produção) ────────────────
// Loga automaticamente na conta existente (ou cria uma conta dev) e cai direto
// na dashboard, sem passar pela tela de login. Usado por v0/testes automáticos.
// Gate: só funciona quando NODE_ENV !== 'production' → num deploy Vercel
// (preview ou produção usam NODE_ENV=production) a rota responde 404.
const DEV_LOGIN_ENABLED = process.env.NODE_ENV !== 'production';
if (DEV_LOGIN_ENABLED) {
  app.get('/__dev/login', async (req, res) => {
    try {
      if (!db.enabled) return res.status(503).send('DATABASE_URL não configurada.');
      let accountId = await db.getFirstAccountId();
      if (!accountId) {
        // Nenhuma conta ainda: cria uma conta admin de desenvolvimento.
        const reg = await auth.register({ email: 'dev@local.test', password: 'devdevdev', name: 'Dev' });
        if (reg.error || !reg.account) return res.status(500).send('Falha ao criar conta dev: ' + (reg.error || ''));
        try { config.migrateLegacyTo(reg.account.id); } catch (_) {}
        await refreshDefaultAccount();
        appendCookie(res, auth.sessionCookie(reg.token));
        return res.redirect('/dashboard');
      }
      // Já existe conta: cria sessão real para ela e entra com os dados reais.
      const token = await db.createAuthSession(accountId, 30);
      appendCookie(res, auth.sessionCookie(token));
      return res.redirect('/dashboard');
    } catch (err) {
      console.error('[dev-login]', err.message);
      res.status(500).send('Erro no acesso rápido: ' + err.message);
    }
  });
  console.log('[dev-login] Acesso rápido habilitado em /__dev/login (apenas desenvolvimento).');
}

app.post('/register', async (req, res) => {
  try {
    const b = req.body || {};
    const result = await auth.register({
      email: b.email, password: b.password, name: b.name,
      meta: { ua: req.headers['user-agent'], ipMasked: maskReqIp(req) } // item 414
    });
    if (result.error) return res.status(400).json({ ok: false, error: result.error });
    // primeiro usuário virou admin e herdou dados legados → migra config em memória
    try { config.migrateLegacyTo(result.account.id); } catch (_) {}
    await refreshDefaultAccount();
    appendCookie(res, auth.sessionCookie(result.token));
    res.json({ ok: true, account: { email: result.account.email, name: result.account.name } });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Erro ao criar conta.' });
  }
});

app.post('/login', async (req, res) => {
  try {
    const b = req.body || {};
    const result = await auth.login({
      email: b.email, password: b.password,
      meta: { ua: req.headers['user-agent'], ipMasked: maskReqIp(req) } // item 414
    });
    // Item 440: 429 quando bloqueado por excesso de tentativas (não 401).
    if (result.error) return res.status(result.locked ? 429 : 401).json({ ok: false, error: result.error });
    // Item 420: conta com 2FA ativo — sem sessão ainda; devolve o ticket do
    // segundo passo para o cliente pedir o código do autenticador.
    if (result.requires2fa) return res.json({ ok: true, requires2fa: true, pending: result.pending });
    appendCookie(res, auth.sessionCookie(result.token));
    res.json({ ok: true, account: { email: result.account.email, name: result.account.name } });
    // Item 417: login entra na trilha de auditoria da conta.
    audit(req, result.account.id, 'login', 'Login no painel');
    // Item 442: aviso de novo login via Pushcut (opt-in explícito). Depois da
    // resposta — nunca atrasa o login. IP mascarado (sem PII completa).
    try {
      const pcCfg = (config.get(result.account.id).pushcut || {});
      if (pcCfg.url && (pcCfg.events || {}).login === true) {
        const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
        const maskedIp = ip.includes(':') ? ip.split(':').slice(0, 3).join(':') + ':…' : ip.replace(/\.\d+$/, '.xxx');
        sendPushcut('Login', {
          title: 'Novo login no painel',
          text: 'Acesso à sua conta em ' + new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) + ' (IP ' + (maskedIp || 'desconhecido') + '). Se não foi você, troque a senha.'
        }, result.account.id).catch(() => {});
      }
    } catch (_) { /* aviso é melhor-esforço */ }
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Erro ao entrar.' });
  }
});

// ── Item 420: 2FA TOTP opcional ───────────────────────────────────────────
// Segundo passo do login: ticket + código de 6 dígitos → sessão de verdade.
app.post('/login/2fa', async (req, res) => {
  try {
    const b = req.body || {};
    const result = await auth.complete2faLogin({ pending: b.pending, code: b.code });
    if (result.error) return res.status(result.locked ? 429 : 401).json({ ok: false, error: result.error });
    appendCookie(res, auth.sessionCookie(result.token));
    res.json({ ok: true, account: { email: result.account.email, name: result.account.name } });
    audit(req, result.account.id, 'login', 'Login no painel (com 2FA)');
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Erro ao verificar o código.' });
  }
});

// Status do 2FA da conta logada (para a UI mostrar ativo/inativo).
app.get('/api/account/2fa', dashboardAuth, async (req, res) => {
  try {
    const row = await db.getAccountById(req.account.id);
    res.json({ ok: true, enabled: !!(row && row.totp_secret) });
  } catch (_) { res.status(500).json({ ok: false, error: 'Erro ao consultar.' }); }
});

// Passo 1 da ativação: gera secret + QR (data URL). Nada persiste ainda.
app.post('/api/account/2fa/setup', dashboardAuth, async (req, res) => {
  if (rateLimited('2fasetup|' + req.account.id, 'tokrot', 5)) {
    return res.status(429).json({ ok: false, error: 'Muitas tentativas. Aguarde um minuto.' });
  }
  const result = await auth.setup2fa({ accountId: req.account.id, email: req.account.email });
  if (result.error) return res.status(400).json({ ok: false, error: result.error });
  try {
    const qrDataUrl = await require('qrcode').toDataURL(result.otpauth, { margin: 1, width: 220 });
    res.json({ ok: true, secret: result.secret, qr: qrDataUrl });
  } catch (_) {
    // Sem QR ainda dá para digitar o secret manualmente no app.
    res.json({ ok: true, secret: result.secret, qr: null });
  }
});

// Passo 2 da ativação: confirma o código e liga o 2FA de vez.
app.post('/api/account/2fa/confirm', dashboardAuth, async (req, res) => {
  const result = await auth.confirm2fa({ accountId: req.account.id, code: (req.body || {}).code });
  if (result.error) return res.status(400).json({ ok: false, error: result.error });
  audit(req, req.account.id, '2fa_ativado', 'Verificação em duas etapas ativada');
  res.json({ ok: true });
});

// Desativação: exige um código válido do autenticador.
app.post('/api/account/2fa/disable', dashboardAuth, async (req, res) => {
  const result = await auth.disable2fa({ accountId: req.account.id, code: (req.body || {}).code });
  if (result.error) return res.status(400).json({ ok: false, error: result.error });
  audit(req, req.account.id, '2fa_desativado', 'Verificação em duas etapas desativada');
  res.json({ ok: true });
});

// Item 411/415: trocar senha (verifica a atual) e derrubar as outras sessões.
app.post('/api/account/password', dashboardAuth, async (req, res) => {
  if (rateLimited('pwchange|' + req.account.id, 'pwchange', 5)) {
    return res.status(429).json({ ok: false, error: 'Muitas tentativas. Aguarde um minuto.' });
  }
  const b = req.body || {};
  const keepToken = auth.parseCookies(req)[auth.COOKIE_NAME];
  const result = await auth.changePassword({
    accountId: req.account.id,
    currentPassword: b.currentPassword,
    newPassword: b.newPassword,
    keepToken
  });
  if (result.error) return res.status(400).json({ ok: false, error: result.error });
  audit(req, req.account.id, 'senha_alterada', 'Senha da conta alterada' + (result.revoked ? ' (' + result.revoked + ' sessão(ões) encerrada(s))' : ''));
  res.json({ ok: true, revoked: result.revoked });
});

// Item 413: editar o nome da conta (exibido no cabeçalho da dashboard).
app.post('/api/account/name', dashboardAuth, async (req, res) => {
  const result = await auth.changeName({ accountId: req.account.id, name: (req.body || {}).name });
  if (result.error) return res.status(400).json({ ok: false, error: result.error });
  audit(req, req.account.id, 'nome_alterado', 'Nome da conta alterado para "' + result.name + '"');
  res.json({ ok: true, name: result.name });
});

// Item 414: sessões ativas da conta. Cada sessão vira um "sid" (md5 do token)
// — nunca devolvemos o token real. A sessão atual vem marcada para a UI.
app.get('/api/account/sessions', dashboardAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const rows = await db.listAuthSessions(req.account.id);
  const currentSid = crypto.createHash('md5').update(String(req.sessionToken || '')).digest('hex');
  res.json({
    ok: true,
    sessions: rows.map((s) => ({
      sid: s.sid,
      current: s.sid === currentSid,
      createdAt: s.created_at,
      expiresAt: s.expires_at,
      ua: s.ua || null,
      ip: s.ip_masked || null
    }))
  });
});

// Item 414/415: encerrar todas as OUTRAS sessões (mantém a atual).
app.post('/api/account/sessions/revoke-others', dashboardAuth, async (req, res) => {
  const result = await auth.revokeOtherSessions(req.account.id, req.sessionToken);
  audit(req, req.account.id, 'sessoes_encerradas', (result.revoked || 0) + ' outra(s) sessão(ões) encerrada(s)');
  res.json({ ok: true, revoked: result.revoked });
});

// Item 426 (LGPD/portabilidade): exporta TODOS os dados da conta em um JSON
// único — perfil, config (sem token), links, pixels (sem accessToken),
// gateways (sem secrets), leads, eventos e trilha de auditoria.
app.get('/api/account/export', dashboardAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (rateLimited('accexport|' + req.account.id, 'opsdrain', 3)) {
    return res.status(429).json({ ok: false, error: 'Aguarde um pouco antes de exportar de novo.' });
  }
  const acc = req.account.id;
  const cfg = config.get(acc);
  const s = stats.getStats(acc);
  const auditRows = await db.listAudit(acc, 500).catch(() => []);
  const payload = {
    formato: 'pragmatic-flow-conta-completa',
    versao: 1,
    exportadoEm: new Date().toISOString(),
    conta: { id: acc, email: req.account.email, name: req.account.name, criadaEm: req.account.created_at || null },
    settings: cfg.settings || {},
    pushcut: { configurado: !!(cfg.pushcut || {}).url, events: (cfg.pushcut || {}).events || {} },
    links: linkStore.list(acc),
    pixels: pixelStore.list(acc).map((p) => { const { accessToken, token, ...rest } = p; return rest; }),
    gateways: gatewayStore.list(acc).map((g) => { const { secret, webhookToken, ...rest } = g; return rest; }),
    dominios: cfg.customDomains || [],
    cloakLinks: cfg.cloakLinks || [],
    shortlinks: cfg.shortlinks || [],
    leads: (s.leads || []),
    eventos: (s.events || []),
    auditoria: auditRows
  };
  audit(req, acc, 'dados_exportados', 'Exportação completa da conta (LGPD)');
  res.setHeader('Content-Disposition', 'attachment; filename="minha-conta-completa.json"');
  res.json(payload);
});

// Item 428: pré-visualização da zona de perigo — o que existe na conta hoje
// (alimenta os modais de "zerar estatísticas" e "excluir conta").
app.get('/api/account/data-counts', dashboardAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const counts = await db.accountDataCounts(req.account.id);
  if (!counts) {
    // fallback sem banco: conta pelo estado em memória
    const s = stats.getStats(req.account.id);
    return res.json({ ok: true, counts: { leads: (s.leads || []).length, events: (s.events || []).length } });
  }
  res.json({ ok: true, counts });
});

// Item 427: exclusão da conta — confirmação forte (senha + frase exata) e
// cascata total no banco. A resposta limpa o cookie; não há volta.
app.post('/api/account/delete', dashboardAuth, async (req, res) => {
  const b = req.body || {};
  if (rateLimited('accdel|' + req.account.id, 'pwchange', 3)) {
    return res.status(429).json({ ok: false, error: 'Muitas tentativas. Aguarde um minuto.' });
  }
  if (String(b.confirm || '') !== 'EXCLUIR MINHA CONTA') {
    return res.status(400).json({ ok: false, error: 'Digite exatamente "EXCLUIR MINHA CONTA" para confirmar.' });
  }
  // reusa a checagem de senha do changePassword sem trocar nada
  const row = await db.getAccountById(req.account.id);
  if (!row || !(await auth.verifyPassword(String(b.password || ''), row.password_hash))) {
    return res.status(403).json({ ok: false, error: 'Senha incorreta.' });
  }
  const acc = req.account.id;
  console.log('[account] EXCLUSÃO da conta ' + acc + ' (' + req.account.email + ') solicitada e confirmada');
  const ok = await db.deleteAccountCascade(acc);
  if (!ok) return res.status(500).json({ ok: false, error: 'Falha ao excluir. Tente novamente.' });
  stats.reset(acc);            // limpa o espelho em memória
  auth.clearSessionCache();    // nenhuma sessão da conta sobrevive
  appendCookie(res, auth.clearCookie());
  res.json({ ok: true });
});

// Item 414: encerrar UMA sessão específica pelo sid. A sessão atual não pode
// ser encerrada por aqui (use Sair/logout) — evita se trancar sem querer.
app.delete('/api/account/sessions/:sid', dashboardAuth, async (req, res) => {
  const sid = String(req.params.sid || '');
  if (!/^[a-f0-9]{32}$/.test(sid)) return res.status(400).json({ ok: false, error: 'Identificador de sessão inválido.' });
  const currentSid = crypto.createHash('md5').update(String(req.sessionToken || '')).digest('hex');
  if (sid === currentSid) return res.status(400).json({ ok: false, error: 'Esta é a sessão atual — use "Sair" para encerrá-la.' });
  const result = await auth.revokeSessionBySid(req.account.id, sid);
  if (result.error) return res.status(404).json({ ok: false, error: result.error });
  audit(req, req.account.id, 'sessao_encerrada', 'Sessão encerrada manualmente pela aba Config');
  res.json({ ok: true });
});

app.post('/logout', async (req, res) => {
  try {
    const token = auth.parseCookies(req)[auth.COOKIE_NAME];
    await auth.logout(token);
  } catch (_) {}
  appendCookie(res, auth.clearCookie());
  res.json({ ok: true });
});

// Dados da conta logada (nome/e-mail para o cabeçalho da dashboard).
app.get('/api/me', dashboardAuth, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ email: req.account.email, name: req.account.name, role: req.account.role });
});

// ── API: estatísticas (escopadas à conta logada) ����────────────────────
// ── Item 327: cache curtinho do getStats por conta ──────────────────────────
// getStats() varre TODOS os leads/eventos da conta a cada chamada. Com o poll
// de 12s isso é ok para 1 aba, mas várias abas (ou uma automação martelando)
// multiplicam o custo sem os dados mudarem. Cache de 3s por conta: colapsa
// rajadas em 1 cômputo, e 3s << 12s do poll — o usuário nunca percebe.
const STATS_CACHE = new Map(); // accId -> { at, body }
const STATS_CACHE_TTL = 3e3;

app.get('/api/stats', dashboardAuth, (req, res) => {
  // Item 327: autenticado ≠ ilimitado — 60/min por conta segura scripts
  // rodados com um token de sessão vazado ou automações mal configuradas.
  // O poll legítimo (12s = 5/min por aba) fica a uma ordem de grandeza.
  if (rateLimited('acc|' + req.account.id, 'stats', 60)) {
    res.set('Retry-After', '30');
    return apiError(res, 429, 'Muitas consultas ao painel. Aguarde alguns segundos.', 'rate_limited');
  }
  // Item 469: `private, no-cache` em vez de `no-store` — o navegador PODE
  // guardar a resposta só para revalidar com If-None-Match no próximo poll
  // (12s). O ETag automático do Express casa → 304 sem corpo, poupando a
  // banda do payload inteiro quando nada mudou. `private` barra proxies.
  res.set('Cache-Control', 'private, no-cache');
  const hit = STATS_CACHE.get(req.account.id);
  if (hit && Date.now() - hit.at < STATS_CACHE_TTL) {
    return res.json(hit.body); // ETag do Express continua funcionando (304)
  }
  const body = stats.getStats(req.account.id);
  STATS_CACHE.set(req.account.id, { at: Date.now(), body });
  res.json(body);
  checkDailyReport(); // dashboard aberta também dispara o resumo pendente
  });

// varredura para o cache não reter contas que pararam de olhar o painel
const statsCacheSweep = setInterval(() => {
  const now = Date.now();
  STATS_CACHE.forEach((v, k) => { if (now - v.at > 60e3) STATS_CACHE.delete(k); });
}, 120e3);
if (statsCacheSweep.unref) statsCacheSweep.unref();

// ── API: detalhe de um lead com jornada (item 326 — alimenta o drawer) ──
// Escopo por conta: lead de outra conta responde 404 (não 403 — não
// confirmamos a existência do id a quem não é dono).
app.get('/api/leads/:id', dashboardAuth, (req, res) => {
  const lead = stats.getLead(String(req.params.id || '').slice(0, 64));
  if (!lead || (lead.acc || _defaultAccountId) !== req.account.id) {
    return apiError(res, 404, 'Lead não encontrado.', 'not_found');
  }
  res.set('Cache-Control', 'private, no-cache');
  // projeção explícita — nada de vazar campos internos por acidente
  res.json({
    ok: true,
    lead: {
      id: lead.id, at: lead.at, stage: lead.stage,
      lastSeen: lead.lastSeen || null,
      purchasedAt: lead.purchasedAt || lead.convertedAt || null,
      country: lead.country || null, countryName: lead.countryName || null,
      city: lead.city || null,
      device: lead.device || null, os: lead.os || null, browser: lead.browser || null,
      gateway: lead.gateway || null, linkSlug: lead.linkSlug || null,
      utm: lead.utm || null, referer: lead.referer || lead.ref || null,
      customer: lead.customer || null, email: lead.email || null,
      phone: lead.phone || null,
      amount: lead.amount ?? null,
      expectedAmount: lead.expectedAmount || null,
      reportedAmount: lead.reportedAmount || null,
      currency: lead.currency || lead.reportedCurrency || null,
      orphan: !!lead.orphan,
      checkoutHits: Array.isArray(lead.checkoutHits) ? lead.checkoutHits : [],
      journey: Array.isArray(lead.journey) ? lead.journey : [],
    },
  });
});

// ── API: heartbeat de presença (chamado por todas as páginas do funil) ─
app.post('/api/pulse', (req, res) => {
  try {
    const b = req.body || {};
    // páginas externas (snippet /t.js) não têm cookie → mandam vid no body
    const id = readCookie(req, 'v_id') ||
      (VID_RE.test(String(b.vid || '')) ? String(b.vid) : null);
    if (!id) return res.json({ ok: false });
    const geo = geoFromReq(req);
    presence.touch({
      visitorId: id,
      acc: publicAccountId(req),
      page: b.page ? String(b.page).slice(0, 300) : null,
      referrer: b.referrer ? String(b.referrer).slice(0, 300) : null,
      country: geo.country, countryName: geo.countryName, city: geo.city,
      ua: String(req.headers['user-agent'] || '').slice(0, 300),
      ip: clientIp(req),
      variant: readCookie(req, 'ab_variant') || null
    });
  } catch (_) {}
  res.json({ ok: true });
});
app.post('/api/pulse/leave', (req, res) => {
  try {
    const b = req.body || {};
    const id = readCookie(req, 'v_id') ||
      (VID_RE.test(String(b.vid || '')) ? String(b.vid) : null);
    if (id) presence.leave(id);
  } catch (_) {}
  res.json({ ok: true });
});

// ── API: visitantes navegando AGORA (dashboard) ────────────────────────
app.get('/api/live', dashboardAuth, async (req, res) => {
  // Item 379: dados ao vivo nunca podem ser cacheados por proxy/navegador.
  res.set('Cache-Control', 'no-store');
  try {
    // presence.list() e summary() são agora async (mescla memória + Redis)
    const accId = req.account.id;
    const [visitors, presenceSummary] = await Promise.all([presence.list(accId), presence.summary(accId)]);
    // Checkouts são EXTERNOS (sem script nosso lá) → estimativa via janela
    // de entrada de 10min (leads que clicaram num /go/ recentemente).
    let checkoutEst = 0;
    try {
      const now = stats.inCheckoutNow(undefined, accId);
      checkoutEst = Object.values(now).reduce((a, b) => a + (b || 0), 0);
    } catch (_) {}
    res.json({
      visitors,
      summary: presenceSummary,
      checkout: { externalEst: checkoutEst },
      ts: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ���═����� Links de Checkout — CRUD + validação de domínio (por conta) ══════
// Itens 230/232: auditoria de integridade referencial + dados órfãos.
// Reporta (sem alterar nada): links apontando para pixel/domínio inexistente
// e stats de cloak de slugs que não existem mais. O modo ?fix=1 limpa os
// órfãos seguros (somente referências, nunca dados de venda).
app.get('/api/ops/integrity', dashboardAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const acc = req.account.id;
  const cfg = config.get(acc);
  const pixels = new Set(pixelStore.list(acc).map((p) => p.slug));
  const domains = new Set((cfg.customDomains || []).map((d) => d.host));
  const cloakSlugs = new Set((cfg.cloakLinks || []).map((c) => c.slug));
  const problemas = [];
  for (const l of linkStore.list(acc)) {
    // pixel referenciado que não existe mais
    if (l.pixelSlug && !pixels.has(l.pixelSlug)) {
      problemas.push({ tipo: 'link-pixel', slug: l.slug, ref: l.pixelSlug,
        msg: 'Link "' + l.nome + '" aponta para o pixel "' + l.pixelSlug + '", que não existe mais.' });
    }
    // domínio personalizado que sumiu da lista global
    if (l.dominio && domains.size > 0 && !domains.has(l.dominio)) {
      problemas.push({ tipo: 'link-dominio', slug: l.slug, ref: l.dominio,
        msg: 'Link "' + l.nome + '" usa o domínio "' + l.dominio + '", que não está mais cadastrado.' });
    }
  }
  // stats de cloak de slugs apagados (órfãos no Redis). O prefixo 'cloak:'
  // vem do bumpDecision ('cloak:' + slug) — remove antes de comparar.
  let orfaosCloak = [];
  try {
    const statSlugs = await redis.listCloakStatSlugs(acc);
    orfaosCloak = statSlugs
      .map((s) => s.replace(/^cloak:/, ''))
      .filter((slug) => !cloakSlugs.has(slug));
  } catch (_) {}
  const fix = req.query.fix === '1';
  let corrigidos = 0;
  if (fix) {
    // limpar referência de pixel fantasma nos links (ação segura e reversível)
    for (const p of problemas.filter((x) => x.tipo === 'link-pixel')) {
      try { await linkStore.save(acc, { slug: p.slug, pixelSlug: '' }); corrigidos++; } catch (_) {}
    }
    // apagar contadores e histórico de decisões de slugs de cloak apagados
    if (orfaosCloak.length) {
      const prefixed = orfaosCloak.map((s) => 'cloak:' + s);
      try {
        corrigidos += await redis.clearCloakStats(acc, prefixed);
        await redis.clearCloakDecisionLogs(acc, prefixed);
      } catch (_) {}
    }
  }
  res.json({ ok: true, problemas, orfaosCloak, corrigidos: fix ? corrigidos : undefined });
});

// Item 231: backup self-service da configuração da conta em JSON.
// SEGREDOS NUNCA SAEM: accessToken de pixel e secret de gateway são omitidos —
// o import recria a estrutura e o usuário recoloca as credenciais.
app.get('/api/backup/export', dashboardAuth, (req, res) => {
  res.set('Cache-Control', 'no-store');
  const acc = req.account.id;
  const cfg = config.get(acc);
  const payload = {
    formato: 'pragmatic-flow-backup',
    versao: 1,
    exportadoEm: new Date().toISOString(),
    links: linkStore.list(acc),
    pixels: pixelStore.list(acc).map((p) => {
      const { accessToken, token, ...rest } = p; // token público também sai (regenerado no import)
      return rest;
    }),
    gateways: gatewayStore.list(acc).map((g) => {
      const { secret, webhookToken, ...rest } = g;
      return rest;
    }),
    dominios: (cfg.customDomains || []).map((d) => ({ host: d.host, uso: d.uso || 'ambos' })),
    cloakLinks: cfg.cloakLinks || [],
    cloak: cfg.cloak || null
  };
  res.setHeader('Content-Disposition', 'attachment; filename="backup-conta.json"');
  res.json(payload);
});

// Item 231 (import): recria links/pixels/gateways/cloak a partir do backup.
// Cada item passa pelo MESMO sanitizador do save normal — nada entra cru.
// Itens que já existem (mesmo slug/nome) são atualizados, não duplicados.
app.post('/api/backup/import', dashboardAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (rateLimited('backup-import|' + req.account.id, 'opsdrain', 3)) {
    return apiError(res, 429, 'Aguarde um pouco antes de importar de novo.', 'rate_limited');
  }
  const b = req.body || {};
  if (b.formato !== 'pragmatic-flow-backup') {
    return apiError(res, 400, 'Arquivo não reconhecido — exporte o backup pela própria dashboard.', 'bad_format');
  }
  const acc = req.account.id;
  const report = { links: 0, pixels: 0, gateways: 0, cloakLinks: 0, erros: [] };
  try {
    for (const l of (Array.isArray(b.links) ? b.links : []).slice(0, 100)) {
      try { await linkStore.save(acc, l); report.links++; }
      catch (e) { report.erros.push('link ' + (l && l.slug) + ': ' + e.message); }
    }
    for (const p of (Array.isArray(b.pixels) ? b.pixels : []).slice(0, 50)) {
      try { await pixelStore.save(acc, p); report.pixels++; } // sem accessToken: usuário recoloca
      catch (e) { report.erros.push('pixel ' + (p && p.slug) + ': ' + e.message); }
    }
    for (const g of (Array.isArray(b.gateways) ? b.gateways : []).slice(0, 30)) {
      try { await gatewayStore.save(acc, g); report.gateways++; } // token/secret novos são gerados
      catch (e) { report.erros.push('gateway ' + (g && g.name) + ': ' + e.message); }
    }
    // cloak entries + config global passam pela sanitização do config.set
    const patch = {};
    if (Array.isArray(b.cloakLinks) && b.cloakLinks.length) patch.cloakLinks = b.cloakLinks.slice(0, 100);
    if (b.cloak && typeof b.cloak === 'object') patch.cloak = b.cloak;
    if (Object.keys(patch).length) {
      config.set(acc, patch);
      report.cloakLinks = (patch.cloakLinks || []).length;
    }
    stats.logEvent('info', { acc, title: 'Backup importado: ' + report.links + ' links, ' + report.pixels + ' pixels, ' + report.gateways + ' gateways' });
    audit(req, req.account.id, 'backup_importado', 'Backup restaurado no painel'); // item 417
    res.json({ ok: true, report });
  } catch (e) {
    apiError(res, 500, 'Falha ao importar o backup.', 'import_failed');
  }
});

app.get('/api/links', dashboardAuth, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ links: linkStore.list(req.account.id) });
});

app.post('/api/links', dashboardAuth, async (req, res) => {
  try {
    // Um domínio já verificado na aba "Domínio personalizado" conta como
    // validado para o link — sem precisar revalidar por link (era a origem do
    // "Domínio não validado" apesar do domínio estar verificado).
    (config.get(req.account.id).customDomains || [])
      .filter((d) => d.verificado)
      .forEach((d) => linkStore.markDomainValidated(d.host, d.verificadoEm));
    const saved = await linkStore.save(req.account.id, req.body || {});
    stats.logEvent('info', { acc: req.account.id, title: 'Link de checkout salvo: ' + saved.nome, ref: saved.slug });
    audit(req, req.account.id, 'link_salvo', 'Link ' + saved.slug + ' (' + saved.nome + ')'); // item 417
    res.json({ ok: true, link: saved });
  } catch (err) {
    // Item 235: conflito de edição concorrente → 409 com mensagem acionável
    res.status(err.code === 'conflict' ? 409 : 400).json({ error: err.message, code: err.code });
  }
});

app.delete('/api/links/:slug', dashboardAuth, async (req, res) => {
  try {
    await linkStore.remove(req.account.id, req.params.slug);
    stats.logEvent('info', { acc: req.account.id, title: 'Link de checkout removido', ref: req.params.slug });
    audit(req, req.account.id, 'link_removido', 'Link ' + req.params.slug); // item 417
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Valida o domínio de um checkout externo: DNS resolve + resposta HTTP.
app.post('/api/links/validate-domain', dashboardAuth, async (req, res) => {
  const result = await linkStore.validateDomain(String((req.body || {}).dominio || ''));
  res.json(result);
});

// ═══ Domínios personalizados — plugue qualquer domínio via DNS ════���═══
// O usuário aponta um CNAME do domínio dele para este app; como todas as
// rotas públicas (/go, /l, /t.js, /px.gif) são agnósticas de Host, o mesmo
// servidor atende o domínio personalizado automaticamente. Aqui fica o
// registro + verificação (DNS aponta pra cá? HTTPS chega neste app?).
const dnsp = require('dns').promises;
// Cloudflare for SaaS remove o limite de domínios customizados da Railway.
// Mantemos Railway como fallback para instalações antigas sem CLOUDFLARE_*.
const railwayDomainProvider = require('./domain-provider');
const cloudflareDomainProvider = require('./cloudflare-domain-provider');
// Seleção DINÂMICA: o preflight do Cloudflare roda assíncrono no boot e pode
// desabilitar o provider (token inválido / origem privada / origem offline).
// Capturar o valor uma única vez no boot congelava a decisão errada.
function activeDomainProvider() {
  return cloudflareDomainProvider.enabled ? cloudflareDomainProvider : railwayDomainProvider;
}
// normHost/DOMAIN_RE extraídos para security-helpers.js (testáveis — item 60)
const { normHost } = require('./security-helpers');
const APP_CHECK_ID = 'roi-nados-tracker';

// Marcador público que prova que o tráfego do domínio chega NESTE app
// (usado pela verificação; sem auth de propósito — não expõe nada).
app.get('/__domain-check', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ app: APP_CHECK_ID, ok: true });
});

// ── Configurações da conta (moeda padrão etc.) ���───────────────────────────
// A moeda escolhida aqui alimenta TODOS os disparos/testes que não trazem
// moeda própria no payload (fallback era EUR fixo; agora é por conta, BRL).
function accountCurrency(accId) {
  const cur = String((config.get(accId).settings || {}).defaultCurrency || '').toUpperCase();
  return /^[A-Z]{3}$/.test(cur) ? cur : 'BRL';
}

app.get('/api/settings', dashboardAuth, (req, res) => {
  res.set('Cache-Control', 'no-store');
  const s = config.get(req.account.id).settings || {};
  res.json({
    defaultCurrency: accountCurrency(req.account.id),
    // Itens 422/423/424/425/429/430: preferências avançadas da conta
    timezone: s.timezone || 'America/Sao_Paulo',
    revenueGoal: s.revenueGoal || 0,
    outboundWebhook: s.outboundWebhook || '',
    lgpdDays: s.lgpdDays || 0,
    dailyReportHour: Number.isFinite(s.dailyReportHour) ? s.dailyReportHour : 0,
    pushcutTemplate: s.pushcutTemplate || '',
    // Item 419: escopo atual do token público (para a UI refletir o valor)
    apiScope: (config.get(req.account.id).api || {}).scope || 'stats',
    raw: { defaultCurrency: s.defaultCurrency || null }
  });
});

app.post('/api/settings', dashboardAuth, (req, res) => {
  const body = req.body || {};
  // Itens 422/423/424/425/429/430: campos opcionais — só sobrescreve o que
  // veio no body; a sanitização final é do config.set (fonte única de regras).
  const patchable = ['timezone', 'revenueGoal', 'outboundWebhook', 'lgpdDays', 'dailyReportHour', 'pushcutTemplate'];
  const hasExtra = patchable.some((k) => Object.prototype.hasOwnProperty.call(body, k));
  if (hasExtra && !body.defaultCurrency) {
    const s = Object.assign({}, config.get(req.account.id).settings || {});
    patchable.forEach((k) => {
      if (!Object.prototype.hasOwnProperty.call(body, k)) return;
      // string vazia / 0 = "limpar o campo" (o sanitizador descarta)
      if (body[k] === '' || body[k] === 0 || body[k] === null) delete s[k];
      else s[k] = body[k];
    });
    const saved = (config.set(req.account.id, { settings: s }).settings || {});
    audit(req, req.account.id, 'settings_alterados', 'Preferências da conta atualizadas');
    return res.json({ ok: true, settings: saved });
  }
  const cur = String(body.defaultCurrency || '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(cur)) {
    return res.status(400).json({ error: 'moeda inválida — use um código de 3 letras (BRL, USD, EUR…)' });
  }
  const s = Object.assign({}, config.get(req.account.id).settings || {}, { defaultCurrency: cur });
  config.set(req.account.id, { settings: s });
  // Item 242: espelha em accounts.currency (write-through assíncrono — a
  // moeda sobrevive mesmo se a config jsonb for recriada/perdida).
  db.setAccountCurrency(req.account.id, cur);
  stats.logEvent('info', { acc: req.account.id, title: 'Moeda padrão da conta: ' + cur });
  res.json({ ok: true, defaultCurrency: cur });
});

// Item 424: teste de disparo do webhook de saída — envia uma venda fictícia
// para a URL configurada e devolve o status HTTP que o destino respondeu.
app.post('/api/settings/webhook-test', dashboardAuth, async (req, res) => {
  if (rateLimited('whtest|' + req.account.id, 'tokrot', 5)) {
    return res.status(429).json({ ok: false, error: 'Muitos testes. Aguarde um minuto.' });
  }
  const url = (config.get(req.account.id).settings || {}).outboundWebhook;
  if (!url) return res.status(400).json({ ok: false, error: 'Nenhum webhook configurado — salve a URL primeiro.' });
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Source': 'pragmatic-flow' },
      body: JSON.stringify({
        type: 'sale', test: true, at: new Date().toISOString(),
        orderId: 'TESTE-' + Date.now(), gateway: 'teste',
        amountCents: 12345, currency: accountCurrency(req.account.id),
        product: 'Disparo de teste', customer: 'Cliente Teste', email: 'teste@exemplo.com', country: 'BR'
      }),
      signal: ctl.signal
    });
    clearTimeout(timer);
    res.json({ ok: r.ok, status: r.status });
  } catch (e) {
    res.json({ ok: false, error: e.name === 'AbortError' ? 'timeout (8s) — o destino não respondeu' : e.message });
  }
});

app.get('/api/domains', dashboardAuth, (req, res) => {
  res.set('Cache-Control', 'no-store');
  const domainProvider = activeDomainProvider();
  res.json({
    domains: config.get(req.account.id).customDomains || [],
    // Alvo amigável do CNAME. Com Cloudflare for SaaS, o alvo é o Managed CNAME
    // target (CLOUDFLARE_CNAME_TARGET) — NUNCA a origem Railway, que serve o
    // certificado errado. Sem Cloudflare, mantém o host principal legado.
    appHost: cloudflareDomainProvider.enabled
      ? cloudflareDomainProvider.cnameTarget()
      : String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim().replace(/:\d+$/, ''),
    // Provisionamento automático na hospedagem ativo? Quando false, cada domínio
    // precisa ser adicionado manualmente no painel da hospedagem — a UI avisa.
    autoProvision: domainProvider.enabled,
    domainProvider: domainProvider.enabled ? (domainProvider.name || 'hosting') : null,
    // Modo degradado (sem CLOUDFLARE_CNAME_TARGET) — a UI mostra o aviso.
    providerDegraded: cloudflareDomainProvider.enabled ? cloudflareDomainProvider.preflightState.degraded : false
  });
});

app.post('/api/domains', dashboardAuth, async (req, res) => {
  const host = normHost((req.body || {}).host);
  if (!host) return res.status(400).json({ error: 'domínio inválido (ex.: link.seudominio.com)' });
  // domínio precisa ser único ENTRE TODAS as contas: ele identifica a conta
  // dona do tráfego público (publicAccountId) — duas contas não podem tê-lo
  const owner = config.accountForDomain(host);
  if (owner && owner !== req.account.id) return res.status(400).json({ error: 'domínio já cadastrado em outra conta' });
  const cur = config.get(req.account.id).customDomains || [];
  if (cur.some((d) => d.host === host)) return res.status(400).json({ error: 'domínio já cadastrado' });
  if (cur.length >= 20) return res.status(400).json({ error: 'limite de 20 domínios' });

  // Registra o domínio na hospedagem (Railway) para ele ser roteado + ganhar
  // SSL. Se o provider estiver em modo manual (sem token), segue o fluxo antigo:
  // o lojista aponta o CNAME e adiciona o domínio na hospedagem na mão.
  const domainProvider = activeDomainProvider();
  let dnsRecords = null, providerId = null, providerNote = null, providerName = null, providerStatus = null;
  if (domainProvider.enabled) {
    try {
      const reg = await domainProvider.register(host);
      providerId = reg.providerId || null;
      providerName = reg.provider || domainProvider.name || null;
      dnsRecords = reg.dns || null;
      providerStatus = reg.status || null;
    } catch (e) {
      // NENHUM erro da hospedagem bloqueia o cadastro: tudo degrada para modo
      // manual (o lojista aponta o CNAME/adiciona o domínio depois). Assim que
      // houver capacidade, a verificação re-tenta o registro sozinha. Mensagens
      // genéricas — nunca expõem token nem detalhe interno da API.
      // Itens 8/20: linguagem NEUTRA — nunca citar provedor interno. O lojista
      // s�� precisa saber que o provisionamento automático não completou agora
      // e que a reconexão é automática.
      const notes = {
        limite: 'limite de domínios simultâneos atingido ��� domínio salvo; o provisionamento automático reconecta sozinho quando houver espaço (ou remova um domínio não usado)',
        duplicado: 'este domínio já está provisionado (possivelmente em outra conta) — domínio salvo; verifique em alguns minutos',
        auth: 'o provisionamento automático está indisponível no momento — domínio salvo; tentamos de novo sozinhos na próxima verificação',
        offline: 'não foi possível completar o provisionamento agora — domínio salvo; tentamos de novo sozinhos na próxima verificação'
      };
      providerNote = notes[e.message] || 'domínio salvo — o provisionamento automático completa na próxima verificação';
      stats.logEvent('warn', { acc: req.account.id, title: 'Domínio salvo em modo manual (' + e.message + '): ' + host });
    }
  }

  // Uso do domínio: onde ele vale — links de checkout, cloaker ou ambos.
  const usoRaw = String((req.body || {}).uso || 'ambos');
  const uso = ['checkout', 'cloaker', 'ambos'].includes(usoRaw) ? usoRaw : 'ambos';
  // status: 'pending_dns' | 'pending_ssl' | 'active' | 'error' — estado
  // explícito do provisionamento (substitui o booleano cru na origem; o campo
  // legado `verificado` continua espelhado para compatibilidade da UI antiga).
  const entry = { host, uso, verificado: false, verificadoEm: null, status: providerStatus || 'pending_dns', lastCheckedAt: null, lastError: null, criadoEm: new Date().toISOString() };
  if (providerId) entry.providerId = providerId;
  if (providerName) entry.provider = providerName;
  // Guarda os registros DNS junto do domínio: o tutorial da dashboard precisa
  // deles a qualquer momento (não só na resposta do cadastro), para o lojista
  // reabrir as instruções sem depender de acesso à hospedagem.
  if (dnsRecords) entry.dns = dnsRecords;
  config.set(req.account.id, { customDomains: cur.concat([entry]) });
  stats.logEvent('info', { acc: req.account.id, title: 'Domínio personalizado adicionado: ' + host });
  // Devolve os registros DNS que o lojista precisa criar (CNAME + TXT). Nada
  // aqui cont��m segredo — são valores públicos de DNS. providerNote avisa quando
  // caiu em modo manual (ex.: teto da hospedagem) sem bloquear o cadastro.
  // Item 8: `mode` explícito — 'auto' = provisionado automaticamente;
  // 'manual' = aguardando (a verificação re-tenta o registro sozinha).
  const managed = domainProvider.enabled && !!providerId;
  res.json({ ok: true, host, dnsRecords, managed, mode: managed ? 'auto' : 'manual', providerNote });
});

app.delete('/api/domains/:host', dashboardAuth, async (req, res) => {
  const host = normHost(req.params.host);
  const cur = config.get(req.account.id).customDomains || [];
  const found = cur.find((d) => d.host === host);
  // Remove também na hospedagem, para não acumular contra o teto do provedor.
  const domainProvider = activeDomainProvider();
  if (found && found.providerId && domainProvider.enabled) {
    try { await domainProvider.remove(found.providerId, found.host); }
    catch (_) { /* best-effort — segue removendo localmente */ }
  }
  config.set(req.account.id, { customDomains: cur.filter((d) => d.host !== host) });
  res.json({ ok: true });
});

// Verificação em 2 passos: (1) DNS do domínio aponta para este app
// (CNAME → appHost ou A/AAAA com IPs iguais); (2) HTTPS no domínio
// responde o marcador /__domain-check deste app (prova final).
// detecta IPs do proxy da Cloudflare (nuvem laranja) — mascaram o CNAME real
function isCloudflareIp(ip) {
  const cidrs = ['173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22'];
  const toInt = (s) => s.split('.').reduce((a, o) => ((a << 8) + (parseInt(o, 10) & 255)) >>> 0, 0);
  const ipn = toInt(ip);
  return cidrs.some((c) => {
    const [net, bits] = c.split('/');
    const mask = bits === '0' ? 0 : (~((1 << (32 - parseInt(bits, 10))) - 1)) >>> 0;
    return (ipn & mask) === (toInt(net) & mask);
  });
}

// Item 175: resolução via DNS-over-HTTPS (dns.google / cloudflare-dns) para ler
// a propagação GLOBAL do registro. O resolver local (dnsp) responde pelo cache
// do sistema/rede, que pode estar defasado logo após o lojista criar o CNAME;
// os resolvers públicos costumam refletir a mudança antes. Best-effort e com
// timeout curto — nunca é fonte de verdade, só um sinal antecipado de "já vejo
// seu registro apontando pra cá". type=5 (CNAME), type=1 (A).
async function dohResolve(host, type) {
  const providers = [
    'https://dns.google/resolve?name=' + encodeURIComponent(host) + '&type=' + type,
    'https://cloudflare-dns.com/dns-query?name=' + encodeURIComponent(host) + '&type=' + type,
  ];
  for (const url of providers) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 2500);
      const r = await fetch(url, { headers: { accept: 'application/dns-json' }, signal: ctrl.signal });
      clearTimeout(t);
      if (!r.ok) continue;
      const j = await r.json().catch(() => null);
      if (!j || !Array.isArray(j.Answer)) continue;
      // Answer[].type: 5 = CNAME, 1 = A. data traz o valor resolvido.
      const answers = j.Answer.filter((a) => a.type === type).map((a) => String(a.data || '').replace(/\.$/, ''));
      if (answers.length) return answers;
    } catch (_) { /* tenta o próximo provider */ }
  }
  return [];
}

app.post('/api/domains/verify', dashboardAuth, async (req, res) => {
  const host = normHost((req.body || {}).host);
  if (!host) return res.status(400).json({ error: 'domínio inválido' });
  const appHost = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim().replace(/:\d+$/, '');
  const out = { host, appHost, dnsOk: false, dnsDetail: '', httpOk: false, httpDetail: '' };

  // 0. Auto-recuperação: se o domínio está em modo manual (sem providerId) e a
  // automação está ligada, tenta registrar agora — cobre o caso de um slot da
  // hospedagem ter vagado desde o cadastro. Best-effort: nunca derruba a
  // verificação, mas o MOTIVO da falha não é mais silencioso (registroErro) —
  // antes um token inválido deixava o lojista preso em "reconexão automática"
  // que nunca acontecia, sem nenhuma pista.
  const domainProvider = activeDomainProvider();
  let registroErro = null; // 'auth' | 'limite' | 'offline' | 'falha' | null
  if (domainProvider.enabled) {
    const cur0 = config.get(req.account.id).customDomains || [];
    const d0 = cur0.find((d) => d.host === host);
    // Ao trocar Railway → Cloudflare, domínios antigos têm providerId da
    // Railway. Eles precisam ser adotados pelo Cloudflare, não consultados com
    // o ID incompatível do provedor anterior.
    const needsAdoption = d0 && (!d0.providerId || (domainProvider.name && d0.provider !== domainProvider.name));
    if (needsAdoption) {
      try {
        const reg = await domainProvider.register(host);
        if (reg && reg.providerId) {
          const patch = { providerId: reg.providerId, provider: reg.provider || domainProvider.name || null };
          if (reg.dns) patch.dns = reg.dns; // instruções ficam disponíveis no tutorial
          const next = cur0.map((d) => d.host === host ? Object.assign({}, d, patch) : d);
          config.set(req.account.id, { customDomains: next });
          out.reconectado = true;
          out.dnsRecords = reg.dns || null;
        }
      } catch (e) {
        registroErro = ['auth', 'limite', 'offline', 'duplicado'].includes(e.message) ? e.message : 'falha';
        stats.logEvent('warn', { acc: req.account.id, title: 'Re-registro do domínio falhou (' + registroErro + '): ' + host });
      }
    }
  }

  // 1. DNS. O CNAME do lojista pode apontar para DOIS alvos válidos:
  //   (a) o host do app (appHost) — fluxo manual antigo;
  //   (b) o alvo que a hospedagem gerou para ESTE domínio (entry.dns.cname.target)
  //       — é ESSE valor que o Tutorial DNS mostra ao lojista.
  // Antes só (a) era aceito, então quem seguia o tutorial ficava preso em
  // "DNS aponta para outro destino" para sempre. Agora aceitamos ambos.
  const entry2 = (config.get(req.account.id).customDomains || []).find((d) => d.host === host);
  const providerTarget = (entry2 && entry2.dns && entry2.dns.cname && entry2.dns.cname.target)
    ? String(entry2.dns.cname.target).toLowerCase().replace(/\.$/, '') : '';
  const targets = Array.from(new Set([appHost.toLowerCase(), providerTarget].filter(Boolean)));

  // 1a. Fonte de verdade da hospedagem: se o provedor já validou o DNS deste
  // domínio, ele está certo — mesmo que os resolvers daqui ainda não reflitam
  // (apex com CNAME flattening da Cloudflare "esconde" o CNAME; vira registro A).
  // Também sincroniza os registros do tutorial com o que a hospedagem exige hoje.
  if (domainProvider.enabled && entry2 && entry2.providerId && (!entry2.provider || entry2.provider === domainProvider.name)) {
  try {
      const st = await domainProvider.status(entry2.providerId, host);
      if (st) {
        out.providerVerified = !!st.verified;
        if (st.certificateStatus) out.certificateStatus = st.certificateStatus;
        if (st.status) out.providerStatus = st.status;
        // Persiste o estado de provisionamento a cada verificação — transições
        // explícitas (pending_dns → pending_ssl → active). Nunca regride um
        // 'active' persistido por causa de uma leitura transitória: só regride
        // se a Cloudflare reportar 'error' explícito.
        const prevStatus = entry2.status || null;
        const nextStatus = (prevStatus === 'active' && st.status !== 'active' && st.status !== 'error') ? 'active' : (st.status || prevStatus);
        const statusPatch = {
          status: nextStatus,
          sslStatus: st.sslStatus || st.certificateStatus || null,
          lastCheckedAt: new Date().toISOString(),
          lastError: st.status === 'error' ? ((st.verificationErrors || []).concat(st.sslErrors || []).join('; ') || 'erro reportado pela Cloudflare') : null,
        };
        const needsDnsSync = st.dns && JSON.stringify(entry2.dns || null) !== JSON.stringify(st.dns);
        if (needsDnsSync || nextStatus !== prevStatus || statusPatch.lastError) {
          const cur1 = config.get(req.account.id).customDomains || [];
          config.set(req.account.id, { customDomains: cur1.map((d) => d.host === host ? Object.assign({}, d, statusPatch, needsDnsSync ? { dns: st.dns, provider: st.provider || domainProvider.name || d.provider } : {}) : d) });
        }
        if (st.dns && st.dns.cname && st.dns.cname.target) {
          const t = String(st.dns.cname.target).toLowerCase().replace(/\.$/, '');
          if (t && !targets.includes(t)) targets.push(t);
        }
      }
    } catch (_) { /* best-effort — segue com a checagem local */ }
  }

  try {
    const cnames = (await dnsp.resolveCname(host).catch(() => [])).map((c) => c.toLowerCase().replace(/\.$/, ''));
    const matched = cnames.find((c) => targets.includes(c));
    // IPs de TODOS os alvos aceitos — apex com CNAME flattening resolve como A,
    // e provedores com round-robin de IPs quebravam a comparação contra um só alvo.
    const targetIps = (await Promise.all(targets.map((t) => dnsp.resolve4(t).catch(() => [])))).flat();
    if (matched) {
      out.dnsOk = true;
      out.dnsDetail = 'CNAME → ' + matched;
    } else {
      const hostIps = await dnsp.resolve4(host).catch(() => []);
      if (hostIps.length && targetIps.length && hostIps.some((ip) => targetIps.includes(ip))) {
        out.dnsOk = true;
        out.dnsDetail = 'A → ' + hostIps.join(', ');
      } else if (out.providerVerified) {
        // a hospedagem já validou o apontamento; resolvers daqui só não refletem ainda
        out.dnsOk = true;
        out.dnsDetail = 'DNS validado pela hospedagem — propagação/flattening em curso nos resolvers públicos';
      } else if (!hostIps.length && !cnames.length) {
        // Item 175: o resolver local não vê o registro — checar via DoH (resolvers
        // públicos) antes de dizer "não resolve". Se o CNAME/A já aparece lá, é
        // propagação em curso, não erro de configuração.
        const [dohCn, dohA] = await Promise.all([
          dohResolve(host, 5).catch(() => []),
          dohResolve(host, 1).catch(() => []),
        ]);
        const dohPointsHere =
          dohCn.some((c) => targets.includes(c.toLowerCase())) ||
          (dohA.length && targetIps.length && dohA.some((ip) => targetIps.includes(ip)));
        if (dohPointsHere) {
          out.dnsPropagating = true;
          out.dnsDetail = 'registro já visível nos resolvers públicos (dns.google/cloudflare) apontando pra cá — propagação em curso; aguarde alguns minutos e verifique de novo';
        } else if (dohCn.length || dohA.length) {
          out.dnsDetail = 'DNS aponta para outro destino (' + (dohCn[0] || dohA.join(', ')) + ') — corrija o registro para apontar para ' + (providerTarget || appHost);
        } else {
          out.dnsDetail = 'domínio não resolve — crie o registro DNS e aguarde propagar';
        }
      } else if (hostIps.length && hostIps.some(isCloudflareIp) && !targetIps.some(isCloudflareIp)) {
        out.cloudflareProxy = true;
        out.dnsDetail = 'proxy da Cloudflare ativo (nuvem laranja) — edite o registro na Cloudflare e mude para "Somente DNS" (nuvem cinza)';
      } else {
        out.dnsDetail = 'DNS aponta para outro destino (' + (cnames[0] || hostIps.join(', ')) + ') — aponte para ' + (providerTarget || appHost);
      }
    }
  } catch (e) { out.dnsDetail = 'erro na consulta DNS: ' + e.message; }

  // 2. HTTPS: o marcador deste app responde no domínio?
  // As mensagens são escritas para o LOJISTA, que só controla o DNS do domínio
  // dele — nunca citam a hospedagem interna (Railway) nem pedem ação lá. Quando
  // a ativação na hospedagem está pendente, o texto diz o que fazer NA dashboard.
  const gerenciado = !!(entry2 && entry2.providerId); // registro automático já feito
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch('https://' + host + '/__domain-check', { redirect: 'manual', signal: ctrl.signal });
    clearTimeout(t);
    if (r.status === 200) {
      const j = await r.json().catch(() => null);
      if (j && j.app === APP_CHECK_ID) { out.httpOk = true; out.httpDetail = 'HTTPS ativo e servido por este app'; }
      else out.httpDetail = 'HTTPS responde, mas é outro servidor — confira se o CNAME aponta para ' + appHost;
    } else if (r.status === 404) {
      if (out.cloudflareProxy) {
        out.httpDetail = 'HTTPS 404 — o proxy da Cloudflare (nuvem laranja) está na frente. Edite o registro DNS na Cloudflare e mude para "Somente DNS" (nuvem cinza), depois clique em Verificar de novo.';
      } else if (gerenciado) {
        out.httpDetail = 'HTTPS respondeu 404 — o DNS já chega até nós e o registro autom��tico foi feito; a ativação/SSL costuma levar alguns minutos. Aguarde e clique em Verificar de novo.';
      } else if (!domainProvider.enabled) {
        // HONESTIDADE: sem automação configurada NÃO existe "reconexão
        // automática" — dizer isso deixava o lojista clicando em Verificar
        // para sempre. out.autoProvision=false permite à UI destacar o aviso.
        out.autoProvision = false;
        out.httpDetail = 'HTTPS respondeu 404 — o DNS está certo, mas o registro automático de domínios está desligado neste servidor, então este domínio precisa ser ativado manualmente na hospedagem. Veja o aviso no topo desta aba para ligar o registro automático de vez.';
        stats.logEvent('warn', { acc: req.account.id, title: 'Domínio com DNS ok mas registro automático DESLIGADO (exige ação manual na hospedagem): ' + host });
      } else if (registroErro) {
        const motivos = {
          auth: 'a autenticação com a hospedagem está falhando (token inválido ou expirado) — o administrador precisa gerar um novo token e atualizar a variável no servidor',
          limite: 'o limite de domínios simultâneos da hospedagem foi atingido — remova um domínio não usado e clique em Verificar de novo',
          duplicado: 'este domínio já está provisionado em outro projeto/conta da hospedagem — remova-o de lá primeiro',
          offline: 'a hospedagem não respondeu agora — clique em Verificar de novo em instantes',
          falha: 'a hospedagem recusou o registro agora — clique em Verificar de novo em instantes'
        };
        out.httpDetail = 'HTTPS respondeu 404 — o DNS está certo, mas o registro automático falhou: ' + (motivos[registroErro] || motivos.falha) + '.';
        stats.logEvent('warn', { acc: req.account.id, title: 'Domínio com DNS ok aguardando registro na hospedagem (' + registroErro + '): ' + host });
      } else {
        out.httpDetail = 'HTTPS respondeu 404 — o DNS está certo, mas o provisionamento automático ainda está completando do nosso lado. Clique em Verificar de novo em alguns minutos (a reconexão é automática).';
        stats.logEvent('warn', { acc: req.account.id, title: 'Domínio com DNS ok aguardando registro na hospedagem (modo manual): ' + host });
      }
    } else out.httpDetail = 'HTTPS respondeu status ' + r.status;
  } catch (_) {
    out.httpDetail = out.dnsOk
      ? 'HTTPS ainda não responde — o certificado SSL deve estar sendo emitido. Aguarde alguns minutos e clique em Verificar de novo.'
      : 'sem resposta HTTPS — confira se o registro DNS foi criado e aguarde a propagação (pode levar de minutos a algumas horas)';
  }

  // Verificado exige a PROVA FORTE: o marcador /__domain-check deste app precisa
  // responder no domínio. Só DNS apontado não basta — na Railway o host só é
  // servido depois de adicionado como Custom Domain; sem isso os /go dão 404
  // (era o falso "Verificado" que deixava os links quebrados).
  out.ok = out.httpOk;
  out.dnsPronto = out.dnsOk && !out.httpOk; // DNS ok mas app ainda não atende
  if (out.ok) {
    const now = new Date().toISOString();
    const cur = config.get(req.account.id).customDomains || [];
    const has = cur.some((d) => d.host === host);
    // Prova forte confirmada (HTTPS + marcador) ��� status 'active' persistido,
    // além do espelho legado `verificado` para a UI antiga.
    const next = has
      ? cur.map((d) => d.host === host ? Object.assign({}, d, { verificado: true, verificadoEm: now, status: 'active', lastCheckedAt: now, lastError: null }) : d)
      : cur.concat([{ host, verificado: true, verificadoEm: now, status: 'active', lastCheckedAt: now, lastError: null, criadoEm: now }]);
    config.set(req.account.id, { customDomains: next });
  }
  res.json(out);
});

// Diagnóstico consolidado de um domínio: preflight do provider + status
// Cloudflare + DNS público + certificado apresentado via SNI + marcador HTTP —
// tudo em um JSON. Alimenta o badge de erro da aba Domínios e o suporte.
// Nunca expõe token/segredo: só estados e mensagens legíveis.
app.get('/api/custom-domains/:host/diagnostics', dashboardAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const host = normHost(req.params.host);
  if (!host) return res.status(400).json({ error: 'domínio inválido' });
  const entry = (config.get(req.account.id).customDomains || []).find((d) => d.host === host);
  if (!entry) return res.status(404).json({ error: 'domínio não cadastrado nesta conta' });

  const out = { host, checkedAt: new Date().toISOString() };

  // 1. Provider (preflight + status Cloudflare do hostname)
  try {
    out.provider = await cloudflareDomainProvider.health();
  } catch (e) { out.provider = { enabled: false, reason: e.message }; }
  if (out.provider && out.provider.enabled) {
    try {
      const st = await cloudflareDomainProvider.status(entry.providerId || null, host);
      out.cloudflare = st ? { status: st.status, sslStatus: st.sslStatus, verificationErrors: st.verificationErrors, sslErrors: st.sslErrors } : { status: 'not_found' };
    } catch (e) { out.cloudflare = { error: e.message }; }
  }

  // 2. DNS público
  try {
    const [cn, a] = await Promise.all([
      dnsp.resolveCname(host).catch(() => []),
      dnsp.resolve4(host).catch(() => []),
    ]);
    out.dns = { cname: cn, a, resolves: !!(cn.length || a.length) };
  } catch (e) { out.dns = { error: e.message }; }

  // 3. Certificado apresentado via SNI (o sintoma clássico do bug era o
  // certificado *.up.railway.app aparecendo no domínio do cliente)
  out.tls = await new Promise((resolve) => {
    try {
      const tls = require('tls');
      const socket = tls.connect({ host, port: 443, servername: host, timeout: 8000, rejectUnauthorized: false }, () => {
        const cert = socket.getPeerCertificate();
        const san = String((cert && cert.subjectaltname) || '');
        const covers = san.split(/,\s*/).some((s) => {
          const v = s.replace(/^DNS:/i, '').toLowerCase();
          return v === host || (v.startsWith('*.') && host.endsWith(v.slice(1)) && host.split('.').length === v.split('.').length);
        });
        socket.destroy();
        resolve({ ok: covers, subject: cert && cert.subject ? cert.subject.CN : null, san: san || null, covers });
      });
      socket.on('error', (e) => resolve({ ok: false, error: e.code || e.message }));
      socket.on('timeout', () => { socket.destroy(); resolve({ ok: false, error: 'timeout' }); });
    } catch (e) { resolve({ ok: false, error: e.message }); }
  });

  // 4. Marcador do app via HTTPS
  try {
    const r = await fetch('https://' + host + '/__domain-check', { redirect: 'manual', signal: AbortSignal.timeout(8000) });
    const j = r.status === 200 ? await r.json().catch(() => null) : null;
    out.http = { status: r.status, servedByThisApp: !!(j && j.app === APP_CHECK_ID) };
  } catch (e) { out.http = { error: e.name === 'TimeoutError' ? 'timeout' : e.message }; }

  // Veredito consolidado + causa mais provável (para o badge da UI)
  out.healthy = !!(out.tls && out.tls.ok && out.http && out.http.servedByThisApp);
  if (!out.healthy) {
    if (out.provider && !out.provider.enabled) out.likelyCause = 'provider: ' + (out.provider.detail || out.provider.reason || 'desativado');
    else if (out.dns && !out.dns.resolves) out.likelyCause = 'DNS não resolve — crie o registro CNAME';
    else if (out.tls && !out.tls.ok) out.likelyCause = 'certificado TLS não cobre o domínio — emissão pendente ou CNAME apontando direto para a origem';
    else if (out.http && !out.http.servedByThisApp) out.likelyCause = 'HTTPS responde mas não é este app — roteamento pendente';
    else out.likelyCause = 'verificação parcial — tente de novo em instantes';
  }
  res.json(out);
});

// ═══ Pushcut — notificações configuráveis pela dashboard (por conta) ══
app.get('/api/pushcut-config', dashboardAuth, (req, res) => {
  res.set('Cache-Control', 'no-store');
  const cfg = config.get(req.account.id);
  const pc = cfg.pushcut || {};
  res.json({
    // mascara a URL (contém o segredo do Pushcut)
    url: pc.url ? pc.url.replace(/(https:\/\/api\.pushcut\.io\/)([^/]+)/, (m, a, b) => a + '••••' + b.slice(-4)) : '',
    hasUrl: !!pc.url,
    events: Object.assign({ sale: true, failed: true, refund: true, dispute: true, checkout: false, daily: false, login: false, watchdog: false }, pc.events || {})
  });
});

app.post('/api/pushcut-config', dashboardAuth, (req, res) => {
  const b = req.body || {};
  const cur = config.get(req.account.id);
  const pc = Object.assign({}, cur.pushcut || {});
  // URL só é substituída se vier completa (não mascarada)
  if (typeof b.url === 'string' && b.url.indexOf('••••') === -1) {
    const u = b.url.trim();
    if (u === '' || /^https:\/\/api\.pushcut\.io\/.+/i.test(u)) pc.url = u.slice(0, 300);
    else return res.status(400).json({ error: 'URL inválida �� use o webhook do app Pushcut (https://api.pushcut.io/...)' });
  }
  if (b.events && typeof b.events === 'object') {
    pc.events = {};
    ['sale', 'failed', 'refund', 'dispute', 'checkout'].forEach((k) => { pc.events[k] = b.events[k] !== false; });
    ['sale', 'failed', 'refund', 'dispute', 'checkout'].forEach((k) => { if (b.events[k] === false) pc.events[k] = false; });
    pc.events.daily = b.events.daily === true; // opt-in explícito (relatório diário)
    pc.events.login = b.events.login === true; // item 442: opt-in explícito (novo login)
    pc.events.watchdog = b.events.watchdog === true; // item 464: opt-in explícito (alerta de anomalia)
  }
  config.set(req.account.id, { pushcut: pc });
  res.json({ ok: true });
});

// ── Filtro de Bots / Revisores TikTok (cloaking, por conta) ────────────────
app.get('/api/cloak-config', dashboardAuth, (req, res) => {
  res.set('Cache-Control', 'no-store');
  const c = config.get(req.account.id).cloak || {};
  res.json(Object.assign({}, botFilter.DEFAULT_CONFIG, c, {
    sensitivityThresholds: botFilter.SENSITIVITY_THRESHOLDS
  }));
});

app.post('/api/cloak-config', dashboardAuth, (req, res) => {
  const b = req.body || {};
  const cur = config.get(req.account.id).cloak || {};
  const next = Object.assign({}, cur);
  const boolKeys = ['enabled', 'blockDatacenter', 'blockHeadless', 'checkHeaders',
    'requireJsChallenge', 'checkWebgl', 'checkTimezone', 'checkBehavior', 'blockZhLang',
    'checkWebview', 'checkCoherence', 'checkEntropy'];
  boolKeys.forEach((k) => { if (typeof b[k] === 'boolean') next[k] = b[k]; });
  if (['strict', 'balanced', 'loose', 'custom'].includes(b.sensitivity)) next.sensitivity = b.sensitivity;
  if (b.threshold != null && !isNaN(Number(b.threshold))) next.threshold = Number(b.threshold);
  if (b.deadlineMs != null && !isNaN(Number(b.deadlineMs))) next.deadlineMs = Number(b.deadlineMs);
  // White page global de fallback (a sanitização do config valida o https://).
  // String vazia limpa o valor e volta a usar a página neutra embutida /_safe.
  if (typeof b.defaultWhitePage === 'string') next.defaultWhitePage = b.defaultWhitePage.trim();
  // Item 254: limites de velocity — clamp final fica no sanitizador do config.js
  if (b.velocityLimit != null && !isNaN(Number(b.velocityLimit))) next.velocityLimit = Number(b.velocityLimit);
  if (b.velocityWindowSec != null && !isNaN(Number(b.velocityWindowSec))) next.velocityWindowSec = Number(b.velocityWindowSec);
  config.set(req.account.id, { cloak: next });
  res.json({ ok: true, cloak: config.get(req.account.id).cloak });
});

// ── Regras de cloaking POR LINK (offer/white/pa��ses/pixel) ��────────────────
// Lista os links com suas regras + os pixels disponíveis para o dropdown.
app.get('/api/cloak/links', dashboardAuth, (req, res) => {
  res.set('Cache-Control', 'no-store');
  const links = linkStore.list(req.account.id).map((l) => ({
    slug: l.slug,
    nome: l.nome,
    dominio: l.dominio || null,
    ativo: l.ativo !== false,
    offerUrl: (l.variantes && l.variantes[0]) ? l.variantes[0].url : null,
    offerCount: (l.variantes || []).length,
    urlWhitePage: l.urlWhitePage || '',
    paises: Array.isArray(l.paises) ? l.paises : [],
    idiomas: Array.isArray(l.idiomas) ? l.idiomas : [],
    pixelSlug: l.pixelSlug || ''
  }));
  const pixels = pixelStore.list(req.account.id).map((p) => ({
    slug: p.slug, name: p.name, active: p.active !== false, pixelCode: !!p.pixelCode
  }));
  res.json({ links, pixels });
});

// Atualiza white page, países liberados e pixel de um link. Opcional
// syncPixel:true adiciona a rota /go/<slug> às rotas do pixel escolhido,
// sincronizando o pixel com o domínio+slug deste link.
app.post('/api/cloak/link/:slug', dashboardAuth, async (req, res) => {
  const b = req.body || {};
  const link = linkStore.get(req.account.id, req.params.slug);
  if (!link) return res.status(404).json({ error: 'Link não encontrado' });

  const patch = { slug: link.slug };
  if (typeof b.urlWhitePage === 'string') patch.urlWhitePage = b.urlWhitePage.trim();
  if (Array.isArray(b.paises)) patch.paises = b.paises;
  if (Array.isArray(b.idiomas)) patch.idiomas = b.idiomas;
  if (typeof b.pixelSlug === 'string') patch.pixelSlug = b.pixelSlug;

  let saved;
  try {
    saved = await linkStore.save(req.account.id, Object.assign({}, link, patch));
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  // Sincroniza o pixel escolhido com este link (adiciona /go/<slug> às rotas)
  let pixelSynced = false;
  if (b.syncPixel === true && saved.pixelSlug) {
    const px = pixelStore.get(req.account.id, saved.pixelSlug);
    if (px) {
      const route = '/go/' + saved.slug;
      const routes = Array.isArray(px.routes) ? px.routes.slice() : [];
      // se já cobre tudo ('*') ou já tem a rota, não duplica
      if (routes.indexOf('*') < 0 && routes.indexOf(route) < 0) {
        routes.push(route);
        try { await pixelStore.save(req.account.id, { slug: px.slug, routes }); pixelSynced = true; } catch (_) {}
      } else { pixelSynced = true; }
    }
  }

  res.json({
    ok: true, pixelSynced,
    link: {
      slug: saved.slug, urlWhitePage: saved.urlWhitePage || '',
      paises: saved.paises || [], idiomas: saved.idiomas || [], pixelSlug: saved.pixelSlug || ''
    }
  });
});

// Item 165/208: lista os perfis de simulaç��o disponíveis (metadados leves —
// não expõe headers/IPs sintéticos, só o rótulo e o veredito esperado).
app.get('/api/cloak/test/profiles', dashboardAuth, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, profiles: cloakTestProfiles.listProfilesMeta() });
});

// Testa o motor de julgamento. Por padrão usa o request ATUAL do navegador do
// admin (deve dar 'real'). Item 165/208: quando vem `profile`, roda o mesmo
// motor sobre um visitante SINTÉTICO (revisor ByteDance, headless, usuário do
// anúncio no webview, etc.) para o operador ver como cada perfil seria tratado.
app.post('/api/cloak/test', dashboardAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  // Item 178: rate-limit por conta — o judge faz lookup de ASN (DNS), então
  // limitamos a 30 testes/min para evitar abuso e custo de resolução.
  if (rateLimited('cloak-test|' + req.account.id, 'cloaktest', 30)) {
    return res.status(429).json({ ok: false, error: 'Muitos testes seguidos. Aguarde um minuto e tente de novo.', code: 'rate_limited' });
  }
  // Item 134: quando vem `slug`, simula o julgamento DAQUELE link /c/:slug —
  // usa a config do próprio entry no motor de score E reporta os gates extras
  // (mobile, ad-click, país, idioma) que decidem ANTES do score na rota real.
  const slug = req.body && req.body.slug ? String(req.body.slug).slice(0, 40) : '';
  let cloakCfg = config.get(req.account.id).cloak || {};
  let entry = null;
  if (slug) {
    entry = (config.get(req.account.id).cloakLinks || []).find((l) => l.slug === slug) || null;
    if (!entry) return res.status(404).json({ error: 'link de cloaking n��o encontrado' });
    cloakCfg = entry; // o /c/:slug passa o próprio entry como cloakCfg ao judge
  }

  // Modo simulação: monta um request sintético a partir do perfil escolhido.
  // O `evalReq` substitui o `req` em TODA leitura derivada do visitante (headers,
  // query, IP, geo, fingerprint), mantendo req.account/req.body do admin real.
  const profileId = req.body && req.body.profile ? String(req.body.profile).slice(0, 40) : '';
  let evalReq = req;
  let challengeData = {};
  let profileMeta = null;
  if (profileId) {
    const prof = cloakTestProfiles.getProfile(profileId);
    if (!prof) return res.status(404).json({ ok: false, error: 'Perfil de simulação desconhecido.', code: 'bad_profile' });
    const headers = Object.assign({}, prof.headers);
    if (prof.country) headers['x-vercel-ip-country'] = prof.country;
    if (prof.ip) headers['x-forwarded-for'] = prof.ip;
    evalReq = Object.assign(Object.create(req), {
      headers,
      query: Object.assign({}, prof.query || {}),
      socket: { remoteAddress: prof.ip || '' },
    });
    challengeData = prof.challengeData || {};
    profileMeta = { id: prof.id, label: prof.label, expected: prof.expected, hint: prof.hint };
  }

  const filterReq = Object.assign(Object.create(evalReq), { geoCountry: geoFromReq(evalReq).country || '' });
  const j = await botFilter.judge(filterReq, 'admin-test', null, challengeData, cloakCfg)
    .catch((e) => ({ verdict: 'erro', score: 0, signals: ['erro:' + e.message] }));

  // Avalia os gates pré-score do /c/:slug com o mesmo request avaliado (real ou
  // sintético) para o painel mostrar o que barraria além do score.
  let gates = null;
  if (entry) {
    const uaRaw = String(evalReq.headers['user-agent'] || '');
    const dev = uaTools.parse(uaRaw);
    const isMobile = dev.device === 'mobile' || dev.device === 'tablet';
    const ref = String(evalReq.headers['referer'] || evalReq.headers['referrer'] || '');
    const q = evalReq.query || {};
    const ttclidRaw = typeof q.ttclid === 'string' ? q.ttclid.trim() : '';
    const validTtclid = /^[A-Za-z0-9._-]{20,}$/.test(ttclidRaw);
    const isWebview = uaTools.isInAppTikTok(uaRaw);
    const fromTikTok = isWebview || /tiktok|ttwebview|musical_ly|bytedance|tiktokcdn/i.test(ref);
    const adClickOk = entry.sensitivity === 'strict' ? isWebview : (fromTikTok || validTtclid);
    const cc = String(geoFromReq(evalReq).country || '').toUpperCase();
    const lang = String(evalReq.headers['accept-language'] || '').split(',')[0].split('-')[0].trim().toLowerCase();
    gates = {
      mobile: entry.mobileOnly === false ? 'off' : (isMobile ? 'pass' : 'block'),
      adClick: entry.requireAdClick === false ? 'off' : (adClickOk ? 'pass' : 'block'),
      pais: !Array.isArray(entry.paises) || !entry.paises.length ? 'off' : (cc && entry.paises.indexOf(cc) >= 0 ? 'pass' : 'block'),
      idioma: !Array.isArray(entry.idiomas) || !entry.idiomas.length ? 'off' : (lang && entry.idiomas.indexOf(lang) >= 0 ? 'pass' : 'block'),
    };
  }

  // Item 257: previsão da camada de velocity — mostra em quantos acessos do
  // MESMO IP na janela o visitante (ainda que "real") seria mandado à white
  // por parecer device-farm. Cálculo puro: NÃO toca os contadores reais.
  const accCloak = config.get(req.account.id).cloak || {};
  const velLimit = accCloak.velocityLimit || 12;
  const velWindow = accCloak.velocityWindowSec || 60;
  const velocity = {
    limit: velLimit,
    windowSec: velWindow,
    // acessos permitidos antes de bloquear; o (limit+1)-ésimo vai para white
    blockedAtHit: velLimit + 1,
    note: `Até ${velLimit} acessos deste IP a cada ${velWindow}s passam; o acesso nº ${velLimit + 1} iria para a white page como automação.`,
  };

  res.json({
    verdict: j.verdict, score: j.score, threshold: j.threshold,
    signals: j.signals, ip: clientIp(evalReq),
    ua: String(evalReq.headers['user-agent'] || '').slice(0, 120),
    slug: slug || undefined, gates,
    profile: profileMeta, // item 165/208: eco do perfil simulado (null = request real)
    velocity, // item 257: previsão da camada anti device-farm
    // Itens 163/164/210: infraestrutura resolvida + tempo de julgamento
    asn: j.asn || 0, org: j.org || '', resolvedAt: j.resolvedAt || 0
  });
});

// ── Métricas de decisão do cloaker (offer vs white) por conta ─────────��──��─
// Devolve, por link (/go e /c), quantas visitas foram para a offer vs white,
// a taxa de bloqueio e o breakdown por motivo (bot-ua, pais, idioma, score,
// rate-limit). Alimenta o painel white/offer da aba Filtro de Bots.
app.get('/api/cloak/stats', dashboardAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const acc = req.account.id;

  // Junta os dois tipos de link protegido: checkout (/go/<slug>) e cloak (/c/<slug>)
  const goLinks = linkStore.list(acc).map((l) => ({ tipo: 'go', slug: l.slug, nome: l.nome, key: l.slug }));
  const ckLinks = (config.get(acc).cloakLinks || []).map((l) => ({ tipo: 'cloak', slug: l.slug, nome: l.nome || l.slug, key: 'cloak:' + l.slug }));
  const all = goLinks.concat(ckLinks);

  const items = await Promise.all(all.map(async (l) => {
    const s = await redis.getCloakStats(acc, l.key).catch(() => null);
    const st = s || { offer: 0, white: 0, total: 0, offerRate: 0, reasons: {}, daily: [] };
    return {
      tipo: l.tipo, slug: l.slug, nome: l.nome,
      offer: st.offer, white: st.white, total: st.total,
      blockRate: st.total ? st.white / st.total : 0,   // taxa de bloqueio
      reasons: st.reasons, daily: st.daily
    };
  }));

  // Agregado geral da conta
  const agg = items.reduce((a, it) => {
    a.offer += it.offer; a.white += it.white; a.total += it.total;
    Object.keys(it.reasons || {}).forEach((r) => { a.reasons[r] = (a.reasons[r] || 0) + it.reasons[r]; });
    return a;
  }, { offer: 0, white: 0, total: 0, reasons: {} });
  agg.blockRate = agg.total ? agg.white / agg.total : 0;

  // Item 201: quantos visitantes estão em cache como bot AGORA (sticky 6h).
  // Item 203: quantos acessos foram barrados por replay de ttclid (30d).
  const [sticky, ttclidReplays] = await Promise.all([
    redis.countStickyBots().catch(() => ({ available: false, count: 0 })),
    redis.getTtclidReplayCount(acc).catch(() => 0)
  ]);

  res.json({
    ok: true, redis: redis.enabled, aggregate: agg, links: items, sticky, ttclidReplays,
    // Item 209: se nunca chegou beacon do challenge, o snippet /t.js não está
    // instalado nas páginas — as camadas D–H do julgamento ficam inertes.
    challenge: { beacons: _challengeBeacon.count, lastAt: _challengeBeacon.lastAt || null }
  });
});

// Item 201: limpar o veredito sticky de UM visitante (vid) para reteste.
// O sticky é unidirecional (só cacheia BOT) — limpar força o judge a re-rodar
// na próxima visita daquele v_id. Útil quando um humano real caiu no cache.
app.post('/api/cloak/sticky/clear', dashboardAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const vid = String((req.body && req.body.vid) || '').trim().slice(0, 80);
  if (!vid) return apiError(res, 400, 'Informe o v_id do visitante para limpar o veredito.', 'missing_vid');
  if (!redis.enabled) return apiError(res, 400, 'O veredito sticky só existe com Redis configurado.', 'no_redis');
  const cleared = await redis.clearStickyBot(vid);
  res.json({ ok: true, cleared });
});

// Item 222: limpar o cache de ASN de UM IP (memória + Redis) para reteste
// imediato quando o lookup ficou errado ou negativo (asn:0 por timeout).
app.post('/api/cloak/asn/clear', dashboardAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const ip = String((req.body && req.body.ip) || '').trim().slice(0, 64);
  // valida formato básico de IPv4/IPv6 antes de mexer no cache
  if (!ip || !/^[0-9a-fA-F.:]+$/.test(ip)) {
    return apiError(res, 400, 'Informe um IP válido para limpar o cache de infraestrutura.', 'bad_ip');
  }
  const cleared = await botFilter.clearAsnCache(ip);
  res.json({ ok: true, cleared });
});

// Item 256: libera um IP que caiu no limite de acessos (velocity) — ex.: um
// escritório inteiro atrás do mesmo NAT. Apaga as chaves de contagem do IP em
// todas as entradas; o próximo acesso recomeça do zero.
app.post('/api/cloak/velocity/clear', dashboardAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const ip = String((req.body && req.body.ip) || '').trim().slice(0, 64);
  if (!ip || !/^[0-9a-fA-F.:]+$/.test(ip)) {
    return apiError(res, 400, 'Informe um IP v��lido para liberar do limite de acessos.', 'bad_ip');
  }
  const cleared = await redis.clearVelocity(ip);
  stats.logEvent('info', { acc: req.account.id, title: '[cloak] limite de acessos liberado para IP', ref: ip });
  res.json({ ok: true, cleared });
});

// Zera os contadores de um link (ou de todos, se slug ausente).
app.post('/api/cloak/stats/reset', dashboardAuth, async (req, res) => {
  const acc = req.account.id;
  const key = req.body && req.body.key ? String(req.body.key).slice(0, 60) : null;
  if (key) {
    await redis.resetCloakStats(acc, key).catch(() => {});
  } else {
    const keys = linkStore.list(acc).map((l) => l.slug)
      .concat((config.get(acc).cloakLinks || []).map((l) => 'cloak:' + l.slug));
    await Promise.all(keys.map((k) => redis.resetCloakStats(acc, k).catch(() => {})));
  }
  res.json({ ok: true });
});

// Item 170: histórico das últimas N decisões de um link de cloaking (observa-
// bilidade). Multi-tenant: só o dono lê (a key sempre carrega o account_id).
// IP já vem mascarado do store — nunca expõe PII. `key` = slug do /go ou
// "cloak:<slug>" do /c (mesma convenção do /api/cloak/stats/reset).
app.get('/api/cloak/decisions', dashboardAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const acc = req.account.id;
  const key = req.query && req.query.key ? String(req.query.key).slice(0, 60) : '';
  if (!key) return res.status(400).json({ ok: false, error: 'informe key' });
  const log = await redis.getCloakDecisionLog(acc, key).catch(() => []);
  res.json({ ok: true, key, log, source: redis.enabled ? 'redis' : 'memory' });
});

// ── Links de cloaking (entidade própria, servidos em /c/:slug) ─────────────
// Diferente dos links de checkout (/go): cada link de cloaking carrega SUA
// própria configuração de proteção (interruptor, sensibilidade, camadas de
// detecção) + offer/white page + allowlists de país e idioma. Guardados no
// bloco cloakLinks da config da conta (durável no Neon + snapshot local).
const _ckSlugify = (s) => String(s || '').toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const _ckValidHttps = (u) => /^https:\/\/[^\s]+\.[^\s]+/i.test(String(u || '').trim());
// Slug ALEATÓRIO (~8 chars): a URL /c/<slug> deixa de ser previsível a partir
// do nome do link — mais difícil de adivinhar/enumerar por revisores.
const _ckRandSlug = () => Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 4);
// Extrai só o hostname de um domínio digitado (aceita com ou sem https://)
const _ckHost = (input) => {
  const s = String(input || '').trim(); if (!s) return '';
  try { return new URL(s.includes('://') ? s : 'https://' + s).hostname.toLowerCase(); } catch (_) { return ''; }
};

app.get('/api/cloak/entries', dashboardAuth, (req, res) => {
  res.set('Cache-Control', 'no-store');
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  res.json({
    entries: config.get(req.account.id).cloakLinks || [],
    baseUrl: 'https://' + host
  });
});

app.post('/api/cloak/entries', dashboardAuth, (req, res) => {
  const b = req.body || {};
  const nome = String(b.nome || '').trim();
  if (!_ckValidHttps(b.offerUrl)) return res.status(400).json({ error: 'a offer precisa ser uma URL https:// válida' });

  const cur = config.get(req.account.id).cloakLinks || [];
  // Edição: usa o slug enviado (já existe). Criação: gera slug ALEATÓRIO único.
  let slug;
  if (b.slug) {
    slug = _ckSlugify(b.slug);
  } else {
    if (!nome) return res.status(400).json({ error: 'dê um nome ao link' });
    do { slug = _ckRandSlug(); } while (cur.some((l) => l.slug === slug));
  }
  if (!slug) return res.status(400).json({ error: 'slug inválido' });

  const existing = cur.find((l) => l.slug === slug);
  const isNew = !existing;

  const entry = Object.assign({}, existing || {}, {
    slug,
    nome: nome || (existing ? existing.nome : slug),
    // Domínio personalizado (opcional): a URL do link vira https://<dominio>/c/<slug>.
    // O domínio precisa apontar (DNS) para este app para o /c/:slug responder lá.
    dominio: b.dominio !== undefined ? _ckHost(b.dominio) : (existing ? existing.dominio || '' : ''),
    offerUrl: String(b.offerUrl).trim(),
    whitePageUrl: _ckValidHttps(b.whitePageUrl) ? String(b.whitePageUrl).trim() : '',
    enabled: typeof b.enabled === 'boolean' ? b.enabled : (existing ? existing.enabled : true),
    // Novos gates (default LIGADO, inclusive retroativo para links antigos):
    mobileOnly: typeof b.mobileOnly === 'boolean' ? b.mobileOnly : (existing ? existing.mobileOnly !== false : true),
    requireAdClick: typeof b.requireAdClick === 'boolean' ? b.requireAdClick : (existing ? existing.requireAdClick !== false : true),
    sensitivity: b.sensitivity,
    threshold: b.threshold,
    deadlineMs: b.deadlineMs,
    paisPreset: typeof b.paisPreset === 'string' ? b.paisPreset : (existing ? existing.paisPreset : ''),
    paises: Array.isArray(b.paises) ? b.paises : (existing ? existing.paises : []),
    idiomas: Array.isArray(b.idiomas) ? b.idiomas : (existing ? existing.idiomas : []),
    criadoEm: existing ? existing.criadoEm : new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  ['blockDatacenter', 'blockHeadless', 'checkHeaders', 'requireJsChallenge',
    'checkWebgl', 'checkTimezone', 'checkBehavior', 'blockZhLang',
    'checkWebview', 'checkCoherence', 'checkEntropy'].forEach((k) => {
    if (typeof b[k] === 'boolean') entry[k] = b[k];
  });

  const nextList = isNew ? cur.concat([entry]) : cur.map((l) => (l.slug === slug ? entry : l));
  config.set(req.account.id, { cloakLinks: nextList });
  const saved = (config.get(req.account.id).cloakLinks || []).find((l) => l.slug === slug);
  stats.logEvent('info', { acc: req.account.id, title: 'Link de cloaking salvo: ' + saved.nome, ref: saved.slug });
  res.json({ ok: true, entry: saved });
});

app.delete('/api/cloak/entries/:slug', dashboardAuth, (req, res) => {
  const slug = _ckSlugify(req.params.slug);
  const cur = config.get(req.account.id).cloakLinks || [];
  config.set(req.account.id, { cloakLinks: cur.filter((l) => l.slug !== slug) });
  stats.logEvent('info', { acc: req.account.id, title: 'Link de cloaking removido', ref: slug });
  res.json({ ok: true });
});

app.post('/api/pushcut/test', dashboardAuth, async (req, res) => {
  const ok = await sendPushcut('Aprovada', {
    title: 'Teste de notificação — ROI-NADOS',
    text: 'Se você recebeu isto, o Pushcut está configurado corretamente.\nData: ' + fmtDate(),
    sound: 'system'
  }, req.account.id);
  res.json({ ok });
});

// ── API: Web Push — notificações nativas no iPhone (PWA, sem Pushcut) ─────
const webPushNotify = require('./web-push-notify');

// Chave pública VAPID (o navegador precisa dela para se inscrever)
app.get('/api/webpush/public-key', dashboardAuth, async (_req, res) => {
  try {
    res.json({ ok: true, key: await webPushNotify.publicKey() });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'VAPID indisponível: ' + err.message });
  }
});

// Inscreve o aparelho atual (subscription vem do PushManager do navegador)
app.post('/api/webpush/subscribe', dashboardAuth, (req, res) => {
  const sub = (req.body || {}).subscription;
  if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
    return res.status(400).json({ ok: false, error: 'subscription inválida' });
  }
  const wp = config.get(req.account.id).webPush || { subs: [], funMode: true };
  const subs = (wp.subs || []).filter((s) => s.endpoint !== sub.endpoint);
  if (subs.length >= 10) return res.status(400).json({ ok: false, error: 'Máximo de 10 aparelhos por conta' });
  subs.push({
    id: crypto.randomBytes(8).toString('hex'),
    endpoint: sub.endpoint,
    keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    ua: String(req.headers['user-agent'] || '').slice(0, 120),
    createdAt: new Date().toISOString()
  });
  config.set(req.account.id, { webPush: Object.assign({}, wp, { subs }) });
  stats.logEvent('info', { acc: req.account.id, title: '[webpush] Novo aparelho inscrito para notificações' });
  res.json({ ok: true, devices: subs.length });
});

// Remove a inscrição do aparelho atual
app.post('/api/webpush/unsubscribe', dashboardAuth, (req, res) => {
  const endpoint = String((req.body || {}).endpoint || '');
  if (!endpoint) return res.status(400).json({ ok: false, error: 'endpoint obrigatório' });
  const wp = config.get(req.account.id).webPush || { subs: [] };
  const subs = (wp.subs || []).filter((s) => s.endpoint !== endpoint);
  config.set(req.account.id, { webPush: Object.assign({}, wp, { subs }) });
  res.json({ ok: true, devices: subs.length });
});

// Status: aparelhos inscritos + modo zoeira
app.get('/api/webpush/status', dashboardAuth, (req, res) => {
  const wp = config.get(req.account.id).webPush || { subs: [], funMode: true };
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, devices: (wp.subs || []).length, funMode: wp.funMode !== false });
});

// Liga/desliga a copy humorada (modo zoeira)
app.post('/api/webpush/funmode', dashboardAuth, (req, res) => {
  const wp = config.get(req.account.id).webPush || { subs: [], funMode: true };
  const funMode = (req.body || {}).funMode !== false;
  config.set(req.account.id, { webPush: Object.assign({}, wp, { funMode }) });
  res.json({ ok: true, funMode });
});

// Teste: dispara uma notificação engraçada só pelo canal Web Push
app.post('/api/webpush/test', dashboardAuth, async (req, res) => {
  const wp = config.get(req.account.id).webPush || {};
  if (!(wp.subs || []).length) return res.json({ ok: false, error: 'Nenhum aparelho inscrito ainda' });
  const note = require('./notify-copy').build({
    name: 'Teste', payload: { title: 'Teste — ROI-NADOS', text: 'Notificação de teste.' },
    meta: { event: 'test' }, funMode: wp.funMode !== false, accountId: req.account.id
  });
  const ok = await webPushNotify.sendWebPush(req.account.id, note);
  res.json({ ok });
});

// ── API: health-check — variáveis críticas + ping REAL no banco ─────
app.get('/api/health', dashboardAuth, async (req, res) => {
  // Item 263: health consolidado — além de db/redis, agrega a profundidade
  // das filas duráveis num único payload para o cabeçalho de durabilidade
  // (evita um segundo polling de /api/ops só para o badge).
  const [dbPing, redisPing, queueDepth] = await Promise.all([
    require('./db').ping(),
    rdb.ping(),
    rdb.convQueueDepth().catch(() => null)
  ]);
  res.set('Cache-Control', 'no-store');
  res.json({
    // Item 263: resumo das filas — {queue, processing} da fila de conversões
    // + tamanho da fila de retry da CAPI da conta. null = indisponível.
    queues: {
      conv: queueDepth,
      capiRetry: (ttEvents.retryQueueInfo(req.account.id) || {}).count ?? 0
    },
    conversionWebhook: !!process.env.CONVERSION_WEBHOOK_SECRET,
    tiktok:      pixelStore.list(req.account.id).some((p) => p.active && p.accessToken),
    pushcut:     !!((config.get(req.account.id).pushcut || {}).url || process.env.PUSHCUT_WEBHOOK_URL),
    dashboard:   true, // sessão obrigatória — sempre protegida
    db:          dbPing.ok,
    dbLatencyMs: dbPing.ok ? dbPing.latencyMs : null,
    // Item 249: as migrações novas (custom_domains + accounts.currency)
    // rodaram com sucesso no boot? false = boot com Neon degradado.
    migrations:  require('./db').migrationStatus(),
    redis:       redisPing.ok,
    redisEnabled:rdb.enabled,
    // Item 177: latência do julgamento do cloaker (p50/p95/deadlineRate).
    // deadlineRate alto = lookup de ASN estourando o teto (DNS lento) e o
    // sinal de datacenter escapando com frequência.
    cloakerLatency: botFilter.getJudgeLatency(),
    // Poda silenciosa (auditoria): quantos leads/eventos foram descartados do
    // cache quente por exceder o cap desde o boot. >0 em leads = cache
    // subdimensionado (dados seguem no Neon; o match usa fallback no banco).
    prune:       stats.getPruneStats(),
    uptimeSec:   Math.round(process.uptime()),
    // Item 443: versão do app para a seção "Sobre" das Configurações.
    version:     require('./package.json').version || null,
    ts: new Date().toISOString()
  });
});

// ═══ Observabilidade das filas duráveis (Leva 5, bloco I: 191–200) ════
// Expõe o que já existia no backend mas nenhuma UI mostrava: profundidade da
// fila de conversões (pendentes + em processamento), fila de retry da CAPI,
// prova de vida do worker, latência webhook→disparo, reentregas ignoradas.
// Tudo escopado por conta quando aplicável; sem PII.
app.get('/api/ops', dashboardAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const acc = req.account.id;
  const [depth, dedup, live] = await Promise.all([
    rdb.convQueueDepth(),
    rdb.getWebhookDedupCount(acc),
    presence.summary(acc)   // {online, countries, byEntry} — itens 220/226
  ]);
  // Item 220: aviso ao aproximar do teto recomendado do SCAN de presença.
  const PRESENCE_LIMIT = 500;
  res.json({
    redisEnabled: rdb.enabled, // sem Redis a fila é best-effort em memória
    convQueue: depth,                       // {queue, processing} — item 191
    reclaim: rdb.getReclaimInfo(),          // último reprocessamento — item 192
    convLatency: rdb.getConvLatency(),      // p50/p95/max webhook→disparo — item 199
    worker: rdb.getConvWorkerBeat(),        // {at, active} — item 197
    capiRetry: ttEvents.retryQueueInfo(acc),// {count, oldestAgeMs} — item 193
    webhookDedup: dedup,                    // reentregas ignoradas — item 195
    // Item 225: dedup de disparos CAPI (beacon + middleware) — o "faltou disparo"
    // que na verdade foi evitado de propósito.
    pixelDedup: { deduped: _dedupStats.deduped, sinceMs: Date.now() - _dedupStats.since },
    // Item 220/226: presença ao vivo com teto e distribuição por entrada.
    presence: {
      online: live.online,
      limit: PRESENCE_LIMIT,
      near: live.online >= PRESENCE_LIMIT * 0.9,
      byEntry: live.byEntry || []
    },
    // Item 223: cobertura do cache de ASN (hits vs lookups ao vivo).
    asnCache: botFilter.getAsnCacheStats(),
    // Item 224: TTLs efetivos das camadas de cache, para transparência técnica.
    cacheTtls: botFilter.CACHE_TTLS,
    ts: new Date().toISOString()
  });
});

// Item 194/198: forçar drenagem da fila de retry da CAPI AGORA (ignora backoff),
// só os eventos desta conta. Rate-limitado — cada disparo bate na API do TikTok.
app.post('/api/ops/drain-retry', dashboardAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (rateLimited('ops-drain|' + req.account.id, 'opsdrain', 6)) {
    return res.status(429).json({ ok: false, error: 'Aguarde um pouco antes de forçar a fila de novo.', code: 'rate_limited' });
  }
  try {
    const processed = await ttEvents.drainRetryQueue({ force: true, acc: req.account.id });
    const info = ttEvents.retryQueueInfo(req.account.id);
    res.json({ ok: true, processed: processed || 0, remaining: info.count });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'Falha ao drenar a fila.', code: 'drain_failed' });
  }
});

// Item 198: reprocessar UMA conversão do log (reenfileirar manualmente).
// Uso: o disparo CAPI falhou (erro/sem pixel) mas o pagamento é válido —
// o admin redispara sem duplicar a venda no dashboard (registerSale off).
app.post('/api/ops/reprocess-conversion', dashboardAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (rateLimited('ops-reproc|' + req.account.id, 'opsdrain', 10)) {
    return apiError(res, 429, 'Aguarde um pouco antes de reprocessar de novo.', 'rate_limited');
  }
  const id = String((req.body && req.body.id) || '').slice(0, 200);
  // Item 341: replay direto do feed — o feed só conhece o orderId (ref),
  // então aceitamos os dois; por orderId pegamos o recibo MAIS RECENTE.
  const orderId = String((req.body && req.body.orderId) || '').slice(0, 200);
  // Item 314: replay a partir do drawer do lead — lá só existe o leadId.
  // Mesmo princípio: recibo MAIS RECENTE daquele lead, escopado à conta.
  const leadId = String((req.body && req.body.leadId) || '').slice(0, 200);
  if (!id && !orderId && !leadId) return apiError(res, 400, 'Informe o id do recibo (ou orderId/leadId) a reprocessar.', 'missing_id');
  try {
    const log = await rdb.loadConversionLog(200);
    // multi-tenant: só recibos da PRÓPRIA conta (legado sem acc → só admin)
    const mine = (r) => r && (r.acc === req.account.id || (!r.acc && req.account.role === 'admin'));
    const entry = id
      ? (log || []).find((r) => mine(r) && r.id === id)
      : orderId
        ? (log || []).find((r) => mine(r) && r.orderId === orderId) // log é recente→antigo
        : (log || []).find((r) => mine(r) && r.leadId === leadId);
    if (!entry) return apiError(res, 404, 'Recibo não encontrado no log (só os 200 mais recentes podem ser reprocessados).', 'not_found');
    if (entry.teste) return apiError(res, 400, 'Recibos de teste (dry-run) não podem ser reprocessados.', 'is_test');
    // Reconstrói o envelope a partir do recibo. registerSale=false: a venda já
    // foi contabilizada no primeiro processamento — aqui só re-dispara a CAPI.
    const n = {
      acc: entry.acc || req.account.id,
      gateway: entry.gateway, event: entry.event, orderId: entry.orderId,
      amountCents: entry.amount, currency: entry.currency,
      leadId: entry.leadId || undefined,
      registerSale: false,
      _forceRedispatch: true,
      _recvAt: Date.now()
    };
    const receipt = await processConversion(n); // síncrono: devolve o recibo novo
    res.json({ ok: true, receipt });
  } catch (e) {
    apiError(res, 500, 'Falha ao reprocessar a conversão.', 'reprocess_failed');
  }
});

// Item 200: retenção dos logs — expõe os limites efetivos e permite limpar
// manualmente por aba (sempre respeitando a fronteira da conta).
const LOG_RETENTION = {
  pixelLog:  { label: 'Log de disparos CAPI',  limite: '500 entradas · 14 dias no Redis' },
  convLog:   { label: 'Log de webhooks',       limite: '200 entradas' },
  cloakLog:  { label: 'Histórico do cloaker',  limite: '50 por link · 30 dias' },
  emq:       { label: 'Série de EMQ',          limite: '40 dias por pixel' },
  // Itens 349/448: o feed de eventos é arquivado (não apagado) após a janela.
  events:    { label: 'Feed de eventos',       limite: EVENT_RETENTION_DAYS + ' dias no feed quente · histórico completo arquivado' }
};
app.get('/api/ops/retention', dashboardAuth, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, retention: LOG_RETENTION });
});
app.post('/api/ops/clear-log', dashboardAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (rateLimited('ops-clear|' + req.account.id, 'opsdrain', 6)) {
    return apiError(res, 429, 'Aguarde um pouco antes de limpar de novo.', 'rate_limited');
  }
  const scope = String((req.body && req.body.scope) || '');
  if (!LOG_RETENTION[scope]) return apiError(res, 400, 'Escopo inválido. Use pixelLog, convLog, cloakLog ou emq.', 'bad_scope');
  try {
    const acc = req.account.id;
    let removed = 0;
    if (scope === 'pixelLog') removed = await ttEvents.clearLog(acc);
    else if (scope === 'convLog') removed = await rdb.clearConversionLog(acc);
    else if (scope === 'cloakLog') {
      const slugs = (config.get(acc).cloakLinks || []).map((l) => l.slug);
      removed = await rdb.clearCloakDecisionLogs(acc, slugs);
    } else if (scope === 'emq') {
      const pixels = pixelStore.list(acc).map((p) => p.pixelCode);
      removed = await rdb.clearEmq(acc, pixels);
    }
    res.json({ ok: true, removed });
  } catch (e) {
    apiError(res, 500, 'Falha ao limpar o log.', 'clear_failed');
  }
});

// ═══ Webhook UNIVERSAL de conversões (qualquer gateway) ════��══════════
// Kiwify, Hotmart, PerfectPay, Cakto, etc.: configure a URL
//   https://<host>/api/conversion?secret=SEU_SEGREDO[&gateway=kiwify]
// no painel do gateway. O corpo é normalizado por aliases — não importa o
// formato exato que o gateway envia, desde que tenha evento + order_id.

// Mapeia o "status/evento" que cada gateway envia → evento interno.
// CompletePayment/AddPaymentInfo/InitiateCheckout vão para a CAPI do TikTok;
// Refund/Dispute/Failed só alimentam a dashboard + Pushcut (sem CAPI).
 // ── Pushcut — notificação por evento, respeitando toggles da dashboard ──
const PUSHCUT_EVENT_MAP = {
  CompletePayment: { key: 'sale', name: 'Aprovada' },
  Failed:          { key: 'failed', name: 'Recusada' },
  Refund:          { key: 'refund', name: 'Reembolso' },
  Dispute:         { key: 'dispute', name: 'Disputa' },
  InitiateCheckout:{ key: 'checkout', name: 'Checkout' },
  AddPaymentInfo:  { key: 'checkout', name: 'Checkout' }
};
// Item 429: preset de mensagem com variáveis — o dono escreve o próprio
// título de venda ("{{valor}} no {{gateway}}!") e o sistema preenche.
function applyPushcutTemplate(tpl, n, valor) {
  const vars = {
    valor,
    pais: n.countryName || n.country || '',
    produto: n.product || '',
    gateway: n.gateway || '',
    cliente: n.customer || '',
    pedido: n.orderId || ''
  };
  return String(tpl).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : '')).trim();
}

// Item 325/424: webhook de saída — cada venda aprovada é POSTada na URL que
// o dono configurou (CRM, planilha, Zapier…). Assíncrono com timeout de 8s;
// falha vira evento no feed (nunca derruba o processamento da conversão).
function fireOutboundWebhook(n) {
  try {
    const url = (config.get(n.acc).settings || {}).outboundWebhook;
    if (!url) return;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Source': 'pragmatic-flow' },
      body: JSON.stringify({
        type: 'sale', at: new Date().toISOString(),
        orderId: n.orderId, gateway: n.gateway,
        amountCents: n.amountCents, currency: n.currency,
        product: n.product || null, customer: n.customer || null,
        email: n.email || null, country: n.country || null
      }),
      signal: ctl.signal
    }).then((r) => {
      if (!r.ok) stats.logEvent('info', { acc: n.acc, title: '[webhook-saida] HTTP ' + r.status + ' ao entregar venda ' + n.orderId });
    }).catch((e) => {
      stats.logEvent('info', { acc: n.acc, title: '[webhook-saida] Falha ao entregar venda ' + n.orderId + ': ' + (e.name === 'AbortError' ? 'timeout' : e.message) });
    }).finally(() => clearTimeout(timer));
  } catch (_) { /* webhook de saída nunca derruba a conversão */ }
}

function notifyPushcut(event, n) {
  // Item 325/424: venda aprovada também dispara o webhook de saída da conta
  // (independe dos toggles do Pushcut — é outro canal).
  if (event === 'CompletePayment') fireOutboundWebhook(n);
  const map = PUSHCUT_EVENT_MAP[event];
  if (!map) return;
  const cfg = config.get(n.acc).pushcut || {};
  const events = Object.assign({ sale: true, failed: true, refund: true, dispute: true, checkout: false }, cfg.events || {});
  if (!events[map.key]) return;
  const valor = fmtMoney(n.amountCents, n.currency);
  // Item 429: preset custom só para VENDA (o caso que o dono personaliza).
  const tpl = (config.get(n.acc).settings || {}).pushcutTemplate;
  const titles = {
    sale: (map.key === 'sale' && tpl) ? (applyPushcutTemplate(tpl, n, valor) || `Venda aprovada — ${valor}`) : `Venda aprovada — ${valor}`,
    failed: `Pagamento recusado — ${valor}`,
    refund: `Reembolso — ${valor}`,
    dispute: `Disputa aberta — ${valor}`,
    checkout: `Checkout iniciado — ${n.gateway}`
  };
  sendPushcut(map.name, {
    title: titles[map.key],
    text: [
      n.customer ? `Cliente: ${n.customer}` : null,
      n.email ? `Email: ${n.email}` : null,
      n.product ? `Produto: ${n.product}` : null,
      `Gateway: ${n.gateway}`,
      `Data: ${fmtDate()}`,
      `Pedido: ${n.orderId}`
    ].filter(Boolean).join('\n'),
    sound: 'system',
    isTimeSensitive: map.key === 'sale' || map.key === 'dispute'
  }, n.acc, {
    // meta para a copy do Web Push (notify-copy): evento + dados reais.
    event: map.key,
    valor,
    produto: n.product || '',
    cliente: n.customer || '',
    gateway: n.gateway || ''
  }).catch(() => {});
}

// A normalização de payloads de gateway (flatten + aliases + tracking) vive em
// ./conversion-normalize (módulo puro e testável). Ver a tabela de params por
// gateway lá e no CLAUDE.md.

// Motor: resolve o lead no backend, enriquece, dedupa e dispara a CAPI.
// Roda SEMPRE em background (a resposta HTTP já foi enviada ao gateway).
async function processConversion(n) {
  // item 199: latência webhook→disparo (do recebimento até começar a processar)
  if (n && n._recvAt) rdb.recordConvLatency(Date.now() - n._recvAt);
  // Risco 6: a chave de dedup DEVE incluir a conta. Sem ela, duas contas com
  // gateway 'generic' e order_ids curtos ("1001") colidem e a venda da segunda
  // conta é descartada como duplicata da primeira. 'legacy' cobre o webhook
  // legado (conta padrão) de forma estável.
  const evId = (n.acc || 'legacy') + '.' + n.event + '.' + n.gateway + '.' + n.orderId;
  const receipt = {
    // Item 198: id ESTÁVEL do recibo — permite localizar a entrada no log
    // para reprocessamento manual (evId + carimbo de recebimento)
    id: evId + '.' + (n._recvAt || Date.now()),
    at: new Date().toISOString(),
    acc: n.acc || null,
    gateway: n.gateway, event: n.event, orderId: n.orderId,
    amount: n.amountCents, currency: n.currency
  };
  if (n._forceRedispatch) receipt.reprocessado = true;
  // Princípio (auditoria): nenhum evento de dinheiro pode sumir sem rastro.
  // O log da conversão (Redis) é best-effort, mas a falha NÃO pode ser
  // engolida — se o Redis está fora, precisamos saber que o recibo se perdeu.
  const logConvLogErr = (where) => (err) =>
    console.error('[server] pushConversionLog falhou (' + where + '):', err && err.message,
      '| orderId=', n.orderId, '| gateway=', n.gateway, '| acc=', n.acc);
  // Item 342: cópia auditável da conversão normalizada para o feed.
  // Whitelist (nada de flags internas) + cap de tamanho: MAX_EVENTS eventos
  // ficam em memória e no JSON persistido — raw gigante estouraria o estado.
  const rawForFeed = () => {
    try {
      const skip = { acc: 1, dryRun: 1, registerSale: 1 };
      const out = {};
      for (const k of Object.keys(n)) {
        if (k[0] === '_' || skip[k] || n[k] == null || typeof n[k] === 'function') continue;
        out[k] = n[k];
      }
      return JSON.stringify(out).length <= 2000 ? out : { orderId: n.orderId, gateway: n.gateway, event: n.event, truncado: true };
    } catch (_) { return undefined; }
  };
  try {
    // Risco 5: dedup DURÁVEL de receita ANTES do Redis. O dedup do Redis
    // abaixo expira em ~2h; um retry do gateway depois disso re-emitia a venda
    // e duplicava a receita. O registro em processed_orders (Neon, 90 dias)
    // reconhece o pedido mesmo dias depois. Só vale para a venda paga
    // (CompletePayment que registra receita); refund/dispute são eventos
    // distintos e não passam por aqui. Reprocessamento manual pula de propósito.
    if (n.event === 'CompletePayment' && n.registerSale && !n.dryRun && !n._forceRedispatch && n.orderId) {
      const fresh = await db.markOrderProcessed(n.acc || null, n.gateway, n.orderId);
      if (!fresh) {
        receipt.status = 'dedup (durável — receita já contabilizada)';
        rdb.pushConversionLog(receipt).catch(logConvLogErr('dedup-duravel'));
        return receipt;
      }
    }
    // 1. dedup — retries do gateway nunca duplicam o disparo.
    // Item 198: reprocessamento manual PULA o dedup de propósito (o admin
    // pediu o redisparo porque a CAPI falhou mas o pagamento é válido).
    if (!n._forceRedispatch && await seenPixelEvent(evId)) {
      receipt.status = 'dedup';
      rdb.pushConversionLog(receipt).catch(logConvLogErr('dedup'));
      return receipt;
    }
    // 2. resolve o lead no backend: ttclid → leadId → e-mail → telefone → órfão
    // (com n.acc definido, o match respeita a fronteira da conta)
    // Risco 3: ttclid primeiro — clique pago é a chave de match mais forte.
    let lead = n.ttclid ? stats.findLeadByTtclid(n.ttclid, n.acc) : null;
    let matchVia = lead ? 'ttclid' : null;
    if (!lead) {
      lead = n.leadId ? stats.getLead(n.leadId) : null;
      // Risco 2: fronteira ESTRITA. O guard antigo só agia quando ambos os acc
      // existiam, deixando cruzar contas quando algum era null (lead legado ou
      // n.acc não resolvido). Agora um lead só casa se a conta for EXATAMENTE a
      // mesma (null só casa com null).
      if (lead && (lead.acc || null) !== (n.acc || null)) lead = null;
      if (lead) matchVia = 'leadId';
    }
    if (!lead && n.email) { try { lead = stats.findLeadByEmail(n.email, n.acc); if (lead) matchVia = 'email'; } catch (err) { console.error('[server] findLeadByEmail falhou:', err.message, '| orderId=', n.orderId); } }
    if (!lead && n.phone) { try { lead = stats.findLeadByPhone(n.phone, n.acc); if (lead) matchVia = 'phone'; } catch (err) { console.error('[server] findLeadByPhone falhou:', err.message, '| orderId=', n.orderId); } }
    // Risco 7: fallback no Neon quando o cache em memória não casou — o
    // comprador pode ser antigo e ter sido podado do cache (cap MAX_LEADS).
    // Re-hidrata no cache para que o match e a CAPI usem a identidade real
    // em vez de tratar como órfã.
    if (!lead && (n.email || n.phone)) {
      try {
        const rows = await db.findLeadsByContact(n.acc || null, { email: n.email, phone: n.phone });
        if (rows && rows.length) {
          lead = stats.ingestLead(rows[0]);
          if (lead) matchVia = n.email ? 'email (neon)' : 'phone (neon)';
        }
      } catch (err) {
        console.error('[server] fallback findLeadsByContact falhou:', err.message, '| gateway=', n.gateway, '| orderId=', n.orderId, '| acc=', n.acc);
      }
    }
    receipt.match = matchVia || 'órfã';
    receipt.leadId = lead ? lead.id : null;

    // Teste da dashboard: valida normalização/dedup/match e loga o recibo,
    // mas NÃO mexe nas estatísticas nem dispara a CAPI de verdade.
    if (n.dryRun) {
      receipt.status = 'teste ok';
      receipt.teste = true;
      rdb.pushConversionLog(receipt).catch(logConvLogErr('teste'));
      return receipt;
    }

    // Eventos sem CAPI (Refund/Dispute/Failed): dashboard + Pushcut e encerra.
    if (n.event === 'Refund' || n.event === 'Dispute' || n.event === 'Failed') {
      const typeMap = { Refund: 'refund', Dispute: 'dispute', Failed: 'failed' };
      const titleMap = { Refund: 'Reembolso', Dispute: 'Disputa / chargeback', Failed: 'Pagamento recusado' };
      try {
        stats.logEvent(typeMap[n.event], {
          acc: n.acc || (lead && lead.acc) || null,
          title: titleMap[n.event] + ' (' + n.gateway + ')',
          amount: n.amountCents, currency: n.currency,
          customer: n.customer, email: n.email,
          gateway: n.gateway, ref: n.orderId,
          raw: rawForFeed()
        });
      } catch (_) {}
      // Item 302: recusa = cliente SUBMETEU o pagamento — conta como
      // "iniciou pagamento" no funil (se conseguimos identificar o lead)
      if (n.event === 'Failed' && lead) {
        try { stats.markPaymentStarted(lead.id); } catch (_) {}
      }
      notifyPushcut(n.event, n);
      receipt.status = 'ok (sem CAPI)';
      rdb.pushConversionLog(receipt).catch(logConvLogErr('sem-capi'));
      return receipt;
    }

    // 3. registra a venda no dashboard (só CompletePayment)
    if (n.event === 'CompletePayment' && n.registerSale) {
      const saleAcc = n.acc || (lead && lead.acc) || null;
      let matched = null;
      try {
        matched = stats.matchExternalConversion({
          acc: saleAcc,
          ttclid: n.ttclid || (lead && lead.ttclid) || null, // Risco 3: 1ª chave de match
          leadId: lead ? lead.id : null, gateway: n.gateway,
          amountCents: n.amountCents, currency: n.currency,
          customer: n.customer, email: n.email, phone: n.phone, ref: n.orderId
        });
        // Risco 1: transparência de atribuição — quantos leads casaram com o
        // contato e se pertenciam a campanhas diferentes (crédito duvidoso).
        receipt.matchCandidates = matched.matchCandidates || 1;
        receipt.matchAmbiguous = !!matched.matchAmbiguous;
        // Risco 5: em duplicata (lead já 'converted' ou 2º hit da mesma órfã),
        // NÃO re-emite o evento de venda — senão a receita conta 2×.
        if (matched._duplicate) {
          receipt.duplicate = true;
          receipt.status = 'duplicata (receita não recontada)';
        } else {
          stats.logEvent('sale', {
            acc: saleAcc,
            title: matched.orphan ? ('Venda ' + n.gateway + ' SEM lead (órfã)') : ('Venda aprovada (' + n.gateway + ')'),
            amount: n.amountCents, currency: n.currency,
            customer: n.customer, email: n.email,
            gateway: n.gateway, orphan: !!matched.orphan, ref: matched.id,
            matchAmbiguous: !!matched.matchAmbiguous, matchCandidates: matched.matchCandidates || 1,
            raw: rawForFeed()
          });
        }
      } catch (err) {
        // PIOR caso da auditoria: sem isto, a venda paga sumia do dashboard, o
        // recibo dizia "ok" e a CAPI disparava — perda de receita invisível.
        console.error('[server] matchExternalConversion falhou (venda NÃO registrada no dashboard):',
          err && err.message, '| gateway=', n.gateway, '| orderId=', n.orderId, '| acc=', saleAcc,
          '| email=', n.email || '—');
        receipt.saleError = String((err && err.message) || err).slice(0, 200);
        // deixa rastro NO FEED: o operador vê que houve uma venda não contabilizada.
        try {
          stats.logEvent('info', {
            acc: saleAcc,
            title: '[erro] venda paga não registrada no dashboard: ' + ((err && err.message) || 'erro'),
            gateway: n.gateway, ref: n.orderId,
            amount: n.amountCents, currency: n.currency,
            moneyPathError: true
          });
        } catch (e2) {
          console.error('[server] logEvent do erro de venda também falhou:', e2 && e2.message, '| orderId=', n.orderId);
        }
      }
      // Atribuição ao link/variante que originou o clique (teste A/B).
      // Risco 5: duplicata NÃO reconta a conversão do teste A/B.
      try {
        if (lead && lead.linkSlug && !(matched && matched._duplicate)) {
          linkStore.recordConversion(saleAcc, lead.linkSlug, lead.linkVariant, n.amountCents, n.currency);
          receipt.link = lead.linkSlug;
        }
      } catch (err) {
        console.error('[server] linkStore.recordConversion falhou (atribuição A/B perdida):',
          err && err.message, '| link=', lead && lead.linkSlug, '| orderId=', n.orderId, '| acc=', saleAcc);
      }
      notifyPushcut('CompletePayment', n);
    } else if (n.event === 'InitiateCheckout' || n.event === 'AddPaymentInfo') {
      // PIX gerado / checkout iniciado no gateway: avança o estágio do lead
      // no funil e salva email/telefone/nome — essenciais para casar a
      // conversão paga que chega depois (match por e-mail/telefone)
      if (lead) {
        try {
          stats.recordCheckoutEntry(lead.id, n.gateway, {
            acc: n.acc || lead.acc || undefined,
            email: n.email || undefined,
            phone: n.phone || undefined,
            customer: n.name || undefined,
            ttclid: n.ttclid || undefined, // Risco 3: mantém o clique pago coerente
            paymentStarted: true // item 302: veio do GATEWAY, não do hit de página
          });
        } catch (_) {}
      }
      notifyPushcut(n.event, n);
    }
    // 4. dispara a CAPI com o MÁXIMO de sinal: identidade do lead do backend.
    // _trusted: origem = gateway (webhook/api de conversão) → libera a trava
    // gateway-only para eventos monetários (CompletePayment/AddPaymentInfo…).
    const r = await ttEvents.dispatchToAll(n.event, {
      _trusted: true,
      eventId: evId,
      email: n.email || (lead && lead.email) || undefined,
      phone: n.phone || (lead && lead.phone) || undefined,
      leadId: lead ? lead.id : undefined,            // external_id = hash do v_id
      externalId: lead ? undefined : (n.email || n.orderId),
      ip: (lead && lead.ip) || undefined,
      userAgent: (lead && lead.ua) || undefined,
      ttclid: (lead && lead.ttclid) || undefined,
      ttp: (lead && lead.ttp) || undefined,
      url: (lead && lead.ttUrl) || undefined,
      value: n.amountCents ? n.amountCents / 100 : undefined,
      currency: n.currency,
      fallbackCurrency: n.acc ? accountCurrency(n.acc) : undefined,
      contents: n.product ? [{
        // content_id derivado do nome (slug estável) — TikTok usa para catálogo/otimização
        content_id: String(n.product).toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 100),
        content_name: String(n.product).slice(0, 100),
        price: n.amountCents ? n.amountCents / 100 : undefined,
        quantity: 1
      }] : undefined
    }, '*', n.acc || (lead && lead.acc) || null);
    const errs = (r.results || []).filter((x) => x && (x.error || (x.code != null && x.code !== 0))).length;
    receipt.status = r.dispatched === 0 ? 'sem pixel' : (errs ? ('erro em ' + errs + '/' + r.dispatched) : 'ok');
    // Não deixa o recibo dizer "ok" se a venda não foi contabilizada (o match
    // acima falhou): o status carrega a ressalva para não enganar o operador.
    if (receipt.saleError) receipt.status += ' — VENDA NÃO CONTABILIZADA (' + receipt.saleError + ')';
    receipt.dispatched = r.dispatched;
  } catch (err) {
    receipt.status = 'erro';
    receipt.error = String(err.message || err).slice(0, 200);
    // Caminho do dinheiro: falha ao processar a conversão não pode sumir.
    console.error('[server] processConversion falhou:', err && err.message,
      '| event=', n.event, '| gateway=', n.gateway, '| orderId=', n.orderId, '| acc=', n.acc);
  }
  rdb.pushConversionLog(receipt).catch(logConvLogErr('final'));
  return receipt;
}

// ── Ponte DURÁVEL entre o webhook e o processamento ────────────────────────
// Em vez de processar em background logo após o 200 (perde a venda se o
// processo reiniciar no meio), a conversão é GRAVADA no Redis primeiro. Um
// worker consome e confirma; um crash no meio deixa o item na fila e ele é
// reprocessado (idempotente via dedup). Sem Redis, cai no comportamento antigo
// (processa inline) — funciona, só não sobrevive a restart.
function submitConversion(n) {
  if (n && !n._recvAt) n._recvAt = Date.now(); // item 199: carimbo de recebimento
  // Caminho do dinheiro: qualquer falha no processamento inline precisa deixar
  // rastro (senão a venda some sem nenhuma pista de que existiu).
  const onProcErr = (where) => (err) =>
    console.error('[server] submitConversion/processConversion falhou (' + where + '):', err && err.message,
      '| event=', n && n.event, '| gateway=', n && n.gateway, '| orderId=', n && n.orderId);
  if (rdb.enabled) {
    rdb.enqueueConversion(n).then((ok) => {
      // se o enqueue falhar (Redis instável), processa inline como rede de segurança
      if (!ok) processConversion(n).catch(onProcErr('fallback-inline'));
    }).catch((err) => {
      console.error('[server] enqueueConversion falhou, processando inline:', err && err.message,
        '| orderId=', n && n.orderId);
      processConversion(n).catch(onProcErr('enqueue-rejeitado'));
    });
  } else {
    processConversion(n).catch(onProcErr('sem-redis'));
  }
}

// Worker: consome a fila durável de conversões. Lock distribuído garante que,
// com várias instâncias, só UMA drena por ciclo (evita disparo duplicado).
let _convWorkerBusy = false;
async function convWorkerTick() {
  if (!rdb.enabled || _convWorkerBusy) return;
  _convWorkerBusy = true;
  rdb.heartbeatConvWorker(); // item 197: prova de vida do drain worker
  try {
    if (!(await rdb.acquireLock('convWorker', 25))) return; // outra instância já drena
    const batch = await rdb.reserveConversions(25);
    for (const item of batch) {
      const n = item.env && item.env.n;
      if (!n) { await rdb.ackConversion(item.raw); continue; } // item corrompido → descarta
      try { await processConversion(n); } catch (_) {}
      await rdb.ackConversion(item.raw); // dedup cobre reprocesso; ack sempre
    }
  } catch (_) {} finally {
    _convWorkerBusy = false;
    rdb.releaseLock('convWorker').catch(() => {});
  }
}
if (rdb.enabled) {
  // drena a cada 2s (baixa latência para a venda aparecer na dashboard)
  const _cw = setInterval(() => { convWorkerTick().catch(() => {}); }, 2000);
  if (_cw.unref) _cw.unref();
  // requeue de itens presos (worker morto no meio) a cada 60s, idade > 120s
  const _cr = setInterval(() => { rdb.reclaimConversions(120000).catch(() => {}); }, 60000);
  if (_cr.unref) _cr.unref();
  // no boot, recupera imediatamente qualquer item deixado por um restart anterior
  setTimeout(() => { rdb.reclaimConversions(0 + 1).then(() => convWorkerTick()).catch(() => {}); }, 4000).unref();
}

// ── Quarentena de webhooks REJEITADOS (prioridade #1 do handoff) ───────────
// Guarda o PAYLOAD CRU + headers de qualquer webhook rejeitado ANTES de
// responder o erro. Sem isso, a evidência era destruída (só os nomes das
// chaves iam para o log) e nenhum erro futuro podia ser diagnosticado.
// Best-effort e NÃO-bloqueante: nunca pode atrasar/derrubar a resposta ao gateway.
function quarantineWebhook(req, route, reason, gatewayHint, accountId) {
  try {
    const h = (req && req.headers) || {};
    // headers úteis para diagnóstico, SEM cookie/authorization (não vaza sessão)
    const safeHeaders = {};
    Object.keys(h).forEach((k) => {
      const kl = String(k).toLowerCase();
      if (kl === 'cookie' || kl === 'authorization') return;
      safeHeaders[k] = String(h[k]).slice(0, 300);
    });
    // corpo cru: prioriza o texto EXATO recebido (req.rawBody); cai no parseado.
    // Guarda o texto original quando não for JSON válido (form-urlencoded etc.).
    let raw = null;
    if (req && req.rawBody) {
      try { raw = JSON.parse(req.rawBody); }
      catch (_) { raw = { _rawText: String(req.rawBody).slice(0, 8000) }; }
    }
    if (raw == null) raw = (req && req.body != null) ? req.body : null;
    db.insertQuarantine({
      accountId: accountId || null,
      route: route,
      rawPayload: raw,
      headers: safeHeaders,
      rejectionReason: reason,
      gatewayHint: gatewayHint || null
    }).catch(() => {});
  } catch (_) { /* a quarentena NUNCA pode quebrar o webhook */ }
}

// Endpoint público que os gateways chamam.
app.post('/api/conversion', (req, res) => {
  const secret = process.env.CONVERSION_WEBHOOK_SECRET;
  if (!secret) {
    // nunca fica aberto sem segredo — instrui em vez de aceitar
    return res.status(503).json({ ok: false, error: 'defina CONVERSION_WEBHOOK_SECRET no servidor' });
  }
  const provided = req.headers['x-webhook-secret'] || req.query.secret || '';
  if (!provided || !safeEqual(String(provided), secret)) {
    // Quarentena: guarda o payload cru mesmo quando o segredo global não bate.
    quarantineWebhook(req, '/api/conversion', 'segredo inválido', String(req.query.gateway || ''), _defaultAccountId);
    return res.status(401).json({ ok: false, error: 'segredo inválido' });
  }
  const n = normalizeConversion(req.body, req.query);
  if (n.error) {
    // registra a falha no log de conversões — sem isso o gateway recebe 400
    // em silêncio e a dashboard parece "não puxar" os valores
    rdb.pushConversionLog({
      at: new Date().toISOString(),
      gateway: String(req.query.gateway || 'desconhecido').toLowerCase().slice(0, 30),
      event: 'formato inválido',
      status: 'erro',
      error: n.error,
      keys: Object.keys(req.body || {}).slice(0, 20).join(',').slice(0, 300)
    }).catch(() => {});
    // Quarentena: o corpo cru é preservado para descobrir onde está o valor.
    quarantineWebhook(req, '/api/conversion', n.error, String(req.query.gateway || ''), _defaultAccountId);
    return res.status(400).json({ ok: false, error: n.error });
  }
  // Risco 2: o webhook legado depende da conta padrão para ter uma fronteira.
  // Se ela não resolveu (_defaultAccountId null), processar significaria rodar
  // SEM dono — e um match por leadId/e-mail poderia cruzar contas. Recusamos
  // com 503 (o gateway reenvia) em vez de processar sem fronteira.
  if (!_defaultAccountId) {
    quarantineWebhook(req, '/api/conversion', 'conta padrão indisponível — webhook recusado', String(req.query.gateway || ''), null);
    return res.status(503).json({ ok: false, error: 'conta indisponível, tente novamente' });
  }
  // resposta IMEDIATA — nenhum gateway sofre timeout esperando a CAPI
  res.json({ ok: true, event: n.event, gateway: n.gateway, orderId: n.orderId });
  // legado (sem conta no token): atribui à conta padrão
  n.acc = _defaultAccountId;
  submitConversion(n);
});

// ═══ Webhook DEDICADO por gateway (multi-tenant): POST /hook/:token ═══
// Cada gateway cadastrado na dashboard tem um token ��nico que identifica
// a CONTA e o PROVIDER — cole a URL no painel do gateway e pronto.
// Suporta assinatura por provider (Stripe whsec, Hotmart hottok, Kiwify
// signature) e adapta payloads específicos antes do normalizador genérico.
app.post('/hook/:token', async (req, res) => {
  const token = String(req.params.token || '').slice(0, 64);
  // Item 46: rate-limit por token — 120/janela é folgado para gateways reais
  // (retries inclusos) mas corta flood/brute-force de token. Respondemos 429
  // sem detalhe para não confirmar se o token existe.
  if (rateLimited('hook|' + token, 'hook', 120)) {
    return res.status(429).json({ ok: false });
  }
  const gw = gatewayStore.findByToken(token);
  if (!gw) return res.status(404).json({ ok: false, error: 'webhook não encontrado' });

  // 1. autentica conforme o provider (token da URL já é um segredo forte)
  const sig = gatewayStore.verifySignature(gw, req);
  if (!sig.ok) {
    gatewayStore.touch(gw.id, 'assinatura inválida');
    rdb.pushConversionLog({
      at: new Date().toISOString(), acc: gw.accountId,
      gateway: gw.provider, event: 'rejeitado', status: 'erro', error: sig.reason
    }).catch(() => {});
    // Quarentena: guarda o payload cru para inspeção mesmo com assinatura ruim.
    quarantineWebhook(req, '/hook/:token', sig.reason || 'assinatura inválida', gw.provider, gw.accountId);
    return res.status(401).json({ ok: false, error: sig.reason });
  }

  // 2. adapta payload específico do provider → normalizador genérico
  const adapted = gatewayStore.adaptPayload(gw.provider, req.body);
  const n = normalizeConversion(adapted, { gateway: gw.provider, amountInCents: !!(gw.config && gw.config.amountInCents) });
  if (n.error) {
    gatewayStore.touch(gw.id, 'formato inválido');
    rdb.pushConversionLog({
      at: new Date().toISOString(), acc: gw.accountId,
      gateway: gw.provider, event: 'formato inválido', status: 'erro',
      error: n.error, keys: Object.keys(req.body || {}).slice(0, 20).join(',').slice(0, 300)
    }).catch(() => {});
    // Quarentena: preserva o corpo cru — é aqui que descobrimos o alias do valor.
    quarantineWebhook(req, '/hook/:token', n.error, gw.provider, gw.accountId);
    return res.status(400).json({ ok: false, error: n.error });
  }

  // 3. idempotência por order_id (item 45): gateways REENVIAM webhooks em
  // retry — o mesmo pedido não pode disparar CompletePayment duas vezes.
  // Responde 200 mesmo assim (o gateway precisa parar de reenviar).
  const dup = await rdb.seenWebhookOrder(gw.accountId, n.event, n.orderId).catch(() => false);
  if (dup) {
    rdb.bumpWebhookDedup(gw.accountId).catch(() => {}); // item 195
    gatewayStore.touch(gw.id, 'reentrega ignorada: ' + n.event);
    rdb.pushConversionLog({
      at: new Date().toISOString(), acc: gw.accountId,
      gateway: gw.provider, event: n.event, status: 'duplicado',
      orderId: n.orderId, error: 'reentrega do gateway ignorada (mesmo order_id em 24h)'
    }).catch(() => {});
    return res.json({ ok: true, event: n.event, gateway: gw.provider, orderId: n.orderId, deduplicated: true });
  }

  // 4. resposta imediata + processamento em background NA CONTA DO GATEWAY
  res.json({ ok: true, event: n.event, gateway: gw.provider, orderId: n.orderId });
  n.acc = gw.accountId;
  n.gatewayId = gw.id;
  gatewayStore.touch(gw.id, 'ok: ' + n.event);
  submitConversion(n);
});

// ═══ CRUD de gateways (dashboard, por conta) ══════════════════════════
app.get('/api/gateways', dashboardAuth, (req, res) => {
  res.set('Cache-Control', 'no-store');
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  res.json({
    providers: Object.keys(gatewayStore.PROVIDERS).map((k) => ({
      id: k,
      label: gatewayStore.PROVIDERS[k].label,
      secretLabel: gatewayStore.PROVIDERS[k].secretLabel,
      docs: gatewayStore.PROVIDERS[k].docs
    })),
    gateways: gatewayStore.list(req.account.id).map((g) => ({
      id: g.id, provider: g.provider, name: g.name,
      webhookUrl: proto + '://' + host + '/hook/' + g.webhookToken,
      hasSecret: !!g.secret,
      amountInCents: !!(g.config && g.config.amountInCents), // valor já vem em centavos
      lastEventAt: g.lastEventAt, lastEventStatus: g.lastEventStatus,
      createdAt: g.createdAt
    }))
  });
});

app.post('/api/gateways', dashboardAuth, async (req, res) => {
  try {
    // Nome único por conta (item 109): dois "Stripe" id��nticos confundem o
    // log e a escolha do webhook. A checagem ignora o próprio registro na edição.
    const body = req.body || {};
    const nome = String(body.name || '').trim();
    if (nome) {
      const clash = gatewayStore.list(req.account.id)
        .find((g) => g.name.toLowerCase() === nome.toLowerCase() && g.id !== body.id);
      if (clash) return res.status(400).json({ error: 'já existe um gateway com este nome — escolha outro para diferenciá-los' });
    }
    const saved = await gatewayStore.save(req.account.id, req.body || {});
    stats.logEvent('info', { acc: req.account.id, title: 'Gateway salvo: ' + saved.name + ' (' + saved.provider + ')' });
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
    res.json({
      ok: true,
      gateway: {
        id: saved.id, provider: saved.provider, name: saved.name,
        webhookUrl: proto + '://' + host + '/hook/' + saved.webhookToken,
        hasSecret: !!saved.secret
      }
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/gateways/:id', dashboardAuth, async (req, res) => {
  const ok = await gatewayStore.remove(req.account.id, String(req.params.id || ''));
  if (!ok) return res.status(404).json({ error: 'gateway não encontrado' });
  stats.logEvent('info', { acc: req.account.id, title: 'Gateway removido', ref: req.params.id });
  res.json({ ok: true });
});

// Rotaciona o webhook token (item 100): a URL antiga PARA de funcionar —
// use quando a URL vazou ou para invalidar um checkout antigo.
app.post('/api/gateways/:id/rotate', dashboardAuth, async (req, res) => {
  try {
    const g = await gatewayStore.rotateToken(req.account.id, String(req.params.id || ''));
    if (!g) return res.status(404).json({ error: 'gateway não encontrado' });
    stats.logEvent('warn', { acc: req.account.id, title: 'Webhook do gateway rotacionado: ' + g.name });
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
    res.json({ ok: true, webhookUrl: proto + '://' + host + '/hook/' + g.webhookToken });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err).slice(0, 200) });
  }
});

// Teste POR GATEWAY (itens 34/101/152): simula um webhook naquele token,
// percorrendo o MESMO fluxo real (assinatura → adaptação → normalização →
// dry-run) e devolve o resultado estruturado, inclusive da assinatura.
app.post('/api/gateways/:id/test', dashboardAuth, async (req, res) => {
  try {
    const g = gatewayStore.get(req.account.id, String(req.params.id || ''));
    if (!g) return res.status(404).json({ error: 'gateway não encontrado' });
    // Verificação de assinatura: como o teste vem do painel (sem headers do
    // provider), com segredo configurado avisamos que o teste pula a assinatura
    const signatureNote = g.secret
      ? 'este gateway tem segredo configurado — o teste do painel valida o fluxo do payload, mas a assinatura só é conferida em webhooks reais do provedor'
      : 'sem segredo configurado — o token da URL é a autenticação';
    const cur = accountCurrency(req.account.id);
    const amountInCents = !!(g.config && g.config.amountInCents);
    const adapted = gatewayStore.adaptPayload(g.provider, g.provider === 'stripe' ? {
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_teste_' + Date.now().toString(36), amount_total: 100, currency: cur.toLowerCase(), customer_details: { email: 'teste@webhook.local', name: 'Teste do Painel' } } }
    } : {
      event: 'paid',
      order_id: 'teste_' + Date.now().toString(36),
      // reflete o formato real do gateway: em centavos (100) ou unidade ('1.00')
      amount: amountInCents ? 100 : '1.00',
      currency: cur,
      email: 'teste@webhook.local',
      name: 'Teste do Painel',
      product: 'Disparo de teste'
    });
    const n = normalizeConversion(adapted, { gateway: g.provider, amountInCents });
    if (n.error) return res.status(400).json({ ok: false, error: n.error, signatureNote });
    n.dryRun = true;
    n.acc = req.account.id;
    n.gatewayId = g.id;
    const receipt = await processConversion(n);
    res.json({ ok: true, gateway: { id: g.id, name: g.name, provider: g.provider }, signatureNote, receipt });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err).slice(0, 200) });
  }
});

// Teste do webhook direto da dashboard (protegido): injeta um payload de
// exemplo no MESMO fluxo real (normaliza → processa) e devolve o recibo na
// hora — confere status/match sem sair da tela e sem depender do gateway.
app.post('/api/conversion/test', dashboardAuth, async (req, res) => {
  try {
    // Item 178: rate-limit por conta — dispara CAPI + Pushcut reais.
    if (rateLimited('conv-test|' + req.account.id, 'convtest', 15)) {
      return res.status(429).json({ ok: false, error: 'Muitos disparos de teste seguidos. Aguarde um minuto e tente de novo.', code: 'rate_limited' });
    }
    const bodyCur = String((req.body || {}).currency || '').toUpperCase();
    const cur = /^[A-Z]{3}$/.test(bodyCur) ? bodyCur : accountCurrency(req.account.id);
    const n = normalizeConversion({
      event: 'paid',
      order_id: 'teste_' + Date.now().toString(36),
      amount: '1.00',
      currency: cur,
      email: 'teste@webhook.local',
      name: 'Teste da Dashboard',
      product: 'Disparo de teste'
    }, { gateway: 'teste' });
    if (n.error) return res.status(400).json({ ok: false, error: n.error });
    // dry-run: percorre o fluxo real (dedup, match, log) mas NÃO registra
    // venda nas estatísticas nem dispara a CAPI de verdade
    n.dryRun = true;
    n.acc = req.account.id;
    const receipt = await processConversion(n);   // aguarda para devolver o recibo
    res.json({ ok: true, receipt });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err).slice(0, 200) });
  }
});

// Log dos webhooks recebidos (painel, aba Pixels). Protegido por dashboardAuth;
// devolve o segredo para o painel montar a URL de configuração do gateway.
// Filtra por conta: cada usuário só vê os webhooks dos SEUS gateways.
app.get('/api/conversion/log', dashboardAuth, async (req, res) => {
  const log = await rdb.loadConversionLog(200);
  const own = (log || []).filter((r) => !r.acc || r.acc === req.account.id).slice(0, 50);
  res.json({
    configured: !!process.env.CONVERSION_WEBHOOK_SECRET,
    secret: req.account.role === 'admin' ? (process.env.CONVERSION_WEBHOOK_SECRET || '') : '',
    log: own
  });
});

// ── Quarentena de webhooks rejeitados (item handoff #1) ────────────────────
// Lista os payloads crus dos webhooks recusados para inspeção no "Diagnóstico
// avançado". Escopo por conta; admin também vê os itens legados (sem account_id).
app.get('/api/conversion/quarantine', dashboardAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const isAdmin = req.account.role === 'admin';
  const includeResolved = String(req.query.all || '') === '1';
  try {
    const items = await db.listQuarantine(req.account.id, isAdmin, { includeResolved, limit: 100 });
    const pending = await db.countQuarantine(req.account.id, isAdmin);
    res.json({ ok: true, enabled: db.enabled, pending, items });
  } catch (e) {
    apiError(res, 500, 'Falha ao carregar a quarentena.', 'quarantine_failed');
  }
});

// Marca um item da quarentena como resolvido (some da lista padrão).
app.post('/api/conversion/quarantine/resolve', dashboardAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const id = Number((req.body && req.body.id) || 0);
  if (!id) return apiError(res, 400, 'Informe o id do item a resolver.', 'missing_id');
  try {
    const ok = await db.resolveQuarantine(req.account.id, req.account.role === 'admin', id);
    if (!ok) return apiError(res, 404, 'Item não encontrado na sua quarentena.', 'not_found');
    res.json({ ok: true });
  } catch (e) {
    apiError(res, 500, 'Falha ao resolver o item.', 'resolve_failed');
  }
});

// ���─ API: zerar estatísticas ─────���───────���──────────────────────���─────
// ═══ TikTok multi-pixel ══════════════════════════���══════════════════��═
// ── /px.js: loader dinâmico do pixel — as páginas só referenciam ESTE
// script; o servidor injeta todos os pixels ativos da rota. Adicionar ou
// editar um pixel (arquivo em pixels/ ou painel) atualiza todas as p��ginas.
// Snippet oficial (stub) do ttq — idempotente: reaproveita window.ttq se já
// existir. Usado tanto no snippet NATIVO inline (recomendado no <head>) quanto
// como fallback nos scripts servidos por nós, para instalações de tag única.
const TTQ_STUB = '!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie","holdConsent","revokeConsent","grantConsent"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e},ttq.load=function(e,n){var r="https://analytics.tiktok.com/i18n/pixel/events.js",o=n&&n.partner;ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=r,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};n=document.createElement("script");n.type="text/javascript",n.async=!0,n.src=r+"?sdkid="+e+"&lib="+t;e=document.getElementsByTagName("script")[0];e.parentNode.insertBefore(n,e)}}(window,document,"ttq");';

app.get('/px.js', (req, res) => {
  // Cache PRIVADO (nunca compartilhado): o script embute dados do visitante
  // (external_id + event_id com o v_id), então não pode ser servido a outro
  // visitante. `private` mantém no cache do PRÓPRIO navegador; max-age=300
  // elimina o roundtrip por pageview; stale-while-revalidate=3600 permite usar
  // a cópia antiga (mesmo se o nosso servidor cair) enquanto revalida em 2º
  // plano. O ETag abaixo torna a revalidação barata (304 sem corpo).
  res.set({ 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'private, max-age=300, stale-while-revalidate=3600' });
  // rota da página que pediu o script (Referer) — decide QUAIS pixels carregar
  let route = '/';
  try { route = new URL(req.headers.referer || 'https://x/').pathname || '/'; } catch (_) {}
  if (req.query.p) route = String(req.query.p);

  const pixels = pixelStore.forRoute(publicAccountId(req), route);
  if (!pixels.length) return res.send('/* nenhum pixel ativo para esta rota */');

  const vId = readCookie(req, 'v_id') || '';
  const extId = vId ? ttEvents.externalIdFromLead(vId) : '';
  const hk = hourKey();
  const isCheckout = route.indexOf('/checkout') === 0;

  // eventos do navegador com event_id DETERMINÍSTICO (= mesmo id do servidor → dedup)
  const evs = [];
  if (vId && pixels.some((px) => px.events.ViewContent)) {
    evs.push({ n: 'ViewContent', id: 'ViewContent.' + vId + '.' + hk });
  }
  if (vId && isCheckout && pixels.some((px) => px.events.InitiateCheckout)) {
    evs.push({ n: 'InitiateCheckout', id: 'InitiateCheckout.' + vId + '.' + hk });
  }

  const js = [
    // Resiliência: só inicializa/carrega o ttq se ele ainda NÃO existir. Em
    // instalações de duas partes o snippet nativo já está no <head> e este
    // bloco é pulado — o pixel nativo funciona mesmo que ESTE script (servido
    // pelo nosso domínio) não carregue. Fallback para instalações de tag única.
    'if(!window.ttq){' + TTQ_STUB + '\n' +
      pixels.map((px) => 'ttq.load(' + JSON.stringify(px.pixelCode) + ');').join('') +
      'ttq.page();}',
    // identidade: external_id = hash do id único do lead (igual ao servidor)
    extId ? 'window.ttq.identify({external_id:' + JSON.stringify(extId) + '});' : '',
    // eventos com event_id determinístico + espelho server-side via beacon
    evs.map((e) =>
      'window.ttq.track(' + JSON.stringify(e.n) + ',{},{event_id:' + JSON.stringify(e.id) + '});'
    ).join('\n'),
    // beacon: o servidor re-dispara via CAPI com o MESMO event_id (dedup),
    // acrescentando ip/ua/ttclid/_ttp — o sinal mais completo possível
    'try{',
    '  var _c=function(n){var m=document.cookie.match(new RegExp("(?:^|; )"+n+"=([^;]*)"));return m?decodeURIComponent(m[1]):null};',
    '  var _q=new URLSearchParams(location.search);',
    '  var _p={events:' + JSON.stringify(evs.map((e) => ({ n: e.n, id: e.id }))) + ',url:location.href,ttclid:_q.get("ttclid")||_c("ttclid")||null,ttp:_c("_ttp")||null};',
    '  if(_p.events.length){var _b=JSON.stringify(_p);',
    '    if(navigator.sendBeacon){navigator.sendBeacon("/api/px/event",new Blob([_b],{type:"application/json"}))}',
    '    else{fetch("/api/px/event",{method:"POST",headers:{"Content-Type":"application/json"},body:_b,keepalive:true})}',
    '  }',
    '}catch(_){}'
  ].filter(Boolean).join('\n');

  // ETag forte do conteúdo → revalidação barata (If-None-Match → 304 sem corpo)
  const etag = '"' + crypto.createHash('md5').update(js).digest('hex') + '"';
  res.set('ETag', etag);
  if (req.headers['if-none-match'] === etag) return res.status(304).end();
  res.send(js);
});

// ── /px/:token.js — SCRIPT INDIVIDUAL POR PIXEL (estilo Xtracky) ─────────
// Cada pixel tem um token único; cole em QUALQUER página (deste app ou
// externa): <script src="https://SEU-DOMINIO/px/px_xxxx.js" defer></script>
// O script carrega SÓ aquele pixel, identifica o visitante e espelha os
// eventos no servidor (CAPI) com dedup — independe de rotas configuradas.
app.get('/px/:token.js', (req, res) => {
  // Cache PRIVADO + SWR + ETag (mesma razão do /px.js: o corpo varia por
  // visitante, então nunca 'public'). Vary: Cookie garante que caches que
  // porventura ignorem 'private' ao menos segmentem pelo v_id do visitante.
  res.set({
    'Content-Type': 'application/javascript; charset=utf-8',
    'Cache-Control': 'private, max-age=300, stale-while-revalidate=3600',
    'Vary': 'Cookie',
    'Access-Control-Allow-Origin': '*'   // páginas externas podem carregar
  });
  const token = String(req.params.token || '').slice(0, 64);
  const px = pixelStore.getByToken(token);
  if (!px || px.active === false || !px.pixelCode) {
    return res.send('/* pixel não encontrado ou inativo */');
  }
  const vId = readCookie(req, 'v_id') || '';
  const extId = vId ? ttEvents.externalIdFromLead(vId) : '';
  const hk = hourKey();
  const evs = [];
  if (vId && px.events && px.events.ViewContent) {
    evs.push({ n: 'ViewContent', id: 'ViewContent.' + vId + '.' + hk });
  }

  const js = [
    // Resiliência (ver /px.js): não recarrega o ttq se o snippet nativo inline
    // já o inicializou no <head>. Se o snippet nativo estiver presente, ele
    // segue funcionando mesmo que ESTE script não carregue.
    'if(!window.ttq){' + TTQ_STUB + 'ttq.load(' + JSON.stringify(px.pixelCode) + ');ttq.page();}',
    extId ? 'window.ttq.identify({external_id:' + JSON.stringify(extId) + '});' : '',
    evs.map((e) =>
      'window.ttq.track(' + JSON.stringify(e.n) + ',{},{event_id:' + JSON.stringify(e.id) + '});'
    ).join('\n'),
    // beacon → espelho server-side (CAPI) apontando para ESTE pixel (token)
    'try{',
    '  var _c=function(n){var m=document.cookie.match(new RegExp("(?:^|; )"+n+"=([^;]*)"));return m?decodeURIComponent(m[1]):null};',
    '  var _q=new URLSearchParams(location.search);',
    '  var _p={px:' + JSON.stringify(token) + ',events:' + JSON.stringify(evs.map((e) => ({ n: e.n, id: e.id }))) + ',url:location.href,ttclid:_q.get("ttclid")||_c("ttclid")||null,ttp:_c("_ttp")||null};',
    '  if(_p.events.length){var _b=JSON.stringify(_p);',
    '    if(navigator.sendBeacon){navigator.sendBeacon("/api/px/event",new Blob([_b],{type:"application/json"}))}',
    '    else{fetch("/api/px/event",{method:"POST",headers:{"Content-Type":"application/json"},body:_b,keepalive:true})}',
    '  }',
    '}catch(_){}'
  ].filter(Boolean).join('\n');

  const etag = '"' + crypto.createHash('md5').update(js).digest('hex') + '"';
  res.set('ETag', etag);
  if (req.headers['if-none-match'] === etag) return res.status(304).end();
  res.send(js);
});

// ── Beacon do navegador → espelho server-side (CAPI) com o mesmo event_id.
app.post('/api/px/event', (req, res) => {
  // Responde IMEDIATAMENTE: sendBeacon não lê a resposta, e o disparo CAPI
  // (com dedup) segue em background — latência zero para o navegador.
  res.json({ ok: true });
  try {
    const vId = readCookie(req, 'v_id');
    const b = req.body || {};
    const events = Array.isArray(b.events) ? b.events.slice(0, 5) : [];
    if (!events.length) return;
    let route = '/';
    try { route = new URL(b.url || 'https://x/').pathname || '/'; } catch (_) {}
    const ip = clientIp(req);
    const ua = String(req.headers['user-agent'] || '').slice(0, 500);
    // guarda ttclid/_ttp no lead UMA vez (não por evento) — enriquece conversões futuras
    if (vId && (b.ttclid || b.ttp)) {
      try { stats.attachTracking(vId, { ttclid: b.ttclid || undefined, ttp: b.ttp || undefined }); } catch (_) {}
    }
    // identidade já salva no lead (email/phone do Advanced Matching, ttclid/_ttp
    // de visitas anteriores) — todo disparo sai com o sinal máximo disponível
    let leadPx = null;
    if (vId) { try { leadPx = stats.getLead(vId); } catch (_) {} }
    // b.px = token do script individual (/px/:token.js): espelha SÓ naquele
    // pixel. Sem token (loader /px.js por rota): dispatchToAll da conta.
    const tokenPixel = b.px ? pixelStore.getByToken(String(b.px).slice(0, 64)) : null;
    const acc = tokenPixel ? (tokenPixel.acc || null) : publicAccountId(req);
    // dedup + disparo em PARALELO (antes era serial: 1 roundtrip Redis por evento)
    events.forEach((e) => {
      const name = String(e.n || '').slice(0, 40);
      const evId = String(e.id || '').slice(0, 120);
      if (!name || !evId) return;
      if (!/^(ViewContent|InitiateCheckout|AddToCart)$/.test(name)) return; // whitelist
      seenPixelEvent(evId).then((seen) => {
        if (seen) return; // já disparado pelo middleware/rota
        const payload = {
          event: name,
          eventId: evId,
          leadId: vId || undefined,
          email: (leadPx && leadPx.email) || undefined,
          phone: (leadPx && leadPx.phone) || undefined,
          ip,
          userAgent: ua,
          ttclid: (b.ttclid ? String(b.ttclid).slice(0, 500) : undefined) || (leadPx && leadPx.ttclid) || undefined,
          ttp: (b.ttp ? String(b.ttp).slice(0, 500) : undefined) || (leadPx && leadPx.ttp) || undefined,
          url: b.url ? String(b.url).slice(0, 500) : undefined
        };
        if (tokenPixel) return ttEvents.sendToPixel(tokenPixel, payload);
        return ttEvents.dispatchToAll(name, payload, route, acc);
      }).catch((err) =>
        console.error('[server] beacon dispatch falhou (' + name + ' perdido):', err && err.message,
          '| evId=', evId, '| vid=', vId || '—', '| acc=', acc));
    });
  } catch (err) { console.error('[server] beacon erro inesperado:', err && err.message); }
});

// ── APIs de gestão de pixels (dashboard, por conta) ────�����─����────────────
app.get('/api/pixels', dashboardAuth, (req, res) => {
  res.set('Cache-Control', 'no-store');
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  // mascara o token na listagem (só mostra últimos 4 chars)
  const list = pixelStore.list(req.account.id).map((p) => ({
    ...p,
    accessToken: p.accessToken ? '�����••' + p.accessToken.slice(-4) : '',
    hasToken: !!p.accessToken,
    // script individual deste pixel (estilo Xtracky): cole em qualquer página
    scriptUrl: p.token ? proto + '://' + host + '/px/' + p.token + '.js' : null,
    // Instalação em DUAS PARTES (resiliência): o snippet nativo da TikTok vai
    // inline no <head> e NÃO depende do nosso servidor — se o nosso domínio
    // cair, o pixel nativo continua disparando. O nosso script (com defer)
    // apenas enriquece (external_id) e espelha via CAPI; ele detecta o ttq já
    // carregado e não o recarrega. Degradação graciosa em vez de perda total.
    // Parte 1 — RASTREAMENTO (/t.js): é o que registra a visita NA DASHBOARD
    // (funil, leads, geo, jornada). Sem ele o visitante fica invisível para o
    // operador, mesmo com o pixel disparando para o TikTok. Um por página,
    // independe de qual pixel — por isso a mesma tag em todos.
    scriptTagTracker: '<!-- 1) ROI-NADOS Rastreamento — registra a visita na SUA dashboard (funil, leads, jornada) -->\n<script src="' + proto + '://' + host + '/t.js" defer></script>',
    scriptTagNative: p.pixelCode
      ? '<!-- 2) TikTok Pixel (nativo) — cole no <head>, funciona mesmo se nosso servidor cair -->\n<script>\n' + TTQ_STUB + '\nttq.load(' + JSON.stringify(p.pixelCode) + ');\nttq.page();\n</script>'
      : null,
    scriptTagEnrich: p.token
      ? '<!-- 3) ROI-NADOS (enriquecimento + CAPI) — pode ir antes do </body> -->\n<script src="' + proto + '://' + host + '/px/' + p.token + '.js" defer></script>'
      : null,
    // Compatibilidade: scriptTag entrega o bloco COMPLETO (as TRÊS partes).
    // A parte 1 (/t.js) faltava aqui — quem instalava só o que a página mandava
    // não via as próprias visitas na dashboard.
    scriptTag: p.token && p.pixelCode
      ? '<!-- 1) ROI-NADOS Rastreamento — registra a visita na SUA dashboard (funil, leads, jornada) -->\n<script src="' + proto + '://' + host + '/t.js" defer></script>\n\n<!-- 2) TikTok Pixel (nativo) — cole no <head>, funciona mesmo se nosso servidor cair -->\n<script>\n' + TTQ_STUB + '\nttq.load(' + JSON.stringify(p.pixelCode) + ');\nttq.page();\n</script>\n\n<!-- 3) ROI-NADOS (enriquecimento + CAPI) — pode ir antes do </body> -->\n<script src="' + proto + '://' + host + '/px/' + p.token + '.js" defer></script>'
      : (p.token ? '<script src="' + proto + '://' + host + '/t.js" defer></script>\n<script src="' + proto + '://' + host + '/px/' + p.token + '.js" defer></script>' : null)
  }));
  // Item 6: snippet BASE do loader (dispara para todos os pixels da conta) e
  // orientação clara — eventos de pagamento exigem gateway, nunca o navegador.
  const base = proto + '://' + host + '/px.js';
  res.json({
    pixels: list,
    dir: 'pixels/',
    meta: {
      loaderUrl: base,
      loaderTag: '<script src="' + base + '" defer></script>',
      trackerUrl: proto + '://' + host + '/t.js',
      trackerTag: '<script src="' + proto + '://' + host + '/t.js" defer></script>',
      paymentNote: 'Este script cobre Visita, Carrinho e Checkout. O evento de Compra (CompletePayment) só dispara quando um gateway confirma o pagamento via webhook — conecte um gateway na aba Gateways.'
    }
  });
});

app.post('/api/pixels', dashboardAuth, async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.pixelCode && !b.slug) return res.status(400).json({ error: 'pixelCode é obrigatório' });
    // Item 49: edição parcial segura — para slug existente, campos AUSENTES do
    // payload preservam o valor atual (merge-patch). Permite toggles inline
    // (ex.: ativo/pausado) sem reenviar token/eventos e sem risco de apagá-los.
    if (b.slug) {
      const existing = pixelStore.get(req.account.id, pixelStore.slugify(b.slug));
      if (existing) {
        // Token mascarado (form) ou ausente (patch) → mantém o existente
        if (b.accessToken === undefined || (b.accessToken && b.accessToken.indexOf('••••') === 0)) {
          b.accessToken = existing.accessToken;
        }
        if (b.pixelCode === undefined) b.pixelCode = existing.pixelCode;
        if (b.name === undefined) b.name = existing.name;
        if (b.events === undefined) b.events = existing.events;
        if (b.testEventCode === undefined) b.testEventCode = existing.testEventCode;
        if (b.active === undefined) b.active = existing.active;
      }
    }
    const saved = await pixelStore.save(req.account.id, b);
    stats.logEvent(saved._durable ? 'info' : 'error', {
      acc: req.account.id,
      title: (saved._durable ? 'Pixel TikTok salvo: ' : 'Pixel salvo SÓ EM MEMÓRIA (não durável): ') + saved.name,
      ref: saved.slug
    });
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
    res.json({
      ok: true,
      // Avisa o painel quando a gravação NÃO foi durável — evita o cenário
      // silencioso em que o usuário salva, some no restart e o pixel para.
      durable: saved._durable,
      warning: saved._durable ? null : saved._saveError,
      pixel: {
        ...saved,
        accessToken: saved.accessToken ? '••••' + saved.accessToken.slice(-4) : '',
        scriptUrl: saved.token ? proto + '://' + host + '/px/' + saved.token + '.js' : null,
        scriptTag: saved.token ? '<script src="' + proto + '://' + host + '/px/' + saved.token + '.js" defer></script>' : null
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/pixels/:slug', dashboardAuth, async (req, res) => {
  try {
    await pixelStore.remove(req.account.id, req.params.slug);
    stats.logEvent('info', { acc: req.account.id, title: 'Pixel TikTok removido', ref: req.params.slug });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Saúde da PERSISTÊNCIA de pixels: informa se a config está durável (Neon ou
// Redis) ou apenas em memória volátil, além de detectar pixels com venda ligada
// mas sem gateway "trusted" entregando (o motivo nº1 de "config não vai pro
// pixel"). Alimenta o banner de diagnóstico no painel. (Distinto de
// /api/pixels/health, que mede a taxa de sucesso dos DISPAROS.)
app.get('/api/pixels/durability', dashboardAuth, (req, res) => {
  res.set('Cache-Control', 'no-store');
  const h = pixelStore.health();
  const pixels = pixelStore.list(req.account.id);
  // Gateways que entregam eventos "trusted" (server-side) para esta conta.
  let trustedGateways = 0;
  try { trustedGateways = (gatewayStore.list(req.account.id) || []).length; } catch (_) {}
  const warnings = [];
  if (!h.durable && (h.dbEnabled || h.redisEnabled) && h.lastError) warnings.push(h.lastError);
  if (!h.dbEnabled && !h.redisEnabled) {
    warnings.push('Sem Neon nem Redis: a config de pixel vive só em memória e some a cada reinício.');
  }
  // Pixels que dependem de CompletePayment mas não há webhook de gateway
  // instalado — nesse caso o evento de venda NUNCA dispara (trava _trusted).
  const salePixels = pixels.filter((p) => p.events && p.events.CompletePayment).length;
  if (salePixels > 0 && trustedGateways === 0) {
    warnings.push('Você tem ' + salePixels + ' pixel(s) com "Compra" ligada, mas nenhum gateway conectado. '
      + 'Eventos de venda (CompletePayment) só disparam via webhook do gateway — configure um gateway para o pixel receber conversões.');
  }
  const incomplete = pixels
    .filter((p) => p.active && (!p.pixelCode || !p.accessToken))
    .map((p) => ({ slug: p.slug, name: p.name, missing: [!p.pixelCode && 'pixelCode', !p.accessToken && 'accessToken'].filter(Boolean) }));
  if (incomplete.length) warnings.push(incomplete.length + ' pixel(s) ativo(s) com credencial incompleta (não disparam).');
  res.json({
    durable: h.durable,
    dbEnabled: h.dbEnabled,
    redisEnabled: h.redisEnabled,
    lastOk: h.lastOk,
    lastError: h.lastError,
    trustedGateways,
    salePixels,
    incomplete,
    warnings
  });
});

// Teste de disparo: envia um ViewContent de teste e devolve a resposta CRUA
// do TikTok — valida pixel code + access token na hora.
app.post('/api/pixels/test', dashboardAuth, async (req, res) => {
  try {
    // Item 178: rate-limit por conta — cada teste chama a Events API do TikTok.
    if (rateLimited('pixel-test|' + req.account.id, 'pixeltest', 15)) {
      return res.status(429).json({ ok: false, error: 'Muitos testes de pixel seguidos. Aguarde um minuto e tente de novo.', code: 'rate_limited' });
    }
    const slug = pixelStore.slugify(req.body.slug || '');
    const pixel = pixelStore.get(req.account.id, slug);
    if (!pixel) return res.status(404).json({ error: 'pixel não encontrado' });
    // Exige Access Token com mensagem pt-BR clara (item 41): sem token, o
    // evento server-side jamais dispara — melhor avisar antes de chamar a API.
    if (!pixel.accessToken) {
      return res.status(400).json({ ok: false, error: 'Configure o Access Token da Events API para testar este pixel.' });
    }
    // ip/ua de quem clicou: a Events API exige identidade de usuário no evento.
    // Evento e moeda são escolhíveis pelo painel (default ViewContent / moeda da conta).
    const result = await ttEvents.testPixel(pixel, {
      ip: clientIp(req),
      userAgent: String(req.headers['user-agent'] || '').slice(0, 500),
      event: String(req.body.event || ''),
      currency: accountCurrency(req.account.id)
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Verificação de instalação do pixel por URL ───────────────��────────────
// O lojista cola a URL de uma página dele (ex.: a LP ou a página de obrigado)
// e o servidor busca o HTML e confere se o script do pixel (/px/<token>.js)
// ou o pixel code do TikTok aparecem na página. Roda 100% server-side.
//
// SEGURANÇA (anti-SSRF): só http/https; o hostname é resolvido via DNS e IPs
// privados/loopback/link-local são bloqueados; redirects são seguidos
// manualmente (máx. 3) revalidando cada destino; timeout de 8s e leitura
// limitada a 1,5 MB. Nunca devolvemos o HTML cru ao cliente — só o veredito.
// ipPrivado/hostSeguro extraídos para security-helpers.js (testáveis — item 60)
const { hostSeguro } = require('./security-helpers');

// Item 179 (estende 148): tetos rígidos para o fetch externo do verify-url.
// N segundos, M bytes, no máximo 1 redirect e NUNCA baixar corpo não-HTML —
// cada hop ainda passa por hostSeguro (anti-SSRF). Constantes nomeadas para
// facilitar ajuste sem caçar números mágicos no corpo da função.
const VERIFY_TIMEOUT_MS   = 8000;
const VERIFY_MAX_BYTES    = 1.5 * 1024 * 1024; // 1.5 MB de HTML basta p/ achar o pixel
const VERIFY_MAX_REDIRECTS = 1;                // segue no máximo 1 salto
async function buscarPaginaSegura(rawUrl) {
  let u;
  try { u = new URL(String(rawUrl || '').trim()); } catch (_) { return { error: 'URL inválida — use o endereço completo, ex.: https://minhapagina.com/oferta' }; }
  for (let hop = 0; hop <= VERIFY_MAX_REDIRECTS; hop++) {
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { error: 'só endereços http(s) são aceitos' };
    if (!(await hostSeguro(u.hostname))) return { error: 'este endereço não pode ser verificado (host bloqueado ou não resolve)' };
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), VERIFY_TIMEOUT_MS);
    let r;
    try {
      r = await fetch(u.href, {
        redirect: 'manual',
        signal: ctrl.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ROI-NADOS-PixelCheck/1.0)', 'Accept': 'text/html' }
      });
    } catch (_) {
      clearTimeout(t);
      return { error: 'não foi possível acessar a página (offline ou bloqueou a verificação)' };
    }
    clearTimeout(t);
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get('location');
      if (!loc || hop === VERIFY_MAX_REDIRECTS) return { error: 'a página redirecionou demais — informe a URL final (após os redirecionamentos)' };
      try { u = new URL(loc, u); continue; } catch (_) { return { error: 'redirecionamento inválido' }; }
    }
    if (!r.ok) return { error: 'a página respondeu com erro HTTP ' + r.status };
    // Item 179: nunca baixar corpo não-HTML (PDF, imagem, binário) — evita
    // gastar rede/memória com conteúdo que não pode conter o snippet do pixel.
    const ctype = (r.headers.get('content-type') || '').toLowerCase();
    if (ctype && !/(text\/html|application\/xhtml)/.test(ctype)) {
      try { if (r.body && r.body.cancel) r.body.cancel(); } catch (_) {}
      return { error: 'a URL não retornou uma página HTML (tipo: ' + ctype.split(';')[0] + '). Informe o endereço da página de vendas.' };
    }
    const reader = r.body && r.body.getReader ? r.body.getReader() : null;
    let html = '';
    if (reader) {
      const dec = new TextDecoder();
      while (html.length < VERIFY_MAX_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        html += dec.decode(value, { stream: true });
      }
      try { reader.cancel(); } catch (_) {}
    } else {
      html = (await r.text()).slice(0, VERIFY_MAX_BYTES);
    }
    return { html, finalUrl: u.href };
  }
  return { error: 'a p��gina redirecionou demais' };
}

app.post('/api/pixels/verify-url', dashboardAuth, async (req, res) => {
  try {
    // Item 5/9: rate-limit dedicado — verify-url faz fetch externo, então
    // limitamos a 10 verificações por janela por conta (evita abuso de SSRF-scan
    // e proteje nossa saída de rede). 429 com mensagem pt-BR clara.
    if (rateLimited('verify-url|' + req.account.id, 'verifyurl', 10)) {
      return res.status(429).json({ ok: false, error: 'Muitas verificações seguidas. Aguarde um minuto e tente de novo.' });
    }
    const page = await buscarPaginaSegura((req.body || {}).url);
    if (page.error) return res.json({ ok: false, error: page.error });
    const html = page.html || '';
    const pixels = pixelStore.list(req.account.id);
    // Para cada pixel da conta: o script tag (/px/<token>.js) está na página?
    // E o pixel code do TikTok (instalação nativa ttq) aparece?
    const found = pixels.map((p) => {
      const scriptOk = !!(p.token && html.indexOf('/px/' + p.token + '.js') !== -1);
      const nativeOk = !!(p.pixelCode && html.indexOf(p.pixelCode) !== -1);
      return { slug: p.slug, name: p.name, scriptOk, nativeOk, instalado: scriptOk || nativeOk };
    });
    const algum = found.some((f) => f.instalado);
    // O /t.js é quem registra a visita NA DASHBOARD. Pixel instalado sem ele =
    // eventos chegam ao TikTok mas o operador não vê os próprios visitantes —
    // exatamente a confusão mais comum. Checamos e avisamos explicitamente.
    const trackerOk = html.indexOf('/t.js') !== -1;
    stats.logEvent('info', {
      acc: req.account.id,
      title: 'Verificação de pixel por URL: ' + (algum ? 'instalado' : 'NÃO encontrado') + (trackerOk ? '' : ' (sem rastreamento /t.js)') + ' em ' + page.finalUrl
    });
    res.json({ ok: true, url: page.finalUrl, algumInstalado: algum, trackerOk, pixels: found });
  } catch (err) {
    res.status(500).json({ error: 'falha na verificação' });
  }
});

// Log de disparos CAPI (memória rápida + histórico do banco, por conta)
app.get('/api/pixels/log', dashboardAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  // 1. tenta memória local + Redis (recentLogAsync faz fallback automático)
  const rows = await ttEvents.recentLogAsync(100, req.account.id);
  if (rows.length) return res.json({ log: rows, source: 'redis' });
  // 2. fallback Neon (backup estruturado para quando Redis não está disponível)
  const dbRows = await db.loadPixelEvents(req.account.id, 100);
  res.json({ log: (dbRows || []).map((r) => ({
    id: r.id, at: r.at, pixel: r.pixel, event: r.event,
    eventId: r.event_id, leadId: r.lead_id, status: r.status, response: r.response
  })), source: 'neon' });
});

// Saúde da CAPI: taxa de sucesso, EMQ médio por evento, últimos erros e o
// tamanho da fila de retry ��� visão imediata de "está tudo disparando?"
app.get('/api/pixels/health', dashboardAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const rows = await ttEvents.recentLogAsync(200, req.account.id);
  const total = rows.length;
  const ok = rows.filter((r) => r.status === 'ok').length;
  const byEvent = {};
  let emqSum = 0, emqN = 0;
  rows.forEach((r) => {
    const e = byEvent[r.event] = byEvent[r.event] || { total: 0, ok: 0, emqSum: 0, emqN: 0 };
    e.total++;
    if (r.status === 'ok') e.ok++;
    if (r.emq != null) { e.emqSum += r.emq; e.emqN++; emqSum += r.emq; emqN++; }
  });
  const events = Object.keys(byEvent).map((name) => {
    const e = byEvent[name];
    return {
      event: name, total: e.total, ok: e.ok,
      rate: e.total ? Math.round((e.ok / e.total) * 100) : 0,
      emq: e.emqN ? Math.round((e.emqSum / e.emqN) * 10) / 10 : null
    };
  }).sort((a, b) => b.total - a.total);
  const errors = rows.filter((r) => r.status !== 'ok').slice(0, 5).map((r) => ({
    at: r.at, pixel: r.pixel, event: r.event,
    message: (r.response && (r.response.message || ('code ' + r.response.code))) || 'erro'
  }));
  res.json({
    ok: true, total, success: ok,
    rate: total ? Math.round((ok / total) * 100) : null,
    emq: emqN ? Math.round((emqSum / emqN) * 10) / 10 : null,
    events, errors,
    retryQueue: ttEvents.retryQueueSize()
  });
});

// Tendência de EMQ por pixel (série diária) + ALERTA de queda. O EMQ é o
// Event Match Quality: quanto mais sinal de identidade casa, melhor o TikTok
// otimiza. Quando cai, a campanha piora EM SILÊNCIO — este endpoint detecta a
// queda comparando a média recente (3d) com a base anterior (dias 4–10).
app.get('/api/pixels/emq-trend', dashboardAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const acc = req.account.id;
  const pixels = pixelStore.list(acc);
  const out = [];
  for (const p of pixels) {
    const name = p.slug || p.pixelCode;
    if (!name) continue;
    const trend = await redis.getEmqTrend(acc, name, 14).catch(() => []);
    // média recente (últimos 3 dias com dado) vs base (3 dias anteriores a esses)
    const withData = trend.filter((d) => d.count > 0);
    const recent = withData.slice(-3);
    const base = withData.slice(-6, -3);
    const avg = (arr) => arr.length ? arr.reduce((s, d) => s + d.avg, 0) / arr.length : null;
    const rAvg = avg(recent), bAvg = avg(base);
    // alerta: EMQ recente < 4/10 OU caiu >= 1.5 pontos vs a base
    let alert = null;
    if (rAvg != null && rAvg < 4) alert = 'baixo';
    else if (rAvg != null && bAvg != null && (bAvg - rAvg) >= 1.5) alert = 'queda';
    out.push({
      pixel: name,
      pixelCode: p.pixelCode,
      trend,
      recentAvg: rAvg != null ? Math.round(rAvg * 10) / 10 : null,
      baseAvg: bAvg != null ? Math.round(bAvg * 10) / 10 : null,
      alert
    });
  }
  // ordena: pixels em alerta primeiro
  out.sort((a, b) => (b.alert ? 1 : 0) - (a.alert ? 1 : 0));
  res.json({ ok: true, pixels: out, alerts: out.filter((p) => p.alert).length });
});

// Itens 417/439: trilha de auditoria da conta, visível na aba Config.
app.get('/api/audit', dashboardAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const rows = await db.listAudit(req.account.id, req.query.limit);
  res.json({
    ok: true,
    enabled: db.enabled,
    log: rows.map((r) => ({
      id: String(r.id),
      at: r.at,
      action: r.action,
      detail: r.detail || null,
      ip: r.ip_masked || null,
    })),
  });
});

app.post('/api/reset-stats', dashboardAuth, (req, res) => {
  stats.reset(req.account.id); // zera SÓ os dados da conta logada
  audit(req, req.account.id, 'reset_stats', 'Estatísticas zeradas'); // item 417
  res.json({ ok: true });
});

// ── Dashboard Next.js (proxy reverso, mesmo domínio) ───────────────���─
// O app Next roda internamente na porta 3001 com basePath /dashboard.
// O Express (porta pública) repassa /dashboard/* para ele — sessão, APIs
// e WebSocket ficam todos no MESMO domínio, sem CORS nem env de URL pública.
// Rollback: a dashboard antiga continua acessível em /dashboard?legacy=1.
const DASH_UPSTREAM = process.env.DASHBOARD_UPSTREAM_URL || 'http://127.0.0.1:3001';

// Headers hop-by-hop NÃO podem ser repassados (RFC 7230 §6.1). Repassar
// transfer-encoding/connection corrompe o streaming do Next (RSC) e quebra
// a hidratação do React no cliente.
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade',
]);

function stripHopByHop(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    if (!HOP_BY_HOP.has(k.toLowerCase())) out[k] = v;
  }
  return out;
}

function proxyToNextDashboard(req, res) {
  const upstream = new URL(DASH_UPSTREAM);
  const proxyReq = require(upstream.protocol === 'https:' ? 'https' : 'http').request(
    {
      hostname: upstream.hostname,
      port: upstream.port || (upstream.protocol === 'https:' ? 443 : 80),
      path: req.originalUrl, // já inclui /dashboard/...
      method: req.method,
      headers: { ...stripHopByHop(req.headers), host: upstream.host },
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, stripHopByHop(proxyRes.headers));
      proxyRes.pipe(res);
    },
  );
  proxyReq.on('error', () => {
    // Next fora do ar → fallback para a dashboard legada (nunca tela branca)
    if (!res.headersSent) {
      sendLegacyDashboard(res, 'fallback'); // item 475: com banner "vá para o novo"
    }
  });
  if (req.readable) req.pipe(proxyReq);
  else proxyReq.end();
}

// WebSocket do Next (Turbopack/HMR em dev) tamb��m precisa atravessar o
// proxy — sem repassar o upgrade, o cliente dev do Next fica aguardando a
// conexão e a hidratação do React nunca completa via porta pública.
function proxyDashboardUpgrade(req, socket, head) {
  const upstream = new URL(DASH_UPSTREAM);
  const proxyReq = require(upstream.protocol === 'https:' ? 'https' : 'http').request({
    hostname: upstream.hostname,
    port: upstream.port || (upstream.protocol === 'https:' ? 443 : 80),
    path: req.url,
    method: 'GET',
    headers: { ...req.headers, host: upstream.host },
  });
  proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
    // Reconstroi o handshake 101 para o cliente e emenda os dois sockets
    let raw = 'HTTP/1.1 101 Switching Protocols\r\n';
    for (let i = 0; i < proxyRes.rawHeaders.length; i += 2) {
      raw += proxyRes.rawHeaders[i] + ': ' + proxyRes.rawHeaders[i + 1] + '\r\n';
    }
    socket.write(raw + '\r\n');
    if (proxyHead && proxyHead.length) socket.write(proxyHead);
    proxySocket.pipe(socket);
    socket.pipe(proxySocket);
    proxySocket.on('error', () => socket.destroy());
    socket.on('error', () => proxySocket.destroy());
  });
  proxyReq.on('error', () => socket.destroy());
  if (head && head.length) proxyReq.write(head);
  proxyReq.end();
}

// ── Integração TikTok Ads (via Zernio) ─────────────────────────────���──────
// Rotas /api/ads/* — escopadas à conta logada pelo mesmo dashboardAuth.
require('./ads-routes')(app, dashboardAuth, { stats });

// Item 475: dashboard-view.js (5680 linhas) está CONGELADO — não evoluir.
// Quem cair nele (via ?legacy=1 ou fallback com Next fora do ar) vê um banner
// fixo apontando para o novo painel. Injetado na hora de servir para não tocar
// no arquivo legado (que não aceita crase/${} e tem risco alto de regressão).
function legacyBanner(reason) {
  var msg = reason === 'fallback'
    ? 'O painel novo est\u00e1 reiniciando \u2014 esta \u00e9 a vers\u00e3o antiga (somente leitura de refer\u00eancia). '
    : 'Voc\u00ea est\u00e1 na vers\u00e3o antiga do painel (congelada, sem novidades). ';
  return '<div style="position:sticky;top:0;z-index:9999;background:#1a1206;border-bottom:1px solid #7c5a12;' +
    'color:#fbbf24;font:600 13px/1.5 system-ui,sans-serif;padding:9px 16px;text-align:center">' +
    msg + '<a href="/dashboard" style="color:#6cb4ff;text-decoration:underline">Ir para o painel novo</a></div>';
}
function sendLegacyDashboard(res, reason) {
  res.set('Content-Type', 'text/html; charset=utf-8');
  var html = DASHBOARD_HTML;
  var i = html.indexOf('<body');
  if (i !== -1) {
    var close = html.indexOf('>', i);
    if (close !== -1) html = html.slice(0, close + 1) + legacyBanner(reason) + html.slice(close + 1);
  }
  res.send(html);
}

// Assets públicos do PWA — o navegador busca manifest/ícones SEM cookies
// (fetch sem credenciais), então não podem exigir login. São estáticos e
// não contêm nada sensível. O sw.js também: iOS revalida o worker em
// background e a sessão pode ter expirado nesse momento.
const PWA_PUBLIC_PATHS = new Set([
  '/manifest.webmanifest', '/sw.js',
  '/icon-192.png', '/icon-512.png', '/icon-512-maskable.png',
  '/apple-touch-icon.png', '/badge-96.png'
]);
app.use('/dashboard', (req, res, next) => {
  if (PWA_PUBLIC_PATHS.has(req.path)) return proxyToNextDashboard(req, res);
  next();
});

app.get('/dashboard', pageAuth, (req, res) => {
  if (req.query.legacy === '1') {
    return sendLegacyDashboard(res, 'manual');
  }
  proxyToNextDashboard(req, res);
});

// Sub-rotas e assets do Next (/dashboard/live, /dashboard/_next/..., etc.)
app.use('/dashboard', pageAuth, proxyToNextDashboard);

// ── Landing Page do SaaS (raiz, pública, com pulse de presença) ──────
app.get('/', (req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(injectPulse(LP_HTML));
});

// ── Páginas legais (públicas — exigidas na revisão do TikTok for Business) ──
const { privacyPage, termsPage } = require('./legal-view');
app.get('/privacidade', (req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(privacyPage);
});
app.get('/termos', (req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(termsPage);
});

// ── Só a pasta /assets é servida estaticamente (logo da marca) ───────
app.use('/assets', express.static(path.join(__dirname, 'assets'), { maxAge: '7d' }));

// ── Iniciar servidor ────────���─────────────────────────────────���──────
// Hidrata stats, config, pixels, links e gateways a partir do Neon ANTES
// de escutar, para que os dados de todas as contas já estejam disponíveis
// no primeiro request pós-deploy.
stats.hydrate()
  .then(() => config.hydrate())
  .then(() => pixelStore.init())
  .then(() => linkStore.init())
  .then(() => gatewayStore.init())
  .then(() => refreshDefaultAccount())
  // Garante que as tabelas ads_* existam ANTES de qualquer operação de Ads.
  // Sem isto, o app quebrava com `relation "ads_safety_policies" does not exist`
  // ao conectar a um banco onde essas tabelas nunca foram criadas.
  .then(() => require('./ads-ops-store').ensureSchema().catch((e) => {
    console.warn('[ads-ops] ensureSchema falhou:', e.message);
  }))
  // Tabelas de catálogo de produtos (ads_catalogs / ads_catalog_products).
  .then(() => require('./ads-catalog-store').ensureSchema().catch((e) => {
    console.warn('[ads-catalog] ensureSchema falhou:', e.message);
  }))
  // Espelho durável do Pipeboard (ads_campaigns_cache / _metrics_cache /
  // _sync_state). A dashboard lê daqui; o motor de sync escreve aqui.
  .then(() => require('./ads-cache-store').ensureSchema().catch((e) => {
    console.warn('[ads-cache] ensureSchema falhou:', e.message);
  }))
  // Liga o motor de sync Pipeboard→Neon (loop em background p/ contas ativas).
  .then(() => { try { require('./ads-sync').start(); } catch (e) { console.warn('[ads-sync] start falhou:', e.message); } })
  // Jobs de Ads presos em running/queued de ANTES do reinício nunca continuam
  // (rodam in-process) — marca como failed/partial para o usuário reprocessar.
  .then(() => require('./ads-ops-store').reconcileOrphanJobs().catch((e) => {
    console.warn('[ads-ops] reconciliação de jobs órfãos falhou:', e.message);
  }))
  .finally(() => {
  const httpServer = app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Servidor rodando na porta ${PORT}`);
  console.log(`   Neon (persistência): ${db.enabled ? '✅ ativa' : '❌ desativada'}`);
  });
  // Repassa o upgrade de WebSocket do painel novo (Turbopack/HMR) para o Next
  httpServer.on('upgrade', (req, socket, head) => {
    if (req.url && req.url.startsWith('/dashboard')) {
      proxyDashboardUpgrade(req, socket, head);
    } else {
      socket.destroy();
    }
  });

    // ── Manutenção periódica ─────────────────────────────────────────
    // 1. Prune do mapa de presença em memória (remove sessões expiradas
    //    mesmo sem ninguém consultar /api/live).
    setInterval(() => { try { presence.prune(); } catch (_) {} }, 60 * 1000).unref();
    // 2. Limpeza de sessões antigas no Neon (1x por dia, mantém 30 dias).
    //    A quarentena de webhooks também tem retenção de 30 dias (item handoff #1).
    setInterval(() => { db.pruneSessions(30); db.prunePixelEvents(14); db.pruneQuarantine(); db.pruneProcessedOrders(); }, 24 * 60 * 60 * 1000).unref();
    setTimeout(() => { db.pruneSessions(30); db.prunePixelEvents(14); db.pruneQuarantine(); db.pruneProcessedOrders(); }, 30 * 1000).unref();
    // 3. Sessões de login expiradas: o próprio auth.js agenda o prune (1x/h).
  });
