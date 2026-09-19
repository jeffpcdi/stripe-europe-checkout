'use strict';

const crypto = require('crypto');
const { neon } = require('@neondatabase/serverless');
const publicSlug = require('./public-slug');
const { normalizeTrafficSource } = require('./cloak-traffic-sources');

const URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL || null;
const isPlaceholder = !URL || /USER:PASSWORD@HOST|HOST\/DATABASE|example\.com/i.test(URL);
const sql = (!isPlaceholder && URL) ? neon(URL) : null;
const enabled = !!sql;

let schemaReady = null;
let hydrated = false;

const byId = new Map();
const byRoute = new Map();
const byAccountRoute = new Map();
const byAccountPath = new Map();
const byAccount = new Map();

function cleanAccountId(value) {
  const out = String(value || '').trim();
  if (!out || out === '__all__') throw new Error('accountId específico é obrigatório');
  return out.slice(0, 120);
}

function cleanHost(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
    .replace(/\.$/, '')
    .slice(0, 253);
}

function cleanPath(value) {
  return publicSlug.normalize(value);
}

function iso(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toISOString();
}

function routeKey(host, path) {
  return cleanHost(host) + '\0' + cleanPath(path);
}

function accountRouteKey(accountId, host, path) {
  return String(accountId || '') + '\0' + routeKey(host, path);
}

function accountPathKey(accountId, path) {
  return String(accountId || '') + '\0' + cleanPath(path);
}

function mapRow(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    domainHost: row.domain_host ? cleanHost(row.domain_host) : '',
    path: cleanPath(row.path),
    name: String(row.name || ''),
    primaryUrl: String(row.primary_url || ''),
    safeUrl: String(row.safe_url || ''),
    trafficSource: normalizeTrafficSource(row.traffic_source),
    trafficToken: String(row.traffic_token || ''),
    createKeyHash: String(row.create_key_hash || ''),
    settings: row.settings && typeof row.settings === 'object' ? row.settings : {},
    legacySlug: row.legacy_slug ? cleanPath(row.legacy_slug) : '',
    revision: Math.max(1, Number(row.revision) || 1),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function clearIndexes() {
  byId.clear();
  byRoute.clear();
  byAccountRoute.clear();
  byAccountPath.clear();
  byAccount.clear();
}

function recomputeAccountPath(accountId, path) {
  const key = accountPathKey(accountId, path);
  const matches = [...byId.values()].filter((row) => row.accountId === String(accountId || '') && row.path === cleanPath(path));
  if (!matches.length) byAccountPath.delete(key);
  else if (matches.length === 1) byAccountPath.set(key, matches[0]);
  else byAccountPath.set(key, null);
}

function removeFromIndexes(campaign) {
  if (!campaign) return;
  byId.delete(campaign.id);
  if (campaign.domainHost) {
    const rk = routeKey(campaign.domainHost, campaign.path);
    if (byRoute.get(rk) && byRoute.get(rk).id === campaign.id) byRoute.delete(rk);
    const ark = accountRouteKey(campaign.accountId, campaign.domainHost, campaign.path);
    if (byAccountRoute.get(ark) && byAccountRoute.get(ark).id === campaign.id) byAccountRoute.delete(ark);
  }
  recomputeAccountPath(campaign.accountId, campaign.path);
  const rows = byAccount.get(campaign.accountId) || [];
  byAccount.set(campaign.accountId, rows.filter((row) => row.id !== campaign.id));
}

function put(campaign) {
  if (!campaign || !campaign.id) return;
  const previous = byId.get(campaign.id);
  if (previous) removeFromIndexes(previous);

  byId.set(campaign.id, campaign);
  if (campaign.domainHost) {
    byRoute.set(routeKey(campaign.domainHost, campaign.path), campaign);
    byAccountRoute.set(accountRouteKey(campaign.accountId, campaign.domainHost, campaign.path), campaign);
  }

  const apk = accountPathKey(campaign.accountId, campaign.path);
  if (!byAccountPath.has(apk)) {
    byAccountPath.set(apk, campaign);
  } else {
    const currentPath = byAccountPath.get(apk);
    if (!currentPath || currentPath.id !== campaign.id) byAccountPath.set(apk, null);
  }

  const rows = byAccount.get(campaign.accountId) || [];
  rows.push(campaign);
  rows.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  byAccount.set(campaign.accountId, rows);
}

function rebuild(rows) {
  clearIndexes();
  for (const row of rows || []) put(mapRow(row));
}

async function ensureSchema() {
  if (!enabled) return false;
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    await sql`CREATE TABLE IF NOT EXISTS cloak_campaigns (
      id text PRIMARY KEY,
      account_id text NOT NULL,
      domain_host text,
      path text NOT NULL,
      name text NOT NULL,
      primary_url text NOT NULL,
      safe_url text,
      traffic_source text NOT NULL DEFAULT 'tiktok_standard',
      traffic_token text,
      create_key_hash text,
      settings jsonb NOT NULL DEFAULT '{}'::jsonb,
      legacy_slug text,
      revision integer NOT NULL DEFAULT 1,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
    await sql`CREATE INDEX IF NOT EXISTS cloak_campaigns_account_idx
      ON cloak_campaigns (account_id, created_at DESC)`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS cloak_campaigns_domain_path_uidx
      ON cloak_campaigns (domain_host, path)
      WHERE domain_host IS NOT NULL AND domain_host <> ''`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS cloak_campaigns_legacy_uidx
      ON cloak_campaigns (account_id, legacy_slug)
      WHERE legacy_slug IS NOT NULL AND legacy_slug <> ''`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS cloak_campaigns_create_key_uidx
      ON cloak_campaigns (account_id, create_key_hash)
      WHERE create_key_hash IS NOT NULL AND create_key_hash <> ''`;
    return true;
  })().catch((err) => {
    schemaReady = null;
    throw err;
  });
  return schemaReady;
}

