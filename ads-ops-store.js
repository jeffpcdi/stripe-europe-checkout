const crypto = require('crypto');
const { neon } = require('@neondatabase/serverless');

const URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL || null;
const sql = URL ? neon(URL) : null;
const enabled = !!sql;

const JOB_STATUSES = new Set(['queued', 'running', 'retrying', 'completed', 'partial', 'failed', 'cancelled']);

function id(prefix) {
  return prefix + crypto.randomUUID().replace(/-/g, '');
}

function cleanAccountId(value) {
  const accountId = String(value || '').trim();
  if (!accountId || accountId === '__all__') throw new Error('accountId específico é obrigatório');
  return accountId.slice(0, 120);
}

function normalizePolicy(input) {
  const value = input || {};
  return {
    enabled: value.enabled !== false,
    dryRun: value.dryRun !== false,
    killSwitch: value.killSwitch === true,
    // null/undefined/'' = "sem teto". Só vira número quando o valor é explícito;
    // Number(null) === 0 transformaria "sem teto" em "teto zero" (bloqueia tudo).
    dailySpendCap: value.dailySpendCap != null && value.dailySpendCap !== '' && Number.isFinite(Number(value.dailySpendCap)) && Number(value.dailySpendCap) >= 0 ? Number(value.dailySpendCap) : null,
    maxBudgetChangePct: Math.min(100, Math.max(0, Number(value.maxBudgetChangePct) || 20)),
    cooldownMinutes: Math.min(10080, Math.max(0, Math.floor(Number(value.cooldownMinutes) || 60))),
    allowedHours: value.allowedHours && typeof value.allowedHours === 'object' ? value.allowedHours : {},
    blockedAdvertiserIds: Array.isArray(value.blockedAdvertiserIds) ? [...new Set(value.blockedAdvertiserIds.map(String).filter(Boolean))].slice(0, 100) : [],
    circuitBreakerErrorPct: Math.min(100, Math.max(1, Number(value.circuitBreakerErrorPct) || 25))
  };
}

function assertMutationAllowed(policy, context) {
  const p = normalizePolicy(policy);
  const c = context || {};
  if (!p.enabled) throw new Error('Política de segurança desativada');
  if (p.killSwitch) throw new Error('Kill switch ativo');
  if (p.blockedAdvertiserIds.includes(String(c.advertiserId || ''))) throw new Error('Conta de anúncio bloqueada pela política');
  if (!String(c.idempotencyKey || '').trim()) throw new Error('Idempotency key obrigatória');
  if (c.budgetChangePct != null && Math.abs(Number(c.budgetChangePct)) > p.maxBudgetChangePct) throw new Error('Variação de orçamento excede a política');
  return { allowed: true, dryRun: p.dryRun };
}

async function getSafetyPolicy(accountId) {
  accountId = cleanAccountId(accountId);
  if (!enabled) return normalizePolicy({});
  const rows = await sql`SELECT enabled, dry_run, kill_switch, daily_spend_cap, max_budget_change_pct, cooldown_minutes, allowed_hours, blocked_advertiser_ids, circuit_breaker_error_pct FROM ads_safety_policies WHERE account_id = ${accountId} LIMIT 1`;
  if (!rows.length) return normalizePolicy({});
  const row = rows[0];
  return normalizePolicy({ enabled: row.enabled, dryRun: row.dry_run, killSwitch: row.kill_switch, dailySpendCap: row.daily_spend_cap, maxBudgetChangePct: row.max_budget_change_pct, cooldownMinutes: row.cooldown_minutes, allowedHours: row.allowed_hours, blockedAdvertiserIds: row.blocked_advertiser_ids, circuitBreakerErrorPct: row.circuit_breaker_error_pct });
}

