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
    // Colunas do vínculo com o TikTok real (idempotentes — mesmo padrão do db.js).
    // catalog_type/country/currency são a config que o TikTok exige na criação do
    // catálogo; tiktok_catalog_id/bc_id gravam o catálogo criado na plataforma;
    // synced_at/audit guardam a última publicação e o resumo de auditoria dos
    // produtos (aprovados/pendentes/reprovados) para a UI mostrar "pronto p/ campanha".
    await sql`ALTER TABLE ads_catalogs ADD COLUMN IF NOT EXISTS catalog_type text NOT NULL DEFAULT 'ECOM'`;
    // Migra catálogos gravados com os tipos antigos (descontinuados pelo TikTok).
    await sql`UPDATE ads_catalogs SET catalog_type = 'ECOM' WHERE catalog_type = 'PRODUCT_CATALOG'`;
    await sql`UPDATE ads_catalogs SET catalog_type = 'HOTEL' WHERE catalog_type = 'HOTEL_CATALOG'`;
    await sql`UPDATE ads_catalogs SET catalog_type = 'FLIGHT' WHERE catalog_type = 'FLIGHT_CATALOG'`;
    await sql`UPDATE ads_catalogs SET catalog_type = 'AUTO_VEHICLE' WHERE catalog_type = 'VEHICLE_CATALOG'`;
    await sql`ALTER TABLE ads_catalogs ADD COLUMN IF NOT EXISTS country text`;
    await sql`ALTER TABLE ads_catalogs ADD COLUMN IF NOT EXISTS bc_id text`;
    await sql`ALTER TABLE ads_catalogs ADD COLUMN IF NOT EXISTS tiktok_catalog_id text`;
    await sql`ALTER TABLE ads_catalogs ADD COLUMN IF NOT EXISTS synced_at timestamptz`;
    await sql`ALTER TABLE ads_catalogs ADD COLUMN IF NOT EXISTS audit jsonb`;
    // V2: o vínculo remoto deixa de ser apenas dois IDs copiados. Guardamos o
    // resultado da verificação contra o Business Center e um snapshot mínimo
    // do catálogo encontrado no TikTok para detectar divergências.
    await sql`ALTER TABLE ads_catalogs ADD COLUMN IF NOT EXISTS link_status text NOT NULL DEFAULT 'unlinked'`;
    await sql`ALTER TABLE ads_catalogs ADD COLUMN IF NOT EXISTS link_verified_at timestamptz`;
    await sql`ALTER TABLE ads_catalogs ADD COLUMN IF NOT EXISTS link_error text`;
    await sql`ALTER TABLE ads_catalogs ADD COLUMN IF NOT EXISTS remote_snapshot jsonb`;
    // feed_token: token público e estável que compõe a URL do feed servida pelo
    // app (/feed/<token>.csv) — substitui a URL do Vercel Blob.
    await sql`ALTER TABLE ads_catalogs ADD COLUMN IF NOT EXISTS feed_token text`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS ads_catalogs_feed_token_idx ON ads_catalogs (feed_token) WHERE feed_token IS NOT NULL`;
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
    await sql`CREATE TABLE IF NOT EXISTS ads_catalog_publications (
      id text PRIMARY KEY,
      catalog_id text NOT NULL,
      account_id text NOT NULL,
      kind text NOT NULL,
      status text NOT NULL,
      published integer NOT NULL DEFAULT 0,
      skipped integer NOT NULL DEFAULT 0,
      feed_url text,
      tiktok_catalog_id text,
      audit jsonb,
      error text,
      created_at timestamptz NOT NULL DEFAULT now()
    )`;
    await sql`CREATE INDEX IF NOT EXISTS ads_catalog_publications_idx ON ads_catalog_publications (account_id, catalog_id, created_at DESC)`;
    // Jobs duráveis: preservam etapa, erro e IDs parciais para retomada mesmo
    // quando o processo reinicia no meio de uma chamada ao TikTok.
    await sql`CREATE TABLE IF NOT EXISTS ads_catalog_sync_runs (
      id text PRIMARY KEY,
      account_id text NOT NULL,
      catalog_id text NOT NULL,
      status text NOT NULL DEFAULT 'queued',
      stage text NOT NULL DEFAULT 'queued',
      idempotency_key text NOT NULL,
      payload jsonb NOT NULL DEFAULT '{}'::jsonb,
      progress jsonb NOT NULL DEFAULT '{}'::jsonb,
      error jsonb,
      locked_at timestamptz,
      locked_by text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz,
      UNIQUE (account_id, idempotency_key)
    )`;
    await sql`CREATE INDEX IF NOT EXISTS ads_catalog_sync_runs_idx ON ads_catalog_sync_runs (account_id, catalog_id, created_at DESC)`;
    await sql`CREATE TABLE IF NOT EXISTS ads_catalog_campaign_runs (
      id text PRIMARY KEY,
      account_id text NOT NULL,
      catalog_id text NOT NULL,
      advertiser_id text NOT NULL,
      status text NOT NULL DEFAULT 'queued',
      stage text NOT NULL DEFAULT 'queued',
      idempotency_key text NOT NULL,
      spec jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_ids jsonb NOT NULL DEFAULT '{}'::jsonb,
      result jsonb,
      error jsonb,
      locked_at timestamptz,
      locked_by text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz,
      UNIQUE (account_id, idempotency_key)
    )`;
    await sql`CREATE INDEX IF NOT EXISTS ads_catalog_campaign_runs_idx ON ads_catalog_campaign_runs (account_id, catalog_id, created_at DESC)`;
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
    catalogType: cleanCatalogType(row.catalog_type),
    country: row.country || null,
    bcId: row.bc_id || null,
    tiktokCatalogId: row.tiktok_catalog_id || null,
    linkStatus: row.link_status || (row.tiktok_catalog_id ? 'unverified' : 'unlinked'),
    linkVerifiedAt: row.link_verified_at || null,
    linkError: row.link_error || null,
    remoteSnapshot: row.remote_snapshot || null,
    syncedAt: row.synced_at || null,
    audit: row.audit || null,
    feedToken: row.feed_token || null,
    feedUrl: row.feed_blob_url || null,
    feedPublishedAt: row.feed_published_at || null,
    productCount: Number(row.product_count) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

// Tipos de catálogo aceitos pelo TikTok (create_tiktok_catalog). ECOM cobre
// e-commerce/infoproduto — o restante é nichado (hotel/voo/veículo/etc). Os
// valores antigos (PRODUCT_CATALOG…) foram descontinuados pelo TikTok; mapeamos
// os legados p/ os novos para não quebrar catálogos já gravados no banco.
const CATALOG_TYPES = ['ECOM', 'HOTEL', 'FLIGHT', 'AUTO_VEHICLE', 'AUTO_MODEL', 'COMIC', 'DESTINATION', 'ENTERTAINMENT', 'HOME_LISTING', 'MINI_SERIES', 'RECRUITMENT'];
const LEGACY_CATALOG_TYPES = { PRODUCT_CATALOG: 'ECOM', HOTEL_CATALOG: 'HOTEL', FLIGHT_CATALOG: 'FLIGHT', VEHICLE_CATALOG: 'AUTO_VEHICLE' };
function cleanCatalogType(value) {
  const t = String(value || '').trim().toUpperCase();
  if (LEGACY_CATALOG_TYPES[t]) return LEGACY_CATALOG_TYPES[t];
  return CATALOG_TYPES.includes(t) ? t : 'ECOM';
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
  const rows = await sql`SELECT * FROM ads_catalogs WHERE account_id = ${accountId} ORDER BY created_at DESC`;
  return rows.map(mapCatalog);
}

async function getCatalog(accountId, catalogId) {
  accountId = cleanAccountId(accountId);
  if (!enabled) return null;
  await ensureSchema();
  const rows = await sql`SELECT * FROM ads_catalogs WHERE account_id = ${accountId} AND id = ${String(catalogId || '')} LIMIT 1`;
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
  const catalogType = cleanCatalogType(value.catalogType);
  const country = value.country ? String(value.country).trim().toUpperCase().slice(0, 4) || null : null;
  const catalogId = id('cat_');
  const rows = await sql`INSERT INTO ads_catalogs (id, account_id, name, currency, catalog_type, country)
    VALUES (${catalogId}, ${accountId}, ${name}, ${currency}, ${catalogType}, ${country})
    RETURNING *`;
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
  const catalogType = value.catalogType != null ? cleanCatalogType(value.catalogType) : existing.catalogType;
  const country = value.country !== undefined
    ? (value.country ? String(value.country).trim().toUpperCase().slice(0, 4) || null : null)
    : existing.country;
  const rows = await sql`UPDATE ads_catalogs
    SET name = ${name}, currency = ${currency}, catalog_type = ${catalogType}, country = ${country}, updated_at = now()
    WHERE account_id = ${accountId} AND id = ${String(catalogId)}
    RETURNING *`;
  return mapCatalog(rows[0]);
}

async function deleteCatalog(accountId, catalogId) {
  accountId = cleanAccountId(accountId);
  if (!enabled) return false;
  await ensureSchema();
  const value = String(catalogId);
  // As tabelas foram criadas sem FK para preservar compatibilidade com bancos
  // antigos. Por isso a limpeza precisa ser explícita: antes, excluir o
  // catálogo deixava publicações e jobs órfãos no Neon.
  await sql`DELETE FROM ads_catalog_campaign_runs WHERE account_id = ${accountId} AND catalog_id = ${value}`;
  await sql`DELETE FROM ads_catalog_sync_runs WHERE account_id = ${accountId} AND catalog_id = ${value}`;
  await sql`DELETE FROM ads_catalog_publications WHERE account_id = ${accountId} AND catalog_id = ${value}`;
  await sql`DELETE FROM ads_catalog_products WHERE account_id = ${accountId} AND catalog_id = ${value}`;
  const rows = await sql`DELETE FROM ads_catalogs WHERE account_id = ${accountId} AND id = ${value} RETURNING id`;
  return rows.length > 0;
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
    RETURNING *`;
  return mapCatalog(rows[0]);
}

