// ── Espelho durável do Pipeboard no Neon (cache de leitura) ─────────────────
// PORQUÊ: a dashboard era stateless — cada tela batia ao vivo na API do
// Pipeboard (TTFB ~1,4s + acoplada à disponibilidade do provider). Aqui
// guardamos um ESPELHO por (conta, advertiser): a ESTRUTURA da árvore
// (campanhas→adgroups→ads, com status/budget/creative já derivados pelo
// provider) como JSONB, e as MÉTRICAS DIÁRIAS normalizadas numa tabela própria.
//
// Assim, QUALQUER intervalo de datas pedido pela dashboard é servido do Neon
// (agregando os dias da janela) — zero chamadas ao provider no caminho de
// leitura. O único consumidor de leitura do Pipeboard é o motor de sync
// (ads-sync.js), que reescreve este espelho a cada N minutos.
//
// Convenções seguidas do resto do projeto (db.js / ads-ops-store.js):
//   - @neondatabase/serverless com tagged-template `sql`;
//   - ensureSchema() idempotente (CREATE TABLE IF NOT EXISTS), chamado no boot;
//   - multi-tenant: toda linha carrega account_id.
const { neon } = require('@neondatabase/serverless');

const URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL || null;
const sql = URL ? neon(URL) : null;
const enabled = !!sql;

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function cleanAccountId(value) {
  const accountId = String(value || '').trim();
  if (!accountId || accountId === '__all__') throw new Error('accountId específico é obrigatório');
  return accountId.slice(0, 120);
}

// ── Schema ──────────────────────────────────────────────────────────────────
let schemaReady = null;
async function ensureSchema() {
  if (!enabled) return false;
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    // Estrutura da árvore: 1 linha por campanha, com o NÓ COMPLETO (adSets/ads,
    // status/review/budget/creative) em `data` — sem métricas, que são
    // sobrepostas na leitura a partir de ads_metrics_cache. synced_at data o
    // último sync que tocou a linha (permite podar entidades removidas lá fora).
    await sql`CREATE TABLE IF NOT EXISTS ads_campaigns_cache (
      account_id text NOT NULL,
      advertiser_id text NOT NULL,
      campaign_id text NOT NULL,
      name text,
      status text,
      operation_status text,
      objective text,
      budget numeric,
      budget_mode text,
      currency text,
      ad_count integer NOT NULL DEFAULT 0,
      ad_set_count integer NOT NULL DEFAULT 0,
      data jsonb NOT NULL DEFAULT '{}'::jsonb,
      synced_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (account_id, advertiser_id, campaign_id)
    )`;
    await sql`CREATE INDEX IF NOT EXISTS ads_campaigns_cache_adv_idx ON ads_campaigns_cache (account_id, advertiser_id)`;

    // Métricas DIÁRIAS por entidade e nível. A granularidade de dia é o que
    // torna qualquer date-range servível por agregação (SUM sobre a janela).
    // level: 'campaign' | 'adgroup' | 'ad'. entity_id = id da plataforma.
    await sql`CREATE TABLE IF NOT EXISTS ads_metrics_cache (
      account_id text NOT NULL,
      advertiser_id text NOT NULL,
      level text NOT NULL,
      entity_id text NOT NULL,
      day date NOT NULL,
      spend numeric NOT NULL DEFAULT 0,
      impressions bigint NOT NULL DEFAULT 0,
      clicks bigint NOT NULL DEFAULT 0,
      conversions numeric NOT NULL DEFAULT 0,
      reach bigint NOT NULL DEFAULT 0,
      synced_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (account_id, advertiser_id, level, entity_id, day)
    )`;
    await sql`CREATE INDEX IF NOT EXISTS ads_metrics_cache_query_idx ON ads_metrics_cache (account_id, advertiser_id, level, day)`;
    await sql`CREATE INDEX IF NOT EXISTS ads_metrics_cache_entity_idx ON ads_metrics_cache (account_id, advertiser_id, level, entity_id, day)`;

    // Estado do sync por (conta, advertiser): quando sincronizou, com que
    // janela, quantas chamadas gastou, último erro, e quando a dashboard
    // visualizou a conta pela última vez (activity → alvo do sync ativo).
    await sql`CREATE TABLE IF NOT EXISTS ads_sync_state (
      account_id text NOT NULL,
      advertiser_id text NOT NULL,
      status text NOT NULL DEFAULT 'never',
      last_synced_at timestamptz,
      last_full_synced_at timestamptz,
      last_error text,
      last_duration_ms integer,
      calls_used integer NOT NULL DEFAULT 0,
      window_from date,
      window_to date,
      requested_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (account_id, advertiser_id)
    )`;
    // Tabelas pré-existentes (antes do sync incremental) ganham a coluna aqui.
    await sql`ALTER TABLE ads_sync_state ADD COLUMN IF NOT EXISTS last_full_synced_at timestamptz`;
    await sql`CREATE INDEX IF NOT EXISTS ads_sync_state_activity_idx ON ads_sync_state (requested_at DESC)`;

    // Estado durável das automações (cooldowns de regras/alertas + marcações
    // do dayparting). Antes vivia só em Maps de memória: um deploy re-armava
    // todos os cooldowns e uma regra podia agir DUAS vezes no mesmo episódio.
    // key: 'rule:<accId>:<campId>:<ruleId>' | 'alert:...' | 'sched:<ruleId>:<campId>'
    await sql`CREATE TABLE IF NOT EXISTS ads_automation_state (
      account_id text NOT NULL,
      key text NOT NULL,
      kind text NOT NULL DEFAULT 'rule',
      last_fired_at timestamptz NOT NULL DEFAULT now(),
      meta jsonb NOT NULL DEFAULT '{}'::jsonb,
      PRIMARY KEY (account_id, key)
    )`;
    console.log('[ads-cache] schema verificado/criado');
    return true;
  })().catch((err) => { schemaReady = null; throw err; });
  return schemaReady;
}

