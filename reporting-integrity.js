'use strict';

// Núcleo puro usado pela auditoria V11. Mantém receita, atribuição, moeda e
// janela temporal alinhadas antes de derivar ROAS/lucro.

const DEFAULT_TIME_ZONE = 'America/Sao_Paulo';
const DAY_FORMATTERS = new Map();

function safeTimeZone(value) {
  const zone = String(value || '').trim() || DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(new Date());
    return zone;
  } catch (_) {
    return DEFAULT_TIME_ZONE;
  }
}

function dayAt(value, timeZone) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const zone = safeTimeZone(timeZone);
  let formatter = DAY_FORMATTERS.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric', month: '2-digit', day: '2-digit',
    });
    DAY_FORMATTERS.set(zone, formatter);
  }
  return formatter.format(date);
}

function moneyCurrency(value, fallback = 'BRL') {
  const currency = String(value || fallback).trim().toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : fallback;
}


function periodRange(period, now, timeZone) {
  const zone = safeTimeZone(timeZone);
  const toDate = dayAt(now || new Date(), zone);
  const days = period === 'today' ? 1 : period === '7d' ? 7 : period === '30d' ? 30 : 365;
  const [year, month, day] = toDate.split('-').map(Number);
  const fromUtc = new Date(Date.UTC(year, month - 1, day - (days - 1), 12));
  const fromDate = dayAt(fromUtc, 'UTC');
  return { fromDate, toDate, days, timeZone: zone };
}

function inRange(value, fromDate, toDate, timeZone) {
  const day = dayAt(value, timeZone);
  return !!day && day >= fromDate && day <= toDate;
}

function pickDominant(groups) {
  const entries = Object.entries(groups || {});
  if (!entries.length) return null;
  entries.sort((a, b) => {
    const revenue = (Number(b[1].revenueCents) || 0) - (Number(a[1].revenueCents) || 0);
    if (revenue) return revenue;
    return (Number(b[1].sales) || 0) - (Number(a[1].sales) || 0);
  });
  return entries[0][0];
}

function summarizeRevenueEvents(events, { fromDate, toDate, timeZone, fallbackCurrency = 'BRL' }) {
  const groups = {};
  for (const event of Array.isArray(events) ? events : []) {
    if (!event || event.type !== 'sale' || !inRange(event.at || event.convertedAt, fromDate, toDate, timeZone)) continue;
    const currency = moneyCurrency(event.currency, fallbackCurrency);
    const group = groups[currency] || (groups[currency] = { revenueCents: 0, sales: 0, daily: {} });
    const cents = Math.max(0, Number(event.amount) || 0);
    const day = dayAt(event.at || event.convertedAt, timeZone);
    group.revenueCents += cents;
    group.sales += 1;
    group.daily[day] = group.daily[day] || { revenueCents: 0, sales: 0 };
    group.daily[day].revenueCents += cents;
    group.daily[day].sales += 1;
  }
  const currency = pickDominant(groups);
  const selected = currency ? groups[currency] : { revenueCents: 0, sales: 0, daily: {} };
  return { currency, groups, ...selected };
}

function isTikTokLead(lead) {
  const source = String(lead && lead.utm && lead.utm.source || '').trim().toLowerCase();
  return source === 'tiktok' || !!(lead && lead.ttclid);
}

function summarizeAttributedLeads(leads, { fromDate, toDate, timeZone, fallbackCurrency = 'BRL' }) {
  const groups = {};
  for (const lead of Array.isArray(leads) ? leads : []) {
    if (!lead || lead.stage !== 'purchased' || !isTikTokLead(lead)) continue;
    const convertedAt = lead.convertedAt || lead.purchasedAt || lead.at;
    if (!inRange(convertedAt, fromDate, toDate, timeZone)) continue;
    const currency = moneyCurrency(lead.reportedCurrency || lead.currency, fallbackCurrency);
    const cents = Math.max(0, Number(lead.reportedAmount != null ? lead.reportedAmount : lead.amount) || 0);
    const day = dayAt(convertedAt, timeZone);
    const group = groups[currency] || (groups[currency] = { revenueCents: 0, sales: 0, daily: {} });
    group.revenueCents += cents;
    group.sales += 1;
    group.daily[day] = group.daily[day] || { revenueCents: 0, sales: 0 };
    group.daily[day].revenueCents += cents;
    group.daily[day].sales += 1;
  }
  const currency = pickDominant(groups);
  const selected = currency ? groups[currency] : { revenueCents: 0, sales: 0, daily: {} };
  return { currency, groups, ...selected };
}


function summarizeConversion(leads, { fromDate, toDate, timeZone }) {
  let visits = 0;
  let purchased = 0;
  for (const lead of Array.isArray(leads) ? leads : []) {
    if (!lead || lead.orphan || !inRange(lead.at, fromDate, toDate, timeZone)) continue;
    visits += 1;
    const convertedAt = lead.convertedAt || lead.purchasedAt || (lead.stage === 'purchased' ? lead.at : null);
    if (lead.stage === 'purchased' && convertedAt && inRange(convertedAt, fromDate, toDate, timeZone)) purchased += 1;
  }
  return { visits, purchased, conversionPct: visits > 0 ? Math.round((purchased / visits) * 1000) / 10 : 0 };
}

function deriveRoas({ spend, spendCurrency, revenueCents, revenueCurrency, sales }) {
  const safeSpend = Math.max(0, Number(spend) || 0);
  const spendCur = moneyCurrency(spendCurrency, 'BRL');
  const revenueCur = revenueCurrency ? moneyCurrency(revenueCurrency, 'BRL') : null;
  const currencyMismatch = !!(safeSpend > 0 && revenueCents > 0 && revenueCur && revenueCur !== spendCur);
  return {
    currencyMismatch,
    roas: currencyMismatch ? null : (safeSpend > 0 ? +((Number(revenueCents || 0) / 100) / safeSpend).toFixed(2) : 0),
    cpa: safeSpend > 0 && Number(sales || 0) > 0 ? +(safeSpend / Number(sales)).toFixed(2) : null,
  };
}

module.exports = {
  DEFAULT_TIME_ZONE,
  safeTimeZone,
  dayAt,
  periodRange,
  inRange,
  summarizeRevenueEvents,
  summarizeAttributedLeads,
  summarizeConversion,
  deriveRoas,
  _internals: { moneyCurrency, pickDominant, isTikTokLead },
};