// Garante um feed_token estável para o catálogo (gera na 1ª vez). O token compõe
// a URL pública do feed servida pelo app (/feed/<token>.csv). Devolve o token.
async function ensureFeedToken(accountId, catalogId) {
  accountId = cleanAccountId(accountId);
  if (!enabled) throw new Error('Persistência Neon indisponível');
  await ensureSchema();
  const cur = await sql`SELECT feed_token FROM ads_catalogs WHERE account_id = ${accountId} AND id = ${String(catalogId)} LIMIT 1`;
  if (cur[0] && cur[0].feed_token) return cur[0].feed_token;
  const token = require('crypto').randomBytes(16).toString('hex');
  const rows = await sql`UPDATE ads_catalogs SET feed_token = ${token}, updated_at = now()
    WHERE account_id = ${accountId} AND id = ${String(catalogId)} AND feed_token IS NULL
    RETURNING feed_token`;
  // corrida: se outro request gravou primeiro, relê o valor efetivo
  if (rows[0] && rows[0].feed_token) return rows[0].feed_token;
  const again = await sql`SELECT feed_token FROM ads_catalogs WHERE account_id = ${accountId} AND id = ${String(catalogId)} LIMIT 1`;
  return (again[0] && again[0].feed_token) || token;
}

// Resolve um catálogo SÓ pelo feed_token (rota pública /feed/:token.csv — não há
// sessão). Devolve o catálogo (com account_id) para listar os produtos.
async function getCatalogByFeedToken(token) {
  if (!enabled) return null;
  const t = String(token || '').trim();
  if (!/^[a-f0-9]{16,64}$/.test(t)) return null;
  await ensureSchema();
  const rows = await sql`SELECT * FROM ads_catalogs WHERE feed_token = ${t} LIMIT 1`;
  return mapCatalog(rows[0]);
}

