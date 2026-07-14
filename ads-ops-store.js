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
    // Cap global de ações reais do motor por hora/conta. Trava o loop
    // "regra pausa → outra reativa → repete". Default 10; 0 = desligado.
    maxActionsPerHour: value.maxActionsPerHour != null && value.maxActionsPerHour !== '' && Number.isFinite(Number(value.maxActionsPerHour)) && Number(value.maxActionsPerHour) >= 0 ? Math.min(1000, Math.floor(Number(value.maxActionsPerHour))) : 10,
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

// Autocura de schema: as tabelas ads_* precisam existir sempre que o app
// conectar (qualquer branch/banco). Sem isto, uma conexão a um banco sem essas
// tabelas quebrava com `relation "ads_safety_policies" does not exist`. Roda no
// boot (server.js) e é idempotente — CREATE TABLE IF NOT EXISTS nunca destrói
// dados existentes.
let schemaReady = null;
async function ensureSchema() {
  if (!enabled) return false;
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    await sql`CREATE TABLE IF NOT EXISTS ads_safety_policies (
      id text PRIMARY KEY,
      account_id text NOT NULL UNIQUE,
      enabled boolean NOT NULL DEFAULT true,
      dry_run boolean NOT NULL DEFAULT true,
      kill_switch boolean NOT NULL DEFAULT false,
      daily_spend_cap numeric,
      max_budget_change_pct numeric NOT NULL DEFAULT 20,
      max_actions_per_hour integer NOT NULL DEFAULT 10,
      cooldown_minutes integer NOT NULL DEFAULT 60,
      allowed_hours jsonb NOT NULL DEFAULT '{}'::jsonb,
      blocked_advertiser_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
      circuit_breaker_error_pct numeric NOT NULL DEFAULT 25,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
    // Migração para bancos que já têm a tabela antiga (CREATE IF NOT EXISTS não
    // adiciona colunas novas). Idempotente.
    await sql`ALTER TABLE ads_safety_policies ADD COLUMN IF NOT EXISTS max_actions_per_hour integer NOT NULL DEFAULT 10`;
    await sql`CREATE TABLE IF NOT EXISTS ads_jobs (
      id text PRIMARY KEY,
      account_id text NOT NULL,
      kind text NOT NULL,
      status text NOT NULL DEFAULT 'queued',
      idempotency_key text NOT NULL,
      advertiser_id text,
      payload jsonb NOT NULL DEFAULT '{}'::jsonb,
      progress jsonb NOT NULL DEFAULT '{}'::jsonb,
      error text,
      attempts integer NOT NULL DEFAULT 0,
      next_attempt_at timestamptz,
      locked_at timestamptz,
      locked_by text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz,
      UNIQUE (account_id, idempotency_key)
    )`;
    await sql`CREATE INDEX IF NOT EXISTS ads_jobs_account_created_idx ON ads_jobs (account_id, created_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS ads_jobs_claim_idx ON ads_jobs (status, next_attempt_at)`;
    await sql`CREATE TABLE IF NOT EXISTS ads_job_items (
      id text PRIMARY KEY,
      account_id text NOT NULL,
      job_id text NOT NULL,
      item_index integer NOT NULL,
      status text NOT NULL DEFAULT 'queued',
      idempotency_key text NOT NULL,
      payload jsonb NOT NULL DEFAULT '{}'::jsonb,
      result jsonb,
      error text,
      attempts integer NOT NULL DEFAULT 0,
      next_attempt_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (account_id, job_id, item_index),
      UNIQUE (account_id, idempotency_key)
    )`;
    await sql`CREATE INDEX IF NOT EXISTS ads_job_items_job_idx ON ads_job_items (job_id)`;
    await sql`CREATE TABLE IF NOT EXISTS ads_audit_events (
      id text PRIMARY KEY,
      account_id text NOT NULL,
      actor_type text NOT NULL,
      actor_id text,
      action text NOT NULL,
      target_type text,
      target_id text,
      advertiser_id text,
      job_id text,
      before_state jsonb,
      after_state jsonb,
      reason text,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )`;
    await sql`CREATE INDEX IF NOT EXISTS ads_audit_events_account_created_idx ON ads_audit_events (account_id, created_at DESC)`;
    await sql`CREATE TABLE IF NOT EXISTS ads_account_health (
      id text PRIMARY KEY,
      account_id text NOT NULL,
      advertiser_id text NOT NULL,
      advertiser_name text,
      status text NOT NULL DEFAULT 'unknown',
      raw_status text,
      status_reason text,
      first_seen_banned_at timestamptz,
      last_checked_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (account_id, advertiser_id)
    )`;
    await sql`CREATE TABLE IF NOT EXISTS ads_unban_tickets (
      id text PRIMARY KEY,
      account_id text NOT NULL,
      advertiser_id text NOT NULL,
      advertiser_name text,
      status text NOT NULL DEFAULT 'open',
      appeal_text text,
      appeal_url text,
      notes text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      submitted_at timestamptz,
      resolved_at timestamptz
    )`;
    // Índice único parcial: no máximo 1 ticket ativo (open/submitted) por
    // advertiser. É a garantia de idempotência de createUnbanTicketIfAbsent.
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_ads_unban_tickets_open ON ads_unban_tickets (account_id, advertiser_id) WHERE status IN ('open', 'submitted')`;
    await sql`CREATE INDEX IF NOT EXISTS idx_ads_unban_tickets_account ON ads_unban_tickets (account_id, status, created_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_ads_account_health_account ON ads_account_health (account_id, status)`;
    console.log('[ads-ops] schema verificado/criado');
    return true;
  })().catch((err) => {
    // Não deixa uma falha transitória "gravar" um schema pronto — permite retry.
    schemaReady = null;
    throw err;
  });
  return schemaReady;
}

