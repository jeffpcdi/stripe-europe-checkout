'use strict';
/*
 * resolveBudgetPlan — mapeia a escolha ABO/CBO + estratégia de lance do gestor
 * para os campos reais do TikTok (create_tiktok_campaign / create_tiktok_adgroup).
 * Um mapeamento errado cria a campanha com o orçamento no nível errado ou com
 * lance inválido — a plataforma rejeita ou entrega de forma inesperada.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const provider = require('../ads-provider');
const rb = provider._internals.resolveBudgetPlan;

let n = 0;
function ok(cond, label) { assert.ok(cond, label); n++; console.log('  ✓ ' + label); }
function eq(a, b, label) { assert.deepStrictEqual(a, b, label); n++; console.log('  ✓ ' + label); }
function throwsWith(fn, pattern, label) {
  assert.throws(fn, pattern, label); n++; console.log('  ✓ ' + label);
}

console.log('ABO (padrão) — orçamento no ad group');
{
  const p = rb({ budgetOptimization: 'adgroup', budgetType: 'daily', budgetAmount: 50 });
  eq(p.cbo, false, 'não é CBO');
  eq(p.campaign, {}, 'campanha não recebe orçamento');
  eq(p.adgroup, { budget_mode: 'BUDGET_MODE_DAY', budget: 50 }, 'ad group leva o orçamento diário');
  eq(p.bid, { bid_type: 'BID_TYPE_NO_BID' }, 'lance padrão = máxima entrega');
  eq(p.delivery, { delivery_mode: 'STANDARD' }, 'entrega padrão é explícita');
}

console.log('CBO — orçamento na campanha, ad group INFINITE');
{
  const p = rb({ budgetOptimization: 'campaign', budgetType: 'daily', budgetAmount: 100 });
  eq(p.cbo, true, 'é CBO');
  eq(p.campaign, { budget_mode: 'BUDGET_MODE_DAY', budget: 100, budget_optimize_on: true }, 'campanha com budget_optimize_on');
  eq(p.adgroup, { budget_mode: 'BUDGET_MODE_INFINITE' }, 'ad group sem orçamento próprio');
}

console.log('CBO + total (lifetime)');
{
  const p = rb({ budgetOptimization: 'campaign', budgetType: 'lifetime', budgetAmount: 500 });
  eq(p.campaign.budget_mode, 'BUDGET_MODE_TOTAL', 'modo total na campanha');
}

console.log('Estratégia de lance — custo-alvo');
{
  const conv = rb({ budgetType: 'daily', budgetAmount: 40, bidStrategy: 'cost_cap', bidAmount: 8, goal: 'conversions' });
  eq(conv.bid, { bid_type: 'BID_TYPE_CUSTOM', conversion_bid_price: 8 }, 'conversões usam conversion_bid_price');
  const traffic = rb({ budgetType: 'daily', budgetAmount: 30, bidStrategy: 'cost_cap', bidAmount: 0.5, goal: 'traffic' });
  eq(traffic.bid, { bid_type: 'BID_TYPE_CUSTOM', bid_price: 0.5 }, 'tráfego usa bid_price');
  const catalog = rb({ budgetType: 'daily', budgetAmount: 50, bidStrategy: 'cost_cap', bidAmount: 12, optimizationGoal: 'CONVERT', billingEvent: 'OCPM' });
  eq(catalog.bid, { bid_type: 'BID_TYPE_CUSTOM', conversion_bid_price: 12 }, 'catálogo CONVERT + OCPM usa custo por conversão mesmo sem goal genérico');
  throwsWith(() => rb({ bidStrategy: 'cost_cap', budgetType: 'daily', budgetAmount: 20 }), /valor de lance maior que zero/i, 'cost_cap sem valor falha fechado');
}

console.log('Entrega acelerada — somente ABO + Cost Cap');
{
  const accelerated = rb({ budgetOptimization: 'adgroup', budgetType: 'daily', budgetAmount: 50, bidStrategy: 'cost_cap', bidAmount: 10, goal: 'conversions', deliveryMode: 'accelerated' });
  eq(accelerated.delivery, { delivery_mode: 'ACCELERATED' }, 'ABO + Cost Cap envia ACCELERATED');
  throwsWith(() => rb({ budgetOptimization: 'adgroup', budgetAmount: 50, deliveryMode: 'accelerated' }), /exige estratégia cost_cap/i, 'máxima entrega não aceita aceleração');
  throwsWith(() => rb({ budgetOptimization: 'campaign', budgetAmount: 100, bidStrategy: 'cost_cap', bidAmount: 10, deliveryMode: 'accelerated' }), /orçamento no conjunto/i, 'CBO não aceita aceleração');
}

console.log('Rota /api/ads/create — valida e propaga ABO/CBO/bid');
{
  const routes = fs.readFileSync(path.join(__dirname, '..', 'ads-provider.js'), 'utf8');
  const routesTxt = fs.readFileSync(path.join(__dirname, '..', 'ads-routes.js'), 'utf8');
  ok(/budgetOptimization === 'campaign' \? 'campaign' : 'adgroup'/.test(routesTxt), 'buildCreatePayload normaliza budgetOptimization');
  ok(/bidStrategy === 'cost_cap'/.test(routesTxt), 'buildCreatePayload trata cost_cap');
  ok(/exige um valor de lance/.test(routesTxt), 'cost_cap sem valor é rejeitado na rota');
  ok(/budgetOptimization: payload\.budgetOptimization/.test(routesTxt), 'create propaga budgetOptimization ao provider');
  ok(/budget_optimize_on = true/.test(routes), 'provider ativa CBO com budget_optimize_on');
}

console.log('\nads-budget-plan: ' + n + ' asserts OK');
