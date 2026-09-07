'use strict';
/*
 * Bug de produção: um Access-Token com caractere corrompido (0xFFFD, o "�" de um
 * cadastro com encoding errado) fazia o fetch do Node lançar "Cannot convert
 * argument to a ByteString" em TODO disparo — derrubando a CAPI, re-enfileirando
 * para sempre (fila acumulada) e zerando o EMQ.
 *
 * Correção: o token é saneado para ASCII imprimível antes de virar header.
 *  - token com um caractere solto → recupera o token limpo e dispara normal;
 *  - token só com lixo → falha CLARA (BAD_TOKEN) sem crashar e SEM re-enfileirar.
 */
const assert = require('assert');

let n = 0;
function ok(cond, label) { assert.ok(cond, label); n++; console.log('  ✓ ' + label); }

const ACC = 'acc-tok';
const PIX_DIRTY = { slug: 'p-dirty', acc: ACC, name: 'Sujo', pixelCode: 'CODE1', accessToken: '�GOODTOKEN123', active: true, events: { ViewContent: true }, gatewayIds: [] };
const PIX_GARBAGE = { slug: 'p-garbage', acc: ACC, name: 'Lixo', pixelCode: 'CODE2', accessToken: '��', active: true, events: { ViewContent: true }, gatewayIds: [] };

let current = [PIX_DIRTY];
const psPath = require.resolve('../pixel-store');
require.cache[psPath] = {
  id: psPath, filename: psPath, loaded: true,
  exports: {
    get(a, slug) { return current.find((p) => p.slug === slug) || null; },
    getByToken() { return null; },
    list() { return current; },
    forEvent() { return current; },
    forRoute() { return current; },
  },
};

let requeued = 0;
const rdbPath = require.resolve('../redis');
require.cache[rdbPath] = {
  id: rdbPath, filename: rdbPath, loaded: true,
  exports: {
    loadCapiRetryQueue: async () => [], saveCapiRetryQueue: async (q) => { requeued = (q || []).length; },
    acquireLock: async () => true, releaseLock: async () => {},
    recentPixelLog: async () => [], pushPixelLog: async () => {}, bumpEmq: async () => {},
  },
};

const originalFetch = global.fetch;
let capturedHeader = null;
let fetchCalls = 0;
global.fetch = async (url, opts) => {
  if (typeof url === 'string' && url.includes('tiktok.com')) {
    fetchCalls++;
    capturedHeader = opts && opts.headers && opts.headers['Access-Token'];
    return { status: 200, json: async () => ({ code: 0, message: 'OK' }), text: async () => '{"code":0,"message":"OK"}' };
  }
  return originalFetch(url, opts);
};

const tt = require('../tiktok-events');

(async () => {
  console.log('Token com caractere corrompido → saneado e disparado');
  current = [PIX_DIRTY];
  const r1 = await tt.dispatchToAll('ViewContent', { eventId: 'ViewContent.x.2026072010', url: 'https://x/' }, '*', ACC);
  ok(fetchCalls === 1, 'não crashou — chamou o fetch uma vez');
  ok(capturedHeader === 'GOODTOKEN123', 'header saiu SEM o caractere inválido (0xFFFD removido)');
  ok(r1.results[0] && r1.results[0].code === 0, 'disparo aceito (code 0)');

  console.log('Token só com lixo → BAD_TOKEN, sem crash e sem re-enfileirar');
  current = [PIX_GARBAGE];
  fetchCalls = 0; requeued = 0;
  const r2 = await tt.dispatchToAll('ViewContent', { eventId: 'ViewContent.y.2026072010', url: 'https://x/' }, '*', ACC);
  ok(fetchCalls === 0, 'token inválido nem chega a bater na rede');
  ok(r2.results[0] && r2.results[0].code === 'BAD_TOKEN', 'retorna erro claro BAD_TOKEN');
  ok(requeued === 0, 'NÃO re-enfileira (falha determinística não faz a fila crescer)');

  console.log('\ncapi-token-sanitize: ' + n + ' asserts OK');
})().catch((e) => { console.error(e); process.exit(1); });