async function getSafetyPolicy(accountId) {
  accountId = cleanAccountId(accountId);
  if (!enabled) return normalizePolicy({});
  await ensureSchema();
  const rows = await sql`SELECT enabled, dry_run, kill_switch, daily_spend_cap, max_budget_change_pct, max_actions_per_hour, cooldown_minutes, allowed_hours, blocked_advertiser_ids, circuit_breaker_error_pct FROM ads_safety_policies WHERE account_id = ${accountId} LIMIT 1`;
  if (!rows.length) return normalizePolicy({});
  const row = rows[0];
  return normalizePolicy({ enabled: row.enabled, dryRun: row.dry_run, killSwitch: row.kill_switch, dailySpendCap: row.daily_spend_cap, maxBudgetChangePct: row.max_budget_change_pct, maxActionsPerHour: row.max_actions_per_hour, cooldownMinutes: row.cooldown_minutes, allowedHours: row.allowed_hours, blockedAdvertiserIds: row.blocked_advertiser_ids, circuitBreakerErrorPct: row.circuit_breaker_error_pct });
}

async function saveSafetyPolicy(accountId, input) {
  accountId = cleanAccountId(accountId);
  if (!enabled) throw new Error('Persistência Neon indisponível');
  await ensureSchema();
  const p = normalizePolicy(input);
  await sql`INSERT INTO ads_safety_policies (id, account_id, enabled, dry_run, kill_switch, daily_spend_cap, max_budget_change_pct, max_actions_per_hour, cooldown_minutes, allowed_hours, blocked_advertiser_ids, circuit_breaker_error_pct) VALUES (${id('sp_')}, ${accountId}, ${p.enabled}, ${p.dryRun}, ${p.killSwitch}, ${p.dailySpendCap}, ${p.maxBudgetChangePct}, ${p.maxActionsPerHour}, ${p.cooldownMinutes}, ${JSON.stringify(p.allowedHours)}, ${JSON.stringify(p.blockedAdvertiserIds)}, ${p.circuitBreakerErrorPct}) ON CONFLICT (account_id) DO UPDATE SET enabled = EXCLUDED.enabled, dry_run = EXCLUDED.dry_run, kill_switch = EXCLUDED.kill_switch, daily_spend_cap = EXCLUDED.daily_spend_cap, max_budget_change_pct = EXCLUDED.max_budget_change_pct, max_actions_per_hour = EXCLUDED.max_actions_per_hour, cooldown_minutes = EXCLUDED.cooldown_minutes, allowed_hours = EXCLUDED.allowed_hours, blocked_advertiser_ids = EXCLUDED.blocked_advertiser_ids, circuit_breaker_error_pct = EXCLUDED.circuit_breaker_error_pct, updated_at = now()`;
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
  await ensureSchema();
  const rows = await sql`SELECT id, status FROM ads_jobs WHERE account_id = ${accountId} AND idempotency_key = ${value} LIMIT 1`;
  return rows[0] || null;
}

