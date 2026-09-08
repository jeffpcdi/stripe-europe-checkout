'use strict';

const assert = require('assert');
const vm = require('vm');
const { buildPixelClient } = require('../pixel-client');

const listeners = new Map();
const documentListeners = new Map();
const requests = [];
const injectedScripts = [];
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
  documentElement: {},
  head: { appendChild(el) { injectedScripts.push(el); } },
  addEventListener(name, fn) {
    const rows = documentListeners.get(name) || [];
    rows.push(fn);
    documentListeners.set(name, rows);
  },
  dispatchEvent(event) {
    for (const fn of documentListeners.get(event.type) || []) fn(event);
  },
  createElement() { return { setAttribute(name, value) { this[name] = value; } }; },
  querySelectorAll() { return []; },
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
  // timers de sincronização tardia (_ttp) não precisam segurar o processo;
  // o contrato de runtime é exercitado de forma determinística abaixo.
  setTimeout: () => 1, clearTimeout: () => {},
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

assert.strictEqual(injectedScripts.filter((el) => String(el.src || '').includes('/t.js?px=')).length, 1,
  'a tag individual inicializa o tracker completo uma única vez');
assert.strictEqual(injectedScripts.find((el) => String(el.src || '').includes('/t.js?px=')).src,
  'https://dashboard.example/t.js?px=px_a', 'tracker herda origem e token do primeiro pixel explícito');

assert.strictEqual(tracks('CODE_A').length, 1, 'pixel A recebe seu ViewContent inicial');
assert.strictEqual(tracks('CODE_B').length, 1, 'pixel B recebe seu ViewContent inicial');
assert.deepStrictEqual(requests.map((r) => r.url), [
  'https://dashboard.example/api/px/event',
  'https://dashboard.example/api/px/event'
], 'os dois beacons usam a origem absoluta da dashboard');
assert.deepStrictEqual(requests.map((r) => r.body.px), ['px_a', 'px_b'], 'cada beacon carrega seu token');
assert.ok(requests.every((r) => /^ld_[a-z0-9]{6,30}$/i.test(r.body.vid)), 'vid local acompanha o beacon cross-domain');
assert.strictEqual(
  requests[0].body.events[0].id,
  requests[1].body.events[0].id,
  'dois pixels na mesma navegação compartilham event_id para Browser+CAPI sem misturar destinos'
);
assert.strictEqual(requests[0].body.ttclid, 'click-1', 'ttclid acompanha o evento server-side');

window.RoiNadosPixel.track('px_a', 'AddToCart', { content_id: 'SKU-A', value: 97, currency: 'BRL' });
assert.strictEqual(tracks('CODE_A').length, 2, 'API explícita acrescenta evento somente ao pixel A');
assert.strictEqual(tracks('CODE_B').length, 1, 'API do pixel A não toca o pixel B');
assert.strictEqual(requests[2].body.events[0].n, 'AddToCart');
assert.strictEqual(requests[2].body.events[0].properties.content_id, 'SKU-A');

const beforePurchaseRequests = requests.length;
assert.strictEqual(window.RoiNadosPixel.purchase('px_a', {
  order_id: 'PEDIDO 123', value: 97, currency: 'brl', content_id: 'SKU-A'
}), true, 'API explícita aceita uma compra confirmada');
assert.strictEqual(tracks('CODE_A').length, 3, 'Purchase chega somente ao Pixel nativo A');
assert.strictEqual(tracks('CODE_B').length, 1, 'Purchase de A não toca o Pixel B');
const purchase = tracks('CODE_A').at(-1);
assert.strictEqual(purchase[1], 'Purchase', 'nome atual do Standard Event');
assert.strictEqual(purchase[3].event_id, 'Purchase.PEDIDO_123', 'event_id deriva do pedido como no webhook');
assert.strictEqual(requests.length, beforePurchaseRequests + 1, 'Purchase sincroniza apenas sinais de identidade');
assert.strictEqual(requests.at(-1).body.signalsOnly, true, 'nenhuma venda é criada no endpoint server-side');
assert.deepStrictEqual(requests.at(-1).body.events, [], 'o beacon de Purchase não atravessa a trava gateway-only');
window.RoiNadosPixel.purchase('px_a', { order_id: 'PEDIDO 123', value: 97, currency: 'BRL' });
assert.strictEqual(tracks('CODE_A').length, 3, 'reload/chamada repetida não duplica o Purchase nativo');

assert.strictEqual(window.RoiNadosPixel.identify({ email: 'ambiguo@example.com' }), false,
  'identify sem token falha fechado quando há dois pixels');
assert.strictEqual(window.RoiNadosPixel.identify('px_b', { email: 'b@example.com' }), true,
  'identify com token atualiza somente o destino explícito');
assert.strictEqual(requests.at(-1).body.px, 'px_b');
assert.strictEqual(requests.at(-1).body.signalsOnly, true);

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
assert.strictEqual(tracks('CODE_A').length, 3, 'botão destinado a B não dispara A');
assert.strictEqual(tracks('CODE_B').length, 2, 'botão destinado a B dispara B');

const firstViewId = requests[1].body.events[0].id;
window.dispatchEvent({ type: 'roinados:navigation', detail: { px: 'px_b', eventId: 'ViewContent.ld_nova.navegacao.1' } });
assert.strictEqual(tracks('CODE_A').length, 3, 'navegação destinada a B não dispara A');
assert.strictEqual(tracks('CODE_B').length, 3, 'navegação destinada a B dispara B');
assert.notStrictEqual(requests.at(-1).body.events[0].id, firstViewId, 'nova navegação não colide com a visita anterior');
assert.strictEqual(requests.at(-1).body.events[0].id, 'ViewContent.ld_nova.navegacao.1', 'tracker e loader compartilham o id explícito da navegação');

console.log('[PASS] pixel-client-runtime: duas instâncias reais em VM permanecem isoladas e enviam beacon absoluto.');

assert.strictEqual(window.RoiNadosPixel.purchase('px_a', { order_id: 'sem-valor', currency: 'BRL' }), false, 'valor ausente não vira compra de valor zero');
assert.strictEqual(window.RoiNadosPixel.purchase('px_a', { order_id: 'sem-moeda', value: 10 }), false, 'moeda ausente não vira BRL silenciosamente');
const priorVid = window.RoiNadosPixel.getVisitorId();
context.localStorage = { getItem() { throw Error('bloqueado'); }, setItem() { throw Error('bloqueado'); } };
currentScript.src = 'https://dashboard.example/px/px_c.js';
vm.runInContext(buildPixelClient(config('c', 'CODE_C'), 'px_c'), context);
assert.equal(window.RoiNadosPixel.getVisitorId(), priorVid, 'armazenamento bloqueado mantém identidade compartilhada na sessão');
assert.equal(typeof requests[requests.length - 1].body.events[0].time, 'number', 'evento preserva o horário original para reenvio');
console.log('[PASS] pixel-client: compra exige valor/moeda, identidade em memória e horário original OK');
