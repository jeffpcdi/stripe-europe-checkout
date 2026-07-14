// Testes da F1 — criação composta de campanha via Pipeboard (createFullAd):
// orquestração campaign→adgroup→upload→ad, identidade obrigatória vinda de
// get_tiktok_identities, targeting por location_ids, criação SEMPRE em PAUSED,
// pausa da campanha órfã em falha parcial, e contrato da rota /api/ads/create.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Stub do wrapper MCP ANTES de usar o provider: o provider guarda a referência
// do módulo e chama pipeboard.callTool em runtime, então o patch pega tudo
// (inclusive getAdvertiserInfo/setCampaignStatus internos).
const mcp = require('../pipeboard-mcp');
const toolCalls = [];
let failOn = null; // nome de tool que deve falhar (simula erro do TikTok)
const responses = {
  get_tiktok_advertiser_info: () => ({ advertiser: { name: 'Conta Teste', currency: 'EUR', timezone: 'Europe/Lisbon', status: 'STATUS_ENABLE' } }),
  get_tiktok_identities: () => ({
    identities: [
      { identity_type: 'TT_USER', identity_id: 'tt_1' }, // Spark-only: NÃO pode ser escolhida
      { identity_type: 'CUSTOMIZED_USER', identity_id: 'cu_1' },
    ],
  }),
  get_tiktok_targeting_regions: () => ({ regions: [{ region_code: 'PT', location_id: '620' }, { region_code: 'BR', location_id: '76' }] }),
  create_tiktok_campaign: () => ({ campaign_id: '111' }),
  create_tiktok_adgroup: () => ({ adgroup_id: '222' }),
  upload_tiktok_video: () => ({ video_id: 'v_1', displayable: true }),
  create_tiktok_ad: () => ({ ad_id: '333' }),
  update_tiktok_ad_status: () => ({ ok: true }),
  update_tiktok_campaign_status: () => ({ ok: true }),
};
mcp.callTool = async (name, args) => {
  toolCalls.push({ name, args });
  if (failOn === name) { const e = new Error('TikTok recusou ' + name + ' (simulado)'); e.status = 502; throw e; }
  const fn = responses[name];
  if (!fn) throw new Error('tool inesperada no teste: ' + name);
  return fn(args);
};

const provider = require('../ads-provider');
const { ageGroupsFor, GOAL_MAP } = provider._internals;

function callsTo(name) { return toolCalls.filter((c) => c.name === name); }
function resetCalls() { toolCalls.length = 0; failOn = null; }

const baseSpec = {
  name: 'Campanha F1', goal: 'traffic', videoUrl: 'https://blob.example/video.mp4',
  budgetAmount: 20, budgetType: 'daily', body: 'Texto do anúncio',
  linkUrl: 'https://example.com/lp', countries: ['PT'], ageMin: 18, ageMax: 34,
};

