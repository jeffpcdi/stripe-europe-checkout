'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('../dashboard/node_modules/typescript');
const output = ts.transpileModule(fs.readFileSync('dashboard/lib/use-modal-a11y.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
let active, cursor = 0, effects = [], slots;
const listeners = new Set();
const document = { activeElement: null, body: { style: { overflow: 'auto' } }, addEventListener(_name, cb) { listeners.add(cb); }, removeEventListener(_name, cb) { listeners.delete(cb); } };
function element(name) { return { name, isConnected: true, getClientRects: () => [1], closest: () => null, focus() { document.activeElement = this; } }; }
const react = {
  useRef(value) { const i = cursor++; return slots[i] || (slots[i] = { current: value }); },
  useEffect(fn, deps) { const i = cursor++; if (!slots[i] || deps.some((dep, n) => dep !== slots[i].deps[n])) { const own = slots; effects.push(() => { own[i]?.cleanup?.(); own[i] = { deps, cleanup: fn() }; }); } },
};
const moduleObj = { exports: {} };
vm.runInNewContext(output, { exports: moduleObj.exports, module: moduleObj, document, require: () => react });
const { useModalA11y } = moduleObj.exports;
function dialog(name) {
  const first = element(name + '-first'), last = element(name + '-last');
  const container = { ...element(name), hasAttribute: () => true, querySelectorAll: () => [first, last] };
  return { slots: [], ref: { current: container }, first, last, render(open, close) { slots = this.slots; cursor = 0; effects = []; useModalA11y(open, this.ref, close); effects.forEach(fn => fn()); } };
}
function key(key, shiftKey = false) {
  const event = { key, shiftKey, defaultPrevented: false, stopped: false, preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
  for (const listener of listeners) { listener(event); if (event.stopped) break; }
  return event;
}
let oldClose = 0, newClose = 0, childClose = 0;
const trigger = element('trigger'); trigger.focus();
const parent = dialog('parent');
parent.render(true, () => oldClose++);
assert.equal(document.body.style.overflow, 'hidden');
parent.last.focus();
parent.render(true, () => newClose++);
assert.equal(document.activeElement, parent.last, 'novo callback não rouba foco durante digitação');
assert.equal(listeners.size, 1, 'não duplica listener ao renderizar');
key('Escape'); assert.equal(newClose, 1); assert.equal(oldClose, 0);
const child = dialog('child'); child.render(true, () => childClose++);
key('Escape'); assert.equal(childClose, 1); assert.equal(newClose, 1, 'ESC fecha apenas o diálogo superior');
child.last.focus(); assert.equal(key('Tab').defaultPrevented, true); assert.equal(document.activeElement, child.first);
assert.equal(key('Tab', true).defaultPrevented, true); assert.equal(document.activeElement, child.last);
child.render(false, () => {});
assert.equal(document.body.style.overflow, 'hidden', 'fechar filho mantém trava do pai');
assert.equal(document.activeElement, parent.last);
parent.render(false, () => {});
assert.equal(document.body.style.overflow, 'auto');
assert.equal(document.activeElement, trigger);
assert.equal(listeners.size, 0);
console.log('dashboard-modal-focus: callback estável, teclado, modais sobrepostos e retorno de foco OK');
