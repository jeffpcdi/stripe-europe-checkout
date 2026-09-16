'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

const tree = read('dashboard/components/ads/campaign-tree.tsx')
const drawer = read('dashboard/components/ads/campaign-drawer.tsx')
const api = read('dashboard/lib/api.ts')
const routes = read('ads-routes.js')
const ops = read('ads-ops-store.js')

// A Central pede o histórico da campanha na origem, em vez de filtrar um recorte global já limitado.
assert.match(api, /export function useAdsAudit\([\s\S]*advertiserId\?: string; campaignId\?: string; limit\?: number/)
assert.match(api, /params\.set\('advertiserId', filters\.advertiserId\)/)
assert.match(api, /params\.set\('campaignId', filters\.campaignId\)/)
assert.match(drawer, /useAdsAudit\(Boolean\(id\), \{[\s\S]*advertiserId,[\s\S]*campaignId: id \|\| undefined,[\s\S]*limit: 80/)
assert.match(drawer, /const timeline = \(audit\?\.events \|\| \[\]\)\.slice\(0, 30\)/)
assert.doesNotMatch(drawer, /const timeline = \(audit\?\.events \|\| \[\]\)\.filter/)
assert.match(ops, /async function listAuditEvents\(accountId, limit, opts = \{\}\)/)
assert.match(ops, /metadata ->> 'campaignId' = \$\{campaignId\}/)
assert.match(ops, /metadata ->> 'winnerId' = \$\{campaignId\}/)
assert.match(ops, /metadata ->> 'donorId' = \$\{campaignId\}/)
assert.match(routes, /advertiserId: req\.query\.advertiserId/)
assert.match(routes, /campaignId: req\.query\.campaignId/)

// Métrica ausente continua ausente: não vira zero falso dentro da estrutura.
assert.match(drawer, /ad\.metrics\?\.spend == null \? '—' : fmtMoney\(Number\(ad\.metrics\.spend\), ccy\)/)
assert.match(drawer, /ad\.metrics\?\.impressions == null \? '—' : fmtCompact\(Number\(ad\.metrics\.impressions\)\)/)
assert.doesNotMatch(drawer, /fmtMoney\(Number\(ad\.metrics\?\.spend\) \|\| 0/)

// Bulk status envia somente campanhas que realmente precisam daquela transição.
assert.match(tree, /status === 'active' \? campaign\.status === 'paused' : campaign\.status === 'active'/)
assert.match(tree, /const selectedActiveCampaigns = selectedCampaigns\.filter\(\(campaign\) => campaign\.status === 'active'\)/)
assert.match(tree, /const selectedPausedCampaigns = selectedCampaigns\.filter\(\(campaign\) => campaign\.status === 'paused'\)/)
assert.match(tree, /const selectedNotPausedCount = selectedCampaigns\.length - selectedPausedCampaigns\.length/)
assert.match(tree, /Pausar\{selectedActiveCampaigns\.length \? ` · \$\{selectedActiveCampaigns\.length\}` : ''\}/)
assert.match(tree, /Ativar\{selectedPausedCampaigns\.length \? ` · \$\{selectedPausedCampaigns\.length\}` : ''\}/)

// Orçamento em massa mostra efeito antes de persistir e mantém validação do mínimo TikTok.
assert.match(tree, /type BulkBudgetMode = 'percent_up' \| 'percent_down' \| 'fixed'/)
assert.match(tree, /function adjustedBudgetAmount\(/)
assert.match(tree, /function budgetImpactSummary\(/)
assert.match(tree, /Impacto antes de salvar/)
assert.match(tree, /Este ajuste aumenta o potencial de gasto/)
assert.match(tree, /role="tablist" aria-label="Tipo de ajuste de orçamento"/)
assert.match(tree, /bulkBudgetMode !== 'fixed' \|\| bulkBudgetNumericValue >= TIKTOK_MIN_BUDGET/)
assert.match(tree, /disabled=\{bulkBudgetBusy \|\| !bulkBudgetValueValid\}/)

console.log('[OK] TikTok Ads V16.10 — histórico por campanha, zeros reais e ações financeiras previsíveis.')
