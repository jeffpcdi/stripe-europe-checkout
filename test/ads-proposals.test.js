// F3 — Modo proposta do motor de regras. Critério duro da verificação:
//   1. sweep com regra em proposal gera linha PENDING e ZERO chamadas ao provider;
//   2. aprovar executa (provider chamado) e audita como rule_proposal.approved;
//   3. proposta expirada recusa aprovação;
//   4. mode:'execute' continua agindo direto (os dois modos coexistem);
//   5. cooldown É consumido na proposta (sweep seguinte não duplica);
//   6. re-validação: orçamento mudou desde a proposta → recusa e marca failed.
// Provider/Neon 100% mockados — nenhum teste toca rede.
const assert = require('assert');

const provider = require('../ads-provider');
const cache = require('../ads-cache-store');
const adsOps = require('../ads-ops-store');
const automation = require('../ads-automation');

// ── Stubs ────────────────────────────────────────────────────────────────────
const calls = { status: [], budget: [], campaignBudget: [] };
provider.enabled = true;
provider.resolveAdvertiserId = async () => 'adv1';
provider.setCampaignStatus = async (adv, ids, status) => { calls.status.push({ adv, ids, status }); };
provider.updateAdGroup = async (adv, id, patch) => { calls.budget.push({ adv, id, patch }); };
provider.updateCampaign = async (adv, id, patch) => { calls.campaignBudget.push({ adv, id, patch }); };
const stateByAcc = {};
provider.getState = (accId) => stateByAcc[accId] || {};
provider.setState = (accId, patch) => { stateByAcc[accId] = Object.assign({}, stateByAcc[accId], patch); };
cache.upsertAutomationState = async () => {};
cache.deleteAutomationState = async () => {};
cache.listAutomationState = async () => [];

let policyOverride = { dryRun: false };
adsOps.getSafetyPolicy = async () => adsOps.normalizePolicy(policyOverride);
const audits = [];
adsOps.appendAuditEvent = async (acc, ev) => { const row = { id: 'audit_' + (audits.length + 1), ...ev }; audits.push(row); return row; };
adsOps.countRecentEngineActions = async () => 0;

// Store de propostas em memória com a MESMA semântica do Neon (dedup de
// pendente, transição atômica com TTL, execução só a partir de approved).
const proposals = [];
const TTL_MS = 6 * 3600e3;
adsOps.createRuleProposal = async (acc, v) => {
  if (proposals.some((p) => p.account_id === acc && p.rule_id === v.ruleId && p.campaign_id === v.campaignId && p.status === 'pending')) return null;
  const row = {
    id: 'prop_' + (proposals.length + 1), account_id: acc, rule_id: v.ruleId, metric: v.metric,
    action: v.action, advertiser_id: v.advertiserId, campaign_id: v.campaignId,
    campaign_name: v.campaignName, detail: v.detail, plan: v.plan || {},
    status: 'pending', created_at: new Date().toISOString(),
  };
  proposals.push(row);
  return row;
};
adsOps.getRuleProposal = async (acc, id) => proposals.find((p) => p.id === id && p.account_id === acc) || null;
adsOps.decideRuleProposal = async (acc, id, decision) => {
  const p = proposals.find((x) => x.id === id && x.account_id === acc);
  if (!p || p.status !== 'pending') return null;
  if (Date.now() - new Date(p.created_at).getTime() > TTL_MS) { p.status = 'expired'; return null; }
  p.status = decision; p.decided_at = new Date().toISOString();
  return p;
};
adsOps.markProposalExecution = async (acc, id, ok, error) => {
  const p = proposals.find((x) => x.id === id && x.account_id === acc);
  if (p && p.status === 'approved') { p.status = ok ? 'executed' : 'failed'; p.error = error || null; p.executed_at = new Date().toISOString(); }
  return p;
};
adsOps.releaseProposalApproval = async (acc, id, error) => {
  const p = proposals.find((x) => x.id === id && x.account_id === acc);
  if (p && p.status === 'approved') {
    p.status = 'pending';
    p.decided_at = null;
    p.error = error || null;
  }
  return p;
};

let treeCampaigns = [];
provider.getDashboardTree = async () => ({ campaigns: treeCampaigns });

automation.init({ stats: { logEvent() {}, getStats: () => ({ leads: [] }) }, syncAfterWrite: () => {} });

