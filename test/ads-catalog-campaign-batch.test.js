'use strict';
/*
 * Modo Turbo: N campanhas VSA de um catálogo em uma única chamada.
 * O domínio gera os nomes numerados (função pura, testada de verdade) e a
 * rota reutiliza prepareCatalogCampaign + runs idempotentes — inspecionamos o
 * fonte para garantir que os guardrails (kill switch, dry-run, idempotência)
 * não sejam contornados pelo caminho novo.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const domain = require('../catalog/catalog-domain');

let n = 0;
function ok(cond, label) { assert.ok(cond, label); n++; console.log('  ✓ ' + label); }
function eq(actual, expected, label) { assert.deepStrictEqual(actual, expected, label); n++; console.log('  ✓ ' + label); }
function throwsWith(fn, code, label) {
  try { fn(); ok(false, label + ' (deveria lançar)'); }
  catch (e) { assert.strictEqual(e.code, code, `${label} code=${e.code}`); n++; console.log('  ✓ ' + label); }
}

console.log('Domínio — nomes numerados do lote (buildCampaignBatchNames)');
{
  eq(domain.buildCampaignBatchNames('Loja Verão — VSA', 3),
    ['Loja Verão — VSA 01', 'Loja Verão — VSA 02', 'Loja Verão — VSA 03'],
    '3 campanhas ganham numeração 01..03 com zero-padding');
  const fifty = domain.buildCampaignBatchNames('Catálogo — VSA', 50);
  eq(fifty.length, 50, '50 campanhas geram 50 nomes');
  eq(fifty[0], 'Catálogo — VSA 01', 'primeiro nome do lote de 50');
  eq(fifty[49], 'Catálogo — VSA 50', 'último nome do lote de 50');
  eq(new Set(fifty).size, 50, 'nenhum nome duplicado no lote');
  eq(domain.buildCampaignBatchNames('Único', 1), ['Único 01'], 'lote de 1 também é numerado (consistência)');
  eq(domain.CATALOG_CAMPAIGN_BATCH_MAX, 50, 'limite máximo do lote é 50');
  const longPrefix = 'x'.repeat(130);
  ok(domain.buildCampaignBatchNames(longPrefix, 2).every((name) => name.length <= 120),
    'nomes respeitam o limite de 120 caracteres do TikTok');
  throwsWith(() => domain.buildCampaignBatchNames('Loja', 0), 'CATALOG_CAMPAIGN_BATCH_COUNT_INVALID', 'count 0 é rejeitado');
  throwsWith(() => domain.buildCampaignBatchNames('Loja', 51), 'CATALOG_CAMPAIGN_BATCH_COUNT_INVALID', 'count 51 é rejeitado');
  throwsWith(() => domain.buildCampaignBatchNames('Loja', 2.5), 'CATALOG_CAMPAIGN_BATCH_COUNT_INVALID', 'count fracionário é rejeitado');
  throwsWith(() => domain.buildCampaignBatchNames('Loja', 'abc'), 'CATALOG_CAMPAIGN_BATCH_COUNT_INVALID', 'count não numérico é rejeitado');
  throwsWith(() => domain.buildCampaignBatchNames('   ', 5), 'CATALOG_CAMPAIGN_NAME_REQUIRED', 'prefixo vazio é rejeitado');
}

console.log('Rota — guardrails do campaign-batch');
{
  const routes = fs.readFileSync(path.join(__dirname, '..', 'ads-routes.js'), 'utf8');
  ok(/app\.post\('\/api\/ads\/catalogs\/:catalogId\/campaign-batch'/.test(routes), 'POST /catalogs/:id/campaign-batch registrado');
  const body = (routes.match(/campaign-batch'[\s\S]*?\n  \}\);/) || [''])[0];
  ok(body.length > 0, 'corpo da rota encontrado para inspeção');
  ok(/prepareCatalogCampaign\(req\)/.test(body), 'reutiliza prepareCatalogCampaign (prontidão, capabilities, pixel, orçamento)');
  ok(/buildCampaignBatchNames/.test(body), 'usa o gerador de nomes do domínio (validação de count centralizada)');
  ok(/killSwitchActive/.test(body), 'respeita kill switch (Pausar tudo)');
  ok(/isDryRun/.test(body), 'respeita Modo teste (dry-run) sem criar runs');
  ok(/auditSimulated/.test(body), 'dry-run audita a simulação do lote');
  ok(/scopedCatalogRunIdempotencyKey\(prepared\.advertiserId, `\$\{batchKey\}:\$\{i \+ 1\}`\)/.test(body),
    'cada campanha tem chave de idempotência derivada por índice (retry não duplica)');
  ok(/createCampaignRun/.test(body), 'enfileira runs duráveis processados pelo worker existente');
  ok(/Idempotency-Key/.test(body), 'aceita Idempotency-Key do cliente');
  ok(!/setCampaignStatus|createCatalogCampaign\(/.test(body), 'rota não toca o TikTok direto — só enfileira (worker cria pausado)');
}

console.log('Dialog — Modo Turbo sem CSV e com Pixel automático');
{
  const dialog = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'components', 'ads', 'catalog-quick-campaigns-dialog.tsx'), 'utf8');
  ok(/adsCreateCatalogCampaignBatch/.test(dialog), 'dialog chama o endpoint de lote');
  ok(/pickDefaultCatalogPixel/.test(dialog), 'Pixel é auto-selecionado (ativo + mais compras 30d)');
  ok(/COUNT_PRESETS = \[5, 10, 25, 50\]/.test(dialog), 'atalhos de quantidade 5/10/25/50');
  ok(/nascem\s+<strong[^>]*>pausadas<\/strong>/.test(dialog), 'resumo deixa claro que tudo nasce pausado');
  ok(!/<textarea/.test(dialog) && !/buildCatalogBatchPlan/.test(dialog), 'nenhum CSV/colagem é exigido no Modo Turbo');
  ok(/productScope: 'all'/.test(dialog), 'escopo automático: todos os produtos do catálogo');
  ok(/idempotencyKey/.test(dialog), 'envia chave de idempotência (retry seguro)');
  const manager = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'components', 'ads', 'catalog-manager.tsx'), 'utf8');
  ok(/CatalogQuickCampaignsDialog/.test(manager), 'lista de catálogos abre o Modo Turbo');
  ok(/linkStatus === 'verified'/.test(manager), 'botão aparece apenas em catálogos conectados/verificados');
}

console.log('\nads-catalog-campaign-batch: ' + n + ' asserts OK');
