'use strict'
const assert = require('node:assert/strict')
const profit = require('../profit-engine')

const sale = [{ type: 'sale', at: '2026-09-15T12:00:00Z', amount: 10000, currency: 'BRL', gateway: 'generic' }]
const base = { fromDate: '2026-09-15', toDate: '2026-09-15', timeZone: 'UTC', adSpendExact: true }

const brl = profit.calculate(sale, 0, {
  ...base,
  currency: 'BRL',
  config: { gatewayFeePct: 10, gatewayFixedFeeCents: 200, productCostPct: 10, productCostFixedCents: 300, fixedCostCurrency: 'BRL' },
})
assert.equal(brl.gatewayFeesCents, 1200, 'BRL aplica percentual + taxa fixa BRL')
assert.equal(brl.productCostsCents, 1300, 'BRL aplica percentual + custo fixo BRL')
assert.equal(brl.fixedCostCurrencyMismatch, false)

const usdSale = [{ ...sale[0], currency: 'USD' }]
const mismatch = profit.calculate(usdSale, 0, {
  ...base,
  currency: 'USD',
  config: { gatewayFeePct: 10, gatewayFixedFeeCents: 200, productCostPct: 10, productCostFixedCents: 300, fixedCostCurrency: 'BRL' },
})
assert.equal(mismatch.gatewayFeesCents, 1000, 'USD mantém percentual e não reinterpreta R$ 2 como US$ 2')
assert.equal(mismatch.productCostsCents, 1000, 'USD mantém percentual e não reinterpreta custo fixo BRL')
assert.equal(mismatch.fixedCostCurrencyMismatch, true)
assert.equal(mismatch.quality, 'mixed')
assert.match(mismatch.note, /não foram aplicados ao resultado em USD/)

const usd = profit.calculate(usdSale, 0, {
  ...base,
  currency: 'USD',
  config: { gatewayFeePct: 10, gatewayFixedFeeCents: 200, productCostPct: 10, productCostFixedCents: 300, fixedCostCurrency: 'USD' },
})
assert.equal(usd.gatewayFeesCents, 1200)
assert.equal(usd.productCostsCents, 1300)
assert.equal(usd.fixedCostCurrencyMismatch, false)

const exact = profit.calculate([{ ...usdSale[0], feeCents: 50, productCostCents: 75 }], 0, {
  ...base,
  currency: 'USD',
  config: { gatewayFeePct: 99, gatewayFixedFeeCents: 200, productCostPct: 99, productCostFixedCents: 300, fixedCostCurrency: 'BRL' },
})
assert.equal(exact.gatewayFeesCents, 50, 'valor exato do webhook continua tendo prioridade')
assert.equal(exact.productCostsCents, 75, 'custo exato do webhook continua tendo prioridade')
assert.equal(exact.fixedCostCurrencyMismatch, false, 'fixo incompatível irrelevante não cria warning quando valor exato existe')

const override = profit.calculate([{ ...usdSale[0], gateway: 'stripe' }], 0, {
  ...base,
  currency: 'USD',
  config: { gatewayFeePct: 1, gatewayFixedFeeCents: 0, productCostPct: 0, productCostFixedCents: 0, fixedCostCurrency: 'BRL', gatewayOverrides: { stripe: { feePct: 3, fixedFeeCents: 250 } } },
})
assert.equal(override.gatewayFeesCents, 300, 'percentual do override continua aplicado')
assert.equal(override.fixedCostCurrencyMismatch, true, 'fixo do override respeita a mesma moeda configurada')

console.log('[OK] profitability V16.7 — custos fixos respeitam moeda sem conversão cambial implícita.')
