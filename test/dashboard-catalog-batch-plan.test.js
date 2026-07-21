'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('../dashboard/node_modules/typescript');

function loadTypeScriptModule(file) {
  const source = fs.readFileSync(file, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      strict: true,
    },
    reportDiagnostics: true,
    fileName: file,
  });
  const diagnostics = compiled.diagnostics || [];
  assert.strictEqual(diagnostics.length, 0, diagnostics.map((item) => item.messageText).join('\n'));
  const loaded = { exports: {} };
  new Function('module', 'exports', compiled.outputText)(loaded, loaded.exports);
  return loaded.exports;
}

const { buildCatalogBatchPlan } = loadTypeScriptModule(
  path.join(__dirname, '..', 'dashboard', 'lib', 'catalog-batch-plan.ts'),
);
const { resolveStableIdempotencyKey } = loadTypeScriptModule(
  path.join(__dirname, '..', 'dashboard', 'lib', 'stable-idempotency.ts'),
);
const { catalogSyncRunsRefreshInterval } = loadTypeScriptModule(
  path.join(__dirname, '..', 'dashboard', 'lib', 'catalog-run-polling.ts'),
);
const { catalogPixelLabel, catalogPixelValue, pickDefaultCatalogPixel } = loadTypeScriptModule(
  path.join(__dirname, '..', 'dashboard', 'lib', 'catalog-pixels.ts'),
);

const header = 'catalogo\tsku\ttitulo\tpreco\tmarca\tlink\timagem\tcampanha\torcamento\tpixel_id\tevento';
function row(catalog, sku, campaign, pixelId, event = 'ON_WEB_ORDER') {
  return [
    catalog, sku, 'Produto ' + sku, '79,90', 'Marca real',
    'https://loja.example/' + sku, 'https://cdn.example/' + sku + '.jpg',
    campaign, '50', pixelId, event,
  ].join('\t');
}

let n = 0;
function ok(condition, label) {
  assert.ok(condition, label);
  n += 1;
  console.log('  ✓ ' + label);
}
function eq(actual, expected, label) {
  assert.strictEqual(actual, expected, label + ' → esperado ' + expected + ', veio ' + actual);
  n += 1;
  console.log('  ✓ ' + label);
}

console.log('dashboard-catalog-batch-plan — agrupamento seguro');
{
  const plan = buildCatalogBatchPlan([
    header,
    row('Loja A', 'sku-1', 'Campanha A', '1234567890123456789'),
    row('Loja A', 'sku-2', 'Campanha A', '1234567890123456789'),
  ].join('\n'), 'BRL', { requireCampaignPixel: true });
  eq(plan.message, '', 'nome idêntico pode repetir produtos sem erro');
  eq(plan.catalogs.length, 1, 'linhas do mesmo catálogo continuam agrupadas');
  eq(plan.catalogs[0].products.length, 2, 'todos os produtos são preservados');
  eq(plan.catalogs[0].campaigns.length, 1, 'campanha repetida é deduplicada');
  eq(plan.catalogs[0].campaigns[0].pixelId, '1234567890123456789', 'Pixel ID segue no payload da campanha');
  eq(plan.catalogs[0].campaigns[0].pixelEvent, 'ON_WEB_ORDER', 'evento canônico segue no payload');
}

console.log('dashboard-catalog-batch-plan — colisões de key');
{
  const plan = buildCatalogBatchPlan([
    header,
    row('Loja A', 'sku-1', 'Campanha A', '1234567890123456789'),
    row('Loja-A', 'sku-2', 'Campanha B', '1234567890123456789'),
  ].join('\n'), 'BRL', { requireCampaignPixel: true });
  ok(plan.message.includes('Loja A') && plan.message.includes('Loja-A'), 'erro identifica os dois nomes colidentes');
  ok(plan.message.includes('linha 2') && plan.message.includes('linha 3'), 'erro identifica as linhas da colisão');
  eq(plan.catalogs.length, 1, 'colisão não cria catálogo fantasma');
  eq(plan.catalogs[0].products.length, 1, 'linha colidente não é fundida ao primeiro catálogo');
}
{
  const plan = buildCatalogBatchPlan([
    header,
    row('Café', 'sku-1', 'Campanha A', '1234567890123456789'),
    row('Cafe', 'sku-2', 'Campanha B', '1234567890123456789'),
  ].join('\n'), 'BRL', { requireCampaignPixel: true });
  ok(plan.message.includes('Café') && plan.message.includes('Cafe'), 'colisão causada por remoção de acento também é explícita');
}

