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
const TRACKER_JS = require('./tracker-view');
const auth = require('./auth');
const gatewayStore = require('./gateway-store');
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
async function seenPixelEvent(eventId) {
  // Redis primeiro: SET NX com TTL de 2h — garante dedup entre instâncias
  if (rdb.enabled) return rdb.seenEventId(eventId);
  // fallback memória local
  const now = Date.now();
  if (_seenPx.size > 5000) {
    for (const [k, ts] of _seenPx) { if (now - ts > 2 * 3600e3) _seenPx.delete(k); }
  }
  if (_seenPx.has(eventId)) return true;
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
app.use(compression({ threshold: 1024 }));
// rawBody: necessário para verificar assinaturas HMAC de webhooks (Stripe,
// Kiwify) — o HMAC é calculado sobre os bytes originais, não o JSON re-serializado
app.use(express.json({
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
        utm: {
          source: q.utm_source || null, medium: q.utm_medium || null,
          campaign: q.utm_campaign || null, content: q.utm_content || null, term: q.utm_term || null
        }
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

  try { stats.attachTracking(vid, patch); } catch (_) {}

  // Beacon revelou headless (WebGL de software) mesmo tendo passado a 1ª visita
  // só por headers → grava veredito sticky de bot para a PRÓXIMA visita ir à
  // white sem depender do judge. Fecha a janela do "primeiro acesso limpo".
  if (typeof b.webgl === 'string' && /SwiftShader|llvmpipe|Mesa|VMware|VirtualBox/i.test(b.webgl)) {
    redis.setStickyBot(vid, { at: Date.now(), score: 100, sig: ['webgl:software-renderer'] }).catch(() => {});
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
      }, landing, acc).catch(() => {});
    }).catch(() => {});
  } catch (_) { /* pixel de imagem nunca derruba nada */ }
});

// Endpoint público chamado pelo snippet (sendBeacon/fetch, sem cookies).
// A identidade vem do vid explícito — validado com regex estrita.
app.post('/api/track', async (req, res) => {
  res.json({ ok: true });                          // responde já; processa depois
  try {
    const b = req.body || {};
    const vid = VID_RE.test(String(b.vid || '')) ? String(b.vid) : null;
    if (!vid) return;
    if (rateLimited(clientIp(req), 'track', 120)) return; // bot martelando: ignora
    checkDailyReport();                            // carona no tráfego (sem cron)
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
      utm: {
        source: utm.source || null, medium: utm.medium || null,
        campaign: utm.campaign || null, content: utm.content || null, term: utm.term || null
      }
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

// ── Links de Checkout externos (/go/:slug) ───────────────────────────
// O checkout NÃO vive neste projeto: cada link aponta para URLs externas
// do usuário (qualquer gateway). Este redirect é o ponto de rastreamento:
// registra o clique, dispara InitiateCheckout na CAPI e repassa o leadId
// para o checkout externo — a conversão volta pelo webhook universal.
app.get('/go/:slug', async (req, res) => {
  // resolve por conta: domínio personalizado → conta dona; senão 1º match
  const link = linkStore.resolve(req.params.slug, publicAccountId(req));
  if (!link || !link.ativo || !link.variantes.length) {
    return res.status(404).send('Link não encontrado');
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
    const challengeData = {
      webgl: lead0.cloakWebgl || '',
      tz:    lead0.cloakTz    || '',
      fp:    lead0.cloakFp    || '',
      dt:    typeof lead0.cloakDt  === 'number' ? lead0.cloakDt  : NaN,
      beh:   typeof lead0.cloakBeh === 'number' ? lead0.cloakBeh : NaN
    };

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
    utm: {
      source: q.utm_source || null, medium: q.utm_medium || null,
      campaign: q.utm_campaign || null, content: q.utm_content || null, term: q.utm_term || null
    }
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
  // Filtro por dispositivo: celular/tablet vai para urlMobile (se definida),
  // computador vai para a URL principal da variante
  const baseUrl = (dev.device !== 'desktop' && variant.urlMobile) ? variant.urlMobile : variant.url;
  const dest = baseUrl + (baseUrl.includes('?') ? '&' : '?') + params.toString();
  return res.redirect(302, dest);
});

// ── Links de cloaking (/c/:slug) ─────────────────────────────────────
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
  if (!found || !found.entry.offerUrl) return res.status(404).send('Link não encontrado');
  const { acc, entry } = found;
  const offer = entry.offerUrl;
  // FAIL-SAFE: white do próprio link → white global da conta → /_safe embutida.
  const acctCloak = config.get(acc).cloak || {};
  const white = entry.whitePageUrl || acctCloak.defaultWhitePage || '/_safe';
  const uaRaw = String(req.headers['user-agent'] || '');
  // Interruptor do link liga/desliga o cloaking; o destino seguro sempre existe.
  const cloakOn = entry.enabled !== false;

  // Registra a decisão (offer/white + motivo) nos contadores do painel.
  const bumpDecision = (decision, reason) => {
    try { redis.bumpCloakDecision(acc, 'cloak:' + entry.slug, decision, reason); } catch (_) {}
  };

  // preserva a query original (UTMs/ttclid) no destino final
  const go = (url) => {
    const qs = req.originalUrl.includes('?') ? req.originalUrl.split('?')[1] : '';
    return res.redirect(302, url + (qs ? (url.includes('?') ? '&' : '?') + qs : ''));
  };

  // Crawler conhecido → página segura (nunca à offer)
  if (uaTools.isBot(uaRaw)) {
    stats.logEvent('info', { acc, title: '[cloak] bot UA → ' + (cloakOn ? 'white' : 'offer'), gateway: 'cloak:' + entry.slug, ref: String(uaRaw).slice(0, 80) });
    if (cloakOn) { bumpDecision('white', 'bot-ua'); return go(white); }
    bumpDecision('offer', null);
    return go(offer);
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
    const filterVid = readCookie(req, 'v_id') || '';
    const lead0 = (() => { try { return stats.getLead(filterVid) || {}; } catch (_) { return {}; } })();
    const challengeToken = lead0.cloakChallenge === 'ok'
      ? botFilter.issueChallengeToken(filterVid)
      : (lead0.cloakChallenge === 'fail' ? '' : null);
    const challengeData = {
      webgl: lead0.cloakWebgl || '', tz: lead0.cloakTz || '', fp: lead0.cloakFp || '',
      dt: typeof lead0.cloakDt === 'number' ? lead0.cloakDt : NaN,
      beh: typeof lead0.cloakBeh === 'number' ? lead0.cloakBeh : NaN
    };
    const filterReq = Object.assign(Object.create(req), { geoCountry: geoFromReq(req).country || '' });
    const j = await botFilter.judge(filterReq, filterVid, challengeToken, challengeData, entry)
      .catch(() => ({ verdict: 'real', score: 0, signals: [] }));
    if (j.verdict === 'bot') {
      stats.logEvent('info', { acc, title: '[cloak] score=' + j.score + ' → white | ' + (j.signals || []).slice(0, 4).join(', '), gateway: 'cloak:' + entry.slug, ref: clientIp(req) });
      bumpDecision('white', 'score');
      return go(white);
    }
  }
  if (cloakOn) bumpDecision('offer', null);
  return go(offer);
});

// ── Encurtador rastreável (/l/:slug) ─────────────────────────────────
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
      utm: {
        source: q.utm_source || null, medium: q.utm_medium || null,
        campaign: q.utm_campaign || null, content: q.utm_content || null, term: q.utm_term || null
      }
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
  res.json({ today: agg(24 * 3600e3), last7d: agg(7 * 86400e3), total: agg(null), ts: new Date().toISOString() });
});

