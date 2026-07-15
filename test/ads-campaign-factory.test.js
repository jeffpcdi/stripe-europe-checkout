const assert = require('assert');
const fs = require('fs');
const path = require('path');

const routes = fs.readFileSync(path.join(__dirname, '..', 'ads-routes.js'), 'utf8');
const bulk = fs.readFileSync(path.join(__dirname, '..', 'ads-bulk.js'), 'utf8');
const ops = fs.readFileSync(path.join(__dirname, '..', 'ads-ops-store.js'), 'utf8');

assert.match(routes, /app\.post\('\/api\/ads\/bulk'[\s\S]*?idempotencyKey obrigatória/);
assert.match(routes, /app\.post\('\/api\/ads\/bulk'[\s\S]*?requireAdvertiser/);
assert.match(routes, /app\.post\('\/api\/ads\/bulk'[\s\S]*?campaign_factory\.simulated/);
// F3: duplicação reimplementada via Pipeboard (captura + recriação composta).
// A rota valida advertiser + idempotencyKey, passa pelo guard da política
// (kill switch/dry-run) e recusa cross-account com código estável (a UI trata).
assert.match(routes, /app\.post\('\/api\/ads\/duplicate'[\s\S]*?requireAdvertiser/);
assert.match(routes, /app\.post\('\/api\/ads\/duplicate'[\s\S]*?idempotencyKey obrigatória/);
assert.match(routes, /app\.post\('\/api\/ads\/duplicate'[\s\S]*?assertMutationAllowed/);
assert.match(routes, /app\.post\('\/api\/ads\/duplicate'[\s\S]*?CROSS_ACCOUNT_UNSUPPORTED/);
assert.match(routes, /app\.post\('\/api\/ads\/duplicate'[\s\S]*?captureCampaign/);
// O worker do bulk processa o tipo novo com retomada idempotente:
assert.match(routes, /duplicate_pb[\s\S]*?getBulkProgress/);
assert.match(routes, /duplicate_pb[\s\S]*?recreateCampaign/);
assert.match(bulk, /findJobByIdempotencyKey/);
assert.match(ops, /task: item\.payload && item\.payload\.task/);
assert.match(ops, /payload = EXCLUDED\.payload/);

console.log('ads-campaign-factory tests: OK');
