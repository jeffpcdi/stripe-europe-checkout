'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const domain = require('../catalog/catalog-domain');
const gateway = require('../catalog/catalog-tiktok-gateway');

let n = 0;
function ok(value, label) { assert.ok(value, label); n += 1; console.log('  ✓ ' + label); }
function eq(actual, expected, label) { assert.deepStrictEqual(actual, expected, label); n += 1; console.log('  ✓ ' + label); }
function throwsCode(fn, code, label) {
  try { fn(); ok(false, label + ' (deveria lançar)'); }
  catch (error) { eq(error.code, code, label); }
}

(async () => {
  console.log('Domínio — prontidão baseada em estados reais');
  const products = [{ valid: true, updatedAt: '2026-07-20T10:00:00.000Z' }];
  const base = {
    tiktokCatalogId: '7662123486130784016', bcId: '7550683248272228369',
    linkStatus: 'verified', linkError: null, syncedAt: '2026-07-20T11:00:00.000Z',
    updatedAt: '2026-07-20T11:00:00.000Z', audit: { approved: 1, pending: 0, rejected: 0 },
  };
  let readiness = domain.computeReadiness({}, [], {});
  eq(readiness.nextAction, 'add_products', 'catálogo vazio pede o primeiro produto');
  readiness = domain.computeReadiness({ ...base, tiktokCatalogId: null, bcId: null, linkStatus: 'unlinked', audit: null, syncedAt: null }, products, {});
  eq(readiness.nextAction, 'connect_tiktok', 'produto válido sem vínculo pede conexão');
  readiness = domain.computeReadiness(base, products, { advertiserId: '1870000000001' });
  ok(readiness.readyForCampaign, 'aprovado, verificado e com advertiser libera campanha');
  readiness = domain.computeReadiness(base, [{ ...products[0], updatedAt: '2026-07-20T12:00:00.000Z' }], { advertiserId: '1870000000001' });
  eq(readiness.nextAction, 'sync', 'edição posterior à publicação exige nova sincronização');
  ok(!readiness.readyForCampaign, 'alteração local bloqueia campanha até sincronizar');

  console.log('Domínio — contrato explícito da campanha');
  const input = {
    name: 'Catálogo manual', budgetAmount: 50, productScope: 'specific',
    productIds: ['7664730406680594184'], catalogVideoTemplateId: '4983c351template',
  };
  const spec = domain.normalizeCampaignSpec(input, { name: 'Loja', country: 'BR' });
  eq(spec.destination, 'PRODUCT_LINK', 'destino vem do produto, sem URL manual');
  eq(spec.creativeMode, 'CATALOG_VIDEO', 'criativo usa vídeo de catálogo');
  eq(spec.budgetOptimization, 'adgroup', 'ABO é o padrão');
  throwsCode(() => domain.normalizeCampaignSpec({ ...input, productIds: ['SKU-local'] }, {}), 'CATALOG_PRODUCT_ID_INVALID', 'não confunde SKU local com Product ID do TikTok');
  throwsCode(() => domain.normalizeCampaignSpec({ ...input, catalogVideoTemplateId: '' }, {}), 'CATALOG_VIDEO_TEMPLATE_REQUIRED', 'template de vídeo é pré-requisito explícito');

  console.log('Gateway — vínculo verificado contra o Business Center');
  const remote = await gateway.verifyCatalogLink({
    async listTikTokCatalogs() {
      return [{ catalog_id: '7662123486130784016', catalog_name: 'E-commerce catalog', currency: 'BRL', region: 'BR', product_count: 2 }];
    },
  }, { bcId: '7550683248272228369', catalogId: '7662123486130784016' });
  eq(remote.name, 'E-commerce catalog', 'normaliza o snapshot remoto');
  eq(remote.productCount, 2, 'preserva contagem remota');
  try {
    await gateway.verifyCatalogLink({ async listTikTokCatalogs() { return []; } }, { bcId: '7550683248272228369', catalogId: '7662123486130784016' });
    ok(false, 'catálogo ausente deveria falhar');
  } catch (error) {
    eq(error.code, 'CATALOG_NOT_FOUND_IN_BC', 'ID copiado não vira vínculo sem confirmação remota');
    eq(error.retryable, false, 'erro de ID/BC não é retry cego');
  }

  const blockedCapabilities = await gateway.capabilities({
    async getCatalogCapabilities() {
      return { catalogCreate: false, manualCatalogCampaign: false, catalogUpload: true };
    },
  });
  eq(blockedCapabilities.manualCatalogCampaign, false, 'capability real bloqueia campanha parcial');
  eq(blockedCapabilities.catalogCreate, false, 'capability real não promete criação sem catalog_conf');

  console.log('Persistência e UI — jobs retomáveis e componentes separados');
  const store = fs.readFileSync(path.join(__dirname, '..', 'ads-catalog-store.js'), 'utf8');
  ok(/CREATE TABLE IF NOT EXISTS ads_catalog_sync_runs/.test(store), 'schema contém jobs de sincronização');
  ok(/CREATE TABLE IF NOT EXISTS ads_catalog_campaign_runs/.test(store), 'schema contém jobs da hierarquia de campanha');
  ok(/FOR UPDATE SKIP LOCKED/.test(store), 'workers reivindicam jobs sem corrida');
  ok(/resumeSyncRun/.test(store) && /resumeCampaignRun/.test(store), 'falhas podem ser retomadas');
  const routes = fs.readFileSync(path.join(__dirname, '..', 'ads-routes.js'), 'utf8');
  ok(/campaign-preflight/.test(routes), 'preflight existe antes da escrita');
  ok(/CATALOG_CAMPAIGN_UNSUPPORTED/.test(routes), 'preflight bloqueia antes de criar hierarquia parcial');
  ok(/catalog-sync-runs\/:runId\/resume/.test(routes), 'sincronização falha tem endpoint de retomada');
  ok(/CATALOG_CAMPAIGN_NOT_CLEANABLE/.test(routes), 'cleanup não remove campanha concluída');
  const manager = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'components', 'ads', 'catalog-manager.tsx'), 'utf8');
  ok(/CatalogReadinessCard/.test(manager), 'UI usa checklist de prontidão');
  ok(/CatalogConnectionCard/.test(manager), 'UI separa conexão remota');
  ok(/CatalogCampaignWizard/.test(manager), 'UI usa assistente da campanha completa');
  ok(/campaignCreateSupported/.test(manager), 'UI condiciona criação ao schema atual do Pipeboard');
  ok(/DELETE FROM ads_catalog_campaign_runs/.test(store) && /DELETE FROM ads_catalog_publications/.test(store), 'exclusão remove jobs e publicações órfãos');
  ok(!/autoPublish=\{bcConfigured\}/.test(manager), 'salvar produto não publica silenciosamente');

  console.log('\nads-catalog-v2: ' + n + ' asserts OK');
})().catch((error) => { console.error(error); process.exit(1); });
