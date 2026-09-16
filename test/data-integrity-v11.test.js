'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const integrity = require('../reporting-integrity');
const profitEngine = require('../profit-engine');

const tz = 'America/Sao_Paulo';
const now = new Date('2026-09-15T04:00:00.000Z'); // 01:00 de 15/09 em São Paulo

// O mesmo calendário civil precisa produzir 1/7/30/365 dias inclusivos.
const expectedDays = { today: 1, '7d': 7, '30d': 30, all: 365 };
for (const [period, days] of Object.entries(expectedDays)) {
  const range = integrity.periodRange(period, now, tz);
  const from = Date.parse(range.fromDate + 'T12:00:00Z');
  const to = Date.parse(range.toDate + 'T12:00:00Z');
  assert.equal(Math.round((to - from) / 864e5) + 1, days, `${period} deve ter ${days} dias civis`);
}
assert.equal(integrity.periodRange('today', now, tz).toDate, '2026-09-15');

// Dados brutos de vendas: a venda 02:30Z ainda pertence a 14/09 em São Paulo.
const events = [
  { type: 'sale', at: '2026-09-15T03:30:00.000Z', amount: 10000, currency: 'BRL', gateway: 'stripe' }, // 15/09 00:30
  { type: 'sale', at: '2026-09-15T02:30:00.000Z', amount: 20000, currency: 'BRL', gateway: 'stripe' }, // 14/09 23:30
  { type: 'sale', at: '2026-09-09T15:00:00.000Z', amount: 30000, currency: 'BRL', gateway: 'stripe' },
  { type: 'sale', at: '2026-08-20T15:00:00.000Z', amount: 40000, currency: 'BRL', gateway: 'stripe' },
  { type: 'sale', at: '2025-08-01T15:00:00.000Z', amount: 90000, currency: 'BRL', gateway: 'stripe' }, // fora dos 365d
  { type: 'sale', at: '2026-09-15T03:40:00.000Z', amount: 2500, currency: 'USD', gateway: 'stripe' },
];

const today = integrity.periodRange('today', now, tz);
const seven = integrity.periodRange('7d', now, tz);
const thirty = integrity.periodRange('30d', now, tz);
const all = integrity.periodRange('all', now, tz);

let summary = integrity.summarizeRevenueEvents(events, { ...today, timeZone: tz });
assert.equal(summary.currency, 'BRL');
assert.equal(summary.revenueCents, 10000, 'Hoje não pode puxar venda do dia anterior por UTC');
assert.equal(summary.sales, 1);

summary = integrity.summarizeRevenueEvents(events, { ...seven, timeZone: tz });
assert.equal(summary.revenueCents, 60000, '7d deve somar exatamente os sete dias civis');
assert.equal(summary.sales, 3);

summary = integrity.summarizeRevenueEvents(events, { ...thirty, timeZone: tz });
assert.equal(summary.revenueCents, 100000, '30d deve incluir a venda de agosto dentro da janela');
assert.equal(summary.sales, 4);

summary = integrity.summarizeRevenueEvents(events, { ...all, timeZone: tz });
assert.equal(summary.revenueCents, 100000, 'Tudo é a janela comparável de 365d e exclui histórico mais antigo');
assert.equal(summary.sales, 4);

// ROAS usa somente receita atribuída ao TikTok, não faturamento orgânico.
const leads = [
  { stage: 'purchased', convertedAt: '2026-09-15T03:30:00.000Z', reportedAmount: 10000, reportedCurrency: 'BRL', ttclid: 'ttclid_paid_12345678901234567890', utm: { source: 'tiktok', campaign: '123456' } },
  { stage: 'purchased', convertedAt: '2026-09-15T03:35:00.000Z', reportedAmount: 30000, reportedCurrency: 'BRL', utm: { source: 'organic' } },
  { stage: 'purchased', convertedAt: '2026-09-15T03:45:00.000Z', reportedAmount: 5000, reportedCurrency: 'USD', ttclid: 'ttclid_paid_abcdefghij1234567890', utm: { source: 'tiktok' } },
];
const conversionLeads = [
  { stage: 'purchased', at: '2026-09-15T03:10:00.000Z', convertedAt: '2026-09-15T03:30:00.000Z' },
  { stage: 'visit', at: '2026-09-15T03:20:00.000Z' },
  // Compra hoje originada ontem: entra no faturamento do dia, mas não na coorte
  // de conversão de hoje.
  { stage: 'purchased', at: '2026-09-15T02:30:00.000Z', convertedAt: '2026-09-15T03:50:00.000Z' },
];
const conversion = integrity.summarizeConversion(conversionLeads, { ...today, timeZone: tz });
assert.deepEqual(conversion, { visits: 2, purchased: 1, conversionPct: 50 });

