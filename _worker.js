const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}

async function stripePost(path, params, secretKey) {
  const body = new URLSearchParams(params).toString();
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });
  return res.json();
}

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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    // ── Webhook WayMB — aceita POST em /webhook.php ──────────────────
    if (url.pathname === '/webhook.php' && request.method === 'POST') {
      try {
        const body = await request.json();
        console.log('WayMB webhook recebido:', JSON.stringify(body));
      } catch (_) {}
      return json({ status: 'ok' });
    }

    // ── Checkout principal: criar PaymentIntent ───────────────────────
    if (url.pathname === '/api/create-payment-intent' && request.method === 'POST') {
      try {
        const sk = env.STRIPE_SECRET_KEY;
        if (!sk) return json({ error: 'Stripe secret key não configurada.' }, 500);

        const body = await request.json().catch(() => ({}));
        const currency = (body.currency || 'eur').toLowerCase();

        // Preços por moeda (em cêntimos)
        const PRICES = { eur: 1297, gbp: 1097, usd: 1397 };
        const unitAmount = PRICES[currency] ?? PRICES.eur;
        const resolvedCurrency = PRICES[currency] ? currency : 'eur';

        const pi = await stripePost('/payment_intents', {
          amount: String(unitAmount),
          currency: resolvedCurrency,
          'automatic_payment_methods[enabled]': 'true',
          description: randomDesc(DESCRIPTIONS)
        }, sk);

        if (pi.error) return json({ error: pi.error.message }, 400);

        return json({
          clientSecret: pi.client_secret,
          currency: resolvedCurrency,
          unitAmount: unitAmount / 100
        });
      } catch (err) {
        return json({ error: err.message || 'Erro interno' }, 500);
      }
    }

    // ── Upsell one-click: criar PaymentIntent (60 €) ─────────────────
    if (url.pathname === '/api/create-upsell-intent' && request.method === 'POST') {
      try {
        const sk = env.STRIPE_SECRET_KEY;
        if (!sk) return json({ error: 'Stripe secret key não configurada.' }, 500);

        const body = await request.json().catch(() => ({}));
        const paymentMethodId = body.paymentMethodId || null;

        const params = {
          amount: '6000',          // 60,00 €
          currency: 'eur',
          description: randomDesc(UPSELL_DESCRIPTIONS),
          'automatic_payment_methods[enabled]': 'true',
          'automatic_payment_methods[allow_redirects]': 'never'
        };

        // Se vier um paymentMethodId, tenta confirmar imediatamente (one-click)
        if (paymentMethodId) {
          params.payment_method = paymentMethodId;
          params.confirm = 'true';
          params.off_session = 'true';
        }

        const pi = await stripePost('/payment_intents', params, sk);

        if (pi.error) return json({ error: pi.error.message }, 400);

        return json({
          clientSecret: pi.client_secret,
          status: pi.status,
          paymentIntentId: pi.id
        });
      } catch (err) {
        return json({ error: err.message || 'Erro interno' }, 500);
      }
    }

    // Tudo o resto → ficheiros estáticos normais
    return env.ASSETS.fetch(request);
  }
};