async function hydrate() {
  if (!enabled) {
    hydrated = false;
    return false;
  }
  await ensureSchema();
  try {
    const rows = await sql`SELECT * FROM cloak_campaigns ORDER BY created_at DESC`;
    rebuild(rows);
    hydrated = true;
    return true;
  } catch (err) {
    console.error('[cloak-campaign-store] hydrate:', err && err.message || err);
    hydrated = false;
    return false;
  }
}

function list(accountId) {
  return (byAccount.get(String(accountId || '')) || []).slice();
}

function get(accountId, id) {
  const row = byId.get(String(id || ''));
  if (!row || row.accountId !== String(accountId || '')) return null;
  return row;
}

function resolve(host, path) {
  if (!host || !path) return null;
  return byRoute.get(routeKey(host, path)) || null;
}

function resolveForAccount(accountId, path) {
  if (!accountId || !path) return null;
  return byAccountPath.get(accountPathKey(accountId, path)) || null;
}

function findByPath(accountId, path, domainHost) {
  if (!accountId || !path) return null;
  if (domainHost) {
    return byAccountRoute.get(accountRouteKey(accountId, domainHost, path)) || null;
  }
  return resolveForAccount(accountId, path);
}

function cleanSettings(input) {
  const src = input && typeof input === 'object' ? input : {};
  const out = {};
  const bools = [
    'enabled', 'shadowMode', 'mobileOnly', 'requireAdClick',
    'blockDatacenter', 'blockHeadless', 'checkHeaders', 'requireJsChallenge',
    'checkWebgl', 'checkTimezone', 'checkBehavior', 'blockZhLang',
    'checkWebview', 'checkCoherence', 'checkEntropy',
  ];
  for (const key of bools) if (typeof src[key] === 'boolean') out[key] = src[key];
  if (['strict', 'balanced', 'loose', 'custom'].includes(src.sensitivity)) out.sensitivity = src.sensitivity;
  if (['v5', 'v6-shadow'].includes(src.decisionEngineVersion)) out.decisionEngineVersion = src.decisionEngineVersion;
  if (Number.isFinite(Number(src.threshold))) out.threshold = Number(src.threshold);
  if (Number.isFinite(Number(src.deadlineMs))) out.deadlineMs = Number(src.deadlineMs);
  out.paisPreset = String(src.paisPreset || '').slice(0, 80);
  out.paises = Array.isArray(src.paises) ? src.paises.map((x) => String(x).toUpperCase().slice(0, 2)).filter(Boolean).slice(0, 80) : [];
  out.idiomas = Array.isArray(src.idiomas) ? src.idiomas.map((x) => String(x).toLowerCase().slice(0, 12)).filter(Boolean).slice(0, 80) : [];
  return out;
}