// ── Relatório diário via Pushcut ─────────────────────────────────────
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
function checkDailyReportFor(accId) {
  const cfg = config.get(accId);
  const pc = cfg.pushcut || {};
  if (!pc.url || !(pc.events || {}).daily) return;
  const today = new Date().toISOString().slice(0, 10);
  if (cfg.lastDailyReport === today) return;
  try {
    const y = new Date(Date.now() - 86400e3);
    const yKey = y.toISOString().slice(0, 10);
    const s = stats.getStats(accId);
    const dayLeads = (s.leads || []).filter((l) => !l.orphan && String(l.at || '').slice(0, 10) === yKey);
    const sales = (s.events || []).filter((e) => e.type === 'sale' && String(e.at || '').slice(0, 10) === yKey);
    const rev = sales.reduce((a, e) => a + (e.amount || 0), 0);
    const conv = dayLeads.length ? Math.round(sales.length / dayLeads.length * 1000) / 10 : 0;
    // anteontem, para comparação
    const y2Key = new Date(Date.now() - 2 * 86400e3).toISOString().slice(0, 10);
    const sales2 = (s.events || []).filter((e) => e.type === 'sale' && String(e.at || '').slice(0, 10) === y2Key);
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
    hint: db.enabled ? undefined : 'DATABASE_URL ausente: configure a connection string do Neon nas variáveis de ambiente do servidor (ex.: painel do Railway).'
  });
});

// ── Rotas de autenticação (registro / login / logout) ─────────────────────
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
    const result = await auth.register({ email: b.email, password: b.password, name: b.name });
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
    const result = await auth.login({ email: b.email, password: b.password });
    if (result.error) return res.status(401).json({ ok: false, error: result.error });
    appendCookie(res, auth.sessionCookie(result.token));
    res.json({ ok: true, account: { email: result.account.email, name: result.account.name } });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Erro ao entrar.' });
  }
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

// ── API: estatísticas (escopadas à conta logada) ─────────────────────
app.get('/api/stats', dashboardAuth, (req, res) => {
  res.set('Cache-Control', 'no-store'); // dados ao vivo — nunca cachear em proxies
  res.json(stats.getStats(req.account.id));
  checkDailyReport(); // dashboard aberta também dispara o resumo pendente
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

// ═══ Links de Checkout — CRUD + validação de domínio (por conta) ══════
app.get('/api/links', dashboardAuth, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ links: linkStore.list(req.account.id) });
});

app.post('/api/links', dashboardAuth, async (req, res) => {
  try {
    const saved = await linkStore.save(req.account.id, req.body || {});
    stats.logEvent('info', { acc: req.account.id, title: 'Link de checkout salvo: ' + saved.nome, ref: saved.slug });
    res.json({ ok: true, link: saved });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/links/:slug', dashboardAuth, async (req, res) => {
  try {
    await linkStore.remove(req.account.id, req.params.slug);
    stats.logEvent('info', { acc: req.account.id, title: 'Link de checkout removido', ref: req.params.slug });
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
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const APP_CHECK_ID = 'roi-nados-tracker';

function normHost(input) {
  const s = String(input || '').trim().toLowerCase();
  if (!s) return null;
  try {
    const h = new URL(s.includes('://') ? s : 'https://' + s).hostname;
    return DOMAIN_RE.test(h) ? h : null;
  } catch (_) { return null; }
}

// Marcador público que prova que o tráfego do domínio chega NESTE app
// (usado pela verificação; sem auth de propósito — não expõe nada).
app.get('/__domain-check', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ app: APP_CHECK_ID, ok: true });
});

app.get('/api/domains', dashboardAuth, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    domains: config.get(req.account.id).customDomains || [],
    // host principal do app — alvo do CNAME nas instruções de DNS
    appHost: String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim()
  });
});

