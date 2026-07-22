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
