// ── Redis (Upstash) — camada rápida para presença ao vivo e log de pixels ─
// Usa HTTP REST do @upstash/redis — sem conexão TCP persistente, funciona
// em qualquer ambiente (Railway, Vercel, Fly, VPS).
// Se as variáveis não estiverem definidas, o módulo degrada silenciosamente
// para no-op e os dados ficam apenas em memória (comportamento anterior).

let redis = null;

try {
  const { Redis } = require('@upstash/redis');
  // Aceita os nomes padrão da Upstash e os aliases KV_* (Vercel KV / Railway)
  const url   = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
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

// ── Idempotência de webhook por order_id (item 45/114) ─────────────────────
// Gateways reenviam webhooks (retry) — sem dedup, o MESMO pagamento dispararia
// CompletePayment duplicado. Chave por conta+evento+pedido com TTL de 24h.
// Fallback em memória quando o Redis está off (protege ao menos o processo).
const _memWebhookDedup = new Map(); // key → expiraEm(ms)
function _memSeen(key, ttlMs) {
  const now = Date.now();
  // limpeza oportunista para não crescer sem limite
  if (_memWebhookDedup.size > 5000) {
    for (const [k, exp] of _memWebhookDedup) { if (exp < now) _memWebhookDedup.delete(k); }
  }
  const exp = _memWebhookDedup.get(key);
  if (exp && exp > now) return true;
  _memWebhookDedup.set(key, now + ttlMs);
  return false;
}

async function seenWebhookOrder(accountId, event, orderId) {
  if (!orderId) return false; // sem order_id não há como deduplicar
  const key = 'whdedup:' + (accountId || 'default') + ':' + String(event || '') + ':' + String(orderId).slice(0, 120);
  if (!enabled) return _memSeen(key, 24 * 3600 * 1000);
  try {
    const res = await redis.set(key, '1', { ex: 24 * 3600, nx: true });
    return res === null; // null = já visto
  } catch (err) {
    console.error('[redis] seenWebhookOrder:', err.message);
    return _memSeen(key, 24 * 3600 * 1000);
  }
}

// ── Cache de ASN (lookup Cymru) ──────────────────────────────────────��─────
// Chave "asn:<ip>" com o resultado do lookup BGP. TTL de 24h. Compartilha a
// resolução entre processos/instâncias e sobrevive a restarts, deixando o
// caminho quente do /go/ quase instantâneo para IPs recorrentes.
const ASN_TTL = 24 * 3600; // 24h (hit válido: asn > 0)
// Item 176: cache negativo curto também no Redis — um lookup sem ASN resolvido
// (asn:0/unknown/timeout) não pode ficar 24h fixado, senão um datacenter cujo
// primeiro lookup falhou passaria o dia inteiro como neutro em todas as instâncias.
const ASN_NEG_TTL = 5 * 60; // 5 minutos

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
    const ttl = (entry.asn > 0) ? ASN_TTL : ASN_NEG_TTL;
    await redis.set('asn:' + ip, JSON.stringify(entry), { ex: ttl });
    return true;
  } catch (_) { return false; }
}

// ── Contadores de decisão do cloaker (offer vs white) ─────────────────────
// Um hash por link: "cloakstats:<accountId>:<slug>". Campos:
//   offer, white                          → totais
//   d:<YYYY-MM-DD>:offer / :white         → série diária (para o painel)
//   r:<motivo>                            → contagem por motivo do desvio à white
// Durável, multi-instância e atômico via HINCRBY; fallback em memória sem Redis.
const cloakStatsMem = new Map(); // key -> { field: number }
function cloakKey(accountId, slug) { return 'cloakstats:' + (accountId || 'default') + ':' + slug; }
function todayUTC() { return new Date().toISOString().slice(0, 10); }

