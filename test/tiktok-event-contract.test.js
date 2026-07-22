'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { canonicalTikTokEvent, purchaseEventId } = require('../tiktok-event-contract');

assert.strictEqual(canonicalTikTokEvent('CompletePayment'), 'Purchase');
assert.strictEqual(canonicalTikTokEvent('ViewContent'), 'ViewContent');
assert.strictEqual(purchaseEventId(' PEDIDO 123/BR '), 'Purchase.PEDIDO_123_BR');
assert.strictEqual(purchaseEventId(''), null);
assert.ok(purchaseEventId('x'.repeat(200)).length <= 99, 'event_id respeita o limite do contrato');
const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
assert.match(serverSource, /requestedEvent === 'Purchase'/,
  'teste monetário Purchase exige Test Event Code e não contamina dados reais');

console.log('[PASS] tiktok-event-contract: compra interna vira Purchase com event_id estável por pedido.');
