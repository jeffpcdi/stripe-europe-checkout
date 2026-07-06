// ── Camada de persistência (Neon Postgres) — MULTI-TENANT ────────────────
// Guarda contas, sessões de login, gateways, leads, eventos, contadores de
// variantes e sessões ao vivo de forma DURÁVEL, isolados por conta
// (account_id). O stats.js continua com a API síncrona (arquivo local como
// cache quente) e faz "write-through" assíncrono para cá. No boot, hidratamos
// o cache a partir do banco — assim os dados sobrevivem a deploys/reinícios.
//
// Convenções multi-tenant:
//  - Toda tabela de dados tem a coluna account_id (text).
//  - Tabelas com PK "de nome" (variants, pixels, links, config) usam chave
//    namespaced `${accountId}:${nome}` na PK para evitar colisão entre
//    contas; a coluna account_id permite filtrar.
//  - Dados legados (account_id IS NULL) são atribuídos ao PRIMEIRO usuário
//    cadastrado (admin) via claimLegacyData().
const { neon } = require('@neondatabase/serverless');
const crypto = require('crypto');

const URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || null;
const enabled = !!URL;
const sql = enabled ? neon(URL) : null;

if (!enabled) {
  console.warn('[db] DATABASE_URL não definido — persistência desativada (modo só-arquivo).');
}

let ready = false;

// Chave namespaced por conta para tabelas keyed-by-name.
function nsKey(accountId, name) {
  return (accountId || 'legacy') + ':' + String(name || '');
}

