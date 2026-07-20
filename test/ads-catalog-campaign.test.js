'use strict';
/*
 * Parte B — lançar campanha de catálogo (DPA / Catalog Listing Ads) da dashboard.
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
    ok(/product_source: 'CATALOG'/.test(body), 'ad group aponta a fonte CATALOG');
    ok(/operation_status: 'DISABLE'|status: 'PAUSED'/.test(body), 'nasce pausada');
    ok(/setCampaignStatus\(adv, \[campaignId\], 'paused'\)/.test(body), 'órfã é pausada no catch (à prova de órfãos)');
    ok(/stepError\('adgroup'/.test(body), 'reporta o passo em falha de ad group');
  }

  console.log('Rota — guardrails e pré-requisitos');
  {
    const routes = fs.readFileSync(path.join(__dirname, '..', 'ads-routes.js'), 'utf8');
    ok(/app\.post\('\/api\/ads\/catalogs\/:catalogId\/campaign'/.test(routes), 'POST /catalogs/:id/campaign registrado');
    const body = (routes.match(/app\.post\('\/api\/ads\/catalogs\/:catalogId\/campaign'[\s\S]*?\n  }\);/) || [''])[0];
    ok(/killSwitchActive/.test(body), 'respeita kill switch (Pausar tudo)');
    ok(/isDryRun/.test(body), 'respeita Modo teste (dry-run)');
    ok(/NOT_SYNCED/.test(body), 'exige catálogo já sincronizado (tiktokCatalogId + bcId)');
    ok(/createCatalogCampaign/.test(body), 'chama o composto do provider');
    ok(/auditSimulated/.test(body), 'dry-run audita a simulação');
    // interesses (Parte A, leitura)
    ok(/app\.get\('\/api\/ads\/targeting\/interests'/.test(routes), 'GET /targeting/interests registrado');
    ok(/listInterestCategories/.test(routes), 'rota de interesses chama o provider');
  }

  console.log('\nads-catalog-campaign: ' + n + ' asserts OK');
})().catch((e) => { console.error(e); process.exit(1); });
