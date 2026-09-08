const crypto = require('crypto');
const { neon } = require('@neondatabase/serverless');

const URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL || null;
const isPlaceholder = !URL || /USER:PASSWORD@HOST|HOST\/DATABASE|example\.com/i.test(URL);
const sql = (!isPlaceholder && URL) ? neon(URL) : null;
const enabled = !!sql;
const pixelBindingMemory = new Map();
const rejectionMemory = new Map();

const JOB_STATUSES = new Set(['queued', 'running', 'retrying', 'completed', 'partial', 'failed', 'cancelled']);

function id(prefix) {
  return prefix + crypto.randomUUID().replace(/-/g, '');
}

function rejectionScope(accountId, advertiserId) {
  return cleanAccountId(accountId) + ':' + String(advertiserId || '').trim().slice(0, 120);
}

function rejectedStatus(value) {
  const status = String(value || '').toUpperCase();
  return status === 'REJECTED' || status.includes('REJECT') || status.includes('DENY') || status.includes('AUDIT_DENY');
}

// Uma apelação do TikTok reabre o GRUPO inteiro. Por isso a central agrupa os
// anúncios rejeitados pelo ad group, em vez de oferecer um botão enganoso para
// cada criativo. IDs/materiais continuam anexados como evidência do incidente.
function normalizeRejectionIncidents(campaigns) {
  const grouped = new Map();
  for (const campaign of Array.isArray(campaigns) ? campaigns : []) {
    const campaignId = String(campaign.platformCampaignId || '');
    const campaignKind = campaign.campaignKind === 'smart_plus' ? 'smart_plus' : 'auction';
    for (const group of (campaign.adSets || [])) {
      const adGroupId = String(group.platformAdSetId || '');
      for (const ad of (group.ads || [])) {
        if (!rejectedStatus(ad.status) && !rejectedStatus(ad.secondaryStatus) && !rejectedStatus(ad.rejectionReason)) continue;
        const adId = String(ad.platformAdId || '');
        if (!adId) continue;
        const key = campaignKind + ':' + (adGroupId || adId);
        if (!grouped.has(key)) {
          grouped.set(key, {
            fingerprint: crypto.createHash('sha256').update([
              campaignKind, adGroupId || adId, String(ad.secondaryStatus || ad.rejectionReason || ad.status || ''),
            ].join('\u0000')).digest('hex'),
            campaignKind,
            campaignId,
            campaignName: String(campaign.campaignName || campaignId),
            adGroupId,
            adGroupName: String(group.adSetName || group.name || adGroupId),
            adId,
            adName: String(ad.name || adId),
            adIds: [],
            adNames: [],
            materialIds: [],
            rawStatus: String(ad.secondaryStatus || ad.rejectionReason || ad.status || ''),
            reason: String(ad.rejectionReason || ad.secondaryStatus || 'Reprovado pelo TikTok'),
          });
        }
        const incident = grouped.get(key);
        incident.adIds.push(adId);
        incident.adNames.push(String(ad.name || adId));
        incident.materialIds.push(...(Array.isArray(ad.materialIds) ? ad.materialIds.map(String) : []));
      }
    }
  }
  return [...grouped.values()].map((incident) => ({
    ...incident,
    adIds: [...new Set(incident.adIds)],
    adNames: [...new Set(incident.adNames)],
    materialIds: [...new Set(incident.materialIds.filter(Boolean))],
  }));
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
    // Cap de ações reais do motor por hora/advertiser. Trava o loop
    // "regra pausa → outra reativa → repete". Default 10. Zero permanece
    // legível para dados legados, mas novas gravações e autonomia o rejeitam.
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
    await sql`CREATE TABLE IF NOT EXISTS ads_pixel_bindings (
      account_id text NOT NULL,
      advertiser_id text NOT NULL,
      pixel_slug text NOT NULL,
      pixel_code text NOT NULL,
      pixel_id text NOT NULL,
      pixel_name text,
      remote_status text,
      last_verified_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (account_id, advertiser_id)
    )`;
    await sql`CREATE INDEX IF NOT EXISTS ads_pixel_bindings_pixel_idx
      ON ads_pixel_bindings (account_id, pixel_slug)`;
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
    // Progresso durável POR ITEM do bulk (F2): grava cada ID criado ANTES de
    // avançar para o próximo passo da composição. É o que torna o retry da fila
    // (at-least-once) seguro sem Idempotency-Key no MCP: pós-crash, o item
    // retoma do passo gravado em vez de recriar a campanha.
    await sql`CREATE TABLE IF NOT EXISTS ads_bulk_progress (
      account_id text NOT NULL,
      job_id text NOT NULL,
      item_index integer NOT NULL,
      created jsonb NOT NULL DEFAULT '{}'::jsonb,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (account_id, job_id, item_index)
    )`;
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
    // Caixa de entrada de reprovações. Um incidente fica aberto enquanto o
    // grupo continua rejeitado; quando some do espelho ele é resolvido. O
    // índice parcial garante uma única apelação ativa por grupo/episódio.
    await sql`CREATE TABLE IF NOT EXISTS ads_ad_rejections (
      id text PRIMARY KEY,
      account_id text NOT NULL,
      advertiser_id text NOT NULL,
      fingerprint text NOT NULL,
      campaign_kind text NOT NULL DEFAULT 'auction',
      campaign_id text,
      campaign_name text,
      adgroup_id text,
      adgroup_name text,
      ad_id text NOT NULL,
      ad_name text,
      ad_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
      ad_names jsonb NOT NULL DEFAULT '[]'::jsonb,
      material_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
      raw_status text,
      reason text,
      status text NOT NULL DEFAULT 'open',
      appeal_status text NOT NULL DEFAULT 'none',
      appeal_text text,
      appeal_auto boolean NOT NULL DEFAULT false,
      appeal_attempts integer NOT NULL DEFAULT 0,
      appeal_error text,
      appeal_attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
      appeal_submitted_at timestamptz,
      first_seen_at timestamptz NOT NULL DEFAULT now(),
      last_seen_at timestamptz NOT NULL DEFAULT now(),
      resolved_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_ads_ad_rejections_open_group
      ON ads_ad_rejections (account_id, advertiser_id, campaign_kind, adgroup_id)
      WHERE status = 'open'`;
    await sql`CREATE INDEX IF NOT EXISTS idx_ads_ad_rejections_inbox
      ON ads_ad_rejections (account_id, advertiser_id, status, last_seen_at DESC)`;
    // F3 — MODO PROPOSTA: regra em mode:'proposal' grava a intenção aqui em
    // vez de chamar o provider. `plan` carrega before/after JÁ computados no
    // momento do hit (a aprovação re-valida contra o estado atual antes de
    // executar). TTL de 6h: proposta velha tem dado defasado — vira 'expired'
    // e recusa aprovação.
    await sql`CREATE TABLE IF NOT EXISTS ads_rule_proposals (
      id text PRIMARY KEY,
      account_id text NOT NULL,
      rule_id text NOT NULL,
      metric text NOT NULL,
      action text NOT NULL,
      advertiser_id text,
      campaign_id text NOT NULL,
      campaign_name text,
      detail text,
      plan jsonb NOT NULL DEFAULT '{}'::jsonb,
      status text NOT NULL DEFAULT 'pending',
      error text,
      created_at timestamptz NOT NULL DEFAULT now(),
      decided_at timestamptz,
      executed_at timestamptz
    )`;
    // Índice (acc, status): o painel lista pendentes por conta a cada poll —
    // sem ele cada load faria seq scan na tabela inteira.
    await sql`CREATE INDEX IF NOT EXISTS idx_ads_rule_proposals_account ON ads_rule_proposals (account_id, status, created_at DESC)`;
    // Dedup: no máximo 1 proposta PENDENTE por (conta, regra, campanha) —
    // dois sweeps concorrentes (tick + hook das rotas) não duplicam.
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_ads_rule_proposals_pending ON ads_rule_proposals (account_id, rule_id, campaign_id) WHERE status = 'pending'`;
    await sql`CREATE TABLE IF NOT EXISTS ads_workspace_preferences (
      account_id text NOT NULL,
      advertiser_id text NOT NULL,
      goals jsonb NOT NULL DEFAULT '{}'::jsonb,
      favorites jsonb NOT NULL DEFAULT '[]'::jsonb,
      columns jsonb NOT NULL DEFAULT '[]'::jsonb,
      memory jsonb NOT NULL DEFAULT '{}'::jsonb,
      governance jsonb NOT NULL DEFAULT '{}'::jsonb,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (account_id, advertiser_id)
    )`;
    await sql`CREATE TABLE IF NOT EXISTS ads_internal_reports (
      id text PRIMARY KEY,
      account_id text NOT NULL,
      advertiser_id text NOT NULL,
      kind text NOT NULL,
      title text NOT NULL,
      content jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )`;
    await sql`CREATE INDEX IF NOT EXISTS ads_internal_reports_account_idx ON ads_internal_reports (account_id, advertiser_id, created_at DESC)`;
    // DEAD-LETTER de ações de regra: quando uma ação REAL do motor falha (o
    // provider recusou/caiu), a intenção não pode sumir no log. Grava aqui com o
    // `plan` (before/after já computados) para o gestor inspecionar e reprocessar
    // com 1 clique. status: pending → resolved | discarded | failed.
    await sql`CREATE TABLE IF NOT EXISTS ads_action_deadletter (
      id text PRIMARY KEY,
      account_id text NOT NULL,
      rule_id text,
      metric text,
      action text NOT NULL,
      advertiser_id text,
      campaign_id text NOT NULL,
      campaign_name text,
      detail text,
      plan jsonb NOT NULL DEFAULT '{}'::jsonb,
      error text,
      status text NOT NULL DEFAULT 'pending',
      attempts integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      resolved_at timestamptz
    )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_ads_action_deadletter_account ON ads_action_deadletter (account_id, status, created_at DESC)`;
    // HISTÓRICO de backtests: cada simulação "e se" grava um resumo (janela +
    // contagem de hits por ação) para comparar o efeito de ajustes de threshold
    // ao longo do tempo, ANTES de ligar a regra. `findings` guarda a amostra
    // (limitada) do que teria acontecido.
    await sql`CREATE TABLE IF NOT EXISTS ads_backtest_runs (
      id text PRIMARY KEY,
      account_id text NOT NULL,
      from_date text,
      to_date text,
      lookback_days integer,
      rules_count integer NOT NULL DEFAULT 0,
      hits integer NOT NULL DEFAULT 0,
      summary jsonb NOT NULL DEFAULT '{}'::jsonb,
      findings jsonb NOT NULL DEFAULT '[]'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_ads_backtest_runs_account ON ads_backtest_runs (account_id, created_at DESC)`;
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

async function listJobs(accountId, limit, advertiserId) {
  accountId = cleanAccountId(accountId);
  if (!enabled) return [];
  await ensureSchema();
  const size = Math.min(100, Math.max(1, Number(limit) || 30));
  const scope = String(advertiserId || '').trim().slice(0, 120);
  if (scope) {
    return sql`SELECT id, kind, status, advertiser_id, progress, error, attempts, created_at, updated_at, completed_at FROM ads_jobs WHERE account_id = ${accountId} AND advertiser_id = ${scope} ORDER BY created_at DESC LIMIT ${size}`;
  }
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
    const itemPayload = {
      ref: item.ref,
      task: item.task || null,
      attempts: item.attempts !== undefined ? item.attempts : undefined,
      retryAt: item.retryAt || null,
    };
    await sql`INSERT INTO ads_job_items (id, account_id, job_id, item_index, status, idempotency_key, payload, result, error) VALUES (${job.id + ':' + item.idx}, ${accountId}, ${job.id}, ${item.idx}, ${itemStatus}, ${itemKey}, ${JSON.stringify(itemPayload)}, ${item.resultId ? JSON.stringify({ resultId: item.resultId }) : null}, ${item.error || null}) ON CONFLICT (account_id, job_id, item_index) DO UPDATE SET status = EXCLUDED.status, payload = EXCLUDED.payload, result = EXCLUDED.result, error = EXCLUDED.error, updated_at = now()`;
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
  const items = itemRows.map((item) => ({
    idx: item.item_index,
    ref: item.payload && item.payload.ref,
    task: item.payload && item.payload.task ? item.payload.task : null,
    status: item.status === 'completed' ? 'done' : item.status,
    error: item.error || null,
    attempts: item.payload && item.payload.attempts !== undefined ? item.payload.attempts : undefined,
    retryAt: (item.payload && item.payload.retryAt) || null,
    resultId: item.result && item.result.resultId ? item.result.resultId : null,
  }));
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

// ── Progresso por item do bulk (F2) ─────────────────────────────────────────
// getBulkProgress: o que este item JÁ criou na plataforma (retomada pós-crash).
// saveBulkProgress: merge do progresso — chamado após CADA passo da composição.
// Sem Neon (enabled=false) devolve {} e não grava: o bulk continua funcionando,
// só sem a garantia de retomada (mesma degradação do resto do ops-store).
async function getBulkProgress(accountId, jobId, itemIndex) {
  accountId = cleanAccountId(accountId);
  if (!enabled) return {};
  await ensureSchema();
  const rows = await sql`SELECT created FROM ads_bulk_progress WHERE account_id = ${accountId} AND job_id = ${String(jobId)} AND item_index = ${Number(itemIndex) || 0}`;
  return (rows[0] && rows[0].created) || {};
}

async function saveBulkProgress(accountId, jobId, itemIndex, created) {
  accountId = cleanAccountId(accountId);
  if (!enabled) return;
  await ensureSchema();
  const patch = JSON.stringify(created || {});
  await sql`INSERT INTO ads_bulk_progress (account_id, job_id, item_index, created, updated_at)
    VALUES (${accountId}, ${String(jobId)}, ${Number(itemIndex) || 0}, ${patch}::jsonb, now())
    ON CONFLICT (account_id, job_id, item_index)
    DO UPDATE SET created = ads_bulk_progress.created || ${patch}::jsonb, updated_at = now()`;
}

// Lista os eventos de auditoria mais recentes da conta (para a UI mostrar o
// histórico e oferecer "reverter" nas ações reais do motor que têm before_state).
async function listAuditEvents(accountId, limit) {
  accountId = cleanAccountId(accountId);
  if (!enabled) return [];
  await ensureSchema();
  const lim = Math.min(200, Math.max(1, Math.floor(Number(limit) || 50)));
  return await sql`SELECT id, actor_type, actor_id, action, target_type, target_id, advertiser_id, before_state, after_state, reason, metadata, created_at FROM ads_audit_events WHERE account_id = ${accountId} ORDER BY created_at DESC LIMIT ${lim}`;
}

// Conta ações REAIS do motor de regras na última janela (default 1h). É a base
// durável do cap de ações/hora por advertiser (sobrevive a restart, ao contrário de um
// contador em memória). Só conta ações reais — os sufixos '.simulated' (dry-run)
// não entram, senão o dry-run travaria o motor sem nunca tocar a plataforma.
async function countRecentEngineActions(accountId, sinceMs, advertiserId) {
  accountId = cleanAccountId(accountId);
  if (!enabled) return 0;
  await ensureSchema();
  const windowMs = Math.max(60e3, Number(sinceMs) || 3600e3);
  const seconds = Math.ceil(windowMs / 1000);
  // 'rule_proposal.approved' e 'smart_plus_appeal' entram: ambos executam
  // ações REAIS na
  // plataforma — o cap/hora vale para ela como para qualquer outra. Ações
  // parciais também alteraram verba real e contam. Propostas criadas
  // ('rule_proposal.created') NÃO entram: nada foi executado.
  const adv = advertiserId ? String(advertiserId).slice(0, 120) : null;
  const rows = adv
    ? await sql`SELECT count(*)::int AS n FROM ads_audit_events WHERE account_id = ${accountId} AND advertiser_id = ${adv} AND actor_type = 'system' AND action IN ('rule_action', 'rule_action.partial', 'schedule_action', 'rule_proposal.approved', 'rule_proposal.partial', 'smart_plus_appeal') AND created_at > now() - make_interval(secs => ${seconds})`
    : await sql`SELECT count(*)::int AS n FROM ads_audit_events WHERE account_id = ${accountId} AND actor_type = 'system' AND action IN ('rule_action', 'rule_action.partial', 'schedule_action', 'rule_proposal.approved', 'rule_proposal.partial', 'smart_plus_appeal') AND created_at > now() - make_interval(secs => ${seconds})`;
  return rows.length ? Number(rows[0].n) || 0 : 0;
}

// ── F3: propostas do motor de regras (modo proposta) ────────────────────────
// Cria proposta pendente. Dedup pelo índice único parcial: já existe pendente
// para a mesma (regra, campanha) → devolve null (nada re-gravado).
async function createRuleProposal(accountId, input) {
  accountId = cleanAccountId(accountId);
  if (!enabled) return null;
  await ensureSchema();
  const v = input || {};
  try {
    const rows = await sql`INSERT INTO ads_rule_proposals (id, account_id, rule_id, metric, action, advertiser_id, campaign_id, campaign_name, detail, plan)
      VALUES (${id('prop_')}, ${accountId}, ${String(v.ruleId || '').slice(0, 24)}, ${String(v.metric || '').slice(0, 40)}, ${String(v.action || '').slice(0, 40)}, ${v.advertiserId ? String(v.advertiserId).slice(0, 120) : null}, ${String(v.campaignId || '').slice(0, 160)}, ${v.campaignName ? String(v.campaignName).slice(0, 200) : null}, ${v.detail ? String(v.detail).slice(0, 500) : null}, ${JSON.stringify(v.plan || {})})
      ON CONFLICT DO NOTHING RETURNING *`;
    return rows[0] || null;
  } catch (_) { return null; } // proposta é best-effort: nunca derruba o sweep
}

const PROPOSAL_TTL_MS = 6 * 3600e3; // 6h — depois disso o dado do plan está defasado

// Lista propostas da conta. Antes de listar, expira as pendentes velhas —
// a UI nunca mostra uma proposta "aprovável" com dados de ontem.
async function listRuleProposals(accountId, { status, limit, advertiserId } = {}) {
  accountId = cleanAccountId(accountId);
  if (!enabled) return [];
  await ensureSchema();
  await sql`UPDATE ads_rule_proposals SET status = 'expired', decided_at = now() WHERE account_id = ${accountId} AND status = 'pending' AND created_at < now() - make_interval(secs => ${PROPOSAL_TTL_MS / 1000})`;
  const max = Math.min(200, Math.max(1, Number(limit) || 50));
  const adv = advertiserId ? String(advertiserId).slice(0, 120) : null;
  if (status && adv) {
    return await sql`SELECT * FROM ads_rule_proposals WHERE account_id = ${accountId} AND advertiser_id = ${adv} AND status = ${String(status).slice(0, 20)} ORDER BY created_at DESC LIMIT ${max}`;
  }
  if (status) {
    return await sql`SELECT * FROM ads_rule_proposals WHERE account_id = ${accountId} AND status = ${String(status).slice(0, 20)} ORDER BY created_at DESC LIMIT ${max}`;
  }
  if (adv) return await sql`SELECT * FROM ads_rule_proposals WHERE account_id = ${accountId} AND advertiser_id = ${adv} ORDER BY created_at DESC LIMIT ${max}`;
  return await sql`SELECT * FROM ads_rule_proposals WHERE account_id = ${accountId} ORDER BY created_at DESC LIMIT ${max}`;
}

// Busca uma proposta específica (escopada à conta) — o approve precisa dela
// ANTES da transição (advertiser_id para o assertMutationAllowed).
async function getRuleProposal(accountId, proposalId) {
  accountId = cleanAccountId(accountId);
  if (!enabled) return null;
  await ensureSchema();
  const rows = await sql`SELECT * FROM ads_rule_proposals WHERE account_id = ${accountId} AND id = ${String(proposalId || '').slice(0, 160)} LIMIT 1`;
  return rows[0] || null;
}

// Transição atômica pending→(approved|rejected). O WHERE carrega o TTL: uma
// proposta velha NUNCA transiciona (0 linhas → chamador trata como expirada).
async function decideRuleProposal(accountId, proposalId, decision) {
  accountId = cleanAccountId(accountId);
  if (!enabled) return null;
  if (!['approved', 'rejected'].includes(decision)) throw new Error('decisão inválida');
  await ensureSchema();
  const rows = await sql`UPDATE ads_rule_proposals SET status = ${decision}, decided_at = now()
    WHERE account_id = ${accountId} AND id = ${String(proposalId || '').slice(0, 160)}
      AND status = 'pending' AND created_at > now() - make_interval(secs => ${PROPOSAL_TTL_MS / 1000})
    RETURNING *`;
  return rows[0] || null;
}

// Resultado da execução pós-aprovação: 'executed' ou 'failed' (+erro).
async function markProposalExecution(accountId, proposalId, ok, error) {
  accountId = cleanAccountId(accountId);
  if (!enabled) return null;
  await ensureSchema();
  const rows = await sql`UPDATE ads_rule_proposals SET status = ${ok ? 'executed' : 'failed'}, error = ${error ? String(error).slice(0, 300) : null}, executed_at = now()
    WHERE account_id = ${accountId} AND id = ${String(proposalId || '').slice(0, 160)} AND status = 'approved' RETURNING *`;
  return rows[0] || null;
}

// Se o lease distribuído for perdido ENTRE a reserva e a chamada externa,
// nenhuma mutação foi enviada (executeRuleAction valida o lease primeiro).
// Nesse caso a proposta volta a pending em vez de ficar aprovada/fracassada.
async function releaseProposalApproval(accountId, proposalId, error) {
  accountId = cleanAccountId(accountId);
  if (!enabled) return null;
  await ensureSchema();
  const rows = await sql`UPDATE ads_rule_proposals
    SET status = 'pending', decided_at = null, error = ${error ? String(error).slice(0, 300) : null}
    WHERE account_id = ${accountId}
      AND id = ${String(proposalId || '').slice(0, 160)}
      AND status = 'approved'
      AND created_at > now() - make_interval(secs => ${PROPOSAL_TTL_MS / 1000})
    RETURNING *`;
  return rows[0] || null;
}

// ── Dead-letter de ações de regra ───────────────────────────────────────────
// Grava a ação real que FALHOU. Best-effort: nunca derruba o sweep. Devolve a
// row criada (ou null se persistência off).
async function addActionDeadLetter(accountId, input) {
  accountId = cleanAccountId(accountId);
  if (!enabled) return null;
  await ensureSchema();
  const v = input || {};
  try {
    const rows = await sql`INSERT INTO ads_action_deadletter (id, account_id, rule_id, metric, action, advertiser_id, campaign_id, campaign_name, detail, plan, error)
      VALUES (${id('dl_')}, ${accountId}, ${v.ruleId ? String(v.ruleId).slice(0, 24) : null}, ${v.metric ? String(v.metric).slice(0, 40) : null}, ${String(v.action || '').slice(0, 40)}, ${v.advertiserId ? String(v.advertiserId).slice(0, 120) : null}, ${String(v.campaignId || '').slice(0, 160)}, ${v.campaignName ? String(v.campaignName).slice(0, 200) : null}, ${v.detail ? String(v.detail).slice(0, 500) : null}, ${JSON.stringify(v.plan || {})}, ${v.error ? String(v.error).slice(0, 500) : null})
      RETURNING *`;
    return rows[0] || null;
  } catch (_) { return null; }
}

async function listActionDeadLetter(accountId, { status, limit } = {}) {
  accountId = cleanAccountId(accountId);
  if (!enabled) return [];
  await ensureSchema();
  const max = Math.min(200, Math.max(1, Number(limit) || 50));
  if (status) {
    return await sql`SELECT * FROM ads_action_deadletter WHERE account_id = ${accountId} AND status = ${String(status).slice(0, 20)} ORDER BY created_at DESC LIMIT ${max}`;
  }
  return await sql`SELECT * FROM ads_action_deadletter WHERE account_id = ${accountId} ORDER BY created_at DESC LIMIT ${max}`;
}

async function getActionDeadLetter(accountId, dlId) {
  accountId = cleanAccountId(accountId);
  if (!enabled) return null;
  await ensureSchema();
  const rows = await sql`SELECT * FROM ads_action_deadletter WHERE account_id = ${accountId} AND id = ${String(dlId || '').slice(0, 160)} LIMIT 1`;
  return rows[0] || null;
}

// Transição de status (+incrementa attempts no reprocessamento). Só sai de
// 'pending': uma entrada já resolvida/descartada não volta atrás.
async function markActionDeadLetter(accountId, dlId, status, { error, incrementAttempt } = {}) {
  accountId = cleanAccountId(accountId);
  if (!enabled) return null;
  if (!['pending', 'resolved', 'discarded', 'failed'].includes(status)) throw new Error('status inválido');
  await ensureSchema();
  const rows = await sql`UPDATE ads_action_deadletter
    SET status = ${status}, error = ${error ? String(error).slice(0, 500) : null}, attempts = attempts + ${incrementAttempt ? 1 : 0}, updated_at = now(), resolved_at = CASE WHEN ${status} IN ('resolved','discarded') THEN now() ELSE resolved_at END
    WHERE account_id = ${accountId} AND id = ${String(dlId || '').slice(0, 160)} AND status = 'pending' RETURNING *`;
  return rows[0] || null;
}

// Quando um lote de orçamento falha depois de alguns targets confirmados, a
// entrada pendente passa a conter SOMENTE o restante. Isso impede repetir uma
// alteração já aplicada ao reprocessar após perda de lease/falha parcial.
async function updateActionDeadLetterPlan(accountId, dlId, plan, { error, incrementAttempt } = {}) {
  accountId = cleanAccountId(accountId);
  if (!enabled) return null;
  await ensureSchema();
  const rows = await sql`UPDATE ads_action_deadletter
    SET plan = ${JSON.stringify(plan || {})},
        error = ${error ? String(error).slice(0, 500) : null},
        attempts = attempts + ${incrementAttempt ? 1 : 0},
        updated_at = now()
    WHERE account_id = ${accountId}
      AND id = ${String(dlId || '').slice(0, 160)}
      AND status = 'pending'
    RETURNING *`;
  return rows[0] || null;
}

async function countPendingActionDeadLetter(accountId) {
  accountId = cleanAccountId(accountId);
  if (!enabled) return 0;
  await ensureSchema();
  const rows = await sql`SELECT count(*)::int AS n FROM ads_action_deadletter WHERE account_id = ${accountId} AND status = 'pending'`;
  return rows.length ? Number(rows[0].n) || 0 : 0;
}

// ── Histórico de backtests ──────────────────────────────────────────────────
async function saveBacktestRun(accountId, input) {
  accountId = cleanAccountId(accountId);
  if (!enabled) return null;
  await ensureSchema();
  const v = input || {};
  const window = v.window || {};
  const summary = v.summary || {};
  // guarda no máx. 200 findings — evita linha gigante em contas com muitas campanhas
  const findings = Array.isArray(v.findings) ? v.findings.slice(0, 200) : [];
  try {
    const rows = await sql`INSERT INTO ads_backtest_runs (id, account_id, from_date, to_date, lookback_days, rules_count, hits, summary, findings)
      VALUES (${id('bt_')}, ${accountId}, ${window.fromDate ? String(window.fromDate).slice(0, 10) : null}, ${window.toDate ? String(window.toDate).slice(0, 10) : null}, ${Number(window.lookbackDays) || null}, ${Number(summary.rules) || 0}, ${Number(summary.hits) || 0}, ${JSON.stringify(summary)}, ${JSON.stringify(findings)})
      RETURNING id, created_at`;
    return rows[0] || null;
  } catch (_) { return null; }
}

async function listBacktestRuns(accountId, limit) {
  accountId = cleanAccountId(accountId);
  if (!enabled) return [];
  await ensureSchema();
  const max = Math.min(100, Math.max(1, Number(limit) || 20));
  return await sql`SELECT id, from_date, to_date, lookback_days, rules_count, hits, summary, created_at FROM ads_backtest_runs WHERE account_id = ${accountId} ORDER BY created_at DESC LIMIT ${max}`;
}

async function getBacktestRun(accountId, runId) {
  accountId = cleanAccountId(accountId);
  if (!enabled) return null;
  await ensureSchema();
  const rows = await sql`SELECT * FROM ads_backtest_runs WHERE account_id = ${accountId} AND id = ${String(runId || '').slice(0, 160)} LIMIT 1`;
  return rows[0] || null;
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

function cleanAdvertiserId(value) {
  const advertiserId = String(value || '').trim().slice(0, 120);
  if (!advertiserId) throw new Error('advertiserId obrigatório');
  return advertiserId;
}

function normalizeWorkspace(input) {
  const value = input || {};
  const goals = value.goals || {};
  const governance = value.governance || {};
  const favorites = Array.isArray(value.favorites) ? value.favorites : [];
  return {
    goals: {
      roasMin: Math.max(0, Number(goals.roasMin) || 0),
      cpaMax: Math.max(0, Number(goals.cpaMax) || 0),
      dailySpendCap: Math.max(0, Number(goals.dailySpendCap) || 0),
      conversionsTarget: Math.max(0, Math.floor(Number(goals.conversionsTarget) || 0)),
      revenueTarget: Math.max(0, Number(goals.revenueTarget) || 0)
    },
    favorites: favorites.map((item) => ({
      type: ['campaign', 'product', 'rule'].includes(item && item.type) ? item.type : 'campaign',
      id: String(item && item.id || '').slice(0, 160),
      label: String(item && item.label || '').slice(0, 200)
    })).filter((item) => item.id).slice(0, 100),
    columns: Array.isArray(value.columns) ? [...new Set(value.columns.map(String))].slice(0, 20) : [],
    memory: Object.fromEntries(Object.entries(value.memory && typeof value.memory === 'object' ? value.memory : {}).slice(0, 20).map(([key, val]) => [String(key).slice(0, 60), String(val).slice(0, 500)])),
    governance: {
      actorRole: ['viewer', 'analyst', 'operator', 'admin'].includes(governance.actorRole) ? governance.actorRole : 'admin',
      requiredApprovals: 1,
      dualApprovalEnabled: false,
      maxTargetsPerAction: Math.min(100, Math.max(1, Number(governance.maxTargetsPerAction) || 20)),
      maxTotalBudget: Math.max(0, Number(governance.maxTotalBudget) || 0)
    }
  };
}

async function getWorkspace(accountId, advertiserId) {
  accountId = cleanAccountId(accountId);
  advertiserId = cleanAdvertiserId(advertiserId);
  if (!enabled) return normalizeWorkspace({});
  await ensureSchema();
  const rows = await sql`SELECT goals, favorites, columns, memory, governance, updated_at FROM ads_workspace_preferences WHERE account_id = ${accountId} AND advertiser_id = ${advertiserId} LIMIT 1`;
  if (!rows.length) return { ...normalizeWorkspace({}), updatedAt: null };
  const row = rows[0];
  return { ...normalizeWorkspace(row), updatedAt: row.updated_at };
}

async function saveWorkspace(accountId, advertiserId, input) {
  accountId = cleanAccountId(accountId);
  advertiserId = cleanAdvertiserId(advertiserId);
  if (!enabled) throw new Error('Persistência Neon indisponível');
  await ensureSchema();
  const value = normalizeWorkspace(input);
  await sql`INSERT INTO ads_workspace_preferences (account_id, advertiser_id, goals, favorites, columns, memory, governance) VALUES (${accountId}, ${advertiserId}, ${JSON.stringify(value.goals)}, ${JSON.stringify(value.favorites)}, ${JSON.stringify(value.columns)}, ${JSON.stringify(value.memory)}, ${JSON.stringify(value.governance)}) ON CONFLICT (account_id, advertiser_id) DO UPDATE SET goals = EXCLUDED.goals, favorites = EXCLUDED.favorites, columns = EXCLUDED.columns, memory = EXCLUDED.memory, governance = EXCLUDED.governance, updated_at = now()`;
  return value;
}

async function createInternalReport(accountId, advertiserId, input) {
  accountId = cleanAccountId(accountId);
  advertiserId = cleanAdvertiserId(advertiserId);
  if (!enabled) throw new Error('Persistência Neon indisponível');
  await ensureSchema();
  const kind = ['daily', 'weekly', 'monthly'].includes(input && input.kind) ? input.kind : 'daily';
  const rows = await sql`INSERT INTO ads_internal_reports (id, account_id, advertiser_id, kind, title, content) VALUES (${id('report_')}, ${accountId}, ${advertiserId}, ${kind}, ${String(input && input.title || 'Relatório TikTok Ads').slice(0, 200)}, ${JSON.stringify(input && input.content || {})}) RETURNING id, advertiser_id, kind, title, content, created_at`;
  return rows[0];
}

async function listInternalReports(accountId, advertiserId, limit) {
  accountId = cleanAccountId(accountId);
  advertiserId = cleanAdvertiserId(advertiserId);
  if (!enabled) return [];
  await ensureSchema();
  const size = Math.min(50, Math.max(1, Number(limit) || 20));
  return sql`SELECT id, advertiser_id, kind, title, content, created_at FROM ads_internal_reports WHERE account_id = ${accountId} AND advertiser_id = ${advertiserId} ORDER BY created_at DESC LIMIT ${size}`;
}

function pixelBindingKey(accountId, advertiserId) {
  return cleanAccountId(accountId) + ':' + cleanAdvertiserId(advertiserId);
}

function mapPixelBinding(row) {
  if (!row) return null;
  return {
    advertiserId: String(row.advertiser_id || row.advertiserId || ''),
    pixelSlug: String(row.pixel_slug || row.pixelSlug || ''),
    pixelCode: String(row.pixel_code || row.pixelCode || ''),
    pixelId: String(row.pixel_id || row.pixelId || ''),
    pixelName: String(row.pixel_name || row.pixelName || ''),
    remoteStatus: String(row.remote_status || row.remoteStatus || ''),
    lastVerifiedAt: row.last_verified_at || row.lastVerifiedAt || null,
  };
}

async function getPixelBinding(accountId, advertiserId) {
  const key = pixelBindingKey(accountId, advertiserId);
  if (!enabled) return mapPixelBinding(pixelBindingMemory.get(key));
  await ensureSchema();
  const rows = await sql`SELECT advertiser_id, pixel_slug, pixel_code, pixel_id,
    pixel_name, remote_status, last_verified_at FROM ads_pixel_bindings
    WHERE account_id = ${cleanAccountId(accountId)} AND advertiser_id = ${cleanAdvertiserId(advertiserId)} LIMIT 1`;
  return mapPixelBinding(rows[0]);
}

async function savePixelBinding(accountId, advertiserId, input) {
  const acc = cleanAccountId(accountId);
  const adv = cleanAdvertiserId(advertiserId);
  const value = mapPixelBinding({ advertiserId: adv, ...(input || {}) });
  if (!/^\d{5,30}$/.test(value.pixelId)) {
    throw new Error('Vínculo de Pixel inválido');
  }
  const key = pixelBindingKey(acc, adv);
  const stored = { ...value, lastVerifiedAt: new Date().toISOString() };
  pixelBindingMemory.set(key, stored);
  if (!enabled) return stored;
  await ensureSchema();
  const rows = await sql`INSERT INTO ads_pixel_bindings
    (account_id, advertiser_id, pixel_slug, pixel_code, pixel_id, pixel_name, remote_status, last_verified_at)
    VALUES (${acc}, ${adv}, ${value.pixelSlug}, ${value.pixelCode}, ${value.pixelId},
      ${value.pixelName || null}, ${value.remoteStatus || null}, now())
    ON CONFLICT (account_id, advertiser_id) DO UPDATE SET
      pixel_slug = EXCLUDED.pixel_slug, pixel_code = EXCLUDED.pixel_code,
      pixel_id = EXCLUDED.pixel_id, pixel_name = EXCLUDED.pixel_name,
      remote_status = EXCLUDED.remote_status, last_verified_at = now(), updated_at = now()
    RETURNING advertiser_id, pixel_slug, pixel_code, pixel_id, pixel_name, remote_status, last_verified_at`;
  return mapPixelBinding(rows[0]);
}

async function deletePixelBinding(accountId, advertiserId) {
  const acc = cleanAccountId(accountId);
  const adv = cleanAdvertiserId(advertiserId);
  pixelBindingMemory.delete(pixelBindingKey(acc, adv));
  if (!enabled) return true;
  await ensureSchema();
  await sql`DELETE FROM ads_pixel_bindings WHERE account_id = ${acc} AND advertiser_id = ${adv}`;
  return true;
}

// Exclusão de um Pixel local invalida todos os vínculos centrais que apontam
// para ele. A limpeza é escopada por conta para nenhuma campanha futura
// reutilizar silenciosamente uma referência órfã.
async function deletePixelBindingsBySlug(accountId, pixelSlug) {
  const acc = cleanAccountId(accountId);
  const slug = String(pixelSlug || '').trim();
  if (!slug) throw new Error('pixelSlug obrigatório');

  let removedFromMemory = 0;
  for (const [key, binding] of pixelBindingMemory.entries()) {
    if (!key.startsWith(acc + ':') || !binding || binding.pixelSlug !== slug) continue;
    pixelBindingMemory.delete(key);
    removedFromMemory++;
  }
  if (!enabled) return removedFromMemory;

  await ensureSchema();
  const rows = await sql`DELETE FROM ads_pixel_bindings
    WHERE account_id = ${acc} AND pixel_slug = ${slug}
    RETURNING advertiser_id`;
  return rows.length;
}

function mapAdRejection(row) {
  if (!row) return null;
  return {
    id: String(row.id || ''),
    advertiserId: String(row.advertiser_id || row.advertiserId || ''),
    fingerprint: String(row.fingerprint || ''),
    campaignKind: String(row.campaign_kind || row.campaignKind || 'auction'),
    campaignId: String(row.campaign_id || row.campaignId || ''),
    campaignName: String(row.campaign_name || row.campaignName || ''),
    adGroupId: String(row.adgroup_id || row.adGroupId || ''),
    adGroupName: String(row.adgroup_name || row.adGroupName || ''),
    adId: String(row.ad_id || row.adId || ''),
    adName: String(row.ad_name || row.adName || ''),
    adIds: Array.isArray(row.ad_ids || row.adIds) ? (row.ad_ids || row.adIds).map(String) : [],
    adNames: Array.isArray(row.ad_names || row.adNames) ? (row.ad_names || row.adNames).map(String) : [],
    materialIds: Array.isArray(row.material_ids || row.materialIds) ? (row.material_ids || row.materialIds).map(String) : [],
    rawStatus: String(row.raw_status || row.rawStatus || ''),
    reason: String(row.reason || 'Reprovado pelo TikTok'),
    status: String(row.status || 'open'),
    appealStatus: String(row.appeal_status || row.appealStatus || 'none'),
    appealText: String(row.appeal_text || row.appealText || ''),
    appealAuto: row.appeal_auto === true || row.appealAuto === true,
    appealAttempts: Number(row.appeal_attempts || row.appealAttempts || 0),
    appealError: String(row.appeal_error || row.appealError || ''),
    appealAttachments: Array.isArray(row.appeal_attachments || row.appealAttachments) ? (row.appeal_attachments || row.appealAttachments).map(String) : [],
    appealSubmittedAt: row.appeal_submitted_at || row.appealSubmittedAt || null,
    firstSeenAt: row.first_seen_at || row.firstSeenAt || null,
    lastSeenAt: row.last_seen_at || row.lastSeenAt || null,
    resolvedAt: row.resolved_at || row.resolvedAt || null,
  };
}

async function syncAdRejections(accountId, advertiserId, campaigns) {
  const acc = cleanAccountId(accountId);
  const adv = cleanAdvertiserId(advertiserId);
  const incidents = normalizeRejectionIncidents(campaigns).map((item) => ({
    ...item,
    adGroupId: item.adGroupId || item.adId,
    adGroupName: item.adGroupName || item.adName,
  }));
  const now = new Date().toISOString();
  if (!enabled) {
    const scope = rejectionScope(acc, adv);
    const rows = rejectionMemory.get(scope) || [];
    const open = new Map(rows.filter((row) => row.status === 'open').map((row) => [row.campaignKind + ':' + row.adGroupId, row]));
    const seen = new Set();
    for (const incident of incidents) {
      const key = incident.campaignKind + ':' + incident.adGroupId;
      seen.add(key);
      const current = open.get(key);
      if (current) Object.assign(current, incident, { lastSeenAt: now });
      else rows.unshift(mapAdRejection({ id: id('rej_'), advertiserId: adv, ...incident, status: 'open', appealStatus: 'none', firstSeenAt: now, lastSeenAt: now }));
    }
    for (const row of rows) {
      const key = row.campaignKind + ':' + row.adGroupId;
      if (row.status === 'open' && !seen.has(key)) Object.assign(row, { status: 'resolved', resolvedAt: now });
    }
    rejectionMemory.set(scope, rows.slice(0, 500));
    return rows.filter((row) => row.status === 'open');
  }

  await ensureSchema();
  const existing = await sql`SELECT * FROM ads_ad_rejections
    WHERE account_id = ${acc} AND advertiser_id = ${adv} AND status = 'open'`;
  const byGroup = new Map(existing.map((row) => [String(row.campaign_kind) + ':' + String(row.adgroup_id), row]));
  const seenIds = new Set();
  for (const incident of incidents) {
    const current = byGroup.get(incident.campaignKind + ':' + incident.adGroupId);
    if (current) {
      seenIds.add(String(current.id));
      await sql`UPDATE ads_ad_rejections SET fingerprint = ${incident.fingerprint}, campaign_id = ${incident.campaignId || null},
        campaign_name = ${incident.campaignName || null}, adgroup_name = ${incident.adGroupName || null},
        ad_id = ${incident.adId}, ad_name = ${incident.adName || null}, ad_ids = ${JSON.stringify(incident.adIds)},
        ad_names = ${JSON.stringify(incident.adNames)}, material_ids = ${JSON.stringify(incident.materialIds)},
        raw_status = ${incident.rawStatus || null}, reason = ${incident.reason || null}, last_seen_at = now(), updated_at = now()
        WHERE account_id = ${acc} AND id = ${current.id}`;
      continue;
    }
    const newId = id('rej_');
    const inserted = await sql`INSERT INTO ads_ad_rejections
      (id, account_id, advertiser_id, fingerprint, campaign_kind, campaign_id, campaign_name,
       adgroup_id, adgroup_name, ad_id, ad_name, ad_ids, ad_names, material_ids, raw_status, reason)
      VALUES (${newId}, ${acc}, ${adv}, ${incident.fingerprint}, ${incident.campaignKind}, ${incident.campaignId || null},
       ${incident.campaignName || null}, ${incident.adGroupId}, ${incident.adGroupName || null}, ${incident.adId},
       ${incident.adName || null}, ${JSON.stringify(incident.adIds)}, ${JSON.stringify(incident.adNames)},
       ${JSON.stringify(incident.materialIds)}, ${incident.rawStatus || null}, ${incident.reason || null})
      ON CONFLICT DO NOTHING RETURNING id`;
    if (inserted[0]) seenIds.add(String(inserted[0].id));
    else {
      const collision = await sql`SELECT id FROM ads_ad_rejections WHERE account_id = ${acc} AND advertiser_id = ${adv}
        AND campaign_kind = ${incident.campaignKind} AND adgroup_id = ${incident.adGroupId} AND status = 'open' LIMIT 1`;
      if (collision[0]) seenIds.add(String(collision[0].id));
    }
  }
  for (const row of existing) {
    if (seenIds.has(String(row.id))) continue;
    await sql`UPDATE ads_ad_rejections SET status = 'resolved', resolved_at = now(), updated_at = now()
      WHERE account_id = ${acc} AND id = ${row.id} AND status = 'open'`;
  }
  return listAdRejections(acc, { advertiserId: adv, status: 'open' });
}

async function listAdRejections(accountId, opts = {}) {
  const acc = cleanAccountId(accountId);
  const adv = opts.advertiserId ? cleanAdvertiserId(opts.advertiserId) : '';
  const status = ['open', 'resolved'].includes(opts.status) ? opts.status : '';
  const limit = Math.min(200, Math.max(1, Number(opts.limit) || 100));
  if (!enabled) {
    const scopes = adv ? [rejectionScope(acc, adv)] : [...rejectionMemory.keys()].filter((key) => key.startsWith(acc + ':'));
    return scopes.flatMap((key) => rejectionMemory.get(key) || [])
      .filter((row) => !status || row.status === status)
      .sort((a, b) => String(b.lastSeenAt || '').localeCompare(String(a.lastSeenAt || ''))).slice(0, limit);
  }
  await ensureSchema();
  let rows;
  if (adv && status) rows = await sql`SELECT * FROM ads_ad_rejections WHERE account_id = ${acc} AND advertiser_id = ${adv} AND status = ${status} ORDER BY last_seen_at DESC LIMIT ${limit}`;
  else if (adv) rows = await sql`SELECT * FROM ads_ad_rejections WHERE account_id = ${acc} AND advertiser_id = ${adv} ORDER BY last_seen_at DESC LIMIT ${limit}`;
  else if (status) rows = await sql`SELECT * FROM ads_ad_rejections WHERE account_id = ${acc} AND status = ${status} ORDER BY last_seen_at DESC LIMIT ${limit}`;
  else rows = await sql`SELECT * FROM ads_ad_rejections WHERE account_id = ${acc} ORDER BY last_seen_at DESC LIMIT ${limit}`;
  return rows.map(mapAdRejection);
}

async function getAdRejection(accountId, rejectionId) {
  const acc = cleanAccountId(accountId);
  const rid = String(rejectionId || '').slice(0, 160);
  if (!enabled) {
    for (const [scope, rows] of rejectionMemory) {
      if (!scope.startsWith(acc + ':')) continue;
      const found = rows.find((row) => row.id === rid);
      if (found) return found;
    }
    return null;
  }
  await ensureSchema();
  const rows = await sql`SELECT * FROM ads_ad_rejections WHERE account_id = ${acc} AND id = ${rid} LIMIT 1`;
  return mapAdRejection(rows[0]);
}

function buildAdAppealText(rejection, customText) {
  const custom = String(customText || '').trim();
  if (custom) return custom.slice(0, 2000);
  const item = rejection || {};
  return ('Solicito uma nova revisão manual do grupo de anúncios "' + String(item.adGroupName || item.adName || item.adGroupId || item.adId || 'sem nome')
    + '". A integração registrou o status "' + String(item.rawStatus || 'reprovado')
    + '", mas a resposta disponível não trouxe a política específica nem o trecho exato que motivou a reprovação. '
    + 'Peço a reavaliação do criativo e do destino no contexto completo da oferta. Se ainda houver não conformidade, por favor indiquem a política e o elemento preciso que precisa ser corrigido.').slice(0, 2000);
}

async function reserveAdAppeal(accountId, rejectionId, input = {}) {
  const acc = cleanAccountId(accountId);
  const current = await getAdRejection(acc, rejectionId);
  if (!current || current.status !== 'open') return null;
  if (['submitting', 'submitted', 'in_review'].includes(current.appealStatus)) return null;
  const text = buildAdAppealText(current, input.text);
  const attachments = (Array.isArray(input.attachments) ? input.attachments : []).map(String).filter(Boolean).slice(0, 20);
  if (!enabled) {
    Object.assign(current, { appealStatus: 'submitting', appealText: text, appealAuto: input.auto === true,
      appealAttempts: current.appealAttempts + 1, appealAttachments: attachments, appealError: '' });
    return current;
  }
  const rows = await sql`UPDATE ads_ad_rejections SET appeal_status = 'submitting', appeal_text = ${text},
    appeal_auto = ${input.auto === true}, appeal_attempts = appeal_attempts + 1, appeal_error = null,
    appeal_attachments = ${JSON.stringify(attachments)}, updated_at = now()
    WHERE account_id = ${acc} AND id = ${String(rejectionId)} AND status = 'open'
      AND appeal_status NOT IN ('submitting','submitted','in_review') RETURNING *`;
  return mapAdRejection(rows[0]);
}

async function finishAdAppeal(accountId, rejectionId, result = {}) {
  const acc = cleanAccountId(accountId);
  const status = result.ok ? 'submitted' : 'failed';
  const error = result.ok ? '' : String(result.error || 'Falha ao enviar recurso').slice(0, 500);
  if (!enabled) {
    const current = await getAdRejection(acc, rejectionId);
    if (current) Object.assign(current, { appealStatus: status, appealError: error, appealSubmittedAt: result.ok ? new Date().toISOString() : null });
    return current;
  }
  const rows = await sql`UPDATE ads_ad_rejections SET appeal_status = ${status}, appeal_error = ${error || null},
    appeal_submitted_at = ${result.ok ? new Date().toISOString() : null}, updated_at = now()
    WHERE account_id = ${acc} AND id = ${String(rejectionId)} RETURNING *`;
  return mapAdRejection(rows[0]);
}

async function releaseAdAppealReservation(accountId, rejectionId, error) {
  const acc = cleanAccountId(accountId);
  if (!enabled) {
    const current = await getAdRejection(acc, rejectionId);
    if (current && current.appealStatus === 'submitting') {
      Object.assign(current, {
        appealStatus: 'not_requested',
        appealAttempts: Math.max(0, Number(current.appealAttempts || 0) - 1),
        appealError: String(error || '').slice(0, 500),
      });
    }
    return current;
  }
  const rows = await sql`UPDATE ads_ad_rejections
    SET appeal_status = 'not_requested',
        appeal_attempts = GREATEST(0, appeal_attempts - 1),
        appeal_error = ${error ? String(error).slice(0, 500) : null},
        updated_at = now()
    WHERE account_id = ${acc}
      AND id = ${String(rejectionId)}
      AND appeal_status = 'submitting'
    RETURNING *`;
  return mapAdRejection(rows[0]);
}

module.exports = { enabled, ensureSchema, cleanAccountId, normalizePolicy, assertMutationAllowed, retryDelayMs, circuitBreakerOpen, getSafetyPolicy, saveSafetyPolicy, createJob, findJobByIdempotencyKey, listJobs, persistBulkSnapshot, getBulkSnapshot, appendAuditEvent, getAuditEvent, listAuditEvents, countRecentEngineActions, getBulkProgress, saveBulkProgress, claimNextJob, retryJob, reconcileOrphanJobs, setJobStatus, normalizeAccountStatus, upsertAccountHealth, listAccountHealth, createUnbanTicketIfAbsent, listUnbanTickets, updateUnbanTicket, resolveTicketsForAdvertiser, createRuleProposal, listRuleProposals, getRuleProposal, decideRuleProposal, markProposalExecution, releaseProposalApproval, addActionDeadLetter, listActionDeadLetter, getActionDeadLetter, markActionDeadLetter, updateActionDeadLetterPlan, countPendingActionDeadLetter, saveBacktestRun, listBacktestRuns, getBacktestRun, getWorkspace, saveWorkspace, createInternalReport, listInternalReports, normalizeWorkspace, getPixelBinding, savePixelBinding, deletePixelBinding, deletePixelBindingsBySlug, normalizeRejectionIncidents, syncAdRejections, listAdRejections, getAdRejection, buildAdAppealText, reserveAdAppeal, finishAdAppeal, releaseAdAppealReservation, PROPOSAL_TTL_MS };
