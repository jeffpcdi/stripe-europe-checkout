'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'ads-routes.js'), 'utf8');
const from = source.indexOf('  async function validateCatalogCreatives(');
const to = source.indexOf('  // Bulk Creative Match:', from);
const handlers = new Map();
const queue = new Map();
let locked = false, dry = false, bc = '', candidates = [{ id: 'bc-1' }], missingFile = false;
let published = 0, resumed = 0, discoveries = 0;
const req = { account: { id: 'acc' }, query: { adAccountId: 'adv' } };
const provider = { enabled: true, getBusinessCenterId: () => bc,
  listCatalogBusinessCenters: async adv => { assert.equal(adv, 'adv'); discoveries++; return candidates; },
  setBusinessCenterId: (account, adv, id) => { assert.equal(account, 'acc'); assert.equal(adv, 'adv'); bc = id; return id; },
};
const catalog = { id: 'cat', automation: { sourceUrl: 'https://loja.example/p' }, creatives: [] };
const catalogStore = {
  createSyncRun: async (account, adv, cat, data) => {
    assert.equal(account, 'acc'); assert.equal(adv, 'adv'); assert.equal(cat, 'cat');
    if (!queue.has(data.idempotencyKey)) queue.set(data.idempotencyKey, { id: 'sync', ...data });
    return queue.get(data.idempotencyKey);
  },
  resumeSyncRun: async (account, adv, id) => { assert.equal(account, 'acc'); assert.equal(adv, 'adv'); assert.equal(id, 'sync'); resumed++; return { id, status: 'queued' }; },
  getCatalog: async (account, adv) => account === 'acc' && adv === 'adv' ? catalog : null,
  addCatalogCreatives: async (_account, _adv, _id, creatives) => ({ ...catalog, creatives }),
  removeCatalogCreative: async (account, adv) => account === 'acc' && adv === 'adv' ? catalog : null,
};
const ctx = vm.createContext({ URL,
  app: { post: (route, _auth, fn) => handlers.set('POST ' + route, fn), delete: (route, _auth, fn) => handlers.set('DELETE ' + route, fn) },
  dashboardAuth() {}, pipeboard: provider, catalogStore,
  catalogAdvertiserId: async req => req.query.adAccountId,
  killSwitchActive: async () => locked, isDryRun: async () => dry,
  adsStorage: { publicOrigin: () => 'https://app.example', safeSegment: value => value, accountDir: () => '/isolated/acc' },
  publishCatalogFeed: async () => { published++; return { feedRevision: 'revision-1', feedUrl: 'https://app.example/feed/token.csv?v=revision-1', published: 4, skipped: 0 }; },
  scopedCatalogRunIdempotencyKey: (adv, key) => adv + ':' + key,
  fail: (res, err) => res.status(err.status || 500).json({ error: err.message, code: err.code }),
  require: name => {
    if (name === 'path') return path;
    if (name === 'fs/promises') return { access: async file => { assert.ok(file.startsWith('/isolated/acc/')); if (missingFile) throw Error('missing'); } };
    if (name === './catalog/catalog-product-automation') return require('../catalog/catalog-product-automation');
    throw Error(name);
  },
});
vm.runInContext(source.slice(from, to), ctx);
async function send(method, body, advertiser = 'adv') {
  const result = { status: 200 };
  const res = { status(code) { result.status = code; return this; }, json(body) { result.body = body; return this; } };
  const route = method === 'POST' ? '/api/ads/catalogs/:catalogId/creatives' : '/api/ads/catalogs/:catalogId/creatives/:creativeId';
  await handlers.get(method + ' ' + route)({ ...req, query: { adAccountId: advertiser }, params: { catalogId: 'cat', creativeId: 'v1' }, body }, res);
  return result;
}
async function main() {
  const valid = { creatives: [{ name: 'Vídeo', url: 'https://app.example/uploads/acc/video.mp4' }] };
  assert.equal((await send('POST', valid)).status, 200);
  for (const url of ['https://app.example/uploads/other/video.mp4', 'https://other.example/uploads/acc/video.mp4', 'https://app.example/uploads/acc/video.mp4?x=1', 'https://app.example/uploads/acc/../other/video.mp4']) {
    assert.equal((await send('POST', { creatives: [{ url }] })).status, 400, 'vínculo exige arquivo próprio');
  }
  assert.equal((await send('POST', valid, 'other')).status, 404);
  assert.equal((await send('DELETE', {}, 'other')).status, 404);
  missingFile = true;
  assert.equal((await send('POST', valid)).status, 422);
  missingFile = false;
  for (const [code, set, reset] of [
    ['KILL_SWITCH_ACTIVE', () => { locked = true; }, () => { locked = false; }],
    ['DRY_RUN_ENABLED', () => { dry = true; }, () => { dry = false; }],
    ['PIPEBOARD_DISABLED', () => { provider.enabled = false; }, () => { provider.enabled = true; }],
  ]) {
    set(); await assert.rejects(ctx.startProductCatalogSync(req, 'adv', catalog), err => err.code === code); reset();
  }
  assert.equal(published, 0, 'bloqueios não publicam nem enfileiram');
  candidates = [{ id: 'bc-1' }, { id: 'bc-2' }];
  await assert.rejects(ctx.startProductCatalogSync(req, 'adv', catalog), err => err.code === 'CATALOG_BC_REQUIRED');
  assert.equal(queue.size, 0, 'mais de um BC requer escolha');
  candidates = [{ id: 'bc-1' }];
  const run = await ctx.startProductCatalogSync(req, 'adv', catalog);
  assert.equal(run.payload.bcId, 'bc-1');
  assert.equal(run.payload.published, 4);
  assert.equal(discoveries, 2);
  assert.equal(run.status, 'queued');
  await ctx.startProductCatalogSync(req, 'adv', catalog);
  assert.equal(queue.size, 1, 'mesma revisão usa mesmo run');
  assert.equal(discoveries, 2, 'BC já vinculado dispensa nova descoberta');
  run.status = 'failed';
  await ctx.startProductCatalogSync(req, 'adv', catalog);
  assert.equal(resumed, 1, 'falha retoma run existente');
  console.log('catalog-product-routes: biblioteca própria, arquivos ausentes, BC, bloqueios e fila idempotente OK');
}
main().catch(err => { console.error(err); process.exitCode = 1; });
