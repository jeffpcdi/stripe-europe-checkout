// ─────────────────────────────────────────────────────────────────────────────
// ads-routes.js — Rotas /api/ads/* do painel (TikTok Ads via Zernio).
//
// Registradas pelo server.js com o MESMO dashboardAuth das demais APIs.
// Toda chamada é escopada à conta logada (req.account.id): profile Zernio,
// SocialAccount tiktokads e advertiser selecionado vivem na config da conta.
//
// Fluxo de conexão (OAuth):
//   GET  /api/ads/status     → estado geral (conectado? advertiser? identity?)
//   GET  /api/ads/connect    → { authUrl } (TikTok Business OAuth via Zernio)
//   POST /api/ads/connected  → callback do painel pós-OAuth: descobre a conta
//   POST /api/ads/disconnect → esquece a conexão local (não revoga na Zernio)
//
// Leitura:
//   GET /api/ads/accounts    → advertisers do token
//   GET /api/ads/tree        → campanha → ad group → ad com métricas
//   GET /api/ads/campaigns/:id/analytics → resumo + série diária
//
// Escrita:
//   POST   /api/ads/create               → campanha completa (vídeo)
//   POST   /api/ads/boost                → Spark Ads
//   POST   /api/ads/campaigns/bulk-status→ pausa/ativa em lote
//   POST   /api/ads/campaigns/:id/duplicate
//   PUT    /api/ads/:adId                → status/budget/creative
//   DELETE /api/ads/:adId                → cancela o anúncio
//   PATCH  /api/ads/identity             → Brand Identity (nome+avatar)
//   POST   /api/ads/upload               → vídeo/imagem → Vercel Blob (URL pública)
// ─────────────────────────────────────────────────────────────────────────────
const zernio = require('./zernio-ads');
const pipeboard = require('./ads-provider'); // Gate 2+: fronteira dashboard↔Pipeboard
const pipeboardMcp = require('./pipeboard-mcp'); // Gate 1: cliente MCP cru (só /diag)
const adsCache = require('./ads-cache-store'); // espelho durável no Neon (leitura)
const adsSync = require('./ads-sync');         // motor Pipeboard→Neon (sync em background)
const automation = require('./ads-automation'); // regras/alertas/dayparting 24/7
const adsAi = require('./ads-ai');             // copiloto/briefing/criativos/realocação (IA, leituras 100% Neon)
const adsOps = require('./ads-ops-store');
const catalogStore = require('./ads-catalog-store');
const catalogFeed = require('./ads-catalog-feed');

// Repassa erros da Zernio com o payload estruturado (o front mostra a mensagem)
function fail(res, err) {
  const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
  const out = { error: String(err.message || 'erro inesperado').slice(0, 500) };
  if (err.zernio && typeof err.zernio === 'object') {
    if (err.zernio.code) out.code = err.zernio.code;
    if (err.zernio.type) out.type = err.zernio.type;
    if (err.zernio.platformError) out.platformError = err.zernio.platformError;
  }
  res.status(status).json(out);
}

