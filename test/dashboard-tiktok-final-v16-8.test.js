'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

const rejection = read('dashboard/components/ads/rejection-inbox.tsx')
const quick = read('dashboard/components/ads/catalog-quick-campaigns-dialog.tsx')
const view = read('dashboard/components/ads/tiktok-ads-view.tsx')
const detail = read('dashboard/components/ads/catalog-detail.tsx')
const magic = read('dashboard/components/ads/magic-ops-panel.tsx')
const ops = read('dashboard/components/ads/ops-dialog.tsx')
const routes = read('ads-routes.js')
const overviewApi = read('dashboard/lib/api.ts')

// Dois erros TypeScript concretos da V16.7.
assert.match(rejection, /import type \{ AdsAdRejection \} from '@\/lib\/types'/)
assert.doesNotMatch(rejection, /AdsRejectionItem/)
const createStart = quick.indexOf('async function create()')
const createEnd = quick.indexOf('\n  async function uploadItems', createStart)
const createBody = quick.slice(createStart, createEnd)
assert.ok(createStart >= 0 && createEnd > createStart)
assert.doesNotMatch(createBody, /return toast\.error\(/)
assert.match(quick, /onConfirm=\{create\}/)
assert.doesNotMatch(quick, /onConfirm=\{\(\) => .*create/)

// Tour/popstate usam estado atual; V16.9 preserva a pilha real com índices e history.go.
assert.match(view, /requestTabChangeRef\.current\(value, 'tour'\)/)
assert.match(view, /const handlePopState = \(event: PopStateEvent\) =>/)
assert.match(view, /roiAdsHistoryIndex/)
assert.match(view, /window\.history\.go\(-delta\)/)
assert.match(view, /allowNextPopRef\.current = true/)

// Saídas do detalhe não destroem trabalho local silenciosamente.
assert.match(detail, /function requestBack\(\)/)
assert.match(detail, /setConfirmBack\(true\)/)
assert.match(detail, /Voltar e cancelar o envio\?/)
assert.match(detail, /Voltar e descartar os envios pendentes\?/)
assert.match(detail, /disabled=\{cloning \|\| !catalog \|\| hasCreativeLocalWork\}/)
assert.match(detail, /disabled=\{localUploading\}/)
assert.match(detail, /envios locais pendentes e as tentativas disponíveis também serão descartados/)

// Ações globais de catálogo também passam por confirmação quando desmontariam o detalhe.
assert.match(view, /if \(tab === 'catalog' && hasCatalogLocalWork\)/)
assert.match(view, /setPendingCatalogAction\(action\)/)
assert.match(view, /Abrir criação e cancelar o envio atual\?/)
assert.match(view, /Abrir criação e descartar os envios pendentes\?/)

// Copy diferencia upload ativo de erro/retry pendente.
assert.match(view, /Há envios locais pendentes ou com falha/)
assert.match(view, /opções locais de tentar novamente/)

// Resultado após custos usa calendário explícito do advertiser; Overview mantém default.
assert.match(magic, /calendar: 'advertiser'/)
assert.match(magic, /Período no fuso da conta TikTok/)
const profitabilityStart = routes.indexOf("app.get('/api/ads/profitability'")
const profitabilityEnd = routes.indexOf('// V11 — auditoria', profitabilityStart)
const profitabilityRoute = routes.slice(profitabilityStart, profitabilityEnd)
assert.match(profitabilityRoute, /if \(q\.calendar === 'advertiser'\)/)
assert.match(profitabilityRoute, /calendarSource = 'advertiser'/)
assert.match(profitabilityRoute, /summarizeRevenueEvents\([\s\S]*timeZone: effectiveTimeZone/)
assert.match(profitabilityRoute, /profitEngine\.calculate\([\s\S]*timeZone: effectiveTimeZone/)
assert.match(profitabilityRoute, /timeZone: effectiveTimeZone/)
assert.doesNotMatch(overviewApi, /calendar=advertiser/)
const roasStart = routes.indexOf("app.get('/api/ads/roas'")
const roasEnd = roasStart >= 0 ? routes.indexOf("app.get('", roasStart + 10) : -1
const roasRoute = roasStart >= 0 ? routes.slice(roasStart, roasEnd > roasStart ? roasEnd : roasStart + 5000) : ''
assert.doesNotMatch(roasRoute, /q\.calendar|calendar === 'advertiser'/)

// Segurança compara blockedAdvertiserIds como conjunto ordenado.
assert.match(ops, /normalizePolicyForCompare/)
assert.match(ops, /new Set\(\(value\.blockedAdvertiserIds \?\? \[\]\)\.map\(String\)\)/)
assert.match(ops, /\.sort\(\)/)

console.log('[OK] TikTok Ads V16.8 — fechamento técnico final: tipos, navegação, uploads, timezone e dirty state.')
