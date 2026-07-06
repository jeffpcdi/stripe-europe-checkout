// ── Gateways de pagamento (multi-tenant, 1 webhook por gateway) ────────────
// Cada gateway cadastrado ganha um webhook_token único → a URL do webhook é
// POST /hook/:token. O token identifica a CONTA e o PROVIDER, dispensando
// segredo global (CONVERSION_WEBHOOK_SECRET) e permitindo N gateways por
// conta, como Utmify/Xtracky.
//
// Este módulo faz: CRUD (cache + Neon), catálogo de providers, verificação
// de assinatura por provider e adaptação de payload (pré-mapeia campos
// específicos para o normalizador genérico do server.js entender).
const crypto = require('crypto');
const db = require('./db');

// ── Catálogo de providers suportados ───────────────────────────────────────
// secretLabel: nome do campo de segredo na UI (null = sem segredo)
// docs: dica de configuração exibida na dashboard
const PROVIDERS = {
  kiwify: {
    label: 'Kiwify',
    secretLabel: 'Token de assinatura (opcional)',
    docs: 'Kiwify → Apps → Webhooks → adicione a URL. Selecione os eventos de venda. O token de assinatura fica na tela do webhook.'
  },
  hotmart: {
    label: 'Hotmart',
    secretLabel: 'Hottok (opcional)',
    docs: 'Hotmart → Ferramentas → Webhook (2.0) → adicione a URL. O hottok aparece na configuração do webhook.'
  },
  perfectpay: {
    label: 'PerfectPay',
    secretLabel: 'Token (opcional)',
    docs: 'PerfectPay → Integrações → Webhook → adicione a URL e selecione os eventos de venda.'
  },
  cakto: {
    label: 'Cakto',
    secretLabel: 'Segredo (opcional)',
    docs: 'Cakto → Integrações → Webhooks → adicione a URL e selecione os eventos.'
  },
  stripe: {
    label: 'Stripe',
    secretLabel: 'Signing secret (whsec_…)',
    docs: 'Stripe → Developers → Webhooks → Add endpoint com a URL. Eventos: checkout.session.completed, charge.refunded, charge.dispute.created, payment_intent.payment_failed. Cole o signing secret (whsec_…) aqui.'
  },
  vega: {
    label: 'Vega Checkout',
    secretLabel: 'Token (opcional)',
    docs: 'Vega Checkout → Configurações → Webhooks → adicione a URL e selecione os eventos de venda.'
  },
  adoorei: {
    label: 'Adoorei',
    secretLabel: 'Token (opcional)',
    docs: 'Adoorei → Configurações → Webhooks → adicione a URL.'
  },
  payt: {
    label: 'PayT',
    secretLabel: 'Token (opcional)',
    docs: 'PayT → Integrações → Webhooks → adicione a URL e selecione os eventos.'
  },
  generic: {
    label: 'Genérico (qualquer gateway)',
    secretLabel: 'Segredo (opcional)',
    docs: 'Aceita qualquer payload JSON com event/status (paid, refunded…), order_id/id, amount/value e email. Se definir um segredo, envie-o no header x-webhook-secret ou query ?secret=.'
  }
};

let cache = []; // todas as contas (poucos registros; filtragem é por request)

function newId() { return 'gw_' + crypto.randomBytes(8).toString('hex'); }
function newToken() { return crypto.randomBytes(24).toString('hex'); }

function fromRow(r) {
  return {
    id: r.id,
    accountId: r.account_id || r.accountId,
    provider: r.provider,
    name: r.name || PROVIDERS[r.provider]?.label || r.provider,
    webhookToken: r.webhook_token || r.webhookToken,
    secret: r.secret || null,
    config: r.config || {},
    lastEventAt: r.last_event_at || r.lastEventAt || null,
    lastEventStatus: r.last_event_status || r.lastEventStatus || null,
    createdAt: r.created_at || r.createdAt || null
  };
}

// ── Boot: hidrata do Neon ──────────────────────────────────────────────────
async function init() {
  if (!db.enabled) { console.log('[gateways] Neon desativado — gateways só em memória.'); return 0; }
  const res = await db.loadGateways(null);
  if (res.ok) {
    cache = (res.data || []).map(fromRow);
    console.log('[gateways] ' + cache.length + ' gateway(s) carregado(s).');
  } else {
    console.warn('[gateways] falha ao ler gateways do Neon — cache vazio nesta sessão, banco intocado.');
  }
  return cache.length;
}

// ── CRUD (escopado por conta) ──────────────────────────────────────────────
function list(accountId) {
  return cache.filter((g) => g.accountId === accountId).map((g) => ({ ...g }));
}

function get(accountId, id) {
  return cache.find((g) => g.id === id && g.accountId === accountId) || null;
}

function findByToken(token) {
  if (!token) return null;
  return cache.find((g) => g.webhookToken === token) || null;
}

async function save(accountId, input) {
  input = input || {};
  const provider = String(input.provider || 'generic').toLowerCase();
  if (!PROVIDERS[provider]) throw new Error('provider inválido: ' + provider);
  const existing = input.id ? get(accountId, input.id) : null;
  const g = {
    id: existing ? existing.id : newId(),
    accountId,
    provider,
    name: String(input.name || PROVIDERS[provider].label).slice(0, 80),
    webhookToken: existing ? existing.webhookToken : newToken(),
    secret: input.secret != null ? String(input.secret).slice(0, 200) || null : (existing ? existing.secret : null),
    config: input.config && typeof input.config === 'object' ? input.config : (existing ? existing.config : {}),
    lastEventAt: existing ? existing.lastEventAt : null,
    lastEventStatus: existing ? existing.lastEventStatus : null,
    createdAt: existing ? existing.createdAt : new Date().toISOString()
  };
  const idx = cache.findIndex((x) => x.id === g.id);
  if (idx >= 0) cache[idx] = g; else cache.push(g);
  if (db.enabled) await db.upsertGateway(g);
  return { ...g };
}

