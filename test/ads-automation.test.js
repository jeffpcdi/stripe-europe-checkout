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

(async () => {
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
    provider.setState(acc, { rules: automation.validateRules([{ id: 'r1', enabled: true, metric: 'ctr_min', threshold: 1, minImpressions: 1000 }]) });
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
    provider.setState(acc, { rules: automation.validateRules([{ id: 'r1', enabled: true, metric: 'cpm_max', threshold: 10, minSpend: 2 }]) });
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
    provider.setState(acc, { rules: automation.validateRules([{ id: 'r1', enabled: true, metric: 'roas_scale', threshold: 2, minSales: 1, pct: 50, budgetCap: 60 }]) });
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

  // ── roas_min: sem vendas atribuíveis não age ──────────────────────────────
  {
    const acc = 'acc_roas';
    provider.setState(acc, { rules: automation.validateRules([{ id: 'r1', enabled: true, metric: 'roas_min', threshold: 2 }]) });
    leads = []; // NENHUMA venda atribuída
    resetCalls(); clearCooldowns(acc);
    treeCampaigns = [campaign({ metrics: { spend: 100, conversions: 0, impressions: 1000, clicks: 50 } })];
    const out = await automation.runRulesSweep(acc, { force: true });
    assert.strictEqual(out.executed.length, 0, 'ROAS 0 sem NENHUMA venda atribuída pode ser atraso de webhook: não pausa');
  }

  // ── cooldown: write-through no Neon (persistência) ────────────────────────
  {
    const acc = 'acc_cd';
    provider.setState(acc, { rules: automation.validateRules([{ id: 'r1', enabled: true, metric: 'spend_no_conv', threshold: 5 }]) });
    resetCalls(); clearCooldowns(acc);
    // volume acima dos pisos default (1000 impr. / 30 cliques) p/ a regra agir
    treeCampaigns = [campaign({ metrics: { spend: 10, conversions: 0, impressions: 2000, clicks: 40 } })];
    await automation.runRulesSweep(acc, { force: true });
    const ruleUpserts = calls.upserts.filter((u) => u.key.startsWith('rule:'));
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
    provider.setState(acc, { rules: automation.validateRules([{ id: 's1', enabled: true, metric: 'schedule', days: [notToday], startTime: '03:00', endTime: '03:01', timezone: 'UTC' }]) });
    resetCalls(); clearCooldowns(acc);
    treeCampaigns = [
      campaign({ platformCampaignId: 'c1', status: 'active' }),
      campaign({ platformCampaignId: 'c2', status: 'paused' }), // pausada por OUTRO motivo
    ];
    let out = await automation.runScheduleSweep(acc, { force: true });
    assert.strictEqual(out.executed.length, 1, 'fora da janela: pausa só a ativa');
    assert.deepStrictEqual(calls.status[0].ids, ['c1']);
    assert.strictEqual(calls.status[0].status, 'paused');
    assert.ok(calls.upserts.some((u) => u.key === 'sched:s1:c1'), 'autoria da pausa persistida');

    // agora janela SEMPRE ativa: só reativa c1 (que ELE pausou); c2 fica quieta
    provider.setState(acc, { rules: automation.validateRules([{ id: 's1', enabled: true, metric: 'schedule', days: [0, 1, 2, 3, 4, 5, 6], startTime: '00:00', endTime: '23:59', timezone: 'UTC' }]) });
    resetCalls();
    treeCampaigns = [
      campaign({ platformCampaignId: 'c1', status: 'paused' }),
      campaign({ platformCampaignId: 'c2', status: 'paused' }),
    ];
    out = await automation.runScheduleSweep(acc, { force: true });
    assert.strictEqual(out.executed.length, 1, 'só reativa a campanha que o agendamento pausou');
    assert.deepStrictEqual(calls.status[0].ids, ['c1']);
    assert.strictEqual(calls.status[0].status, 'active');
    assert.ok(calls.deletes.some((d) => d.key === 'sched:s1:c1'), 'marcação de autoria limpa após reativar');

    // idempotência: estado já correto → zero chamadas
    resetCalls();
    treeCampaigns = [campaign({ platformCampaignId: 'c1', status: 'active' })];
    out = await automation.runScheduleSweep(acc, { force: true });
    assert.strictEqual(calls.status.length, 0, 'status já correto: nenhuma chamada à API');
  }

  // ── dry-run: avalia e loga, mas NÃO toca a plataforma ─────────────────────
  {
    policyOverride = { dryRun: true };
    const acc = 'acc_dry';
    provider.setState(acc, { rules: automation.validateRules([{ id: 'r1', enabled: true, metric: 'spend_no_conv', threshold: 5 }]) });
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
    provider.setState(acc, { rules: automation.validateRules([{ id: 'r1', enabled: true, metric: 'spend_no_conv', threshold: 5 }]) });
    resetCalls(); clearCooldowns(acc);
    treeCampaigns = [campaign({ metrics: { spend: 999, conversions: 0, impressions: 5000, clicks: 100 } })];
    const out = await automation.runRulesSweep(acc, { force: true });
    assert.strictEqual(out.killSwitch, true, 'sweep sinaliza killSwitch');
    assert.strictEqual(out.executed.length, 0, 'kill switch: nada avaliado nem executado');
    assert.strictEqual(calls.status.length, 0, 'kill switch: nenhuma escrita');
    // schedule também respeita o kill switch
    provider.setState(acc, { rules: automation.validateRules([{ id: 's1', enabled: true, metric: 'schedule', days: [0, 1, 2, 3, 4, 5, 6], startTime: '00:00', endTime: '23:59', timezone: 'UTC' }]) });
    treeCampaigns = [campaign({ platformCampaignId: 'c1', status: 'active' })];
    const outS = await automation.runScheduleSweep(acc, { force: true });
    assert.strictEqual(outS.killSwitch, true, 'dayparting também aborta com kill switch');
    assert.strictEqual(calls.status.length, 0, 'kill switch: dayparting não escreve');
    policyOverride = { dryRun: false };
  }

  // ── GUARDA: teto de gasto diário recusa budget_up sem consumir cooldown ───
  {
    // maxBudgetChangePct alto p/ o passo de +50% valer; teto de gasto é o que barra.
    policyOverride = { dryRun: false, dailySpendCap: 60, maxBudgetChangePct: 100 };
    const acc = 'acc_cap';
    // roas_scale quer +50% em cima de 50 = 75; conta já gasta 50/dia; teto 60
    const campId = '9990000000001';
    provider.setState(acc, { rules: automation.validateRules([{ id: 'r1', enabled: true, metric: 'roas_scale', threshold: 2, minSales: 1, pct: 50, budgetCap: 500 }]) });
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
    provider.setState(acc, { rules: automation.validateRules([{ id: 'r1', enabled: true, metric: 'spend_no_conv', threshold: 5 }]) });
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
    provider.setState(acc, { rules: automation.validateRules([{ id: 'r1', enabled: true, metric: 'spend_no_conv', threshold: 5, minClicks: 30, minImpressions: 1000 }]) });
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
    provider.setState(acc, { rules: automation.validateRules([{ id: 'r1', enabled: true, metric: 'roas_scale', threshold: 2, minSales: 1, pct: 50, budgetCap: 500 }]) });
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
    assert.match(sync, /automation\.maybeSweep\(accId\)/, 'tick do sync varre automações 24/7');
    assert.match(sync, /automation\.noteRecovery/, 'auto-recuperação de conta bloqueada ligada no tick');
    const auto = fs.readFileSync(path.join(__dirname, '..', 'ads-automation.js'), 'utf8');
    assert.doesNotMatch(auto, /require\('\.\/ads-sync'\)/, 'sem require circular: automation não importa ads-sync');
  }

  console.log('ads-automation.test.js: OK');
})().catch((err) => { console.error(err); process.exit(1); });