// Grava o vínculo com o catálogo REAL criado no TikTok (via Pipeboard). A partir
// daí a publicação atualiza sempre o MESMO catálogo (não recria).
async function linkTikTokCatalog(accountId, catalogId, { tiktokCatalogId, bcId, verified, remoteSnapshot } = {}) {
  accountId = cleanAccountId(accountId);
  if (!enabled) throw new Error('Persistência Neon indisponível');
  await ensureSchema();
  const remoteId = String(tiktokCatalogId || '');
  const rows = await sql`UPDATE ads_catalogs
    SET audit = CASE WHEN tiktok_catalog_id IS DISTINCT FROM ${remoteId} THEN null ELSE audit END,
        synced_at = CASE WHEN tiktok_catalog_id IS DISTINCT FROM ${remoteId} THEN null ELSE synced_at END,
        tiktok_catalog_id = ${remoteId}, bc_id = ${String(bcId || '')},
        link_status = ${verified ? 'verified' : 'unverified'},
        link_verified_at = ${verified ? new Date().toISOString() : null},
        link_error = null,
        remote_snapshot = ${remoteSnapshot ? JSON.stringify(remoteSnapshot) : null},
        updated_at = now()
    WHERE account_id = ${accountId} AND id = ${String(catalogId)}
    RETURNING *`;
  return mapCatalog(rows[0]);
}

