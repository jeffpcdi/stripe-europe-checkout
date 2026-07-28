'use strict';
// Lease distribuído do Redis: token de proprietário, SET NX EX, renovação e
// liberação atômicas. Cliente 100% fake; este teste nunca acessa rede.
const assert = require('assert');
const { _leaseInternals } = require('../redis');

class FakeRedis {
  constructor() {
    this.now = 0;
    this.rows = new Map();
    this.setCalls = [];
    this.evalCalls = [];
    this.failSet = false;
    this.failEval = false;
  }

  live(key) {
    const row = this.rows.get(key);
    if (row && row.expiresAt <= this.now) {
      this.rows.delete(key);
      return null;
    }
    return row || null;
  }

  advance(ms) {
    this.now += ms;
  }

  async set(key, value, options) {
    this.setCalls.push({ key, value, options });
    if (this.failSet) throw new Error('redis offline');
    if (options && options.nx && this.live(key)) return null;
    this.rows.set(key, { value, expiresAt: this.now + Number(options.ex) * 1000 });
    return 'OK';
  }

  async eval(script, keys, args) {
    this.evalCalls.push({ script, keys, args });
    if (this.failEval) throw new Error('eval offline');
    const key = keys[0];
    const row = this.live(key);
    if (!row || row.value !== args[0]) return 0;
    if (script.includes("redis.call('expire'")) {
      row.expiresAt = this.now + Number(args[1]) * 1000;
      return 1;
    }
    if (script.includes("redis.call('del'")) {
      this.rows.delete(key);
      return 1;
    }
    throw new Error('script desconhecido no fake');
  }
}

let passed = 0;
function ok(condition, message) {
  assert.ok(condition, message);
  console.log('  ok  ' + message);
  passed++;
}

(async () => {
  const fake = new FakeRedis();
  const firstWorker = _leaseInternals.createLeaseManager(fake, true);
  const secondWorker = _leaseInternals.createLeaseManager(fake, true);

  const first = await firstWorker.acquire('ads:acc-1:adv-1', 10);
  ok(first.acquired === true && first.backend === 'redis', 'primeiro worker adquire o lease Redis');
  ok(typeof first.token === 'string' && first.token.length >= 32, 'lease devolve token forte ao proprietário');
  ok(fake.setCalls[0].options.nx === true && fake.setCalls[0].options.ex === 10, 'aquisição usa SET NX EX');

  const busy = await secondWorker.acquire('ads:acc-1:adv-1', 10);
  ok(busy.acquired === false && busy.reason === 'busy', 'segundo worker não adquire lease ocupado');

  const forged = { ...first, token: 'outro-proprietario' };
  ok(await secondWorker.renew(forged, 20) === false, 'token diferente não renova o lease');
  ok(await secondWorker.release(forged) === false, 'token diferente não libera o lease');

  fake.advance(8000);
  ok(await firstWorker.renew(first, 20) === true, 'proprietário renova o TTL atomicamente');
  const comparedOnRenew = fake.evalCalls.some((call) => (
    call.script.includes("redis.call('expire'")
    && call.keys[0] === first.key
    && call.args[0] === first.token
  ));
  ok(comparedOnRenew, 'renovação compara o token dentro do EVAL');
  fake.advance(3000); // TTL original venceu; o TTL renovado continua válido.
  const stillBusy = await secondWorker.acquire('ads:acc-1:adv-1', 10);
  ok(stillBusy.acquired === false && stillBusy.reason === 'busy', 'renovação mantém exclusão após o TTL original');

  ok(await firstWorker.release(first) === true, 'proprietário libera o lease atomicamente');
  const comparedOnRelease = fake.evalCalls.some((call) => (
    call.script.includes("redis.call('del'")
    && call.keys[0] === first.key
    && call.args[0] === first.token
  ));
  ok(comparedOnRelease, 'liberação compara o token dentro do EVAL');
  const afterRelease = await secondWorker.acquire('ads:acc-1:adv-1', 5);
  ok(afterRelease.acquired === true, 'outro worker adquire depois da liberação válida');

  // Um proprietário atrasado não pode apagar o lease adquirido após expiração.
  const stale = await firstWorker.acquire('ads:stale', 5);
  fake.advance(6000);
  const replacement = await secondWorker.acquire('ads:stale', 30);
  ok(replacement.acquired === true && replacement.token !== stale.token, 'lease expirado recebe novo proprietário');
  ok(await firstWorker.release(stale) === false, 'proprietário antigo não apaga o lease novo');
  ok(fake.live(replacement.key).value === replacement.token, 'lease do novo proprietário permanece intacto');

  // Redis configurado indisponível deve falhar fechado, sem fallback em memória.
  const offline = new FakeRedis();
  offline.failSet = true;
  const offlineManager = _leaseInternals.createLeaseManager(offline, true);
  const failed = await offlineManager.acquire('ads:offline', 10);
  ok(failed.acquired === false && failed.reason === 'redis_error', 'erro de rede na aquisição falha fechado');
  ok(offline.rows.size === 0, 'erro de Redis não cria lease local permissivo');

  const missingClient = _leaseInternals.createLeaseManager(null, true);
  const unavailable = await missingClient.acquire('ads:missing-client', 10);
  ok(unavailable.acquired === false && unavailable.reason === 'redis_unavailable', 'configuração sem cliente falha fechado');

  const evalOffline = new FakeRedis();
  const evalManager = _leaseInternals.createLeaseManager(evalOffline, true);
  const held = await evalManager.acquire('ads:eval-offline', 10);
  evalOffline.failEval = true;
  ok(await evalManager.renew(held, 10) === false, 'falha do EVAL não declara renovação');
  ok(await evalManager.release(held) === false, 'falha do EVAL não declara liberação');

  // Desenvolvimento sem Redis continua funcional, mas com exclusão local.
  const memoryManager = _leaseInternals.createLeaseManager(null, false);
  const local = await memoryManager.acquire('dev-job', 10);
  ok(local.acquired === true && local.backend === 'memory', 'sem Redis configurado usa lease local explícito');
  ok((await memoryManager.acquire('dev-job', 10)).reason === 'busy', 'fallback local também impede sobreposição');
  ok(await memoryManager.release({ ...local, token: 'invasor' }) === false, 'fallback local também valida proprietário');
  ok(await memoryManager.release(local) === true, 'fallback local libera com o token correto');

  console.log('\nredis-lease: ' + passed + ' asserts OK');
})().catch((err) => {
  console.error('FALHOU:', err.stack || err.message);
  process.exit(1);
});
