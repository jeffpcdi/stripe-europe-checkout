'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
function ok(cond, label) { assert.ok(cond, label); n++; console.log('  ✓ ' + label); }

const routes = fs.readFileSync(path.join(__dirname, '..', 'ads-routes.js'), 'utf8');
const ui = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'components', 'ads', 'campaign-tree.tsx'), 'utf8');

console.log('TikTok Ads — orçamento em lote');
ok(/app\.post\('\/api\/ads\/campaigns\/bulk-budget'/.test(routes), 'rota bulk-budget registrada');
ok(/killSwitchActive\(req\.account\.id\)/.test(routes), 'rota respeita kill switch');
ok(/requireAdvertiser\(req\.account\.id/.test(routes), 'advertiser recebido do navegador é revalidado');
ok(/classifyEntities\(req\.account\.id, advertiserId/.test(routes), 'IDs são classificados no espelho antes da escrita');
ok(/entity\.budgetOwner[\s\S]{0,120}!=='campaign'|entity\.budgetOwner[\s\S]{0,120}!== 'campaign'/.test(routes), 'ABO é ignorado no endpoint de orçamento de campanha');
ok(/isDryRun\(req\.account\.id\)/.test(routes), 'dry-run não publica alterações reais');
ok(/updateEntityBudget\(item\.entity/.test(routes), 'backend roteia atualização pelo tipo real da campanha');
ok(/adsSync\.syncAfterWrite\(req\.account\.id, advertiserId\)/.test(routes), 'um sync é disparado após o lote');
ok(/campaign_budget\.bulk_updated/.test(routes), 'operação é registrada na auditoria');
ok(/\/api\/ads\/campaigns\/bulk-budget/.test(ui), 'UI usa uma única chamada de lote');
ok(!/for \(const c of selectedCampaigns\)[\s\S]{0,1000}apiSend<\{ dryRun\?: boolean \}>\(`\/api\/ads\//.test(ui), 'UI não envia mais PUT sequencial por campanha');

console.log('\nads-bulk-budget: ' + n + ' asserts OK');
