'use strict';
/*
 * Teste de regressão do VÍNCULO pixel ↔ gateway.
 *
 * Cenário do usuário: 2 infoprodutos, 2 pixels e 2 gateways na MESMA conta.
 * Cada pixel deve receber a venda (CompletePayment) SOMENTE do seu gateway —
 * um nunca pode disparar a venda do outro.
 *
 * Regras testadas:
 *  1. Evento do gateway A → só dispara no pixel vinculado ao gateway A;
 *  2. Evento do gateway B → só dispara no pixel vinculado ao gateway B;
 *  3. Pixel SEM vínculo só é fallback quando não há vínculo explícito;
 *  4. Evento SEM gatewayId → pixel vinculado NÃO dispara (isolamento estrito),
 *     mas pixel sem vínculo dispara normalmente;
 *  5. Eventos de navegador (ViewContent) ignoram o vínculo.
 */
const assert = require('assert');

const ACC = 'acc-multi';
const GW_A = 'gw_aaaa1111';
const GW_B = 'gw_bbbb2222';

function mkPixel(slug, code, gatewayIds) {
  return {
    slug, acc: ACC, token: 'tok_' + slug, name: slug,
    pixelCode: code, accessToken: 'ATOKEN_' + slug, testEventCode: '',
    active: true, routes: ['*'], gatewayIds,
    events: { CompletePayment: true, ViewContent: true, AddPaymentInfo: true }
  };
}

const PIXEL_A = mkPixel('produto-a', 'PXA', [GW_A]); // vinculado ao gateway A
const PIXEL_B = mkPixel('produto-b', 'PXB', [GW_B]); // vinculado ao gateway B
const PIXEL_LIVRE = mkPixel('livre', 'PXL', []);     // sem vínculo = todos
const ALL = [PIXEL_A, PIXEL_B, PIXEL_LIVRE];

const psPath = require.resolve('../pixel-store');
require.cache[psPath] = {
  id: psPath, filename: psPath, loaded: true,
  exports: {
    get(a, s) { return ALL.find((p) => p.acc === (a || null) && p.slug === s) || null; },
    getByToken(t) { return ALL.find((p) => p.token === t) || null; },
    list() { return ALL; },
    forEvent(acc, ev) { return ALL.filter((p) => p.events[ev]); },
    forRoute() { return ALL; }
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
    seenEventId: async () => false,
    acquireLock: async () => true,
    releaseLock: async () => {},
    bumpEmq: async () => {}
  }
};

let fetchCalls = [];
global.fetch = async (url, opts) => {
  fetchCalls.push({ url, body: opts && opts.body });
  return { status: 200, json: async () => ({ code: 0, message: 'OK' }) };
};

// Extrai os pixel codes que efetivamente receberam disparo
function firedCodes() {
  return fetchCalls.map((c) => {
    try { return JSON.parse(c.body).event_source_id; } catch (_) { return null; }
  }).sort();
}

const tk = require('../tiktok-events');

(async () => {
  // 1) Venda vinda do gateway A → só pixel A (vínculo explícito vence livre)
  fetchCalls = [];
  const r1 = await tk.dispatchToAll('CompletePayment', {
    _trusted: true, acc: ACC, gatewayId: GW_A,
    eventId: 'CompletePayment.gwa', value: 97, currency: 'BRL'
  }, '*', ACC);
  assert.strictEqual(r1.dispatched, 1, 'gateway A deve atingir somente o pixel A');
  assert.deepStrictEqual(firedCodes(), ['PXA'], 'pixels B/livre NÃO podem receber venda do gateway A');

  // 2) Venda vinda do gateway B → só pixel B
  fetchCalls = [];
  const r2 = await tk.dispatchToAll('CompletePayment', {
    _trusted: true, acc: ACC, gatewayId: GW_B,
    eventId: 'CompletePayment.gwb', value: 147, currency: 'BRL'
  }, '*', ACC);
  assert.strictEqual(r2.dispatched, 1, 'gateway B deve atingir somente o pixel B');
  assert.deepStrictEqual(firedCodes(), ['PXB'], 'pixels A/livre NÃO podem receber venda do gateway B');

  // 3) Venda SEM gatewayId (ex.: /api/conversion legado) → só o pixel livre
  fetchCalls = [];
  const r3 = await tk.dispatchToAll('CompletePayment', {
    _trusted: true, acc: ACC,
    eventId: 'CompletePayment.semgw', value: 47, currency: 'BRL'
  }, '*', ACC);
  assert.strictEqual(r3.dispatched, 1, 'evento sem gateway só atinge o pixel sem vínculo');
  assert.deepStrictEqual(firedCodes(), ['PXL'], 'pixels vinculados exigem identificação de gateway');

  // 4) ViewContent (navegador, não monetário) → vínculo NÃO se aplica
  fetchCalls = [];
  const r4 = await tk.dispatchToAll('ViewContent', {
    acc: ACC, eventId: 'ViewContent.x'
  }, '*', ACC);
  assert.strictEqual(r4.dispatched, 3, 'ViewContent ignora vínculo de gateway (3 pixels)');

  // 5) AddPaymentInfo (monetário) também respeita o vínculo
  fetchCalls = [];
  const r5 = await tk.dispatchToAll('AddPaymentInfo', {
    _trusted: true, acc: ACC, gatewayId: GW_A,
    eventId: 'AddPaymentInfo.gwa'
  }, '*', ACC);
  assert.deepStrictEqual(firedCodes(), ['PXA'], 'AddPaymentInfo do gateway A só vai ao pixel A');

  console.log('[OK] vínculo pixel↔gateway: vendas isoladas por gateway; navegador livre; legado preservado.');
  process.exit(0);
})().catch((e) => { console.error('[FALHOU]', e.message); process.exit(1); });
