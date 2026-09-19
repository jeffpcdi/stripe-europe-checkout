'use strict'

const fs = require('fs')
const path = require('path')
const assert = require('assert')

const root = path.join(__dirname, '..')
const stats = fs.readFileSync(path.join(root, 'dashboard/components/cloak/cloak-stats-panel.tsx'), 'utf8')
const view = fs.readFileSync(path.join(root, 'dashboard/components/cloak/cloak-view.tsx'), 'utf8')

assert(view.includes('Campanhas') && view.includes('Resultados') && view.includes('Proteção'), 'Cloaker deve manter navegação por tarefa')
assert(stats.includes('Diagnóstico e falsos positivos'), 'recuperação de falso positivo deve ser acessível e nomeada por tarefa')
assert(stats.includes('Use estas ações somente quando um visitante legítimo tiver sido classificado incorretamente'), 'ferramentas avançadas devem explicar quando usar')
assert(stats.includes('agg && agg.total > 0'), 'diagnóstico não pode depender de cache sticky ou replay para aparecer')
assert(!stats.includes("data.redis ? 'Contadores duráveis'"), 'estado técnico positivo de Redis não deve competir com resultados operacionais')
assert(stats.includes('Histórico temporário'), 'risco real de perda dos contadores deve continuar visível quando armazenamento não é durável')
assert(stats.includes('Limpar veredito') && stats.includes('Refazer lookup') && stats.includes('Liberar IP'), 'falsos positivos devem ter recuperação operacional')

console.log('[OK] Cloaker V16.25 — resultados limpos e recuperação de falsos positivos acessível.')
