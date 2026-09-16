'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

const pilots = read('dashboard/components/ads/pilots-panel.tsx')
const context = read('dashboard/components/ads/context-bar.tsx')
const view = read('dashboard/components/ads/tiktok-ads-view.tsx')
const inbox = read('dashboard/components/ads/needs-you-inbox.tsx')
const automation = read('dashboard/components/ads/automation-panel.tsx')
const magic = read('dashboard/components/ads/magic-ops-panel.tsx')
const batch = read('dashboard/components/ads/catalog-batch-dialog.tsx')
const quick = read('dashboard/components/ads/catalog-quick-campaigns-dialog.tsx')
const creatives = read('dashboard/components/ads/catalog-creatives.tsx')
const universal = read('dashboard/components/ads/universal-launcher-dialog.tsx')
const spark = read('dashboard/components/ads/spark-ad-dialog.tsx')
const campaignTree = read('dashboard/components/ads/campaign-tree.tsx')
const routes = read('ads-routes.js')
const config = read('config.js')
const profit = read('profit-engine.js')

// Compilação/React hooks.
assert.match(pilots, /import \{[^}]*useEffect[^}]*\} from 'react'/)

// Conta: ContextBar só emite intenção; persistência ocorre no parent após proteção de draft/upload.
assert.doesNotMatch(context, /\/api\/ads\/accounts\/select/)
assert.match(context, /onAdvertiserChangeRequested/)
assert.match(view, /async function commitAdvertiserChange/)
assert.match(view, /\/api\/ads\/accounts\/select/)
assert.match(view, /if \(hasAutomationDraft \|\| hasCatalogLocalWork\)/)
assert.match(view, /setPendingAdvertiserId\(id\)[\s\S]*setConfirmAccountSwitch\(true\)[\s\S]*return/)
assert.match(view, /onConfirm=\{\(\) => \{ const id = pendingAdvertiserId; if \(id\) void commitAdvertiserChange\(id\) \}\}/)

// Período TikTok usa dia civil do advertiser.
assert.match(view, /adsDateRange\(rangeDays, advertiserTimeZone\)/)
assert.doesNotMatch(view, /reportingTimeZone = accountSettings/)

// Propostas financeiras usam moeda real.
assert.match(inbox, /function money\(value: unknown, currency: string\)/)
assert.match(inbox, /proposalImpact\(p, currency\)/)
assert.doesNotMatch(inbox, /currency:\s*'BRL'/)
assert.match(view, /<NeedsYouInbox[\s\S]*currency=\{currency\}/)

// Custos fixos multimoeda: contrato explícito, sem FX silencioso.
assert.match(config, /fixedCostCurrency/)
assert.match(config, /settingsCurrency[\s\S]*defaultCurrency/)
assert.match(routes, /effectiveProfitabilityConfig/)
assert.match(routes, /settings\.defaultCurrency \|\| 'BRL'/)
assert.match(profit, /fixedCurrencyCompatible/)
assert.match(profit, /fixedCostCurrencyMismatch/)
assert.match(profit, /não há conversão cambial automática/)
assert.match(magic, /Moeda dos custos fixos/)
assert.match(magic, /não faz conversão cambial automática/)

// Escape de regra dirty é protegido; exclusão limpa dirty fantasma.
assert.match(automation, /confirmEscapeDiscard/)
assert.match(automation, /Descartar alterações desta regra\?/)
assert.match(automation, /if \(dirty\) setConfirmEscapeDiscard\(true\)/)
assert.match(automation, /markRuleDirty\(id, false\)/)

// Pilotos e MagicOps calculam dirty por diferença real.
assert.match(pilots, /const pilotDirty =/)
assert.match(pilots, /draft !== saved/)
assert.match(magic, /const profitDirty = useMemo/)
assert.match(magic, /driveFolder\.trim\(\) !== cloudBaseline\.googleDrive/)
assert.match(magic, /dropboxFolder\.trim\(\) !== cloudBaseline\.dropbox/)

// OAuth protege drafts antes de navegação completa.
assert.match(magic, /confirmCloudConnect/)
assert.match(magic, /localDirty \|\| externalDirty/)
assert.match(magic, /Sair para conectar Google Drive\?/)

// Batch respeita a moeda do advertiser e o mesmo conjunto do Catálogo.
for (const code of ['BRL','USD','EUR','GBP','MXN','CAD','AUD','JPY']) assert.match(batch, new RegExp(`['\"]${code}['\"]`))
assert.match(batch, /useState\(\(\) => CATALOG_CURRENCIES\.includes\(advertiserCurrency/)

// Product Link não afirma Pixel confirmado antes do preflight.
assert.match(quick, /Será validado na revisão/)
assert.doesNotMatch(quick, /: 'Confirmado na revisão'/)

// Upload local do Catálogo é protegido ao navegar; remoção de criativo é confirmada.
assert.match(view, /hasCatalogLocalWork/)
assert.match(view, /Sair e cancelar o envio\?/)
assert.match(view, /function commitTabChange/)
assert.match(view, /function changeTab/)
assert.match(creatives, /Remover este criativo do catálogo\?/)
assert.match(creatives, /ConfirmDialog/)

// Touch targets residuais.
assert.match(universal, /min-h-10[^\n]*>Colar</)
assert.match(spark, /min-h-10[^\n]*Colar/)
assert.match(campaignTree, /btn-ghost min-h-10 px-3 text-xs[\s\S]*Anterior/)
assert.match(campaignTree, /btn-ghost min-h-10 px-3 text-xs[\s\S]*Próxima/)

console.log('[OK] TikTok Ads V16.7 — consistência final de conta, timezone, moeda, drafts e uploads.')
