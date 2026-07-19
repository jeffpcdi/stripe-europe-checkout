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
// Cap de ações/hora: default 10, aceita 0 (desliga), clampa em 1000, ignora lixo
assert.strictEqual(defaults.maxActionsPerHour, 10, 'default do cap de ações/hora é 10');
assert.strictEqual(ops.normalizePolicy({ maxActionsPerHour: 0 }).maxActionsPerHour, 0, '0 = sem limite (respeitado, não vira default)');
assert.strictEqual(ops.normalizePolicy({ maxActionsPerHour: 5000 }).maxActionsPerHour, 1000, 'cap clampado em 1000');
assert.strictEqual(ops.normalizePolicy({ maxActionsPerHour: '' }).maxActionsPerHour, 10, 'vazio cai no default 10');
assert.strictEqual(ops.normalizePolicy({ maxActionsPerHour: 3.9 }).maxActionsPerHour, 3, 'fracionário é truncado');
// dailySpendCap: null = sem teto; 0 explícito é um teto real (não vira null)
assert.strictEqual(ops.normalizePolicy({}).dailySpendCap, null, 'sem teto de gasto por padrão');
assert.strictEqual(ops.normalizePolicy({ dailySpendCap: '' }).dailySpendCap, null, "'' = sem teto");
assert.strictEqual(ops.normalizePolicy({ dailySpendCap: 0 }).dailySpendCap, 0, '0 explícito é um teto de gasto real');
// kill switch também é barrado por assertMutationAllowed via política normalizada
assert.throws(() => ops.assertMutationAllowed(ops.normalizePolicy({ killSwitch: true }), { advertiserId: 'a', idempotencyKey: 'k' }), /Kill switch/, 'política normalizada com kill switch bloqueia mutação');

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

const workspace = ops.normalizeWorkspace({
  goals: { roasMin: -2, cpaMax: '15.5', conversionsTarget: 4.8 },
  favorites: [{ type: 'campaign', id: 'cmp_1', label: 'Principal' }, { type: 'invalid', id: '' }],
  columns: ['spend', 'spend', 'roas'],
  memory: { market: 'Portugal' },
  governance: { actorRole: 'viewer', requiredApprovals: 99, dualApprovalEnabled: true, maxTargetsPerAction: 500 },
});
assert.strictEqual(workspace.goals.roasMin, 0, 'metas negativas são normalizadas');
assert.strictEqual(workspace.goals.cpaMax, 15.5);
assert.strictEqual(workspace.goals.conversionsTarget, 4, 'conversões são inteiras');
assert.deepStrictEqual(workspace.columns, ['spend', 'roas'], 'colunas são únicas');
assert.strictEqual(workspace.favorites.length, 1, 'favoritos inválidos são removidos');
assert.strictEqual(workspace.governance.actorRole, 'viewer');
assert.strictEqual(workspace.governance.dualApprovalEnabled, false, 'aprovação dupla não pode ser ativada sem gestão real de usuários');
assert.strictEqual(workspace.governance.requiredApprovals, 1);
assert.strictEqual(workspace.governance.maxTargetsPerAction, 100, 'limite de alvos é clampado');

if (previous) process.env.DATABASE_URL = previous;
console.log('ads-ops-store.test.js OK — escopo, dry-run, idempotência, kill switch e limites validados');
