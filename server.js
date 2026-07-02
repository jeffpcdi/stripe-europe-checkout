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
const { Resend } = require('resend');
const { buildConfirmationEmail } = require('./emails/confirmation');
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
const _seenPx = new Map();
function seenPixelEvent(eventId) {
  const now = Date.now();
  if (_seenPx.size > 5000) { // limpeza ocasional
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

// Retorna a variante do visitante (sticky via cookie); atribui conforme config se novo.
// O visitorId torna a atribuição determinística (hash) — sobrevive à limpeza de cookies.
function getOrAssignVariant(req, res, visitorId) {
  let variant = readCookie(req, 'ab_variant');
  if (!stats.VARIANTS.includes(variant)) {
    variant = config.pickVariant(visitorId);
    appendCookie(res, `ab_variant=${variant};Path=/;Max-Age=2592000;SameSite=Lax`);
    stats.recordAssignment(variant);
  }
  return variant;
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

// ── Resend client ─────────────────────────────────────────────────────
function getResend() {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY não configurada nas variáveis de ambiente.');
  return new Resend(key);
}

// ── Middleware ────────────────────────────────────────────────────────
// ATENÇÃO: o webhook Stripe precisa do raw body — definido ANTES do express.json()
app.use('/api/stripe-webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

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
app.use((req, res, next) => {
  try {
    if (req.method !== 'GET') return next();
    const p = req.path || '';
    if (p.startsWith('/api') || p.startsWith('/assets') || p.startsWith('/.well-known')
        || p === '/dashboard' || p === '/checkout') return next();
    const accept = req.headers.accept || '';
    if (!accept.includes('text/html')) return next();          // só navegações
    if (/\.[a-z0-9]{2,5}$/i.test(p) && !p.endsWith('.html')) return next(); // ignora assets

    const hadCookie = !!readCookie(req, 'v_id');
    const id = getOrAssignVisitor(req, res);
    if (!hadCookie) {                                          // 1 lead por visitante
      const geo = geoFromReq(req);
      const q = req.query || {};
      stats.recordVisit({
        id,
        ip: clientIp(req),
        ua: String(req.headers['user-agent'] || '').slice(0, 300),
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
      if (!seenPixelEvent(evId)) {
        ttEvents.dispatchToAll('ViewContent', {
          eventId: evId,
          leadId: id,
          ip: clientIp(req),
          userAgent: String(req.headers['user-agent'] || '').slice(0, 500),
          ttclid: q.ttclid || null,
          url: fullUrl(req)
        }, p).catch(() => {});
      }
    }
  } catch (_) { /* nunca bloquear navegação */ }
  next();
});

// ── Stripe setup ─────────────────────────────────────────────────────
function getStripe() {
  const sk = process.env.STRIPE_SECRET_KEY;
  if (!sk) throw new Error('STRIPE_SECRET_KEY não configurada nas variáveis de ambiente.');
  return require('stripe')(sk);
}

// ── Preços por moeda (em cêntimos) ──────────────────────────────────
const PRICES = { eur: 1297, gbp: 1097, usd: 1397 };

// ── Descrições aleatórias (infoprodutos legítimos aceitos pela Stripe) ─
const DESCRIPTIONS = [
  'Digital Course Access — Social Media Growth',
  'Online Workshop — Content Creator Toolkit',
  'Premium Ebook — Digital Marketing Strategies',
  'Membership Plan — Creator Academy Monthly',
  'Video Training — Audience Growth Blueprint',
  'Digital License — Analytics Dashboard Pro',
  'Online Course — Viral Content Masterclass',
  'Subscription — Social Media Management Suite',
  'Digital Guide — Influencer Monetization Kit',
  'Premium Access — Creator Engagement Platform'
];

const UPSELL_DESCRIPTIONS = [
  'Premium Upgrade — Advanced Creator Tools',
  'Pro Membership — Priority Support & Features',
  'Digital Bundle — Complete Growth Package',
  'VIP Access — Exclusive Creator Resources',
  'Premium Plan — Full Platform Activation',
  'Advanced Module — Pro Analytics & Insights',
  'Elite Package — Accelerated Growth Program',
  'Priority Access — Premium Content Library',
  'Pro Upgrade — Enhanced Creator Dashboard',
  'Gold Tier — Unlimited Platform Features'
];

function randomDesc(list) {
  return list[Math.floor(Math.random() * list.length)];
}

// ── API: Checkout principal — criar PaymentIntent ────────────────────
app.post('/api/create-payment-intent', async (req, res) => {
  try {
    const stripe = getStripe();
    const currency = (req.body.currency || 'eur').toLowerCase();
    const unitAmount = PRICES[currency] ?? PRICES.eur;
    const resolvedCurrency = PRICES[currency] ? currency : 'eur';

    // Dados de atribuição TikTok enviados pelo checkout (para o Events API no webhook)
    const t = req.body.tracking || {};
    const vId = readCookie(req, 'v_id') || '';
    const trackingMeta = {};
    if (t.ttclid) trackingMeta.ttclid = String(t.ttclid).slice(0, 500);
    if (t.ttp) trackingMeta.ttp = String(t.ttp).slice(0, 500);
    trackingMeta.tt_ip = clientIp(req);
    trackingMeta.tt_ua = String(req.headers['user-agent'] || '').slice(0, 500);
    trackingMeta.ab_variant = readCookie(req, 'ab_variant') || 'stripe';
    trackingMeta.v_id = vId;

    // ── tt_url: a URL REAL fica só no servidor (nunca na Stripe) ──────
    // Na metadata da Stripe grava-se uma URL "decoy" rotacionada, para que o
    // painel da Stripe não exponha a landing/parâmetros reais do TikTok.
    const realUrl = t.url ? String(t.url).slice(0, 500) : null;
    if (realUrl) {
      // guarda a URL real (+ ids) no lead, no servidor, para o CAPI no webhook
      if (vId) stats.attachTracking(vId, { ttUrl: realUrl, ttclid: t.ttclid, ttp: t.ttp });
      const decoy = config.nextRotationUrl(); // round-robin; null se rotação off
      trackingMeta.tt_url = decoy || realUrl; // se rotação off, mantém comportamento antigo
      if (decoy) trackingMeta.tt_url_rot = '1'; // marca que está mascarada
    }

    // ── Customer + setup_future_usage: essenciais para o upsell one-click ──
    // Sem Customer anexado, a Stripe NÃO permite reutilizar o payment_method
    // nas páginas /s1 e /s2 (erro "PaymentMethod was previously used...").
    let customerId = readCookie(req, 'sc_id');
    if (customerId && !/^cus_[A-Za-z0-9]+$/.test(customerId)) customerId = null;
    if (!customerId) {
      const cust = await stripe.customers.create({ metadata: { v_id: vId || '' } });
      customerId = cust.id;
    }
    appendCookie(res, `sc_id=${customerId};Path=/;Max-Age=2592000;SameSite=Lax;HttpOnly`);

    let pi;
    const piParams = {
      amount: unitAmount,
      currency: resolvedCurrency,
      customer: customerId,
      setup_future_usage: 'off_session', // guarda o cartão p/ upsell one-click
      automatic_payment_methods: { enabled: true },
      description: randomDesc(DESCRIPTIONS),
      metadata: trackingMeta
    };
    try {
      pi = await stripe.paymentIntents.create(piParams);
    } catch (err) {
      // Customer do cookie pode ter sido apagado na Stripe — recria e tenta 1x
      if (/No such customer/i.test(err.message || '')) {
        const cust = await stripe.customers.create({ metadata: { v_id: vId || '' } });
        customerId = cust.id;
        appendCookie(res, `sc_id=${customerId};Path=/;Max-Age=2592000;SameSite=Lax;HttpOnly`);
        pi = await stripe.paymentIntents.create({ ...piParams, customer: customerId });
      } else throw err;
    }

    res.json({
      clientSecret: pi.client_secret,
      currency: resolvedCurrency,
      unitAmount: unitAmount / 100
    });
  } catch (err) {
    console.error('create-payment-intent error:', err.message);
    res.status(500).json({ error: err.message || 'Erro interno' });
  }
});

// ── API: Upsell one-click — criar PaymentIntent ─────────────────────
// Valores permitidos (cêntimos): s1 = 60,00 €, s2 = 34,00 €.
// Whitelist para impedir manipulação do valor pelo cliente.
const ALLOWED_UPSELL_AMOUNTS = [6000, 3400];
app.post('/api/create-upsell-intent', async (req, res) => {
  try {
    const stripe = getStripe();
    const paymentMethodId = req.body.paymentMethodId || null;
    const reqAmount = Number(req.body.amountCents);
    const amount = ALLOWED_UPSELL_AMOUNTS.includes(reqAmount) ? reqAmount : 6000;

    // Customer criado no checkout inicial (cookie sc_id) — obrigatório para
    // reutilizar o payment_method guardado (one-click)
    let customerId = readCookie(req, 'sc_id');
    if (customerId && !/^cus_[A-Za-z0-9]+$/.test(customerId)) customerId = null;

    // Metadata de rastreamento: o webhook usa isto para o TikTok CAPI do
    // upsell carregar a MESMA identidade do lead (external_id, ttclid, ttp).
    const vIdUp = readCookie(req, 'v_id') || '';
    const upsellMeta = { type: 'upsell', v_id: vIdUp };
    upsellMeta.ab_variant = readCookie(req, 'ab_variant') || 'stripe';
    upsellMeta.tt_ip = clientIp(req);
    upsellMeta.tt_ua = String(req.headers['user-agent'] || '').slice(0, 500);
    try {
      const leadUp = stats.getLead(vIdUp);
      if (leadUp) {
        if (leadUp.ttclid) upsellMeta.ttclid = String(leadUp.ttclid).slice(0, 500);
        if (leadUp.ttp) upsellMeta.ttp = String(leadUp.ttp).slice(0, 500);
      }
    } catch (_) {}

    const params = {
      amount,                // valor validado (60,00 € ou 34,00 €)
      currency: 'eur',
      description: randomDesc(UPSELL_DESCRIPTIONS),
      metadata: upsellMeta,
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: 'never'
      }
    };
    if (customerId) params.customer = customerId;

    // Se vier um paymentMethodId, tenta confirmar imediatamente (one-click)
    if (paymentMethodId) {
      if (!customerId) {
        // Sem customer o one-click é impossível na Stripe — instruí o front a
        // cair no formulário completo em vez de devolver um erro críptico
        return res.status(409).json({ error: 'Sesión de pago expirada. Introduce los datos de nuevo.' });
      }
      params.payment_method = paymentMethodId;
      params.confirm = true;
      params.off_session = true;
    }

    const pi = await stripe.paymentIntents.create(params);

    res.json({
      clientSecret: pi.client_secret,
      status: pi.status,
      paymentIntentId: pi.id
    });
  } catch (err) {
    console.error('create-upsell-intent error:', err.message);
    res.status(500).json({ error: err.message || 'Erro interno' });
  }
});

// ── Webhook Stripe — confirmação de pagamento + e-mail ───────────────
app.post('/api/stripe-webhook', async (req, res) => {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const stripe = getStripe();
  let event;

  try {
    if (webhookSecret) {
      const sig = req.headers['stripe-signature'];
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } else {
      // Sem segredo configurado: parseia o body diretamente (apenas para testes)
      event = JSON.parse(req.body.toString());
    }
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object;

    // Recupera o charge para obter billing_details (nome + email) e detalhes do cartão
    let customerEmail = null;
    let customerName = null;
    let cardInfo = null;
    let country = null;

    try {
      const charges = await stripe.charges.list({ payment_intent: pi.id, limit: 1 });
      const charge = charges.data[0];
      customerEmail = charge?.billing_details?.email || null;
      customerName  = charge?.billing_details?.name  || 'Cliente';
      country       = charge?.billing_details?.address?.country
                    || charge?.payment_method_details?.card?.country || null;
      const card    = charge?.payment_method_details?.card;
      if (card) cardInfo = `${(card.brand || 'card').toUpperCase()} ****${card.last4 || ''}`;
    } catch (err) {
      console.error('Erro ao buscar charge:', err.message);
    }

    if (customerEmail) {
      try {
        const resend = getResend();

        const amountFormatted = new Intl.NumberFormat('pt-PT', {
          style: 'currency',
          currency: (pi.currency || 'eur').toUpperCase()
        }).format(pi.amount_received / 100);

        const dateFormatted = new Intl.DateTimeFormat('pt-PT', {
          day: '2-digit', month: '2-digit', year: 'numeric',
          hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Lisbon'
        }).format(new Date(pi.created * 1000));

        const html = buildConfirmationEmail({
          customerName: customerName,
          orderId: pi.id,
          date: dateFormatted,
          total: amountFormatted,
          type: pi.metadata?.type || 'Pagamento único'
        });

        await resend.emails.send({
          from: 'EventPay <info@suport.com>',
          to: customerEmail,
          subject: 'Compra aprovada — acesse agora',
          html
        });

        console.log(`[stripe-webhook] E-mail de confirmação enviado para ${customerEmail}`);
      } catch (emailErr) {
        console.error('[stripe-webhook] Erro ao enviar e-mail:', emailErr.message);
      }
    } else {
      console.warn('[stripe-webhook] payment_intent.succeeded sem e-mail do cliente:', pi.id);
    }

    // ── TikTok Events API (server-side / CAPI) ────────────────────────
    // event_id idêntico ao pixel do navegador ('CompletePayment.<pi.id>') → dedup automática
    try {
      const md = pi.metadata || {};
      const value = (pi.amount_received || pi.amount || 0) / 100;
      const currency = (pi.currency || 'eur').toUpperCase();

      // tt_url REAL: recupera do store por v_id. A metadata pode conter só a
      // decoy rotacionada (md.tt_url_rot === '1'), que NÃO deve ir ao TikTok.
      let realUrl = null;
      try {
        const lead = stats.getLead(md.v_id);
        if (lead && lead.ttUrl) realUrl = lead.ttUrl;
      } catch (_) {}
      if (!realUrl && md.tt_url && md.tt_url_rot !== '1') realUrl = md.tt_url;
      const contents = [{
        content_id: 'tiktok_verificacao',
        content_name: 'Tasa de Verificacion TikTok',
        content_category: 'Verificacion',
        price: value,
        quantity: 1
      }];

      await ttEvents.dispatchToAll('CompletePayment', {
        eventId: 'CompletePayment.' + pi.id,
        eventTime: pi.created,
        email: customerEmail || undefined,
        leadId: md.v_id || undefined,           // external_id = hash do id único do lead
        externalId: md.v_id ? undefined : (customerEmail || pi.id),
        ip: md.tt_ip || undefined,
        userAgent: md.tt_ua || undefined,
        ttclid: md.ttclid || undefined,
        ttp: md.ttp || undefined,
        url: realUrl || undefined,
        value,
        currency,
        contents
      }, '*');
    } catch (ttErr) {
      console.error('[stripe-webhook] Erro no TikTok CAPI:', ttErr.message);
    }

    // ── Teste A/B — registrar conversão da variante ───────────────────
    try {
      const variant = (pi.metadata && pi.metadata.ab_variant) || 'stripe';
      stats.recordConversion(variant, pi.amount_received || pi.amount, pi.currency);
    } catch (abErr) {
      console.error('[stripe-webhook] Erro ao registrar conversão A/B:', abErr.message);
    }

    // ── Funil — marcar o lead do visitante como COMPRADO (Stripe) ──────
    try {
      const vId = (pi.metadata && pi.metadata.v_id) || pi.id;
      stats.markPurchased(vId, {
        gateway: 'stripe',
        amountCents: pi.amount_received || pi.amount,
        currency: pi.currency,
        customer: customerName || null,
        email: customerEmail || null,
        card: cardInfo || null,
        ref: pi.id
      });
    } catch (fErr) {
      console.error('[stripe-webhook] Erro ao marcar lead comprado:', fErr.message);
    }

    // ── Log de evento — VENDA APROVADA ────────────────────────────────
    try {
      stats.logEvent('sale', {
        title: 'Venda aprovada',
        amount: pi.amount_received || pi.amount,
        currency: pi.currency,
        customer: customerName || null,
        email: customerEmail || null,
        card: cardInfo || null,
        country: country || null,
        gateway: (pi.metadata && pi.metadata.ab_variant) || 'stripe',
        ref: pi.id
      });
    } catch (_) {}

    // ── Pushcut — VENDA APROVADA ──────────────────────────────────────
    try {
      const valor = fmtMoney(pi.amount_received || pi.amount, pi.currency);
      await sendPushcut('Aprovada', {
        title: `Venda aprovada — ${valor}`,
        text: [
          `Cliente: ${customerName || '—'}`,
          customerEmail ? `Email: ${customerEmail}` : null,
          cardInfo ? `Cartão: ${cardInfo}` : null,
          country ? `País: ${country}` : null,
          `Data: ${fmtDate(pi.created)}`,
          `Pedido: ${pi.id}`
        ].filter(Boolean).join('\n'),
        sound: 'system',
        isTimeSensitive: true
      });
    } catch (pcErr) {
      console.error('[stripe-webhook] Erro no Pushcut (venda):', pcErr.message);
    }
  }

  // ── Pushcut — PAGAMENTO RECUSADO ────────────────────────────────────
  else if (event.type === 'payment_intent.payment_failed') {
    const pi = event.data.object;
    const err = pi.last_payment_error || {};
    const bd = err.payment_method?.billing_details || {};
    try {
      stats.logEvent('failed', {
        title: 'Pagamento recusado',
        amount: pi.amount,
        currency: pi.currency,
        customer: bd.name || null,
        email: bd.email || null,
        reason: err.message || err.decline_code || err.code || 'desconhecido',
        gateway: (pi.metadata && pi.metadata.ab_variant) || 'stripe',
        ref: pi.id
      });
    } catch (_) {}
    try {
      await sendPushcut('Recusada', {
        title: `Pagamento recusado — ${fmtMoney(pi.amount, pi.currency)}`,
        text: [
          bd.name ? `Cliente: ${bd.name}` : null,
          bd.email ? `Email: ${bd.email}` : null,
          `Motivo: ${err.message || err.decline_code || err.code || 'desconhecido'}`,
          `Data: ${fmtDate(pi.created)}`,
          `Pedido: ${pi.id}`
        ].filter(Boolean).join('\n'),
        sound: 'system'
      });
    } catch (pcErr) {
      console.error('[stripe-webhook] Erro no Pushcut (recusada):', pcErr.message);
    }
  }

  // ── Pushcut — REEMBOLSO ─────────────────���───────────────────────────
  else if (event.type === 'charge.refunded') {
    const ch = event.data.object;
    try {
      stats.logEvent('refund', {
        title: 'Reembolso',
        amount: ch.amount_refunded,
        currency: ch.currency,
        customer: ch.billing_details?.name || null,
        email: ch.billing_details?.email || null,
        ref: ch.id
      });
    } catch (_) {}
    try {
      await sendPushcut('Reembolso', {
        title: `Reembolso — ${fmtMoney(ch.amount_refunded, ch.currency)}`,
        text: [
          ch.billing_details?.name ? `Cliente: ${ch.billing_details.name}` : null,
          ch.billing_details?.email ? `Email: ${ch.billing_details.email}` : null,
          `Valor original: ${fmtMoney(ch.amount, ch.currency)}`,
          `Data: ${fmtDate(ch.created)}`,
          `Cobrança: ${ch.id}`
        ].filter(Boolean).join('\n'),
        sound: 'system'
      });
    } catch (pcErr) {
      console.error('[stripe-webhook] Erro no Pushcut (reembolso):', pcErr.message);
    }
  }

  // ── Pushcut — DISPUTA / CHARGEBACK ──────────────────────────────────
  else if (event.type === 'charge.dispute.created') {
    const d = event.data.object;
    try {
      stats.logEvent('dispute', {
        title: 'Disputa / chargeback',
        amount: d.amount,
        currency: d.currency,
        reason: d.reason || 'desconhecido',
        status: d.status || null,
        ref: d.charge
      });
    } catch (_) {}
    try {
      await sendPushcut('Disputa', {
        title: `Disputa aberta — ${fmtMoney(d.amount, d.currency)}`,
        text: [
          `Motivo: ${d.reason || 'desconhecido'}`,
          `Status: ${d.status || '—'}`,
          `Data: ${fmtDate(d.created)}`,
          `Cobrança: ${d.charge}`
        ].filter(Boolean).join('\n'),
        sound: 'vibrateOnly',
        isTimeSensitive: true
      });
    } catch (pcErr) {
      console.error('[stripe-webhook] Erro no Pushcut (disputa):', pcErr.message);
    }
  }

  res.json({ received: true });
});

// ── Webhook WayMB ────────────────────────────────────────────────────
app.post('/webhook.php', (req, res) => {
  console.log('WayMB webhook recebido:', JSON.stringify(req.body));
  res.json({ status: 'ok' });
});

// ── Rota /checkout → teste A/B de gateway (configurável) ─────────────
app.get('/checkout', (req, res) => {
  const cfg = config.get();
  const q = req.query || {};
  const currency = (q.currency || 'eur').toLowerCase();
  const expectedAmount = PRICES[currency] || PRICES.eur;

  // Identificador de visitante (liga o checkout ao lead do funil)
  const visitorId = getOrAssignVisitor(req, res);

  // Permite forçar variante para testes: /checkout?ab=stripe ou ?ab=cooud
  const forced = req.query.ab;
  if (forced === 'stripe' || forced === 'cooud') {
    appendCookie(res, `ab_variant=${forced};Path=/;Max-Age=2592000;SameSite=Lax`);
  }

  let variant = (forced === 'stripe' || forced === 'cooud')
    ? forced
    : getOrAssignVariant(req, res, visitorId);

  // Modo "apenas Stripe" força tudo para o Stripe (respeitando override manual)
  if (cfg.mode === 'stripe_only' && forced !== 'cooud') variant = 'stripe';

  stats.recordClick(variant);

  const geo = geoFromReq(req);
  const utm = {
    source: q.utm_source || null, medium: q.utm_medium || null,
    campaign: q.utm_campaign || null, content: q.utm_content || null, term: q.utm_term || null
  };

  // Registra entrada no checkout (funil) para ambas as variantes
  stats.recordCheckoutEntry(visitorId, variant, {
    ip: clientIp(req),
    ua: String(req.headers['user-agent'] || '').slice(0, 300),
    referer: req.headers['referer'] || null,
    country: geo.country, countryName: geo.countryName, city: geo.city,
    ttclid: q.ttclid || null,
    utm,
    expectedAmount,
    expectedCurrency: currency.toUpperCase()
  });

  // ── TikTok CAPI: InitiateCheckout server-side — cobre AMBAS as variantes,
  // inclusive o checkout externo (Cooud), onde não dá para injetar pixel.
  try {
    const lead = stats.getLead(visitorId) || {};
    const evId = 'InitiateCheckout.' + visitorId + '.' + hourKey();
    if (!seenPixelEvent(evId)) {
      ttEvents.dispatchToAll('InitiateCheckout', {
        eventId: evId,
        leadId: visitorId,
        ip: clientIp(req),
        userAgent: String(req.headers['user-agent'] || '').slice(0, 500),
        ttclid: q.ttclid || lead.ttclid || null,
        ttp: lead.ttp || null,
        url: fullUrl(req),
        value: expectedAmount / 100,
        currency: currency.toUpperCase()
      }, '/checkout').catch(() => {});
    }
  } catch (_) { /* rastreamento nunca bloqueia o checkout */ }

  if (variant === 'cooud') {
    stats.logEvent('lead', {
      title: 'Lead enviado ao ' + (cfg.externalName || 'Cooud'),
      gateway: 'cooud',
      amount: expectedAmount,
      currency: currency.toUpperCase(),
      country: geo.countryName || geo.country || null,
      ref: visitorId
    });

    // Preserva query string original + injeta o identificador do visitante p/ conciliação
    const params = new URLSearchParams(req.originalUrl.includes('?') ? req.originalUrl.split('?')[1] : '');
    params.delete('ab'); // parâmetro interno de teste — não vazar para o checkout externo
    params.set('client_reference_id', visitorId);
    params.set('lead_id', visitorId);
    const base = cfg.externalUrl || 'https://checkout.cooud.com/01KVQSV545NN7APJN3RQMGSASV';
    return res.redirect(302, base + '?' + params.toString());
  }

  // Variante nativa (Stripe)
  try {
    const html = fs.readFileSync(path.join(__dirname, 'proximo', 'premium', 'checkout.html'), 'utf8');
    res.set('Content-Type', 'text/html; charset=utf-8');
    return res.send(injectPulse(html));
  } catch (_) {
    return res.sendFile(path.join(__dirname, 'proximo', 'premium', 'checkout.html'));
  }
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

// ── API: estatísticas do teste A/B ───────────────────────────────────
app.get('/api/stats', dashboardAuth, (req, res) => {
  res.set('Cache-Control', 'no-store'); // dados ao vivo — nunca cachear em proxies
  res.json(stats.getStats());
});

// ── API: heartbeat de presença (chamado por todas as páginas do funil) ─
app.post('/api/pulse', (req, res) => {
  try {
    const id = readCookie(req, 'v_id');
    if (!id) return res.json({ ok: false });
    const b = req.body || {};
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
  try { presence.leave(readCookie(req, 'v_id')); } catch (_) {}
  res.json({ ok: true });
});

// ── API: visitantes navegando AGORA (dashboard) ────────────────────────
app.get('/api/live', dashboardAuth, (req, res) => {
  const visitors = presence.list();
  // No checkout agora: Stripe conta pela presença real (heartbeat da página);
  // Cooud é externo (sem script lá) → estimativa via janela de entrada de 10min
  const stripeNow = visitors.filter((v) => v.page && v.page.indexOf('checkout') !== -1).length;
  let cooudEst = 0;
  try { cooudEst = stats.inCheckoutNow().cooud; } catch (_) {}
  res.json({
    visitors,
    summary: presence.summary(),
    checkout: { stripeNow, cooudEst },
    ts: new Date().toISOString()
  });
});

// ── API: configuração do teste A/B (ler/atualizar) ───────────────────
app.get('/api/config', dashboardAuth, (req, res) => {
  const cfg = config.get();
  // _rotIndex é estado interno — não expor na API pública
  const { _rotIndex, ...pub } = cfg;
  res.json(pub);
});
app.post('/api/config', dashboardAuth, (req, res) => {
  const next = config.set(req.body || {});
  const { _rotIndex, ...pub } = next;
  res.json({ ok: true, config: pub });
});

// ── API: health-check — variáveis críticas + ping REAL no banco ─────
app.get('/api/health', dashboardAuth, async (req, res) => {
  const dbPing = await require('./db').ping();
  res.set('Cache-Control', 'no-store');
  res.json({
    stripe:   !!process.env.STRIPE_SECRET_KEY,
    webhook:  !!process.env.STRIPE_WEBHOOK_SECRET,
    resend:   !!process.env.RESEND_API_KEY,
    tiktok:   !!process.env.TIKTOK_ACCESS_TOKEN,
    pushcut:  !!process.env.PUSHCUT_SECRET,
    dashboard:!!process.env.DASHBOARD_PASSWORD,
    db:       dbPing.ok,
    dbLatencyMs: dbPing.ok ? dbPing.latencyMs : null,
    uptimeSec: Math.round(process.uptime()),
    ts: new Date().toISOString()
  });
});

// ── API: conversão do Cooud (para webhook/integração futura) ─────────
// Chame este endpoint a partir do webhook do Cooud quando um pagamento for aprovado.
// Se COOUD_WEBHOOK_SECRET estiver definido, exige o segredo no header
// x-webhook-secret ou em ?secret= — sem ele o endpoint fica aberto (retro-compat).
app.post('/api/cooud-conversion', (req, res) => {
  const secret = process.env.COOUD_WEBHOOK_SECRET;
  if (secret) {
    const provided = req.headers['x-webhook-secret'] || req.query.secret || '';
    if (!provided || !safeEqual(String(provided), secret)) {
      return res.status(401).json({ ok: false, error: 'segredo inválido' });
    }
  }
  const b = req.body || {};
  // Validação do payload: valor numérico, positivo e com teto de sanidade
  const rawAmount = Number(b.amount);
  if (!Number.isFinite(rawAmount) || rawAmount < 0 || rawAmount > 1000000) {
    return res.status(400).json({ ok: false, error: 'amount inválido' });
  }
  const amount = Math.round(rawAmount * 100); // valor em unidades → cêntimos
  const currency = /^[a-zA-Z]{3}$/.test(String(b.currency || '')) ? b.currency : 'eur';
  // aceita várias chaves possíveis vindas do webhook do Cooud
  const leadId = b.leadId || b.lead_id || b.client_reference_id || b.reference || null;
  // flags das funções do Cooud, se o painel/webhook deles enviar
  const smartCapture = b.smartCapture === true || b.smart_capture === true
    || /smart.?capture/i.test(String(b.type || b.method || b.origin || ''));
  const recovery = b.recovery === true || b.recuperar_prejuizo === true || b.loss_recovery === true
    || /recover|recupera|preju/i.test(String(b.type || b.method || b.origin || ''));

  const lead = stats.matchCooudConversion({
    leadId,
    amountCents: amount,
    currency,
    customer: b.customer || b.name || null,
    email: b.email || null,
    ref: b.ref || b.order_id || b.id || null,
    smartCapture,
    recovery
  });

  try {
    var extras = [];
    if (lead.smartCapture) extras.push('Smart Capture');
    if (lead.recovery) extras.push('Recuperar Prejuízo');
    stats.logEvent('sale', {
      title: lead.orphan ? 'Venda Cooud SEM lead (órfã)' : 'Venda aprovada (Cooud)',
      amount: amount,
      currency: currency,
      customer: b.customer || b.name || null,
      email: b.email || null,
      gateway: 'cooud',
      orphan: !!lead.orphan,
      smartCapture: !!lead.smartCapture,
      recovery: !!lead.recovery,
      practice: extras.length ? extras.join(' + ') : null,
      ref: lead.id
    });
  } catch (_) {}

  res.json({ ok: true, matched: !lead.orphan, leadId: lead.id, smartCapture: !!lead.smartCapture, recovery: !!lead.recovery });
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
  try {
    const vId = readCookie(req, 'v_id');
    const b = req.body || {};
    const events = Array.isArray(b.events) ? b.events.slice(0, 5) : [];
    let route = '/';
    try { route = new URL(b.url || 'https://x/').pathname || '/'; } catch (_) {}
    events.forEach((e) => {
      const name = String(e.n || '').slice(0, 40);
      const evId = String(e.id || '').slice(0, 120);
      if (!name || !evId) return;
      if (!/^(ViewContent|InitiateCheckout|AddToCart)$/.test(name)) return; // whitelist
      if (seenPixelEvent(evId)) return; // já disparado pelo middleware/rota
      ttEvents.dispatchToAll(name, {
        eventId: evId,
        leadId: vId || undefined,
        ip: clientIp(req),
        userAgent: String(req.headers['user-agent'] || '').slice(0, 500),
        ttclid: b.ttclid ? String(b.ttclid).slice(0, 500) : undefined,
        ttp: b.ttp ? String(b.ttp).slice(0, 500) : undefined,
        url: b.url ? String(b.url).slice(0, 500) : undefined
      }, route).catch(() => {});
      // guarda ttclid/_ttp no lead — enriquece conversões futuras
      if (vId && (b.ttclid || b.ttp)) {
        try { stats.attachTracking(vId, { ttclid: b.ttclid || undefined, ttp: b.ttp || undefined }); } catch (_) {}
      }
    });
    res.json({ ok: true });
  } catch (_) {
    res.json({ ok: false });
  }
});

// ── APIs de gestão de pixels (dashboard) ────────────────────────────────
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
  const mem = ttEvents.recentLog(100);
  let dbRows = null;
  if (mem.length < 20) {
    const db = require('./db');
    dbRows = await db.loadPixelEvents(100);
  }
  res.json({ log: mem.length ? mem : (dbRows || []).map((r) => ({
    id: r.id, at: r.at, pixel: r.pixel, event: r.event,
    eventId: r.event_id, leadId: r.lead_id, status: r.status, response: r.response
  })) });
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

// ── Injeção do heartbeat de presença em todas as páginas HTML do funil ─
// Resolve o arquivo HTML como o express.static faria (exato, /index.html ou
// extensão .html), injeta o script de "pulse" e envia. Se não for HTML, segue.
function resolveHtml(reqPath) {
  try {
    const clean = decodeURIComponent(reqPath.split('?')[0]);
    if (clean.includes('..')) return null;
    const base = path.join(__dirname, clean);
    const candidates = [];
    if (clean.endsWith('.html')) candidates.push(base);
    else if (clean.endsWith('/')) candidates.push(path.join(base, 'index.html'));
    else { candidates.push(base + '.html'); candidates.push(path.join(base, 'index.html')); }
    for (const f of candidates) {
      if (f.startsWith(__dirname) && fs.existsSync(f) && fs.statSync(f).isFile()) return f;
    }
  } catch (_) {}
  return null;
}
function sendHtmlWithPulse(res, filePath) {
  const html = fs.readFileSync(filePath, 'utf8');
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(injectPulse(html));
}
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/assets')
      || req.path === '/dashboard' || req.path === '/checkout') return next();
  const accept = req.headers.accept || '';
  if (!accept.includes('text/html')) return next();
  const file = resolveHtml(req.path);
  if (!file) return next();
  try { return sendHtmlWithPulse(res, file); } catch (_) { return next(); }
});

// ── Apple Pay: servir .well-known (verificação de domínio) ──────────
app.use('/.well-known', express.static(path.join(__dirname, '.well-known'), {
  dotfiles: 'allow'
}));

// ── Proteger dados sensíveis (stats do A/B) de acesso público ────────
app.use(['/data', '/stats.js', '/config.js', '/dashboard-view.js', '/tiktok-events.js', '/pushcut.js', '/emails', '/pixels', '/pixel-store.js', '/db.js', '/presence.js'], (req, res) => {
  res.status(404).send('Not found');
});

// ── Servir ficheiros estáticos ───────────────────────────────────────
// Serve index.html automaticamente para pastas (ex: /1/ → /1/index.html)
app.use(express.static(path.join(__dirname), {
  extensions: ['html'],
  index: 'index.html'
}));

// Fallback: se pedir /1 sem barra, serve /1/index.html (com pulse injetado)
app.get('*', (req, res, next) => {
  const filePath = path.join(__dirname, req.path, 'index.html');
  if (fs.existsSync(filePath)) {
    try { return sendHtmlWithPulse(res, filePath); } catch (_) { return res.sendFile(filePath); }
  }
  next();
});

// ── Iniciar servidor ─────────────────────────────────────────────────
// Hidrata stats E config a partir do Neon ANTES de escutar, para que os
// dados de vários dias já estejam disponíveis no primeiro request pós-deploy.
stats.hydrate()
  .then(() => config.hydrate())
  .then(() => pixelStore.init())
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`✅ Servidor rodando na porta ${PORT}`);
      console.log(`   STRIPE_SECRET_KEY: ${process.env.STRIPE_SECRET_KEY ? '✅ configurada' : '❌ NÃO CONFIGURADA'}`);
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
