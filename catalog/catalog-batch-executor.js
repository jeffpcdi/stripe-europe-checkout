'use strict';

// Executor puro para um plano já normalizado por catalog-batch-domain. Ele não
// importa store, provider ou worker: cada efeito é recebido por injeção para
// manter o lote testável e para que a rota escolha a persistência apropriada.

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

const MAX_CONCURRENCY = 8;

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function text(value, maxLength) {
  const out = value == null ? '' : String(value).trim();
  return maxLength ? out.slice(0, maxLength) : out;
}

function clone(value, depth) {
  const remaining = depth == null ? 12 : depth;
  if (remaining < 1 || value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => clone(item, remaining - 1));
  const out = {};
  for (const key of Object.keys(value)) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') continue;
    out[key] = clone(value[key], remaining - 1);
  }
  return out;
}

function executionIssue(code, message, field) {
  const out = { code, message };
  if (field) out.field = field;
  return out;
}

function failureFrom(error, stage) {
  const value = error || {};
  return {
    stage,
    code: text(value.code, 120) || 'CATALOG_BATCH_EXECUTION_FAILED',
    message: text(value.userMessage || value.message, 500) || 'A execução do lote falhou.',
  };
}

function positiveInteger(value, fallback, max) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number) || number < 1) return fallback;
  return Math.min(number, max);
}

function normalizeOptions(value) {
  const input = isRecord(value) ? value : {};
  return {
    accountId: text(input.accountId, 160),
    advertiserId: text(input.advertiserId, 160),
    batchId: text(input.batchId, 160),
    metadata: clone(isRecord(input.metadata) ? input.metadata : {}),
    concurrency: positiveInteger(input.concurrency, 2, MAX_CONCURRENCY),
    queueSync: input.queueSync === true,
    queueCampaigns: input.queueCampaigns === true,
  };
}

function sourcePlan(input) {
  if (isRecord(input) && isRecord(input.plan)) return input.plan;
  return input;
}

function isManualUrlField(key) {
  return AD_LEVEL_URL_FIELD_KEYS.has(String(key || '').replace(/[_-]/g, '').toLowerCase());
}

