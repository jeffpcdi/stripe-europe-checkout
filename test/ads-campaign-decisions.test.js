'use strict';

const assert = require('assert');
const { buildCampaignDecisions } = require('../ads-campaign-decisions');

const out = buildCampaignDecisions({
  attribution: {
    byCampaign: {
      '1001': { revenueCents: 42500, sales: 5, currency: 'BRL' },
    },
  },
  snapshot: {
    autonomy: 'auto',
    engine: {
      state: 'running',
      executionMode: 'automatic',
      actionsPaused: false,
      rulesEnabled: 3,
      alertsEnabled: true,
    },
    log: [
      {
        at: '2026-09-14T13:00:00.000Z', campaignId: '1001', action: 'budget_up',
        detail: 'ROAS 3.10 ≥ 2', result: 'orçamento +20% em 1 nível(is)', ok: true,
      },
      {
        at: '2026-09-14T12:00:00.000Z', campaignId: '1001', action: 'pause',
        detail: 'antigo', result: 'campanha pausada', ok: true,
      },
      {
        at: '2026-09-14T12:30:00.000Z', campaignId: '1002', action: 'pause',
        detail: 'CPA acima do teto', result: 'campanha pausada', ok: false,
      },
    ],
  },
  pendingProposals: [
    {
      id: 'prop-1', campaign_id: '1002', action: 'pause', metric: 'cpa_max',
      detail: 'CPA 90 > teto 70', created_at: '2026-09-14T13:10:00.000Z',
    },
  ],
});

assert.deepStrictEqual(
  { sales: out.byCampaign['1001'].sales, revenueCents: out.byCampaign['1001'].revenueCents, currency: out.byCampaign['1001'].currency },
  { sales: 5, revenueCents: 42500, currency: 'BRL' },
  'preserva a atribuição first-party da campanha',
);
assert.strictEqual(out.byCampaign['1001'].automation.lastEvent.action, 'budget_up', 'usa o evento mais recente da automação');
assert.strictEqual(out.byCampaign['1002'].automation.pendingProposal.id, 'prop-1', 'proposta pendente entra na campanha mesmo sem venda atribuída');
assert.strictEqual(out.byCampaign['1002'].sales, 0, 'campanha criada pelo estado da automação nasce com venda zero');
assert.strictEqual(out.automation.autonomy, 'auto');
assert.strictEqual(out.automation.rulesEnabled, 3);

const empty = buildCampaignDecisions({});
assert.deepStrictEqual(empty.byCampaign, {});
assert.strictEqual(empty.automation.state, 'idle');
assert.strictEqual(empty.automation.autonomy, 'custom');

console.log('[OK] campaign decisions — atribuição real, último evento e proposta pendente unidos por campanha.');