async function bumpCloakDecision(accountId, slug, decision, reason) {
  if (!slug) return false;
  const key = cloakKey(accountId, slug);
  const day = todayUTC();
  const dec = decision === 'offer' ? 'offer' : 'white';
  const fields = [dec, 'd:' + day + ':' + dec];
  if (dec === 'white' && reason) fields.push('r:' + String(reason).slice(0, 40));
  if (!enabled) {
    const h = cloakStatsMem.get(key) || {};
    fields.forEach((f) => { h[f] = (h[f] || 0) + 1; });
    h._ts = Date.now();
    cloakStatsMem.set(key, h);
    return true;
  }
  try {
    const pipe = redis.pipeline();
    fields.forEach((f) => pipe.hincrby(key, f, 1));
    pipe.expire(key, 90 * 86400); // retenção de 90 dias
    await pipe.exec();
    return true;
  } catch (err) {
    console.error('[redis] bumpCloakDecision:', err.message);
    return false;
  }
}

async function getCloakStats(accountId, slug) {
  const key = cloakKey(accountId, slug);
  if (!enabled) return normalizeCloakHash(cloakStatsMem.get(key) || {});
  try {
    const h = await redis.hgetall(key);
    return normalizeCloakHash(h || {});
  } catch (err) {
    console.error('[redis] getCloakStats:', err.message);
    return normalizeCloakHash({});
  }
}

// Converte o hash cru em { offer, white, total, offerRate, reasons{}, daily[] }
function normalizeCloakHash(h) {
  const num = (v) => { const n = parseInt(v, 10); return isNaN(n) ? 0 : n; };
  const offer = num(h.offer), white = num(h.white), total = offer + white;
  const reasons = {}; const dailyMap = {};
  Object.keys(h).forEach((k) => {
    if (k.startsWith('r:')) reasons[k.slice(2)] = num(h[k]);
    else if (k.startsWith('d:')) {
      const rest = k.slice(2); const i = rest.lastIndexOf(':');
      const day = rest.slice(0, i), kind = rest.slice(i + 1);
      dailyMap[day] = dailyMap[day] || { day, offer: 0, white: 0 };
      dailyMap[day][kind] = num(h[k]);
    }
  });
  const daily = Object.values(dailyMap).sort((a, b) => a.day < b.day ? -1 : 1);
  return { offer, white, total, offerRate: total ? offer / total : 0, reasons, daily };
}

async function resetCloakStats(accountId, slug) {
  const key = cloakKey(accountId, slug);
  cloakStatsMem.delete(key);
  cloakLogMem.delete(cloakLogKey(accountId, slug)); // Item 170: zera o log junto
  if (!enabled) return true;
  try { await redis.del(key); await redis.del(cloakLogKey(accountId, slug)); return true; }
  catch (err) { console.error('[redis] resetCloakStats:', err.message); return false; }
}

// ── Item 170: histórico das últimas N decisões por link (observabilidade) ──
// Lista limitada "cloaklog:<accountId>:<slug>" (mais recente à frente). Guarda
// só o necessário para depurar SEM expor PII: IP com último octeto mascarado,
// UA truncado, decisão, score, motivo e timestamp. LTRIM mantém o teto e um
// TTL evita acúmulo. Fallback em memória (array) quando não há Redis.
const CLOAK_LOG_MAX = 50;
const cloakLogMem = new Map(); // key -> [entry, ...] (mais recente à frente)
function cloakLogKey(accountId, slug) { return 'cloaklog:' + (accountId || 'default') + ':' + slug; }

// Mascara o último octeto de IPv4 e o sufixo de IPv6 — observabilidade sem PII
function maskIp(ip) {
  const s = String(ip || '').trim();
  if (!s) return '';
  if (s.includes('.')) return s.replace(/\.\d+$/, '.x'); // 1.2.3.4 → 1.2.3.x
  if (s.includes(':')) { const p = s.split(':'); return p.slice(0, 3).join(':') + '::x'; }
  return s;
}

