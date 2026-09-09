'use strict';
// Executa os blocos reais do motor/worker sem subir Express nem serviços externos.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
(async () => {
  let fail = true, ack = 0, log = [], redisDedup = 0;
  const n = { acc: 'a', event: 'CompletePayment', registerSale: true, gateway: 'g', orderId: 'o' };
  const rdb = {
    enabled: true, pushConversionLog: async (r) => { log.push(r); },
    heartbeatConvWorker() {}, acquireLease: async () => ({ acquired: true }), renewLease: async () => true, releaseLease: async () => {},
    reserveConversions: async () => [{ env: { n }, raw: 'pedido' }],
    ackConversion: async () => { ack++; },
  };
  const context = vm.createContext({
    console: { error() {} }, rdb, setInterval: () => ({ unref() {} }), clearInterval() {},
    db: { markOrderProcessed: async () => {
      if (fail) throw Object.assign(new Error('banco fora'), { code: 'ORDER_PERSISTENCE_UNAVAILABLE' });
      return false;
    } },
    seenPixelEvent: async () => { redisDedup++; return false; },
  });
  const start = source.indexOf('async function processConversion(n)');
  const end = source.indexOf('// ── Ponte DURÁVEL', start);
  vm.runInContext(source.slice(start, end), context);
  const workerStart = source.indexOf('let _convWorkerBusy = false;');
  const workerEnd = source.indexOf('\nif (rdb.enabled)', workerStart);
  vm.runInContext(source.slice(workerStart, workerEnd), context);
  const receipt = await context.processConversion(n);
  assert.strictEqual(receipt.retryable, true);
  assert.strictEqual(redisDedup, 0, 'falha anterior a qualquer efeito ou dedup Redis');
  await context.convWorkerTick();
  assert.strictEqual(ack, 0, 'falha do Neon mantém item durável reservado');
  fail = false;
  await context.convWorkerTick();
  assert.strictEqual(ack, 1, 'pedido já confirmado no Neon pode ser reconhecido sem recontar');
  assert.ok(log.some((r) => /durável/.test(r.status)));
  context.processConversion = async () => { throw Error('falha inesperada'); };
  await context.convWorkerTick();
  assert.strictEqual(ack, 1, 'exceção também não confirma o item');
  let releases = 0, reservations = 0;
  rdb.acquireLease = async () => ({ acquired: false });
  rdb.releaseLease = async () => { releases++; };
  rdb.reserveConversions = async () => { reservations++; return []; };
  await context.convWorkerTick();
  assert.equal(reservations, 0, 'sem posse não reserva eventos');
  assert.equal(releases, 0, 'não libera o lease de outro worker');
  // Sem fila disponível, o caminho inline mantém uma nova tentativa em memória.
  const timers = [];
  rdb.enabled = false;
  context.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return { unref() {} }; };
  context.processConversion = async () => ({ retryable: true });
  const submitStart = source.indexOf('function submitConversion(n)');
  const submitEnd = source.indexOf('// Worker:', submitStart);
  vm.runInContext(source.slice(submitStart, submitEnd), context);
  context.submitConversion(n);
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(timers.length, 1);
  assert.strictEqual(timers[0].ms, 30000);
  // O recebimento HTTP aguarda a persistência e não confirma fila indisponível.
  context.process = { env: { NODE_ENV: 'production' } };
  assert.strictEqual(await context.acceptWebhookConversion({}), false, 'produção sem fila pede reentrega');
  rdb.enabled = true;
  let confirmQueue;
  rdb.enqueueConversion = () => new Promise(resolve => { confirmQueue = resolve; });
  context.convWorkerTick = async () => {};
  let accepted = false;
  const pending = context.acceptWebhookConversion({}).then(result => { accepted = result; });
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(accepted, false, 'não confirma antes da fila');
  confirmQueue(true);
  await pending;
  assert.strictEqual(accepted, true);
  rdb.enqueueConversion = async () => false;
  assert.strictEqual(await context.acceptWebhookConversion({}), false);
  rdb.enqueueConversion = async () => { throw Error('offline'); };
  assert.strictEqual(await context.acceptWebhookConversion({}), false);
  const redisSource = fs.readFileSync(path.join(__dirname, '..', 'redis.js'), 'utf8');
  const queueContext = vm.createContext({ enabled: true, Date, JSON, Number, console,
    CONV_QUEUE: 'isolated', CONV_QUEUE_CAP: 2, redisRandId: () => 'qid',
    redis: { eval: async (script, keys, args) => {
      assert.ok(!script.includes('LTRIM'), 'não remove pedidos antigos');
      assert.strictEqual(keys[0], 'isolated');
      assert.strictEqual(args[0], '2');
      return 0;
    } },
  });
  const enqueueStart = redisSource.indexOf('async function enqueueConversion(n)');
  const enqueueEnd = redisSource.indexOf('// Move até', enqueueStart);
  vm.runInContext(redisSource.slice(enqueueStart, enqueueEnd), queueContext);
  assert.strictEqual(await queueContext.enqueueConversion({ orderId: 'full' }), false, 'fila cheia recusa recebimento');
  queueContext.redis.eval = async () => 1;
  assert.strictEqual(await queueContext.enqueueConversion({ orderId: 'accepted' }), true);
  console.log('conversion-database-retry: falha preserva venda, recuperação confirma e fallback inline tenta novamente OK');
})().catch((e) => { console.error(e); process.exitCode = 1; });
