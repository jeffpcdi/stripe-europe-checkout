'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8')

const view = read('dashboard/components/overview/overview-view.tsx')
const metrics = read('dashboard/components/overview/overview-metrics.tsx')
const hero = read('dashboard/components/overview/hero-globe.tsx')
const feed = read('dashboard/components/overview/live-feed.tsx')
const css = read('dashboard/app/dashboard-refinement.css')

// KPI: valor dominante + contexto, sem chamar receita menos mídia de lucro completo.
assert.match(metrics, /observatory-metric-context/)
assert.match(metrics, /vs\. período anterior/)
assert.match(metrics, /CPA \$\{adsMoney\(cpa\)\}/)
assert.match(metrics, /Margem \$\{decimal\(profitability\.netMarginPct\)\}%/)
assert.doesNotMatch(metrics, /estimatedProfit/)
assert.match(metrics, /profitCents = profitability/)

// Presença ao vivo e refresh continuam disponíveis fora da barreira WebGL.
const liveIndex = hero.indexOf('className="observatory-globe-live"')
const boundaryIndex = hero.indexOf('<GlobeBoundary embedded>')
assert(liveIndex >= 0 && boundaryIndex >= 0 && liveIndex < boundaryIndex, 'status ao vivo deve ficar fora da barreira WebGL')
assert.match(hero, /aria-label="Atualizar indicadores"/)
assert.match(hero, /Promise\.resolve\(onRefresh\(\)\)/)
assert.match(hero, /mutate\(\)/)

// Atividade usa o timestamp real da etapa e o fuso configurado da conta.
assert.match(feed, /function activityAt\(lead: Lead\)/)
assert.match(feed, /lead\.convertedAt \|\| lead\.purchasedAt/)
assert.match(feed, /timeZone = 'America\/Sao_Paulo'/)
assert.match(feed, /toLocaleString\('pt-BR', \{ timeZone \}\)/)
assert.match(view, /<LiveFeed leads=\{data\?\.leads \?\? \[\]\} timeZone=\{accountTimeZone\} \/>/)

// Campanhas não transformam ausência em zero e preservam ROAS zero como dado real.
assert.match(view, /const spend = typeof c\.metrics\?\.spend === 'number'/)
assert.match(view, /c\.spend == null \? '—' : fmtAdsMoney/)
assert.match(view, /c\.roas !== null \? `\$\{c\.roas\.toFixed\(2\)/)
assert.match(view, /campaignDrilldownHref = showingTikTokCampaigns \? '\/ads\/tiktok' : '\/activity'/)

// Saúde de dados deixa de ser apenas percentual passivo.
assert.match(view, /overview-health-state/)
assert.match(view, /overviewHealth\.actions\?\.\[0\]/)
assert.match(view, /Saúde dos dados indisponível · tentar novamente/)
assert.match(css, /V16\.11 — Visão Geral/)
assert.match(css, /\.overview-health-state/)
assert.match(css, /\.overview-data-action/)

console.log('dashboard-overview-refinement-v16-11: OK')