function campaign(over = {}) {
  return Object.assign({
    platformCampaignId: 'c1', campaignName: 'Camp 1', status: 'active', currency: 'EUR',
    metrics: { spend: 50, conversions: 0, impressions: 2000, clicks: 40 },
    adSets: [{ platformAdSetId: 'g1', budget: { amount: 50, type: 'daily' } }],
  }, over);
}
function resetAll(accId) {
  calls.status.length = 0; calls.budget.length = 0; calls.campaignBudget.length = 0; audits.length = 0;
  proposals.length = 0;
  automation._internals.memState.delete(accId);
  automation._internals.actionOutcomes.delete(accId);
}
function setRules(accId, rules) { stateByAcc[accId] = { rulesSeeded: true, alertsSeeded: true, rules }; }

(async () => {
  // ── validateRules: mode default proposal, execute preservado ───────────────
  {
    const rules = automation.validateRules([
      { enabled: true, metric: 'cpa_max', threshold: 10 },                    // sem mode (regra antiga)
      { enabled: true, metric: 'cpa_max', threshold: 10, mode: 'execute' },   // explícito
      { enabled: true, metric: 'cpa_max', threshold: 10, mode: 'invented' },  // inválido
    ]);
    assert.strictEqual(rules[0].mode, 'proposal', 'regra sem mode migra para proposal (default)');
    assert.strictEqual(rules[1].mode, 'execute', 'mode execute explícito é preservado');
    assert.strictEqual(rules[2].mode, 'proposal', 'mode inválido cai em proposal (o lado seguro)');
    const presets = automation.buildRulePresets();
    assert.ok(presets.every((r) => r.mode === 'proposal'), 'os 5 presets de fábrica nascem em proposal');
  }

  // ── 1+5: sweep em proposal → pending, ZERO provider, cooldown consumido ────
  {
    const acc = 'acc_p1';
    resetAll(acc);
    setRules(acc, automation.validateRules([{ id: 'r1', enabled: true, metric: 'spend_no_conv', threshold: 10, lookbackDays: 2, action: 'pause' }]));
    treeCampaigns = [campaign()];
    const out = await automation.runRulesSweep(acc, { force: true });
    assert.strictEqual(proposals.length, 1, 'sweep gerou exatamente 1 proposta');
    assert.strictEqual(proposals[0].status, 'pending', 'proposta nasce pending');
    assert.strictEqual(proposals[0].action, 'pause', 'ação registrada na proposta');
    assert.ok(proposals[0].plan.beforeState, 'plan carrega before_state já computado');
    assert.strictEqual(calls.status.length, 0, 'ZERO chamadas de status ao provider');
    assert.strictEqual(calls.budget.length, 0, 'ZERO chamadas de orçamento ao provider');
    assert.ok(out.executed.some((e) => e.proposed), 'log do sweep marca a proposta');
    assert.ok(audits.some((a) => a.action === 'rule_proposal.created'), 'criação auditada');

    // cooldown consumido: o sweep seguinte NÃO duplica a proposta
    const again = await automation.runRulesSweep(acc, { force: true });
    assert.strictEqual(proposals.length, 1, 'sweep seguinte não duplica (cooldown consumido na proposta)');
    assert.strictEqual(again.executed.filter((e) => e.proposed).length, 0, 'nenhuma proposta nova no 2º sweep');
  }

  // ── 2: aprovar executa pelo caminho real e audita ──────────────────────────
  {
    const acc = 'acc_p1'; // reaproveita a proposta pendente do bloco acima
    const p = proposals[0];
    const res = await automation.approveProposal(acc, p.id);
    assert.strictEqual(res.ok, true, 'aprovação executou com sucesso');
    assert.strictEqual(calls.status.length, 1, 'provider chamado exatamente 1 vez na aprovação');
    assert.deepStrictEqual(calls.status[0].ids, ['c1'], 'pausou a campanha certa');
    assert.strictEqual(p.status, 'executed', 'proposta marcada como executed');
    const ap = audits.find((a) => a.action === 'rule_proposal.approved');
    assert.ok(ap, 'aprovação auditada como rule_proposal.approved');
    assert.ok(ap.beforeState && ap.afterState, 'auditoria carrega before/after (base do rollback)');
  }

  // ── 3: proposta expirada recusa aprovação ──────────────────────────────────
  {
    const acc = 'acc_p2';
    resetAll(acc);
    proposals.push({
      id: 'prop_old', account_id: acc, rule_id: 'r1', metric: 'spend_no_conv', action: 'pause',
      advertiser_id: 'adv1', campaign_id: 'c1', campaign_name: 'Camp 1', detail: 'antiga',
      plan: {}, status: 'pending', created_at: new Date(Date.now() - 7 * 3600e3).toISOString(),
    });
    let threw = null;
    try { await automation.approveProposal(acc, 'prop_old'); } catch (e) { threw = e; }
    assert.ok(threw, 'aprovação de proposta expirada lança erro');
    assert.strictEqual(calls.status.length + calls.budget.length, 0, 'nada executado para proposta expirada');
  }

  // ── 4: mode execute continua agindo direto ─────────────────────────────────
  {
    const acc = 'acc_p3';
    resetAll(acc);
    setRules(acc, automation.validateRules([{ id: 'r2', enabled: true, metric: 'spend_no_conv', threshold: 10, lookbackDays: 2, action: 'pause', mode: 'execute' }]));
    treeCampaigns = [campaign()];
    await automation.runRulesSweep(acc, { force: true });
    assert.strictEqual(calls.status.length, 1, 'mode execute chama o provider direto');
    assert.strictEqual(proposals.length, 0, 'mode execute não cria proposta');
    assert.ok(audits.some((a) => a.action === 'rule_action'), 'execução direta audita como rule_action');
  }

  // ── lease perdido antes do provider: proposta volta a pending ─────────────
  {
    const acc = 'acc_p_lease';
    resetAll(acc);
    proposals.push({
      id: 'prop_lease', account_id: acc, rule_id: 'r-lease', metric: 'spend_no_conv', action: 'pause',
      advertiser_id: 'adv1', campaign_id: 'c1', campaign_name: 'Camp 1', detail: 'teste lease',
      plan: {}, status: 'pending', created_at: new Date().toISOString(),
    });
    treeCampaigns = [campaign()];
    let guards = 0;
    const lost = new Error('lease perdido');
    lost.code = 'AUTOMATION_LEASE_LOST';
    await assert.rejects(
      automation.approveProposal(acc, 'prop_lease', async () => {
        guards += 1;
        if (guards > 1) throw lost;
      }),
      (error) => error && error.code === 'AUTOMATION_LEASE_LOST',
    );
    assert.strictEqual(calls.status.length, 0, 'lease perdido antes da chamada não toca o provider');
    assert.strictEqual(proposals[0].status, 'pending', 'reserva da proposta é devolvida para nova tentativa');
  }

  // ── pausa por desempenho aprovada remove autoria antiga do agendamento ───
  {
    const acc = 'acc_p_schedule_owner';
    resetAll(acc);
    setRules(acc, automation.validateRules([{
      id: 'sched-old',
      enabled: true,
      metric: 'schedule',
      days: [0, 1, 2, 3, 4, 5, 6],
      startTime: '09:00',
      endTime: '18:00',
      mode: 'execute',
    }]));
    const scheduleKey = 'adv:adv1:sched:sched-old:c1';
    await automation._internals.markFired(acc, scheduleKey, 'sched', {
      ruleId: 'sched-old',
      pausedAt: new Date().toISOString(),
    });
    proposals.push({
      id: 'prop_perf_pause',
      account_id: acc,
      rule_id: 'perf-pause',
      metric: 'spend_no_conv',
      action: 'pause',
      advertiser_id: 'adv1',
      campaign_id: 'c1',
      campaign_name: 'Camp 1',
      detail: 'pausa por desempenho',
      plan: {},
      status: 'pending',
      created_at: new Date().toISOString(),
    });
    treeCampaigns = [campaign()];

    const out = await automation.approveProposal(acc, 'prop_perf_pause');
    assert.strictEqual(out.ok, true, 'pausa por desempenho aprovada foi executada');
    assert.strictEqual(
      automation._internals.memState.get(acc).has(scheduleKey),
      false,
      'aprovação remove a autoria antiga antes de pausar',
    );
    assert.strictEqual(
      proposals[0].status,
      'executed',
      'proposta conclui sem deixar a agenda apta a reativar a campanha',
    );
  }

  // ── 6: re-validação — orçamento mudou desde a proposta → failed ────────────
  {
    const acc = 'acc_p4';
    resetAll(acc);
    setRules(acc, automation.validateRules([{ id: 'r3', enabled: true, metric: 'cpm_max', threshold: 5, lookbackDays: 2, action: 'budget_down', minSpend: 1 }]));
    treeCampaigns = [campaign({ metrics: { spend: 50, conversions: 0, impressions: 2000, clicks: 40 } })];
    await automation.runRulesSweep(acc, { force: true });
    assert.strictEqual(proposals.length, 1, 'proposta de budget criada');
    // alguém mexeu no orçamento no meio-tempo: 50 → 80
    treeCampaigns = [campaign({ adSets: [{ platformAdSetId: 'g1', budget: { amount: 80, type: 'daily' } }] })];
    let threw = null;
    try { await automation.approveProposal(acc, proposals[0].id); } catch (e) { threw = e; }
    assert.ok(threw && /Orçamento mudou/.test(threw.message), 'aprovação recusada: orçamento divergiu do before');
    assert.strictEqual(proposals[0].status, 'failed', 'proposta marcada failed com o motivo');
    assert.strictEqual(calls.budget.length, 0, 'provider não tocado quando a re-validação falha');
  }

  // ── orçamento CBO: revalidação usa budget da campanha, não adGroupId ─────
  {
    const acc = 'acc_p_cbo';
    resetAll(acc);
    setRules(acc, automation.validateRules([{
      id: 'r-cbo',
      enabled: true,
      metric: 'cpm_max',
      threshold: 5,
      minSpend: 1,
      action: 'budget_down',
      pct: 20,
      mode: 'proposal',
    }]));
    treeCampaigns = [campaign({
      budgetOwner: 'campaign',
      budget: { amount: 100, type: 'daily' },
      metrics: { spend: 50, conversions: 0, impressions: 2000, clicks: 40 },
    })];
    await automation.runRulesSweep(acc, { force: true });
    assert.strictEqual(proposals.length, 1, 'proposta CBO criada');
    assert.strictEqual(proposals[0].plan.changes[0].targetType, 'campaign', 'plano preserva ownership CBO');
    const out = await automation.approveProposal(acc, proposals[0].id);
    assert.strictEqual(out.ok, true, 'aprovação CBO passa pela revalidação correta');
    assert.strictEqual(calls.campaignBudget.length, 1, 'orçamento é alterado no nível campanha');
    assert.strictEqual(calls.budget.length, 0, 'não usa endpoint de ad group para CBO');
  }

  // ── guards: kill switch bloqueia aprovação (proposta segue pendente) ───────
  {
    const acc = 'acc_p5';
    resetAll(acc);
    setRules(acc, automation.validateRules([{ id: 'r4', enabled: true, metric: 'spend_no_conv', threshold: 10, lookbackDays: 2, action: 'pause' }]));
    treeCampaigns = [campaign()];
    await automation.runRulesSweep(acc, { force: true });
    assert.strictEqual(proposals.length, 1, 'proposta criada antes do kill switch');
    policyOverride = { dryRun: false, killSwitch: true };
    let threw = null;
    try { await automation.approveProposal(acc, proposals[0].id); } catch (e) { threw = e; }
    assert.ok(threw && /[Kk]ill/.test(threw.message), 'kill switch recusa a aprovação');
    assert.strictEqual(proposals[0].status, 'pending', 'proposta continua pendente (guard antes da transição)');
    assert.strictEqual(calls.status.length, 0, 'nada executado com kill switch');
    // e o sweep inteiro aborta (nem propostas novas)
    proposals.length = 0;
    automation._internals.memState.delete(acc);
    const out = await automation.runRulesSweep(acc, { force: true });
    assert.strictEqual(out.killSwitch, true, 'kill switch aborta o sweep');
    assert.strictEqual(proposals.length, 0, 'kill switch não deixa nem criar propostas');
    policyOverride = { dryRun: false };
  }

  // ── dry-run tem precedência sobre proposal (simula, não propõe) ────────────
  {
    const acc = 'acc_p6';
    resetAll(acc);
    setRules(acc, automation.validateRules([{ id: 'r5', enabled: true, metric: 'spend_no_conv', threshold: 10, lookbackDays: 2, action: 'pause' }]));
    treeCampaigns = [campaign()];
    policyOverride = { dryRun: true };
    const out = await automation.runRulesSweep(acc, { force: true });
    assert.strictEqual(proposals.length, 0, 'dry-run não cria proposta (simula como sempre)');
    assert.ok(out.executed.some((e) => e.simulated), 'dry-run segue simulando');
    assert.strictEqual(calls.status.length, 0, 'dry-run nunca toca o provider');
    policyOverride = { dryRun: false };
  }

  console.log('ads-proposals.test.js: todos os testes passaram');
})().catch((err) => { console.error(err); process.exit(1); });
