// Dead-letter de ações do motor + persistência do circuit breaker no Redis.
// Critérios duros:
//   1. ação REAL que falha no sweep vira 1 entrada de dead-letter (pending);
//   2. dry-run NÃO gera dead-letter (nada foi executado);
//   3. reprocessar com sucesso → resolved, provider chamado, breaker alimentado;
//   4. reprocessar com falha → volta a pending com o erro e attempts++;
//   5. descartar → discarded, sem tocar o provider;
//   6. kill switch recusa reprocessamento (entrada segue pending);
//   7. breaker: recordOutcome persiste no Redis e ensureBreakerHydrated restaura
//      a janela após "restart" (limpando a memória).
// Provider/Neon/Redis 100% mockados — nenhum teste toca rede.
const assert = require('assert');

const provider = require('../ads-provider');
const cache = require('../ads-cache-store');
const adsOps = require('../ads-ops-store');
const redis = require('../redis');
const automation = require('../ads-automation');

// ── Stubs de provider ────────────────────────────────────────────────────────
const calls = { status: [], smartStatus: [], budget: [] };
let failStatus = false;
provider.enabled = true;
provider.resolveAdvertiserId = async () => 'adv1';
provider.setCampaignStatus = async (adv, ids, status) => {
  if (failStatus) throw new Error('provider recusou (429)');
  calls.status.push({ adv, ids, status });
};
provider.setSmartPlusCampaignStatus = async (adv, ids, status) => {
  calls.smartStatus.push({ adv, ids, status });
};
provider.updateAdGroup = async (adv, id, patch) => { calls.budget.push({ adv, id, patch }); };
const stateByAcc = {};
provider.getState = (accId) => stateByAcc[accId] || {};
provider.setState = (accId, patch) => { stateByAcc[accId] = Object.assign({}, stateByAcc[accId], patch); };
cache.upsertAutomationState = async () => {};
cache.deleteAutomationState = async () => {};
cache.listAutomationState = async () => [];

let policyOverride = { dryRun: false };
adsOps.getSafetyPolicy = async () => adsOps.normalizePolicy(policyOverride);
adsOps.appendAuditEvent = async (acc, ev) => ({ id: 'audit_x', ...ev });
adsOps.countRecentEngineActions = async () => 0;

// ── Store de dead-letter em memória (mesma semântica do Neon) ─────────────────
const dl = [];
adsOps.addActionDeadLetter = async (acc, v) => {
  const row = { id: 'dl_' + (dl.length + 1), account_id: acc, status: 'pending', attempts: 0,
    rule_id: v.ruleId, metric: v.metric, action: v.action, advertiser_id: v.advertiserId,
    campaign_id: v.campaignId, campaign_name: v.campaignName, detail: v.detail, plan: v.plan || {}, error: v.error || null };
  dl.push(row);
  return row;
};
adsOps.getActionDeadLetter = async (acc, id) => dl.find((x) => x.id === id && x.account_id === acc) || null;
adsOps.markActionDeadLetter = async (acc, id, status, opts = {}) => {
  const row = dl.find((x) => x.id === id && x.account_id === acc);
  if (!row || row.status !== 'pending') return null;
  row.status = status;
  if (opts.error !== undefined) row.error = opts.error;
  if (opts.incrementAttempt) row.attempts += 1;
  return row;
};
adsOps.updateActionDeadLetterPlan = async (acc, id, plan, opts = {}) => {
  const row = dl.find((x) => x.id === id && x.account_id === acc);
  if (!row || row.status !== 'pending') return null;
  row.plan = plan || {};
  if (opts.error !== undefined) row.error = opts.error;
  if (opts.incrementAttempt) row.attempts += 1;
  return row;
};
adsOps.countPendingActionDeadLetter = async (acc) => dl.filter((x) => x.account_id === acc && x.status === 'pending').length;

// ── Stub de Redis para o breaker (KV em memória) ─────────────────────────────
const kv = {};
redis.saveBreakerSamples = async (acc, samples) => { kv[acc] = { samples: samples.slice(), at: Date.now() }; return true; };
redis.loadBreakerSamples = async (acc) => kv[acc] || null;

let treeCampaigns = [];
provider.getDashboardTree = async () => ({ campaigns: treeCampaigns });

