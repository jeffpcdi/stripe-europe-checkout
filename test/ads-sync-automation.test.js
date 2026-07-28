// Regressão do worker 24/7: uma conta com automação persistida continua no
// ciclo mesmo sem touchActivity/requested_at recente e volta após reinício.
// Tudo usa stubs; nenhuma chamada chega ao Neon, Pipeboard ou TikTok.
const assert = require('assert');

const config = require('../config');
const provider = require('../ads-provider');
const automation = require('../ads-automation');

// ── Descoberta pura das inscrições persistidas ─────────────────────────────
const originalAccountIds = config.accountIds;
const originalGetState = provider.getState;
const persistedStates = {
  acc_rules: {
    automationProfiles: {
      adv_rules: {
        rules: [{ id: 'r1', enabled: true, metric: 'cpa_max', threshold: 10 }],
        alerts: { enabled: false },
      },
      adv_schedule: {
        rules: [{ id: 'schedule', enabled: true, metric: 'schedule', days: [1] }],
        alerts: { enabled: false },
      },
    },
  },
  acc_alerts: {
    automationProfiles: {
      adv_alerts: {
        rules: [{ id: 'r2', enabled: false, metric: 'cpa_max', threshold: 10 }],
        alerts: { enabled: true },
      },
    },
  },
  acc_idle: {
    automationProfiles: {
      adv_idle: {
        rules: [{ id: 'r3', enabled: false, metric: 'cpa_max', threshold: 10 }],
        alerts: { enabled: false },
      },
      __default__: {
        rules: [{ id: 'r4', enabled: true, metric: 'cpa_max', threshold: 10 }],
        alerts: { enabled: true },
      },
    },
  },
  acc_legacy: {
    advertiserId: 'adv_legacy',
    rules: [{ id: 'r5', enabled: true, metric: 'spend_no_conv', threshold: 20 }],
    alerts: { enabled: false },
  },
  acc_corrupt: {
    automationProfiles: {
      adv_incomplete: {},
      adv_invalid: null,
    },
  },
};

config.accountIds = () => Object.keys(persistedStates);
provider.getState = (accountId) => persistedStates[accountId] || {};

const persistentScopes = automation.listPersistentAutomationScopes()
  .map((scope) => scope.accountId + ':' + scope.advertiserId)
  .sort();
assert.deepStrictEqual(persistentScopes, [
  'acc_alerts:adv_alerts',
  'acc_legacy:adv_legacy',
  'acc_rules:adv_rules',
  'acc_rules:adv_schedule',
], 'somente perfis com trabalho ativo e advertiser concreto ficam inscritos');

config.accountIds = originalAccountIds;
provider.getState = originalGetState;

// ── Tick sem atividade recente + novo processo ─────────────────────────────
const paths = {
  sync: require.resolve('../ads-sync'),
  provider: require.resolve('../ads-provider'),
  cache: require.resolve('../ads-cache-store'),
  pipeboard: require.resolve('../pipeboard-mcp'),
  ops: require.resolve('../ads-ops-store'),
  automation: require.resolve('../ads-automation'),
  ai: require.resolve('../ads-ai'),
};
const previous = new Map(Object.values(paths).map((id) => [id, require.cache[id]]));
function install(id, exports) {
  require.cache[id] = { id, filename: id, loaded: true, exports };
}

let recentReads = 0;
let treeReads = 0;
const treeRanges = [];
const syncStatePatches = [];
let sweeps = 0;
let briefings = 0;
let includeRecentDuplicate = false;
const oldSyncState = {
  status: 'ok',
  last_synced_at: '2026-07-27T00:00:00.000Z',
  last_full_synced_at: '2026-07-27T00:00:00.000Z',
  updated_at: '2026-07-27T00:00:00.000Z',
};

