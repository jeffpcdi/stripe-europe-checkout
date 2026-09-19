'use strict';

const MAX_RECENT = 40;
const byAccount = new Map();

function fresh() {
  return {
    total: 0, agree: 0, diverged: 0,
    legacyPrimary: 0, legacySafe: 0,
    v6Primary: 0, v6Safe: 0, v6Challenge: 0,
    edgeVerified: 0, networkVerified: 0,
    campaigns: new Map(), recent: [], lastAt: 0,
  };
}

function campaignFresh() {
  return { total: 0, agree: 0, diverged: 0, primary: 0, safe: 0, challenge: 0, lastAt: 0 };
}

function normalizeLegacy(value) {
  return String(value || '').toUpperCase() === 'SAFE' ? 'SAFE' : 'PRIMARY';
}

function record(input = {}) {
  const accountId = String(input.accountId || '');
  const campaignId = String(input.campaignId || '');
  if (!accountId || !campaignId || !input.v6) return false;

  const row = byAccount.get(accountId) || fresh();
  const legacy = normalizeLegacy(input.legacyAction);
  const v6 = String(input.v6.decision || '');
  const agrees = v6 !== 'CHALLENGE' && v6 === legacy;
  const at = Date.now();

  row.total++;
  row[legacy === 'SAFE' ? 'legacySafe' : 'legacyPrimary']++;
  if (v6 === 'SAFE') row.v6Safe++;
  else if (v6 === 'CHALLENGE') row.v6Challenge++;
  else row.v6Primary++;
  if (agrees) row.agree++; else row.diverged++;
  if (input.edgeVerified) row.edgeVerified++;
  if (input.networkVerified) row.networkVerified++;
  row.lastAt = at;

  const c = row.campaigns.get(campaignId) || campaignFresh();
  c.total++;
  if (agrees) c.agree++; else c.diverged++;
  if (v6 === 'SAFE') c.safe++;
  else if (v6 === 'CHALLENGE') c.challenge++;
  else c.primary++;
  c.lastAt = at;
  row.campaigns.set(campaignId, c);

  row.recent.unshift({
    at,
    campaignId,
    legacyAction: legacy,
    legacyReason: String(input.legacyReason || '').slice(0, 40),
    legacyScore: Number.isFinite(Number(input.legacyScore)) ? Number(input.legacyScore) : null,
    v6Decision: v6,
    v6Score: Number(input.v6.score) || 0,
    v6Confidence: input.v6.confidence || 'medium',
    reasons: Array.isArray(input.v6.reasons) ? input.v6.reasons.slice(0, 6) : [],
    edgeVerified: !!input.edgeVerified,
    networkVerified: !!input.networkVerified,
  });
  if (row.recent.length > MAX_RECENT) row.recent.length = MAX_RECENT;
  byAccount.set(accountId, row);
  return true;
}

function snapshot(accountId) {
  const row = byAccount.get(String(accountId || '')) || fresh();
  return {
    total: row.total,
    agree: row.agree,
    diverged: row.diverged,
    agreementRate: row.total ? Number((row.agree / row.total).toFixed(4)) : 0,
    legacy: { primary: row.legacyPrimary, safe: row.legacySafe },
    v6: { primary: row.v6Primary, safe: row.v6Safe, challenge: row.v6Challenge },
    edgeVerified: row.edgeVerified,
    networkVerified: row.networkVerified,
    campaigns: [...row.campaigns.entries()].map(([campaignId, item]) => ({ campaignId, ...item })),
    recent: row.recent.slice(),
    lastAt: row.lastAt || null,
  };
}

function reset(accountId) {
  return byAccount.delete(String(accountId || ''));
}

module.exports = { record, snapshot, reset };
