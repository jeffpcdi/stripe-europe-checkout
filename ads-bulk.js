// ─────────────────────────────────────────────────────────────────────────────
// ads-bulk.js — Fila DURÁVEL de criação/duplicação em massa de anúncios TikTok.
//
// Segue o MESMO padrão da fila de conversões do redis.js
// (enqueue → reserve → ack → reclaim), com uma diferença deliberada: aqui há
// FALLBACK EM MEMÓRIA quando o Redis não está configurado — o bulk precisa
// funcionar em qualquer ambiente (o job só perde durabilidade a restart).
//
// Modelo:
//   • Job   = { id, accountId, kind, total, done, failed, status, items[] }
//     status: 'queued' | 'running' | 'done'
//     item:   { ref, status: 'queued'|'running'|'done'|'failed', error?, resultId? }
//   • Fila  = envelopes { qid, at, accountId, jobId, idx, task } — um por item.
//     O worker (registrado em ads-routes.js) consome UM POR VEZ, com backoff
//     em erro, respeitando o rate limit da Zernio.
//   • Estado do job: Redis (chave adsBulkJob:<acc>:<id>, TTL 24h) + espelho em
//     memória (leitura rápida do polling da UI).
//
// Testes: test/ads-bulk-queue.test.js (espelha retry-queue.test.js).
// ─────────────────────────────────────────────────────────────────────────────
const redisMod = require('./redis');
const adsOps = require('./ads-ops-store');

// Desenvolvimento local e produção frequentemente compartilham o mesmo
// Upstash neste projeto. Sem namespace, um worker de produção podia consumir
// o job criado localmente (ou vice-versa). Produção mantém a chave legada para
// não abandonar jobs já enfileirados; outros ambientes ficam isolados. Staging
// pode definir ADS_BULK_QUEUE_NAMESPACE explicitamente.
const queueNamespace = String(process.env.ADS_BULK_QUEUE_NAMESPACE || (process.env.NODE_ENV === 'production' ? '' : 'development'))
  .replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
const QUEUE = 'adsBulkQ' + (queueNamespace ? ':' + queueNamespace : '');
const PROC = QUEUE + ':proc';
const QUEUE_CAP = 2000;
const JOB_TTL_S = 24 * 3600; // 24h — o job é efêmero por natureza
const RATE_LIMIT_PAUSE_MS = Math.max(1000, Number(process.env.ADS_BULK_RATE_LIMIT_PAUSE_MS) || 5 * 60 * 1000);
const PAUSE_KEY = QUEUE + ':paused';

const redis = redisMod.redis;
const redisOn = () => !!(redisMod.enabled && redis);

// ── Fallback em memória (sem Redis) ─────────────────────────────────────────
const memQueue = []; // envelopes serializados (string), cabeça = mais novo
const memProc = [];  // itens reservados
let memPausedUntil = 0;
let memPauseReason = '';

function randId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

// ── Fila (enqueue → reserve → ack → reclaim) ────────────────────────────────
async function enqueueBulkItem(env) {
  const raw = JSON.stringify(Object.assign({ qid: randId(), at: Date.now() }, env));
  if (redisOn()) {
    try {
      const pipe = redis.pipeline();
      pipe.lpush(QUEUE, raw);
      pipe.ltrim(QUEUE, 0, QUEUE_CAP - 1);
      await pipe.exec();
      return true;
    } catch (err) {
      console.error('[ads-bulk] enqueue:', err.message);
    }
  }
  memQueue.unshift(raw);
  if (memQueue.length > QUEUE_CAP) memQueue.length = QUEUE_CAP;
  return true;
}

