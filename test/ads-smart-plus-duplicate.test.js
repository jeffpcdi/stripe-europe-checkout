'use strict';

const assert = require('assert');
const path = require('path');

const calls = [];
const mcpPath = require.resolve(path.join(__dirname, '..', 'pipeboard-mcp.js'));
require.cache[mcpPath] = {
  id: mcpPath,
  filename: mcpPath,
  loaded: true,
  exports: {
    enabled: true,
    listTools: async () => ({ tools: [] }),
    callTool: async (name, args) => {
      calls.push({ name, args });
      if (name === 'get_tiktok_smart_plus_campaigns') return { campaigns: [{ campaign_id: 'sp-src', campaign_name: 'Smart origem', objective_type: 'WEB_CONVERSIONS', sales_destination: 'WEBSITE', budget: 100, budget_mode: 'BUDGET_MODE_TOTAL', budget_optimize_on: true, catalog_enabled: true, catalog_type: 'ECOM', operation_status: 'DISABLE' }] };
      if (name === 'get_tiktok_smart_plus_adgroups') return { adgroups: [{ adgroup_id: 'sg-src', campaign_id: 'sp-src', adgroup_name: 'Grupo', promotion_type: 'WEBSITE', targeting_spec: { location_ids: ['100025'] }, schedule_type: 'SCHEDULE_START_END', schedule_start_time: '2099-01-01 00:00:00', schedule_end_time: '2099-01-08 00:00:00', optimization_goal: 'CONVERT', billing_event: 'OCPM', budget_mode: 'BUDGET_MODE_INFINITE', pixel_id: '123456', optimization_event: 'ON_WEB_ORDER', catalog_id: 'cat1', catalog_authorized_bc_id: 'bc1', product_source: 'CATALOG', click_attribution_window: 7, view_attribution_window: 1, suggestion_audience_enabled: true }] };
      if (name === 'get_tiktok_smart_plus_ads') return { ads: [{ smart_plus_ad_id: 'sa-src', campaign_id: 'sp-src', adgroup_id: 'sg-src', ad_name: 'Asset', creative_list: [{ ad_material_id: 'output-only', smart_plus_creative_id: 'output-only-2', creative_info: { ad_format: 'SINGLE_VIDEO', video_info: { video_id: 'v1' }, identity_id: 'brand', identity_type: 'BC_AUTH_TT', identity_authorized_bc_id: 'bc1', dark_post_status: 'ON' } }], landing_page_url_list: [{ landing_page_url: 'https://example.com' }], ad_text_list: [{ ad_text: 'Texto original' }], operation_status: 'DISABLE' }] };
      if (name === 'get_tiktok_advertiser_info') return { advertiser: { name: 'Conta', timezone: 'America/Sao_Paulo', currency: 'BRL' } };
      if (name === 'create_tiktok_smart_plus_campaign') return { campaign_id: 'sp-new' };
      if (name === 'create_tiktok_smart_plus_adgroup') return { adgroup_id: 'sg-new' };
      if (name === 'create_tiktok_smart_plus_ad') return { smart_plus_ad_id: 'sa-new' };
      if (name.startsWith('update_tiktok_smart_plus_')) return { ok: true };
      throw new Error('stub sem handler: ' + name);
    },
  },
};
const providerPath = require.resolve(path.join(__dirname, '..', 'ads-provider.js'));
delete require.cache[providerPath];
const provider = require(providerPath);

(async () => {
  const capture = await provider.captureCampaign('adv1', 'sp-src');
  assert.strictEqual(capture.campaignKind, 'smart_plus', 'origem detectada pelo endpoint dedicado');
  const result = await provider.recreateCampaign('adv1', capture, 'Smart cópia', { overrides: { budgetAmount: 150, adText: 'Texto novo' } });
  assert.strictEqual(result.campaignKind, 'smart_plus');
  assert.deepStrictEqual(result.adGroupIds, ['sg-new']);
  assert.deepStrictEqual(result.adIds, ['sa-new']);
  assert.ok(!calls.some((call) => call.name === 'create_tiktok_campaign'), 'nunca converte Smart+ em campanha comum');

  const campaign = calls.find((call) => call.name === 'create_tiktok_smart_plus_campaign').args;
  assert.strictEqual(campaign.operation_status, 'DISABLE');
  assert.strictEqual(campaign.budget, 150, 'variação CBO altera orçamento na campanha');
  assert.strictEqual(campaign.catalog_enabled, true);
  assert.strictEqual(campaign.catalog_type, 'ECOM');
  const group = calls.find((call) => call.name === 'create_tiktok_smart_plus_adgroup').args;
  assert.strictEqual(group.operation_status, 'DISABLE');
  assert.strictEqual(group.pixel_id, '123456');
  assert.strictEqual(group.catalog_id, 'cat1');
  assert.strictEqual(group.catalog_authorized_bc_id, 'bc1');
  assert.strictEqual(group.product_source, 'CATALOG');
  assert.strictEqual(group.click_attribution_window, 7);
  assert.strictEqual(group.view_attribution_window, 1);
  assert.strictEqual(group.suggestion_audience_enabled, true);
  assert.ok(!('budget' in group), 'grupo CBO não ganha orçamento ABO por engano');
  const ad = calls.find((call) => call.name === 'create_tiktok_smart_plus_ad').args;
  assert.strictEqual(ad.operation_status, 'DISABLE');
  assert.strictEqual(ad.ad_text_list[0].ad_text, 'Texto novo');
  assert.deepStrictEqual(Object.keys(ad.creative_list[0]), ['creative_info'], 'IDs de saída não vazam no create');
  assert.ok(calls.some((call) => call.name === 'update_tiktok_smart_plus_campaign_status'));
  assert.ok(calls.some((call) => call.name === 'update_tiktok_smart_plus_adgroup_status'));
  assert.ok(calls.some((call) => call.name === 'update_tiktok_smart_plus_ad_status'));

  console.log('ads-smart-plus-duplicate.test.js: captura e duplicação Smart+ completa/pausada OK');
})().catch((error) => { console.error(error); process.exit(1); });
