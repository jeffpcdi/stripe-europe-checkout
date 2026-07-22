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

// A ORDEM das checagens importa. Casos que se confundem:
//  - "subscription.canceled" contém "cancel" → NÃO é pagamento recusado; é
//    churn de assinatura. Precisa ser tratado ANTES do Failed (que casa "cancel").
//  - Renovação de assinatura ("invoice.payment_succeeded", "subscription_charged",
//    "renovada"…) É uma venda recorrente → CompletePayment. Mas uma renovação
//    que FALHOU ("recurring_payment_failed") continua Failed — por isso o Failed
//    é avaliado ANTES do sucesso recorrente.
function mapConversionEvent(raw) {
  const s = String(raw || '').toLowerCase();
  if (/refund|reembols|estorn|devolvid/.test(s)) return 'Refund';
  if (/charged?_?back|dispute|disputa|protest|contesta/.test(s)) return 'Dispute';
  // Cancelamento/pausa de ASSINATURA não é pagamento recusado — ignora (não
  // dispara Failed nem CAPI). Guardado ANTES do Failed, que casaria "cancel".
  if (/(subscription|assinatura|recurr|recorr)[^a-z]?.*(cancel|delet|pause|paus|revok)|(cancel|delet|pause|paus|revok).*(subscription|assinatura|recurr|recorr)/.test(s)) return null;
  // Falha/recusa de pagamento (inclui falha de renovação: "..._failed").
  if (/fail|refus|recus|declin|denied|negad|cancel|expirad|expired|chargefail/.test(s)) return 'Failed';
  // Renovação/cobrança recorrente BEM-SUCEDIDA = venda recorrente.
  if (/renew|renov|recurr|recorren|subscription_?charged|subscription_?renew|invoice\.payment_succeeded|invoice_paid/.test(s)) return 'CompletePayment';
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
  // Item 458 (bug 1000x): "1.234" com ponto de MILHAR BR (grupos de 3, sem
  // vírgula decimal) lia como 1.234 em vez de 1234. Padrão inequívoco de
  // milhar: 1–3 dígitos + grupos de exatamente 3 ("1.234", "12.345.678").
  // "12.34"/"1.2345" não casam (decimal legítimo) e "0.234" é excluído
  // porque valor monetário nunca agrupa milhar começando em zero.
  if (/^-?[1-9]\d{0,2}(\.\d{3})+$/.test(s)) return Number(s.replace(/\./g, ''));
  const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');   // 1.234,56 → 1234.56
  else s = s.replace(/,/g, '');                                          // 1,234.56 → 1234.56
  return Number(s);
}

// Varredura RECURSIVA (breadth-first) por campos candidatos. O valor pode estar
// aninhado em containers que o flatten não conhece (ex.: o gateway manda
// { data: { transaction: { charge: {...} } } } e pickAmountCents só olhava a
// raiz). BFS garante que a ocorrência MAIS RASA de cada alias vença — assim a
// raiz continua com prioridade sobre um campo homônimo lá no fundo (ex.: uma
// comissão). Mesmo princípio do flattenGatewayPayload, mas para QUALQUER nível.
function collectFields(root, wanted) {
  const found = {};
  let level = [root];
  let depth = 0;
  while (level.length && depth < 8) {
    const next = [];
    for (const obj of level) {
      if (Array.isArray(obj)) {
        for (const item of obj) if (item && typeof item === 'object') next.push(item);
        continue;
      }
      if (!obj || typeof obj !== 'object') continue;
      for (const k of Object.keys(obj)) {
        const kl = String(k).toLowerCase();
        const v = obj[k];
        // primeira (mais rasa) ocorrência de cada alias vence
        if (wanted.has(kl) && !(kl in found)) found[kl] = v;
        if (v && typeof v === 'object') next.push(v);
      }
    }
    level = next;
    depth++;
  }
  return found;
}

// Extrai o valor da venda em CENTAVOS testando aliases de todos os gateways,
// em QUALQUER profundidade (item handoff #3). Campos que já vêm em centavos
// (Kiwify: charge_amount, product_base_price) têm prioridade e NÃO são
// multiplicados por 100.
const CENTS_FIELDS = ['amount_cents', 'value_cents', 'total_cents', 'price_cents', 'charge_amount', 'product_base_price'];
const UNIT_FIELDS = ['amount', 'value', 'valor', 'total', 'price', 'total_price', 'total_value',
  'total_amount', 'valor_total', 'order_amount', 'payment_amount', 'amount_paid', 'paid_amount',
  'sale_amount', 'purchase_amount', 'gross_amount', 'net_amount', 'full_price'];
function pickAmountCents(b, opts) {
  // amountInCents: alguns gateways (ex.: "Cloud") mandam o valor JÁ em centavos
  // (menor unidade) mesmo sob um alias "de unidade" (amount/value/total). Sem
  // isso, o valor era multiplicado por 100 (ex.: amount:694 → €694 em vez de
  // €6,94). Configurável por gateway (config.amountInCents).
  const amountInCents = !!(opts && opts.amountInCents);
  const wanted = new Set(CENTS_FIELDS.concat(UNIT_FIELDS));
  const found = collectFields(b, wanted);
  for (let i = 0; i < CENTS_FIELDS.length; i++) {
    const n = parseAmount(found[CENTS_FIELDS[i]]);
    if (Number.isFinite(n) && n >= 0 && n <= 100000000) return Math.round(n);
  }
  for (let j = 0; j < UNIT_FIELDS.length; j++) {
    const n = parseAmount(found[UNIT_FIELDS[j]]);
    if (!Number.isFinite(n) || n < 0) continue;
    // gateway manda em centavos: NÃO multiplica (o valor já é a menor unidade)
    if (amountInCents) { if (n <= 100000000) return Math.round(n); continue; }
    if (n <= 1000000) return Math.round(n * 100);
  }
  return null;
}

