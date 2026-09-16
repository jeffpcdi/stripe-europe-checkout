'use strict';

// Critérios de aceite, não snapshots que consagram os defeitos. No main
// auditado, os testes negativos devem FALHAR até cada causa ser corrigida.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { laboratory, invoke, isolatedStats, fixture } = require('../scripts/audit-overview-local');
const reporting = require('../reporting-integrity');
const today = reporting.dayAt(new Date(), 'America/Sao_Paulo');
const query = { adAccountId: 'a', fromDate: today, toDate: today };

test('base: lucro aplica tarifas e impostos; estatísticas isolam a conta ROI-NADOS', async () => {
  const lab = laboratory();
  const profit = await invoke(lab, '/api/ads/profitability', query);
  assert.equal(profit.status, 200);
  assert.equal(profit.body.netProfitCents, 20500);
  const seed = fixture();
  seed.leads.push({ ...seed.leads[0], id: 'outra-conta', acc: 'outra' });
  assert.equal(isolatedStats(seed).getStats('audit').funnel.visits, 10);
});

test('ROAS deve atribuir somente vendas das campanhas do advertiser selecionado', async () => {
  const result = await invoke(laboratory(), '/api/ads/roas', query);
  assert.equal(result.body.revenueCents, 10000, 'Conta A vendeu R$100; os R$200 da conta B não pertencem a A');
  assert.equal(result.body.roas, 2);
});

test('primeira sincronização malsucedida não pode confirmar gasto/ROAS zero', async () => {
  const result = await invoke(laboratory('cold'), '/api/ads/roas', query);
  assert.ok(result.status >= 400 || result.body.spend == null,
    'Recebido HTTP ' + result.status + ', spend=' + result.body.spend + ', roas=' + result.body.roas + ', lastSyncedAt=' + result.body.lastSyncedAt);
});

test('lucro com sincronização em erro não deve declarar mídia exata', async () => {
  const result = await invoke(laboratory('stale'), '/api/ads/profitability', query);
  assert.notEqual(result.body.coverage?.adSpendExact, true);
});

test('ROAS deve expor lastSyncedAt depois de concluir a sincronização fria', async () => {
  const lab = laboratory('cold');
  const freshAt = new Date().toISOString();
  lab.context.adsSync.ensureFresh = async () => {
    lab.context.adsCache.getSyncState = async () => ({ status: 'idle', last_synced_at: freshAt });
  };
  const result = await invoke(lab, '/api/ads/roas', query);
  assert.equal(result.body.lastSyncedAt, freshAt);
});

test('funil e receita atribuída devem incluir o lead 3501 convertido no período', () => {
  const snapshot = laboratory('large').stats.getStats('audit');
  assert.equal(snapshot.funnel.visits, 3501);
  assert.equal(snapshot.leads.length, snapshot.funnel.visits,
    'A UI recalcula o funil com leads, mas o endpoint corta em 3000 sem indicar incompletude');
});

test('ROAS de fusos distintos deve ficar indisponível ou indicar incomparabilidade', async () => {
  const result = await invoke(laboratory('timezone'), '/api/ads/roas', query);
  assert.notEqual(result.body.timeZone, result.body.spendTimeZone);
  assert.ok(result.body.roas == null || result.body.timeZoneMismatch === true,
    'Dias civis diferentes retornaram ROAS numérico sem sinalizar comparação inválida');
});

test('presença deve isolar o mesmo visitorId em duas contas', async () => {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../presence.js'), 'utf8'), {
    module, Date, URL, require: name => name === './db' ? { upsertSession() {} } : { enabled: false, touchPresence() {}, leavePresence() {} },
  });
  const presence = module.exports;
  presence.touch({ visitorId: 'mesmo-id', acc: 'a', country: 'BR', page: '/a' });
  presence.touch({ visitorId: 'mesmo-id', acc: 'b', country: 'PT', page: '/b' });
  assert.equal((await presence.list('a'))[0].page, '/a');
  assert.equal((await presence.list('b')).length, 1);
});

test('Lucro não deve substituir falha de mídia/custos pelo faturamento integral', () => {
  const dashboard = process.env.OVERVIEW_AUDIT_DASHBOARD || path.join(__dirname, '../dashboard');
  const ts = require(path.join(dashboard, 'node_modules/typescript'));
  const React = require(path.join(dashboard, 'node_modules/react'));
  const { renderToStaticMarkup } = require(path.join(dashboard, 'node_modules/react-dom/server'));
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, '../dashboard/components/overview/overview-metrics.tsx'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require: name => name === '@/components/count-up'
      ? { CountUp: ({ value, format }) => format(value) }
      : require(path.join(dashboard, 'node_modules', name)),
  });
  const html = renderToStaticMarkup(React.createElement(module.exports.OverviewMetrics, {
    revenueCents: 30000, currency: 'BRL', visits: 10, purchased: 2, adsError: true,
  }));
  const profitArticle = html.match(/<article[^>]*aria-label="Lucro"[^]*?<\/article>/)?.[0];
  assert.ok(profitArticle, 'O indicador Lucro precisa existir');
  assert.match(profitArticle, /observatory-metric-value[^>]*>—<\/div>/);
});
