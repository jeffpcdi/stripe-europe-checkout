'use strict';

const assert = require('assert');
const vm = require('vm');
const { buildPixelClient } = require('../pixel-client');

const listeners = new Map();
const documentListeners = new Map();
const requests = [];
const storage = new Map();
const currentScript = { src: 'https://dashboard.example/px/placeholder.js', parentNode: { insertBefore() {} } };

const window = {
  addEventListener(name, fn) {
    const rows = listeners.get(name) || [];
    rows.push(fn);
    listeners.set(name, rows);
  },
  dispatchEvent(event) {
    for (const fn of listeners.get(event.type) || []) fn(event);
  }
};

const document = {
  currentScript,
  cookie: '_ttp=ttp_cookie',
  addEventListener(name, fn) {
    const rows = documentListeners.get(name) || [];
    rows.push(fn);
    documentListeners.set(name, rows);
  },
  dispatchEvent(event) {
    for (const fn of documentListeners.get(event.type) || []) fn(event);
  },
  createElement() { return {}; },
  getElementsByTagName() { return [currentScript]; }
};

const context = vm.createContext({
  window, document,
  location: { href: 'https://loja.example/produto?ttclid=click-1', search: '?ttclid=click-1' },
  localStorage: { getItem: (k) => storage.get(k) || null, setItem: (k, v) => storage.set(k, String(v)) },
  navigator: { sendBeacon: () => false },
  fetch: (url, opts) => { requests.push({ url, body: JSON.parse(opts.body) }); return Promise.resolve({}); },
  URL, URLSearchParams, Blob, TextEncoder,
  crypto: null,
  isFinite,
  setTimeout, clearTimeout,
  console
});

function config(slug, code) {
  return {
    slug, pixelCode: code,
    events: { ViewContent: true, AddToCart: true, InitiateCheckout: true }
  };
}

function tracks(code) {
  const queue = window.ttq && window.ttq._i && window.ttq._i[code];
  return (queue || []).filter((row) => Array.isArray(row) && row[0] === 'track');
}

currentScript.src = 'https://dashboard.example/px/px_a.js';
vm.runInContext(buildPixelClient(config('a', 'CODE_A'), 'px_a'), context);
currentScript.src = 'https://dashboard.example/px/px_b.js';
vm.runInContext(buildPixelClient(config('b', 'CODE_B'), 'px_b'), context);

assert.strictEqual(tracks('CODE_A').length, 1, 'pixel A recebe seu ViewContent inicial');
assert.strictEqual(tracks('CODE_B').length, 1, 'pixel B recebe seu ViewContent inicial');
assert.deepStrictEqual(requests.map((r) => r.url), [
  'https://dashboard.example/api/px/event',
  'https://dashboard.example/api/px/event'
], 'os dois beacons usam a origem absoluta da dashboard');
assert.deepStrictEqual(requests.map((r) => r.body.px), ['px_a', 'px_b'], 'cada beacon carrega seu token');
assert.ok(requests.every((r) => /^ld_[a-z0-9]{6,30}$/i.test(r.body.vid)), 'vid local acompanha o beacon cross-domain');

window.RoiNadosPixel.track('px_a', 'AddToCart', { content_id: 'SKU-A', value: 97, currency: 'BRL' });
assert.strictEqual(tracks('CODE_A').length, 2, 'API explícita acrescenta evento somente ao pixel A');
assert.strictEqual(tracks('CODE_B').length, 1, 'API do pixel A não toca o pixel B');
assert.strictEqual(requests[2].body.events[0].n, 'AddToCart');
assert.strictEqual(requests[2].body.events[0].properties.content_id, 'SKU-A');

function markedButton(token) {
  const values = {
    'data-tiktok-event': 'AddToCart',
    'data-pixel-token': token,
    'data-content-id': 'SKU-B',
    'data-content-name': 'Produto B',
    'data-value': '149',
    'data-currency': 'BRL'
  };
  return { closest: () => ({ getAttribute: (name) => values[name] || null }) };
}

const beforeAmbiguousClick = requests.length;
document.dispatchEvent({ type: 'click', target: markedButton(null) });
assert.strictEqual(requests.length, beforeAmbiguousClick, 'botão sem token é bloqueado quando há dois loaders');

document.dispatchEvent({ type: 'click', target: markedButton('px_b') });
assert.strictEqual(tracks('CODE_A').length, 2, 'botão destinado a B não dispara A');
assert.strictEqual(tracks('CODE_B').length, 2, 'botão destinado a B dispara B');

window.dispatchEvent({ type: 'roinados:navigation', detail: { px: 'px_b' } });
assert.strictEqual(tracks('CODE_A').length, 2, 'navegação destinada a B não dispara A');
assert.strictEqual(tracks('CODE_B').length, 3, 'navegação destinada a B dispara B');

console.log('[PASS] pixel-client-runtime: duas instâncias reais em VM permanecem isoladas e enviam beacon absoluto.');
