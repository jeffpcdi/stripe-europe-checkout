'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const runtime = require('../pixel-runtime-coverage');

function eq(actual, expected, message) { assert.deepStrictEqual(actual, expected, message); }

// 1) host normalization + subdomain distinction.
eq(runtime.normalizeHost('  WWW.Example.COM. '), 'example.com');
eq(runtime.normalizeHost('checkout.example.com'), 'checkout.example.com');
assert.notStrictEqual(runtime.normalizeHost('checkout.example.com'), runtime.normalizeHost('example.com'));

// 2) hits are exact when valid and minimum 1 otherwise.
eq(runtime.normalizeHits(4), 4);
eq(runtime.normalizeHits(4.9), 4);
eq(runtime.normalizeHits(0), 1);
eq(runtime.normalizeHits(-10), 1);
eq(runtime.normalizeHits('invalid'), 1);

// 3) modern sites[] wins over legacy site; no double count.
const modern = runtime.coverageFromLeads([{
  pixelSlug: 'px-a', site: 'legacy.example.com', lastSeen: '2026-09-10T00:00:00.000Z',
  sites: [{ host: 'WWW.Example.com.', hits: 3, lastAt: '2026-09-11T00:00:00.000Z' }]
}]);
eq(modern.length, 1);
eq(modern[0].host, 'example.com');
eq(modern[0].visits, 3);

// 4) global recency priority: any site.lastAt beats newer lower-priority dates.
const recency = runtime.normalizeDurableCoverage([
  { pixel_slug: 'px-a', host: 'example.com', visits: 1, site_last_at: '2026-01-01T00:00:00Z', updated_at: '2026-09-15T00:00:00Z' },
  { pixel_slug: 'px-a', host: 'example.com', visits: 2, last_seen_at: '2026-09-16T00:00:00Z', updated_at: '2026-09-16T00:00:00Z' },
]);
eq(recency[0].visits, 3);
eq(recency[0].lastSeenAt, '2026-01-01T00:00:00.000Z');

// 5) successful Neon result is authoritative even when empty; hot cache cannot override it.
const hot = [{ pixelSlug: 'px-a', site: 'example.com', lastSeen: '2026-09-17T00:00:00Z' }];
let resolved = runtime.resolveRuntimeCoverage({ ok: true, data: [] }, hot, { host: 'example.com' });
eq(resolved.data, []);
eq(resolved.runtimeSource, 'neon');
eq(resolved.runtimeCoverageComplete, true);

// 6) Neon failure uses hot cache only as incomplete fallback.
resolved = runtime.resolveRuntimeCoverage({ ok: false, data: [] }, hot, { host: 'example.com' });
eq(resolved.runtimeSource, 'hot-cache-fallback');
eq(resolved.runtimeCoverageComplete, false);
eq(resolved.data[0].visits, 1);

// 7) unknown semantics: no static/runtime evidence while durable source is unavailable.
eq(runtime.installationVerdict(false, null, false), { installed: null, runtimeState: 'unknown' });
eq(runtime.installationVerdict(false, null, true), { installed: false, runtimeState: 'not_seen' });
eq(runtime.installationVerdict(false, { visits: 2 }, false), { installed: true, runtimeState: 'seen' });
eq(runtime.installationVerdict(true, null, false), { installed: true, runtimeState: 'unknown' });

// 8) durable rows preserve exact pixel/host isolation.
const grouped = runtime.normalizeDurableCoverage([
  { pixel_slug: 'px-a', host: 'example.com', visits: 2 },
  { pixel_slug: 'px-b', host: 'example.com', visits: 4 },
  { pixel_slug: 'px-a', host: 'checkout.example.com', visits: 5 },
]);
eq(grouped.length, 3);

// 9) DB contract: compact SQL aggregation, finite window, no speculative index.
const dbSource = fs.readFileSync(path.join(root, 'db.js'), 'utf8');
assert(dbSource.includes('async function readPixelRuntimeCoverage'));
assert(dbSource.includes('WHERE account_id = ${accountId}'));
assert(dbSource.includes("updated_at >= now() - (${windowDays} * interval '1 day')"));
assert(dbSource.includes("data->>'pixelSlug' = ${pixelSlug}"));
assert(dbSource.includes('jsonb_array_elements'));
assert(dbSource.includes('SUM(hits)::bigint AS visits'));
assert(dbSource.includes('GROUP BY pixel_slug, host'));
assert(!/readPixelRuntimeCoverage[\s\S]{0,5000}CREATE\s+(?:UNIQUE\s+)?INDEX/i.test(dbSource), 'runtime reader must not create indexes');