async function remove(accountId, id) {
  const g = get(accountId, id);
  if (!g) return false;
  cache = cache.filter((x) => x.id !== id);
  if (db.enabled) await db.deleteGateway(accountId, id);
  return true;
}

// Marca o último evento recebido (feedback "recebendo webhooks" na UI).
function touch(id, status) {
  const g = cache.find((x) => x.id === id);
  if (g) { g.lastEventAt = new Date().toISOString(); g.lastEventStatus = status || null; }
  if (db.enabled) db.touchGateway(id, status);
}

// ── Verificação de assinatura por provider ─────────────────────────────────
function safeEqual(a, b) {
  const ab = Buffer.from(String(a)), bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/**
 * Verifica a autenticidade do webhook conforme o provider.
 * @param {object} gateway  Registro do gateway (secret, provider)
 * @param {object} req      Request do Express (headers, query, body, rawBody)
 * @returns {{ok: boolean, reason?: string}}
 */
function verifySignature(gateway, req) {
  const secret = gateway.secret;
  // Sem segredo cadastrado: o token da URL (impossível de adivinhar) já
  // autentica — comportamento padrão de Utmify/Xtracky.
  if (!secret) return { ok: true };

  switch (gateway.provider) {
    case 'stripe': {
      // Stripe-Signature: t=timestamp,v1=hmac_sha256(t + '.' + rawBody)
      const header = String(req.headers['stripe-signature'] || '');
      const parts = {};
      header.split(',').forEach((kv) => {
        const i = kv.indexOf('=');
        if (i > 0) parts[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
      });
      if (!parts.t || !parts.v1) return { ok: false, reason: 'header Stripe-Signature ausente/incompleto' };
      const raw = req.rawBody != null ? req.rawBody : JSON.stringify(req.body || {});
      const expected = crypto.createHmac('sha256', secret).update(parts.t + '.' + raw).digest('hex');
      if (!safeEqual(expected, parts.v1)) return { ok: false, reason: 'assinatura Stripe inválida' };
      // tolerância de 5 min contra replay
      if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) return { ok: false, reason: 'timestamp Stripe expirado' };
      return { ok: true };
    }
    case 'hotmart': {
      // Hotmart manda o hottok no header x-hotmart-hottok
      const tok = String(req.headers['x-hotmart-hottok'] || req.body?.hottok || '');
      return tok && safeEqual(tok, secret) ? { ok: true } : { ok: false, reason: 'hottok inválido' };
    }
    case 'kiwify': {
      // Kiwify: ?signature= HMAC-SHA1 do rawBody com o token
      const sig = String(req.query.signature || '');
      if (!sig) return { ok: false, reason: 'query ?signature= ausente' };
      const raw = req.rawBody != null ? req.rawBody : JSON.stringify(req.body || {});
      const expected = crypto.createHmac('sha1', secret).update(raw).digest('hex');
      return safeEqual(expected, sig) ? { ok: true } : { ok: false, reason: 'assinatura Kiwify inválida' };
    }
    default: {
      // Demais providers: segredo simples em header/query (x-webhook-secret,
      // x-token, ?secret=, ?token=) ou campo token no body
      const provided = String(
        req.headers['x-webhook-secret'] || req.headers['x-token'] || req.headers['x-api-key'] ||
        req.query.secret || req.query.token ||
        req.body?.token || req.body?.secret || ''
      );
      return provided && safeEqual(provided, secret) ? { ok: true } : { ok: false, reason: 'segredo inválido' };
    }
  }
}

// ── Adaptação de payload por provider ──────────────────────────────────────
// Pré-mapeia formatos específicos para campos que o normalizador genérico
// (flatten + aliases) do server.js entende. Só o Stripe precisa de mapeamento
// real; os gateways BR já são cobertos pelos aliases do normalizador.
function adaptPayload(provider, body) {
  body = body || {};
  if (provider !== 'stripe') return body;

  // Stripe: envelope { type: 'checkout.session.completed', data: { object: {…} } }
  const type = String(body.type || '');
  const obj = (body.data && body.data.object) || {};
  const EVENT_MAP = {
    'checkout.session.completed': 'paid',
    'checkout.session.async_payment_succeeded': 'paid',
    'payment_intent.succeeded': 'paid',
    'invoice.paid': 'paid',
    'charge.refunded': 'refunded',
    'charge.dispute.created': 'chargeback',
    'payment_intent.payment_failed': 'failed',
    'checkout.session.async_payment_failed': 'failed'
  };
  const mapped = EVENT_MAP[type];
  if (!mapped) return { event: type }; // evento não relevante → normalizador rejeita com clareza
  const details = obj.customer_details || {};
  return {
    event: mapped,
    order_id: obj.id || obj.payment_intent || (body.id ? String(body.id) : null),
    // amount_total/amount_received/amount já vêm em CENTAVOS no Stripe
    amount_cents: obj.amount_total != null ? obj.amount_total
      : (obj.amount_received != null ? obj.amount_received : obj.amount),
    currency: obj.currency || null,
    email: details.email || obj.receipt_email || obj.customer_email || null,
    phone: details.phone || null,
    name: details.name || null,
    leadId: obj.client_reference_id || (obj.metadata && (obj.metadata.leadId || obj.metadata.lead_id)) || null,
    product: (obj.metadata && obj.metadata.product) || null
  };
}

module.exports = {
  PROVIDERS,
  init, list, get, save, remove, findByToken, touch,
  verifySignature, adaptPayload
};
