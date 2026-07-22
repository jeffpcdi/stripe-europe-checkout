'use strict';
/*
 * C1 + C3 — o motor de automação passa a agir sobre Smart+:
 *  - C1: campanhas Smart+ entram no espelho (ads-sync) e as ações de STATUS
 *    (pausa por regra + dayparting) roteiam para setSmartPlusCampaignStatus.
 *    Orçamento/escala usa os endpoints dedicados que o Pipeboard passou a
 *    expor, respeitando o dono do orçamento (campanha CBO ou grupo ABO).
 *  - C3: com autoAppealSmartPlus ligado, o robô recorre SOZINHO 1× de cada
 *    incidente/grupo Smart+ reprovado, com cooldown de 7 dias e respeitando os
 *    guardrails (kill switch e Modo teste/dry-run).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const provider = require('../ads-provider');
const adsOps = require('../ads-ops-store');
const automation = require('../ads-automation');

let n = 0;
function ok(cond, label) { assert.ok(cond, label); n++; console.log('  ✓ ' + label); }
function eq(a, b, label) { assert.strictEqual(a, b, label + ' → esperado ' + b + ', veio ' + a); n++; console.log('  ✓ ' + label); }

const { setCampaignStatusByKind, executeRuleAction, autoAppealRejectedSmartPlus, APPEAL_COOLDOWN_MS, APPEAL_RETRY_MS } = automation._internals;

(async () => {
  // ── C1: roteamento de status por origem da campanha ───────────────────────
  console.log('C1 — setCampaignStatusByKind roteia pelo tipo');
  {
    const calls = { sp: [], auc: [] };
    provider.setSmartPlusCampaignStatus = async (adv, ids, st) => { calls.sp.push([adv, ids, st]); return { ok: true }; };
    provider.setCampaignStatus = async (adv, ids, st) => { calls.auc.push([adv, ids, st]); return { ok: true }; };

    await setCampaignStatusByKind({ campaignKind: 'smart_plus', platformCampaignId: 'sp1' }, 'adv', 'sp1', 'paused');
    eq(calls.sp.length, 1, 'Smart+ vai para setSmartPlusCampaignStatus');
    eq(calls.auc.length, 0, 'Smart+ NÃO usa o setCampaignStatus de leilão');
    eq(calls.sp[0][2], 'paused', 'status repassado');

    await setCampaignStatusByKind({ campaignKind: 'auction', platformCampaignId: 'c1' }, 'adv', 'c1', 'active');
    eq(calls.auc.length, 1, 'leilão vai para setCampaignStatus');
    await setCampaignStatusByKind({ platformCampaignId: 'c2' }, 'adv', 'c2', 'active');
    eq(calls.auc.length, 2, 'sem campaignKind = leilão (default)');
  }

  console.log('C1 — executeRuleAction pausa Smart+ pelo endpoint certo');
  {
    const calls = { sp: [], auc: [] };
    provider.setSmartPlusCampaignStatus = async (adv, ids, st) => { calls.sp.push([adv, ids, st]); return { ok: true }; };
    provider.setCampaignStatus = async (adv, ids, st) => { calls.auc.push([adv, ids, st]); return { ok: true }; };

    const done = await executeRuleAction({
      advertiserId: 'adv', action: 'pause', dryRun: false, plan: null,
      campaign: { campaignKind: 'smart_plus', platformCampaignId: 'sp9', status: 'active' },
    });
    eq(done.ok, true, 'ação concluída');
    eq(calls.sp.length, 1, 'pausa de Smart+ chama setSmartPlusCampaignStatus');
    eq(calls.auc.length, 0, 'pausa de Smart+ não toca o setCampaignStatus de leilão');
    ok(/Smart\+/.test(done.result), 'resultado sinaliza Smart+');

    const dry = await executeRuleAction({
      advertiserId: 'adv', action: 'pause', dryRun: true, plan: null,
      campaign: { campaignKind: 'smart_plus', platformCampaignId: 'sp9', status: 'active' },
    });
    eq(calls.sp.length, 1, 'dry-run NÃO chama o provider (segue em 1)');
    ok(/simulado/.test(dry.result), 'dry-run marca [simulado]');
  }

  console.log('C1 — ads-sync mescla Smart+ no snapshot');
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'ads-sync.js'), 'utf8');
    ok(/getSmartPlusDashboardTree/.test(src), 'ads-sync lê a hierarquia completa Smart+');
    ok(/smartById/.test(src), 'nó Smart+ substitui a leitura genérica de mesmo ID');
    ok(/SMART_PLUS_CLASSIFICATION_UNAVAILABLE/.test(src), 'sem classificação Smart+ o sync falha fechado e preserva o snapshot anterior');
    ok(!/catch[\s\S]{0,40}return \[\]/.test(src), 'falha dedicada não degrada Smart+ para campanha comum');
    ok(/tree\.campaigns = merged/.test(src), 'hierarquia Smart+ entra no mesmo snapshot sem duplicar ID');
  }

  console.log('C1 — provider marca campaignKind:auction nos nós de leilão');
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'ads-provider.js'), 'utf8');
    ok(/campaignKind: 'auction'/.test(src), "nó de campanha regular nasce campaignKind:'auction'");
  }

  console.log('C1 — orçamento Smart+ usa o endpoint dedicado');
  {
    const calls = [];
    provider.updateSmartPlusCampaign = async (adv, id, patch) => { calls.push({ adv, id, patch }); };
    const changed = await executeRuleAction({
      advertiserId: 'adv', action: 'budget_up', dryRun: false,
      campaign: { campaignKind: 'smart_plus', platformCampaignId: 'sp-budget', budgetOwner: 'campaign' },
      plan: { pct: 20, cap: 0, capped: 0, changes: [{ targetType: 'campaign', targetId: 'sp-budget', cur: 100, amount: 120, type: 'daily' }] },
    });
    eq(changed.ok, true, 'ajuste Smart+ é executado');
    eq(calls.length, 1, 'usa updateSmartPlusCampaign');
    eq(calls[0].patch.budget.amount, 120, 'novo orçamento é repassado');
    const src = fs.readFileSync(path.join(__dirname, '..', 'ads-automation.js'), 'utf8');
    // dayparting usa o roteador por tipo (não o setCampaignStatus direto)
    ok(/setCampaignStatusByKind\(c, advertiserId, cid, 'paused'\)/.test(src), 'dayparting pausa via roteador por tipo');
    ok(/setCampaignStatusByKind\(c, advertiserId, cid, 'active'\)/.test(src), 'dayparting reativa via roteador por tipo');
  }

  // ── C3: auto-appeal de anúncio Smart+ reprovado ───────────────────────────
  console.log('C3 — config e rota');
  {
    eq(automation.ALERT_DEFAULTS.autoAppealSmartPlus, false, 'autoAppealSmartPlus nasce desligado (opt-in)');
    ok(APPEAL_COOLDOWN_MS === 7 * 24 * 3600e3, 'cooldown de auto-recurso é 7 dias');
    ok(APPEAL_RETRY_MS === 60 * 60e3, 'falha transitória espera 1h antes de tentar novamente');
    const src = fs.readFileSync(path.join(__dirname, '..', 'ads-automation.js'), 'utf8');
    ok(/autoAppealSmartPlus: b\.autoAppealSmartPlus === true/.test(src), 'contrato versionado de alertas aceita autoAppealSmartPlus (opt-in explícito)');
    ok(/cfg\.autoAppealSmartPlus && smart\.length/.test(src), 'sweep só auto-recorre com a opção ligada e havendo reprovação');
  }

  console.log('C3 — autoAppealRejectedSmartPlus: recorre 1×, respeita cooldown/guardrails');
  {
    // guardrails stubados: sem kill switch, sem dry-run
    let policy = { killSwitch: false, dryRun: false };
    adsOps.getSafetyPolicy = async () => policy;
    const appeals = [];
    provider.appealSmartPlusAd = async (adv, adId, reason) => { appeals.push([adv, adId, reason]); return { ok: true }; };

    const acc = 'acc_c3_' + Date.now();
    await autoAppealRejectedSmartPlus(acc, 'adv', [{ adId: 'ad1', name: 'Criativo A' }, { adId: 'ad2', name: 'Criativo B' }]);
    eq(appeals.length, 2, 'recorre de cada anúncio reprovado uma vez');

    // segunda varredura: cooldown de 7d bloqueia repetição
    await autoAppealRejectedSmartPlus(acc, 'adv', [{ adId: 'ad1', name: 'Criativo A' }, { adId: 'ad2', name: 'Criativo B' }]);
    eq(appeals.length, 2, 'cooldown de 7 dias impede recorrer 2× do mesmo anúncio');

    // kill switch: não recorre de forma alguma
    appeals.length = 0;
    policy = { killSwitch: true, dryRun: false };
    await autoAppealRejectedSmartPlus('acc_kill_' + Date.now(), 'adv', [{ adId: 'adK', name: 'X' }]);
    eq(appeals.length, 0, 'kill switch aborta o auto-recurso');

    // dry-run: simula (audita) mas NÃO chama a API real de appeal
    appeals.length = 0;
    policy = { killSwitch: false, dryRun: true };
    await autoAppealRejectedSmartPlus('acc_dry_' + Date.now(), 'adv', [{ adId: 'adD', name: 'Y' }]);
    eq(appeals.length, 0, 'Modo teste (dry-run) não envia recurso real');

    // falha transitória: não martela o TikTok em toda varredura
    policy = { killSwitch: false, dryRun: false };
    let failedCalls = 0;
    provider.appealSmartPlusAd = async () => { failedCalls += 1; throw new Error('temporário'); };
    const failedAcc = 'acc_failure_' + Date.now();
    await autoAppealRejectedSmartPlus(failedAcc, 'adv', [{ adId: 'adF', name: 'Falha' }]);
    await autoAppealRejectedSmartPlus(failedAcc, 'adv', [{ adId: 'adF', name: 'Falha' }]);
    eq(failedCalls, 1, 'backoff de falha impede repetição imediata do recurso');
  }

  console.log('\nads-smart-plus-automation: ' + n + ' asserts OK');
})().catch((e) => { console.error(e); process.exit(1); });
