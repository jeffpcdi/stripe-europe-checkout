'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Middleware e utilitários de multi-moeda e persistência durável para checkouts
// e webhooks de conversão (BRL como moeda padrão do ecossistema).
// ─────────────────────────────────────────────────────────────────────────────

const REFERENCE_RATES_TO_BRL = {
  brl: 1.0,
  usd: 5.60,
  eur: 6.10,
  gbp: 7.20,
  cad: 4.10,
  aud: 3.70,
  chf: 6.40,
  jpy: 0.038,
  ars: 0.0058,
  clp: 0.0061,
  mxn: 0.28,
  cop: 0.0014,
  pen: 1.50,
  uyu: 0.14,
  pyg: 0.00075
};

function getReferenceRate(fromCurrency, toCurrency = 'brl') {
  const from = String(fromCurrency || 'brl').toLowerCase().trim();
  const to = String(toCurrency || 'brl').toLowerCase().trim();
  if (from === to) return 1.0;
  const fromRate = REFERENCE_RATES_TO_BRL[from] || 1.0;
  const toRate = REFERENCE_RATES_TO_BRL[to] || 1.0;
  return fromRate / toRate;
}

function normalizeTransactionToBrl(n, options = {}) {
  if (!n || typeof n !== 'object') return n;
  const currency = String(n.currency || 'brl').toLowerCase().trim();
  const rate = getReferenceRate(currency, 'brl');

  n.originalCurrency = currency;
  n.originalAmountCents = typeof n.amountCents === 'number' ? n.amountCents : 0;
  n.rateToBrl = rate;

  if (currency === 'brl') {
    n.amountCentsBrl = n.originalAmountCents;
    if (typeof n.feeCents === 'number') n.feeCentsBrl = n.feeCents;
    if (typeof n.taxCents === 'number') n.taxCentsBrl = n.taxCents;
    if (typeof n.netAmountCents === 'number') n.netAmountCentsBrl = n.netAmountCents;
    if (typeof n.productCostCents === 'number') n.productCostCentsBrl = n.productCostCents;
  } else {
    n.amountCentsBrl = Math.round(n.originalAmountCents * rate);
    if (typeof n.feeCents === 'number') n.feeCentsBrl = Math.round(n.feeCents * rate);
    if (typeof n.taxCents === 'number') n.taxCentsBrl = Math.round(n.taxCents * rate);
    if (typeof n.netAmountCents === 'number') n.netAmountCentsBrl = Math.round(n.netAmountCents * rate);
    if (typeof n.productCostCents === 'number') n.productCostCentsBrl = Math.round(n.productCostCents * rate);
  }

  if (options.accountId && !n.acc) {
    n.acc = options.accountId;
  }
  if (options.gateway && !n.gateway) {
    n.gateway = options.gateway;
  }

  return n;
}

function checkoutCurrencyMiddleware(req, res, next) {
  try {
    if (req.query && req.query.currency) {
      req.query.currency = String(req.query.currency).toLowerCase().trim();
    }
    if (req.body && typeof req.body === 'object' && req.body.currency) {
      req.body.currency = String(req.body.currency).toLowerCase().trim();
    }
  } catch (_) {}
  if (typeof next === 'function') next();
}

async function ensureConversionPersisted({ accountId, lead, event, database }) {
  if (!database) return false;
  const acc = accountId || (lead && lead.acc) || null;
  let persisted = false;

  try {
    if (lead && typeof database.upsertLead === 'function') {
      await database.upsertLead(acc, lead).catch((err) => {
        console.warn('[checkout-currency] upsertLead warning:', err && err.message);
      });
      persisted = true;
    }
    if (event && typeof database.insertEvent === 'function') {
      await database.insertEvent(acc, event).catch((err) => {
        console.warn('[checkout-currency] insertEvent warning:', err && err.message);
      });
      persisted = true;
    }
    return persisted;
  } catch (err) {
    console.warn('[checkout-currency] ensureConversionPersisted falhou:', err && err.message);
    return false;
  }
}

module.exports = {
  REFERENCE_RATES_TO_BRL,
  getReferenceRate,
  normalizeTransactionToBrl,
  checkoutCurrencyMiddleware,
  ensureConversionPersisted
};
