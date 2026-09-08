'use strict';
const assert = require('node:assert/strict');
const paths = { db: require.resolve('../db'), redis: require.resolve('../redis'), pixels: require.resolve('../pixel-store'), gateways: require.resolve('../gateway-store') };
function fresh(name, db, redis) {
  for (const [key, value] of Object.entries({ db, redis })) require.cache[paths[key]] = { id: paths[key], filename: paths[key], loaded: true, exports: value };
  delete require.cache[paths[name]];
  return require(paths[name]);
}
(async () => {
  const p = { slug: 'existing', acc: 'account', token: 'px_existing', name: 'Original', pixelCode: 'CODE', active: true, gatewayIds: ['gw_a'] };
  let mirrored = 0;
  const pixels = fresh('pixels', { enabled: true, loadPixels: async () => ({ ok: true, data: [p] }), upsertPixel: async () => false }, { enabled: true, savePixelSnapshot: async () => { mirrored++; return true; } });
  await pixels.init();
  await assert.rejects(pixels.save('account', { slug: p.slug, name: 'Alterado', gatewayIds: [] }), /preservado/);
  assert.equal(pixels.get('account', p.slug).name, 'Original');
  assert.deepEqual(pixels.get('account', p.slug).gatewayIds, ['gw_a']);
  assert.equal(mirrored, 0, 'Neon rejeitado não publica configuração divergente no Redis');
  const g = { id: 'gw_existing', account_id: 'account', name: 'Original', provider: 'generic', webhook_token: 'original' };
  const gateways = fresh('gateways', { enabled: true, loadGateways: async () => ({ ok: true, data: [g] }), upsertGateway: async () => null, deleteGateway: async () => false }, { enabled: true, saveGatewaySnapshot: async () => true, deleteGatewaySnapshot: async () => true });
  await gateways.init();
  await assert.rejects(gateways.save('account', { id: g.id, name: 'Alterado', provider: 'generic' }), /salvar/);
  assert.equal(gateways.get('account', g.id).name, 'Original');
  await assert.rejects(gateways.remove('account', g.id), /exclusão/);
  assert(gateways.get('account', g.id));
  await assert.rejects(gateways.save('other-account', { id: g.id, provider: 'generic' }), /não encontrado/);
  console.log('conversions-persistence: falha preserva configurações; isolamento de conta OK');
})().catch(e => { console.error(e); process.exitCode = 1; });