function newId() {
  return 'ck_' + crypto.randomUUID().replace(/-/g, '');
}

function newTrafficToken() {
  return crypto.randomBytes(18).toString('base64url');
}

function conflictError(message) {
  const err = new Error(message || 'campanha em conflito');
  err.code = 'conflict';
  err.status = 409;
  return err;
}

async function create(accountId, input = {}) {
  const acc = cleanAccountId(accountId);
  if (!enabled) {
    const err = new Error('persistência durável indisponível');
    err.code = 'persistence_failed';
    err.status = 503;
    throw err;
  }
  await ensureSchema();

  const createKeyHash = String(input.createKeyHash || '').trim().slice(0, 80);
  if (createKeyHash) {
    const replay = await sql`SELECT * FROM cloak_campaigns
      WHERE account_id = ${acc} AND create_key_hash = ${createKeyHash}
      LIMIT 1`;
    if (replay && replay[0]) {
      const mapped = mapRow(replay[0]);
      put(mapped);
      return { campaign: mapped, replayed: true };
    }
  }

  const domainHost = cleanHost(input.domainHost);
  if (!domainHost) {
    const err = new Error('domínio do Cloaker é obrigatório');
    err.code = 'domain_required';
    err.status = 422;
    throw err;
  }

  let path = cleanPath(input.path);
  if (!path) path = publicSlug.generate();
  const checked = publicSlug.validate(path);
  if (!checked.ok) {
    const err = new Error(checked.error);
    err.code = checked.code;
    err.status = 422;
    throw err;
  }
  path = checked.slug;

  const id = newId();
  const name = String(input.name || path).trim().slice(0, 160) || path;
  const primaryUrl = String(input.primaryUrl || '').trim().slice(0, 2000);
  const safeUrl = String(input.safeUrl || '').trim().slice(0, 2000);
  const trafficSource = normalizeTrafficSource(input.trafficSource);
  const trafficToken = String(input.trafficToken || newTrafficToken()).trim().slice(0, 160);
  const settings = cleanSettings(input.settings);

  try {
    const rows = await sql`INSERT INTO cloak_campaigns (
      id, account_id, domain_host, path, name, primary_url, safe_url,
      traffic_source, traffic_token, create_key_hash, settings, legacy_slug
    ) VALUES (
      ${id}, ${acc}, ${domainHost}, ${path}, ${name}, ${primaryUrl}, ${safeUrl || null},
      ${trafficSource}, ${trafficToken}, ${createKeyHash || null},
      ${JSON.stringify(settings)}::jsonb, NULL
    ) RETURNING *`;
    const campaign = mapRow(rows[0]);
    put(campaign);
    return { campaign, replayed: false };
  } catch (err) {
    if (err && String(err.code) === '23505') throw conflictError('Este domínio e endereço já estão em uso.');
    throw err;
  }
}