async function markTikTokCatalogLinkError(accountId, catalogId, error) {
  accountId = cleanAccountId(accountId);
  if (!enabled) throw new Error('Persistência Neon indisponível');
  await ensureSchema();
  const rows = await sql`UPDATE ads_catalogs
    SET link_status = 'error', link_error = ${String(error || 'Falha ao verificar vínculo').slice(0, 500)},
        link_verified_at = null, updated_at = now()
    WHERE account_id = ${accountId} AND id = ${String(catalogId)} RETURNING *`;
  return mapCatalog(rows[0]);
}

async function unlinkTikTokCatalog(accountId, catalogId) {
  accountId = cleanAccountId(accountId);
  if (!enabled) throw new Error('Persistência Neon indisponível');
  await ensureSchema();
  const rows = await sql`UPDATE ads_catalogs
    SET tiktok_catalog_id = null, bc_id = null, link_status = 'unlinked',
        link_verified_at = null, link_error = null, remote_snapshot = null,
        audit = null, synced_at = null, updated_at = now()
    WHERE account_id = ${accountId} AND id = ${String(catalogId)} RETURNING *`;
  return mapCatalog(rows[0]);
}

// Snapshot da auditoria dos produtos no TikTok (aprovados/pendentes/reprovados).
async function setAudit(accountId, catalogId, audit) {
  accountId = cleanAccountId(accountId);
  if (!enabled) throw new Error('Persistência Neon indisponível');
  await ensureSchema();
  const snapshot = audit && typeof audit === 'object'
    ? { approved: Number(audit.approved) || 0, pending: Number(audit.pending) || 0, rejected: Number(audit.rejected) || 0, total: Number(audit.total) || 0, at: new Date().toISOString() }
    : null;
  const rows = await sql`UPDATE ads_catalogs SET audit = ${snapshot ? JSON.stringify(snapshot) : null}, synced_at = now(), updated_at = now()
    WHERE account_id = ${accountId} AND id = ${String(catalogId)}
    RETURNING *`;
  return mapCatalog(rows[0]);
}

async function markSynced(accountId, catalogId) {
  accountId = cleanAccountId(accountId);
  if (!enabled) throw new Error('Persistência Neon indisponível');
  await ensureSchema();
  const rows = await sql`UPDATE ads_catalogs SET synced_at = now(), audit = null, updated_at = now()
    WHERE account_id = ${accountId} AND id = ${String(catalogId)} RETURNING *`;
  return mapCatalog(rows[0]);
}

async function appendPublication(accountId, catalogId, event) {
  accountId = cleanAccountId(accountId);
  if (!enabled) return null;
  await ensureSchema();
  const value = event || {};
  const audit = value.audit && typeof value.audit === 'object' ? value.audit : null;
  const rows = await sql`INSERT INTO ads_catalog_publications
    (id, catalog_id, account_id, kind, status, published, skipped, feed_url, tiktok_catalog_id, audit, error)
    VALUES (${id('pub_')}, ${String(catalogId)}, ${accountId}, ${String(value.kind || 'publish').slice(0, 30)},
      ${String(value.status || 'success').slice(0, 30)}, ${Number(value.published) || 0}, ${Number(value.skipped) || 0},
      ${value.feedUrl ? String(value.feedUrl).slice(0, 2000) : null}, ${value.tiktokCatalogId ? String(value.tiktokCatalogId).slice(0, 100) : null},
      ${audit ? JSON.stringify(audit) : null}, ${value.error ? String(value.error).slice(0, 500) : null}) RETURNING *`;
  return rows[0] || null;
}

