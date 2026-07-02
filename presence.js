// ── Presença ao vivo (quem está navegando AGORA) ─────────────────────────
// Mapa em memória keyed por visitor id (rápido, tempo real). Cada página do
// funil envia um "heartbeat" a cada ~12s. Consideramos online quem foi visto
// nos últimos ONLINE_WINDOW ms.
// Camada durável dupla:
//   1. Upstash Redis — presença com TTL de 60s (sobrevive a restarts, ~1ms)
//   2. Neon — histórico de sessões para analytics
const db    = require('./db');
const rdb   = require('./redis');

const ONLINE_WINDOW = 35 * 1000; // 35s sem heartbeat = offline
const DB_WRITE_INTERVAL = 60 * 1000; // grava no Neon no máx. 1x/min por sessão
const live = new Map();          // visitorId -> sessão

// Registra/atualiza um heartbeat de um visitante.
function touch(data) {
  data = data || {};
  const id = data.visitorId;
  if (!id) return null;
  const now = Date.now();
  let s = live.get(id);
  if (!s) {
    s = {
      visitorId: id,
      firstSeen: now,
      pageviews: 0,
      country: null, countryName: null, city: null,
      page: null, referrer: null, ua: null, ip: null, variant: null
    };
    live.set(id, s);
  }
  // atualiza campos (mantém geo já conhecido se não vier)
  let pageChanged = false;
  if (data.page) { if (data.page !== s.page) { s.pageviews++; pageChanged = true; } s.page = data.page; }
  if (data.referrer && !s.referrer) s.referrer = data.referrer;
  if (data.country) s.country = data.country;
  if (data.countryName) s.countryName = data.countryName;
  if (data.city) s.city = data.city;
  if (data.ua) s.ua = data.ua;
  if (data.ip) s.ip = data.ip;
  if (data.variant) s.variant = data.variant;
  s.lastSeen = now;
  if (!s.pageviews) s.pageviews = 1;

  // Upstash Redis: renova TTL de 60s a cada heartbeat (~12s) — sobrevive
  // a restarts do servidor sem perder quem está online agora.
  const redisPayload = {
    id: s.visitorId, page: s.page, referrer: s.referrer,
    country: s.country, countryName: s.countryName, city: s.city,
    variant: s.variant, ua: s.ua, pageviews: s.pageviews,
    durationMs: now - s.firstSeen, idleMs: 0
  };
  rdb.touchPresence(s.visitorId, redisPayload); // non-blocking

  // Neon: grava apenas na 1ª vez, mudança de página ou a cada DB_WRITE_INTERVAL
  if (!s._lastDbWrite || pageChanged || (now - s._lastDbWrite) >= DB_WRITE_INTERVAL) {
    s._lastDbWrite = now;
    db.upsertSession(s);
  }
  return s;
}

// Marca saída imediata (beacon no unload/visibilitychange).
function leave(id) {
  if (!id) return;
  live.delete(id);
  rdb.leavePresence(id); // remove do Redis imediatamente
}

// Remove sessões expiradas do mapa em memória.
function prune() {
  const cut = Date.now() - ONLINE_WINDOW;
  for (const [id, s] of live) {
    if (s.lastSeen < cut) live.delete(id);
  }
}

// Lista de visitantes online agora (ordenada por mais recente).
// Retorna Promise quando Redis está ativo (dados mesclados), array síncrono
// quando só há memória local. O caller (server.js /api/live) usa await.
async function list() {
  prune();
  const now = Date.now();

  // mapa local (sempre disponível, mais fresco)
  const localMap = new Map();
  for (const s of live.values()) {
    localMap.set(s.visitorId, {
      id: s.visitorId,
      page: s.page,
      referrer: s.referrer,
      country: s.country,
      countryName: s.countryName,
      city: s.city,
      variant: s.variant,
      ua: s.ua,
      pageviews: s.pageviews || 1,
      durationMs: now - s.firstSeen,
      idleMs: now - s.lastSeen
    });
  }

  // Redis: acrescenta quem sobreviveu a um restart (não está em memória local)
  if (rdb.enabled) {
    try {
      const redisRows = await rdb.listPresence();
      if (redisRows) {
        for (const r of redisRows) {
          if (r.id && !localMap.has(r.id)) localMap.set(r.id, r);
        }
      }
    } catch (_) {}
  }

  return [...localMap.values()].sort((a, b) => (a.idleMs || 0) - (b.idleMs || 0));
}

// Resumo por país (para o globo) + contagem total.
async function summary() {
  const rows = await list();
  const byCountry = {};
  rows.forEach((r) => {
    if (!r.country) return;
    if (!byCountry[r.country]) byCountry[r.country] = { code: r.country, name: r.countryName || r.country, count: 0 };
    byCountry[r.country].count++;
  });
  return {
    online: rows.length,
    countries: Object.values(byCountry).sort((a, b) => b.count - a.count)
  };
}

module.exports = { touch, leave, prune, list, summary };
