'use strict';

const assert = require('assert');
const windowing = require('../ads-automation-window');

const {
  DEFAULT_TIME_ZONE,
  normalizeTimeZone,
  civilDay,
  normalizeLookbackDays,
  inclusiveWindow,
  groupRulesByWindow,
  compareActionsConservatively,
  conservativeAction,
} = windowing;

// 01:30 UTC ainda pertence ao dia anterior em Brasília.
const nearUtcMidnight = new Date('2026-07-28T01:30:00.000Z');
assert.strictEqual(civilDay(nearUtcMidnight, 'UTC'), '2026-07-28');
assert.strictEqual(civilDay(nearUtcMidnight, DEFAULT_TIME_ZONE), '2026-07-27');

// Lisboa já está em UTC+1 depois da transição de DST de março de 2026.
const lisbonDst = new Date('2026-03-29T23:30:00.000Z');
assert.strictEqual(normalizeTimeZone('Europe/Lisbon'), 'Europe/Lisbon');
assert.strictEqual(civilDay(lisbonDst, 'UTC'), '2026-03-29');
assert.strictEqual(civilDay(lisbonDst, 'Europe/Lisbon'), '2026-03-30');

// Fuso inválido nunca vaza para o Intl nem muda silenciosamente o dia padrão.
assert.strictEqual(normalizeTimeZone('Fuso/Inexistente'), DEFAULT_TIME_ZONE);
assert.strictEqual(normalizeTimeZone('', 'Europe/Lisbon'), 'Europe/Lisbon');
assert.strictEqual(civilDay(nearUtcMidnight, 'Fuso/Inexistente'), '2026-07-27');

// Janela inclusiva: 1 dia = hoje; 7 dias = hoje + seis anteriores.
assert.deepStrictEqual(inclusiveWindow(nearUtcMidnight, 1, DEFAULT_TIME_ZONE), {
  timeZone: DEFAULT_TIME_ZONE,
  lookbackDays: 1,
  fromDate: '2026-07-27',
  toDate: '2026-07-27',
});
assert.deepStrictEqual(inclusiveWindow(nearUtcMidnight, 7, DEFAULT_TIME_ZONE), {
  timeZone: DEFAULT_TIME_ZONE,
  lookbackDays: 7,
  fromDate: '2026-07-21',
  toDate: '2026-07-27',
});
assert.strictEqual(normalizeLookbackDays(0), 1);
assert.strictEqual(normalizeLookbackDays(31), 30);

// Regras com a mesma janela civil compartilham uma consulta. O fuso pertence
// ao advertiser: um campo legado na regra nunca desloca a janela sozinho.
const rules = [
  { id: 'hoje-a', lookbackDays: 1 },
  { id: 'hoje-b', lookbackDays: 1, timezone: 'Fuso/Inexistente' },
  { id: 'semana', lookbackDays: 7 },
  { id: 'lisboa', lookbackDays: 1, timezone: 'Europe/Lisbon' },
];
const groups = groupRulesByWindow(rules, {
  now: nearUtcMidnight,
  timeZone: DEFAULT_TIME_ZONE,
});
assert.strictEqual(groups.length, 2);
assert.deepStrictEqual(groups.map((group) => group.rules.map((rule) => rule.id)), [
  ['hoje-a', 'hoje-b', 'lisboa'],
  ['semana'],
]);
assert.deepStrictEqual(
  groups.map((group) => [group.timeZone, group.fromDate, group.toDate]),
  [
    [DEFAULT_TIME_ZONE, '2026-07-27', '2026-07-27'],
    [DEFAULT_TIME_ZONE, '2026-07-21', '2026-07-27'],
  ],
);

// A resolução de conflitos é sempre conservadora, independentemente da ordem.
const actions = ['activate', 'budget_up', 'budget_down', 'pause'];
assert.deepStrictEqual([...actions].sort(compareActionsConservatively), [
  'pause',
  'budget_down',
  'budget_up',
  'activate',
]);
assert.strictEqual(conservativeAction(actions), 'pause');
assert.strictEqual(conservativeAction(['activate', 'budget_up']), 'budget_up');
assert.strictEqual(conservativeAction([{ action: 'activate' }, { action: 'budget_down' }]), 'budget_down');
assert.strictEqual(conservativeAction(['desconhecida']), null);

console.log('ads-automation-window.test.js OK — fuso, janelas inclusivas, agrupamento e precedência validados');