// ── Escrita (chamada pelo motor de sync) ────────────────────────────────────
// Bulk insert parametrizado em chunks (1 round-trip HTTP por chunk) via
// sql.query(text, params) — evita milhares de statements individuais.
// Um INSERT multi-linha com ON CONFLICT DO UPDATE quebra ("cannot affect row a
// second time") se o MESMO conflict-key aparecer 2× no lote. As fontes (API
// paginada, merge de Smart+ na árvore) podem repetir chaves — então deduplicamos
// por chave ANTES do insert, mantendo a ÚLTIMA ocorrência (mesma semântica do
// upsert). keyFn devolve a chave composta como string.
function dedupeByKey(arr, keyFn) {
  const m = new Map();
  for (const x of arr) m.set(keyFn(x), x); // última vence
  return [...m.values()];
}

async function bulkUpsertMetrics(accountId, advertiserId, syncedAt, rows) {
  if (!rows.length) return 0;
  rows = dedupeByKey(rows, (r) => r.level + '|' + r.entityId + '|' + r.day);
  const CHUNK = 400;
  let total = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const params = [];
    const tuples = chunk.map((r) => {
      const base = params.length;
      params.push(accountId, advertiserId, r.level, r.entityId, r.day, r.spend, r.impressions, r.clicks, r.conversions, r.reach, syncedAt);
      return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11})`;
    });
    const text = `INSERT INTO ads_metrics_cache
      (account_id, advertiser_id, level, entity_id, day, spend, impressions, clicks, conversions, reach, synced_at)
      VALUES ${tuples.join(',')}
      ON CONFLICT (account_id, advertiser_id, level, entity_id, day) DO UPDATE SET
        spend = EXCLUDED.spend, impressions = EXCLUDED.impressions, clicks = EXCLUDED.clicks,
        conversions = EXCLUDED.conversions, reach = EXCLUDED.reach, synced_at = EXCLUDED.synced_at`;
    await sql.query(text, params);
    total += chunk.length;
  }
  return total;
}

async function bulkUpsertCampaigns(accountId, advertiserId, syncedAt, campaigns) {
  if (!campaigns.length) return 0;
  // dedup por campaign_id (o merge de Smart+ ou paginação da API pode repetir) —
  // senão o ON CONFLICT quebra com "cannot affect row a second time".
  campaigns = dedupeByKey(campaigns, (c) => String(c.platformCampaignId || ''));
  const CHUNK = 100;
  let total = 0;
  for (let i = 0; i < campaigns.length; i += CHUNK) {
    const chunk = campaigns.slice(i, i + CHUNK);
    const params = [];
    const tuples = chunk.map((c) => {
      const base = params.length;
      params.push(
        accountId, advertiserId, String(c.platformCampaignId || ''),
        c.campaignName || '', c.status || '', c.platformCampaignStatus || '',
        c.objective || null, c.budget ? num(c.budget.amount) : 0, c.budget ? String(c.budget.type || '') : '',
        c.currency || '', num(c.adCount), num(c.adSetCount), JSON.stringify(c), syncedAt
      );
      return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11},$${base + 12},$${base + 13},$${base + 14})`;
    });
    const text = `INSERT INTO ads_campaigns_cache
      (account_id, advertiser_id, campaign_id, name, status, operation_status, objective, budget, budget_mode, currency, ad_count, ad_set_count, data, synced_at)
      VALUES ${tuples.join(',')}
      ON CONFLICT (account_id, advertiser_id, campaign_id) DO UPDATE SET
        name = EXCLUDED.name, status = EXCLUDED.status, operation_status = EXCLUDED.operation_status,
        objective = EXCLUDED.objective, budget = EXCLUDED.budget, budget_mode = EXCLUDED.budget_mode,
        currency = EXCLUDED.currency, ad_count = EXCLUDED.ad_count, ad_set_count = EXCLUDED.ad_set_count,
        data = EXCLUDED.data, synced_at = EXCLUDED.synced_at`;
    await sql.query(text, params);
    total += chunk.length;
  }
  return total;
}

