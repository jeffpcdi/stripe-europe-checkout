'use strict';
// Executa os módulos reais com Neon simulado, sem ler env, disco de dados ou rede.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const root = path.join(__dirname, '..');
const silent = { log() {}, warn() {}, error() {} };
function load(file, stubs, env = {}) {
  const sandbox = {
    module: { exports: {} }, process: { env }, console: silent, Buffer,
    setTimeout: (fn) => { queueMicrotask(fn); return { unref() {} }; },
    setInterval: () => ({ unref() {} }), clearInterval() {},
    require: (name) => {
      if (name in stubs) return stubs[name];
      if (['crypto', 'otplib'].includes(name)) return require(name);
      throw new Error('Dependência não autorizada no teste: ' + name);
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox, { filename: file });
  return sandbox.module.exports;
}
(async () => {
  let fail = true, calls = 0, failBoots = 0;
  const orders = new Set(), writes = [];
  const sql = async (strings, ...values) => {
    const text = strings.join('?'); calls++;
    if (fail || (text.includes('CREATE TABLE IF NOT EXISTS accounts') && failBoots-- > 0)) throw new Error('Neon indisponível');
    if (text.includes('INSERT INTO processed_orders')) {
      const key = JSON.stringify(values);
      if (orders.has(key)) return [];
      orders.add(key); return [{ order_id: values[2] }];
    }
    writes.push({ text, values });
    return [];
  };
  const env = { NODE_ENV: 'production', DATABASE_URL: 'postgresql://test:test@neon.invalid/test' };
  const db = load('db.js', { '@neondatabase/serverless': { neon: () => sql } }, env);
  assert.strictEqual(await db.initWithRetry(3), false);
  assert.strictEqual(calls, 3, 'falha de boot repete Neon, nunca migra para mock');
  assert.strictEqual(db.isReady(), false);
  assert.ok(Object.values(db.migrationStatus()).every((v) => v === false));
  assert.strictEqual((await db.ping()).ok, false);
  assert.strictEqual(await db.getAccountByEmail('admin@roi-nados.local'), null);
  const auth = load('auth.js', { './db': db }, env);
  for (let i = 0; i < 10; i++) {
    const result = await auth.login({ email: 'admin@roi-nados.local', password: 'qualquer' });
    assert.strictEqual(result.dbDown, true, 'queda de banco não vira credencial inválida nem bloqueio por tentativas');
    assert.ok(!result.token && !result.account);
  }
  await assert.rejects(db.markOrderProcessed('acc-a', 'gw', 'order-1'), { code: 'ORDER_PERSISTENCE_UNAVAILABLE' });
  assert.strictEqual(orders.size, 0);
  fail = false; failBoots = 1;
  assert.strictEqual(await db.initWithRetry(3), true, 'recupera usando o mesmo Neon');
  assert.strictEqual(db.isReady(), true);
  assert.strictEqual((await db.ping()).ok, true);
  assert.strictEqual(await db.markOrderProcessed('acc-a', 'gw', 'order-1'), true);
  assert.strictEqual(await db.markOrderProcessed('acc-a', 'gw', 'order-2'), true, 'pedidos distintos são independentes');
  assert.strictEqual(await db.markOrderProcessed('acc-b', 'gw', 'order-1'), true, 'contas isoladas');
  assert.strictEqual(await db.markOrderProcessed('acc-a', 'gw-2', 'order-1'), true, 'gateways isolados');
  assert.strictEqual(await db.markOrderProcessed('acc-a', 'gw', 'order-1'), false, 'retry real não duplica');
  const lead = { id: 'lead-1', stage: 'purchased', acc: 'acc-a' };
  await db.upsertLead('acc-a', lead);
  await db.insertEvent('acc-a', { id: 'evt-1', type: 'purchase' });
  await db.saveConfig('acc-a', { test: 123 });
  assert.strictEqual(writes.find((q) => q.text.includes('INSERT INTO leads')).values[1], 'acc-a');
  assert.strictEqual(writes.find((q) => q.text.includes('INSERT INTO events')).values[1], 'acc-a');
  assert.deepStrictEqual(JSON.parse(writes.find((q) => q.text.includes('INSERT INTO config')).values[1]), { test: 123 });
  // Uma falha durante operação também não troca o backend para dados locais.
  fail = true;
  assert.strictEqual(await db.archiveOldEvents(30), 0);
  fail = false;
  assert.strictEqual(await db.markOrderProcessed('acc-a', 'gw', 'order-3'), true);
  const disabled = load('db.js', { '@neondatabase/serverless': { neon: () => { throw Error('não deve conectar'); } } }, { NODE_ENV: 'production' });
  assert.strictEqual(await disabled.init(), false);
  assert.strictEqual(disabled.enabled, false);
  await assert.rejects(disabled.markOrderProcessed('a', 'g', 'o'), { code: 'ORDER_PERSISTENCE_UNAVAILABLE' });
  // Sessão só existe quando a gravação durável confirma.
  const authNoSession = load('auth.js', { './db': {
    enabled: true, getAccountByEmail: async () => ({ id: 'a', password_hash: auth.hashPassword('senha') }),
    createAuthSession: async () => null,
  } }, env);
  assert.strictEqual((await authNoSession.login({ email: 'a@test.local', password: 'senha' })).dbDown, true);
  console.log('db-failure-integrity: produção sem mock, retry, auth e contratos multi-tenant OK');
})().catch((e) => { console.error(e); process.exitCode = 1; });
