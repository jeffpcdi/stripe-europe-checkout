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
const companionConfigSwift = fs.readFileSync(path.join(root, 'ios/Shared/CompanionConfig.swift'), 'utf8')
const widgetSnapshotSwift = fs.readFileSync(path.join(root, 'ios/Shared/WidgetSnapshot.swift'), 'utf8')
const apiClientSwift = fs.readFileSync(path.join(root, 'ios/Shared/ROIAPIClient.swift'), 'utf8')
const projectYml = fs.readFileSync(path.join(root, 'ios/project.yml'), 'utf8')
const appEntitlements = fs.readFileSync(path.join(root, 'ios/ROINADOSCompanion/ROINADOSCompanion.entitlements'), 'utf8')

const salePayload = JSON.parse(iosPush._payloadFor({
  event: 'sale',
  title: 'Venda aprovada · R$ 197,00',
  body: 'Produto · Gateway',
  url: '/dashboard/activity',
  badge: true,
  priority: 'normal',
}))
assert.strictEqual(salePayload.aps.sound, 'roi-sale-v2.wav', 'venda nativa deve usar o som ROI-NADOS')
assert.strictEqual(salePayload.aps['interruption-level'], 'active', 'venda comum não deve fingir alerta crítico Apple')
assert.strictEqual(salePayload.aps.badge, 1, 'venda acionável deve marcar o app')
assert.strictEqual(salePayload.aps['content-available'], 1, 'venda deve solicitar atualização de dados do widget em background')
assert.strictEqual(salePayload.aps.category, 'ROI_SALE', 'venda nativa deve oferecer ação contextual')

const breakerPayload = JSON.parse(iosPush._payloadFor({
  event: 'ads_breaker',
  title: 'Automação pausada',
  body: 'Revise no painel.',
  priority: 'critical',
}))
assert.strictEqual(breakerPayload.aps.sound, 'default', 'som customizado é reservado para venda/teste')
assert.strictEqual(breakerPayload.aps['interruption-level'], 'time-sensitive', 'falha crítica interna pode usar Time Sensitive, não Critical Alert')
assert.strictEqual(breakerPayload.aps.category, 'ROI_AUTOMATION', 'alerta de automação deve oferecer revisão contextual')

const dailyPayload = JSON.parse(iosPush._payloadFor({
  event: 'daily',
  title: 'Resumo de ontem · R$ 1.000,00',
  body: '10 vendas · ROAS 2.50×',
  priority: 'normal',
}))
assert.strictEqual(dailyPayload.aps['interruption-level'], 'passive', 'brief diário deve informar sem interromper')
assert.strictEqual(dailyPayload.aps.sound, undefined, 'brief diário passivo não deve tocar som')
assert.strictEqual(dailyPayload.aps.category, 'ROI_DAILY', 'brief diário deve oferecer ação para abrir o resumo')
const iosPushSource = fs.readFileSync(path.join(root, 'ios-push.js'), 'utf8')
assert(iosPushSource.includes("event === 'daily' ? '5' : '10'"), 'APNs deve usar prioridade econômica no brief diário')
assert(iosPushSource.includes("24 * 3600") && iosPushSource.includes("6 * 3600") && iosPushSource.includes("3600"), 'APNs deve manter TTL por severidade em vez de descartar offline')
assert(iosPushSource.includes("'apns-collapse-id'"), 'notificações de status devem poder colapsar por tag')

assert(server.includes("app.get('/api/v1/widget'"), 'backend deve expor snapshot agregado para WidgetKit')
assert(server.includes("companionApiAccount(req) || publicApiAccount(req)"), 'widget deve aceitar token dedicado do companion')
assert(server.includes("app.post('/api/v1/companion/register'"), 'companion deve registrar device token APNs')
assert(server.includes("app.post('/api/companion/test'"), 'dashboard deve testar APNs e o som nativo de venda diretamente')
assert(server.includes("app.get('/api/companion/token'"), 'dashboard deve gerar token dedicado de pareamento')
assert(server.includes("app.post('/api/companion/token/rotate'"), 'token do companion deve ser revogável sem afetar BI')
assert(server.includes("const title = 'Ontem · ' + revenueText"), 'relatório diário deve usar título executivo curto e factual')
assert(server.includes('DAILY_REPORT_SWEEP_MS = 5 * 60 * 1000') && server.includes('dailyReportBootCheck'), 'brief diário deve rodar por scheduler e não depender de tráfego')
assert(server.includes("' · Ticket ' + aovText") && server.includes("'Atenção: ' + exception"), 'brief diário deve incluir ticket médio e exceção factual útil')
assert(server.includes("'Próximo passo: ' + nextAction"), 'brief diário excepcional deve terminar com próxima ação operacional')
assert(server.includes("'Mais vendido: ' + topProductText"), 'brief diário deve incluir produto líder quando houver dado real')
assert(server.includes("NATIVE_PREFERENCE_GROUPS = ['sales', 'risks', 'automation', 'reports']"), 'relatórios devem ter preferência nativa própria')
assert(server.includes("new Intl.NumberFormat('pt-BR'"), 'brief diário deve formatar moeda para leitura humana')