console.log('dashboard-catalog-batch-plan — contrato do Pixel');
{
  const withoutPixel = [header, row('Loja A', 'sku-1', 'Campanha A', '')].join('\n');
  const catalogOnly = buildCatalogBatchPlan(withoutPixel, 'BRL');
  eq(catalogOnly.message, '', 'Pixel não bloqueia lote que não prepara campanhas');
  const campaigns = buildCatalogBatchPlan(withoutPixel, 'BRL', { requireCampaignPixel: true });
  ok(campaigns.message.includes('linhas 2') && campaigns.message.includes('pixel_id'), 'campanha sem Pixel aponta linha e coluna esperada');
}
{
  const plan = buildCatalogBatchPlan([
    header,
    row('Loja A', 'sku-1', 'Campanha A', 'pixel-123'),
  ].join('\n'), 'BRL', { requireCampaignPixel: true });
  ok(plan.message.includes('somente 6 a 30 dígitos'), 'Pixel alfanumérico é bloqueado antes do preview');
}
{
  const plan = buildCatalogBatchPlan([
    header,
    row('Loja A', 'sku-1', 'Campanha A', '1234567890123456789', ''),
  ].join('\n'), 'BRL', { requireCampaignPixel: true });
  eq(plan.catalogs[0].campaigns[0].pixelEvent, 'ON_WEB_ORDER', 'evento vazio recebe o padrão canônico');
}

console.log('dashboard-catalog-batch-plan — Pixel padrão automático');
{
  const withoutPixel = [
    header,
    row('Loja A', 'sku-1', 'Campanha A', '', ''),
    row('Loja B', 'sku-2', 'Campanha B', '', ''),
  ].join('\n');
  const plan = buildCatalogBatchPlan(withoutPixel, 'BRL', {
    requireCampaignPixel: true,
    defaultPixelId: '9876543210987654321',
  });
  eq(plan.message, '', 'Pixel padrão elimina a exigência da coluna pixel_id');
  eq(plan.catalogs[0].campaigns[0].pixelId, '9876543210987654321', 'campanha sem pixel_id herda o Pixel padrão');
  eq(plan.catalogs[1].campaigns[0].pixelId, '9876543210987654321', 'todas as campanhas do lote herdam o padrão');
  eq(plan.catalogs[0].campaigns[0].pixelEvent, 'ON_WEB_ORDER', 'evento vazio segue o canônico mesmo com Pixel padrão');
}
{
  const plan = buildCatalogBatchPlan([
    header,
    row('Loja A', 'sku-1', 'Campanha A', '1111110000000000001'),
  ].join('\n'), 'BRL', { requireCampaignPixel: true, defaultPixelId: '9876543210987654321' });
  eq(plan.catalogs[0].campaigns[0].pixelId, '1111110000000000001', 'coluna pixel_id preenchida vence o Pixel padrão');
}
{
  const plan = buildCatalogBatchPlan([
    header,
    row('Loja A', 'sku-1', 'Campanha A', '', ''),
  ].join('\n'), 'BRL', { requireCampaignPixel: true, defaultPixelId: 'pixel-abc' });
  ok(plan.message.includes('pixel_id'), 'Pixel padrão inválido é ignorado e a exigência volta a valer');
}
{
  const plan = buildCatalogBatchPlan([
    header,
    row('Loja A', 'sku-1', 'Campanha A', '', ''),
  ].join('\n'), 'BRL', { requireCampaignPixel: true, defaultPixelId: '9876543210987654321', defaultPixelEvent: 'initiate_order' });
  eq(plan.catalogs[0].campaigns[0].pixelEvent, 'INITIATE_ORDER', 'evento padrão customizado é normalizado para maiúsculas');
}
{
  const plan = buildCatalogBatchPlan([
    header,
    row('Loja A', 'sku-1', 'Campanha A', '', 'ON_WEB_CART'),
  ].join('\n'), 'BRL', { requireCampaignPixel: true, defaultPixelId: '9876543210987654321', defaultPixelEvent: 'INITIATE_ORDER' });
  eq(plan.catalogs[0].campaigns[0].pixelEvent, 'ON_WEB_CART', 'coluna evento preenchida vence o evento padrão');
}
{
  const pixels = [
    { id: '1000000000000000001', code: 'A', name: 'Antigo', status: 'inactive', purchaseCount: 90 },
    { id: '1000000000000000002', code: 'B', name: 'Principal', status: 'active', purchaseCount: 42 },
    { id: '1000000000000000003', code: 'C', name: 'Secundário', status: 'active', purchaseCount: 7 },
  ];
  eq(pickDefaultCatalogPixel(pixels), '1000000000000000002', 'auto-seleção prefere pixel ativo com mais compras em 30d');
  eq(pickDefaultCatalogPixel([]), '', 'lista vazia não seleciona Pixel');
  eq(pickDefaultCatalogPixel([{ id: 'abc', code: 'x', name: 'Sem ID', status: 'active', purchaseCount: 5 }]), '', 'pixel sem ID numérico é descartado da auto-seleção');
  eq(pickDefaultCatalogPixel([
    { id: 'local', code: '2000000000000000009', name: 'Só código', status: 'active', purchaseCount: 1 },
  ]), '2000000000000000009', 'código numérico serve de fallback na auto-seleção');
}

