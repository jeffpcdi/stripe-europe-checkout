'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')

function read(path) {
  return fs.readFileSync(path, 'utf8')
}

const nav = read('dashboard/lib/navigation.ts')
const view = read('dashboard/components/insights/insights-view.tsx')
const campaigns = read('dashboard/components/insights/campaigns-panel.tsx')
const creatives = read('dashboard/components/insights/creative-insights-panel.tsx')
const diagnosis = read('dashboard/components/insights/diagnosis-panel.tsx')
const simulator = read('dashboard/components/insights/scenario-simulator.tsx')
const anomalies = read('dashboard/lib/insight-anomalies.ts')
const opportunities = read('dashboard/lib/insight-opportunities.ts')
const subnav = read('dashboard/components/shell/subnav.tsx')
const header = read('dashboard/components/shell/header.tsx')
const page = read('dashboard/app/(dashboard)/insights/page.tsx')
const layout = read('dashboard/app/(dashboard)/layout.tsx')
const api = read('dashboard/lib/api.ts')
const launcher = read('dashboard/components/ads/universal-launcher-dialog.tsx')
const tiktokView = read('dashboard/components/ads/tiktok-ads-view.tsx')
const routes = read('ads-routes.js')
const automation = read('ads-automation.js')
const adsAi = read('ads-ai.js')

assert.match(nav, /id: 'insights'/)
assert.match(nav, /label: 'Insights'/)
assert.match(nav, /{ label: 'Visão', href: '\/insights' }/)
assert.match(nav, /\/insights\?tab=campaigns/)
assert.match(nav, /\/insights\?tab=creatives/)
assert.match(nav, /\/insights\?tab=funnel/)
assert.match(nav, /\/insights\?tab=diagnosis/)
assert.doesNotMatch(nav, /label: 'Oportunidades'/)
assert.doesNotMatch(nav, /label: 'Simulador'/)
assert.doesNotMatch(nav, /label: 'Anomalias'/)
assert.doesNotMatch(nav, /label: 'Qualidade'/)

assert.match(view, /type InsightTab = 'performance' \| 'campaigns' \| 'creatives' \| 'funnel' \| 'diagnosis'/)
assert.match(view, /useAdsRoas/)
assert.match(view, /useAdsProfitability/)
assert.match(view, /useAdsTree/)
assert.match(view, /useAdsCampaignDecisions/)
assert.match(view, /label="Faturamento"/)
assert.match(view, /label="Investimento"/)
assert.match(view, /label="Lucro"/)
assert.match(view, /label="ROAS"/)
assert.match(view, /label="CPA"/)
assert.match(view, /TikTok atribuído/)
assert.match(view, /!roas\.currencyMismatch/)
assert.match(view, /Simular orçamento/)
assert.match(view, /<ScenarioSimulator/)
assert.match(view, /<InsightsCampaignsPanel/)
assert.match(view, /<CreativeInsightsPanel/)
assert.match(view, /todayAdsRange/)
assert.match(view, /pacingTree/)
assert.match(view, /previousAdsRange/)
assert.match(view, /<InsightsDiagnosisPanel/)
assert.match(view, /useAdsDestinationHealth/)
assert.match(view, /destinationHealth={destinationHealth}/)

for (const label of ['Gasto', 'Receita', 'Compras', 'CPA', 'ROAS']) {
  assert.match(campaigns, new RegExp(label))
}
assert.match(campaigns, /formatMoney\(Math\.round\(row\.spend \* 100\), row\.spendCurrency\)/)
assert.match(campaigns, /Ritmo hoje/)
assert.match(campaigns, /Exportar/)
assert.match(campaigns, /\/api\/ads\/reports\/export/)
assert.match(campaigns, /fromDate/)
assert.match(campaigns, /toDate/)
assert.match(campaigns, /dailyBudget/)
assert.match(campaigns, /pacingView/)
assert.match(campaigns, /Acima do ritmo/)
assert.match(campaigns, /Abaixo do ritmo/)
assert.match(campaigns, /Redistribuir/)
assert.match(campaigns, /Profit Allocator/)
assert.match(campaigns, /\/api\/ads\/budget\/proposal\/apply/)
assert.match(campaigns, /Aprendizado protegido/)

assert.match(creatives, /Possível desgaste/)
assert.match(creatives, /Ganhando eficiência/)
assert.match(creatives, /CTR/)
assert.match(creatives, /CPC/)
assert.match(creatives, /CPA/)
assert.match(creatives, /métricas do TikTok/)
assert.match(creatives, /volume mínimo/)
assert.match(creatives, /Creative DNA/)
assert.match(creatives, /Refresh assistido/)
assert.match(creatives, /Preparar refresh/)
assert.match(creatives, /roi:ads:creative-draft/)
assert.match(creatives, /tiktok:video:/)