// Cria as tabelas se ainda não existirem. Idempotente.
async function init() {
  if (!enabled) return false;
  try {
    // ── Contas / sessões de login / gateways (multi-tenant) ──────────────
    await sql`CREATE TABLE IF NOT EXISTS accounts (
      id text PRIMARY KEY,
      email text UNIQUE NOT NULL,
      password_hash text NOT NULL,
      name text,
      role text NOT NULL DEFAULT 'user',
      created_at timestamptz NOT NULL DEFAULT now()
    )`;
    await sql`CREATE TABLE IF NOT EXISTS account_sessions (
      token text PRIMARY KEY,
      account_id text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL
    )`;
    await sql`CREATE INDEX IF NOT EXISTS account_sessions_expires_idx ON account_sessions (expires_at)`;
    await sql`CREATE TABLE IF NOT EXISTS gateways (
      id text PRIMARY KEY,
      account_id text NOT NULL,
      provider text NOT NULL,
      name text,
      webhook_token text UNIQUE NOT NULL,
      secret text,
      config jsonb NOT NULL DEFAULT '{}'::jsonb,
      last_event_at timestamptz,
      last_event_status text,
      created_at timestamptz NOT NULL DEFAULT now()
    )`;
    await sql`CREATE INDEX IF NOT EXISTS gateways_account_idx ON gateways (account_id)`;

    await sql`CREATE TABLE IF NOT EXISTS leads (
      id text PRIMARY KEY,
      data jsonb NOT NULL,
      stage text,
      status text,
      gateway text,
      country text,
      country_name text,
      orphan boolean DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
    await sql`CREATE INDEX IF NOT EXISTS leads_created_idx ON leads (created_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS leads_country_idx ON leads (country)`;

    await sql`CREATE TABLE IF NOT EXISTS events (
      id text PRIMARY KEY,
      type text,
      at timestamptz NOT NULL DEFAULT now(),
      data jsonb NOT NULL
    )`;
    await sql`CREATE INDEX IF NOT EXISTS events_at_idx ON events (at DESC)`;

    await sql`CREATE TABLE IF NOT EXISTS variants (
      name text PRIMARY KEY,
      data jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;

    await sql`CREATE TABLE IF NOT EXISTS sessions (
      visitor_id text PRIMARY KEY,
      page text,
      referrer text,
      country text,
      country_name text,
      city text,
      ua text,
      ip text,
      variant text,
      first_seen timestamptz NOT NULL DEFAULT now(),
      last_seen timestamptz NOT NULL DEFAULT now(),
      pageviews integer DEFAULT 1
    )`;
    await sql`CREATE INDEX IF NOT EXISTS sessions_last_idx ON sessions (last_seen DESC)`;

    // Config da dashboard — uma linha por conta (key = account_id).
    await sql`CREATE TABLE IF NOT EXISTS config (
      key text PRIMARY KEY,
      data jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;

    // Pixels TikTok (backup durável; slug = `${accountId}:${slug}`).
    await sql`CREATE TABLE IF NOT EXISTS pixels (
      slug text PRIMARY KEY,
      data jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;

    // Links de checkout externos (/go/:slug) — config + contadores A/B.
    await sql`CREATE TABLE IF NOT EXISTS links (
      slug text PRIMARY KEY,
      data jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;

    // Log de disparos server-side (CAPI) para o painel.
    await sql`CREATE TABLE IF NOT EXISTS pixel_events (
      id text PRIMARY KEY,
      pixel text,
      event text,
      event_id text,
      lead_id text,
      status text,
      response jsonb,
      at timestamptz NOT NULL DEFAULT now()
    )`;
    await sql`CREATE INDEX IF NOT EXISTS pixel_events_at_idx ON pixel_events (at DESC)`;

    // ── Coluna account_id (multi-tenancy) em todas as tabelas de dados ────
    await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS account_id text`;
    await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS account_id text`;
    await sql`ALTER TABLE variants ADD COLUMN IF NOT EXISTS account_id text`;
    await sql`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS account_id text`;
    await sql`ALTER TABLE pixels ADD COLUMN IF NOT EXISTS account_id text`;
    await sql`ALTER TABLE links ADD COLUMN IF NOT EXISTS account_id text`;
    await sql`ALTER TABLE pixel_events ADD COLUMN IF NOT EXISTS account_id text`;
    await sql`CREATE INDEX IF NOT EXISTS leads_account_idx ON leads (account_id, created_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS events_account_idx ON events (account_id, at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS sessions_account_idx ON sessions (account_id, last_seen DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS pixels_account_idx ON pixels (account_id)`;
    await sql`CREATE INDEX IF NOT EXISTS links_account_idx ON links (account_id)`;
    await sql`CREATE INDEX IF NOT EXISTS pixel_events_account_idx ON pixel_events (account_id, at DESC)`;

    ready = true;
    console.log('[db] Neon pronto (tabelas multi-tenant verificadas).');
    return true;
  } catch (err) {
    console.error('[db] Erro ao inicializar:', err.message);
    return false;
  }
}

// init com retry — uma falha transitória de rede no boot não pode deixar o
// processo rodando sem persistência (era um dos vetores de perda de config).
async function initWithRetry(attempts) {
  const max = Math.max(1, attempts || 3);
  for (let i = 1; i <= max; i++) {
    if (await init()) return true;
    if (i < max) {
      console.warn('[db] init falhou, tentando de novo (' + i + '/' + max + ')...');
      await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
  return false;
}

// ── Contas ────────────────────────────────────────────────────────────────
async function createAccount(acc) {
  if (!enabled || !acc || !acc.id || !acc.email) return null;
  try {
    const rows = await sql`INSERT INTO accounts (id, email, password_hash, name, role)
      VALUES (${acc.id}, ${acc.email.toLowerCase()}, ${acc.passwordHash}, ${acc.name || null}, ${acc.role || 'user'})
      ON CONFLICT (email) DO NOTHING
      RETURNING id, email, name, role, created_at`;
    return rows.length ? rows[0] : null;
  } catch (err) { console.error('[db] createAccount:', err.message); return null; }
}

async function getAccountByEmail(email) {
  if (!enabled || !email) return null;
  try {
    const rows = await sql`SELECT id, email, password_hash, name, role, created_at
      FROM accounts WHERE email = ${email.toLowerCase()} LIMIT 1`;
    return rows.length ? rows[0] : null;
  } catch (err) { console.error('[db] getAccountByEmail:', err.message); return null; }
}

async function getAccountById(id) {
  if (!enabled || !id) return null;
  try {
    const rows = await sql`SELECT id, email, name, role, created_at
      FROM accounts WHERE id = ${id} LIMIT 1`;
    return rows.length ? rows[0] : null;
  } catch (err) { console.error('[db] getAccountById:', err.message); return null; }
}

async function countAccounts() {
  if (!enabled) return -1;
  try {
    const rows = await sql`SELECT count(*)::int AS n FROM accounts`;
    return rows[0].n;
  } catch (err) { console.error('[db] countAccounts:', err.message); return -1; }
}

// Migração: atribui todos os dados legados (account_id IS NULL) à conta
// informada (o primeiro admin). Idempotente — roda no registro do 1º usuário.
async function claimLegacyData(accountId) {
  if (!enabled || !accountId) return false;
  try {
    await sql`UPDATE leads SET account_id = ${accountId} WHERE account_id IS NULL`;
    await sql`UPDATE events SET account_id = ${accountId} WHERE account_id IS NULL`;
    await sql`UPDATE sessions SET account_id = ${accountId} WHERE account_id IS NULL`;
    await sql`UPDATE pixel_events SET account_id = ${accountId} WHERE account_id IS NULL`;
    // Tabelas keyed-by-name: além do account_id, a PK ganha o namespace.
    await sql`UPDATE variants SET account_id = ${accountId}, name = ${accountId} || ':' || name
      WHERE account_id IS NULL AND position(':' in name) = 0`;
    await sql`UPDATE pixels SET account_id = ${accountId}, slug = ${accountId} || ':' || slug
      WHERE account_id IS NULL AND position(':' in slug) = 0`;
    await sql`UPDATE links SET account_id = ${accountId}, slug = ${accountId} || ':' || slug
      WHERE account_id IS NULL AND position(':' in slug) = 0`;
    // Config global 'main' vira a config do admin.
    await sql`UPDATE config SET key = ${accountId} WHERE key = 'main'
      AND NOT EXISTS (SELECT 1 FROM config c2 WHERE c2.key = ${accountId})`;
    console.log('[db] Dados legados atribuídos à conta ' + accountId + '.');
    return true;
  } catch (err) { console.error('[db] claimLegacyData:', err.message); return false; }
}

// ── Sessões de login ──────────────────────────────────────────────────────
async function createAuthSession(accountId, ttlDays) {
  if (!enabled || !accountId) return null;
  const token = crypto.randomBytes(32).toString('hex');
  const days = Math.max(1, ttlDays || 30);
  try {
    await sql`INSERT INTO account_sessions (token, account_id, expires_at)
      VALUES (${token}, ${accountId}, now() + make_interval(days => ${days}))`;
    return token;
  } catch (err) { console.error('[db] createAuthSession:', err.message); return null; }
}

async function getAuthSession(token) {
  if (!enabled || !token) return null;
  try {
    const rows = await sql`SELECT s.token, s.account_id, s.expires_at, a.email, a.name, a.role
      FROM account_sessions s JOIN accounts a ON a.id = s.account_id
      WHERE s.token = ${token} AND s.expires_at > now() LIMIT 1`;
    return rows.length ? rows[0] : null;
  } catch (err) { console.error('[db] getAuthSession:', err.message); return null; }
}

async function deleteAuthSession(token) {
  if (!enabled || !token) return;
  try { await sql`DELETE FROM account_sessions WHERE token = ${token}`; }
  catch (err) { console.error('[db] deleteAuthSession:', err.message); }
}

async function pruneAuthSessions() {
  if (!enabled) return 0;
  try {
    const rows = await sql`DELETE FROM account_sessions WHERE expires_at < now() RETURNING token`;
    return rows.length;
  } catch (err) { console.error('[db] pruneAuthSessions:', err.message); return 0; }
}

// ── Gateways (1 webhook por gateway) ──────────────────────────────────────
async function upsertGateway(g) {
  if (!enabled || !g || !g.id || !g.accountId) return null;
  try {
    const rows = await sql`INSERT INTO gateways (id, account_id, provider, name, webhook_token, secret, config)
      VALUES (${g.id}, ${g.accountId}, ${g.provider}, ${g.name || null}, ${g.webhookToken},
              ${g.secret || null}, ${JSON.stringify(g.config || {})}::jsonb)
      ON CONFLICT (id) DO UPDATE SET
        provider = EXCLUDED.provider, name = EXCLUDED.name,
        secret = EXCLUDED.secret, config = EXCLUDED.config
      RETURNING *`;
    return rows.length ? rows[0] : null;
  } catch (err) { console.error('[db] upsertGateway:', err.message); return null; }
}

async function deleteGateway(accountId, id) {
  if (!enabled || !id) return;
  try { await sql`DELETE FROM gateways WHERE id = ${id} AND account_id = ${accountId}`; }
  catch (err) { console.error('[db] deleteGateway:', err.message); }
}

async function loadGateways(accountId) {
  if (!enabled) return { ok: false, data: null };
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const rows = accountId
        ? await sql`SELECT * FROM gateways WHERE account_id = ${accountId} ORDER BY created_at DESC`
        : await sql`SELECT * FROM gateways ORDER BY created_at DESC`;
      return { ok: true, data: rows };
    } catch (err) {
      console.error('[db] loadGateways (tentativa ' + attempt + '/3):', err.message);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  return { ok: false, data: null };
}

async function getGatewayByToken(token) {
  if (!enabled || !token) return null;
  try {
    const rows = await sql`SELECT * FROM gateways WHERE webhook_token = ${token} LIMIT 1`;
    return rows.length ? rows[0] : null;
  } catch (err) { console.error('[db] getGatewayByToken:', err.message); return null; }
}

async function touchGateway(id, status) {
  if (!enabled || !id) return;
  try {
    await sql`UPDATE gateways SET last_event_at = now(), last_event_status = ${status || null} WHERE id = ${id}`;
  } catch (err) { console.error('[db] touchGateway:', err.message); }
}

// ── Leads / eventos / variantes (write-through, por conta) ────────────────
async function upsertLead(accountId, lead) {
  if (!enabled || !lead || !lead.id) return;
  try {
    await sql`INSERT INTO leads (id, account_id, data, stage, status, gateway, country, country_name, orphan, created_at, updated_at)
      VALUES (${lead.id}, ${accountId || null}, ${JSON.stringify(lead)}::jsonb, ${lead.stage || null}, ${lead.status || null},
              ${lead.gateway || null}, ${lead.country || null}, ${lead.countryName || null},
              ${!!lead.orphan}, ${lead.at || new Date().toISOString()}, now())
      ON CONFLICT (id) DO UPDATE SET
        data = EXCLUDED.data, stage = EXCLUDED.stage, status = EXCLUDED.status,
        gateway = EXCLUDED.gateway, country = EXCLUDED.country, country_name = EXCLUDED.country_name,
        orphan = EXCLUDED.orphan, account_id = COALESCE(leads.account_id, EXCLUDED.account_id), updated_at = now()`;
  } catch (err) { console.error('[db] upsertLead:', err.message); }
}

async function insertEvent(accountId, evt) {
  if (!enabled || !evt || !evt.id) return;
  try {
    await sql`INSERT INTO events (id, account_id, type, at, data)
      VALUES (${evt.id}, ${accountId || null}, ${evt.type || 'info'}, ${evt.at || new Date().toISOString()}, ${JSON.stringify(evt)}::jsonb)
      ON CONFLICT (id) DO NOTHING`;
  } catch (err) { console.error('[db] insertEvent:', err.message); }
}

async function upsertVariant(accountId, name, data) {
  if (!enabled || !name) return;
  try {
    await sql`INSERT INTO variants (name, account_id, data, updated_at)
      VALUES (${nsKey(accountId, name)}, ${accountId || null}, ${JSON.stringify(data)}::jsonb, now())
      ON CONFLICT (name) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;
  } catch (err) { console.error('[db] upsertVariant:', err.message); }
}

// Carrega o estado persistido de UMA conta para hidratar o cache no boot.
async function loadState(accountId, limitLeads, limitEvents) {
  if (!enabled) return null;
  try {
    const [leadRows, eventRows, variantRows] = await Promise.all([
      accountId
        ? sql`SELECT data FROM leads WHERE account_id = ${accountId} ORDER BY created_at DESC LIMIT ${limitLeads || 8000}`
        : sql`SELECT data FROM leads ORDER BY created_at DESC LIMIT ${limitLeads || 8000}`,
      accountId
        ? sql`SELECT data FROM events WHERE account_id = ${accountId} ORDER BY at DESC LIMIT ${limitEvents || 4000}`
        : sql`SELECT data FROM events ORDER BY at DESC LIMIT ${limitEvents || 4000}`,
      accountId
        ? sql`SELECT name, data FROM variants WHERE account_id = ${accountId}`
        : sql`SELECT name, data FROM variants`
    ]);
    const variants = {};
    variantRows.forEach((r) => {
      const clean = r.name.includes(':') ? r.name.slice(r.name.indexOf(':') + 1) : r.name;
      variants[clean] = r.data;
    });
    return {
      leads: leadRows.map((r) => r.data),
      events: eventRows.map((r) => r.data),
      variants
    };
  } catch (err) {
    console.error('[db] loadState:', err.message);
    return null;
  }
}

async function reset(accountId) {
  if (!enabled) return;
  try {
    if (accountId) {
      await sql`DELETE FROM leads WHERE account_id = ${accountId}`;
      await sql`DELETE FROM events WHERE account_id = ${accountId}`;
      await sql`DELETE FROM variants WHERE account_id = ${accountId}`;
      await sql`DELETE FROM sessions WHERE account_id = ${accountId}`;
    } else {
      await sql`TRUNCATE leads, events, variants, sessions`;
    }
  } catch (err) { console.error('[db] reset:', err.message); }
}

// ── Sessões ao vivo (heartbeat, por conta) ────────────────────────────────
async function upsertSession(accountId, s) {
  if (!enabled || !s || !s.visitorId) return;
  try {
    await sql`INSERT INTO sessions (visitor_id, account_id, page, referrer, country, country_name, city, ua, ip, variant, first_seen, last_seen, pageviews)
      VALUES (${s.visitorId}, ${accountId || null}, ${s.page || null}, ${s.referrer || null}, ${s.country || null},
              ${s.countryName || null}, ${s.city || null}, ${s.ua || null}, ${s.ip || null},
              ${s.variant || null}, now(), now(), 1)
      ON CONFLICT (visitor_id) DO UPDATE SET
        page = EXCLUDED.page, referrer = COALESCE(sessions.referrer, EXCLUDED.referrer),
        country = COALESCE(EXCLUDED.country, sessions.country),
        country_name = COALESCE(EXCLUDED.country_name, sessions.country_name),
        city = COALESCE(EXCLUDED.city, sessions.city),
        ua = COALESCE(sessions.ua, EXCLUDED.ua),
        ip = COALESCE(sessions.ip, EXCLUDED.ip),
        variant = COALESCE(EXCLUDED.variant, sessions.variant),
        account_id = COALESCE(sessions.account_id, EXCLUDED.account_id),
        last_seen = now(),
        pageviews = sessions.pageviews + 1`;
  } catch (err) { console.error('[db] upsertSession:', err.message); }
}

// ── Config durável (por conta) ────────────────────────────────────────────
async function saveConfig(accountId, data) {
  if (!enabled || !data) return;
  const key = accountId || 'main';
  try {
    await sql`INSERT INTO config (key, data, updated_at)
      VALUES (${key}, ${JSON.stringify(data)}::jsonb, now())
      ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;
  } catch (err) { console.error('[db] saveConfig:', err.message); }
}

// Retorna { ok, data }: ok=false significa ERRO de leitura (não sobrescrever
// nada!); ok=true com data=null significa "confirmado: não há config salva".
async function loadConfig(accountId) {
  if (!enabled) return { ok: false, data: null };
  const key = accountId || 'main';
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const rows = await sql`SELECT data FROM config WHERE key = ${key} LIMIT 1`;
      return { ok: true, data: rows.length ? rows[0].data : null };
    } catch (err) {
      console.error('[db] loadConfig (tentativa ' + attempt + '/3):', err.message);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  return { ok: false, data: null };
}

// Lê as configs de TODAS as contas (para resolver domínio → conta).
async function loadAllConfigs() {
  if (!enabled) return { ok: false, data: null };
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const rows = await sql`SELECT key, data FROM config`;
      return { ok: true, data: rows };
    } catch (err) {
      console.error('[db] loadAllConfigs (tentativa ' + attempt + '/3):', err.message);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  return { ok: false, data: null };
}

// ── Pixels TikTok (por conta; PK namespaced) ──────────────────────────────
async function upsertPixel(accountId, slug, data) {
  if (!enabled || !slug) return;
  try {
    await sql`INSERT INTO pixels (slug, account_id, data, updated_at)
      VALUES (${nsKey(accountId, slug)}, ${accountId || null}, ${JSON.stringify(data)}::jsonb, now())
      ON CONFLICT (slug) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;
  } catch (err) { console.error('[db] upsertPixel:', err.message); }
}

async function deletePixel(accountId, slug) {
  if (!enabled || !slug) return;
  try {
    await sql`DELETE FROM pixels WHERE slug = ${nsKey(accountId, slug)}`;
  } catch (err) { console.error('[db] deletePixel:', err.message); }
}

// Mesmo contrato do loadConfig: { ok, data } — erro de leitura NUNCA deve
// ser tratado como "não há pixels salvos".
async function loadPixels(accountId) {
  if (!enabled) return { ok: false, data: null };
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const rows = accountId
        ? await sql`SELECT slug, data FROM pixels WHERE account_id = ${accountId}`
        : await sql`SELECT slug, data FROM pixels`;
      return {
        ok: true,
        data: rows.map((r) => {
          const clean = r.slug.includes(':') ? r.slug.slice(r.slug.indexOf(':') + 1) : r.slug;
          return { slug: clean, ...r.data };
        })
      };
    } catch (err) {
      console.error('[db] loadPixels (tentativa ' + attempt + '/3):', err.message);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  return { ok: false, data: null };
}

// Busca um pixel pelo token público (para /px/:token.js) — qualquer conta.
async function getPixelByToken(token) {
  if (!enabled || !token) return null;
  try {
    const rows = await sql`SELECT slug, account_id, data FROM pixels
      WHERE data->>'token' = ${token} LIMIT 1`;
    if (!rows.length) return null;
    const r = rows[0];
    const clean = r.slug.includes(':') ? r.slug.slice(r.slug.indexOf(':') + 1) : r.slug;
    return { slug: clean, accountId: r.account_id, ...r.data };
  } catch (err) { console.error('[db] getPixelByToken:', err.message); return null; }
}

// ── Links de checkout externos (por conta; PK namespaced) ─────────────────
async function upsertLink(accountId, slug, data) {
  if (!enabled || !slug) return;
  try {
    await sql`INSERT INTO links (slug, account_id, data, updated_at)
      VALUES (${nsKey(accountId, slug)}, ${accountId || null}, ${JSON.stringify(data)}::jsonb, now())
      ON CONFLICT (slug) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;
  } catch (err) { console.error('[db] upsertLink:', err.message); }
}

async function deleteLink(accountId, slug) {
  if (!enabled || !slug) return;
  try {
    await sql`DELETE FROM links WHERE slug = ${nsKey(accountId, slug)}`;
  } catch (err) { console.error('[db] deleteLink:', err.message); }
}

// Mesmo contrato do loadConfig: { ok, data }.
async function loadLinks(accountId) {
  if (!enabled) return { ok: false, data: null };
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const rows = accountId
        ? await sql`SELECT slug, account_id, data FROM links WHERE account_id = ${accountId}`
        : await sql`SELECT slug, account_id, data FROM links`;
      return {
        ok: true,
        data: rows.map((r) => {
          const clean = r.slug.includes(':') ? r.slug.slice(r.slug.indexOf(':') + 1) : r.slug;
          return { slug: clean, accountId: r.account_id, ...r.data };
        })
      };
    } catch (err) {
      console.error('[db] loadLinks (tentativa ' + attempt + '/3):', err.message);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  return { ok: false, data: null };
}

// ── Log de disparos CAPI (por conta) ──────────────────────────────────────
async function insertPixelEvent(accountId, evt) {
  if (!enabled || !evt || !evt.id) return;
  try {
    await sql`INSERT INTO pixel_events (id, account_id, pixel, event, event_id, lead_id, status, response, at)
      VALUES (${evt.id}, ${accountId || null}, ${evt.pixel || null}, ${evt.event || null}, ${evt.eventId || null},
              ${evt.leadId || null}, ${evt.status || null},
              ${JSON.stringify(evt.response || {})}::jsonb, ${evt.at || new Date().toISOString()})
      ON CONFLICT (id) DO NOTHING`;
  } catch (err) { console.error('[db] insertPixelEvent:', err.message); }
}

async function loadPixelEvents(accountId, limit) {
  if (!enabled) return null;
  try {
    const rows = accountId
      ? await sql`SELECT id, pixel, event, event_id, lead_id, status, response, at
          FROM pixel_events WHERE account_id = ${accountId} ORDER BY at DESC LIMIT ${limit || 200}`
      : await sql`SELECT id, pixel, event, event_id, lead_id, status, response, at
          FROM pixel_events ORDER BY at DESC LIMIT ${limit || 200}`;
    return rows;
  } catch (err) {
    console.error('[db] loadPixelEvents:', err.message);
    return null;
  }
}

// Mantém o log de disparos enxuto (padrão: 14 dias).
async function prunePixelEvents(olderThanDays) {
  if (!enabled) return 0;
  const days = Math.max(1, Number(olderThanDays) || 14);
  try {
    const rows = await sql`DELETE FROM pixel_events
      WHERE at < now() - make_interval(days => ${days})
      RETURNING id`;
    return rows.length;
  } catch (err) {
    console.error('[db] prunePixelEvents:', err.message);
    return 0;
  }
}

// ── Diagnóstico: ping real no banco (para o /api/health) ─────────────────
async function ping() {
  if (!enabled) return { ok: false, reason: 'sem DATABASE_URL' };
  try {
    const t0 = Date.now();
    await sql`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - t0 };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

// ── Manutenção: apaga sessões antigas (evita crescimento sem limite) ─────
async function pruneSessions(olderThanDays) {
  if (!enabled) return 0;
  const days = Math.max(1, Number(olderThanDays) || 30);
  try {
    const rows = await sql`DELETE FROM sessions
      WHERE last_seen < now() - make_interval(days => ${days})
      RETURNING visitor_id`;
    if (rows.length) console.log('[db] pruneSessions: ' + rows.length + ' sessões antigas removidas.');
    return rows.length;
  } catch (err) {
    console.error('[db] pruneSessions:', err.message);
    return 0;
  }
}

module.exports = {
  enabled,
  isReady: () => ready,
  init, initWithRetry,
  // contas / auth / migração
  createAccount, getAccountByEmail, getAccountById, countAccounts, claimLegacyData,
  createAuthSession, getAuthSession, deleteAuthSession, pruneAuthSessions,
  // gateways
  upsertGateway, deleteGateway, loadGateways, getGatewayByToken, touchGateway,
  // dados por conta
  upsertLead, insertEvent, upsertVariant, loadState, reset, upsertSession,
  saveConfig, loadConfig, loadAllConfigs, ping, pruneSessions,
  upsertPixel, deletePixel, loadPixels, getPixelByToken,
  upsertLink, deleteLink, loadLinks,
  insertPixelEvent, loadPixelEvents, prunePixelEvents
};