const widgetBlock = server.slice(server.indexOf("app.get('/api/v1/widget'"), server.indexOf("app.post('/api/v1/companion/register'"))
assert(!/email|phone|customer|orderId/i.test(widgetBlock), 'snapshot do widget não deve expor PII de cliente')
assert(widgetBlock.includes('revenueCents') && widgetBlock.includes('netProfitCents') && widgetBlock.includes('roas'), 'widget deve receber KPIs executivos reais')
assert(widgetBlock.includes('revenueDeltaPct') && widgetBlock.includes('lastSale') && widgetBlock.includes('version: 2'), 'snapshot v2 deve incluir tendência e última venda')

assert(config.includes("companion: {") && config.includes("devices: devices.slice(0, 6)"), 'config deve limitar e sanitizar aparelhos nativos')
assert(config.includes("preferNativeIOS: source.preferNativeIOS === true"), 'preferência pelo canal nativo deve ser explícita e persistida')
assert(webPush.includes('note && note.skipIOSWebPush'), 'Web Push deve ceder iPhone ao companion nativo para evitar duplicação')
assert(webPush.includes('note && note.onlyIOSWebPush') && webPush.includes('isIOSSub'), 'Web Push deve conseguir atingir apenas iOS como fallback do APNs')
assert(fanout.includes('async function sendViaIOS') && fanout.includes('sendViaIOS(notificationName'), 'fan-out deve incluir APNs nativo')
assert(fanout.includes("event === 'daily'") && fanout.includes('dailyReportEnabled === true') && fanout.includes('nativePreferencesFor(accountId).reports !== false'), 'brief diário deve respeitar agendamento e preferência do canal')
assert(fanout.includes('companion.preferNativeIOS === true') && fanout.includes('note.skipIOSWebPush'), 'Web Push do iPhone só deve ser suprimido por preferência explícita')
assert(fanout.includes("require('./ios-push').configured()"), 'handoff nativo deve exigir APNs configurado antes de suprimir Web Push')
assert(fanout.includes('{ onlyIOS: true }') && fanout.includes('nativePreferred && !iosOk'), 'falha APNs deve cair para Web Push apenas no iPhone')
assert(fanout.includes("companion.preferNativeIOS !== true) return false"), 'APNs de produção também deve depender da preferência explícita para evitar duplicação')