app.post('/api/domains', dashboardAuth, (req, res) => {
  const host = normHost((req.body || {}).host);
  if (!host) return res.status(400).json({ error: 'domínio inválido (ex.: link.seudominio.com)' });
  // domínio precisa ser único ENTRE TODAS as contas: ele identifica a conta
  // dona do tráfego público (publicAccountId) — duas contas não podem tê-lo
  const owner = config.accountForDomain(host);
  if (owner && owner !== req.account.id) return res.status(400).json({ error: 'domínio já cadastrado em outra conta' });
  const cur = config.get(req.account.id).customDomains || [];
  if (cur.some((d) => d.host === host)) return res.status(400).json({ error: 'domínio já cadastrado' });
  if (cur.length >= 20) return res.status(400).json({ error: 'limite de 20 domínios' });
  config.set(req.account.id, { customDomains: cur.concat([{ host, verificado: false, verificadoEm: null, criadoEm: new Date().toISOString() }]) });
  stats.logEvent('info', { acc: req.account.id, title: 'Domínio personalizado adicionado: ' + host });
  res.json({ ok: true, host });
});

app.delete('/api/domains/:host', dashboardAuth, (req, res) => {
  const host = normHost(req.params.host);
  const cur = config.get(req.account.id).customDomains || [];
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

app.post('/api/domains/verify', dashboardAuth, async (req, res) => {
  const host = normHost((req.body || {}).host);
  if (!host) return res.status(400).json({ error: 'domínio inválido' });
  const appHost = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim().replace(/:\d+$/, '');
  const out = { host, appHost, dnsOk: false, dnsDetail: '', httpOk: false, httpDetail: '' };

  // 1. DNS: CNAME direto ou IPs coincidentes
  try {
    const cnames = await dnsp.resolveCname(host).catch(() => []);
    if (cnames.some((c) => c.toLowerCase().replace(/\.$/, '') === appHost.toLowerCase())) {
      out.dnsOk = true;
      out.dnsDetail = 'CNAME → ' + appHost;
    } else {
      const [hostIps, appIps] = await Promise.all([
        dnsp.resolve4(host).catch(() => []),
        dnsp.resolve4(appHost).catch(() => [])
      ]);
      if (hostIps.length && appIps.length && hostIps.some((ip) => appIps.includes(ip))) {
        out.dnsOk = true;
        out.dnsDetail = 'A → ' + hostIps.join(', ');
      } else if (!hostIps.length && !cnames.length) {
        out.dnsDetail = 'domínio não resolve — crie o registro DNS e aguarde propagar';
      } else if (hostIps.length && hostIps.some(isCloudflareIp)) {
        out.cloudflareProxy = true;
        out.dnsDetail = 'proxy da Cloudflare ativo (nuvem laranja) — mude o CNAME para "Somente DNS" (nuvem cinza) e adicione o domínio na Vercel → Domains';
      } else {
        out.dnsDetail = 'DNS aponta para outro destino (' + (cnames[0] || hostIps.join(', ')) + ')';
      }
    }
  } catch (e) { out.dnsDetail = 'erro na consulta DNS: ' + e.message; }

  // 2. HTTPS: o marcador deste app responde no domínio?
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch('https://' + host + '/__domain-check', { redirect: 'manual', signal: ctrl.signal });
    clearTimeout(t);
    if (r.status === 200) {
      const j = await r.json().catch(() => null);
      if (j && j.app === APP_CHECK_ID) { out.httpOk = true; out.httpDetail = 'HTTPS ativo e servido por este app'; }
      else out.httpDetail = 'HTTPS responde, mas é outro servidor — confira o DNS';
    } else if (r.status === 404) {
      out.httpDetail = out.cloudflareProxy
        ? 'HTTPS 404 — a Cloudflare está no meio; desative o proxy (nuvem cinza) e adicione o domínio na Vercel → Domains'
        : 'HTTPS respondeu 404 — adicione este domínio no painel da hospedagem (ex.: Vercel → Domains) para ele ser servido por este app';
    } else out.httpDetail = 'HTTPS respondeu status ' + r.status;
  } catch (_) {
    out.httpDetail = out.dnsOk
      ? 'HTTPS ainda não responde — o certificado SSL pode estar sendo emitido (adicione o domínio também no painel da hospedagem, ex.: Vercel → Domains)'
      : 'sem resposta HTTPS';
  }

  // verificado = prova HTTPS (forte) ou DNS correto (SSL ainda propagando)
  out.ok = out.httpOk || out.dnsOk;
  if (out.ok) {
    const now = new Date().toISOString();
    const cur = config.get(req.account.id).customDomains || [];
    const has = cur.some((d) => d.host === host);
    const next = has
      ? cur.map((d) => d.host === host ? Object.assign({}, d, { verificado: true, verificadoEm: now }) : d)
      : cur.concat([{ host, verificado: true, verificadoEm: now, criadoEm: now }]);
    config.set(req.account.id, { customDomains: next });
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
    events: Object.assign({ sale: true, failed: true, refund: true, dispute: true, checkout: false, daily: false }, pc.events || {})
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
    else return res.status(400).json({ error: 'URL inválida — use o webhook do app Pushcut (https://api.pushcut.io/...)' });
  }
  if (b.events && typeof b.events === 'object') {
    pc.events = {};
    ['sale', 'failed', 'refund', 'dispute', 'checkout'].forEach((k) => { pc.events[k] = b.events[k] !== false; });
    ['sale', 'failed', 'refund', 'dispute', 'checkout'].forEach((k) => { if (b.events[k] === false) pc.events[k] = false; });
    pc.events.daily = b.events.daily === true; // opt-in explícito (relatório diário)
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
    'requireJsChallenge', 'checkWebgl', 'checkTimezone', 'checkBehavior', 'blockZhLang'];
  boolKeys.forEach((k) => { if (typeof b[k] === 'boolean') next[k] = b[k]; });
  if (['strict', 'balanced', 'loose', 'custom'].includes(b.sensitivity)) next.sensitivity = b.sensitivity;
  if (b.threshold != null && !isNaN(Number(b.threshold))) next.threshold = Number(b.threshold);
  if (b.deadlineMs != null && !isNaN(Number(b.deadlineMs))) next.deadlineMs = Number(b.deadlineMs);
  // White page global de fallback (a sanitização do config valida o https://).
  // String vazia limpa o valor e volta a usar a página neutra embutida /_safe.
  if (typeof b.defaultWhitePage === 'string') next.defaultWhitePage = b.defaultWhitePage.trim();
  config.set(req.account.id, { cloak: next });
  res.json({ ok: true, cloak: config.get(req.account.id).cloak });
});

// ── Regras de cloaking POR LINK (offer/white/países/pixel) ─────────────────
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

// Testa o motor de julgamento com o request ATUAL do navegador do usuário —
// mostra na dashboard como o próprio admin seria classificado (deve dar 'real').
app.post('/api/cloak/test', dashboardAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const cloakCfg = config.get(req.account.id).cloak || {};
  const filterReq = Object.assign(Object.create(req), { geoCountry: geoFromReq(req).country || '' });
  const j = await botFilter.judge(filterReq, 'admin-test', null, {}, cloakCfg)
    .catch((e) => ({ verdict: 'erro', score: 0, signals: ['erro:' + e.message] }));
  res.json({
    verdict: j.verdict, score: j.score, threshold: j.threshold,
    signals: j.signals, ip: clientIp(req),
    ua: String(req.headers['user-agent'] || '').slice(0, 120)
  });
});

