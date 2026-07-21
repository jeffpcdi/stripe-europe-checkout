'use strict';

// Pré-validação pura de um lote de catálogos. Este módulo não cria entidades,
// não consulta a rede e não conhece banco: ele apenas prepara um plano seguro
// para a camada que eventualmente fará a persistência ou o enfileiramento.
const catalogFeed = require('../ads-catalog-feed');

const CATALOG_TYPES = Object.freeze([
  'ECOM', 'HOTEL', 'FLIGHT', 'AUTO_VEHICLE', 'AUTO_MODEL', 'COMIC',
  'DESTINATION', 'ENTERTAINMENT', 'HOME_LISTING', 'MINI_SERIES', 'RECRUITMENT',
]);
const LEGACY_CATALOG_TYPES = Object.freeze({
  PRODUCT_CATALOG: 'ECOM',
  HOTEL_CATALOG: 'HOTEL',
  FLIGHT_CATALOG: 'FLIGHT',
  VEHICLE_CATALOG: 'AUTO_VEHICLE',
});
// Mantido em sincronia com o executor. O preview deve apontar qualquer
// variação conhecida de URL do anúncio antes de o usuário clicar em criar.
const AD_LEVEL_URL_FIELDS = Object.freeze([
  'landingPageUrl',
  'landing_page_url',
  'landing_page_url_list',
  'landingUrl',
  'landing_url',
  'linkUrl',
  'link_url',
  'websiteUrl',
  'website_url',
  'destinationUrl',
  'destination_url',
  'externalUrl',
  'external_url',
  'clickUrl',
  'click_url',
  'redirectUrl',
  'redirect_url',
  'deeplink',
  'deep_link',
  'deeplink_url',
  'deep_link_url',
  'url',
  'link',
]);
const AD_LEVEL_URL_FIELD_KEYS = new Set(AD_LEVEL_URL_FIELDS.map((field) => field.replace(/[_-]/g, '').toLowerCase()));

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function text(value, maxLength) {
  const out = value == null ? '' : String(value).trim();
  return maxLength ? out.slice(0, maxLength) : out;
}

function canonicalKey(value) {
  return text(value, 120).toLowerCase();
}

function normalizeCatalogType(value) {
  const type = text(value, 64).toUpperCase();
  if (LEGACY_CATALOG_TYPES[type]) return LEGACY_CATALOG_TYPES[type];
  return CATALOG_TYPES.includes(type) ? type : 'ECOM';
}

function cloneData(value, excluded) {
  const source = isRecord(value) ? value : {};
  const omit = new Set(excluded || []);
  const out = {};
  for (const key of Object.keys(source)) {
    if (omit.has(key) || key === '__proto__' || key === 'prototype' || key === 'constructor') continue;
    const item = source[key];
    if (typeof item === 'string') out[key] = item.trim();
    else if (Array.isArray(item)) out[key] = item.slice();
    else if (isRecord(item)) out[key] = { ...item };
    else out[key] = item;
  }
  return out;
}

function isAdLevelUrlField(key) {
  return AD_LEVEL_URL_FIELD_KEYS.has(String(key || '').replace(/[_-]/g, '').toLowerCase());
}

// A planilha pode trazer objetos de criativo aninhados. Encontrar as chaves
// recursivamente permite explicar o erro no preview; o executor repete a
// mesma barreira imediatamente antes de qualquer efeito.
function findAdLevelUrlFields(value, path, output) {
  const found = output || [];
  const stack = [{ value, path: path || '' }];
  const seen = new WeakSet();
  // O payload HTTP é limitado pelo parser; ainda assim, usamos uma travessia
  // iterativa para não deixar uma URL manual escondida em objetos muito fundos
  // e para não estourar a pilha JavaScript em planos importados.
  while (stack.length) {
    const current = stack.pop();
    const source = current && current.value;
    if (!source || typeof source !== 'object' || seen.has(source)) continue;
    seen.add(source);
    const prefix = current.path || '';
    for (const key of Object.keys(source)) {
      if (key === '__proto__' || key === 'prototype' || key === 'constructor') continue;
      const nextPath = prefix ? prefix + '.' + key : key;
      if (isAdLevelUrlField(key)) {
        found.push({ field: key, path: nextPath });
        continue;
      }
      const child = source[key];
      if (child && typeof child === 'object') {
        if (Array.isArray(child)) {
          child.forEach((item, index) => stack.push({ value: item, path: nextPath + '[' + index + ']' }));
        } else {
          stack.push({ value: child, path: nextPath });
        }
      }
    }
  }
  return found;
}