install(paths.provider, {
  enabled: true,
  getAdvertiserInfo: async () => ({ timezone: 'Asia/Tokyo' }),
  getDashboardTree: async (_accountId, options) => {
    treeReads += 1;
    treeRanges.push(options);
    return { campaigns: [] };
  },
  getSmartPlusDashboardTree: async () => [],
  getInsights: async () => ({ rows: [] }),
});
install(paths.cache, {
  enabled: true,
  listActiveAdvertisers: async () => {
    recentReads += 1;
    // Vazio representa requested_at ausente ou com mais de 6 horas. A última
    // passagem devolve o mesmo advertiser pelos dois caminhos para provar a
    // deduplicação do ciclo.
    return includeRecentDuplicate
      ? [{ accountId: 'acc_24h', advertiserId: 'adv_24h', currency: 'BRL' }]
      : [];
  },
  getSyncState: async () => oldSyncState,
  upsertSyncState: async (_accountId, _advertiserId, patch) => {
    syncStatePatches.push(patch);
    return {};
  },
  writeAdvertiserSnapshot: async () => {},
});
install(paths.pipeboard, { getCallStats: () => ({ total: 0 }) });
install(paths.ops, { syncAdRejections: async () => {} });
install(paths.automation, {
  listPersistentAutomationScopes: () => [{ accountId: 'acc_24h', advertiserId: 'adv_24h' }],
  maybeSweep: (accountId, advertiserId) => {
    assert.strictEqual(accountId, 'acc_24h');
    assert.strictEqual(advertiserId, 'adv_24h');
    sweeps += 1;
  },
  noteRecovery() {},
});
install(paths.ai, {
  maybeDailyBriefing() {
    briefings += 1;
  },
});

(async () => {
  delete require.cache[paths.sync];
  const firstProcess = require('../ads-sync');
  assert.deepStrictEqual(
    firstProcess.getRuntimeStatus(),
    {
      started: false,
      running: false,
      lastTickStartedAt: null,
      lastTickCompletedAt: null,
      lastTickError: null,
      intervalMs: firstProcess._config.SYNC_INTERVAL_MS,
    },
    'processo novo não reaproveita heartbeat de outro runtime',
  );
  await firstProcess.tick();
  const firstRuntime = firstProcess.getRuntimeStatus();
  assert.ok(firstRuntime.lastTickStartedAt, 'tick registra início real');
  assert.ok(firstRuntime.lastTickCompletedAt, 'tick registra conclusão real');
  assert.strictEqual(firstRuntime.lastTickError, null);

  // Simula um novo processo Node: o módulo do worker perde todos os Maps, mas
  // a inscrição continua sendo devolvida pelo perfil que o boot hidratou.
  delete require.cache[paths.sync];
  const secondProcess = require('../ads-sync');
  await secondProcess.tick();

  assert.strictEqual(recentReads, 2, 'os dois processos confirmam que não há atividade recente');
  assert.strictEqual(treeReads, 2, 'o advertiser persistente é sincronizado nos dois processos');
  assert.strictEqual(sweeps, 2, 'a automação roda nos dois processos sem depender da dashboard');
  assert.strictEqual(briefings, 0, 'a inscrição operacional não liga briefing de IA fora de escopo');

  includeRecentDuplicate = true;
  delete require.cache[paths.sync];
  const processWithDuplicate = require('../ads-sync');
  await processWithDuplicate.tick();
  assert.strictEqual(treeReads, 3, 'advertiser recente e automatizado sincroniza uma única vez');
  assert.strictEqual(sweeps, 3, 'advertiser recente e automatizado é varrido uma única vez');
  assert.strictEqual(briefings, 1, 'briefing continua restrito ao caminho de atividade recente');
  const completed = syncStatePatches.filter((patch) => patch.status === 'ok');
  assert.strictEqual(completed.length, 3, 'cada sync conclui com estado durável');
  assert.ok(completed.every((patch) => patch.advertiserTimezone === 'Asia/Tokyo'), 'fuso do TikTok é persistido em todo sync');
  assert.ok(treeRanges.every((range) => /^\d{4}-\d{2}-\d{2}$/.test(range.fromDate) && /^\d{4}-\d{2}-\d{2}$/.test(range.toDate)), 'ranges usam datas civis');
  assert.ok(treeRanges.every((range) => range.fromDate <= range.toDate), 'range civil nunca inverte');

  const beforePostWrite = treeReads;
  const firstPostWrite = processWithDuplicate.syncAfterWrite('acc_post_write', 'adv_post_write');
  const secondPostWrite = processWithDuplicate.syncAfterWrite('acc_post_write', 'adv_post_write');
  assert.strictEqual(firstPostWrite, secondPostWrite, 'escritas concorrentes compartilham a Promise do sync pós-escrita');
  const postWriteResult = await firstPostWrite;
  assert.strictEqual(postWriteResult.ok, true, 'a Promise só conclui quando o espelho foi atualizado');
  assert.strictEqual(treeReads, beforePostWrite + 2, 'dirty durante o sync força uma segunda passagem antes de resolver');

  console.log('ads-sync-automation.test.js: OK');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  for (const [id, cached] of previous) {
    if (cached) require.cache[id] = cached;
    else delete require.cache[id];
  }
});
