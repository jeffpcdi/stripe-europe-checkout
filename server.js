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
const TRACKER_JS = require('./tracker-view');

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
app.use(express.json());
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
        || p === '/dashboard') return next();
    const accept = req.headers.accept || '';
    if (!accept.includes('text/html')) return next();          // só navegações
    if (/\.[a-z0-9]{2,5}$/i.test(p) && !p.endsWith('.html')) return next(); // ignora assets

    // Bots (crawlers do TikTok/Google, monitoramento, curl) nunca viram lead
    // nem disparam CAPI — poluiriam o funil e o Event Match Quality do pixel.
    const uaRaw = String(req.headers['user-agent'] || '');
    if (uaTools.isBot(uaRaw)) return next();

    const hadCookie = !!readCookie(req, 'v_id');
    const id = getOrAssignVisitor(req, res);
    if (!hadCookie) {                                          // 1 lead por visitante
      const geo = geoFromReq(req);
      const q = req.query || {};
      const dev = uaTools.parse(uaRaw);
      stats.recordVisit({
        id,
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
          url: fullUrl(req)
        }, p).catch(() => {});
      }
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

app.get('/t.js', (_req, res) => {
  res.set({
    'Content-Type': 'application/javascript; charset=utf-8',
    'Cache-Control': 'public, max-age=300',        // 5min: atualizações chegam rápido
    'Access-Control-Allow-Origin': '*'
  });
  res.send(TRACKER_JS);
});

// Endpoint público chamado pelo snippet (sendBeacon/fetch, sem cookies).
// A identidade vem do vid explícito — validado com regex estrita.
app.post('/api/track', async (req, res) => {
  res.json({ ok: true });                          // responde já; processa depois
  try {
    const b = req.body || {};
    const vid = VID_RE.test(String(b.vid || '')) ? String(b.vid) : null;
    if (!vid) return;
    const uaRaw = String(req.headers['user-agent'] || '');
    if (uaTools.isBot(uaRaw)) return;              // bots não viram lead nem CAPI

    const geo = geoFromReq(req);
    const dev = uaTools.parse(uaRaw);
    const utm = (b.utm && typeof b.utm === 'object') ? b.utm : {};
    const pageUrl = typeof b.url === 'string' ? b.url.slice(0, 500) : null;
    let landing = pageUrl;
    try { landing = new URL(pageUrl).pathname.slice(0, 200); } catch (_) {}

    // lead já existia? (evita "novo lead" duplicado a cada page view)
    let existed = false;
    try { existed = !!stats.getLead(vid); } catch (_) {}

    // registra/enriquece o lead no funil (mesma trilha do middleware interno)
    stats.recordVisit({
      id: vid,
      ip: clientIp(req),
      ua: uaRaw.slice(0, 300),
      device: dev.device, os: dev.os, browser: dev.browser,
      referer: typeof b.referrer === 'string' ? b.referrer.slice(0, 300) : null,
      landing: landing || 'externa',
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
        url: pageUrl
      }, landing || 'externa').catch(() => {});
    }
  } catch (_) { /* rastreamento nunca derruba o servidor */ }
});