automation.init({ stats: { logEvent() {}, getStats: () => ({ leads: [] }) }, syncAfterWrite: () => {} });

function campaign(over = {}) {
  return Object.assign({
    platformCampaignId: 'c1', campaignName: 'Camp 1', campaignKind: 'auction',
    status: 'active', currency: 'EUR',
    metrics: { spend: 50, conversions: 0, impressions: 2000, clicks: 40 },
    adSets: [{ platformAdSetId: 'g1', budget: { amount: 50, type: 'daily' } }],
  }, over);
}
function setRules(accId, rules) { stateByAcc[accId] = { rulesSeeded: true, alertsSeeded: true, rules }; }
function reset(accId) {
  calls.status.length = 0; calls.smartStatus.length = 0; calls.budget.length = 0; dl.length = 0;
  treeCampaigns = [campaign()];
  automation._internals.memState.delete(accId);
  automation._internals.actionOutcomes.delete(accId);
  automation._internals.breakerHydrated.delete(accId);
  delete kv[accId];
}

(async () => {
  // ── 1: ação real que falha vira dead-letter pending ────────────────────────
  {
    const acc = 'dl_1';
    reset(acc);
    failStatus = true; // provider recusa o pause
    setRules(acc, automation.validateRules([{ id: 'r1', enabled: true, metric: 'spend_no_conv', threshold: 10, lookbackDays: 2, action: 'pause', mode: 'execute' }]));
    treeCampaigns = [campaign()];
    await automation.runRulesSweep(acc, { force: true });
    assert.strictEqual(dl.length, 1, 'ação falha gerou 1 dead-letter');
    assert.strictEqual(dl[0].status, 'pending', 'nasce pending');
    assert.strictEqual(dl[0].action, 'pause', 'ação registrada');
    assert.ok(dl[0].plan.beforeState, 'plan carrega before/after p/ reprocesso');
    assert.ok(/provider recusou/.test(dl[0].error), 'guarda o erro do provider');
    failStatus = false;
  }

  // ── 2: dry-run não gera dead-letter ────────────────────────────────────────
  {
    const acc = 'dl_2';
    reset(acc);
    failStatus = true;
    policyOverride = { dryRun: true };
    setRules(acc, automation.validateRules([{ id: 'r1', enabled: true, metric: 'spend_no_conv', threshold: 10, lookbackDays: 2, action: 'pause', mode: 'execute' }]));
    treeCampaigns = [campaign()];
    await automation.runRulesSweep(acc, { force: true });
    assert.strictEqual(dl.length, 0, 'dry-run não cria dead-letter (nada executado)');
    policyOverride = { dryRun: false };
    failStatus = false;
  }

  // ── perda de lease após 1º target: não repete a parte já aplicada ─────────
  {
    const acc = 'dl_partial_lease';
    reset(acc);
    setRules(acc, automation.validateRules([{
      id: 'r-partial',
      enabled: true,
      metric: 'cpm_max',
      threshold: 10,
      minSpend: 1,
      action: 'budget_down',
      pct: 20,
      mode: 'execute',
    }]));
    treeCampaigns = [campaign({
      adSets: [
        { platformAdSetId: 'g1', budget: { amount: 50, type: 'daily' } },
        { platformAdSetId: 'g2', budget: { amount: 80, type: 'daily' } },
      ],
    })];
    let guardCalls = 0;
    const lost = new Error('lease perdido entre targets');
    lost.code = 'AUTOMATION_LEASE_LOST';
    await assert.rejects(
      automation.runRulesSweep(acc, {
        force: true,
        advertiserId: 'adv1',
        leaseGuard: async () => {
          guardCalls += 1;
          if (guardCalls >= 3) throw lost;
        },
      }),
      (error) => error && error.code === 'AUTOMATION_LEASE_LOST',
      'o ciclo para assim que perde o lease depois de uma mutação',
    );
    assert.deepStrictEqual(
      calls.budget.map((call) => call.id),
      ['g1'],
      'somente o primeiro target foi enviado antes da perda do lease',
    );
    assert.strictEqual(dl.length, 1, 'a parte pendente virou uma única dead-letter');
    assert.deepStrictEqual(
      dl[0].plan.changes.map((change) => change.targetId),
      ['g2'],
      'dead-letter contém somente o target ainda não aplicado',
    );
    assert.strictEqual(
      automation._internals.memState.get(acc).has('adv:adv1:rule:c1:r-partial'),
      true,
      'cooldown é preservado após mutação parcial para impedir replay do lote original',
    );
  }

  // ── 3: reprocessar com sucesso → resolved + provider chamado ───────────────
  {
    const acc = 'dl_3';
    reset(acc);
    const row = await adsOps.addActionDeadLetter(acc, {
      ruleId: 'r1', metric: 'spend_no_conv', action: 'pause', advertiserId: 'adv1',
      campaignId: 'c1', campaignName: 'Camp 1', detail: 'sem conversão',
      plan: { beforeState: {}, afterState: {} }, error: 'falha antiga',
    });
    const out = await automation.reprocessDeadLetter(acc, row.id);
    assert.strictEqual(out.ok, true, 'reprocesso executou');
    assert.strictEqual(out.status, 'resolved', 'marca resolved');
    assert.strictEqual(calls.status.length, 1, 'provider chamado 1 vez no reprocesso');
    assert.strictEqual(row.status, 'resolved', 'entrada resolvida no store');
    assert.strictEqual(row.attempts, 1, 'attempts incrementado');
    // breaker alimentado com sucesso
    assert.deepStrictEqual(automation._internals.actionOutcomes.get(acc + ':adv1'), [true], 'sucesso alimenta o breaker do advertiser');
  }

  // ── 3b: retry parcial reduz a própria dead-letter ao restante ─────────────
  {
    const acc = 'dl_retry_partial';
    reset(acc);
    const row = await adsOps.addActionDeadLetter(acc, {
      ruleId: 'r-budget',
      metric: 'cpm_max',
      action: 'budget_down',
      advertiserId: 'adv1',
      campaignId: 'c1',
      campaignName: 'Camp 1',
      detail: 'reduzir orçamento',
      plan: {
        pct: 20,
        cap: 0,
        capped: 0,
        changes: [
          { targetType: 'adgroup', targetId: 'g1', adGroupId: 'g1', cur: 50, amount: 40, type: 'daily' },
          { targetType: 'adgroup', targetId: 'g2', adGroupId: 'g2', cur: 80, amount: 64, type: 'daily' },
        ],
      },
      error: 'falha antiga',
    });
    treeCampaigns = [campaign({
      adSets: [
        { platformAdSetId: 'g1', budget: { amount: 50, type: 'daily' } },
        { platformAdSetId: 'g2', budget: { amount: 80, type: 'daily' } },
      ],
    })];
    let guardCalls = 0;
    const lost = new Error('lease perdido no retry');
    lost.code = 'AUTOMATION_LEASE_LOST';
    await assert.rejects(
      automation.reprocessDeadLetter(acc, row.id, async () => {
        guardCalls += 1;
        if (guardCalls >= 3) throw lost;
      }),
      (error) => error && error.code === 'ADS_PARTIAL_MUTATION',
      'retry parcial devolve erro acionável sem repetir o target confirmado',
    );
    assert.deepStrictEqual(calls.budget.map((call) => call.id), ['g1'], 'retry aplicou somente o primeiro target');
    assert.deepStrictEqual(row.plan.changes.map((change) => change.targetId), ['g2'], 'entrada foi reduzida ao target restante');
    assert.strictEqual(row.status, 'pending', 'entrada parcial continua pendente');
    assert.strictEqual(row.attempts, 1, 'tentativa parcial é contabilizada');
  }

  // ── 3c: dead-letter Smart+ preserva o endpoint dedicado ──────────────────
  {
    const acc = 'dl_smart_plus';
    reset(acc);
    const row = await adsOps.addActionDeadLetter(acc, {
      ruleId: 'r-smart',
      metric: 'spend_no_conv',
      action: 'pause',
      advertiserId: 'adv1',
      campaignId: 'sp1',
      campaignName: 'Smart 1',
      detail: 'pausa Smart+',
      plan: { campaignKind: 'smart_plus' },
      error: 'falha antiga',
    });
    treeCampaigns = [campaign({
      platformCampaignId: 'sp1',
      campaignName: 'Smart 1',
      campaignKind: 'smart_plus',
    })];
    const out = await automation.reprocessDeadLetter(acc, row.id);
    assert.strictEqual(out.ok, true, 'retry Smart+ concluiu');
    assert.strictEqual(calls.smartStatus.length, 1, 'usa setSmartPlusCampaignStatus');
    assert.strictEqual(calls.status.length, 0, 'não degrada Smart+ para endpoint de leilão');
  }

  // ── 4: reprocessar com falha → volta a pending + attempts++ ────────────────
  {
    const acc = 'dl_4';
    reset(acc);
    const row = await adsOps.addActionDeadLetter(acc, {
      ruleId: 'r1', metric: 'spend_no_conv', action: 'pause', advertiserId: 'adv1',
      campaignId: 'c1', campaignName: 'Camp 1', detail: 'sem conversão', plan: {}, error: 'falha antiga',
    });
    failStatus = true;
    let threw = null;
    try { await automation.reprocessDeadLetter(acc, row.id); } catch (e) { threw = e; }
    assert.ok(threw && threw.status === 502, 'reprocesso falho lança 502');
    assert.strictEqual(row.status, 'pending', 'volta a pending para nova tentativa');
    assert.strictEqual(row.attempts, 1, 'attempts incrementado mesmo na falha');
    assert.ok(/provider recusou/.test(row.error), 'atualiza o erro');
    failStatus = false;
  }

  // ── 5: descartar → discarded, sem provider ─────────────────────────────────
  {
    const acc = 'dl_5';
    reset(acc);
    const row = await adsOps.addActionDeadLetter(acc, {
      ruleId: 'r1', metric: 'spend_no_conv', action: 'pause', advertiserId: 'adv1',
      campaignId: 'c1', campaignName: 'Camp 1', detail: 'x', plan: {}, error: 'e',
    });
    const out = await automation.discardDeadLetter(acc, row.id);
    assert.strictEqual(out.status, 'discarded', 'marca discarded');
    assert.strictEqual(row.status, 'discarded', 'entrada descartada no store');
    assert.strictEqual(calls.status.length, 0, 'descartar não toca o provider');
  }

  // ── 6: kill switch recusa reprocessamento ──────────────────────────────────
  {
    const acc = 'dl_6';
    reset(acc);
    const row = await adsOps.addActionDeadLetter(acc, {
      ruleId: 'r1', metric: 'spend_no_conv', action: 'pause', advertiserId: 'adv1',
      campaignId: 'c1', campaignName: 'Camp 1', detail: 'x', plan: {}, error: 'e',
    });
    policyOverride = { dryRun: false, killSwitch: true };
    let threw = null;
    try { await automation.reprocessDeadLetter(acc, row.id); } catch (e) { threw = e; }
    assert.ok(threw && /[Kk]ill/.test(threw.message), 'kill switch recusa o reprocesso');
    assert.strictEqual(row.status, 'pending', 'entrada segue pending');
    assert.strictEqual(calls.status.length, 0, 'nada executado com kill switch');
    policyOverride = { dryRun: false };
  }

  // ── 7: breaker persiste no Redis e sobrevive a "restart" ───────────────────
  {
    const acc = 'dl_7';
    reset(acc);
    automation._internals.recordOutcome(acc, true);
    automation._internals.recordOutcome(acc, false);
    automation._internals.recordOutcome(acc, false);
    // deixa o write-through assíncrono concluir
    await new Promise((r) => setTimeout(r, 10));
    assert.ok(kv[acc] && kv[acc].samples.length === 3, 'janela persistida no Redis');
    // simula restart: limpa memória, mantém o KV
    automation._internals.actionOutcomes.delete(acc);
    automation._internals.breakerLastAt.delete(acc);
    automation._internals.breakerHydrated.delete(acc);
    await automation.ensureBreakerHydrated(acc);
    assert.deepStrictEqual(automation._internals.actionOutcomes.get(acc), [true, false, false], 'janela restaurada do Redis pós-restart');
    // e uma nova hidratação não duplica nem sobrescreve
    await automation.ensureBreakerHydrated(acc);
    assert.strictEqual(automation._internals.actionOutcomes.get(acc).length, 3, 'hidratar de novo é idempotente');
  }

  console.log('ads-deadletter.test.js: OK');
})().catch((err) => { console.error(err); process.exit(1); });
