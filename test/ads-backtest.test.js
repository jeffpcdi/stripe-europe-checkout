// Testes do backtest de regras (simulação "e se", sem agir) e do estado
// observável do circuit breaker. Nenhum teste toca rede/Neon — tudo stubado,
// no mesmo espírito de test/ads-automation.test.js.
const assert = require('assert');

const provider = require('../ads-provider');
const cache = require('../ads-cache-store');
const adsOps = require('../ads-ops-store');
const automation = require('../ads-automation');

// ── Stubs ────────────────────────────────────────────────────────────────────
const calls = { status: [], budget: [] };
provider.enabled = true;
provider.resolveAdvertiserId = async () => 'adv1';
provider.setCampaignStatus = async (adv, ids, status) => { calls.status.push({ adv, ids, status }); };
provider.updateAdGroup = async (adv, id, patch) => { calls.budget.push({ adv, id, patch }); };
const stateByAcc = {};
provider.getState = (accId) => stateByAcc[accId] || {};
provider.setState = (accId, patch) => { stateByAcc[accId] = Object.assign({}, stateByAcc[accId], patch); };
cache.upsertAutomationState = async () => {};
cache.deleteAutomationState = async () => {};
cache.listAutomationState = async () => [];

let policyOverride = { dryRun: false };
adsOps.getSafetyPolicy = async () => adsOps.normalizePolicy(policyOverride);
adsOps.appendAuditEvent = async () => ({ id: 'audit_test' });
adsOps.countRecentEngineActions = async () => 0;

let treeCampaigns = [];
provider.getDashboardTree = async () => ({ campaigns: treeCampaigns });

let leads = [];
automation.init({
  stats: { logEvent() {}, getStats: () => ({ leads }) },
  syncAfterWrite: () => {},
});

function campaign(over = {}) {
  return Object.assign({
    platformCampaignId: 'c1', campaignName: 'Camp 1', status: 'active', currency: 'EUR',
    metrics: { spend: 0, conversions: 0, impressions: 0, clicks: 0 },
    adSets: [{ platformAdSetId: 'g1', budget: { amount: 50, type: 'daily' } }],
  }, over);
}

