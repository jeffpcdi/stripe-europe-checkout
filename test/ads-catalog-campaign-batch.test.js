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
  const longNames = domain.buildCampaignBatchNames(longPrefix, 2);
  ok(longNames.every((name) => name.length <= 120),
    'nomes respeitam o limite de 120 caracteres do TikTok');
  eq(new Set(longNames).size, 2, 'prefixo longo preserva sufixos únicos');
  ok(longNames[0].endsWith(' 01') && longNames[1].endsWith(' 02'),
    'prefixo longo não corta a numeração');
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
  ok(/prepared\.spec\.pixelId,[\s\S]*prepared\.spec\.bidStrategy[\s\S]*prepared\.spec\.deliveryMode[\s\S]*prepared\.spec\.identityId[\s\S]*prepared\.spec\.videoUrl, namePrefix/.test(body), 'fallback idempotente muda com vídeo, lance, entrega, perfil ou nome');
  ok(!/setCampaignStatus|createCatalogCampaign\(/.test(body), 'rota não toca o TikTok direto — só enfileira (worker cria pausado)');
}

console.log('Dialog — lote rápido sem CSV nem configuração repetida');
{
  const dialog = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'components', 'ads', 'catalog-quick-campaigns-dialog.tsx'), 'utf8');
  ok(/adsCreateCatalogCampaignBatch/.test(dialog), 'dialog chama o endpoint de lote');
  ok(/COUNT_PRESETS = \[1, 5, 10, 25, 50\]/.test(dialog), 'começa simples e mantém atalhos de escala 1/5/10/25/50');
  ok(/estrutura nasce pausada, é conferida e depois ativada/.test(dialog), 'resumo explica validação segura antes da ativação');
  ok(!/<textarea/.test(dialog) && !/buildCatalogBatchPlan/.test(dialog), 'nenhum CSV/colagem é exigido no Modo Turbo');
  ok(/productScope: 'all'/.test(dialog), 'escopo automático: todos os produtos do catálogo');
  ok(/Pixel, Compra e capa são automáticos/.test(dialog), 'Pixel, evento e capa são explicados sem virar campos repetidos');
  ok(/adsUpload\(file, 'video'\)/.test(dialog) && /videoUrl/.test(dialog), 'lote recebe um vídeo sem etapa manual no Ads Manager');
  ok(!/useAdsTikTokPixels|pixelId|pixelEvent|TIKTOK_PIXEL_EVENTS/.test(dialog), 'dialog não pede Pixel nem evento manualmente');
  ok(/idempotencyKey/.test(dialog), 'envia chave de idempotência (retry seguro)');
  ok(/autoActivate: true/.test(dialog), 'fluxo rápido solicita ativação automática após a validação');
  ok(/Máxima entrega/.test(dialog) && /Custo-alvo/.test(dialog) && /bidStrategy/.test(dialog), 'opções avançadas expõem estratégia de lance sem poluir o fluxo principal');
  ok(/Entrega acelerada/.test(dialog) && /deliveryMode/.test(dialog), 'entrega acelerada só é enviada pelo contrato explícito');
  ok(/Perfil mostrado no anúncio/.test(dialog) && /useAdsCatalogIdentities/.test(dialog), 'perfil autorizado pode ser escolhido sem abrir o Ads Manager');
  ok(/catalogCostCap/.test(dialog) && /catalogAcceleratedDelivery/.test(dialog), 'interface só mostra recursos confirmados pelo schema vivo');
  ok(/if \(!open\) return[\s\S]*setAdvancedOpen\(false\)[\s\S]*\[open, advertiserId, catalog\.id, initialVideoUrl\]/.test(dialog), 'reabrir o modal sempre volta ao fluxo automático limpo');
  ok(/Entrega e perfil/.test(dialog) && /advancedSummary/.test(dialog), 'resumo fechado mostra onde ajustar entrega e perfil');
  ok(/aria-expanded=\{advancedOpen\}/.test(dialog) && /advancedOpen && \(/.test(dialog), 'expansão controlada não reabre sozinha ao reutilizar o modal');
  ok(/overflow-hidden/.test(dialog) && /overflow-y-auto/.test(dialog) && /footer className="flex shrink-0/.test(dialog), 'corpo rola sem esconder a ação final');
  ok(!/>Cancelar<\/button>/.test(dialog) && /aria-label="Fechar"/.test(dialog), 'remove fechamento duplicado e mantém saída acessível');
  ok(/disabled:cursor-not-allowed disabled:opacity-40/.test(dialog), 'ação bloqueada parece bloqueada e explica o próximo passo');
  const wizard = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'components', 'ads', 'catalog-campaign-wizard.tsx'), 'utf8');
  ok(/CatalogQuickCampaignsDialog/.test(wizard), 'lote vive junto das campanhas do catálogo, sem poluir a lista');
  ok(/disabled=\{!connectorReady \|\| !ready \|\| Boolean\(activeRun\)\}/.test(wizard) && /open=\{dialogOpen\}/.test(wizard), 'botão do modal só abre quando o conector confirma Product Link e o catálogo está pronto');
  const routes = fs.readFileSync(path.join(__dirname, '..', 'ads-routes.js'), 'utf8');
  ok(/resolveCatalogPurchaseEvent\(advertiserId, pixel\.pixelId\)[\s\S]*pixelId: pixel\.pixelId[\s\S]*pixelEvent/.test(routes), 'backend injeta o Pixel central e o evento de Compra real antes de normalizar');
}

console.log('\nads-catalog-campaign-batch: ' + n + ' asserts OK');