async function saveSafetyPolicy(accountId, input) {
  accountId = cleanAccountId(accountId);
  if (!enabled) throw new Error('Persistência Neon indisponível');
  const p = normalizePolicy(input);
  await sql`INSERT INTO ads_safety_policies (id, account_id, enabled, dry_run, kill_switch, daily_spend_cap, max_budget_change_pct, cooldown_minutes, allowed_hours, blocked_advertiser_ids, circuit_breaker_error_pct) VALUES (${id('sp_')}, ${accountId}, ${p.enabled}, ${p.dryRun}, ${p.killSwitch}, ${p.dailySpendCap}, ${p.maxBudgetChangePct}, ${p.cooldownMinutes}, ${JSON.stringify(p.allowedHours)}, ${JSON.stringify(p.blockedAdvertiserIds)}, ${p.circuitBreakerErrorPct}) ON CONFLICT (account_id) DO UPDATE SET enabled = EXCLUDED.enabled, dry_run = EXCLUDED.dry_run, kill_switch = EXCLUDED.kill_switch, daily_spend_cap = EXCLUDED.daily_spend_cap, max_budget_change_pct = EXCLUDED.max_budget_change_pct, cooldown_minutes = EXCLUDED.cooldown_minutes, allowed_hours = EXCLUDED.allowed_hours, blocked_advertiser_ids = EXCLUDED.blocked_advertiser_ids, circuit_breaker_error_pct = EXCLUDED.circuit_breaker_error_pct, updated_at = now()`;
  // Contrato único (camelCase normalizado) para GET e PUT — a UI nunca vê a row crua.
  return p;
}

async function createJob(accountId, input) {
  accountId = cleanAccountId(accountId);
  if (!enabled) throw new Error('Persistência Neon indisponível');
  const value = input || {};
  const key = String(value.idempotencyKey || '').trim().slice(0, 200);
  if (!key) throw new Error('Idempotency key obrigatória');
  const policy = await getSafetyPolicy(accountId);
  assertMutationAllowed(policy, { advertiserId: value.advertiserId, idempotencyKey: key, budgetChangePct: value.budgetChangePct });
  const rows = await sql`INSERT INTO ads_jobs (id, account_id, kind, status, idempotency_key, advertiser_id, payload, progress) VALUES (${id('job_')}, ${accountId}, ${String(value.kind || 'operation').slice(0, 80)}, 'queued', ${key}, ${String(value.advertiserId || '').slice(0, 120) || null}, ${JSON.stringify(value.payload || {})}, ${JSON.stringify({ total: 0, completed: 0, failed: 0 })}) ON CONFLICT (account_id, idempotency_key) DO UPDATE SET updated_at = ads_jobs.updated_at RETURNING *`;
  return rows[0];
}

async function findJobByIdempotencyKey(accountId, key) {
  accountId = cleanAccountId(accountId);
  if (!enabled) return null;
  const value = String(key || '').trim().slice(0, 200);
  if (!value) return null;
  const rows = await sql`SELECT id, status FROM ads_jobs WHERE account_id = ${accountId} AND idempotency_key = ${value} LIMIT 1`;
  return rows[0] || null;
}

async function listJobs(accountId, limit) {
  accountId = cleanAccountId(accountId);
  if (!enabled) return [];
  const size = Math.min(100, Math.max(1, Number(limit) || 30));
  return sql`SELECT id, kind, status, advertiser_id, progress, error, attempts, created_at, updated_at, completed_at FROM ads_jobs WHERE account_id = ${accountId} ORDER BY created_at DESC LIMIT ${size}`;
}

async function persistBulkSnapshot(job) {
  const accountId = cleanAccountId(job && job.accountId);
  if (!enabled) return false;
  const status = job.status === 'done' ? (job.failed > 0 ? (job.done > 0 ? 'partial' : 'failed') : 'completed') : (job.status === 'running' ? 'running' : 'queued');
  const idempotencyKey = String((job.meta && job.meta.idempotencyKey) || ('bulk:' + job.id)).slice(0, 200);
  await sql`INSERT INTO ads_jobs (id, account_id, kind, status, idempotency_key, advertiser_id, payload, progress, error, completed_at) VALUES (${job.id}, ${accountId}, ${String(job.kind || 'bulk_create').slice(0, 80)}, ${status}, ${idempotencyKey}, ${String(job.adAccountId || '').slice(0, 120) || null}, ${JSON.stringify({ meta: job.meta || {}, createdAt: job.createdAt })}, ${JSON.stringify({ total: job.total || 0, completed: job.done || 0, failed: job.failed || 0 })}, ${null}, ${status === 'completed' || status === 'partial' || status === 'failed' ? new Date().toISOString() : null}) ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, progress = EXCLUDED.progress, completed_at = EXCLUDED.completed_at, updated_at = now()`;
  for (const item of job.items || []) {
    const itemStatus = item.status === 'done' ? 'completed' : item.status;
    const itemKey = idempotencyKey + ':' + item.idx;
    await sql`INSERT INTO ads_job_items (id, account_id, job_id, item_index, status, idempotency_key, payload, result, error) VALUES (${job.id + ':' + item.idx}, ${accountId}, ${job.id}, ${item.idx}, ${itemStatus}, ${itemKey}, ${JSON.stringify({ ref: item.ref, task: item.task || null })}, ${item.resultId ? JSON.stringify({ resultId: item.resultId }) : null}, ${item.error || null}) ON CONFLICT (account_id, job_id, item_index) DO UPDATE SET status = EXCLUDED.status, payload = EXCLUDED.payload, result = EXCLUDED.result, error = EXCLUDED.error, updated_at = now()`;
  }
  return true;
}