(async () => {
  // ── caminho feliz: 4 creates encadeados, tudo PAUSED ───────────────────────
  {
    resetCalls();
    const out = await provider.createFullAd('adv1', { ...baseSpec });
    assert.strictEqual(out.campaignId, '111');
    assert.strictEqual(out.adGroupId, '222');
    assert.strictEqual(out.videoId, 'v_1');
    assert.strictEqual(out.adId, '333');

    const camp = callsTo('create_tiktok_campaign')[0].args;
    assert.strictEqual(camp.objective_type, 'TRAFFIC', 'goal traffic → TRAFFIC');
    assert.strictEqual(camp.pixel_id, undefined, 'sem pixel fora de conversões');

    const ag = callsTo('create_tiktok_adgroup')[0].args;
    assert.deepStrictEqual(ag.targeting.location_ids, ['620'], 'PT → location_id 620 (nunca o código do país)');
    assert.deepStrictEqual(ag.targeting.age_groups, ['AGE_18_24', 'AGE_25_34'], '18–34 → dois buckets');
    assert.strictEqual(ag.optimization_goal, 'CLICK');
    assert.strictEqual(ag.budget_mode, 'BUDGET_MODE_DAY');
    assert.strictEqual(ag.budget, 20);
    assert.match(ag.schedule_start_time, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, 'schedule no formato do advertiser');
    assert.strictEqual(ag.bid_type, 'BID_TYPE_NO_BID');

    const ad = callsTo('create_tiktok_ad')[0].args;
    assert.strictEqual(ad.status, 'PAUSED', 'anúncio SEMPRE nasce PAUSED');
    assert.strictEqual(ad.identity_id, 'cu_1', 'CUSTOMIZED_USER preferida (TT_USER é Spark-only)');
    assert.strictEqual(ad.identity_type, 'CUSTOMIZED_USER');
    assert.strictEqual(ad.video_id, 'v_1');
    assert.strictEqual(ad.landing_page_url, 'https://example.com/lp');

    assert.strictEqual(callsTo('update_tiktok_ad_status').length, 0, 'default paused: sem ENABLE no fim');
    assert.ok(out.warnings.some((w) => /PAUSED/.test(w)), 'warning avisa que ficou pausado');
  }

  // ── status active: liga o anúncio só no FIM da composição ─────────────────
  {
    resetCalls();
    await provider.createFullAd('adv1', { ...baseSpec, status: 'active' });
    const enables = callsTo('update_tiktok_ad_status');
    assert.strictEqual(enables.length, 1, 'com status active há exatamente 1 enable');
    assert.strictEqual(enables[0].args.operation_status, 'ENABLE');
    // e o enable veio DEPOIS do create_tiktok_ad
    const idxAd = toolCalls.findIndex((c) => c.name === 'create_tiktok_ad');
    const idxEn = toolCalls.findIndex((c) => c.name === 'update_tiktok_ad_status');
    assert.ok(idxEn > idxAd, 'enable acontece após o anúncio existir');
  }

  // ── falha no adgroup: campanha órfã é PAUSADA e o erro carrega step+ids ────
  {
    resetCalls();
    failOn = 'create_tiktok_adgroup';
    let err = null;
    try { await provider.createFullAd('adv1', { ...baseSpec }); } catch (e) { err = e; }
    assert.ok(err, 'falha propaga');
    assert.strictEqual(err.createdIds.campaignId, '111', 'erro informa o que já foi criado');
    assert.strictEqual(err.createdIds.adId, undefined, 'anúncio nunca chegou a existir');
    const pauses = callsTo('update_tiktok_campaign_status');
    assert.strictEqual(pauses.length, 1, 'campanha órfã foi pausada (não fica entregável)');
    assert.strictEqual(pauses[0].args.operation_status, 'DISABLE');
    assert.strictEqual(callsTo('create_tiktok_ad').length, 0, 'composição parou no passo que falhou');
  }

  // ── validações ANTES de qualquer tool call (zero órfãos) ───────────────────
  {
    resetCalls();
    await assert.rejects(() => provider.createFullAd('adv1', { ...baseSpec, goal: 'app_promotion' }), /app_id/, 'app_promotion rejeitado com explicação (exige app_id)');
    await assert.rejects(() => provider.createFullAd('adv1', { ...baseSpec, goal: 'conversions', promotedObject: { pixelId: '12345678' } }), /customEventType|optimization_event/, 'CONVERT sem evento é rejeitado cedo');
    assert.strictEqual(toolCalls.length, 0, 'validação falha SEM tocar a plataforma');
  }

  // ── conversões: pixel + optimization_event na campanha e no adgroup ────────
  {
    resetCalls();
    await provider.createFullAd('adv1', { ...baseSpec, goal: 'conversions', promotedObject: { pixelId: '12345678', customEventType: 'COMPLETE_PAYMENT' } });
    const camp = callsTo('create_tiktok_campaign')[0].args;
    assert.strictEqual(camp.pixel_id, '12345678');
    assert.strictEqual(camp.optimization_event, 'COMPLETE_PAYMENT');
    const ag = callsTo('create_tiktok_adgroup')[0].args;
    assert.strictEqual(ag.optimization_goal, 'CONVERT');
    assert.strictEqual(ag.optimization_event, 'COMPLETE_PAYMENT');
  }

  // ── helpers puros ──────────────────────────────────────────────────────────
  assert.deepStrictEqual(ageGroupsFor(25, 44), ['AGE_25_34', 'AGE_35_44']);
  assert.strictEqual(ageGroupsFor(13, 100), undefined, 'faixa completa = sem segmentação por idade');
  assert.ok(GOAL_MAP.traffic && GOAL_MAP.conversions && !GOAL_MAP.app_promotion, 'mapa de objetivos coerente');

  // ── contrato da rota: /create usa o provider, não a Zernio ─────────────────
  {
    const routes = fs.readFileSync(path.join(__dirname, '..', 'ads-routes.js'), 'utf8');
    assert.match(routes, /pipeboard\.createFullAd\(/, 'rota /create chama provider.createFullAd');
    const createRoute = routes.slice(routes.indexOf("app.post('/api/ads/create'"), routes.indexOf("app.post('/api/ads/boost'"));
    assert.ok(!/zernio\.api\(/.test(createRoute), 'rota /create não chama mais zernio.api');
    assert.match(createRoute, /killSwitchActive/, 'kill switch continua na rota');
    assert.match(createRoute, /isDryRun/, 'dry-run continua na rota');
    assert.match(createRoute, /status: 'paused'/, 'rota cria SEMPRE em paused');
  }

  console.log('ads-create (F1): todos os testes passaram');
})().catch((e) => { console.error(e); process.exit(1); });
