// F5 — Spark Ads via Pipeboard.
// Cobre: descoberta (identidades ranqueadas, posts com itemId), criação
// composta (identity + tiktok_item_id, sem upload), PAUSED por construção,
// pausa de órfã em falha parcial, validações que NÃO tocam a plataforma e o
// contrato da rota (Spark Code cru → 422 com código estável).
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

process.env.PIPEBOARD_API_KEY = 'test-key';

const providerPath = require.resolve('../ads-provider.js');
const pipeboardPath = require.resolve('../pipeboard-mcp.js');

// Stub do wrapper MCP: intercepta callTool e grava a sequência de chamadas.
const calls = [];
let responders = {};
require.cache[pipeboardPath] = {
  id: pipeboardPath,
  filename: pipeboardPath,
  loaded: true,
  exports: {
    enabled: true,
    callTool: async (name, args) => {
      calls.push({ name, args });
      if (responders[name]) return responders[name](args);
      throw new Error('tool inesperado no teste: ' + name);
    },
    listTools: async () => ({ tools: [] }),
  },
};
delete require.cache[providerPath];
const provider = require(providerPath);

function resetCalls() { calls.length = 0; }
function callNames() { return calls.map((c) => c.name); }

const baseResponders = () => ({
  get_tiktok_advertiser_info: () => ({ advertiser: { name: 'Conta', currency: 'EUR', timezone: 'Europe/Lisbon', status: 'STATUS_ENABLE' } }),
  get_tiktok_targeting_regions: () => ({ regions: [{ region_code: 'PT', location_id: '620' }, { region_code: 'BR', location_id: '76' }] }),
  create_tiktok_campaign: () => ({ campaign_id: 'spark-camp-1' }),
  create_tiktok_adgroup: () => ({ adgroup_id: 'spark-ag-1' }),
  create_tiktok_ad: () => ({ ad_id: 'spark-ad-1' }),
  update_tiktok_campaign_status: () => ({ ok: true }),
});
const conversion = {
  goal: 'conversions',
  linkUrl: 'https://loja.example/produto',
  pixelId: '12345678',
  customEventType: 'ON_WEB_ORDER',
};

