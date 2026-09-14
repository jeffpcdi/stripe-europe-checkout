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
const WORKER_LEASE_NAME = 'ads-bulk-worker:' + (queueNamespace || 'production');
const WORKER_LEASE_TTL_SEC = Math.max(120, Number(process.env.ADS_BULK_WORKER_LEASE_TTL_SEC) || 10 * 60);
const WORKER_LEASE_RENEW_MS = Math.max(15_000, Math.min(60_000, Math.floor(WORKER_LEASE_TTL_SEC * 1000 / 3)));
const RETRY_LEASE_TTL_SEC = 30;

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
        const moved = await redis.lmove(QUEUE, PROC, 'right', 'left');
        if (moved == null) break;
        const movedRaw = typeof moved === 'string' ? moved : JSON.stringify(moved);
        let env = null;
        try { env = typeof moved === 'string' ? JSON.parse(moved) : moved; } catch (_) { env = null; }
        // LMOVE preserva o timestamp original de enqueue. Sem carimbar a
        // reserva, um item que passou >5 min esperando na fila podia ser
        // "reclamado" imediatamente enquanto ainda estava sendo processado.
        // Substituímos a entrada em :proc por uma versão com reservedAt atual.
        const reservedEnv = Object.assign({}, env || {}, { reservedAt: Date.now() });
        const reservedRaw = JSON.stringify(reservedEnv);
        if (reservedRaw !== movedRaw) {
          const pipe = redis.pipeline();
          pipe.lrem(PROC, 1, movedRaw);
          pipe.lpush(PROC, reservedRaw);
          await pipe.exec();
        }
        out.push({ raw: reservedRaw, env: reservedEnv });
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
          const procRaw = typeof raw === 'string' ? raw : JSON.stringify(raw);
          const queuedEnv = Object.assign({}, env || {});
          delete queuedEnv.reservedAt;
          queuedEnv.at = Date.now();
          const queueRaw = JSON.stringify(queuedEnv);
          const pipe = redis.pipeline();
          pipe.lrem(PROC, 1, procRaw);
          pipe.lpush(QUEUE, queueRaw);
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
      const queuedEnv = Object.assign({}, env || {});
      delete queuedEnv.reservedAt;
      queuedEnv.at = Date.now();
      memQueue.unshift(JSON.stringify(queuedEnv));
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
  // Em múltiplas instâncias até um job terminal pode voltar a `running` depois
  // de um retry iniciado em outra aba/instância. Portanto, com Neon ativo, o
  // espelho durável é sempre consultado antes do cache em memória; caso
  // contrário uma instância poderia devolver `done` antigo e fazer a UI parar
  // o polling enquanto o retry já estava em andamento.
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

// Reprocessa falhas sob lease distribuído por job. O endpoint de retry pode
// ser clicado em duas abas ou atendido por duas instâncias; sem esta seção
// crítica, ambas enxergavam o mesmo item `failed` e o colocavam duas vezes na
// fila. O lease também falha fechado quando Redis foi configurado e caiu.
async function retryFailedBulkItems(accountId, jobId, indexes) {
  const wanted = Array.isArray(indexes) ? new Set(indexes.map(Number)) : null;
  const lease = await redisMod.acquireLease(
    'ads-bulk-retry:' + String(accountId).slice(0, 120) + ':' + String(jobId).slice(0, 160),
    RETRY_LEASE_TTL_SEC,
  );
  if (!lease || !lease.acquired) {
    return { ok: false, busy: lease && lease.reason === 'busy', reason: lease && lease.reason, requeued: 0 };
  }
  try {
    const job = await getBulkJob(accountId, jobId);
    if (!job) return { ok: false, notFound: true, requeued: 0 };
    let requeued = 0;
    for (const it of job.items || []) {
      if (it.status !== 'failed') continue;
      if (wanted && !wanted.has(Number(it.idx))) continue;
      if (!it.task) continue;
      // Persiste primeiro o estado não-falhado; chamadas concorrentes que
      // vierem depois do lease verão `queued` e não reenfileirarão este item.
      await updateBulkItem(accountId, job.id, it.idx, { status: 'queued', error: null, retryAt: null });
      await enqueueBulkItem({ accountId, jobId: job.id, idx: it.idx, task: it.task });
      requeued++;
    }
    return { ok: true, requeued };
  } finally {
    await redisMod.releaseLease(lease).catch(() => {});
  }
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
    let workerLease = null;
    let renewTimer = null;
    try {
      // "1 item por vez" precisa valer para TODAS as instâncias do servidor,
      // não só para este processo. Sem o lease, dois deploys podiam reservar
      // itens diferentes simultaneamente e ultrapassar o rate limit do TikTok.
      workerLease = await redisMod.acquireLease(WORKER_LEASE_NAME, WORKER_LEASE_TTL_SEC);
      if (!workerLease || !workerLease.acquired) return;
      renewTimer = setInterval(() => {
        redisMod.renewLease(workerLease, WORKER_LEASE_TTL_SEC).catch(() => {});
      }, WORKER_LEASE_RENEW_MS);
      if (renewTimer.unref) renewTimer.unref();

      // Reclaim também fica sob o mesmo lease. Assim outra instância não pode
      // recolocar na fila um item que este worker ainda está processando.
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
      if (renewTimer) clearInterval(renewTimer);
      if (workerLease && workerLease.acquired) await redisMod.releaseLease(workerLease).catch(() => {});
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
  createBulkJob, getBulkJob, updateBulkItem, retryFailedBulkItems,
  startBulkWorker, stopBulkWorker,
  _internals: { queue: QUEUE, processing: PROC, pauseKey: PAUSE_KEY, namespace: queueNamespace, RATE_LIMIT_PAUSE_MS },
};
