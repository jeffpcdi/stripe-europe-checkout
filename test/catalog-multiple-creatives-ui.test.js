'use strict';
// Exercita eventos e estado do componente TSX real sem subir workers ou enviar vídeos reais.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('../dashboard/node_modules/typescript');
const jsx = require('../dashboard/node_modules/react/jsx-runtime');
const source = fs.readFileSync(path.join(__dirname, '..', 'dashboard/components/ads/catalog-quick-campaigns-dialog.tsx'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function harness(upload, create = async () => ({ count: 5 })) {
  let cursor = 0, dirty = false, pending = [], tree, serial = 0;
  const slots = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
  const react = {
    useState(initial) {
      const i = cursor++;
      if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[i].value, (value) => {
        const next = typeof value === 'function' ? value(slots[i].value) : value;
        if (!Object.is(next, slots[i].value)) { slots[i].value = next; dirty = true; }
      }];
    },
    useRef(value) { const i = cursor++; return slots[i] || (slots[i] = { current: value }); },
    useMemo(fn, deps) { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { value: fn(), deps }; return slots[i].value; },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
    useEffect(fn, deps) {
      const i = cursor++;
      if (!slots[i] || !same(slots[i].deps, deps)) pending.push(() => {
        slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: fn() };
      });
    },
  };
  const requests = [], messages = [];
  class ApiError extends Error {}
  const props = { open: true, catalog: { id: 'cat', name: 'Loja' }, advertiserId: 'adv', advertiserCurrency: 'BRL', capabilities: {}, onClose() {}, onCreated() {} };
  const context = { AbortController, module: { exports: {} }, exports: {}, crypto: { randomUUID: () => 'key-' + (++serial) },
    require: (name) => {
      if (name === './saved-videos') return { SavedVideos: 'SavedVideos' };
      if (name === '@/lib/ads-upload') return { creativeFileError: (file) => /\.(mp4|mov)$/i.test(file.name) ? null : 'Formato inválido' };
      if (name === './market-selector') return { MarketSelector: 'MarketSelector', defaultMarket: (country = 'BR') => ({ countries: [country], languages: [] }) };
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return jsx;
      if (name === 'lucide-react') return new Proxy({}, { get: (_o, key) => String(key) });
      if (name === '@/lib/api') return {
        ApiError, adsUpload: upload, adsCatalogApiUrl: (url) => url, apiSend: async () => ({}), useAdsCatalogIdentities: () => ({ data: { identities: [] } }),
        adsCreateCatalogCampaignBatch: async (_cat, _adv, body) => { requests.push(body); return create(body); },
      };
      if (name === './tiktok-contracts') return { TIKTOK_MIN_BUDGET: 50, tiktokMinimumBudgetMessage: () => 'Mínimo 50' };
      if (name === '@/lib/toast') return { toast: new Proxy({}, { get: () => (...args) => messages.push(args) }) };
      if (name === '@/components/ui/dialog-portal') return { DialogPortal: 'DialogPortal' };
      if (name === '@/lib/use-modal-a11y') return { useModalA11y() {} };
      throw Error(name);
    },
  };
  context.exports = context.module.exports;
  vm.runInNewContext(compiled, context);
  function render() {
    let rounds = 0;
    do {
      dirty = false; cursor = 0; pending = [];
      tree = context.exports.CatalogQuickCampaignsDialog(props);
      pending.forEach((effect) => effect());
      assert.ok(++rounds < 10, 'render estabiliza');
    } while (dirty);
    return tree;
  }
  function all(node) {
    if (!node || typeof node !== 'object') return [];
    if (Array.isArray(node)) return node.flatMap((child) => all(child));
    return [node, ...all(node.props?.children)];
  }
  function find(predicate) { return all(tree).find(predicate); }
  const button = () => find((n) => n.type === 'button' && n.props.className?.startsWith('btn-primary'));
  function add(files) {
    find((n) => n.type === 'input' && n.props.type === 'file').props.onChange({ target: { files }, currentTarget: { value: '' } });
    render();
  }
  render();
  return { props, render, find, button, add, requests, messages, tree: () => tree };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));
