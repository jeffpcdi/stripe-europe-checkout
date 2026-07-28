// Estado operacional real do motor: configuração ativa não basta para dizer
// que ele está rodando. Valida worker, sync, segurança e conclusão das promises.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const provider = require('../ads-provider');
const automation = require('../ads-automation');

const derive = automation._internals.deriveEngineStatus;
const NOW = Date.parse('2026-07-28T15:00:00.000Z');
const isoAgo = (ms) => new Date(NOW - ms).toISOString();

const baseSweep = {
  advertiserId: 'adv_status',
  revision: 1,
  autonomy: 'auto',
  updatedAt: isoAgo(60_000),
  subscribed24x7: true,
  running: false,
  lastDispatchAt: isoAgo(90_000),
  lastCompletedAt: isoAgo(60_000),
  lastResult: 'ok',
  lastError: null,
  lastSweepAt: isoAgo(60_000),
  lastScheduleSweepAt: null,
  nextSweepAt: new Date(NOW + 60_000).toISOString(),
  rulesEnabled: 1,
  schedulesEnabled: 0,
  alertsEnabled: false,
  lastLogEntry: null,
  lastAction: null,
};
const baseWorker = {
  started: true,
  running: false,
  lastTickStartedAt: isoAgo(45_000),
  lastTickCompletedAt: isoAgo(30_000),
  lastTickError: null,
  intervalMs: 180_000,
};
const baseSync = {
  status: 'ok',
  last_synced_at: isoAgo(60_000),
  last_error: null,
};
const basePolicy = { dryRun: false, killSwitch: false };

function status(overrides = {}) {
  return derive({
    sweep: { ...baseSweep, ...(overrides.sweep || {}) },
    providerEnabled: overrides.providerEnabled ?? true,
    cacheEnabled: overrides.cacheEnabled ?? true,
    worker: { ...baseWorker, ...(overrides.worker || {}) },
    syncState: Object.prototype.hasOwnProperty.call(overrides, 'syncState')
      ? overrides.syncState
      : baseSync,
    syncReadError: overrides.syncReadError || null,
    policy: { ...basePolicy, ...(overrides.policy || {}) },
    policyAvailable: overrides.policyAvailable ?? true,
    breaker: { open: false, ...(overrides.breaker || {}) },
    now: NOW,
  });
}

