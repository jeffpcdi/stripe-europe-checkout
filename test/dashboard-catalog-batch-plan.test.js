'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('../dashboard/node_modules/typescript');

function loadTypeScriptModule(file) {
  const source = fs.readFileSync(file, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, strict: true },
    reportDiagnostics: true,
    fileName: file,
  });
  assert.strictEqual((compiled.diagnostics || []).length, 0);
  const loaded = { exports: {} };
  new Function('module', 'exports', compiled.outputText)(loaded, loaded.exports);
  return loaded.exports;
}

const { buildCatalogBatchPlan } = loadTypeScriptModule(path.join(__dirname, '..', 'dashboard', 'lib', 'catalog-batch-plan.ts'));
const { resolveStableIdempotencyKey } = loadTypeScriptModule(path.join(__dirname, '..', 'dashboard', 'lib', 'stable-idempotency.ts'));
const { catalogCampaignRunsRefreshInterval, catalogSyncRunsRefreshInterval } = loadTypeScriptModule(path.join(__dirname, '..', 'dashboard', 'lib', 'catalog-run-polling.ts'));

const header = 'catalogo\tsku\ttitulo\tpreco\tmarca\tlink\timagem\tcampanha\torcamento\ttipo_orcamento\tpais\tperiodo';
function row(catalog, sku, campaign, config = {}) {
  return [
    catalog, sku, 'Produto ' + sku, '79,90', config.brand ?? 'Marca real',
    'https://loja.example/' + sku, 'https://cdn.example/' + sku + '.jpg',
    campaign, config.budget ?? '50', config.budgetType ?? 'daily', config.country ?? 'BR', config.period ?? '',
  ].join('\t');
}

let n = 0;
function ok(condition, label) { assert.ok(condition, label); n += 1; console.log('  ✓ ' + label); }
function eq(actual, expected, label) { assert.strictEqual(actual, expected, label); n += 1; console.log('  ✓ ' + label); }

console.log('Lote de catálogo — agrupamento e Pixel central');
{
  const plan = buildCatalogBatchPlan([header, row('Loja A', 'sku-1', 'Campanha A'), row('Loja A', 'sku-2', 'Campanha A')].join('\n'), 'BRL');
  eq(plan.message, '', 'nome idêntico repete produtos sem erro');
  eq(plan.catalogs.length, 1, 'linhas ficam no mesmo catálogo');
  eq(plan.catalogs[0].products.length, 2, 'todos os produtos são preservados');
  eq(plan.catalogs[0].campaigns.length, 1, 'campanha repetida é deduplicada');
  ok(!('pixelId' in plan.catalogs[0].campaigns[0]), 'planilha não transporta Pixel por linha');
  ok(!('pixelEvent' in plan.catalogs[0].campaigns[0]), 'planilha não transporta evento por linha');
}
{
  const legacy = [header + '\tpixel_id\tevento', row('Loja A', 'sku-1', 'Campanha A') + '\t1234567890123456789\tINITIATE_ORDER'].join('\n');
  const plan = buildCatalogBatchPlan(legacy, 'BRL');
  eq(plan.message, '', 'colunas legadas de Pixel são ignoradas sem quebrar importações');
  ok(!('pixelId' in plan.catalogs[0].campaigns[0]), 'Pixel legado não substitui o vínculo central');
}

console.log('Lote de catálogo — colisões e dados obrigatórios');
{
  const plan = buildCatalogBatchPlan([header, row('Loja A', 'sku-1', 'Campanha A'), row('Loja-A', 'sku-2', 'Campanha B')].join('\n'), 'BRL');
  ok(plan.message.includes('Loja A') && plan.message.includes('Loja-A'), 'colisão identifica os dois nomes');
  ok(plan.message.includes('linha 2') && plan.message.includes('linha 3'), 'colisão identifica as linhas');
  eq(plan.catalogs[0].products.length, 1, 'linha colidente não é fundida');
}
{
  const plan = buildCatalogBatchPlan([header, row('Loja A', 'sku-1', 'Campanha A', { brand: '' })].join('\n'), 'BRL');
  ok(/marca real/i.test(plan.message) && /linhas? 2/.test(plan.message), 'marca ausente bloqueia com linha exata');
}
{
  const plan = buildCatalogBatchPlan([
    header,
    row('Loja A', 'sku-1', 'Campanha A'),
    row('Loja A', 'sku-2', 'Campanha A', { budget: '70', budgetType: 'lifetime', country: 'US', period: '2026-08-31' }),
  ].join('\n'), 'BRL');
  ok(plan.message.includes('orçamento') && plan.message.includes('tipo de orçamento'), 'campanha repetida detecta configuração divergente');
  ok(plan.message.includes('país') && plan.message.includes('período'), 'conflito informa os campos divergentes');
  eq(plan.catalogs[0].products.length, 2, 'produtos permanecem disponíveis para correção');
}

console.log('Retry e polling dos jobs');
{
  let created = 0;
  const createKey = () => 'key-' + (++created);
  const first = resolveStableIdempotencyKey(null, 'form-a', createKey);
  const retry = resolveStableIdempotencyKey(first, 'form-a', createKey);
  const changed = resolveStableIdempotencyKey(retry, 'form-b', createKey);
  eq(retry.key, first.key, 'retry preserva a chave idempotente');
  ok(changed.key !== first.key, 'mudança material gera nova chave');
}
{
  eq(catalogSyncRunsRefreshInterval([{ status: 'running', stage: 'uploading_products' }]), 4_000, 'sync ativo consulta em 4 segundos');
  eq(catalogSyncRunsRefreshInterval([{ status: 'waiting_tiktok_processing', stage: 'processing_tiktok' }]), 15_000, 'processamento TikTok mantém polling lento');
  eq(catalogSyncRunsRefreshInterval([{ status: 'completed', stage: 'reviewed_tiktok' }]), 0, 'sync concluído encerra polling');
  eq(catalogCampaignRunsRefreshInterval([{ status: 'waiting_catalog_review' }]), 15_000, 'campanha aguardando catálogo consulta em 15 segundos');
  eq(catalogCampaignRunsRefreshInterval([{ status: 'waiting_tiktok_confirmation' }]), 15_000, 'campanha aguardando readback do TikTok consulta em 15 segundos');
  eq(catalogCampaignRunsRefreshInterval([{ status: 'waiting_connector_confirmation' }]), 60_000, 'campanha aguardando conector consulta em 60 segundos');
  eq(catalogCampaignRunsRefreshInterval([{ status: 'completed' }]), 0, 'campanha concluída encerra polling');
}

console.log('\ndashboard-catalog-batch-plan: ' + n + ' asserts OK');
