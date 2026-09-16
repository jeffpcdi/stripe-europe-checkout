'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Module = require('module');

const ROOT = path.join(__dirname, '..');

(async () => {
  // 1) Janela civil: Hoje em São Paulo começa à meia-noite local (03:00Z em setembro).
  const { periodWindow } = require('../overview-window');
  const now = new Date('2026-09-16T12:34:56.000Z');
  const today = periodWindow('today', 'America/Sao_Paulo', now);
  assert.equal(today.curFrom.toISOString(), '2026-09-16T03:00:00.000Z');
  assert.equal(today.curTo.toISOString(), now.toISOString());
  const all = periodWindow('all', 'America/Sao_Paulo', now);
  assert(all.curFrom < all.curTo);
  assert.equal(all.period, 'all');

  // 2) Memória/leave: mesmo visitorId precisa coexistir em duas contas.
  {
    const dbWrites = [];
    const redisTouches = [];
    const redisLeaves = [];
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'presence.js'), 'utf8'), {
      module,
      exports: module.exports,
      Date,
      URL,
      require: (name) => name === './db'
        ? { upsertSession: (acc, row) => dbWrites.push([acc, row.visitorId]) }
        : {
            enabled: false,
            touchPresence: (acc, id) => redisTouches.push([acc, id]),
            leavePresence: (acc, id) => redisLeaves.push([acc, id]),
          },
    });
    const presence = module.exports;
    presence.touch({ visitorId: 'ld_same', acc: 'acc_A', page: '/a', country: 'BR' });
    presence.touch({ visitorId: 'ld_same', acc: 'acc_B', page: '/b', country: 'PT' });
    assert.equal((await presence.list('acc_A')).length, 1);
    assert.equal((await presence.list('acc_A'))[0].page, '/a');
    assert.equal((await presence.list('acc_B')).length, 1);
    assert.equal((await presence.list('acc_B'))[0].page, '/b');
    presence.leave('acc_A', 'ld_same');
    assert.equal((await presence.list('acc_A')).length, 0, 'leave de A precisa remover somente A');
    assert.equal((await presence.list('acc_B')).length, 1, 'leave de A não pode derrubar B');
    assert.deepEqual(redisTouches, [['acc_A', 'ld_same'], ['acc_B', 'ld_same']]);
    assert.deepEqual(redisLeaves, [['acc_A', 'ld_same']]);
    assert.deepEqual(dbWrites, [['acc_A', 'ld_same'], ['acc_B', 'ld_same']]);
  }

  // 3) Upstash: namespace por conta e SCAN restrito ao tenant.
  {
    const oldLoad = Module._load;
    const oldUrl = process.env.UPSTASH_REDIS_REST_URL;
    const oldToken = process.env.UPSTASH_REDIS_REST_TOKEN;
    const store = new Map();
    const scans = [];
    class FakeRedis {
      async set(key, value) { store.set(key, value); return 'OK'; }
      async del(key) { return store.delete(key) ? 1 : 0; }
      async scan(_cursor, opts) {
        scans.push(opts.match);
        const prefix = String(opts.match || '').replace(/\*$/, '');
        return ['0', [...store.keys()].filter((key) => key.startsWith(prefix))];
      }
      async mget(...keys) { return keys.map((key) => store.get(key) ?? null); }
    }
    process.env.UPSTASH_REDIS_REST_URL = 'https://unit.test';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'token';
    Module._load = function(request, parent, isMain) {
      if (request === '@upstash/redis') return { Redis: FakeRedis };
      return oldLoad.call(this, request, parent, isMain);
    };
    delete require.cache[require.resolve('../redis')];
    try {
      const redis = require('../redis');
      await redis.touchPresence('acc_A', 'ld_same', { id: 'ld_same', acc: 'acc_A' });
      await redis.touchPresence('acc_B', 'ld_same', { id: 'ld_same', acc: 'acc_B' });
      assert.equal(store.size, 2, 'duas contas precisam gerar duas chaves');
      const rowsA = await redis.listPresence('acc_A');
      assert.deepEqual(rowsA.map((row) => row.acc), ['acc_A']);
      assert(scans.some((pattern) => pattern.startsWith('presence:acc_A:')));
      await redis.leavePresence('acc_A', 'ld_same');
      assert.equal(store.size, 1);
      assert([...store.keys()][0].includes('acc_B'));
    } finally {
      Module._load = oldLoad;
      if (oldUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL; else process.env.UPSTASH_REDIS_REST_URL = oldUrl;
      if (oldToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN; else process.env.UPSTASH_REDIS_REST_TOKEN = oldToken;
      delete require.cache[require.resolve('../redis')];
    }
  }

  // 4) Health: fatos duráveis vencem o snapshot truncado.
  {
    const { buildOverviewHealth } = require('../overview-health');
    const out = buildOverviewHealth({
      snapshot: { events: [], leads: [{ id: 'hot', at: '2026-09-16T10:00:00Z', stage: 'visit' }] },
      facts: {
        leads_total: 9001,
        tracked_purchases: 450,
        orphan_purchases: 50,
        sale_events: 500,
        attributed_visits: 8100,
        country_visits: 8500,
        last_traffic_at: '2026-09-16T11:00:00Z',
        last_payment_at: '2026-09-16T11:05:00Z',
        hosts: [{ host: 'example.com', visits: 9001, last_at: '2026-09-16T11:00:00Z', pixels: ['px-main'] }],
      },
      links: [{ slug: 'oferta', ativo: true }],
      pixels: [{ slug: 'px-main', active: true, pixelCode: '1', accessToken: 'x' }],
      gateways: [{ id: 'gw' }],
      timeZone: 'America/Sao_Paulo',
    });
    assert.equal(out.coverage.attribution.total, 9001);
    assert.equal(out.coverage.purchases.total, 500);
    assert.equal(out.coverage.purchases.tracked, 450);
    assert.equal(out.freshness.lastPaymentAt, '2026-09-16T11:05:00.000Z');
  }

  // 5) readOverviewPeriod: resultado vem do banco e não contém cap de 8k/3k.
  {
    const oldLoad = Module._load;
    const oldDb = process.env.DATABASE_URL;
    let capturedSql = '';
    const fakeRow = {
      event_totals: { sales: 100, failed: 25, refunds: 2, disputes: 1, last_event_at: '2026-09-16T12:00:00Z' },
      event_currency: [{ currency: 'BRL', sales: 100, revenue_cents: 123456 }],
      event_daily: [{ day: '2026-09-16', revenue: 123456, sales: 100 }],
      lead_summary: { visits: 9001, reached_checkout: 4000, payment_started: 2000, purchased: 450, last_lead_at: '2026-09-16T12:01:00Z' },
      countries: [{ code: 'BR', name: 'Brasil', count: 8000, purchased: 400 }],
      campaigns: [{ name: 'campanha-a', leads: 1000, purchased: 100 }],
      lead_daily: [{ day: '2026-09-16', visits: 9001 }],
    };
    const fakeSql = async (strings) => {
      capturedSql = Array.from(strings).join('?');
      return [fakeRow];
    };
    process.env.DATABASE_URL = 'postgres://unit.test/db';
    Module._load = function(request, parent, isMain) {
      if (request === '@neondatabase/serverless') return { neon: () => fakeSql };
      return oldLoad.call(this, request, parent, isMain);
    };
    delete require.cache[require.resolve('../db')];
    try {
      const db = require('../db');
      const result = await db.readOverviewPeriod('acc_A', '2026-09-16T03:00:00Z', '2026-09-17T03:00:00Z', 'America/Sao_Paulo');
      assert.equal(result.visits, 9001, 'agregado não pode herdar cap de 8000');
      assert.equal(result.rev.BRL, 123456);
      assert.equal(result.approval, 80);
      assert.equal(result.topCampaigns[0].conv, 10);
      assert.match(capturedSql, /FROM leads/);
      assert.match(capturedSql, /account_id\s*=/);
      assert.doesNotMatch(capturedSql, /LIMIT\s+8000|LIMIT\s+3000/i);
    } finally {
      Module._load = oldLoad;
      if (oldDb === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = oldDb;
      delete require.cache[require.resolve('../db')];
    }
  }

  // 6) Contrato estrutural: Home usa analytics durável; schema da presença é composto.
  const serverSource = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const dbSource = fs.readFileSync(path.join(ROOT, 'db.js'), 'utf8');
  const overviewSource = fs.readFileSync(path.join(ROOT, 'dashboard/components/overview/overview-view.tsx'), 'utf8');
  assert.match(serverSource, /\/api\/overview\/analytics/);
  assert.match(serverSource, /db\.readOverviewPeriod/);
  assert.match(overviewSource, /overviewAnalytics\?\.complete/);
  assert.match(overviewSource, /cur:\s*overviewAnalytics\.current/);
  assert.match(dbSource, /PRIMARY KEY \(account_id, visitor_id\)/);
  assert.match(dbSource, /ON CONFLICT \(account_id, visitor_id\)/);

  console.log('overview-backend-v16-12.test.js: ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