async function getBulkSnapshot(accountId, jobId) {
  accountId = cleanAccountId(accountId);
  if (!enabled) return null;
  const rows = await sql`SELECT id, kind, status, advertiser_id, payload, progress, created_at FROM ads_jobs WHERE account_id = ${accountId} AND id = ${String(jobId || '')} LIMIT 1`;
  if (!rows.length) return null;
  const itemRows = await sql`SELECT item_index, status, payload, result, error FROM ads_job_items WHERE account_id = ${accountId} AND job_id = ${String(jobId || '')} ORDER BY item_index ASC`;
  const row = rows[0];
  const items = itemRows.map((item) => ({ idx: item.item_index, ref: item.payload && item.payload.ref, task: item.payload && item.payload.task ? item.payload.task : null, status: item.status === 'completed' ? 'done' : item.status, error: item.error || null, resultId: item.result && item.result.resultId ? item.result.resultId : null }));
  const progress = row.progress || {};
  return { id: row.id, accountId, kind: row.kind, adAccountId: row.advertiser_id || '', createdAt: row.created_at, status: ['completed', 'partial', 'failed'].includes(row.status) ? 'done' : row.status, total: Number(progress.total) || items.length, done: Number(progress.completed) || 0, failed: Number(progress.failed) || 0, meta: (row.payload && row.payload.meta) || {}, items };
}

function retryDelayMs(attempt, baseMs) {
  const n = Math.min(8, Math.max(0, Math.floor(Number(attempt) || 0)));
  return Math.min(15 * 60 * 1000, (Math.max(250, Number(baseMs) || 1000) * (2 ** n)));
}

function circuitBreakerOpen(samples, thresholdPct, minimumSamples) {
  const values = (Array.isArray(samples) ? samples : []).map(Boolean);
  const minimum = Math.max(1, Number(minimumSamples) || 10);
  if (values.length < minimum) return false;
  const failures = values.filter((ok) => !ok).length;
  return (failures / values.length) * 100 >= Math.max(1, Number(thresholdPct) || 25);
}

async function appendAuditEvent(accountId, input) {
  accountId = cleanAccountId(accountId);
  if (!enabled) return null;
  const value = input || {};
  const rows = await sql`INSERT INTO ads_audit_events (id, account_id, actor_type, actor_id, action, target_type, target_id, advertiser_id, job_id, before_state, after_state, reason, metadata) VALUES (${id('audit_')}, ${accountId}, ${String(value.actorType || 'system').slice(0, 40)}, ${value.actorId ? String(value.actorId).slice(0, 120) : null}, ${String(value.action || 'unknown').slice(0, 100)}, ${value.targetType ? String(value.targetType).slice(0, 60) : null}, ${value.targetId ? String(value.targetId).slice(0, 160) : null}, ${value.advertiserId ? String(value.advertiserId).slice(0, 120) : null}, ${value.jobId ? String(value.jobId).slice(0, 160) : null}, ${value.beforeState ? JSON.stringify(value.beforeState) : null}, ${value.afterState ? JSON.stringify(value.afterState) : null}, ${value.reason ? String(value.reason).slice(0, 500) : null}, ${JSON.stringify(value.metadata || {})}) RETURNING *`;
  return rows[0];
}