async function listPublications(accountId, catalogId, limit = 20) {
  accountId = cleanAccountId(accountId);
  if (!enabled) return [];
  await ensureSchema();
  const safeLimit = Math.max(1, Math.min(50, Number(limit) || 20));
  const rows = await sql`SELECT id, kind, status, published, skipped, feed_url, tiktok_catalog_id, audit, error, created_at
    FROM ads_catalog_publications WHERE account_id = ${accountId} AND catalog_id = ${String(catalogId)}
    ORDER BY created_at DESC LIMIT ${safeLimit}`;
  return rows.map((row) => ({
    id: row.id, kind: row.kind, status: row.status, published: Number(row.published) || 0,
    skipped: Number(row.skipped) || 0, feedUrl: row.feed_url || null,
    tiktokCatalogId: row.tiktok_catalog_id || null, audit: row.audit || null,
    error: row.error || null, createdAt: row.created_at,
  }));
}

function mapSyncRun(row) {
  if (!row) return null;
  return {
    id: row.id, catalogId: row.catalog_id, status: row.status, stage: row.stage,
    payload: row.payload || {}, progress: row.progress || {}, error: row.error || null,
    createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at || null,
  };
}

function mapCampaignRun(row) {
  if (!row) return null;
  return {
    id: row.id, catalogId: row.catalog_id, advertiserId: row.advertiser_id,
    status: row.status, stage: row.stage, spec: row.spec || {}, createdIds: row.created_ids || {},
    result: row.result || null, error: row.error || null,
    createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at || null,
  };
}

async function createSyncRun(accountId, catalogId, input) {
  accountId = cleanAccountId(accountId);
  if (!enabled) throw new Error('Persistência Neon indisponível');
  await ensureSchema();
  const value = input || {};
  const key = String(value.idempotencyKey || '').trim().slice(0, 200);
  if (!key) throw new Error('Idempotency key obrigatória');
  const rows = await sql`INSERT INTO ads_catalog_sync_runs
    (id, account_id, catalog_id, idempotency_key, payload, progress)
    VALUES (${id('catsync_')}, ${accountId}, ${String(catalogId)}, ${key}, ${JSON.stringify(value.payload || {})}, ${JSON.stringify(value.progress || {})})
    ON CONFLICT (account_id, idempotency_key) DO UPDATE SET updated_at = ads_catalog_sync_runs.updated_at
    RETURNING *`;
  return mapSyncRun(rows[0]);
}

async function getSyncRun(accountId, runId) {
  accountId = cleanAccountId(accountId);
  if (!enabled) return null;
  await ensureSchema();
  const rows = await sql`SELECT * FROM ads_catalog_sync_runs WHERE account_id = ${accountId} AND id = ${String(runId || '')} LIMIT 1`;
  return mapSyncRun(rows[0]);
}

async function listSyncRuns(accountId, catalogId, limit = 20) {
  accountId = cleanAccountId(accountId);
  if (!enabled) return [];
  await ensureSchema();
  const size = Math.max(1, Math.min(50, Number(limit) || 20));
  const rows = await sql`SELECT * FROM ads_catalog_sync_runs WHERE account_id = ${accountId} AND catalog_id = ${String(catalogId)} ORDER BY created_at DESC LIMIT ${size}`;
  return rows.map(mapSyncRun);
}

async function claimNextSyncRun(workerId) {
  if (!enabled) return null;
  await ensureSchema();
  const worker = String(workerId || '').trim().slice(0, 120);
  const rows = await sql`WITH candidate AS (
    SELECT id FROM ads_catalog_sync_runs
    WHERE (status IN ('queued','retrying') AND (locked_at IS NULL OR locked_at < now() - interval '5 minutes'))
       OR (status = 'running' AND locked_at < now() - interval '5 minutes')
    ORDER BY created_at ASC FOR UPDATE SKIP LOCKED LIMIT 1
  ) UPDATE ads_catalog_sync_runs AS run
    SET status = 'running', stage = CASE WHEN run.stage = 'queued' THEN 'publishing_feed' ELSE run.stage END,
        locked_at = now(), locked_by = ${worker}, updated_at = now()
    FROM candidate WHERE run.id = candidate.id RETURNING run.*`;
  return rows[0] || null;
}