// ── Métricas de decisão do cloaker (offer vs white) por conta ──────────────
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

  res.json({ ok: true, redis: redis.enabled, aggregate: agg, links: items });
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

// ── Links de cloaking (entidade própria, servidos em /c/:slug) ─────────────
// Diferente dos links de checkout (/go): cada link de cloaking carrega SUA
// própria configuração de proteção (interruptor, sensibilidade, camadas de
// detecção) + offer/white page + allowlists de país e idioma. Guardados no
// bloco cloakLinks da config da conta (durável no Neon + snapshot local).
const _ckSlugify = (s) => String(s || '').toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const _ckValidHttps = (u) => /^https:\/\/[^\s]+\.[^\s]+/i.test(String(u || '').trim());

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
  const slug = _ckSlugify(b.slug || nome);
  if (!slug) return res.status(400).json({ error: 'nome do link é obrigatório' });
  if (!_ckValidHttps(b.offerUrl)) return res.status(400).json({ error: 'a offer precisa ser uma URL https:// válida' });

  const cur = config.get(req.account.id).cloakLinks || [];
  const existing = cur.find((l) => l.slug === slug);
  const isNew = !existing;

  const entry = Object.assign({}, existing || {}, {
    slug,
    nome: nome || slug,
    offerUrl: String(b.offerUrl).trim(),
    whitePageUrl: _ckValidHttps(b.whitePageUrl) ? String(b.whitePageUrl).trim() : '',
    enabled: typeof b.enabled === 'boolean' ? b.enabled : (existing ? existing.enabled : true),
    sensitivity: b.sensitivity,
    threshold: b.threshold,
    deadlineMs: b.deadlineMs,
    paises: Array.isArray(b.paises) ? b.paises : (existing ? existing.paises : []),
    idiomas: Array.isArray(b.idiomas) ? b.idiomas : (existing ? existing.idiomas : []),
    criadoEm: existing ? existing.criadoEm : new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  ['blockDatacenter', 'blockHeadless', 'checkHeaders', 'requireJsChallenge',
    'checkWebgl', 'checkTimezone', 'checkBehavior', 'blockZhLang'].forEach((k) => {
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

// ── API: health-check — variáveis críticas + ping REAL no banco ─────
app.get('/api/health', dashboardAuth, async (req, res) => {
  const [dbPing, redisPing] = await Promise.all([
    require('./db').ping(),
    rdb.ping()
  ]);
  res.set('Cache-Control', 'no-store');
  res.json({
    conversionWebhook: !!process.env.CONVERSION_WEBHOOK_SECRET,
    tiktok:      pixelStore.list(req.account.id).some((p) => p.active && p.accessToken),
    pushcut:     !!((config.get(req.account.id).pushcut || {}).url || process.env.PUSHCUT_WEBHOOK_URL),
    dashboard:   true, // sessão obrigatória — sempre protegida
    db:          dbPing.ok,
    dbLatencyMs: dbPing.ok ? dbPing.latencyMs : null,
    redis:       redisPing.ok,
    redisEnabled:rdb.enabled,
    uptimeSec:   Math.round(process.uptime()),
    ts: new Date().toISOString()
  });
});

// ═══ Webhook UNIVERSAL de conversões (qualquer gateway) ═══════════════
// Kiwify, Hotmart, PerfectPay, Cakto, etc.: configure a URL
//   https://<host>/api/conversion?secret=SEU_SEGREDO[&gateway=kiwify]
// no painel do gateway. O corpo é normalizado por aliases — não importa o
// formato exato que o gateway envia, desde que tenha evento + order_id.

// Mapeia o "status/evento" que cada gateway envia → evento interno.
// CompletePayment/AddPaymentInfo/InitiateCheckout vão para a CAPI do TikTok;
// Refund/Dispute/Failed só alimentam a dashboard + Pushcut (sem CAPI).
function mapConversionEvent(raw) {
  const s = String(raw || '').toLowerCase();
  if (/refund|reembols|estorn|devolvid/.test(s)) return 'Refund';
  if (/charged?_?back|dispute|disputa|protest|contesta/.test(s)) return 'Dispute';
  if (/fail|refus|recus|declin|denied|negad|cancel|expirad|expired/.test(s)) return 'Failed';
  if (/paid|approved|aprovad|completed|complete|purchase|sale|compra|venda|succeed|success/.test(s)) return 'CompletePayment';
  if (/payment_info|processing|processando|waiting_payment|pending|analys|analis/.test(s)) return 'AddPaymentInfo';
  if (/checkout|cart|carrinho|pix|billet|boleto|initiate|created|criad/.test(s)) return 'InitiateCheckout';
  return null;
}

// ── Pushcut — notificação por evento, respeitando toggles da dashboard ──
const PUSHCUT_EVENT_MAP = {
  CompletePayment: { key: 'sale', name: 'Aprovada' },
  Failed:          { key: 'failed', name: 'Recusada' },
  Refund:          { key: 'refund', name: 'Reembolso' },
  Dispute:         { key: 'dispute', name: 'Disputa' },
  InitiateCheckout:{ key: 'checkout', name: 'Checkout' },
  AddPaymentInfo:  { key: 'checkout', name: 'Checkout' }
};
function notifyPushcut(event, n) {
  const map = PUSHCUT_EVENT_MAP[event];
  if (!map) return;
  const cfg = config.get(n.acc).pushcut || {};
  const events = Object.assign({ sale: true, failed: true, refund: true, dispute: true, checkout: false }, cfg.events || {});
  if (!events[map.key]) return;
  const valor = fmtMoney(n.amountCents, n.currency);
  const titles = {
    sale: `Venda aprovada — ${valor}`,
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
  }, n.acc).catch(() => {});
}

// Achata payloads aninhados: Kiwify manda {order:{…}, Customer:{…}, Commissions:{…}},
// Hotmart {data:{purchase:{price:{…}}, buyer:{…}}}, outros {payment:{…}} — mescla
// containers conhecidos no nível raiz (raiz vence). Case-insensitive: "Customer"
// e "customer" são o mesmo container (Kiwify capitaliza os dela).
function flattenGatewayPayload(b) {
  if (!b || typeof b !== 'object') return {};
  const CONTAINERS = ['data', 'order', 'purchase', 'payment', 'transaction', 'sale', 'charge',
    'customer', 'buyer', 'client', 'commissions', 'product', 'subscription', 'price', 'offer'];
  let flat = {};
  const merge = (obj, depth) => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj) || depth > 4) return;
    Object.keys(obj).forEach((k) => {
      const kl = String(k).toLowerCase();
      if (CONTAINERS.indexOf(kl) !== -1 && obj[k] && typeof obj[k] === 'object' && !Array.isArray(obj[k])) {
        let child = obj[k];
        // "name" dentro de product/offer é o NOME DO PRODUTO — renomeia para
        // product_name para não sobrescrever o nome do comprador (buyer.name)
        if ((kl === 'product' || kl === 'offer') && child.name != null && child.product_name == null) {
          child = Object.assign({}, child, { product_name: child.name });
          delete child.name;
        }
        merge(child, depth + 1);
      }
    });
    // nível mais raso vence: campos do topo sobrescrevem os aninhados
    flat = Object.assign({}, flat, obj);
  };
  merge(b, 0);
  return flat;
}