async function listJobs(accountId, limit) {
  accountId = cleanAccountId(accountId);
  if (!enabled) return [];
  await ensureSchema();
  const size = Math.min(100, Math.max(1, Number(limit) || 30));
  return sql`SELECT id, kind, status, advertiser_id, progress, error, attempts, created_at, updated_at, completed_at FROM ads_jobs WHERE account_id = ${accountId} ORDER BY created_at DESC LIMIT ${size}`;
}

async function persistBulkSnapshot(job) {
  const accountId = cleanAccountId(job && job.accountId);
  if (!enabled) return false;
  await ensureSchema();
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
  await ensureSchema();
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
  await ensureSchema();
  const value = input || {};
  const rows = await sql`INSERT INTO ads_audit_events (id, account_id, actor_type, actor_id, action, target_type, target_id, advertiser_id, job_id, before_state, after_state, reason, metadata) VALUES (${id('audit_')}, ${accountId}, ${String(value.actorType || 'system').slice(0, 40)}, ${value.actorId ? String(value.actorId).slice(0, 120) : null}, ${String(value.action || 'unknown').slice(0, 100)}, ${value.targetType ? String(value.targetType).slice(0, 60) : null}, ${value.targetId ? String(value.targetId).slice(0, 160) : null}, ${value.advertiserId ? String(value.advertiserId).slice(0, 120) : null}, ${value.jobId ? String(value.jobId).slice(0, 160) : null}, ${value.beforeState ? JSON.stringify(value.beforeState) : null}, ${value.afterState ? JSON.stringify(value.afterState) : null}, ${value.reason ? String(value.reason).slice(0, 500) : null}, ${JSON.stringify(value.metadata || {})}) RETURNING *`;
  return rows[0];
}

// Busca um evento de auditoria específico (escopado à conta) — usado pelo
// rollback para restaurar o before_state gravado numa ação real do motor.
async function getAuditEvent(accountId, auditId) {
  accountId = cleanAccountId(accountId);
  if (!enabled) return null;
  await ensureSchema();
  const rows = await sql`SELECT id, account_id, actor_type, actor_id, action, target_type, target_id, advertiser_id, job_id, before_state, after_state, reason, metadata, created_at FROM ads_audit_events WHERE account_id = ${accountId} AND id = ${String(auditId || '')} LIMIT 1`;
  return rows[0] || null;
}