(async () => {
  // ── 1. listSparkIdentities: só tipos Spark-utilizáveis, ranqueados ─────────
  resetCalls();
  responders = {
    get_tiktok_identities: () => ({
      identities: [
        { identity_id: 'i-auth', identity_type: 'AUTH_CODE', display_name: 'Criador X' },
        { identity_id: 'i-cust', identity_type: 'CUSTOMIZED_USER', display_name: 'Marca' },
        { identity_id: 'i-tt', identity_type: 'TT_USER', display_name: 'Conta TT' },
        { identity_id: 'i-bc', identity_type: 'BC_AUTH_TT', identity_authorized_bc_id: 'bc-9' },
      ],
    }),
  };
  const ids = await provider.listSparkIdentities('adv1');
  assert.deepStrictEqual(ids.map((i) => i.identityType), ['TT_USER', 'AUTH_CODE', 'BC_AUTH_TT'],
    'CUSTOMIZED_USER fica de fora (não-Spark) e TT_USER vem primeiro');
  assert.strictEqual(ids[2].bcId, 'bc-9', 'BC_AUTH_TT carrega o bcId');
  console.log('ok 1 - listSparkIdentities filtra e ranqueia');

  // ── 2. listIdentityVideos: itemId extraído; BC exige bcId ──────────────────
  resetCalls();
  responders = {
    get_tiktok_identity_videos: (args) => {
      assert.strictEqual(args.identity_type, 'TT_USER');
      return { videos: [{ item_id: 'post-7', text: 'meu viral', video_cover_url: 'https://c/x.jpg', duration: 21.4 }] };
    },
  };
  const vids = await provider.listIdentityVideos('adv1', 'i-tt', 'TT_USER');
  assert.strictEqual(vids[0].itemId, 'post-7');
  assert.strictEqual(vids[0].text, 'meu viral');
  await assert.rejects(
    () => provider.listIdentityVideos('adv1', 'i-bc', 'BC_AUTH_TT'),
    /Business Center/,
    'BC_AUTH_TT sem bcId é rejeitado ANTES de chamar a plataforma'
  );
  console.log('ok 2 - listIdentityVideos extrai itemId e valida BC');

  // ── 3. createSparkAd caminho feliz: sem upload, PAUSED, item_id no ad ──────
  resetCalls();
  responders = baseResponders();
  const result = await provider.createSparkAd('adv1', {
    ...conversion, name: 'Spark viral',
    budgetAmount: 50, budgetType: 'daily',
    identityId: 'i-tt', identityType: 'TT_USER', itemId: 'post-7',
    countries: ['BR'],
  });
  assert.strictEqual(result.campaignId, 'spark-camp-1');
  assert.strictEqual(result.adId, 'spark-ad-1');
  assert.ok(!callNames().includes('upload_tiktok_video'), 'Spark NÃO faz upload — o criativo é o post orgânico');
  const adCall = calls.find((c) => c.name === 'create_tiktok_ad');
  assert.strictEqual(adCall.args.tiktok_item_id, 'post-7', 'tiktok_item_id obrigatório vai no create_tiktok_ad');
  assert.strictEqual(adCall.args.identity_type, 'TT_USER');
  assert.strictEqual(adCall.args.status, 'PAUSED', 'Spark ad SEMPRE nasce PAUSED');
  assert.ok(!callNames().includes('get_tiktok_identities'), 'identidade veio da UI — não re-lista no create');
  console.log('ok 3 - createSparkAd compõe sem upload e nasce PAUSED');

  // ── 3b. Orçamento total exige fim futuro e o envia ao conjunto ─────────────
  resetCalls();
  responders = baseResponders();
  await provider.createSparkAd('adv1', {
    ...conversion, name: 'Spark total',
    budgetAmount: 250, budgetType: 'lifetime', endDate: '2099-12-31',
    identityId: 'i-tt', identityType: 'TT_USER', itemId: 'post-8',
  });
  const lifetimeGroup = calls.find((c) => c.name === 'create_tiktok_adgroup');
  assert.strictEqual(lifetimeGroup.args.budget_mode, 'BUDGET_MODE_TOTAL');
  assert.strictEqual(lifetimeGroup.args.schedule_end_time, '2099-12-31 23:59:59');
  console.log('ok 3b - Spark total envia schedule_end_time');

  // ── 4. Falha parcial pausa a campanha órfã ─────────────────────────────────
  resetCalls();
  responders = { ...baseResponders(), create_tiktok_ad: () => { throw new Error('review rejected'); } };
  await assert.rejects(
    () => provider.createSparkAd('adv1', {
      ...conversion, name: 'Spark falha', budgetAmount: 50, budgetType: 'daily',
      identityId: 'i-tt', identityType: 'TT_USER', itemId: 'post-9',
    }),
    (err) => {
      assert.ok(err.createdIds && err.createdIds.campaignId === 'spark-camp-1', 'erro carrega createdIds');
      return true;
    }
  );
  assert.ok(callNames().includes('update_tiktok_campaign_status'), 'campanha órfã foi pausada (best-effort)');
  console.log('ok 4 - falha parcial pausa a órfã e propaga createdIds');

  // ── 5. Validações baratas NÃO tocam a plataforma ───────────────────────────
  resetCalls();
  responders = {};
  await assert.rejects(() => provider.createSparkAd('adv1', { ...conversion, name: 'x', budgetAmount: 49.99, identityId: 'i', identityType: 'TT_USER', itemId: 'p' }), /orçamento mínimo/i);
  await assert.rejects(() => provider.createSparkAd('adv1', { ...conversion, name: 'x', budgetAmount: 50, identityType: 'TT_USER', itemId: '' }), /identityId e itemId/);
  await assert.rejects(() => provider.createSparkAd('adv1', { ...conversion, name: 'x', budgetAmount: 50, identityId: 'i', identityType: 'BANANA', itemId: 'p' }), /identityType/);
  await assert.rejects(() => provider.createSparkAd('adv1', { ...conversion, name: 'x', budgetAmount: 50, identityId: 'i-bc', identityType: 'BC_AUTH_TT', itemId: 'p' }), /Business Center/);
  await assert.rejects(() => provider.createSparkAd('adv1', { ...conversion, name: 'x', budgetAmount: 50, budgetType: 'lifetime', endDate: '2020-01-01', identityId: 'i', identityType: 'TT_USER', itemId: 'p' }), /data de término futura/);
  await assert.rejects(() => provider.createSparkAd('adv1', { ...conversion, name: 'x', goal: 'engagement', budgetAmount: 50, identityId: 'i', identityType: 'TT_USER', itemId: 'p' }), /não suportado para Spark/);
  assert.strictEqual(calls.length, 0, 'nenhuma chamada à plataforma nas validações');
  console.log('ok 5 - validações não tocam a plataforma');

  // ── 6. Contrato da rota /boost e das rotas de descoberta ───────────────────
  const routes = fs.readFileSync(path.join(__dirname, '..', 'ads-routes.js'), 'utf8');
  assert.match(routes, /app\.get\('\/api\/ads\/spark\/identities'[\s\S]*?listSparkIdentities/);
  assert.match(routes, /app\.get\('\/api\/ads\/spark\/videos'[\s\S]*?listIdentityVideos/);
  assert.match(routes, /app\.post\('\/api\/ads\/boost'[\s\S]*?SPARK_CODE_REDEEM_REQUIRED/, 'Spark Code cru → 422 com código estável');
  assert.match(routes, /app\.post\('\/api\/ads\/boost'[\s\S]*?killSwitchActive/, 'kill switch preservado');
  assert.match(routes, /app\.post\('\/api\/ads\/boost'[\s\S]*?isDryRun/, 'dry-run preservado');
  assert.match(routes, /app\.post\('\/api\/ads\/boost'[\s\S]*?createSparkAd/, 'rota usa o provider — nunca callTool direto');
  assert.ok(!/zernio\.api\('POST', '\/ads\/boost'/.test(routes), 'chamada zernio do boost removida');
  console.log('ok 6 - contrato das rotas Spark');

  console.log('\nads-spark: todos os testes passaram');
})().catch((err) => {
  console.error('FALHOU:', err && err.message);
  process.exit(1);
});