async function claimNextJob(workerId, leaseSeconds) {
  if (!enabled) return null;
  const worker = String(workerId || '').trim().slice(0, 120);
  if (!worker) throw new Error('workerId obrigatório');
  const lease = Math.min(900, Math.max(15, Number(leaseSeconds) || 120));
  const rows = await sql`WITH candidate AS (SELECT id FROM ads_jobs WHERE status IN ('queued','retrying') AND (next_attempt_at IS NULL OR next_attempt_at <= now()) AND (locked_at IS NULL OR locked_at < now() - make_interval(secs => ${lease})) ORDER BY created_at ASC FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE ads_jobs AS job SET status = 'running', locked_at = now(), locked_by = ${worker}, attempts = attempts + 1, updated_at = now() FROM candidate WHERE job.id = candidate.id RETURNING job.*`;
  return rows[0] || null;
}

async function retryJob(accountId, jobId, error, attempt) {
  accountId = cleanAccountId(accountId);
  if (!enabled) return null;
  const delay = retryDelayMs(attempt);
  const rows = await sql`UPDATE ads_jobs SET status = 'retrying', error = ${String(error || 'falha transitória').slice(0, 500)}, next_attempt_at = now() + make_interval(secs => ${Math.ceil(delay / 1000)}), locked_at = null, locked_by = null, updated_at = now() WHERE account_id = ${accountId} AND id = ${String(jobId || '')} RETURNING *`;
  return rows[0] || null;
}

async function setJobStatus(accountId, jobId, status, patch) {
  accountId = cleanAccountId(accountId);
  if (!enabled) throw new Error('Persistência Neon indisponível');
  if (!JOB_STATUSES.has(status)) throw new Error('Status de job inválido');
  const value = patch || {};
  const rows = await sql`UPDATE ads_jobs SET status = ${status}, progress = COALESCE(${value.progress ? JSON.stringify(value.progress) : null}::jsonb, progress), error = ${value.error ? String(value.error).slice(0, 500) : null}, attempts = attempts + ${value.incrementAttempt ? 1 : 0}, locked_at = CASE WHEN ${status} IN ('completed','partial','failed','cancelled','retrying') THEN null ELSE locked_at END, locked_by = CASE WHEN ${status} IN ('completed','partial','failed','cancelled','retrying') THEN null ELSE locked_by END, updated_at = now(), completed_at = CASE WHEN ${status} IN ('completed','partial','failed','cancelled') THEN now() ELSE completed_at END WHERE account_id = ${accountId} AND id = ${String(jobId || '')} RETURNING *`;
  return rows[0] || null;
}

// Reinício do servidor: jobs bulk rodam in-process, então qualquer job preso
// em 'running'/'queued'/'retrying' que não voltou à memória nunca continuará.
// Marca como 'partial' (se algo concluiu) ou 'failed', com erro claro — o
// usuário vê o motivo no painel de Operações e pode reprocessar.
async function reconcileOrphanJobs() {
  if (!enabled) return 0;
  const rows = await sql`UPDATE ads_jobs SET status = CASE WHEN COALESCE((progress->>'completed')::int, 0) > 0 THEN 'partial' ELSE 'failed' END, error = 'Interrompido por reinício do servidor — reprocesse as falhas', locked_at = null, locked_by = null, updated_at = now(), completed_at = now() WHERE status IN ('running', 'queued', 'retrying') AND updated_at < now() - interval '2 minutes' RETURNING id, account_id`;
  for (const row of rows) {
    await sql`UPDATE ads_job_items SET status = 'failed', error = 'Interrompido por reinício do servidor', updated_at = now() WHERE job_id = ${row.id} AND status IN ('queued', 'running')`;
  }
  if (rows.length > 0) console.log('[ads-ops] ' + rows.length + ' job(s) órfão(s) reconciliado(s) após reinício');
  return rows.length;
}

module.exports = { enabled, cleanAccountId, normalizePolicy, assertMutationAllowed, retryDelayMs, circuitBreakerOpen, getSafetyPolicy, saveSafetyPolicy, createJob, findJobByIdempotencyKey, listJobs, persistBulkSnapshot, getBulkSnapshot, appendAuditEvent, claimNextJob, retryJob, reconcileOrphanJobs, setJobStatus };
