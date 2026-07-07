'use strict';
/*
 * Teste de regressão da trava gateway-only (Fase 4).
 *
 * Regra: eventos MONETÁRIOS (CompletePayment, AddPaymentInfo, Refund, Dispute)
 * só podem ser disparados por origem confiável (webhook do gateway ou
 * /api/conversion), que marcam p._trusted = true. Qualquer disparo sem essa
 * marca — típico de beacon client-side — é BLOQUEADO antes de ir ao TikTok.
 * Eventos não monetários (ex.: ViewContent) continuam livres.
 *
 * Stubamos ./pixel-store e ./redis no require-cache e um fetch fake para
 * detectar se houve (ou não) chamada real ao TikTok.
 */
const assert = require('assert');

const ACC = 'acc-xyz';
const PIXEL = {
  slug: 'venda-eur', acc: ACC, token: 'tok_x', name: 'Venda EUR',
  pixelCode: 'PXCODE', accessToken: 'ATOKEN', testEventCode: '',
  active: true, routes: ['*'],
  events: { CompletePayment: true, ViewContent: true, AddPaymentInfo: true }
};

const psPath = require.resolve('../pixel-store');
require.cache[psPath] = {
  id: psPath, filename: psPath, loaded: true,
  exports: {
    get(a, s) { return (PIXEL.acc === (a || null) && PIXEL.slug === s) ? PIXEL : null; },
    getByToken(t) { return t === PIXEL.token ? PIXEL : null; },
    list() { return [PIXEL]; },
    forEvent() { return [PIXEL]; },
    forRoute() { return [PIXEL]; }
  }
};

const rdbPath = require.resolve('../redis');
require.cache[rdbPath] = {
  id: rdbPath, filename: rdbPath, loaded: true,
  exports: {
    loadCapiRetryQueue: async () => [],
    saveCapiRetryQueue: async () => {},
    recentPixelLog: async () => [],
    pushPixelLog: async () => {},
    seenEventId: async () => false
  }
};

let fetchCalls = [];
global.fetch = async (url, opts) => {
  fetchCalls.push({ url, body: opts && opts.body });
  return { status: 200, json: async () => ({ code: 0, message: 'OK' }) };
};

const tk = require('../tiktok-events');

(async () => {
  // 1) venda SEM _trusted (client-side) → deve ser bloqueada, sem fetch
  fetchCalls = [];
  const r1 = await tk.dispatchToAll('CompletePayment', {
    acc: ACC, eventId: 'CompletePayment.aaa', value: 50, currency: 'EUR'
  }, '*', ACC);
  assert.strictEqual(fetchCalls.length, 0, 'venda client-side NÃO pode chamar o TikTok');
  assert.strictEqual(r1 && r1.blocked, 'gateway-only', 'deve reportar bloqueio gateway-only');

  // 2) venda COM _trusted (gateway) → deve disparar normalmente
  fetchCalls = [];
  const r2 = await tk.dispatchToAll('CompletePayment', {
    _trusted: true, acc: ACC, eventId: 'CompletePayment.bbb', value: 50, currency: 'EUR'
  }, '*', ACC);
  assert.strictEqual(fetchCalls.length, 1, 'venda do gateway deve ir ao TikTok');
  assert.ok(!r2.blocked, 'venda confiável não pode ser bloqueada');

  // 3) evento NÃO monetário sem _trusted → livre (client-side pode disparar)
  fetchCalls = [];
  await tk.dispatchToAll('ViewContent', {
    acc: ACC, eventId: 'ViewContent.ccc'
  }, '*', ACC);
  assert.strictEqual(fetchCalls.length, 1, 'ViewContent client-side deve passar');

  console.log('[OK] gateway-only: venda client-side bloqueada; venda do gateway e ViewContent liberados.');
  process.exit(0);
})().catch((e) => { console.error('[FALHOU]', e.message); process.exit(1); });
