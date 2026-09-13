'use strict';

const assert = require('assert');
const { buildOverviewHealth, cleanHost, campaignOf } = require('../overview-health');

function configured(extra) {
  return buildOverviewHealth({
    snapshot: { events: [], leads: [], updatedAt: null },
    links: [{ slug: 'oferta', ativo: true }],
    pixels: [{ slug: 'principal', active: true, pixelCode: 'PX1', accessToken: 'token' }],
    gateways: [{ id: 'gw_1' }],
    ...extra
  });
}

{
  const out = buildOverviewHealth({ snapshot: { events: [], leads: [] } });
  assert.equal(out.status, 'critical');
  assert(out.actions.some((a) => a.id === 'link'));
  assert(out.actions.some((a) => a.id === 'pixel'));
  assert(out.actions.some((a) => a.id === 'gateway'));
}

{
  const out = configured({
    snapshot: {
      updatedAt: '2026-07-21T12:00:00.000Z',
      events: [
        { type: 'sale', at: '2026-07-21T11:00:00.000Z' },
        { type: 'sale', at: '2026-07-21T11:30:00.000Z' }
      ],
      leads: [
        {
          id: 'tracked', at: '2026-07-21T10:00:00.000Z', lastSeen: '2026-07-21T10:05:00.000Z',
          stage: 'purchased', linkSlug: 'oferta', pixelSlug: 'principal',
          sites: [{ host: 'https://WWW.Example.com/checkout', hits: 3, lastAt: '2026-07-21T10:05:00.000Z' }]
        },
        { id: 'orphan', at: '2026-07-21T11:30:00.000Z', stage: 'purchased', orphan: true }
      ]
    }
  });
  assert.equal(out.status, 'warning');
  assert.deepEqual(out.coverage.purchases, { total: 2, tracked: 1, orphan: 1, rate: 50 });
  assert.equal(out.coverage.attribution.rate, 100);
  assert.equal(out.coverage.hosts.items[0].host, 'example.com');
  assert.deepEqual(out.coverage.hosts.items[0].pixels, ['principal']);
  assert.equal(out.freshness.lastDataAt, '2026-07-21T12:00:00.000Z');
  assert(out.actions.some((a) => a.id === 'orphan'));
}

{
  const leads = Array.from({ length: 10 }, (_, i) => ({
    id: String(i), at: '2026-07-21T10:00:00.000Z', stage: 'visit',
    utm: { campaign: i === 0 ? 'campanha-real' : '__CAMPAIGN_NAME__' }
  }));
  const out = configured({ snapshot: { events: [], leads } });
  assert.equal(out.coverage.attribution.identified, 1);
  assert(out.actions.some((a) => a.id === 'attribution'));
}

assert.equal(cleanHost('https://www.Example.com/path'), 'example.com');
assert.equal(campaignOf({ utm: { campaign: '__CAMPAIGN_ID__' } }), '');
assert.equal(campaignOf({ utm: { campaign: 'black_friday' } }), 'black_friday');

console.log('overview-health.test.js: ok');
