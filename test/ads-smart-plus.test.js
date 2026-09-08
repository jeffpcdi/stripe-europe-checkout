'use strict';
/*
 * Smart+ — gestão (listar/pausar/escalar) + recurso de anúncio reprovado.
 * As escritas (status/appeal) precisam passar pelos guardrails (kill switch,
 * dry-run) e validar entradas ANTES de tocar o TikTok. O appeal só existe para
 * anúncio Smart+ (a API não tem appeal de conta).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const provider = require('../ads-provider');

let n = 0;
function ok(cond, label) { assert.ok(cond, label); n++; console.log('  ✓ ' + label); }
async function throws(fn, status, label) {
  try { await fn(); ok(false, label + ' (deveria lançar)'); }
  catch (e) { assert.strictEqual(e.status, status, label + ' status=' + e.status); n++; console.log('  ✓ ' + label); }
}

console.log('Provider — validação antes da rede');
(async () => {
  const futureDate = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
  const baseCreate = {
    name: 'x', goal: 'conversions', videoUrl: 'https://a/v.mp4', coverUrl: 'https://cdn.example/c.jpg',
    linkUrl: 'https://a.example/offer', budgetAmount: 50, endDate: futureDate,
    pixelId: '12345678', customEventType: 'ON_WEB_ORDER',
  };
  await throws(() => provider.listSmartPlusCampaigns(''), 400, 'listar exige advertiser');
  await throws(() => provider.setSmartPlusCampaignStatus('123', [], 'paused'), 400, 'status exige ao menos 1 campanha');
  await throws(() => provider.setSmartPlusCampaignStatus('123', ['c1'], 'xxx'), 400, 'status inválido é rejeitado');
  await throws(() => provider.appealSmartPlusAd('123', ''), 400, 'appeal exige o ID do anúncio');

  console.log('Criação Smart+ — validação antes da rede');
  await throws(() => provider.createSmartPlusCampaign('123', { ...baseCreate, goal: undefined }), 400, 'objetivo inválido reprova');
  await throws(() => provider.createSmartPlusCampaign('123', { ...baseCreate, videoUrl: 'ftp://x' }), 400, 'vídeo não-https reprova');
  await throws(() => provider.createSmartPlusCampaign('123', { ...baseCreate, coverUrl: 'http://private/c.jpg' }), 400, 'Smart+ valida capa personalizada');
  await throws(() => provider.createSmartPlusCampaign('123', { ...baseCreate, linkUrl: '' }), 400, 'Smart+ exige destino');
  await throws(() => provider.createSmartPlusCampaign('123', { ...baseCreate, budgetAmount: 49.99 }), 400, 'Smart+ exige orçamento mínimo de 50');
  await throws(() => provider.createSmartPlusCampaign('123', { ...baseCreate, endDate: '' }), 400, 'Smart+ exige data de término (orçamento total)');
  await throws(() => provider.createSmartPlusCampaign('123', { ...baseCreate, endDate: '2020-01-01' }), 400, 'Smart+ rejeita término no passado');
  await throws(() => provider.createSmartPlusCampaign('123', { ...baseCreate, pixelId: '' }), 400, 'conversões exigem pixel numérico');

  console.log('Rotas — guardrails e allowlist');
  const routes = fs.readFileSync(path.join(__dirname, '..', 'ads-routes.js'), 'utf8');
  ok(/app\.get\('\/api\/ads\/smart-plus'/.test(routes), 'GET /smart-plus registrado');
  const createBody = (routes.match(/app\.post\('\/api\/ads\/smart-plus'[\s\S]*?app\.post\('\/api\/ads\/smart-plus\/:campaignId\/status'/) || [''])[0];
  ok(/killSwitchActive/.test(createBody), 'criação respeita kill switch');
  ok(/isDryRun/.test(createBody), 'criação respeita dry-run');
  ok(/createSmartPlusCampaign/.test(createBody), 'criação chama o composto do provider');
  ok(/requireCampaignPixel/.test(createBody) && /customEventType = 'ON_WEB_ORDER'/.test(createBody), 'rota usa o Pixel central e o evento Compra');
  const providerSource = fs.readFileSync(path.join(__dirname, '..', 'ads-provider.js'), 'utf8');
  const providerCreate = (providerSource.match(/async function createSmartPlusCampaign[\s\S]*?\n}\n/) || [''])[0];
  ok(/uploadImage\(adv, s\.coverUrl \|\| videoAsset.coverUrl/.test(providerCreate), 'capa é enviada ao TikTok');
  ok(/image_info: \[\{ web_uri: coverId }\]/.test(providerCreate), 'asset Smart+ recebe image_info obrigatório');
  // isola o corpo de cada rota até a próxima registrada (não conta em outra rota)
  const statusBody = (routes.match(/app\.post\('\/api\/ads\/smart-plus\/:campaignId\/status'[\s\S]*?app\.post\('\/api\/ads\/smart-plus\/ads/) || [''])[0];
  const appealBody = (routes.match(/app\.post\('\/api\/ads\/smart-plus\/ads\/:adId\/appeal'[\s\S]*?\n  \/\/ ── Catálogos/) || [''])[0];
  ok(/killSwitchActive/.test(statusBody), 'status respeita kill switch');
  ok(/isDryRun/.test(statusBody), 'status respeita dry-run');
  ok(/killSwitchActive/.test(appealBody), 'appeal respeita kill switch');
  ok(/isDryRun/.test(appealBody), 'appeal respeita dry-run');
  ok(/RESERVED_AD_IDS[\s\S]{0,400}'smart-plus'/.test(routes), "'smart-plus' está na allowlist de rotas reservadas");

  console.log('\nads-smart-plus: ' + n + ' asserts OK');
})().catch((e) => { console.error(e); process.exit(1); });
