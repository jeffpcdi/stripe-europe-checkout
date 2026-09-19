'use strict'

const fs = require('fs')
const path = require('path')
const assert = require('assert')

const root = path.join(__dirname, '..')
const links = fs.readFileSync(path.join(root, 'dashboard/components/links/links-view.tsx'), 'utf8')
const cloakStats = fs.readFileSync(path.join(root, 'dashboard/components/cloak/cloak-stats-panel.tsx'), 'utf8')

assert(links.includes("domain.verificado && (!domain.status || domain.status === 'active')"), 'atenção de Links deve exigir domínio realmente pronto, não apenas verificado')
assert(links.includes('attentionOnly') && links.includes('apenas atenção'), 'contador de atenção deve abrir um filtro operacional recuperável')
assert(links.includes('setAttentionOnly(false); setShowArchived'), 'arquivados e atenção não devem produzir filtros conflitantes')
assert(cloakStats.includes('Por que foram ao destino seguro?'), 'resultados do Cloaker devem explicar a decisão de destino')
assert(cloakStats.includes('{pct}%</span> no seguro'), 'taxa por campanha não deve chamar toda decisão segura de bloqueio')
assert(!cloakStats.includes('{pct}%</span> bloqueado'), 'terminologia antiga de bloqueio não deve reaparecer no resumo por campanha')

console.log('[OK] V16.25 — Links e Cloaker preservam estado, ação e terminologia coerentes.')
