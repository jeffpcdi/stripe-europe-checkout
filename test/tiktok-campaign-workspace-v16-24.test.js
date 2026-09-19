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

const workspace = read('dashboard/components/ads/campaign-workspace.tsx');
for (const label of ['Campanhas', 'Conjuntos', 'Anúncios', 'Criativos', 'Insights']) {
  assert.match(workspace, new RegExp(`label: '${label}'`));
}
assert.match(workspace, /ads:campaign-workspace-level/);
assert.match(workspace, /ads:campaign-workspace-status/);
assert.match(workspace, /ads:campaign-workspace-metrics/);
assert.match(workspace, /\/api\/ads\/entities\/bulk-status/);
assert.match(workspace, /CreativePreview ad=\{ad\}/);
assert.match(workspace, /<video/);
assert.match(workspace, /EntityStatusToggle/);
assert.match(workspace, /Performance/);
assert.match(workspace, /Entrega/);
assert.match(workspace, /Custos/);
assert.match(workspace, /Gasto sem venda real/);
assert.match(workspace, /Operação autônoma/);

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

console.log('tiktok-campaign-workspace-v16-24: hierarchy workspace, child controls and bulk operations OK');
