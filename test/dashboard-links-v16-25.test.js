'use strict'

const fs = require('fs')
const path = require('path')
const assert = require('assert')

const root = path.join(__dirname, '..')
const links = fs.readFileSync(path.join(root, 'dashboard/components/links/links-view.tsx'), 'utf8')

assert(links.includes('domain.verificado && (!domain.status || domain.status === \'active\')'), 'resumo e lista devem considerar domínio realmente pronto, não apenas verificado')
assert(links.includes('attentionOnly') && links.includes('setAttentionOnly'), 'contador de atenção deve permitir chegar aos links com problema')
assert(links.includes('Nenhum link com atenção corresponde aos filtros atuais.'), 'estado vazio do filtro de atenção deve explicar o contexto')
assert(links.includes('Limpar filtros'), 'filtros de links devem ser recuperáveis')
assert(links.includes('setAttentionOnly(false); setShowArchived'), 'arquivados e filtro de atenção não devem competir')

console.log('[OK] Links V16.25 — atenção acionável e domínio pronto coerente.')
