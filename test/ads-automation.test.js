// Testes do motor de automações (ads-automation.js): validação de regras,
// guardas de volume das métricas novas, teto do roas_scale, cooldowns,
// dayparting (janela normal, cruzando meia-noite, autoria de pausa) e
// não-regressão do contrato das rotas.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const provider = require('../ads-provider');
const cache = require('../ads-cache-store');
const adsOps = require('../ads-ops-store');
const automation = require('../ads-automation');

// ── Stubs: nenhum teste toca rede/Neon ──────────────────────────────────────
const calls = { status: [], budget: [], upserts: [], deletes: [] };
provider.enabled = true;
provider.resolveAdvertiserId = async () => 'adv1';
provider.getAdvertiserInfo = async () => ({ id: 'adv1', timezone: 'UTC' });
provider.setCampaignStatus = async (adv, ids, status) => { calls.status.push({ adv, ids, status }); };
provider.updateAdGroup = async (adv, id, patch) => { calls.budget.push({ adv, id, patch }); };
const stateByAcc = {};
provider.getState = (accId) => stateByAcc[accId] || {};
provider.setState = (accId, patch) => { stateByAcc[accId] = Object.assign({}, stateByAcc[accId], patch); };
cache.upsertAutomationState = async (acc, key, kind, meta) => { calls.upserts.push({ acc, key, kind, meta }); };
cache.deleteAutomationState = async (acc, key) => { calls.deletes.push({ acc, key }); };
cache.listAutomationState = async () => [];
// Política base: usa a normalização REAL para carregar todos os campos com
// defaults (maxBudgetChangePct, maxActionsPerHour, circuitBreakerErrorPct...).
// Os testes sobrescrevem `policyOverride` para exercitar cada guarda.
let policyOverride = { dryRun: false };
adsOps.getSafetyPolicy = async () => adsOps.normalizePolicy(policyOverride);
adsOps.appendAuditEvent = async () => ({ id: 'audit_test' });
// Contador durável de ações/hora: por padrão zero (sem histórico). Testes do
// cap sobrescrevem para simular ações já feitas na janela.
let recentActions = 0;
adsOps.countRecentEngineActions = async () => recentActions;

let treeCampaigns = [];
// intercepta a fonte da árvore: cache está off (sem DATABASE_URL no teste),
// então treeForSweep cai no provider.getDashboardTree
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
function resetCalls() { calls.status.length = 0; calls.budget.length = 0; calls.upserts.length = 0; calls.deletes.length = 0; }
function clearCooldowns(accId) { automation._internals.memState.delete(accId); }
function configureRules(accId, rules, advertiserId = 'adv1') {
  const profile = automation.getAutomationProfile(accId, advertiserId);
  return automation.saveRules(accId, advertiserId, rules, profile.revision);
}

