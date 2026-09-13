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
let spendCard = metricCard(html, 'Investimento em anúncios');
assert(spendCard.includes('US$') && spendCard.includes('125,00'), 'gasto vem do spend na moeda da conta');
assert(!spendCard.includes('775,00'), 'não exibe receita menos anúncios');
assert(!spendCard.includes('margem'));
assert(!metricCard(html, 'Retorno \\(ROAS\\)').includes('0,00×'), 'retorno ausente não vira zero');
for (const ads of [undefined, { ...overviewProps.ads, scope: undefined }, { ...overviewProps.ads, spend: NaN }]) {
  spendCard = metricCard(renderToStaticMarkup(React.createElement(OverviewMetrics, { ...overviewProps, ads })), 'Investimento em anúncios');
  assert(spendCard.includes('Dados indisponíveis') && !spendCard.includes('125,00'), 'total ausente/inválido não usa fallback');
}
html = renderToStaticMarkup(React.createElement(OverviewMetrics, { ...overviewProps, ads: { ...overviewProps.ads, spend: 0 } }));
assert(metricCard(html, 'Investimento em anúncios').includes('0,00'), 'zero confirmado permanece visível');
html = renderToStaticMarkup(React.createElement(OverviewMetrics, { ...overviewProps, adsError: true, visits: 0, purchased: 0 }));
assert(metricCard(html, 'Investimento em anúncios').includes('Atualização pendente'));
assert(!metricCard(html, 'Conversão geral').includes('0,0%'), 'sem visitas não inventa taxa');
console.log('overview-metrics: gasto real, moeda, zero, ausência e retorno indefinido OK');

// A composição não retorna os antigos cards e não duplica os indicadores no globo.
html = renderToStaticMarkup(React.createElement(OverviewMetrics, { ...overviewProps, globe: React.createElement('div', { id: 'canvas-unico' }) }));
assert.equal((html.match(/<article/g) || []).length, 4);
assert(!html.includes('surface-card') && !html.includes('overview-summary-kpis'));
assert.equal((html.match(/id="canvas-unico"/g) || []).length, 1);
assert.equal((html.match(/<details/g) || []).length, 4, 'explicações só aparecem sob demanda');
const { RevenueTrend } = load('components/overview/revenue-trend.tsx');
for (const series of [[], [{ day: '2026-09-12', revenue: 90000, sales: 3, visits: 20 }]]) {
  const trend = renderToStaticMarkup(React.createElement(RevenueTrend, { series, currency: 'BRL', compact: true }));
  assert(!trend.includes('<svg') && !trend.includes('900,00'), 'sem curva inventada ou valor duplicado com menos de dois dias');
}
const { GlobeBoundary } = load('components/geo/globe-boundary.tsx');
const boundary = new GlobeBoundary({ embedded: true, children: null });
boundary.state = { failed: true };
html = renderToStaticMarkup(boundary.render());
assert(html.includes('observatory-globe-fallback') && html.includes('Tentar novamente'));
const retry = boundary.render().props.children.props.children.find(child => child.type === 'button');
boundary.setState = state => { boundary.state = state; };
retry.props.onClick();
assert.equal(boundary.state.failed, false);
console.log('observatório: quatro métricas sem cards, curva real e recuperação isolada do WebGL OK');

const { SetupGuide } = load('components/overview/setup-guide.tsx');
const { buildOverviewHealth } = require('../overview-health');
assert.equal(renderToStaticMarkup(React.createElement(SetupGuide)), '', 'não inventa pendências durante o carregamento');
const emptyAccountHealth = buildOverviewHealth({});
html = renderToStaticMarkup(React.createElement(SetupGuide, { health: emptyAccountHealth }));
assert(html.includes('Crie um link rastreado'));
assert(html.includes('Configuração · 0/3'));
assert(html.includes('<details') && !html.includes('<details open'), 'detalhes da configuração ficam recolhidos');
assert(html.includes('Cadastros não confirmam a entrega'), 'não promete integração com base no cadastro');
const configuredHealth = buildOverviewHealth({ links: [{}], pixels: [{ pixelCode: 'PX', accessToken: 'token' }], gateways: [{}] });
assert.equal(renderToStaticMarkup(React.createElement(SetupGuide, { health: configuredHealth })), '', 'conta pronta não vê onboarding repetido');
html = renderToStaticMarkup(React.createElement(SetupGuide, { health: { ...emptyAccountHealth, guide: undefined } }));
assert(html.includes('Crie um link rastreado'), 'compatível com backend anterior sem guide');
console.log('setup-guide: próximo passo real, detalhes recolhidos e compatibilidade OK');

