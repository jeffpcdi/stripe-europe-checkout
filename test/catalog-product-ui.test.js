'use strict';
// Eventos dos componentes React reais, sem navegador, uploads ou servidor.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('../dashboard/node_modules/typescript');
const jsx = require('../dashboard/node_modules/react/jsx-runtime');

class ApiError extends Error { get display() { return this.message; } }
const settle = () => new Promise(resolve => setImmediate(resolve));
function mount(file, name, props, api = {}) {
  let cursor = 0, dirty = false, pending = [], tree, serial = 0;
  const slots = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, value => {
        const next = typeof value === 'function' ? value(slots[index].value) : value;
        if (!Object.is(next, slots[index].value)) { slots[index].value = next; dirty = true; }
      }];
    },
    useRef(value) { const index = cursor++; return slots[index] || (slots[index] = { current: value }); },
    useEffect(fn, deps) {
      const index = cursor++;
      if (!slots[index] || !same(slots[index].deps, deps)) pending.push(() => { slots[index]?.cleanup?.(); slots[index] = { deps, cleanup: fn() }; });
    },
  };
  const context = { module: { exports: {} }, exports: {}, crypto: { randomUUID: () => 'key-' + (++serial) }, AbortController,
    require: dependency => {
      if (dependency === 'react') return react;
      if (dependency === 'react/jsx-runtime') return jsx;
      if (dependency === 'lucide-react') return new Proxy({}, { get: (_target, key) => key });
      if (dependency === '@/lib/api') return { ApiError, adsCatalogApiUrl: (url, adv) => url + '?adAccountId=' + adv, ...api };
      if (dependency === '@/lib/ads-upload') return { creativeFileError: file => /\.(mp4|mov)$/i.test(file.name) ? null : 'Formato inválido' };
      if (dependency === '@/lib/toast') return { toast: { error() {}, success() {}, info() {} } };
      if (dependency === './catalog-creatives') return { CatalogCreatives: 'CatalogCreatives' };
      throw new Error(dependency);
    },
  };
  context.exports = context.module.exports;
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../dashboard/components/ads', file), 'utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
  function render() {
    let rounds = 0;
    do {
      dirty = false; cursor = 0; pending = [];
      tree = context.exports[name](props);
      pending.forEach(effect => effect());
      assert.ok(++rounds < 12, 'render estabiliza');
    } while (dirty);
  }
  function nodes(node) {
    if (!node || typeof node !== 'object') return [];
    if (Array.isArray(node)) return node.flatMap(nodes);
    return [node, ...nodes(node.props?.children)];
  }
  render();
  return { props, render, all: () => nodes(tree), find: predicate => nodes(tree).find(predicate) };
}

async function main() {
  const requests = [];
  let mode = 'missing', created = null;
  const h = mount('catalog-product-import.tsx', 'CatalogProductImport', {
    advertiserId: 'adv', countries: [{ code: 'BR', name: 'Brasil' }], onBusyChange() {}, onClose() {}, onCreated: catalog => { created = catalog; },
  }, { apiSend: async (url, method, body) => {
    requests.push({ url, method, body });
    if (mode === 'missing') throw Object.assign(new ApiError('Informe a marca'), { code: 'CATALOG_PRODUCT_INCOMPLETE', fields: [{ field: 'brand', message: 'obrigatório' }], product: {} });
    if (mode === 'timeout') throw new Error('Timeout');
    return { catalog: { id: 'cat' }, syncStarted: true };
  } });
  const create = () => h.find(node => node.type === 'button' && node.props.className.startsWith('btn-primary'));
  h.find(node => node.type === 'input' && node.props.type === 'url').props.onChange({ target: { value: 'https://loja.example/produto' } }); h.render();
  const videos = h.find(node => node.type === 'CatalogCreatives');
  videos.props.onPendingChange(1); h.render();
  assert.equal(create().props.disabled, true, 'vídeo com falha não é omitido da criação');
  videos.props.onPendingChange(0); h.render();
  await create().props.onClick(); await settle(); h.render();
  assert.ok(h.all().some(node => node.props?.role === 'alert'));
  const brand = h.find(node => node.type === 'input' && node.props.type === 'text');
  assert.ok(brand, 'pede só o campo ausente');
  assert.equal(h.all().filter(node => node.type === 'input').length, 2);
  brand.props.onChange({ target: { value: 'Marca real' } }); h.render();
  mode = 'timeout';
  await create().props.onClick(); await settle(); h.render();
  await create().props.onClick(); await settle(); h.render();
  assert.equal(requests.at(-1).body.idempotencyKey, requests.at(-2).body.idempotencyKey, 'timeout preserva tentativa');
  assert.equal(requests.at(-1).body.product.brand, 'Marca real');
  mode = 'success';
  await create().props.onClick(); await settle(); h.render();
  assert.equal(created.id, 'cat');
  assert.ok(requests.every(item => item.url.endsWith('adAccountId=adv')));

  let fail = true, pendingCount = 0;
  const linked = [];
  const upload = mount('catalog-creatives.tsx', 'CatalogCreatives', {
    value: [], onBusyChange() {}, onPendingChange: count => { pendingCount = count; },
    onAdd: async creative => { linked.push(creative); }, onRemove: async () => {},
  }, { adsUpload: async file => { if (file.name === 'first.mp4' && fail) throw new Error('Rede indisponível'); return { url: 'https://app.example/' + file.name }; } });
  upload.find(node => node.type === 'input').props.onChange({ target: { files: [{ name: 'first.mp4' }, { name: 'second.mov' }] }, currentTarget: { value: '' } });
  upload.render(); await settle(); upload.render();
  assert.equal(pendingCount, 1);
  assert.equal(linked.length, 1);
  assert.equal(linked[0].sortOrder, 1);
  fail = false;
  upload.find(node => node.props?.['aria-label'] === 'Reenviar first.mp4').props.onClick();
  await settle(); upload.render();
  assert.equal(pendingCount, 0);
  assert.equal(linked[1].sortOrder, 0, 'retry preserva posição inicial');
  assert.equal(linked[1].name, 'first.mp4');
  console.log('catalog-product-ui: campos ausentes, vídeos pendentes, retry, ordem e escopo OK');
}
main().catch(err => { console.error(err); process.exitCode = 1; });
