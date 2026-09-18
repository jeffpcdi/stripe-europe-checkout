'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const traffic = require('../cloak-traffic-sources');
const publicSlug = require('../public-slug');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

// Link Kit profissional: URL limpa, token interno e macros de atribuição.
const standard = traffic.buildLinkKit({
  id: 'ck_test',
  domainHost: 'teste.example.com',
  path: 'd8as97kp',
  trafficSource: 'tiktok_standard',
  trafficToken: 'token123',
});
assert.equal(standard.url, 'https://teste.example.com/d8as97kp');
assert.match(standard.urlParams, /rk=token123/);
assert.match(standard.urlParams, /utm_campaign=__CAMPAIGN_NAME__/);
assert.match(standard.urlParams, /campaign_id=__CAMPAIGN_ID__/);
assert.match(standard.urlParams, /adgroup_id=__AID__/);
assert.match(standard.urlParams, /creative_id=__CID__/);
assert.doesNotMatch(standard.url, /\/c\//);
assert.doesNotMatch(standard.url, /\/go\//);

const smart = traffic.buildLinkKit({
  domainHost: 'teste.example.com',
  path: 'smart01',
  trafficSource: 'tiktok_smart_plus',
  trafficToken: 'smarttoken',
});
assert.match(smart.urlParams, /ad_id=__ADID_V2__/);
assert.match(smart.urlParams, /ad_name=__ADID_V2_NAME__/);

// Parâmetros internos nunca vazam para a página de destino.
const outbound = traffic.stripInternalParams('rk=secret&roi_debug=1&utm_source=tiktok&campaign_id=123&ttclid=abc');
assert.equal(outbound.get('rk'), null);
assert.equal(outbound.get('roi_debug'), null);
assert.equal(outbound.get('utm_source'), 'tiktok');
assert.equal(outbound.get('campaign_id'), '123');
assert.equal(outbound.get('ttclid'), 'abc');

// Paths públicos continuam aleatórios/normalizados pelo contrato V16.18.
for (let i = 0; i < 50; i++) assert.match(publicSlug.generate(), /^[a-hj-km-np-z2-9]{8}$/);
assert.equal(publicSlug.normalize(' Minha Oferta '), 'minha-oferta');

const store = read('cloak-campaign-store.js');
assert.match(store, /CREATE TABLE IF NOT EXISTS cloak_campaigns/);
assert.match(store, /cloak_campaigns_domain_path_uidx/);
assert.match(store, /ON cloak_campaigns \(domain_host, path\)/);
assert.match(store, /revision = revision \+ 1/);
assert.match(store, /legacy_slug/);
assert.match(store, /create_key_hash/);
assert.match(store, /function resolve\(host, path\)/);
assert.match(store, /byRoute\.get\(routeKey\(host, path\)\)/);

const server = read('server.js');
assert.match(server, /require\('\.\/cloak-campaign-store'\)/);
assert.match(server, /app\.get\('\/api\/cloak\/campaigns'/);
assert.match(server, /app\.post\('\/api\/cloak\/campaigns'/);
assert.match(server, /app\.delete\('\/api\/cloak\/campaigns\/:id'/);
assert.match(server, /app\.get\('\/api\/cloak\/campaigns\/:id\/link-kit'/);
assert.match(server, /const decisionKey = campaign \? 'campaign:' \+ campaign\.id/);
assert.match(server, /cloakCampaignStore\.resolve\(host, slug\)/);
assert.match(server, /stripInternalParams/);
assert.match(server, /cloakCampaignStore\.migrateLegacy/);

const api = read('dashboard/lib/api.ts');
assert.match(api, /useSWR<CloakEntriesResponse>\('\/api\/cloak\/campaigns'/);

const editor = read('dashboard/components/cloak/cloak-entry-editor.tsx');
assert.match(editor, /apiSend\('\/api\/cloak\/campaigns'/);
assert.match(editor, /TikTok Smart\+/);
assert.match(editor, /Escolha um domínio dedicado ao Cloaker/);

const panel = read('dashboard/components/cloak/cloak-entries-panel.tsx');
assert.match(panel, /campaign:\$\{id\}/);
assert.match(panel, /Copiar parâmetros/);
assert.match(panel, /\/api\/cloak\/campaigns/);

console.log('cloak-campaign-core-v16-21: durable campaign core, clean routing e Link Kit OK');