// Grava o snapshot completo de um advertiser: estrutura (campanhas) + métricas
// diárias. Poda linhas com synced_at anterior a este sync (entidades/dias que
// sumiram lá fora). Não é uma transação única (driver HTTP), mas é seguro para
// um cache: uma falha parcial é corrigida no próximo sync.
async function writeAdvertiserSnapshot(accountId, advertiserId, snapshot, opts = {}) {
  accountId = cleanAccountId(accountId);
  advertiserId = String(advertiserId || '').trim();
  if (!enabled || !advertiserId) return { ok: false };
  await ensureSchema();
  const syncedAt = new Date().toISOString();
  const campaigns = Array.isArray(snapshot.campaigns) ? snapshot.campaigns : [];
  const metrics = Array.isArray(snapshot.dailyMetrics) ? snapshot.dailyMetrics : [];
  // pruneMetrics: só o sync COMPLETO poda o histórico. O incremental refaz
  // apenas os últimos dias (upsert) e NÃO deve apagar o backfill mais antigo.
  const pruneMetrics = opts.pruneMetrics !== false;

  const nCamp = await bulkUpsertCampaigns(accountId, advertiserId, syncedAt, campaigns);
  const nMet = await bulkUpsertMetrics(accountId, advertiserId, syncedAt, metrics);

  // Poda: remove campanhas que não vieram neste sync (deletadas no TikTok).
  // A estrutura é sempre refetch completa, então a poda é sempre segura.
  await sql`DELETE FROM ads_campaigns_cache WHERE account_id = ${accountId} AND advertiser_id = ${advertiserId} AND synced_at < ${syncedAt}`;
  // Poda de métricas: só no sync completo e só quando houve alguma métrica
  // (evita apagar tudo se a chamada de insights falhou e veio vazia).
  if (pruneMetrics && metrics.length) {
    await sql`DELETE FROM ads_metrics_cache WHERE account_id = ${accountId} AND advertiser_id = ${advertiserId} AND synced_at < ${syncedAt}`;
  }
  return { ok: true, campaigns: nCamp, metrics: nMet, syncedAt };
}

// ── Leitura (consumida pelas rotas da dashboard) ────────────────────────────
// Agrega métricas da janela [fromDate,toDate] por (level, entity_id).
async function aggregateMetrics(accountId, advertiserId, level, fromDate, toDate) {
  const rows = await sql`
    SELECT entity_id,
      SUM(spend)::float8 AS spend,
      SUM(impressions)::bigint AS impressions,
      SUM(clicks)::bigint AS clicks,
      SUM(conversions)::float8 AS conversions,
      SUM(reach)::bigint AS reach
    FROM ads_metrics_cache
    WHERE account_id = ${accountId} AND advertiser_id = ${advertiserId}
      AND level = ${level} AND day >= ${fromDate} AND day <= ${toDate}
    GROUP BY entity_id`;
  const map = new Map();
  for (const r of rows) {
    const spend = num(r.spend), impressions = num(r.impressions), clicks = num(r.clicks), conversions = num(r.conversions);
    map.set(String(r.entity_id), {
      spend, impressions, clicks, conversions, reach: num(r.reach),
      ctr: impressions ? clicks / impressions : 0,
      cpc: clicks ? spend / clicks : 0,
      cpm: impressions ? (spend / impressions) * 1000 : 0,
      cpa: conversions ? spend / conversions : 0,
    });
  }
  return map;
}

const EMPTY_METRICS = { impressions: 0, clicks: 0, spend: 0, ctr: 0, cpm: 0, cpc: 0, conversions: 0, reach: 0 };

function metricsForNode(map, primaryId, extraIds) {
  const ids = [...new Set([String(primaryId || ''), ...(Array.isArray(extraIds) ? extraIds.map(String) : [])].filter(Boolean))];
  let found = false;
  const total = { impressions: 0, clicks: 0, spend: 0, conversions: 0, reach: 0 };
  for (const entityId of ids) {
    const value = map.get(entityId);
    if (!value) continue;
    found = true;
    total.impressions += num(value.impressions);
    total.clicks += num(value.clicks);
    total.spend += num(value.spend);
    total.conversions += num(value.conversions);
    total.reach += num(value.reach);
  }
  if (!found) return Object.assign({}, EMPTY_METRICS);
  total.ctr = total.impressions ? total.clicks / total.impressions : 0;
  total.cpc = total.clicks ? total.spend / total.clicks : 0;
  total.cpm = total.impressions ? (total.spend / total.impressions) * 1000 : 0;
  total.cpa = total.conversions ? total.spend / total.conversions : 0;
  return total;
}

