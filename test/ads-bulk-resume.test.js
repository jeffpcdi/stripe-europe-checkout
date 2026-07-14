// Testes da F2 — retomada idempotente do bulk. O critério de aceitação é
// literal: "matar o processo no meio de um job e reiniciar NÃO pode duplicar
// campanha". Aqui o crash é simulado no nível determinístico: a 1ª tentativa
// falha no meio da composição (progresso parcial gravado), a 2ª tentativa
// (pós-"restart") retoma com resume — e create_tiktok_campaign NÃO pode ser
// chamado de novo. Cobre também a janela crash-antes-de-gravar (dedupeByName)
// e o curto-circuito de item já completo.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const mcp = require('../pipeboard-mcp');
const toolCalls = [];
let failOn = null;
const responses = {
  get_tiktok_advertiser_info: () => ({ advertiser: { name: 'Conta Teste', currency: 'EUR', timezone: 'Europe/Lisbon', status: 'STATUS_ENABLE' } }),
  get_tiktok_identities: () => ({ identities: [{ identity_type: 'CUSTOMIZED_USER', identity_id: 'cu_1' }] }),
  get_tiktok_targeting_regions: () => ({ regions: [{ region_code: 'PT', location_id: '620' }] }),
  get_tiktok_campaigns: () => ({ campaigns: [] }),
  create_tiktok_campaign: () => ({ campaign_id: '111' }),
  create_tiktok_adgroup: () => ({ adgroup_id: '222' }),
  upload_tiktok_video: () => ({ video_id: 'v_1', displayable: true }),
  create_tiktok_ad: () => ({ ad_id: '333' }),
  update_tiktok_campaign_status: () => ({ ok: true }),
};
mcp.callTool = async (name, args) => {
  toolCalls.push({ name, args });
  if (failOn === name) { const e = new Error('crash simulado em ' + name); e.status = 502; throw e; }
  const fn = responses[name];
  if (!fn) throw new Error('tool inesperada no teste: ' + name);
  return fn(args);
};

const provider = require('../ads-provider');

function callsTo(name) { return toolCalls.filter((c) => c.name === name); }
function resetCalls() { toolCalls.length = 0; failOn = null; }

const spec = {
  name: 'Bulk item 0', goal: 'traffic', videoUrl: 'https://blob.example/v.mp4',
  budgetAmount: 20, budgetType: 'daily', countries: ['PT'],
};

// "Neon" em memória: o mesmo papel do ads_bulk_progress (merge por item)
const progressStore = {};
function saveProgress(key) {
  return (ids) => { progressStore[key] = { ...(progressStore[key] || {}), ...ids }; };
}

