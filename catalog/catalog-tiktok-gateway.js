'use strict';

const { catalogError } = require('./catalog-domain');

function deepValue(value, keys, depth) {
  if (depth > 5 || value == null) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = deepValue(item, keys, depth + 1);
      if (found != null && found !== '') return found;
    }
    return null;
  }
  if (typeof value !== 'object') return null;
  for (const key of keys) {
    if (value[key] != null && value[key] !== '') return value[key];
  }
  for (const child of Object.values(value)) {
    const found = deepValue(child, keys, depth + 1);
    if (found != null && found !== '') return found;
  }
  return null;
}

function normalizeRemoteCatalog(raw) {
  const value = raw || {};
  return {
    id: String(deepValue(value, ['catalog_id', 'catalogId', 'id'], 0) || ''),
    name: String(deepValue(value, ['catalog_name', 'catalogName', 'name'], 0) || ''),
    currency: String(deepValue(value, ['currency'], 0) || '').toUpperCase(),
    country: String(deepValue(value, ['country', 'region'], 0) || '').toUpperCase(),
    catalogType: String(deepValue(value, ['catalog_type', 'catalogType', 'type'], 0) || '').toUpperCase(),
    productCount: Number(deepValue(value, ['product_count', 'total_products', 'total'], 0)) || 0,
  };
}

async function verifyCatalogLink(provider, input) {
  const bcId = String(input && input.bcId || '').trim();
  const catalogId = String(input && input.catalogId || '').trim();
  if (!/^\d{6,30}$/.test(bcId)) throw catalogError('INVALID_BC_ID', 'Informe um Business Center ID válido.');
  if (!/^\d{6,30}$/.test(catalogId)) throw catalogError('INVALID_CATALOG_ID', 'Informe um Catalog ID válido.');
  const attempts = Math.max(1, Math.min(5, Number(input && input.attempts) || 1));
  const delayMs = Math.max(0, Math.min(3000, Number(input && input.delayMs) || 0));
  let found = null;
  for (let attempt = 0; attempt < attempts && !found; attempt += 1) {
    let rows;
    try {
      rows = await provider.listTikTokCatalogs(bcId);
    } catch (cause) {
      throw catalogError('CATALOG_LINK_VERIFY_FAILED', 'Não foi possível consultar os catálogos deste Business Center.', {
        status: cause.status || 502, message: cause.message, retryable: true,
        suggestedAction: 'Confirme o Business Center e as permissões do token Pipeboard.',
      });
    }
    const catalogs = (Array.isArray(rows) ? rows : []).map(normalizeRemoteCatalog);
    found = catalogs.find((catalog) => catalog.id === catalogId) || null;
    if (!found && attempt < attempts - 1 && delayMs) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  if (!found) {
    throw catalogError('CATALOG_NOT_FOUND_IN_BC', 'O catálogo não foi encontrado neste Business Center.', {
      status: 422, retryable: false,
      suggestedAction: 'Confira o Catalog ID, o Business Center e se o token possui acesso aos dois.',
    });
  }
  return found;
}

function capabilities(provider) {
  return {
    catalogCreate: typeof provider.createTikTokCatalog === 'function',
    catalogUpload: typeof provider.uploadTikTokCatalogProducts === 'function',
    catalogAudit: typeof provider.getTikTokCatalogOverview === 'function',
    catalogLinkVerify: typeof provider.listTikTokCatalogs === 'function',
    manualCatalogCampaign: typeof provider.createCatalogCampaign === 'function',
    productSets: false,
    catalogVideoTemplates: false,
    note: 'Product sets e templates podem ser vinculados por ID; criação/listagem depende de novas tools do Pipeboard.',
  };
}

module.exports = { normalizeRemoteCatalog, verifyCatalogLink, capabilities };