// 10) Server contract: durable-first, explicit incomplete fallback, merged CAPI history.
const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
assert(serverSource.includes('readPixelRuntimeEvidence'));
assert(serverSource.includes('typeof db.readPixelRuntimeCoverage'));
assert(serverSource.includes("runtimeSource: runtime.runtimeSource"));
assert(serverSource.includes('runtimeCoverageComplete: runtime.runtimeCoverageComplete'));
assert(serverSource.includes('installationVerdict(scriptOk || nativeOk'));
assert(serverSource.includes("verdictText = algum === true ? 'instalado' : (algum === false ? 'NÃO encontrado' : 'inconclusivo')"));
assert(serverSource.includes("status = 'indisponivel'"));
assert(serverSource.includes('mergePixelEventRows(volatileRows, dbRows, 100)'));
assert(serverSource.includes('mergePixelEventRows(volatileRows, dbRows, 200)'));
assert(serverSource.includes('emqFields: Array.isArray(r.emq_fields)'));
assert(serverSource.includes("source: volatileRows.length ? 'redis' : 'neon'"));
// Existing SSRF protections must remain.
assert(serverSource.includes('VERIFY_MAX_BYTES'));
assert(serverSource.includes('hostSeguro'));
assert(serverSource.includes('VERIFY_MAX_REDIRECTS'));

// 11) UI must distinguish unknown/incomplete history.
const installSource = fs.readFileSync(path.join(root, 'dashboard/components/conversions/install-check.tsx'), 'utf8');
const cardSource = fs.readFileSync(path.join(root, 'dashboard/components/conversions/pixel-card.tsx'), 'utf8');
assert(installSource.includes("'seen' | 'not_seen' | 'unknown'"));
assert(installSource.includes('a verificação ficou inconclusiva'));
assert(cardSource.includes('Histórico indisponível'));

async function testRetryHydration() {
  const redisPath = require.resolve('../redis');
  const pixelStorePath = require.resolve('../pixel-store');
  const dbPath = require.resolve('../db');
  const errorsPath = require.resolve('../tiktok-errors');
  const eventContractPath = require.resolve('../tiktok-event-contract');
  const modulePath = require.resolve('../tiktok-events');
  const previous = new Map();
  [redisPath, pixelStorePath, dbPath, errorsPath, eventContractPath, modulePath].forEach((key) => previous.set(key, require.cache[key]));

  let calls = 0;
  const futureItem = {
    token: 'px_test', acc: 'acc-one', slug: 'pixel-a', eventId: 'event-1',
    p: { event: 'ViewContent' }, attempt: 0,
    firstAt: Date.now(), nextAt: Date.now() + 3600000,
  };
  const redisStub = {
    enabled: true,
    loadCapiRetryQueue: async () => { calls++; return calls === 1 ? null : [futureItem]; },
    saveCapiRetryQueue: async () => true,
    acquireLock: async () => true,
    releaseLock: async () => true,
    pushPixelLog: async () => true,
    bumpEmq: async () => true,
  };
  const pixelStoreStub = { getByToken: () => null, get: () => null, list: () => [] };
  require.cache[redisPath] = { id: redisPath, filename: redisPath, loaded: true, exports: redisStub };
  require.cache[pixelStorePath] = { id: pixelStorePath, filename: pixelStorePath, loaded: true, exports: pixelStoreStub };
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { enabled: false, insertPixelEvent() {} } };
  require.cache[errorsPath] = { id: errorsPath, filename: errorsPath, loaded: true, exports: { traduzErroTikTok: () => 'erro' } };
  require.cache[eventContractPath] = { id: eventContractPath, filename: eventContractPath, loaded: true, exports: { canonicalTikTokEvent: (x) => x } };
  delete require.cache[modulePath];
  try {
    const events = require('../tiktok-events');
    await events.drainRetryQueue();
    eq(events.retryQueueSize(), 0, 'failed Redis read must not invent queue data');
    await events.drainRetryQueue();
    eq(calls, 2, 'failed first hydration must be retried');
    eq(events.retryQueueSize(), 1, 'second successful hydration must recover the queue');
    await events.drainRetryQueue();
    eq(calls, 2, 'successful hydration must not reload every drain');
    eq(events.retryQueueSize(), 1, 'future retry item must remain queued');
  } finally {
    [redisPath, pixelStorePath, dbPath, errorsPath, eventContractPath, modulePath].forEach((key) => {
      const old = previous.get(key);
      if (old) require.cache[key] = old;
      else delete require.cache[key];
    });
  }
}

testRetryHydration().then(() => {
  console.log('Pixel runtime reliability V16.16 — OK');
}).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