// Reconstrói o AdsTreeResponse a partir do espelho: estrutura (JSONB) +
// métricas agregadas da janela sobrepostas em cada nível. Aplica filtro de
// status e ordenação (mesmo contrato do getDashboardTree do provider).
async function readTree(accountId, advertiserId, opts = {}) {
  accountId = cleanAccountId(accountId);
  advertiserId = String(advertiserId || '').trim();
  if (!enabled || !advertiserId) return null;
  await ensureSchema();

  const iso = (d) => d.toISOString().slice(0, 10);
  const today = new Date();
  const yearAgo = new Date(today.getTime() - 365 * 864e5);
  const fromDate = /^\d{4}-\d{2}-\d{2}$/.test(String(opts.fromDate || '')) ? opts.fromDate : iso(yearAgo);
  const toDate = /^\d{4}-\d{2}-\d{2}$/.test(String(opts.toDate || '')) ? opts.toDate : iso(today);

  const campRows = await sql`SELECT data FROM ads_campaigns_cache WHERE account_id = ${accountId} AND advertiser_id = ${advertiserId}`;
  if (!campRows.length) return { campaigns: [], backfillPending: false, pagination: { page: 1, limit: 100, total: 0, pages: 0 } };

  const [cMet, gMet, aMet] = await Promise.all([
    aggregateMetrics(accountId, advertiserId, 'campaign', fromDate, toDate),
    aggregateMetrics(accountId, advertiserId, 'adgroup', fromDate, toDate),
    aggregateMetrics(accountId, advertiserId, 'ad', fromDate, toDate),
  ]);

  let campaigns = campRows.map((row) => {
    const c = row.data || {};
    const node = Object.assign({}, c);
    node.metrics = metricsForNode(cMet, c.platformCampaignId, c.metricEntityIds);
    node.adSets = (c.adSets || []).map((s) => {
      const set = Object.assign({}, s);
      set.metrics = metricsForNode(gMet, s.platformAdSetId, s.metricEntityIds);
      set.ads = (s.ads || []).map((ad) => {
        const adNode = Object.assign({}, ad);
        adNode.metrics = metricsForNode(aMet, ad.platformAdId, ad.metricEntityIds);
        return adNode;
      });
      return set;
    });
    return node;
  });

  // filtro de status sobre o conjunto completo (igual ao provider)
  // 'approved' (Validadas) é uma dimensão de REVISÃO, não de entrega — filtra
  // por reviewStatus, não pelo status do nó (uma campanha validada aparece como
  // 'active'). Os demais valores filtram pelo status/childStatus do nó.
  if (opts.status === 'approved') {
    campaigns = campaigns.filter((c) => c.reviewStatus === 'approved');
  } else {
    const statusFilter = ['active', 'paused', 'pending_review', 'error', 'completed', 'cancelled', 'rejected'].includes(opts.status) ? opts.status : undefined;
    if (statusFilter) campaigns = campaigns.filter((c) => c.status === statusFilter || c.childStatus === statusFilter);
  }

  const sort = ['newest', 'oldest', 'spend_desc', 'spend_asc'].includes(opts.sort) ? opts.sort : 'newest';
  campaigns.sort((a, b) => {
    if (sort === 'spend_desc') return (b.metrics.spend || 0) - (a.metrics.spend || 0);
    if (sort === 'spend_asc') return (a.metrics.spend || 0) - (b.metrics.spend || 0);
    const cmp = String(a.platformCampaignId).localeCompare(String(b.platformCampaignId));
    return sort === 'oldest' ? cmp : -cmp;
  });

  return { campaigns, backfillPending: false, pagination: { page: 1, limit: 100, total: campaigns.length, pages: 1 } };
}

