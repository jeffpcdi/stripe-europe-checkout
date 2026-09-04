'use strict';

// Comparação Bayesiana Beta-Binomial sem dependências. O posterior de cada
// variante usa prior Beta(1,1); a probabilidade entre duas Betas é aproximada
// pela diferença normal, suficiente para encerrar cedo apenas com guarda de
// volume e confiança alta. A decisão e seus motivos ficam serializáveis.

function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t
    - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return sign * y;
}

function normalCdf(x) {
  return 0.5 * (1 + erf(x / Math.sqrt(2)));
}

function posterior(variant) {
  const rawConversions = Math.max(0, Math.round(Number(variant.conversions) || 0));
  const clicks = Math.max(rawConversions, Math.max(0, Math.round(Number(variant.clicks) || 0)));
  const conversions = Math.min(clicks, rawConversions);
  const alpha = 1 + conversions;
  const beta = 1 + clicks - conversions;
  const total = alpha + beta;
  return {
    id: String(variant.id || ''),
    name: String(variant.nome || variant.id || ''),
    clicks,
    conversions,
    rate: clicks ? conversions / clicks : 0,
    mean: alpha / total,
    variance: (alpha * beta) / (total * total * (total + 1)),
  };
}

function probabilityBetter(a, b) {
  const variance = a.variance + b.variance;
  if (!(variance > 0)) return a.mean > b.mean ? 1 : 0.5;
  return normalCdf((a.mean - b.mean) / Math.sqrt(variance));
}

function evaluate(variants, rawConfig) {
  const config = Object.assign({
    minVisitors: 200,
    minConversions: 10,
    confidence: 0.95,
    minLiftPct: 5,
  }, rawConfig || {});
  const rows = (Array.isArray(variants) ? variants : []).filter((v) => Number(v.peso) > 0 || Number(v.clicks) > 0).map(posterior);
  if (rows.length < 2) return { ready: false, reason: 'São necessárias pelo menos duas variantes.' };
  rows.sort((a, b) => b.mean - a.mean);
  const winner = rows[0];
  const runnerUp = rows[1];
  const totalVisitors = rows.reduce((sum, row) => sum + row.clicks, 0);
  const totalConversions = rows.reduce((sum, row) => sum + row.conversions, 0);
  const confidence = Math.min(...rows.slice(1).map((row) => probabilityBetter(winner, row)));
  const liftPct = runnerUp.mean > 0 ? ((winner.mean / runnerUp.mean) - 1) * 100 : (winner.mean > 0 ? 100 : 0);
  const volumeReady = totalVisitors >= Math.max(20, Number(config.minVisitors) || 200)
    && totalConversions >= Math.max(2, Number(config.minConversions) || 10);
  const ready = volumeReady
    && confidence >= Math.max(0.8, Math.min(0.999, Number(config.confidence) || 0.95))
    && liftPct >= Math.max(0, Number(config.minLiftPct) || 0);
  return {
    ready,
    winnerId: ready ? winner.id : null,
    bestVariantId: winner.id,
    confidence: Math.round(confidence * 10000) / 10000,
    confidencePct: Math.round(confidence * 1000) / 10,
    liftPct: Math.round(liftPct * 10) / 10,
    totalVisitors,
    totalConversions,
    variants: rows.map((row) => ({
      id: row.id,
      name: row.name,
      clicks: row.clicks,
      conversions: row.conversions,
      observedRatePct: Math.round(row.rate * 1000) / 10,
      predictedRatePct: Math.round(row.mean * 1000) / 10,
      probabilityBestPct: Math.round(Math.min(...rows.filter((other) => other.id !== row.id).map((other) => probabilityBetter(row, other))) * 1000) / 10,
    })),
    reason: ready
      ? 'Vencedora prevista com ' + (Math.round(confidence * 1000) / 10) + '% de confiança e ' + (Math.round(liftPct * 10) / 10) + '% de vantagem.'
      : !volumeReady
        ? 'Coletando volume mínimo antes de decidir.'
        : 'Ainda não há confiança ou vantagem suficiente para encerrar.',
  };
}

module.exports = { evaluate, posterior, probabilityBetter, _internals: { erf, normalCdf } };