(async () => {
  // ── CRITÉRIO DE ACEITAÇÃO: crash no meio → retry NÃO duplica campanha ──────
  {
    resetCalls();
    const key = 'job1:0';
    // Tentativa 1: "processo morre" durante o upload do vídeo (depois de
    // campanha e adgroup existirem e o progresso ter sido gravado).
    failOn = 'upload_tiktok_video';
    let err = null;
    try {
      await provider.createFullAd('adv1', spec, { resume: {}, dedupeByName: true, onProgress: saveProgress(key) });
    } catch (e) { err = e; }
    assert.ok(err, 'tentativa 1 falhou (crash simulado)');
    assert.deepStrictEqual(progressStore[key], { campaignId: '111', adGroupId: '222' }, 'progresso gravado ANTES do crash: campanha e adgroup');
    assert.strictEqual(callsTo('create_tiktok_campaign').length, 1, '1 campanha criada na tentativa 1');

    // "Restart": tentativa 2 com o progresso lido do store.
    failOn = null;
    const before = callsTo('create_tiktok_campaign').length;
    const out = await provider.createFullAd('adv1', spec, { resume: progressStore[key], dedupeByName: true, onProgress: saveProgress(key) });
    assert.strictEqual(callsTo('create_tiktok_campaign').length, before, 'ZERO novas chamadas de create_tiktok_campaign no retry — campanha NÃO duplicada');
    assert.strictEqual(callsTo('create_tiktok_adgroup').length, 1, 'adgroup também não é recriado');
    assert.strictEqual(out.campaignId, '111', 'retry devolve a MESMA campanha');
    assert.strictEqual(out.adId, '333', 'retry completa os passos que faltavam (upload + ad)');
    assert.deepStrictEqual(progressStore[key], { campaignId: '111', adGroupId: '222', videoId: 'v_1', adId: '333' }, 'progresso completo ao final');
    assert.ok(out.warnings.some((w) => /[Rr]etomado/.test(w)), 'resultado avisa que foi retomado');
  }

  // ── Janela crash-antes-de-gravar: dedupeByName reaproveita pelo nome ───────
  {
    resetCalls();
    // A campanha JÁ existe na plataforma (foi criada, mas o progresso não foi
    // gravado antes do crash). O resume vem vazio — o cinto é o nome exato.
    responses.get_tiktok_campaigns = () => ({ campaigns: [{ campaign_id: '999', campaign_name: 'Bulk item 0' }] });
    const out = await provider.createFullAd('adv1', spec, { resume: {}, dedupeByName: true, onProgress: async () => {} });
    assert.strictEqual(callsTo('create_tiktok_campaign').length, 0, 'nome exato já existe → NÃO cria campanha nova');
    assert.strictEqual(out.campaignId, '999', 'reaproveita a campanha existente');
    assert.ok(out.warnings.some((w) => /já existia/.test(w)), 'warning explica o reaproveitamento');
    responses.get_tiktok_campaigns = () => ({ campaigns: [] });
  }

  // ── dedupeByName NÃO vaza p/ a rota interativa (só o bulk pede) ────────────
  {
    resetCalls();
    responses.get_tiktok_campaigns = () => { throw new Error('não deveria listar campanhas sem dedupeByName'); };
    await provider.createFullAd('adv1', spec); // sem opts, como a rota /create chama
    assert.strictEqual(callsTo('get_tiktok_campaigns').length, 0, 'sem dedupeByName: zero listagens');
    responses.get_tiktok_campaigns = () => ({ campaigns: [] });
  }

  // ── Item já completo (crash entre o fim e o ack da fila) ───────────────────
  {
    resetCalls();
    const out = await provider.createFullAd('adv1', spec, {
      resume: { campaignId: '111', adGroupId: '222', videoId: 'v_1', adId: '333' },
    });
    assert.strictEqual(toolCalls.length, 0, 'item completo: ZERO chamadas à plataforma');
    assert.strictEqual(out.resumed, true, 'marcado como retomado');
    assert.strictEqual(out.campaignId, '111');
  }

  // ── Falha da listagem do dedupe não trava a criação (é cinto, não trava) ───
  {
    resetCalls();
    responses.get_tiktok_campaigns = () => { throw new Error('listagem fora do ar'); };
    const out = await provider.createFullAd('adv1', spec, { resume: {}, dedupeByName: true, onProgress: async () => {} });
    assert.strictEqual(out.campaignId, '111', 'listagem falhou → segue criando normalmente');
    responses.get_tiktok_campaigns = () => ({ campaigns: [] });
  }

  // ── Contrato do executor: bulk usa provider + progresso durável ────────────
  {
    const routes = fs.readFileSync(path.join(__dirname, '..', 'ads-routes.js'), 'utf8');
    const exec = routes.slice(routes.indexOf('async function processBulkItem'), routes.indexOf('bulk.startBulkWorker'));
    assert.match(exec, /pipeboard\.createFullAd\(/, 'executor do bulk usa provider.createFullAd');
    assert.match(exec, /adsOps\.getBulkProgress\(/, 'executor LÊ o progresso antes de criar (retomada)');
    assert.match(exec, /adsOps\.saveBulkProgress\(/, 'executor GRAVA o progresso a cada passo');
    assert.match(exec, /dedupeByName: true/, 'cinto extra ligado no bulk');
    const createBranch = exec.slice(0, exec.indexOf("task.kind === 'duplicate_same'"));
    assert.ok(!/zernio\.api\(/.test(createBranch), "branch 'create' não chama mais zernio.api");
    // Store durável existe de verdade
    const store = fs.readFileSync(path.join(__dirname, '..', 'ads-ops-store.js'), 'utf8');
    assert.match(store, /CREATE TABLE IF NOT EXISTS ads_bulk_progress/, 'tabela de progresso no schema');
    assert.match(store, /DO UPDATE SET created = ads_bulk_progress\.created \|\| /, 'progresso é MERGE (não sobrescreve passos anteriores)');
  }

  console.log('ads-bulk-resume (F2): todos os testes passaram');
})().catch((e) => { console.error(e); process.exit(1); });
