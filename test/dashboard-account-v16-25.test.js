'use strict'

const fs = require('fs')
const path = require('path')
const assert = require('assert')

const root = path.join(__dirname, '..')
const view = fs.readFileSync(path.join(root, 'dashboard/components/config/config-view.tsx'), 'utf8')

assert(view.includes('<ActionFeedbackPreference />'), 'feedback de interface deve ficar em Preferências')
assert(view.includes('function ActionFeedbackPreference()'), 'preferência de som/vibração deve ter superfície própria')
const alertsStart = view.indexOf('function DailyReportCard()')
const dangerStart = view.indexOf('function DangerCard()')
const alertsSection = view.slice(alertsStart, dangerStart)
assert(!alertsSection.includes('roi_action_feedback'), 'Alertas não deve carregar preferência local de experiência')
assert(!view.includes('cursor-pointer transition-colors hover:bg-secondary/40'), 'card de histórico não deve parecer clicável quando apenas o botão abre o modal')
assert(view.includes('Preferências') && view.includes('Integrações') && view.includes('Alertas') && view.includes('Conta e segurança') && view.includes('Dados'), 'Conta deve preservar agrupamento por tarefa')

console.log('[OK] Conta V16.25 — preferências e alertas separados por intenção.')
