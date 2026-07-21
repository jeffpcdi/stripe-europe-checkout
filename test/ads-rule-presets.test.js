// ─────────────────────────────────────────────────────────────────────────────
// Fase 1 da reestruturação: presets de regras/alertas + seed automático.
// Contratos:
//   1. buildRulePresets passa por validateRules SEM mutação (preset já nasce
//      válido — inclusive o budgetCap obrigatório do roas_scale).
//   2. Todas as regras preset nascem enabled:false; alertas nascem enabled:true.
//   3. Seed só ocorre 1x (flag) e NUNCA sobrescreve conta que já configurou.
//   4. PUT (via validateRules + flag) preserva name/description/preset.
// ─────────────────────────────────────────────────────────────────────────────
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// storage isolado (config usa DATA_DIR)
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ads-presets-'));

const automation = require('../ads-automation.js');
const provider = require('../ads-provider.js');

// ── 1. presets são estáveis sob validateRules (sem mutação) ─────────────────
{
  const presets = automation.buildRulePresets();
  assert.strictEqual(presets.length, 9, 'pacote tem 9 regras');
  const revalidated = automation.validateRules(presets);
  assert.deepStrictEqual(revalidated, presets, 'validateRules(presets) é identidade — preset já nasce válido');

  for (const p of presets) {
    assert.strictEqual(p.enabled, false, p.id + ' nasce pausada');
    assert.ok(p.preset === true, p.id + ' marcada como preset');
    assert.ok(p.name && p.name.length > 3, p.id + ' tem nome legível');
    assert.ok(p.description && p.description.length > 10, p.id + ' tem descrição');
  }
  const scale = presets.find((p) => p.metric === 'roas_scale');
  assert.ok(scale.budgetCap === 100, 'roas_scale vem com teto preenchido (validateRules desativaria sem teto)');
  assert.strictEqual(scale.action, 'budget_up', 'escala é sempre budget_up');
  const cpa = presets.find((p) => p.metric === 'cpa_max');
  assert.ok(cpa.minClicks === 30 && cpa.minImpressions === 1000, 'pisos de volume do cpa_max');
  // Novos presets (padrão diário): ROAS baixo, escala agressiva e dayparting
  assert.ok(presets.every((p) => p.metric === 'schedule' || p.lookbackDays === 1), 'janela padrão diária (1 dia) em todos os presets com lookback');
  const roasMin = presets.find((p) => p.metric === 'roas_min');
  assert.ok(roasMin && roasMin.action === 'pause' && roasMin.threshold === 1, 'preset roas_min pausa abaixo de 1.0');
  const agro = presets.find((p) => p.id === 'preset_scale_agro');
  assert.ok(agro && agro.budgetCap === 200 && agro.pct === 30 && agro.action === 'budget_up', 'escala agressiva com teto 200');
  const sched = presets.find((p) => p.metric === 'schedule');
  assert.ok(sched && sched.days.length === 5 && sched.startTime === '09:00' && sched.endTime === '23:00', 'dayparting seg–sex 09–23');
  console.log('ok: presets válidos, pausados e estáveis sob validateRules');
}

// ── 2. seed automático na primeira leitura ───────────────────────────────────
{
  const acc = 'acc_fresh_' + Date.now().toString(36);
  const advertiserId = 'adv_fresh';
  const rules = automation.getRules(acc, advertiserId);
  assert.strictEqual(rules.length, 9, 'conta nova é semeada com o pacote');
  assert.ok(rules.every((r) => r.enabled === false), 'tudo semeado pausado');
  assert.ok(provider.getState(acc).automationProfiles[advertiserId], 'perfil do advertiser persistido');

  // segunda leitura NÃO re-semeia (mesmo se o usuário apagar tudo depois)
  const profile = automation.getAutomationProfile(acc, advertiserId);
  automation.saveRules(acc, advertiserId, [], profile.revision);
  assert.deepStrictEqual(automation.getRules(acc, advertiserId), [], 'lista vazia salva é respeitada');

  const cfg = automation.getAlertCfg(acc, advertiserId);
  assert.strictEqual(cfg.enabled, true, 'alertas nascem LIGADOS (só notificam)');
  assert.strictEqual(cfg.cpaMax, 15, 'alerta de CPA vem calibrado');
  assert.strictEqual(cfg.spendNoConv, 20, 'alerta de gasto sem venda vem calibrado');
  console.log('ok: seed 1x em conta nova; lista vazia respeitada; alertas ligados');
}

// ── 3. conta que JÁ configurou antes do deploy não é tocada ─────────────────
{
  const acc = 'acc_veteran_' + Date.now().toString(36);
  // simula estado pré-deploy: regras próprias, SEM flag
  const own = automation.validateRules([{ id: 'minha', metric: 'cpa_max', threshold: 99, enabled: true }]);
  provider.setState(acc, { rules: own, alerts: { enabled: false, spendNoConv: 50, cpaMax: 0, lookbackDays: 7 } });

  const rules = automation.getRules(acc, 'adv_veteran');
  assert.strictEqual(rules.length, 1, 'regras existentes preservadas (não substituídas por presets)');
  assert.strictEqual(rules[0].id, 'minha');
  assert.strictEqual(provider.getState(acc).automationLegacyMigratedTo, 'adv_veteran', 'migração legada marcada sem tocar nos dados');

  const cfg = automation.getAlertCfg(acc, 'adv_veteran');
  assert.strictEqual(cfg.enabled, false, 'alertas desligados de propósito seguem desligados');
  assert.strictEqual(cfg.spendNoConv, 50, 'config própria preservada');
  console.log('ok: conta veterana intocada (só ganha a flag)');
}

// ── 4. name/description/preset sobrevivem ao ciclo PUT (validateRules) ───────
{
  const presets = automation.buildRulePresets();
  const edited = automation.validateRules(presets.map((p) => ({ ...p, enabled: true })));
  const scale = edited.find((p) => p.metric === 'roas_scale');
  assert.strictEqual(scale.enabled, true, 'ativar preset com 1 clique funciona (roas_scale tem teto)');
  assert.strictEqual(scale.name, 'ROAS bom → escalar', 'nome sobrevive à revalidação');
  assert.ok(scale.preset === true, 'badge preset sobrevive');
  // regra sem nome continua válida (compat com regras antigas)
  const legacy = automation.validateRules([{ metric: 'cpa_max', threshold: 10 }]);
  assert.strictEqual(legacy.length, 1);
  assert.ok(!('name' in legacy[0]), 'regra antiga sem nome segue válida e sem campo name');
  console.log('ok: campos legíveis sobrevivem ao PUT; regras antigas seguem válidas');
}

// ── 5. contrato das rotas (fonte) ────────────────────────────────────────────
{
  const routes = fs.readFileSync(path.join(__dirname, '..', 'ads-routes.js'), 'utf8');
  assert.match(routes, /app\.get\('\/api\/ads\/rules\/presets'/, 'endpoint GET /rules/presets existe');
  assert.match(routes, /automation\.saveRules/, 'PUT /rules usa perfil versionado');
  assert.match(routes, /automation\.saveAlerts/, 'PUT /alerts usa perfil versionado');
  console.log('ok: contrato das rotas');
}

console.log('ads-rule-presets.test.js: todos os testes passaram');
