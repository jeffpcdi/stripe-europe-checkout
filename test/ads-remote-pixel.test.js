'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../ads-routes'), 'utf8');
const section = source.slice(source.indexOf('  async function pixelContext'), source.indexOf('  // ── Públicos Personalizados'));
const handlers = {};
let remote = [], binding = null, offline = false;
vm.runInNewContext(section, {
  app: Object.fromEntries(['get', 'put'].map(method => [method, (route, auth, handler) => { handlers[method + route] = handler; }])),
  dashboardAuth() {}, pixelStore: { list: () => [] },
  pipeboard: { listTikTokPixels: async () => { if (offline) throw Error('offline'); return remote; } },
  adsOps: {
    getPixelBinding: async () => binding,
    savePixelBinding: async (account, advertiser, value) => (binding = value),
    deletePixelBinding: async () => { binding = null; },
  },
  requireAdvertiser: async (account, _, id) => { if (id !== 'allowed') throw Error('Conta não autorizada'); return { advertiserId: id }; },
  fail: (res, error) => res.status(error.status || 500).json({ error: error.message }),
});
async function call(method, body = {}) {
  const res = { statusCode: 200, set() {}, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
  await handlers[method + '/api/ads/pixels' + (method === 'put' ? '/default' : '')]({ account: { id: 'tenant' }, query: { adAccountId: 'allowed' }, body: { adAccountId: 'allowed', ...body } }, res);
  return res;
}
(async () => {
  assert.equal((await call('get')).body.ready, false);
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
  console.log('ads-remote-pixel: origem remota, escolha, revogação e isolamento OK');
})().catch(error => { console.error(error); process.exitCode = 1; });
