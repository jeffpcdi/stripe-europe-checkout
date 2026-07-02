// ── Presença ao vivo (quem está navegando AGORA) ─────────────────────────
// Mapa em memória keyed por visitor id (rápido, tempo real). Cada página do
// funil envia um "heartbeat" a cada ~12s. Consideramos online quem foi visto
// nos últimos ONLINE_WINDOW ms. Também gravamos as sessões no Neon (via db)
// para manter histórico durável de vários dias.
const db = require('./db');

const ONLINE_WINDOW = 35 * 1000; // 35s sem heartbeat = offline
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
  if (data.page) { if (data.page !== s.page) s.pageviews++; s.page = data.page; }
  if (data.referrer && !s.referrer) s.referrer = data.referrer;
  if (data.country) s.country = data.country;
  if (data.countryName) s.countryName = data.countryName;
  if (data.city) s.city = data.city;
  if (data.ua) s.ua = data.ua;
  if (data.ip) s.ip = data.ip;
  if (data.variant) s.variant = data.variant;
  s.lastSeen = now;
  if (!s.pageviews) s.pageviews = 1;

  // write-through durável (não bloqueia)
  db.upsertSession(s);
  return s;
}

// Marca saída imediata (beacon no unload/visibilitychange).
function leave(id) {
  if (id) live.delete(id);
}

// Remove sessões expiradas do mapa em memória.
function prune() {
  const cut = Date.now() - ONLINE_WINDOW;
  for (const [id, s] of live) {
    if (s.lastSeen < cut) live.delete(id);
  }
}

// Lista de visitantes online agora (ordenada por mais recente).
function list() {
  prune();
  const now = Date.now();
  const arr = [];
  for (const s of live.values()) {
    arr.push({
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
  arr.sort((a, b) => a.idleMs - b.idleMs);
  return arr;
}

// Resumo por país (para o globo) + contagem total.
function summary() {
  const rows = list();
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
