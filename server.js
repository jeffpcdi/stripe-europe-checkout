const express = require('express');
const path = require('path');
const { Resend } = require('resend');
const { buildConfirmationEmail } = require('./emails/confirmation');
const { sendTikTokEvent } = require('./tiktok-events');
const { sendPushcut } = require('./pushcut');
const stats = require('./stats');
const DASHBOARD_HTML = require('./dashboard-view');

// ── Teste A/B de gateway (50/50) ─────────────────────────────────────
const COOUD_CHECKOUT_URL = process.env.COOUD_CHECKOUT_URL
  || 'https://checkout.cooud.com/01KVQSV545NN7APJN3RQMGSASV';

// Lê um cookie do request (parse simples, sem dependência extra)
function readCookie(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  const found = raw.split(';').map((c) => c.trim()).find((c) => c.startsWith(name + '='));
  return found ? decodeURIComponent(found.split('=').slice(1).join('=')) : null;
}

// Retorna a variante do visitante (sticky via cookie); atribui 50/50 se novo
function getOrAssignVariant(req, res) {
  let variant = readCookie(req, 'ab_variant');
  if (!stats.VARIANTS.includes(variant)) {
    variant = Math.random() < 0.5 ? 'stripe' : 'cooud';
    res.setHeader('Set-Cookie',
      `ab_variant=${variant};Path=/;Max-Age=2592000;SameSite=Lax`); // 30 dias
    stats.recordAssignment(variant);
  }
  return variant;
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

// IP real do cliente (respeita proxy/Railway via X-Forwarded-For)
function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.socket?.remoteAddress || req.ip || '';
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

// CORS headers para todas as rotas API
app.use('/api', (req, res, next) => {
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  if (req.method === 'OPTIONS') return res.sendStatus(204);
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
    const trackingMeta = {};
    if (t.ttclid) trackingMeta.ttclid = String(t.ttclid).slice(0, 500);
    if (t.ttp) trackingMeta.ttp = String(t.ttp).slice(0, 500);
    if (t.url) trackingMeta.tt_url = String(t.url).slice(0, 500);
    trackingMeta.tt_ip = clientIp(req);
    trackingMeta.tt_ua = String(req.headers['user-agent'] || '').slice(0, 500);
    trackingMeta.ab_variant = readCookie(req, 'ab_variant') || 'stripe';

    const pi = await stripe.paymentIntents.create({
      amount: unitAmount,
      currency: resolvedCurrency,
      automatic_payment_methods: { enabled: true },
      description: randomDesc(DESCRIPTIONS),
      metadata: trackingMeta
    });

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

// ── API: Upsell one-click — criar PaymentIntent (60 €) ──────────────
app.post('/api/create-upsell-intent', async (req, res) => {
  try {
    const stripe = getStripe();
    const paymentMethodId = req.body.paymentMethodId || null;

    const params = {
      amount: 6000,          // 60,00 €
      currency: 'eur',
      description: randomDesc(UPSELL_DESCRIPTIONS),
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: 'never'
      }
    };

    // Se vier um paymentMethodId, tenta confirmar imediatamente (one-click)
    if (paymentMethodId) {
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
      const contents = [{
        content_id: 'tiktok_verificacao',
        content_name: 'Tasa de Verificacion TikTok',
        content_category: 'Verificacion',
        price: value,
        quantity: 1
      }];

      await sendTikTokEvent({
        event: 'CompletePayment',
        eventId: 'CompletePayment.' + pi.id,
        eventTime: pi.created,
        email: customerEmail || undefined,
        externalId: customerEmail || pi.id,
        ip: md.tt_ip || undefined,
        userAgent: md.tt_ua || undefined,
        ttclid: md.ttclid || undefined,
        ttp: md.ttp || undefined,
        url: md.tt_url || undefined,
        value,
        currency,
        contents
      });
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

    // ── Pushcut — VENDA APROVADA ──────────────────────────────────────
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
  }

  // ── Pushcut — PAGAMENTO RECUSADO ────────────────────────────────────
  else if (event.type === 'payment_intent.payment_failed') {
    const pi = event.data.object;
    const err = pi.last_payment_error || {};
    const bd = err.payment_method?.billing_details || {};
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
  }

  // ── Pushcut — REEMBOLSO ─────────────────────────────────────────────
  else if (event.type === 'charge.refunded') {
    const ch = event.data.object;
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
  }

  // ── Pushcut — DISPUTA / CHARGEBACK ──────────────────────────────────
  else if (event.type === 'charge.dispute.created') {
    const d = event.data.object;
    await sendPushcut('Disputa', {
      title: `⚠️ Disputa aberta — ${fmtMoney(d.amount, d.currency)}`,
      text: [
        `Motivo: ${d.reason || 'desconhecido'}`,
        `Status: ${d.status || '—'}`,
        `Data: ${fmtDate(d.created)}`,
        `Cobrança: ${d.charge}`
      ].filter(Boolean).join('\n'),
      sound: 'vibrateOnly',
      isTimeSensitive: true
    });
  }

  res.json({ received: true });
});

// ── Webhook WayMB ────────────────────────────────────────────────────
app.post('/webhook.php', (req, res) => {
  console.log('WayMB webhook recebido:', JSON.stringify(req.body));
  res.json({ status: 'ok' });
});

// ── Rota /checkout → teste A/B de gateway (50/50) ────────────────────
app.get('/checkout', (req, res) => {
  // Permite forçar variante para testes: /checkout?ab=stripe ou ?ab=cooud
  const forced = req.query.ab;
  if (forced === 'stripe' || forced === 'cooud') {
    res.setHeader('Set-Cookie', `ab_variant=${forced};Path=/;Max-Age=2592000;SameSite=Lax`);
  }

  const variant = (forced === 'stripe' || forced === 'cooud')
    ? forced
    : getOrAssignVariant(req, res);

  stats.recordClick(variant);

  if (variant === 'cooud') {
    // Preserva query string (UTMs, ttclid, etc.) no redirect externo
    const qs = req.originalUrl.includes('?') ? '?' + req.originalUrl.split('?')[1] : '';
    return res.redirect(302, COOUD_CHECKOUT_URL + qs);
  }

  // Variante nativa (Stripe)
  res.sendFile(path.join(__dirname, 'proximo', 'premium', 'checkout.html'));
});

// ── Auth simples (Basic Auth) para a dashboard ───────────────────────
function dashboardAuth(req, res, next) {
  const pass = process.env.DASHBOARD_PASSWORD;
  if (!pass) return next(); // sem senha definida: acesso livre (defina DASHBOARD_PASSWORD para proteger)
  const header = req.headers.authorization || '';
  const token = header.startsWith('Basic ') ? Buffer.from(header.slice(6), 'base64').toString() : '';
  const provided = token.split(':').slice(1).join(':'); // ignora usuário, valida senha
  if (provided === pass) return next();
  res.set('WWW-Authenticate', 'Basic realm="Dashboard"');
  return res.status(401).send('Autenticação necessária.');
}

// ── API: estatísticas do teste A/B ───────────────────────────────────
app.get('/api/stats', dashboardAuth, (req, res) => {
  res.json(stats.getStats());
});

// ── API: conversão do Cooud (para webhook/integração futura) ─────────
// Chame este endpoint a partir do webhook do Cooud quando um pagamento for aprovado.
app.post('/api/cooud-conversion', (req, res) => {
  const amount = Math.round((Number(req.body.amount) || 0) * 100); // valor em unidades → cêntimos
  const currency = req.body.currency || 'eur';
  stats.recordConversion('cooud', amount, currency);
  res.json({ ok: true });
});

// ── API: zerar estatísticas ──────────────────────────────────────────
app.post('/api/reset-stats', dashboardAuth, (req, res) => {
  stats.reset();
  res.json({ ok: true });
});

// ── Dashboard (HTML inline, protegida) ───────────────────────────────
app.get('/dashboard', dashboardAuth, (req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(DASHBOARD_HTML);
});

// ── Apple Pay: servir .well-known (verificação de domínio) ──────────
app.use('/.well-known', express.static(path.join(__dirname, '.well-known'), {
  dotfiles: 'allow'
}));

// ── Proteger dados sensíveis (stats do A/B) de acesso público ────────
app.use(['/data', '/stats.js', '/dashboard-view.js', '/tiktok-events.js', '/pushcut.js', '/emails'], (req, res) => {
  res.status(404).send('Not found');
});

// ── Servir ficheiros estáticos ───────────────────────────────────────
// Serve index.html automaticamente para pastas (ex: /1/ → /1/index.html)
app.use(express.static(path.join(__dirname), {
  extensions: ['html'],
  index: 'index.html'
}));

// Fallback: se pedir /1 sem barra, redireciona para /1/ (que serve /1/index.html)
app.get('*', (req, res, next) => {
  const filePath = path.join(__dirname, req.path, 'index.html');
  const fs = require('fs');
  if (fs.existsSync(filePath)) {
    return res.sendFile(filePath);
  }
  next();
});

// ── Iniciar servidor ─────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Servidor rodando na porta ${PORT}`);
  console.log(`   STRIPE_SECRET_KEY: ${process.env.STRIPE_SECRET_KEY ? '✅ configurada' : '❌ NÃO CONFIGURADA'}`);
});
