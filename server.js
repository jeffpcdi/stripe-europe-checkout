const express = require('express');
const path = require('path');
const { Resend } = require('resend');
const { buildConfirmationEmail } = require('./emails/confirmation');

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

    const pi = await stripe.paymentIntents.create({
      amount: unitAmount,
      currency: resolvedCurrency,
      automatic_payment_methods: { enabled: true },
      description: randomDesc(DESCRIPTIONS)
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

    // Recupera o charge para obter billing_details (nome + email)
    let customerEmail = null;
    let customerName = null;

    try {
      const charges = await stripe.charges.list({ payment_intent: pi.id, limit: 1 });
      const charge = charges.data[0];
      customerEmail = charge?.billing_details?.email || null;
      customerName  = charge?.billing_details?.name  || 'Cliente';
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
  }

  res.json({ received: true });
});

// ── Webhook WayMB ────────────────────────────────────────────────────
app.post('/webhook.php', (req, res) => {
  console.log('WayMB webhook recebido:', JSON.stringify(req.body));
  res.json({ status: 'ok' });
});

// ── Rota /checkout → serve o checkout Stripe ─────────────────────────
app.get('/checkout', (req, res) => {
  res.sendFile(path.join(__dirname, 'proximo', 'premium', 'checkout.html'));
});

// ── Apple Pay: servir .well-known (verificação de domínio) ──────────
app.use('/.well-known', express.static(path.join(__dirname, '.well-known'), {
  dotfiles: 'allow'
}));

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