// Valor monetário robusto: aceita número, "49.90", "49,90", "R$ 49,90", "1.234,56"
// e objetos { value: 49.9 } (Hotmart manda price: { value, currency_value }).
function parseAmount(v) {
  if (v == null) return NaN;
  if (typeof v === 'object' && !Array.isArray(v)) v = v.value != null ? v.value : v.amount;
  if (v == null) return NaN;
  if (typeof v === 'number') return v;
  let s = String(v).replace(/[^\d.,-]/g, '');
  if (!s) return NaN;
  const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');   // 1.234,56 → 1234.56
  else s = s.replace(/,/g, '');                                          // 1,234.56 → 1234.56
  return Number(s);
}

// Extrai o valor da venda em CENTAVOS testando aliases de todos os gateways.
// Campos que já vêm em centavos (Kiwify: charge_amount, product_base_price)
// têm prioridade e NÃO são multiplicados por 100.
function pickAmountCents(b) {
  const CENTS_FIELDS = ['amount_cents', 'value_cents', 'total_cents', 'price_cents', 'charge_amount', 'product_base_price'];
  for (let i = 0; i < CENTS_FIELDS.length; i++) {
    const n = parseAmount(b[CENTS_FIELDS[i]]);
    if (Number.isFinite(n) && n >= 0 && n <= 100000000) return Math.round(n);
  }
  const UNIT_FIELDS = ['amount', 'value', 'total', 'price', 'total_price', 'total_value',
    'amount_paid', 'paid_amount', 'sale_amount', 'purchase_amount', 'full_price'];
  for (let j = 0; j < UNIT_FIELDS.length; j++) {
    const n = parseAmount(b[UNIT_FIELDS[j]]);
    if (Number.isFinite(n) && n >= 0 && n <= 1000000) return Math.round(n * 100);
  }
  return null;
}