console.log('dashboard-catalog-batch-plan — retry e polling');
{
  let created = 0;
  const createKey = () => 'key-' + (++created);
  const first = resolveStableIdempotencyKey(null, 'form-a', createKey);
  const retry = resolveStableIdempotencyKey(first, 'form-a', createKey);
  const changed = resolveStableIdempotencyKey(retry, 'form-b', createKey);
  const afterSuccess = resolveStableIdempotencyKey(null, 'form-b', createKey);
  eq(retry.key, first.key, 'retry sem mudança reaproveita a chave idempotente');
  ok(changed.key !== first.key, 'mudança material gera nova chave idempotente');
  ok(afterSuccess.key !== changed.key, 'reset após sucesso gera nova chave na próxima criação');
  eq(created, 3, 'fábrica só roda em mudança material ou reset');
}
{
  eq(catalogSyncRunsRefreshInterval([{ status: 'running', stage: 'uploading_products' }]), 4_000, 'run ativo consulta a cada 4 segundos');
  eq(catalogSyncRunsRefreshInterval([{ status: 'waiting_tiktok_processing', stage: 'processing_tiktok' }]), 15_000, 'estado explícito de processamento do TikTok mantém polling');
  eq(catalogSyncRunsRefreshInterval([{ status: 'completed', stage: 'processing_tiktok' }]), 15_000, 'processamento assíncrono do TikTok mantém polling');
  eq(catalogSyncRunsRefreshInterval([{ status: 'completed', stage: 'reviewed_tiktok' }]), 0, 'auditoria concluída encerra polling');
  eq(catalogSyncRunsRefreshInterval([{ status: 'failed', stage: 'failed' }]), 0, 'terminal acionável encerra polling');
}
{
  const pixel = { id: '1234567890123456789', code: 'PIXEL_A', name: 'Checkout principal', status: 'active', purchaseCount: 12 };
  eq(catalogPixelValue(pixel), pixel.id, 'lista autenticada seleciona o ID numérico do Pixel');
  ok(catalogPixelLabel(pixel).includes('Checkout principal') && catalogPixelLabel(pixel).includes('12 compras em 30d'), 'opção mostra nome e compras de 30 dias');
  eq(catalogPixelValue({ ...pixel, id: 'local', code: '9876543210987654321' }), '9876543210987654321', 'código numérico funciona como fallback do ID');
}

console.log('\ndashboard-catalog-batch-plan: ' + n + ' asserts OK');
