'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('../dashboard/node_modules/typescript');
const React = require('../dashboard/node_modules/react');
const { renderToStaticMarkup } = require('../dashboard/node_modules/react-dom/server');
const root = path.join(__dirname, '../dashboard');
const responses = {};
const simple = ({ children, ...props }) => React.createElement('div', props, children);
function load(relative) {
  const filename = path.join(root, relative);
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, { module, exports: module.exports, Intl, Date, console, require(name) {
    if (name === '@/lib/api') return { useDomains: () => responses.domains || {}, useAdsKpis: () => responses.kpis || {}, useAdsRoas: () => responses.roas || {} };
    if (name === '@/lib/toast') return { toast: {} };
    if (name === '@/components/glass-card') return { GlassCard: simple };
    if (name === '@/components/switch') return { Switch: () => null };
    if (name === '@/components/confirm-dialog') return { ConfirmDialog: () => null };
    if (name === '@/components/skeleton') return { Skeleton: simple };
    if (name === 'next/link') return { __esModule: true, default: ({ children }) => React.createElement('a', null, children) };
    if (name === 'lucide-react') return new Proxy({}, { get: () => () => null });
    if (name.startsWith('@/')) {
      const base = name.slice(2);
      return load(fs.existsSync(path.join(root, base + '.tsx')) ? base + '.tsx' : base + '.ts');
    }
    if (name.startsWith('.')) return load(path.relative(root, path.resolve(path.dirname(filename), name + '.ts')));
    return require(path.join(root, 'node_modules', name));
  } }, { filename });
  return module.exports;
}
const { liveGlobeData } = load('lib/live-globe.ts');
const now = Date.now();
const live = { ts: new Date(now).toISOString(), summary: { online: 5, countries: [{ code: 'br', name: 'Brasil', count: 3 }, { code: 'BR', name: 'Brasil', count: 2 }, { code: 'US', count: 0 }, { code: 'FR', count: -1 }] }, visitors: [] };
assert.equal(liveGlobeData(live, now).countries.length, 1);
assert.equal(liveGlobeData(live, now).countries[0].count, 5);
assert.equal(liveGlobeData(live, now).countries[0].purchased, 0);
for (const data of [undefined, { ...live, ts: 'invalid' }, { ...live, ts: new Date(now - 21_000).toISOString() }, { ...live, ts: new Date(now + 60_000).toISOString() }]) {
  assert.equal(liveGlobeData(data, now).online, null);
  assert.equal(liveGlobeData(data, now).countries.length, 0);
}
assert.equal(liveGlobeData(live, now, true).countries.length, 0, 'falha não mantém pontos antigos ao vivo');
assert.equal(liveGlobeData({ ...live, summary: { online: 0, countries: [] } }, now).online, 0, 'zero confirmado é distinto de indisponível');
const { KpiRow } = load('components/ads/kpi-row.tsx');
const props = { kpi: { spend: 9999 }, currency: 'BRL', active: true, adAccountId: 'adv', fromDate: '2026-09-07', toDate: '2026-09-07' };
let html = renderToStaticMarkup(React.createElement(KpiRow, props));
assert(!html.includes('9.999'), 'não usa subtotal como total');
assert(!html.includes('R$'), 'dados ausentes não viram zero monetário');
responses.kpis = { data: { scope: 'advertiser_all_campaigns', currency: 'BRL', current: { spend: 100, clicks: 50, impressions: 2000, ctr: 2.5, cpm: 50 } } };
responses.roas = { data: { revenueCents: 30000, revenueCurrency: 'EUR', currency: 'BRL', sales: 3, roas: null, cpa: 33.33, currencyMismatch: true } };
html = renderToStaticMarkup(React.createElement(KpiRow, props));
assert(html.includes('€'), 'receita mantém moeda real');
assert(html.includes('100,00'), 'primeiro valor renderiza sem animação desde zero');
assert(!html.includes('Lucro'), 'ROAS não é lucro');
responses.kpis.error = Error('rede');
assert(renderToStaticMarkup(React.createElement(KpiRow, props)).includes('Dados não atualizados'));
const { buildPilotRules } = load('lib/pilots.ts');
const { PilotsPanel } = load('components/ads/pilots-panel.tsx');
const rules = buildPilotRules('protector', 'conservador');
rules[0].threshold = 47;
rules[2].pct = 13;
html = renderToStaticMarkup(React.createElement(PilotsPanel, { currency: 'BRL', rules, autonomy: 'propose', saving: false, onSetPilot() {}, onSetAutonomy() {} }));
assert(html.includes('47,00'), 'mostra limite personalizado salvo');
assert(html.includes('em 13%'), 'mostra redução real, não 20% fixos');
assert(html.includes('Regras personalizadas'));
assert(!html.includes('100% Autônomo'));
assert(!html.includes('Pausa imediata'));
console.log('dashboard-ui-integrity: presença fresca, moedas, dados indisponíveis e regras reais OK');