// Spend + conversões por DIA no nível advertiser = soma das campanhas por dia.
// Alimenta o /ads/roas (que cruza com a receita interna atribuída).
async function readAdvertiserDaily(accountId, advertiserId, fromDate, toDate) {
  accountId = cleanAccountId(accountId);
  advertiserId = String(advertiserId || '').trim();
  if (!enabled || !advertiserId) return { spendByDay: {}, spend: 0, conversions: 0, currency: null };
  await ensureSchema();
  const rows = await sql`
    SELECT day::text AS day, SUM(spend)::float8 AS spend, SUM(conversions)::float8 AS conversions
    FROM ads_metrics_cache
    WHERE account_id = ${accountId} AND advertiser_id = ${advertiserId}
      AND level = 'campaign' AND day >= ${fromDate} AND day <= ${toDate}
    GROUP BY day ORDER BY day`;
  const spendByDay = {};
  let spend = 0, conversions = 0;
  for (const r of rows) {
    const day = String(r.day).slice(0, 10);
    spendByDay[day] = num(r.spend);
    spend += num(r.spend);
    conversions += num(r.conversions);
  }
  // moeda: lida de qualquer campanha do espelho (o sync a persiste no nó)
  const curRows = await sql`
    SELECT data->>'currency' AS currency FROM ads_campaigns_cache
    WHERE account_id = ${accountId} AND advertiser_id = ${advertiserId}
      AND data->>'currency' IS NOT NULL LIMIT 1`;
  const currency = (curRows[0] && curRows[0].currency) || null;
  return { spendByDay, spend, conversions, currency };
}

// Totais agregados do advertiser num range (spend/impressões/cliques/conv).
// Alimenta o /api/ads/kpis — o delta de período é só ESTA query com outro range.
async function readAdvertiserTotals(accountId, advertiserId, fromDate, toDate) {
  accountId = cleanAccountId(accountId);
  advertiserId = String(advertiserId || '').trim();
  if (!enabled || !advertiserId) return null;
  await ensureSchema();
  const rows = await sql`
    SELECT SUM(spend)::float8 AS spend, SUM(impressions)::float8 AS impressions,
           SUM(clicks)::float8 AS clicks, SUM(conversions)::float8 AS conversions
    FROM ads_metrics_cache
    WHERE account_id = ${accountId} AND advertiser_id = ${advertiserId}
      AND level = 'campaign' AND day >= ${fromDate} AND day <= ${toDate}`;
  const r = rows[0] || {};
  return {
    spend: num(r.spend),
    impressions: num(r.impressions),
    clicks: num(r.clicks),
    conversions: num(r.conversions),
  };
}

// Série diária + resumo de UMA campanha (aba de analytics da campanha).
async function readCampaignAnalytics(accountId, advertiserId, campaignId, fromDate, toDate) {
  accountId = cleanAccountId(accountId);
  advertiserId = String(advertiserId || '').trim();
  campaignId = String(campaignId || '').trim();
  if (!enabled || !advertiserId || !campaignId) return { summary: null, daily: [] };
  await ensureSchema();
  const rows = await sql`
    SELECT day::text AS day, spend::float8 AS spend, impressions::bigint AS impressions,
      clicks::bigint AS clicks, conversions::float8 AS conversions, reach::bigint AS reach
    FROM ads_metrics_cache
    WHERE account_id = ${accountId} AND advertiser_id = ${advertiserId}
      AND level = 'campaign' AND entity_id = ${campaignId}
      AND day >= ${fromDate} AND day <= ${toDate}
    ORDER BY day`;
  const daily = rows.map((r) => {
    const spend = num(r.spend), impressions = num(r.impressions), clicks = num(r.clicks), conversions = num(r.conversions);
    return {
      date: String(r.day).slice(0, 10), spend, impressions, clicks, conversions, reach: num(r.reach),
      ctr: impressions ? clicks / impressions : 0,
      cpc: clicks ? spend / clicks : 0,
      cpm: impressions ? (spend / impressions) * 1000 : 0,
      cpa: conversions ? spend / conversions : 0,
    };
  });
  const summary = daily.reduce((acc, d) => {
    acc.spend += d.spend; acc.impressions += d.impressions; acc.clicks += d.clicks;
    acc.conversions += d.conversions; acc.reach += d.reach; return acc;
  }, { spend: 0, impressions: 0, clicks: 0, conversions: 0, reach: 0 });
  summary.ctr = summary.impressions ? summary.clicks / summary.impressions : 0;
  summary.cpc = summary.clicks ? summary.spend / summary.clicks : 0;
  summary.cpm = summary.impressions ? (summary.spend / summary.impressions) * 1000 : 0;
  summary.cpa = summary.conversions ? summary.spend / summary.conversions : 0;
  return { summary, daily };
}

// ── Estado do sync ──────────────────────────────────────────────────────────
async function getSyncState(accountId, advertiserId) {
  accountId = cleanAccountId(accountId);
  advertiserId = String(advertiserId || '').trim();
  if (!enabled || !advertiserId) return null;
  await ensureSchema();
  const rows = await sql`SELECT * FROM ads_sync_state WHERE account_id = ${accountId} AND advertiser_id = ${advertiserId} LIMIT 1`;
  return rows[0] || null;
}