(async () => {
  // ── backtest: encontra o hit MAS não executa nada (sem cooldown/auditoria) ──
  {
    const acc = 'bt_hit';
    resetOutcomes(acc);
    calls.status.length = 0; calls.budget.length = 0;
    treeCampaigns = [campaign({ metrics: { spend: 10, conversions: 0, impressions: 2000, clicks: 40 } })];
    const out = await automation.backtestRules(acc, {
      rules: [{ id: 'r1', enabled: false, metric: 'spend_no_conv', threshold: 5, mode: 'execute' }],
    });
    assert.strictEqual(out.findings.length, 1, 'backtest acha 1 hit');
    assert.strictEqual(out.findings[0].metric, 'spend_no_conv');
    assert.strictEqual(out.findings[0].action, 'pause');
    assert.strictEqual(out.findings[0].enabled, false, 'reporta que a regra está desligada (simulou mesmo assim)');
    assert.strictEqual(out.summary.hits, 1);
    assert.strictEqual(out.summary.byAction.pause, 1);
    assert.strictEqual(calls.status.length, 0, 'backtest NÃO pausa na plataforma');
    assert.strictEqual(calls.budget.length, 0, 'backtest NÃO mexe em orçamento');
  }

  // ── backtest: sem hit quando o volume/valor não bate ──────────────────────
  {
    const acc = 'bt_nohit';
    treeCampaigns = [campaign({ metrics: { spend: 10, conversions: 0, impressions: 100, clicks: 5 } })]; // volume abaixo do piso
    const out = await automation.backtestRules(acc, {
      rules: [{ id: 'r1', enabled: true, metric: 'spend_no_conv', threshold: 5 }],
    });
    assert.strictEqual(out.findings.length, 0, 'volume abaixo do piso: nenhum hit');
    assert.strictEqual(out.summary.hits, 0);
  }

  // ── backtest: projeta a mudança de orçamento de um budget_up (roas_scale) ──
  {
    // maxBudgetChangePct alto p/ o passo de +50% valer (o default de 20% já
    // clampa e mascararia o teste do teto por campanha).
    policyOverride = { dryRun: false, maxBudgetChangePct: 100 };
    const acc = 'bt_scale';
    const campId = '1234567890123';
    leads = [{ stage: 'purchased', convertedAt: new Date().toISOString(), utm: { source: 'tiktok', campaign: campId }, reportedAmount: 10000 }];
    treeCampaigns = [campaign({ platformCampaignId: campId, adSets: [{ platformAdSetId: 'g1', budget: { amount: 50, type: 'daily' } }], metrics: { spend: 10, conversions: 1, impressions: 100, clicks: 5 } })];
    const out = await automation.backtestRules(acc, {
      rules: [{ id: 'r1', enabled: true, metric: 'roas_scale', threshold: 2, minSales: 1, pct: 50, budgetCap: 60 }],
    });
    assert.strictEqual(out.findings.length, 1, 'roas_scale bate no backtest');
    const f = out.findings[0];
    assert.strictEqual(f.action, 'budget_up');
    assert.ok(f.projected, 'traz a projeção de orçamento');
    assert.strictEqual(f.projected.changes.length, 1, 'projeta 1 grupo');
    assert.strictEqual(f.projected.changes[0].to, 60, '50→75 clampa no teto 60');
    assert.strictEqual(f.projected.capped, 1, 'marca que o teto foi aplicado');
    assert.strictEqual(calls.budget.length, 0, 'projeção não altera orçamento de verdade');
    leads = [];
    policyOverride = { dryRun: false };
  }

  // ── backtest: schedule é ignorado; sem regras utilizáveis → skipped ────────
  {
    const acc = 'bt_sched';
    treeCampaigns = [campaign()];
    const out = await automation.backtestRules(acc, {
      rules: [{ id: 's1', enabled: true, metric: 'schedule', days: [1, 2], startTime: '09:00', endTime: '18:00' }],
    });
    assert.strictEqual(out.skipped, true, 'só schedule: nada para simular');
    assert.strictEqual(out.findings.length, 0);
  }

  // ── breaker: warming up (poucas amostras) nunca abre ──────────────────────
  {
    const acc = 'br_warm';
    resetOutcomes(acc);
    const { recordOutcome } = automation._internals;
    for (let i = 0; i < 5; i++) recordOutcome(acc, false); // 5 falhas, < mínimo de 10
    const st = automation.getBreakerState(acc, adsOps.normalizePolicy({ circuitBreakerErrorPct: 25 }));
    assert.strictEqual(st.open, false, 'abaixo do mínimo de amostras: breaker fechado');
    assert.strictEqual(st.warmingUp, true, 'sinaliza aquecimento');
    assert.strictEqual(st.samples, 5);
    assert.strictEqual(st.failures, 5);
    assert.strictEqual(st.failureRatePct, 100);
    assert.ok(st.lastOutcomeAt, 'traz o timestamp do último resultado');
  }

  // ── breaker: acima do threshold com amostras suficientes → aberto ─────────
  {
    const acc = 'br_open';
    resetOutcomes(acc);
    const { recordOutcome } = automation._internals;
    // 10 amostras, 4 falhas = 40% ≥ threshold 25%
    for (let i = 0; i < 6; i++) recordOutcome(acc, true);
    for (let i = 0; i < 4; i++) recordOutcome(acc, false);
    const st = automation.getBreakerState(acc, adsOps.normalizePolicy({ circuitBreakerErrorPct: 25 }));
    assert.strictEqual(st.samples, 10);
    assert.strictEqual(st.failures, 4);
    assert.strictEqual(st.failureRatePct, 40);
    assert.strictEqual(st.open, true, '40% de falha ≥ 25%: breaker aberto');
    assert.strictEqual(st.warmingUp, false);
    // threshold mais alto (50%) com o mesmo histórico → fechado
    const st2 = automation.getBreakerState(acc, adsOps.normalizePolicy({ circuitBreakerErrorPct: 50 }));
    assert.strictEqual(st2.open, false, '40% < 50%: fechado sob threshold maior');
    assert.strictEqual(st2.thresholdPct, 50, 'reflete o threshold configurado');
  }

  // ── breaker: conta sem histórico → estado neutro ──────────────────────────
  {
    const st = automation.getBreakerState('br_empty', null);
    assert.strictEqual(st.open, false);
    assert.strictEqual(st.samples, 0);
    assert.strictEqual(st.failureRatePct, 0);
    assert.strictEqual(st.thresholdPct, 25, 'sem política usa o default de 25%');
    assert.strictEqual(st.lastOutcomeAt, null);
  }

  console.log('ads-backtest.test.js: OK');
})().catch((e) => { console.error(e); process.exit(1); });

function resetOutcomes(accId) {
  automation._internals.actionOutcomes.delete(accId);
  automation._internals.breakerLastAt.delete(accId);
}