// Normaliza QUALQUER payload de gateway para o formato interno.
function normalizeConversion(body, query) {
  const b = flattenGatewayPayload(body);
  // evento: Kiwify usa webhook_event_type + order_status, Hotmart usa event,
  // PerfectPay usa sale_status_detail, outros usam type/status
  const event = mapConversionEvent(
    b.webhook_event_type || b.event || b.event_type || b.type || b.trigger ||
    b.status || b.order_status || b.sale_status_detail || (query && query.event)
  );
  if (!event) return { error: 'evento não reconhecido (use event/type/status: paid, checkout, processing…)' };
  const orderId = b.order_id || b.transaction_id || b.orderId ||
    str(b.transaction) || b.sale_id || b.purchase_id || b.order_ref || b.code || b.id || b.ref || null;
  if (!orderId) return { error: 'order_id obrigatório (aliases: transaction_id, transaction, sale_id, id, ref)' };
  // valor: obrigatório apenas na compra aprovada (aliases + campos em centavos)
  const amountCents = pickAmountCents(b);
  const hasAmount = amountCents != null;
  if (event === 'CompletePayment' && !hasAmount) return { error: 'amount inválido (aliases: value, total, price, charge_amount…)' };
  // moeda: Hotmart manda currency_value, outros currency/currency_code
  const curRaw = String(b.currency || b.currency_value || b.currency_code || '');
  return {
    event,
    gateway: String((query && query.gateway) || b.gateway || b.platform || b.source || 'generic').toLowerCase().slice(0, 30),
    orderId: String(orderId).slice(0, 120),
    amountCents: hasAmount ? amountCents : 0,
    currency: /^[a-zA-Z]{3}$/.test(curRaw) ? curRaw.toLowerCase() : 'eur',
    leadId: str(b.leadId || b.lead_id || b.client_reference_id || b.reference || b.external_id || b.s1 || b.sck || b.src),
    email: str(b.email || b.customer_email || b.buyer_email),
    phone: str(b.phone || b.customer_phone || b.buyer_phone || b.phone_number || b.mobile || b.checkout_phone),
    customer: str(b.customer || b.name || b.full_name || b.buyer_name || b.customer_name),
    product: str(b.product_name || b.content_name || b.product),
    registerSale: true
  };
}
// Só aceita string/número primitivo — objetos aninhados (ex.: customer:{…}) viram null.
function str(v) {
  return (typeof v === 'string' || typeof v === 'number') ? String(v).slice(0, 320) : null;
}

// Motor: resolve o lead no backend, enriquece, dedupa e dispara a CAPI.
// Roda SEMPRE em background (a resposta HTTP já foi enviada ao gateway).
async function processConversion(n) {
  const evId = n.event + '.' + n.gateway + '.' + n.orderId;
  const receipt = {
    at: new Date().toISOString(),
    acc: n.acc || null,
    gateway: n.gateway, event: n.event, orderId: n.orderId,
    amount: n.amountCents, currency: n.currency
  };
  try {
    // 1. dedup — retries do gateway nunca duplicam o disparo
    if (await seenPixelEvent(evId)) {
      receipt.status = 'dedup';
      rdb.pushConversionLog(receipt).catch(() => {});
      return receipt;
    }
    // 2. resolve o lead no backend: leadId → e-mail → telefone → órfão
    // (com n.acc definido, o match respeita a fronteira da conta)
    let lead = n.leadId ? stats.getLead(n.leadId) : null;
    if (lead && n.acc && lead.acc && lead.acc !== n.acc) lead = null;
    let matchVia = lead ? 'leadId' : null;
    if (!lead && n.email) { try { lead = stats.findLeadByEmail(n.email, n.acc); if (lead) matchVia = 'email'; } catch (_) {} }
    if (!lead && n.phone) { try { lead = stats.findLeadByPhone(n.phone, n.acc); if (lead) matchVia = 'phone'; } catch (_) {} }
    receipt.match = matchVia || 'órfã';
    receipt.leadId = lead ? lead.id : null;

    // Teste da dashboard: valida normalização/dedup/match e loga o recibo,
    // mas NÃO mexe nas estatísticas nem dispara a CAPI de verdade.
    if (n.dryRun) {
      receipt.status = 'teste ok';
      receipt.teste = true;
      rdb.pushConversionLog(receipt).catch(() => {});
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
          gateway: n.gateway, ref: n.orderId
        });
      } catch (_) {}
      notifyPushcut(n.event, n);
      receipt.status = 'ok (sem CAPI)';
      rdb.pushConversionLog(receipt).catch(() => {});
      return receipt;
    }

    // 3. registra a venda no dashboard (só CompletePayment)
    if (n.event === 'CompletePayment' && n.registerSale) {
      const saleAcc = n.acc || (lead && lead.acc) || null;
      try {
        const matched = stats.matchExternalConversion({
          acc: saleAcc,
          leadId: lead ? lead.id : null, gateway: n.gateway,
          amountCents: n.amountCents, currency: n.currency,
          customer: n.customer, email: n.email, phone: n.phone, ref: n.orderId
        });
        stats.logEvent('sale', {
          acc: saleAcc,
          title: matched.orphan ? ('Venda ' + n.gateway + ' SEM lead (órfã)') : ('Venda aprovada (' + n.gateway + ')'),
          amount: n.amountCents, currency: n.currency,
          customer: n.customer, email: n.email,
          gateway: n.gateway, orphan: !!matched.orphan, ref: matched.id
        });
      } catch (_) {}
      // Atribuição ao link/variante que originou o clique (teste A/B)
      try {
        if (lead && lead.linkSlug) {
          linkStore.recordConversion(saleAcc, lead.linkSlug, lead.linkVariant, n.amountCents, n.currency);
          receipt.link = lead.linkSlug;
        }
      } catch (_) {}
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
            customer: n.name || undefined
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
    receipt.dispatched = r.dispatched;
  } catch (err) {
    receipt.status = 'erro';
    receipt.error = String(err.message || err).slice(0, 200);
  }
  rdb.pushConversionLog(receipt).catch(() => {});
  return receipt;
}

