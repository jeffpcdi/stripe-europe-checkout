'use strict'

const fs = require('fs')
const path = require('path')
const assert = require('assert')

const root = path.join(__dirname, '..')
const drawer = fs.readFileSync(path.join(root, 'dashboard/components/ads/campaign-drawer.tsx'), 'utf8')
const view = fs.readFileSync(path.join(root, 'dashboard/components/ads/tiktok-ads-view.tsx'), 'utf8')

assert(drawer.includes('Central da campanha'), 'drawer deve comunicar a central da campanha')
assert(drawer.includes("type SectionKey = 'overview' | 'structure' | 'history'"), 'drawer deve separar resultado, estrutura e histórico')
assert(drawer.includes('useAdsCampaignDecisions(Boolean(id), advertiserId, cur)'), 'resultado deve usar vendas reais no mesmo período selecionado')
assert(drawer.includes('Vendas reais') && drawer.includes('CPA real') && drawer.includes('ROAS real'), 'KPIs first-party devem permanecer visíveis')
assert(drawer.includes("'/api/ads/campaigns/bulk-status'"), 'drawer deve reutilizar alteração de status existente')
assert(drawer.includes("`/api/ads/${encodeURIComponent(id)}`"), 'drawer deve reutilizar edição de orçamento existente')
assert(drawer.includes('<AdEditDialog'), 'estrutura deve reutilizar editor existente de anúncio')
assert(drawer.includes('Campanha → conjuntos → anúncios'), 'estrutura hierárquica deve permanecer explícita')
assert(view.includes('onMutate={refreshCampaignSurfaces}'), 'mutações do drawer devem atualizar superfícies de campanha')
assert(view.includes('onDuplicate={(campaign) => setDuplicateCampaign(campaign)}'), 'duplicação deve reutilizar fluxo existente')
assert(view.includes("changeTab('automation')"), 'central deve poder encaminhar para automações')

console.log('[OK] TikTok Ads V3 — central da campanha, ações existentes e métricas first-party integradas.')