(async () => {
  // ── Autonomia total nunca roda sem os guardrails mínimos ─────────────────
  {
    assert.throws(
      () => automation.assertAutomaticPolicy(adsOps.normalizePolicy({ enabled: false }), 'adv1'),
      (error) => error.code === 'ADS_SAFETY_POLICY_DISABLED' && error.status === 409,
      'política desativada bloqueia Agir sozinho',
    );
    assert.throws(
      () => automation.assertAutomaticPolicy(adsOps.normalizePolicy({ blockedAdvertiserIds: ['adv1'] }), 'adv1'),
      (error) => error.code === 'ADS_ADVERTISER_BLOCKED',
      'advertiser bloqueado não recebe ação automática',
    );
    assert.throws(
      () => automation.assertAutomaticPolicy(adsOps.normalizePolicy({ maxActionsPerHour: 0 }), 'adv1'),
      (error) => error.code === 'ADS_AUTOMATION_ACTION_CAP_REQUIRED',
      'anti-loop desligado bloqueia Agir sozinho',
    );
    assert.strictEqual(
      automation.assertAutomaticPolicy(adsOps.normalizePolicy({ maxActionsPerHour: 10 }), 'adv1'),
      true,
      'política segura libera a autonomia total',
    );
  }

  // ── validateRules: defaults seguros + campos novos ────────────────────────
  {
    const rules = automation.validateRules([
      { enabled: true, metric: 'cpa_max', threshold: 10 },              // regra antiga, sem campos novos
      { enabled: true, metric: 'ctr_min', threshold: 0.5 },
      { enabled: true, metric: 'cpm_max', threshold: 20 },
      { enabled: true, metric: 'roas_scale', threshold: 3, budgetCap: 100 },
      { enabled: true, metric: 'roas_scale', threshold: 3 },            // SEM teto
      { enabled: true, metric: 'schedule', days: [1, 2], startTime: '18:00', endTime: '23:00' },
      { enabled: true, metric: 'schedule', days: [] },                  // sem dias
      { enabled: true, metric: 'invented', threshold: 5 },              // métrica inválida
    ]);
    assert.strictEqual(rules.find((r) => r.metric === 'ctr_min').minImpressions, 1000, 'ctr_min ganha guarda default de 1000 impressões');
    assert.strictEqual(rules.find((r) => r.metric === 'cpm_max').minSpend, 1, 'cpm_max ganha guarda default de gasto 1');
    const scales = rules.filter((r) => r.metric === 'roas_scale');
    assert.strictEqual(scales[0].enabled, true, 'roas_scale com teto fica habilitada');
    assert.strictEqual(scales[0].action, 'budget_up', 'roas_scale é sempre budget_up');
    assert.strictEqual(scales[1].enabled, false, 'roas_scale SEM teto é desativada (nunca escala sem limite)');
    const scheds = rules.filter((r) => r.metric === 'schedule');
    assert.strictEqual(scheds.length, 1, 'schedule sem dias é filtrada');
    assert.strictEqual(rules.find((r) => r.metric === 'invented'), undefined, 'métrica inválida vira cpa_max');
    // regra antiga avalia sem lançar (campos novos ausentes → defaults)
    assert.strictEqual(rules[0].metric, 'cpa_max');
  }

  // ── perfil por advertiser + revisão + autonomia realmente global ─────────
  {
    const acc = 'acc_profiles';
    const a0 = automation.getAutomationProfile(acc, 'advA');
    const a1 = automation.saveRules(acc, 'advA', [
      { id: 'advanced', enabled: true, metric: 'spend_no_conv', threshold: 20, mode: 'execute' },
      { id: 'pilot', enabled: true, metric: 'cpa_max', threshold: 15, mode: 'execute', pilot: 'protector', intensity: 'normal' },
      { id: 'schedule', enabled: true, metric: 'schedule', days: [1, 2, 3], startTime: '09:00', endTime: '18:00', mode: 'execute' },
    ], a0.revision);
    const b0 = automation.getAutomationProfile(acc, 'advB');
    assert.notDeepStrictEqual(a1.rules.map((r) => r.id), b0.rules.map((r) => r.id), 'advertiser B não herda regras do advertiser A');

    assert.throws(
      () => automation.saveRules(acc, 'advA', a1.rules, a0.revision),
      (e) => e.status === 409 && e.code === 'AUTOMATION_REVISION_CONFLICT',
      'revisão antiga é recusada com 409',
    );

    const withAppeal = automation.saveAlerts(acc, 'advA', { ...a1.alerts, enabled: true, autoAppealSmartPlus: true }, a1.revision);
    const notify = automation.setGlobalAutonomy(acc, 'advA', 'notify', withAppeal.revision);
    assert.strictEqual(notify.revision, withAppeal.revision + 1, 'mudança global incrementa uma única revisão');
    assert.ok(notify.rules.every((r) => !r.enabled), 'Só avisar desliga piloto, regra avançada e agendamento');
    assert.strictEqual(notify.alerts.enabled, true, 'Só avisar liga alertas na mesma gravação');
    assert.strictEqual(notify.alerts.autoAppealSmartPlus, false, 'Só avisar também desliga o auto-recurso, que é uma ação real');
    const propose = automation.setGlobalAutonomy(acc, 'advA', 'propose', notify.revision);
    assert.ok(propose.rules.every((r) => r.enabled && r.mode === 'proposal'), 'Propor restaura as regras e alcança todos os tipos');
    assert.strictEqual(propose.alerts.autoAppealSmartPlus, false, 'Propor não deixa auto-recurso agir sem aprovação');
    const auto = automation.setGlobalAutonomy(acc, 'advA', 'auto', propose.revision);
    assert.ok(auto.rules.every((r) => r.enabled && r.mode === 'execute'), 'Agir sozinho muda todas as regras para execução');
    assert.strictEqual(auto.alerts.autoAppealSmartPlus, true, 'Agir sozinho restaura o auto-recurso previamente autorizado');
  }

  // O estado legado só é migrado para o primeiro advertiser aberto.
  {
    const acc = 'acc_legacy_profile';
    provider.setState(acc, { rules: [{ id: 'legacy', enabled: true, metric: 'cpa_max', threshold: 9, mode: 'proposal' }] });
    const first = automation.getAutomationProfile(acc, 'advLegacyA');
    const second = automation.getAutomationProfile(acc, 'advLegacyB');
    assert.ok(first.rules.some((r) => r.id === 'legacy'), 'primeiro advertiser recebe a configuração legada');
    assert.ok(!second.rules.some((r) => r.id === 'legacy'), 'segundo advertiser nasce isolado');
  }

  // Falhas e circuit breaker de um advertiser não congelam outro.
  {
    const acc = 'acc_breaker_scope';
    const policy = adsOps.normalizePolicy({ circuitBreakerErrorPct: 25 });
    for (let i = 0; i < 10; i += 1) automation._internals.recordOutcome(acc, false, 'advA');
    assert.strictEqual(automation.getBreakerState(acc, policy, 'advA').open, true, 'breaker abre no advertiser com falhas');
    assert.strictEqual(automation.getBreakerState(acc, policy, 'advB').open, false, 'outro advertiser permanece independente');
  }

  // ── validateRules: passthrough de pilot/intensity (camada de pilotos) ─────
  {
    const [tagged] = automation.validateRules([
      { metric: 'cpa_max', threshold: 5, pilot: 'protector', intensity: 'normal' },
    ]);
    assert.strictEqual(tagged.pilot, 'protector', 'pilot válido é preservado');
    assert.strictEqual(tagged.intensity, 'normal', 'intensity válida é preservada');
    const [untagged] = automation.validateRules([
      { metric: 'cpa_max', threshold: 5, pilot: 'xyz', intensity: 'brutal' },
    ]);
    assert.strictEqual(untagged.pilot, undefined, 'pilot fora do vocabulário é descartado');
    assert.strictEqual(untagged.intensity, undefined, 'intensity fora do vocabulário é descartada');
    // limite duro de 12 regras: o slice é silencioso — a camada de pilotos
    // PRECISA consumir presets ao ativar pilotos para nunca perder regra aqui
    const thirteen = automation.validateRules(Array.from({ length: 13 }, (_, i) => ({ metric: 'cpa_max', threshold: i + 1 })));
    assert.strictEqual(thirteen.length, 12, 'máximo de 12 regras (13ª é cortada)');
  }

  // ── dayparting: janela normal / cruzando meia-noite / dias ────────────────
  {
    const { scheduleActiveNow } = automation._internals;
    const base = new Date('2026-07-15T12:00:00Z'); // quarta-feira, 12:00 UTC
    const utc = (r) => scheduleActiveNow(Object.assign({ timezone: 'UTC', days: [0, 1, 2, 3, 4, 5, 6] }, r), base);
    assert.strictEqual(utc({ startTime: '09:00', endTime: '18:00' }), true, 'dentro da janela normal');
    assert.strictEqual(utc({ startTime: '13:00', endTime: '18:00' }), false, 'antes da janela');
    assert.strictEqual(utc({ startTime: '22:00', endTime: '02:00' }), false, 'fora da janela que cruza meia-noite');
    const night = new Date('2026-07-15T23:30:00Z');
    assert.strictEqual(scheduleActiveNow({ timezone: 'UTC', days: [3], startTime: '22:00', endTime: '02:00' }, night), true, '23:30 dentro de 22–02 (dia atual)');
    const after = new Date('2026-07-16T01:00:00Z'); // quinta 01:00 — janela começou quarta (dia 3)
    assert.strictEqual(scheduleActiveNow({ timezone: 'UTC', days: [3], startTime: '22:00', endTime: '02:00' }, after), true, '01:00 pós-meia-noite pertence à janela do dia anterior');
    assert.strictEqual(scheduleActiveNow({ timezone: 'UTC', days: [4], startTime: '22:00', endTime: '02:00' }, after), false, '01:00 não pertence à janela de quinta (ainda não começou)');
    // fuso: 12:00 UTC = 13:00 em Lisboa (verão) — janela 12:30–14:00 Lisboa pega
    assert.strictEqual(scheduleActiveNow({ timezone: 'Europe/Lisbon', days: [0, 1, 2, 3, 4, 5, 6], startTime: '12:30', endTime: '14:00' }, base), true, 'conversão de fuso aplicada');
  }

  // ── ctr_min: guarda de impressões mínimas ─────────────────────────────────
  {
    const acc = 'acc_ctr';
    configureRules(acc, [{ id: 'r1', enabled: true, metric: 'ctr_min', threshold: 1, minImpressions: 1000, mode: 'execute' }]);
    resetCalls(); clearCooldowns(acc);
    treeCampaigns = [campaign({ metrics: { spend: 5, conversions: 0, impressions: 200, clicks: 0 } })];
    let out = await automation.runRulesSweep(acc, { force: true });
    assert.strictEqual(out.executed.length, 0, 'poucas impressões: ctr_min NÃO dispara');
    treeCampaigns = [campaign({ metrics: { spend: 5, conversions: 0, impressions: 5000, clicks: 10 } })]; // CTR 0.2%
    clearCooldowns(acc);
    out = await automation.runRulesSweep(acc, { force: true });
    assert.strictEqual(out.executed.length, 1, 'com volume e CTR baixo: dispara');
    assert.strictEqual(calls.status.length, 1, 'pausou via API');
    assert.strictEqual(calls.status[0].status, 'paused');
  }

  // ── cpm_max: guarda de gasto mínimo ───────────────────────────────────────
  {
    const acc = 'acc_cpm';
    configureRules(acc, [{ id: 'r1', enabled: true, metric: 'cpm_max', threshold: 10, minSpend: 2, mode: 'execute' }]);
    resetCalls(); clearCooldowns(acc);
    treeCampaigns = [campaign({ metrics: { spend: 0.5, conversions: 0, impressions: 10, clicks: 0 } })]; // CPM 50 mas gasto 0.5
    let out = await automation.runRulesSweep(acc, { force: true });
    assert.strictEqual(out.executed.length, 0, 'gasto abaixo do mínimo: cpm_max NÃO dispara');
    treeCampaigns = [campaign({ metrics: { spend: 5, conversions: 0, impressions: 100, clicks: 0 } })]; // CPM 50
    clearCooldowns(acc);
    out = await automation.runRulesSweep(acc, { force: true });
    assert.strictEqual(out.executed.length, 1, 'com gasto e CPM alto: dispara');
  }

  // ── roas_scale: teto respeitado + cooldown de 24h ─────────────────────────
  {
    const acc = 'acc_scale';
    // atenção: a atribuição só casa utm.campaign com ID NUMÉRICO (macro
    // __CAMPAIGN_ID__ do TikTok) — por isso o ID aqui é numérico de verdade
    const campId = '1234567890123';
    configureRules(acc, [{ id: 'r1', enabled: true, metric: 'roas_scale', threshold: 2, minSales: 1, pct: 50, budgetCap: 60, mode: 'execute' }]);
    leads = [{ stage: 'purchased', convertedAt: new Date().toISOString(), utm: { source: 'tiktok', campaign: campId }, reportedAmount: 10000 }]; // 100 de receita
    resetCalls(); clearCooldowns(acc);
    treeCampaigns = [campaign({ platformCampaignId: campId, metrics: { spend: 10, conversions: 1, impressions: 100, clicks: 5 } })]; // ROAS 10
    let out = await automation.runRulesSweep(acc, { force: true });
    assert.strictEqual(out.executed.length, 1, 'roas_scale dispara com venda + ROAS alto');
    assert.strictEqual(calls.budget.length, 1, 'orçamento alterado 1x');
    assert.strictEqual(calls.budget[0].patch.budget.amount, 60, '50→75 estoura o teto 60: clampa em 60');
    // segundo sweep imediato: cooldown de 24h bloqueia
    out = await automation.runRulesSweep(acc, { force: true });
    assert.strictEqual(out.executed.length, 0, 'cooldown de 24h: não escala de novo');
    // grupo já no teto: não toca
    clearCooldowns(acc);
    resetCalls();
    treeCampaigns = [campaign({ platformCampaignId: campId, adSets: [{ platformAdSetId: 'g1', budget: { amount: 60, type: 'daily' } }], metrics: { spend: 10, conversions: 1, impressions: 100, clicks: 5 } })];
    out = await automation.runRulesSweep(acc, { force: true });
    assert.strictEqual(calls.budget.length, 0, 'já no teto: zero chamadas de orçamento');
    leads = [];
  }

  // ── estado durável: falha de persistência aborta e restaura memória ──────
  {
    const acc = 'acc_state_persist';
    const key = 'adv:adv1:rule:c1:persist';
    clearCooldowns(acc);
    const originalUpsert = cache.upsertAutomationState;
    cache.upsertAutomationState = async () => { throw new Error('Neon indisponível'); };
    await assert.rejects(
      automation._internals.markFired(acc, key, 'rule', { action: 'pause' }),
      (error) => error && error.code === 'ADS_AUTOMATION_STATE_PERSIST_FAILED',
      'falha ao persistir cooldown é visível e bloqueia a ação',
    );
    assert.strictEqual(
      automation._internals.memState.get(acc).has(key),
      false,
      'write-through falho não deixa cooldown fantasma só em memória',
    );
    cache.upsertAutomationState = originalUpsert;

    await automation._internals.markFired(acc, key, 'rule', { action: 'pause' });
    const originalDelete = cache.deleteAutomationState;
    cache.deleteAutomationState = async () => { throw new Error('Neon indisponível'); };
    await assert.rejects(
      automation._internals.clearFired(acc, key),
      (error) => error && error.code === 'ADS_AUTOMATION_STATE_PERSIST_FAILED',
      'falha ao remover estado durável também é visível',
    );
    assert.strictEqual(
      automation._internals.memState.get(acc).has(key),
      true,
      'delete falho restaura a marca local conservadora',
    );
    cache.deleteAutomationState = originalDelete;
  }

  // ── estado durável: falha de LEITURA não permite sobrescrever cooldown ───
  {
    const acc = 'acc_state_read';
    const key = 'adv:adv1:rule:c1:read';
    clearCooldowns(acc);
    const originalEnabled = cache.enabled;
    const originalList = cache.listAutomationState;
    const originalUpsert = cache.upsertAutomationState;
    let upsertCalls = 0;
    cache.enabled = true;
    cache.listAutomationState = async () => { throw new Error('leitura Neon indisponível'); };
    cache.upsertAutomationState = async () => { upsertCalls += 1; };
    await assert.rejects(
      automation._internals.markFired(acc, key, 'rule', { action: 'pause' }),
      (error) => error && error.code === 'ADS_AUTOMATION_STATE_PERSIST_FAILED',
      'instância nova falha fechada quando não consegue hidratar cooldowns',
    );
    assert.strictEqual(upsertCalls, 0, 'não sobrescreve o timestamp antigo sem antes conseguir lê-lo');
    assert.strictEqual(
      automation._internals.memState.get(acc).has(key),
      false,
      'falha de leitura não cria marca local permissiva',
    );
    cache.enabled = originalEnabled;
    cache.listAutomationState = originalList;
    cache.upsertAutomationState = originalUpsert;
  }

  // ── roas_min: sem vendas atribuíveis não age ──────────────────────────────
  {
    const acc = 'acc_roas';
    configureRules(acc, [{ id: 'r1', enabled: true, metric: 'roas_min', threshold: 2 }]);
    leads = []; // NENHUMA venda atribuída
    resetCalls(); clearCooldowns(acc);
    treeCampaigns = [campaign({ metrics: { spend: 100, conversions: 0, impressions: 1000, clicks: 50 } })];
    const out = await automation.runRulesSweep(acc, { force: true });
    assert.strictEqual(out.executed.length, 0, 'ROAS 0 sem NENHUMA venda atribuída pode ser atraso de webhook: não pausa');
  }

  // ── cooldown: write-through no Neon (persistência) ────────────────────────
  {
    const acc = 'acc_cd';
    configureRules(acc, [{ id: 'r1', enabled: true, metric: 'spend_no_conv', threshold: 5, mode: 'execute' }]);
    resetCalls(); clearCooldowns(acc);
    // volume acima dos pisos default (1000 impr. / 30 cliques) p/ a regra agir
    treeCampaigns = [campaign({ metrics: { spend: 10, conversions: 0, impressions: 2000, clicks: 40 } })];
    await automation.runRulesSweep(acc, { force: true });
    const ruleUpserts = calls.upserts.filter((u) => u.key.includes(':rule:'));
    assert.strictEqual(ruleUpserts.length, 1, 'cooldown gravado no Neon (write-through)');
    assert.strictEqual(ruleUpserts[0].acc, acc);
    // simula "restart": memória limpa, mas o Neon devolve o cooldown → não re-age
    clearCooldowns(acc);
    cache.listAutomationState = async () => [{ key: ruleUpserts[0].key, kind: 'rule', lastFiredAt: new Date().toISOString(), meta: {} }];
    resetCalls();
    const out = await automation.runRulesSweep(acc, { force: true });
    assert.strictEqual(out.executed.length, 0, 'pós-restart o cooldown vem do Neon: NÃO age de novo');
    cache.listAutomationState = async () => [];
  }

  // ── dayparting: pausa fora da janela, só reativa o que ELE pausou ─────────
  {
    const acc = 'acc_sched';
    // janela impossível agora: 1 minuto em dia que não é hoje (UTC)
    const now = new Date();
    const notToday = (now.getUTCDay() + 3) % 7;
    configureRules(acc, [{ id: 's1', enabled: true, metric: 'schedule', days: [notToday], startTime: '03:00', endTime: '03:01', timezone: 'UTC', mode: 'execute' }]);
    resetCalls(); clearCooldowns(acc);
    treeCampaigns = [
      campaign({ platformCampaignId: 'c1', status: 'active' }),
      campaign({ platformCampaignId: 'c2', status: 'paused' }), // pausada por OUTRO motivo
    ];
    let out = await automation.runScheduleSweep(acc, { force: true });
    assert.strictEqual(out.executed.length, 1, 'fora da janela: pausa só a ativa');
    assert.deepStrictEqual(calls.status[0].ids, ['c1']);
    assert.strictEqual(calls.status[0].status, 'paused');
    assert.ok(calls.upserts.some((u) => u.key === 'adv:adv1:sched:s1:c1'), 'autoria da pausa persistida por advertiser');

    // agora janela SEMPRE ativa: só reativa c1 (que ELE pausou); c2 fica quieta
    // start=end é o contrato de janela de 24h. Usar 00:00–23:59 deixava o
    // teste falhar justamente no último minuto do dia UTC.
    configureRules(acc, [{ id: 's1', enabled: true, metric: 'schedule', days: [0, 1, 2, 3, 4, 5, 6], startTime: '00:00', endTime: '00:00', timezone: 'UTC', mode: 'execute' }]);
    resetCalls();
    treeCampaigns = [
      campaign({ platformCampaignId: 'c1', status: 'paused' }),
      campaign({ platformCampaignId: 'c2', status: 'paused' }),
    ];
    out = await automation.runScheduleSweep(acc, { force: true });
    assert.strictEqual(out.executed.length, 1, 'só reativa a campanha que o agendamento pausou');
    assert.deepStrictEqual(calls.status[0].ids, ['c1']);
    assert.strictEqual(calls.status[0].status, 'active');
    assert.ok(calls.deletes.some((d) => d.key === 'adv:adv1:sched:s1:c1'), 'marcação de autoria limpa após reativar');

    // idempotência: estado já correto → zero chamadas
    resetCalls();
    treeCampaigns = [campaign({ platformCampaignId: 'c1', status: 'active' })];
    out = await automation.runScheduleSweep(acc, { force: true });
    assert.strictEqual(calls.status.length, 0, 'status já correto: nenhuma chamada à API');
  }

  // ── dayparting respeita “Propor”: não executa por fora da autonomia ──────
  {
    const acc = 'acc_sched_proposal';
    const now = new Date();
    const notToday = (now.getUTCDay() + 3) % 7;
    configureRules(acc, [{ id: 's1', enabled: true, metric: 'schedule', days: [notToday], startTime: '03:00', endTime: '03:01', timezone: 'UTC', mode: 'proposal' }]);
    resetCalls(); clearCooldowns(acc);
    treeCampaigns = [campaign({ platformCampaignId: 'c-proposal', status: 'active' })];
    const out = await automation.runScheduleSweep(acc, { force: true, advertiserId: 'adv1' });
    assert.strictEqual(calls.status.length, 0, 'agendamento em Propor não toca a plataforma');
    assert.strictEqual(out.executed.length, 1, 'agendamento registra a intenção');
    assert.strictEqual(out.executed[0].proposed, true, 'intenção marcada como proposta');
    assert.ok(!calls.upserts.some((u) => u.key.includes('sched:s1:c-proposal')), 'autoria da pausa só nasce após aprovação real');
  }

  // ── agendas conflitantes: pausa sempre vence reativação ──────────────────
  {
    const acc = 'acc_sched_conflict';
    const today = new Date().getUTCDay();
    const otherDay = (today + 1) % 7;
    configureRules(acc, [
      {
        id: 'outside',
        enabled: true,
        metric: 'schedule',
        days: [otherDay],
        startTime: '00:00',
        endTime: '00:00',
        mode: 'execute',
      },
      {
        id: 'inside',
        enabled: true,
        metric: 'schedule',
        days: [today],
        startTime: '00:00',
        endTime: '00:00',
        mode: 'execute',
      },
    ]);
    resetCalls();
    clearCooldowns(acc);
    await automation._internals.markFired(
      acc,
      'adv:adv1:sched:inside:c-conflict',
      'sched',
      { ruleId: 'inside' },
    );
    resetCalls();
    treeCampaigns = [campaign({ platformCampaignId: 'c-conflict', status: 'paused' })];
    const out = await automation.runScheduleSweep(acc, {
      force: true,
      advertiserId: 'adv1',
    });
    assert.strictEqual(calls.status.length, 0, 'janela fechada mantém a campanha pausada e bloqueia reativação rival');
    assert.strictEqual(out.executed.length, 0, 'retenção de pausa não é registrada como nova mutação');
    assert.strictEqual(out.conflicts.length, 1, 'conflito entre agendas fica explícito');
    assert.strictEqual(out.conflicts[0].selectedAction, 'pause', 'decisão conservadora vence');
  }

  // ── perda do lease: zero cooldown, dead-letter ou breaker falso ───────────
  {
    const acc = 'acc_lost_lease';
    configureRules(acc, [{
      id: 'lost',
      enabled: true,
      metric: 'spend_no_conv',
      threshold: 5,
      lookbackDays: 1,
      action: 'pause',
      mode: 'execute',
    }]);
    resetCalls();
    clearCooldowns(acc);
    treeCampaigns = [campaign({
      platformCampaignId: 'c-lost',
      status: 'active',
      metrics: { spend: 20, conversions: 0, impressions: 2000, clicks: 40 },
    })];
    const originalDeadLetter = adsOps.addActionDeadLetter;
    let deadLetters = 0;
    adsOps.addActionDeadLetter = async () => { deadLetters += 1; };
    const before = automation.getBreakerState(acc, adsOps.normalizePolicy({}), 'adv1').samples;
    const lost = new Error('lease perdido');
    lost.code = 'AUTOMATION_LEASE_LOST';
    await assert.rejects(
      automation.runRulesSweep(acc, {
        force: true,
        advertiserId: 'adv1',
        leaseGuard: async () => { throw lost; },
      }),
      (error) => error && error.code === 'AUTOMATION_LEASE_LOST',
    );
    adsOps.addActionDeadLetter = originalDeadLetter;
    assert.strictEqual(calls.status.length, 0, 'lease perdido antes da mutação não chama o TikTok');
    assert.strictEqual(deadLetters, 0, 'falha de coordenação não cria dead-letter de provider');
    assert.strictEqual(
      automation.getBreakerState(acc, adsOps.normalizePolicy({}), 'adv1').samples,
      before,
      'falha de coordenação não alimenta o circuit breaker',
    );
    const cooldownState = automation._internals.memState.get(acc);
    assert.ok(
      !cooldownState || !cooldownState.has('adv:adv1:rule:c-lost:lost'),
      'reserva de cooldown é liberada quando nenhuma ação foi enviada',
    );
  }

  // ── dry-run: avalia e loga, mas NÃO toca a plataforma ─────────────────────
  {
    policyOverride = { dryRun: true };
    const acc = 'acc_dry';
    configureRules(acc, [{ id: 'r1', enabled: true, metric: 'spend_no_conv', threshold: 5, mode: 'execute' }]);
    resetCalls(); clearCooldowns(acc);
    treeCampaigns = [campaign({ metrics: { spend: 10, conversions: 0, impressions: 2000, clicks: 40 } })];
    const out = await automation.runRulesSweep(acc, { force: true });
    assert.strictEqual(out.executed.length, 1, 'dry-run avalia e registra');
    assert.strictEqual(out.executed[0].simulated, true, 'entrada marcada como simulada');
    assert.strictEqual(calls.status.length, 0, 'dry-run: NENHUMA escrita na plataforma');
    policyOverride = { dryRun: false };
  }

  // ── GUARDA: kill switch aborta a varredura inteira (zero avaliação) ───────
  {
    policyOverride = { dryRun: false, killSwitch: true };
    const acc = 'acc_kill';
    configureRules(acc, [{ id: 'r1', enabled: true, metric: 'spend_no_conv', threshold: 5, mode: 'execute' }]);
    resetCalls(); clearCooldowns(acc);
    treeCampaigns = [campaign({ metrics: { spend: 999, conversions: 0, impressions: 5000, clicks: 100 } })];
    const out = await automation.runRulesSweep(acc, { force: true });
    assert.strictEqual(out.killSwitch, true, 'sweep sinaliza killSwitch');
    assert.strictEqual(out.executed.length, 0, 'kill switch: nada avaliado nem executado');
    assert.strictEqual(calls.status.length, 0, 'kill switch: nenhuma escrita');
    // schedule também respeita o kill switch
    configureRules(acc, [{ id: 's1', enabled: true, metric: 'schedule', days: [0, 1, 2, 3, 4, 5, 6], startTime: '00:00', endTime: '23:59', timezone: 'UTC', mode: 'execute' }]);
    treeCampaigns = [campaign({ platformCampaignId: 'c1', status: 'active' })];
    const outS = await automation.runScheduleSweep(acc, { force: true });
    assert.strictEqual(outS.killSwitch, true, 'dayparting também aborta com kill switch');
    assert.strictEqual(calls.status.length, 0, 'kill switch: dayparting não escreve');
    policyOverride = { dryRun: false };
  }

  // ── GUARDA: política desligada/bloqueada impede configs antigas de agir ──
  {
    const acc = 'acc_policy_blocked';
    configureRules(acc, [{ id: 'r1', enabled: true, metric: 'spend_no_conv', threshold: 5, mode: 'execute' }]);
    resetCalls(); clearCooldowns(acc);
    treeCampaigns = [campaign({ metrics: { spend: 100, conversions: 0, impressions: 5000, clicks: 100 } })];

    policyOverride = { dryRun: false, enabled: false };
    let out = await automation.runRulesSweep(acc, { force: true, advertiserId: 'adv1' });
    assert.strictEqual(out.policyBlocked, true, 'regra automática antiga não age com política desligada');
    assert.strictEqual(calls.status.length, 0, 'política desligada impede escrita no TikTok');

    policyOverride = { dryRun: false, blockedAdvertiserIds: ['adv1'] };
    out = await automation.runRulesSweep(acc, { force: true, advertiserId: 'adv1' });
    assert.strictEqual(out.reasonCode, 'ADS_ADVERTISER_BLOCKED', 'bloqueio do advertiser chega ao sweep');
    assert.strictEqual(calls.status.length, 0, 'advertiser bloqueado não recebe escrita');

    policyOverride = { dryRun: false };
  }

  // ── GUARDA: teto de gasto diário recusa budget_up sem consumir cooldown ───
  {
    // maxBudgetChangePct alto p/ o passo de +50% valer; teto de gasto é o que barra.
    policyOverride = { dryRun: false, dailySpendCap: 60, maxBudgetChangePct: 100 };
    const acc = 'acc_cap';
    // roas_scale quer +50% em cima de 50 = 75; conta já gasta 50/dia; teto 60
    const campId = '9990000000001';
    configureRules(acc, [{ id: 'r1', enabled: true, metric: 'roas_scale', threshold: 2, minSales: 1, pct: 50, budgetCap: 500, mode: 'execute' }]);
    leads = [{ stage: 'purchased', convertedAt: new Date().toISOString(), utm: { source: 'tiktok', campaign: campId }, reportedAmount: 10000 }];
    resetCalls(); clearCooldowns(acc);
    treeCampaigns = [campaign({ platformCampaignId: campId, adSets: [{ platformAdSetId: 'g1', budget: { amount: 50, type: 'daily' } }], metrics: { spend: 10, conversions: 1, impressions: 100, clicks: 5 } })];
    let out = await automation.runRulesSweep(acc, { force: true });
    assert.strictEqual(calls.budget.length, 0, 'teto de gasto diário: nenhuma alteração de orçamento aplicada');
    assert.ok(out.executed.some((e) => /teto de gasto/.test(e.result || '')), 'registra a recusa por teto de gasto');
    // recusa NÃO consumiu cooldown: com teto maior, a MESMA regra agora aplica
    policyOverride = { dryRun: false, dailySpendCap: 1000, maxBudgetChangePct: 100 };
    resetCalls();
    out = await automation.runRulesSweep(acc, { force: true });
    assert.strictEqual(calls.budget.length, 1, 'sem estouro de teto: aplica (prova que a recusa não gastou o cooldown)');
    leads = [];
    policyOverride = { dryRun: false };
  }

  // ── GUARDA: cap de ações/hora para o motor (anti-loop) ────────────────────
  {
    policyOverride = { dryRun: false, maxActionsPerHour: 2 };
    recentActions = 2; // já bateu o teto antes de começar
    const acc = 'acc_rate';
    configureRules(acc, [{ id: 'r1', enabled: true, metric: 'spend_no_conv', threshold: 5, mode: 'execute' }]);
    resetCalls(); clearCooldowns(acc);
    treeCampaigns = [
      campaign({ platformCampaignId: 'c1', metrics: { spend: 10, conversions: 0, impressions: 2000, clicks: 40 } }),
      campaign({ platformCampaignId: 'c2', metrics: { spend: 10, conversions: 0, impressions: 2000, clicks: 40 } }),
    ];
    const out = await automation.runRulesSweep(acc, { force: true });
    assert.strictEqual(calls.status.length, 0, 'cap de ações/hora já estourado: motor não age');
    assert.ok(out.executed.length === 0, 'nada executado quando o cap já foi atingido');
    recentActions = 0;
    policyOverride = { dryRun: false };
  }

  // ── GUARDA: pisos de volume de cpa_max / spend_no_conv ────────────────────
  {
    policyOverride = { dryRun: false };
    const acc = 'acc_vol';
    configureRules(acc, [{ id: 'r1', enabled: true, metric: 'spend_no_conv', threshold: 5, minClicks: 30, minImpressions: 1000, mode: 'execute' }]);
    resetCalls(); clearCooldowns(acc);
    // gastou acima do limiar mas com pouquíssimo volume (3 cliques) → NÃO age
    treeCampaigns = [campaign({ metrics: { spend: 10, conversions: 0, impressions: 100, clicks: 3 } })];
    let out = await automation.runRulesSweep(acc, { force: true });
    assert.strictEqual(out.executed.length, 0, 'volume insuficiente: spend_no_conv NÃO pausa (ruído estatístico)');
    // agora com volume suficiente → age
    clearCooldowns(acc);
    treeCampaigns = [campaign({ metrics: { spend: 10, conversions: 0, impressions: 2000, clicks: 40 } })];
    out = await automation.runRulesSweep(acc, { force: true });
    assert.strictEqual(out.executed.length, 1, 'com volume suficiente: spend_no_conv pausa');
  }

  // ── maxBudgetChangePct da política limita o passo do motor ────────────────
  {
    policyOverride = { dryRun: false, maxBudgetChangePct: 10 }; // teto 10% mesmo a regra pedindo 50%
    const acc = 'acc_step';
    const campId = '5550000000002';
    configureRules(acc, [{ id: 'r1', enabled: true, metric: 'roas_scale', threshold: 2, minSales: 1, pct: 50, budgetCap: 500, mode: 'execute' }]);
    leads = [{ stage: 'purchased', convertedAt: new Date().toISOString(), utm: { source: 'tiktok', campaign: campId }, reportedAmount: 10000 }];
    resetCalls(); clearCooldowns(acc);
    treeCampaigns = [campaign({ platformCampaignId: campId, adSets: [{ platformAdSetId: 'g1', budget: { amount: 100, type: 'daily' } }], metrics: { spend: 10, conversions: 1, impressions: 100, clicks: 5 } })];
    await automation.runRulesSweep(acc, { force: true });
    assert.strictEqual(calls.budget.length, 1, 'aplicou');
    assert.strictEqual(calls.budget[0].patch.budget.amount, 110, 'regra pedia +50% (150) mas a política limita a +10% → 110');
    leads = [];
    policyOverride = { dryRun: false };
  }

  // ── contrato: rotas delegam ao motor (não-regressão da extração) ──────────
  {
    const routes = fs.readFileSync(path.join(__dirname, '..', 'ads-routes.js'), 'utf8');
    assert.match(routes, /require\('\.\/ads-automation'\)/, 'rotas importam o motor');
    assert.match(routes, /automation\.init\(\{ stats, syncAfterWrite: adsSync\.syncAfterWrite \}\)/, 'motor inicializado com stats + syncAfterWrite injetados');
    assert.match(routes, /automation\.validateRules/, 'PUT /rules valida via motor');
    assert.match(routes, /automation\.runRulesSweep/, 'POST /rules/run delega ao motor');
    assert.match(routes, /automation\.setGlobalAutonomy/, 'autonomia global delega ao contrato atômico do motor');
    assert.match(routes, /AUTOMATION_REVISION_CONFLICT|currentRevision/, 'conflito de revisão tem resposta estruturada');
    assert.match(routes, /adsSweepHook\.fn = automation\.maybeSweep/, 'hook das rotas aponta pro motor');
    // Guardas de kill switch nas rotas de escrita individuais + rollback
    assert.match(routes, /async function killSwitchActive/, 'helper de kill switch existe nas rotas');
    const killGuards = routes.match(/killSwitchActive\(req\.account\.id\)/g) || [];
    assert.ok(killGuards.length >= 6, 'kill switch aplicado em ≥6 rotas de escrita (create/boost/identity/bulk-status/PUT/DELETE/copilot)');
    assert.match(routes, /app\.post\('\/api\/ads\/ops\/audit\/:auditId\/rollback'/, 'rota de rollback registrada');
    assert.match(routes, /app\.get\('\/api\/ads\/ops\/audit'/, 'rota de histórico de auditoria registrada');
    assert.match(routes, /adsOps\.listAuditEvents/, 'GET /ops/audit usa listAuditEvents');
    assert.match(routes, /adsOps\.getAuditEvent/, 'rollback lê o evento pelo id');
    const sync = fs.readFileSync(path.join(__dirname, '..', 'ads-sync.js'), 'utf8');
    assert.match(sync, /automation\.maybeSweep\(accId, scope\.advertiserId\)/, 'tick do sync varre automações 24/7 por advertiser explícito');
    assert.match(sync, /automation\.noteRecovery/, 'auto-recuperação de conta bloqueada ligada no tick');
    const auto = fs.readFileSync(path.join(__dirname, '..', 'ads-automation.js'), 'utf8');
    assert.doesNotMatch(auto, /require\('\.\/ads-sync'\)/, 'sem require circular: automation não importa ads-sync');
  }

  console.log('ads-automation.test.js: OK');
})().catch((err) => { console.error(err); process.exit(1); });
