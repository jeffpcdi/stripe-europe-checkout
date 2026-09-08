'use strict';
const assert = require('node:assert/strict');
const originalTimeout = global.setTimeout;
global.setTimeout = (fn, ms, ...args) => originalTimeout(fn, ms === 6000 ? 25 : ms === 600 ? 1 : ms, ...args);
const tt = require('../tiktok-events');
const pixel = { slug: 'transport', token: 'px_transport', acc: 'test-transport', pixelCode: 'CODE', accessToken: 'token', active: true, events: {} };
(async () => {
  for (const [name, response] of [
    ['TypeError de rede', () => { throw new TypeError('fetch failed'); }],
    ['HTTP 503', () => ({ status: 503, json: async () => ({ code: 500, message: 'temporary' }) })],
    ['HTTP 429', () => ({ status: 429, json: async () => ({ code: 429, message: 'limit' }) })],
    ['corpo inválido', () => ({ status: 200, json: async () => ({}) })],
    ['corpo pendurado', () => ({ status: 200, json: () => new Promise(() => {}) })],
  ]) {
    global.fetch = async () => response();
    const before = tt.retryQueueSize();
    const result = await tt.sendToPixel(pixel, { event: 'ViewContent', eventId: 'transport.' + before });
    assert(result.error, name + ' não pode virar sucesso');
    assert.equal(tt.retryQueueSize(), before + 1, name + ' entra na fila');
  }
  const before = tt.retryQueueSize();
  global.fetch = async () => { throw new Error('offline'); };
  await tt.sendToPixel({ ...pixel, testEventCode: 'TEST' }, { event: 'Purchase', _test: true, eventId: 'test.purchase' });
  assert.equal(tt.retryQueueSize(), before, 'teste de compra não pode virar compra real na fila');
  global.fetch = async () => ({ status: 200, json: async () => ({ code: 0, message: 'OK' }) });
  assert.equal((await tt.sendToPixel(pixel, { event: 'ViewContent', eventId: 'transport.ok' })).code, 0);
  console.log('pixel-transport: 5xx, 429, corpo inválido/lento, teste isolado e confirmação OK');
})().catch(e => { console.error(e); process.exitCode = 1; });
