// ── Redis (Upstash) — camada rápida para presença ao vivo e log de pixels ─
// Usa HTTP REST do @upstash/redis — sem conexão TCP persistente, funciona
// em qualquer ambiente (Railway, Vercel, Fly, VPS).
// Se as variáveis não estiverem definidas, o módulo degrada silenciosamente
// para no-op e os dados ficam apenas em memória (comportamento anterior).

let redis = null;

try {
  const { Redis } = require('@upstash/redis');
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    redis = new Redis({ url, token });
    console.log('[redis] Upstash conectado:', url.slice(0, 40) + '...');
  } else {
    console.log('[redis] Variáveis não encontradas — modo memória ativado');
  }
} catch (err) {
  console.error('[redis] Falha ao inicializar:', err.message);
}

const enabled = !!redis;

// ── TTLs ──────────────────────────────────────────────────────────────────
const TTL = {
  presence:   60,          // 60s — presença; heartbeat renova a cada ~12s
  pixelLog:   14 * 86400,  // 14 dias — log de disparos TikTok CAPI
  dedup:      2  * 3600,   // 2h  — dedup de event_id (evita redisparo)
};

// ── Presença ao vivo ───────────────────────────────────────────────────────
// Cada visitante tem uma chave "presence:<id>" com TTL de 60s.
// O heartbeat chama touchPresence() a cada ~12s, renovando o TTL.
// list() faz SCAN + MGET — rápido para ≤ 500 visitantes simultâneos.

async function touchPresence(id, data) {
  if (!enabled || !id) return false;
  try {
    await redis.set('presence:' + id, JSON.stringify(data), { ex: TTL.presence });
    return true;
  } catch (err) {
    console.error('[redis] touchPresence:', err.message);
    return false;
  }
}

async function leavePresence(id) {
  if (!enabled || !id) return;
  try { await redis.del('presence:' + id); } catch (_) {}
}

async function listPresence() {
  if (!enabled) return null;
  try {
    // SCAN incremental para não bloquear o servidor Redis
    let cursor = 0, keys = [];
    do {
      const [next, batch] = await redis.scan(cursor, { match: 'presence:*', count: 100 });
      cursor = Number(next);
      keys = keys.concat(batch);
    } while (cursor !== 0);
    if (!keys.length) return [];
    const values = await redis.mget(...keys);
    const now = Date.now();
    return values
      .filter(Boolean)
      .map((v) => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch (_) { return null; } })
      .filter(Boolean)
      .sort((a, b) => (a.idleMs || 0) - (b.idleMs || 0));
  } catch (err) {
    console.error('[redis] listPresence:', err.message);
    return null;
  }
}

// ── Log de disparos TikTok CAPI ───────────────────────────────────────────
// Cada disparo é um item numa lista Redis "pixelLog" (LPUSH + LTRIM).
// Mantemos os 500 mais recentes em memória Redis; TTL global de 14 dias
// é gerenciado via sorted set (score = timestamp Unix).

const PIXEL_LOG_KEY  = 'pixelLog';       // lista dos 500 recentes
const PIXEL_LOG_ZSET = 'pixelLogByTime'; // sorted set para expirar por data

async function pushPixelLog(entry) {
  if (!enabled) return false;
  try {
    const payload = JSON.stringify(entry);
    const score   = entry.at ? new Date(entry.at).getTime() : Date.now();
    const cut     = Date.now() - TTL.pixelLog * 1000;
    // pipeline: 4 comandos em UM roundtrip HTTP (antes eram 4 sequenciais)
    const pipe = redis.pipeline();
    pipe.lpush(PIXEL_LOG_KEY, payload);          // lista rápida para o painel
    pipe.ltrim(PIXEL_LOG_KEY, 0, 499);           // máx 500
    pipe.zadd(PIXEL_LOG_ZSET, { score, member: payload }); // índice por data
    pipe.zremrangebyscore(PIXEL_LOG_ZSET, '-inf', cut);    // TTL de 14 dias
    await pipe.exec();
    return true;
  } catch (err) {
    console.error('[redis] pushPixelLog:', err.message);
    return false;
  }
}

async function loadPixelLog(limit) {
  if (!enabled) return null;
  try {
    const raw = await redis.lrange(PIXEL_LOG_KEY, 0, (limit || 100) - 1);
    return raw.map((v) => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch (_) { return null; } }).filter(Boolean);
  } catch (err) {
    console.error('[redis] loadPixelLog:', err.message);
    return null;
  }
}