assert(settings.includes('<IPhoneCompanionCard />'), 'Conta → Alertas deve expor pareamento do companion')
assert(server.includes("code: 'companion_device_required'") && server.includes("code: 'apns_not_configured'"), 'backend deve bloquear handoff nativo sem aparelho/APNs prontos')
assert(companionCard.includes('APNs pronto') && companionCard.includes('Token do Companion copiado.'), 'card deve mostrar prontidão e pareamento sem ruído')
assert(companionCard.includes('2 widgets') && companionCard.includes('Widgets executivo e Vendas'), 'dashboard deve explicar as opções reais de WidgetKit')
assert(companionCard.includes('Preferir Companion no iPhone'), 'usuário deve controlar a troca de Web Push para APNs nativo')
assert(companionCard.includes("disabled={!data?.apnsConfigured && data?.preferNativeIOS !== true}"), 'UI deve impedir ativar handoff nativo enquanto APNs estiver pendente')
assert(companionCard.includes('Web Push do iPhone continua sendo o fallback'), 'UI deve explicar a recuperação automática do canal')
assert(companionCard.includes('Testar som nativo de venda') && companionCard.includes('/api/companion/test'), 'pareamento deve oferecer teste real do chime APNs')
assert(companionCard.includes('roinados://pair?server=') && companionCard.includes('Abrir no Companion'), 'pareamento no iPhone deve ter fluxo de um toque')
assert(server.includes('widgetSnapshotVersion: 2') && server.includes('lockScreenWidget: true'), 'status do companion deve declarar capacidades reais')
assert(server.includes('largeExecutiveWidget: true') && server.includes('salesWidget: true'), 'status deve declarar os widgets adicionais reais')
assert(companionCard.includes('Confirmar renovação') && companionCard.includes('/api/companion/token/rotate'), 'rotação do token deve existir na UI com confirmação antes de desconectar iPhones')
assert(widgetSwift.includes('Receita, vendas, ROAS, lucro e tendência do dia.'), 'widget deve focar KPIs executivos')
assert(widgetSwift.includes('.accessoryRectangular') && widgetSwift.includes('.accessoryInline') && widgetSwift.includes('.accessoryCircular'), 'widget deve cobrir Tela de Início e superfícies úteis da Tela Bloqueada')
assert(widgetSwift.includes('.systemLarge') && widgetSwift.includes('private func large'), 'widget executivo deve aproveitar formato grande do iPhone')
assert(widgetSwift.includes('ROINADOSSalesWidget') && widgetSwift.includes('Vendas ROI-NADOS'), 'Companion deve oferecer widget dedicado a vendas')
assert(widgetSwift.includes('private func lockScreen'), 'widget da Tela Bloqueada deve ter composição própria e glanceable')
assert(widgetSwift.includes('ÚLTIMA VENDA') && widgetSwift.includes('snapshot.lastSale'), 'widget médio deve mostrar a última venda sem poluir quando não há alerta')
assert(widgetSwift.includes('WidgetSnapshotCache.load()'), 'widget deve cair para o último snapshot válido quando a rede falhar')
assert(widgetSnapshotSwift.includes('UserDefaults(suiteName: CompanionConfig.appGroup)') && widgetSnapshotSwift.includes('roi.widget.snapshot.v2'), 'cache do widget deve ficar no App Group compartilhado')
assert(apiClientSwift.includes('WidgetSnapshotCache.save(snapshot)'), 'refresh bem-sucedido deve atualizar o cache compartilhado')
assert(widgetSwift.includes('.widgetURL(CompanionConfig.dashboardURL())'), 'toque no widget deve voltar ao ROI-NADOS')
assert(soundSwift.includes('static let fileName = "roi-sale-v2.wav"'), 'companion deve instalar som de venda nativo versionado')
assert(soundSwift.includes('Library') || soundSwift.includes('libraryDirectory'), 'som customizado deve viver no container permitido pelo iOS')
assert(soundSwift.includes('880') && soundSwift.includes('1320') && soundSwift.includes('1760'), 'som nativo deve usar a mesma assinatura tonal da dashboard')
assert(registerSwift.includes('registerForRemoteNotifications') && registerSwift.includes('/api/v1/companion/register'), 'app nativo deve registrar APNs no backend ROI-NADOS')
assert(registerSwift.includes('configureCategories') && registerSwift.includes('ROI_SALE') && registerSwift.includes('ROI_DAILY') && registerSwift.includes('ROI_AUTOMATION'), 'Companion deve registrar ações contextuais das notificações')
assert(registerSwift.includes('case "OPEN_SALES"') && registerSwift.includes('case "OPEN_DAILY"') && registerSwift.includes('case "OPEN_AUTOMATION"'), 'ações nativas devem abrir superfícies específicas')
assert(registerSwift.includes('requestAuthorizationAndRegister') && registerSwift.includes('registerIfAuthorized'), 'permissão de notificação deve ser pedida em contexto, não automaticamente no primeiro launch')
assert(registerSwift.includes('didReceiveRemoteNotification') && registerSwift.includes('reloadAllTimelines'), 'venda recebida em background deve sinalizar atualização do WidgetKit')
assert(registerSwift.includes('didReceive response') && registerSwift.includes('CompanionConfig.dashboardURL'), 'toque em notificação nativa deve abrir o deep link correto')
assert(registerSwift.includes('WidgetCenter.shared.reloadAllTimelines()'), 'alerta nativo deve sinalizar atualização dos widgets')
assert(registerSwift.includes('applicationDidBecomeActive') && registerSwift.includes('setBadgeCount(0)'), 'Companion deve limpar badge e atualizar widgets quando o usuário retorna')
assert(companionConfigSwift.includes('percentEncodedQuery') && companionConfigSwift.includes('maxSplits: 1'), 'deep link nativo deve preservar query como tab=automation')
assert(projectYml.includes('APS_ENVIRONMENT: production') && projectYml.includes('APS_ENVIRONMENT: development'), 'Debug e Release devem usar ambientes APNs coerentes')
assert(projectYml.includes('CFBundleURLSchemes:') && projectYml.includes('- roinados'), 'Companion deve registrar o scheme de pareamento')
assert(projectYml.includes('UIBackgroundModes:') && projectYml.includes('- remote-notification'), 'Companion deve habilitar refresh de widget por push em background')
assert(appEntitlements.includes('$(APS_ENVIRONMENT)'), 'entitlement APNs não deve ficar fixo em development')
const companionApp = fs.readFileSync(path.join(root, 'ios/ROINADOSCompanion/ROINADOSCompanionApp.swift'), 'utf8')
const notifyCopy = fs.readFileSync(path.join(root, 'notify-copy.js'), 'utf8')
assert(companionApp.includes('.onOpenURL') && companionApp.includes('handlePairingURL'), 'app deve consumir o link de pareamento e validar a conta')
assert(companionApp.includes('Section("Hoje")') && companionApp.includes('LabeledContent("Receita"') && companionApp.includes('LabeledContent("ROAS"'), 'Companion deve mostrar um resumo nativo útil depois do pareamento')
assert(companionApp.includes('Atualizar widgets') && companionApp.includes('Ver vendas') && companionApp.includes('Abrir dashboard completa'), 'Companion deve oferecer atalhos úteis sem duplicar a dashboard')
assert(companionApp.includes('requestAuthorizationAndRegister') && companionApp.includes('Abrir Ajustes de notificações'), 'app deve pedir alertas após validar a conta e oferecer recuperação se negado')
assert((companionApp.match(/notificationNeedsSettings = false/g) || []).length === 1, 'estado de permissão do Companion não deve ser declarado em duplicidade')
assert((notifyCopy.match(/event === 'daily'/g) || []).length === 1, 'copy do relatório diário deve ter um único caminho factual')

console.log('[OK] V16.26 — executive brief, APNs nativo, som de venda e WidgetKit coerentes.')