(async () => {
  {
    const out = status({
      providerEnabled: false,
      cacheEnabled: false,
      worker: { started: false },
      sweep: { rulesEnabled: 0, alertsEnabled: false },
    });
    assert.strictEqual(out.state, 'idle', 'sem trabalho ativo é ocioso, não uma falsa falha de infraestrutura');
    assert.strictEqual(out.subscribed24x7, false);
  }

  {
    const out = status({ worker: { started: false } });
    assert.strictEqual(out.state, 'blocked');
    assert.strictEqual(out.reasonCode, 'worker_stopped', 'configuração ativa com timer parado não aparece como ativa');
  }

  {
    const out = status({ syncState: { status: 'never', last_synced_at: null } });
    assert.strictEqual(out.state, 'starting');
    assert.strictEqual(out.reasonCode, 'sync_never');
  }

  {
    const out = status({ syncState: { status: 'ok', last_synced_at: isoAgo(16 * 60_000) } });
    assert.strictEqual(out.state, 'degraded');
    assert.strictEqual(out.reasonCode, 'sync_stale');
    assert.strictEqual(out.dataFresh, false);
  }

  for (const [syncStatus, reason] of [
    ['error', 'sync_error'],
    ['blocked', 'account_blocked'],
    ['unauthorized', 'account_unauthorized'],
  ]) {
    const out = status({ syncState: { status: syncStatus, last_synced_at: isoAgo(60_000), last_error: 'falha teste' } });
    assert.strictEqual(out.state, 'degraded');
    assert.strictEqual(out.reasonCode, reason);
  }

  {
    const out = status();
    assert.strictEqual(out.state, 'running');
    assert.strictEqual(out.reasonCode, 'healthy');
    assert.strictEqual(out.dataFresh, true);
    assert.strictEqual(out.monitoringActive, true);
  }

  {
    const out = status({ policy: { dryRun: true } });
    assert.strictEqual(out.state, 'running', 'dry-run é modo de execução, não pane do motor');
    assert.strictEqual(out.executionMode, 'simulation');
    assert.strictEqual(out.actionsPaused, true);
  }

  {
    const out = status({ policy: { dryRun: true }, breaker: { open: true } });
    assert.strictEqual(out.state, 'running', 'breaker não interrompe uma avaliação que não executa ações reais');
    assert.strictEqual(out.executionMode, 'simulation');
    assert.strictEqual(out.breakerOpen, true, 'a telemetria continua mostrando o breaker aberto');
  }

  {
    const out = status({
      policy: { killSwitch: true },
      sweep: { alertsEnabled: true },
    });
    assert.strictEqual(out.state, 'paused');
    assert.strictEqual(out.reasonCode, 'kill_switch');
    assert.strictEqual(out.monitoringActive, true, 'alertas continuam monitorando mesmo com novas ações bloqueadas');
  }

  {
    const out = status({ breaker: { open: true } });
    assert.strictEqual(out.state, 'paused');
    assert.strictEqual(out.reasonCode, 'breaker_open');
  }

  {
    assert.strictEqual(status({ providerEnabled: false }).reasonCode, 'provider_unavailable');
    assert.strictEqual(status({ cacheEnabled: false }).reasonCode, 'cache_unavailable');
    assert.strictEqual(status({ policyAvailable: false }).reasonCode, 'policy_unavailable');
  }

  {
    const out = status({ sweep: { lastResult: 'error', lastError: 'erro controlado' } });
    assert.strictEqual(out.state, 'degraded');
    assert.strictEqual(out.reasonCode, 'last_run_error');
    assert.strictEqual(out.lastError, 'erro controlado');
  }

  {
    const out = status({ sweep: { lastResult: 'ok', lastError: 'alertas falharam' } });
    assert.strictEqual(out.state, 'degraded', 'falha de outro componente ativo não é escondida pelo último componente bem-sucedido');
    assert.strictEqual(out.reasonCode, 'last_run_error');
  }

  // Dispatch e conclusão são timestamps diferentes: uma promise pendente
  // jamais pode ser apresentada como "última avaliação concluída".
  const originalGetState = provider.getState;
  const originalSetState = provider.setState;
  const states = {};
  provider.getState = (accountId) => states[accountId] || {};
  provider.setState = (accountId, patch) => {
    states[accountId] = Object.assign({}, states[accountId], patch);
  };
  try {
    const accountId = 'acc_engine_runtime';
    const advertiserId = 'adv_engine_runtime';
    const initial = automation.getAutomationProfile(accountId, advertiserId);
    automation.saveRules(accountId, advertiserId, [
      { id: 'runtime_rule', enabled: true, metric: 'cpa_max', threshold: 10, mode: 'proposal' },
    ], initial.revision);

    let release;
    const pending = automation.runTrackedSweep('rules', accountId, advertiserId, () => new Promise((resolve) => {
      release = resolve;
    }));
    await Promise.resolve();
    let info = automation.getSweepInfo(accountId, advertiserId);
    assert.ok(info.lastDispatchAt, 'dispatch é visível enquanto a promise está em voo');
    assert.strictEqual(info.lastCompletedAt, null, 'não inventa conclusão antes do resolve');
    assert.strictEqual(info.running, true);

    let overlappingRunnerCalls = 0;
    const overlapping = await automation.runTrackedSweep('rules', accountId, advertiserId, async () => {
      overlappingRunnerCalls += 1;
      return { executed: [] };
    });
    assert.strictEqual(overlapping.skipped, true, 'segunda execução concorrente é ignorada');
    assert.strictEqual(overlapping.reason, 'already_running');
    assert.strictEqual(overlappingRunnerCalls, 0, 'runner concorrente nunca é iniciado');
    info = automation.getSweepInfo(accountId, advertiserId);
    assert.strictEqual(info.running, true, 'execução original permanece identificada como ativa');
    assert.strictEqual(info.lastCompletedAt, null, 'skip concorrente não inventa conclusão');

    release({ executed: [], checkedAt: new Date().toISOString() });
    await pending;
    info = automation.getSweepInfo(accountId, advertiserId);
    assert.ok(info.lastCompletedAt, 'conclusão só aparece depois do resolve');
    assert.strictEqual(info.lastResult, 'ok');
    assert.strictEqual(info.running, false);
    assert.strictEqual(info.lastSweepAt, info.lastCompletedAt, 'alias antigo também usa término real');

    await assert.rejects(
      automation.runTrackedSweep('rules', accountId, advertiserId, async () => {
        throw new Error('falha rastreada');
      }),
      /falha rastreada/,
    );
    info = automation.getSweepInfo(accountId, advertiserId);
    assert.strictEqual(info.lastResult, 'error');
    assert.match(info.lastError, /falha rastreada/);
  } finally {
    provider.getState = originalGetState;
    provider.setState = originalSetState;
  }

  const routes = fs.readFileSync(path.join(__dirname, '..', 'ads-routes.js'), 'utf8');
  assert.match(routes, /automation\.getEngineStatus[\s\S]*worker: adsSync\.getRuntimeStatus\(\)/, '/mcp/status usa o diagnóstico operacional');
  assert.match(routes, /await automation\.getAutomationSnapshot[\s\S]*worker: adsSync\.getRuntimeStatus\(\)/, '/rules usa o mesmo diagnóstico');
  assert.match(routes, /automation\.runTrackedSweep/, 'execuções manuais também registram conclusão real');

  console.log('ads-automation-status.test.js: OK');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
