'use strict';
/*
 * Filtro "Validadas" (approved) — dimensão de REVISÃO, não de entrega. Uma
 * campanha validada aparece como 'active'; por isso o filtro precisa olhar o
 * reviewStatus em AMBOS os caminhos de leitura (espelho Neon e live), senão
 * "Validadas" mostraria vazio ou a lista errada.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
function ok(cond, label) { assert.ok(cond, label); n++; console.log('  ✓ ' + label); }

const cache = fs.readFileSync(path.join(__dirname, '..', 'ads-cache-store.js'), 'utf8');
const provider = fs.readFileSync(path.join(__dirname, '..', 'ads-provider.js'), 'utf8');
const tree = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'components', 'ads', 'campaign-tree.tsx'), 'utf8');

console.log('Backend — filtro approved por reviewStatus nos dois caminhos');
{
  ok(/opts\.status === 'approved'[\s\S]{0,120}reviewStatus === 'approved'/.test(cache), 'espelho Neon filtra approved por reviewStatus');
  ok(/opts\.status === 'approved'[\s\S]{0,120}reviewStatus === 'approved'/.test(provider), 'caminho live filtra approved por reviewStatus');
  ok(!/c\.status === statusFilter \|\| c\.childStatus === statusFilter/.test(cache), 'espelho mantém filtros de entrega mutuamente exclusivos');
  ok(!/c\.status === statusFilter \|\| c\.childStatus === statusFilter/.test(provider), 'caminho live mantém filtros de entrega mutuamente exclusivos');
}

console.log('Frontend — chip Validadas + selo na campanha');
{
  ok(/value: 'approved', label: 'Validadas'/.test(tree), 'chip "Validadas" existe');
  ok(/reviewStatus === 'approved'/.test(tree), 'selo condicionado a reviewStatus approved');
  ok(/BadgeCheck/.test(tree), 'ícone do selo importado/usado');
}

console.log('\nads-review-filter: ' + n + ' asserts OK');