// ── Ponte DURÁVEL entre o webhook e o processamento ────────────────────────
// Em vez de processar em background logo após o 200 (perde a venda se o
// processo reiniciar no meio), a conversão é GRAVADA no Redis primeiro. Um
// worker consome e confirma; um crash no meio deixa o item na fila e ele é
// reprocessado (idempotente via dedup). Sem Redis, cai no comportamento antigo
// (processa inline) — funciona, só não sobrevive a restart.
function submitConversion(n) {
  if (rdb.enabled) {
    rdb.enqueueConversion(n).then((ok) => {
      // se o enqueue falhar (Redis instável), processa inline como rede de segurança
      if (!ok) processConversion(n).catch(() => {});
    }).catch(() => { processConversion(n).catch(() => {}); });
  } else {
    processConversion(n).catch(() => {});
  }
}

// Worker: consome a fila durável de conversões. Lock distribuído garante que,
// com várias instâncias, só UMA drena por ciclo (evita disparo duplicado).
let _convWorkerBusy = false;
async function convWorkerTick() {
  if (!rdb.enabled || _convWorkerBusy) return;
  _convWorkerBusy = true;
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

// Endpoint público que os gateways chamam.
app.post('/api/conversion', (req, res) => {
  const secret = process.env.CONVERSION_WEBHOOK_SECRET;
  if (!secret) {
    // nunca fica aberto sem segredo — instrui em vez de aceitar
    return res.status(503).json({ ok: false, error: 'defina CONVERSION_WEBHOOK_SECRET no servidor' });
  }
  const provided = req.headers['x-webhook-secret'] || req.query.secret || '';
  if (!provided || !safeEqual(String(provided), secret)) {
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
    return res.status(400).json({ ok: false, error: n.error });
  }
  // resposta IMEDIATA — nenhum gateway sofre timeout esperando a CAPI
  res.json({ ok: true, event: n.event, gateway: n.gateway, orderId: n.orderId });
  // legado (sem conta no token): atribui à conta padrão
  n.acc = _defaultAccountId;
  submitConversion(n);
});

// ═══ Webhook DEDICADO por gateway (multi-tenant): POST /hook/:token ═══
// Cada gateway cadastrado na dashboard tem um token único que identifica
// a CONTA e o PROVIDER — cole a URL no painel do gateway e pronto.
// Suporta assinatura por provider (Stripe whsec, Hotmart hottok, Kiwify
// signature) e adapta payloads específicos antes do normalizador genérico.
app.post('/hook/:token', (req, res) => {
  const token = String(req.params.token || '').slice(0, 64);
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
    return res.status(401).json({ ok: false, error: sig.reason });
  }

  // 2. adapta payload específico do provider → normalizador genérico
  const adapted = gatewayStore.adaptPayload(gw.provider, req.body);
  const n = normalizeConversion(adapted, { gateway: gw.provider });
  if (n.error) {
    gatewayStore.touch(gw.id, 'formato inválido');
    rdb.pushConversionLog({
      at: new Date().toISOString(), acc: gw.accountId,
      gateway: gw.provider, event: 'formato inválido', status: 'erro',
      error: n.error, keys: Object.keys(req.body || {}).slice(0, 20).join(',').slice(0, 300)
    }).catch(() => {});
    return res.status(400).json({ ok: false, error: n.error });
  }

  // 3. resposta imediata + processamento em background NA CONTA DO GATEWAY
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
      lastEventAt: g.lastEventAt, lastEventStatus: g.lastEventStatus,
      createdAt: g.createdAt
    }))
  });
});