// Conta ações REAIS do motor de regras na última janela (default 1h). É a base
// durável do cap global de ações/hora (sobrevive a restart, ao contrário de um
// contador em memória). Só conta ações reais — os sufixos '.simulated' (dry-run)
// não entram, senão o dry-run travaria o motor sem nunca tocar a plataforma.
async function countRecentEngineActions(accountId, sinceMs) {
  accountId = cleanAccountId(accountId);
  if (!enabled) return 0;
  await ensureSchema();
  const windowMs = Math.max(60e3, Number(sinceMs) || 3600e3);
  const seconds = Math.ceil(windowMs / 1000);
  const rows = await sql`SELECT count(*)::int AS n FROM ads_audit_events WHERE account_id = ${accountId} AND actor_type = 'system' AND action IN ('rule_action', 'schedule_action') AND created_at > now() - make_interval(secs => ${seconds})`;
  return rows.length ? Number(rows[0].n) || 0 : 0;
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

// ── Saúde das contas de anúncio + tickets de desbanimento ──────────────────

// Códigos de status do advertiser TikTok → status normalizado do painel.
// O TikTok não tem API de appeal: o ticket é interno, com link pro formulário.
const ACCOUNT_STATUS_MAP = {
  STATUS_ENABLE: 'approved',
  STATUS_DISABLE: 'banned',
  STATUS_PENALTY: 'banned',
  STATUS_LIMIT: 'limited',
  STATUS_WAIT_FOR_BPM_AUDIT: 'in_review',
  STATUS_WAIT_FOR_PUBLIC_AUTH: 'in_review',
  STATUS_SELF_SERVICE_UNAUDITED: 'in_review',
  STATUS_CONTRACT_PENDING: 'in_review',
  STATUS_PENDING_CONFIRM: 'in_review',
  STATUS_PENDING_CONFIRM_MODIFY: 'in_review',
  STATUS_CONFIRM_FAIL: 'banned',
  STATUS_CONFIRM_FAIL_END: 'banned',
  STATUS_CONFIRM_MODIFY_FAIL: 'limited'
};

function normalizeAccountStatus(rawStatus) {
  const raw = String(rawStatus || '').trim().toUpperCase();
  if (!raw) return 'unknown';
  return ACCOUNT_STATUS_MAP[raw] || 'unknown';
}

// Grava o snapshot de status de cada advertiser e devolve as TRANSIÇÕES
// (ex.: approved → banned) — é isso que dispara a automação de tickets.
async function upsertAccountHealth(accountId, advertisers) {
  accountId = cleanAccountId(accountId);
  if (!enabled) return [];
  await ensureSchema();
  const transitions = [];
  for (const adv of Array.isArray(advertisers) ? advertisers : []) {
    const advertiserId = String(adv.advertiserId || '').trim().slice(0, 120);
    if (!advertiserId) continue;
    const status = normalizeAccountStatus(adv.rawStatus);
    const name = String(adv.name || '').slice(0, 200) || null;
    const rawStatus = String(adv.rawStatus || '').slice(0, 80) || null;
    const reason = String(adv.statusReason || '').slice(0, 500) || null;
    const prev = await sql`SELECT status FROM ads_account_health WHERE account_id = ${accountId} AND advertiser_id = ${advertiserId} LIMIT 1`;
    const previousStatus = prev.length ? prev[0].status : null;
    await sql`INSERT INTO ads_account_health (id, account_id, advertiser_id, advertiser_name, status, raw_status, status_reason, first_seen_banned_at, last_checked_at) VALUES (${id('ah_')}, ${accountId}, ${advertiserId}, ${name}, ${status}, ${rawStatus}, ${reason}, ${status === 'banned' ? new Date().toISOString() : null}, now()) ON CONFLICT (account_id, advertiser_id) DO UPDATE SET advertiser_name = COALESCE(EXCLUDED.advertiser_name, ads_account_health.advertiser_name), status = EXCLUDED.status, raw_status = EXCLUDED.raw_status, status_reason = EXCLUDED.status_reason, first_seen_banned_at = CASE WHEN EXCLUDED.status = 'banned' AND ads_account_health.status != 'banned' THEN now() WHEN EXCLUDED.status != 'banned' THEN null ELSE ads_account_health.first_seen_banned_at END, last_checked_at = now(), updated_at = now()`;
    // 'unknown' anterior não conta como transição real (primeiro contato)
    if (previousStatus && previousStatus !== status) {
      transitions.push({ advertiserId, advertiserName: name, from: previousStatus, to: status });
    }
  }
  return transitions;
}

async function listAccountHealth(accountId) {
  accountId = cleanAccountId(accountId);
  if (!enabled) return [];
  await ensureSchema();
  return sql`SELECT advertiser_id, advertiser_name, status, raw_status, status_reason, first_seen_banned_at, last_checked_at FROM ads_account_health WHERE account_id = ${accountId} ORDER BY CASE status WHEN 'banned' THEN 0 WHEN 'limited' THEN 1 WHEN 'in_review' THEN 2 WHEN 'approved' THEN 3 ELSE 4 END, advertiser_name ASC NULLS LAST`;
}

const TICKET_STATUSES = new Set(['open', 'submitted', 'resolved', 'dismissed']);

// Cria ticket de desbanimento se não houver um ativo (open/submitted) para o
// advertiser — o índice único parcial garante isso mesmo em corrida.
async function createUnbanTicketIfAbsent(accountId, input) {
  accountId = cleanAccountId(accountId);
  if (!enabled) return null;
  await ensureSchema();
  const value = input || {};
  const advertiserId = String(value.advertiserId || '').trim().slice(0, 120);
  if (!advertiserId) throw new Error('advertiserId obrigatório');
  try {
    const rows = await sql`INSERT INTO ads_unban_tickets (id, account_id, advertiser_id, advertiser_name, status, appeal_text, appeal_url) VALUES (${id('ut_')}, ${accountId}, ${advertiserId}, ${String(value.advertiserName || '').slice(0, 200) || null}, 'open', ${String(value.appealText || '').slice(0, 4000) || null}, ${String(value.appealUrl || '').slice(0, 500) || null}) RETURNING *`;
    return rows[0];
  } catch (error) {
    // Violação do índice único parcial = já existe ticket ativo → idempotente
    if (String(error && error.message || '').includes('idx_ads_unban_tickets_open')) return null;
    throw error;
  }
}

async function listUnbanTickets(accountId, limit) {
  accountId = cleanAccountId(accountId);
  if (!enabled) return [];
  await ensureSchema();
  const size = Math.min(100, Math.max(1, Number(limit) || 50));
  return sql`SELECT id, advertiser_id, advertiser_name, status, appeal_text, appeal_url, notes, created_at, updated_at, submitted_at, resolved_at FROM ads_unban_tickets WHERE account_id = ${accountId} ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'submitted' THEN 1 ELSE 2 END, created_at DESC LIMIT ${size}`;
}

async function updateUnbanTicket(accountId, ticketId, patch) {
  accountId = cleanAccountId(accountId);
  if (!enabled) throw new Error('Persistência Neon indisponível');
  const value = patch || {};
  if (value.status && !TICKET_STATUSES.has(value.status)) throw new Error('Status de ticket inválido');
  const rows = await sql`UPDATE ads_unban_tickets SET status = COALESCE(${value.status || null}, status), appeal_text = COALESCE(${value.appealText != null ? String(value.appealText).slice(0, 4000) : null}, appeal_text), notes = COALESCE(${value.notes != null ? String(value.notes).slice(0, 1000) : null}, notes), submitted_at = CASE WHEN ${value.status || ''} = 'submitted' THEN now() ELSE submitted_at END, resolved_at = CASE WHEN ${value.status || ''} IN ('resolved','dismissed') THEN now() ELSE resolved_at END, updated_at = now() WHERE account_id = ${accountId} AND id = ${String(ticketId || '')} RETURNING *`;
  return rows[0] || null;
}

// Reativação detectada → resolve automaticamente os tickets ativos da conta.
async function resolveTicketsForAdvertiser(accountId, advertiserId) {
  accountId = cleanAccountId(accountId);
  if (!enabled) return [];
  return sql`UPDATE ads_unban_tickets SET status = 'resolved', resolved_at = now(), notes = COALESCE(notes || ' | ', '') || 'Conta reativada — resolvido automaticamente', updated_at = now() WHERE account_id = ${accountId} AND advertiser_id = ${String(advertiserId || '')} AND status IN ('open','submitted') RETURNING id, advertiser_id`;
}

module.exports = { enabled, ensureSchema, cleanAccountId, normalizePolicy, assertMutationAllowed, retryDelayMs, circuitBreakerOpen, getSafetyPolicy, saveSafetyPolicy, createJob, findJobByIdempotencyKey, listJobs, persistBulkSnapshot, getBulkSnapshot, appendAuditEvent, getAuditEvent, countRecentEngineActions, claimNextJob, retryJob, reconcileOrphanJobs, setJobStatus, normalizeAccountStatus, upsertAccountHealth, listAccountHealth, createUnbanTicketIfAbsent, listUnbanTickets, updateUnbanTicket, resolveTicketsForAdvertiser };
