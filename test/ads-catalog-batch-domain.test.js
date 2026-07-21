'use strict';

const assert = require('assert');
const batch = require('../catalog/catalog-batch-domain');

let n = 0;
function ok(condition, label) {
  assert.ok(condition, label);
  n++;
  console.log('  ✓ ' + label);
}
function eq(actual, expected, label) {
  assert.strictEqual(actual, expected, label + ' → esperado ' + expected + ', veio ' + actual);
  n++;
  console.log('  ✓ ' + label);
}

function product(overrides) {
  return {
    sku_id: 'sku-1',
    title: 'Produto de teste',
    description: 'Descrição de teste',
    availability: 'in stock',
    condition: 'new',
    price: '19.90 BRL',
    link: 'https://loja.example/produto',
    image_link: 'https://cdn.example/produto.jpg',
    ...overrides,
  };
}

console.log('catalog-batch-domain — plano aninhado');
{
  const input = {
    catalogs: [{
      key: 'loja-br', name: 'Loja Brasil', currency: 'BRL', country: 'br', catalogType: 'product_catalog',
      products: [product()],
      campaigns: [{ name: 'Remarketing catálogo' }],
    }],
  };
  const result = batch.previewBatchPlan(input);
  eq(result.ok, true, 'lote aninhado válido');
  eq(result.summary.catalogs.valid, 1, 'catálogo válido');
  eq(result.summary.products.valid, 1, 'produto passa no validador do feed');
  eq(result.summary.campaigns.valid, 1, 'campanha sem URL manual é válida');
  eq(result.plan.catalogs[0].catalogType, 'ECOM', 'tipo legado é normalizado');
  eq(result.plan.catalogs[0].country, 'BR', 'país é normalizado');
  eq(result.plan.catalogs[0].campaigns[0].destination, 'PRODUCT_LINK', 'destino é sempre Product Link');
  eq(result.plan.catalogs[0].campaigns[0].productScope, 'all', 'escopo de produtos padrão é all');
  ok(!Object.prototype.hasOwnProperty.call(input.catalogs[0].campaigns[0], 'destination'), 'preview não altera a entrada');
}

console.log('catalog-batch-domain — listas separadas por catalogKey');
{
  const result = batch.validateAndNormalizeBatchPlan({
    catalogs: [{ key: 'separado', name: 'Separado', currency: 'BRL', country: 'BR' }],
    products: [{ catalogKey: 'SEPARADO', data: product({ sku_id: 'sku-separado' }) }],
    campaigns: [{ catalogKey: 'separado', data: { name: 'Campanha separada', productScope: 'specific', productIds: [' 42 '] } }],
  });
  eq(result.ok, true, 'catalogKey é resolvida sem diferenciar maiúsculas');
  eq(result.plan.catalogs[0].products.length, 1, 'produto separado entra no catálogo dono');
  eq(result.plan.catalogs[0].products[0].data.sku_id, 'sku-separado', 'payload data é preservado');
  eq(result.plan.catalogs[0].campaigns.length, 1, 'campanha separada entra no catálogo dono');
  eq(result.plan.catalogs[0].campaigns[0].productScope, 'specific', 'escopo explícito é preservado');
  assert.deepStrictEqual(result.plan.catalogs[0].campaigns[0].productIds, ['42']);
  n++; console.log('  ✓ IDs de produtos da campanha são normalizados');
}