const attributed = integrity.summarizeAttributedLeads(leads, { ...today, timeZone: tz });
assert.equal(attributed.currency, 'BRL');
assert.equal(attributed.revenueCents, 10000, 'receita orgânica não entra no ROAS TikTok');
assert.equal(attributed.sales, 1);
let roas = integrity.deriveRoas({ spend: 50, spendCurrency: 'BRL', revenueCents: attributed.revenueCents, revenueCurrency: attributed.currency, sales: attributed.sales });
assert.equal(roas.roas, 2);
assert.equal(roas.cpa, 50);
assert.equal(roas.currencyMismatch, false);
roas = integrity.deriveRoas({ spend: 0, spendCurrency: 'BRL', revenueCents: 10000, revenueCurrency: 'BRL', sales: 1 });
assert.equal(roas.roas, 0, 'sem gasto confirmado ROAS é 0, não indisponível');
roas = integrity.deriveRoas({ spend: 50, spendCurrency: 'USD', revenueCents: 10000, revenueCurrency: 'BRL', sales: 1 });
assert.equal(roas.roas, null, 'moedas incompatíveis nunca podem gerar ROAS numérico');
assert.equal(roas.currencyMismatch, true);

// Lucro precisa usar a mesma janela/moeda da receita bruta.
const profitEvents = [
  { type: 'sale', at: '2026-09-15T03:30:00.000Z', amount: 10000, currency: 'BRL', gateway: 'stripe' },
  { type: 'refund', at: '2026-09-15T03:40:00.000Z', amount: 1000, currency: 'BRL', gateway: 'stripe' },
];
const profit = profitEngine.calculate(profitEvents, 20, {
  currency: 'BRL', fromDate: today.fromDate, toDate: today.toDate, timeZone: tz,
  config: { gatewayFeePct: 5, productCostPct: 10, taxPct: 0 }, adSpendExact: true,
});
assert.equal(profit.grossRevenueCents, 10000);
assert.equal(profit.refundCents, 1000);
assert.equal(profit.gatewayFeesCents, 500);
assert.equal(profit.productCostsCents, 1000);
assert.equal(profit.adSpendCents, 2000);
assert.equal(profit.netProfitCents, 5500);

// Guardas estruturais: frontend e backend compartilham a mesma janela/fuso.
const dashboard = path.join(__dirname, '..', 'dashboard');
const metricsSource = fs.readFileSync(path.join(dashboard, 'lib/metrics.ts'), 'utf8');
const overviewSource = fs.readFileSync(path.join(dashboard, 'components/overview/overview-view.tsx'), 'utf8');
const adsSource = fs.readFileSync(path.join(dashboard, 'components/ads/tiktok-ads-view.tsx'), 'utf8');
const routesSource = fs.readFileSync(path.join(__dirname, '..', 'ads-routes.js'), 'utf8');

assert.match(metricsSource, /period === '30d' \? 29 : 364/, 'Tudo deve usar 365 dias no agregado interno');
assert.match(overviewSource, /periodToAdsRange\(period, accountTimeZone\)/, 'Overview deve gerar mídia no fuso canônico da conta');
assert.match(adsSource, /adsDateRange\(rangeDays, advertiserTimeZone\)/, 'TikTok Ads deve usar o dia civil do advertiser');
assert.match(routesSource, /summarizeAttributedLeads/, 'ROAS deve derivar receita de jornadas TikTok atribuídas');
assert.match(routesSource, /summarizeRevenueEvents/, 'Lucro deve derivar moeda/receita dos eventos brutos da janela');
assert.match(routesSource, /spendTimeZone/, 'API deve expor o fuso original do gasto para auditoria');
assert.match(routesSource, /api\/ads\/data-integrity/, 'backend deve oferecer auditoria protegida dos cinco KPIs');
const statsSource = fs.readFileSync(path.join(__dirname, '..', 'stats.js'), 'utf8');
assert.match(statsSource, /lead\.purchasedAt = nowIso/, 'backend deve persistir alias temporal de compra para novos dados');
assert.match(statsSource, /lead\.convertedAt/, 'históricos antigos devem continuar usando convertedAt');

console.log('data-integrity-v11: calendário, fuso, moeda, atribuição, ROAS e lucro OK');
