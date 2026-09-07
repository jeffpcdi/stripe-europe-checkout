'use strict';
// Exercita o sync e a transação reais com stubs; nenhuma conexão externa.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
function load(file, stubs, env = {}) {
  const context = { module: { exports: {} }, process: { env }, console: { log() {}, warn() {}, error() {} },
    require: (id) => { if (id in stubs) return stubs[id]; throw Error('Dependência não autorizada: ' + id); } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file });
  return context.module.exports;
}
(async () => {
  let failLevel = '', malformed = false, empty = false, failWrite = false, disabledWrite = false, writes = [], patches = [], alerts = 0;
  const old = { last_synced_at: '2026-01-01T00:00:00Z', last_full_synced_at: '2026-01-01T00:00:00Z' };
  const provider = {
    getAdvertiserInfo: async () => ({ timezone: 'Europe/Budapest' }),
    getDashboardTree: async () => ({ campaigns: [{ platformCampaignId: 'c1' }] }),
    getSmartPlusDashboardTree: async () => [],
    getInsights: async (_adv, opts) => {
      if (failLevel === 'all' || failLevel === opts.level) throw Error('consulta incompleta: ' + opts.level);
      if (malformed) return { rows: [{ dimensions: {} }] };
      return { rows: empty ? [] : [{ dimensions: { [opts.dimensions[0]]: '1', stat_time_day: opts.startDate }, spend: 10 }] };
    },
  };
  const cache = {
    getSyncState: async () => old,
    upsertSyncState: async (_a, _b, patch) => { patches.push(patch); },
    writeAdvertiserSnapshot: async (...args) => { if (failWrite) throw Error('banco fora'); if (disabledWrite) return { ok: false }; writes.push(args); },
  };
  const sync = load('ads-sync.js', {
    './ads-provider': provider, './ads-cache-store': cache, './pipeboard-mcp': {},
    './ads-ops-store': { syncAdRejections: async () => { alerts++; } },
    './ads-automation-window': require('../ads-automation-window'),
  }, { ADS_SYNC_WINDOW_DAYS: '3' });
  for (const failure of ['AUCTION_CAMPAIGN', 'AUCTION_ADGROUP', 'AUCTION_AD', 'all']) {
    failLevel = failure; patches = [];
    const result = await sync.syncAdvertiser('acc', 'adv', { full: true });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(writes.length, 0, 'nenhuma substituição parcial do espelho');
    assert.strictEqual(alerts, 0, 'reprovações não são resolvidas com snapshot incompleto');
    assert.strictEqual(patches.at(-1).status, 'error');
    assert.ok(patches.every((p) => !p.lastSyncedAt && !p.lastFullSyncedAt), 'falha não renova frescor');
  }
  failLevel = ''; malformed = true;
  assert.strictEqual((await sync.syncAdvertiser('acc', 'adv', { full: true })).ok, false);
  assert.strictEqual(writes.length, 0, 'linha sem dimensão válida não apaga histórico');
  malformed = false; failWrite = true; patches = [];
  assert.strictEqual((await sync.syncAdvertiser('acc', 'adv', { full: true })).ok, false);
  assert.ok(patches.every((p) => !p.lastSyncedAt));
  failWrite = false; disabledWrite = true; patches = [];
  assert.strictEqual((await sync.syncAdvertiser('acc', 'adv', { full: true })).ok, false);
  assert.ok(patches.every((p) => !p.lastSyncedAt));
  disabledWrite = false; patches = [];
  assert.strictEqual((await sync.syncAdvertiser('acc', 'adv', { full: true })).ok, true);
  assert.strictEqual(writes.length, 1);
  assert.strictEqual(writes[0][2].dailyMetrics.length, 3);
  assert.strictEqual(patches.at(-1).status, 'ok');
  assert.ok(patches.at(-1).lastFullSyncedAt);
  assert.strictEqual(patches.at(-1).advertiserTimezone, 'Europe/Budapest');
  empty = true;
  assert.strictEqual((await sync.syncAdvertiser('acc', 'adv', { full: true })).ok, true);
  assert.strictEqual(writes.at(-1)[2].dailyMetrics.length, 0, 'vazio confirmado é diferente de erro');

  // NeonPromise é lazy: só executa os statements no transaction, como o driver real.
  let committed = [], transactions = [], rollback = false, outsideWrites = 0;
  function query(text, params) {
    const stmt = { text, params, then(resolve, reject) {
      if (/INSERT INTO ads_(campaigns|metrics)_cache|DELETE FROM ads_(campaigns|metrics)_cache/.test(text)) {
        outsideWrites++; return Promise.reject(Error('escrita fora da transação')).then(resolve, reject);
      }
      return Promise.resolve([]).then(resolve, reject);
    } };
    return stmt;
  }
  const sql = (strings, ...values) => query(strings.join('?'), values);
  sql.query = query;
  sql.transaction = async (statements) => {
    transactions.push(statements);
    if (rollback) throw Error('falha em chunk de métricas');
    committed = statements.map((q) => ({ text: q.text, params: q.params }));
    return [];
  };
  const realCache = load('ads-cache-store.js', { '@neondatabase/serverless': { neon: () => sql } },
    { DATABASE_URL: 'postgresql://test:test@neon.invalid/test' });
  const snapshot = { campaigns: [{ platformCampaignId: 'c1' }], dailyMetrics: [
    { level: 'campaign', entityId: 'c1', day: '2026-09-01', spend: 10, impressions: 1, clicks: 1, conversions: 1, reach: 1 },
  ] };
  await realCache.writeAdvertiserSnapshot('acc', 'adv', snapshot, { pruneMetrics: true });
  assert.strictEqual(outsideWrites, 0);
  assert.ok(committed.some((q) => /INSERT INTO ads_campaigns_cache/.test(q.text)));
  assert.ok(committed.some((q) => /INSERT INTO ads_metrics_cache/.test(q.text)));
  assert.ok(committed.some((q) => /DELETE FROM ads_metrics_cache/.test(q.text)));
  assert.ok(committed.every((q) => q.params.includes('acc') && q.params.includes('adv') || /advisory/.test(q.text)), 'escopo da conta em todos os statements');
  const previous = JSON.stringify(committed);
  rollback = true;
  await assert.rejects(realCache.writeAdvertiserSnapshot('acc', 'adv', snapshot), /chunk/);
  assert.strictEqual(JSON.stringify(committed), previous, 'falha transacional preserva snapshot anterior');
  rollback = false;
  await realCache.writeAdvertiserSnapshot('acc', 'adv', { campaigns: [], dailyMetrics: [] }, { pruneMetrics: true });
  assert.ok(committed.some((q) => /DELETE FROM ads_metrics_cache/.test(q.text)), 'vazio confirmado limpa totais antigos');
  await realCache.writeAdvertiserSnapshot('acc', 'adv', snapshot, { pruneMetrics: false, metricsFrom: '2026-09-01', metricsTo: '2026-09-03' });
  const prune = committed.find((q) => /DELETE FROM ads_metrics_cache/.test(q.text));
  assert.ok(prune.params.includes('2026-09-01') && prune.params.includes('2026-09-03'));
  assert.match(prune.text, /day >=/);
  const count = transactions.length;
  await assert.rejects(realCache.writeAdvertiserSnapshot('acc', 'adv', {}), /incompleto/);
  assert.strictEqual(transactions.length, count);
  console.log('ads-sync-integrity: falhas por nível, frescor, recuperação, vazio e transação do espelho OK');
})().catch((e) => { console.error(e); process.exitCode = 1; });