module.exports = function registerAdsRoutes(app, dashboardAuth, deps) {
  const stats = (deps && deps.stats) || { logEvent() {} };

  // Hook da varredura de alertas — preenchido no fim do arquivo (as regras
  // vivem lá); as rotas de polling chamam via adsSweepHook.fn(accId).
  const adsSweepHook = { fn: null };

  // Atribuição por campanha: anexa UTMs ao link de destino dos anúncios.
  // __CAMPAIGN_ID__ é um macro que o PRÓPRIO TikTok substitui na entrega pelo
  // ID real da campanha — o lead chega com utm_campaign=<id> e o /api/track
  // já grava utm.campaign no lead. Não sobrescreve UTMs que o usuário já pôs.
  function withAdsTracking(url) {
    try {
      const u = new URL(url);
      if (!u.searchParams.has('utm_source')) u.searchParams.set('utm_source', 'tiktok');
      if (!u.searchParams.has('utm_medium')) u.searchParams.set('utm_medium', 'paid');
      if (!u.searchParams.has('utm_campaign')) u.searchParams.set('utm_campaign', '__CAMPAIGN_ID__');
      // decodeURIComponent: o TikTok exige o macro cru (__X__), não %5F%5FX...
      return u.toString().replace(/%5F%5FCAMPAIGN%5FID%5F%5F/gi, '__CAMPAIGN_ID__');
    } catch (_) { return url; }
  }

  // ── Fundação operacional: jobs e guardrails por conta ─────────────────────
  app.get('/api/ads/ops/jobs', dashboardAuth, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const jobs = await adsOps.listJobs(req.account.id, req.query.limit);
      res.json({ enabled: adsOps.enabled, jobs });
    } catch (err) { fail(res, err); }
  });

  app.get('/api/ads/ops/safety-policy', dashboardAuth, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      res.json({ enabled: adsOps.enabled, policy: await adsOps.getSafetyPolicy(req.account.id) });
    } catch (err) { fail(res, err); }
  });

  app.put('/api/ads/ops/safety-policy', dashboardAuth, async (req, res) => {
    try {
      const before = await adsOps.getSafetyPolicy(req.account.id);
      const policy = await adsOps.saveSafetyPolicy(req.account.id, req.body || {});
      await adsOps.appendAuditEvent(req.account.id, {
        actorType: 'user', actorId: req.account.id, action: 'safety_policy.updated',
        targetType: 'safety_policy', targetId: req.account.id, beforeState: before,
        afterState: adsOps.normalizePolicy(req.body || {}),
        reason: policy.killSwitch ? 'Kill switch acionado manualmente' : 'Guardrails atualizados manualmente'
      });
      stats.logEvent('warn', { acc: req.account.id, title: policy.killSwitch ? 'Kill switch de Ads ativado' : 'Política de segurança de Ads atualizada' });
      res.json({ policy });
    } catch (err) { fail(res, err); }
  });

  // Histórico de auditoria (ações reais/simuladas do motor + escritas manuais).
  // A UI usa `before_state` p/ decidir se mostra o botão "reverter".
  app.get('/api/ads/ops/audit', dashboardAuth, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      res.json({ enabled: adsOps.enabled, events: await adsOps.listAuditEvents(req.account.id, req.query.limit) });
    } catch (err) { fail(res, err); }
  });

  // Rollback de UMA ação do motor: restaura o `before_state` gravado quando a
  // ação real aconteceu. Só reverte ações reais com estado anterior conhecido
  // (rule_action / schedule_action). O kill switch NÃO bloqueia o rollback —
  // reverter é justamente a forma de reagir a algo que o motor fez.
  app.post('/api/ads/ops/audit/:auditId/rollback', dashboardAuth, async (req, res) => {
    try {
      if (!pipeboard.enabled) return res.status(409).json({ error: 'Pipeboard não configurado no servidor' });
      const ev = await adsOps.getAuditEvent(req.account.id, String(req.params.auditId || ''));
      if (!ev) return res.status(404).json({ error: 'Evento de auditoria não encontrado' });
      if (!['rule_action', 'schedule_action'].includes(ev.action)) {
        return res.status(422).json({ error: 'Esta ação não é reversível automaticamente.', code: 'NOT_REVERSIBLE' });
      }
      const before = ev.before_state;
      if (!before || !before.kind) return res.status(422).json({ error: 'Sem estado anterior registrado para reverter.', code: 'NO_BEFORE_STATE' });
      const advertiserId = ev.advertiser_id;
      if (!advertiserId) return res.status(422).json({ error: 'Advertiser da ação não registrado.' });

      // dry-run continua valendo: um rollback também é uma escrita.
      if (await isDryRun(req.account.id)) {
        await auditSimulated(req.account.id, {
          action: 'rollback', targetType: ev.target_type, targetId: ev.target_id, advertiserId,
          metadata: { of: ev.id, restore: before }, title: 'Reverter ação ' + ev.id,
        });
        return res.json({ dryRun: true, simulated: true, restored: before });
      }

      if (before.kind === 'status') {
        // restaura o status anterior da campanha (pause/activate feito pelo motor)
        await pipeboard.setCampaignStatus(advertiserId, [before.id], before.value === 'paused' ? 'paused' : 'active');
      } else if (before.kind === 'budget') {
        // restaura o orçamento anterior de cada ad group tocado
        for (const g of (before.adGroups || [])) {
          if (!g || !g.id || !(Number(g.amount) > 0)) continue;
          await pipeboard.updateAdGroup(advertiserId, g.id, { budget: { amount: Number(g.amount), type: g.type === 'lifetime' ? 'lifetime' : 'daily' } });
        }
      } else {
        return res.status(422).json({ error: 'Tipo de estado anterior não suportado para rollback.', code: 'UNSUPPORTED_STATE' });
      }
      adsSync.syncAfterWrite(req.account.id, advertiserId);
      await adsOps.appendAuditEvent(req.account.id, {
        actorType: 'user', actorId: req.account.id, action: 'rollback',
        targetType: ev.target_type, targetId: ev.target_id, advertiserId,
        beforeState: ev.after_state, afterState: before,
        reason: 'Rollback manual da ação ' + ev.id, metadata: { of: ev.id },
      });
      stats.logEvent('warn', { acc: req.account.id, title: '[tiktok-ads] Rollback manual da ação ' + ev.id + ' (' + ev.action + ')' });
      res.json({ ok: true, restored: before });
    } catch (err) { fail(res, err); }
  });

  // ── Guarda de escrita (dry-run) ─────────────────────────────────────────────
  // O badge "Modo simulação" promete que NENHUMA escrita chega ao TikTok. Esta
  // guarda centraliza essa promessa: toda rota/rotina que muta estado na Zernio
  // (status, orçamento, bid, criação, duplicação, delete e as regras
  // automáticas) consulta a política ANTES de chamar a Zernio. getSafetyPolicy
  // já devolve dryRun=true por padrão — inclusive quando o Neon está
  // indisponível — então a guarda falha FECHADA: na dúvida, simula em vez de
  // escrever de verdade.
  async function isDryRun(accountId) {
    const policy = await adsOps.getSafetyPolicy(accountId);
    return !!(policy && policy.dryRun);
  }

  // Auditoria padronizada de uma escrita simulada (mesmo sufixo `.simulated`
  // usado em criar/duplicar em massa) + log de atividade. Nunca lança —
  // auditoria é best-effort e não pode derrubar a resposta da rota.
  async function auditSimulated(accountId, { action, targetType, targetId, advertiserId, metadata, title }) {
    try {
      await adsOps.appendAuditEvent(accountId, {
        actorType: 'user', actorId: accountId, action: action + '.simulated',
        targetType: targetType || null, targetId: targetId || null,
        advertiserId: advertiserId || null,
        reason: 'Política em modo dry-run (nada enviado ao TikTok)',
        metadata: metadata || {}
      });
    } catch (_) { /* auditoria não pode derrubar a rota */ }
    if (title) stats.logEvent('info', { acc: accountId, title: '[simulação] ' + title });
  }

  // Kill switch: corta TODA escrita (status/orçamento/bid/criar/duplicar/delete),
  // inclusive as mutações individuais que antes só checavam dry-run. Falha
  // FECHADA como o dry-run — se o Neon estiver fora, getSafetyPolicy devolve o
  // default (killSwitch=false), então não bloqueia por engano. Uso nas rotas:
  //   if (await killSwitchActive(accountId)) return res.status(423).json(KILL_SWITCH_BODY)
  async function killSwitchActive(accountId) {
    try {
      const policy = await adsOps.getSafetyPolicy(accountId);
      return !!(policy && policy.killSwitch);
    } catch (_) { return false; }
  }
  const KILL_SWITCH_BODY = { error: 'KILL_SWITCH_ON', message: 'Kill switch ativo: todas as alterações em anúncios estão bloqueadas. Desative em Operações › Política de segurança para voltar a agir.' };

  // ── [Gate 1 — TEMPORÁRIO] Diagnóstico do Pipeboard MCP ──────────────────────
  // Valida a auth server-to-server e captura os JSON Schemas REAIS das tools
  // ANTES de escrever o provider (o plano proíbe mapear às cegas). Também
  // confirma ≥1 advertiser. Escopado ao dashboardAuth; removido no Gate 7.
  // Critério de aceite do gate: retornar as 19 tools + ≥1 advertiser.
  app.get('/api/ads/diag', dashboardAuth, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const started = Date.now();
    try {
      if (!pipeboardMcp.enabled) {
        return res.status(503).json({
          ok: false,
          reason: 'PIPEBOARD_API_KEY ausente ou inválida no servidor',
          url: pipeboardMcp.MCP_URL,
        });
      }
      const listed = await pipeboardMcp.listTools();
      const tools = (listed && listed.tools) || [];
      const toolNames = tools.map((t) => t.name).sort();
      // Schema real de cada tool — o provider (Gate 2) é escrito contra isto.
      const schemas = {};
      for (const t of tools) schemas[t.name] = t.inputSchema || t.input_schema || null;

      // Prova de vida da conta: lista advertisers (só se a tool existir).
      let advertisers = null;
      let advertisersError = null;
      if (toolNames.includes('list_tiktok_advertisers')) {
        try {
          advertisers = await pipeboardMcp.callTool('list_tiktok_advertisers', {});
        } catch (e) {
          advertisersError = String((e && e.message) || e);
        }
      }

      res.json({
        ok: true,
        url: pipeboardMcp.MCP_URL,
        elapsedMs: Date.now() - started,
        toolCount: toolNames.length,
        toolNames,
        schemas,
        advertisers,
        advertisersError,
      });
    } catch (err) {
      res.status(err.status || 500).json({
        ok: false,
        error: String((err && err.message) || err).slice(0, 500),
        status: err.status || 500,
        pipeboard: (err && err.pipeboard) || null,
      });
    }
  });

  // ── Diagnóstico do cache/sync ───────────────────────────────────────────────
  // Prova que o caminho de leitura ficou local: mostra quantas chamadas o app
  // fez ao Pipeboard (total/min/hora) — que agora só vêm do sync + escritas —
  // e o estado de sync de cada advertiser desta conta (último sync, duração,
  // chamadas gastas, erro). Alimenta o painel de diagnóstico da dashboard.
  app.get('/api/ads/sync-status', dashboardAuth, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const calls = pipeboardMcp.getCallStats ? pipeboardMcp.getCallStats() : null;
      const states = adsCache.enabled ? await adsCache.listSyncStates(req.account.id) : [];
      res.json({
        cacheEnabled: !!adsCache.enabled,
        syncConfig: adsSync._config || null,
        calls, // { total, lastMinute, lastHour, byTool }
        advertisers: (states || []).map((s) => ({
          advertiserId: s.advertiser_id,
          status: s.status,
          lastSyncedAt: s.last_synced_at,
          lastDurationMs: s.last_duration_ms,
          callsUsed: s.calls_used,
          windowFrom: s.window_from,
          windowTo: s.window_to,
          lastError: s.last_error,
          requestedAt: s.requested_at,
        })),
      });
    } catch (err) { fail(res, err); }
  });

  // ── Status da integração ──────────────────────────────────────────────────
  app.get('/api/ads/status', dashboardAuth, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      if (adsSweepHook.fn) adsSweepHook.fn(req.account.id); // alertas pegam carona
      // Pipeboard: sem OAuth/SocialAccount. "connected" = chave no servidor +
      // um advertiser resolvido (persistido → env → 1º da conta). O provider
      // enriquece o nome do advertiser selecionado (1 chamada, cacheada).
      const s = await pipeboard.getStatus(req.account.id);
      if (!s.enabled) return res.json({ enabled: false, connected: false });
      if (!s.connected) return res.json({ enabled: true, connected: false });
      const advName = (s.advertiser && s.advertiser.name) || s.advertiserId;
      res.json({
        enabled: true,
        connected: true,
        // shape do frontend (AdsStatusResponse): mapeamos o advertiser
        // selecionado no lugar da antiga SocialAccount da Zernio.
        account: { id: s.advertiserId, username: advName, displayName: advName },
        businessCenterId: '', // Pipeboard não tem Business Center
        advertiserId: s.advertiserId || '',
        identity: null,        // identidade migra no Gate 6 (capability flag)
      });
    } catch (err) { fail(res, err); }
  });

  // ── Diagnóstico da conexão MCP Pipeboard ────────────────────────────────────
  // Painel de saúde da integração: conexão real (tools/list cacheado 5min),
  // volume de chamadas/erros na última hora e contas bloqueadas pelo limite
  // mensal (com data de reset). ?force=1 refaz o teste ignorando o cache.
  app.get('/api/ads/mcp/status', dashboardAuth, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const mcp = require('./pipeboard-mcp');
      const [diag, syncStates] = await Promise.all([
        mcp.getDiagnostics({ force: req.query.force === '1' }),
        adsCache.enabled ? adsCache.listSyncStates(req.account.id).catch(() => []) : Promise.resolve([]),
      ]);
      const blocked = syncStates
        .filter((s) => s.status === 'blocked')
        .map((s) => {
          const m = String(s.last_error || '').match(/(\d{4}-\d{2}-\d{2})/);
          return { advertiserId: s.advertiser_id, blockedUntil: (m && m[1]) || null };
        });
      const lastSync = syncStates.reduce((max, s) => {
        const t = s.last_synced_at ? new Date(s.last_synced_at).getTime() : 0;
        return t > max ? t : max;
      }, 0);
      res.json({
        enabled: mcp.enabled,
        connected: !!diag.ok,
        error: diag.error || null,
        checkedAt: diag.checkedAt || null,
        cached: !!diag.cached,
        toolCount: diag.toolCount || 0,
        calls: mcp.getCallStats(),
        accounts: {
          synced: syncStates.length,
          blocked,
          lastSyncAt: lastSync ? new Date(lastSync).toISOString() : null,
        },
        automation: automation.getSweepInfo(req.account.id),
        // IA: configuração + telemetria (chamadas 1h, tokens, briefing de hoje)
        ai: adsAi.getAiStats(),
      });
    } catch (err) { fail(res, err); }
  });

  // ── OAuth: gera a URL de autorização do TikTok Business ───────────────────
  // Aceita GET e POST: o painel chama via POST (ação), mas mantemos GET
  // para compatibilidade com integrações antigas.
  //
  // FIX: o endpoint canônico da Zernio é GET /connect/{platform}/ads →
  // /connect/tiktok/ads (docs: "Connect ads for a platform"). O caminho
  // antigo /connect/tiktok-ads não é a rota de OAuth (só existe como PATCH,
  // para Brand Identity) e levava o usuário ao dashboard/login da Zernio em
  // vez da tela de autorização do TikTok for Business.
  //
  // Escopo da BC: o TikTok escolhe os advertisers NA TELA DE CONSENTIMENTO
  // do OAuth ("tiktok scopes advertisers at OAuth"). Se o usuário marcar a
  // Business Center inteira, a Zernio enumera todos os advertisers da BC
  // automaticamente em GET /ads/accounts (sem cap por chamada).
  async function startConnect(req, res) {
    try {
      const profileId = await zernio.ensureProfile(req.account.id);
      // Modo ads-only (sem accountId de posting): anúncios usam Brand Identity.
      const data = await zernio.api('GET', '/connect/tiktok/ads', { query: { profileId } });
      // Já conectado nesta profile → devolve como sucesso imediato (o front
      // confirma via POST /api/ads/connected, que resolve a SocialAccount).
      if (data && data.alreadyConnected) {
        return res.json({ alreadyConnected: true, authUrl: '' });
      }
      if (!data || !data.authUrl) return res.status(502).json({ error: 'Zernio não retornou a URL de autorização' });
      res.json({ authUrl: data.authUrl });
    } catch (err) { fail(res, err); }
  }
  app.get('/api/ads/connect', dashboardAuth, startConnect);
  app.post('/api/ads/connect', dashboardAuth, startConnect);

  // ── Callback do painel: após o OAuth, descobre a SocialAccount criada ─────
  app.post('/api/ads/connected', dashboardAuth, async (req, res) => {
    try {
      const profileId = await zernio.ensureProfile(req.account.id);
      const data = await zernio.api('GET', '/accounts');
      let mine = (data.accounts || []).filter((a) => a.platform === 'tiktokads' && String(a.profileId || '') === String(profileId));
      // FALLBACK (adoção de órfã): se a config local foi resetada e um profile
      // novo foi criado, a conexão feita antes vive em OUTRO profile da mesma
      // chave (ex.: "Painel acc_282f0c9e4c" antigo). Sem isso o painel fica
      // preso em "Aguardando autorização" mesmo com a conta conectada na
      // Zernio. Adotamos a tiktokads mais recente da chave, registrando também
      // o profileId dela para as próximas chamadas de connect/status.
      if (!mine.length) {
        const any = (data.accounts || []).filter((a) => a.platform === 'tiktokads');
        if (any.length) {
          any.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
          const adopted = any[0];
          zernio.setState(req.account.id, { profileId: String(adopted.profileId || profileId) });
          mine = [adopted];
        }
      }
      if (!mine.length) return res.json({ connected: false });
      // a mais recente vence (reconexões geram novas SocialAccounts)
      mine.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      const acct = mine[0];
      zernio.setState(req.account.id, { accountId: acct._id });
      zernio.cacheBust('status:' + req.account.id);
      zernio.cacheBust('accounts:' + req.account.id);
      stats.logEvent('info', { acc: req.account.id, title: 'TikTok Ads conectado: ' + (acct.displayName || acct.username || acct._id) });
      res.json({ connected: true, account: { id: acct._id, username: acct.username || '', displayName: acct.displayName || '' } });
    } catch (err) { fail(res, err); }
  });

  // ── Desconectar (esquece localmente; a revogação fica no painel Zernio) ───
  app.post('/api/ads/disconnect', dashboardAuth, async (req, res) => {
    try {
      const st = zernio.getState(req.account.id);
      if (st.accountId) {
        // tenta remover a SocialAccount na Zernio (melhor esforço)
        try { await zernio.api('DELETE', '/accounts/' + st.accountId); } catch (_) { /* já removida */ }
      }
      zernio.setState(req.account.id, { accountId: '', businessCenterId: '', advertiserId: '', identity: null });
      zernio.cacheBust('status:' + req.account.id);
      zernio.cacheBust('accounts:' + req.account.id);
      zernio.cacheBust('bcs:' + req.account.id);
      zernio.cacheBust('tree:' + req.account.id);
      stats.logEvent('warn', { acc: req.account.id, title: 'TikTok Ads desconectado' });
      res.json({ ok: true });
    } catch (err) { fail(res, err); }
  });

  // ── Business Centers (camada acima dos advertisers) ──────────────────────
  // A Zernio expõe GET /ads/business-centers; a criação de BC/conta de anúncio
  // NÃO tem API (só a UI do TikTok) — por isso o deep-link mais abaixo.
  // Se a Zernio não suportar o endpoint (404), devolvemos lista vazia com
  // `unsupported: true` e a UI esconde o seletor de BC (nunca prometer o que
  // a API não faz).
  // Pipeboard NÃO tem Business Center (nem API nem conceito). A UI mantém o
  // seletor de BC escondido quando `unsupported: true`. Deixamos o helper por
  // compatibilidade com as rotas, sempre devolvendo lista vazia + unsupported.
  async function listBusinessCenters(_accId, _st) {
    return { businessCenters: [], unsupported: true };
  }

  // Lista advertisers via provider (os 155 do token). O provider já normaliza
  // healthStatus + rawStatus e resolve o selecionado. `businessCenterId` é
  // ignorado (não existe no Pipeboard) — mantido na assinatura por compat.
  async function listAdvertisers(accId, _st, _businessCenterId) {
    const out = await pipeboard.listAdvertisers(accId, { enrich: 0 });
    return out.advertisers;
  }

  async function requireAdvertiser(accId, _st, rawId, _rawBcId) {
    const advertiserId = String(rawId || '').trim().slice(0, 60);
    if (!advertiserId || advertiserId === '__all__') {
      const err = new Error('Selecione uma conta de anúncio específica');
      err.status = 400;
      throw err;
    }
    // valida que o advertiser pertence ao token (autorizado no Pipeboard)
    const ids = await pipeboard.listAdvertiserIds();
    if (!ids.map(String).includes(advertiserId)) {
      const err = new Error('Esta conta de anúncio não está autorizada no token do Pipeboard');
      err.status = 403;
      throw err;
    }
    return { advertiserId, businessCenterId: '', advertiser: { id: advertiserId } };
  }

  app.get('/api/ads/business-centers', dashboardAuth, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      // Pipeboard não tem BC: sempre unsupported → a UI esconde o seletor.
      const out = await listBusinessCenters(req.account.id);
      res.json({ businessCenters: out.businessCenters, selected: '', unsupported: out.unsupported });
    } catch (err) { fail(res, err); }
  });

  app.post('/api/ads/business-centers/select', dashboardAuth, async (req, res) => {
    // Sem BC no Pipeboard — no-op idempotente (a UI não deve chamar isto).
    res.json({ ok: true, businessCenterId: '', advertiserId: pipeboard.getState(req.account.id).advertiserId || '' });
  });

  // ── Deep-link: criar conta de anúncio (NÃO há API — só a UI do TikTok) ────
  // Sem BC, o deep-link aponta para o Business Center genérico do TikTok.
  app.get('/api/ads/deeplink/create-account', dashboardAuth, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ url: 'https://business.tiktok.com/', businessCenterId: '' });
  });

  // ── Advertisers (contas de anúncio do token) ──────────────────────────────
  // Lista os 155 advertisers autorizados no token do Pipeboard. Enriquece os
  // nomes dos primeiros N (o resto cai no id até ser selecionado/aberto —
  // enriquecer 155 de uma vez = 155 chamadas). O selecionado sempre vem com
  // nome (o provider resolve + enriquece o escolhido).
  app.get('/api/ads/accounts', dashboardAuth, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      if (!pipeboard.enabled) return res.status(409).json({ error: 'Pipeboard não configurado no servidor' });
      const out = await pipeboard.listAdvertisers(req.account.id, { enrich: 30 });
      res.json({ accounts: out.advertisers, selected: out.selectedId || '', businessCenterId: '' });
    } catch (err) { fail(res, err); }
  });

  // seleciona o advertiser usado como padrão nas telas
  app.post('/api/ads/accounts/select', dashboardAuth, async (req, res) => {
    try {
      if (!pipeboard.enabled) return res.status(409).json({ error: 'Pipeboard não configurado no servidor' });
      const body = req.body || {};
      const selected = await requireAdvertiser(req.account.id, null, body.advertiserId, null);
      await pipeboard.selectAdvertiser(req.account.id, selected.advertiserId);
      pipeboard.cacheBust('roas:' + req.account.id);
      res.json({ ok: true, advertiserId: selected.advertiserId });
    } catch (err) { fail(res, err); }
  });

  // ── Árvore campanha → ad group → ad com métricas ──────────────────────────
  // Delegada ao provider (getDashboardTree): resolve o advertiser, busca
  // campaigns/adgroups/ads + insights por nível, reconcilia status (incluindo
  // reviewStatus dos anúncios) e devolve o shape AdsTreeResponse. Paginação,
  // ordenação e filtro de status são resolvidos lá. Não há Business Center
  // nem paginação de 100 no Pipeboard (get_tiktok_campaigns já traz tudo).
  app.get('/api/ads/tree', dashboardAuth, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      if (adsSweepHook.fn) adsSweepHook.fn(req.account.id); // alertas pegam carona
      if (!pipeboard.enabled) return res.status(409).json({ error: 'Pipeboard não configurado no servidor' });
      const q = req.query || {};
      // adAccountId opcional: quando ausente, o provider usa o advertiser
      // resolvido (persistido → env → 1º). Quando presente, valida autorização.
      let advertiserId;
      if (q.adAccountId) {
        const selected = await requireAdvertiser(req.account.id, null, q.adAccountId, null);
        advertiserId = selected.advertiserId;
      } else {
        advertiserId = await pipeboard.resolveAdvertiserId(req.account.id);
        if (!advertiserId) return res.status(409).json({ error: 'Nenhuma conta de anúncio autorizada no token' });
      }
      // Caminho de leitura = espelho no Neon (instantâneo + resiliente).
      // ensureFresh: marca a conta como ativa (alvo do loop), serve o cache já
      // gravado e revalida em segundo plano; só bloqueia no cache FRIO (1º acesso).
    if (adsCache.enabled) {
      await adsSync.ensureFresh(req.account.id, advertiserId).catch((e) => {
        console.warn('[ads/tree] ensureFresh falhou (segue com o que houver):', e.message);
      });
      const cached = await adsCache.readTree(req.account.id, advertiserId, {
        fromDate: q.fromDate, toDate: q.toDate, status: q.status, sort: q.sort,
      });
      if (cached) {
        // Se o último sync falhou (ex.: conta bloqueada pelo limite mensal do
        // Pipeboard), a árvore vem vazia. Sem isto a tela diria "0 campanhas"
        // como se a conta não tivesse anúncios — enganoso. Anexamos o motivo
        // real para a dashboard mostrar um aviso claro (não é erro fatal: o
        // resto da UI segue renderizando).
        const st = await adsCache.getSyncState(req.account.id, advertiserId).catch(() => null);
        if (st && (st.status === 'blocked' || st.status === 'error')) {
          const m = String(st.last_error || '').match(/(\d{4}-\d{2}-\d{2})/);
          cached.syncError = {
            code: st.status === 'blocked' ? 'ACCOUNT_BLOCKED' : 'SYNC_ERROR',
            message: st.last_error || 'Falha ao sincronizar com o TikTok.',
            blockedUntil: st.status === 'blocked' ? (m && m[1]) || null : null,
            advertiserId,
          };
        }
        return res.json(cached);
      }
    }
      // Fallback: Neon indisponível → leitura ao vivo do provider (degradado).
      const data = await pipeboard.getDashboardTree(req.account.id, {
        advertiserId, fromDate: q.fromDate, toDate: q.toDate, status: q.status, sort: q.sort,
      });
      res.json(data);
    } catch (err) { fail(res, err); }
  });

  // Refresh manual ("Atualizar agora"): força um sync imediato deste advertiser
  // (Pipeboard→Neon) com throttle por conta. Não é mais um cache-bust local —
  // é o único gatilho manual de leitura ao provider fora do loop de sync.
  app.post('/api/ads/tree/refresh', dashboardAuth, async (req, res) => {
    try {
      if (!adsCache.enabled) { pipeboard.cacheBust('dashtree:' + req.account.id); return res.status(204).end(); }
      const q = req.query || {};
      let advertiserId = q.adAccountId ? String(q.adAccountId).trim() : await pipeboard.resolveAdvertiserId(req.account.id);
      if (!advertiserId) return res.status(409).json({ error: 'Nenhuma conta de anúncio autorizada no token' });
      const r = await adsSync.refreshNow(req.account.id, advertiserId);
      if (r && r.throttled) return res.status(429).json({ error: 'Aguarde antes de atualizar novamente', retryInMs: r.retryInMs });
      res.json({ ok: true, synced: !!(r && r.ok), campaigns: r && r.campaigns, metrics: r && r.metrics });
    } catch (err) { fail(res, err); }
  });

  // ── Analytics de campanha (resumo + série diária) ───────────────────���─────
  app.get('/api/ads/campaigns/:id/analytics', dashboardAuth, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      if (!pipeboard.enabled) return res.status(409).json({ error: 'Pipeboard não configurado no servidor' });
      const q = req.query || {};
      const campaignId = String(req.params.id || '').trim();
      if (!campaignId) return res.status(400).json({ error: 'ID da campanha obrigatório' });
      // advertiser: query explícita (validada) ou o padrão resolvido
      let advertiserId;
      if (q.adAccountId) advertiserId = (await requireAdvertiser(req.account.id, null, q.adAccountId, null)).advertiserId;
      else {
        advertiserId = await pipeboard.resolveAdvertiserId(req.account.id);
        if (!advertiserId) return res.status(409).json({ error: 'Nenhuma conta de anúncio autorizada no token' });
      }
      const today = new Date();
      const iso = (d) => d.toISOString().slice(0, 10);
      const fromDate = /^\d{4}-\d{2}-\d{2}$/.test(String(q.fromDate || '')) ? q.fromDate : iso(new Date(today.getTime() - 6 * 864e5));
      const toDate = /^\d{4}-\d{2}-\d{2}$/.test(String(q.toDate || '')) ? q.toDate : iso(today);

      // Espelho no Neon: série diária no nível campanha, agregada por dia.
      if (adsCache.enabled) {
        await adsSync.ensureFresh(req.account.id, advertiserId).catch(() => {});
        const cachedAn = await adsCache.readCampaignAnalytics(req.account.id, advertiserId, campaignId, fromDate, toDate);
        if (cachedAn && cachedAn.summary) return res.json(cachedAn);
      }
      // Fallback: leitura ao vivo (Neon indisponível).
      const ck = 'analytics:' + req.account.id + ':' + advertiserId + ':' + campaignId + ':' + fromDate + ':' + toDate;
      let data = pipeboard.cacheGet(ck);
      if (!data) {
        // Série diária no nível CAMPAIGN (dimensões dia + campanha), filtrada
        // pela campanha pedida. summary = soma da série.
        const ins = await pipeboard.getInsights(advertiserId, {
          level: 'AUCTION_CAMPAIGN', startDate: fromDate, endDate: toDate,
          dimensions: ['stat_time_day', 'campaign_id'],
        });
        const daily = (ins.rows || [])
          .filter((r) => String((r.dimensions || {}).campaign_id || '') === campaignId)
          .map((r) => ({
            date: String((r.dimensions || {}).stat_time_day || '').slice(0, 10),
            spend: r.spend, impressions: r.impressions, clicks: r.clicks,
            conversions: r.conversions, reach: r.reach,
            ctr: r.ctr, cpc: r.cpc, cpm: r.cpm, cpa: r.cpa,
          }))
          .sort((a, b) => a.date.localeCompare(b.date));
        const summary = daily.reduce((acc, d) => {
          acc.spend += d.spend; acc.impressions += d.impressions; acc.clicks += d.clicks;
          acc.conversions += d.conversions; acc.reach += d.reach; return acc;
        }, { spend: 0, impressions: 0, clicks: 0, conversions: 0, reach: 0 });
        summary.ctr = summary.impressions ? summary.clicks / summary.impressions : 0;
        summary.cpc = summary.clicks ? summary.spend / summary.clicks : 0;
        summary.cpm = summary.impressions ? (summary.spend / summary.impressions) * 1000 : 0;
        summary.cpa = summary.conversions ? summary.spend / summary.conversions : 0;
        data = { summary, daily };
        pipeboard.cacheSet(ck, data, 60 * 1000);
      }
      res.json(data);
    } catch (err) { fail(res, err); }
  });

  // ── Criação de campanha completa (vídeo obrigatório no TikTok) ────────────
  // A montagem+validação do payload vive numa função própria para ser
  // REUTILIZADA pelo worker de bulk (cada item do lote vira uma criação
  // individual idêntica à deste endpoint).
  function buildCreatePayload(st, b) {
    const adAccountId = String(b.adAccountId || st.advertiserId || '').trim();
    if (!adAccountId || adAccountId === '__all__') return { error: 'Selecione um advertiser específico (adAccountId)' };
    const name = String(b.name || '').trim().slice(0, 120);
    if (!name) return { error: 'Nome da campanha é obrigatório' };
    const goal = ['engagement', 'traffic', 'awareness', 'video_views', 'lead_generation', 'conversions', 'app_promotion'].includes(b.goal) ? b.goal : '';
    if (!goal) return { error: 'Objetivo (goal) inválido' };
    const videoUrl = String(b.videoUrl || '').trim();
    if (!/^https:\/\/[^\s]+/.test(videoUrl)) return { error: 'URL do vídeo é obrigatória (MP4 9:16, 5–60s, até 500 MB)' };
    const budgetAmount = Number(b.budgetAmount);
    if (!(budgetAmount > 0)) return { error: 'Orçamento inválido' };
    const budgetType = b.budgetType === 'lifetime' ? 'lifetime' : 'daily';

    const payload = {
      accountId: st.accountId,
      adAccountId,
      name,
      goal,
      budgetAmount,
      budgetType,
      // No TikTok, o campo imageUrl carrega a URL do VÍDEO (API é video-only).
      imageUrl: videoUrl,
      body: String(b.body || '').trim().slice(0, 100) || undefined,
      linkUrl: /^https?:\/\//.test(String(b.linkUrl || '')) ? withAdsTracking(String(b.linkUrl).trim().slice(0, 500)) : undefined,
      callToAction: /^[A-Z_]{3,30}$/.test(String(b.callToAction || '')) ? b.callToAction : undefined,
      countries: Array.isArray(b.countries)
        ? b.countries.map((c) => String(c || '').trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)).slice(0, 30)
        : undefined,
      languages: Array.isArray(b.languages)
        ? b.languages.map((c) => String(c || '').trim().toLowerCase().split('-')[0]).filter((c) => /^[a-z]{2}$/.test(c)).slice(0, 10)
        : undefined
    };
    const ageMin = parseInt(b.ageMin, 10); const ageMax = parseInt(b.ageMax, 10);
    if (ageMin >= 13) payload.ageMin = Math.min(ageMin, 65);
    if (ageMax >= 13) payload.ageMax = Math.min(ageMax, 65);
    if (budgetType === 'lifetime') {
      if (!/^\d{4}-\d{2}-\d{2}/.test(String(b.endDate || ''))) return { error: 'Orçamento lifetime exige data de término (endDate)' };
      payload.endDate = String(b.endDate).slice(0, 24);
    }
    // Conversões: pixel numérico do TikTok obrigatório
    if (goal === 'conversions') {
      const pixelId = String((b.promotedObject || {}).pixelId || b.pixelId || '').trim();
      if (!/^\d{5,30}$/.test(pixelId)) {
        return { error: 'Objetivo Conversões exige o Pixel ID NUMÉRICO do TikTok (não o código alfanumérico do Events Manager)' };
      }
      payload.promotedObject = { pixelId };
      const evt = String((b.promotedObject || {}).customEventType || b.customEventType || '').trim().toUpperCase();
      if (/^[A-Z_]{3,40}$/.test(evt)) payload.promotedObject.customEventType = evt;
    }
    // Identidade do anúncio: TT_USER (conta de posting) ou CUSTOMIZED_USER (Brand Identity)
    if (['TT_USER', 'CUSTOMIZED_USER'].includes(b.identityType)) payload.identityType = b.identityType;
    if (b.brandIdentity && b.brandIdentity.displayName && b.brandIdentity.imageUrl) {
      payload.brandIdentity = {
        displayName: String(b.brandIdentity.displayName).trim().slice(0, 100),
        imageUrl: String(b.brandIdentity.imageUrl).trim().slice(0, 500)
      };
    }
    return { payload };
  }

  app.post('/api/ads/create', dashboardAuth, async (req, res) => {
    try {
      // F1: gate via Pipeboard (a Zernio está morta — o gate antigo por
      // st.accountId deixaria a rota em 409 p/ sempre). O buildCreatePayload
      // recebe um "st" sintético com o advertiser resolvido pelo provider.
      if (!pipeboard.enabled) return res.status(409).json({ error: 'Pipeboard não configurado no servidor' });
      const advertiserId = await pipeboard.resolveAdvertiserId(req.account.id);
      if (!advertiserId) return res.status(409).json({ error: 'Nenhum advertiser TikTok autorizado — conecte no Pipeboard primeiro' });
      if (await killSwitchActive(req.account.id)) return res.status(423).json(KILL_SWITCH_BODY);
      const b = req.body || {};
      const st = { accountId: req.account.id, advertiserId };
      const built = buildCreatePayload(st, b);
      if (built.error) return res.status(400).json({ error: built.error });
      const payload = built.payload;
      const name = payload.name;

      // dry-run: não cria nada no TikTok.
      if (await isDryRun(req.account.id)) {
        await auditSimulated(req.account.id, {
          action: 'campaign_create', targetType: 'campaign', advertiserId: payload.adAccountId || st.advertiserId,
          metadata: { name, goal: payload.goal }, title: 'Criar campanha ' + name
        });
        return res.status(200).json({ dryRun: true, simulated: true, id: 'dry-run', name });
      }
      // F1: criação composta via Pipeboard (campaign → adgroup → upload → ad).
      // O provider SEMPRE cria em PAUSED; sem "status: active" aqui — a rota de
      // criação entrega material p/ revisão humana, nunca delivery imediato.
      // No campo imageUrl o buildCreatePayload carrega a URL do VÍDEO (legado).
      const result = await pipeboard.createFullAd(payload.adAccountId, {
        name: payload.name,
        goal: payload.goal,
        videoUrl: payload.imageUrl,
        budgetAmount: payload.budgetAmount,
        budgetType: payload.budgetType,
        endDate: payload.endDate,
        body: payload.body,
        linkUrl: payload.linkUrl,
        callToAction: payload.callToAction,
        countries: payload.countries,
        languages: payload.languages,
        ageMin: payload.ageMin,
        ageMax: payload.ageMax,
        promotedObject: payload.promotedObject,
        status: 'paused',
      });
      // Auditoria durável da criação real (afterState = IDs criados; "desfazer
      // criação" = pausar/apagar em cadeia esses IDs).
      await adsOps.appendAuditEvent(req.account.id, {
        actorType: 'user', actorId: req.account.id, action: 'campaign_create',
        targetType: 'campaign', targetId: result.campaignId, advertiserId: payload.adAccountId,
        afterState: { campaignId: result.campaignId, adGroupId: result.adGroupId, adId: result.adId, videoId: result.videoId },
        reason: 'Criação de campanha completa: ' + name, metadata: { goal: payload.goal },
      }).catch(() => {});
      adsSync.syncAfterWrite(req.account.id, payload.adAccountId);
      stats.logEvent('info', { acc: req.account.id, title: 'Campanha TikTok criada (PAUSED): ' + name + ' [' + result.campaignId + ']' });
      res.status(201).json({ id: result.campaignId, campaignId: result.campaignId, adGroupId: result.adGroupId, adId: result.adId, videoId: result.videoId, name, status: 'paused', warnings: result.warnings });
    } catch (err) {
      // Falha no meio da composição: reporta o passo e o que já existe (pausado).
      if (err && err.step) {
        stats.logEvent('warn', { acc: req.account.id, title: '[tiktok-ads] Criação falhou no passo "' + err.step + '": ' + String(err.message || '').slice(0, 160) });
        return res.status(err.status || 502).json({ error: err.message, step: err.step, createdIds: err.createdIds || {}, note: err.createdIds && err.createdIds.campaignId ? 'A campanha parcial foi pausada — nada está gastando. Revise e apague na dashboard se não quiser mantê-la.' : undefined });
      }
      fail(res, err);
    }
  });

  // ── Spark Ads (impulsionar vídeo orgânico) ───────────────────────────�����────
  app.post('/api/ads/boost', dashboardAuth, async (req, res) => {
    try {
      const st = zernio.getState(req.account.id);
      if (!st.accountId) return res.status(409).json({ error: 'Conecte sua conta TikTok Ads primeiro' });
      if (await killSwitchActive(req.account.id)) return res.status(423).json(KILL_SWITCH_BODY);
      const b = req.body || {};
      const adAccountId = String(b.adAccountId || st.advertiserId || '').trim();
      if (!adAccountId || adAccountId === '__all__') return res.status(400).json({ error: 'Selecione um advertiser específico (adAccountId)' });
      const name = String(b.name || '').trim().slice(0, 120);
      if (!name) return res.status(400).json({ error: 'Nome da campanha é obrigatório' });
      const goal = ['engagement', 'traffic', 'awareness', 'video_views', 'lead_generation', 'conversions', 'app_promotion'].includes(b.goal) ? b.goal : '';
      if (!goal) return res.status(400).json({ error: 'Objetivo (goal) inválido' });
      const budgetAmount = Number((b.budget || {}).amount || b.budgetAmount);
      if (!(budgetAmount > 0)) return res.status(400).json({ error: 'Orçamento inválido' });
      const budgetType = ((b.budget || {}).type || b.budgetType) === 'lifetime' ? 'lifetime' : 'daily';

      const payload = {
        accountId: st.accountId,
        adAccountId,
        name,
        goal,
        budget: { amount: budgetAmount, type: budgetType }
      };
      // vídeo próprio (platformPostId) OU de outro criador (sparkAuthCode)
      const platformPostId = String(b.platformPostId || '').trim().slice(0, 60);
      const sparkAuthCode = String(b.sparkAuthCode || '').trim().slice(0, 120);
      if (platformPostId) payload.platformPostId = platformPostId;
      if (sparkAuthCode) payload.sparkAuthCode = sparkAuthCode;
      if (!platformPostId && !sparkAuthCode) {
        return res.status(400).json({ error: 'Informe o ID do vídeo (platformPostId) ou um Spark Code do criador' });
      }
      if (/^https?:\/\//.test(String(b.linkUrl || ''))) payload.linkUrl = withAdsTracking(String(b.linkUrl).trim().slice(0, 500));
      if (/^[A-Z_]{3,30}$/.test(String(b.callToAction || ''))) payload.callToAction = b.callToAction;
      const countries = Array.isArray(b.countries)
        ? b.countries.map((c) => String(c || '').trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)).slice(0, 30) : [];
      if (countries.length) payload.targeting = Object.assign({}, payload.targeting, { countries });

      // dry-run: não impulsiona de verdade.
      if (await isDryRun(req.account.id)) {
        await auditSimulated(req.account.id, {
          action: 'spark_ad_create', targetType: 'campaign', advertiserId: adAccountId,
          metadata: { name, goal }, title: 'Impulsionar Spark Ad ' + name
        });
        return res.status(200).json({ dryRun: true, simulated: true, id: 'dry-run', name });
      }
      const data = await zernio.api('POST', '/ads/boost', { body: payload, timeoutMs: 120000 });
      zernio.cacheBust('tree:' + req.account.id);
      stats.logEvent('info', { acc: req.account.id, title: 'Spark Ad criado: ' + name });
      res.status(201).json(data);
    } catch (err) { fail(res, err); }
  });

  // ── Pausar/ativar campanhas em lote ───────────────────────────────────────
  app.post('/api/ads/campaigns/bulk-status', dashboardAuth, async (req, res) => {
    try {
      if (!pipeboard.enabled) return res.status(409).json({ error: 'Pipeboard não configurado no servidor' });
      const b = req.body || {};
      const status = b.status === 'paused' ? 'paused' : b.status === 'active' ? 'active' : '';
      if (!status) return res.status(400).json({ error: 'status deve ser active ou paused' });
      const ids = (Array.isArray(b.campaigns) ? b.campaigns : []).slice(0, 50)
        .map((c) => String((c || {}).platformCampaignId || '').slice(0, 60)).filter(Boolean);
      if (!ids.length) return res.status(400).json({ error: 'Nenhuma campanha informada' });
      if (await killSwitchActive(req.account.id)) return res.status(423).json(KILL_SWITCH_BODY);
      // advertiser: do corpo (adAccountId) ou o resolvido no token
      const advertiserId = b.adAccountId ? String(b.adAccountId).trim() : await pipeboard.resolveAdvertiserId(req.account.id);
      if (!advertiserId) return res.status(409).json({ error: 'Nenhuma conta de anúncio autorizada no token' });
      // dry-run: não toca o Pipeboard. Mesma forma de resposta ({ totals }).
      if (await isDryRun(req.account.id)) {
        await auditSimulated(req.account.id, {
          action: 'campaign_status', targetType: 'campaign', advertiserId,
          metadata: { status, count: ids.length, campaignIds: ids },
          title: (status === 'paused' ? 'Pausar' : 'Ativar') + ' ' + ids.length + ' campanha(s)'
        });
        return res.json({ dryRun: true, simulated: ids.length, totals: { updated: 0, skipped: ids.length, failed: 0 } });
      }
      await pipeboard.setCampaignStatus(advertiserId, ids, status);
      adsSync.syncAfterWrite(req.account.id, advertiserId); // reflete no espelho
      stats.logEvent('info', { acc: req.account.id, title: 'Campanhas TikTok ' + (status === 'paused' ? 'pausadas' : 'ativadas') + ': ' + ids.length });
      res.json({ ok: true, totals: { updated: ids.length, skipped: 0, failed: 0 } });
    } catch (err) { fail(res, err); }
  });

  // ── Duplicar campanha ─────────────────────────────────────────────────────
  // ADIADO na migração p/ Pipeboard: o provider não expõe uma tool de "duplicar"
  // (o zernio fazia deep-copy nativo). Reconstruir via create_* + re-upload de
  // vídeo é um gate próprio. Até lá, respondemos 501 com mensagem clara — a UI
  // desabilita o botão e mostra este texto.
  app.post('/api/ads/campaigns/:id/duplicate', dashboardAuth, async (req, res) => {
    return res.status(501).json({
      error: 'Duplicar campanha está temporariamente indisponível nesta versão. Crie uma nova campanha manualmente ou aguarde a próxima atualização.',
      code: 'DUPLICATE_UNSUPPORTED',
    });
  });

  // Palavras reservadas de /api/ads/* que as rotas genéricas :adId NÃO podem
  // capturar (Express casa na ordem de registro; alerts/library vêm depois).
  const RESERVED_AD_IDS = new Set(['alerts', 'library', 'roas', 'identity', 'upload', 'status', 'accounts', 'tree', 'campaigns', 'create', 'boost', 'connect', 'connected', 'disconnect', 'attribution', 'rules', 'templates', 'business-centers', 'deeplink', 'bulk', 'duplicate', 'health', 'tickets', 'ops', 'catalogs']);

  // ── Atualizar uma entidade (status/budget) ────────────────────────────────
  // O :adId pode ser campanha, ad group ou anúncio. Classificamos no espelho
  // (Neon) e roteamos ao tool certo do Pipeboard:
  //   - status  → update_tiktok_{campaign|adgroup|ad}_status
  //   - budget  → só campanha/ad group (o TikTok não tem orçamento em anúncio);
  //               se o ID for um anúncio, aplicamos no AD GROUP dono — que é o
  //               que o front pretende (envia o 1º anúncio do grupo).
  app.put('/api/ads/:adId', dashboardAuth, async (req, res, next) => {
    if (RESERVED_AD_IDS.has(String(req.params.adId))) return next();
    try {
      if (!pipeboard.enabled) return res.status(409).json({ error: 'Pipeboard não configurado no servidor' });
      if (await killSwitchActive(req.account.id)) return res.status(423).json(KILL_SWITCH_BODY);
      const b = req.body || {};
      const entityId = String(req.params.adId || '');
      const wantStatus = ['active', 'paused'].includes(b.status) ? b.status : null;
      const wantBudget = b.budget && Number(b.budget.amount) > 0
        ? { amount: Number(b.budget.amount), type: b.budget.type === 'lifetime' ? 'lifetime' : 'daily' } : null;
      if (b.creative && typeof b.creative === 'object') {
        // Edição de criativo depende de re-upload/asset ids no Pipeboard — adiado
        // junto com a duplicação. Não silenciamos: avisamos o front.
        return res.status(501).json({ error: 'Editar o criativo de um anúncio existente está temporariamente indisponível.', code: 'CREATIVE_EDIT_UNSUPPORTED' });
      }
      if (!wantStatus && !wantBudget) return res.status(400).json({ error: 'Nada para atualizar' });

      // classifica no espelho (advertiser resolvido junto)
      const hint = String(b.adAccountId || '').trim() || undefined;
      const ent = await adsCache.classifyEntity(req.account.id, hint, entityId);
      if (!ent) return res.status(404).json({ error: 'Entidade não encontrada no espelho. Atualize a árvore e tente de novo.' });
      const advertiserId = ent.advertiserId;

      // orçamento em anúncio → aplica no ad group dono
      const budgetTarget = wantBudget
        ? (ent.type === 'campaign' ? { kind: 'campaign', id: ent.campaignId } : { kind: 'adgroup', id: ent.type === 'ad' ? ent.adGroupId : ent.adGroupId || entityId })
        : null;
      if (wantBudget && (!budgetTarget || !budgetTarget.id)) {
        return res.status(422).json({ error: 'Não foi possível resolver o ad group/campanha para aplicar o orçamento.' });
      }

      const applied = {};
      if (wantStatus) applied.status = { level: ent.type, id: entityId, value: wantStatus };
      if (wantBudget) applied.budget = { level: budgetTarget.kind, id: budgetTarget.id, amount: wantBudget.amount, type: wantBudget.type };

      // dry-run: nada chega ao TikTok.
      if (await isDryRun(req.account.id)) {
        await auditSimulated(req.account.id, {
          action: 'entity_update', targetType: ent.type, targetId: entityId, advertiserId,
          metadata: { applied }, title: 'Atualizar ' + ent.type + ' ' + entityId
        });
        return res.json({ dryRun: true, simulated: true, id: entityId, applied });
      }

      if (wantStatus) {
        if (ent.type === 'campaign') await pipeboard.setCampaignStatus(advertiserId, [entityId], wantStatus);
        else if (ent.type === 'adgroup') await pipeboard.setAdGroupStatus(advertiserId, [entityId], wantStatus);
        else await pipeboard.setAdStatus(advertiserId, [entityId], wantStatus);
      }
      if (wantBudget) {
        if (budgetTarget.kind === 'campaign') await pipeboard.updateCampaign(advertiserId, budgetTarget.id, { budget: wantBudget });
        else await pipeboard.updateAdGroup(advertiserId, budgetTarget.id, { budget: wantBudget });
      }
      adsSync.syncAfterWrite(req.account.id, advertiserId);
      stats.logEvent('info', { acc: req.account.id, title: 'Entidade TikTok atualizada (' + ent.type + ')', ref: entityId });
      res.json({ ok: true, id: entityId, applied });
    } catch (err) { fail(res, err); }
  });

  // ── Cancelar/excluir um anúncio ───────────────────────────────────────────
  app.delete('/api/ads/:adId', dashboardAuth, async (req, res, next) => {
    if (RESERVED_AD_IDS.has(String(req.params.adId))) return next();
    try {
      if (!pipeboard.enabled) return res.status(409).json({ error: 'Pipeboard não configurado no servidor' });
      if (await killSwitchActive(req.account.id)) return res.status(423).json(KILL_SWITCH_BODY);
      const adId = String(req.params.adId || '');
      const hint = String((req.body || {}).adAccountId || '').trim() || undefined;
      const ent = await adsCache.classifyEntity(req.account.id, hint, adId);
      if (!ent) return res.status(404).json({ error: 'Entidade não encontrada no espelho. Atualize a árvore e tente de novo.' });
      const advertiserId = ent.advertiserId;
      // dry-run: não exclui de verdade.
      if (await isDryRun(req.account.id)) {
        await auditSimulated(req.account.id, {
          action: 'entity_delete', targetType: ent.type, targetId: adId, advertiserId,
          title: 'Excluir ' + ent.type + ' ' + adId
        });
        return res.json({ dryRun: true, simulated: true, id: adId });
      }
      if (ent.type === 'campaign') await pipeboard.setCampaignStatus(advertiserId, [adId], 'deleted');
      else if (ent.type === 'adgroup') await pipeboard.setAdGroupStatus(advertiserId, [adId], 'deleted');
      else await pipeboard.setAdStatus(advertiserId, [adId], 'deleted');
      adsSync.syncAfterWrite(req.account.id, advertiserId);
      stats.logEvent('warn', { acc: req.account.id, title: ent.type + ' TikTok excluído', ref: adId });
      res.json({ ok: true, id: adId });
    } catch (err) { fail(res, err); }
  });

  // ── Brand Identity (nome + avatar exibidos no anúncio) ────────────────────
  app.patch('/api/ads/identity', dashboardAuth, async (req, res) => {
    try {
      const st = zernio.getState(req.account.id);
      if (!st.accountId) return res.status(409).json({ error: 'Conecte sua conta TikTok Ads primeiro' });
      if (await killSwitchActive(req.account.id)) return res.status(423).json(KILL_SWITCH_BODY);
      const displayName = String((req.body || {}).displayName || '').trim().slice(0, 100);
      const imageUrl = String((req.body || {}).imageUrl || '').trim().slice(0, 500);
      if (!displayName) return res.status(400).json({ error: 'Nome da marca é obrigatório' });
      if (!/^https:\/\//.test(imageUrl)) return res.status(400).json({ error: 'URL da imagem (quadrada, ≥98×98, JPG/PNG) é obrigatória' });
      const data = await zernio.api('PATCH', '/connect/tiktok-ads', {
        body: { accountId: st.accountId, displayName, imageUrl },
        timeoutMs: 60000
      });
      zernio.setState(req.account.id, { identity: { identityId: data.identityId || '', displayName, imageUrl } });
      stats.logEvent('info', { acc: req.account.id, title: 'Brand Identity TikTok configurada: ' + displayName });
      res.json({ ok: true, identityId: data.identityId || '', displayName, imageUrl });
    } catch (err) { fail(res, err); }
  });

  // ── Upload de criativo → Vercel Blob (retorna URL pública p/ a Zernio) ────
  // O corpo é o binário puro (express.raw), com metadados via querystring.
  app.post('/api/ads/upload', dashboardAuth, require('express').raw({ type: '*/*', limit: '500mb' }), async (req, res) => {
    try {
      if (!process.env.BLOB_READ_WRITE_TOKEN) return res.status(503).json({ error: 'Armazenamento (Vercel Blob) não configurado' });
      const kind = req.query.kind === 'image' ? 'image' : 'video';
      const rawName = String(req.query.filename || (kind === 'image' ? 'avatar.png' : 'criativo.mp4'));
      const safe = rawName.toLowerCase().replace(/[^a-z0-9._-]/g, '-').slice(0, 80);
      const okExt = kind === 'image' ? /\.(png|jpe?g)$/ : /\.(mp4|mov)$/;
      if (!okExt.test(safe)) {
        return res.status(400).json({ error: kind === 'image' ? 'Envie PNG ou JPG' : 'Envie MP4 ou MOV' });
      }
      if (!req.body || !req.body.length) return res.status(400).json({ error: 'Arquivo vazio' });
      const max = kind === 'image' ? 5 * 1024 * 1024 : 500 * 1024 * 1024;
      if (req.body.length > max) return res.status(413).json({ error: 'Arquivo excede o limite de ' + (kind === 'image' ? '5 MB' : '500 MB') });
      const { put } = require('@vercel/blob');
      // access public: a Zernio (e o TikTok) precisam BAIXAR o arquivo pela URL
      const blob = await put('tiktok-ads/' + req.account.id + '/' + Date.now().toString(36) + '-' + safe, req.body, {
        access: 'public',
        contentType: kind === 'image' ? (safe.endsWith('.png') ? 'image/png' : 'image/jpeg') : 'video/mp4'
      });
      res.json({ ok: true, url: blob.url });
    } catch (err) { fail(res, err); }
  });

  // ── KPIs agregados com comparação de período ────────────────────────────────
  // Totais do range pedido + o range ANTERIOR de mesmo tamanho, direto do
  // espelho Neon (2 SUMs — zero chamadas à Pipeboard). Deltas em % ficam null
  // quando a base é 0 (a UI oculta a seta em vez de mostrar "+Infinity%").
  app.get('/api/ads/kpis', dashboardAuth, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const q = req.query || {};
      let advertiserId;
      if (q.adAccountId) {
        advertiserId = (await requireAdvertiser(req.account.id, null, q.adAccountId, null)).advertiserId;
      } else {
        advertiserId = await pipeboard.resolveAdvertiserId(req.account.id);
        if (!advertiserId) return res.status(409).json({ error: 'Nenhuma conta de anúncio autorizada no token' });
      }
      if (!adsCache.enabled) return res.json({ current: null, previous: null, deltas: null });

      const iso = (d) => d.toISOString().slice(0, 10);
      const today = new Date();
      const toDate = /^\d{4}-\d{2}-\d{2}$/.test(String(q.toDate || '')) ? q.toDate : iso(today);
      const fromDate = /^\d{4}-\d{2}-\d{2}$/.test(String(q.fromDate || ''))
        ? q.fromDate
        : iso(new Date(today.getTime() - 6 * 864e5));
      // período anterior: mesma duração, terminando 1 dia antes do início atual
      const spanMs = new Date(toDate + 'T00:00:00Z').getTime() - new Date(fromDate + 'T00:00:00Z').getTime();
      const prevTo = iso(new Date(new Date(fromDate + 'T00:00:00Z').getTime() - 864e5));
      const prevFrom = iso(new Date(new Date(prevTo + 'T00:00:00Z').getTime() - spanMs));

      const [current, previous] = await Promise.all([
        adsCache.readAdvertiserTotals(req.account.id, advertiserId, fromDate, toDate),
        adsCache.readAdvertiserTotals(req.account.id, advertiserId, prevFrom, prevTo),
      ]);
      const derive = (t) => t && {
        ...t,
        ctr: t.impressions > 0 ? (t.clicks / t.impressions) * 100 : 0,
        cpm: t.impressions > 0 ? (t.spend / t.impressions) * 1000 : 0,
      };
      const cur = derive(current);
      const prev = derive(previous);
      const pct = (c, p) => (p > 0 ? +(((c - p) / p) * 100).toFixed(1) : null);
      const deltas = cur && prev ? {
        spend: pct(cur.spend, prev.spend),
        impressions: pct(cur.impressions, prev.impressions),
        clicks: pct(cur.clicks, prev.clicks),
        conversions: pct(cur.conversions, prev.conversions),
        ctr: pct(cur.ctr, prev.ctr),
        cpm: pct(cur.cpm, prev.cpm),
      } : null;
      res.json({ fromDate, toDate, prevFrom, prevTo, current: cur, previous: prev, deltas });
    } catch (err) { fail(res, err); }
  });

  // ── ROAS/CPA — cruza o gasto do TikTok com as VENDAS REAIS dos gateways ───
  // Gasto: /ads/tree com timeIncrement=1 (série diária somada entre campanhas).
  // Receita: leads convertidos (stage=purchased) da pr��pria conta no período —
  // a mesma fonte da aba Visão Geral, então os números batem entre abas.
  app.get('/api/ads/roas', dashboardAuth, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      if (!pipeboard.enabled) return res.status(409).json({ error: 'Pipeboard não configurado no servidor' });
      const q = req.query || {};
      let advertiserId;
      if (q.adAccountId) {
        advertiserId = (await requireAdvertiser(req.account.id, null, q.adAccountId, null)).advertiserId;
      } else {
        advertiserId = await pipeboard.resolveAdvertiserId(req.account.id);
        if (!advertiserId) return res.status(409).json({ error: 'Nenhuma conta de anúncio autorizada no token' });
      }
      const today = new Date();
      const defFrom = new Date(today.getTime() - 6 * 864e5);
      const iso = (d) => d.toISOString().slice(0, 10);
      const fromDate = /^\d{4}-\d{2}-\d{2}$/.test(String(q.fromDate || '')) ? q.fromDate : iso(defFrom);
      const toDate = /^\d{4}-\d{2}-\d{2}$/.test(String(q.toDate || '')) ? q.toDate : iso(today);

      // 1) Gasto do TikTok por DIA — do espelho no Neon (instantâneo). A receita
      // vem do stats interno, então a leitura local do gasto é agregada aqui.
      const spendByDay = {}; // 'YYYY-MM-DD' → gasto (moeda do advertiser)
      let spend = 0, conversions = 0, currency = null;
      if (adsCache.enabled) {
        await adsSync.ensureFresh(req.account.id, advertiserId).catch(() => {});
        const d = await adsCache.readAdvertiserDaily(req.account.id, advertiserId, fromDate, toDate);
        Object.assign(spendByDay, d.spendByDay);
        spend = d.spend; conversions = d.conversions; currency = d.currency;
      } else {
        // Fallback ao vivo (Neon indisponível).
        const advInfo = await pipeboard.getAdvertiserInfo(advertiserId).catch(() => null);
        currency = (advInfo && advInfo.currency) || null;
        const ins = await pipeboard.getInsights(advertiserId, {
          level: 'AUCTION_ADVERTISER', startDate: fromDate, endDate: toDate, dimensions: ['stat_time_day'],
        });
        (ins.rows || []).forEach((r) => {
          const day = String((r.dimensions || {}).stat_time_day || '').slice(0, 10);
          spend += r.spend || 0;
          conversions += r.conversions || 0;
          if (/^\d{4}-\d{2}-\d{2}$/.test(day)) spendByDay[day] = (spendByDay[day] || 0) + (r.spend || 0);
        });
      }

      // 2) Vendas reais da conta no mesmo intervalo (fonte: stats/leads)
      const revByDay = {}; const salesByDay = {};
      let revenueCents = 0, sales = 0;
      if (typeof stats.getStats === 'function') {
        const snap = stats.getStats(req.account.id) || {};
        (snap.leads || []).forEach((l) => {
          if (l.stage !== 'purchased' || !l.convertedAt) return;
          const day = String(l.convertedAt).slice(0, 10);
          if (day < fromDate || day > toDate) return;
          const cents = Number(l.reportedAmount) || 0;
          revenueCents += cents; sales += 1;
          revByDay[day] = (revByDay[day] || 0) + cents;
          salesByDay[day] = (salesByDay[day] || 0) + 1;
        });
      }

      // 3) Série contínua dia a dia (mesmo sem dado — o gráfico não pula datas)
      const daily = [];
      for (let t = new Date(fromDate + 'T00:00:00Z'); iso(t) <= toDate; t = new Date(t.getTime() + 864e5)) {
        const day = iso(t);
        daily.push({
          date: day,
          spend: +(spendByDay[day] || 0).toFixed(2),
          revenueCents: revByDay[day] || 0,
          sales: salesByDay[day] || 0
        });
      }

      const revenue = revenueCents / 100;
      const out = {
        fromDate, toDate, currency: currency || 'EUR',
        spend: +spend.toFixed(2), conversions,
        revenueCents, sales,
        roas: spend > 0 ? +(revenue / spend).toFixed(2) : null,
        cpa: sales > 0 && spend > 0 ? +(spend / sales).toFixed(2) : null,
        daily
      };
      res.json(out);
    } catch (err) { fail(res, err); }
  });

  // ── Biblioteca de criativos — vídeos já enviados ao Vercel Blob ��───────��───
  app.get('/api/ads/library', dashboardAuth, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      if (!process.env.BLOB_READ_WRITE_TOKEN) return res.json({ items: [] });
      const { list } = require('@vercel/blob');
      // prefixo POR CONTA: uma conta nunca enxerga criativos da outra
      const { blobs } = await list({ prefix: 'tiktok-ads/' + req.account.id + '/', limit: 200 });
      const items = (blobs || [])
        .filter((b) => /\.(mp4|mov)$/i.test(b.pathname))
        .sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0))
        .map((b) => ({
          url: b.url,
          name: b.pathname.split('/').pop().replace(/^[a-z0-9]+-/, ''),
          size: b.size || 0,
          uploadedAt: b.uploadedAt || null
        }));
      res.json({ items });
    } catch (err) { fail(res, err); }
  });

  app.delete('/api/ads/library', dashboardAuth, async (req, res) => {
    try {
      const url = String((req.query || {}).url || '');
      // só deleta blobs DO PRÓPRIO diretório da conta (o path é verificável na URL)
      if (!url.includes('/tiktok-ads/' + req.account.id + '/')) {
        return res.status(403).json({ error: 'Criativo não pertence a esta conta' });
      }
      const { del } = require('@vercel/blob');
      await del(url);
      res.json({ ok: true });
    } catch (err) { fail(res, err); }
  });

  // ── Alertas + regras + dayparting — motor extraído para ads-automation.js ──
  // O motor roda 24/7 no tick do ads-sync (dashboard fechada = automações vivas)
  // E pega carona no polling das rotas (latência percebida menor). O throttle é
  // ÚNICO, dentro do módulo — dois gatilhos nunca causam varredura dupla.
  automation.init({ stats, syncAfterWrite: adsSync.syncAfterWrite });
  adsSweepHook.fn = automation.maybeSweep;

  // ── IA (copiloto/briefing/criativos/realocação) ─────────────────────────────
  // ads-ai.js NUNCA toca a Pipeboard: leituras vêm do espelho Neon + atribuição
  // local (injetadas aqui). Mutações só via /copilot/execute, que reusa os
  // MESMOS caminhos das ações manuais (dry-run, auditoria, syncAfterWrite).
  adsAi.init({
    cache: adsCache,
    computeAttribution: automation.computeAttribution,
    getRules: automation.getRules,
    getRulesLog: automation.getRulesLog,
    sendPushcut: require('./pushcut').sendPushcut,
  });

  const AI_OFF = { error: 'IA não configurada no servidor (AI_GATEWAY_API_KEY ausente)', code: 'AI_NOT_CONFIGURED' };

  // Resolve o advertiser (query/body opcional) sem duplicar lógica.
  async function resolveAdv(req, hint) {
    if (hint) return (await requireAdvertiser(req.account.id, null, hint, null)).advertiserId;
    const id = await pipeboard.resolveAdvertiserId(req.account.id);
    if (!id) { const e = new Error('Nenhuma conta de anúncio autorizada no token'); e.status = 409; throw e; }
    return id;
  }

  // Chat do copiloto — resposta em SSE (text/event-stream).
  app.post('/api/ads/copilot', dashboardAuth, async (req, res) => {
    if (!adsAi.enabled()) return res.status(503).json(AI_OFF);
    try {
      const b = req.body || {};
      const message = String(b.message || '').trim();
      if (!message) return res.status(400).json({ error: 'Mensagem vazia' });
      const advertiserId = await resolveAdv(req, String(b.adAccountId || '').trim());
      const currency = String(b.currency || 'USD').slice(0, 5);

      res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.flushHeaders();
      const write = (ev) => { try { res.write('data: ' + JSON.stringify(ev) + '\n\n'); } catch (_) { /* cliente desconectou */ } };
      await adsAi.copilotTurn({
        accId: req.account.id,
        advertiserId,
        currency,
        sessionId: String(b.sessionId || '').slice(0, 60) || req.account.id,
        message,
        write,
      });
      res.end();
    } catch (err) {
      if (!res.headersSent) return fail(res, err);
      try { res.write('data: ' + JSON.stringify({ type: 'error', error: String(err.message || err) }) + '\n\n'); res.end(); } catch (_) {}
    }
  });

  // Executa uma proposta APROVADA pelo usuário. Valida schema + IDs contra o
  // espelho e delega para os mesmos primitivos das ações manuais.
  app.post('/api/ads/copilot/execute', dashboardAuth, async (req, res) => {
    try {
      if (!pipeboard.enabled) return res.status(409).json({ error: 'Pipeboard não configurado no servidor' });
      const b = req.body || {};
      const action = b.action || {};
      const advertiserId = await resolveAdv(req, String(b.adAccountId || '').trim());

      // IDs conhecidos do espelho — proposta com ID alucinado morre aqui (400).
      const tree = await adsCache.readTree(req.account.id, advertiserId, {});
      const knownIds = new Set(((tree && tree.campaigns) || []).map((c) => String(c.platformCampaignId)));
      const v = adsAi.validateProposedAction(action, knownIds);
      if (!v.ok) return res.status(400).json({ error: 'Proposta inválida: ' + v.error });

      // Kill switch bloqueia escritas na plataforma (pause/activate/budget), mas
      // NÃO impede criar uma regra (create_rule é só config; regras já respeitam
      // o kill switch na hora de agir, no motor).
      if (action.type !== 'create_rule' && await killSwitchActive(req.account.id)) return res.status(423).json(KILL_SWITCH_BODY);

      if (action.type === 'pause' || action.type === 'activate') {
        const status = action.type === 'pause' ? 'paused' : 'active';
        const ids = v.params.campaignIds;
        if (await isDryRun(req.account.id)) {
          await auditSimulated(req.account.id, {
            action: 'campaign_status', targetType: 'campaign', advertiserId,
            metadata: { status, count: ids.length, campaignIds: ids, via: 'copilot' },
            title: '[Copiloto] ' + (status === 'paused' ? 'Pausar' : 'Ativar') + ' ' + ids.length + ' campanha(s)',
          });
          return res.json({ dryRun: true, simulated: ids.length });
        }
        await pipeboard.setCampaignStatus(advertiserId, ids, status);
        adsSync.syncAfterWrite(req.account.id, advertiserId);
        stats.logEvent('info', { acc: req.account.id, title: '[Copiloto] Campanhas ' + (status === 'paused' ? 'pausadas' : 'ativadas') + ': ' + ids.length });
        return res.json({ ok: true, updated: ids.length });
      }

      if (action.type === 'budget') {
        const { campaignId, budget } = v.params;
        if (await isDryRun(req.account.id)) {
          await auditSimulated(req.account.id, {
            action: 'entity_update', targetType: 'campaign', targetId: campaignId, advertiserId,
            metadata: { applied: { budget: { level: 'campaign', id: campaignId, amount: budget, type: 'daily' } }, via: 'copilot' },
            title: '[Copiloto] Orçamento da campanha ' + campaignId + ' → ' + budget,
          });
          return res.json({ dryRun: true, simulated: true });
        }
        await pipeboard.updateCampaign(advertiserId, campaignId, { budget: { amount: budget, type: 'daily' } });
        adsSync.syncAfterWrite(req.account.id, advertiserId);
        stats.logEvent('info', { acc: req.account.id, title: '[Copiloto] Orçamento atualizado', ref: campaignId });
        return res.json({ ok: true });
      }

      if (action.type === 'create_rule') {
        // validateRules aplica clamps/drop de regra inválida — mesma via do PUT.
        const current = automation.getRules(req.account.id);
        const merged = automation.validateRules(current.concat([Object.assign({ enabled: true }, v.params.rule)]));
        if (merged.length === current.length) return res.status(400).json({ error: 'Regra proposta é inválida (rejeitada pela validação do motor)' });
        pipeboard.setState(req.account.id, { rules: merged });
        stats.logEvent('info', { acc: req.account.id, title: '[Copiloto] Regra de automação criada' });
        return res.json({ ok: true, rules: merged });
      }

      return res.status(400).json({ error: 'Tipo de ação não suportado' });
    } catch (err) { fail(res, err); }
  });

  // Briefing de hoje + histórico 7d (gerado 1×/dia pelo tick do ads-sync).
  app.get('/api/ads/briefing', dashboardAuth, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const briefings = await adsCache.listBriefings(req.account.id, 'daily', 7);
      res.json({ ai: adsAi.enabled(), briefings });
    } catch (err) { fail(res, err); }
  });

  // Gerar briefing agora (botão na UI) — sobrescreve o de hoje (PK account+date).
  app.post('/api/ads/briefing/run', dashboardAuth, async (req, res) => {
    if (!adsAi.enabled()) return res.status(503).json(AI_OFF);
    try {
      const advertiserId = await resolveAdv(req, String((req.body || {}).adAccountId || '').trim());
      const out = await adsAi.generateDailyBriefing(req.account.id, advertiserId, String((req.body || {}).currency || 'USD').slice(0, 5));
      res.json(out);
    } catch (err) { fail(res, err); }
  });

  // Análise de criativos (cache 24h; ?force=1 regenera).
  app.get('/api/ads/creatives/insights', dashboardAuth, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const advertiserId = await resolveAdv(req, String((req.query || {}).adAccountId || '').trim());
      const out = await adsAi.creativeInsights(req.account.id, advertiserId, { force: String((req.query || {}).force || '') === '1' });
      if (out && out.error === 'AI_NOT_CONFIGURED') return res.status(503).json(AI_OFF);
      res.json(out);
    } catch (err) { fail(res, err); }
  });

  // Proposta de realocação de orçamento (determinística + rationale da IA).
  app.get('/api/ads/budget/proposal', dashboardAuth, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const q = req.query || {};
      const advertiserId = await resolveAdv(req, String(q.adAccountId || '').trim());
      const out = await adsAi.budgetProposal(req.account.id, advertiserId, String(q.currency || 'USD').slice(0, 5));
      res.json(out);
    } catch (err) { fail(res, err); }
  });

  app.get('/api/ads/alerts', dashboardAuth, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(automation.getAlertCfg(req.account.id));
  });

  app.put('/api/ads/alerts', dashboardAuth, (req, res) => {
    try {
      const b = req.body || {};
      const cfg = {
        enabled: !!b.enabled,
        spendNoConv: Math.max(0, Math.min(100000, Number(b.spendNoConv) || 0)),
        cpaMax: Math.max(0, Math.min(100000, Number(b.cpaMax) || 0)),
        lookbackDays: Math.max(1, Math.min(30, parseInt(b.lookbackDays, 10) || 2))
      };
      pipeboard.setState(req.account.id, { alerts: cfg });
      res.json(cfg);
    } catch (err) { fail(res, err); }
  });

  // “verificar agora” — roda a varredura na hora e devolve o que encontrou
  app.post('/api/ads/alerts/check', dashboardAuth, async (req, res) => {
    try {
      automation.markSweepNow(req.account.id);
      const result = await automation.runAlertSweep(req.account.id, { force: true });
      res.json(result);
    } catch (err) { fail(res, err); }
  });

  // ── Atribuição por campanha ─────────────────────────────────────────────────
  // Os anúncios criados aqui saem com utm_campaign=__CAMPAIGN_ID__ (macro que
  // o TikTok troca pelo ID real). O /api/track grava utm.campaign no lead, e
  // este endpoint casa os leads COMPRADOS com o platformCampaignId — dando
  // receita, vendas e ROAS POR CAMPANHA. A lógica vive em ads-automation.js
  // (as regras roas_min/roas_scale usam a mesma atribuição).
  const computeAttribution = automation.computeAttribution;

  app.get('/api/ads/attribution', dashboardAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
  if (!pipeboard.enabled) return res.status(409).json({ error: 'Pipeboard não configurado no servidor' });
  const q = req.query || {};
  // valida a conta selecionada (a receita vem do stats interno; a validação
  // só garante que o advertiser é autorizado). Sem adAccountId, resolve o padrão.
  if (q.adAccountId) await requireAdvertiser(req.account.id, null, q.adAccountId, null);
  const iso = (d) => d.toISOString().slice(0, 10);
  const today = new Date();
  const fromDate = /^\d{4}-\d{2}-\d{2}$/.test(String(q.fromDate || '')) ? q.fromDate : iso(new Date(today.getTime() - 6 * 864e5));
  const toDate = /^\d{4}-\d{2}-\d{2}$/.test(String(q.toDate || '')) ? q.toDate : iso(today);
  const data = computeAttribution(req.account.id, fromDate, toDate);
  res.json({ fromDate, toDate, byCampaign: data.byCampaign, unattributed: data.unattributed });
  } catch (err) { fail(res, err); }
  });

  // ── Regras automáticas — motor em ads-automation.js ────────��───────────────
  // Métricas: cpa_max | spend_no_conv | roas_min | ctr_min | cpm_max |
  // roas_scale (escala vencedoras com teto) | schedule (dayparting).
  // As rotas abaixo só delegam; a varredura 24/7 roda no tick do ads-sync.

  // ── Saúde das contas + tickets de desbanimento (semi-automático) ──────────
  // O TikTok NÃO tem API de appeal de conta: a automação detecta o banimento
  // (transição de status no snapshot Neon), abre um ticket interno com texto
  // de recurso pré-gerado e link pro formulário oficial — o envio é manual.
  const APPEAL_URL = 'https://www.tiktok.com/business/en/apply/business-ads-appeal';
  const healthLastRun = new Map(); // accId → timestamp da última varredura

  function buildAppealText(ticket) {
    const name = ticket.advertiserName || ticket.advertiserId;
    const date = new Date().toLocaleDateString('pt-BR');
    return 'Prezada equipe do TikTok for Business,\n\n'
      + 'Solicito a revisão da suspensão da conta de an��ncios "' + name + '" (ID: ' + ticket.advertiserId + '), detectada em ' + date + '.\n\n'
      + 'Acredito que a suspensão tenha sido aplicada por engano. Nossa conta segue as Políticas de Publicidade do TikTok: os criativos divulgam produtos/serviços legítimos, as páginas de destino correspondem ao conteúdo anunciado e não utilizamos práticas enganosas.\n\n'
      + 'Estamos à disposição para fornecer qualquer documentação adicional que comprove a conformidade da conta (informações do negócio, notas fiscais, comprovantes de entrega).\n\n'
      + 'Solicito, por gentileza, a reativação da conta ou um detalhamento específico da violação identificada para que possamos corrigi-la imediatamente.\n\n'
      + 'Atenciosamente.';
  }

  // Varredura de saúde: snapshot dos advertisers → transições → automação.
  // banned: cria ticket (idempotente) + alerta. approved: resolve tickets.
  async function runHealthSweep(accId) {
    if (!pipeboard.enabled || !adsOps.enabled) return { health: [], transitions: [] };
    // varre TODAS as contas do token: banimento em qualquer uma deve ser visto
    const advertisers = await listAdvertisers(accId, null, '');
    const snapshot = advertisers.map((a) => ({
      advertiserId: String(a.id || a._id || ''),
      name: a.name || a.advertiserName || '',
      rawStatus: a.rawStatus,
      statusReason: a.statusReason || a.rejectReason || ''
    }));
    const transitions = await adsOps.upsertAccountHealth(accId, snapshot);
    for (const t of transitions) {
      if (t.to === 'banned') {
        const ticket = await adsOps.createUnbanTicketIfAbsent(accId, {
          advertiserId: t.advertiserId, advertiserName: t.advertiserName,
          appealText: buildAppealText({ advertiserId: t.advertiserId, advertiserName: t.advertiserName }),
          appealUrl: APPEAL_URL
        });
        await adsOps.appendAuditEvent(accId, { actorType: 'system', action: 'account_health.banned', targetType: 'advertiser', targetId: t.advertiserId, advertiserId: t.advertiserId, reason: 'Transição ' + t.from + ' → banned detectada', metadata: { ticketId: ticket ? ticket.id : null } });
        stats.logEvent('error', { acc: accId, title: '[tiktok-ads] Conta "' + (t.advertiserName || t.advertiserId) + '" foi banida — ticket de desbanimento ' + (ticket ? 'criado' : 'já existente') });
      } else if (t.to === 'approved' && t.from === 'banned') {
        const resolved = await adsOps.resolveTicketsForAdvertiser(accId, t.advertiserId);
        await adsOps.appendAuditEvent(accId, { actorType: 'system', action: 'account_health.reactivated', targetType: 'advertiser', targetId: t.advertiserId, advertiserId: t.advertiserId, reason: 'Conta reativada', metadata: { resolvedTickets: resolved.length } });
        stats.logEvent('info', { acc: accId, title: '[tiktok-ads] Conta "' + (t.advertiserName || t.advertiserId) + '" foi reativada' + (resolved.length ? ' — ' + resolved.length + ' ticket(s) resolvido(s)' : '') });
      }
    }
    return { health: await adsOps.listAccountHealth(accId), transitions };
  }

  // pega carona na mesma varredura oportunista (throttle 30min por conta)
  const prevHealthSweep = adsSweepHook.fn;
  adsSweepHook.fn = function (accId) {
    if (prevHealthSweep) prevHealthSweep(accId);
    try {
      if (!accId) return;
      const last = healthLastRun.get(accId) || 0;
      if (Date.now() - last > 30 * 60e3) {
        healthLastRun.set(accId, Date.now());
        runHealthSweep(accId).catch(() => {});
      }
    } catch (_) { /* nunca bloqueia a rota */ }
  };

  // Painel "Saúde das contas": responde LENDO só o estado já persistido no
  // Neon (barato, sem tocar na Zernio). A varredura fresca (runHealthSweep,
  // que chama a Zernio + faz upserts) roda FORA do caminho da resposta via
  // adsSweepHook.fn, com throttle de 30min por conta — a rota nunca a aguarda.
  // Antes, o sweep inline segurava a conexão por segundos a cada poll de 12s,
  // estourando o limite de 6 conexões do navegador e enfileirando o /tree.
  app.get('/api/ads/health', dashboardAuth, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      if (!pipeboard.enabled) return res.status(409).json({ error: 'Pipeboard não configurado no servidor' });
      if (adsSweepHook.fn) adsSweepHook.fn(req.account.id); // varredura pega carona (throttled, sem await)
      const [health, tickets] = await Promise.all([
        adsOps.listAccountHealth(req.account.id),
        adsOps.listUnbanTickets(req.account.id),
      ]);
      res.json({ enabled: adsOps.enabled, health, tickets, appealUrl: APPEAL_URL });
    } catch (err) { fail(res, err); }
  });

  app.get('/api/ads/tickets', dashboardAuth, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      res.json({ enabled: adsOps.enabled, tickets: await adsOps.listUnbanTickets(req.account.id, req.query.limit) });
    } catch (err) { fail(res, err); }
  });

  app.patch('/api/ads/tickets/:ticketId', dashboardAuth, async (req, res) => {
    try {
      const b = req.body || {};
      const patch = {};
      if (b.status && ['submitted', 'dismissed', 'resolved', 'open'].includes(b.status)) patch.status = b.status;
      if (typeof b.appealText === 'string') patch.appealText = b.appealText;
      if (typeof b.notes === 'string') patch.notes = b.notes;
      const ticket = await adsOps.updateUnbanTicket(req.account.id, req.params.ticketId, patch);
      if (!ticket) return res.status(404).json({ error: 'Ticket não encontrado' });
      await adsOps.appendAuditEvent(req.account.id, { actorType: 'user', actorId: req.account.id, action: 'unban_ticket.updated', targetType: 'unban_ticket', targetId: ticket.id, advertiserId: ticket.advertiser_id, reason: patch.status ? 'Status → ' + patch.status : 'Texto/notas editados' });
      res.json({ ticket });
    } catch (err) { fail(res, err); }
  });

  // Regenera o texto do recurso a partir do template (descarta edições)
  app.post('/api/ads/tickets/:ticketId/regenerate', dashboardAuth, async (req, res) => {
    try {
      const tickets = await adsOps.listUnbanTickets(req.account.id);
      const existing = tickets.find((t) => t.id === req.params.ticketId);
      if (!existing) return res.status(404).json({ error: 'Ticket não encontrado' });
      const ticket = await adsOps.updateUnbanTicket(req.account.id, existing.id, {
        appealText: buildAppealText({ advertiserId: existing.advertiser_id, advertiserName: existing.advertiser_name })
      });
      res.json({ ticket });
    } catch (err) { fail(res, err); }
  });

  app.get('/api/ads/rules', dashboardAuth, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ rules: automation.getRules(req.account.id), log: automation.getRulesLog(req.account.id) });
  });

  app.put('/api/ads/rules', dashboardAuth, (req, res) => {
    try {
      // validação/clamps (inclusive dos campos novos) centralizada no motor
      const rules = automation.validateRules((req.body || {}).rules);
      pipeboard.setState(req.account.id, { rules });
      res.json({ rules, log: automation.getRulesLog(req.account.id) });
    } catch (err) { fail(res, err); }
  });

  app.post('/api/ads/rules/run', dashboardAuth, async (req, res) => {
    try {
      automation.markSweepNow(req.account.id);
      const [rules, schedule] = await Promise.all([
        automation.runRulesSweep(req.account.id, { force: true }),
        automation.runScheduleSweep(req.account.id, { force: true }),
      ]);
      res.json({
        executed: [...(rules.executed || []), ...(schedule.executed || [])],
        checkedAt: rules.checkedAt || schedule.checkedAt || new Date().toISOString(),
      });
    } catch (err) { fail(res, err); }
  });

  // ── Templates de campanha ──────────────────���─��─────���───────────────────────
  // Guarda a CONFIGURAÇÃO (objetivo, orçamento, público, CTA, link, pixel…) —
  // nunca o vídeo. Criar do template = wizard pré-preenchido, só troca o vídeo.
  app.get('/api/ads/templates', dashboardAuth, (req, res) => {
    res.set('Cache-Control', 'no-store');
    const st = pipeboard.getState(req.account.id);
    res.json({ items: Array.isArray(st.templates) ? st.templates : [] });
  });

  app.post('/api/ads/templates', dashboardAuth, (req, res) => {
    try {
      const b = req.body || {};
      const name = String(b.name || '').trim().slice(0, 60);
      if (!name) return res.status(400).json({ error: 'Nome do template é obrigatório' });
      const p = (b.payload && typeof b.payload === 'object') ? b.payload : {};
      // whitelist estrita — nada além da config do wizard entra no template
      const payload = {};
      if (typeof p.goal === 'string') payload.goal = p.goal.slice(0, 30);
      if (Number(p.budgetAmount) > 0) payload.budgetAmount = Number(p.budgetAmount);
      if (['daily', 'lifetime'].includes(p.budgetType)) payload.budgetType = p.budgetType;
      if (typeof p.body === 'string') payload.body = p.body.slice(0, 100);
      if (typeof p.linkUrl === 'string') payload.linkUrl = p.linkUrl.slice(0, 500);
      if (typeof p.callToAction === 'string') payload.callToAction = p.callToAction.slice(0, 30);
      if (Array.isArray(p.countries)) payload.countries = p.countries.slice(0, 30);
      if (Array.isArray(p.languages)) payload.languages = p.languages.slice(0, 10);
      if (p.ageMin) payload.ageMin = parseInt(p.ageMin, 10) || undefined;
      if (p.ageMax) payload.ageMax = parseInt(p.ageMax, 10) || undefined;
      if (typeof p.pixelId === 'string') payload.pixelId = p.pixelId.slice(0, 30);
      if (typeof p.customEventType === 'string') payload.customEventType = p.customEventType.slice(0, 40);
      if (typeof p.identityType === 'string') payload.identityType = p.identityType.slice(0, 30);

      const st = pipeboard.getState(req.account.id);
      const items = Array.isArray(st.templates) ? st.templates.slice(0, 19) : [];
      const item = { id: 't' + Date.now().toString(36), name, payload, createdAt: new Date().toISOString() };
      pipeboard.setState(req.account.id, { templates: [item, ...items] });
      res.status(201).json(item);
    } catch (err) { fail(res, err); }
  });

  app.delete('/api/ads/templates', dashboardAuth, (req, res) => {
    try {
      const id = String((req.query || {}).id || '');
      const st = pipeboard.getState(req.account.id);
      const items = (Array.isArray(st.templates) ? st.templates : []).filter((t) => t.id !== id);
      pipeboard.setState(req.account.id, { templates: items });
      res.json({ ok: true });
    } catch (err) { fail(res, err); }
  });

  // ── Bulk upload — subir N anúncios numa fila durável com progresso ────────
  // O TikTok NÃO tem bulk nativo de criação: o backend enfileira N criações
  // individuais (padrão enqueue/reserve/ack/reclaim do redis.js, ver
  // ads-bulk.js) e processa UMA POR VEZ com backoff — respeitando o rate
  // limit da Zernio. A UI faz polling em GET /api/ads/bulk/:jobId.
  const bulk = require('./ads-bulk');

  // Processador de UM item da fila. Tipos de task:
  //   create          — criação individual (payload já validado no POST /bulk)
  //   duplicate_same  — duplica campanha na MESMA conta (endpoint da Zernio)
  //   duplicate_cross — duplica para OUTRA conta (reconstrói + /ads/create)
  async function processBulkItem(env) {
    const task = env.task || {};
    if (task.kind === 'create') {
      // F2: composição via Pipeboard com RETOMADA IDEMPOTENTE. O MCP não tem
      // Idempotency-Key e a fila é at-least-once, então a garantia vem de:
      // 1) progresso por item gravado no Neon após CADA passo (onProgress);
      // 2) no retry/reclaim, resume pula os passos já feitos;
      // 3) cinto extra dedupeByName p/ a janela crash-antes-de-gravar.
      // Critério de aceitação da F2: matar o processo no meio de um job e
      // reiniciar NÃO pode duplicar campanha.
      const p = task.payload || {};
      const resume = await adsOps.getBulkProgress(env.accountId, env.jobId, env.idx);
      const result = await pipeboard.createFullAd(p.adAccountId, {
        name: p.name, goal: p.goal, videoUrl: p.imageUrl,
        budgetAmount: p.budgetAmount, budgetType: p.budgetType, endDate: p.endDate,
        body: p.body, linkUrl: p.linkUrl, callToAction: p.callToAction,
        countries: p.countries, languages: p.languages,
        ageMin: p.ageMin, ageMax: p.ageMax, promotedObject: p.promotedObject,
        status: 'paused',
      }, {
        resume,
        dedupeByName: true,
        onProgress: (ids) => adsOps.saveBulkProgress(env.accountId, env.jobId, env.idx, ids),
      });
      await adsOps.appendAuditEvent(env.accountId, {
        actorType: 'user', actorId: env.accountId, action: 'bulk_create_item',
        targetType: 'campaign', targetId: result.campaignId, advertiserId: p.adAccountId,
        jobId: env.jobId,
        afterState: { campaignId: result.campaignId, adGroupId: result.adGroupId, adId: result.adId },
        reason: 'Bulk item ' + env.idx + ' do job ' + env.jobId,
      }).catch(() => {});
      pipeboard.cacheBust('tree:');
      return { resultId: result.campaignId || null };
    }
    if (task.kind === 'duplicate_same') {
      const id = encodeURIComponent(String(task.sourceId || ''));
      const data = await zernio.api('POST', '/ads/campaigns/' + id + '/duplicate', {
        body: {
          platform: 'tiktok', deepCopy: true, statusOption: 'PAUSED',
          renameStrategy: 'ONLY_TOP_LEVEL_RENAME',
          renameSuffix: String(task.renameSuffix || ' (cópia)').slice(0, 60)
        },
        timeoutMs: 120000
      });
      zernio.cacheBust('tree:' + env.accountId);
      return { resultId: (data && data.platformCampaignId) || null };
    }
    if (task.kind === 'duplicate_cross') {
      // Não há "duplicate para outra conta" na Zernio: lê a campanha de origem
      // na árvore e RECRIA na conta destino com os dados disponíveis.
      const st = zernio.getState(env.accountId);
      const tree = await zernio.api('GET', '/ads/tree', {
        query: { accountId: st.accountId, platform: 'tiktok', adAccountId: task.sourceAdAccountId || undefined, limit: 50 }
      });
      const src = (tree.campaigns || []).find((c) => c.platformCampaignId === task.sourceId);
      if (!src) throw new Error('Campanha de origem não encontrada na conta de origem');
      const firstAd = ((src.adSets || [])[0] || {}).ads && src.adSets[0].ads[0];
      const creative = (firstAd && firstAd.creative) || {};
      const videoUrl = String(creative.videoUrl || creative.imageUrl || '');
      if (!/^https:\/\//.test(videoUrl)) {
        throw new Error('A campanha de origem não expõe a URL do criativo — duplicação entre contas exige recriar com o vídeo. Use "Subir em massa" com o vídeo da biblioteca.');
      }
      const goal = String((firstAd && firstAd.goal) || 'traffic');
      const built = buildCreatePayload(st, {
        adAccountId: task.targetAdAccountId,
        name: String(task.newName || ((src.campaignName || task.sourceId) + (task.renameSuffix || ' (cópia)'))).slice(0, 120),
        goal: ['engagement', 'traffic', 'awareness', 'video_views', 'lead_generation', 'conversions', 'app_promotion'].includes(goal) ? goal : 'traffic',
        videoUrl,
        budgetAmount: Number((src.budget || {}).amount) || Number(((src.adSets || [])[0] || {}).budget && src.adSets[0].budget.amount) || 0,
        // lifetime exigiria endDate (não disponível na árvore) — recria como daily
        budgetType: 'daily',
        body: creative.body || undefined,
        linkUrl: creative.linkUrl || undefined
      });
      if (built.error) throw new Error('Não foi possível reconstruir a campanha: ' + built.error);
      const data = await zernio.api('POST', '/ads/create', {
        body: built.payload,
        timeoutMs: 120000,
        headers: { 'Idempotency-Key': 'dup:' + env.jobId + ':' + env.idx }
      });
      zernio.cacheBust('tree:' + env.accountId);
      return { resultId: (data && data.platformCampaignId) || null };
    }
    throw new Error('Tipo de tarefa desconhecido: ' + String(task.kind || ''));
  }

  bulk.startBulkWorker(processBulkItem);

  // Nunca expor a task interna (payloads) no polling da UI
  function publicJob(job) {
    return {
      jobId: job.id,
      kind: job.kind,
      status: job.status,
      total: job.total,
      done: job.done,
      failed: job.failed,
      createdAt: job.createdAt,
      items: job.items.map((it) => ({ idx: it.idx, ref: it.ref, status: it.status, error: it.error || undefined, resultId: it.resultId || undefined }))
    };
  }

  app.post('/api/ads/bulk', dashboardAuth, async (req, res) => {
    try {
      // F2: gate via Pipeboard (requireAdvertiser já valida o advertiser contra
      // o token; o gate antigo por st.accountId da Zernio deixaria 409 p/ sempre).
      if (!pipeboard.enabled) return res.status(409).json({ error: 'Pipeboard não configurado no servidor' });
      const st = { accountId: req.account.id };
      const b = req.body || {};
      const adAccountId = String(b.adAccountId || '').trim().slice(0, 60);
      const selected = await requireAdvertiser(req.account.id, st, adAccountId, b.businessCenterId);
      const idempotencyKey = String(b.idempotencyKey || '').trim().slice(0, 200);
      if (!idempotencyKey) return res.status(400).json({ error: 'idempotencyKey obrigatória' });
      const policy = await adsOps.getSafetyPolicy(req.account.id);
      const guard = adsOps.assertMutationAllowed(policy, { advertiserId: selected.advertiserId, idempotencyKey });
      const common = (b.common && typeof b.common === 'object') ? b.common : {};
      const rawItems = Array.isArray(b.items) ? b.items.slice(0, 20) : [];
      if (!rawItems.length) return res.status(400).json({ error: 'Adicione pelo menos 1 item (vídeo + nome)' });

      // valida TODOS os itens ANTES de enfileirar — o job nasce consistente
      const tasks = [];
      for (let i = 0; i < rawItems.length; i++) {
        const it = rawItems[i] || {};
        const built = buildCreatePayload(st, Object.assign({}, common, {
          adAccountId,
          name: it.name,
          videoUrl: it.videoUrl,
          body: it.body !== undefined ? it.body : common.body,
          linkUrl: it.linkUrl !== undefined ? it.linkUrl : common.linkUrl
        }));
        if (built.error) return res.status(400).json({ error: 'Item ' + (i + 1) + ': ' + built.error });
        tasks.push({ ref: String(it.name || 'item ' + (i + 1)).slice(0, 120), task: { kind: 'create', payload: built.payload } });
      }

      const job = await bulk.createBulkJob(req.account.id, {
        kind: 'bulk_create', adAccountId: selected.advertiserId,
        items: tasks.map((t) => ({ ref: t.ref })),
        meta: { goal: common.goal || '', idempotencyKey, dryRun: guard.dryRun }
      });
      if (job.meta && job.meta.idempotencyKey === idempotencyKey && job.items.some((item) => item.task || item.status !== 'queued')) {
        return res.status(200).json({ jobId: job.id, total: job.total, dryRun: Boolean(job.meta.dryRun), reused: true });
      }
      for (let i = 0; i < tasks.length; i++) {
        await bulk.updateBulkItem(req.account.id, job.id, i, { task: tasks[i].task });
        if (guard.dryRun) {
          await bulk.updateBulkItem(req.account.id, job.id, i, { status: 'done', resultId: 'dry-run' });
        } else {
          await bulk.enqueueBulkItem({ accountId: req.account.id, jobId: job.id, idx: i, task: tasks[i].task });
        }
      }
      await adsOps.appendAuditEvent(req.account.id, { actorType: 'user', actorId: req.account.id, action: guard.dryRun ? 'campaign_factory.simulated' : 'campaign_factory.queued', targetType: 'bulk_job', targetId: job.id, advertiserId: selected.advertiserId, jobId: job.id, reason: guard.dryRun ? 'Política em modo dry-run' : 'Criação em massa confirmada', metadata: { total: tasks.length, idempotencyKey } });
      stats.logEvent('info', { acc: req.account.id, title: (guard.dryRun ? 'Simulação bulk TikTok: ' : 'Bulk TikTok iniciado: ') + tasks.length + ' anúncio(s)' });
      res.status(guard.dryRun ? 200 : 202).json({ jobId: job.id, total: tasks.length, dryRun: guard.dryRun });
    } catch (err) { fail(res, err); }
  });

  // Progresso do job (polling da UI)
  app.get('/api/ads/bulk/:jobId', dashboardAuth, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const job = await bulk.getBulkJob(req.account.id, String(req.params.jobId || ''));
      if (!job) return res.status(404).json({ error: 'Job não encontrado (expira em 24h)' });
      res.json(publicJob(job));
    } catch (err) { fail(res, err); }
  });

  // Reprocessa os itens que FALHARAM (todos, ou só os índices informados)
  app.post('/api/ads/bulk/:jobId/retry', dashboardAuth, async (req, res) => {
    try {
      const job = await bulk.getBulkJob(req.account.id, String(req.params.jobId || ''));
      if (!job) return res.status(404).json({ error: 'Job não encontrado (expira em 24h)' });
      const wanted = Array.isArray((req.body || {}).indexes) ? req.body.indexes.map(Number) : null;
      let requeued = 0;
      for (const it of job.items) {
        if (it.status !== 'failed') continue;
        if (wanted && !wanted.includes(it.idx)) continue;
        if (!it.task) continue;
        await bulk.updateBulkItem(req.account.id, job.id, it.idx, { status: 'queued', error: null });
        await bulk.enqueueBulkItem({ accountId: req.account.id, jobId: job.id, idx: it.idx, task: it.task });
        requeued++;
      }
      res.json({ ok: true, requeued });
    } catch (err) { fail(res, err); }
  });

  // ── Duplicação (1 ou N cópias) ────────────────────────────────────────────
  // ADIADO na migração p/ Pipeboard: sem tool nativa de duplicar; reconstruir
  // via create_* + re-upload de vídeo é um gate próprio (junto do Gate 5 de
  // criação). Até lá respondemos 501 — a UI (duplicate-dialog) mostra o aviso.
  app.post('/api/ads/duplicate', dashboardAuth, async (req, res) => {
    return res.status(501).json({
      error: 'Duplicar campanha está temporariamente indisponível nesta versão. Aguarde a próxima atualização.',
      code: 'DUPLICATE_UNSUPPORTED',
    });
  });

  // ── Catálogos de produtos (TikTok Shopping / Catalog) ─────────────────────
  // A Zernio não publica campanhas de catálogo no TikTok — então aqui gerimos
  // o CATÁLOGO (produtos edit��veis + feed) e publicamos um feed TikTok-ready
  // numa URL pública do Blob. O usuário cola essa URL no Catalog Manager do
  // TikTok como feed agendado; toda edição aqui atualiza o feed no próximo pull.
  // Escopo por conta logada (req.account.id) — nunca cruza contas.

  // Spec das colunas/campos p/ a UI montar o formulário e validar ao vivo.
  app.get('/api/ads/catalogs/spec', dashboardAuth, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ columns: catalogFeed.COLUMNS, required: catalogFeed.REQUIRED, enums: catalogFeed.ENUMS, fields: catalogFeed.FIELD_META });
  });

  app.get('/api/ads/catalogs', dashboardAuth, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      res.json({ enabled: catalogStore.enabled, catalogs: await catalogStore.listCatalogs(req.account.id) });
    } catch (err) { fail(res, err); }
  });

  app.post('/api/ads/catalogs', dashboardAuth, async (req, res) => {
    try {
      const catalog = await catalogStore.createCatalog(req.account.id, req.body || {});
      stats.logEvent('info', { acc: req.account.id, title: 'Catálogo de produtos criado', ref: catalog.id });
      res.status(201).json({ catalog });
    } catch (err) { fail(res, err); }
  });

  app.get('/api/ads/catalogs/:catalogId', dashboardAuth, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const catalog = await catalogStore.getCatalog(req.account.id, req.params.catalogId);
      if (!catalog) return res.status(404).json({ error: 'Catálogo não encontrado' });
      const products = await catalogStore.listProducts(req.account.id, req.params.catalogId);
      res.json({ catalog, products });
    } catch (err) { fail(res, err); }
  });

  app.put('/api/ads/catalogs/:catalogId', dashboardAuth, async (req, res) => {
    try {
      const catalog = await catalogStore.updateCatalog(req.account.id, req.params.catalogId, req.body || {});
      res.json({ catalog });
    } catch (err) { fail(res, err); }
  });

  app.delete('/api/ads/catalogs/:catalogId', dashboardAuth, async (req, res) => {
    try {
      await catalogStore.deleteCatalog(req.account.id, req.params.catalogId);
      res.json({ ok: true });
    } catch (err) { fail(res, err); }
  });

  // Cria/atualiza um produto (upsert por SKU). Revalida contra a spec.
  app.post('/api/ads/catalogs/:catalogId/products', dashboardAuth, async (req, res) => {
    try {
      const body = req.body || {};
      const product = await catalogStore.upsertProduct(
        req.account.id, req.params.catalogId,
        { data: body.data || body }, catalogFeed.validateProduct
      );
      res.json({ product });
    } catch (err) { fail(res, err); }
  });

  app.delete('/api/ads/catalogs/:catalogId/products/:productId', dashboardAuth, async (req, res) => {
    try {
      await catalogStore.deleteProduct(req.account.id, req.params.catalogId, req.params.productId);
      res.json({ ok: true });
    } catch (err) { fail(res, err); }
  });

  // Importa CSV (texto no corpo). Aceita o template oficial do TikTok — ignora
  // cabeçalho e as linhas de instrução (4 & 5). Upsert por SKU: reimportar
  // atualiza em vez de duplicar.
  app.post('/api/ads/catalogs/:catalogId/import', dashboardAuth, require('express').text({ type: '*/*', limit: '25mb' }), async (req, res) => {
    try {
      const text = typeof req.body === 'string' ? req.body : String((req.body && req.body.csv) || '');
      if (!text.trim()) return res.status(400).json({ error: 'CSV vazio' });
      const parsed = catalogFeed.parseCatalogCsv(text);
      if (!parsed.products.length) return res.status(400).json({ error: 'Nenhum produto encontrado no CSV' });
      const summary = await catalogStore.bulkUpsertProducts(
        req.account.id, req.params.catalogId, parsed.products, catalogFeed.validateProduct
      );
      stats.logEvent('info', { acc: req.account.id, title: 'Produtos importados no catálogo: ' + summary.imported, ref: req.params.catalogId });
      res.json({ summary });
    } catch (err) { fail(res, err); }
  });

  // Baixa o CSV pronto pro TikTok (sem linhas de instrução).
  app.get('/api/ads/catalogs/:catalogId/export.csv', dashboardAuth, async (req, res) => {
    try {
      const catalog = await catalogStore.getCatalog(req.account.id, req.params.catalogId);
      if (!catalog) return res.status(404).json({ error: 'Catálogo não encontrado' });
      const products = await catalogStore.listProducts(req.account.id, req.params.catalogId);
      const csv = catalogFeed.buildCatalogCsv(products);
      res.set('Content-Type', 'text/csv; charset=utf-8');
      res.set('Content-Disposition', 'attachment; filename="' + (catalog.name || 'catalogo').replace(/[^a-z0-9_-]+/gi, '_') + '.csv"');
      res.send(csv);
    } catch (err) { fail(res, err); }
  });

  // Publica o feed no Blob (URL pública estável). allowOverwrite mantém a MESMA
  // URL entre publicações — o usuário cola uma vez no TikTok e nunca mais mexe.
  app.post('/api/ads/catalogs/:catalogId/publish', dashboardAuth, async (req, res) => {
    try {
      if (!process.env.BLOB_READ_WRITE_TOKEN) return res.status(503).json({ error: 'Armazenamento (Vercel Blob) não configurado' });
      const catalog = await catalogStore.getCatalog(req.account.id, req.params.catalogId);
      if (!catalog) return res.status(404).json({ error: 'Catálogo não encontrado' });
      const products = await catalogStore.listProducts(req.account.id, req.params.catalogId);
      const valid = products.filter((p) => p.valid);
      if (!valid.length) return res.status(400).json({ error: 'Nenhum produto válido para publicar. Corrija os erros primeiro.' });
      const csv = catalogFeed.buildCatalogCsv(valid);
      const { put } = require('@vercel/blob');
      // path estável por conta+catálogo → URL não muda entre publicações
      const blob = await put(
        'tiktok-catalogs/' + req.account.id + '/' + catalog.id + '.csv', csv,
        { access: 'public', contentType: 'text/csv; charset=utf-8', allowOverwrite: true, addRandomSuffix: false }
      );
      const updated = await catalogStore.setFeedUrl(req.account.id, catalog.id, blob.url);
      stats.logEvent('info', { acc: req.account.id, title: 'Feed de catálogo publicado (' + valid.length + ' produtos)', ref: catalog.id });
      res.json({ catalog: updated, feedUrl: blob.url, published: valid.length, skipped: products.length - valid.length });
    } catch (err) { fail(res, err); }
  });
};
