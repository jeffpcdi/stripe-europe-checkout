const assert = require('assert');

const previous = process.env.DATABASE_URL;
delete process.env.DATABASE_URL;
delete require.cache[require.resolve('../ads-ops-store')];
const ops = require('../ads-ops-store');

assert.strictEqual(ops.cleanAccountId('acc_1'), 'acc_1');
assert.throws(() => ops.cleanAccountId(''), /obrigatório/);
assert.throws(() => ops.cleanAccountId('__all__'), /obrigatório/);

const defaults = ops.normalizePolicy({});
assert.strictEqual(defaults.dryRun, true);
assert.strictEqual(defaults.killSwitch, false);
assert.strictEqual(defaults.maxBudgetChangePct, 20);
assert.strictEqual(defaults.cooldownMinutes, 60);

assert.deepStrictEqual(ops.assertMutationAllowed(defaults, { advertiserId: 'adv_1', idempotencyKey: 'once:1' }), { allowed: true, dryRun: true });
assert.throws(() => ops.assertMutationAllowed({ killSwitch: true }, { idempotencyKey: 'once:2' }), /Kill switch/);
assert.throws(() => ops.assertMutationAllowed({}, {}), /Idempotency/);
assert.throws(() => ops.assertMutationAllowed({ blockedAdvertiserIds: ['adv_2'] }, { advertiserId: 'adv_2', idempotencyKey: 'once:3' }), /bloqueada/);
assert.throws(() => ops.assertMutationAllowed({ maxBudgetChangePct: 10 }, { idempotencyKey: 'once:4', budgetChangePct: 11 }), /excede/);

assert.strictEqual(ops.retryDelayMs(0), 1000);
assert.strictEqual(ops.retryDelayMs(3), 8000);
assert.strictEqual(ops.retryDelayMs(99), 256000);
assert.strictEqual(ops.circuitBreakerOpen([true, false], 25, 10), false);
assert.strictEqual(ops.circuitBreakerOpen([true, true, true, true, true, true, false, false, false, false], 25, 10), true);
assert.strictEqual(ops.circuitBreakerOpen([true, true, true, true, true, true, true, true, false, false], 25, 10), false);

if (previous) process.env.DATABASE_URL = previous;
console.log('ads-ops-store.test.js OK — escopo, dry-run, idempotência, kill switch e limites validados');
