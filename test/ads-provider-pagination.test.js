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
      if (name === 'get_tiktok_ads') {
        return {
          ads: [{ ad_id: 'a' + args.page, adgroup_id: 'g1', campaign_id: 'c1', ad_name: 'Anúncio ' + args.page }],
          page_info: { page: args.page, total_page: 2, total_number: 2 },
        };
      }
      if (name === 'get_tiktok_smart_plus_campaigns') return { campaigns: [{ campaign_id: 'sp1', campaign_name: 'Smart', operation_status: 'ENABLE', budget: 100, budget_mode: 'BUDGET_MODE_DAY', budget_optimize_on: true }] };
      if (name === 'get_tiktok_smart_plus_adgroups') return { adgroups: [{ adgroup_id: 'sg1', campaign_id: 'sp1', adgroup_name: 'Grupo Smart', operation_status: 'ENABLE', budget_mode: 'BUDGET_MODE_INFINITE', pixel_id: '123456', optimization_event: 'ON_WEB_ORDER', targeting_spec: { location_ids: ['100025'] } }] };
      if (name === 'get_tiktok_smart_plus_ads') return { ads: [{ smart_plus_ad_id: 'sa1', campaign_id: 'sp1', adgroup_id: 'sg1', ad_name: 'Asset', operation_status: 'DISABLE', secondary_status: 'AD_STATUS_AUDIT_DENY', creative_list: [{ ad_material_id: 'mat1', smart_plus_creative_id: 'cr1', creative_info: { video_id: 'v1' } }] }] };
      if (name.startsWith('update_tiktok_smart_plus_')) return { ok: true };
      throw new Error('stub sem handler: ' + name);
    },
  },
};
const providerPath = require.resolve(path.join(__dirname, '..', 'ads-provider.js'));
delete require.cache[providerPath];
const provider = require(providerPath);

(async () => {
  const ads = await provider.getAds('adv1');
  assert.deepStrictEqual(ads.map((item) => item.id), ['a1', 'a2'], 'pagina todos os anúncios até total_page');
  assert.strictEqual(calls.filter((call) => call.name === 'get_tiktok_ads').length, 2, 'faz exatamente duas páginas');

  const tree = await provider.getSmartPlusDashboardTree('adv1', 'BRL');
  assert.strictEqual(tree.length, 1);
  assert.strictEqual(tree[0].campaignKind, 'smart_plus');
  assert.strictEqual(tree[0].budgetOwner, 'campaign', 'CBO Smart+ mantém orçamento na campanha');
  assert.strictEqual(tree[0].adSets.length, 1, 'grupo Smart+ preservado');
  assert.strictEqual(tree[0].adSets[0].ads.length, 1, 'asset group Smart+ preservado');
  assert.strictEqual(tree[0].adSets[0].ads[0].status, 'rejected');
  assert.deepStrictEqual(tree[0].adSets[0].ads[0].metricEntityIds, ['cr1'], 'métrica usa o ID que o AUCTION_AD realmente reporta');
  assert.deepStrictEqual(
    provider._internals.mapSmartPlusAd({ smart_plus_ad_id: 'legacy', creative_list: [{ ad_material_id: 'mat-only' }] }).metricEntityIds,
    ['mat-only'],
    'material_id continua como fallback para conectores antigos',
  );

  await provider.setSmartPlusAdGroupStatus('adv1', ['sg1'], 'paused');
  await provider.setSmartPlusAdStatus('adv1', ['sa1'], 'paused');
  await provider.updateSmartPlusCampaign('adv1', 'sp1', { budget: { amount: 120, type: 'daily' } });
  assert.ok(calls.some((call) => call.name === 'update_tiktok_smart_plus_adgroup_status' && call.args.operation_status === 'DISABLE'));
  assert.ok(calls.some((call) => call.name === 'update_tiktok_smart_plus_ad_status' && call.args.operation_status === 'DISABLE'));
  assert.ok(calls.some((call) => call.name === 'update_tiktok_smart_plus_campaign' && call.args.budget === 120));

  console.log('ads-provider-pagination.test.js: paginação completa + hierarquia/mutações Smart+ OK');
})().catch((error) => { console.error(error); process.exit(1); });
