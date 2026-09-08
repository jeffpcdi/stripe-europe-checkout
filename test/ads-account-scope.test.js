const fs = require('fs');
const path = require('path');
const assert = require('assert');

const routes = fs.readFileSync(path.join(__dirname, '..', 'ads-routes.js'), 'utf8');
const api = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'lib', 'api.ts'), 'utf8');
const contextBar = fs.readFileSync(
  path.join(__dirname, '..', 'dashboard', 'components', 'ads', 'context-bar.tsx'),
  'utf8',
);
const view = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'components', 'ads', 'tiktok-ads-view.tsx'), 'utf8');
const campaignTree = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'components', 'ads', 'campaign-tree.tsx'), 'utf8');
const drawer = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'components', 'ads', 'campaign-drawer.tsx'), 'utf8');
const cacheStore = fs.readFileSync(path.join(__dirname, '..', 'ads-cache-store.js'), 'utf8');

function routeBody(method, route, nextRouteMarker) {
  const start = routes.indexOf(`app.${method}('${route}'`);
  assert.notStrictEqual(start, -1, `${method.toUpperCase()} ${route} deve existir`);
  const end = routes.indexOf(nextRouteMarker, start);
  assert.notStrictEqual(end, -1, `marcador final de ${route} deve existir`);
  return routes.slice(start, end);
}

const tree = routeBody('get', '/api/ads/tree', "app.get('/api/ads/campaigns/:id/analytics'");
const roas = routeBody('get', '/api/ads/roas', "app.get('/api/ads/library'");
const select = routeBody('post', '/api/ads/accounts/select', '// ── Árvore campanha');
const attribution = routeBody('get', '/api/ads/attribution', '// ── Regras automáticas');
const refresh = routeBody('post', '/api/ads/tree/refresh', "app.get('/api/ads/campaigns/:id/analytics'");
const analytics = routeBody('get', '/api/ads/campaigns/:id/analytics', '// ── ROAS');
const jobs = routeBody('get', '/api/ads/ops/jobs', "app.get('/api/ads/ops/safety-policy'");
const briefing = routeBody('get', '/api/ads/briefing', "app.post('/api/ads/briefing/run'");
const templates = routeBody('get', '/api/ads/templates', "app.post('/api/ads/templates'");

// Contrato: quando o cliente manda adAccountId, a rota valida a autorização
// via requireAdvertiser e usa o advertiser VALIDADO (nunca o texto cru do
// query). Pós-refactor do espelho Neon o shape mudou (advertiserId =
// selected.advertiserId), mas a garantia de escopo é a mesma.
assert.match(tree, /requireAdvertiser\([\s\S]*q\.adAccountId/);
assert.match(tree, /advertiserId = selected\.advertiserId/);
assert.match(tree, /readTree\(req\.account\.id, advertiserId/); // leitura do espelho escopada por conta+advertiser
assert.doesNotMatch(tree, /st\.advertiserId\s*\|\|\s*undefined/);
assert.doesNotMatch(tree, /aggregated/);

assert.match(roas, /requireAdvertiser\([\s\S]*q\.adAccountId/);
assert.match(roas, /\(await requireAdvertiser\(req\.account\.id, null, q\.adAccountId, null\)\)\.advertiserId/);
assert.match(roas, /readAdvertiserDaily\(req\.account\.id, advertiserId/); // gasto diário escopado

assert.match(select, /requireAdvertiser/);
// pós-migração ao Pipeboard não existe Business Center: o select valida o
// advertiser e persiste APENAS o id validado (nunca o corpo cru da request)
assert.match(select, /selectAdvertiser\(req\.account\.id, selected\.advertiserId\)/);
assert.match(attribution, /requireAdvertiser\(req\.account\.id, null, q\.adAccountId, null\)/);
assert.match(routes, /advertiserId === '__all__'/);
assert.match(routes, /err\.status = 400/);
assert.match(routes, /err\.status = 403/);

assert.doesNotMatch(contextBar, /Todas as contas/);
assert.doesNotMatch(contextBar, /value="__all__"/);
assert.match(api, /keepPreviousData: false/);
assert.match(api, /params\.set\('adAccountId', adAccountId\)/);

// Todas as leituras/ações sensíveis da UI levam a conta que está visível.
assert.match(view, /tree\/refresh\?adAccountId=/);
assert.match(view, /PixelBindingCard active=\{Boolean\(concreteAdvertiser\)\} advertiserId=\{concreteAdvertiser\}/);
assert.match(drawer, /useAdsCampaignAnalytics\(id, advertiserId, cur\)/);
assert.match(campaignTree, /budget: \{ amount, type \}, adAccountId/);
assert.match(campaignTree, /'DELETE', \{ adAccountId:/);

// O backend não confia no hint: valida antes de ler ou sincronizar.
assert.match(refresh, /requireAdvertiser[\s\S]*refreshNow\(req\.account\.id, advertiserId\)/);
assert.match(refresh, /SYNC_FAILED/);
assert.match(analytics, /requireAdvertiser[\s\S]*readCampaignAnalytics\(req\.account\.id, advertiserId/);
assert.match(jobs, /requireAdvertiser[\s\S]*listJobs\(req\.account\.id, req\.query\.limit, advertiserId\)/);
assert.match(briefing, /resolveAdv[\s\S]*listBriefings\(req\.account\.id, advertiserId/);
assert.match(templates, /resolveAdv[\s\S]*item\.advertiserId[\s\S]*advertiserId/);
assert.match(api, /useAdsTemplates\(active: boolean, adAccountId: string\)/);

// Migração preserva as linhas antigas, mas a chave nova separa advertisers.
assert.match(cacheStore, /ads_briefings_scope_unique[\s\S]*account_id, advertiser_id, date, kind/);
assert.match(cacheStore, /advertiser_id = ''/);

console.log('ads-account-scope.test.js OK — leituras, mutações, sync, jobs e briefings isolam a conta selecionada');