function itemData(value, errors, kind) {
  if (!isRecord(value)) {
    errors.push(issue(kind + '_OBJECT_REQUIRED', 'O item deve ser um objeto JSON.'));
    return {};
  }
  if (hasOwn(value, 'data')) {
    if (!isRecord(value.data)) {
      errors.push(issue(kind + '_DATA_OBJECT_REQUIRED', 'O campo data deve ser um objeto JSON.'));
      return {};
    }
    return cloneData(value.data);
  }
  return cloneData(value, ['catalogKey', 'products', 'campaigns']);
}

function issue(code, message, field) {
  const out = { code, message };
  if (field) out.field = field;
  return out;
}

function isHttpsUrl(value) {
  const raw = text(value);
  if (!raw || /\s/.test(raw)) return false;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && !!url.hostname;
  } catch (_) {
    return false;
  }
}

function normalizeCatalog(value, index) {
  const errors = [];
  if (!isRecord(value)) {
    errors.push(issue('CATALOG_OBJECT_REQUIRED', 'O catálogo deve ser um objeto JSON.'));
    value = {};
  }

  const key = text(value.key, 120);
  if (!key) errors.push(issue('CATALOG_KEY_REQUIRED', 'Informe uma key única para o catálogo.', 'key'));
  const suppliedCurrency = text(value.currency, 8).toUpperCase();
  const currency = /^[A-Z]{3}$/.test(suppliedCurrency) ? suppliedCurrency : 'BRL';
  if (suppliedCurrency && !/^[A-Z]{3}$/.test(suppliedCurrency)) {
    errors.push(issue('CATALOG_CURRENCY_INVALID', 'A moeda deve usar o código ISO de três letras.', 'currency'));
  }

  if (hasOwn(value, 'products') && !Array.isArray(value.products)) {
    errors.push(issue('CATALOG_PRODUCTS_ARRAY_REQUIRED', 'products deve ser uma lista.', 'products'));
  }
  if (hasOwn(value, 'campaigns') && !Array.isArray(value.campaigns)) {
    errors.push(issue('CATALOG_CAMPAIGNS_ARRAY_REQUIRED', 'campaigns deve ser uma lista.', 'campaigns'));
  }

  const normalized = {
    key,
    name: text(value.name || key, 200),
    currency,
    country: text(value.country || 'BR', 4).toUpperCase(),
    catalogType: normalizeCatalogType(value.catalogType),
  };
  return {
    source: 'catalogs',
    path: 'catalogs[' + index + ']',
    index,
    key,
    canonicalKey: canonicalKey(key),
    errors,
    normalized,
    products: [],
    campaigns: [],
  };
}

function normalizeProduct(value, context) {
  context = context || {};
  const errors = [];
  const raw = isRecord(value) ? value : null;
  const catalogKey = context.catalogKey || text(raw && raw.catalogKey, 120);
  const data = itemData(value, errors, 'PRODUCT');

  if (!catalogKey) errors.push(issue('PRODUCT_CATALOG_KEY_REQUIRED', 'Informe catalogKey para associar o produto.', 'catalogKey'));
  if (!context.catalog) errors.push(issue('PRODUCT_CATALOG_KEY_NOT_FOUND', 'A key informada não corresponde a um catálogo do lote.', 'catalogKey'));

  // Mesmo produto órfão passa pelo validador do feed; assim o preview devolve
  // todos os problemas de conteúdo numa única tentativa, além da associação.
  const feedCatalog = (context.catalog && (context.catalog.normalized || context.catalog)) || { currency: 'BRL' };
  const feedCheck = catalogFeed.validateProduct(data, feedCatalog);
  for (const error of feedCheck.errors) {
    errors.push(issue('PRODUCT_FEED_INVALID', error.message, error.field));
  }

  if (!isHttpsUrl(data.link)) {
    errors.push(issue(
      'PRODUCT_LINK_HTTPS_REQUIRED',
      text(data.link) ? 'O link do produto deve usar URL https://.' : 'O link do produto é obrigatório e deve usar URL https://.',
      'link',
    ));
  }

  return {
    source: context.source,
    path: context.path,
    index: context.index,
    catalogKey,
    errors,
    normalized: { catalogKey, data },
    planItem: { data },
  };
}