async function updateSyncRun(accountId, runId, status, patch) {
  accountId = cleanAccountId(accountId);
  if (!enabled) throw new Error('Persistência Neon indisponível');
  await ensureSchema();
  const value = patch || {};
  const terminal = ['completed', 'partial', 'failed', 'cancelled'].includes(status);
  const rows = await sql`UPDATE ads_catalog_sync_runs SET
    status = ${String(status)}, stage = ${String(value.stage || status)},
    progress = COALESCE(${value.progress ? JSON.stringify(value.progress) : null}::jsonb, progress),
    error = ${value.error ? JSON.stringify(value.error) : null},
    locked_at = ${terminal ? null : value.release ? null : new Date().toISOString()},
    locked_by = ${terminal || value.release ? null : String(value.workerId || '').slice(0, 120) || null},
    completed_at = ${terminal ? new Date().toISOString() : null}, updated_at = now()
    WHERE account_id = ${accountId} AND id = ${String(runId)} RETURNING *`;
  return mapSyncRun(rows[0]);
}

async function resumeSyncRun(accountId, runId) {
  accountId = cleanAccountId(accountId);
  if (!enabled) throw new Error('Persistência Neon indisponível');
  await ensureSchema();
  const rows = await sql`UPDATE ads_catalog_sync_runs SET status = 'queued', stage = 'queued',
    error = null, locked_at = null, locked_by = null, completed_at = null, updated_at = now()
    WHERE account_id = ${accountId} AND id = ${String(runId)} AND status IN ('partial','failed') RETURNING *`;
  return mapSyncRun(rows[0]);
}

async function createCampaignRun(accountId, catalogId, input) {
  accountId = cleanAccountId(accountId);
  if (!enabled) throw new Error('Persistência Neon indisponível');
  await ensureSchema();
  const value = input || {};
  const key = String(value.idempotencyKey || '').trim().slice(0, 200);
  const advertiserId = String(value.advertiserId || '').trim().slice(0, 120);
  if (!key) throw new Error('Idempotency key obrigatória');
  if (!advertiserId) throw new Error('advertiserId obrigatório');
  const rows = await sql`INSERT INTO ads_catalog_campaign_runs
    (id, account_id, catalog_id, advertiser_id, idempotency_key, spec)
    VALUES (${id('catcamp_')}, ${accountId}, ${String(catalogId)}, ${advertiserId}, ${key}, ${JSON.stringify(value.spec || {})})
    ON CONFLICT (account_id, idempotency_key) DO UPDATE SET updated_at = ads_catalog_campaign_runs.updated_at
    RETURNING *`;
  return mapCampaignRun(rows[0]);
}

async function getCampaignRun(accountId, runId) {
  accountId = cleanAccountId(accountId);
  if (!enabled) return null;
  await ensureSchema();
  const rows = await sql`SELECT * FROM ads_catalog_campaign_runs WHERE account_id = ${accountId} AND id = ${String(runId || '')} LIMIT 1`;
  return mapCampaignRun(rows[0]);
}

async function listCampaignRuns(accountId, catalogId, limit = 20) {
  accountId = cleanAccountId(accountId);
  if (!enabled) return [];
  await ensureSchema();
  const size = Math.max(1, Math.min(50, Number(limit) || 20));
  const rows = await sql`SELECT * FROM ads_catalog_campaign_runs WHERE account_id = ${accountId} AND catalog_id = ${String(catalogId)} ORDER BY created_at DESC LIMIT ${size}`;
  return rows.map(mapCampaignRun);
}

async function claimNextCampaignRun(workerId) {
  if (!enabled) return null;
  await ensureSchema();
  const worker = String(workerId || '').trim().slice(0, 120);
  const rows = await sql`WITH candidate AS (
    SELECT id FROM ads_catalog_campaign_runs
    WHERE (status IN ('queued','retrying') AND (locked_at IS NULL OR locked_at < now() - interval '5 minutes'))
       OR (status = 'running' AND locked_at < now() - interval '5 minutes')
    ORDER BY created_at ASC FOR UPDATE SKIP LOCKED LIMIT 1
  ) UPDATE ads_catalog_campaign_runs AS run
    SET status = 'running', stage = CASE WHEN run.stage = 'queued' THEN 'validating' ELSE run.stage END,
        locked_at = now(), locked_by = ${worker}, updated_at = now()
    FROM candidate WHERE run.id = candidate.id RETURNING run.*`;
  return rows[0] || null;
}

