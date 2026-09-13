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
    useMemo(fn, deps) {
      const index = cursor++;
      if (!slots[index] || deps.some((dep, i) => !Object.is(dep, slots[index].deps[i]))) slots[index] = { deps, value: fn() };
      return slots[index].value;
    },
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

  // O hook e a árvore reais, sem iniciar WebGL nem consultar APIs.
  const liveModule = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../dashboard/lib/live-globe.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module: liveModule, exports: liveModule.exports });
  let clock = Date.now(), refreshes = 0, liveRefreshes = 0;
  class TestDate extends Date { static now() { return clock; } }
  const live = { data: { ts: new Date(clock).toISOString(), summary: { online: 5, countries: [{ code: 'BR', count: 5 }] } }, mutate: () => liveRefreshes++, isLoading: false };
  const intervals = new Map(), timers = new Map();
  let timerId = 0;
  const hero = mount('components/overview/hero-globe.tsx', 'HeroGlobe', {
    metrics: { allPeriod: false }, periodPicker: 'Período', onRefresh: () => refreshes++,
    purchases: [
      { at: new Date(clock - 1000).toISOString(), country: 'BR', amount: 0 },
      { at: new Date(clock - 600001).toISOString(), country: 'US', amount: 99999 },
      { at: new Date(clock + 60000).toISOString(), country: 'FR', amount: 88888 },
      { at: 'inválida', country: 'CL', amount: 77777 },
    ],
  }, {
    'next/dynamic': { __esModule: true, default: () => 'GlobePanel' },
    '@/lib/api': { useLive: () => live },
    '@/lib/live-globe': liveModule.exports,
    '@/lib/countries': { countryName: code => code === 'BR' ? 'Brasil' : code },
    '@/lib/format': { countryFlag: code => code, fmtCurrency: amount => `valor:${amount}`, timeAgo: () => 'agora' },
    '@/components/geo/globe-boundary': { GlobeBoundary: 'GlobeBoundary' },
    '@/components/overview/overview-metrics': { OverviewMetrics: 'OverviewMetrics' },
  }, {
    Date: TestDate,
    window: {
      setInterval: fn => { intervals.set(++timerId, fn); return timerId; }, clearInterval: id => intervals.delete(id),
      setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id),
    },
  });
  const globe = () => hero.find(node => node.type === 'OverviewMetrics').props.globe.props.children;
  assert.equal(globe().type, 'GlobePanel');
  assert.equal(globe().props.embedded, true);
  assert.equal(globe().props.online, 5);
  assert.equal(globe().props.pulseCodes.length, 0, 'entrada na página não simula chegada');
  assert(hero.find(node => node.props?.['aria-label'] === 'Visitantes ao vivo'), 'faixa ao vivo é irmã das métricas, fora da barreira WebGL');
  assert(!hero.find(node => node.type === 'GlobeBoundary'), 'somente o slot do canvas está na barreira');
  assert.equal(hero.all().filter(node => node.props?.className === 'observatory-purchase').length, 1, 'compras usam janela de 10min, ignorando datas inválidas/futuras');
  assert(hero.find(node => node.type === 'strong' && node.props.children === 'valor:0'), 'compra de valor zero não vira ausência');
  hero.find(node => node.type === 'button' && node.props.title === 'Localizar Brasil no globo').props.onClick(); hero.render();
  assert.equal(globe().props.focusCode, 'BR', 'país da faixa controla o globo');
  const revision = globe().props.focusRevision;
  hero.props.metrics = { allPeriod: true }; hero.render();
  assert.equal(globe().props.focusCode, 'BR');
  assert.equal(globe().props.focusRevision, revision, 'período não muda câmera');
  assert.equal(globe().key, null, 'canvas não usa período como chave');
  assert.equal(globe().props.online, 5, 'Tudo não muda presença atual');
  hero.find(node => node.props?.['aria-label'] === 'Atualizar indicadores').props.onClick();
  assert.equal(refreshes, 1); assert.equal(liveRefreshes, 1, 'atualizar revalida indicadores e presença');
  live.data = { ...live.data, summary: { online: 6, countries: [{ code: 'BR', count: 6 }] } }; hero.render();
  assert.equal(globe().props.pulseCodes.join(','), 'BR', 'aumento real cria destaque');
  live.error = new Error('rede'); hero.render();
  assert.equal(globe().props.online, null); assert.equal(globe().props.countries.length, 0);
  assert.equal(globe().props.pulseCodes.length, 0);
  assert(hero.find(node => node.type === 'span' && node.props.children === 'sem atualização'));
  delete live.error; hero.render();
  assert.equal(globe().props.pulseCodes.length, 0, 'reconexão não fabrica novo acesso');
  clock += 21000; intervals.forEach(fn => fn()); hero.render();
  assert.equal(globe().props.online, null, 'leitura vencida não permanece ao vivo');
  hero.props.purchasesStale = true; hero.render();
  assert(hero.find(node => node.props?.children === 'Histórico não atualizado'));
  console.log('observatório: isolamento WebGL, filtros, foco, compras, presença, reconexão e atualização OK');

  const info = mount('components/overview/overview-metrics.tsx', 'MetricInfo', { title: 'Faturamento', children: 'Explicação' });
  let returnedFocus = 0;
  const details = { open: true, querySelector: () => ({ focus: () => returnedFocus++ }), contains: target => target === 'interno' };
  const disclosure = info.find(node => node.type === 'details');
  disclosure.props.onKeyDown({ key: 'Escape', currentTarget: details });
  assert.equal(details.open, false); assert.equal(returnedFocus, 1, 'Escape fecha e devolve foco ao resumo');
  details.open = true;
  disclosure.props.onBlur({ currentTarget: details, relatedTarget: 'interno' });
  assert.equal(details.open, true, 'foco interno não fecha a explicação');
  disclosure.props.onBlur({ currentTarget: details, relatedTarget: null });
  assert.equal(details.open, false, 'sair do foco recolhe o detalhe');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
