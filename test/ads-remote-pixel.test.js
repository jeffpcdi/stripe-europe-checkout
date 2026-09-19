'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../ads-routes'), 'utf8');
const section = source.slice(source.indexOf('  async function pixelContext'), source.indexOf('  // ── Públicos Personalizados'));
const handlers = {};
let remote = [], binding = null, offline = false, dryRun = false;
let local = [];
vm.runInNewContext(section, {
  app: Object.fromEntries(['get', 'put', 'post'].map(method => [method, (route, auth, handler) => { handlers[method + route] = handler; }])),
  dashboardAuth() {},
  console,
  pixelStore: {
    list: () => local,
    save: async (account, input) => {
      const row = { slug: 'roi-nados-vendas', acc: account, name: input.name, pixelCode: input.pixelCode, accessToken: '', active: true };
      local.push(row);
      return row;
    },
  },
  pipeboard: {
    listTikTokPixels: async () => { if (offline) throw Error('offline'); return remote; },
    createTikTokPixel: async (advertiserId, input) => {
      const existing = remote.find(pixel => pixel.name === input.name);
      if (existing) return { pixel: existing, reused: true };
      const pixel = { id: '55555555', code: 'ROI555', name: input.name, status: 'ACTIVE' };
      remote.push(pixel);
      return { pixel, reused: false };
    },
  },
  adsOps: {
    getPixelBinding: async () => binding,
    savePixelBinding: async (account, advertiser, value) => (binding = value),
    deletePixelBinding: async () => { binding = null; },
    getSafetyPolicy: async () => ({ enabled: true, blockedAdvertiserIds: [], dryRun }),
    appendAuditEvent: async () => {},
  },
  requireAdvertiser: async (account, _, id) => { if (id !== 'allowed') throw Error('Conta não autorizada'); return { advertiserId: id }; },
  killSwitchActive: async () => false,
  KILL_SWITCH_BODY: { error: 'KILL_SWITCH_ON' },
  auditSimulated: async () => {},
  stats: { logEvent() {} },
  fail: (res, error) => res.status(error.status || 500).json({ error: error.message }),
});
async function call(method, body = {}) {
  const res = { statusCode: 200, set() {}, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
  const suffix = method === 'put' ? '/default' : '';
  await handlers[method + '/api/ads/pixels' + suffix]({
    account: { id: 'tenant' },
    query: { adAccountId: 'allowed' },
    body: { adAccountId: 'allowed', ...body },
  }, res);
  return res;
}
(async () => {
  assert.equal((await call('get')).body.ready, false);

  const created = await call('post', { pixelName: 'ROI-NADOS — Vendas' });
  assert.equal(created.statusCode, 201);
  assert.equal(created.body.binding.pixelId, '55555555');
  assert.equal(created.body.localPixelCreated, true);
  assert.equal(local[0].pixelCode, 'ROI555', 'provisionamento cria espelho local sem inventar Access Token');

  let state = await call('get');
  assert.equal(state.body.ready, true);
  assert.equal(state.body.capiReady, false, 'sem Access Token, campanhas estão prontas mas server-side não');

  local[0].accessToken = 'token-real';
  state = await call('get');
  assert.equal(state.body.capiReady, true, 'o mesmo Pixel fica server-side pronto quando há token local');

  binding = null;
  const reused = await call('post', { pixelName: 'ROI-NADOS — Vendas' });
  assert.equal(reused.statusCode, 200);
  assert.equal(reused.body.reused, true, 'retry reutiliza Pixel com mesmo nome em vez de duplicar');
  assert.equal(remote.length, 1);

  dryRun = true;
  remote = []; binding = null; local = [];
  const simulated = await call('post', { pixelName: 'Outro Pixel' });
  assert.equal(simulated.body.dryRun, true);
  assert.equal(remote.length, 0, 'dry-run não cria Pixel remoto');
  dryRun = false;

  remote = [{ id: '12345678', code: '', name: 'Pixel remoto' }];
  assert.equal((await call('get')).body.binding.pixelId, '12345678', 'Pixel remoto funciona sem cadastro local ou código alfanumérico');
  offline = true;
  assert.equal((await call('get')).statusCode, 500);
  assert.equal(binding.pixelId, '12345678', 'falha de transporte preserva o vínculo');
  offline = false; binding = null;
  remote.push({ id: '87654321', code: 'B', name: 'Segundo' });
  assert.equal((await call('get')).body.needsChoice, true, 'não escolhe arbitrariamente entre vários');
  assert.equal((await call('put', { pixelId: 'foreign' })).statusCode, 400);
  assert.equal((await call('put', { pixelId: '87654321' })).body.binding.pixelId, '87654321');
  assert.equal((await call('get')).body.binding.pixelId, '87654321');
  assert.equal((await call('put', { adAccountId: 'foreign', pixelId: '87654321' })).statusCode, 500);
  remote = [];
  assert.equal((await call('get')).body.ready, false, 'revogação remove o vínculo');
  console.log('ads-remote-pixel: provisionamento, prontidão, dry-run, escolha, revogação e isolamento OK');
})().catch(error => { console.error(error); process.exitCode = 1; });
