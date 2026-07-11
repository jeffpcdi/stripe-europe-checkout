'use strict';
/*
 * Item 458 — parseAmount/pickAmountCents: formatos BR/EU/US divergem e um
 * parse errado gera valor 100x (ou 1000x) na receita. Cada caso aqui é um
 * formato REAL que gateways mandam. Se algum falhar, a receita do painel
 * está errada — trate como incidente, não como "teste chato".
 */
const assert = require('assert');
const { parseAmount, pickAmountCents } = require('../conversion-normalize');

let n = 0;
function eq(actual, expected, label) {
  assert.strictEqual(actual, expected, label + ' → esperado ' + expected + ', veio ' + actual);
  n++;
  console.log('  ✓ ' + label);
}
function isNan(actual, label) {
  assert.ok(Number.isNaN(actual), label + ' → esperado NaN, veio ' + actual);
  n++;
  console.log('  ✓ ' + label);
}

console.log('parseAmount — números e strings simples');
eq(parseAmount(49.9), 49.9, 'número puro 49.9');
eq(parseAmount(0), 0, 'zero');
eq(parseAmount('49.90'), 49.9, 'string US "49.90"');
eq(parseAmount('49,90'), 49.9, 'string BR "49,90"');
eq(parseAmount('R$ 49,90'), 49.9, 'moeda BR "R$ 49,90"');
eq(parseAmount('€ 12.97'), 12.97, 'moeda EU "€ 12.97"');
eq(parseAmount('$1,234.56'), 1234.56, 'US com milhar "$1,234.56"');
eq(parseAmount('1.234,56'), 1234.56, 'BR com milhar "1.234,56"');

console.log('parseAmount — o caso perigoso: ponto de MILHAR sem decimal');
eq(parseAmount('1.234'), 1234, '"1.234" é milhar BR (1234), NÃO 1.234');
eq(parseAmount('12.345.678'), 12345678, '"12.345.678" milhares encadeados');
eq(parseAmount('12.34'), 12.34, '"12.34" é decimal legítimo (2 casas)');
eq(parseAmount('1.2345'), 1.2345, '"1.2345" é decimal legítimo (4 casas)');
eq(parseAmount('0.234'), 0.234, '"0.234" é decimal (milhar nunca inicia em 0)');

console.log('parseAmount — objetos de gateway e lixo');
eq(parseAmount({ value: 49.9 }), 49.9, 'objeto Hotmart { value }');
eq(parseAmount({ amount: 12.5 }), 12.5, 'objeto { amount }');
isNan(parseAmount(null), 'null');
isNan(parseAmount(undefined), 'undefined');
isNan(parseAmount(''), 'string vazia');
isNan(parseAmount('abc'), 'string sem dígitos');
isNan(parseAmount({}), 'objeto vazio');

console.log('pickAmountCents — campos em centavos NÃO multiplicam por 100');
eq(pickAmountCents({ charge_amount: 4990 }), 4990, 'Kiwify charge_amount=4990 → 4990 cents');
eq(pickAmountCents({ amount_cents: '1290' }), 1290, 'amount_cents string → 1290 cents');
eq(pickAmountCents({ amount: 49.9 }), 4990, 'amount unitário 49.9 → 4990 cents');
eq(pickAmountCents({ value: '49,90' }), 4990, 'value BR "49,90" → 4990 cents');
eq(pickAmountCents({ price: '1.234' }), 123400, 'price milhar BR "1.234" → 123400 cents');
eq(pickAmountCents({}), null, 'sem campo de valor → null');
eq(pickAmountCents({ amount: -5 }), null, 'valor negativo rejeitado');
eq(pickAmountCents({ amount: 99999999 }), null, 'unitário acima do teto (1M) rejeitado');
// prioridade: campo em centavos vence o unitário quando ambos existem
eq(pickAmountCents({ charge_amount: 4990, amount: 49.9 }), 4990, 'centavos tem prioridade sobre unitário');

console.log('\nparse-amount: ' + n + ' asserts OK');
