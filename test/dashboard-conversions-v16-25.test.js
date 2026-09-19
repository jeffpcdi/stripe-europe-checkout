'use strict'

const fs = require('fs')
const path = require('path')
const assert = require('assert')

const root = path.join(__dirname, '..')
const view = fs.readFileSync(path.join(root, 'dashboard/components/conversions/conversions-view.tsx'), 'utf8')
const gatewayCard = fs.readFileSync(path.join(root, 'dashboard/components/conversions/gateway-card.tsx'), 'utf8')

assert(view.includes('lastFailureDate') && view.includes('unresolvedLogFailure'), 'falhas históricas não devem permanecer como falha recente após recuperação')
assert(view.includes('trackingNextAction') && view.includes('Crie ou ative um Pixel') && view.includes('Conecte um checkout'), 'saúde de tracking deve orientar a próxima configuração real')
assert(view.includes('Assinatura do webhook') && view.includes('gateway-secret'), 'credencial de assinatura suportada pelo backend deve ser configurável na UI')
assert(!/DirectGatewayModal[\s\S]{0,180}pixels=\{pixels\}/.test(view), 'modal de checkout não deve prometer vínculo de Pixel que o endpoint de gateway não salva')
assert(/<GatewayCard[\s\S]{0,180}pixels=\{pixels\}/.test(view), 'cartão de checkout deve receber Pixels para mostrar vínculos reais')
assert(gatewayCard.includes('Testar recebimento'), 'teste de checkout deve descrever o recebimento de webhook, não uma integração completa')
assert(gatewayCard.includes('não envia ao TikTok nem registra receita'), 'teste interno deve deixar claro seu limite')
assert(gatewayCard.includes('/erro|error|falh|inválid|invalid|rejeitad/i') && gatewayCard.includes('/^ok\\b/i'), 'cartão de checkout deve usar a mesma semântica ampla de erro e sucesso do diagnóstico')
assert(view.includes('Limpar filtro'), 'estado vazio de entregas filtradas deve ser recuperável')

console.log('[OK] Conversões V16.25 — saúde cronológica, próxima ação e configuração de checkout coerentes.')