const files = Array.from({ length: 5 }, (_, i) => ({ name: `video-${i + 1}.mp4` }));
(async () => {
  let unexpectedUploads = 0;
  const saved = harness(async () => { unexpectedUploads++; throw Error('vídeo já salvo'); });
  saved.props.open = false; saved.render();
  saved.props.catalog.creatives = Array.from({ length: 10 }, (_, i) => ({ id: 'saved-' + i, name: 'Salvo ' + i, url: `https://cdn.test/saved-${i}.mp4` }));
  saved.props.open = true; saved.render();
  await saved.button().props.onClick(); saved.render();
  assert.strictEqual(saved.requests[0].count, 10);
  assert.strictEqual(saved.requests[0].videoUrls.length, 10);
  assert.strictEqual(unexpectedUploads, 0, 'dez vídeos vinculados geram dez campanhas sem reupload');
  saved.props.open = false; saved.render();
  saved.props.advertiserId = 'other';
  saved.props.catalog = { id: 'other-cat', name: 'Outro', creatives: [] };
  saved.props.open = true; saved.render();
  assert.strictEqual(saved.button().props.disabled, true, 'trocar conta não reaproveita vídeos do catálogo anterior');
  let failCreation = true;
  const h = harness(async (file) => ({ url: 'https://cdn.test/' + file.name }), async () => {
    if (failCreation) throw Error('timeout');
    return { count: 5 };
  });
  assert.strictEqual(h.find((n) => n.type === 'input' && n.props.type === 'file').props.multiple, true);
  h.add(files);
  assert.strictEqual(h.button().props.disabled, true, 'bloqueia criação durante envio');
  await settle(); h.render();
  assert.strictEqual(h.button().props.disabled, false);
  await h.button().props.onClick(); h.render();
  assert.strictEqual(h.requests[0].count, 5);
  assert.deepStrictEqual(Array.from(h.requests[0].videoUrls), files.map((f) => 'https://cdn.test/' + f.name));
  failCreation = false;
  await h.button().props.onClick(); h.render();
  assert.strictEqual(h.requests[0].idempotencyKey, h.requests[1].idempotencyKey, 'timeout mantém chave de retry');
  h.find((n) => n.props?.['aria-label'] === 'Quantidade de campanhas').props.onChange({ target: { value: '10' } }); h.render();
  await h.button().props.onClick(); h.render();
  assert.strictEqual(h.requests.at(-1).count, 10);
  assert.strictEqual(h.requests.at(-1).videoUrls.length, 5);

  let failed = true;
  const retry = harness(async (file) => { if (failed && file.name === files[1].name) throw Error('Falha de rede'); return { url: 'https://cdn.test/' + file.name }; });
  retry.add(files); await settle(); retry.render();
  assert.strictEqual(retry.button().props.disabled, true, 'não omite silenciosamente arquivo com falha');
  failed = false;
  retry.find((n) => n.props?.['aria-label'] === 'Tentar novamente video-2.mp4').props.onClick();
  await settle(); retry.render();
  assert.strictEqual(retry.button().props.disabled, false);
  await retry.button().props.onClick(); retry.render();
  assert.deepStrictEqual(Array.from(retry.requests[0].videoUrls), files.map((f) => 'https://cdn.test/' + f.name), 'retry mantém ordem do criativo');
  retry.find((n) => n.props?.['aria-label'] === 'Remover video-3.mp4').props.onClick(); retry.render();
  await retry.button().props.onClick();
  assert.strictEqual(retry.requests.at(-1).count, 4, 'remoção recalcula uma campanha por criativo');

  let complete;
  const stale = harness(() => new Promise((resolve) => { complete = resolve; }));
  stale.add([files[0]]);
  stale.props.open = false; stale.render();
  stale.props.open = true; stale.render();
  complete({ url: 'https://cdn.test/old.mp4' });
  await settle(); stale.render();
  assert.strictEqual(stale.button().props.disabled, true, 'upload de modal fechado não contamina novo lote');
  const invalid = harness(async () => { throw Error('não deveria enviar'); });
  invalid.add([{ name: 'foto.png' }]); await settle(); invalid.render();
  assert.strictEqual(invalid.button().props.disabled, true);
  assert.strictEqual(invalid.messages.length, 1);
  console.log('catalog-multiple-creatives-ui: seleção múltipla, payload, retry, remoção e fechamento durante upload OK');
})().catch((e) => { console.error(e); process.exitCode = 1; });
