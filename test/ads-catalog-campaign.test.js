'use strict';
/*
 * Lançar a hierarquia completa de Catalog Video Ads pela dashboard.
 * O composto valida TUDO antes de tocar a rede (advertiser/catalogId/bcId/nome/
 * orçamento) e a rota respeita os guardrails (kill switch, dry-run) + exige o
 * catálogo já sincronizado. Sem chave da API, a criação real fica no runbook.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const provider = require('../ads-provider');

let n = 0;
function ok(cond, label) { assert.ok(cond, label); n++; console.log('  ✓ ' + label); }
async function throws(fn, status, label) {
  try { await fn(); ok(false, label + ' (deveria lançar)'); }
  catch (e) { assert.strictEqual(e.status, status, label + ' status=' + e.status); n++; console.log('  ✓ ' + label); }
}

(async () => {
  console.log('Provider — validação antes da rede (createCatalogCampaign)');
  const base = { catalogId: 'cat_1', bcId: 'bc_1', name: 'Catálogo X', budgetAmount: 50 };
  await throws(() => provider.createCatalogCampaign('', base), 400, 'exige advertiser');
  await throws(() => provider.createCatalogCampaign('123', { ...base, catalogId: '' }), 400, 'exige catalogId do TikTok');
  await throws(() => provider.createCatalogCampaign('123', { ...base, bcId: '' }), 400, 'exige bcId (Business Center)');
  await throws(() => provider.createCatalogCampaign('123', { ...base, name: '' }), 400, 'exige nome');
  await throws(() => provider.createCatalogCampaign('123', { ...base, budgetAmount: 0 }), 400, 'exige orçamento > 0');
  await throws(() => provider.createCatalogCampaign('123', { ...base, budgetType: 'lifetime' }), 400, 'orçamento total exige data de término');

  console.log('Provider — exportado e no molde composto');
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'ads-provider.js'), 'utf8');
    ok(typeof provider.createCatalogCampaign === 'function', 'createCatalogCampaign exportado');
    ok(typeof provider.listInterestCategories === 'function', 'listInterestCategories exportado');
    const body = src.match(/async function createCatalogCampaign[\s\S]*?\n}\n/)[0];
    ok(/objective_type: 'PRODUCT_SALES'/.test(body), 'campanha usa objetivo PRODUCT_SALES');
    ok(/VIDEO_SHOPPING_ADS/.test(body), 'usa o tipo Video Shopping Ads do fluxo validado');
    ok(/product_source: 'CATALOG'/.test(body), 'ad group aponta a fonte CATALOG');
    ok(/CATALOG_VIDEO/.test(body), 'anúncio usa Catalog video');
    ok(/catalog_video_template_id/.test(body), 'propaga o template de vídeo do catálogo');
    ok(/product_ids/.test(body), 'propaga produtos específicos');
    ok(/operation_status: 'DISABLE'|status: 'PAUSED'/.test(body), 'nasce pausada');
    ok(/setCampaignStatus\(adv, \[campaignId\], 'paused'\)/.test(body), 'órfã é pausada no catch (à prova de órfãos)');
    ok(/stepError\('adgroup'/.test(body), 'reporta o passo em falha de ad group');
    ok(/verifying_entities/.test(body), 'confirma campanha, conjunto e anúncio antes do sucesso');
  }

  console.log('Rota — guardrails e pré-requisitos');
  {
    const routes = fs.readFileSync(path.join(__dirname, '..', 'ads-routes.js'), 'utf8');
    ok(/app\.post\('\/api\/ads\/catalogs\/:catalogId\/campaign'/.test(routes), 'POST /catalogs/:id/campaign registrado');
    const body = (routes.match(/async function prepareCatalogCampaign[\s\S]*?app\.post\('\/api\/ads\/catalogs\/:catalogId\/campaign-runs[^\n]*/) || [''])[0];
    ok(/killSwitchActive/.test(body), 'respeita kill switch (Pausar tudo)');
    ok(/isDryRun/.test(body), 'respeita Modo teste (dry-run)');
    ok(/CATALOG_LINK_NOT_VERIFIED/.test(body), 'exige vínculo remoto verificado');
    ok(/createCampaignRun/.test(body), 'enfileira um job durável e idempotente');
    ok(/auditSimulated/.test(body), 'dry-run audita a simulação');
    const worker = fs.readFileSync(path.join(__dirname, '..', 'catalog', 'catalog-campaign-worker.js'), 'utf8');
    ok(/provider\.createCatalogCampaign/.test(worker), 'worker chama o composto do provider');
    ok(/status = Object\.keys\(createdIds\)\.length \? 'partial' : 'failed'/.test(worker), 'falha parcial preserva IDs criados');
    // interesses (Parte A, leitura)
    ok(/app\.get\('\/api\/ads\/targeting\/interests'/.test(routes), 'GET /targeting/interests registrado');
    ok(/listInterestCategories/.test(routes), 'rota de interesses chama o provider');
  }

  console.log('CSV pronto + publish honesto (fallback do 502)');
  {
    const routes = fs.readFileSync(path.join(__dirname, '..', 'ads-routes.js'), 'utf8');
    const csvBody = (routes.match(/export\.csv'[\s\S]*?buildCatalogCsv\(products\)/) || [''])[0];
    ok(/all\.filter\(\(p\) => p\.valid\)/.test(csvBody), 'export.csv serve só produtos válidos (import-ready)');
    ok(/all=1|\.all \|\| ''\) === '1'/.test(csvBody), 'export.csv aceita ?all=1 para debug (todos)');
    const worker = fs.readFileSync(path.join(__dirname, '..', 'catalog', 'catalog-sync-worker.js'), 'utf8');
    ok(/appendPublication[\s\S]*status: 'error'/.test(worker), 'worker persiste a razão real da falha de sincronização');
  }

  console.log('\nads-catalog-campaign: ' + n + ' asserts OK');
})().catch((e) => { console.error(e); process.exit(1); });
