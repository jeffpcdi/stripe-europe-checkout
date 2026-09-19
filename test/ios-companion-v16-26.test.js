'use strict'

const fs = require('fs')
const path = require('path')
const assert = require('assert')

const root = path.join(__dirname, '..')
const iosPush = require('../ios-push')
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8')
const config = fs.readFileSync(path.join(root, 'config.js'), 'utf8')
const webPush = fs.readFileSync(path.join(root, 'web-push-notify.js'), 'utf8')
const fanout = fs.readFileSync(path.join(root, 'pushcut.js'), 'utf8')
const settings = fs.readFileSync(path.join(root, 'dashboard/components/config/config-view.tsx'), 'utf8')
const companionCard = fs.readFileSync(path.join(root, 'dashboard/components/config/iphone-companion-card.tsx'), 'utf8')
const widgetSwift = fs.readFileSync(path.join(root, 'ios/ROINADOSWidget/ROINADOSWidget.swift'), 'utf8')
const soundSwift = fs.readFileSync(path.join(root, 'ios/ROINADOSCompanion/SaleSoundInstaller.swift'), 'utf8')
const registerSwift = fs.readFileSync(path.join(root, 'ios/ROINADOSCompanion/PushRegistration.swift'), 'utf8')

const salePayload = JSON.parse(iosPush._payloadFor({
  event: 'sale',
  title: 'Venda aprovada · R$ 197,00',
  body: 'Produto · Gateway',
  url: '/dashboard/activity',
  badge: true,
  priority: 'normal',
}))
assert.strictEqual(salePayload.aps.sound, 'roi-sale.wav', 'venda nativa deve usar o som ROI-NADOS')
assert.strictEqual(salePayload.aps['interruption-level'], 'active', 'venda comum não deve fingir alerta crítico Apple')
assert.strictEqual(salePayload.aps.badge, 1, 'venda acionável deve marcar o app')

const breakerPayload = JSON.parse(iosPush._payloadFor({
  event: 'ads_breaker',
  title: 'Automação pausada',
  body: 'Revise no painel.',
  priority: 'critical',
}))
assert.strictEqual(breakerPayload.aps.sound, 'default', 'som customizado é reservado para venda/teste')
assert.strictEqual(breakerPayload.aps['interruption-level'], 'time-sensitive', 'falha crítica interna pode usar Time Sensitive, não Critical Alert')

assert(server.includes("app.get('/api/v1/widget'"), 'backend deve expor snapshot agregado para WidgetKit')
assert(server.includes("companionApiAccount(req) || publicApiAccount(req)"), 'widget deve aceitar token dedicado do companion')
assert(server.includes("app.post('/api/v1/companion/register'"), 'companion deve registrar device token APNs')
assert(server.includes("app.get('/api/companion/token'"), 'dashboard deve gerar token dedicado de pareamento')
assert(server.includes("app.post('/api/companion/token/rotate'"), 'token do companion deve ser revogável sem afetar BI')
assert(server.includes("const title = 'Ontem · ' + revenueText + ' em receita'"), 'relatório diário deve usar título executivo curto e factual')
assert(server.includes('DAILY_REPORT_SWEEP_MS = 5 * 60 * 1000') && server.includes('dailyReportBootCheck'), 'brief diário deve rodar por scheduler e não depender de tráfego')
assert(server.includes("' · Ticket ' + aovText") && server.includes("'Atenção: ' + exception"), 'brief diário deve incluir ticket médio e exceção factual útil')
assert(server.includes("new Intl.NumberFormat('pt-BR'"), 'brief diário deve formatar moeda para leitura humana')

const widgetBlock = server.slice(server.indexOf("app.get('/api/v1/widget'"), server.indexOf("app.post('/api/v1/companion/register'"))
assert(!/email|phone|customer|orderId/i.test(widgetBlock), 'snapshot do widget não deve expor PII de cliente')
assert(widgetBlock.includes('revenueCents') && widgetBlock.includes('netProfitCents') && widgetBlock.includes('roas'), 'widget deve receber KPIs executivos reais')

assert(config.includes("companion: {") && config.includes("devices: devices.slice(0, 6)"), 'config deve limitar e sanitizar aparelhos nativos')
assert(config.includes("preferNativeIOS: source.preferNativeIOS === true"), 'preferência pelo canal nativo deve ser explícita e persistida')
assert(webPush.includes('note && note.skipIOSWebPush'), 'Web Push deve ceder iPhone ao companion nativo para evitar duplicação')
assert(fanout.includes('async function sendViaIOS') && fanout.includes('sendViaIOS(notificationName'), 'fan-out deve incluir APNs nativo')
assert(fanout.includes("event === 'daily'") && fanout.includes('dailyReportEnabled === true'), 'brief diário deve atravessar canais nativos apenas quando opt-in estiver ativo')
assert(fanout.includes('companion.preferNativeIOS === true') && fanout.includes('note.skipIOSWebPush'), 'Web Push do iPhone só deve ser suprimido por preferência explícita')

assert(settings.includes('<IPhoneCompanionCard />'), 'Conta → Alertas deve expor pareamento do companion')
assert(companionCard.includes('APNs pronto') && companionCard.includes('Token do Companion copiado.'), 'card deve mostrar prontidão e pareamento sem ruído')
assert(companionCard.includes('Preferir Companion no iPhone'), 'usuário deve controlar a troca de Web Push para APNs nativo')
assert(widgetSwift.includes('Receita, vendas, ROAS e lucro do dia.'), 'widget deve focar KPIs executivos')
assert(widgetSwift.includes('.supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular])'), 'widget deve cobrir Tela de Início e uma superfície enxuta da Tela Bloqueada')
assert(widgetSwift.includes('private func lockScreen'), 'widget da Tela Bloqueada deve ter composição própria e glanceable')
assert(soundSwift.includes('static let fileName = "roi-sale.wav"'), 'companion deve instalar som de venda nativo')
assert(soundSwift.includes('Library') || soundSwift.includes('libraryDirectory'), 'som customizado deve viver no container permitido pelo iOS')
assert(registerSwift.includes('registerForRemoteNotifications') && registerSwift.includes('/api/v1/companion/register'), 'app nativo deve registrar APNs no backend ROI-NADOS')

console.log('[OK] V16.26 — executive brief, APNs nativo, som de venda e WidgetKit coerentes.')