const { presenceIncreases } = load('lib/live-globe.ts');
assert.equal(presenceIncreases(null, [{ code: 'BR', count: 3 }]).length, 0, 'carregamento inicial não simula entrada');
assert.equal(presenceIncreases([{ code: 'BR', count: 3 }], [{ code: 'BR', count: 3 }]).length, 0, 'poll sem mudança não repete pulso');
assert.equal(presenceIncreases([{ code: 'BR', count: 3 }], [{ code: 'BR', count: 2 }]).length, 0, 'saída não gera pulso');
assert.equal(presenceIncreases([{ code: 'BR', count: 3 }], [{ code: 'BR', count: 4 }, { code: 'PT', count: 1 }]).join(','), 'BR,PT');
const { FunnelGauge } = load('components/overview/funnel-gauge.tsx');
html = renderToStaticMarkup(React.createElement(FunnelGauge, { visits: 55, checkout: 0, payment: 0, purchased: 0 }));
assert(html.includes('width:100%'));
assert.equal((html.match(/width:0%/g) || []).length, 3, 'zero não inventa preenchimento de barra');
html = renderToStaticMarkup(React.createElement(FunnelGauge, { visits: 0, checkout: 0, payment: 0, purchased: 0 }));
assert(!html.includes('0,0%'), 'sem base não calcula taxa fictícia');
const { LiveFeed } = load('components/overview/live-feed.tsx');
html = renderToStaticMarkup(React.createElement(LiveFeed, { leads: [{ id: 'jp', country: 'JP', stage: 'visit', at: new Date(now).toISOString() }, { id: 'invalid', country: 'BR', stage: 'visit', at: 'invalid' }] }));
assert(html.includes('Japão'), 'nome do país traduzido, sem código cru');
assert(html.includes('Visitou a página'));
assert(!html.includes('Brasil'), 'data inválida não entra no histórico');
assert(!html.includes('online'), 'histórico não indica presença atual');
console.log('overview-presence: pulsos só com aumento, funil sem taxa fictícia e países traduzidos OK');

const { campaignMetrics, campaignBudget, campaignStatusOutcome } = load('lib/campaign-metrics.ts');
let performance = campaignMetrics({ spend: 120, clicks: 60, impressions: 12000, conversions: 6, cpa: 999 });
assert.equal(performance.cpa, 20);
assert.equal(performance.cpc, 2);
assert.equal(performance.cpm, 10);
assert.equal(performance.ctr, 0.5);
assert.equal(campaignMetrics({ spend: 120, clicks: 0, conversions: 0 }).cpa, null);
assert.equal(campaignMetrics({ spend: 0, clicks: 5 }).cpc, 0);
assert.equal(campaignMetrics().spend, null);
assert.equal(campaignBudget({ budgetOwner: 'campaign', budget: { amount: 300, type: 'lifetime' }, adSets: [{ budget: { amount: 40, type: 'daily' } }] }).amount, 300);
const abo = { budgetOwner: 'adgroup', budget: { amount: 999, type: 'daily' }, adSetCount: 2, adSets: [{ budget: { amount: 50, type: 'daily' } }, { budget: { amount: 70, type: 'daily' } }] };
assert.equal(campaignBudget(abo).amount, 120, 'ABO não soma orçamento legado da campanha');
assert.equal(campaignBudget({ ...abo, adSetCount: 3 }).amount, null, 'conjuntos incompletos não mostram total parcial');
assert.equal(campaignBudget({ ...abo, adSets: [abo.adSets[0], { budget: { amount: 70, type: 'lifetime' } }] }).amount, null);
assert.equal(campaignStatusOutcome({ dryRun: true, totals: { updated: 0, skipped: 1, failed: 0 } }, 1), 'simulated');
assert.equal(campaignStatusOutcome({ totals: { updated: 0, skipped: 1, failed: 0 } }, 1), 'failed');
assert.equal(campaignStatusOutcome({ totals: { updated: 1, skipped: 1, failed: 0 } }, 2), 'partial');
assert.equal(campaignStatusOutcome({ totals: { updated: 1, skipped: 0, failed: 0 } }, 1), 'accepted');
const { CampaignMetricGrid } = load('components/ads/campaign-metric-grid.tsx');
html = renderToStaticMarkup(React.createElement(CampaignMetricGrid, { campaign: { ...abo, metrics: { spend: 120, clicks: 60, impressions: 12000, conversions: 6 } }, currency: 'USD' }));
assert(html.includes('US$') && html.includes('CPA') && html.includes('CPM') && html.includes('CPC'));
assert(html.includes('soma dos conjuntos'));
console.log('campaign-metrics: custos, orçamento CBO/ABO e respostas de status OK');

