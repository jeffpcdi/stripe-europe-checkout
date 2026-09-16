'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const audiences = read('dashboard/components/ads/audiences-dialog.tsx');
assert.match(audiences, /useAdsTikTokPixels/);
assert.match(audiences, /Purchase/);
assert.match(audiences, /InitiateCheckout/);
assert.match(audiences, /ViewContent/);
assert.match(audiences, /countries: market\.countries/);
assert.match(audiences, /SIMILARITY/);
assert.match(audiences, /BALANCE/);
assert.match(audiences, /REACH/);
assert.doesNotMatch(audiences, /Alcance estimado/);
assert.match(audiences, /appearance="quiet"/);

const providerSource = read('ads-provider.js');
const lookalike = providerSource.slice(providerSource.indexOf('async function createLookalikeAudience'), providerSource.indexOf('async function deleteCustomAudiences'));
assert.match(lookalike, /resolveLocationIds\(adv, countries, 'WEB_CONVERSIONS'\)/);
assert.doesNotMatch(lookalike, /location_ids:\s*\[["']BR["']\]/);

const duplicate = read('dashboard/components/ads/duplicate-panel.tsx');
assert.doesNotMatch(duplicate, /Conta destino/);
assert.match(duplicate, /Revisar duplicação/);
assert.match(duplicate, /duplicate\/preflight/);
assert.match(duplicate, /targetAdAccountId: currentAdvertiserId/);
assert.match(duplicate, /queue\?\.paused|job\?\.queue\?\.paused/);
assert.match(duplicate, /retryAt/);
assert.match(duplicate, /Simulada/);
assert.match(duplicate, /pausada/);

const ops = read('dashboard/components/ads/ops-dialog.tsx');
assert.match(ops, /Alterações não salvas/);
assert.match(ops, /Salvar política/);
assert.match(ops, /killSwitch/);
assert.match(ops, /dryRun/);
assert.doesNotMatch(ops, /input-neon/);
assert.match(ops, /Descartar alterações\?/);

const health = read('dashboard/components/ads/health-dialog.tsx');
assert.doesNotMatch(health, /onBlur=/);
assert.match(health, /Salvar texto/);
assert.match(health, /Alterações não salvas/);
assert.match(health, /Substituir o texto atual\?/);
assert.match(health, /Dispensar este ticket\?/);

const tour = read('dashboard/lib/tour.ts');
const adsTour = tour.slice(tour.indexOf('const ADS_TOUR'), tour.indexOf('/** Mapa rota'));
assert.match(adsTour, /appearance: 'quiet'/);
assert.match(adsTour, /roinados:ads-tab/);
assert.match(adsTour, /Campanhas/);
assert.match(adsTour, /Catálogo/);
assert.match(adsTour, /Automações/);
assert.doesNotMatch(adsTour, /Quatro abas/);
assert.doesNotMatch(adsTour, /ads-feed/);
assert.doesNotMatch(adsTour, /Hoje \(/);

const view = read('dashboard/components/ads/tiktok-ads-view.tsx');
assert.match(view, /roinados:ads-tab/);
assert.match(view, /data-tour="ads-campaign-actions"/);
assert.match(view, /data-tour="ads-catalog"/);
assert.match(view, /data-tour="ads-automation"/);

(async () => {
  const mcp = require('../pipeboard-mcp');
  let createArgs = null;
  const previous = mcp.callTool;
  mcp.callTool = async (name, args) => {
    if (name === 'get_tiktok_targeting_regions') return { regions: [{ region_code: 'BR', location_id: '76' }] };
    if (name === 'create_tiktok_lookalike_audience') { createArgs = args; return { custom_audience_id: 'look-1' }; }
    throw new Error('unexpected tool ' + name);
  };
  try {
    const provider = require('../ads-provider');
    await provider.createLookalikeAudience('adv-v163', { name: 'Semelhante', sourceAudienceId: 'seed-1', countries: ['BR'], lookalikeType: 'BALANCE' });
    assert.deepStrictEqual(createArgs.lookalike_spec.location_ids, ['76']);
    assert.notDeepStrictEqual(createArgs.lookalike_spec.location_ids, ['BR']);
  } finally { mcp.callTool = previous; }
  console.log('dashboard-tiktok-v16-3: UI/UX, tour e location_id do Lookalike OK');
})().catch((error) => { console.error(error); process.exitCode = 1; });
