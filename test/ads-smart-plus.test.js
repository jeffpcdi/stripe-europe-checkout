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
  await throws(() => provider.listSmartPlusCampaigns(''), 400, 'listar exige advertiser');
  await throws(() => provider.setSmartPlusCampaignStatus('123', [], 'paused'), 400, 'status exige ao menos 1 campanha');
  await throws(() => provider.setSmartPlusCampaignStatus('123', ['c1'], 'xxx'), 400, 'status inválido é rejeitado');
  await throws(() => provider.appealSmartPlusAd('123', ''), 400, 'appeal exige o ID do anúncio');

  console.log('Rotas — guardrails e allowlist');
  const routes = fs.readFileSync(path.join(__dirname, '..', 'ads-routes.js'), 'utf8');
  ok(/app\.get\('\/api\/ads\/smart-plus'/.test(routes), 'GET /smart-plus registrado');
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