const { EmqGauge } = load('components/overview/emq-gauge.tsx');
html = renderToStaticMarkup(React.createElement(EmqGauge, { score: null }));
assert(html.includes('Sem dados recentes'));
assert(!html.includes('8.5'));
assert(!html.includes('Excelente'));

const { DomainsView } = load('components/domains/domains-view.tsx');
responses.domains = { data: { domains: [{ host: 'link.example.test', verificado: false, status: 'pending_dns', dns: { cname: { name: 'link', target: 'target.example.test' } } }] } };
html = renderToStaticMarkup(React.createElement(DomainsView));
assert(html.includes('Aguardando conexão'));
assert(html.includes('target.example.test'));
assert(!html.includes('Pronto para usar'));
assert(html.includes('Verificar'));

// O título de gasto deve corresponder ao investimento, inclusive com receita em outra moeda.
const { OverviewMetrics } = load('components/overview/overview-metrics.tsx');
const overviewProps = { revenueCents: 90000, currency: 'BRL', sales: 3, visits: 20, purchased: 3, approval: 50, otherCurrencies: 0, previousRevenueCents: null, ads: { scope: 'advertiser_all_campaigns', currency: 'USD', spend: 125, revenueCents: 90000, roas: null, cpa: null, currencyMismatch: true } };
function metricCard(markup, name) { return markup.match(new RegExp('<article[^>]*aria-label="' + name + '"[^>]*>([\\s\\S]*?)</article>'))[1]; }
html = renderToStaticMarkup(React.createElement(OverviewMetrics, overviewProps));
let spendCard = metricCard(html, 'Gasto em ADS');
assert(spendCard.includes('US$') && spendCard.includes('125,00'), 'gasto vem do spend na moeda da conta');
assert(!spendCard.includes('775,00'), 'não exibe receita menos anúncios');
assert(!spendCard.includes('margem'));
assert(!metricCard(html, 'Retorno \\(ROAS\\)').includes('0,00×'), 'retorno ausente não vira zero');
for (const ads of [undefined, { ...overviewProps.ads, scope: undefined }, { ...overviewProps.ads, spend: NaN }]) {
  spendCard = metricCard(renderToStaticMarkup(React.createElement(OverviewMetrics, { ...overviewProps, ads })), 'Gasto em ADS');
  assert(spendCard.includes('Dados indisponíveis') && !spendCard.includes('125,00'), 'total ausente/inválido não usa fallback');
}
html = renderToStaticMarkup(React.createElement(OverviewMetrics, { ...overviewProps, ads: { ...overviewProps.ads, spend: 0 } }));
assert(metricCard(html, 'Gasto em ADS').includes('0,00'), 'zero confirmado permanece visível');
html = renderToStaticMarkup(React.createElement(OverviewMetrics, { ...overviewProps, adsError: true, visits: 0, purchased: 0 }));
assert(metricCard(html, 'Gasto em ADS').includes('Atualização pendente'));
assert(!metricCard(html, 'Conversão geral').includes('0,0%'), 'sem visitas não inventa taxa');
console.log('overview-metrics: gasto real, moeda, zero, ausência e retorno indefinido OK');