async function pushCloakDecision(accountId, slug, entry) {
  if (!slug || !entry) return false;
  const key = cloakLogKey(accountId, slug);
  const row = {
    at: Date.now(),
    decision: entry.decision === 'offer' ? 'offer' : 'white',
    reason: entry.reason ? String(entry.reason).slice(0, 40) : '',
    score: typeof entry.score === 'number' ? entry.score : null,
    ip: maskIp(entry.ip),
    ua: String(entry.ua || '').slice(0, 120),
    country: entry.country ? String(entry.country).slice(0, 2).toUpperCase() : '',
  };
  if (!enabled) {
    const arr = cloakLogMem.get(key) || [];
    arr.unshift(row);
    if (arr.length > CLOAK_LOG_MAX) arr.length = CLOAK_LOG_MAX;
    cloakLogMem.set(key, arr);
    return true;
  }
  try {
    const pipe = redis.pipeline();
    pipe.lpush(key, JSON.stringify(row));
    pipe.ltrim(key, 0, CLOAK_LOG_MAX - 1);
    pipe.expire(key, 30 * 86400); // 30 dias
    await pipe.exec();
    return true;
  } catch (err) {
    console.error('[redis] pushCloakDecision:', err.message);
    return false;
  }
}

async function getCloakDecisionLog(accountId, slug) {
  const key = cloakLogKey(accountId, slug);
  if (!enabled) return (cloakLogMem.get(key) || []).slice(0, CLOAK_LOG_MAX);
  try {
    const rows = await redis.lrange(key, 0, CLOAK_LOG_MAX - 1);
    return (rows || []).map((r) => { try { return JSON.parse(r); } catch (_) { return null; } }).filter(Boolean);
  } catch (err) {
    console.error('[redis] getCloakDecisionLog:', err.message);
    return [];
  }
}

// ── Fila DURÁVEL de conversões (webhook → processamento) ──────────────────
// O webhook responde 200 ao gateway e SÓ ENTÃO processa (resolve lead, dispara
// CAPI). Sem durabilidade, um restart nesse intervalo PERDE a venda paga — o
// gateway já recebeu 200 e não reenvia. Aqui a conversão é gravada numa lista
// Redis ANTES do 200; um worker consome e confirma. Como processConversion é
// idempotente (dedup por event_id), reprocessar após crash nunca duplica.
//   convQ       : fila principal (LPUSH na cabeça, consumo pela cauda = FIFO)
//   convQ:proc  : itens reservados/em processamento (reclaim por idade)
const CONV_QUEUE = 'convQ';
const CONV_PROC  = 'convQ:proc';
const CONV_QUEUE_CAP = 5000;

async function enqueueConversion(n) {
  if (!enabled) return false;
  try {
    const env = { qid: (redisRandId()), at: Date.now(), n };
    const pipe = redis.pipeline();
    pipe.lpush(CONV_QUEUE, JSON.stringify(env));
    pipe.ltrim(CONV_QUEUE, 0, CONV_QUEUE_CAP - 1);
    await pipe.exec();
    return true;
  } catch (err) {
    console.error('[redis] enqueueConversion:', err.message);
    return false;
  }
}

