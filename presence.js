// ── Presença ao vivo (quem está navegando AGORA) ─────────────────────────
// V16.12: a identidade de sessão é SEMPRE (accountId + visitorId). Isso vale
// para memória, Upstash e Neon; visitorId sozinho nunca atravessa tenants.
const db  = require('./db');
const rdb = require('./redis');

const ONLINE_WINDOW = 35 * 1000; // 35s sem heartbeat = offline
const DB_WRITE_INTERVAL = 60 * 1000; // grava no Neon no máx. 1x/min por sessão
const live = new Map(); // `${accountId}\x1f${visitorId}` -> sessão

function normalizeAccountId(accountId) {
  return String(accountId || '');
}

function sessionKey(accountId, visitorId) {
  return normalizeAccountId(accountId) + '\x1f' + String(visitorId || '');
}

// Registra/atualiza um heartbeat de um visitante.
function touch(data) {
  data = data || {};
  const id = data.visitorId;
  if (!id) return null;
  const acc = normalizeAccountId(data.acc);
  const key = sessionKey(acc, id);
  const now = Date.now();
  let s = live.get(key);
  if (!s) {
    s = {
      visitorId: id,
      acc,
      firstSeen: now,
      pageviews: 0,
      country: null, countryName: null, city: null,
      page: null, referrer: null, ua: null, ip: null, variant: null
    };
    live.set(key, s);
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

  const redisPayload = {
    id: s.visitorId, acc: s.acc, page: s.page, referrer: s.referrer,
    country: s.country, countryName: s.countryName, city: s.city,
    variant: s.variant, ua: s.ua, pageviews: s.pageviews,
    durationMs: now - s.firstSeen, idleMs: 0
  };
  rdb.touchPresence(s.acc, s.visitorId, redisPayload); // non-blocking

  // Neon: grava apenas na 1ª vez, mudança de página ou a cada intervalo.
  if (!s._lastDbWrite || pageChanged || (now - s._lastDbWrite) >= DB_WRITE_INTERVAL) {
    s._lastDbWrite = now;
    db.upsertSession(s.acc, s);
  }
  return s;
}

// Marca saída imediata (beacon no unload/visibilitychange), sempre por conta.
function leave(accountId, id) {
  if (!id) return;
  const acc = normalizeAccountId(accountId);
  live.delete(sessionKey(acc, id));
  rdb.leavePresence(acc, id); // remove somente a sessão daquele tenant
}

// Remove sessões expiradas do mapa em memória.
function prune() {
  const cut = Date.now() - ONLINE_WINDOW;
  for (const [key, s] of live) {
    if (s.lastSeen < cut) live.delete(key);
  }
}

// Lista de visitantes online agora (ordenada por mais recente).
async function list(accountId) {
  prune();
  const now = Date.now();
  const acc = normalizeAccountId(accountId);

  const localMap = new Map();
  for (const s of live.values()) {
    if (s.acc !== acc) continue;
    localMap.set(s.visitorId, {
      id: s.visitorId,
      acc: s.acc,
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

  // Upstash já escaneia APENAS o namespace da conta, evitando SCAN global.
  if (rdb.enabled) {
    try {
      const redisRows = await rdb.listPresence(acc);
      if (redisRows) {
        for (const r of redisRows) {
          if (r.acc !== acc) continue; // defesa em profundidade
          if (r.id && !localMap.has(r.id)) localMap.set(r.id, r);
        }
      }
    } catch (_) {}
  }

  return [...localMap.values()].sort((a, b) => (a.idleMs || 0) - (b.idleMs || 0));
}

async function summary(accountId) {
  const rows = await list(accountId);
  const byCountry = {};
  const byEntry = {};
  rows.forEach((r) => {
    if (r.country) {
      if (!byCountry[r.country]) byCountry[r.country] = { code: r.country, name: r.countryName || r.country, count: 0 };
      byCountry[r.country].count++;
    }
    let entry = 'outros';
    if (r.page) {
      try {
        const path = r.page.startsWith('http') ? new URL(r.page).pathname : r.page;
        const m = path.match(/^\/(go|c)\/([^/?#]+)/);
        entry = m ? '/' + m[1] + '/' + m[2] : path.split('?')[0].slice(0, 40) || 'outros';
      } catch (_) { entry = 'outros'; }
    }
    if (!byEntry[entry]) byEntry[entry] = { entry, count: 0 };
    byEntry[entry].count++;
  });
  return {
    online: rows.length,
    countries: Object.values(byCountry).sort((a, b) => b.count - a.count),
    byEntry: Object.values(byEntry).sort((a, b) => b.count - a.count).slice(0, 12)
  };
}

module.exports = { touch, leave, prune, list, summary, sessionKey };
