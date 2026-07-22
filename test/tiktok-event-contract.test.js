'use strict';

const assert = require('assert');
const { canonicalTikTokEvent, purchaseEventId } = require('../tiktok-event-contract');

assert.strictEqual(canonicalTikTokEvent('CompletePayment'), 'Purchase');
assert.strictEqual(canonicalTikTokEvent('ViewContent'), 'ViewContent');
assert.strictEqual(purchaseEventId(' PEDIDO 123/BR '), 'Purchase.PEDIDO_123_BR');
assert.strictEqual(purchaseEventId(''), null);
assert.ok(purchaseEventId('x'.repeat(200)).length <= 99, 'event_id respeita o limite do contrato');

console.log('[PASS] tiktok-event-contract: compra interna vira Purchase com event_id estável por pedido.');
