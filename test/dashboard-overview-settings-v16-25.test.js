'use strict'

const fs = require('fs')
const path = require('path')
const assert = require('assert')
const { buildOverviewHealth } = require('../overview-health')

const base = {
  snapshot: { leads: [], events: [] },
  facts: null,
  timeZone: 'America/Sao_Paulo',
  links: [{ ativo: true, arquivado: false }],
  pixels: [{ active: true, pixelCode: 'PX', accessToken: 'TOKEN' }],
}

const noEvent = buildOverviewHealth({ ...base, gateways: [{ id: 'g1', lastEventAt: null, lastEventStatus: null }] })
assert(noEvent.actions.some((action) => action.id === 'gateway-validation'), 'checkout cadastrado sem webhook válido deve continuar pedindo validação')
assert.strictEqual(noEvent.setup.gateways.lastEventStatus, null)

const failed = buildOverviewHealth({ ...base, gateways: [{ id: 'g1', lastEventAt: '2026-09-19T10:00:00.000Z', lastEventStatus: 'assinatura inválida' }] })
assert(failed.actions.some((action) => action.id === 'gateway-validation'), 'último webhook inválido deve permanecer como atenção')
assert.strictEqual(failed.setup.gateways.lastEventStatus, 'assinatura inválida')

const ok = buildOverviewHealth({ ...base, gateways: [{ id: 'g1', lastEventAt: '2026-09-19T11:00:00.000Z', lastEventStatus: 'ok: paid' }] })
assert(!ok.actions.some((action) => action.id === 'gateway-validation'), 'webhook confirmado deve concluir a validação do checkout')
assert.strictEqual(ok.setup.gateways.lastEventStatus, 'ok: paid')

const root = path.join(__dirname, '..')
const guide = fs.readFileSync(path.join(root, 'dashboard/components/overview/setup-guide.tsx'), 'utf8')
const settings = fs.readFileSync(path.join(root, 'dashboard/components/config/config-view.tsx'), 'utf8')

assert(guide.includes('gatewayValidated') && guide.includes('Valide a primeira venda'), 'onboarding deve permanecer até uma venda real ser processada')
assert(guide.includes('Configuração · {completed}/{steps.length}'), 'progresso deve refletir o número real de etapas')
assert(settings.includes('<SettingsOverview onSelect={selectTab} />'), 'resumo da conta deve navegar para a configuração correspondente')
assert(settings.includes("'/api/overview/analytics'") && settings.includes("'/api/ads/campaign-decisions'"), 'reset de histórico deve invalidar superfícies derivadas de vendas')
assert(settings.includes('apiCacheKeyMatches'), 'reset deve invalidar chaves parametrizadas e não apenas URLs exatas')

console.log('[OK] V16.25 — onboarding validado por webhook real e reset de dados coerente.')
