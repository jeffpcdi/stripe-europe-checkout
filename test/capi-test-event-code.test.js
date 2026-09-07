'use strict';
/*
 * Regressão CRÍTICA: test_event_code NUNCA pode ir em eventos de produção.
 *
 * Bug original: bastava o pixel ter um Test Event Code salvo (a dashboard
 * EXIGE um para testar Compra no painel) para TODOS os disparos reais irem
 * marcados como teste. O TikTok respondia code 0 (log "ok"), mas exibia os
 * eventos apenas na aba "Testar eventos" — nenhum Purchase real era
 * contabilizado no TikTok Ads. Venda saía, atribuição não.
 *
 * Regra correta:
 *   - dispatch de produção (webhook/beacon/fila de retry) → SEM test_event_code
 *   - teste explícito do painel (testPixel)               → COM test_event_code
 */
const assert = require('assert');

const ACC = 'acc-test-code';
const PIXEL = {
  slug: 'pixel-prod', acc: ACC, token: 'tok_prod', name: 'Pixel Prod',
  pixelCode: 'PXCODE', accessToken: 'ATOKEN',
  testEventCode: 'TEST12345', // Test Event Code SALVO (o cenário do bug)
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
    seenEventId: async () => false,
    acquireLock: async () => true,
    releaseLock: async () => {},
    bumpEmq: async () => {}
  }
};

const originalFetch = global.fetch;
let fetchCalls = [];
global.fetch = async (url, opts) => {
  if (typeof url === 'string' && url.includes('tiktok.com')) {
    fetchCalls.push({ url, body: JSON.parse((opts && opts.body) || '{}') });
    return { status: 200, json: async () => ({ code: 0, message: 'OK' }), text: async () => '{"code":0,"message":"OK"}' };
  }
  return originalFetch(url, opts);
};

const tk = require('../tiktok-events');

(async () => {
  // 1) Venda REAL do gateway com Test Event Code salvo → payload SEM test_event_code
  fetchCalls = [];
  await tk.dispatchToAll('CompletePayment', {
    _trusted: true, acc: ACC, eventId: 'Purchase.order-1', value: 97, currency: 'EUR'
  }, '*', ACC);
  assert.strictEqual(fetchCalls.length, 1, 'venda do gateway deve ir ao TikTok');
  assert.strictEqual(fetchCalls[0].body.test_event_code, undefined,
    'PRODUÇÃO nunca pode enviar test_event_code (senão o Purchase vira evento de teste e some do Ads)');
  assert.strictEqual(fetchCalls[0].body.data[0].event, 'Purchase', 'evento outbound é Purchase');

  // 2) ViewContent real (client-side) → também SEM test_event_code
  fetchCalls = [];
  await tk.dispatchToAll('ViewContent', { acc: ACC, eventId: 'ViewContent.x1' }, '*', ACC);
  assert.strictEqual(fetchCalls.length, 1, 'ViewContent deve passar');
  assert.strictEqual(fetchCalls[0].body.test_event_code, undefined,
    'evento de navegação real não pode ir marcado como teste');

  // 3) Teste EXPLÍCITO do painel → COM test_event_code (comportamento desejado)
  fetchCalls = [];
  const r3 = await tk.testPixel(PIXEL, { event: 'Purchase', currency: 'EUR' });
  assert.strictEqual(fetchCalls.length, 1, 'teste do painel deve chamar o TikTok');
  assert.strictEqual(fetchCalls[0].body.test_event_code, 'TEST12345',
    'teste do painel DEVE usar o test_event_code para não contaminar dados reais');
  assert.ok(r3 && r3.ok, 'teste do painel deve reportar sucesso');

  console.log('[OK] test_event_code: produção limpa; só o teste do painel usa o código de teste.');
  process.exit(0);
})().catch((e) => { console.error('[FALHOU]', e.message); process.exit(1); });
