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
const pipeboard = require('./ads-provider'); // fronteira dashboard↔Pipeboard (única integração — F6 removeu a Zernio)
const pipeboardMcp = require('./pipeboard-mcp'); // Gate 1: cliente MCP cru (só /diag)
const adsCache = require('./ads-cache-store'); // espelho durável no Neon (leitura)
const adsSync = require('./ads-sync');         // motor Pipeboard→Neon (sync em background)
const automation = require('./ads-automation'); // regras/alertas/dayparting 24/7
const adsAi = require('./ads-ai');             // copiloto/briefing/criativos/realocação (IA, leituras 100% Neon)
const adsOps = require('./ads-ops-store');
const catalogStore = require('./ads-catalog-store');
const catalogFeed = require('./ads-catalog-feed');

// Repassa erros do provider com o payload estruturado (o front mostra a mensagem)
function fail(res, err) {
  const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
  const out = { error: String(err.message || 'erro inesperado').slice(0, 500) };
  if (err.step) out.step = err.step;
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
        identity: null,
        // F6 — capability flags: fonte ÚNICA de verdade do que o backend
        // suporta via Pipeboard. A UI esconde (não desabilita com promessa
        // vaga) o que estiver false. Nunca prometer o que a API não faz.
        capabilities: {
          createCampaign: true,      // F1
          bulkCreate: true,          // F2
          duplicateSameAccount: true, // F3
          duplicateCrossAccount: false, // video_id é escopado ao advertiser
          variations: true,          // F4
          sparkAds: true,            // F5 (via seletor de identidade/post)
          sparkCodeRedeem: false,    // resgate só no TikTok Ads Manager
          customIdentity: false,     // CUSTOMIZED_USER deprecated na plataforma (2026)
          businessCenters: false,    // Pipeboard não expõe BC
          oauthConnect: false,       // conexão é por chave de servidor, não OAuth por usuário
          appPromotion: false,       // exige app_id que a UI não coleta
        },
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

  // ── Conexão — F6, semântica Pipeboard ──────────────────────────────────────
  // NÃO há OAuth por usuário: a integração é uma chave de servidor
  // (PIPEBOARD_API_KEY) que já escopa os advertisers. "Conectar" no painel
  // vira uma verificação: se a chave está de pé e há advertiser, já está
  // conectado. GET mantido por compatibilidade com integrações antigas.
  async function startConnect(req, res) {
    try {
      if (!pipeboard.enabled) return res.status(409).json({ error: 'Pipeboard não configurado no servidor (PIPEBOARD_API_KEY)' });
      const s = await pipeboard.getStatus(req.account.id);
      if (s.connected) return res.json({ alreadyConnected: true, authUrl: '' });
      // Chave ok mas nenhum advertiser visível: não existe URL de autorização
      // a devolver — o vínculo de contas é feito no painel do Pipeboard.
      return res.status(422).json({
        error: 'A chave do Pipeboard está ativa mas nenhum advertiser está visível. Vincule a conta TikTok Ads no painel do Pipeboard (pipeboard.co) e recarregue.',
        code: 'NO_ADVERTISER_VISIBLE',
      });
    } catch (err) { fail(res, err); }
  }
  app.get('/api/ads/connect', dashboardAuth, startConnect);
  app.post('/api/ads/connect', dashboardAuth, startConnect);

  // Confirmação de conexão (o front chama após "conectar"): mesmo shape antigo.
  app.post('/api/ads/connected', dashboardAuth, async (req, res) => {
    try {
      if (!pipeboard.enabled) return res.json({ connected: false });
      const s = await pipeboard.getStatus(req.account.id);
      if (!s.connected) return res.json({ connected: false });
      const advName = (s.advertiser && s.advertiser.name) || s.advertiserId;
      res.json({ connected: true, account: { id: s.advertiserId, username: advName, displayName: advName } });
    } catch (err) { fail(res, err); }
  });

  // Desconectar não existe com chave de servidor: a revogação é remover o
  // token no painel do Pipeboard. 410 honesto (capabilities.oauthConnect=false
  // já esconde o botão na UI; isto cobre chamadas diretas à API).
  app.post('/api/ads/disconnect', dashboardAuth, async (_req, res) => {
    res.status(410).json({
      error: 'A conexão é gerenciada pela chave do servidor (Pipeboard) — não há desconexão por usuário. Para revogar o acesso, remova o token no painel do Pipeboard.',
      code: 'SERVER_KEY_MANAGED',
    });
  });

  // ── Advertisers: helpers ───────────────────────────────────────────────────
  // Lista advertisers via provider. O provider já normaliza healthStatus +
  // rawStatus e resolve o selecionado. (Business Centers da era Zernio foram
  // removidos: o Pipeboard não tem o conceito — as contas vêm do token.)
  async function listAdvertisers(accId, _st) {
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

  // ── Deep-link: criar conta de anúncio (NÃO há API — só a UI do TikTok) ────
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
    // ABO/CBO: 'campaign' = orçamento otimizado na campanha (CBO); qualquer
    // outro valor cai em ABO (orçamento no ad group) — o padrão histórico.
    const budgetOptimization = b.budgetOptimization === 'campaign' ? 'campaign' : 'adgroup';
    // Estratégia de lance: 'cost_cap' exige um custo-alvo (bidAmount > 0);
    // 'lowest_cost' (padrão) deixa o TikTok maximizar a entrega.
    const bidStrategy = b.bidStrategy === 'cost_cap' ? 'cost_cap' : 'lowest_cost';
    let bidAmount;
    if (bidStrategy === 'cost_cap') {
      bidAmount = Number(b.bidAmount);
      if (!(bidAmount > 0)) return { error: 'Estratégia "custo-alvo" exige um valor de lance (bidAmount) maior que zero' };
    }

    const payload = {
      accountId: st.accountId,
      adAccountId,
      name,
      goal,
      budgetAmount,
      budgetType,
      budgetOptimization,
      bidStrategy,
      bidAmount,
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
        budgetOptimization: payload.budgetOptimization,
        bidStrategy: payload.bidStrategy,
        bidAmount: payload.bidAmount,
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
  // F5 via Pipeboard. Descoberta: identidades autorizadas p/ Spark
  // (TT_USER/AUTH_CODE/BC_AUTH_TT). AUTH_CODE = criador cujo Spark Code JÁ
  // foi resgatado no TikTok Ads Manager.
  app.get('/api/ads/spark/identities', dashboardAuth, async (req, res) => {
    try {
      if (!pipeboard.enabled) return res.status(409).json({ error: 'Pipeboard não configurado no servidor' });
      const selected = await requireAdvertiser(req.account.id, null, String(req.query.adAccountId || ''), null);
      const identities = await pipeboard.listSparkIdentities(selected.advertiserId);
      res.json({ identities });
    } catch (err) { fail(res, err); }
  });

  // Posts (vídeos orgânicos) de uma identidade — fonte do tiktok_item_id.
  app.get('/api/ads/spark/videos', dashboardAuth, async (req, res) => {
    try {
      if (!pipeboard.enabled) return res.status(409).json({ error: 'Pipeboard não configurado no servidor' });
      const selected = await requireAdvertiser(req.account.id, null, String(req.query.adAccountId || ''), null);
      const videos = await pipeboard.listIdentityVideos(
        selected.advertiserId,
        String(req.query.identityId || ''),
        String(req.query.identityType || ''),
        String(req.query.bcId || '') || undefined
      );
      res.json({ videos });
    } catch (err) { fail(res, err); }
  });

  app.post('/api/ads/boost', dashboardAuth, async (req, res) => {
    try {
      if (!pipeboard.enabled) return res.status(409).json({ error: 'Pipeboard não configurado no servidor' });
      if (await killSwitchActive(req.account.id)) return res.status(423).json(KILL_SWITCH_BODY);
      const b = req.body || {};
      const selected = await requireAdvertiser(req.account.id, null, String(b.adAccountId || ''), null);
      const adAccountId = selected.advertiserId;
      const name = String(b.name || '').trim().slice(0, 120);
      if (!name) return res.status(400).json({ error: 'Nome da campanha é obrigatório' });
      const goal = ['engagement', 'traffic', 'awareness', 'video_views', 'lead_generation', 'conversions'].includes(b.goal) ? b.goal : '';
      if (!goal) return res.status(400).json({ error: 'Objetivo (goal) inválido' });
      const budgetAmount = Number((b.budget || {}).amount || b.budgetAmount);
      if (!(budgetAmount > 0)) return res.status(400).json({ error: 'Orçamento inválido' });
      const budgetType = ((b.budget || {}).type || b.budgetType) === 'lifetime' ? 'lifetime' : 'daily';

      // Spark Code cru NÃO é conversível via API (nenhum tool de resgate no
      // MCP — verificado no dump dos 74 tools): o resgate é feito no TikTok
      // Ads Manager e o criador vira identidade AUTH_CODE, que aparece no
      // seletor. 422 honesto com o caminho.
      if (String(b.sparkAuthCode || '').trim()) {
        return res.status(422).json({
          error: 'Colar Spark Code direto não é suportado: resgate o código no TikTok Ads Manager (Ativos → Criativo → Autorização de post). O criador vira uma identidade autorizada e os vídeos dele aparecem no seletor aqui.',
          code: 'SPARK_CODE_REDEEM_REQUIRED',
        });
      }
      const identityId = String(b.identityId || '').trim().slice(0, 60);
      const identityType = String(b.identityType || '').trim().toUpperCase().slice(0, 20);
      const itemId = String(b.itemId || b.platformPostId || '').trim().slice(0, 60);
      if (!identityId || !itemId) {
        return res.status(400).json({ error: 'Selecione a identidade (identityId/identityType) e o post (itemId) — use os seletores do diálogo' });
      }

      const spec = {
        name, goal,
        budgetAmount, budgetType,
        identityId, identityType, itemId,
        bcId: String(b.bcId || '').trim() || undefined,
      };
      if (/^https?:\/\//.test(String(b.linkUrl || ''))) spec.linkUrl = withAdsTracking(String(b.linkUrl).trim().slice(0, 500));
      if (/^[A-Z_]{3,30}$/.test(String(b.callToAction || ''))) spec.callToAction = b.callToAction;
      if (String(b.body || '').trim()) spec.body = String(b.body).trim().slice(0, 100);
      const countries = Array.isArray(b.countries)
        ? b.countries.map((c) => String(c || '').trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)).slice(0, 30) : [];
      if (countries.length) spec.countries = countries;

      // dry-run: não impulsiona de verdade.
      if (await isDryRun(req.account.id)) {
        await auditSimulated(req.account.id, {
          action: 'spark_ad_create', targetType: 'campaign', advertiserId: adAccountId,
          metadata: { name, goal, itemId }, title: 'Impulsionar Spark Ad ' + name
        });
        return res.status(200).json({ dryRun: true, simulated: true, id: 'dry-run', name });
      }
      const result = await pipeboard.createSparkAd(adAccountId, spec);
      await adsOps.appendAuditEvent(req.account.id, {
        actorType: 'user', actorId: req.account.id, action: 'spark_ad_create',
        targetType: 'campaign', targetId: result.campaignId, advertiserId: adAccountId,
        afterState: { campaignId: result.campaignId, adGroupId: result.adGroupId, adId: result.adId, itemId },
        reason: 'Spark Ad: ' + name, metadata: { goal, identityType },
      }).catch(() => {});
      adsSync.syncAfterWrite(req.account.id, adAccountId);
      stats.logEvent('info', { acc: req.account.id, title: 'Spark Ad criado (PAUSED): ' + name + ' [' + result.campaignId + ']' });
      res.status(201).json({ id: result.campaignId, campaignId: result.campaignId, adGroupId: result.adGroupId, adId: result.adId, name, status: 'paused', warnings: result.warnings });
    } catch (err) {
      if (err && err.step) {
        stats.logEvent('warn', { acc: req.account.id, title: '[tiktok-ads] Spark falhou no passo "' + err.step + '": ' + String(err.message || '').slice(0, 160) });
        return res.status(err.status || 502).json({ error: err.message, step: err.step, createdIds: err.createdIds || {}, note: err.createdIds && err.createdIds.campaignId ? 'A campanha parcial foi pausada — nada está gastando.' : undefined });
      }
      fail(res, err);
    }
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

  // ── Duplicar campanha ─────��───────────────────────────────────────────────
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
  const RESERVED_AD_IDS = new Set(['alerts', 'library', 'roas', 'identity', 'upload', 'status', 'accounts', 'tree', 'campaigns', 'create', 'boost', 'connect', 'connected', 'disconnect', 'attribution', 'rules', 'templates', 'business-centers', 'deeplink', 'bulk', 'duplicate', 'health', 'tickets', 'ops', 'catalogs', 'smart-plus']);

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

  // ── Brand Identity (CUSTOMIZED_USER) — F6: deprecated NA PLATAFORMA ───────
  // O TikTok não aceita mais identidades customizadas na criação de anúncios
  // (2026): anúncios criados com CUSTOMIZED_USER são REJEITADOS. O próprio
  // create_tiktok_identity do MCP está marcado deprecated. As identidades
  // agora vêm de get_tiktok_identities (TT_USER/AUTH_CODE/BC_AUTH_TT) — é o
  // que a criação (F1) e o Spark (F5) já usam. 410 honesto; a UI esconde o
  // diálogo via capabilities.customIdentity=false.
  app.patch('/api/ads/identity', dashboardAuth, async (_req, res) => {
    res.status(410).json({
      error: 'Identidade customizada (nome + avatar próprios) foi descontinuada pelo TikTok — anúncios com ela são rejeitados. Os anúncios usam a identidade da conta TikTok vinculada ao advertiser (automático).',
      code: 'CUSTOM_IDENTITY_DEPRECATED',
    });
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
      const defFrom = today; // padrão diário: sem ?fromDate, a janela é HOJE
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
      // F2 (guarda de moeda): a receita vem dos gateways (ex.: BRL) e o gasto
      // da conta de anúncio (ex.: EUR). Dividir um pelo outro produz um "ROAS"
      // numericamente plausível e completamente errado. Rastreamos a moeda
      // dominante da receita para bloquear o cálculo quando divergir.
      const revCurCount = {};
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
          const rc = String(l.reportedCurrency || 'BRL').toUpperCase();
          revCurCount[rc] = (revCurCount[rc] || 0) + cents;
        });
      }
      const revenueCurrency = Object.entries(revCurCount).sort((a, b) => b[1] - a[1])[0] ? Object.entries(revCurCount).sort((a, b) => b[1] - a[1])[0][0] : null;

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
      const spendCurrency = String(currency || 'EUR').toUpperCase();
      // ROAS só é um número quando gasto e receita estão na MESMA moeda.
      const currencyMismatch = !!(revenueCurrency && revenueCents > 0 && spend > 0 && revenueCurrency !== spendCurrency);
      const out = {
        fromDate, toDate, currency: currency || 'EUR',
        revenueCurrency, currencyMismatch,
        spend: +spend.toFixed(2), conversions,
        revenueCents, sales,
        roas: spend > 0 && !currencyMismatch ? +(revenue / spend).toFixed(2) : null,
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
  // ?days= — janela de atribuição (clamp 1–30, default 1 = hoje). Janela curta
  // é ruidosa: a UI avisa com base no windowDays devolvido pela proposta.
  app.get('/api/ads/budget/proposal', dashboardAuth, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const q = req.query || {};
      const advertiserId = await resolveAdv(req, String(q.adAccountId || '').trim());
      const days = Math.max(1, Math.min(30, parseInt(q.days, 10) || 1));
      const out = await adsAi.budgetProposal(req.account.id, advertiserId, String(q.currency || 'USD').slice(0, 5), days);
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
      // alertsSeeded: salvar é escolha do usuário — o seed não mexe mais aqui.
      pipeboard.setState(req.account.id, { alerts: cfg, alertsSeeded: true });
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

  // Pacote de presets de fábrica — a UI usa para "adicionar preset" individual
  // ou "restaurar presets" sem duplicar as constantes no front. Sempre vem
  // com enabled:false (quem liga é o usuário, regra a regra).
  app.get('/api/ads/rules/presets', dashboardAuth, (_req, res) => {
    res.json({ presets: automation.buildRulePresets() });
  });

  app.put('/api/ads/rules', dashboardAuth, (req, res) => {
    try {
      // validação/clamps (inclusive dos campos novos) centralizada no motor.
      // rulesSeeded junto: salvar (mesmo lista vazia) é escolha do usuário —
      // o seed automático nunca mais mexe nesta conta.
      const rules = automation.validateRules((req.body || {}).rules);
      pipeboard.setState(req.account.id, { rules, rulesSeeded: true });
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

  // ── F3: propostas do motor (modo proposta) ──────────────────────────────────
  // Regra em mode:'proposal' (default) grava a intenção em ads_rule_proposals
  // em vez de executar. Aqui o humano decide: listar / aprovar / rejeitar.
  app.get('/api/ads/proposals', dashboardAuth, async (req, res) => {
    try {
      res.set('Cache-Control', 'no-store');
      const items = await adsOps.listRuleProposals(req.account.id, {
        status: req.query.status ? String(req.query.status) : undefined,
        limit: req.query.limit,
      });
      res.json({ enabled: adsOps.enabled, items });
    } catch (err) { fail(res, err); }
  });

  // Aprovar = re-validar contra o estado atual + executar pela MESMA função do
  // motor (todos os guards: kill switch, dry-run, cap/hora, breaker). A lógica
  // vive em automation.approveProposal — a rota só traduz o erro em HTTP.
  app.post('/api/ads/proposals/:id/approve', dashboardAuth, async (req, res) => {
    try {
      res.json(await automation.approveProposal(req.account.id, req.params.id));
    } catch (err) { fail(res, err); }
  });

  app.post('/api/ads/proposals/:id/reject', dashboardAuth, async (req, res) => {
    try {
      const row = await adsOps.decideRuleProposal(req.account.id, req.params.id, 'rejected');
      if (!row) return res.status(409).json({ error: 'Proposta expirada ou já decidida' });
      // Decisão humana vai à trilha durável (mesma tabela das ações do motor).
      adsOps.appendAuditEvent(req.account.id, {
        actorType: 'user', action: 'rule_proposal.rejected', targetType: 'campaign',
        targetId: row.campaign_id, advertiserId: row.advertiser_id,
        reason: row.detail || null, metadata: { proposalId: row.id, ruleId: row.rule_id, metric: row.metric },
      }).catch(() => {});
      res.json({ ok: true, proposal: { id: row.id, status: row.status } });
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
  //   create       — criação individual via Pipeboard (payload validado no POST /bulk)
  //   duplicate_pb — recriação composta na MESMA conta via Pipeboard (F3/F4)
  // (Os antigos duplicate_same/duplicate_cross da era Zernio foram removidos —
  //  F6: kind desconhecido cai no throw do final, nunca em código morto.)
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
        budgetOptimization: p.budgetOptimization, bidStrategy: p.bidStrategy, bidAmount: p.bidAmount,
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
    if (task.kind === 'duplicate_pb') {
      // F3: duplicação composta via Pipeboard, MESMA conta. captureCampaign é
      // cacheada 10min no provider → N cópias do mesmo job capturam 1×. Mesma
      // retomada idempotente do 'create': progresso por item no Neon.
      const resume = await adsOps.getBulkProgress(env.accountId, env.jobId, env.idx);
      const capture = await pipeboard.captureCampaign(task.advertiserId, task.sourceId);
      const result = await pipeboard.recreateCampaign(task.advertiserId, capture, String(task.newName || '').slice(0, 512), {
        resume,
        dedupeByName: true,
        overrides: task.overrides || undefined, // F4: variações com budget/texto próprios
        onProgress: (ids) => adsOps.saveBulkProgress(env.accountId, env.jobId, env.idx, ids),
      });
      await adsOps.appendAuditEvent(env.accountId, {
        actorType: 'user', actorId: env.accountId, action: 'bulk_duplicate_item',
        targetType: 'campaign', targetId: result.campaignId, advertiserId: task.advertiserId,
        jobId: env.jobId,
        afterState: { campaignId: result.campaignId, adGroupIds: result.adGroupIds, adIds: result.adIds, sourceId: task.sourceId },
        reason: 'Duplicação da campanha ' + task.sourceId + ' (item ' + env.idx + ' do job ' + env.jobId + ')',
        metadata: { warnings: result.warnings },
      }).catch(() => {});
      pipeboard.cacheBust('tree:');
      return { resultId: result.campaignId || null };
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

  // ── Duplicação (1 ou N cópias) — F3, via Pipeboard ────────────────────────
  // Sem tool nativa de duplicar: cada cópia é uma RECRIAÇÃO composta
  // (captureCampaign 1×/job + recreateCampaign por cópia) processada na mesma
  // fila durável do bulk, com retomada idempotente por item. MESMA conta
  // apenas: entre contas o video_id não é transferível (escopado ao
  // advertiser) — responder 422 honesto é melhor que cópia sem criativo.
  app.post('/api/ads/duplicate', dashboardAuth, async (req, res) => {
    try {
      if (!pipeboard.enabled) return res.status(409).json({ error: 'Pipeboard não configurado no servidor' });
      const b = req.body || {};
      const sourceId = String(b.sourceId || '').trim().slice(0, 60);
      if (!sourceId) return res.status(400).json({ error: 'sourceId (campanha de origem) obrigatório' });
      const sourceAdAccountId = String(b.sourceAdAccountId || '').trim().slice(0, 60);
      const targetAdAccountId = String(b.targetAdAccountId || sourceAdAccountId).trim().slice(0, 60);
      if (targetAdAccountId && sourceAdAccountId && targetAdAccountId !== sourceAdAccountId) {
        return res.status(422).json({
          error: 'Duplicar para OUTRA conta ainda não é suportado: os criativos (video_id) são escopados ao advertiser de origem no TikTok. Duplique na mesma conta ou use "Subir em massa" com o vídeo da biblioteca na conta destino.',
          code: 'CROSS_ACCOUNT_UNSUPPORTED',
        });
      }
      const selected = await requireAdvertiser(req.account.id, null, sourceAdAccountId, null);
      // F4: modo VARIAÇÕES — array de até 50 itens, cada um com overrides
      // opcionais { name?, budgetAmount?, adText? } aplicados sobre o template.
      // Sem "variations", modo cópia exata clássico (1-10, count+suffix).
      // Teto de 50 VALIDADO (400 explícito) — truncar com slice criaria 50 e
      // sumiria com as demais sem o usuário saber quais ficaram de fora.
      const rawVariations = Array.isArray(b.variations) ? b.variations : null;
      if (rawVariations && rawVariations.length > 50) {
        return res.status(400).json({ error: 'Máximo de 50 variações por job — você enviou ' + rawVariations.length + '. Divida em jobs menores.' });
      }
      const count = rawVariations ? rawVariations.length : Math.min(10, Math.max(1, parseInt(b.count, 10) || 1));
      if (rawVariations && !count) return res.status(400).json({ error: 'variations vazio — envie 1 a 50 variações' });
      const suffix = String(b.nameSuffix || (rawVariations ? ' (variação)' : ' (cópia)')).slice(0, 60);
      const idempotencyKey = String(b.idempotencyKey || '').trim().slice(0, 200);
      if (!idempotencyKey) return res.status(400).json({ error: 'idempotencyKey obrigatória' });
      const policy = await adsOps.getSafetyPolicy(req.account.id);
      const guard = adsOps.assertMutationAllowed(policy, { advertiserId: selected.advertiserId, idempotencyKey });

      // Valida a ORIGEM antes de enfileirar (o job nasce consistente) e já
      // aquece o cache da captura p/ os itens do worker.
      const capture = await pipeboard.captureCampaign(selected.advertiserId, sourceId);
      const srcName = String(capture.campaign.campaign_name || capture.campaign.name || sourceId);

      const tasks = [];
      for (let i = 0; i < count; i++) {
        const v = rawVariations ? (rawVariations[i] || {}) : null;
        const newName = String((v && v.name) || (srcName + suffix + (count > 1 ? ' ' + (i + 1) : ''))).slice(0, 512);
        const task = { kind: 'duplicate_pb', sourceId, advertiserId: selected.advertiserId, newName };
        if (v) {
          const overrides = {};
          if (Number(v.budgetAmount) > 0) overrides.budgetAmount = Math.min(100000, Number(v.budgetAmount));
          if (v.adText) overrides.adText = String(v.adText).slice(0, 100);
          if (Object.keys(overrides).length) task.overrides = overrides;
        }
        tasks.push({ ref: newName.slice(0, 120), task });
      }
      const job = await bulk.createBulkJob(req.account.id, {
        kind: 'duplicate', adAccountId: selected.advertiserId,
        items: tasks.map((t) => ({ ref: t.ref })),
        meta: { sourceId, idempotencyKey, dryRun: guard.dryRun },
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
      await adsOps.appendAuditEvent(req.account.id, { actorType: 'user', actorId: req.account.id, action: guard.dryRun ? 'duplicate.simulated' : 'duplicate.queued', targetType: 'bulk_job', targetId: job.id, advertiserId: selected.advertiserId, jobId: job.id, reason: guard.dryRun ? 'Política em modo dry-run' : 'Duplicação confirmada', metadata: { sourceId, count, idempotencyKey } });
      stats.logEvent('info', { acc: req.account.id, title: (guard.dryRun ? 'Simulação de duplicação: ' : 'Duplicação iniciada: ') + count + ' cópia(s) de ' + srcName });
      res.status(guard.dryRun ? 200 : 202).json({ jobId: job.id, total: count, dryRun: guard.dryRun });
    } catch (err) { fail(res, err); }
  });

  // ── Smart+ (campanhas automatizadas do TikTok) ────────────────────────────
  // Gestão (listar/pausar/escalar) + recurso de anúncio reprovado. O appeal de
  // anúncio SÓ existe na API para anúncios Smart+ (appeal_tiktok_smart_plus_ad).
  async function resolveAdvForSmartPlus(req, hint) {
    if (hint) return (await requireAdvertiser(req.account.id, null, hint, null)).advertiserId;
    const id = await pipeboard.resolveAdvertiserId(req.account.id);
    if (!id) { const e = new Error('Nenhuma conta de anúncio autorizada no token'); e.status = 409; throw e; }
    return id;
  }

  app.get('/api/ads/smart-plus', dashboardAuth, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      if (!pipeboard.enabled) return res.status(409).json({ error: 'Pipeboard não configurado no servidor' });
      const advertiserId = await resolveAdvForSmartPlus(req, String(req.query.adAccountId || '').trim() || null);
      const campaigns = await pipeboard.listSmartPlusCampaigns(advertiserId);
      res.json({ advertiserId, campaigns });
    } catch (err) { fail(res, err); }
  });

  app.get('/api/ads/smart-plus/ads', dashboardAuth, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      if (!pipeboard.enabled) return res.status(409).json({ error: 'Pipeboard não configurado no servidor' });
      const advertiserId = await resolveAdvForSmartPlus(req, String(req.query.adAccountId || '').trim() || null);
      const ads = await pipeboard.listSmartPlusAds(advertiserId, { campaignId: req.query.campaignId });
      res.json({ advertiserId, ads });
    } catch (err) { fail(res, err); }
  });

  app.post('/api/ads/smart-plus', dashboardAuth, async (req, res) => {
    try {
      if (!pipeboard.enabled) return res.status(409).json({ error: 'Pipeboard não configurado no servidor' });
      if (await killSwitchActive(req.account.id)) return res.status(423).json(KILL_SWITCH_BODY);
      const b = req.body || {};
      const advertiserId = await resolveAdvForSmartPlus(req, String(b.adAccountId || '').trim() || null);
      const goal = ['conversions', 'traffic'].includes(b.goal) ? b.goal : '';
      if (!goal) return res.status(400).json({ error: 'Objetivo Smart+ deve ser conversions ou traffic' });
      const name = String(b.name || '').trim().slice(0, 120);
      if (!name) return res.status(400).json({ error: 'Nome da campanha é obrigatório' });
      if (!/^https:\/\/[^\s]+/.test(String(b.videoUrl || ''))) return res.status(400).json({ error: 'URL do vídeo é obrigatória (MP4)' });
      const budgetAmount = Number(b.budgetAmount);
      if (!(budgetAmount > 0)) return res.status(400).json({ error: 'Orçamento total inválido' });
      if (!/^\d{4}-\d{2}-\d{2}/.test(String(b.endDate || ''))) return res.status(400).json({ error: 'Informe a data de término (Smart+ usa orçamento total)' });
      const spec = {
        name, goal, videoUrl: String(b.videoUrl).trim(),
        budgetAmount, endDate: String(b.endDate).slice(0, 10),
        body: String(b.body || '').trim().slice(0, 100) || undefined,
        linkUrl: /^https?:\/\//.test(String(b.linkUrl || '')) ? withAdsTracking(String(b.linkUrl).trim().slice(0, 500)) : undefined,
        callToAction: /^[A-Z_]{3,30}$/.test(String(b.callToAction || '')) ? b.callToAction : undefined,
        countries: Array.isArray(b.countries) ? b.countries.map((c) => String(c || '').trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)).slice(0, 30) : undefined,
      };
      if (goal === 'conversions') {
        const pixelId = String(b.pixelId || '').trim();
        if (!/^\d{5,30}$/.test(pixelId)) return res.status(400).json({ error: 'Conversões exigem o Pixel ID NUMÉRICO do TikTok' });
        spec.pixelId = pixelId;
        const evt = String(b.customEventType || '').trim().toUpperCase();
        if (/^[A-Z_]{3,40}$/.test(evt)) spec.customEventType = evt;
      }
      if (await isDryRun(req.account.id)) {
        await auditSimulated(req.account.id, {
          action: 'smart_plus_create', targetType: 'campaign', advertiserId, metadata: { name, goal },
          title: 'Criar campanha Smart+ ' + name,
        });
        return res.status(200).json({ dryRun: true, simulated: true, id: 'dry-run', name });
      }
      const result = await pipeboard.createSmartPlusCampaign(advertiserId, spec);
      await adsOps.appendAuditEvent(req.account.id, {
        actorType: 'user', actorId: req.account.id, action: 'smart_plus_create',
        targetType: 'campaign', targetId: result.campaignId, advertiserId,
        afterState: { campaignId: result.campaignId, adGroupId: result.adGroupId, adId: result.adId, videoId: result.videoId },
        reason: 'Campanha Smart+ criada (PAUSADA): ' + name, metadata: { goal },
      }).catch(() => {});
      adsSync.syncAfterWrite(req.account.id, advertiserId);
      stats.logEvent('info', { acc: req.account.id, title: 'Campanha Smart+ criada (PAUSADA): ' + name + ' [' + result.campaignId + ']' });
      res.status(201).json({ id: result.campaignId, campaignId: result.campaignId, name, status: 'paused', warnings: result.warnings });
    } catch (err) {
      if (err && err.step) {
        stats.logEvent('warn', { acc: req.account.id, title: '[smart+] Criação falhou no passo "' + err.step + '": ' + String(err.message || '').slice(0, 160) });
        return res.status(err.status || 502).json({ error: err.message, step: err.step, createdIds: err.createdIds || {}, note: err.createdIds && err.createdIds.campaignId ? 'A campanha parcial foi pausada — nada veicula. Revise e exclua na aba Smart+ se não quiser mantê-la.' : undefined });
      }
      fail(res, err);
    }
  });

  app.post('/api/ads/smart-plus/:campaignId/status', dashboardAuth, async (req, res) => {
    try {
      if (!pipeboard.enabled) return res.status(409).json({ error: 'Pipeboard não configurado no servidor' });
      if (await killSwitchActive(req.account.id)) return res.status(423).json(KILL_SWITCH_BODY);
      const b = req.body || {};
      const status = ['active', 'paused', 'deleted'].includes(b.status) ? b.status : '';
      if (!status) return res.status(400).json({ error: 'status deve ser active, paused ou deleted' });
      const advertiserId = await resolveAdvForSmartPlus(req, String(b.adAccountId || '').trim() || null);
      const campaignId = String(req.params.campaignId || '');
      if (await isDryRun(req.account.id)) {
        await auditSimulated(req.account.id, {
          action: 'smart_plus_status', targetType: 'campaign', targetId: campaignId, advertiserId,
          metadata: { status }, title: (status === 'paused' ? 'Pausar' : status === 'deleted' ? 'Excluir' : 'Ativar') + ' Smart+ ' + campaignId,
        });
        return res.json({ dryRun: true, simulated: true, id: campaignId });
      }
      await pipeboard.setSmartPlusCampaignStatus(advertiserId, [campaignId], status);
      adsSync.syncAfterWrite(req.account.id, advertiserId);
      await adsOps.appendAuditEvent(req.account.id, {
        actorType: 'user', actorId: req.account.id, action: 'smart_plus_status',
        targetType: 'campaign', targetId: campaignId, advertiserId, reason: 'Smart+ → ' + status,
      }).catch(() => {});
      stats.logEvent('info', { acc: req.account.id, title: 'Campanha Smart+ ' + (status === 'paused' ? 'pausada' : status === 'deleted' ? 'excluída' : 'ativada'), ref: campaignId });
      res.json({ ok: true, id: campaignId, status });
    } catch (err) { fail(res, err); }
  });

  app.post('/api/ads/smart-plus/ads/:adId/appeal', dashboardAuth, async (req, res) => {
    try {
      if (!pipeboard.enabled) return res.status(409).json({ error: 'Pipeboard não configurado no servidor' });
      if (await killSwitchActive(req.account.id)) return res.status(423).json(KILL_SWITCH_BODY);
      const b = req.body || {};
      const advertiserId = await resolveAdvForSmartPlus(req, String(b.adAccountId || '').trim() || null);
      const adId = String(req.params.adId || '');
      const reason = String(b.reason || '').trim();
      if (await isDryRun(req.account.id)) {
        await auditSimulated(req.account.id, {
          action: 'smart_plus_appeal', targetType: 'ad', targetId: adId, advertiserId,
          metadata: { reason: reason.slice(0, 120) }, title: 'Recorrer do anúncio Smart+ ' + adId,
        });
        return res.json({ dryRun: true, simulated: true, id: adId });
      }
      await pipeboard.appealSmartPlusAd(advertiserId, adId, reason);
      await adsOps.appendAuditEvent(req.account.id, {
        actorType: 'user', actorId: req.account.id, action: 'smart_plus_appeal',
        targetType: 'ad', targetId: adId, advertiserId, reason: 'Recurso enviado ao TikTok' + (reason ? ': ' + reason.slice(0, 120) : ''),
      }).catch(() => {});
      stats.logEvent('info', { acc: req.account.id, title: 'Recurso de anúncio Smart+ enviado ao TikTok', ref: adId });
      res.json({ ok: true, id: adId });
    } catch (err) { fail(res, err); }
  });

  // ── Catálogos de produtos (TikTok Shopping / Catalog) ─────────────────────
  // Fluxo ponta a ponta: gerimos os produtos (editáveis + validados contra a
  // spec do template oficial), publicamos um feed CSV TikTok-ready numa URL
  // pública (Blob) E — quando o Business Center está configurado — criamos o
  // catálogo REAL no TikTok via Pipeboard e subimos os produtos, deixando-o
  // pronto para uma campanha de Product Sales / DPA. Escopo por conta logada.

  // Tipos de catálogo do TikTok + países comuns (hints da UI no formulário).
  const CATALOG_TYPE_LABELS = [
    { value: 'PRODUCT_CATALOG', label: 'Produtos (e-commerce / infoproduto)' },
    { value: 'HOTEL_CATALOG', label: 'Hotéis' },
    { value: 'FLIGHT_CATALOG', label: 'Voos' },
    { value: 'VEHICLE_CATALOG', label: 'Veículos' },
  ];
  const CATALOG_COUNTRIES = [
    { code: 'BR', name: 'Brasil' }, { code: 'US', name: 'Estados Unidos' },
    { code: 'PT', name: 'Portugal' }, { code: 'GB', name: 'Reino Unido' },
    { code: 'MX', name: 'México' }, { code: 'ES', name: 'Espanha' },
    { code: 'FR', name: 'França' }, { code: 'DE', name: 'Alemanha' },
    { code: 'IT', name: 'Itália' }, { code: 'CA', name: 'Canadá' },
    { code: 'AU', name: 'Austrália' }, { code: 'JP', name: 'Japão' },
  ];

  // Spec das colunas/campos p/ a UI montar o formulário e validar ao vivo.
  app.get('/api/ads/catalogs/spec', dashboardAuth, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({
      columns: catalogFeed.COLUMNS, required: catalogFeed.REQUIRED,
      enums: catalogFeed.ENUMS, fields: catalogFeed.FIELD_META,
      catalogTypes: CATALOG_TYPE_LABELS, countries: CATALOG_COUNTRIES,
    });
  });

  // Business Center usado para os catálogos desta conta. O TikTok prende
  // catálogos ao BC (não ao advertiser) e não há tool para listar BCs — então o
  // usuário informa o ID uma vez (persistido) ou vem do env TIKTOK_BC_ID.
  app.get('/api/ads/catalogs/business-center', dashboardAuth, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({
      enabled: pipeboard.enabled,
      bcId: pipeboard.getBusinessCenterId(req.account.id) || '',
      fromEnv: pipeboard.businessCenterFromEnv(req.account.id),
    });
  });

  app.post('/api/ads/catalogs/business-center', dashboardAuth, (req, res) => {
    try {
      const raw = String((req.body || {}).bcId || '').trim();
      if (raw && !/^\d{6,30}$/.test(raw)) {
        return res.status(400).json({ error: 'O ID do Business Center deve ser numérico (ex.: 7012345678901234567).', code: 'INVALID_BC_ID' });
      }
      const bcId = pipeboard.setBusinessCenterId(req.account.id, raw);
      res.json({ ok: true, bcId });
    } catch (err) { fail(res, err); }
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

  // Publica o feed CSV no Blob (URL pública estável). Reutilizado por /publish e
  // /sync-tiktok. allowOverwrite mantém a MESMA URL entre publicações — o TikTok
  // re-puxa sozinho do mesmo endereço. Lança erros com `status` para o `fail`.
  async function publishCatalogFeed(accountId, catalogId) {
    if (!process.env.BLOB_READ_WRITE_TOKEN) { const e = new Error('Armazenamento (Vercel Blob) não configurado'); e.status = 503; throw e; }
    const catalog = await catalogStore.getCatalog(accountId, catalogId);
    if (!catalog) { const e = new Error('Catálogo não encontrado'); e.status = 404; throw e; }
    const products = await catalogStore.listProducts(accountId, catalogId);
    const valid = products.filter((p) => p.valid);
    if (!valid.length) { const e = new Error('Nenhum produto válido para publicar. Corrija os erros primeiro.'); e.status = 400; throw e; }
    const csv = catalogFeed.buildCatalogCsv(valid);
    const { put } = require('@vercel/blob');
    // path estável por conta+catálogo → URL não muda entre publicações
    const blob = await put(
      'tiktok-catalogs/' + accountId + '/' + catalog.id + '.csv', csv,
      { access: 'public', contentType: 'text/csv; charset=utf-8', allowOverwrite: true, addRandomSuffix: false }
    );
    const updated = await catalogStore.setFeedUrl(accountId, catalog.id, blob.url);
    return { catalog: updated, feedUrl: blob.url, published: valid.length, skipped: products.length - valid.length };
  }

  app.post('/api/ads/catalogs/:catalogId/publish', dashboardAuth, async (req, res) => {
    try {
      const out = await publishCatalogFeed(req.account.id, req.params.catalogId);
      stats.logEvent('info', { acc: req.account.id, title: 'Feed de catálogo publicado (' + out.published + ' produtos)', ref: req.params.catalogId });
      res.json(out);
    } catch (err) { fail(res, err); }
  });

  // ── Publicar direto no TikTok (o caminho "pronto para campanha") ───────────
  // Um clique faz o ciclo completo: publica o feed no Blob → cria o catálogo no
  // TikTok (se ainda não existe) → sobe os produtos pela URL pública → busca o
  // overview de auditoria. Respeita killSwitch e dry-run como qualquer escrita.
  app.post('/api/ads/catalogs/:catalogId/sync-tiktok', dashboardAuth, async (req, res) => {
    try {
      if (!pipeboard.enabled) return res.status(409).json({ error: 'Pipeboard não configurado no servidor' });
      const accId = req.account.id;
      const catalogId = req.params.catalogId;
      const bcId = pipeboard.getBusinessCenterId(accId);
      if (!bcId) {
        return res.status(422).json({ error: 'Informe o ID do Business Center do TikTok antes de publicar (aba Catálogo → Business Center).', code: 'NO_BUSINESS_CENTER' });
      }
      if (await killSwitchActive(accId)) return res.status(423).json(KILL_SWITCH_BODY);

      // 1) Publica o feed no Blob (também garante que há produtos válidos).
      const pub = await publishCatalogFeed(accId, catalogId);
      let catalog = pub.catalog;

      // dry-run: o feed foi publicado (leitura segura), mas NADA é criado/enviado
      // ao TikTok. Devolve o catálogo + a URL para o usuário conferir.
      if (await isDryRun(accId)) {
        await auditSimulated(accId, {
          action: 'catalog_sync', targetType: 'catalog', targetId: catalogId, advertiserId: null,
          metadata: { bcId, feedUrl: pub.feedUrl, published: pub.published },
          title: 'Publicar catálogo no TikTok: ' + (catalog.name || catalogId),
        });
        return res.json({ dryRun: true, simulated: true, catalog, feedUrl: pub.feedUrl, published: pub.published, skipped: pub.skipped, audit: catalog.audit || null });
      }

      // 2) Cria o catálogo no TikTok se ainda não vinculado (idempotente por
      //    conta: uma vez criado, reusa o mesmo catalog_id nas próximas vezes).
      if (!catalog.tiktokCatalogId) {
        const created = await pipeboard.createTikTokCatalog(bcId, {
          name: catalog.name, catalogType: catalog.catalogType, currency: catalog.currency, country: catalog.country,
        });
        catalog = await catalogStore.linkTikTokCatalog(accId, catalogId, { tiktokCatalogId: created.catalogId, bcId });
      }

      // 3) Sobe os produtos pela URL pública do feed.
      await pipeboard.uploadTikTokCatalogProducts(bcId, catalog.tiktokCatalogId, pub.feedUrl, 'CSV');

      // 4) Overview de auditoria (best-effort — o upload é assíncrono no TikTok,
      //    então pode vir como "pendente" logo após; a UI reconsulta depois).
      let audit = null;
      try {
        audit = await pipeboard.getTikTokCatalogOverview(bcId, catalog.tiktokCatalogId);
        catalog = await catalogStore.setAudit(accId, catalogId, audit);
      } catch (_) { /* overview é opcional; o vínculo já está gravado */ }

      await adsOps.appendAuditEvent(accId, {
        actorType: 'user', actorId: accId, action: 'catalog_sync',
        targetType: 'catalog', targetId: catalogId, advertiserId: null,
        afterState: { tiktokCatalogId: catalog.tiktokCatalogId, bcId, published: pub.published },
        reason: 'Catálogo publicado no TikTok: ' + (catalog.name || catalogId),
        metadata: { bcId, published: pub.published },
      }).catch(() => {});
      stats.logEvent('info', { acc: accId, title: 'Catálogo publicado no TikTok: ' + (catalog.name || catalogId) + ' (' + pub.published + ' produtos)', ref: catalogId });
      res.json({ ok: true, catalog, feedUrl: pub.feedUrl, published: pub.published, skipped: pub.skipped, audit });
    } catch (err) { fail(res, err); }
  });

  // Reconsulta só o overview de auditoria de um catálogo já publicado no TikTok.
  app.get('/api/ads/catalogs/:catalogId/audit', dashboardAuth, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      if (!pipeboard.enabled) return res.status(409).json({ error: 'Pipeboard não configurado no servidor' });
      const catalog = await catalogStore.getCatalog(req.account.id, req.params.catalogId);
      if (!catalog) return res.status(404).json({ error: 'Catálogo não encontrado' });
      if (!catalog.tiktokCatalogId || !catalog.bcId) {
        return res.status(422).json({ error: 'Catálogo ainda não publicado no TikTok.', code: 'NOT_SYNCED' });
      }
      const audit = await pipeboard.getTikTokCatalogOverview(catalog.bcId, catalog.tiktokCatalogId);
      const updated = await catalogStore.setAudit(req.account.id, req.params.catalogId, audit);
      res.json({ catalog: updated, audit });
    } catch (err) { fail(res, err); }
  });
};
