// F4 — Variações a partir de template: overrides { budgetAmount, adText }
// aplicados na recriação, teto de 50 no fan-out da rota, worker repassando
// task.overrides. Stub do MCP igual aos testes F1-F3.
'use strict';

const path = require('path');
const assert = require('assert');
const fs = require('fs');

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

function baseHandlers() {
  return {
    get_tiktok_advertisers: async () => ({ advertisers: [{ advertiser_id: 'adv1', name: 'Conta', timezone: 'Europe/Lisbon', currency: 'EUR', status: 'STATUS_ENABLE' }] }),
    get_tiktok_advertiser_info: async () => ({ advertiser_id: 'adv1', timezone: 'Europe/Lisbon' }),
    get_tiktok_identities: async () => ({ identities: [{ identity_id: 'id-1', identity_type: 'CUSTOMIZED_USER' }] }),
    get_tiktok_campaigns: async () => ({ campaigns: [{ campaign_id: 'tpl', campaign_name: 'Template', objective_type: 'TRAFFIC', budget_mode: 'BUDGET_MODE_DAY', budget: 100 }] }),
    get_tiktok_adgroups: async () => ({ adgroups: [{ adgroup_id: 'tpl-ag', adgroup_name: 'Grupo', optimization_goal: 'CLICK', budget_mode: 'BUDGET_MODE_DAY', budget: 40, schedule_start_time: '2099-01-01 00:00:00', targeting: { location_ids: ['123'] } }] }),
    get_tiktok_ads: async () => ({ ads: [{ ad_id: 'tpl-ad', adgroup_id: 'tpl-ag', ad_name: 'Ad tpl', ad_format: 'SINGLE_VIDEO', ad_text: 'Texto original', video_id: 'vid-1', identity_id: 'id-1', identity_type: 'CUSTOMIZED_USER' }] }),
    create_tiktok_campaign: async () => ({ campaign_id: 'var-camp' }),
    create_tiktok_adgroup: async () => ({ adgroup_id: 'var-ag' }),
    create_tiktok_ad: async () => ({ ad_id: 'var-ad' }),
    update_tiktok_campaign_status: async () => ({ ok: true }),
  };
}
function lastCall(name) { return [...stubCalls].reverse().find((c) => c.name === name); }

(async () => {
  // ── 1. Overrides aplicados: budget no adgroup, adText no anúncio ──────────
  stubCalls.length = 0;
  stubHandlers = baseHandlers();
  provider.cacheBust('');
  const cap = await provider.captureCampaign('adv1', 'tpl');
  const r1 = await provider.recreateCampaign('adv1', cap, 'Template (variação) 1', {
    overrides: { budgetAmount: 12.5, adText: 'Texto novo da variação' },
  });
  assert.strictEqual(r1.campaignId, 'var-camp');
  assert.strictEqual(lastCall('create_tiktok_adgroup').args.budget, 12.5, 'override de orçamento no grupo');
  assert.strictEqual(lastCall('create_tiktok_ad').args.ad_text, 'Texto novo da variação', 'override de texto no anúncio');
  assert.strictEqual(lastCall('create_tiktok_ad').args.video_id, 'vid-1', 'criativo do template reaproveitado');
  assert.strictEqual(lastCall('create_tiktok_ad').args.status, 'PAUSED');
  console.log('ok 1 - overrides de orçamento e texto aplicados; criativo e PAUSED preservados');

  // ── 2. Sem overrides: herda tudo da origem ────────────────────────────────
  stubCalls.length = 0;
  provider.cacheBust('');
  const cap2 = await provider.captureCampaign('adv1', 'tpl');
  await provider.recreateCampaign('adv1', cap2, 'Template (cópia)', {});
  assert.strictEqual(lastCall('create_tiktok_adgroup').args.budget, 40, 'sem override: herda o orçamento da origem');
  assert.strictEqual(lastCall('create_tiktok_ad').args.ad_text, 'Texto original');
  console.log('ok 2 - sem overrides herda orçamento e texto da origem');

  // ── 3. Origem CBO/INFINITE no grupo + override → vira BUDGET_MODE_DAY ─────
  stubCalls.length = 0;
  provider.cacheBust('');
  stubHandlers = baseHandlers();
  stubHandlers.get_tiktok_adgroups = async () => ({ adgroups: [{ adgroup_id: 'tpl-ag', adgroup_name: 'Grupo', optimization_goal: 'CLICK', budget_mode: 'BUDGET_MODE_INFINITE', schedule_start_time: '2099-01-01 00:00:00', targeting: { location_ids: ['123'] } }] });
  const cap3 = await provider.captureCampaign('adv1', 'tpl');
  await provider.recreateCampaign('adv1', cap3, 'Var 3', { overrides: { budgetAmount: 7 } });
  const ag3 = lastCall('create_tiktok_adgroup').args;
  assert.strictEqual(ag3.budget_mode, 'BUDGET_MODE_DAY', 'INFINITE + override vira DAY');
  assert.strictEqual(ag3.budget, 7);
  console.log('ok 3 - origem sem orçamento no grupo + override vira orçamento diário fixo');

  // ── 4. Contrato da rota: teto de 50, overrides no task, worker repassa ────
  const routes = fs.readFileSync(path.join(__dirname, '..', 'ads-routes.js'), 'utf8');
  // Teto VALIDADO com 400 (não slice silencioso): 51+ variações são rejeitadas
  // inteiras — truncar criaria 50 e sumiria com o resto sem o usuário saber.
  assert.match(routes, /rawVariations\.length > 50/, 'teto de 50 validado antes de enfileirar');
  assert.match(routes, /Máximo de 50 variações/, 'erro explícito quando passa do teto');
  assert.ok(!/b\.variations\.slice\(0, 50\)/.test(routes), 'sem truncamento silencioso do array');
  assert.match(routes, /app\.post\('\/api\/ads\/duplicate'[\s\S]*?variations vazio/, 'variations vazio rejeitado');
  assert.match(routes, /task\.overrides = overrides/, 'overrides embarcam no task');
  assert.match(routes, /duplicate_pb[\s\S]*?overrides: task\.overrides/, 'worker repassa overrides ao recreateCampaign');
  // A UI expõe o modo variações e o teto:
  const dialog = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'components', 'ads', 'duplicate-dialog.tsx'), 'utf8');
  assert.match(dialog, /variations' \? 50 : 10/, 'UI: teto 50 só no modo variações');
  assert.match(dialog, /body\.variations = Array\.from/, 'UI monta o array de variações');
  console.log('ok 4 - contrato da rota (teto 50, overrides) e da UI');

  console.log('\nF4: todos os testes passaram');
})().catch((e) => { console.error('FALHOU:', e); process.exit(1); });
