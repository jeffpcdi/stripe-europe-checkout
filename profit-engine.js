'use strict';

// Lucro líquido auditável. Toda entrada monetária usa centavos; o gasto do
// TikTok chega em unidade maior e é convertido uma única vez na fronteira.
// Custos exatos do webhook vencem os percentuais configurados. O resultado
// expõe a cobertura para a UI nunca chamar uma estimativa de valor "exato".

function cents(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

function pct(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
}

function dayAt(value, timeZone) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || 'America/Sao_Paulo',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(date);
  } catch (_) {
    return date.toISOString().slice(0, 10);
  }
}

function configuredFee(event, config) {
  const gateway = String(event.gateway || 'generic').toLowerCase();
  const override = config.gatewayOverrides && config.gatewayOverrides[gateway] || {};
  return {
    feePct: pct(override.feePct != null ? override.feePct : config.gatewayFeePct),
    fixedFeeCents: cents(override.fixedFeeCents != null ? override.fixedFeeCents : config.gatewayFixedFeeCents) || 0,
  };
}

function calculate(events, adSpendMajor, options) {
  const opts = options || {};
  const currency = String(opts.currency || 'BRL').toUpperCase();
  const fromDate = String(opts.fromDate || '0000-00-00');
  const toDate = String(opts.toDate || '9999-99-99');
  const timeZone = opts.timeZone || 'America/Sao_Paulo';
  const config = opts.config || {};
  const rows = (Array.isArray(events) ? events : []).filter((event) => {
    const day = dayAt(event.at, timeZone);
    return day >= fromDate && day <= toDate
      && String(event.currency || currency).toUpperCase() === currency;
  });
  const sales = rows.filter((event) => event.type === 'sale');
  const refunds = rows.filter((event) => event.type === 'refund');
  const disputes = rows.filter((event) => event.type === 'dispute');
  let grossRevenueCents = 0;
  let refundCents = 0;
  let disputeCents = 0;
  let gatewayFeesCents = 0;
  let taxesCents = 0;
  let productCostsCents = 0;
  let exactFees = 0;
  let exactTaxes = 0;
  let exactProductCosts = 0;

  for (const event of sales) {
    const gross = cents(event.amount) || 0;
    grossRevenueCents += gross;

    const exactTax = cents(event.taxCents);
    const tax = exactTax == null ? Math.round(gross * pct(config.taxPct) / 100) : exactTax;
    taxesCents += tax;
    if (exactTax != null) exactTaxes++;

    let exactFee = cents(event.feeCents);
    const net = cents(event.netAmountCents);
    if (exactFee == null && net != null && gross >= net + tax) exactFee = gross - net - tax;
    if (exactFee == null) {
      const fallback = configuredFee(event, config);
      gatewayFeesCents += Math.round(gross * fallback.feePct / 100) + fallback.fixedFeeCents;
    } else {
      gatewayFeesCents += exactFee;
      exactFees++;
    }

    const exactCost = cents(event.productCostCents);
    if (exactCost == null) {
      productCostsCents += Math.round(gross * pct(config.productCostPct) / 100)
        + (cents(config.productCostFixedCents) || 0);
    } else {
      productCostsCents += exactCost;
      exactProductCosts++;
    }
  }

  for (const event of refunds) refundCents += cents(event.amount) || 0;
  for (const event of disputes) disputeCents += cents(event.amount) || 0;
  const adSpendCents = Math.max(0, Math.round((Number(adSpendMajor) || 0) * 100));
  const netRevenueCents = grossRevenueCents - refundCents - disputeCents
    - gatewayFeesCents - taxesCents - productCostsCents;
  const netProfitCents = netRevenueCents - adSpendCents;
  const contributionBeforeAdsCents = grossRevenueCents
    - refundCents - disputeCents - gatewayFeesCents - taxesCents - productCostsCents;

  const coverage = {
    feeExactPct: sales.length ? Math.round(exactFees / sales.length * 1000) / 10 : 100,
    taxExactPct: sales.length ? Math.round(exactTaxes / sales.length * 1000) / 10 : 100,
    productCostExactPct: sales.length ? Math.round(exactProductCosts / sales.length * 1000) / 10 : 100,
    adSpendExact: opts.adSpendExact === true,
  };
  const allExact = coverage.feeExactPct === 100 && coverage.taxExactPct === 100
    && coverage.productCostExactPct === 100 && coverage.adSpendExact;

  return {
    currency,
    fromDate,
    toDate,
    timeZone,
    sales: sales.length,
    refunds: refunds.length,
    disputes: disputes.length,
    grossRevenueCents,
    refundCents,
    disputeCents,
    gatewayFeesCents,
    taxesCents,
    productCostsCents,
    adSpendCents,
    contributionBeforeAdsCents,
    netRevenueCents,
    netProfitCents,
    netMarginPct: grossRevenueCents ? Math.round(netProfitCents / grossRevenueCents * 1000) / 10 : 0,
    roas: adSpendCents ? Math.round(grossRevenueCents / adSpendCents * 100) / 100 : 0,
    coverage,
    quality: allExact ? 'exact' : 'mixed',
    note: allExact
      ? 'Tarifas, impostos, custos e mídia vieram de fontes exatas.'
      : 'Os itens sem valor no webhook usam a configuração da conta e aparecem como estimativa.',
  };
}

module.exports = { calculate, dayAt, configuredFee, _internals: { cents, pct } };
