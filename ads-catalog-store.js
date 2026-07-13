const crypto = require('crypto');
const { neon } = require('@neondatabase/serverless');

const URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL || null;
const sql = URL ? neon(URL) : null;
const enabled = !!sql;

function id(prefix) {
  return prefix + crypto.randomUUID().replace(/-/g, '');
}

function cleanAccountId(value) {
  const accountId = String(value || '').trim();
  if (!accountId || accountId === '__all__') throw new Error('accountId específico é obrigatório');
  return accountId.slice(0, 120);
}

// Autocura de schema: mesmo padrão de ads-ops-store. As tabelas de catálogo
// precisam existir sempre que o app conectar (qualquer branch/banco). Roda no
// boot e é idempotente — CREATE TABLE IF NOT EXISTS nunca destrói dados.
let schemaReady = null;
async function ensureSchema() {
  if (!enabled) return false;
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    await sql`CREATE TABLE IF NOT EXISTS ads_catalogs (
      id text PRIMARY KEY,
      account_id text NOT NULL,
      name text NOT NULL,
      currency text NOT NULL DEFAULT 'USD',
      feed_blob_url text,
      feed_published_at timestamptz,
      product_count integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
    await sql`CREATE INDEX IF NOT EXISTS ads_catalogs_account_idx ON ads_catalogs (account_id, created_at DESC)`;
    await sql`CREATE TABLE IF NOT EXISTS ads_catalog_products (
      id text PRIMARY KEY,
      catalog_id text NOT NULL,
      account_id text NOT NULL,
      sku_id text NOT NULL,
      data jsonb NOT NULL DEFAULT '{}'::jsonb,
      valid boolean NOT NULL DEFAULT false,
      errors jsonb NOT NULL DEFAULT '[]'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (catalog_id, sku_id)
    )`;
    await sql`CREATE INDEX IF NOT EXISTS ads_catalog_products_catalog_idx ON ads_catalog_products (catalog_id, created_at DESC)`;
    console.log('[ads-catalog] schema verificado/criado');
    return true;
  })().catch((err) => {
    schemaReady = null;
    throw err;
  });
  return schemaReady;
}

function mapCatalog(row) {
  if (!row) return null;
  return {
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    currency: row.currency,
    feedUrl: row.feed_blob_url || null,
    feedPublishedAt: row.feed_published_at || null,
    productCount: Number(row.product_count) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapProduct(row) {
  if (!row) return null;
  return {
    id: row.id,
    catalogId: row.catalog_id,
    skuId: row.sku_id,
    data: row.data || {},
    valid: row.valid === true,
    errors: Array.isArray(row.errors) ? row.errors : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function listCatalogs(accountId) {
  accountId = cleanAccountId(accountId);
  if (!enabled) return [];
  await ensureSchema();
  const rows = await sql`SELECT id, account_id, name, currency, feed_blob_url, feed_published_at, product_count, created_at, updated_at
    FROM ads_catalogs WHERE account_id = ${accountId} ORDER BY created_at DESC`;
  return rows.map(mapCatalog);
}

async function getCatalog(accountId, catalogId) {
  accountId = cleanAccountId(accountId);
  if (!enabled) return null;
  await ensureSchema();
  const rows = await sql`SELECT id, account_id, name, currency, feed_blob_url, feed_published_at, product_count, created_at, updated_at
    FROM ads_catalogs WHERE account_id = ${accountId} AND id = ${String(catalogId || '')} LIMIT 1`;
  return mapCatalog(rows[0]);
}

async function createCatalog(accountId, input) {
  accountId = cleanAccountId(accountId);
  if (!enabled) throw new Error('Persistência Neon indisponível');
  await ensureSchema();
  const value = input || {};
  const name = String(value.name || '').trim().slice(0, 200);
  if (!name) throw new Error('Nome do catálogo obrigatório');
  const currency = String(value.currency || 'USD').trim().toUpperCase().slice(0, 8) || 'USD';
  const catalogId = id('cat_');
  const rows = await sql`INSERT INTO ads_catalogs (id, account_id, name, currency)
    VALUES (${catalogId}, ${accountId}, ${name}, ${currency})
    RETURNING id, account_id, name, currency, feed_blob_url, feed_published_at, product_count, created_at, updated_at`;
  return mapCatalog(rows[0]);
}

async function updateCatalog(accountId, catalogId, input) {
  accountId = cleanAccountId(accountId);
  if (!enabled) throw new Error('Persistência Neon indisponível');
  await ensureSchema();
  const value = input || {};
  const existing = await getCatalog(accountId, catalogId);
  if (!existing) throw new Error('Catálogo não encontrado');
  const name = value.name != null ? String(value.name).trim().slice(0, 200) || existing.name : existing.name;
  const currency = value.currency != null ? (String(value.currency).trim().toUpperCase().slice(0, 8) || existing.currency) : existing.currency;
  const rows = await sql`UPDATE ads_catalogs SET name = ${name}, currency = ${currency}, updated_at = now()
    WHERE account_id = ${accountId} AND id = ${String(catalogId)}
    RETURNING id, account_id, name, currency, feed_blob_url, feed_published_at, product_count, created_at, updated_at`;
  return mapCatalog(rows[0]);
}

async function deleteCatalog(accountId, catalogId) {
  accountId = cleanAccountId(accountId);
  if (!enabled) return false;
  await ensureSchema();
  await sql`DELETE FROM ads_catalog_products WHERE account_id = ${accountId} AND catalog_id = ${String(catalogId)}`;
  await sql`DELETE FROM ads_catalogs WHERE account_id = ${accountId} AND id = ${String(catalogId)}`;
  return true;
}

async function listProducts(accountId, catalogId) {
  accountId = cleanAccountId(accountId);
  if (!enabled) return [];
  await ensureSchema();
  const rows = await sql`SELECT id, catalog_id, sku_id, data, valid, errors, created_at, updated_at
    FROM ads_catalog_products WHERE account_id = ${accountId} AND catalog_id = ${String(catalogId || '')}
    ORDER BY created_at ASC`;
  return rows.map(mapProduct);
}

// Grava a contagem de produtos no catálogo pai — mantém a lista consistente
// sem uma segunda consulta a cada leitura.
async function refreshProductCount(accountId, catalogId) {
  const rows = await sql`SELECT count(*)::int AS n FROM ads_catalog_products WHERE account_id = ${accountId} AND catalog_id = ${String(catalogId)}`;
  const n = (rows[0] && rows[0].n) || 0;
  await sql`UPDATE ads_catalogs SET product_count = ${n}, updated_at = now() WHERE account_id = ${accountId} AND id = ${String(catalogId)}`;
  return n;
}

// Upsert de um produto. `validate` é injetado pelo chamador (ads-catalog-feed)
// para não acoplar o store à lógica de validação.
async function upsertProduct(accountId, catalogId, product, validate) {
  accountId = cleanAccountId(accountId);
  if (!enabled) throw new Error('Persistência Neon indisponível');
  await ensureSchema();
  const catalog = await getCatalog(accountId, catalogId);
  if (!catalog) throw new Error('Catálogo não encontrado');
  const data = (product && product.data) || {};
  const skuId = String(data.sku_id || (product && product.skuId) || '').trim().slice(0, 100);
  if (!skuId) throw new Error('sku_id obrigatório');
  data.sku_id = skuId;
  const result = typeof validate === 'function' ? validate(data, catalog) : { valid: true, errors: [] };
  const rows = await sql`INSERT INTO ads_catalog_products (id, catalog_id, account_id, sku_id, data, valid, errors)
    VALUES (${id('prod_')}, ${catalogId}, ${accountId}, ${skuId}, ${JSON.stringify(data)}, ${result.valid}, ${JSON.stringify(result.errors)})
    ON CONFLICT (catalog_id, sku_id) DO UPDATE SET
      data = EXCLUDED.data, valid = EXCLUDED.valid, errors = EXCLUDED.errors, updated_at = now()
    RETURNING id, catalog_id, sku_id, data, valid, errors, created_at, updated_at`;
  await refreshProductCount(accountId, catalogId);
  return mapProduct(rows[0]);
}

// Importa muitos produtos de uma vez (CSV). Revalida cada linha e devolve o
// resumo. Usa upsert por SKU — reimportar atualiza em vez de duplicar.
async function bulkUpsertProducts(accountId, catalogId, products, validate) {
  accountId = cleanAccountId(accountId);
  if (!enabled) throw new Error('Persistência Neon indisponível');
  await ensureSchema();
  const catalog = await getCatalog(accountId, catalogId);
  if (!catalog) throw new Error('Catálogo não encontrado');
  let imported = 0;
  let validCount = 0;
  const skipped = [];
  for (const product of products || []) {
    const data = (product && product.data) || product || {};
    const skuId = String(data.sku_id || '').trim().slice(0, 100);
    if (!skuId) { skipped.push({ reason: 'sku_id ausente' }); continue; }
    data.sku_id = skuId;
    const result = typeof validate === 'function' ? validate(data, catalog) : { valid: true, errors: [] };
    await sql`INSERT INTO ads_catalog_products (id, catalog_id, account_id, sku_id, data, valid, errors)
      VALUES (${id('prod_')}, ${catalogId}, ${accountId}, ${skuId}, ${JSON.stringify(data)}, ${result.valid}, ${JSON.stringify(result.errors)})
      ON CONFLICT (catalog_id, sku_id) DO UPDATE SET
        data = EXCLUDED.data, valid = EXCLUDED.valid, errors = EXCLUDED.errors, updated_at = now()`;
    imported += 1;
    if (result.valid) validCount += 1;
  }
  await refreshProductCount(accountId, catalogId);
  return { imported, valid: validCount, invalid: imported - validCount, skipped };
}

async function deleteProduct(accountId, catalogId, productId) {
  accountId = cleanAccountId(accountId);
  if (!enabled) return false;
  await ensureSchema();
  await sql`DELETE FROM ads_catalog_products WHERE account_id = ${accountId} AND catalog_id = ${String(catalogId)} AND id = ${String(productId)}`;
  await refreshProductCount(accountId, catalogId);
  return true;
}

async function setFeedUrl(accountId, catalogId, feedUrl) {
  accountId = cleanAccountId(accountId);
  if (!enabled) throw new Error('Persistência Neon indisponível');
  await ensureSchema();
  const rows = await sql`UPDATE ads_catalogs SET feed_blob_url = ${String(feedUrl || '')}, feed_published_at = now(), updated_at = now()
    WHERE account_id = ${accountId} AND id = ${String(catalogId)}
    RETURNING id, account_id, name, currency, feed_blob_url, feed_published_at, product_count, created_at, updated_at`;
  return mapCatalog(rows[0]);
}

module.exports = {
  enabled,
  ensureSchema,
  cleanAccountId,
  listCatalogs,
  getCatalog,
  createCatalog,
  updateCatalog,
  deleteCatalog,
  listProducts,
  upsertProduct,
  bulkUpsertProducts,
  deleteProduct,
  setFeedUrl
};