async function update(accountId, id, patch = {}, options = {}) {
  const acc = cleanAccountId(accountId);
  const current = get(acc, id);
  if (!current) {
    const err = new Error('campanha de Cloaker não encontrada');
    err.code = 'not_found';
    err.status = 404;
    throw err;
  }
  if (!enabled) {
    const err = new Error('persistência durável indisponível');
    err.code = 'persistence_failed';
    err.status = 503;
    throw err;
  }
  await ensureSchema();

  const next = {
    ...current,
    domainHost: patch.domainHost !== undefined ? cleanHost(patch.domainHost) : current.domainHost,
    path: patch.path !== undefined ? cleanPath(patch.path) : current.path,
    name: patch.name !== undefined ? String(patch.name || '').trim().slice(0, 160) : current.name,
    primaryUrl: patch.primaryUrl !== undefined ? String(patch.primaryUrl || '').trim().slice(0, 2000) : current.primaryUrl,
    safeUrl: patch.safeUrl !== undefined ? String(patch.safeUrl || '').trim().slice(0, 2000) : current.safeUrl,
    trafficSource: patch.trafficSource !== undefined ? normalizeTrafficSource(patch.trafficSource) : current.trafficSource,
    settings: patch.settings !== undefined ? cleanSettings({ ...current.settings, ...patch.settings }) : current.settings,
  };

  if (!next.domainHost) {
    const err = new Error('domínio do Cloaker é obrigatório');
    err.code = 'domain_required';
    err.status = 422;
    throw err;
  }
  const checked = publicSlug.validate(next.path);
  if (!checked.ok) {
    const err = new Error(checked.error);
    err.code = checked.code;
    err.status = 422;
    throw err;
  }
  next.path = checked.slug;

  const expectedUpdatedAt = String(options.expectedUpdatedAt || '').trim();
  try {
    const rows = expectedUpdatedAt
      ? await sql`UPDATE cloak_campaigns SET
          domain_host = ${next.domainHost},
          path = ${next.path},
          name = ${next.name || next.path},
          primary_url = ${next.primaryUrl},
          safe_url = ${next.safeUrl || null},
          traffic_source = ${next.trafficSource},
          settings = ${JSON.stringify(next.settings || {})}::jsonb,
          revision = revision + 1,
          updated_at = now()
        WHERE id = ${current.id} AND account_id = ${acc}
          AND updated_at = ${expectedUpdatedAt}::timestamptz
        RETURNING *`
      : await sql`UPDATE cloak_campaigns SET
          domain_host = ${next.domainHost},
          path = ${next.path},
          name = ${next.name || next.path},
          primary_url = ${next.primaryUrl},
          safe_url = ${next.safeUrl || null},
          traffic_source = ${next.trafficSource},
          settings = ${JSON.stringify(next.settings || {})}::jsonb,
          revision = revision + 1,
          updated_at = now()
        WHERE id = ${current.id} AND account_id = ${acc}
        RETURNING *`;

    if (!rows || !rows[0]) {
      const err = new Error('Esta campanha foi alterada em outra aba ou por outro usuário.');
      err.code = 'revision_conflict';
      err.status = 409;
      throw err;
    }
    const campaign = mapRow(rows[0]);
    put(campaign);
    return campaign;
  } catch (err) {
    if (err && String(err.code) === '23505') throw conflictError('Este domínio e endereço já estão em uso.');
    throw err;
  }
}

async function remove(accountId, id, options = {}) {
  const acc = cleanAccountId(accountId);
  const current = get(acc, id);
  if (!current) {
    const err = new Error('campanha de Cloaker não encontrada');
    err.code = 'not_found';
    err.status = 404;
    throw err;
  }
  if (!enabled) {
    const err = new Error('persistência durável indisponível');
    err.code = 'persistence_failed';
    err.status = 503;
    throw err;
  }
  const expectedUpdatedAt = String(options.expectedUpdatedAt || '').trim();
  const rows = expectedUpdatedAt
    ? await sql`DELETE FROM cloak_campaigns
        WHERE id = ${current.id} AND account_id = ${acc}
          AND updated_at = ${expectedUpdatedAt}::timestamptz
        RETURNING id`
    : await sql`DELETE FROM cloak_campaigns
        WHERE id = ${current.id} AND account_id = ${acc}
        RETURNING id`;
  if (!rows || !rows[0]) {
    const err = new Error('Esta campanha foi alterada em outra aba ou por outro usuário.');
    err.code = 'revision_conflict';
    err.status = 409;
    throw err;
  }
  removeFromIndexes(current);
  return true;
}