console.log('catalog-batch-domain — erros por item');
{
  const result = batch.previewBatchPlan({
    catalogs: [
      { key: 'duplicado', name: 'A', currency: 'BRL' },
      { key: 'DUPLICADO', name: 'B', currency: 'BRL' },
      {
        key: 'erros', name: 'Erros', currency: 'BRL',
        products: [product({ availability: 'talvez', link: 'http://loja.example/sem-ssl' })],
        campaigns: [
          { name: 'camel', landingPageUrl: 'https://manual.example' },
          { name: 'snake', landing_page_url: 'https://manual.example' },
          { name: 'lista', landing_page_url_list: [{ landing_page_url: 'https://manual.example' }] },
          { name: 'legado', linkUrl: 'https://manual.example' },
          { name: 'destino', website_url: 'https://manual.example' },
          { name: 'aninhada', creative: { landing_page_url_list: [{ landing_page_url: 'https://manual.example' }] } },
          { name: 'deeplink', deep_link_url: 'https://manual.example' },
        ],
      },
    ],
  });
  eq(result.ok, false, 'erros tornam o preview inválido');
  ok(result.preview.catalogs[1].errors.some((error) => error.code === 'CATALOG_KEY_DUPLICATE'), 'key duplicada é apontada no catálogo duplicado');
  const invalidProduct = result.preview.catalogs[2].products[0];
  ok(invalidProduct.errors.some((error) => error.field === 'availability' && error.code === 'PRODUCT_FEED_INVALID'), 'erro do validateProduct aparece no produto');
  ok(invalidProduct.errors.some((error) => error.field === 'link' && error.code === 'PRODUCT_LINK_HTTPS_REQUIRED'), 'link HTTP é rejeitado explicitamente no batch');
  for (const field of ['landingPageUrl', 'landing_page_url', 'landing_page_url_list', 'linkUrl', 'website_url', 'deep_link_url']) {
    ok(result.preview.campaigns.some((campaign) => campaign.errors.some((error) => error.field === field && error.code === 'CAMPAIGN_AD_LEVEL_URL_FORBIDDEN')), field + ' é rejeitado como URL de anúncio');
  }
  ok(result.preview.campaigns.some((campaign) => campaign.errors.some((error) => error.field === 'creative.landing_page_url_list' && error.code === 'CAMPAIGN_AD_LEVEL_URL_FORBIDDEN')), 'URL aninhada é rejeitada já no preview');
  eq(result.plan.catalogs.find((catalog) => catalog.key === 'erros').products.length, 0, 'produto inválido não entra no plano seguro');
  eq(result.plan.catalogs.find((catalog) => catalog.key === 'erros').campaigns.length, 0, 'campanhas inválidas não entram no plano seguro');
}

console.log('catalog-batch-domain — URL profunda nunca passa para o plano seguro');
{
  const nested = {};
  let cursor = nested;
  for (let index = 0; index < 12; index += 1) {
    cursor.creative = {};
    cursor = cursor.creative;
  }
  cursor.external_url = 'https://manual.example/escondida';
  const result = batch.previewBatchPlan({
    catalogs: [{ key: 'profundo', name: 'Profundo', currency: 'BRL', products: [product()], campaigns: [{ name: 'Profunda', ...nested }] }],
  });
  eq(result.ok, false, 'campo manual além de oito níveis invalida o lote');
  ok(result.preview.campaigns[0].errors.some((error) => error.field === 'creative.creative.creative.creative.creative.creative.creative.creative.creative.creative.creative.creative.external_url'), 'caminho profundo aparece no preview');
  eq(result.plan.catalogs[0].campaigns.length, 0, 'campanha profunda não entra no plano seguro');
}

console.log('catalog-batch-domain — link ausente preserva as duas regras');
{
  const result = batch.preview({
    catalogs: [{ key: 'sem-link', name: 'Sem link', currency: 'BRL', products: [product({ link: '' })] }],
  });
  const errors = result.preview.products[0].errors;
  ok(errors.some((error) => error.field === 'link' && error.code === 'PRODUCT_FEED_INVALID'), 'validateProduct continua apontando link obrigatório');
  ok(errors.some((error) => error.field === 'link' && error.code === 'PRODUCT_LINK_HTTPS_REQUIRED'), 'regra adicional do lote exige HTTPS');
  eq(result.normalizedPlan, result.plan, 'normalizedPlan referencia o plano normalizado');
}

console.log('catalog-batch-domain — associação inválida');
{
  const result = batch.normalizeBatchPlan({
    catalogs: [{ key: 'conhecido', name: 'Conhecido', currency: 'BRL' }],
    products: [{ catalogKey: 'ausente', data: product() }],
    campaigns: [{ catalogKey: 'ausente', name: 'Sem catálogo' }],
  });
  eq(result.summary.products.invalid, 1, 'produto sem catálogo existente é inválido');
  eq(result.summary.campaigns.invalid, 1, 'campanha sem catálogo existente é inválida');
  ok(result.errors.some((error) => error.code === 'PRODUCT_CATALOG_KEY_NOT_FOUND'), 'erro agregado aponta produto órfão');
  ok(result.errors.some((error) => error.code === 'CAMPAIGN_CATALOG_KEY_NOT_FOUND'), 'erro agregado aponta campanha órfã');
}

console.log('\nads-catalog-batch-domain: ' + n + ' asserts OK');