function findManualUrlFields(value, path, output) {
  const found = output || [];
  const stack = [{ value, path: path || '' }];
  const seen = new WeakSet();
  while (stack.length) {
    const current = stack.pop();
    const source = current && current.value;
    if (!source || typeof source !== 'object' || seen.has(source)) continue;
    seen.add(source);
    const prefix = current.path || '';
    for (const key of Object.keys(source)) {
      if (key === '__proto__' || key === 'prototype' || key === 'constructor') continue;
      const nextPath = prefix ? prefix + '.' + key : key;
      if (isManualUrlField(key)) {
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

// Mesmo recebendo um plano de uma fonte já validada, o executor mantém esta
// barreira. Assim uma URL manual nunca chega ao adaptador que cria anúncios.
function validateCampaign(campaign) {
  const errors = [];
  if (!isRecord(campaign)) {
    return [executionIssue('CAMPAIGN_OBJECT_REQUIRED', 'A campanha do lote deve ser um objeto JSON.')];
  }
  for (const found of findManualUrlFields(campaign, '', [], 0)) {
    errors.push(executionIssue(
      'CAMPAIGN_AD_LEVEL_URL_FORBIDDEN',
      'Campanhas de catálogo usam Product Link; não informe URL manual no nível do anúncio.',
      found.path,
    ));
  }
  const destination = text(campaign.destination, 64).toUpperCase();
  if (destination && destination !== 'PRODUCT_LINK') {
    errors.push(executionIssue(
      'CAMPAIGN_PRODUCT_LINK_REQUIRED',
      'A campanha de catálogo deve usar Product Link como destino.',
      'destination',
    ));
  }
  return errors;
}

function safeCampaign(campaign) {
  const out = clone(campaign);
  out.destination = 'PRODUCT_LINK';
  return out;
}

function validateCatalog(catalog) {
  const errors = [];
  if (!isRecord(catalog)) {
    return [executionIssue('CATALOG_OBJECT_REQUIRED', 'O catálogo do lote deve ser um objeto JSON.')];
  }
  if (!text(catalog.key, 120)) errors.push(executionIssue('CATALOG_KEY_REQUIRED', 'Informe a key do catálogo.', 'key'));
  if (!text(catalog.name, 200)) errors.push(executionIssue('CATALOG_NAME_REQUIRED', 'Informe o nome do catálogo.', 'name'));
  if (catalog.products != null && !Array.isArray(catalog.products)) {
    errors.push(executionIssue('CATALOG_PRODUCTS_ARRAY_REQUIRED', 'products deve ser uma lista.', 'products'));
  }
  if (catalog.campaigns != null && !Array.isArray(catalog.campaigns)) {
    errors.push(executionIssue('CATALOG_CAMPAIGNS_ARRAY_REQUIRED', 'campaigns deve ser uma lista.', 'campaigns'));
  }
  if (Array.isArray(catalog.products)) {
    catalog.products.forEach((product, index) => {
      if (!isRecord(product) || !isRecord(product.data)) {
        errors.push(executionIssue('PRODUCT_DATA_OBJECT_REQUIRED', 'Cada produto precisa conter data como objeto JSON.', 'products[' + index + '].data'));
      }
    });
  }
  if (Array.isArray(catalog.campaigns)) {
    catalog.campaigns.forEach((campaign, index) => {
      for (const error of validateCampaign(campaign)) {
        errors.push({ ...error, field: 'campaigns[' + index + ']' + (error.field ? '.' + error.field : '') });
      }
    });
  }
  return errors;
}

function validateDependencies(dependencies, plan, options) {
  const deps = isRecord(dependencies) ? dependencies : {};
  if (typeof deps.createCatalog !== 'function') throw new TypeError('createCatalog deve ser uma função.');
  if (typeof deps.upsertProduct !== 'function') throw new TypeError('upsertProduct deve ser uma função.');
  const catalogs = Array.isArray(plan.catalogs) ? plan.catalogs : [];
  const hasCampaign = catalogs.some((catalog) => isRecord(catalog) && Array.isArray(catalog.campaigns) && catalog.campaigns.length > 0);
  if (options.queueSync && typeof deps.enqueueSync !== 'function') throw new TypeError('enqueueSync deve ser uma função quando queueSync está ativo.');
  if (options.queueCampaigns && hasCampaign && typeof deps.enqueueCampaign !== 'function') {
    throw new TypeError('enqueueCampaign deve ser uma função quando queueCampaigns está ativo.');
  }
  return deps;
}

function catalogInput(catalog) {
  return {
    name: text(catalog.name, 200),
    currency: text(catalog.currency || 'BRL', 8).toUpperCase() || 'BRL',
    country: text(catalog.country || 'BR', 4).toUpperCase() || 'BR',
    catalogType: text(catalog.catalogType || 'ECOM', 64).toUpperCase() || 'ECOM',
  };
}

function productSku(product) {
  return text(product && product.data && product.data.sku_id, 120);
}

function publicResource(value) {
  if (typeof value === 'string' || typeof value === 'number') return { id: String(value) };
  return isRecord(value) ? clone(value) : null;
}

function makeBaseContext(options, catalog, catalogIndex) {
  return {
    accountId: options.accountId,
    advertiserId: options.advertiserId,
    batchId: options.batchId,
    metadata: clone(options.metadata),
    catalogKey: text(catalog.key, 120),
    catalogIndex,
  };
}

function makeResult(catalog) {
  const products = Array.isArray(catalog.products) ? catalog.products : [];
  const campaigns = Array.isArray(catalog.campaigns) ? catalog.campaigns : [];
  return {
    key: text(catalog && catalog.key, 120),
    name: text(catalog && catalog.name, 200),
    status: 'pending',
    validationErrors: [],
    error: null,
    catalog: null,
    products: {
      total: products.length,
      upserted: 0,
      failed: 0,
      skipped: 0,
      results: [],
    },
    sync: { requested: false, status: 'not_requested', run: null, error: null },
    campaigns: {
      requested: false,
      total: campaigns.length,
      queued: 0,
      failed: 0,
      skipped: 0,
      results: [],
    },
  };
}

function skipProducts(result, products, fromIndex) {
  for (let index = fromIndex; index < products.length; index++) {
    result.products.skipped += 1;
    result.products.results.push({
      index,
      skuId: productSku(products[index]),
      status: 'skipped',
      reason: 'CATALOG_STOPPED_AFTER_ERROR',
    });
  }
}

function skipCampaigns(result, campaigns, fromIndex) {
  for (let index = fromIndex; index < campaigns.length; index++) {
    result.campaigns.skipped += 1;
    result.campaigns.results.push({
      index,
      name: text(campaigns[index] && campaigns[index].name, 160),
      status: 'skipped',
      reason: 'CATALOG_STOPPED_AFTER_ERROR',
    });
  }
}

async function executeOne(catalog, catalogIndex, deps, options) {
  const safeCatalog = isRecord(catalog) ? clone(catalog) : catalog;
  const result = makeResult(safeCatalog || {});
  const validationErrors = validateCatalog(safeCatalog);
  if (validationErrors.length) {
    result.status = 'failed';
    result.validationErrors = validationErrors;
    result.error = { stage: 'validation', ...validationErrors[0] };
    skipProducts(result, Array.isArray(safeCatalog && safeCatalog.products) ? safeCatalog.products : [], 0);
    skipCampaigns(result, Array.isArray(safeCatalog && safeCatalog.campaigns) ? safeCatalog.campaigns : [], 0);
    return result;
  }

  const products = safeCatalog.products || [];
  const campaigns = safeCatalog.campaigns || [];
  const context = makeBaseContext(options, safeCatalog, catalogIndex);
  let createdCatalog;

  try {
    createdCatalog = await deps.createCatalog({ ...context, stage: 'create_catalog' }, catalogInput(safeCatalog));
    if (createdCatalog == null) {
      const error = new Error('A criação local do catálogo não retornou um catálogo.');
      error.code = 'CATALOG_CREATE_EMPTY_RESULT';
      throw error;
    }
    result.catalog = publicResource(createdCatalog);
  } catch (error) {
    result.status = 'failed';
    result.error = failureFrom(error, 'create_catalog');
    skipProducts(result, products, 0);
    skipCampaigns(result, campaigns, 0);
    return result;
  }

  for (let index = 0; index < products.length; index++) {
    const product = clone(products[index]);
    try {
      const saved = await deps.upsertProduct(
        { ...context, stage: 'upsert_product', productIndex: index },
        createdCatalog,
        product,
      );
      result.products.upserted += 1;
      result.products.results.push({ index, skuId: productSku(product), status: 'upserted', product: publicResource(saved) });
    } catch (error) {
      result.status = 'failed';
      result.products.failed += 1;
      result.products.results.push({ index, skuId: productSku(product), status: 'failed', error: failureFrom(error, 'upsert_product') });
      result.error = failureFrom(error, 'upsert_product');
      skipProducts(result, products, index + 1);
      skipCampaigns(result, campaigns, 0);
      return result;
    }
  }

  let syncRun = null;
  if (options.queueSync) {
    result.sync.requested = true;
    result.sync.status = 'queuing';
    try {
      syncRun = await deps.enqueueSync(
        { ...context, stage: 'enqueue_sync' },
        createdCatalog,
        { catalog: catalogInput(safeCatalog), products: clone(products) },
      );
      result.sync.status = 'queued';
      result.sync.run = publicResource(syncRun);
    } catch (error) {
      result.status = 'failed';
      result.sync.status = 'failed';
      result.sync.error = failureFrom(error, 'enqueue_sync');
      result.error = result.sync.error;
      skipCampaigns(result, campaigns, 0);
      return result;
    }
  }

  if (options.queueCampaigns) {
    result.campaigns.requested = true;
    for (let index = 0; index < campaigns.length; index++) {
      const campaign = safeCampaign(campaigns[index]);
      try {
        const run = await deps.enqueueCampaign(
          { ...context, stage: 'enqueue_campaign', campaignIndex: index, syncRun: publicResource(syncRun) },
          createdCatalog,
          campaign,
          { syncRun },
        );
        result.campaigns.queued += 1;
        result.campaigns.results.push({
          index,
          name: text(campaign.name, 160),
          status: 'queued',
          run: publicResource(run),
        });
      } catch (error) {
        result.status = 'failed';
        result.campaigns.failed += 1;
        result.campaigns.results.push({
          index,
          name: text(campaign.name, 160),
          status: 'failed',
          error: failureFrom(error, 'enqueue_campaign'),
        });
        result.error = failureFrom(error, 'enqueue_campaign');
        skipCampaigns(result, campaigns, index + 1);
        return result;
      }
    }
  } else {
    skipCampaigns(result, campaigns, 0);
  }

  result.status = 'completed';
  return result;
}

function makeSummary(results, options) {
  const sum = (selector) => results.reduce((total, item) => total + selector(item), 0);
  return {
    concurrency: options.concurrency,
    catalogs: {
      total: results.length,
      completed: results.filter((item) => item.status === 'completed').length,
      failed: results.filter((item) => item.status === 'failed').length,
    },
    products: {
      total: sum((item) => item.products.total),
      upserted: sum((item) => item.products.upserted),
      failed: sum((item) => item.products.failed),
      skipped: sum((item) => item.products.skipped),
    },
    sync: {
      requested: results.filter((item) => item.sync.requested).length,
      queued: results.filter((item) => item.sync.status === 'queued').length,
      failed: results.filter((item) => item.sync.status === 'failed').length,
    },
    campaigns: {
      total: sum((item) => item.campaigns.total),
      queued: sum((item) => item.campaigns.queued),
      failed: sum((item) => item.campaigns.failed),
      skipped: sum((item) => item.campaigns.skipped),
    },
  };
}

async function executeCatalogBatch(planInput, dependencies, optionsInput) {
  const plan = sourcePlan(planInput);
  const options = normalizeOptions(optionsInput);
  if (!isRecord(plan) || !Array.isArray(plan.catalogs)) {
    const error = executionIssue('CATALOGS_ARRAY_REQUIRED', 'O plano normalizado deve conter catalogs como lista.');
    return {
      ok: false,
      errors: [error],
      summary: makeSummary([], options),
      results: [],
    };
  }
  if (plan.catalogs.length === 0) {
    const error = executionIssue('CATALOGS_REQUIRED', 'Informe ao menos um catálogo no lote.');
    return {
      ok: false,
      errors: [error],
      summary: makeSummary([], options),
      results: [],
    };
  }
  const deps = validateDependencies(dependencies, plan, options);
  const catalogs = plan.catalogs.map((catalog) => clone(catalog));
  const results = new Array(catalogs.length);
  let nextIndex = 0;

  async function work() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= catalogs.length) return;
      results[index] = await executeOne(catalogs[index], index, deps, options);
    }
  }

  const workers = [];
  const workerCount = Math.min(options.concurrency, catalogs.length);
  for (let index = 0; index < workerCount; index++) workers.push(work());
  await Promise.all(workers);
  const summary = makeSummary(results, options);
  return {
    ok: summary.catalogs.failed === 0 && summary.catalogs.total > 0,
    errors: results.filter((item) => item.error).map((item) => ({ catalogKey: item.key, ...item.error })),
    summary,
    results,
  };
}

module.exports = {
  AD_LEVEL_URL_FIELDS,
  MAX_CONCURRENCY,
  normalizeOptions,
  validateCampaign,
  validateCatalog,
  executeCatalogBatch,
  execute: executeCatalogBatch,
  run: executeCatalogBatch,
};
