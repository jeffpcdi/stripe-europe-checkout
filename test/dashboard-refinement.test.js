'use strict';

// Exercita os handlers React reais sem navegador, serviços externos ou escritas.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('../dashboard/node_modules/typescript');
const jsx = require('../dashboard/node_modules/react/jsx-runtime');
const settle = () => new Promise(resolve => setImmediate(resolve));

function mount(relative, name, props, modules = {}, globals = {}) {
  let cursor = 0, changed = false, effects = [], tree;
  const slots = [];
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, value => {
        const next = typeof value === 'function' ? value(slots[index].value) : value;
        if (!Object.is(next, slots[index].value)) { slots[index].value = next; changed = true; }
      }];
    },
    useRef(initial) { const index = cursor++; return slots[index] || (slots[index] = { current: initial }); },
    useId: () => 'dialog-test',
    useEffect(fn, deps) {
      const index = cursor++;
      if (!slots[index] || deps.some((dep, i) => !Object.is(dep, slots[index].deps[i]))) {
        effects.push(() => { slots[index]?.cleanup?.(); slots[index] = { deps, cleanup: fn() }; });
      }
    },
  };
  const module = { exports: {} };
  const output = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../dashboard', relative), 'utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(output + `\nmodule.exports.testComponent = ${name};`, {
    module, exports: module.exports, ...globals,
    require(dependency) {
      if (dependency === 'react') return react;
      if (dependency === 'react/jsx-runtime') return jsx;
      if (modules[dependency]) return modules[dependency];
      return new Proxy({}, { get: (_, key) => key });
    },
  });
  function nodes(node) {
    if (!node || typeof node !== 'object') return [];
    if (Array.isArray(node)) return node.flatMap(nodes);
    return [node, ...nodes(node.props?.children)];
  }
  function render() {
    let rounds = 0;
    do {
      cursor = 0; changed = false; effects = [];
      tree = module.exports.testComponent(props);
      effects.forEach(fn => fn());
      assert(++rounds < 12, 'render deve estabilizar');
    } while (changed);
  }
  render();
  return { render, props, find: predicate => nodes(tree).find(predicate), all: () => nodes(tree) };
}

async function main() {
  let close = 0, closeByKeyboard;
  const modal = mount('components/ui/modal.tsx', 'Modal', { isOpen: true, busy: true, title: 'Salvar', onClose: () => close++ }, {
    '@/lib/use-modal-a11y': { useModalA11y: (_open, _ref, onClose) => { closeByKeyboard = onClose; } },
  });
  assert.equal(modal.find(node => node.props?.role === 'dialog').props['aria-busy'], true);
  assert.equal(modal.find(node => node.props?.['aria-label'] === 'Fechar').props.disabled, true);
  const backdrop = modal.find(node => node.props?.onClick && node.type === 'div');
  const target = {};
  backdrop.props.onClick({ target, currentTarget: target }); closeByKeyboard();
  assert.equal(close, 0, 'não fecha durante gravação por backdrop ou teclado');
  modal.props.busy = false; modal.render(); closeByKeyboard();
  assert.equal(close, 1, 'volta a fechar após gravação');

  class ApiError extends Error { get display() { return this.message; } }
  let reloads = 0;
  const pixels = { error: new Error('conexão'), isLoading: false, mutate: async () => reloads++ };
  const pixel = mount('components/ads/pixel-binding-card.tsx', 'PixelBindingCard', { active: true, advertiserId: 'adv' }, {
    '@/lib/api': { ApiError, useAdsTikTokPixels: () => pixels },
  });
  assert(!pixel.all().some(node => node.type === 'select'), 'falha de consulta não oferece opções antigas');
  pixel.find(node => node.type === 'button').props.onClick(); await settle();
  assert.equal(reloads, 1, 'falha oferece reconsulta, sem escrita');

  let data, rejectSave = true, saves = 0;
  const daily = mount('components/config/config-view.tsx', 'DailyReportCard', {}, {
    swr: { __esModule: true, default: () => ({ data, mutate: async value => { if (value) data = value; } }) },
    '@/lib/api': { ApiError, apiSend: async (_path, _method, body) => { saves++; if (rejectSave) throw new ApiError('Tente novamente'); return { ok: true, settings: body }; } },
    '@/lib/toast': { toast: { success() {} } },
  }, { localStorage: { getItem: () => null } });
  assert.equal(daily.find(node => node.type === 'fieldset').props.disabled, true, 'não sobrescreve configuração antes de carregá-la');
  data = { defaultCurrency: 'BRL', whatsappTo: '5511999999999', dailyReportHour: 8 };
  daily.render();
  daily.find(node => node.props?.type === 'tel').props.onChange({ target: { value: '5521888888888' } }); daily.render();
  data = { ...data, whatsappTo: '5531777777777' }; daily.render();
  assert.equal(daily.find(node => node.props?.type === 'tel').props.value, '5521888888888', 'revalidação não sobrescreve rascunho');
  daily.find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); await settle(); daily.render();
  assert.equal(saves, 1);
  assert.equal(daily.find(node => node.props?.type === 'tel').props.value, '5521888888888', 'erro mantém os dados digitados');
  assert.equal(daily.find(node => node.props?.role === 'status').props.children, 'Tente novamente');
  rejectSave = false;
  daily.find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); await settle(); daily.render();
  assert.equal(data.whatsappTo, '5521888888888');
  assert.equal(daily.find(node => node.props?.type === 'submit').props.disabled, true, 'sucesso limpa pendência e impede salvar sem alteração');
  console.log('dashboard-refinement: modal ocupado, recuperação de Pixel e rascunho de configurações OK');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
