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

  // ── Status da integração ──────────────────────────────────────────────────
  app.get('/api/ads/status', dashboardAuth, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      if (adsSweepHook.fn) adsSweepHook.fn(req.account.id); // alertas pegam carona
      if (!zernio.enabled) return res.json({ enabled: false, connected: false });
      const st = zernio.getState(req.account.id);
      if (!st.accountId) return res.json({ enabled: true, connected: false });
      // valida que a SocialAccount ainda existe do lado da Zernio (cache 60s)
      const ck = 'status:' + req.account.id;
      let acct = zernio.cacheGet(ck);
      if (!acct) {
        const data = await zernio.api('GET', '/accounts');
        acct = (data.accounts || []).find((a) => a._id === st.accountId) || false;
        zernio.cacheSet(ck, acct, 60 * 1000);
      }
      if (!acct) {
        // a conta sumiu na Zernio (desconectada por lá) — esquece localmente
        zernio.setState(req.account.id, { accountId: '', advertiserId: '', identity: null });
        return res.json({ enabled: true, connected: false });
      }
      res.json({
        enabled: true,
        connected: true,
        account: { id: acct._id, username: acct.username || '', displayName: acct.displayName || '' },
        advertiserId: st.advertiserId || '',
        identity: st.identity || null
      });
    } catch (err) { fail(res, err); }
  });

  // ── OAuth: gera a URL de autorização do TikTok Business ───────────────────
  app.get('/api/ads/connect', dashboardAuth, async (req, res) => {
    try {
      const profileId = await zernio.ensureProfile(req.account.id);
      // Modo ads-only (sem accountId de posting): anúncios usam Brand Identity.
      const data = await zernio.api('GET', '/connect/tiktok-ads', { query: { profileId } });
      if (!data || !data.authUrl) return res.status(502).json({ error: 'Zernio não retornou a URL de autorização' });
      res.json({ authUrl: data.authUrl });
    } catch (err) { fail(res, err); }
  });

  // ── Callback do painel: após o OAuth, descobre a SocialAccount criada ─────
  app.post('/api/ads/connected', dashboardAuth, async (req, res) => {
    try {
      const profileId = await zernio.ensureProfile(req.account.id);
      const data = await zernio.api('GET', '/accounts');
      const mine = (data.accounts || []).filter((a) => a.platform === 'tiktokads' && String(a.profileId || '') === String(profileId));
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
      zernio.setState(req.account.id, { accountId: '', advertiserId: '', identity: null });
      zernio.cacheBust('status:' + req.account.id);
      zernio.cacheBust('accounts:' + req.account.id);
      zernio.cacheBust('tree:' + req.account.id);
      stats.logEvent('warn', { acc: req.account.id, title: 'TikTok Ads desconectado' });
      res.json({ ok: true });
    } catch (err) { fail(res, err); }
  });

  // ── Advertisers (contas de anúncio do token) ──────────────────────────────
  app.get('/api/ads/accounts', dashboardAuth, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const st = zernio.getState(req.account.id);
      if (!st.accountId) return res.status(409).json({ error: 'Conecte sua conta TikTok Ads primeiro' });
      const ck = 'accounts:' + req.account.id;
      let data = zernio.cacheGet(ck);
      if (!data) {
        data = await zernio.api('GET', '/ads/accounts', { query: { accountId: st.accountId } });
        zernio.cacheSet(ck, data, 5 * 60 * 1000);
      }
      res.json({ accounts: data.accounts || [], selected: st.advertiserId || '' });
    } catch (err) { fail(res, err); }
  });

  // seleciona o advertiser usado como padrão nas telas
  app.post('/api/ads/accounts/select', dashboardAuth, async (req, res) => {
    try {
      const id = String((req.body || {}).advertiserId || '').trim().slice(0, 60);
      if (!id) return res.status(400).json({ error: 'advertiserId obrigatório' });
      zernio.setState(req.account.id, { advertiserId: id });
      zernio.cacheBust('tree:' + req.account.id);
      res.json({ ok: true, advertiserId: id });
    } catch (err) { fail(res, err); }
  });

  // ── Árvore campanha → ad group → ad com métricas ──────────────────────────
  app.get('/api/ads/tree', dashboardAuth, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      if (adsSweepHook.fn) adsSweepHook.fn(req.account.id); // alertas pegam carona
      const st = zernio.getState(req.account.id);
      if (!st.accountId) return res.status(409).json({ error: 'Conecte sua conta TikTok Ads primeiro' });
      const q = req.query || {};
      const query = {
        accountId: st.accountId,
        platform: 'tiktok',
        adAccountId: String(q.adAccountId || st.advertiserId || '') || undefined,
        status: ['active', 'paused', 'pending_review', 'error', 'completed', 'cancelled', 'rejected'].includes(q.status) ? q.status : undefined,
        fromDate: /^\d{4}-\d{2}-\d{2}$/.test(String(q.fromDate || '')) ? q.fromDate : undefined,
        toDate: /^\d{4}-\d{2}-\d{2}$/.test(String(q.toDate || '')) ? q.toDate : undefined,
        sort: ['newest', 'oldest', 'spend_desc', 'spend_asc'].includes(q.sort) ? q.sort : 'newest',
        limit: Math.max(1, Math.min(50, parseInt(q.limit, 10) || 20)),
        page: Math.max(1, parseInt(q.page, 10) || 1),
        timeIncrement: q.daily === '1' ? 1 : undefined
      };
      const ck = 'tree:' + req.account.id + ':' + JSON.stringify(query);
      let data = zernio.cacheGet(ck);
      if (!data) {
        data = await zernio.api('GET', '/ads/tree', { query });
        // TTL curto: o painel faz polling e as métricas do TikTok não mudam a cada segundo
        zernio.cacheSet(ck, data, 45 * 1000);
      }
      res.json(data);
    } catch (err) { fail(res, err); }
  });

  // ── Analytics de campanha (resumo + série diária) ─────────────────────────
  app.get('/api/ads/campaigns/:id/analytics', dashboardAuth, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const st = zernio.getState(req.account.id);
      if (!st.accountId) return res.status(409).json({ error: 'Conecte sua conta TikTok Ads primeiro' });
      const q = req.query || {};
      const query = {
        platform: 'tiktok',
        fromDate: /^\d{4}-\d{2}-\d{2}$/.test(String(q.fromDate || '')) ? q.fromDate : undefined,
        toDate: /^\d{4}-\d{2}-\d{2}$/.test(String(q.toDate || '')) ? q.toDate : undefined
      };
      const id = encodeURIComponent(String(req.params.id || ''));
      const ck = 'analytics:' + req.account.id + ':' + id + ':' + JSON.stringify(query);
      let data = zernio.cacheGet(ck);
      if (!data) {
        data = await zernio.api('GET', '/ads/campaigns/' + id + '/analytics', { query });
        zernio.cacheSet(ck, data, 60 * 1000);
      }
      res.json(data);
    } catch (err) { fail(res, err); }
  });

  // ── Criação de campanha completa (vídeo obrigatório no TikTok) ────────────
  app.post('/api/ads/create', dashboardAuth, async (req, res) => {
    try {
      const st = zernio.getState(req.account.id);
      if (!st.accountId) return res.status(409).json({ error: 'Conecte sua conta TikTok Ads primeiro' });
      const b = req.body || {};
      const adAccountId = String(b.adAccountId || st.advertiserId || '').trim();
      if (!adAccountId) return res.status(400).json({ error: 'Selecione um advertiser (adAccountId)' });
      const name = String(b.name || '').trim().slice(0, 120);
      if (!name) return res.status(400).json({ error: 'Nome da campanha é obrigatório' });
      const goal = ['engagement', 'traffic', 'awareness', 'video_views', 'lead_generation', 'conversions', 'app_promotion'].includes(b.goal) ? b.goal : '';
      if (!goal) return res.status(400).json({ error: 'Objetivo (goal) inválido' });
      const videoUrl = String(b.videoUrl || '').trim();
      if (!/^https:\/\/[^\s]+/.test(videoUrl)) return res.status(400).json({ error: 'URL do vídeo é obrigatória (MP4 9:16, 5–60s, até 500 MB)' });
      const budgetAmount = Number(b.budgetAmount);
      if (!(budgetAmount > 0)) return res.status(400).json({ error: 'Orçamento inválido' });
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
        linkUrl: /^https?:\/\//.test(String(b.linkUrl || '')) ? String(b.linkUrl).trim().slice(0, 500) : undefined,
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
        if (!/^\d{4}-\d{2}-\d{2}/.test(String(b.endDate || ''))) return res.status(400).json({ error: 'Orçamento lifetime exige data de término (endDate)' });
        payload.endDate = String(b.endDate).slice(0, 24);
      }
      // Conversões: pixel numérico do TikTok obrigatório
      if (goal === 'conversions') {
        const pixelId = String((b.promotedObject || {}).pixelId || b.pixelId || '').trim();
        if (!/^\d{5,30}$/.test(pixelId)) {
          return res.status(400).json({ error: 'Objetivo Conversões exige o Pixel ID NUMÉRICO do TikTok (não o código alfanumérico do Events Manager)' });
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

      // Idempotency-Key evita campanha duplicada em retry de rede
      const idem = String(b.idempotencyKey || '').slice(0, 80) || undefined;
      const data = await zernio.api('POST', '/ads/create', {
        body: payload,
        timeoutMs: 120000, // upload de vídeo síncrono no TikTok pode demorar
        headers: idem ? { 'Idempotency-Key': idem } : undefined
      });
      zernio.cacheBust('tree:' + req.account.id);
      stats.logEvent('info', { acc: req.account.id, title: 'Campanha TikTok criada: ' + name });
      res.status(201).json(data);
    } catch (err) { fail(res, err); }
  });

  // ── Spark Ads (impulsionar vídeo orgânico) ────────────────────────────────
  app.post('/api/ads/boost', dashboardAuth, async (req, res) => {
    try {
      const st = zernio.getState(req.account.id);
      if (!st.accountId) return res.status(409).json({ error: 'Conecte sua conta TikTok Ads primeiro' });
      const b = req.body || {};
      const adAccountId = String(b.adAccountId || st.advertiserId || '').trim();
      if (!adAccountId) return res.status(400).json({ error: 'Selecione um advertiser (adAccountId)' });
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
      if (/^https?:\/\//.test(String(b.linkUrl || ''))) payload.linkUrl = String(b.linkUrl).trim().slice(0, 500);
      if (/^[A-Z_]{3,30}$/.test(String(b.callToAction || ''))) payload.callToAction = b.callToAction;
      const countries = Array.isArray(b.countries)
        ? b.countries.map((c) => String(c || '').trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)).slice(0, 30) : [];
      if (countries.length) payload.targeting = Object.assign({}, payload.targeting, { countries });

      const data = await zernio.api('POST', '/ads/boost', { body: payload, timeoutMs: 120000 });
      zernio.cacheBust('tree:' + req.account.id);
      stats.logEvent('info', { acc: req.account.id, title: 'Spark Ad criado: ' + name });
      res.status(201).json(data);
    } catch (err) { fail(res, err); }
  });

  // ── Pausar/ativar campanhas em lote ───────────────────────────────────────
  app.post('/api/ads/campaigns/bulk-status', dashboardAuth, async (req, res) => {
    try {
      const st = zernio.getState(req.account.id);
      if (!st.accountId) return res.status(409).json({ error: 'Conecte sua conta TikTok Ads primeiro' });
      const b = req.body || {};
      const status = b.status === 'paused' ? 'paused' : b.status === 'active' ? 'active' : '';
      if (!status) return res.status(400).json({ error: 'status deve ser active ou paused' });
      const campaigns = (Array.isArray(b.campaigns) ? b.campaigns : []).slice(0, 50)
        .map((c) => ({ platformCampaignId: String((c || {}).platformCampaignId || '').slice(0, 60), platform: 'tiktok' }))
        .filter((c) => c.platformCampaignId);
      if (!campaigns.length) return res.status(400).json({ error: 'Nenhuma campanha informada' });
      const data = await zernio.api('POST', '/ads/campaigns/bulk-status', { body: { status, campaigns } });
      zernio.cacheBust('tree:' + req.account.id);
      stats.logEvent('info', { acc: req.account.id, title: 'Campanhas TikTok ' + (status === 'paused' ? 'pausadas' : 'ativadas') + ': ' + campaigns.length });
      res.json(data);
    } catch (err) { fail(res, err); }
  });

  // ── Duplicar campanha (cópia nasce pausada) ───────────────────────────────
  app.post('/api/ads/campaigns/:id/duplicate', dashboardAuth, async (req, res) => {
    try {
      const st = zernio.getState(req.account.id);
      if (!st.accountId) return res.status(409).json({ error: 'Conecte sua conta TikTok Ads primeiro' });
      const id = encodeURIComponent(String(req.params.id || ''));
      const data = await zernio.api('POST', '/ads/campaigns/' + id + '/duplicate', {
        body: { platform: 'tiktok', deepCopy: true, statusOption: 'PAUSED', renameStrategy: 'ONLY_TOP_LEVEL_RENAME', renameSuffix: ' (cópia)' },
        timeoutMs: 120000
      });
      zernio.cacheBust('tree:' + req.account.id);
      stats.logEvent('info', { acc: req.account.id, title: 'Campanha TikTok duplicada', ref: String(req.params.id || '') });
      res.json(data);
    } catch (err) { fail(res, err); }
  });

  // Palavras reservadas de /api/ads/* que as rotas genéricas :adId NÃO podem
  // capturar (Express casa na ordem de registro; alerts/library vêm depois).
  const RESERVED_AD_IDS = new Set(['alerts', 'library', 'roas', 'identity', 'upload', 'status', 'accounts', 'tree', 'campaigns', 'create', 'boost', 'connect', 'connected', 'disconnect']);

  // ── Atualizar um anúncio (status/budget/creative) ─────────────────────────
  app.put('/api/ads/:adId', dashboardAuth, async (req, res, next) => {
    if (RESERVED_AD_IDS.has(String(req.params.adId))) return next();
    try {
      const st = zernio.getState(req.account.id);
      if (!st.accountId) return res.status(409).json({ error: 'Conecte sua conta TikTok Ads primeiro' });
      const b = req.body || {};
      const payload = {};
      if (['active', 'paused'].includes(b.status)) payload.status = b.status;
      if (b.budget && Number(b.budget.amount) > 0) {
        payload.budget = { amount: Number(b.budget.amount), type: b.budget.type === 'lifetime' ? 'lifetime' : 'daily' };
      }
      if (b.creative && typeof b.creative === 'object') {
        const c = {};
        if (typeof b.creative.body === 'string' && b.creative.body.trim()) c.body = b.creative.body.trim().slice(0, 100);
        if (/^https?:\/\//.test(String(b.creative.linkUrl || ''))) c.linkUrl = String(b.creative.linkUrl).trim().slice(0, 500);
        if (/^https:\/\//.test(String(b.creative.videoUrl || ''))) c.videoUrl = String(b.creative.videoUrl).trim().slice(0, 500);
        if (Object.keys(c).length) payload.creative = c;
      }
      if (!Object.keys(payload).length) return res.status(400).json({ error: 'Nada para atualizar' });
      const id = encodeURIComponent(String(req.params.adId || ''));
      const data = await zernio.api('PUT', '/ads/' + id, { body: payload, timeoutMs: 120000 });
      zernio.cacheBust('tree:' + req.account.id);
      res.json(data);
    } catch (err) { fail(res, err); }
  });

  // ── Cancelar um anúncio (preservado para histórico) ───────────────────────
  app.delete('/api/ads/:adId', dashboardAuth, async (req, res, next) => {
    if (RESERVED_AD_IDS.has(String(req.params.adId))) return next();
    try {
      const st = zernio.getState(req.account.id);
      if (!st.accountId) return res.status(409).json({ error: 'Conecte sua conta TikTok Ads primeiro' });
      const id = encodeURIComponent(String(req.params.adId || ''));
      const data = await zernio.api('DELETE', '/ads/' + id);
      zernio.cacheBust('tree:' + req.account.id);
      stats.logEvent('warn', { acc: req.account.id, title: 'Anúncio TikTok cancelado', ref: String(req.params.adId || '') });
      res.json(data);
    } catch (err) { fail(res, err); }
  });

  // ── Brand Identity (nome + avatar exibidos no anúncio) ────────────────────
  app.patch('/api/ads/identity', dashboardAuth, async (req, res) => {
    try {
      const st = zernio.getState(req.account.id);
      if (!st.accountId) return res.status(409).json({ error: 'Conecte sua conta TikTok Ads primeiro' });
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

  // ── ROAS/CPA — cruza o gasto do TikTok com as VENDAS REAIS dos gateways ───
  // Gasto: /ads/tree com timeIncrement=1 (série diária somada entre campanhas).
  // Receita: leads convertidos (stage=purchased) da própria conta no período —
  // a mesma fonte da aba Visão Geral, então os números batem entre abas.
  app.get('/api/ads/roas', dashboardAuth, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const st = zernio.getState(req.account.id);
      if (!st.accountId) return res.status(409).json({ error: 'Conecte sua conta TikTok Ads primeiro' });
      const q = req.query || {};
      const today = new Date();
      const defFrom = new Date(today.getTime() - 6 * 864e5);
      const iso = (d) => d.toISOString().slice(0, 10);
      const fromDate = /^\d{4}-\d{2}-\d{2}$/.test(String(q.fromDate || '')) ? q.fromDate : iso(defFrom);
      const toDate = /^\d{4}-\d{2}-\d{2}$/.test(String(q.toDate || '')) ? q.toDate : iso(today);

      const ck = 'roas:' + req.account.id + ':' + fromDate + ':' + toDate;
      let out = zernio.cacheGet(ck);
      if (!out) {
        // 1) Gasto do TikTok por dia (todas as campanhas do advertiser)
        const tree = await zernio.api('GET', '/ads/tree', {
          query: {
            accountId: st.accountId, platform: 'tiktok',
            adAccountId: st.advertiserId || undefined,
            fromDate, toDate, timeIncrement: 1, limit: 50
          }
        });
        const spendByDay = {}; // 'YYYY-MM-DD' → gasto (moeda do advertiser)
        let spend = 0, conversions = 0, currency = null;
        (tree.campaigns || []).forEach((c) => {
          if (!currency && c.currency) currency = c.currency;
          const m = c.metrics || {};
          spend += Number(m.spend) || 0;
          conversions += Number(m.conversions) || 0;
          (c.daily || []).forEach((d) => {
            const day = String(d.date || d.dateStart || d.date_start || d.day || '').slice(0, 10);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
            spendByDay[day] = (spendByDay[day] || 0) + (Number(d.spend) || 0);
          });
        });

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
        out = {
          fromDate, toDate, currency: currency || 'EUR',
          spend: +spend.toFixed(2), conversions,
          revenueCents, sales,
          roas: spend > 0 ? +(revenue / spend).toFixed(2) : null,
          cpa: sales > 0 && spend > 0 ? +(spend / sales).toFixed(2) : null,
          daily
        };
        zernio.cacheSet(ck, out, 60 * 1000);
      }
      res.json(out);
    } catch (err) { fail(res, err); }
  });

  // ── Biblioteca de criativos — vídeos já enviados ao Vercel Blob ────────────
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

  // ── Alertas de performance ─────────────────────────────────────────────────
  // Config por conta (junto do estado zernioAds). Regras:
  //  • gasto sem conversão: campanha ativa gastou ≥ X no período sem converter
  //  • CPA estourado: gasto/conversões > teto definido
  // A varredura pega carona nas chamadas do painel (throttle 30min por conta) e
  // notifica via Pushcut (mesmo canal "Aprovada" já configurado pelo usuário).
  const ALERT_DEFAULTS = { enabled: false, spendNoConv: 20, cpaMax: 0, lookbackDays: 2 };
  const alertLastRun = new Map();   // accId → timestamp da última varredura
  const alertCooldown = new Map();  // accId:campanha:regra → timestamp do último aviso

  function getAlertCfg(accId) {
    return Object.assign({}, ALERT_DEFAULTS, zernio.getState(accId).alerts || {});
  }

  async function runAlertSweep(accId, { force } = {}) {
    const cfg = getAlertCfg(accId);
    if (!cfg.enabled && !force) return { findings: [], skipped: true };
    const st = zernio.getState(accId);
    if (!st.accountId) return { findings: [], skipped: true };

    const iso = (d) => d.toISOString().slice(0, 10);
    const to = new Date();
    const from = new Date(to.getTime() - Math.max(1, cfg.lookbackDays) * 864e5);
    const tree = await zernio.api('GET', '/ads/tree', {
      query: {
        accountId: st.accountId, platform: 'tiktok',
        adAccountId: st.advertiserId || undefined,
        status: 'active', fromDate: iso(from), toDate: iso(to), limit: 50
      }
    });

    const findings = [];
    (tree.campaigns || []).forEach((c) => {
      const m = c.metrics || {};
      const spend = Number(m.spend) || 0;
      const conv = Number(m.conversions) || 0;
      const name = c.campaignName || c.platformCampaignId;
      if (cfg.spendNoConv > 0 && conv === 0 && spend >= cfg.spendNoConv) {
        findings.push({
          rule: 'spend_no_conv', campaignId: c.platformCampaignId, campaignName: name,
          spend: +spend.toFixed(2), conversions: 0,
          text: '"' + name + '" gastou ' + spend.toFixed(2) + ' ' + (c.currency || '') + ' nos últimos ' + cfg.lookbackDays + 'd sem nenhuma conversão.'
        });
      }
      if (cfg.cpaMax > 0 && conv > 0 && spend / conv > cfg.cpaMax) {
        findings.push({
          rule: 'cpa_max', campaignId: c.platformCampaignId, campaignName: name,
          spend: +spend.toFixed(2), conversions: conv, cpa: +(spend / conv).toFixed(2),
          text: '"' + name + '" está com CPA de ' + (spend / conv).toFixed(2) + ' ' + (c.currency || '') + ' (teto: ' + cfg.cpaMax + ').'
        });
      }
    });

    // notifica com cooldown de 6h por campanha+regra (não vira spam)
    const { sendPushcut } = require('./pushcut');
    for (const f of findings) {
      const key = accId + ':' + f.campaignId + ':' + f.rule;
      const last = alertCooldown.get(key) || 0;
      if (Date.now() - last < 6 * 3600e3) { f.muted = true; continue; }
      alertCooldown.set(key, Date.now());
      stats.logEvent('warn', { acc: accId, title: '[tiktok-ads] ' + f.text });
      sendPushcut('Aprovada', { title: 'TikTok Ads: atenção', text: f.text, sound: 'system' }, accId).catch(() => {});
    }
    return { findings, checkedAt: new Date().toISOString() };
  }

  // varredura oportunista: pega carona no polling do painel (nunca derruba a
  // request). Chamada explicitamente pelas rotas de leitura mais frequentes —
  // um app.use registrado aqui não funcionaria (Express roda na ordem de
  // registro e as rotas acima já terminaram a resposta).
  function maybeSweep(accId) {
    try {
      if (!accId || !getAlertCfg(accId).enabled) return;
      const last = alertLastRun.get(accId) || 0;
      if (Date.now() - last > 30 * 60e3) {
        alertLastRun.set(accId, Date.now());
        runAlertSweep(accId).catch(() => {});
      }
    } catch (_) { /* nunca bloqueia a rota que pegou a carona */ }
  }
  adsSweepHook.fn = maybeSweep;

  app.get('/api/ads/alerts', dashboardAuth, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(getAlertCfg(req.account.id));
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
      zernio.setState(req.account.id, { alerts: cfg });
      res.json(cfg);
    } catch (err) { fail(res, err); }
  });

  // “verificar agora” — roda a varredura na hora e devolve o que encontrou
  app.post('/api/ads/alerts/check', dashboardAuth, async (req, res) => {
    try {
      alertLastRun.set(req.account.id, Date.now());
      const result = await runAlertSweep(req.account.id, { force: true });
      res.json(result);
    } catch (err) { fail(res, err); }
  });
};
