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
  let seen = [];
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
    seen = catalogs;
    found = catalogs.find((catalog) => catalog.id === catalogId) || null;
    // Algumas respostas atuais de get_tiktok_catalogs voltam vazias mesmo
    // quando o endpoint de overview enxerga o mesmo catálogo no BC. Antes de
    // recriar um catálogo remoto já existente, usamos esse segundo endpoint
    // como prova somente quando ele ecoa o catalog_id solicitado.
    if (!found && typeof provider.getTikTokCatalogOverview === 'function') {
      try {
        const overview = await provider.getTikTokCatalogOverview(bcId, catalogId);
        const raw = overview && overview.raw;
        const overviewId = String(deepValue(raw, ['catalog_id', 'catalogId', 'id'], 0) || '');
        if (overviewId === catalogId) {
          found = {
            id: catalogId,
            name: '',
            currency: '',
            country: '',
            catalogType: '',
            productCount: Number(overview && overview.total) || 0,
          };
        }
      } catch (_) {
        // A lista continua sendo a fonte principal. Falha de overview não
        // transforma um vínculo inexistente em válido.
      }
    }
    if (!found && attempt < attempts - 1 && delayMs) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  if (!found) {
    // Diagnóstico acionável: quantos catálogos o token enxergou neste BC muda
    // o motivo. Zero = o token/BC não têm acesso um ao outro (o BC está errado
    // ou o token do Pipeboard não é do mesmo Business Center). Alguns visíveis
    // = o Catalog ID informado é que está errado (ou é de outro BC).
    const visibleIds = seen.map((c) => c.id).filter(Boolean);
    const zero = visibleIds.length === 0;
    const userMessage = zero
      ? 'O Business Center ' + bcId + ' não devolveu nenhum catálogo — confirme se esse é o Business Center do catálogo e se o token do Pipeboard tem acesso a ele.'
      : 'O catálogo ' + catalogId + ' não está no Business Center ' + bcId + ' (vi ' + visibleIds.length + ' catálogo(s) nele). Confira se o Catalog ID e o Business Center são do mesmo par.';
    throw catalogError('CATALOG_NOT_FOUND_IN_BC', userMessage, {
      status: 422, retryable: false,
      suggestedAction: zero
        ? 'Ajuste o Business Center (aba Catálogo → Business Center) para o mesmo do catálogo, ou peça acesso do token a esse BC.'
        : 'Confira o Catalog ID no TikTok Catalog Manager — ele precisa ser do Business Center ' + bcId + '.',
      createdIds: null,
    });
  }
  return found;
}

async function capabilities(provider) {
  if (provider && typeof provider.getCatalogCapabilities === 'function') {
    return provider.getCatalogCapabilities();
  }
  return {
    // Fallback conservador para providers antigos: leitura/upload podem ser
    // inferidos pelo método, mas criar catálogo/campanha exige schema remoto.
    catalogCreate: false,
    catalogUpload: typeof provider.uploadTikTokCatalogProducts === 'function',
    catalogAudit: typeof provider.getTikTokCatalogOverview === 'function',
    catalogFeedRead: typeof provider.getTikTokCatalogFeeds === 'function',
    catalogLinkVerify: typeof provider.listTikTokCatalogs === 'function',
    manualCatalogCampaign: false,
    productSets: false,
    catalogVideoTemplates: false,
    note: 'A criação só é liberada depois de confirmar os campos nos schemas atuais do Pipeboard.',
  };
}

module.exports = { normalizeRemoteCatalog, verifyCatalogLink, capabilities };