// Só aceita string/número primitivo — objetos aninhados (ex.: customer:{…}) viram null.
function str(v) {
  return (typeof v === 'string' || typeof v === 'number') ? String(v).slice(0, 320) : null;
}

// Advanced Matching (EMQ): e-mail e telefone do comprador são o sinal de match
// mais forte no evento de dinheiro. Alguns gateways aninham o cliente em
// containers que o flatten não conhece (ex.: Stripe `customer_details.email`,
// PagSeguro `sender.email`, payloads `charges[].billing_details.email`), então
// a busca é RECURSIVA (mesmo mecanismo do valor/ttclid), não só na raiz. A
// ocorrência mais rasa vence — a raiz continua com prioridade sobre um e-mail
// de afiliado/comissão lá no fundo.
const EMAIL_ALIASES = ['email', 'customer_email', 'buyer_email', 'payer_email', 'contact_email',
  'email_address', 'e_mail', 'client_email', 'cliente_email', 'user_email', 'checkout_email',
  'receipt_email', 'sender_email'];
const PHONE_ALIASES = ['phone', 'customer_phone', 'buyer_phone', 'phone_number', 'mobile',
  'checkout_phone', 'telefone', 'celular', 'whatsapp', 'phone_local_code', 'contact_phone',
  'cliente_telefone', 'sender_phone', 'mobile_phone', 'msisdn', 'tel'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function pickContactByDepth(root, aliases, valid) {
  const wanted = new Set(aliases);
  let level = [root];
  let depth = 0;
  while (level.length && depth < 8) {
    const next = [];
    const atDepth = {};
    for (const obj of level) {
      if (Array.isArray(obj)) {
        for (const item of obj) if (item && typeof item === 'object') next.push(item);
        continue;
      }
      if (!obj || typeof obj !== 'object') continue;
      for (const key of Object.keys(obj)) {
        const normalized = String(key).toLowerCase();
        const value = obj[key];
        if (wanted.has(normalized) && !(normalized in atDepth)) atDepth[normalized] = value;
        if (value && typeof value === 'object') next.push(value);
      }
    }
    for (const alias of aliases) {
      const value = str(atDepth[alias]);
      if (value && valid(value.trim())) return value.trim();
    }
    level = next;
    depth++;
  }
  return null;
}
function pickEmail(body, flat) {
  const nested = pickContactByDepth(body || {}, EMAIL_ALIASES, (value) => EMAIL_RE.test(value));
  if (nested) return nested;
  for (const alias of EMAIL_ALIASES) {
    const value = str(flat[alias]);
    if (value && EMAIL_RE.test(value.trim())) return value.trim();
  }
  return null;
}
function pickPhone(body, flat) {
  const valid = (value) => String(value).replace(/\D/g, '').length >= 7;
  const nested = pickContactByDepth(body || {}, PHONE_ALIASES, valid);
  if (nested) return nested;
  for (const alias of PHONE_ALIASES) {
    const value = str(flat[alias]);
    // precisa ter dígitos suficientes para ser telefone (o hash E.164 acontece
    // depois, em tiktok-events.js); descarta "0"/lixo curto que zeraria o EMQ.
    if (value && valid(value)) return value.trim();
  }
  return null;
}

// Alguns provedores enviam no mesmo webhook notificações da CONTA do lojista
// (saque, payout, transferência de saldo). Elas não são uma compra do cliente
// e palavras como "TRANSFER_COMPLETED" não podem cair no regex genérico de
// "completed". Só ignoramos quando o tipo e o formato financeiro concordam;
// webhooks de pagamento com nome parecido continuam indo para a quarentena.
function operationalWebhook(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const rawType = String(body.event || body.event_type || body.type || body.status || '').trim().toLowerCase();
  const keys = Object.keys(body).map((key) => String(key).toLowerCase());
  const payoutShape = keys.some((key) => /^(withdraw|withdrawal|payout|payoutaccount|sents|settlement)$/.test(key));
  if (payoutShape && /^(transfer|withdraw|withdrawal|payout|settlement)[._:-]/.test(rawType)) {
    return { ignored: true, reason: 'notificação financeira da conta (saque/transferência), não é compra' };
  }
  return null;
}

// Normaliza QUALQUER payload de gateway para o formato interno.
function normalizeConversion(body, query) {
  const operational = operationalWebhook(body);
  if (operational) return operational;
  const b = flattenGatewayPayload(body);
  // Risco 3: extrai o ttclid ecoado pelo gateway (chave de match determinística
  // e last-click pago). Busca RECURSIVA e case-insensitive (mesmo padrão do
  // collectFields), então acha o ttclid mesmo aninhado em trackingParameters /
  // metadata / tracking. Aliases aceitos: ttclid, utm_ttclid.
  const trk = collectFields(body || {}, new Set(['ttclid', 'utm_ttclid']));
  const ttclidRaw = str(trk.ttclid || trk.utm_ttclid || b.ttclid || b.utm_ttclid);
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
  const amountCents = pickAmountCents(b, { amountInCents: !!(query && query.amountInCents) });
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
    ttclid: ttclidRaw, // Risco 3: 1ª tentativa de match (antes do leadId)
    // Advanced Matching: busca recursiva (raiz vence) — e-mail/telefone do
    // comprador sobem o EMQ do CompletePayment mesmo aninhados fundo.
    email: pickEmail(body, b),
    phone: pickPhone(body, b),
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
  operationalWebhook,
  normalizeConversion,
  str
};
