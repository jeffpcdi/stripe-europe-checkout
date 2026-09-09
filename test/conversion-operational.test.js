'use strict';

const assert = require('assert');
const { normalizeConversion, operationalWebhook } = require('../conversion-normalize');

const payout = {
  event: 'TRANSFER_COMPLETED',
  token: 'redacted',
  withdraw: { id: 'w_1', amount: 100 },
  sents: [],
  payoutAccount: { id: 'pa_1' }
};
const ignored = normalizeConversion(payout, { gateway: 'generic' });
assert.strictEqual(ignored.ignored, true, 'transferência de saldo não vira compra');
assert.match(ignored.reason, /não é compra/);

assert.strictEqual(operationalWebhook({ event: 'TRANSFER_COMPLETED', order_id: 'order-1', amount: 97 }), null,
  'nome transfer sem formato de payout não é ignorado por chute');
const payment = normalizeConversion({ event: 'TRANSFER_COMPLETED', order_id: 'order-1', amount: 97 }, { gateway: 'generic' });
assert.strictEqual(payment.event, 'CompletePayment', 'webhook de pagamento parecido continua sendo normalizado');

console.log('[PASS] conversion-operational: payout é ignorado; pagamento semelhante continua auditável.');

const gateways = require('../gateway-store');
const pending = normalizeConversion({ event: 'pending', order_id: 'pix-1', amount: 97, currency: 'BRL', payment: { method: 'pix' } });
assert.strictEqual(pending.paymentMethod, 'pix');
assert.strictEqual(pending.event, 'AddPaymentInfo');
assert.strictEqual(normalizeConversion({ event: 'pending', order_id: 'card-1', product: 'Curso Pix', payment_method: 'card' }).paymentMethod, null);
assert.strictEqual(normalizeConversion({ event: 'paid', order_id: 'pix-1', amount: 97, payment_method: 'pix' }).event, 'CompletePayment');
const stripePending = normalizeConversion(gateways.adaptPayload('stripe', { type: 'checkout.session.completed', data: { object: { id: 'cs_pending', payment_status: 'unpaid', amount_total: 9700, currency: 'brl' } } }));
assert.strictEqual(stripePending.event, 'AddPaymentInfo', 'checkout não pago nunca vira Purchase');
console.log('Pix identificado sem inferência por produto; Stripe não pago permanece pendente.');

// Exercita o disparo real sem rede nem configuração de produção.
(async () => {
  const fs = require('fs');
  const vm = require('vm');
  const source = fs.readFileSync(require.resolve('../server'), 'utf8');
  const sent = [];
  const seen = new Set();
  const context = vm.createContext({
    PUSHCUT_EVENT_MAP: { InitiateCheckout: { key: 'checkout', name: 'Checkout' }, AddPaymentInfo: { key: 'checkout', name: 'Checkout' }, CompletePayment: { key: 'sale', name: 'Aprovada' } },
    config: { get: () => ({}) }, fireOutboundWebhook() {},
    fmtMoney: () => 'R$ 97,00', fmtDate: () => 'hoje',
    rdb: { seenWebhookOrder: async (...args) => { const key = JSON.stringify(args); const repeat = seen.has(key); seen.add(key); return repeat; } },
    sendPushcut: async (...args) => sent.push(args),
  });
  const start = source.indexOf('async function notifyPushcut(event, n)');
  vm.runInContext(source.slice(start, source.indexOf('async function processConversion(n)', start)), context);
  const sale = { acc: 'a', gatewayId: 'g', gateway: 'kiwify', orderId: 'p', paymentMethod: 'pix', amountCents: 9700 };
  await context.notifyPushcut('InitiateCheckout', sale);
  await context.notifyPushcut('AddPaymentInfo', sale);
  await context.notifyPushcut('CompletePayment', sale);
  assert.deepStrictEqual(sent.map(args => args[3].event), ['pix_pending', 'sale']);
  assert.strictEqual(sent[0][1].text, 'Aguardando pagamento.');
  await context.notifyPushcut('AddPaymentInfo', { ...sale, orderId: 'card', paymentMethod: 'card' });
  assert.strictEqual(sent[2][3].event, 'checkout', 'cartão não gera aviso Pix');
})().catch(error => { console.error(error); process.exitCode = 1; });
