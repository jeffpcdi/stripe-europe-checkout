const assert = require('assert');
const fs = require('fs');
const path = require('path');

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
assert.strictEqual(ops.normalizePolicy({ maxActionsPerHour: 0 }).maxActionsPerHour, 0, '0 legado permanece legível para a autonomia bloqueá-lo explicitamente');
assert.strictEqual(ops.normalizePolicy({ maxActionsPerHour: 5000 }).maxActionsPerHour, 1000, 'cap clampado em 1000');
assert.strictEqual(ops.normalizePolicy({ maxActionsPerHour: '' }).maxActionsPerHour, 10, 'vazio cai no default 10');
assert.strictEqual(ops.normalizePolicy({ maxActionsPerHour: 3.9 }).maxActionsPerHour, 3, 'fracionário é truncado');
// dailySpendCap: null = sem teto; 0 explícito é um teto real (não vira null)
assert.strictEqual(ops.normalizePolicy({}).dailySpendCap, null, 'sem teto de gasto por padrão');
assert.strictEqual(ops.normalizePolicy({ dailySpendCap: '' }).dailySpendCap, null, "'' = sem teto");
assert.strictEqual(ops.normalizePolicy({ dailySpendCap: 0 }).dailySpendCap, 0, '0 explícito é um teto de gasto real');
const storeSource = fs.readFileSync(path.join(__dirname, '..', 'ads-ops-store.js'), 'utf8');
assert.match(storeSource, /'smart_plus_appeal'/, 'auto-recurso Smart+ entra no cap durável de ações por hora');
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

async function testPixelBindings() {
  const first = await ops.savePixelBinding('acc_1', 'adv_1', {
    pixelSlug: 'pixel-a', pixelCode: 'CODE_A', pixelId: '12345678', pixelName: 'Pixel A', remoteStatus: 'ACTIVE',
  });
  assert.strictEqual(first.pixelId, '12345678');
  assert.strictEqual((await ops.getPixelBinding('acc_1', 'adv_1')).pixelSlug, 'pixel-a');
  assert.strictEqual(await ops.getPixelBinding('acc_2', 'adv_1'), null, 'vínculo não vaza entre contas');
  assert.strictEqual(await ops.getPixelBinding('acc_1', 'adv_2'), null, 'vínculo não vaza entre advertisers');
  await assert.rejects(
    () => ops.savePixelBinding('acc_1', 'adv_1', { pixelSlug: 'pixel-a', pixelCode: 'CODE_A', pixelId: 'código-alfanumérico' }),
    /Vínculo de Pixel inválido/,
  );
  await ops.savePixelBinding('acc_1', 'adv_2', {
    pixelSlug: 'pixel-a', pixelCode: 'CODE_A', pixelId: '87654321', pixelName: 'Pixel A', remoteStatus: 'ACTIVE',
  });
  await ops.savePixelBinding('acc_2', 'adv_1', {
    pixelSlug: 'pixel-a', pixelCode: 'CODE_A', pixelId: '11223344', pixelName: 'Pixel A', remoteStatus: 'ACTIVE',
  });
  assert.strictEqual(await ops.deletePixelBindingsBySlug('acc_1', 'pixel-a'), 2,
    'remoção por slug limpa todos os advertisers da conta');
  assert.strictEqual(await ops.getPixelBinding('acc_1', 'adv_1'), null, 'primeiro vínculo foi limpo');
  assert.strictEqual(await ops.getPixelBinding('acc_1', 'adv_2'), null, 'segundo vínculo foi limpo');
  assert.strictEqual((await ops.getPixelBinding('acc_2', 'adv_1')).pixelSlug, 'pixel-a',
    'remoção por slug não vaza para outra conta');
  await ops.deletePixelBinding('acc_2', 'adv_1');
}

testPixelBindings().then(() => {
  if (previous) process.env.DATABASE_URL = previous;
  console.log('ads-ops-store.test.js OK — escopo, dry-run, idempotência, kill switch, limites e Pixel central validados');
}).catch((error) => {
  if (previous) process.env.DATABASE_URL = previous;
  console.error(error);
  process.exitCode = 1;
});
