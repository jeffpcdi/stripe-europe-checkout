// F3 — Duplicação composta via Pipeboard (captureCampaign + recreateCampaign).
// Mesmo padrão dos testes F1/F2: stub do wrapper MCP via require.cache, zero
// rede. Cobre: captura completa, allowlist (IDs/métricas nunca copiados),
// schedule no passado recalculado, preflight+fallback 40002, reaproveitamento
// de criativos, identidade Spark → fallback, retomada idempotente e pausa de
// cópia parcial em falha.
'use strict';

const path = require('path');
const assert = require('assert');

// ── Stub do pipeboard-mcp ANTES de carregar o provider ─────────────────────
const stubCalls = [];
let stubHandlers = {};
const pipeboardPath = require.resolve(path.join(__dirname, '..', 'pipeboard-mcp.js'));
require.cache[pipeboardPath] = {
  id: pipeboardPath, filename: pipeboardPath, loaded: true,
  exports: {
    enabled: true,
    callTool: async (name, args) => {
      stubCalls.push({ name, args });
      if (!stubHandlers[name]) throw new Error('stub sem handler p/ ' + name);
      return stubHandlers[name](args);
    },
    listTools: async () => ({ tools: [] }),
  },
};
const providerPath = require.resolve(path.join(__dirname, '..', 'ads-provider.js'));
delete require.cache[providerPath];
const provider = require(providerPath);

function countCalls(name) { return stubCalls.filter((c) => c.name === name).length; }
function lastCall(name) { return [...stubCalls].reverse().find((c) => c.name === name); }

// Handlers base: uma origem com 1 campanha, 2 adgroups, 2 ads (1 vídeo Spark).
function baseHandlers(overrides) {
  const h = {
    get_tiktok_advertisers: async () => ({ advertisers: [{ advertiser_id: 'adv1', name: 'Conta', timezone: 'Europe/Lisbon', currency: 'EUR', status: 'STATUS_ENABLE' }] }),
    get_tiktok_advertiser_info: async () => ({ advertiser_id: 'adv1', name: 'Conta', timezone: 'Europe/Lisbon', currency: 'EUR' }),
    get_tiktok_identities: async () => ({ identities: [{ identity_id: 'id-bc', identity_type: 'BC_AUTH_TT', identity_authorized_bc_id: 'bc-1', display_name: 'Marca' }] }),
    get_tiktok_campaigns: async () => ({ campaigns: [{
      campaign_id: 'src-camp', campaign_name: 'Origem', objective_type: 'TRAFFIC',
      budget_mode: 'BUDGET_MODE_DAY', budget: 50, create_time: '2026-01-01 10:00:00',
      modify_time: '2026-02-01 10:00:00', secondary_status: 'CAMPAIGN_STATUS_ENABLE',
    }] }),
    get_tiktok_adgroups: async () => ({ adgroups: [
      { adgroup_id: 'src-ag1', adgroup_name: 'Grupo A', optimization_goal: 'CLICK',
        budget_mode: 'BUDGET_MODE_DAY', budget: 25, bid_type: 'BID_TYPE_NO_BID',
        schedule_start_time: '2025-01-01 00:00:00', // PASSADO — deve recalcular
        targeting: { location_ids: ['123'], age_groups: ['AGE_25_34'] } },
      { adgroup_id: 'src-ag2', adgroup_name: 'Grupo B', optimization_goal: 'CLICK',
        budget_mode: 'BUDGET_MODE_DAY', budget: 25, bid_type: 'BID_TYPE_CUSTOM', bid_price: 0.5,
        schedule_start_time: '2099-01-01 00:00:00', // FUTURO — deve preservar
        targeting: { location_ids: ['123'] } },
    ] }),
    get_tiktok_ads: async () => ({ ads: [
      { ad_id: 'src-ad1', adgroup_id: 'src-ag1', ad_name: 'Ad 1', ad_format: 'SINGLE_VIDEO',
        ad_text: 'Texto 1', video_id: 'vid-1', identity_id: 'id-custom', identity_type: 'CUSTOMIZED_USER',
        landing_page_url: 'https://ex.com', call_to_action: 'SHOP_NOW' },
      { ad_id: 'src-ad2', adgroup_id: 'src-ag2', ad_name: 'Ad 2 (spark)', ad_format: 'SINGLE_VIDEO',
        ad_text: 'Texto 2', video_id: 'vid-2', identity_id: 'tt-user-9', identity_type: 'TT_USER' },
    ] }),
    create_tiktok_campaign: async () => ({ campaign_id: 'new-camp' }),
    create_tiktok_adgroup: (() => { let n = 0; return async () => ({ adgroup_id: 'new-ag' + (++n) }); })(),
    create_tiktok_ad: (() => { let n = 0; return async () => ({ ad_id: 'new-ad' + (++n) }); })(),
    update_tiktok_campaign_status: async () => ({ ok: true }),
  };
  return Object.assign(h, overrides || {});
}

