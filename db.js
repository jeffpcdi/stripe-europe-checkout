// ── Camada de persistência (Neon Postgres) ──────────────────────────────
// Guarda leads, eventos, contadores de variantes e sessões ao vivo de forma
// DURÁVEL. O stats.js continua com a API síncrona (arquivo local como cache
// quente) e faz "write-through" assíncrono para cá. No boot, hidratamos o
// cache a partir do banco — assim os dados sobrevivem a deploys/reinícios e
// acumulam ao longo de vários dias.
const { neon } = require('@neondatabase/serverless');

const URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || null;
const enabled = !!URL;
const sql = enabled ? neon(URL) : null;

if (!enabled) {
  console.warn('[db] DATABASE_URL não definido — persistência desativada (modo só-arquivo).');
}

let ready = false;

// Cria as tabelas se ainda não existirem. Idempotente.
async function init() {
  if (!enabled) return false;
  try {
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

    // Config da dashboard (chave única 'main') — sobrevive a deploys.
    await sql`CREATE TABLE IF NOT EXISTS config (
      key text PRIMARY KEY,
      data jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;

    // Pixels TikTok (backup durável dos arquivos pixels/*.json).
    await sql`CREATE TABLE IF NOT EXISTS pixels (
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

    ready = true;
    console.log('[db] Neon pronto (tabelas verificadas).');
    return true;
  } catch (err) {
    console.error('[db] Erro ao inicializar:', err.message);
    return false;
  }
}

// ── Leads / eventos / variantes (write-through) ───────────────────────────
async function upsertLead(lead) {
  if (!enabled || !lead || !lead.id) return;
  try {
    await sql`INSERT INTO leads (id, data, stage, status, gateway, country, country_name, orphan, created_at, updated_at)
      VALUES (${lead.id}, ${JSON.stringify(lead)}::jsonb, ${lead.stage || null}, ${lead.status || null},
              ${lead.gateway || null}, ${lead.country || null}, ${lead.countryName || null},
              ${!!lead.orphan}, ${lead.at || new Date().toISOString()}, now())
      ON CONFLICT (id) DO UPDATE SET
        data = EXCLUDED.data, stage = EXCLUDED.stage, status = EXCLUDED.status,
        gateway = EXCLUDED.gateway, country = EXCLUDED.country, country_name = EXCLUDED.country_name,
        orphan = EXCLUDED.orphan, updated_at = now()`;
  } catch (err) { console.error('[db] upsertLead:', err.message); }
}

async function insertEvent(evt) {
  if (!enabled || !evt || !evt.id) return;
  try {
    await sql`INSERT INTO events (id, type, at, data)
      VALUES (${evt.id}, ${evt.type || 'info'}, ${evt.at || new Date().toISOString()}, ${JSON.stringify(evt)}::jsonb)
      ON CONFLICT (id) DO NOTHING`;
  } catch (err) { console.error('[db] insertEvent:', err.message); }
}

async function upsertVariant(name, data) {
  if (!enabled || !name) return;
  try {
    await sql`INSERT INTO variants (name, data, updated_at)
      VALUES (${name}, ${JSON.stringify(data)}::jsonb, now())
      ON CONFLICT (name) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;
  } catch (err) { console.error('[db] upsertVariant:', err.message); }
}

// Carrega o estado persistido para hidratar o cache quente no boot.
async function loadState(limitLeads, limitEvents) {
  if (!enabled) return null;
  try {
    const [leadRows, eventRows, variantRows] = await Promise.all([
      sql`SELECT data FROM leads ORDER BY created_at DESC LIMIT ${limitLeads || 8000}`,
      sql`SELECT data FROM events ORDER BY at DESC LIMIT ${limitEvents || 4000}`,
      sql`SELECT name, data FROM variants`
    ]);
    const variants = {};
    variantRows.forEach((r) => { variants[r.name] = r.data; });
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

async function reset() {
  if (!enabled) return;
  try {
    await sql`TRUNCATE leads, events, variants, sessions`;
  } catch (err) { console.error('[db] reset:', err.message); }
}

// ── Sessões ao vivo (heartbeat) ───────────────────────────────────────────
async function upsertSession(s) {
  if (!enabled || !s || !s.visitorId) return;
  try {
    await sql`INSERT INTO sessions (visitor_id, page, referrer, country, country_name, city, ua, ip, variant, first_seen, last_seen, pageviews)
      VALUES (${s.visitorId}, ${s.page || null}, ${s.referrer || null}, ${s.country || null},
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
        last_seen = now(),
        pageviews = sessions.pageviews + 1`;
  } catch (err) { console.error('[db] upsertSession:', err.message); }
}

// ── Config durável (dashboard) ────────────────────────────────────────────
async function saveConfig(data) {
  if (!enabled || !data) return;
  try {
    await sql`INSERT INTO config (key, data, updated_at)
      VALUES ('main', ${JSON.stringify(data)}::jsonb, now())
      ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;
  } catch (err) { console.error('[db] saveConfig:', err.message); }
}

async function loadConfig() {
  if (!enabled) return null;
  try {
    const rows = await sql`SELECT data FROM config WHERE key = 'main' LIMIT 1`;
    return rows.length ? rows[0].data : null;
  } catch (err) {
    console.error('[db] loadConfig:', err.message);
    return null;
  }
}

// ── Pixels TikTok (espelho durável dos arquivos pixels/*.json) ───────────
async function upsertPixel(slug, data) {
  if (!enabled || !slug) return;
  try {
    await sql`INSERT INTO pixels (slug, data, updated_at)
      VALUES (${slug}, ${JSON.stringify(data)}::jsonb, now())
      ON CONFLICT (slug) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;
  } catch (err) { console.error('[db] upsertPixel:', err.message); }
}

async function deletePixel(slug) {
  if (!enabled || !slug) return;
  try {
    await sql`DELETE FROM pixels WHERE slug = ${slug}`;
  } catch (err) { console.error('[db] deletePixel:', err.message); }
}

async function loadPixels() {
  if (!enabled) return null;
  try {
    const rows = await sql`SELECT slug, data FROM pixels`;
    return rows.map((r) => ({ slug: r.slug, ...r.data }));
  } catch (err) {
    console.error('[db] loadPixels:', err.message);
    return null;
  }
}

// ── Log de disparos CAPI ──────────────────────────────────────────────────
async function insertPixelEvent(evt) {
  if (!enabled || !evt || !evt.id) return;
  try {
    await sql`INSERT INTO pixel_events (id, pixel, event, event_id, lead_id, status, response, at)
      VALUES (${evt.id}, ${evt.pixel || null}, ${evt.event || null}, ${evt.eventId || null},
              ${evt.leadId || null}, ${evt.status || null},
              ${JSON.stringify(evt.response || {})}::jsonb, ${evt.at || new Date().toISOString()})
      ON CONFLICT (id) DO NOTHING`;
  } catch (err) { console.error('[db] insertPixelEvent:', err.message); }
}

async function loadPixelEvents(limit) {
  if (!enabled) return null;
  try {
    const rows = await sql`SELECT id, pixel, event, event_id, lead_id, status, response, at
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
  init, upsertLead, insertEvent, upsertVariant, loadState, reset, upsertSession,
  saveConfig, loadConfig, ping, pruneSessions,
  upsertPixel, deletePixel, loadPixels,
  insertPixelEvent, loadPixelEvents, prunePixelEvents
};
