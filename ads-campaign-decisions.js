'use strict';

// Junta três fontes já resolvidas pelo backend em um contrato pequeno para a
// lista de campanhas: atribuição first-party, último evento da automação e
// proposta pendente. Não lê banco/rede; é puro e testável.
function buildCampaignDecisions({ attribution, snapshot, pendingProposals } = {}) {
  const byCampaign = {};

  function ensureCampaign(campaignId) {
    const id = String(campaignId || '').trim();
    if (!id) return null;
    if (!byCampaign[id]) {
      byCampaign[id] = {
        revenueCents: 0,
        sales: 0,
        currency: null,
        automation: { pendingProposal: null, lastEvent: null },
      };
    }
    return byCampaign[id];
  }

  for (const [campaignId, entry] of Object.entries((attribution && attribution.byCampaign) || {})) {
    const target = ensureCampaign(campaignId);
    if (!target) continue;
    target.revenueCents = Number(entry && entry.revenueCents) || 0;
    target.sales = Number(entry && entry.sales) || 0;
    target.currency = entry && Object.prototype.hasOwnProperty.call(entry, 'currency') ? entry.currency : null;
  }

  const seenLog = new Set();
  const orderedLog = [...((snapshot && snapshot.log) || [])].sort(
    (a, b) => new Date((b && b.at) || 0).getTime() - new Date((a && a.at) || 0).getTime(),
  );
  for (const entry of orderedLog) {
    const campaignId = String((entry && entry.campaignId) || '').trim();
    if (!campaignId || seenLog.has(campaignId)) continue;
    seenLog.add(campaignId);
    const target = ensureCampaign(campaignId);
    if (!target) continue;
    target.automation.lastEvent = {
      at: entry.at || null,
      action: entry.action || null,
      detail: entry.detail || null,
      result: entry.result || null,
      ok: entry.ok !== false,
      proposed: entry.proposed === true,
      simulated: entry.simulated === true,
      approvedProposal: entry.approvedProposal === true,
    };
  }

  // Proposta pendente tem prioridade visual sobre histórico. listRuleProposals
  // já devolve ordem decrescente, então a primeira de cada campanha é a atual.
  for (const proposal of pendingProposals || []) {
    const target = ensureCampaign(proposal && proposal.campaign_id);
    if (!target || target.automation.pendingProposal) continue;
    target.automation.pendingProposal = {
      id: proposal.id,
      action: proposal.action || null,
      metric: proposal.metric || null,
      detail: proposal.detail || null,
      createdAt: proposal.created_at || null,
    };
  }

  const engine = (snapshot && snapshot.engine) || {};
  return {
    byCampaign,
    automation: {
      autonomy: (snapshot && snapshot.autonomy) || 'custom',
      state: engine.state || 'idle',
      executionMode: engine.executionMode || 'custom',
      actionsPaused: engine.actionsPaused === true,
      rulesEnabled: Number(engine.rulesEnabled) || 0,
      alertsEnabled: engine.alertsEnabled === true,
    },
  };
}

module.exports = { buildCampaignDecisions };