// A comparação mantém dias civis e o período selecionado, sem deslocamento por DST.
const { adsDateRange, previousAdsRange, shiftAdsDay } = load('lib/ads-time.ts');
const current = adsDateRange(7, 'America/New_York', new Date('2026-03-09T02:30:00Z'));
assert.equal(current.fromDate, '2026-03-02');
assert.equal(current.toDate, '2026-03-08');
const previous = previousAdsRange(current);
assert.equal(previous.fromDate, '2026-02-23');
assert.equal(previous.toDate, '2026-03-01');
assert.equal(previousAdsRange({fromDate:'2026-01-01',toDate:'2026-01-01'}).fromDate, '2025-12-31');
assert.equal(shiftAdsDay('2026-03-08', -7), '2026-03-01');

const { catalogDisplayPrice } = load('lib/catalog-display.ts');
assert.equal(catalogDisplayPrice('79.90 BRL', 'BRL').replace(/\s/g, ' '), 'R$ 79,90');
assert(catalogDisplayPrice('10.00 EUR', 'BRL').includes('€'), 'moeda do feed não é trocada');
assert.equal(catalogDisplayPrice(undefined, 'BRL'), '—');

const { conversionStatus, conversionAmount } = load('lib/conversion-status.ts');
for (const row of [{ status: 'recebido' }, { status: 'teste ok' }, { status: 'ok' }, { status: 'dedup' }, { status: 'ok (sem CAPI)' }]) assert.notEqual(conversionStatus(row).kind, 'success');
assert.equal(conversionStatus({ status: 'ok', capi: [{ ok: true }] }).kind, 'success');
assert.equal(conversionStatus({ capi: [{ ok: true }, { ok: false }] }).label, 'Envio parcial');
assert.equal(conversionStatus({ status: 'sem pixel' }).kind, 'error');
assert(conversionAmount({ amount: 12345, currency: 'BRL' }).includes('123,45'));
assert(conversionAmount({ amount: 12345, currency: 'USD' }).includes('US$'));
assert.equal(conversionAmount({ amount: 100 }), 'Moeda não informada');
console.log('conversões: estados confirmados, simulação, parcial e moeda/centavos OK');

const { campaignMatchesStatus, campaignStatusCounts } = load('lib/campaign-list.ts');
const statusRows = [{ status: 'active', reviewStatus: 'approved' }, { status: 'paused', reviewStatus: 'approved' }, { status: 'error' }, { status: 'rejected' }];
const counts = campaignStatusCounts(statusRows);
assert.equal(counts.all, 4);
assert.equal(counts.approved, 2);
assert.equal(counts.rejected, 1);
assert.equal(statusRows.filter(c => campaignMatchesStatus(c, 'active')).length, 1);
assert.equal(statusRows.filter(c => campaignMatchesStatus(c, 'approved')).length, 2);
const { catalogProductCount } = load('lib/catalog-display.ts');
assert.equal(catalogProductCount({ productCount: 20, audit: { total: 0 } }).count, 0);
assert.equal(catalogProductCount({ productCount: 20, audit: { total: 0 } }).source, 'TikTok');
assert.equal(catalogProductCount({ productCount: 20 }).source, 'local');
assert.equal(catalogProductCount({ productCount: 20, audit: { total: 4 } }).count, 4);
console.log('listas: filtros completos, aprovação independente e zero remoto preservado OK');
