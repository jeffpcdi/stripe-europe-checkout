'use strict';
// Executa o handler real com persistência simulada, sem TikTok/Neon.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const catalogDomain = require('../catalog/catalog-domain');
const source = fs.readFileSync(path.join(__dirname, '..', 'ads-routes.js'), 'utf8');
const start = source.indexOf("  app.post('/api/ads/catalogs/:catalogId/campaign-batch'");
const end = source.indexOf('\n  });', start) + '\n  });'.length;
let handler, dryRun = false, locked = false, failAt = 0, attempts = 0;
const persisted = new Map();
vm.runInNewContext(source.slice(start, end), {
  app: { post: (_path, _auth, fn) => { handler = fn; } }, dashboardAuth() {}, catalogDomain,
  prepareCatalogCampaign: async (req) => ({
    accId: req.account.id, advertiserId: 'adv', catalog: { id: 'cat', name: 'Loja' }, pixelReady: true,
    spec: catalogDomain.normalizeCampaignSpec({ ...req.body, pixelId: '12345678', pixelEvent: 'ON_WEB_ORDER' }, { name: 'Loja', currency: 'BRL' }),
  }),
  killSwitchActive: async () => locked, KILL_SWITCH_BODY: { error: 'pausado' },
  isDryRun: async () => dryRun, auditSimulated: async () => {},
  scopedCatalogRunIdempotencyKey: (adv, key) => adv + ':' + key,
  catalogStore: { createCampaignRun: async (acc, adv, cat, run) => {
    attempts++;
    if (failAt && attempts === failAt) throw Error('falha temporária');
    assert.strictEqual(acc, 'acc'); assert.strictEqual(adv, 'adv'); assert.strictEqual(cat, 'cat');
    if (!persisted.has(run.idempotencyKey)) persisted.set(run.idempotencyKey, run);
    return persisted.get(run.idempotencyKey);
  } },
  fail: (res, err) => res.status(err.status || 500).json({ error: err.message, code: err.code }),
});
async function send(body) {
  const result = { status: 200 };
  const res = { status(code) { result.status = code; return this; }, json(value) { result.body = value; } };
  await handler({ account: { id: 'acc' }, params: { catalogId: 'cat' }, body: { budgetAmount: 50, ...body }, get: () => null }, res);
  return result;
}
const videos = Array.from({ length: 5 }, (_, i) => `https://cdn.test/creative-${i + 1}.mp4`);
(async () => {
  let result = await send({ videoUrls: videos, idempotencyKey: 'five' });
  assert.strictEqual(result.status, 202, JSON.stringify(result.body));
  assert.strictEqual(result.body.count, 5);
  assert.deepStrictEqual(Array.from(result.body.runs, (run) => run.spec.videoUrl), videos);
  assert.strictEqual(new Set(result.body.runs.map((r) => r.spec.name)).size, 5);
  assert.ok(result.body.runs.every((r) => r.spec.productScope === 'all' && r.spec.pixelId === '12345678'));
  await send({ videoUrls: videos, idempotencyKey: 'five' });
  assert.strictEqual(persisted.size, 5, 'retry mantém cinco runs');
  result = await send({ videoUrls: videos, count: 10, idempotencyKey: 'ten' });
  assert.deepStrictEqual(Array.from(result.body.runs, (r) => r.spec.videoUrl), [...videos, ...videos], 'rodízio preserva ordem');
  result = await send({ videoUrl: videos[0], count: 5, idempotencyKey: 'legacy' });
  assert.strictEqual(result.body.count, 5, 'contrato antigo continua funcionando');
  assert.ok(result.body.runs.every((r) => r.spec.videoUrl === videos[0]));
  const before = persisted.size;
  for (const body of [
    { videoUrls: [...videos.slice(0, 4), 'http://invalido.test/video.mp4'] },
    { videoUrls: [videos[0], null] }, { videoUrls: [] }, { videoUrls: 'inválido' },
    { videoUrls: Array(51).fill(videos[0]) }, { videoUrls: videos, count: 3 },
  ]) {
    result = await send(body);
    assert.strictEqual(result.status, 400);
    assert.strictEqual(persisted.size, before, 'nenhum run parcial por criativo inválido');
  }
  dryRun = true;
  result = await send({ videoUrls: videos });
  assert.strictEqual(result.body.dryRun, true);
  assert.strictEqual(result.body.count, 5);
  assert.strictEqual(persisted.size, before);
  dryRun = false; locked = true;
  assert.strictEqual((await send({ videoUrls: videos })).status, 423);
  assert.strictEqual(persisted.size, before);
  locked = false; attempts = 0; failAt = 3;
  assert.strictEqual((await send({ videoUrls: videos, idempotencyKey: 'resume' })).status, 500);
  assert.strictEqual(persisted.size, before + 2);
  failAt = 0;
  result = await send({ videoUrls: videos, idempotencyKey: 'resume' });
  assert.strictEqual(result.body.count, 5);
  assert.strictEqual(persisted.size, before + 5, 'retomada preserva associação sem duplicar campanhas já salvas');
  console.log('catalog-multiple-creatives: 5 vídeos/5 campanhas, rodízio, validação e retomada OK');
})().catch((e) => { console.error(e); process.exitCode = 1; });
