// ── Motor de sync Pipeboard → Neon ──────────────────────────────────────────
// PORQUÊ: a dashboard não deve mais esperar a API do Pipeboard a cada tela.
// Este motor busca, em segundo plano, a estrutura + as métricas diárias de cada
// advertiser ATIVO e grava no espelho durável (ads-cache-store). "Ativo" é a
// união de: visualizado recentemente na dashboard OU com automação persistente
// ligada. As rotas de leitura passam a ler só do Neon.
//
// Estratégia:
//   - Janela larga (365d) de métricas DIÁRIAS por entidade → qualquer
//     date-range pedido pela dashboard é servido por agregação, sem re-chamar.
//   - Advertisers sem automação usam a janela de atividade da dashboard; quem
//     tem regra/alerta/agendamento ligado permanece inscrito 24/7, inclusive
//     após fechar a tela ou reiniciar o processo.
//   - Stale-while-revalidate: se já há cache, serve na hora e revalida em
//     segundo plano; só bloqueia no PRIMEIRO carregamento (cache frio).
//   - Como o plano é ilimitado, o intervalo é agressivo (3 min por padrão).
const provider = require('./ads-provider');
const cache = require('./ads-cache-store');
const pipeboard = require('./pipeboard-mcp');
const adsOps = require('./ads-ops-store');
const automationWindow = require('./ads-automation-window');

const WIDE_DAYS = Number(process.env.ADS_SYNC_WINDOW_DAYS) || 90;
const CHUNK_DAYS = 30; // TikTok limita stat_time_day a janelas de 30 dias (erro 40002)
// Sync incremental: métricas de dias passados são imutáveis, só as recentes
// mudam. O loop quente refaz só os últimos INCREMENTAL_DAYS dias; o backfill
// completo (WIDE_DAYS) roda no cache frio e no máximo 1× a cada FULL_EVERY_MS.
const INCREMENTAL_DAYS = Number(process.env.ADS_SYNC_INCREMENTAL_DAYS) || 3;
const FULL_EVERY_MS = Number(process.env.ADS_SYNC_FULL_EVERY_MS) || 24 * 3600 * 1000;
const SYNC_INTERVAL_MS = Number(process.env.ADS_SYNC_INTERVAL_MS) || 3 * 60 * 1000; // 3 min
const ACTIVE_WINDOW_MIN = Number(process.env.ADS_SYNC_ACTIVE_MIN) || 6 * 60;        // 6h
const STALE_MS = Number(process.env.ADS_SYNC_STALE_MS) || SYNC_INTERVAL_MS;         // idade p/ revalidar
const MANUAL_THROTTLE_MS = Number(process.env.ADS_SYNC_MANUAL_THROTTLE_MS) || 20 * 1000;
// Conta bloqueada pelo limite mensal do Pipeboard: espera antes de tentar de
// novo. O reset real é mensal, mas 30min basta para recuperar rápido se o
// usuário liberar um slot, sem martelar a API a cada tick.
const BLOCKED_BACKOFF_MS = Number(process.env.ADS_SYNC_BLOCKED_BACKOFF_MS) || 30 * 60 * 1000;

function iso(d) { return d.toISOString().slice(0, 10); }
function dayStr(v) { return String(v || '').slice(0, 10); }
function syncKey(accountId, advertiserId) { return accountId + '|' + advertiserId; }

// Coleta métricas DIÁRIAS de um nível (dimensão de entidade + stat_time_day).
// Uma linha por (entidade, dia). Falha isolada devolve [] (o snapshot preserva
// o cache antigo daquele nível em vez de zerá-lo).
const LEVELS = {
  campaign: { level: 'AUCTION_CAMPAIGN', dimKey: 'campaign_id' },
  adgroup: { level: 'AUCTION_ADGROUP', dimKey: 'adgroup_id' },
  ad: { level: 'AUCTION_AD', dimKey: 'ad_id' },
};
// Fatia [startDate, endDate] em janelas de ≤30 dias (limite do TikTok para
// stat_time_day). Devolve [{ start, end }].
function dateChunks(startDate, endDate) {
  const chunks = [];
  let cur = new Date(startDate + 'T00:00:00Z');
  const end = new Date(endDate + 'T00:00:00Z');
  while (cur <= end) {
    const chunkEnd = new Date(Math.min(cur.getTime() + (CHUNK_DAYS - 1) * 864e5, end.getTime()));
    chunks.push({ start: iso(cur), end: iso(chunkEnd) });
    cur = new Date(chunkEnd.getTime() + 864e5);
  }
  return chunks;
}

