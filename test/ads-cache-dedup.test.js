'use strict';
/*
 * Bug de produção: "ON CONFLICT DO UPDATE command cannot affect row a second
 * time". Os upserts multi-linha do espelho (bulkUpsertCampaigns/Metrics) montam
 * um único INSERT ... ON CONFLICT DO UPDATE; se o MESMO conflict-key aparecer 2×
 * no lote (merge de Smart+ com a lista normal, ou paginação da API repetindo),
 * o Postgres quebra e o sync inteiro falha. Correção: dedup por chave (última
 * ocorrência vence) ANTES do insert.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const cache = require('../ads-cache-store');

let n = 0;
function ok(cond, label) { assert.ok(cond, label); n++; console.log('  ✓ ' + label); }
function eq(a, b, label) { assert.strictEqual(a, b, label + ' → esperado ' + b + ', veio ' + a); n++; console.log('  ✓ ' + label); }

const { dedupeByKey, classifyRows } = cache._internals;

console.log('dedupeByKey — mantém a última ocorrência por chave');
{
  const arr = [
    { id: 'a', v: 1 }, { id: 'b', v: 2 }, { id: 'a', v: 3 }, { id: 'c', v: 4 }, { id: 'b', v: 5 },
  ];
  const out = dedupeByKey(arr, (x) => x.id);
  eq(out.length, 3, 'chaves únicas (a,b,c)');
  eq(out.find((x) => x.id === 'a').v, 3, 'a → última (v=3)');
  eq(out.find((x) => x.id === 'b').v, 5, 'b → última (v=5)');
  // chave composta (como as métricas: level|entity|day)
  const metrics = [
    { level: 'campaign', entityId: '1', day: '2026-07-20', spend: 10 },
    { level: 'campaign', entityId: '1', day: '2026-07-20', spend: 99 }, // dup
    { level: 'ad', entityId: '1', day: '2026-07-20', spend: 5 },
  ];
  const md = dedupeByKey(metrics, (r) => r.level + '|' + r.entityId + '|' + r.day);
  eq(md.length, 2, 'métricas: (campaign,1,dia) colapsa; (ad,1,dia) separado');
  eq(md.find((r) => r.level === 'campaign').spend, 99, 'métrica duplicada → última vence');
}

console.log('bulkUpsert — dedup aplicado antes do INSERT multi-linha');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'ads-cache-store.js'), 'utf8');
  ok(/campaigns = dedupeByKey\(campaigns, \(c\) => String\(c\.platformCampaignId/.test(src), 'bulkUpsertCampaigns deduplica por campaign_id');
  ok(/rows = dedupeByKey\(rows, \(r\) => r\.level \+ '\|' \+ r\.entityId \+ '\|' \+ r\.day\)/.test(src), 'bulkUpsertMetrics deduplica por (level,entity,day)');
}

console.log('classifyRows — lote classificado com uma única leitura');
{
  const found = classifyRows([
    { advertiser_id: 'adv', data: { platformCampaignId: 'c1', campaignKind: 'auction', budgetOwner: 'adgroup', adSets: [] } },
    { advertiser_id: 'adv', data: { platformCampaignId: 'sp1', campaignKind: 'smart_plus', budgetOwner: 'campaign', adSets: [{ platformAdSetId: 'sg1', ads: [{ platformAdId: 'sa1' }] }] } },
  ], ['c1', 'sp1', 'sg1', 'sa1', 'missing']);
  eq(found.size, 4, 'quatro IDs existentes classificados sem inventar o ausente');
  eq(found.get('sp1').campaignKind, 'smart_plus', 'campanha Smart+ preserva o tipo');
  eq(found.get('sg1').budgetOwner, 'campaign', 'filho preserva o dono CBO do orçamento');
  eq(found.get('sa1').type, 'ad', 'asset group é classificado como anúncio');
}

console.log('ads-sync — merge de Smart+ não duplica campaign_id');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'ads-sync.js'), 'utf8');
  ok(/const smartById = new Map/.test(src), 'merge indexa a leitura Smart+ dedicada por campaign_id');
  ok(/smartById\.get\(String\(node\.platformCampaignId\)\) \|\| node/.test(src), 'Smart+ substitui o nó genérico duplicado do mesmo ID');
  ok(/if \(!present\.has\(String\(node\.platformCampaignId\)\)\) merged\.push\(node\)/.test(src), 'campanha Smart+ ausente na leitura genérica também é adicionada uma vez');
  ok(/const postWriteSync = new Map\(\)/.test(src), 'sync pós-escrita mantém estado por advertiser');
  ok(/while \(state\.dirty\)/.test(src), 'escritas concorrentes provocam nova passagem depois do sync em voo');
  ok(/dedupSync\(accountId, advertiserId, \{ force: true \}\)/.test(src), 'sync pós-escrita força leitura fresca da plataforma');
}

console.log('\nads-cache-dedup: ' + n + ' asserts OK');
