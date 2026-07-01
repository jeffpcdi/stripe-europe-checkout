const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────────
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
      description: 'Tasa de Verificación TikTok'
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
      description: 'Upsell TikTok — Activación Premium',
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

// ── Webhook WayMB ────────────────────────────────────────────────────
app.post('/webhook.php', (req, res) => {
  console.log('WayMB webhook recebido:', JSON.stringify(req.body));
  res.json({ status: 'ok' });
});

// ── Rota /checkout → serve o checkout Stripe ─────────────────────────
app.get('/checkout', (req, res) => {
  res.sendFile(path.join(__dirname, 'proximo', 'premium', 'checkout.html'));
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
