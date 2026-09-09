const crypto = require('crypto');
const { neon } = require('@neondatabase/serverless');
const { TIKTOK_MIN_APPROVED_PRODUCTS } = require('./catalog/catalog-domain');

const URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL || null;
const isPlaceholder = !URL || /USER:PASSWORD@HOST|HOST\/DATABASE|example\.com/i.test(URL);
const sql = (!isPlaceholder && URL) ? neon(URL) : null;
const enabled = !!sql;

function id(prefix) {
  return prefix + crypto.randomUUID().replace(/-/g, '');
}

function cleanAccountId(value) {
  const accountId = String(value || '').trim();
  if (!accountId || accountId === '__all__') throw new Error('accountId específico é obrigatório');
  return accountId.slice(0, 120);
}

function cleanAdvertiserId(value) {
  const advertiserId = String(value || '').trim();
  if (!advertiserId || advertiserId === '__all__') throw new Error('advertiserId específico é obrigatório');
  return advertiserId.slice(0, 120);
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
      advertiser_id text,
      name text NOT NULL,
      currency text NOT NULL DEFAULT 'BRL',
      feed_blob_url text,
      feed_published_at timestamptz,
      product_count integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
    await sql`CREATE INDEX IF NOT EXISTS ads_catalogs_account_idx ON ads_catalogs (account_id, created_at DESC)`;
    // O painel é BRL por padrão. A alteração é só para novos registros: nunca
    // troca a moeda já escolhida por um catálogo existente.
    await sql`ALTER TABLE ads_catalogs ALTER COLUMN currency SET DEFAULT 'BRL'`;
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
    // Cada sincronização aponta para um CSV imutável identificado pelo
    // hash do conteúdo. Assim, editar o catálogo enquanto o TikTok ainda
    // baixa o arquivo não altera silenciosamente o lote em processamento.
    await sql`CREATE TABLE IF NOT EXISTS ads_catalog_feed_snapshots (
      feed_token text NOT NULL,
      revision text NOT NULL,
      catalog_id text NOT NULL,
      account_id text NOT NULL,
      advertiser_id text NOT NULL,
      content text NOT NULL,
      product_count integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (feed_token, revision)
    )`;
    await sql`CREATE INDEX IF NOT EXISTS ads_catalog_feed_snapshots_catalog_idx
      ON ads_catalog_feed_snapshots (account_id, advertiser_id, catalog_id, created_at DESC)`;
    // A coluna nasce anulável para bancos que já possuem catálogos. Esses
    // registros legados são reivindicados atomicamente pelo primeiro
    // advertiser selecionado da conta (claimLegacyCatalogs), sem apagar nem
    // duplicar catálogo/produto/feed existente.
    await sql`ALTER TABLE ads_catalogs ADD COLUMN IF NOT EXISTS advertiser_id text`;
    await sql`CREATE INDEX IF NOT EXISTS ads_catalogs_account_advertiser_idx ON ads_catalogs (account_id, advertiser_id, created_at DESC)`;
    // A chave de lote torna a criação reexecutável: se a conexão cair depois
    // de persistir um catálogo, o mesmo lote reaproveita o registro em vez de
    // duplicar produtos e feeds no retry.
    await sql`ALTER TABLE ads_catalogs ADD COLUMN IF NOT EXISTS batch_key text`;
    await sql`ALTER TABLE ads_catalogs ADD COLUMN IF NOT EXISTS automation jsonb NOT NULL DEFAULT '{}'::jsonb`;
    await sql`ALTER TABLE ads_catalogs ADD COLUMN IF NOT EXISTS creatives jsonb NOT NULL DEFAULT '[]'::jsonb`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS ads_catalogs_batch_key_idx
      ON ads_catalogs (account_id, advertiser_id, batch_key) WHERE batch_key IS NOT NULL`;
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
    await sql`ALTER TABLE ads_catalog_products ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0`;
    await sql`WITH legacy_catalogs AS (
      SELECT catalog_id FROM ads_catalog_products
      GROUP BY catalog_id
      HAVING count(*) > 1 AND count(DISTINCT sort_order) = 1
    ), ranked AS (
      SELECT product.id, row_number() OVER (PARTITION BY product.catalog_id ORDER BY product.created_at, product.id) - 1 AS pos
      FROM ads_catalog_products AS product
      JOIN legacy_catalogs ON legacy_catalogs.catalog_id = product.catalog_id
    ) UPDATE ads_catalog_products AS product SET sort_order = ranked.pos
      FROM ranked WHERE product.id = ranked.id`;
    // Catalog Carousel precisa de item_group_id. Para catálogos existentes de
    // produto simples, usa o SKU como SPU e marca o catálogo como alterado para
    // que a UI solicite uma nova sincronização antes de criar campanha.
    await sql`WITH changed AS (
      UPDATE ads_catalog_products
      SET data = data || jsonb_build_object('item_group_id', sku_id), updated_at = now()
      WHERE coalesce(btrim(data ->> 'item_group_id'), '') = ''
        AND coalesce(btrim(sku_id), '') <> ''
      RETURNING catalog_id
    )
    UPDATE ads_catalogs SET updated_at = now()
    WHERE id IN (SELECT DISTINCT catalog_id FROM changed)`;
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
      advertiser_id text,
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
    await sql`ALTER TABLE ads_catalog_sync_runs ADD COLUMN IF NOT EXISTS advertiser_id text`;
    await sql`UPDATE ads_catalog_sync_runs AS run SET advertiser_id = catalog.advertiser_id
      FROM ads_catalogs AS catalog
      WHERE run.account_id = catalog.account_id AND run.catalog_id = catalog.id
        AND run.advertiser_id IS NULL AND catalog.advertiser_id IS NOT NULL`;
    await sql`CREATE INDEX IF NOT EXISTS ads_catalog_sync_runs_idx ON ads_catalog_sync_runs (account_id, catalog_id, created_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS ads_catalog_sync_runs_advertiser_idx ON ads_catalog_sync_runs (account_id, advertiser_id, created_at DESC)`;
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
    await sql`ALTER TABLE ads_catalog_campaign_runs ADD COLUMN IF NOT EXISTS asset_attempts integer NOT NULL DEFAULT 0`;
    await sql`ALTER TABLE ads_catalog_campaign_runs ADD COLUMN IF NOT EXISTS creation_attempts integer NOT NULL DEFAULT 0`;
    await sql`ALTER TABLE ads_catalog_campaign_runs ADD COLUMN IF NOT EXISTS verify_attempts integer NOT NULL DEFAULT 0`;
    await sql`ALTER TABLE ads_catalog_campaign_runs ADD COLUMN IF NOT EXISTS activation_attempts integer NOT NULL DEFAULT 0`;
    await sql`ALTER TABLE ads_catalog_campaign_runs ADD COLUMN IF NOT EXISTS next_retry_at timestamptz`;
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
    advertiserId: row.advertiser_id || null,
    batchKey: row.batch_key || null,
    automation: row.automation || {},
    creatives: Array.isArray(row.creatives) ? row.creatives : [],
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
    sortOrder: Number(row.sort_order) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

// Catálogos anteriores à segmentação não têm advertiser_id. No primeiro
// acesso já escopado, a atualização condicional atribui todos ao advertiser
// selecionado. Em concorrência, o Postgres reavalia o WHERE após o lock: cada
// linha só pode ser reivindicada uma vez e nunca troca de advertiser depois.
async function claimLegacyCatalogs(accountId, advertiserId) {
  accountId = cleanAccountId(accountId);
  advertiserId = cleanAdvertiserId(advertiserId);
  if (!enabled) return 0;
  await ensureSchema();
  const rows = await sql`UPDATE ads_catalogs SET advertiser_id = ${advertiserId}
    WHERE account_id = ${accountId} AND advertiser_id IS NULL
    RETURNING id`;
  if (rows.length) {
    await sql`UPDATE ads_catalog_sync_runs AS run SET advertiser_id = ${advertiserId}
      WHERE run.account_id = ${accountId} AND run.advertiser_id IS NULL
        AND run.catalog_id IN (SELECT id FROM ads_catalogs WHERE account_id = ${accountId} AND advertiser_id = ${advertiserId})`;
  }
  return rows.length;
}

async function listCatalogs(accountId, advertiserId) {
  accountId = cleanAccountId(accountId);
  advertiserId = cleanAdvertiserId(advertiserId);
  if (!enabled) return [];
  await ensureSchema();
  await claimLegacyCatalogs(accountId, advertiserId);
  const rows = await sql`SELECT * FROM ads_catalogs
    WHERE account_id = ${accountId} AND advertiser_id = ${advertiserId}
    ORDER BY created_at DESC`;
  return rows.map(mapCatalog);
}

async function getCatalog(accountId, advertiserId, catalogId) {
  accountId = cleanAccountId(accountId);
  advertiserId = cleanAdvertiserId(advertiserId);
  if (!enabled) return null;
  await ensureSchema();
  await claimLegacyCatalogs(accountId, advertiserId);
  const rows = await sql`SELECT * FROM ads_catalogs
    WHERE account_id = ${accountId} AND advertiser_id = ${advertiserId}
      AND id = ${String(catalogId || '')}
    LIMIT 1`;
  return mapCatalog(rows[0]);
}

async function createCatalog(accountId, advertiserId, input) {
  accountId = cleanAccountId(accountId);
  advertiserId = cleanAdvertiserId(advertiserId);
  if (!enabled) throw new Error('Persistência Neon indisponível');
  await ensureSchema();
  const value = input || {};
  const name = String(value.name || '').trim().slice(0, 200);
  if (!name) throw new Error('Nome do catálogo obrigatório');
  const currency = String(value.currency || 'BRL').trim().toUpperCase().slice(0, 8) || 'BRL';
  const catalogType = cleanCatalogType(value.catalogType);
  const country = value.country ? String(value.country).trim().toUpperCase().slice(0, 4) || null : null;
  const batchKey = value.batchKey ? String(value.batchKey).trim().slice(0, 200) || null : null;
  const catalogId = id('cat_');
  const rows = batchKey
    ? await sql`INSERT INTO ads_catalogs
      (id, account_id, advertiser_id, name, currency, catalog_type, country, batch_key)
      VALUES (${catalogId}, ${accountId}, ${advertiserId}, ${name}, ${currency}, ${catalogType}, ${country}, ${batchKey})
      ON CONFLICT (account_id, advertiser_id, batch_key) WHERE batch_key IS NOT NULL
      DO UPDATE SET updated_at = now()
      RETURNING *`
    : await sql`INSERT INTO ads_catalogs
      (id, account_id, advertiser_id, name, currency, catalog_type, country)
      VALUES (${catalogId}, ${accountId}, ${advertiserId}, ${name}, ${currency}, ${catalogType}, ${country})
      RETURNING *`;
  return mapCatalog(rows[0]);
}

async function getProductCatalogRequest(accountId, advertiserId, batchKey) {
  accountId = cleanAccountId(accountId);
  advertiserId = cleanAdvertiserId(advertiserId);
  if (!enabled) throw new Error('Persistência Neon indisponível');
  await ensureSchema();
  const rows = await sql`SELECT * FROM ads_catalogs WHERE account_id = ${accountId}
    AND advertiser_id = ${advertiserId} AND batch_key = ${batchKey}`;
  return mapCatalog(rows[0]);
}

// Uma única instrução grava catálogo + quatro produtos + vídeos. O conflito
// reaproveita a preparação original, sem sobrescrever edições no retry.
async function createProductCatalog(accountId, advertiserId, input, plan) {
  accountId = cleanAccountId(accountId);
  advertiserId = cleanAdvertiserId(advertiserId);
  if (!enabled) throw new Error('Persistência Neon indisponível');
  await ensureSchema();
  const automation = { sourceUrl: input.url, requestFingerprint: input.fingerprint, sharedItems: 4, products: plan.products };
  const rows = await sql`WITH catalog AS (
    INSERT INTO ads_catalogs (id, account_id, advertiser_id, name, currency, catalog_type, country,
      batch_key, automation, creatives, product_count)
    VALUES (${id('cat_')}, ${accountId}, ${advertiserId}, ${plan.name}, ${plan.currency}, 'ECOM',
      ${plan.country}, ${input.batchKey}, ${JSON.stringify(automation)}::jsonb, ${JSON.stringify(input.creatives)}::jsonb, 4)
    ON CONFLICT (account_id, advertiser_id, batch_key) WHERE batch_key IS NOT NULL
    DO UPDATE SET batch_key = EXCLUDED.batch_key
      WHERE ads_catalogs.automation->>'requestFingerprint' = EXCLUDED.automation->>'requestFingerprint'
    RETURNING *
  ), items AS (
    INSERT INTO ads_catalog_products (id, catalog_id, account_id, sku_id, data, valid, errors, sort_order)
    SELECT catalog.id || '_' || entry.ordinality, catalog.id, catalog.account_id, entry.value->>'sku_id',
      entry.value, true, '[]'::jsonb, entry.ordinality - 1
    FROM catalog, jsonb_array_elements(catalog.automation->'products') WITH ORDINALITY AS entry(value, ordinality)
    ON CONFLICT (catalog_id, sku_id) DO NOTHING RETURNING id
  ) SELECT * FROM catalog`;
  if (!rows.length) throw Object.assign(new Error('Esta tentativa já pertence a outro produto. Inicie uma nova criação.'), { status: 409, code: 'CATALOG_REQUEST_CONFLICT' });
  return mapCatalog(rows[0]);
}

// Mescla por URL dentro do UPDATE: envios simultâneos não perdem vídeos e
// repetir um upload/salvamento não duplica o vínculo. A ordem é preservada.
async function addCatalogCreatives(accountId, advertiserId, catalogId, creatives) {
  accountId = cleanAccountId(accountId);
  advertiserId = cleanAdvertiserId(advertiserId);
  if (!enabled) throw new Error('Persistência Neon indisponível');
  await ensureSchema();
  const rows = await sql`UPDATE ads_catalogs SET creatives = (
    SELECT COALESCE(jsonb_agg(item ORDER BY COALESCE((item->>'sortOrder')::integer, pos), pos), '[]'::jsonb) FROM (
      SELECT DISTINCT ON (value->>'url') value AS item, ordinality AS pos
      FROM jsonb_array_elements(creatives || ${JSON.stringify(creatives)}::jsonb) WITH ORDINALITY
      ORDER BY value->>'url', ordinality
    ) merged
  ) WHERE account_id = ${accountId} AND advertiser_id = ${advertiserId} AND id = ${String(catalogId)}
    AND (SELECT count(DISTINCT value->>'url') FROM jsonb_array_elements(creatives || ${JSON.stringify(creatives)}::jsonb)) <= 50
    RETURNING *`;
  if (!rows.length) {
    const catalog = await getCatalog(accountId, advertiserId, catalogId);
    throw Object.assign(new Error(catalog ? 'O catálogo já possui 50 criativos. Remova um antes de adicionar outro.' : 'Catálogo não encontrado.'),
      { status: catalog ? 409 : 404, code: catalog ? 'CATALOG_CREATIVES_LIMIT' : 'CATALOG_NOT_FOUND' });
  }
  return mapCatalog(rows[0]);
}

async function removeCatalogCreative(accountId, advertiserId, catalogId, creativeId) {
  accountId = cleanAccountId(accountId);
  advertiserId = cleanAdvertiserId(advertiserId);
  if (!enabled) throw new Error('Persistência Neon indisponível');
  await ensureSchema();
  const rows = await sql`UPDATE ads_catalogs SET creatives = (
    SELECT COALESCE(jsonb_agg(value ORDER BY ordinality), '[]'::jsonb)
    FROM jsonb_array_elements(creatives) WITH ORDINALITY WHERE value->>'id' <> ${String(creativeId)}
  ) WHERE account_id = ${accountId} AND advertiser_id = ${advertiserId} AND id = ${String(catalogId)} RETURNING *`;
  return mapCatalog(rows[0]);
}

async function setCatalogSyncIssue(accountId, advertiserId, catalogId, issue) {
  accountId = cleanAccountId(accountId);
  advertiserId = cleanAdvertiserId(advertiserId);
  if (!enabled) throw new Error('Persistência Neon indisponível');
  await ensureSchema();
  await sql`UPDATE ads_catalogs SET automation = jsonb_set(automation, '{syncIssue}', ${JSON.stringify(issue || null)}::jsonb)
    WHERE account_id = ${accountId} AND advertiser_id = ${advertiserId} AND id = ${String(catalogId)}`;
}

async function updateCatalog(accountId, advertiserId, catalogId, input) {
  accountId = cleanAccountId(accountId);
  advertiserId = cleanAdvertiserId(advertiserId);
  if (!enabled) throw new Error('Persistência Neon indisponível');
  await ensureSchema();
  const value = input || {};
  const existing = await getCatalog(accountId, advertiserId, catalogId);
  if (!existing) throw new Error('Catálogo não encontrado');
  const name = value.name != null ? String(value.name).trim().slice(0, 200) || existing.name : existing.name;
  const currency = value.currency != null ? (String(value.currency).trim().toUpperCase().slice(0, 8) || existing.currency) : existing.currency;
  const catalogType = value.catalogType != null ? cleanCatalogType(value.catalogType) : existing.catalogType;
  const country = value.country !== undefined
    ? (value.country ? String(value.country).trim().toUpperCase().slice(0, 4) || null : null)
    : existing.country;
  const rows = await sql`UPDATE ads_catalogs
    SET name = ${name}, currency = ${currency}, catalog_type = ${catalogType}, country = ${country}, updated_at = now()
    WHERE account_id = ${accountId} AND advertiser_id = ${advertiserId} AND id = ${String(catalogId)}
    RETURNING *`;
  return mapCatalog(rows[0]);
}

async function deleteCatalog(accountId, advertiserId, catalogId) {
  accountId = cleanAccountId(accountId);
  advertiserId = cleanAdvertiserId(advertiserId);
  if (!enabled) return false;
  await ensureSchema();
  const value = String(catalogId);
  const catalog = await getCatalog(accountId, advertiserId, value);
  if (!catalog) return false;
  // As tabelas foram criadas sem FK para preservar compatibilidade com bancos
  // antigos. Por isso a limpeza precisa ser explícita: antes, excluir o
  // catálogo deixava publicações e jobs órfãos no Neon.
  await sql`DELETE FROM ads_catalog_campaign_runs
    WHERE account_id = ${accountId} AND advertiser_id = ${advertiserId} AND catalog_id = ${value}`;
  await sql`DELETE FROM ads_catalog_sync_runs
    WHERE account_id = ${accountId} AND advertiser_id = ${advertiserId} AND catalog_id = ${value}`;
  await sql`DELETE FROM ads_catalog_publications WHERE account_id = ${accountId} AND catalog_id = ${value}`;
  await sql`DELETE FROM ads_catalog_feed_snapshots
    WHERE account_id = ${accountId} AND advertiser_id = ${advertiserId} AND catalog_id = ${value}`;
  await sql`DELETE FROM ads_catalog_products WHERE account_id = ${accountId} AND catalog_id = ${value}`;
  const rows = await sql`DELETE FROM ads_catalogs
    WHERE account_id = ${accountId} AND advertiser_id = ${advertiserId} AND id = ${value}
    RETURNING id`;
  return rows.length > 0;
}

// Revalida também registros antigos em toda leitura crítica. A coluna `valid`
// é um cache da spec vigente, não uma verdade eterna: quando um campo passa a
// ser obrigatório (por exemplo `brand`), produtos persistidos como válidos não
// podem continuar entrando no CSV público até serem corrigidos. A projeção é
// feita em memória para o feed de até 1.500 itens continuar sendo uma leitura
// O(n), sem um UPDATE por produto; o próximo upsert persiste a nova validação.
function revalidateProductRows(_accountId, catalog, rows, validate) {
  const validator = typeof validate === 'function'
    ? validate
    : require('./ads-catalog-feed').validateProduct;
  const products = rows.map(mapProduct);
  for (const product of products) {
    product.data = require('./ads-catalog-feed').withCatalogCarouselId(product.data || {});
    const next = validator(product.data || {}, catalog || {});
    product.valid = next.valid === true;
    product.errors = next.errors || [];
  }
  return products;
}

async function listProducts(accountId, advertiserId, catalogId, validate) {
  accountId = cleanAccountId(accountId);
  advertiserId = cleanAdvertiserId(advertiserId);
  if (!enabled) return [];
  await ensureSchema();
  const catalog = await getCatalog(accountId, advertiserId, catalogId);
  if (!catalog) return [];
  const rows = await sql`SELECT id, catalog_id, sku_id, data, valid, errors, sort_order, created_at, updated_at
    FROM ads_catalog_products WHERE account_id = ${accountId} AND catalog_id = ${String(catalogId || '')}
    ORDER BY sort_order ASC, created_at ASC`;
  return revalidateProductRows(accountId, catalog, rows, validate);
}

// Grava a contagem de produtos no catálogo pai — mantém a lista consistente
// sem uma segunda consulta a cada leitura.
async function refreshProductCount(accountId, advertiserId, catalogId) {
  const rows = await sql`SELECT count(*)::int AS n FROM ads_catalog_products WHERE account_id = ${accountId} AND catalog_id = ${String(catalogId)}`;
  const n = (rows[0] && rows[0].n) || 0;
  await sql`UPDATE ads_catalogs SET product_count = ${n}, updated_at = now()
    WHERE account_id = ${accountId} AND advertiser_id = ${advertiserId} AND id = ${String(catalogId)}`;
  return n;
}

// Upsert de um produto. `validate` é injetado pelo chamador (ads-catalog-feed)
// para não acoplar o store à lógica de validação.
function assertCatalogProductUrl(catalog, data) {
  const expected = catalog.automation && catalog.automation.sourceUrl;
  if (!expected) return;
  let actual = '';
  try { const parsed = new globalThis.URL(String(data.link || '')); parsed.hash = ''; actual = parsed.toString(); } catch (_) {}
  if (actual !== expected) throw Object.assign(new Error('Este catálogo pertence a um único produto. Use o link original ou crie outro catálogo.'), { status: 422, code: 'CATALOG_SINGLE_PRODUCT_URL' });
}

async function upsertProduct(accountId, advertiserId, catalogId, product, validate) {
  accountId = cleanAccountId(accountId);
  advertiserId = cleanAdvertiserId(advertiserId);
  if (!enabled) throw new Error('Persistência Neon indisponível');
  await ensureSchema();
  const catalog = await getCatalog(accountId, advertiserId, catalogId);
  if (!catalog) throw new Error('Catálogo não encontrado');
  const data = (product && product.data) || {};
  assertCatalogProductUrl(catalog, data);
  const skuId = String(data.sku_id || (product && product.skuId) || '').trim().slice(0, 100);
  if (!skuId) throw new Error('sku_id obrigatório');
  data.sku_id = skuId;
  if (!String(data.item_group_id || '').trim()) data.item_group_id = skuId;
  const result = typeof validate === 'function' ? validate(data, catalog) : { valid: true, errors: [] };
  const rows = await sql`INSERT INTO ads_catalog_products (id, catalog_id, account_id, sku_id, data, valid, errors, sort_order)
    VALUES (${id('prod_')}, ${catalogId}, ${accountId}, ${skuId}, ${JSON.stringify(data)}, ${result.valid}, ${JSON.stringify(result.errors)},
      COALESCE((SELECT MAX(sort_order) + 1 FROM ads_catalog_products WHERE account_id = ${accountId} AND catalog_id = ${catalogId}), 0))
    ON CONFLICT (catalog_id, sku_id) DO UPDATE SET
      data = EXCLUDED.data, valid = EXCLUDED.valid, errors = EXCLUDED.errors, updated_at = now()
    RETURNING id, catalog_id, sku_id, data, valid, errors, sort_order, created_at, updated_at`;
  await refreshProductCount(accountId, advertiserId, catalogId);
  return mapProduct(rows[0]);
}

// Importa muitos produtos de uma vez (CSV). Revalida cada linha e devolve o
// resumo. Usa upsert por SKU — reimportar atualiza em vez de duplicar.
async function bulkUpsertProducts(accountId, advertiserId, catalogId, products, validate) {
  accountId = cleanAccountId(accountId);
  advertiserId = cleanAdvertiserId(advertiserId);
  if (!enabled) throw new Error('Persistência Neon indisponível');
  await ensureSchema();
  const catalog = await getCatalog(accountId, advertiserId, catalogId);
  if (!catalog) throw new Error('Catálogo não encontrado');
  let imported = 0;
  let validCount = 0;
  const skipped = [];
  // Valida o lote inteiro antes da primeira escrita para evitar importação parcial.
  for (const product of products || []) assertCatalogProductUrl(catalog, (product && product.data) || product || {});
  for (const product of products || []) {
    const data = (product && product.data) || product || {};
    const skuId = String(data.sku_id || '').trim().slice(0, 100);
    if (!skuId) { skipped.push({ reason: 'sku_id ausente' }); continue; }
    data.sku_id = skuId;
    if (!String(data.item_group_id || '').trim()) data.item_group_id = skuId;
    const result = typeof validate === 'function' ? validate(data, catalog) : { valid: true, errors: [] };
    await sql`INSERT INTO ads_catalog_products (id, catalog_id, account_id, sku_id, data, valid, errors, sort_order)
      VALUES (${id('prod_')}, ${catalogId}, ${accountId}, ${skuId}, ${JSON.stringify(data)}, ${result.valid}, ${JSON.stringify(result.errors)},
        COALESCE((SELECT MAX(sort_order) + 1 FROM ads_catalog_products WHERE account_id = ${accountId} AND catalog_id = ${catalogId}), 0))
      ON CONFLICT (catalog_id, sku_id) DO UPDATE SET
        data = EXCLUDED.data, valid = EXCLUDED.valid, errors = EXCLUDED.errors, updated_at = now()`;
    imported += 1;
    if (result.valid) validCount += 1;
  }
  await refreshProductCount(accountId, advertiserId, catalogId);
  return { imported, valid: validCount, invalid: imported - validCount, skipped };
}

// Clone completo: cria um catálogo independente com todos os produtos do
// original. O clone nasce sem vínculo TikTok (tiktokCatalogId, syncedAt, audit)
// — a sincronização cria um catálogo NOVO no TikTok para não sobrepor o
// original. Útil para replicar um catálogo já configurado em 1 clique.
async function cloneCatalog(accountId, advertiserId, catalogId) {
  accountId = cleanAccountId(accountId);
  advertiserId = cleanAdvertiserId(advertiserId);
  if (!enabled) throw new Error('Persistência Neon indisponível');
  await ensureSchema();
  const original = await getCatalog(accountId, advertiserId, catalogId);
  if (!original) throw new Error('Catálogo não encontrado');
  const products = await listProducts(accountId, advertiserId, catalogId);
  const clone = await createCatalog(accountId, advertiserId, {
    name: original.name + ' \u2014 c\u00f3pia',
    currency: original.currency,
    catalogType: original.catalogType,
    country: original.country
  });
  if (products.length > 0) {
    const productData = products.map((p) => ({ data: { ...p.data } }));
    await bulkUpsertProducts(accountId, advertiserId, clone.id, productData);
  }
  // Relê o clone com a contagem atualizada.
  const result = await getCatalog(accountId, advertiserId, clone.id);
  return { catalog: result || clone, productCount: products.length };
}

async function deleteProduct(accountId, advertiserId, catalogId, productId) {
  accountId = cleanAccountId(accountId);
  advertiserId = cleanAdvertiserId(advertiserId);
  if (!enabled) return false;
  await ensureSchema();
  const catalog = await getCatalog(accountId, advertiserId, catalogId);
  if (!catalog) return false;
  const rows = await sql`DELETE FROM ads_catalog_products WHERE account_id = ${accountId} AND catalog_id = ${String(catalogId)} AND id = ${String(productId)} RETURNING id`;
  await refreshProductCount(accountId, advertiserId, catalogId);
  return rows.length > 0;
}

async function reorderProducts(accountId, advertiserId, catalogId, productIds) {
  accountId = cleanAccountId(accountId);
  advertiserId = cleanAdvertiserId(advertiserId);
  if (!enabled) throw new Error('Persistência Neon indisponível');
  await ensureSchema();
  const current = await listProducts(accountId, advertiserId, catalogId);
  const ids = Array.isArray(productIds) ? productIds.map(String) : [];
  const expected = new Set(current.map((product) => product.id));
  if (ids.length !== expected.size || new Set(ids).size !== ids.length || ids.some((value) => !expected.has(value))) {
    const error = new Error('A ordem precisa conter todos os produtos do catálogo exatamente uma vez');
    error.status = 409;
    throw error;
  }
  const params = [accountId, String(catalogId)];
  const cases = ids.map((productId, index) => {
    params.push(productId, index);
    return `WHEN $${params.length - 1} THEN $${params.length}`;
  });
  await sql.query(`UPDATE ads_catalog_products SET sort_order = CASE id ${cases.join(' ')} ELSE sort_order END, updated_at = now()
    WHERE account_id = $1 AND catalog_id = $2`, params);
  await sql`UPDATE ads_catalogs SET updated_at = now() WHERE account_id = ${accountId} AND advertiser_id = ${advertiserId} AND id = ${String(catalogId)}`;
  return listProducts(accountId, advertiserId, catalogId);
}

async function setFeedUrl(accountId, advertiserId, catalogId, feedUrl) {
  accountId = cleanAccountId(accountId);
  advertiserId = cleanAdvertiserId(advertiserId);
  if (!enabled) throw new Error('Persistência Neon indisponível');
  await ensureSchema();
  const rows = await sql`UPDATE ads_catalogs SET feed_blob_url = ${String(feedUrl || '')}, feed_published_at = now(), updated_at = now()
    WHERE account_id = ${accountId} AND advertiser_id = ${advertiserId} AND id = ${String(catalogId)}
    RETURNING *`;
  return mapCatalog(rows[0]);
}

// Garante um feed_token estável para o catálogo (gera na 1ª vez). O token compõe
// a URL pública do feed servida pelo app (/feed/<token>.csv). Devolve o token.
async function ensureFeedToken(accountId, advertiserId, catalogId) {
  accountId = cleanAccountId(accountId);
  advertiserId = cleanAdvertiserId(advertiserId);
  if (!enabled) throw new Error('Persistência Neon indisponível');
  await ensureSchema();
  const cur = await sql`SELECT feed_token FROM ads_catalogs
    WHERE account_id = ${accountId} AND advertiser_id = ${advertiserId} AND id = ${String(catalogId)} LIMIT 1`;
  if (cur[0] && cur[0].feed_token) return cur[0].feed_token;
  const token = require('crypto').randomBytes(16).toString('hex');
  const rows = await sql`UPDATE ads_catalogs SET feed_token = ${token}, updated_at = now()
    WHERE account_id = ${accountId} AND advertiser_id = ${advertiserId}
      AND id = ${String(catalogId)} AND feed_token IS NULL
    RETURNING feed_token`;
  // corrida: se outro request gravou primeiro, relê o valor efetivo
  if (rows[0] && rows[0].feed_token) return rows[0].feed_token;
  const again = await sql`SELECT feed_token FROM ads_catalogs
    WHERE account_id = ${accountId} AND advertiser_id = ${advertiserId} AND id = ${String(catalogId)} LIMIT 1`;
  return (again[0] && again[0].feed_token) || token;
}

async function saveFeedSnapshot(accountId, advertiserId, catalogId, token, revision, content, productCount) {
  accountId = cleanAccountId(accountId);
  advertiserId = cleanAdvertiserId(advertiserId);
  const catalog = String(catalogId || '').trim();
  const feedToken = String(token || '').trim();
  const rev = String(revision || '').trim().toLowerCase();
  if (!catalog || !/^[a-f0-9]{16,64}$/.test(feedToken) || !/^[a-f0-9]{16,64}$/.test(rev)) {
    throw new Error('Snapshot de feed inválido');
  }
  if (!enabled) throw new Error('Persistência Neon indisponível');
  await ensureSchema();
  await sql`INSERT INTO ads_catalog_feed_snapshots
    (feed_token, revision, catalog_id, account_id, advertiser_id, content, product_count)
    VALUES (${feedToken}, ${rev}, ${catalog}, ${accountId}, ${advertiserId}, ${String(content || '')}, ${Math.max(0, Number(productCount) || 0)})
    ON CONFLICT (feed_token, revision) DO NOTHING`;
  // Mantém as dez revisões recentes e NUNCA remove uma revisão referenciada
  // por um run durável. O intervalo de 24h também fecha a janela entre salvar
  // o snapshot e persistir o run que o referencia em requests concorrentes.
  await sql`DELETE FROM ads_catalog_feed_snapshots AS snapshot
    WHERE snapshot.account_id = ${accountId}
      AND snapshot.advertiser_id = ${advertiserId}
      AND snapshot.catalog_id = ${catalog}
      AND snapshot.created_at < now() - interval '24 hours'
      AND NOT EXISTS (
        SELECT 1 FROM ads_catalog_sync_runs AS run
        WHERE run.account_id = snapshot.account_id
          AND run.advertiser_id = snapshot.advertiser_id
          AND run.catalog_id = snapshot.catalog_id
          AND run.payload ->> 'feedRevision' = snapshot.revision
      )
      AND (snapshot.feed_token, snapshot.revision) NOT IN (
        SELECT feed_token, revision FROM ads_catalog_feed_snapshots
        WHERE account_id = ${accountId} AND advertiser_id = ${advertiserId} AND catalog_id = ${catalog}
        ORDER BY created_at DESC LIMIT 10
      )`;
  return { token: feedToken, revision: rev, productCount: Math.max(0, Number(productCount) || 0) };
}

async function getFeedSnapshot(token, revision) {
  if (!enabled) return null;
  const feedToken = String(token || '').trim();
  const rev = String(revision || '').trim().toLowerCase();
  if (!/^[a-f0-9]{16,64}$/.test(feedToken) || !/^[a-f0-9]{16,64}$/.test(rev)) return null;
  await ensureSchema();
  const rows = await sql`SELECT content, product_count, created_at
    FROM ads_catalog_feed_snapshots
    WHERE feed_token = ${feedToken} AND revision = ${rev}
    LIMIT 1`;
  if (!rows[0]) return null;
  return {
    content: String(rows[0].content || ''),
    productCount: Number(rows[0].product_count) || 0,
    createdAt: rows[0].created_at,
  };
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

// A URL pública precisa continuar funcionando para catálogos legados antes de
// alguém abrir a dashboard e reivindicar o advertiser. O token estável resolve
// o catálogo diretamente e evita relaxar o escopo das APIs autenticadas.
async function listProductsByFeedToken(token, validate) {
  if (!enabled) return [];
  const t = String(token || '').trim();
  if (!/^[a-f0-9]{16,64}$/.test(t)) return [];
  await ensureSchema();
  const catalog = await getCatalogByFeedToken(t);
  if (!catalog) return [];
  const rows = await sql`SELECT product.id, product.catalog_id, product.sku_id, product.data,
      product.valid, product.errors, product.sort_order, product.created_at, product.updated_at
    FROM ads_catalog_products AS product
    INNER JOIN ads_catalogs AS catalog
      ON catalog.id = product.catalog_id AND catalog.account_id = product.account_id
    WHERE catalog.feed_token = ${t}
    ORDER BY product.sort_order ASC, product.created_at ASC`;
  return revalidateProductRows(catalog.accountId, catalog, rows, validate);
}

// Grava o vínculo com o catálogo REAL criado no TikTok (via Pipeboard). A partir
// daí a publicação atualiza sempre o MESMO catálogo (não recria).
async function linkTikTokCatalog(accountId, advertiserId, catalogId, { tiktokCatalogId, bcId, verified, remoteSnapshot } = {}) {
  accountId = cleanAccountId(accountId);
  advertiserId = cleanAdvertiserId(advertiserId);
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
    WHERE account_id = ${accountId} AND advertiser_id = ${advertiserId} AND id = ${String(catalogId)}
    RETURNING *`;
  return mapCatalog(rows[0]);
}

async function markTikTokCatalogLinkError(accountId, advertiserId, catalogId, error) {
  accountId = cleanAccountId(accountId);
  advertiserId = cleanAdvertiserId(advertiserId);
  if (!enabled) throw new Error('Persistência Neon indisponível');
  await ensureSchema();
  const rows = await sql`UPDATE ads_catalogs
    SET link_status = 'error', link_error = ${String(error || 'Falha ao verificar vínculo').slice(0, 500)},
        link_verified_at = null, updated_at = now()
    WHERE account_id = ${accountId} AND advertiser_id = ${advertiserId} AND id = ${String(catalogId)} RETURNING *`;
  return mapCatalog(rows[0]);
}

async function unlinkTikTokCatalog(accountId, advertiserId, catalogId) {
  accountId = cleanAccountId(accountId);
  advertiserId = cleanAdvertiserId(advertiserId);
  if (!enabled) throw new Error('Persistência Neon indisponível');
  await ensureSchema();
  const rows = await sql`UPDATE ads_catalogs
    SET tiktok_catalog_id = null, bc_id = null, link_status = 'unlinked',
        link_verified_at = null, link_error = null, remote_snapshot = null,
        audit = null, synced_at = null, updated_at = now()
    WHERE account_id = ${accountId} AND advertiser_id = ${advertiserId} AND id = ${String(catalogId)} RETURNING *`;
  return mapCatalog(rows[0]);
}

// Snapshot da auditoria dos produtos no TikTok (aprovados/pendentes/reprovados).
async function setAudit(accountId, advertiserId, catalogId, audit) {
  accountId = cleanAccountId(accountId);
  advertiserId = cleanAdvertiserId(advertiserId);
  if (!enabled) throw new Error('Persistência Neon indisponível');
  await ensureSchema();
  const snapshot = audit && typeof audit === 'object'
    ? { approved: Number(audit.approved) || 0, pending: Number(audit.pending) || 0, rejected: Number(audit.rejected) || 0, total: Number(audit.total) || 0, at: new Date().toISOString() }
    : null;
  // Atualizar o overview não prova que o upload local mais recente terminou.
  // `synced_at` é alterado exclusivamente por markSynced(), depois da
  // confirmação do feed_log_id correspondente.
  const rows = await sql`UPDATE ads_catalogs SET audit = ${snapshot ? JSON.stringify(snapshot) : null}
    WHERE account_id = ${accountId} AND advertiser_id = ${advertiserId} AND id = ${String(catalogId)}
    RETURNING *`;
  return mapCatalog(rows[0]);
}

async function markSynced(accountId, advertiserId, catalogId) {
  accountId = cleanAccountId(accountId);
  advertiserId = cleanAdvertiserId(advertiserId);
  if (!enabled) throw new Error('Persistência Neon indisponível');
  await ensureSchema();
  const rows = await sql`UPDATE ads_catalogs SET synced_at = now(), audit = null, updated_at = now()
    WHERE account_id = ${accountId} AND advertiser_id = ${advertiserId} AND id = ${String(catalogId)} RETURNING *`;
  return mapCatalog(rows[0]);
}

// O upload foi tentado, mas o TikTok não materializou nenhum produto dentro
// da janela limitada. Mantemos vínculo e feed para diagnóstico/retomada, mas
// removemos a falsa marca de sincronizado para a prontidão voltar a `sync`.
async function markSyncUnconfirmed(accountId, advertiserId, catalogId) {
  accountId = cleanAccountId(accountId);
  advertiserId = cleanAdvertiserId(advertiserId);
  if (!enabled) throw new Error('Persistência Neon indisponível');
  await ensureSchema();
  const rows = await sql`UPDATE ads_catalogs
    SET synced_at = null, audit = null, updated_at = now()
    WHERE account_id = ${accountId} AND advertiser_id = ${advertiserId} AND id = ${String(catalogId)}
    RETURNING *`;
  return mapCatalog(rows[0]);
}

async function appendPublication(accountId, advertiserId, catalogId, event) {
  accountId = cleanAccountId(accountId);
  advertiserId = cleanAdvertiserId(advertiserId);
  if (!enabled) return null;
  await ensureSchema();
  if (!await getCatalog(accountId, advertiserId, catalogId)) return null;
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

async function listPublications(accountId, advertiserId, catalogId, limit = 20) {
  accountId = cleanAccountId(accountId);
  advertiserId = cleanAdvertiserId(advertiserId);
  if (!enabled) return [];
  await ensureSchema();
  if (!await getCatalog(accountId, advertiserId, catalogId)) return [];
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
    id: row.id, catalogId: row.catalog_id, advertiserId: row.advertiser_id || null,
    status: row.status, stage: row.stage,
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
    assetAttempts: Number(row.asset_attempts) || 0,
    creationAttempts: Number(row.creation_attempts) || 0,
    verifyAttempts: Number(row.verify_attempts) || 0,
    activationAttempts: Number(row.activation_attempts) || 0,
    nextRetryAt: row.next_retry_at || null,
    createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at || null,
  };
}

async function createSyncRun(accountId, advertiserId, catalogId, input) {
  accountId = cleanAccountId(accountId);
  advertiserId = cleanAdvertiserId(advertiserId);
  if (!enabled) throw new Error('Persistência Neon indisponível');
  await ensureSchema();
  if (!await getCatalog(accountId, advertiserId, catalogId)) throw new Error('Catálogo não encontrado');
  const value = input || {};
  const key = String(value.idempotencyKey || '').trim().slice(0, 200);
  if (!key) throw new Error('Idempotency key obrigatória');
  const status = ['queued', 'waiting_connector_confirmation'].includes(String(value.status || ''))
    ? String(value.status) : 'queued';
  const stage = String(value.stage || status).trim().slice(0, 120) || status;
  const rows = await sql`INSERT INTO ads_catalog_sync_runs
    (id, account_id, catalog_id, advertiser_id, status, stage, idempotency_key, payload, progress)
    VALUES (${id('catsync_')}, ${accountId}, ${String(catalogId)}, ${advertiserId}, ${status}, ${stage}, ${key}, ${JSON.stringify(value.payload || {})}, ${JSON.stringify(value.progress || {})})
    ON CONFLICT (account_id, idempotency_key) DO UPDATE SET updated_at = ads_catalog_sync_runs.updated_at
    RETURNING *`;
  return mapSyncRun(rows[0]);
}

async function getSyncRun(accountId, advertiserId, runId) {
  accountId = cleanAccountId(accountId);
  advertiserId = cleanAdvertiserId(advertiserId);
  if (!enabled) return null;
  await ensureSchema();
  const rows = await sql`SELECT * FROM ads_catalog_sync_runs
    WHERE account_id = ${accountId} AND advertiser_id = ${advertiserId} AND id = ${String(runId || '')} LIMIT 1`;
  return mapSyncRun(rows[0]);
}

async function listSyncRuns(accountId, advertiserId, catalogId, limit = 20) {
  accountId = cleanAccountId(accountId);
  advertiserId = cleanAdvertiserId(advertiserId);
  if (!enabled) return [];
  await ensureSchema();
  const size = Math.max(1, Math.min(50, Number(limit) || 20));
  const rows = await sql`SELECT * FROM ads_catalog_sync_runs
    WHERE account_id = ${accountId} AND advertiser_id = ${advertiserId} AND catalog_id = ${String(catalogId)}
    ORDER BY created_at DESC LIMIT ${size}`;
  return rows.map(mapSyncRun);
}

async function claimNextSyncRun(workerId) {
  if (!enabled) return null;
  await ensureSchema();
  const worker = String(workerId || '').trim().slice(0, 120);
  const rows = await sql`WITH candidate AS (
    SELECT id FROM ads_catalog_sync_runs
    WHERE advertiser_id IS NOT NULL AND (
      (status IN ('queued','retrying') AND (locked_at IS NULL OR locked_at < now() - interval '5 minutes'))
       OR (status = 'running' AND locked_at < now() - interval '5 minutes')
    )
    ORDER BY created_at ASC FOR UPDATE SKIP LOCKED LIMIT 1
  ) UPDATE ads_catalog_sync_runs AS run
    SET status = 'running', stage = CASE WHEN run.stage = 'queued' THEN 'publishing_feed' ELSE run.stage END,
        locked_at = now(), locked_by = ${worker}, updated_at = now()
    FROM candidate WHERE run.id = candidate.id RETURNING run.*`;
  return rows[0] || null;
}

// Um lote pode publicar o feed local e ficar pronto antes de a tool remota
// confirmar o contrato de criação do catálogo. Esses jobs não são claimáveis
// até a confirmação; a promoção atômica evita duplicar a sincronização em
// workers concorrentes.
async function promoteSyncRunsAwaitingConnectorConfirmation(limit = 20) {
  if (!enabled) return [];
  await ensureSchema();
  const size = Math.max(1, Math.min(100, Number(limit) || 20));
  const rows = await sql`WITH candidate AS (
    SELECT id FROM ads_catalog_sync_runs
    WHERE status = 'waiting_connector_confirmation'
    ORDER BY created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT ${size}
  ) UPDATE ads_catalog_sync_runs AS run
    SET status = 'queued', stage = 'queued', error = null,
        locked_at = null, locked_by = null, completed_at = null, updated_at = now()
    FROM candidate WHERE run.id = candidate.id
    RETURNING run.*`;
  return rows.map(mapSyncRun);
}

// Após o upload, o TikTok pode aceitar a chamada antes de materializar os
// produtos no catálogo. Esta consulta devolve apenas o ÚLTIMO sync de cada
// catálogo que aguarda confirmação. Inclui o estado legado
// completed/processing_tiktok para migrar runs criados antes do contrato que
// deixou de considerar o simples retorno do upload como sucesso.
async function listCatalogsAwaitingTikTokAudit(limit = 5) {
  if (!enabled) return [];
  await ensureSchema();
  const size = Math.max(1, Math.min(20, Number(limit) || 5));
  const rows = await sql`SELECT catalog.*, run.id AS sync_run_id, run.progress AS sync_progress
    FROM ads_catalogs AS catalog
    INNER JOIN LATERAL (
      SELECT id, status, stage, progress
      FROM ads_catalog_sync_runs
      WHERE account_id = catalog.account_id AND advertiser_id = catalog.advertiser_id
        AND catalog_id = catalog.id
      ORDER BY created_at DESC
      LIMIT 1
    ) AS run ON true
    WHERE ((run.status = 'waiting_tiktok_processing' AND run.stage = 'processing_tiktok')
        OR (run.status = 'completed' AND run.stage = 'processing_tiktok'))
      AND catalog.tiktok_catalog_id IS NOT NULL
      AND catalog.bc_id IS NOT NULL
      AND catalog.link_status = 'verified'
    ORDER BY catalog.updated_at ASC
    LIMIT ${size}`;
  return rows.map((row) => Object.assign(mapCatalog(row), {
    syncRunId: row.sync_run_id || null,
    syncProgress: row.sync_progress || {},
  }));
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

async function resumeSyncRun(accountId, advertiserId, runId) {
  accountId = cleanAccountId(accountId);
  advertiserId = cleanAdvertiserId(advertiserId);
  if (!enabled) throw new Error('Persistência Neon indisponível');
  await ensureSchema();
  const rows = await sql`UPDATE ads_catalog_sync_runs SET status = 'queued', stage = 'queued',
    error = null, locked_at = null, locked_by = null, completed_at = null, updated_at = now()
    WHERE account_id = ${accountId} AND advertiser_id = ${advertiserId}
      AND id = ${String(runId)} AND status IN ('partial','failed') RETURNING *`;
  return mapSyncRun(rows[0]);
}

async function createCampaignRun(accountId, advertiserId, catalogId, input) {
  accountId = cleanAccountId(accountId);
  advertiserId = cleanAdvertiserId(advertiserId);
  if (!enabled) throw new Error('Persistência Neon indisponível');
  await ensureSchema();
  if (!await getCatalog(accountId, advertiserId, catalogId)) throw new Error('Catálogo não encontrado');
  const value = input || {};
  const key = String(value.idempotencyKey || '').trim().slice(0, 200);
  if (!key) throw new Error('Idempotency key obrigatória');
  const status = ['queued', 'waiting_catalog_review', 'waiting_connector_confirmation', 'waiting_pixel_purchase'].includes(String(value.status || ''))
    ? String(value.status) : 'queued';
  const stage = String(value.stage || status).trim().slice(0, 120) || status;
  const rows = await sql`INSERT INTO ads_catalog_campaign_runs
    (id, account_id, catalog_id, advertiser_id, status, stage, idempotency_key, spec)
    VALUES (${id('catcamp_')}, ${accountId}, ${String(catalogId)}, ${advertiserId}, ${status}, ${stage}, ${key}, ${JSON.stringify(value.spec || {})})
    ON CONFLICT (account_id, idempotency_key) DO UPDATE SET updated_at = ads_catalog_campaign_runs.updated_at
    RETURNING *`;
  return mapCampaignRun(rows[0]);
}

async function getCampaignRun(accountId, advertiserId, runId) {
  accountId = cleanAccountId(accountId);
  advertiserId = cleanAdvertiserId(advertiserId);
  if (!enabled) return null;
  await ensureSchema();
  const rows = await sql`SELECT * FROM ads_catalog_campaign_runs
    WHERE account_id = ${accountId} AND advertiser_id = ${advertiserId} AND id = ${String(runId || '')} LIMIT 1`;
  return mapCampaignRun(rows[0]);
}

async function listCampaignRuns(accountId, advertiserId, catalogId, limit = 20) {
  accountId = cleanAccountId(accountId);
  advertiserId = cleanAdvertiserId(advertiserId);
  if (!enabled) return [];
  await ensureSchema();
  const size = Math.max(1, Math.min(50, Number(limit) || 20));
  const rows = await sql`SELECT * FROM ads_catalog_campaign_runs
    WHERE account_id = ${accountId} AND advertiser_id = ${advertiserId} AND catalog_id = ${String(catalogId)}
    ORDER BY created_at DESC LIMIT ${size}`;
  return rows.map(mapCampaignRun);
}

async function claimNextCampaignRun(workerId) {
  if (!enabled) return null;
  await ensureSchema();
  const worker = String(workerId || '').trim().slice(0, 120);
  const rows = await sql`WITH candidate AS (
    SELECT id FROM ads_catalog_campaign_runs
    WHERE (status = 'queued' AND (locked_at IS NULL OR locked_at < now() - interval '5 minutes'))
       OR (status = 'retrying' AND locked_at IS NULL
         AND (next_retry_at IS NULL OR next_retry_at <= now()))
       OR (status = 'waiting_tiktok_confirmation' AND locked_at IS NULL
         AND (next_retry_at IS NULL OR next_retry_at <= now()))
       OR (status = 'waiting_pixel_purchase' AND locked_at IS NULL
         AND (next_retry_at IS NULL OR next_retry_at <= now()))
       OR (status = 'running' AND locked_at < now() - interval '5 minutes')
    ORDER BY created_at ASC FOR UPDATE SKIP LOCKED LIMIT 1
  ) UPDATE ads_catalog_campaign_runs AS run
    SET status = 'running', stage = CASE WHEN run.stage = 'queued' THEN 'validating' ELSE run.stage END,
        next_retry_at = null, locked_at = now(), locked_by = ${worker}, updated_at = now()
    FROM candidate WHERE run.id = candidate.id RETURNING run.*`;
  return rows[0] || null;
}

// Campanhas enfileiradas por um lote não podem sair antes de o TikTok aceitar
// os produtos do catálogo. Esta promoção é atômica: vários workers podem
// consultar ao mesmo tempo, mas cada run muda de espera para fila uma vez só.
async function promoteCampaignRunsAwaitingReview(limit = 20) {
  if (!enabled) return [];
  await ensureSchema();
  const size = Math.max(1, Math.min(100, Number(limit) || 20));
  const rows = await sql`WITH candidate AS (
    SELECT run.id
    FROM ads_catalog_campaign_runs AS run
    INNER JOIN ads_catalogs AS catalog
      ON catalog.id = run.catalog_id AND catalog.account_id = run.account_id
        AND catalog.advertiser_id = run.advertiser_id
    WHERE run.status = 'waiting_catalog_review'
      AND catalog.tiktok_catalog_id IS NOT NULL
      AND catalog.bc_id IS NOT NULL
      AND catalog.link_status = 'verified'
      AND CASE
        WHEN COALESCE(catalog.audit ->> 'approved', '') ~ '^[0-9]+$'
          THEN (catalog.audit ->> 'approved')::int
        ELSE 0
      END >= ${TIKTOK_MIN_APPROVED_PRODUCTS}
    ORDER BY run.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT ${size}
  ) UPDATE ads_catalog_campaign_runs AS run
    SET status = 'queued', stage = 'validating', error = null,
        locked_at = null, locked_by = null, completed_at = null, updated_at = now()
    FROM candidate WHERE run.id = candidate.id
    RETURNING run.*`;
  return rows.map(mapCampaignRun);
}

// Um lote pode ser preparado antes de o Pipeboard expor o contrato completo
// de Product Link. Esses jobs não são claimáveis nem saem para o TikTok até a
// capacidade ser confirmada pelo worker; a promoção é atômica para vários
// workers não liberarem o mesmo run duas vezes.
async function promoteCampaignRunsAwaitingConnectorConfirmation(limit = 20) {
  if (!enabled) return [];
  await ensureSchema();
  const size = Math.max(1, Math.min(100, Number(limit) || 20));
  const rows = await sql`WITH candidate AS (
    SELECT id FROM ads_catalog_campaign_runs
    WHERE status = 'waiting_connector_confirmation'
    ORDER BY created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT ${size}
  ) UPDATE ads_catalog_campaign_runs AS run
    SET status = 'waiting_catalog_review', stage = 'waiting_catalog_review', error = null,
        locked_at = null, locked_by = null, completed_at = null, updated_at = now()
    FROM candidate WHERE run.id = candidate.id
    RETURNING run.*`;
  return rows.map(mapCampaignRun);
}

// Só devolve catálogos que realmente têm campanhas esperando. O worker usa a
// lista para atualizar a auditoria do TikTok em ritmo lento e liberar o lote
// assim que houver produto aprovado, sem depender de alguém manter a tela
// aberta no navegador.
async function listCatalogsAwaitingCampaignReview(limit = 5) {
  if (!enabled) return [];
  await ensureSchema();
  const size = Math.max(1, Math.min(20, Number(limit) || 5));
  const rows = await sql`SELECT DISTINCT ON (catalog.id) catalog.*
    FROM ads_catalogs AS catalog
    INNER JOIN ads_catalog_campaign_runs AS run
      ON run.catalog_id = catalog.id AND run.account_id = catalog.account_id
        AND run.advertiser_id = catalog.advertiser_id
    WHERE run.status = 'waiting_catalog_review'
      AND catalog.tiktok_catalog_id IS NOT NULL
      AND catalog.bc_id IS NOT NULL
      AND catalog.link_status = 'verified'
    ORDER BY catalog.id, catalog.updated_at ASC
    LIMIT ${size}`;
  return rows.map(mapCatalog);
}

async function updateCampaignRun(accountId, runId, status, patch) {
  accountId = cleanAccountId(accountId);
  if (!enabled) throw new Error('Persistência Neon indisponível');
  await ensureSchema();
  const value = patch || {};
  const terminal = ['completed', 'partial', 'failed', 'cancelled'].includes(status);
  const hasAssetAttempts = Object.prototype.hasOwnProperty.call(value, 'assetAttempts');
  const hasCreationAttempts = Object.prototype.hasOwnProperty.call(value, 'creationAttempts');
  const hasVerifyAttempts = Object.prototype.hasOwnProperty.call(value, 'verifyAttempts');
  const hasActivationAttempts = Object.prototype.hasOwnProperty.call(value, 'activationAttempts');
  const hasNextRetryAt = Object.prototype.hasOwnProperty.call(value, 'nextRetryAt');
  const rows = await sql`UPDATE ads_catalog_campaign_runs SET
    status = ${String(status)}, stage = ${String(value.stage || status)},
    created_ids = COALESCE(${value.createdIds ? JSON.stringify(value.createdIds) : null}::jsonb, created_ids),
    result = COALESCE(${value.result ? JSON.stringify(value.result) : null}::jsonb, result),
    error = ${value.error ? JSON.stringify(value.error) : null},
    asset_attempts = CASE WHEN ${hasAssetAttempts} THEN ${Math.max(0, Number(value.assetAttempts) || 0)} ELSE asset_attempts END,
    creation_attempts = CASE WHEN ${hasCreationAttempts} THEN ${Math.max(0, Number(value.creationAttempts) || 0)} ELSE creation_attempts END,
    verify_attempts = CASE WHEN ${hasVerifyAttempts} THEN ${Math.max(0, Number(value.verifyAttempts) || 0)} ELSE verify_attempts END,
    activation_attempts = CASE WHEN ${hasActivationAttempts} THEN ${Math.max(0, Number(value.activationAttempts) || 0)} ELSE activation_attempts END,
    next_retry_at = CASE WHEN ${hasNextRetryAt} THEN ${value.nextRetryAt || null} ELSE next_retry_at END,
    locked_at = ${terminal || value.release ? null : new Date().toISOString()},
    locked_by = ${terminal || value.release ? null : String(value.workerId || '').slice(0, 120) || null},
    completed_at = ${terminal ? new Date().toISOString() : null}, updated_at = now()
    WHERE account_id = ${accountId} AND id = ${String(runId)} RETURNING *`;
  return mapCampaignRun(rows[0]);
}

async function resumeCampaignRun(accountId, advertiserId, runId) {
  accountId = cleanAccountId(accountId);
  advertiserId = cleanAdvertiserId(advertiserId);
  if (!enabled) throw new Error('Persistência Neon indisponível');
  await ensureSchema();
  const rows = await sql`UPDATE ads_catalog_campaign_runs SET status = 'queued',
    stage = CASE WHEN created_ids ? 'adGroupId' THEN 'creating_ad' WHEN created_ids ? 'campaignId' THEN 'creating_adgroup' ELSE 'validating' END,
    error = null, asset_attempts = 0, creation_attempts = 0, verify_attempts = 0, activation_attempts = 0, next_retry_at = null,
    locked_at = null, locked_by = null, completed_at = null, updated_at = now()
    WHERE account_id = ${accountId} AND advertiser_id = ${advertiserId}
      AND id = ${String(runId)} AND status IN ('partial','failed') RETURNING *`;
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
  cleanAdvertiserId,
  claimLegacyCatalogs,
  listCatalogs,
  getCatalog,
  createCatalog,
  getProductCatalogRequest,
  createProductCatalog,
  addCatalogCreatives,
  removeCatalogCreative,
  setCatalogSyncIssue,
  updateCatalog,
  deleteCatalog,
  cloneCatalog,
  listProducts,
  upsertProduct,
  bulkUpsertProducts,
  deleteProduct,
  reorderProducts,
  setFeedUrl,
  ensureFeedToken,
  saveFeedSnapshot,
  getFeedSnapshot,
  getCatalogByFeedToken,
  listProductsByFeedToken,
  linkTikTokCatalog,
  markTikTokCatalogLinkError,
  unlinkTikTokCatalog,
  setAudit,
  markSynced,
  markSyncUnconfirmed,
  appendPublication,
  listPublications,
  createSyncRun,
  getSyncRun,
  listSyncRuns,
  claimNextSyncRun,
  promoteSyncRunsAwaitingConnectorConfirmation,
  listCatalogsAwaitingTikTokAudit,
  updateSyncRun,
  resumeSyncRun,
  createCampaignRun,
  getCampaignRun,
  listCampaignRuns,
  claimNextCampaignRun,
  promoteCampaignRunsAwaitingReview,
  promoteCampaignRunsAwaitingConnectorConfirmation,
  listCatalogsAwaitingCampaignReview,
  updateCampaignRun,
  resumeCampaignRun,
  recoverCatalogRuns,
  _internals: { revalidateProductRows },
};