// Reserva até `max` itens (FIFO: consumo pela cauda) movendo-os para :proc.
// Devolve [{ raw, env }]; `raw` é usado no ack (LREM).
async function reserveBulkItems(max) {
  const out = [];
  const n = Math.max(1, max || 1);
  if (redisOn()) {
    try {
      for (let i = 0; i < n; i++) {
        const raw = await redis.lmove(QUEUE, PROC, 'right', 'left');
        if (raw == null) break;
        let env = null;
        try { env = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (_) { env = null; }
        out.push({ raw, env });
      }
      return out;
    } catch (err) {
      console.error('[ads-bulk] reserve:', err.message);
      return out;
    }
  }
  for (let i = 0; i < n; i++) {
    const raw = memQueue.pop();
    if (raw == null) break;
    // marca o momento da reserva para o reclaim por idade funcionar
    let env = null;
    try { env = JSON.parse(raw); } catch (_) { env = null; }
    const reserved = JSON.stringify(Object.assign({}, env, { reservedAt: Date.now() }));
    memProc.push(reserved);
    out.push({ raw: reserved, env });
  }
  return out;
}

async function ackBulkItem(raw) {
  if (raw == null) return;
  if (redisOn()) {
    try { await redis.lrem(PROC, 1, raw); } catch (err) { console.error('[ads-bulk] ack:', err.message); }
    return;
  }
  const i = memProc.indexOf(raw);
  if (i >= 0) memProc.splice(i, 1);
}

// Requeue de itens presos em :proc (worker morreu no meio) mais velhos que
// `olderThanMs` — mesmo desenho do reclaimConversions do redis.js.
async function reclaimBulkItems(olderThanMs) {
  // 0 = resgata TUDO (usado nos testes); default 5min — criação de ad pode levar 2min
  const cut = olderThanMs === 0 ? -1 : (olderThanMs || 5 * 60 * 1000);
  const now = Date.now();
  let moved = 0;
  if (redisOn()) {
    try {
      const items = await redis.lrange(PROC, 0, -1);
      for (const raw of items || []) {
        let env = null;
        try { env = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (_) { env = null; }
        const at = env && (env.reservedAt || env.at) ? (env.reservedAt || env.at) : 0;
        if (now - at > cut) {
          const pipe = redis.pipeline();
          pipe.lrem(PROC, 1, typeof raw === 'string' ? raw : JSON.stringify(raw));
          pipe.lpush(QUEUE, typeof raw === 'string' ? raw : JSON.stringify(raw));
          await pipe.exec();
          moved++;
        }
      }
    } catch (err) {
      console.error('[ads-bulk] reclaim:', err.message);
    }
    return moved;
  }
  for (let i = memProc.length - 1; i >= 0; i--) {
    const raw = memProc[i];
    let env = null;
    try { env = JSON.parse(raw); } catch (_) { env = null; }
    const at = env && (env.reservedAt || env.at) ? (env.reservedAt || env.at) : 0;
    if (now - at > cut) {
      memProc.splice(i, 1);
      memQueue.unshift(raw);
      moved++;
    }
  }
  return moved;
}

async function bulkQueueDepth() {
  if (redisOn()) {
    try {
      const [q, p] = await Promise.all([redis.llen(QUEUE), redis.llen(PROC)]);
      return { queue: Number(q) || 0, processing: Number(p) || 0 };
    } catch (_) { /* cai para o espelho em memória */ }
  }
  return { queue: memQueue.length, processing: memProc.length };
}

function isRateLimitError(err) {
  if (!err) return false;
  const status = Number(err.status || err.statusCode || (err.response && err.response.status));
  const code = String(err.code || (err.response && err.response.data && err.response.data.code) || '').toLowerCase();
  const message = String(err.message || err.userMessage || '').toLowerCase();
  return status === 429
    || code === '429'
    || code.includes('rate_limit')
    || code.includes('ratelimit')
    || message.includes('rate limit')
    || /\bhttp\s*429\b/.test(message)
    || message.includes('too many request')
    || message.includes('muitas requisições')
    || message.includes('limite de requisições');
}

async function pauseBulkQueue(reason, durationMs) {
  const until = Date.now() + Math.max(1000, Number(durationMs) || RATE_LIMIT_PAUSE_MS);
  const payload = {
    until,
    reason: String(reason || 'Limite temporário do TikTok').slice(0, 220),
  };
  memPausedUntil = until;
  memPauseReason = payload.reason;
  if (redisOn()) {
    try {
      await redis.set(PAUSE_KEY, JSON.stringify(payload), { px: Math.max(1000, until - Date.now()) });
    } catch (err) {
      console.error('[ads-bulk] pausa durável:', err.message);
    }
  }
  return payload;
}

async function getBulkQueuePause() {
  let payload = memPausedUntil > Date.now()
    ? { until: memPausedUntil, reason: memPauseReason }
    : null;
  if (redisOn()) {
    try {
      const raw = await redis.get(PAUSE_KEY);
      if (raw) {
        const remote = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (Number(remote && remote.until) > Date.now()) payload = remote;
      }
    } catch (err) {
      // A pausa em memória ainda protege esta instância quando o Redis oscila.
      console.error('[ads-bulk] leitura da pausa:', err.message);
    }
  }
  if (!payload || Number(payload.until) <= Date.now()) {
    memPausedUntil = 0;
    memPauseReason = '';
    return { paused: false, pausedUntil: null, retryAfterMs: 0, reason: '' };
  }
  memPausedUntil = Number(payload.until);
  memPauseReason = String(payload.reason || 'Limite temporário do TikTok');
  return {
    paused: true,
    pausedUntil: new Date(memPausedUntil).toISOString(),
    retryAfterMs: Math.max(0, memPausedUntil - Date.now()),
    reason: memPauseReason,
  };
}

async function bulkQueueStatus() {
  const [depth, pause] = await Promise.all([bulkQueueDepth(), getBulkQueuePause()]);
  return Object.assign({}, depth, pause);
}

// ── Estado do job (progresso p/ a UI) ───────────────────────────────────────
// Memória = fonte primária (polling rápido); Redis = durabilidade (restart).
const memJobs = new Map(); // 'acc:jobId' → job

function jobKey(accountId, jobId) { return 'adsBulkJob:' + accountId + ':' + jobId; }

function recountJob(job) {
  let done = 0, failed = 0, running = 0;
  for (const it of job.items) {
    if (it.status === 'done') done++;
    else if (it.status === 'failed') failed++;
    else if (it.status === 'running') running++;
  }
  job.done = done;
  job.failed = failed;
  job.status = done + failed >= job.total ? 'done' : (running || done || failed ? 'running' : 'queued');
  return job;
}

async function persistJob(job) {
  memJobs.set(job.accountId + ':' + job.id, job);
  if (memJobs.size > 200) {
    // higiene: descarta os jobs mais antigos (Neon mantém o histórico durável)
    const oldest = [...memJobs.keys()].slice(0, 50);
    oldest.forEach((k) => memJobs.delete(k));
  }
  if (adsOps.enabled) {
    try { await adsOps.persistBulkSnapshot(job); } catch (err) {
      console.error('[ads-bulk] persistJob Neon:', err.message);
    }
  }
  if (redisOn()) {
    try { await redis.set(jobKey(job.accountId, job.id), JSON.stringify(job), { ex: JOB_TTL_S }); } catch (err) {
      console.error('[ads-bulk] persistJob Redis:', err.message);
    }
  }
}

async function createBulkJob(accountId, { kind, adAccountId, items, meta }) {
  const idempotencyKey = String(meta && meta.idempotencyKey || '').trim().slice(0, 200);
  if (idempotencyKey && adsOps.enabled) {
    const existing = await adsOps.findJobByIdempotencyKey(accountId, idempotencyKey);
    if (existing) {
      const restored = await getBulkJob(accountId, existing.id);
      if (restored) return restored;
    }
  }
  const job = {
    id: 'bj' + randId(),
    accountId,
    kind: kind || 'bulk_create', // 'bulk_create' | 'duplicate'
    adAccountId: adAccountId || '',
    createdAt: new Date().toISOString(),
    status: 'queued',
    total: items.length,
    done: 0,
    failed: 0,
    meta: meta || {},
    items: items.map((it, idx) => ({ idx, ref: it.ref, status: 'queued', error: null, resultId: null }))
  };
  await persistJob(job);
  return job;
}

async function getBulkJob(accountId, jobId) {
  const hit = memJobs.get(accountId + ':' + jobId);
  // Em múltiplas instâncias, outro worker pode ter atualizado o Neon. Um job
  // não terminal em memória nunca é fonte definitiva para o polling.
  if (hit && hit.status === 'done') return hit;
  if (adsOps.enabled) {
    try {
      const job = await adsOps.getBulkSnapshot(accountId, jobId);
      if (job) {
        memJobs.set(accountId + ':' + jobId, job);
        return job;
      }
    } catch (err) {
      console.error('[ads-bulk] getBulkJob Neon:', err.message);
    }
  }
  if (hit) return hit;
  if (redisOn()) {
    try {
      const raw = await redis.get(jobKey(accountId, jobId));
      if (raw) {
        const job = typeof raw === 'string' ? JSON.parse(raw) : raw;
        memJobs.set(accountId + ':' + jobId, job);
        return job;
      }
    } catch (err) {
      console.error('[ads-bulk] getBulkJob:', err.message);
    }
  }
  return null;
}

async function updateBulkItem(accountId, jobId, idx, patch) {
  const job = await getBulkJob(accountId, jobId);
  if (!job || !job.items[idx]) return null;
  Object.assign(job.items[idx], patch || {});
  recountJob(job);
  await persistJob(job);
  return job;
}

// ── Worker sequencial (1 item por vez + backoff) ────────────────────────────
// ads-routes.js registra o processador via startBulkWorker(processItem).
// `processItem(env)` deve resolver { resultId? } ou lançar Error (vira failed).
let workerTimer = null;
let draining = false;
let lastReclaimAt = 0;

function startBulkWorker(processItem, { intervalMs, backoffMs } = {}) {
  if (workerTimer) return; // idempotente (testes chamam stop antes)
  const tick = async () => {
    if (draining) return;
    draining = true;
    try {
      // resgata órfãos a cada ~2min (worker morto no meio de um item)
      if (Date.now() - lastReclaimAt > 120000) {
        lastReclaimAt = Date.now();
        await reclaimBulkItems();
      }
      // Rate limit é uma condição da fila inteira, não uma falha do anúncio.
      // Enquanto o prazo não expira, nenhum item é reservado e o timer segue
      // leve; ao expirar, o próximo tick retoma sozinho.
      const pause = await getBulkQueuePause();
      if (pause.paused) return;
      // UM item por vez — rate limit da Zernio (criação sobe vídeo p/ o TikTok)
      const batch = await reserveBulkItems(1);
      for (const { raw, env } of batch) {
        if (!env || !env.jobId) { await ackBulkItem(raw); continue; }
        await updateBulkItem(env.accountId, env.jobId, env.idx, { status: 'running', error: null });
        try {
          const result = await processItem(env);
          await updateBulkItem(env.accountId, env.jobId, env.idx, {
            status: 'done',
            resultId: (result && result.resultId) || null
          });
          await ackBulkItem(raw);
        } catch (err) {
          const msg = String((err && err.message) || 'erro inesperado').slice(0, 300);
          if (isRateLimitError(err)) {
            const paused = await pauseBulkQueue(msg, RATE_LIMIT_PAUSE_MS);
            const attempts = Math.max(0, Number(env.attempts) || 0) + 1;
            await updateBulkItem(env.accountId, env.jobId, env.idx, {
              status: 'queued',
              error: 'TikTok limitou as requisições. A fila retoma automaticamente em 5 minutos.',
              attempts,
              retryAt: new Date(paused.until).toISOString(),
            });
            await ackBulkItem(raw);
            await enqueueBulkItem(Object.assign({}, env, {
              attempts,
              at: Date.now(),
              reservedAt: undefined,
            }));
            continue;
          }
          await updateBulkItem(env.accountId, env.jobId, env.idx, { status: 'failed', error: msg });
          await ackBulkItem(raw); // failed NÃO volta pra fila sozinho — retry é explícito na UI
          // backoff: respira antes do próximo item quando a Zernio reclamou
          await new Promise((r) => setTimeout(r, backoffMs || 3000));
        }
      }
    } catch (err) {
      console.error('[ads-bulk] worker:', err.message);
    } finally {
      draining = false;
    }
  };
  workerTimer = setInterval(tick, intervalMs || 2000);
  if (workerTimer.unref) workerTimer.unref();
  return tick; // exposto p/ os testes rodarem um ciclo sob demanda
}

function stopBulkWorker() {
  if (workerTimer) { clearInterval(workerTimer); workerTimer = null; }
  draining = false;
}

module.exports = {
  enqueueBulkItem, reserveBulkItems, ackBulkItem, reclaimBulkItems, bulkQueueDepth,
  bulkQueueStatus, getBulkQueuePause, pauseBulkQueue, isRateLimitError,
  createBulkJob, getBulkJob, updateBulkItem,
  startBulkWorker, stopBulkWorker,
  _internals: { queue: QUEUE, processing: PROC, pauseKey: PAUSE_KEY, namespace: queueNamespace, RATE_LIMIT_PAUSE_MS },
};
