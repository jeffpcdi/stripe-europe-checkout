'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

const ops = read('dashboard/components/ads/ops-dialog.tsx')
const health = read('dashboard/components/ads/health-dialog.tsx')
const automation = read('dashboard/components/ads/automation-panel.tsx')
const pilots = read('dashboard/components/ads/pilots-panel.tsx')
const magic = read('dashboard/components/ads/magic-ops-panel.tsx')
const connect = read('dashboard/components/ads/connect-card.tsx')
const view = read('dashboard/components/ads/tiktok-ads-view.tsx')

// Segurança protege draft independentemente da tab visível.
assert.match(ops, /function requestClose\(\) \{ if \(isDirty\) setConfirmDiscard\(true\); else onClose\(\) \}/)
assert.doesNotMatch(ops, /tab === 'safety' && isDirty/)
assert.match(ops, /Descartar alterações\?/)

// Saúde agrega dirty dos tickets e usa requestClose em todas as saídas relevantes.
assert.match(health, /dirtyTickets/)
assert.match(health, /handleTicketDirty/)
assert.match(health, /onDirtyChange=\{handleTicketDirty\}/)
assert.match(health, /useModalA11y\(open, ref, requestClose\)/)
assert.match(health, /onClick=\{requestClose\}/)
assert.match(health, /O texto deste recurso ainda não foi salvo/)
assert.match(health, /Há alterações não salvas em \$\{dirtyTickets\.size\} recursos/)

// Regra automática avançada não pode ser ligada silenciosamente.
assert.match(automation, /confirmRuleEnable/)
assert.match(automation, /Ativar regra automática\?/)
assert.match(automation, /automaticBlockedReason/)
assert.match(automation, /setConfirmRuleEnable\(r\)/)
assert.match(automation, /toast\.info\('Ajuste os limites de segurança antes de ativar esta regra\.'/)
assert.match(automation, /void toggleRule\(r, on\)/) // proposal/desativação continuam diretos

// Drafts sobrevivem a disclosures/subabas; polling fica dependente de active real.
assert.match(view, /<Tabs\.Content forceMount value="automation"/)
assert.match(view, /active=\{automationActive\}/)
assert.match(view, /toolsMounted/)
assert.match(view, /active=\{automationActive && toolsExpanded\}/)
assert.match(automation, /alertsDraft/)
assert.match(automation, /if \(!alertsExpanded && !alertsDraft\)/)
assert.match(automation, /!advanced && 'hidden'/)
assert.match(automation, /!open && 'hidden'/)
assert.match(pilots, /Alterações não aplicadas/)
assert.match(pilots, /onDirtyChange/)
assert.match(magic, /onDirtyChange/)
assert.match(magic, /const cloudDirty = useMemo/)
assert.doesNotMatch(magic, /cloudDirty\.current/)

// Troca de advertiser não deve descartar drafts de automação silenciosamente.
assert.match(view, /Trocar de conta e descartar alterações\?/)
assert.match(view, /hasAutomationDraft/)
assert.match(view, /onAdvertiserChangeRequested=\{requestAdvertiserChange\}/)

// Camada avançada sem microtipografia operacional antiga.
assert.doesNotMatch(automation, /text-\[(?:10|11)px\]/)
assert.doesNotMatch(automation, /uppercase tracking/)
assert.match(automation, /Quando disparar/)
assert.match(automation, /Configurações avançadas/)
assert.match(automation, /min-h-10/)

// Estado inicial agora verifica integração Pipeboard, sem landing/benefit cards e sem promessa realtime.
assert.doesNotMatch(connect, /GlassCard|BENEFITS|Campanhas e métricas|Suba anúncios daqui/)
assert.doesNotMatch(connect, /em tempo real/i)
assert.doesNotMatch(connect, />Conectar TikTok Ads</)
assert.match(connect, /Verificar integração TikTok Ads/)
assert.match(connect, /Verificar integração/)
assert.match(connect, /Integração TikTok Ads verificada/)
assert.match(connect, /Nenhuma conta de anúncios disponível/)
assert.match(view, /Integração TikTok Ads não configurada/)

// Fechamento continua frontend-only.
for (const file of ['ads-automation.js','ads-routes.js','ads-provider.js','ads-ops-store.js']) {
  assert(read(file).length > 0, `${file} deve permanecer presente`)
}

console.log('[OK] TikTok Ads V16.6 — fechamento de drafts, regras automáticas e integração inicial.')
