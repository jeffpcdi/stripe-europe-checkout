'use strict'

const fs = require('fs')
const path = require('path')
const assert = require('assert')

const root = path.join(__dirname, '..')
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8')
const push = fs.readFileSync(path.join(root, 'ios-push.js'), 'utf8')
const widget = fs.readFileSync(path.join(root, 'ios/ROINADOSWidget/ROINADOSWidget.swift'), 'utf8')
const model = fs.readFileSync(path.join(root, 'ios/Shared/WidgetSnapshot.swift'), 'utf8')
const registration = fs.readFileSync(path.join(root, 'ios/ROINADOSCompanion/PushRegistration.swift'), 'utf8')
const sound = fs.readFileSync(path.join(root, 'ios/ROINADOSCompanion/SaleSoundInstaller.swift'), 'utf8')

assert(server.includes("app.get('/api/v1/widget'") && server.includes('version: 2'), 'widget API precisa manter contrato versionado')
assert(server.includes('revenueDeltaPct') && server.includes('lastSale'), 'widget deve receber tendência e última venda')
assert(model.includes('let trend: Trend?') && model.includes('let lastSale: LastSale?'), 'modelo iOS deve ser retrocompatível')
assert(widget.includes('.accessoryInline') && widget.includes('.accessoryCircular'), 'widget deve cobrir superfícies de Lock Screen')
assert(widget.includes('snapshot.trend?.revenueDeltaPct'), 'tendência opcional deve ser renderizada com segurança')
assert(registration.includes('WidgetCenter.shared.reloadAllTimelines()'), 'alerta nativo deve atualizar os widgets')
assert(push.includes("roi-sale.wav") && push.includes("'interruption-level'"), 'APNs deve usar som próprio de venda e prioridade nativa')
assert(sound.includes('static let fileName = "roi-sale.wav"') && sound.includes('duration = 0.42'), 'Companion deve gerar chime curto localmente')

console.log('[OK] V16.25 — Companion iOS, som nativo e WidgetKit coerentes.')
