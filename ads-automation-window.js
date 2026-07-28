'use strict';

// Contrato puro das janelas de avaliação da automação TikTok Ads.
// Datas são civis no fuso escolhido: uma janela de 1 dia contém somente hoje;
// uma janela de 7 dias contém hoje e os seis dias civis anteriores.

const DEFAULT_TIME_ZONE = 'America/Sao_Paulo';
const ACTION_PRECEDENCE = Object.freeze({
  pause: 4,
  budget_down: 3,
  budget_up: 2,
  activate: 1,
});

function canonicalTimeZone(value) {
  const candidate = String(value || '').trim();
  if (!candidate) return null;
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: candidate })
      .resolvedOptions()
      .timeZone;
  } catch (_) {
    return null;
  }
}

function normalizeTimeZone(value, fallback = DEFAULT_TIME_ZONE) {
  return canonicalTimeZone(value)
    || canonicalTimeZone(fallback)
    || DEFAULT_TIME_ZONE;
}

function validDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new RangeError('Data inválida para a janela da automação');
  return date;
}

function civilDay(value = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  const date = validDate(value);
  const zone = normalizeTimeZone(timeZone);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type) => (parts.find((part) => part.type === type) || {}).value || '';
  return get('year') + '-' + get('month') + '-' + get('day');
}

function normalizeLookbackDays(value) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(30, parsed));
}

function shiftCivilDay(day, offsetDays) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''));
  if (!match) throw new RangeError('Dia civil inválido para a janela da automação');
  const shifted = new Date(Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]) + Number(offsetDays || 0),
  ));
  return shifted.toISOString().slice(0, 10);
}

function inclusiveWindow(value = new Date(), lookbackDays = 1, timeZone = DEFAULT_TIME_ZONE) {
  const zone = normalizeTimeZone(timeZone);
  const days = normalizeLookbackDays(lookbackDays);
  const toDate = civilDay(value, zone);
  return {
    timeZone: zone,
    lookbackDays: days,
    fromDate: shiftCivilDay(toDate, -(days - 1)),
    toDate,
  };
}

function groupRulesByWindow(rules, options = {}) {
  const now = options.now == null ? new Date() : validDate(options.now);
  const advertiserZone = normalizeTimeZone(options.timeZone);
  const groups = new Map();

  for (const rule of Array.isArray(rules) ? rules : []) {
    if (!rule || typeof rule !== 'object') continue;
    const window = inclusiveWindow(
      now,
      rule.lookbackDays,
      advertiserZone,
    );
    const key = window.timeZone + '|' + window.fromDate + '|' + window.toDate;
    if (!groups.has(key)) groups.set(key, { key, ...window, rules: [] });
    groups.get(key).rules.push(rule);
  }

  return [...groups.values()];
}

function actionPriority(action) {
  const value = typeof action === 'string' ? action : action && action.action;
  return ACTION_PRECEDENCE[String(value || '')] || 0;
}

function compareActionsConservatively(left, right) {
  return actionPriority(right) - actionPriority(left);
}

function conservativeAction(actions) {
  let selected = null;
  let selectedPriority = 0;
  for (const value of Array.isArray(actions) ? actions : []) {
    const action = typeof value === 'string' ? value : value && value.action;
    const priority = actionPriority(action);
    if (priority > selectedPriority) {
      selected = action;
      selectedPriority = priority;
    }
  }
  return selected;
}

module.exports = {
  DEFAULT_TIME_ZONE,
  ACTION_PRECEDENCE,
  normalizeTimeZone,
  civilDay,
  shiftCivilDay,
  normalizeLookbackDays,
  inclusiveWindow,
  groupRulesByWindow,
  actionPriority,
  compareActionsConservatively,
  conservativeAction,
};
