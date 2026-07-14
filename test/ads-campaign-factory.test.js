const assert = require('assert');
const fs = require('fs');
const path = require('path');

const routes = fs.readFileSync(path.join(__dirname, '..', 'ads-routes.js'), 'utf8');
const bulk = fs.readFileSync(path.join(__dirname, '..', 'ads-bulk.js'), 'utf8');
const ops = fs.readFileSync(path.join(__dirname, '..', 'ads-ops-store.js'), 'utf8');

assert.match(routes, /app\.post\('\/api\/ads\/bulk'[\s\S]*?idempotencyKey obrigatória/);
assert.match(routes, /app\.post\('\/api\/ads\/bulk'[\s\S]*?requireAdvertiser/);
assert.match(routes, /app\.post\('\/api\/ads\/bulk'[\s\S]*?campaign_factory\.simulated/);
// Pós-migração ao Pipeboard a duplicação está desabilitada de propósito:
// a rota DEVE existir e responder 501 com código estável (a UI trata), em vez
// de fingir que duplica. Se voltar a ser implementada, restaurar as asserções
// de requireAdvertiser + campaign_duplicate.simulated.
assert.match(routes, /app\.post\('\/api\/ads\/duplicate'[\s\S]*?501/);
assert.match(routes, /app\.post\('\/api\/ads\/duplicate'[\s\S]*?DUPLICATE_UNSUPPORTED/);
assert.match(bulk, /findJobByIdempotencyKey/);
assert.match(ops, /task: item\.payload && item\.payload\.task/);
assert.match(ops, /payload = EXCLUDED\.payload/);

console.log('ads-campaign-factory tests: OK');