app.post('/api/gateways', dashboardAuth, async (req, res) => {
  try {
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

// Teste do webhook direto da dashboard (protegido): injeta um payload de
// exemplo no MESMO fluxo real (normaliza → processa) e devolve o recibo na
// hora — confere status/match sem sair da tela e sem depender do gateway.
app.post('/api/conversion/test', dashboardAuth, async (req, res) => {
  try {
    const n = normalizeConversion({
      event: 'paid',
      order_id: 'teste_' + Date.now().toString(36),
      amount: '1.00',
      currency: 'eur',
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

// ── API: zerar estatísticas ──────────────────────────────────────────
// ═══ TikTok multi-pixel ═══════════════════════════════════════════════
// ── /px.js: loader dinâmico do pixel — as páginas só referenciam ESTE
// script; o servidor injeta todos os pixels ativos da rota. Adicionar ou
// editar um pixel (arquivo em pixels/ ou painel) atualiza todas as páginas.
app.get('/px.js', (req, res) => {
  res.set({ 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
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
    // lib oficial ttq (stub assíncrono)
    '!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie","holdConsent","revokeConsent","grantConsent"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e},ttq.load=function(e,n){var r="https://analytics.tiktok.com/i18n/pixel/events.js",o=n&&n.partner;ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=r,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};n=document.createElement("script");n.type="text/javascript",n.async=!0,n.src=r+"?sdkid="+e+"&lib="+t;e=document.getElementsByTagName("script")[0];e.parentNode.insertBefore(n,e)}}(window,document,"ttq");',
    // carrega TODOS os pixels ativos desta rota
    pixels.map((px) => 'ttq.load(' + JSON.stringify(px.pixelCode) + ');').join('\n'),
    // identidade: external_id = hash do id único do lead (igual ao servidor)
    extId ? 'ttq.identify({external_id:' + JSON.stringify(extId) + '});' : '',
    'ttq.page();',
    // eventos com event_id determinístico + espelho server-side via beacon
    evs.map((e) =>
      'ttq.track(' + JSON.stringify(e.n) + ',{},{event_id:' + JSON.stringify(e.id) + '});'
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

  res.send(js);
});

// ── /px/:token.js — SCRIPT INDIVIDUAL POR PIXEL (estilo Xtracky) ─────────
// Cada pixel tem um token único; cole em QUALQUER página (deste app ou
// externa): <script src="https://SEU-DOMINIO/px/px_xxxx.js" defer></script>
// O script carrega SÓ aquele pixel, identifica o visitante e espelha os
// eventos no servidor (CAPI) com dedup — independe de rotas configuradas.
app.get('/px/:token.js', (req, res) => {
  res.set({
    'Content-Type': 'application/javascript; charset=utf-8',
    'Cache-Control': 'no-store',
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
    '!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie","holdConsent","revokeConsent","grantConsent"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e},ttq.load=function(e,n){var r="https://analytics.tiktok.com/i18n/pixel/events.js",o=n&&n.partner;ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=r,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};n=document.createElement("script");n.type="text/javascript",n.async=!0,n.src=r+"?sdkid="+e+"&lib="+t;e=document.getElementsByTagName("script")[0];e.parentNode.insertBefore(n,e)}}(window,document,"ttq");',
    'ttq.load(' + JSON.stringify(px.pixelCode) + ');',
    extId ? 'ttq.identify({external_id:' + JSON.stringify(extId) + '});' : '',
    'ttq.page();',
    evs.map((e) =>
      'ttq.track(' + JSON.stringify(e.n) + ',{},{event_id:' + JSON.stringify(e.id) + '});'
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
      }).catch(() => {});
    });
  } catch (_) { /* beacon nunca propaga erro */ }
});

// ── APIs de gestão de pixels (dashboard, por conta) ─────────────────────
app.get('/api/pixels', dashboardAuth, (req, res) => {
  res.set('Cache-Control', 'no-store');
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  // mascara o token na listagem (só mostra últimos 4 chars)
  const list = pixelStore.list(req.account.id).map((p) => ({
    ...p,
    accessToken: p.accessToken ? '••••' + p.accessToken.slice(-4) : '',
    hasToken: !!p.accessToken,
    // script individual deste pixel (estilo Xtracky): cole em qualquer página
    scriptUrl: p.token ? proto + '://' + host + '/px/' + p.token + '.js' : null,
    scriptTag: p.token ? '<script src="' + proto + '://' + host + '/px/' + p.token + '.js" defer></script>' : null
  }));
  res.json({ pixels: list, dir: 'pixels/' });
});

app.post('/api/pixels', dashboardAuth, async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.pixelCode && !b.slug) return res.status(400).json({ error: 'pixelCode é obrigatório' });
    // Se editar sem reenviar token, mantém o existente (o form manda mascarado)
    if (b.slug && b.accessToken && b.accessToken.indexOf('••••') === 0) {
      const existing = pixelStore.get(req.account.id, pixelStore.slugify(b.slug));
      if (existing) b.accessToken = existing.accessToken;
    }
    const saved = await pixelStore.save(req.account.id, b);
    stats.logEvent('info', { acc: req.account.id, title: 'Pixel TikTok salvo: ' + saved.name, ref: saved.slug });
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
    res.json({ ok: true, pixel: {
      ...saved,
      accessToken: saved.accessToken ? '••••' + saved.accessToken.slice(-4) : '',
      scriptUrl: saved.token ? proto + '://' + host + '/px/' + saved.token + '.js' : null,
      scriptTag: saved.token ? '<script src="' + proto + '://' + host + '/px/' + saved.token + '.js" defer></script>' : null
    } });
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

// Teste de disparo: envia um ViewContent de teste e devolve a resposta CRUA
// do TikTok — valida pixel code + access token na hora.
app.post('/api/pixels/test', dashboardAuth, async (req, res) => {
  try {
    const slug = pixelStore.slugify(req.body.slug || '');
    const pixel = pixelStore.get(req.account.id, slug);
    if (!pixel) return res.status(404).json({ error: 'pixel não encontrado' });
    // ip/ua de quem clicou: a Events API exige identidade de usuário no evento
    const result = await ttEvents.testPixel(pixel, {
      ip: clientIp(req),
      userAgent: String(req.headers['user-agent'] || '').slice(0, 500)
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
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
// tamanho da fila de retry — visão imediata de "está tudo disparando?"
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

app.post('/api/reset-stats', dashboardAuth, (req, res) => {
  stats.reset(req.account.id); // zera SÓ os dados da conta logada
  res.json({ ok: true });
});

// ── Dashboard (HTML inline, protegida por sessão) ────────────────────
app.get('/dashboard', pageAuth, (req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(DASHBOARD_HTML);
});

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

// ── Iniciar servidor ─────────────────────────────────────────────────
// Hidrata stats, config, pixels, links e gateways a partir do Neon ANTES
// de escutar, para que os dados de todas as contas já estejam disponíveis
// no primeiro request pós-deploy.
stats.hydrate()
  .then(() => config.hydrate())
  .then(() => pixelStore.init())
  .then(() => linkStore.init())
  .then(() => gatewayStore.init())
  .then(() => refreshDefaultAccount())
  .finally(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`✅ Servidor rodando na porta ${PORT}`);
      console.log(`   Neon (persistência): ${db.enabled ? '✅ ativa' : '❌ desativada'}`);
    });

    // ── Manutenção periódica ─────────────────────────────────────────
    // 1. Prune do mapa de presença em memória (remove sessões expiradas
    //    mesmo sem ninguém consultar /api/live).
    setInterval(() => { try { presence.prune(); } catch (_) {} }, 60 * 1000).unref();
    // 2. Limpeza de sessões antigas no Neon (1x por dia, mantém 30 dias).
    setInterval(() => { db.pruneSessions(30); db.prunePixelEvents(14); }, 24 * 60 * 60 * 1000).unref();
    setTimeout(() => { db.pruneSessions(30); db.prunePixelEvents(14); }, 30 * 1000).unref();
    // 3. Sessões de login expiradas: o próprio auth.js agenda o prune (1x/h).
  });
