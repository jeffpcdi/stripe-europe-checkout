'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const view = read('dashboard/components/ads/tiktok-ads-view.tsx');
assert.match(view, /import \{ CampaignWorkspace \} from '\.\/campaign-workspace'/);
assert.match(view, /<CampaignWorkspace/);
assert.doesNotMatch(view, /import \{ CampaignTree \} from '\.\/campaign-tree'/);
assert.match(view, /approvalsCount=/);
assert.match(view, /approvals=\{\(/);

const workspace = read('dashboard/components/ads/campaign-workspace.tsx');
for (const label of ['Visão', 'Campanhas', 'Conjuntos', 'Anúncios', 'Criativos', 'Oportunidades', 'Aprovações', 'Playbooks']) {
  assert.match(workspace, new RegExp(`label: '${label}'`));
}
assert.match(workspace, /ads:campaign-workspace-level/);
assert.match(workspace, /ads:campaign-workspace-status/);
assert.match(workspace, /ads:campaign-workspace-metrics/);
assert.match(workspace, /ads:campaign-workspace-sort/);
assert.match(workspace, /'ads:campaign-workspace-level', 'overview'/);
assert.match(workspace, /AdEditDialog/);
assert.match(workspace, /AdGroupBudgetControl/);
assert.match(workspace, /TIKTOK_MIN_BUDGET/);
assert.match(workspace, /Central de aprovações/);
assert.match(workspace, /Selecionar visíveis/);
assert.match(workspace, /\/api\/ads\/entities\/bulk-status/);
assert.match(workspace, /CreativePreview ad=\{ad\}/);
assert.match(workspace, /<video/);
assert.match(workspace, /EntityStatusToggle/);
assert.match(workspace, /Performance/);
assert.match(workspace, /Entrega/);
assert.match(workspace, /Custos/);
assert.match(workspace, /Gasto sem venda real/);
assert.match(workspace, /Operação autônoma/);
assert.match(workspace, /useAdsCreativeInsights/);
assert.match(workspace, /useAdsRulePresets/);
assert.match(workspace, /useAdsRules/);
assert.match(workspace, /Creative Intelligence/);
assert.match(workspace, /Playbooks de operação/);
assert.match(workspace, /modo proposta/);
assert.match(workspace, /setSelectedGroups\(new Set\(\)\)/);
assert.match(workspace, /setSelectedAds\(new Set\(\)\)/);

const tree = read('dashboard/components/ads/campaign-tree.tsx');
assert.match(tree, /async function setChildStatus/);
assert.match(tree, /Conjunto/);
assert.match(tree, /Anúncio/);
assert.match(tree, /\/api\/ads\/\$\{encodeURIComponent\(entityId\)\}/);

const routes = read('ads-routes.js');
assert.match(routes, /app\.post\('\/api\/ads\/entities\/bulk-status'/);
assert.match(routes, /entity\.type === 'adgroup' \|\| entity\.type === 'ad'/);
assert.match(routes, /await isDryRun\(req\.account\.id\)/);
assert.match(routes, /await killSwitchActive\(req\.account\.id\)/);
assert.match(routes, /adsSync\.syncAfterWrite\(req\.account\.id, advertiserId\)/);
assert.match(routes, /action: 'entity_bulk_status'/);

const provider = read('ads-provider.js');
assert.match(provider, /async function resolveVideoPreviewMap/);
assert.match(provider, /get_tiktok_video_info/);
assert.match(provider, /videoPreview\.coverUrl/);
assert.match(provider, /videoPreview\.videoUrl/);
assert.match(provider, /Preview é enriquecimento visual best-effort/);

console.log('tiktok-campaign-workspace-v16-24: operations overview, hierarchy, media, approvals and automation OK');