async function upsertSyncState(accountId, advertiserId, patch) {
  accountId = cleanAccountId(accountId);
  advertiserId = String(advertiserId || '').trim();
  if (!enabled || !advertiserId) return null;
  await ensureSchema();
  const p = patch || {};
  const rows = await sql`
    INSERT INTO ads_sync_state (account_id, advertiser_id, status, last_synced_at, last_full_synced_at, last_error, last_duration_ms, calls_used, window_from, window_to, updated_at)
    VALUES (${accountId}, ${advertiserId}, ${p.status || 'syncing'}, ${p.lastSyncedAt || null}, ${p.lastFullSyncedAt || null}, ${p.lastError || null}, ${p.lastDurationMs || null}, ${p.callsUsed || 0}, ${p.windowFrom || null}, ${p.windowTo || null}, now())
    ON CONFLICT (account_id, advertiser_id) DO UPDATE SET
      status = EXCLUDED.status,
      last_synced_at = COALESCE(EXCLUDED.last_synced_at, ads_sync_state.last_synced_at),
      last_full_synced_at = COALESCE(EXCLUDED.last_full_synced_at, ads_sync_state.last_full_synced_at),
      last_error = EXCLUDED.last_error,
      last_duration_ms = COALESCE(EXCLUDED.last_duration_ms, ads_sync_state.last_duration_ms),
      calls_used = EXCLUDED.calls_used,
      window_from = COALESCE(EXCLUDED.window_from, ads_sync_state.window_from),
      window_to = COALESCE(EXCLUDED.window_to, ads_sync_state.window_to),
      updated_at = now()
    RETURNING *`;
  return rows[0] || null;
}

// Marca que a dashboard visualizou este advertiser agora — vira alvo do sync
// ativo. Idempotente e barato (só toca requested_at).
async function touchActivity(accountId, advertiserId) {
  accountId = cleanAccountId(accountId);
  advertiserId = String(advertiserId || '').trim();
  if (!enabled || !advertiserId) return;
  await ensureSchema();
  await sql`
    INSERT INTO ads_sync_state (account_id, advertiser_id, status, requested_at, updated_at)
    VALUES (${accountId}, ${advertiserId}, 'never', now(), now())
    ON CONFLICT (account_id, advertiser_id) DO UPDATE SET requested_at = now(), updated_at = now()`;
}

// Advertisers "ativos" = visualizados na dashboard nas últimas `sinceMinutes`.
// O motor de sync só busca estes (corta o custo vs sincronizar os 155 do token).
async function listActiveAdvertisers(sinceMinutes) {
  if (!enabled) return [];
  await ensureSchema();
  const mins = Math.max(1, Math.min(10080, Number(sinceMinutes) || 1440));
  const rows = await sql`
    SELECT account_id, advertiser_id, last_synced_at, status
    FROM ads_sync_state
    WHERE requested_at IS NOT NULL AND requested_at > now() - make_interval(mins => ${mins})
    ORDER BY last_synced_at ASC NULLS FIRST`;
  return rows.map((r) => ({ accountId: r.account_id, advertiserId: r.advertiser_id, lastSyncedAt: r.last_synced_at, status: r.status }));
}

async function listSyncStates(accountId) {
  accountId = cleanAccountId(accountId);
  if (!enabled) return [];
  await ensureSchema();
  return sql`SELECT advertiser_id, status, last_synced_at, last_full_synced_at, last_error, last_duration_ms, calls_used, window_from, window_to, requested_at FROM ads_sync_state WHERE account_id = ${accountId} ORDER BY last_synced_at DESC NULLS LAST`;
}

// Classifica um ID (campanha | ad group | anúncio) consultando o espelho da
// estrutura. Orçamento no TikTok vive em campanha OU ad group, nunca no anúncio
// — o PUT de orçamento usa isto p/ rotear ao tool certo sem tocar no front.
// Retorna { type, advertiserId, campaignId } ou null se o ID não está no cache.
// Para anúncio, preserva também a semântica Product Link; a rota de edição usa
// isso para nunca aceitar uma landing_page_url manual nesse formato.
// advertiserId é opcional: se omitido, procura em TODOS os advertisers da conta
// (o front não passa o advertiser no PUT/DELETE de entidade) e devolve o dono.
function classifyRows(rows, entityIds) {
  const wanted = new Set((entityIds || []).map(String).filter(Boolean));
  const found = new Map();
  if (!wanted.size) return found;
  function add(entityId, value) {
    const id = String(entityId || '');
    if (wanted.has(id)) found.set(id, value);
  }
  for (const r of rows) {
    const adv = String(r.advertiser_id || '');
    const c = r.data || {};
    const campaignId = String(c.platformCampaignId || '');
    const campaignKind = c.campaignKind === 'smart_plus' ? 'smart_plus' : 'auction';
    const budgetOwner = c.budgetOwner === 'campaign' ? 'campaign' : 'adgroup';
    add(campaignId, { type: 'campaign', advertiserId: adv, campaignId, campaignKind, budgetOwner });
    for (const g of (c.adSets || [])) {
      const adGroupId = String(g.platformAdSetId || '');
      add(adGroupId, { type: 'adgroup', advertiserId: adv, campaignId, adGroupId, campaignKind, budgetOwner });
      for (const a of (g.ads || [])) {
        const adId = String(a.platformAdId || '');
        add(adId, {
          type: 'ad', advertiserId: adv, campaignId, adGroupId, adId,
          campaignKind, budgetOwner,
          catalogId: String(a.catalogId || ''), websiteType: String(a.websiteType || ''), adFormat: String(a.adFormat || ''),
        });
      }
    }
    if (found.size === wanted.size) break;
  }
  return found;
}

