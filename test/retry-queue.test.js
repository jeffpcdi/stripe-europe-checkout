'use strict';
/*
 * Teste de regressão da fila de retry da CAPI (Fase 1).
 *
 * Bug corrigido: drainRetryQueue chamava pixelStore.get(item.slug) com UM
 * argumento, mas a assinatura é get(accountId, slug). Para qualquer pixel
 * escopado por conta isso retornava null e a venda em retry era descartada.
 *
 * Estratégia: stubamos ./pixel-store e ./redis no require-cache ANTES de
 * carregar tiktok-events, semeamos a fila via loadCapiRetryQueue() e drenamos.
 * Não faz rede real (global.fetch é stub).
 */
const path = require('path');
const assert = require('assert');

const ACC = 'acc-123';
const PIXEL = {
  slug: 'venda-eur',
  acc: ACC,
  token: 'tok_abc123',
  name: 'Venda EUR',
  pixelCode: 'PIXELCODE123',
  accessToken: 'ACCESSTOKEN123',
  testEventCode: '',
  active: true,
  routes: ['*'],
  events: { CompletePayment: true }
};

// ── Stub do pixel-store: só uma conta, escopado (reproduz o cenário do bug) ──
const psPath = require.resolve('../pixel-store');
require.cache[psPath] = {
  id: psPath,
  filename: psPath,
  loaded: true,
  exports: {
    // get de UM argumento (jeito antigo/errado) NUNCA acha um pixel com conta:
    get(accountId, slug) {
      if (arguments.length < 2) return null; // simula o bug antigo
      return (PIXEL.acc === (accountId || null) && PIXEL.slug === slug) ? PIXEL : null;
    },
    getByToken(token) { return token === PIXEL.token ? PIXEL : null; },
    list(accountId) { return (!accountId || accountId === PIXEL.acc) ? [PIXEL] : []; },
    forEvent() { return [PIXEL]; },
    forRoute() { return [PIXEL]; }
  }
};

// ── Stub do redis: semeia a fila e captura persistências ────────────────────
let seeded = [];
let persisted = null;
const rdbPath = require.resolve('../redis');
require.cache[rdbPath] = {
  id: rdbPath,
  filename: rdbPath,
  loaded: true,
  exports: {
    loadCapiRetryQueue: async () => seeded,
    saveCapiRetryQueue: async (q) => { persisted = q; },
    // usados por outras partes do módulo; no-ops seguros
    recentPixelLog: async () => [],
    pushPixelLog: async () => {}
  }
};

// ── Stub de fetch: sucesso (code 0), registrando as chamadas ────────────────
let fetchCalls = [];
global.fetch = async (url, opts) => {
  fetchCalls.push({ url, headers: opts && opts.headers, body: opts && opts.body });
  return { status: 200, json: async () => ({ code: 0, message: 'OK' }) };
};

// item na fila: conta escopada, nextAt no passado (vencido), firstAt recente
seeded = [{
  token: PIXEL.token,
  acc: PIXEL.acc,
  slug: PIXEL.slug,
  eventId: 'CompletePayment.deadbeef',
  p: {
    event: 'CompletePayment', eventId: 'CompletePayment.deadbeef',
    value: 97.0, currency: 'EUR', email: 'comprador@ex.com'
  },
  attempt: 0,
  firstAt: Date.now() - 5 * 60e3,
  nextAt: Date.now() - 1000
}];

const tk = require('../tiktok-events');

(async () => {
  assert.strictEqual(tk.retryQueueSize(), 0, 'fila começa vazia (ainda não carregada)');
  await tk.drainRetryQueue();

  // 1) o evento foi realmente reenviado ao TikTok (re-resolução funcionou)
  assert.strictEqual(fetchCalls.length, 1, 'esperava exatamente 1 chamada ao TikTok');
  const sent = JSON.parse(fetchCalls[0].body);
  assert.strictEqual(sent.event_source_id, PIXEL.pixelCode, 'pixelCode correto no payload');
  assert.strictEqual(sent.data[0].event, 'CompletePayment', 'evento correto');
  assert.strictEqual(fetchCalls[0].headers['Access-Token'], PIXEL.accessToken, 'access token enviado');

  // 2) após sucesso, a fila fica vazia e é persistida vazia
  assert.strictEqual(tk.retryQueueSize(), 0, 'fila drenada após sucesso');
  assert.ok(Array.isArray(persisted) && persisted.length === 0, 'persistiu fila vazia');

  console.log('[OK] retry-queue: venda escopada por conta re-resolvida por token e reenviada.');
  console.log('[OK] Sem a correção, get(slug) de 1 argumento retornaria null e a venda seria descartada.');
  process.exit(0);
})().catch((e) => { console.error('[FALHOU]', e.message); process.exit(1); });