(async () => {
  // ── 1. Captura completa + recriação feliz ─────────────────────────────────
  stubCalls.length = 0;
  stubHandlers = baseHandlers();
  provider.cacheBust('');
  const capture = await provider.captureCampaign('adv1', 'src-camp');
  assert.strictEqual(capture.campaign.campaign_id, 'src-camp');
  assert.strictEqual(capture.adGroups.length, 2);
  assert.strictEqual(capture.ads.length, 2);

  const progressLog = [];
  const result = await provider.recreateCampaign('adv1', capture, 'Origem (cópia)', {
    onProgress: async (p) => progressLog.push(JSON.parse(JSON.stringify(p))),
  });
  assert.strictEqual(result.campaignId, 'new-camp');
  assert.strictEqual(result.adGroupIds.length, 2);
  assert.strictEqual(result.adIds.length, 2);

  // Allowlist: nada de IDs/timestamps/métricas nos args de criação
  const campArgs = lastCall('create_tiktok_campaign').args;
  assert.strictEqual(campArgs.campaign_name, 'Origem (cópia)');
  assert.strictEqual(campArgs.objective_type, 'TRAFFIC');
  assert.ok(!('campaign_id' in campArgs) && !('create_time' in campArgs) && !('secondary_status' in campArgs), 'IDs/timestamps não podem vazar p/ o create');

  // Schedule: ag1 (passado) recalculado; ag2 (futuro) preservado
  const agCalls = stubCalls.filter((c) => c.name === 'create_tiktok_adgroup');
  assert.notStrictEqual(agCalls[0].args.schedule_start_time, '2025-01-01 00:00:00', 'passado deve ser recalculado');
  assert.strictEqual(agCalls[1].args.schedule_start_time, '2099-01-01 00:00:00', 'futuro deve ser preservado');
  assert.ok(result.warnings.some((w) => /passado/i.test(w)), 'warning do recálculo');
  // bid custom preservado
  assert.strictEqual(agCalls[1].args.bid_price, 0.5);

  // Criativos reaproveitados + ads PAUSED + Spark → fallback de identidade
  const adCalls = stubCalls.filter((c) => c.name === 'create_tiktok_ad');
  assert.strictEqual(adCalls[0].args.video_id, 'vid-1', 'video_id da origem reaproveitado');
  assert.strictEqual(adCalls[0].args.status, 'PAUSED');
  assert.strictEqual(adCalls[0].args.identity_id, 'id-bc', 'CUSTOMIZED_USER da origem cai na BC_AUTH_TT');
  assert.strictEqual(adCalls[0].args.identity_bc_id, 'bc-1');
  assert.strictEqual(adCalls[1].args.identity_id, 'id-bc', 'Spark (TT_USER) cai na BC_AUTH_TT');
  assert.ok(result.warnings.some((w) => /spark/i.test(w)), 'warning do Spark');
  // progresso reportado a cada passo (1 camp + 2 ags + 2 ads = 5)
  assert.strictEqual(progressLog.length, 5);
  console.log('ok 1 - captura + recriação com allowlist, schedule, criativos e identidade');

  // ── 1b. Targeting ACHATADO (como o get_tiktok_adgroups real devolve) ──────
  // Regressão do erro "targeting is required with at least location_ids": o GET
  // devolve location_ids/age_groups no TOPO do adgroup, não sob `targeting`.
  stubCalls.length = 0;
  provider.cacheBust('');
  stubHandlers = baseHandlers({
    get_tiktok_adgroups: async () => ({ adgroups: [
      { adgroup_id: 'flat-ag1', adgroup_name: 'Grupo achatado', optimization_goal: 'CLICK',
        budget_mode: 'BUDGET_MODE_DAY', budget: 25,
        // SEM chave `targeting` — campos no topo, como a API real:
        location_ids: ['123', '456'], age_groups: ['AGE_25_34'], gender: 'GENDER_FEMALE' },
      // 2º grupo SEM região nenhuma → deve herdar as do 1º via fallback
      { adgroup_id: 'flat-ag2', adgroup_name: 'Grupo sem região', optimization_goal: 'CLICK',
        budget_mode: 'BUDGET_MODE_DAY', budget: 25 },
    ] }),
    get_tiktok_ads: async () => ({ ads: [] }),
  });
  const capFlat = await provider.captureCampaign('adv1', 'src-camp');
  const rFlat = await provider.recreateCampaign('adv1', capFlat, 'Cópia achatada', {});
  const flatAgCalls = stubCalls.filter((c) => c.name === 'create_tiktok_adgroup');
  assert.strictEqual(flatAgCalls.length, 2, 'ambos os grupos criados');
  assert.deepStrictEqual(flatAgCalls[0].args.targeting.location_ids, ['123', '456'], 'location_ids achatados reconstruídos sob targeting');
  assert.strictEqual(flatAgCalls[0].args.targeting.gender, 'GENDER_FEMALE', 'demais campos de targeting também migram');
  assert.deepStrictEqual(flatAgCalls[1].args.targeting.location_ids, ['123', '456'], 'grupo sem região herda o fallback');
  assert.ok(rFlat.warnings.some((w) => /herdou as regiões/i.test(w)), 'warning do fallback de região');
  console.log('ok 1b - targeting achatado reconstruído + fallback de location_ids entre grupos');

  // ── 2. Preflight 40002: DYNAMIC_DAILY + objetivo incompatível → DAY ───────
  stubCalls.length = 0;
  provider.cacheBust('');
  stubHandlers = baseHandlers({
    get_tiktok_campaigns: async () => ({ campaigns: [{
      campaign_id: 'src-camp', campaign_name: 'Origem', objective_type: 'TRAFFIC',
      budget_mode: 'BUDGET_MODE_DYNAMIC_DAILY_BUDGET', budget: 50,
    }] }),
  });
  const cap2 = await provider.captureCampaign('adv1', 'src-camp');
  const r2 = await provider.recreateCampaign('adv1', cap2, 'Cópia 2', {});
  assert.strictEqual(lastCall('create_tiktok_campaign').args.budget_mode, 'BUDGET_MODE_DAY');
  assert.ok(r2.warnings.some((w) => /preflight 40002/.test(w)), 'warning do preflight');
  console.log('ok 2 - preflight 40002 converte DYNAMIC_DAILY → DAY em objetivo incompatível');

  // ── 3. Fallback 40002: TikTok recusa o modo dinâmico → retry único com DAY ─
  stubCalls.length = 0;
  provider.cacheBust('');
  let campAttempts = 0;
  stubHandlers = baseHandlers({
    get_tiktok_campaigns: async () => ({ campaigns: [{
      campaign_id: 'src-camp', campaign_name: 'Origem', objective_type: 'WEB_CONVERSIONS',
      budget_mode: 'BUDGET_MODE_DYNAMIC_DAILY_BUDGET', budget: 50,
    }] }),
    create_tiktok_campaign: async (args) => {
      campAttempts++;
      if (args.budget_mode === 'BUDGET_MODE_DYNAMIC_DAILY_BUDGET') {
        throw new Error('TikTok API error 40002: dynamic daily budget not supported for this objective');
      }
      return { campaign_id: 'new-camp-40002' };
    },
  });
  const cap3 = await provider.captureCampaign('adv1', 'src-camp');
  const r3 = await provider.recreateCampaign('adv1', cap3, 'Cópia 3', {});
  assert.strictEqual(campAttempts, 2, 'exatamente 1 retry');
  assert.strictEqual(r3.campaignId, 'new-camp-40002');
  assert.ok(r3.warnings.some((w) => /40002/.test(w)), 'conversão registrada, nunca silenciosa');
  console.log('ok 3 - fallback 40002: retry único com BUDGET_MODE_DAY, warning registrado');

  // ── 4. Retomada idempotente: crash após 1º adgroup → retry pula os feitos ─
  stubCalls.length = 0;
  provider.cacheBust('');
  stubHandlers = baseHandlers();
  const resume = { campaignId: 'new-camp', adGroups: { 'src-ag1': 'new-ag1' }, ads: {} };
  const r4 = await provider.recreateCampaign('adv1', await provider.captureCampaign('adv1', 'src-camp'), 'Origem (cópia)', { resume });
  assert.strictEqual(countCalls('create_tiktok_campaign'), 0, 'campanha do resume não pode ser recriada');
  assert.strictEqual(countCalls('create_tiktok_adgroup'), 1, 'só o adgroup que faltava');
  assert.strictEqual(r4.campaignId, 'new-camp');
  assert.strictEqual(r4.adGroupIds.length, 2);
  console.log('ok 4 - retomada pula campanha e adgroup já criados (zero duplicação)');

  // ── 5. Falha no meio → cópia parcial PAUSADA + progresso no erro ──────────
  stubCalls.length = 0;
  provider.cacheBust('');
  let paused = false;
  stubHandlers = baseHandlers({
    create_tiktok_adgroup: async () => { throw new Error('boom no adgroup'); },
    update_tiktok_campaign_status: async (args) => { paused = true; assert.deepStrictEqual(args.campaign_ids, ['new-camp']); return { ok: true }; },
  });
  let threw = false;
  try {
    await provider.recreateCampaign('adv1', await provider.captureCampaign('adv1', 'src-camp'), 'Cópia falha', {});
  } catch (e) {
    threw = true;
    assert.ok(paused, 'campanha órfã tem de ser pausada');
    assert.strictEqual(e.createdIds.campaignId, 'new-camp');
    assert.ok(e.step, 'erro carrega o step');
  }
  assert.ok(threw);
  console.log('ok 5 - falha parcial: campanha pausada, erro com step + progresso');

  // ── 6. Cache da captura: 2ª chamada não refaz as leituras ─────────────────
  stubCalls.length = 0;
  provider.cacheBust('');
  stubHandlers = baseHandlers();
  await provider.captureCampaign('adv1', 'src-camp');
  const readsAfterFirst = stubCalls.length;
  await provider.captureCampaign('adv1', 'src-camp');
  assert.strictEqual(stubCalls.length, readsAfterFirst, 'captura cacheada: N cópias = 1 captura');
  console.log('ok 6 - captura cacheada (N cópias do job pagam 1 captura)');

  // ── 7. CBO: ad group INFINITE precisa de budget_mode (bug 40002) ──────────
  // Regressão: duplicar campanha CBO (orçamento na campanha, grupo INFINITE)
  // ia sem budget_mode → "TikTok API error 40002: budget_mode is required".
  stubCalls.length = 0;
  provider.cacheBust('');
  stubHandlers = baseHandlers({
    get_tiktok_campaigns: async () => ({ campaigns: [{
      campaign_id: 'src-cbo', campaign_name: 'CBO', objective_type: 'PRODUCT_SALES',
      budget_mode: 'BUDGET_MODE_DAY', budget: 100, budget_optimize_on: true,
    }] }),
    get_tiktok_adgroups: async () => ({ adgroups: [
      { adgroup_id: 'cbo-ag1', adgroup_name: 'Grupo CBO', optimization_goal: 'CONVERT',
        budget_mode: 'BUDGET_MODE_INFINITE', bid_type: 'BID_TYPE_NO_BID',
        schedule_start_time: '2099-01-01 00:00:00', targeting: { location_ids: ['123'] } },
    ] }),
    get_tiktok_ads: async () => ({ ads: [] }),
  });
  const cboCap = await provider.captureCampaign('adv1', 'src-cbo');
  await provider.recreateCampaign('adv1', cboCap, 'CBO (cópia)', {});
  const cboAg = lastCall('create_tiktok_adgroup').args;
  assert.strictEqual(cboAg.budget_mode, 'BUDGET_MODE_INFINITE', 'ad group CBO precisa mandar budget_mode INFINITE (senão 40002)');
  assert.ok(!('budget' in cboAg), 'ad group INFINITE não manda budget (herda da campanha)');
  console.log('ok 7 - CBO: ad group herda budget_mode INFINITE (fix 40002 na duplicação)');

  // ── 8. Orçamento antigo abaixo do piso atual é autocorrigido ─────────────
  stubCalls.length = 0;
  provider.cacheBust('');
  stubHandlers = baseHandlers({
    get_tiktok_campaigns: async () => ({ campaigns: [{
      campaign_id: 'src-low', campaign_name: 'Orçamento antigo', objective_type: 'TRAFFIC',
      budget_mode: 'BUDGET_MODE_DAY', budget: 10,
    }] }),
    get_tiktok_adgroups: async () => ({ adgroups: [{
      adgroup_id: 'low-ag', adgroup_name: 'Grupo antigo', optimization_goal: 'CLICK',
      budget_mode: 'BUDGET_MODE_DAY', budget: 10,
      schedule_start_time: '2099-01-01 00:00:00', targeting: { location_ids: ['123'] },
    }] }),
    get_tiktok_ads: async () => ({ ads: [] }),
  });
  const lowResult = await provider.recreateCampaign('adv1', await provider.captureCampaign('adv1', 'src-low'), 'Orçamento antigo (cópia)', {});
  assert.strictEqual(lastCall('create_tiktok_campaign').args.budget, 50, 'campanha respeita o piso atual');
  assert.strictEqual(lastCall('create_tiktok_adgroup').args.budget, 50, 'grupo respeita o piso atual');
  assert.ok(lowResult.warnings.some((warning) => /mínimo aceito/.test(warning)), 'ajuste aparece nos avisos');
  console.log('ok 8 - orçamento legado abaixo de 50 é ajustado antes da duplicação');

  // ── 9. Erro transitório 40002/Could not acquire IP ganha retry ───────────
  stubCalls.length = 0;
  provider.cacheBust('');
  let ipAttempts = 0;
  stubHandlers = baseHandlers({
    get_tiktok_adgroups: async () => ({ adgroups: [{
      adgroup_id: 'ip-ag', adgroup_name: 'Grupo instável', optimization_goal: 'CLICK',
      budget_mode: 'BUDGET_MODE_DAY', budget: 50,
      schedule_start_time: '2099-01-01 00:00:00', targeting: { location_ids: ['123'] },
    }] }),
    get_tiktok_ads: async () => ({ ads: [] }),
    create_tiktok_adgroup: async () => {
      ipAttempts += 1;
      if (ipAttempts === 1) throw new Error('TikTok API error 40002: Could not acquire IP. Please try again later');
      return { adgroup_id: 'new-ip-ag' };
    },
  });
  const ipResult = await provider.recreateCampaign('adv1', await provider.captureCampaign('adv1', 'src-camp'), 'Cópia com retry', {});
  assert.strictEqual(ipAttempts, 2, 'retry automático ocorre sem duplicar o passo');
  assert.ok(ipResult.warnings.some((warning) => /nova tentativa automática/.test(warning)), 'retry aparece nos avisos');
  console.log('ok 9 - erro transitório de IP é repetido automaticamente');

  console.log('\nF3: todos os testes passaram');
})().catch((e) => { console.error('FALHOU:', e); process.exit(1); });