assert.match(diagnosis, /Tudo/)
assert.match(diagnosis, /Atenção/)
assert.match(diagnosis, /Oportunidades/)
assert.match(diagnosis, /Saúde dos dados/)
assert.match(diagnosis, /buildInsightAnomalies/)
assert.match(diagnosis, /buildInsightOpportunities/)
assert.match(diagnosis, /Destinos dos anúncios/)
assert.match(diagnosis, /Destino do anúncio indisponível/)
assert.match(diagnosis, /Pixel sem sinal recente no destino/)
assert.doesNotMatch(diagnosis, /sourceConcentration/)

assert.match(anomalies, /buildInsightAnomalies/)
assert.match(anomalies, /\/insights\?tab=diagnosis/)
assert.match(opportunities, /buildInsightOpportunities/)
assert.match(opportunities, /\/insights\?tab=diagnosis/)
assert.doesNotMatch(opportunities, /campaign-growth/)

assert.match(simulator, /Simular orçamento/)
assert.match(simulator, /Variação de investimento/)
assert.match(simulator, /Variação de CPA/)
assert.match(simulator, /type="range"/)
assert.match(simulator, /não estima saturação do leilão/)

assert.match(subnav, /normalizeInsightsTab/)
assert.match(subnav, /value === 'campaigns' \|\| value === 'sources'/)
assert.match(subnav, /value === 'creatives'/)
assert.match(subnav, /value === 'diagnosis' \|\| value === 'opportunities' \|\| value === 'anomalies' \|\| value === 'quality'/)
assert.match(header, /pathname\.startsWith\('\/insights'\)/)
assert.match(page, /<InsightsView \/>/)
assert.match(layout, /<Suspense fallback=\{null\}><SubNav \/><\/Suspense>/)

assert.match(api, /useAdsDestinationHealth/)
assert.match(launcher, /Launch Guardian/)
assert.match(launcher, /guardianDraft/)
assert.match(launcher, /900/)
assert.match(launcher, /initialVideoId/)
assert.match(launcher, /initialLinkUrl/)
assert.match(tiktokView, /creativeDraft/)
assert.match(tiktokView, /initialVideoName=\{creativeDraft\?\.videoName\}/)

assert.match(automation, /Learning Guardian/)
assert.match(automation, /campaignLearningState/)
assert.match(adsAi, /TIKTOK_MIN_BUDGET/)
assert.match(adsAi, /maxBudgetChangePct/)

assert.match(routes, /\/api\/ads\/destinations\/health/)
assert.match(routes, /Destination Sentinel/)
assert.match(routes, /hostSeguro/)
assert.match(routes, /\/api\/ads\/budget\/proposal\/apply/)
assert.match(routes, /budget_allocator\.applied/)
assert.match(routes, /budget_allocator\.change/)
assert.match(routes, /guardian:/)
const destinationRoute = routes.slice(
  routes.indexOf("app.get('/api/ads/destinations/health'"),
  routes.indexOf("app.get('/api/ads/health'", routes.indexOf("app.get('/api/ads/destinations/health'")),
)
assert.match(destinationRoute, /adsCache\.readTree/)
assert.doesNotMatch(destinationRoute, /req\.body[^\n]*url/, 'Destination Sentinel não aceita URL arbitrária do navegador')

const rollbackRoute = routes.slice(
  routes.indexOf("app.post('/api/ads/ops/audit/:auditId/rollback'"),
  routes.indexOf("\n  //", routes.indexOf("app.post('/api/ads/ops/audit/:auditId/rollback'") + 20),
)
assert.doesNotMatch(rollbackRoute, /budget_allocator\.change/, 'audit do allocator nunca entra na rota de rollback')
assert.doesNotMatch(rollbackRoute, /\bprepared\b/, 'rollback não referencia estado local do allocator')

const allocatorRoute = routes.slice(
  routes.indexOf("app.post('/api/ads/budget/proposal/apply'"),
  routes.indexOf("app.get('/api/ads/alerts'", routes.indexOf("app.post('/api/ads/budget/proposal/apply'")),
)
assert.match(allocatorRoute, /budget_allocator\.change/)
assert.match(allocatorRoute, /reserveIdempotentOperation/)
assert.ok(
  allocatorRoute.indexOf('reserveIdempotentOperation') < allocatorRoute.indexOf('updateEntityBudget'),
  'allocator reserva a idempotência antes da primeira mutação externa',
)
assert.match(allocatorRoute, /BUDGET_ALLOCATOR_IN_PROGRESS/)

console.log('dashboard insights v16.24: ok')
