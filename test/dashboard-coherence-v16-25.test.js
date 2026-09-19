'use strict'

const fs = require('fs')
const path = require('path')
const assert = require('assert')

const root = path.join(__dirname, '..')
const links = fs.readFileSync(path.join(root, 'dashboard/components/links/links-view.tsx'), 'utf8')
const cloakEntries = fs.readFileSync(path.join(root, 'dashboard/components/cloak/cloak-entries-panel.tsx'), 'utf8')
const domains = fs.readFileSync(path.join(root, 'dashboard/components/domains/domains-view.tsx'), 'utf8')
const overviewHealth = fs.readFileSync(path.join(root, 'overview-health.js'), 'utf8')
const setupGuide = fs.readFileSync(path.join(root, 'dashboard/components/overview/setup-guide.tsx'), 'utf8')

assert(links.includes("domain.verificado && (!domain.status || domain.status === 'active')"), 'Links deve considerar domínio pronto apenas com verificação e status ativo')
assert(links.includes('attentionOnly') && links.includes('apenas atenção'), 'contador de atenção em Links deve ser acionável')
assert(links.includes('Nenhum link com atenção corresponde aos filtros atuais.'), 'estado vazio do filtro de atenção deve explicar o contexto')

assert(cloakEntries.includes('summary.observing') && cloakEntries.includes('Somente observação'), 'Cloaker deve distinguir proteção efetiva de observação')
assert(cloakEntries.includes("globalConfig?.shadowMode === true"), 'estado efetivo deve respeitar observação global')
assert(cloakEntries.includes('Limpar busca'), 'busca sem resultados no Cloaker deve ser recuperável')

assert(domains.includes("disabled={adding || !host.trim() || data?.autoProvision === false}"), 'Domínios não deve prometer cadastro quando o backend de provisionamento está indisponível')
assert(domains.includes('O ROI-NADOS acompanha DNS e HTTPS'), 'Domínios deve manter onboarding orientado e não expor infraestrutura como tarefa principal')

assert(overviewHealth.includes('latestGatewayFailed') && overviewHealth.includes('gatewayValidated'), 'health global deve distinguir falha real de evento apenas ignorado')
assert(overviewHealth.includes('validated: saleEventCount > 0'), 'validação do checkout deve sobreviver a eventos posteriores não críticos')
assert(setupGuide.includes('validated === true'), 'onboarding deve consumir estado semântico de validação, não interpretar texto do último webhook')

console.log('[OK] V16.25 — coerência entre Links, Domínios e estado efetivo do Cloaker.')