async function updateCampaignRun(accountId, runId, status, patch) {
  accountId = cleanAccountId(accountId);
  if (!enabled) throw new Error('Persistência Neon indisponível');
  await ensureSchema();
  const value = patch || {};
  const terminal = ['completed', 'partial', 'failed', 'cancelled'].includes(status);
  const rows = await sql`UPDATE ads_catalog_campaign_runs SET
    status = ${String(status)}, stage = ${String(value.stage || status)},
    created_ids = COALESCE(${value.createdIds ? JSON.stringify(value.createdIds) : null}::jsonb, created_ids),
    result = COALESCE(${value.result ? JSON.stringify(value.result) : null}::jsonb, result),
    error = ${value.error ? JSON.stringify(value.error) : null},
    locked_at = ${terminal || value.release ? null : new Date().toISOString()},
    locked_by = ${terminal || value.release ? null : String(value.workerId || '').slice(0, 120) || null},
    completed_at = ${terminal ? new Date().toISOString() : null}, updated_at = now()
    WHERE account_id = ${accountId} AND id = ${String(runId)} RETURNING *`;
  return mapCampaignRun(rows[0]);
}

async function resumeCampaignRun(accountId, runId) {
  accountId = cleanAccountId(accountId);
  if (!enabled) throw new Error('Persistência Neon indisponível');
  await ensureSchema();
  const rows = await sql`UPDATE ads_catalog_campaign_runs SET status = 'queued',
    stage = CASE WHEN created_ids ? 'adGroupId' THEN 'creating_ad' WHEN created_ids ? 'campaignId' THEN 'creating_adgroup' ELSE 'validating' END,
    error = null, locked_at = null, locked_by = null, completed_at = null, updated_at = now()
    WHERE account_id = ${accountId} AND id = ${String(runId)} AND status IN ('partial','failed') RETURNING *`;
  return mapCampaignRun(rows[0]);
}

async function recoverCatalogRuns() {
  if (!enabled) return { sync: 0, campaign: 0 };
  await ensureSchema();
  const syncRows = await sql`UPDATE ads_catalog_sync_runs SET status = 'retrying', locked_at = null, locked_by = null,
    error = COALESCE(error, ${JSON.stringify({ code: 'WORKER_RESTARTED', userMessage: 'Publicação retomada após reinício do servidor', retryable: true })}::jsonb), updated_at = now()
    WHERE status = 'running' AND updated_at < now() - interval '2 minutes' RETURNING id`;
  const campaignRows = await sql`UPDATE ads_catalog_campaign_runs SET status = 'retrying', locked_at = null, locked_by = null,
    error = COALESCE(error, ${JSON.stringify({ code: 'WORKER_RESTARTED', userMessage: 'Criação retomada após reinício do servidor', retryable: true })}::jsonb), updated_at = now()
    WHERE status = 'running' AND updated_at < now() - interval '2 minutes' RETURNING id`;
  return { sync: syncRows.length, campaign: campaignRows.length };
}

module.exports = {
  enabled,
  ensureSchema,
  cleanAccountId,
  CATALOG_TYPES,
  listCatalogs,
  getCatalog,
  createCatalog,
  updateCatalog,
  deleteCatalog,
  listProducts,
  upsertProduct,
  bulkUpsertProducts,
  deleteProduct,
  setFeedUrl,
  ensureFeedToken,
  getCatalogByFeedToken,
  linkTikTokCatalog,
  markTikTokCatalogLinkError,
  unlinkTikTokCatalog,
  setAudit,
  markSynced,
  appendPublication,
  listPublications,
  createSyncRun,
  getSyncRun,
  listSyncRuns,
  claimNextSyncRun,
  updateSyncRun,
  resumeSyncRun,
  createCampaignRun,
  getCampaignRun,
  listCampaignRuns,
  claimNextCampaignRun,
  updateCampaignRun,
  resumeCampaignRun,
  recoverCatalogRuns
};