function normalizeCampaign(value, context) {
  context = context || {};
  const errors = [];
  const raw = isRecord(value) ? value : null;
  const catalogKey = context.catalogKey || text(raw && raw.catalogKey, 120);
  const data = itemData(value, errors, 'CAMPAIGN');

  if (!catalogKey) errors.push(issue('CAMPAIGN_CATALOG_KEY_REQUIRED', 'Informe catalogKey para associar a campanha.', 'catalogKey'));
  if (!context.catalog) errors.push(issue('CAMPAIGN_CATALOG_KEY_NOT_FOUND', 'A key informada não corresponde a um catálogo do lote.', 'catalogKey'));

  const rootData = raw && isRecord(raw.data) ? cloneData(raw, ['data', 'catalogKey', 'products', 'campaigns']) : null;
  const urlSources = rootData ? [data, rootData] : [data];
  const seenUrlPaths = new Set();
  for (const source of urlSources) {
    for (const found of findAdLevelUrlFields(source, '', [], 0)) {
      if (seenUrlPaths.has(found.path)) continue;
      seenUrlPaths.add(found.path);
      const field = found.path;
      errors.push(issue(
        'CAMPAIGN_AD_LEVEL_URL_FORBIDDEN',
        'Campanhas de catálogo usam Product Link; não informe URL manual no nível do anúncio.',
        field,
      ));
    }
  }

  const normalized = cloneData(data, AD_LEVEL_URL_FIELDS);
  const requestedScope = text(normalized.productScope, 32).toLowerCase();
  normalized.productScope = ['all', 'product_set', 'specific'].includes(requestedScope) ? requestedScope : 'all';
  normalized.destination = 'PRODUCT_LINK';
  if (normalized.name != null) normalized.name = text(normalized.name, 120);
  if (normalized.country != null) normalized.country = text(normalized.country, 4).toUpperCase();
  else if (context.catalog) normalized.country = context.catalog.normalized.country;
  if (normalized.budgetAmount != null && text(normalized.budgetAmount)) {
    const budgetAmount = Number(normalized.budgetAmount);
    if (Number.isFinite(budgetAmount)) normalized.budgetAmount = budgetAmount;
  }
  if (Array.isArray(normalized.productIds)) {
    normalized.productIds = normalized.productIds.map((item) => text(item, 120)).filter(Boolean);
  }
  if (normalized.productSetId != null) normalized.productSetId = text(normalized.productSetId, 120);

  return {
    source: context.source,
    path: context.path,
    index: context.index,
    catalogKey,
    errors,
    normalized: { catalogKey, ...normalized },
    planItem: normalized,
  };
}

function itemPreview(item) {
  return {
    source: item.source,
    path: item.path,
    index: item.index,
    catalogKey: item.catalogKey,
    valid: item.errors.length === 0,
    errors: item.errors,
    normalized: item.normalized,
  };
}

function addAggregateErrors(target, item) {
  for (const error of item.errors) {
    target.push({
      ...error,
      path: item.path + (error.field ? '.' + error.field : ''),
      source: item.source,
      index: item.index,
      catalogKey: item.catalogKey || item.key || null,
    });
  }
}

function summaryFor(items) {
  const total = items.length;
  const valid = items.filter((item) => item.errors.length === 0).length;
  return { total, valid, invalid: total - valid };
}

