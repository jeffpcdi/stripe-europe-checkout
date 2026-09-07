'use strict';
/*
 * "erro em 1/2" explicado por pixel. Bug de UX: o recibo da conversão só
 * guardava o agregado ("erro em 1/2"); o motivo POR pixel (token inválido etc.)
 * só existia no log da aba Pixels. dispatchToAll passou a devolver, em CADA
 * result, o pixel (slug) e pixelName — de sucesso E de falha — para o server
 * montar receipt.capi e o feed de Gateways explicar sozinho.
 *
 * Estratégia (padrão do retry-queue.test): stub de pixel-store + redis no
 * require-cache e global.fetch controlado. 2 pixels: um OK (code 0), um com
 * token recusado pelo TikTok (code 40105).
 */
const assert = require('assert');

let n = 0;
function ok(cond, label) { assert.ok(cond, label); n++; console.log('  ✓ ' + label); }

const ACC = 'acc-capi';
const GW = 'gw_receipt';
// Os dois destinos compartilham o mesmo vínculo de propósito; fan-out só é
// permitido quando explícito, nunca por duas listas vazias ambíguas.
const PIX_OK = { slug: 'p-ok', acc: ACC, name: 'Pixel OK', pixelCode: 'CODEOK', accessToken: 'TOKOK', active: true, events: { CompletePayment: true }, gatewayIds: [GW] };
const PIX_BAD = { slug: 'p-bad', acc: ACC, name: 'Pixel Ruim', pixelCode: 'CODEBAD', accessToken: 'TOKBAD', active: true, events: { CompletePayment: true }, gatewayIds: [GW] };

const psPath = require.resolve('../pixel-store');
require.cache[psPath] = {
  id: psPath, filename: psPath, loaded: true,
  exports: {
    get(accountId, slug) { return [PIX_OK, PIX_BAD].find((p) => p.acc === (accountId || null) && p.slug === slug) || null; },
    getByToken() { return null; },
    list(accountId) { return (!accountId || accountId === ACC) ? [PIX_OK, PIX_BAD] : []; },
    forEvent() { return [PIX_OK, PIX_BAD]; },
    forRoute() { return [PIX_OK, PIX_BAD]; },
  },
};

const rdbPath = require.resolve('../redis');
require.cache[rdbPath] = {
  id: rdbPath, filename: rdbPath, loaded: true,
  exports: {
    loadCapiRetryQueue: async () => [], saveCapiRetryQueue: async () => {},
    acquireLock: async () => true, releaseLock: async () => {},
    recentPixelLog: async () => [], pushPixelLog: async () => {}, bumpEmq: async () => {},
  },
};

const originalFetch = global.fetch;
// fetch: o pixel com accessToken TOKBAD recebe code 40105 (token inválido).
global.fetch = async (url, opts) => {
  if (typeof url === 'string' && url.includes('tiktok.com')) {
    const bad = String((opts && opts.headers && opts.headers['Access-Token']) || '') === 'TOKBAD';
    return { status: 200, json: async () => (bad ? { code: 40105, message: 'Access token is invalid' } : { code: 0, message: 'OK' }), text: async () => JSON.stringify(bad ? { code: 40105, message: 'Access token is invalid' } : { code: 0, message: 'OK' }) };
  }
  return originalFetch(url, opts);
};

const tt = require('../tiktok-events');

(async () => {
  console.log('dispatchToAll — identidade do pixel em cada result (ok e falha)');
  const r = await tt.dispatchToAll('CompletePayment', { _trusted: true, gatewayId: GW, eventId: 'CompletePayment.abc', value: 50, currency: 'BRL' }, '*', ACC);
  ok(r.dispatched === 2, 'disparou nos 2 pixels');
  const byName = Object.fromEntries((r.results || []).map((x) => [x.pixelName, x]));
  ok(byName['Pixel OK'] && byName['Pixel OK'].code === 0, 'pixel OK devolve code 0 + pixelName');
  ok(byName['Pixel Ruim'] && byName['Pixel Ruim'].code === 40105, 'pixel ruim devolve code 40105 + pixelName');
  ok((r.results || []).every((x) => x.pixel && x.pixelName), 'todo result carrega pixel/pixelName');

  console.log('server.js — monta receipt.capi por pixel');
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  ok(/receipt\.capi = r\.results\.map/.test(src), 'processConversion monta receipt.capi de r.results');
  ok(/pixel: x\.pixelName \|\| x\.pixel/.test(src), 'usa pixelName no recibo');

  console.log('\ncapi-receipt: ' + n + ' asserts OK');
})().catch((e) => { console.error(e); process.exit(1); });
