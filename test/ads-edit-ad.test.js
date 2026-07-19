'use strict';
/*
 * Editar anúncio sem recriar — provider.updateAd (update_tiktok_ad) + a rota
 * PUT /api/ads/:adId. Antes a edição de criativo respondia 501; agora aplica
 * texto/CTA/link/nome como patch parcial, respeitando os guardrails.
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

console.log('provider.updateAd — validação antes da rede');
(async () => {
  ok(typeof provider.updateAd === 'function', 'updateAd exportado');
  await throws(() => provider.updateAd('', 'a1', { text: 'x' }), 400, 'sem advertiser/ad → 400');
  await throws(() => provider.updateAd('123', 'a1', {}), 400, 'patch vazio → 400');
  await throws(() => provider.updateAd('123', 'a1', { linkUrl: 'ftp://x' }), 400, 'sem campo válido (link não-http) → 400');

  console.log('rota PUT /api/ads/:adId — edição de criativo real (não mais 501)');
  const routes = fs.readFileSync(path.join(__dirname, '..', 'ads-routes.js'), 'utf8');
  ok(!/CREATIVE_EDIT_UNSUPPORTED/.test(routes), 'o 501 de edição de criativo foi removido');
  ok(/wantCreative/.test(routes), 'a rota calcula wantCreative');
  ok(/pipeboard\.updateAd\(advertiserId, entityId, wantCreative\)/.test(routes), 'aplica via provider.updateAd');
  ok(/só podem ser editados no n[íi]vel do AN[ÚU]NCIO/.test(routes), 'edição de criativo restrita ao nível ad');
  // guardrails: dry-run cobre o caminho (o bloco isDryRun vem antes das escritas)
  ok(/killSwitchActive\(req\.account\.id\)\) return res\.status\(423\)/.test(routes), 'PUT respeita kill switch');

  console.log('\nads-edit-ad: ' + n + ' asserts OK');
})().catch((e) => { console.error(e); process.exit(1); });