// Aceita itens dentro de cada catálogo e também as listas de topo products e
// campaigns. A saída sempre organiza os itens válidos dentro do catálogo dono.
function previewBatchPlan(input) {
  const root = isRecord(input) ? input : {};
  const globalErrors = [];
  if (!isRecord(input)) globalErrors.push(issue('PLAN_OBJECT_REQUIRED', 'O plano deve ser um objeto JSON.'));
  if (!Array.isArray(root.catalogs)) globalErrors.push(issue('CATALOGS_ARRAY_REQUIRED', 'catalogs deve ser uma lista.'));
  if (hasOwn(root, 'products') && !Array.isArray(root.products)) globalErrors.push(issue('PRODUCTS_ARRAY_REQUIRED', 'products deve ser uma lista.'));
  if (hasOwn(root, 'campaigns') && !Array.isArray(root.campaigns)) globalErrors.push(issue('CAMPAIGNS_ARRAY_REQUIRED', 'campaigns deve ser uma lista.'));

  const rawCatalogs = Array.isArray(root.catalogs) ? root.catalogs : [];
  const catalogItems = rawCatalogs.map((catalog, index) => normalizeCatalog(catalog, index));
  const catalogByKey = new Map();
  for (const catalog of catalogItems) {
    if (!catalog.canonicalKey) continue;
    if (catalogByKey.has(catalog.canonicalKey)) {
      catalog.errors.push(issue('CATALOG_KEY_DUPLICATE', 'A key do catálogo deve ser única no lote.', 'key'));
      continue;
    }
    catalogByKey.set(catalog.canonicalKey, catalog);
  }

  const products = [];
  const campaigns = [];
  function targetFor(key) {
    return catalogByKey.get(canonicalKey(key)) || null;
  }
  function collectProduct(raw, source, path, index, catalogKey) {
    const catalog = targetFor(catalogKey || (isRecord(raw) && raw.catalogKey));
    const item = normalizeProduct(raw, {
      source, path, index, catalogKey: text(catalogKey || (isRecord(raw) && raw.catalogKey), 120), catalog,
    });
    products.push(item);
    if (catalog) catalog.products.push(item);
  }
  function collectCampaign(raw, source, path, index, catalogKey) {
    const catalog = targetFor(catalogKey || (isRecord(raw) && raw.catalogKey));
    const item = normalizeCampaign(raw, {
      source, path, index, catalogKey: text(catalogKey || (isRecord(raw) && raw.catalogKey), 120), catalog,
    });
    campaigns.push(item);
    if (catalog) catalog.campaigns.push(item);
  }

  for (const catalog of catalogItems) {
    const raw = isRecord(rawCatalogs[catalog.index]) ? rawCatalogs[catalog.index] : {};
    if (Array.isArray(raw.products)) {
      raw.products.forEach((product, index) => collectProduct(product, 'catalog.products', catalog.path + '.products[' + index + ']', index, catalog.key));
    }
    if (Array.isArray(raw.campaigns)) {
      raw.campaigns.forEach((campaign, index) => collectCampaign(campaign, 'catalog.campaigns', catalog.path + '.campaigns[' + index + ']', index, catalog.key));
    }
  }
  if (Array.isArray(root.products)) {
    root.products.forEach((product, index) => collectProduct(product, 'products', 'products[' + index + ']', index));
  }
  if (Array.isArray(root.campaigns)) {
    root.campaigns.forEach((campaign, index) => collectCampaign(campaign, 'campaigns', 'campaigns[' + index + ']', index));
  }

  const catalogPreview = catalogItems.map((catalog) => ({
    source: catalog.source,
    path: catalog.path,
    index: catalog.index,
    key: catalog.key,
    valid: catalog.errors.length === 0,
    errors: catalog.errors,
    normalized: catalog.normalized,
    products: catalog.products.map(itemPreview),
    campaigns: catalog.campaigns.map(itemPreview),
  }));
  const preview = {
    globalErrors,
    catalogs: catalogPreview,
    products: products.map(itemPreview),
    campaigns: campaigns.map(itemPreview),
  };

  const errors = globalErrors.map((error) => ({ ...error, path: null, source: 'plan', index: null, catalogKey: null }));
  for (const catalog of catalogItems) addAggregateErrors(errors, catalog);
  for (const product of products) addAggregateErrors(errors, product);
  for (const campaign of campaigns) addAggregateErrors(errors, campaign);

  const plan = {
    catalogs: catalogItems
      .filter((catalog) => catalog.errors.length === 0)
      .map((catalog) => ({
        ...catalog.normalized,
        products: catalog.products.filter((item) => item.errors.length === 0).map((item) => item.planItem),
        campaigns: catalog.campaigns.filter((item) => item.errors.length === 0).map((item) => item.planItem),
      })),
  };
  const summary = {
    catalogs: summaryFor(catalogItems),
    products: summaryFor(products),
    campaigns: summaryFor(campaigns),
    errors: errors.length,
    valid: errors.length === 0,
    normalizedCatalogs: plan.catalogs.length,
    normalizedProducts: plan.catalogs.reduce((sum, catalog) => sum + catalog.products.length, 0),
    normalizedCampaigns: plan.catalogs.reduce((sum, catalog) => sum + catalog.campaigns.length, 0),
  };

  return { ok: summary.valid, valid: summary.valid, errors, summary, preview, plan, normalizedPlan: plan };
}

module.exports = {
  CATALOG_TYPES,
  AD_LEVEL_URL_FIELDS,
  findAdLevelUrlFields,
  normalizeCatalogType,
  normalizeCatalog,
  normalizeProduct,
  normalizeCampaign,
  previewBatchPlan,
  preview: previewBatchPlan,
  validatePlan: previewBatchPlan,
  validateBatchPlan: previewBatchPlan,
  validateAndNormalizeBatchPlan: previewBatchPlan,
  normalizeBatchPlan: previewBatchPlan,
};
