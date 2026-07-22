'use strict';

delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
delete process.env.NEON_DATABASE_URL;

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ops = require('../ads-ops-store');

function tree(status) {
  return [{
    platformCampaignId: 'c1', campaignName: 'Conversão', campaignKind: 'smart_plus',
    adSets: [{
      platformAdSetId: 'g1', adSetName: 'Público aberto',
      ads: [
        { platformAdId: 'a1', name: 'Criativo A', status, secondaryStatus: status === 'rejected' ? 'AD_STATUS_AUDIT_DENY' : 'AD_STATUS_DELIVERY_OK', materialIds: ['m1'] },
        { platformAdId: 'a2', name: 'Criativo B', status, secondaryStatus: status === 'rejected' ? 'AD_STATUS_AUDIT_DENY' : 'AD_STATUS_DELIVERY_OK', materialIds: ['m2'] },
      ],
    }],
  }];
}

(async () => {
  const accountId = 'acc_rejections_' + Date.now();
  const open = await ops.syncAdRejections(accountId, 'adv1', tree('rejected'));
  assert.strictEqual(open.length, 1, 'dois anúncios rejeitados no mesmo grupo viram um incidente');
  assert.deepStrictEqual(open[0].adIds, ['a1', 'a2']);
  assert.deepStrictEqual(open[0].materialIds, ['m1', 'm2']);

  const pausedTree = tree('rejected');
  pausedTree[0].status = 'paused';
  const pausedOpen = await ops.syncAdRejections(accountId + '_paused', 'adv1', pausedTree);
  assert.strictEqual(pausedOpen.length, 1, 'campanha pausada não esconde a reprovação do anúncio');

  const reserved = await ops.reserveAdAppeal(accountId, open[0].id, { auto: true });
  assert.strictEqual(reserved.appealStatus, 'submitting');
  assert.ok(reserved.appealText.length >= 100 && reserved.appealText.length <= 2000, 'justificativa automática é completa e cabe no limite');
  assert.strictEqual(await ops.reserveAdAppeal(accountId, open[0].id, { auto: true }), null, 'reserva atômica impede recurso duplicado');

  await ops.finishAdAppeal(accountId, open[0].id, { ok: true });
  assert.strictEqual((await ops.getAdRejection(accountId, open[0].id)).appealStatus, 'submitted');

  await ops.syncAdRejections(accountId, 'adv1', tree('active'));
  assert.strictEqual((await ops.getAdRejection(accountId, open[0].id)).status, 'resolved', 'incidente fecha quando a rejeição some do espelho');

  const routes = fs.readFileSync(path.join(__dirname, '..', 'ads-routes.js'), 'utf8');
  assert.match(routes, /app\.get\('\/api\/ads\/rejections'/, 'rota da caixa de entrada existe');
  assert.match(routes, /app\.post\('\/api\/ads\/rejections\/:rejectionId\/appeal'/, 'rota de recurso existe');
  assert.match(routes, /REGULAR_APPEAL_UNSUPPORTED/, 'campanha comum não finge suporte do conector');
  assert.match(routes, /app\.post\('\/api\/ads\/smart-plus\/ads\/:adId\/appeal'[\s\S]*?reserveAdAppeal/, 'rota Smart+ legada também usa a reserva central e não duplica recurso');

  console.log('ads-rejections.test.js: incidente, deduplicação, recurso e resolução OK');
})().catch((error) => { console.error(error); process.exit(1); });
