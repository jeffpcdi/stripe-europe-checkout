'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')

const dashboard = path.join(__dirname, '..', 'dashboard')
const read = rel => fs.readFileSync(path.join(dashboard, rel), 'utf8')

const metrics = read('components/overview/overview-metrics.tsx')
const hero = read('components/overview/hero-globe.tsx')
const css = read('app/dashboard-refinement.css')

assert.match(metrics, /title="Investimento"/, 'Investimento deve ter título curto')
assert.match(metrics, /title="Conversão"/, 'Conversão deve ter título curto')
assert.match(metrics, /title="ROAS"/, 'ROAS deve ter título curto')
assert.match(metrics, />CPA <strong/, 'ROAS deve mostrar CPA de forma compacta')
assert.doesNotMatch(metrics, /vendas aprovadas/, 'resumo de faturamento não deve repetir microtexto')
assert.doesNotMatch(metrics, /TikTok Ads · conta inteira/, 'investimento não deve manter contexto redundante')

assert.match(hero, /<span>visitantes<\/span>/, 'visitantes deve usar legenda compacta')
assert.doesNotMatch(hero, /Atualizado às/, 'timestamp permanente deve sair da primeira dobra')
assert.match(hero, />Compras<\/h3><span>10 min<\/span>/, 'compras deve usar título e janela compactos')
assert.match(hero, />Ver tudo <ArrowUpRight/, 'ação de histórico deve permanecer acessível')

assert.match(css, /Overview Hero V7/, 'CSS deve conter o bloco V7')
assert.match(css, /minmax\(500px, 2\.7fr\)/, 'desktop deve dar prioridade real ao globo')
assert.match(css, /min-height: 650px/, 'desktop deve ampliar o palco do globo')
assert.match(css, /@media \(min-width: 1800px\)/, 'deve existir ajuste ultrawide')
assert.match(css, /@media \(min-width: 1100px\) and \(max-width: 1439px\)/, 'deve existir ajuste notebook')
assert.match(css, /@media \(min-width: 640px\) and \(max-width: 1099px\)/, 'deve existir ajuste tablet')
assert.match(css, /@media \(max-width: 639px\)/, 'deve existir ajuste mobile')
assert.match(css, /@media \(max-width: 419px\)/, 'deve existir fallback mobile estreito')
assert.match(css, /grid-template-columns: \.82fr 1fr 1\.22fr/, 'os três blocos operacionais devem manter hierarquia horizontal')

console.log('overview-hero-v7: OK')
