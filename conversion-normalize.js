'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Normalização de payloads de gateway → formato interno de conversão.
//
// Módulo PURO (sem I/O, sem side-effects): extraído do server.js para ser
// testável de forma isolada (o server.js dá app.listen ao ser required).
//
// Mapa de parâmetros de rastreio por gateway (o vid é ecoado de volta no
// webhook DENTRO destes containers/campos — ver CLAUDE.md "Atribuição"):
//
//   Gateway      | container no webhook       | campo(s) do vid
//   -------------|----------------------------|-----------------------
//   Kiwify       | trackingParameters / …     | src, sck  (+ utm_*)
//   PerfectPay   | metadata                   | src
//   Stripe       | (raiz)                     | client_reference_id
//   genérico     | (raiz) ou tracking         | s1, sck, src
//
//   ⚠️ Hotmart NÃO devolve src/sck de forma confiável no corpo do webhook v2
//   (são parâmetros da URL da página, não do postback). Para Hotmart a
//   atribuição cai em e-mail/telefone → órfã. NÃO assumimos um campo do vid
//   para Hotmart aqui; se a Hotmart passar a ecoar, adicionar o container.
// ─────────────────────────────────────────────────────────────────────────────

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

// Achata payloads aninhados: Kiwify manda {order:{…}, Customer:{…}, Commissions:{…}},
// Hotmart {data:{purchase:{price:{…}}, buyer:{…}}}, outros {payment:{…}} — mescla
// containers conhecidos no nível raiz (raiz vence). Case-insensitive: "Customer"
// e "customer" são o mesmo container (Kiwify capitaliza os dela).
//
// Inclui containers de RASTREIO (tracking / trackingParameters / metadata) para
// que o vid ecoado (src/sck/s1) suba ao topo e permita o match determinístico.
function flattenGatewayPayload(b) {
  if (!b || typeof b !== 'object') return {};
  const CONTAINERS = ['data', 'order', 'purchase', 'payment', 'transaction', 'sale', 'charge',
    'customer', 'buyer', 'client', 'commissions', 'product', 'subscription', 'price', 'offer',
    // containers de rastreio — casing varia entre gateways, tudo comparado em lowercase
    'tracking', 'trackingparameters', 'tracking_parameters', 'trackingparams', 'metadata', 'meta', 'utm'];
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

// Só aceita string/número primitivo — objetos aninhados (ex.: customer:{…}) viram null.
function str(v) {
  return (typeof v === 'string' || typeof v === 'number') ? String(v).slice(0, 320) : null;
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
    // vid ecoado: raiz OU containers de rastreio (src/sck/s1) já achatados acima
    leadId: str(b.leadId || b.lead_id || b.client_reference_id || b.reference || b.external_id || b.s1 || b.sck || b.src),
    email: str(b.email || b.customer_email || b.buyer_email),
    phone: str(b.phone || b.customer_phone || b.buyer_phone || b.phone_number || b.mobile || b.checkout_phone),
    customer: str(b.customer || b.name || b.full_name || b.buyer_name || b.customer_name),
    product: str(b.product_name || b.content_name || b.product),
    registerSale: true
  };
}

module.exports = {
  mapConversionEvent,
  flattenGatewayPayload,
  parseAmount,
  pickAmountCents,
  normalizeConversion,
  str
};