// Classificação em lote: uma única leitura do JSONB atende pausa/ativação de
// até 50 campanhas. Antes, o endpoint bulk repetia a mesma consulta N vezes.
async function classifyEntities(accountId, advertiserId, entityIds) {
  accountId = cleanAccountId(accountId);
  advertiserId = String(advertiserId || '').trim();
  const ids = [...new Set((Array.isArray(entityIds) ? entityIds : [entityIds]).map((value) => String(value || '').trim()).filter(Boolean))];
  if (!enabled || !ids.length) return new Map();
  await ensureSchema();
  const rows = advertiserId
    ? await sql`SELECT advertiser_id, data FROM ads_campaigns_cache WHERE account_id = ${accountId} AND advertiser_id = ${advertiserId}`
    : await sql`SELECT advertiser_id, data FROM ads_campaigns_cache WHERE account_id = ${accountId}`;
  return classifyRows(rows, ids);
}

async function classifyEntity(accountId, advertiserId, entityId) {
  const id = String(entityId || '').trim();
  if (!id) return null;
  const found = await classifyEntities(accountId, advertiserId, [id]);
  return found.get(id) || null;
}

// ── Estado das automações (cooldowns/dayparting persistidos) ───────────────
// Leitura em bloco por conta: o motor carrega tudo 1× no boot/primeiro sweep
// e mantém um cache quente em memória (write-through nas escritas).
async function listAutomationState(accountId) {
  accountId = cleanAccountId(accountId);
  if (!enabled) return [];
  await ensureSchema();
  const rows = await sql`SELECT key, kind, last_fired_at, meta FROM ads_automation_state WHERE account_id = ${accountId}`;
  return rows.map((r) => ({ key: r.key, kind: r.kind, lastFiredAt: r.last_fired_at, meta: r.meta || {} }));
}

async function upsertAutomationState(accountId, key, kind, meta) {
  accountId = cleanAccountId(accountId);
  key = String(key || '').slice(0, 200);
  if (!enabled || !key) return null;
  await ensureSchema();
  await sql`
    INSERT INTO ads_automation_state (account_id, key, kind, last_fired_at, meta)
    VALUES (${accountId}, ${key}, ${String(kind || 'rule').slice(0, 20)}, now(), ${JSON.stringify(meta || {})}::jsonb)
    ON CONFLICT (account_id, key) DO UPDATE SET
      kind = EXCLUDED.kind, last_fired_at = now(), meta = EXCLUDED.meta`;
  return true;
}

async function deleteAutomationState(accountId, key) {
  accountId = cleanAccountId(accountId);
  key = String(key || '').slice(0, 200);
  if (!enabled || !key) return;
  await ensureSchema();
  await sql`DELETE FROM ads_automation_state WHERE account_id = ${accountId} AND key = ${key}`;
}

// Série diária COMPLETA do advertiser (spend/impr/cliques/conv por dia).
// Alimenta a detecção de anomalias do briefing (z-score precisa de CTR/CPM
// diários, que readAdvertiserDaily não expõe). Ordenada por dia ASC.
async function readDailySeries(accountId, advertiserId, fromDate, toDate) {
  accountId = cleanAccountId(accountId);
  advertiserId = String(advertiserId || '').trim();
  if (!enabled || !advertiserId) return [];
  await ensureSchema();
  const rows = await sql`
    SELECT day::text AS day, SUM(spend)::float8 AS spend, SUM(impressions)::float8 AS impressions,
           SUM(clicks)::float8 AS clicks, SUM(conversions)::float8 AS conversions
    FROM ads_metrics_cache
    WHERE account_id = ${accountId} AND advertiser_id = ${advertiserId}
      AND level = 'campaign' AND day >= ${fromDate} AND day <= ${toDate}
    GROUP BY day ORDER BY day ASC`;
  return rows.map((r) => ({
    day: r.day,
    spend: num(r.spend),
    impressions: num(r.impressions),
    clicks: num(r.clicks),
    conversions: num(r.conversions),
  }));
}

