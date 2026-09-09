'use strict';

const assert = require('assert');
const {
  getReferenceRate,
  normalizeTransactionToBrl,
  checkoutCurrencyMiddleware,
  ensureConversionPersisted
} = require('../checkout-currency-middleware');

(async () => {
  // 1. Taxas de câmbio de referência
  assert.strictEqual(getReferenceRate('brl', 'brl'), 1.0);
  assert.strictEqual(getReferenceRate('usd', 'brl'), 5.60);
  assert.strictEqual(getReferenceRate('eur', 'brl'), 6.10);

  // 2. Normalização de transação em BRL
  const txBrl = {
    currency: 'brl',
    amountCents: 10000,
    feeCents: 500,
    netAmountCents: 9500
  };
  normalizeTransactionToBrl(txBrl, { accountId: 'acc-1', gateway: 'kiwify' });
  assert.strictEqual(txBrl.amountCentsBrl, 10000);
  assert.strictEqual(txBrl.feeCentsBrl, 500);
  assert.strictEqual(txBrl.netAmountCentsBrl, 9500);
  assert.strictEqual(txBrl.acc, 'acc-1');
  assert.strictEqual(txBrl.gateway, 'kiwify');

  // 3. Normalização de transação em USD para BRL
  const txUsd = {
    currency: 'usd',
    amountCents: 1000, // $10.00
    feeCents: 100,      // $1.00
    netAmountCents: 900 // $9.00
  };
  normalizeTransactionToBrl(txUsd);
  assert.strictEqual(txUsd.amountCentsBrl, 5600); // R$ 56.00
  assert.strictEqual(txUsd.feeCentsBrl, 560);
  assert.strictEqual(txUsd.netAmountCentsBrl, 5040);
  assert.strictEqual(txUsd.rateToBrl, 5.60);

  // 4. Middleware de checkout
  const req = {
    query: { currency: 'USD' },
    body: { currency: 'EUR' }
  };
  let nextCalled = false;
  checkoutCurrencyMiddleware(req, {}, () => { nextCalled = true; });
  assert.strictEqual(nextCalled, true);
  assert.strictEqual(req.query.currency, 'usd');
  assert.strictEqual(req.body.currency, 'eur');

  // 5. Persistência durável
  const mockDb = {
    insertedEvents: [],
    upsertedLeads: [],
    async insertEvent(acc, evt) { this.insertedEvents.push({ acc, evt }); },
    async upsertLead(acc, lead) { this.upsertedLeads.push({ acc, lead }); }
  };
  const persisted = await ensureConversionPersisted({
    accountId: 'acc-test',
    lead: { id: 'lead-1', name: 'Comprador' },
    event: { id: 'evt-1', type: 'CompletePayment' },
    database: mockDb
  });
  assert.strictEqual(persisted, true);
  assert.strictEqual(mockDb.insertedEvents.length, 1);
  assert.strictEqual(mockDb.upsertedLeads.length, 1);

  console.log('checkout-currency-middleware: testes passaram com sucesso OK');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
