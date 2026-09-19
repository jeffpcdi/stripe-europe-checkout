'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')

function read(path) {
  return fs.readFileSync(path, 'utf8')
}

const nav = read('dashboard/lib/navigation.ts')
const view = read('dashboard/components/insights/insights-view.tsx')
const campaigns = read('dashboard/components/insights/campaigns-panel.tsx')
const diagnosis = read('dashboard/components/insights/diagnosis-panel.tsx')
const simulator = read('dashboard/components/insights/scenario-simulator.tsx')
const anomalies = read('dashboard/lib/insight-anomalies.ts')
const opportunities = read('dashboard/lib/insight-opportunities.ts')
const subnav = read('dashboard/components/shell/subnav.tsx')
const header = read('dashboard/components/shell/header.tsx')
const page = read('dashboard/app/(dashboard)/insights/page.tsx')
const layout = read('dashboard/app/(dashboard)/layout.tsx')

assert.match(nav, /id: 'insights'/)
assert.match(nav, /label: 'Insights'/)
assert.match(nav, /{ label: 'Visão', href: '\/insights' }/)
assert.match(nav, /\/insights\?tab=campaigns/)
assert.match(nav, /\/insights\?tab=funnel/)
assert.match(nav, /\/insights\?tab=diagnosis/)
assert.doesNotMatch(nav, /label: 'Oportunidades'/)
assert.doesNotMatch(nav, /label: 'Simulador'/)
assert.doesNotMatch(nav, /label: 'Anomalias'/)
assert.doesNotMatch(nav, /label: 'Qualidade'/)

assert.match(view, /type InsightTab = 'performance' \| 'campaigns' \| 'funnel' \| 'diagnosis'/)
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
assert.match(view, /<InsightsDiagnosisPanel/)

for (const label of ['Gasto', 'Receita', 'Compras', 'CPA', 'ROAS']) {
  assert.match(campaigns, new RegExp(label))
}
assert.match(campaigns, /formatMoney\(Math\.round\(row\.spend \* 100\), row\.spendCurrency\)/)

assert.match(diagnosis, /Tudo/)
assert.match(diagnosis, /Atenção/)
assert.match(diagnosis, /Oportunidades/)
assert.match(diagnosis, /Saúde dos dados/)
assert.match(diagnosis, /buildInsightAnomalies/)
assert.match(diagnosis, /buildInsightOpportunities/)

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
assert.match(subnav, /value === 'diagnosis' \|\| value === 'opportunities' \|\| value === 'anomalies' \|\| value === 'quality'/)
assert.match(header, /pathname\.startsWith\('\/insights'\)/)
assert.match(page, /<InsightsView \/>/)
assert.match(layout, /<Suspense fallback=\{null\}><SubNav \/><\/Suspense>/)

console.log('dashboard insights v16.24: ok')
