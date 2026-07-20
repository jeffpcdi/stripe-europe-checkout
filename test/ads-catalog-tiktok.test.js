'use strict';
/*
 * ads-provider (catálogos) — camada que cria/sobe catálogos no TikTok via
 * Pipeboard. As tools de catálogo exigem bc_id e URLs públicas; validar isso
 * ANTES de chamar a rede evita erros crus do TikTok e chamadas desperdiçadas.
 * Este teste cobre só os caminhos puros/validação (nenhuma chamada MCP real).
 */
const assert = require('assert');
const provider = require('../ads-provider');

let n = 0;
function ok(cond, label) { assert.ok(cond, label); n++; console.log('  ✓ ' + label); }
function eq(a, b, label) { assert.strictEqual(a, b, label + ' → esperado ' + b + ', veio ' + a); n++; console.log('  ✓ ' + label); }

async function throws(fn, status, label) {
  try { await fn(); ok(false, label + ' (deveria lançar)'); }
  catch (e) { eq(e.status, status, label); }
}

console.log('CATALOG_TYPES — enum do TikTok');
{
  ok(Array.isArray(provider.CATALOG_TYPES), 'é um array');
  ok(provider.CATALOG_TYPES.includes('ECOM'), 'inclui ECOM (e-commerce)');
  ok(!provider.CATALOG_TYPES.includes('PRODUCT_CATALOG'), 'não usa mais o legado PRODUCT_CATALOG');
}

console.log('Business Center — persistência por conta');
{
  eq(provider.getBusinessCenterId('cat-test-acc'), '', 'conta nova não tem BC');
  provider.setBusinessCenterId('cat-test-acc', '  7012345678901234567  ');
  eq(provider.getBusinessCenterId('cat-test-acc'), '7012345678901234567', 'BC salvo e com trim');
  eq(provider.businessCenterFromEnv('cat-test-acc'), false, 'não veio do env (a conta gravou o seu)');
  // contas são isoladas
  eq(provider.getBusinessCenterId('cat-test-outra'), '', 'BC é por conta (não vaza)');
}

console.log('createTikTokCatalog — validação antes da rede');
(async () => {
  await throws(() => provider.createTikTokCatalog('', { name: 'Loja' }), 422, 'sem bc_id → 422');
  await throws(() => provider.createTikTokCatalog('7012345678901234567', { name: '' }), 400, 'sem nome → 400');

  console.log('uploadTikTokCatalogProducts — exige args e URL https pública');
  await throws(() => provider.uploadTikTokCatalogProducts('', 'cat1', 'https://x/f.csv'), 400, 'sem bc/catalog → 400');
  await throws(() => provider.uploadTikTokCatalogProducts('7012345678901234567', 'cat1', 'ftp://x/f.csv'), 400, 'URL não-https → 400');

  console.log('getTikTokCatalogOverview — exige bc_id e catalog_id');
  await throws(() => provider.getTikTokCatalogOverview('', ''), 400, 'sem ids → 400');

  console.log('\nads-catalog-tiktok: ' + n + ' asserts OK');
})().catch((e) => { console.error(e); process.exit(1); });