// ── Conteúdo gerado por IA (briefings diários, insights de criativos) ───────
// kind: 'daily' | 'creatives'. Escopo (account, advertiser, date, kind):
// cada conta de anúncio tem análises próprias; linhas legadas ficam preservadas
// com advertiser_id='' e servem de fallback até cada advertiser gerar a sua.
// gerar 2× no mesmo dia sobrescreve em vez de duplicar. content = texto pronto
// para a UI; meta = payload estruturado (anomalias, variações, proposta).
let briefingSchemaReady = null;
async function ensureBriefingSchema() {
  if (!enabled) return false;
  if (briefingSchemaReady) return briefingSchemaReady;
  briefingSchemaReady = (async () => {
    await sql`CREATE TABLE IF NOT EXISTS ads_briefings (
      account_id text NOT NULL,
      advertiser_id text NOT NULL DEFAULT '',
      date date NOT NULL,
      kind text NOT NULL DEFAULT 'daily',
      content text NOT NULL DEFAULT '',
      meta jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )`;
    await sql`ALTER TABLE ads_briefings ADD COLUMN IF NOT EXISTS advertiser_id text NOT NULL DEFAULT ''`;
    // A PK antiga (account_id,date,kind) impediria dois advertisers no mesmo
    // dia. Removê-la não apaga linhas; o índice novo mantém a idempotência.
    await sql`ALTER TABLE ads_briefings DROP CONSTRAINT IF EXISTS ads_briefings_pkey`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS ads_briefings_scope_unique ON ads_briefings (account_id, advertiser_id, date, kind)`;
    return true;
  })().catch((err) => { briefingSchemaReady = null; throw err; });
  return briefingSchemaReady;
}

async function upsertBriefing(accountId, advertiserId, date, kind, content, meta) {
  accountId = cleanAccountId(accountId);
  advertiserId = String(advertiserId || '').trim().slice(0, 120);
  if (!advertiserId) throw new Error('advertiserId específico é obrigatório para briefing');
  if (!enabled) return null;
  await ensureBriefingSchema();
  await sql`
    INSERT INTO ads_briefings (account_id, advertiser_id, date, kind, content, meta)
    VALUES (${accountId}, ${advertiserId}, ${date}, ${String(kind || 'daily').slice(0, 20)}, ${String(content || '')}, ${JSON.stringify(meta || {})}::jsonb)
    ON CONFLICT (account_id, advertiser_id, date, kind) DO UPDATE SET
      content = EXCLUDED.content, meta = EXCLUDED.meta, created_at = now()`;
  return true;
}

// Últimos N briefings de um tipo (default: 7 dias de 'daily' para o card).
async function listBriefings(accountId, advertiserId, kind, limit = 7) {
  accountId = cleanAccountId(accountId);
  advertiserId = String(advertiserId || '').trim().slice(0, 120);
  if (!advertiserId) throw new Error('advertiserId específico é obrigatório para briefing');
  if (!enabled) return [];
  await ensureBriefingSchema();
  let rows = await sql`
    SELECT date::text AS date, kind, content, meta, created_at
    FROM ads_briefings
    WHERE account_id = ${accountId} AND advertiser_id = ${advertiserId} AND kind = ${String(kind || 'daily')}
    ORDER BY date DESC LIMIT ${Math.min(Math.max(1, limit), 30)}`;
  // Compatibilidade segura: dados anteriores à segmentação nunca são apagados.
  // Só aparecem quando ainda não existe nenhum briefing no escopo selecionado.
  if (!rows.length) {
    rows = await sql`
      SELECT date::text AS date, kind, content, meta, created_at
      FROM ads_briefings
      WHERE account_id = ${accountId} AND advertiser_id = '' AND kind = ${String(kind || 'daily')}
      ORDER BY date DESC LIMIT ${Math.min(Math.max(1, limit), 30)}`;
  }
  return rows.map((r) => ({ date: r.date, kind: r.kind, content: r.content, meta: r.meta || {}, createdAt: r.created_at }));
}

module.exports = {
  enabled,
  ensureSchema,
  writeAdvertiserSnapshot,
  readTree,
  readAdvertiserDaily,
  readAdvertiserTotals,
  readDailySeries,
  readCampaignAnalytics,
  getSyncState,
  upsertSyncState,
  touchActivity,
  listActiveAdvertisers,
  listSyncStates,
  classifyEntity,
  classifyEntities,
  listAutomationState,
  upsertAutomationState,
  deleteAutomationState,
  upsertBriefing,
  listBriefings,
  _internals: { dedupeByKey, classifyRows },
};
