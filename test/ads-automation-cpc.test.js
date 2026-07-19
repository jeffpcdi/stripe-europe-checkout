'use strict';
/*
 * Refino do motor de automações: métrica cpc_max (custo por clique) e alerta
 * de criativo reprovado. cpc_max sem piso de cliques pausaria campanha com 2
 * cliques caros (ruído); o alerta de reprovação precisa ler o espelho com
 * status 'rejected' (a varredura padrão filtra 'active' e nunca os veria).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const automation = require('../ads-automation');

let n = 0;
function ok(cond, label) { assert.ok(cond, label); n++; console.log('  ✓ ' + label); }
function eq(a, b, label) { assert.strictEqual(a, b, label + ' → esperado ' + b + ', veio ' + a); n++; console.log('  ✓ ' + label); }

console.log('validateRules — cpc_max');
{
  const [r] = automation.validateRules([{ metric: 'cpc_max', threshold: 1.5, enabled: true }]);
  eq(r.metric, 'cpc_max', 'métrica aceita');
  eq(r.minClicks, 30, 'piso de cliques default = 30 (ruído não é sinal)');
  const [r2] = automation.validateRules([{ metric: 'cpc_max', threshold: 2, minClicks: 50 }]);
  eq(r2.minClicks, 50, 'piso custom respeitado');
  const [r3] = automation.validateRules([{ metric: 'cpc_max', threshold: 2, minClicks: 0 }]);
  eq(r3.minClicks, 30, 'piso 0 cai no default (nunca sem piso)');
}

console.log('Presets — CPC alto incluso e desligado de fábrica');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'ads-automation.js'), 'utf8');
  ok(/preset_cpc/.test(src), 'preset_cpc existe');
  ok(/'cpc_max'/.test(src.match(/const RULE_METRICS = \[[^\]]+\]/)[0]), 'cpc_max está em RULE_METRICS');
  const presetBlock = src.match(/id: 'preset_cpc'[\s\S]*?\},/)[0];
  ok(/enabled: false/.test(presetBlock), 'preset nasce desligado (nenhuma ação sem opt-in)');
  ok(/action: 'budget_down'/.test(presetBlock), 'ação do preset é reduzir orçamento');
}

console.log('Avaliador — branch de cpc_max no sweep');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'ads-automation.js'), 'utf8');
  ok(/r\.metric === 'cpc_max'[\s\S]{0,120}clicks >= \(r\.minClicks \|\| 30\)/.test(src), 'exige piso de cliques antes de agir');
  ok(/spend \/ clicks > r\.threshold/.test(src), 'compara CPC real com o teto');
}

console.log('Alerta de criativo reprovado');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'ads-automation.js'), 'utf8');
  ok(/cfg\.rejectedAds/.test(src), 'alerta é condicionado à config rejectedAds');
  ok(/status: 'rejected'/.test(src), 'segunda leitura do espelho com status rejected');
  ok(/rule: 'rejected_ads'/.test(src), 'finding com regra rejected_ads');
  const routes = fs.readFileSync(path.join(__dirname, '..', 'ads-routes.js'), 'utf8');
  ok(/rejectedAds: b\.rejectedAds === true/.test(routes), 'PUT /api/ads/alerts aceita rejectedAds (opt-in explícito)');
}

console.log('Automação cobrindo Smart+ (vigilância de reprovação)');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'ads-automation.js'), 'utf8');
  ok(/provider\.listSmartPlusAds/.test(src), 'sweep lê anúncios Smart+ (ao vivo)');
  ok(/smart_plus_rejected/.test(src), 'gera finding smart_plus_rejected');
  // best-effort: a leitura Smart+ é protegida por try/catch para nunca quebrar o sweep
  ok(/listSmartPlusAds\(advertiserId\)[\s\S]{0,400}catch/.test(src), 'leitura Smart+ é best-effort (try/catch)');
  ok(/cfg\.rejectedAds[\s\S]{0,1600}listSmartPlusAds/.test(src), 'Smart+ só é vigiado com o alerta de reprovação ligado');
}

console.log('\nads-automation-cpc: ' + n + ' asserts OK');
