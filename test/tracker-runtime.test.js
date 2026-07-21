'use strict';

const assert = require('assert');
const vm = require('vm');
const tracker = require('../tracker-view');

const storage = new Map();
const requests = [];
const windowListeners = new Map();
const documentListeners = new Map();
const attrs = {
  'data-link-domains': 'checkout.example, upsell.example',
  'data-advanced-matching': 'on'
};
const currentScript = {
  src: 'https://track.example/t.js?px=px_runtime',
  getAttribute: (name) => attrs[name] || null
};

function anchor(href, marked) {
  const values = new Set(marked ? ['data-roinados-link'] : []);
  return { href, hasAttribute: (name) => values.has(name) };
}

const checkout = anchor('https://checkout.example/pay');
const upsell = anchor('https://upsell.example/offer');
const thirdParty = anchor('https://other.example/privacy');
const location = {
  href: 'https://landing.example/oferta?ttclid=click-123&utm_source=tiktok&utm_campaign=camp-1',
  pathname: '/oferta',
  search: '?ttclid=click-123&utm_source=tiktok&utm_campaign=camp-1',
  hash: ''
};

const document = {
  currentScript,
  readyState: 'complete',
  title: 'Oferta principal',
  referrer: 'https://www.tiktok.com/',
  cookie: '_ttp=ttp-runtime',
  getElementsByTagName: () => [currentScript],
  querySelectorAll: (selector) => selector === 'a[href]' ? [checkout, upsell, thirdParty] : [],
  addEventListener(name, fn) {
    const rows = documentListeners.get(name) || [];
    rows.push(fn);
    documentListeners.set(name, rows);
  }
};

const window = {
  addEventListener(name, fn) {
    const rows = windowListeners.get(name) || [];
    rows.push(fn);
    windowListeners.set(name, rows);
  },
  dispatchEvent(event) {
    for (const fn of windowListeners.get(event.type) || []) fn(event);
  }
};

const history = {
  pushState(_state, _title, next) {
    const u = new URL(next, location.href);
    location.href = u.href;
    location.pathname = u.pathname;
    location.search = u.search;
    location.hash = u.hash;
  },
  replaceState(_state, _title, next) {
    this.pushState(_state, _title, next);
  }
};

class CustomEvent {
  constructor(type, init) { this.type = type; this.detail = init && init.detail; }
}
class MutationObserver { observe() {} }

const context = vm.createContext({
  window, document, location, history,
  localStorage: {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, String(value))
  },
  navigator: { onLine: true, sendBeacon: () => false },
  fetch: (url, opts) => {
    requests.push({ url, body: JSON.parse(opts.body) });
    return Promise.resolve({ ok: true });
  },
  URL, URLSearchParams, Blob, CustomEvent, MutationObserver,
  setTimeout: () => 1,
  setInterval: () => 1,
  clearInterval: () => {},
  Date, Math, JSON,
  console
});

vm.runInContext(tracker, context);

const pageRequests = () => requests.filter((row) => row.url.endsWith('/api/track') && row.body.eventId);
assert.strictEqual(pageRequests().length, 1, 'carregamento inicial envia uma pageview');
const first = pageRequests()[0].body;
assert.ok(/^ViewContent\.ld_[a-z0-9]+\.[a-z0-9]+\.[a-z0-9]+\.[a-z0-9]+$/i.test(first.eventId), 'event_id é único por navegação');
assert.strictEqual(first.ttclid, 'click-123');
assert.strictEqual(first.utm.source, 'tiktok');

for (const link of [checkout, upsell]) {
  const u = new URL(link.href);
  assert.ok(u.searchParams.get('vid'), 'host autorizado recebe vid');
  assert.strictEqual(u.searchParams.get('ttclid'), 'click-123', 'host autorizado recebe ttclid');
  assert.strictEqual(u.searchParams.get('utm_campaign'), 'camp-1', 'host autorizado recebe UTM');
}
assert.strictEqual(thirdParty.href, 'https://other.example/privacy', 'terceiro não autorizado fica intacto');

const visitorId = window.RoiNadosPixel.getVisitorId();
assert.ok(/^ld_[a-z0-9]{6,30}$/i.test(visitorId));
const decorated = new URL(window.RoiNadosPixel.decorate('https://checkout.example/next'));
assert.strictEqual(decorated.searchParams.get('vid'), visitorId, 'API pública decora URL autorizada');

history.pushState({}, '', '/obrigado');
assert.strictEqual(pageRequests().length, 2, 'troca de rota SPA envia outra pageview');
assert.notStrictEqual(pageRequests()[1].body.eventId, first.eventId, 'navegação SPA recebe outro event_id');

window.RoiNadosPixel.identify({ email: 'cliente@example.com', phone: '+5511999999999' });
const identity = requests.find((row) => row.body.email === 'cliente@example.com');
assert.ok(identity, 'API explícita envia identidade ao backend');
assert.strictEqual(identity.body.vid, visitorId);

console.log('[PASS] tracker-runtime: SPA, identidade, UTMs e linker multi-hospedagem funcionam no runtime.');