// Move até `max` itens da fila para a lista de processamento (atômico por item
// via RPOPLPUSH) e devolve [{ raw, env }]. `raw` é usado para dar ack via LREM.
async function reserveConversions(max) {
  if (!enabled) return [];
  const out = [];
  try {
    for (let i = 0; i < (max || 20); i++) {
      // LMOVE origem→destino RIGHT→LEFT = equivalente ao antigo RPOPLPUSH:
      // remove o item mais ANTIGO (cauda, pois usamos LPUSH) e reserva em :proc
      const raw = await redis.lmove(CONV_QUEUE, CONV_PROC, 'right', 'left');
      if (raw == null) break;
      let env = null;
      try { env = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (_) { env = null; }
      out.push({ raw, env });
    }
  } catch (err) {
    console.error('[redis] reserveConversions:', err.message);
  }
  return out;
}

// Confirma o processamento de um item — remove-o da lista de processamento.
async function ackConversion(raw) {
  if (!enabled || raw == null) return;
  try { await redis.lrem(CONV_PROC, 1, raw); } catch (err) { console.error('[redis] ackConversion:', err.message); }
}

// Requeue de itens presos em convQ:proc (worker morreu no meio). Só reprocessa
// os mais velhos que `olderThanMs` — evita brigar com um processamento em curso.
async function reclaimConversions(olderThanMs) {
  if (!enabled) return 0;
  try {
    const items = await redis.lrange(CONV_PROC, 0, -1);
    if (!items || !items.length) return 0;
    const now = Date.now();
    const cut = olderThanMs || 120000;
    let moved = 0;
    for (const raw of items) {
      let env = null;
      try { env = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (_) { env = null; }
      const at = env && env.at ? env.at : 0;
      if (now - at > cut) {
        const pipe = redis.pipeline();
        pipe.lrem(CONV_PROC, 1, raw);
        pipe.lpush(CONV_QUEUE, raw);
        await pipe.exec();
        moved++;
      }
    }
    return moved;
  } catch (err) {
    console.error('[redis] reclaimConversions:', err.message);
    return 0;
  }
}

async function convQueueDepth() {
  if (!enabled) return { queue: 0, processing: 0 };
  try {
    const [q, p] = await Promise.all([redis.llen(CONV_QUEUE), redis.llen(CONV_PROC)]);
    return { queue: Number(q) || 0, processing: Number(p) || 0 };
  } catch (_) { return { queue: 0, processing: 0 }; }
}

// ── Veredito "sticky" do cloaker (consistência por visitante) ─────────────
// SOMENTE unidirecional para BOT: quando o judge condena um visitante, o
// veredito fica cacheado por TTL. Visitas seguintes do mesmo v_id vão direto à
// white sem re-rodar o judge (mais barato e SEM oscilar offer↔white). Nunca
// cacheamos 'real' → um bot jamais fica "presRealo" como real (fail-safe).
const STICKY_BOT_TTL = 6 * 3600; // 6h

async function setStickyBot(vid, info) {
  if (!enabled || !vid) return false;
  try {
    await redis.set('cloakbot:' + vid, JSON.stringify(info || { at: Date.now() }), { ex: STICKY_BOT_TTL });
    return true;
  } catch (_) { return false; }
}

async function getStickyBot(vid) {
  if (!enabled || !vid) return null;
  try {
    const raw = await redis.get('cloakbot:' + vid);
    if (!raw) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (_) { return null; }
}

// ── Lock distribuído (SET NX EX) ──────────────────────────────────────────
// Garante que só UMA instância execute uma seção crítica (ex.: drenar a fila
// de retry da CAPI) — sem isso, N instâncias disparam o MESMO evento N vezes.
async function acquireLock(name, ttlSec) {
  if (!enabled) return true; // sem Redis = processo único = já é exclusivo
  try {
    const res = await redis.set('lock:' + name, String(Date.now()), { ex: ttlSec || 55, nx: true });
    return res !== null; // OK = adquiriu; null = já travado por outra instância
  } catch (_) { return true; } // erro de rede: não bloqueia o trabalho
}

async function releaseLock(name) {
  if (!enabled || !name) return;
  try { await redis.del('lock:' + name); } catch (_) {}
}

// ── Rollup de EMQ (Event Match Quality) por pixel e por dia ───────────────
// Cada disparo da CAPI carrega um score 0–10 de identidade. Guardamos soma +
// contagem por pixel/dia num hash — permite o painel plotar a TENDÊNCIA e
// alertar quando o EMQ despenca (otimização do TikTok cai em silêncio).
//   emq:<acc>:<pixel>  →  d:<YYYY-MM-DD>:sum / d:<YYYY-MM-DD>:cnt
const emqMem = new Map(); // fallback sem Redis
function emqKey(acc, pixel) { return 'emq:' + (acc || 'default') + ':' + (pixel || 'unknown'); }

async function bumpEmq(acc, pixel, score) {
  if (pixel == null || score == null || isNaN(score)) return false;
  const key = emqKey(acc, pixel);
  const day = todayUTC();
  if (!enabled) {
    const h = emqMem.get(key) || {};
    h['d:' + day + ':sum'] = (h['d:' + day + ':sum'] || 0) + Number(score);
    h['d:' + day + ':cnt'] = (h['d:' + day + ':cnt'] || 0) + 1;
    emqMem.set(key, h);
    return true;
  }
  try {
    const pipe = redis.pipeline();
    pipe.hincrbyfloat(key, 'd:' + day + ':sum', Number(score));
    pipe.hincrby(key, 'd:' + day + ':cnt', 1);
    pipe.expire(key, 40 * 86400); // retém ~40 dias
    await pipe.exec();
    return true;
  } catch (err) {
    console.error('[redis] bumpEmq:', err.message);
    return false;
  }
}

// Retorna série diária [{ day, avg, count }] dos últimos `days` para um pixel.
async function getEmqTrend(acc, pixel, days) {
  const key = emqKey(acc, pixel);
  const h = !enabled ? (emqMem.get(key) || {}) : await redis.hgetall(key).catch(() => ({}));
  return normalizeEmqHash(h || {}, days || 14);
}

function normalizeEmqHash(h, days) {
  const map = {};
  Object.keys(h).forEach((k) => {
    const m = /^d:(\d{4}-\d{2}-\d{2}):(sum|cnt)$/.exec(k);
    if (!m) return;
    const day = m[1];
    map[day] = map[day] || { day, sum: 0, cnt: 0 };
    map[day][m[2] === 'sum' ? 'sum' : 'cnt'] = Number(h[k]) || 0;
  });
  const rows = Object.values(map)
    .map((r) => ({ day: r.day, avg: r.cnt ? Math.round((r.sum / r.cnt) * 10) / 10 : 0, count: r.cnt }))
    .sort((a, b) => (a.day < b.day ? -1 : 1));
  return rows.slice(-days);
}

function redisRandId() {
  try { return require('crypto').randomBytes(8).toString('hex'); }
  catch (_) { return String(Date.now()) + Math.random().toString(36).slice(2, 8); }
}

// ── ttclid: uso único por contexto ────────────────────────────────────────
// O TikTok anexa um ttclid ÚNICO a cada clique no anúncio. Um revisor que copia
// a URL capturada reusa o MESMO ttclid de outro dispositivo/rede. Guardamos a
// "impressão digital" do 1º contexto (ASN + tipo de device) por 12h; se o mesmo
// ttclid reaparecer com contexto divergente, é replay → sinaliza para a white.
// Retorna { firstSeen, reused, ctx } — reused=true quando diverge do 1º contexto.
const TTCLID_TTL = 12 * 3600;
const ttclidMem = new Map(); // fallback SEM Redis: ttclid -> { ctx, exp } (single-instance)
async function checkTtclidContext(ttclid, ctx) {
  if (!ttclid) return { firstSeen: true, reused: false };
  const fp = String(ctx || '').slice(0, 40);
  // Sem Redis: mantém o anti-replay em memória local. Não é compartilhado entre
  // instâncias, mas barra o replay do MESMO processo (melhor que não barrar nada).
  if (!enabled) {
    const now = Date.now();
    if (ttclidMem.size > 5000) { for (const [k, v] of ttclidMem) { if (v.exp < now) ttclidMem.delete(k); } }
    const cur = ttclidMem.get(ttclid);
    if (!cur || cur.exp < now) {
      ttclidMem.set(ttclid, { ctx: fp, exp: now + TTCLID_TTL * 1000 });
      return { firstSeen: true, reused: false, ctx: fp };
    }
    return { firstSeen: false, reused: cur.ctx !== fp, ctx: cur.ctx };
  }
  const key = 'ttclid:' + String(ttclid).slice(0, 80);
  try {
    // 1ª vez: grava contexto e retorna firstSeen. NX garante atomicidade.
    const set = await redis.set(key, fp, { ex: TTCLID_TTL, nx: true });
    if (set !== null) return { firstSeen: true, reused: false, ctx: fp };
    const prev = await redis.get(key);
    const reused = prev != null && String(prev) !== fp;
    return { firstSeen: false, reused, ctx: prev };
  } catch (_) { return { firstSeen: true, reused: false }; }
}

// ── Velocity: contagem de acessos por chave numa janela ────────────────────
// N acessos do mesmo IP/ASN/ttclid em poucos segundos = device farm ou revisão
// automatizada. INCR + EXPIRE numa chave por janela dá um contador durável e
// multi-instância. Retorna a contagem atual (1 = primeiro na janela).
const velMem = new Map(); // fallback SEM Redis: key -> { n, exp } (single-instance)
async function bumpVelocity(kind, id, windowSec) {
  if (!id) return 0;
  const win = windowSec || 60;
  // Sem Redis: contagem por janela em memória local. Barra device farm no mesmo
  // processo; sem compartilhamento entre instâncias, mas melhor que ignorar.
  if (!enabled) {
    const now = Date.now();
    if (velMem.size > 5000) { for (const [k, v] of velMem) { if (v.exp < now) velMem.delete(k); } }
    const key = kind + ':' + String(id).slice(0, 60);
    const cur = velMem.get(key);
    if (!cur || cur.exp < now) { velMem.set(key, { n: 1, exp: now + win * 1000 }); return 1; }
    cur.n += 1;
    return cur.n;
  }
  const key = 'vel:' + kind + ':' + String(id).slice(0, 60);
  try {
    const n = await redis.incr(key);
    if (n === 1) await redis.expire(key, win);
    return Number(n) || 0;
  } catch (_) { return 0; }
}

// ── Fallback DURÁVEL de pixels (quando o Neon falha ou está off) ──────────
// A config do pixel é a fonte de verdade da monetização; perdê-la num restart
// zera o rastreamento. O Neon é a fonte primária, mas quando ele falha (ou não
// está configurado) espelhamos cada pixel num hash Redis "pixels:all" — assim a
// config sobrevive a restarts mesmo sem banco. `field` = `${accountId}:${slug}`.
const PIXELS_KEY = 'pixels:all';

async function savePixelSnapshot(accountId, slug, cfg) {
  if (!enabled || !slug) return false;
  try {
    await redis.hset(PIXELS_KEY, { [(accountId || 'legacy') + ':' + slug]: JSON.stringify(cfg) });
    return true;
  } catch (err) { console.error('[redis] savePixelSnapshot:', err.message); return false; }
}

async function deletePixelSnapshot(accountId, slug) {
  if (!enabled || !slug) return false;
  try {
    await redis.hdel(PIXELS_KEY, (accountId || 'legacy') + ':' + slug);
    return true;
  } catch (err) { console.error('[redis] deletePixelSnapshot:', err.message); return false; }
}

// Retorna array de pixels do snapshot (ou null se Redis off / erro de leitura —
// jamais [] por erro, para não ser confundido com "não há pixels salvos").
async function loadPixelSnapshot() {
  if (!enabled) return null;
  try {
    const h = await redis.hgetall(PIXELS_KEY);
    if (!h) return [];
    return Object.values(h)
      .map((v) => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch (_) { return null; } })
      .filter(Boolean);
  } catch (err) { console.error('[redis] loadPixelSnapshot:', err.message); return null; }
}

// ── Snapshot durável de gateways (item 48) ─────────────────────────────────
// Espelho igual ao dos pixels: se o Neon falhar no boot, os gateways hidratam
// do Redis e os webhooks não ficam órfãos. `field` = `${accountId}:${id}`.
const GATEWAYS_KEY = 'gateways:all';

async function saveGatewaySnapshot(accountId, id, cfg) {
  if (!enabled || !id) return false;
  try {
    await redis.hset(GATEWAYS_KEY, { [(accountId || 'legacy') + ':' + id]: JSON.stringify(cfg) });
    return true;
  } catch (err) { console.error('[redis] saveGatewaySnapshot:', err.message); return false; }
}

async function deleteGatewaySnapshot(accountId, id) {
  if (!enabled || !id) return false;
  try {
    await redis.hdel(GATEWAYS_KEY, (accountId || 'legacy') + ':' + id);
    return true;
  } catch (err) { console.error('[redis] deleteGatewaySnapshot:', err.message); return false; }
}

// Retorna array de gateways do snapshot (ou null se Redis off / erro de leitura
// — jamais [] por erro, para não confundir com "não há gateways salvos").
async function loadGatewaySnapshot() {
  if (!enabled) return null;
  try {
    const h = await redis.hgetall(GATEWAYS_KEY);
    if (!h) return [];
    return Object.values(h)
      .map((v) => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch (_) { return null; } })
      .filter(Boolean);
  } catch (err) { console.error('[redis] loadGatewaySnapshot:', err.message); return null; }
}

// ── Snapshot durável de domínios (item 245) ────────────────────────────────
// Espelho igual ao dos pixels/gateways: se o Neon falhar no boot, os domínios
// personalizados hidratam do Redis e o roteamento Host → conta não quebra.
// `field` = `${accountId}:${host}`.
const DOMAINS_KEY = 'domains:all';

async function saveDomainSnapshot(accountId, host, cfg) {
  if (!enabled || !host) return false;
  try {
    await redis.hset(DOMAINS_KEY, { [(accountId || 'legacy') + ':' + host]: JSON.stringify(cfg) });
    return true;
  } catch (err) { console.error('[redis] saveDomainSnapshot:', err.message); return false; }
}

async function deleteDomainSnapshot(accountId, host) {
  if (!enabled || !host) return false;
  try {
    await redis.hdel(DOMAINS_KEY, (accountId || 'legacy') + ':' + host);
    return true;
  } catch (err) { console.error('[redis] deleteDomainSnapshot:', err.message); return false; }
}

// Retorna array de domínios do snapshot (ou null se Redis off / erro de leitura
// — jamais [] por erro, para não confundir com "não há domínios salvos").
async function loadDomainSnapshot() {
  if (!enabled) return null;
  try {
    const h = await redis.hgetall(DOMAINS_KEY);
    if (!h) return [];
    return Object.values(h)
      .map((v) => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch (_) { return null; } })
      .filter(Boolean);
  } catch (err) { console.error('[redis] loadDomainSnapshot:', err.message); return null; }
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
  seenEventId, seenWebhookOrder,
  getAsnCache, setAsnCache,
  bumpCloakDecision, getCloakStats, resetCloakStats,
  pushCloakDecision, getCloakDecisionLog, // Item 170: log de decisões por link
  enqueueConversion, reserveConversions, ackConversion, reclaimConversions, convQueueDepth,
  setStickyBot, getStickyBot,
  checkTtclidContext, bumpVelocity,
  acquireLock, releaseLock,
  bumpEmq, getEmqTrend,
  savePixelSnapshot, deletePixelSnapshot, loadPixelSnapshot,
  saveGatewaySnapshot, deleteGatewaySnapshot, loadGatewaySnapshot,
  saveDomainSnapshot, deleteDomainSnapshot, loadDomainSnapshot,
  ping, TTL
};