// ── Log de webhooks de conversão recebidos (gateways externos) ────────────
// Registra CADA recebimento no /api/conversion (independente do disparo CAPI),
// para o painel mostrar exatamente o que cada gateway enviou. Ring de 200.
// SEMPRE guarda em memória (funciona sem Redis); Redis adiciona persistência
// entre restarts quando disponível.
const CONV_LOG_KEY = 'conversionWebhookLog';
const convLogMem = []; // ring local — fallback e cache quente

async function pushConversionLog(entry) {
  convLogMem.unshift(entry);
  if (convLogMem.length > 200) convLogMem.length = 200;
  if (!enabled) return false;
  try {
    const pipe = redis.pipeline();
    pipe.lpush(CONV_LOG_KEY, JSON.stringify(entry));
    pipe.ltrim(CONV_LOG_KEY, 0, 199);
    await pipe.exec();
    return true;
  } catch (err) {
    console.error('[redis] pushConversionLog:', err.message);
    return false;
  }
}

async function loadConversionLog(limit) {
  const n = limit || 50;
  if (!enabled) return convLogMem.slice(0, n);
  try {
    const raw = await redis.lrange(CONV_LOG_KEY, 0, n - 1);
    const out = raw.map((v) => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch (_) { return null; } }).filter(Boolean);
    return out.length ? out : convLogMem.slice(0, n); // Redis vazio pós-flush → memória
  } catch (err) {
    console.error('[redis] loadConversionLog:', err.message);
    return convLogMem.slice(0, n);
  }
}

// ── Fila de retry da CAPI (eventos que falharam após os retries imediatos) ─
// Snapshot único em JSON: a fila é pequena (cap 300) e o snapshot evita
// divergência entre memória e Redis. Sobrevive a restarts do servidor.
const CAPI_RETRY_KEY = 'capiRetryQueue';

async function saveCapiRetryQueue(items) {
  if (!enabled) return false;
  try {
    if (!items || !items.length) { await redis.del(CAPI_RETRY_KEY); return true; }
    await redis.set(CAPI_RETRY_KEY, JSON.stringify(items.slice(0, 300)), { ex: 2 * 86400 });
    return true;
  } catch (err) {
    console.error('[redis] saveCapiRetryQueue:', err.message);
    return false;
  }
}

async function loadCapiRetryQueue() {
  if (!enabled) return null;
  try {
    const raw = await redis.get(CAPI_RETRY_KEY);
    if (!raw) return [];
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(arr) ? arr : [];
  } catch (err) {
    console.error('[redis] loadCapiRetryQueue:', err.message);
    return null;
  }
}

// ── Dedup de event_id (evita redisparo CAPI quando beacon + middleware ==) ─
async function seenEventId(eventId) {
  if (!enabled || !eventId) return false;
  try {
    // SET NX com TTL de 2h: retorna OK na 1ª vez, null nas seguintes
    const res = await redis.set('dedup:' + eventId, '1', { ex: TTL.dedup, nx: true });
    return res === null; // null = chave já existia = já visto
  } catch (err) {
    console.error('[redis] seenEventId:', err.message);
    return false; // em caso de erro, deixa passar (melhor duplicar que perder)
  }
}

// ── Cache de ASN (lookup Cymru) ────────────────────────────────────────────
// Chave "asn:<ip>" com o resultado do lookup BGP. TTL de 24h. Compartilha a
// resolução entre processos/instâncias e sobrevive a restarts, deixando o
// caminho quente do /go/ quase instantâneo para IPs recorrentes.
const ASN_TTL = 24 * 3600; // 24h

async function getAsnCache(ip) {
  if (!enabled || !ip) return null;
  try {
    const raw = await redis.get('asn:' + ip);
    if (!raw) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (_) { return null; }
}

async function setAsnCache(ip, entry) {
  if (!enabled || !ip || !entry) return false;
  try {
    await redis.set('asn:' + ip, JSON.stringify(entry), { ex: ASN_TTL });
    return true;
  } catch (_) { return false; }
}

// ── Ping de saúde ─────────────────────────────────────────────────────────
async function ping() {
  if (!enabled) return { ok: false, reason: 'desabilitado' };
  try {
    const res = await redis.ping();
    return { ok: res === 'PONG', response: res };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

module.exports = {
  enabled, redis,
  touchPresence, leavePresence, listPresence,
  pushPixelLog, loadPixelLog,
  pushConversionLog, loadConversionLog,
  saveCapiRetryQueue, loadCapiRetryQueue,
  seenEventId,
  getAsnCache, setAsnCache,
  ping, TTL
};
