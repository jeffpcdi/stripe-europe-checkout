'use strict';

// Janelas civis da Visão Geral. O backend é a autoridade do recorte temporal
// para que o agregado durável do Neon use a mesma semântica da UI.
const DEFAULT_TIME_ZONE = 'America/Sao_Paulo';
const PERIODS = new Set(['today', '7d', '30d', 'all']);

const partsFormatterCache = new Map();

function safeTimeZone(value) {
  const candidate = String(value || DEFAULT_TIME_ZONE);
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(new Date());
    return candidate;
  } catch (_) {
    return DEFAULT_TIME_ZONE;
  }
}

function partsFormatter(timeZone) {
  const tz = safeTimeZone(timeZone);
  let formatter = partsFormatterCache.get(tz);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    partsFormatterCache.set(tz, formatter);
  }
  return formatter;
}

function zonedParts(date, timeZone) {
  const parts = Object.fromEntries(partsFormatter(timeZone).formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second),
  };
}

function offsetMs(date, timeZone) {
  const p = zonedParts(date, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - date.getTime();
}

function zonedMidnight(year, month, day, timeZone) {
  const tz = safeTimeZone(timeZone);
  const utc = Date.UTC(year, month - 1, day);
  let result = new Date(utc - offsetMs(new Date(utc), tz));
  // Segunda passagem cobre mudança de offset/DST na fronteira do dia.
  result = new Date(utc - offsetMs(result, tz));
  return result;
}

function periodWindow(period, timeZone, nowValue) {
  const normalizedPeriod = PERIODS.has(String(period)) ? String(period) : '30d';
  const tz = safeTimeZone(timeZone);
  const now = nowValue instanceof Date ? new Date(nowValue.getTime()) : new Date(nowValue || Date.now());
  const p = zonedParts(now, tz);
  const back = normalizedPeriod === 'today' ? 0 : normalizedPeriod === '7d' ? 6 : normalizedPeriod === '30d' ? 29 : 364;
  const target = new Date(Date.UTC(p.year, p.month - 1, p.day - back));
  const curFrom = zonedMidnight(target.getUTCFullYear(), target.getUTCMonth() + 1, target.getUTCDate(), tz);
  const span = now.getTime() - curFrom.getTime();
  return {
    period: normalizedPeriod,
    timeZone: tz,
    curFrom,
    curTo: now,
    prevFrom: new Date(curFrom.getTime() - span),
    prevTo: curFrom,
  };
}

module.exports = { DEFAULT_TIME_ZONE, safeTimeZone, periodWindow, zonedMidnight };