async function collectDaily(advertiserId, levelName, startDate, endDate) {
  const { level, dimKey } = LEVELS[levelName];
  const chunks = dateChunks(startDate, endDate);
  // Uma chamada por janela de 30 dias. O rate limiter do provider serializa;
  // Promise.all só encurta a espera de agendamento.
  const perChunk = await Promise.all(chunks.map((c) =>
    provider.getInsights(advertiserId, { level, startDate: c.start, endDate: c.end, dimensions: [dimKey, 'stat_time_day'] })
      .then((r) => r.rows || [])
  ));
  const out = [];
  for (const rows of perChunk) {
    for (const r of rows) {
      const d = r.dimensions || {};
      const entityId = String(d[dimKey] || '');
      const day = dayStr(d.stat_time_day);
      if (!entityId || !/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
      out.push({ level: levelName, entityId, day, spend: r.spend, impressions: r.impressions, clicks: r.clicks, conversions: r.conversions, reach: r.reach });
    }
  }
  return out;
}

// Busca a hierarquia Smart+ completa. O endpoint padrão também devolve essas
// campanhas como AUCTION_*; manter esse resultado faria o painel enviar update
// ao tool errado. A leitura dedicada preserva campanha → grupo → asset group e
// permite orçamento/status no nível correto. Falha fechada: se esta leitura
// falhar, o snapshot anterior é preservado. Gravar a leitura genérica marcaria
// Smart+ como leilão e enviaria mutações futuras ao endpoint errado.
async function smartPlusNodes(advertiserId) {
  if (typeof provider.getSmartPlusDashboardTree !== 'function') {
    const error = new Error('O conector não expõe a leitura dedicada da hierarquia Smart+');
    error.code = 'SMART_PLUS_CLASSIFICATION_UNAVAILABLE';
    throw error;
  }
  return (await provider.getSmartPlusDashboardTree(advertiserId))
    .filter((node) => node.platformCampaignId);
}

// Sincroniza UM advertiser: estrutura (getDashboardTree, janela larga) +
// métricas diárias dos 3 níveis → grava snapshot no espelho.
async function syncAdvertiser(accountId, advertiserId, opts = {}) {
  advertiserId = String(advertiserId || '').trim();
  if (!advertiserId) return { ok: false, error: 'advertiserId vazio' };
  const start = Date.now();
  const callsBefore = pipeboard.getCallStats ? pipeboard.getCallStats().total : 0;

  // Backoff de conta bloqueada/não-autorizada: se o último resultado foi
  // 'blocked' ou 'unauthorized' há menos de BLOCKED_BACKOFF_MS, não re-tenta
  // (não desperdiça chamada nem polui o log a cada tick — ambos os estados só
  // mudam por ação externa). O refresh manual passa opts.force para re-tentar.
  if (!opts.force) {
    const prev = await cache.getSyncState(accountId, advertiserId).catch(() => null);
    if (prev && (prev.status === 'blocked' || prev.status === 'unauthorized') && prev.updated_at) {
      const age = Date.now() - new Date(prev.updated_at).getTime();
      if (age < BLOCKED_BACKOFF_MS) {
        return { ok: false, blocked: prev.status === 'blocked', unauthorized: prev.status === 'unauthorized', error: prev.last_error || 'Conta indisponível', skipped: true };
      }
    }
  }

  // Full vs incremental: full quando pedido explicitamente, ou quando nunca
  // houve backfill completo, ou quando o último passou de FULL_EVERY_MS.
  let full = opts.full === true;
  if (!full) {
    const st = await cache.getSyncState(accountId, advertiserId).catch(() => null);
    const lastFull = st && st.last_full_synced_at ? new Date(st.last_full_synced_at).getTime() : 0;
    full = !lastFull || (Date.now() - lastFull) > FULL_EVERY_MS;
  }

  await cache.upsertSyncState(accountId, advertiserId, { status: 'syncing' }).catch(() => {});
  try {
    const today = new Date();
    const previousState = await cache.getSyncState(accountId, advertiserId).catch(() => null);
    // getDashboardTree também consulta advertiser_info; esta leitura aquece o
    // mesmo cache e nos dá o calendário civil correto antes de montar o range.
    const advertiserInfo = typeof provider.getAdvertiserInfo === 'function'
      ? await provider.getAdvertiserInfo(advertiserId).catch(() => null)
      : null;
    const advertiserTimeZone = automationWindow.normalizeTimeZone(
      advertiserInfo && advertiserInfo.timezone
        ? advertiserInfo.timezone
        : previousState && previousState.advertiser_timezone,
    );
    const to = automationWindow.civilDay(today, advertiserTimeZone);
    // Estrutura: sempre janela larga (a árvore precisa refletir tudo).
    const structFrom = automationWindow.shiftCivilDay(to, -WIDE_DAYS);
    // Métricas: janela larga no full, curta no incremental (dias imutáveis).
    const metricsFrom = full
      ? structFrom
      : automationWindow.shiftCivilDay(to, -(INCREMENTAL_DAYS - 1));

    // Estrutura + status derivados (fresh: ignora o micro-cache de 15s do provider).
    const tree = await provider.getDashboardTree(accountId, { advertiserId, fromDate: structFrom, toDate: to, fresh: true });

    // Smart+ entra no MESMO espelho, mas SUBSTITUI o nó genérico de mesmo ID.
    // Isso é obrigatório porque get_tiktok_campaigns/get_tiktok_ads também
    // devolvem Smart+ e os classificavam como leilão comum. As métricas seguem
    // vindo de AUCTION_* e são sobrepostas pelo readTree usando os IDs reais.
    const spNodes = await smartPlusNodes(advertiserId);
    if (spNodes.length) {
      const smartById = new Map(spNodes.map((node) => [String(node.platformCampaignId), node]));
      const merged = (tree.campaigns || []).map((node) => smartById.get(String(node.platformCampaignId)) || node);
      const present = new Set(merged.map((node) => String(node.platformCampaignId)));
      for (const node of spNodes) if (!present.has(String(node.platformCampaignId))) merged.push(node);
      tree.campaigns = merged;
    }

    // Métricas diárias dos 3 níveis (falha isolada não derruba o sync inteiro).
    const [cd, gd, ad] = await Promise.all([
      collectDaily(advertiserId, 'campaign', metricsFrom, to).catch((e) => { console.warn('[ads-sync] métricas campaign falharam:', e.message); return []; }),
      collectDaily(advertiserId, 'adgroup', metricsFrom, to).catch((e) => { console.warn('[ads-sync] métricas adgroup falharam:', e.message); return []; }),
      collectDaily(advertiserId, 'ad', metricsFrom, to).catch((e) => { console.warn('[ads-sync] métricas ad falharam:', e.message); return []; }),
    ]);
    const dailyMetrics = cd.concat(gd, ad);

    // Incremental NÃO poda métricas (preserva o backfill histórico).
    await cache.writeAdvertiserSnapshot(accountId, advertiserId, { campaigns: tree.campaigns || [], dailyMetrics }, { pruneMetrics: full });
    // A mesma árvore já coletada alimenta a caixa durável de reprovações. Não
    // há chamada extra ao TikTok e um incidente some da caixa automaticamente
    // quando deixa de estar rejeitado no próximo sync.
    await adsOps.syncAdRejections(accountId, advertiserId, tree.campaigns || [])
      .catch((error) => console.warn('[ads-sync] central de reprovações não atualizada:', error.message));

    const callsUsed = (pipeboard.getCallStats ? pipeboard.getCallStats().total : 0) - callsBefore;
    const now = new Date().toISOString();
    await cache.upsertSyncState(accountId, advertiserId, {
      status: 'ok', lastSyncedAt: now, lastFullSyncedAt: full ? now : null,
      windowFrom: structFrom, windowTo: to, advertiserTimezone: advertiserTimeZone,
      lastDurationMs: Date.now() - start, callsUsed,
    });
    console.log('[ads-sync] ' + accountId + '/' + advertiserId + ' ok (' + (full ? 'full' : 'incremental') + ') — ' + (tree.campaigns || []).length + ' campanhas, ' + dailyMetrics.length + ' linhas de métrica, ' + callsUsed + ' chamadas, ' + (Date.now() - start) + 'ms');
    return { ok: true, full, campaigns: (tree.campaigns || []).length, metrics: dailyMetrics.length, callsUsed };
  } catch (err) {
    // Bloqueio de conta (limite mensal de contas do Pipeboard) é um estado
    // distinto de erro genérico: é esperado, recuperável só no reset, e não deve
    // ser martelado a cada tick. Marcamos status='blocked' para o backoff e para
    // a dashboard poder explicar ao usuário.
    const blocked = err.code === 'ACCOUNT_BLOCKED';
    // Advertiser removido do acesso da conexão Pipeboard (Configure Access):
    // erro PERMANENTE até o usuário reconfigurar — também entra em backoff em
    // vez de repetir o mesmo erro a cada 3 minutos no log.
    const unauthorized = !blocked && /not one of the accounts this TikTok connection is allowed to access/i.test(String(err.message || ''));
    const status = blocked ? 'blocked' : unauthorized ? 'unauthorized' : 'error';
    await cache.upsertSyncState(accountId, advertiserId, { status, lastError: String(err.message || err).slice(0, 500), lastDurationMs: Date.now() - start }).catch(() => {});
    console.error('[ads-sync] ' + accountId + '/' + advertiserId + (blocked ? ' BLOQUEADA:' : unauthorized ? ' SEM ACESSO (backoff 30min):' : ' ERRO:'), err.message);
    return { ok: false, error: err.message, blocked, unauthorized };
  }
}

// Dedup de sync em voo: requests concorrentes para o mesmo advertiser
// compartilham a mesma promessa (evita rajada de N syncs idênticos).
const inflight = new Map();
function dedupSync(accountId, advertiserId, opts = {}) {
  const key = syncKey(accountId, advertiserId);
  if (inflight.has(key)) return inflight.get(key);
  const p = syncAdvertiser(accountId, advertiserId, opts).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

// Garante dados para uma leitura da dashboard:
//   - marca o advertiser como ativo (vira alvo do loop recorrente);
//   - se há cache, serve na hora e revalida em segundo plano quando velho (SWR);
//   - se o cache está frio (nunca sincronizado), BLOQUEIA até o 1º sync.
// Retorna { ok, cached, stale, cold } — a rota lê do espelho em seguida.
async function ensureFresh(accountId, advertiserId, opts = {}) {
  advertiserId = String(advertiserId || '').trim();
  if (!cache.enabled || !provider.enabled || !advertiserId) return { ok: false, disabled: true };
  await cache.touchActivity(accountId, advertiserId).catch(() => {});
  const st = await cache.getSyncState(accountId, advertiserId).catch(() => null);
  const last = st && st.last_synced_at ? new Date(st.last_synced_at).getTime() : 0;
  const hasData = last > 0 && st && st.status !== 'never';
  const stale = !last || (Date.now() - last) > (opts.maxAgeMs || STALE_MS);

  if (hasData) {
    if (stale) dedupSync(accountId, advertiserId).catch(() => {}); // revalida sem bloquear
    return { ok: true, cached: true, stale };
  }
  // cache frio: bloqueia no primeiro carregamento (senão a tela viria vazia)
  if (opts.blockIfCold === false) { dedupSync(accountId, advertiserId).catch(() => {}); return { ok: false, cold: true }; }
  return dedupSync(accountId, advertiserId);
}

// Refresh manual (botão "Atualizar agora") com throttle por advertiser — evita
// que cliques repetidos disparem uma rajada de syncs.
const lastManual = new Map();
async function refreshNow(accountId, advertiserId) {
  advertiserId = String(advertiserId || '').trim();
  if (!cache.enabled || !provider.enabled || !advertiserId) return { ok: false, disabled: true };
  const key = syncKey(accountId, advertiserId);
  const prev = lastManual.get(key) || 0;
  const waitMs = MANUAL_THROTTLE_MS - (Date.now() - prev);
  if (waitMs > 0) return { ok: false, throttled: true, retryInMs: waitMs };
  lastManual.set(key, Date.now());
  // force: o refresh manual ignora o backoff de bloqueio — o usuário pediu
  // explicitamente, então tentamos de novo mesmo que a conta esteja bloqueada.
  return dedupSync(accountId, advertiserId, { force: true });
}

// ── Loop recorrente ─────────────────────────────────────────────────────────
let running = false;
let timer = null;
const runtime = {
  lastTickStartedAt: null,
  lastTickCompletedAt: null,
  lastTickError: null,
};

// Estado do PROCESSO atual. Não é persistido de propósito: depois de um
// restart, o painel só volta a dizer que o motor está rodando após observar o
// novo timer/tick — nunca reutiliza um heartbeat antigo como se estivesse vivo.
function getRuntimeStatus() {
  return {
    started: !!timer,
    running,
    lastTickStartedAt: runtime.lastTickStartedAt,
    lastTickCompletedAt: runtime.lastTickCompletedAt,
    lastTickError: runtime.lastTickError,
    intervalMs: SYNC_INTERVAL_MS,
  };
}

async function tick() {
  if (running) return;
  running = true;
  const tickStart = Date.now();
  runtime.lastTickStartedAt = new Date(tickStart).toISOString();
  let tickError = null;
  try {
    // automation é carregado preguiçosamente AQUI (não no topo) para evitar
    // qualquer risco de ciclo de require no boot — em runtime o cache de
    // módulos do Node resolve na primeira chamada e reusa depois.
    const automation = require('./ads-automation');
    const recent = await cache.listActiveAdvertisers(ACTIVE_WINDOW_MIN);
    const persistent = automation.listPersistentAutomationScopes();
    const targetsByScope = new Map();
    for (const scope of recent.concat(persistent)) {
      const key = scope.accountId + ':' + scope.advertiserId;
      // A entrada "recent" pode carregar metadados usados pelo briefing; não
      // deixa a versão mínima da inscrição persistente sobrescrevê-los.
      if (!targetsByScope.has(key)) targetsByScope.set(key, scope);
    }
    const targets = [...targetsByScope.values()];

    for (const a of targets) {
      const st = await cache.getSyncState(a.accountId, a.advertiserId).catch(() => null);
      const last = st && st.last_synced_at ? new Date(st.last_synced_at).getTime() : 0;
      const wasBlocked = st && st.status === 'blocked';
      if (!last || (Date.now() - last) >= (SYNC_INTERVAL_MS - 15 * 1000) || wasBlocked) {
        // Conta bloqueada: syncAdvertiser já respeita BLOCKED_BACKOFF_MS (só
        // re-proba após 30min). Se o re-probe der certo, é a auto-recuperação
        // do estado 'blocked' obsoleto — loga e avisa no rulesLog.
        const result = await syncAdvertiser(a.accountId, a.advertiserId); // sequencial: respeita o rate limit
        if (wasBlocked && result && result.ok) {
          try { automation.noteRecovery(a.accountId, a.advertiserId); } catch (_) {}
        }
      }
    }
    // Varreduras de automação 24/7: rodam DEPOIS do sync (espelho fresco),
    // uma vez por advertiser, lendo SÓ do Neon — zero chamadas extras à Pipeboard.
    // Throttle vive dentro do módulo (compartilhado com o hook das rotas).
    for (const scope of targets) {
      const accId = scope.accountId;
      try { await automation.maybeSweep(accId, scope.advertiserId); } catch (_) { /* sweep nunca derruba o sync */ }
    }

    // O briefing não faz parte da automação operacional. Mantém o comportamento
    // anterior: só roda para contas abertas recentemente, evitando geração de
    // IA em background apenas porque uma regra ficou ligada.
    const briefingScopes = [...new Map(recent.map((a) => [a.accountId + ':' + a.advertiserId, a])).values()];
    for (const scope of briefingScopes) {
      const accId = scope.accountId;
      // Briefing diário com IA: 1×/dia por conta + advertiser, idempotente via Neon,
      // fire-and-forget (nunca atrasa nem derruba o tick). Lazy require pelo
      // mesmo motivo do automation acima (sem risco de ciclo no boot).
      try {
        const adsAi = require('./ads-ai');
        adsAi.maybeDailyBriefing(accId, scope.advertiserId, scope.currency || 'BRL');
        // O detector intradiário usa snapshots cumulativos do mesmo espelho.
        // O próprio módulo aplica o intervalo durável de 4h e só chama a
        // Anthropic quando encontra uma anomalia estatisticamente relevante.
        adsAi.maybeIntradayAnomaly(accId, scope.advertiserId, scope.currency || 'BRL');
      } catch (_) { /* briefing nunca derruba o sync */ }
    }
  } catch (err) {
    tickError = String(err && err.message ? err.message : err).slice(0, 500);
    console.error('[ads-sync] tick falhou:', err.message);
  } finally {
    const dur = Date.now() - tickStart;
    if (dur > 60 * 1000) console.warn('[ads-sync] tick demorou ' + Math.round(dur / 1000) + 's (esperado < 60s)');
    runtime.lastTickCompletedAt = new Date().toISOString();
    runtime.lastTickError = tickError;
    running = false;
  }
}

function start() {
  if (timer) return;
  if (!cache.enabled || !provider.enabled) {
    console.warn('[ads-sync] desativado (Neon ou Pipeboard indisponível).');
    return;
  }
  console.log('[ads-sync] motor ligado — intervalo ' + Math.round(SYNC_INTERVAL_MS / 1000) + 's, janela ' + WIDE_DAYS + 'd, recentes < ' + ACTIVE_WINDOW_MIN + 'min + automações persistentes 24/7.');
  timer = setInterval(() => { tick().catch(() => {}); }, SYNC_INTERVAL_MS);
  if (timer.unref) timer.unref();
  // primeiro tick logo após o boot (dá tempo do schema/rotas subirem)
  setTimeout(() => { tick().catch(() => {}); }, 5 * 1000);
}

function stop() { if (timer) { clearInterval(timer); timer = null; } }

// Após uma ESCRITA (pausar/ativar/orçamento), o espelho fica defasado. Isto
// força um sync imediato da conta (sem throttle) p/ a dashboard refletir a
// mudança. Devolve a Promise compartilhada: rotas podem ignorá-la, enquanto o
// motor de automação a aguarda sob o lease antes de avaliar a próxima etapa.
const postWriteSync = new Map();
function syncAfterWrite(accountId, advertiserId) {
  advertiserId = String(advertiserId || '').trim();
  if (!cache.enabled || !provider.enabled || !advertiserId) return Promise.resolve(null);
  const key = syncKey(accountId, advertiserId);
  let state = postWriteSync.get(key);
  if (!state) {
    state = { dirty: false, running: false, promise: null };
    postWriteSync.set(key, state);
  }
  // Toda escrita marca o espelho como sujo. Se outra escrita chegar enquanto
  // um sync está em voo, o loop executa uma segunda passagem depois dele, em
  // vez de considerar a promessa compartilhada suficiente e perder a mudança.
  state.dirty = true;
  if (state.running) return state.promise;
  state.running = true;
  state.promise = (async () => {
    while (state.dirty) {
      state.dirty = false;
      const result = await dedupSync(accountId, advertiserId, { force: true });
      if (!result || !result.ok) throw new Error((result && result.error) || 'sync pós-escrita não concluído');
    }
    return { ok: true };
  })().catch((e) => {
    console.warn('[ads-sync] sync pós-escrita falhou:', e.message);
    return { ok: false, error: e.message };
  }).finally(() => {
    state.running = false;
    // Uma escrita pode marcar dirty entre o fim do while e o finally.
    if (state.dirty) {
      postWriteSync.delete(key);
      return syncAfterWrite(accountId, advertiserId);
    } else {
      postWriteSync.delete(key);
    }
  });
  return state.promise;
}

module.exports = {
  syncAdvertiser,
  ensureFresh,
  refreshNow,
  syncAfterWrite,
  getRuntimeStatus,
  start,
  stop,
  tick,
  _config: { WIDE_DAYS, SYNC_INTERVAL_MS, ACTIVE_WINDOW_MIN, STALE_MS, MANUAL_THROTTLE_MS },
};