function legacyId(accountId, slug) {
  return 'ck_' + crypto.createHash('sha256')
    .update(String(accountId || '') + '|legacy|' + String(slug || ''))
    .digest('hex')
    .slice(0, 32);
}

function legacySettings(entry) {
  return cleanSettings({
    enabled: entry.enabled !== false,
    shadowMode: entry.shadowMode === true,
    mobileOnly: entry.mobileOnly === true,
    requireAdClick: false,
    sensitivity: entry.sensitivity || 'balanced',
    decisionEngineVersion: entry.decisionEngineVersion || 'v6-shadow',
    threshold: entry.threshold,
    deadlineMs: entry.deadlineMs,
    paisPreset: entry.paisPreset,
    paises: entry.paises,
    idiomas: entry.idiomas,
    blockDatacenter: entry.blockDatacenter,
    blockHeadless: entry.blockHeadless,
    checkHeaders: entry.checkHeaders,
    requireJsChallenge: entry.requireJsChallenge,
    checkWebgl: entry.checkWebgl,
    checkTimezone: entry.checkTimezone,
    checkBehavior: entry.checkBehavior,
    blockZhLang: entry.blockZhLang,
    checkWebview: entry.checkWebview,
    checkCoherence: entry.checkCoherence,
    checkEntropy: entry.checkEntropy,
  });
}

async function migrateLegacy(accountId, entries) {
  if (!enabled || !Array.isArray(entries) || !entries.length) return { migrated: 0 };
  const acc = cleanAccountId(accountId);
  await ensureSchema();
  let migrated = 0;
  for (const entry of entries.slice(0, 500)) {
    const slug = cleanPath(entry && entry.slug);
    const primaryUrl = String(entry && entry.offerUrl || '').trim();
    if (!slug || !primaryUrl) continue;
    const id = legacyId(acc, slug);
    const domainHost = cleanHost(entry.dominio) || null;
    const token = newTrafficToken();
    try {
      const rows = await sql`INSERT INTO cloak_campaigns (
        id, account_id, domain_host, path, name, primary_url, safe_url,
        traffic_source, traffic_token, settings, legacy_slug, created_at, updated_at
      ) VALUES (
        ${id}, ${acc}, ${domainHost}, ${slug}, ${String(entry.nome || slug).slice(0, 160)},
        ${primaryUrl.slice(0, 2000)}, ${String(entry.whitePageUrl || '').trim().slice(0, 2000) || null},
        'tiktok_standard', ${token}, ${JSON.stringify(legacySettings(entry))}::jsonb,
        ${slug}, ${entry.criadoEm || new Date().toISOString()}, ${entry.updatedAt || new Date().toISOString()}
      ) ON CONFLICT DO NOTHING
      RETURNING id`;
      if (rows && rows.length) migrated++;
    } catch (err) {
      console.error('[cloak-campaign-store] migrateLegacy ' + slug + ':', err && err.message || err);
    }
  }
  await hydrate();
  return { migrated };
}

module.exports = {
  enabled,
  isReady: () => hydrated,
  ensureSchema,
  hydrate,
  migrateLegacy,
  list,
  get,
  resolve,
  resolveForAccount,
  findByPath,
  create,
  update,
  remove,
  cleanHost,
  cleanPath,
  cleanSettings,
  legacyId,
};
