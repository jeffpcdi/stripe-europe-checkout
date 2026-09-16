// V16.13 — higiene estrutural do scheduler e segurança da suíte.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
require('./helpers/test-env').isolateUnitTest('ads-sync-hygiene-');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const cacheSrc = read('ads-cache-store.js');
const syncSrc = read('ads-sync.js');
const automationSrc = read('ads-automation.js');
const configSrc = read('config.js');
const presetSrc = read('test/ads-rule-presets.test.js');

assert.match(cacheSrc, /INNER JOIN accounts a ON a\.id = s\.account_id/, 'atividade recente deve ser filtrada por conta real no SQL');
assert.match(syncSrc, /new Set\(await db\.listAccountIds\(\)\)/, 'worker usa accounts como fonte autoritativa');
assert.match(syncSrc, /targetsSkippedOrphan/, 'runtime expõe descarte de órfãos');
assert.match(syncSrc, /target .* falhou isoladamente/, 'cada target possui boundary própria');
assert.match(automationSrc, /inspectPersistentAutomationScopes\(validAccountIds\)/, 'automação persistente recebe conjunto de contas válidas');
assert.match(automationSrc, /if \(valid && !valid\.has\(accountId\)\)/, 'config órfã é ignorada antes de ler profile');
assert.match(configSrc, /process\.env\.DATA_DIR/, 'DATA_DIR de teste realmente controla config local');
assert.match(presetSrc, /isolateUnitTest\('ads-presets-'\)/, 'preset test neutraliza serviços externos antes dos módulos da aplicação');

// Exercita a descoberta persistente sem carregar dependências externas reais.
function loadAutomation(stubs) {
  const code = automationSrc;
  const context = {
    module: { exports: {} }, exports: {}, console, process,
    require(id) {
      if (id in stubs) return stubs[id];
      throw new Error('dependência não autorizada: ' + id);
    },
    setTimeout, clearTimeout, setInterval, clearInterval, setImmediate,
  };
  vm.runInNewContext(code, context, { filename: 'ads-automation.js' });
  return context.module.exports;
}

const states = {
  real: { automationProfiles: { adv1: { rules: [{ enabled: true }], alerts: { enabled: false } } } },
  orphan: { automationProfiles: { advX: { rules: [], alerts: { enabled: true } } } },
};
const automation = loadAutomation({
  './ads-provider': { getState: (id) => states[id] || {} },
  './ads-cache-store': {}, './ads-ops-store': {},
  './config': { accountIds: () => ['real', 'orphan'] },
  './redis': {}, './ads-automation-window': {}, './pushcut': { sendPushcut() {} },
});
const inspected = automation.inspectPersistentAutomationScopes(new Set(['real']));
assert.strictEqual(inspected.scopes.length, 1);
assert.strictEqual(inspected.scopes[0].accountId, 'real');
assert.strictEqual(inspected.skippedOrphanAccounts, 1);

console.log('ads-sync-hygiene-v16-13.test.js: OK');

// Exercita o tick completo: órfão não vira target, falha de um advertiser não
// interrompe o seguinte e a telemetria explica o ciclo.
function loadSync(stubs, env = {}) {
  const code = syncSrc;
  const context = {
    module: { exports: {} }, exports: {}, console,
    process: { env: { ...process.env, ADS_SYNC_WINDOW_DAYS: '1', ADS_SYNC_INCREMENTAL_DAYS: '1', ...env } },
    require(id) {
      if (id in stubs) return stubs[id];
      throw new Error('dependência não autorizada sync: ' + id);
    },
    setTimeout, clearTimeout, setInterval, clearInterval, Date, Promise, Map, Set,
  };
  vm.runInNewContext(code, context, { filename: 'ads-sync.js' });
  return context.module.exports;
}

(async () => {
  let dashboardReads = [];
  let sweeps = [];
  let aiCalls = 0;
  const cache = {
    enabled: true,
    listActiveAdvertisers: async () => [
      { accountId: 'realA', advertiserId: 'adv_fail' },
      { accountId: 'realB', advertiserId: 'adv_ok' },
    ],
    countOrphanActiveAdvertisers: async () => 1,
    getSyncState: async () => ({ status: 'never', last_synced_at: null }),
    upsertSyncState: async () => ({}),
    writeAdvertiserSnapshot: async () => ({ ok: true }),
  };
  const provider = {
    enabled: true,
    getAdvertiserInfo: async () => ({ timezone: 'UTC' }),
    getDashboardTree: async (accountId, opts) => {
      dashboardReads.push({ accountId, advertiserId: opts.advertiserId });
      if (opts.advertiserId === 'adv_fail') throw new Error('falha isolada');
      return { campaigns: [] };
    },
    getSmartPlusDashboardTree: async () => [],
    getInsights: async () => ({ rows: [] }),
  };
  const automationStub = {
    inspectPersistentAutomationScopes: () => ({
      scopes: [{ accountId: 'realB', advertiserId: 'adv_ok' }],
      skippedOrphanAccounts: 1,
      skippedOrphanScopes: 2,
    }),
    listPersistentAutomationScopes: () => [],
    maybeSweep: async (accountId, advertiserId) => { sweeps.push(accountId + ':' + advertiserId); },
    noteRecovery() {},
  };
  const sync = loadSync({
    './ads-provider': provider,
    './ads-cache-store': cache,
    './pipeboard-mcp': { getCallStats: () => ({ total: 0 }) },
    './ads-ops-store': { syncAdRejections: async () => {} },
    './ads-automation-window': {
      normalizeTimeZone: () => 'UTC',
      civilDay: () => '2026-09-16',
      shiftCivilDay: (_day, delta) => delta < 0 ? '2026-09-15' : '2026-09-16',
    },
    './db': { listAccountIds: async () => ['realA', 'realB'] },
    './ads-automation': automationStub,
    './ads-ai': {
      maybeDailyBriefing() { aiCalls += 1; },
      maybeIntradayAnomaly() { aiCalls += 1; },
    },
  });

  await sync.tick();
  const runtime = sync.getRuntimeStatus();
  assert.strictEqual(dashboardReads.length, 2, 'somente os dois targets de contas reais chegam ao provider');
  assert.ok(dashboardReads.every((row) => row.accountId.startsWith('real')), 'nenhum órfão chega ao provider');
  assert.strictEqual(runtime.targetsEligible, 2);
  assert.strictEqual(runtime.targetsSynced, 1, 'segundo target continua mesmo após falha do primeiro');
  assert.strictEqual(runtime.targetsFailed, 1);
  assert.ok(runtime.targetsSkippedOrphan >= 2, 'telemetria registra resíduos órfãos descobertos');
  assert.ok(sweeps.includes('realB:adv_ok'), 'automação real continua 24/7');
  assert.ok(!sweeps.some((scope) => scope.startsWith('orphan:')), 'automação órfã nunca roda');
  assert.strictEqual(aiCalls, 4, 'briefing/anomalia continuam apenas para scopes recentes elegíveis');

  console.log('ads-sync-hygiene-v16-13.test.js: tick eligibility/boundary OK');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