// ── Links de Checkout externos (/go/:slug) ───────────────────────────
// O checkout NÃO vive neste projeto: cada link aponta para URLs externas
// do usuário (qualquer gateway). Este redirect é o ponto de rastreamento:
// registra o clique, dispara InitiateCheckout na CAPI e repassa o leadId
// para o checkout externo — a conversão volta pelo webhook universal.
app.get('/go/:slug', async (req, res) => {
  const link = linkStore.get(req.params.slug);
  if (!link || !link.ativo || !link.variantes.length) {
    return res.status(404).send('Link não encontrado');
  }
  const q = req.query || {};

  // Bots (preview do WhatsApp/Telegram, crawler do TikTok, monitoramento):
  // redireciona SEM rastrear — não conta clique, não vira lead, não dispara CAPI.
  const uaRaw = String(req.headers['user-agent'] || '');
  if (uaTools.isBot(uaRaw)) {
    const v0 = link.variantes[0];
    return res.redirect(302, v0.url);
  }

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

  linkStore.recordClick(link.slug, variant.id);

  const geo = geoFromReq(req);
  const dev = uaTools.parse(uaRaw);
  // Funil: lead entrou num checkout (gateway = slug do link)
  stats.recordCheckoutEntry(visitorId, 'link:' + link.slug, {
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
  try { stats.attachTracking(visitorId, { linkSlug: link.slug, linkVariant: variant.id }); } catch (_) {}

  // TikTok CAPI: InitiateCheckout server-side (checkout externo não tem pixel nosso)
  try {
    const lead = stats.getLead(visitorId) || {};
    const evId = 'InitiateCheckout.' + visitorId + '.' + hourKey();
    if (!(await seenPixelEvent(evId))) {
      ttEvents.dispatchToAll('InitiateCheckout', {
        eventId: evId,
        leadId: visitorId,
        email: lead.email || undefined,
        ip: clientIp(req),
        userAgent: uaRaw.slice(0, 500),
        ttclid: q.ttclid || lead.ttclid || null,
        ttp: lead.ttp || null,
        url: fullUrl(req)
      }, '/go/' + link.slug).catch(() => {});
    }
  } catch (_) { /* rastreamento nunca bloqueia o redirect */ }

  stats.logEvent('lead', {
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
  const dest = variant.url + (variant.url.includes('?') ? '&' : '?') + params.toString();
  return res.redirect(302, dest);
});

// ── Auth simples (Basic Auth) para a dashboard ───────────────────────
// Comparação em tempo constante (crypto.timingSafeEqual) — evita timing
// attacks que a comparação com === permitia.
const crypto = require('crypto');
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
function dashboardAuth(req, res, next) {
  const pass = process.env.DASHBOARD_PASSWORD;
  if (!pass) return next(); // sem senha definida: acesso livre (defina DASHBOARD_PASSWORD para proteger)
  const header = req.headers.authorization || '';
  const token = header.startsWith('Basic ') ? Buffer.from(header.slice(6), 'base64').toString() : '';
  const provided = token.split(':').slice(1).join(':'); // ignora usuário, valida senha
  if (provided && safeEqual(provided, pass)) return next();
  res.set('WWW-Authenticate', 'Basic realm="Dashboard"');
  return res.status(401).send('Autenticação necessária.');
}

// ── API: estatísticas do teste A/B ──────���────────────────────────────
app.get('/api/stats', dashboardAuth, (req, res) => {
  res.set('Cache-Control', 'no-store'); // dados ao vivo — nunca cachear em proxies
  res.json(stats.getStats());
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
    const [visitors, presenceSummary] = await Promise.all([presence.list(), presence.summary()]);
    // Checkouts são EXTERNOS (sem script nosso lá) → estimativa via janela
    // de entrada de 10min (leads que clicaram num /go/ recentemente).
    let checkoutEst = 0;
    try {
      const now = stats.inCheckoutNow();
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

// ═══ Links de Checkout — CRUD + validação de domínio (dashboard) ══════
app.get('/api/links', dashboardAuth, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ links: linkStore.list() });
});

app.post('/api/links', dashboardAuth, async (req, res) => {
  try {
    const saved = await linkStore.save(req.body || {});
    stats.logEvent('info', { title: 'Link de checkout salvo: ' + saved.nome, ref: saved.slug });
    res.json({ ok: true, link: saved });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/links/:slug', dashboardAuth, async (req, res) => {
  try {
    await linkStore.remove(req.params.slug);
    stats.logEvent('info', { title: 'Link de checkout removido', ref: req.params.slug });
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

// ═══ Pushcut — notificações configuráveis pela dashboard ═════════════
app.get('/api/pushcut-config', dashboardAuth, (req, res) => {
  res.set('Cache-Control', 'no-store');
  const cfg = config.get();
  const pc = cfg.pushcut || {};
  res.json({
    // mascara a URL (contém o segredo do Pushcut)
    url: pc.url ? pc.url.replace(/(https:\/\/api\.pushcut\.io\/)([^/]+)/, (m, a, b) => a + '••••' + b.slice(-4)) : '',
    hasUrl: !!pc.url,
    events: Object.assign({ sale: true, failed: true, refund: true, dispute: true, checkout: false }, pc.events || {})
  });
});

app.post('/api/pushcut-config', dashboardAuth, (req, res) => {
  const b = req.body || {};
  const cur = config.get();
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
  }
  config.set({ pushcut: pc });
  res.json({ ok: true });
});

app.post('/api/pushcut/test', dashboardAuth, async (req, res) => {
  const ok = await sendPushcut('Aprovada', {
    title: 'Teste de notificação — ROI-NADOS',
    text: 'Se você recebeu isto, o Pushcut está configurado corretamente.\nData: ' + fmtDate(),
    sound: 'system'
  });
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
    tiktok:      !!process.env.TIKTOK_ACCESS_TOKEN,
    pushcut:     !!((config.get().pushcut || {}).url || process.env.PUSHCUT_WEBHOOK_URL),
    dashboard:   !!process.env.DASHBOARD_PASSWORD,
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
  if (/refund|reembols|estorn/.test(s)) return 'Refund';
  if (/chargeback|dispute|disputa/.test(s)) return 'Dispute';
  if (/fail|refus|recus|declin|denied|negad/.test(s)) return 'Failed';
  if (/paid|approved|aprovad|completed|complete|purchase|sale|compra|venda/.test(s)) return 'CompletePayment';
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
  const cfg = config.get().pushcut || {};
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
  }).catch(() => {});
}

// Achata payloads aninhados: Kiwify manda {order:{…}}, Hotmart {data:{purchase:{…}}},
// outros {payment:{…}} — mescla containers conhecidos no nível raiz (raiz vence).
function flattenGatewayPayload(b) {
  if (!b || typeof b !== 'object') return {};
  const CONTAINERS = ['data', 'order', 'purchase', 'payment', 'transaction', 'sale', 'charge', 'customer', 'buyer', 'client'];
  let flat = {};
  const merge = (obj, depth) => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj) || depth > 2) return;
    CONTAINERS.forEach((k) => { if (obj[k] && typeof obj[k] === 'object') merge(obj[k], depth + 1); });
    // nível mais raso vence: campos do topo sobrescrevem os aninhados
    flat = Object.assign({}, flat, obj);
  };
  merge(b, 0);
  return flat;
}

// Valor monetário robusto: aceita número, "49.90", "49,90", "R$ 49,90", "1.234,56".
function parseAmount(v) {
  if (v == null) return NaN;
  if (typeof v === 'number') return v;
  let s = String(v).replace(/[^\d.,-]/g, '');
  if (!s) return NaN;
  const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');   // 1.234,56 → 1234.56
  else s = s.replace(/,/g, '');                                          // 1,234.56 → 1234.56
  return Number(s);
}

// Normaliza QUALQUER payload de gateway para o formato interno.
function normalizeConversion(body, query) {
  const b = flattenGatewayPayload(body);
  const event = mapConversionEvent(b.event || b.type || b.status || b.order_status || (query && query.event));
  if (!event) return { error: 'evento não reconhecido (use event/type/status: paid, checkout, processing…)' };
  const orderId = b.order_id || b.transaction_id || b.orderId || b.id || b.ref || null;
  if (!orderId) return { error: 'order_id obrigatório (aliases: transaction_id, id, ref)' };
  // valor: obrigatório apenas na compra aprovada
  const rawAmount = parseAmount(b.amount != null ? b.amount : (b.value != null ? b.value : (b.total != null ? b.total : b.price)));
  const hasAmount = Number.isFinite(rawAmount) && rawAmount >= 0 && rawAmount <= 1000000;
  if (event === 'CompletePayment' && !hasAmount) return { error: 'amount inválido (aliases: value, total, price; unidades 0–1M)' };
  return {
    event,
    gateway: String((query && query.gateway) || b.gateway || b.platform || b.source || 'generic').toLowerCase().slice(0, 30),
    orderId: String(orderId).slice(0, 120),
    amountCents: hasAmount ? Math.round(rawAmount * 100) : 0,
    currency: /^[a-zA-Z]{3}$/.test(String(b.currency || '')) ? String(b.currency).toLowerCase() : 'eur',
    leadId: str(b.leadId || b.lead_id || b.client_reference_id || b.reference || b.external_id),
    email: str(b.email || b.customer_email || b.buyer_email),
    phone: str(b.phone || b.customer_phone || b.buyer_phone || b.phone_number || b.mobile),
    customer: str(b.customer || b.name || b.full_name || b.buyer_name || b.customer_name),
    product: str(b.product || b.product_name || b.content_name),
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
    // 2. resolve o lead no backend: leadId direto → e-mail → órfão
    let lead = n.leadId ? stats.getLead(n.leadId) : null;
    if (!lead && n.email) { try { lead = stats.findLeadByEmail(n.email); } catch (_) {} }
    receipt.match = lead ? (n.leadId && lead.id === n.leadId ? 'leadId' : 'email') : 'órfã';
    receipt.leadId = lead ? lead.id : null;

    // Eventos sem CAPI (Refund/Dispute/Failed): dashboard + Pushcut e encerra.
    if (n.event === 'Refund' || n.event === 'Dispute' || n.event === 'Failed') {
      const typeMap = { Refund: 'refund', Dispute: 'dispute', Failed: 'failed' };
      const titleMap = { Refund: 'Reembolso', Dispute: 'Disputa / chargeback', Failed: 'Pagamento recusado' };
      try {
        stats.logEvent(typeMap[n.event], {
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
      try {
        const matched = stats.matchExternalConversion({
          leadId: lead ? lead.id : null, gateway: n.gateway,
          amountCents: n.amountCents, currency: n.currency,
          customer: n.customer, email: n.email, phone: n.phone, ref: n.orderId
        });
        stats.logEvent('sale', {
          title: matched.orphan ? ('Venda ' + n.gateway + ' SEM lead (órfã)') : ('Venda aprovada (' + n.gateway + ')'),
          amount: n.amountCents, currency: n.currency,
          customer: n.customer, email: n.email,
          gateway: n.gateway, orphan: !!matched.orphan, ref: matched.id
        });
      } catch (_) {}
      // Atribuição ao link/variante que originou o clique (teste A/B)
      try {
        if (lead && lead.linkSlug) {
          linkStore.recordConversion(lead.linkSlug, lead.linkVariant, n.amountCents, n.currency);
          receipt.link = lead.linkSlug;
        }
      } catch (_) {}
      notifyPushcut('CompletePayment', n);
    } else if (n.event === 'InitiateCheckout' || n.event === 'AddPaymentInfo') {
      notifyPushcut(n.event, n);
    }
    // 4. dispara a CAPI com o MÁXIMO de sinal: identidade do lead do backend
    const r = await ttEvents.dispatchToAll(n.event, {
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
    }, '*');
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
  if (n.error) return res.status(400).json({ ok: false, error: n.error });
  // resposta IMEDIATA — nenhum gateway sofre timeout esperando a CAPI
  res.json({ ok: true, event: n.event, gateway: n.gateway, orderId: n.orderId });
  processConversion(n).catch(() => {});
});

// Log dos webhooks recebidos (painel, aba Pixels). Protegido por dashboardAuth;
// devolve o segredo para o painel montar a URL de configuração do gateway.
app.get('/api/conversion/log', dashboardAuth, async (req, res) => {
  const log = await rdb.loadConversionLog(50);
  res.json({
    configured: !!process.env.CONVERSION_WEBHOOK_SECRET,
    secret: process.env.CONVERSION_WEBHOOK_SECRET || '',
    log: log || []
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

  const pixels = pixelStore.forRoute(route);
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
    // dedup + disparo em PARALELO (antes era serial: 1 roundtrip Redis por evento)
    events.forEach((e) => {
      const name = String(e.n || '').slice(0, 40);
      const evId = String(e.id || '').slice(0, 120);
      if (!name || !evId) return;
      if (!/^(ViewContent|InitiateCheckout|AddToCart)$/.test(name)) return; // whitelist
      seenPixelEvent(evId).then((seen) => {
        if (seen) return; // já disparado pelo middleware/rota
        return ttEvents.dispatchToAll(name, {
          eventId: evId,
          leadId: vId || undefined,
          ip,
          userAgent: ua,
          ttclid: b.ttclid ? String(b.ttclid).slice(0, 500) : undefined,
          ttp: b.ttp ? String(b.ttp).slice(0, 500) : undefined,
          url: b.url ? String(b.url).slice(0, 500) : undefined
        }, route);
      }).catch(() => {});
    });
  } catch (_) { /* beacon nunca propaga erro */ }
});

// ── APIs de gestão de pixels (dashboard) ────��───────────────────────────
app.get('/api/pixels', dashboardAuth, (req, res) => {
  res.set('Cache-Control', 'no-store');
  // mascara o token na listagem (só mostra últimos 4 chars)
  const list = pixelStore.list().map((p) => ({
    ...p,
    accessToken: p.accessToken ? '••••' + p.accessToken.slice(-4) : '',
    hasToken: !!p.accessToken
  }));
  res.json({ pixels: list, dir: 'pixels/' });
});

app.post('/api/pixels', dashboardAuth, async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.pixelCode && !b.slug) return res.status(400).json({ error: 'pixelCode é obrigatório' });
    // Se editar sem reenviar token, mantém o existente (o form manda mascarado)
    if (b.slug && b.accessToken && b.accessToken.indexOf('••••') === 0) {
      const existing = pixelStore.get(pixelStore.slugify(b.slug));
      if (existing) b.accessToken = existing.accessToken;
    }
    const saved = await pixelStore.save(b);
    stats.logEvent('info', { title: 'Pixel TikTok salvo: ' + saved.name, ref: saved.slug });
    res.json({ ok: true, pixel: { ...saved, accessToken: saved.accessToken ? '••••' + saved.accessToken.slice(-4) : '' } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/pixels/:slug', dashboardAuth, async (req, res) => {
  try {
    await pixelStore.remove(req.params.slug);
    stats.logEvent('info', { title: 'Pixel TikTok removido', ref: req.params.slug });
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
    const pixel = pixelStore.get(slug);
    if (!pixel) return res.status(404).json({ error: 'pixel não encontrado' });
    const result = await ttEvents.testPixel(pixel);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Log de disparos CAPI (memória rápida + histórico do banco)
app.get('/api/pixels/log', dashboardAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  // 1. tenta memória local + Redis (recentLogAsync faz fallback automático)
  const rows = await ttEvents.recentLogAsync(100);
  if (rows.length) return res.json({ log: rows, source: 'redis' });
  // 2. fallback Neon (backup estruturado para quando Redis não está disponível)
  const db = require('./db');
  const dbRows = await db.loadPixelEvents(100);
  res.json({ log: (dbRows || []).map((r) => ({
    id: r.id, at: r.at, pixel: r.pixel, event: r.event,
    eventId: r.event_id, leadId: r.lead_id, status: r.status, response: r.response
  })), source: 'neon' });
});

app.post('/api/reset-stats', dashboardAuth, (req, res) => {
  stats.reset();
  res.json({ ok: true });
});

// ── Dashboard (HTML inline, protegida) ───────────────────────────────
app.get('/dashboard', dashboardAuth, (req, res) => {
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
// Hidrata stats E config a partir do Neon ANTES de escutar, para que os
// dados de vários dias já estejam disponíveis no primeiro request pós-deploy.
stats.hydrate()
  .then(() => config.hydrate())
  .then(() => pixelStore.init())
  .then(() => linkStore.init())
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`✅ Servidor rodando na porta ${PORT}`);
      console.log(`   Neon (persistência): ${require('./db').enabled ? '✅ ativa' : '❌ desativada'}`);
    });

    // ── Manutenção periódica ─────────────────────────────────────────
    // 1. Prune do mapa de presença em memória (remove sessões expiradas
    //    mesmo sem ninguém consultar /api/live).
    setInterval(() => { try { presence.prune(); } catch (_) {} }, 60 * 1000).unref();
    // 2. Limpeza de sessões antigas no Neon (1x por dia, mantém 30 dias).
    const db = require('./db');
    setInterval(() => { db.pruneSessions(30); db.prunePixelEvents(14); }, 24 * 60 * 60 * 1000).unref();
    setTimeout(() => { db.pruneSessions(30); db.prunePixelEvents(14); }, 30 * 1000).unref();
  });
