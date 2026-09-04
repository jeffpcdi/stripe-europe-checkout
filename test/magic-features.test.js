'use strict';

const assert = require('node:assert');

delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;
process.env.INTEGRATION_TOKEN_KEY = 'teste-local-com-mais-de-vinte-e-quatro-caracteres';

const predictor = require('../ab-predictor');
const profit = require('../profit-engine');
const automation = require('../ads-automation');
const adsAi = require('../ads-ai');
const feed = require('../ads-catalog-feed');
const botRisk = require('../bot-risk-store');
const cloudVideo = require('../cloud-video-sync');

async function main() {
  const experiment = predictor.evaluate([
    { id: 'a', nome: 'A', clicks: 500, conversions: 75, peso: 50 },
    { id: 'b', nome: 'B', clicks: 500, conversions: 25, peso: 50 },
  ], { minVisitors: 200, minConversions: 10, confidence: 0.95, minLiftPct: 5 });
  assert.strictEqual(experiment.ready, true, 'teste A/B encontra vencedora com volume e confiança');
  assert.strictEqual(experiment.winnerId, 'a');
  assert.ok(experiment.confidence >= 0.95);

  const result = profit.calculate([
    { type: 'sale', at: '2026-09-04T12:00:00Z', amount: 10000, currency: 'BRL', feeCents: 500, taxCents: 1000, productCostCents: 2000 },
    { type: 'refund', at: '2026-09-04T15:00:00Z', amount: 1000, currency: 'BRL' },
  ], 20, { currency: 'BRL', fromDate: '2026-09-04', toDate: '2026-09-04', timeZone: 'America/Sao_Paulo', adSpendExact: true });
  assert.strictEqual(result.netProfitCents, 3500, 'lucro desconta estorno, taxa, imposto, produto e mídia');
  assert.strictEqual(result.quality, 'exact');

  const rule = automation.validateRules([{
    id: 'heal', enabled: true, metric: 'self_heal', threshold: 2, lookbackDays: 1,
    minSales: 2, minSpend: 20, donorRoasMax: 0.8, budgetUtilizationPct: 85,
    pct: 20, budgetCap: 500, mode: 'execute',
  }])[0];
  const campaigns = [
    { platformCampaignId: 'winner', campaignName: 'Vencedora', status: 'active', campaignKind: 'auction', currency: 'BRL', budgetOwner: 'campaign', budget: { amount: 100, type: 'daily' }, metrics: { spend: 90 } },
    { platformCampaignId: 'donor', campaignName: 'Doadora', status: 'active', campaignKind: 'auction', currency: 'BRL', budgetOwner: 'campaign', budget: { amount: 100, type: 'daily' }, metrics: { spend: 50 } },
  ];
  const plan = automation._internals.planSelfHealing(campaigns, { byCampaign: {
    winner: { revenueCents: 27000, sales: 3 }, donor: { revenueCents: 0, sales: 0 },
  } }, rule, 50);
  assert.ok(plan, 'autocura encontra vencedora e doadora compatíveis');
  assert.strictEqual(plan.transfer, 20);
  assert.strictEqual(plan.changes.reduce((sum, row) => sum + row.amount - row.cur, 0), 0, 'transferência preserva o orçamento total');
  assert.strictEqual(plan.changes[0].role, 'donor', 'plano registra a redução antes do aumento');

  const findings = adsAi._internal.compareIntradaySnapshots({
    ad1: { impressions: 1000, clicks: 100, spend: 10, conversions: 2 },
  }, {
    ad1: { adId: 'ad1', name: 'Criativo A', impressions: 2000, clicks: 120, spend: 35, conversions: 2 },
  });
  assert.ok(findings.some((row) => row.type === 'ctr_drop' && row.dropPct === 80), 'detector encontra queda intradiária de CTR');
  assert.ok(findings.some((row) => row.type === 'spend_without_conversion'), 'detector encontra gasto sem conversão');

  const xml = feed.buildCatalogXml([{ data: {
    sku_id: 'sku&1', title: 'Camiseta <Azul>', description: 'Teste', availability: 'in stock',
    condition: 'new', price: '99.90 BRL', link: 'https://loja.test/p?x=1&y=2', image_link: 'https://loja.test/a.jpg', brand: 'Marca',
  } }], { name: 'Loja & Cia' });
  assert.match(xml, /<g:id>sku&amp;1<\/g:id>/);
  assert.match(xml, /Camiseta &lt;Azul&gt;/);
  assert.match(xml, /Loja &amp; Cia/);

  const accountId = 'acc_magic';
  let block;
  for (let i = 0; i < 3; i += 1) block = await botRisk.recordHighRisk({ accountId, ip: '203.0.113.10', adKey: 'ad-42', score: 95, threshold: 3, windowMin: 30, ttlHours: 1 });
  assert.strictEqual(block.blocked, true, 'IP com risco recorrente é bloqueado');
  assert.strictEqual((await botRisk.isBlocked(accountId, '203.0.113.10')).blocked, true);
  assert.ok(!(await botRisk.listBlocks(accountId, 10))[0].ip, 'histórico não expõe IP bruto');

  const secret = { access_token: 'segredo', refresh_token: 'renovação' };
  assert.deepStrictEqual(cloudVideo._internals.decrypt(cloudVideo._internals.encrypt(secret)), secret, 'OAuth fica cifrado em repouso');

  console.log('magic-features.test.js OK — lucro, A/B, autocura, anomalia, XML, anti-bot e OAuth validados');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
