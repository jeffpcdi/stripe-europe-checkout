'use strict';
/*
 * Teste da fila durável de bulk de anúncios TikTok (ads-bulk.js).
 *
 * Espelha o comportamento validado em retry-queue.test.js /
 * queue-observability.test.js: enqueue → reserve → ack → reclaim, progresso
 * do job (done/failed/status) e reprocessamento de itens falhados.
 *
 * Roda SEM Redis (o módulo redis.js degrada para memória quando as variáveis
 * não existem) — exatamente o fallback que o ads-bulk.js precisa cobrir.
 */
const assert = require('assert');

// garante o modo memória do redis.js (sem tocar rede)
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const bulk = require('../ads-bulk');
assert.strictEqual(bulk._internals.namespace, 'development', 'fila local tem namespace próprio');
assert.strictEqual(bulk._internals.queue, 'adsBulkQ:development', 'dev não disputa jobs com produção');

const ACC = 'acc-teste';

async function main() {
  // ── 1. Job nasce consistente ───────────────────────────────────────────────
  const job = await bulk.createBulkJob(ACC, {
    kind: 'bulk_create',
    adAccountId: 'adv-1',
    items: [{ ref: 'Anúncio A' }, { ref: 'Anúncio B' }, { ref: 'Anúncio C' }]
  });
  assert.ok(job.id, 'job tem id');
  assert.strictEqual(job.total, 3);
  assert.strictEqual(job.status, 'queued');
  assert.strictEqual(job.done, 0);
  assert.strictEqual(job.failed, 0);

  // ── 2. Enfileira 3 itens e reserva na ordem FIFO ───────────────────────────
  for (let i = 0; i < 3; i++) {
    await bulk.enqueueBulkItem({ accountId: ACC, jobId: job.id, idx: i, task: { kind: 'create', payload: { name: 'A' + i } } });
  }
  let depth = await bulk.bulkQueueDepth();
  assert.strictEqual(depth.queue, 3, 'fila com 3 itens');
  assert.strictEqual(depth.processing, 0);

  const first = await bulk.reserveBulkItems(1);
  assert.strictEqual(first.length, 1);
  assert.strictEqual(first[0].env.idx, 0, 'FIFO: o primeiro enfileirado sai primeiro');
  depth = await bulk.bulkQueueDepth();
  assert.strictEqual(depth.queue, 2);
  assert.strictEqual(depth.processing, 1, 'item reservado em :proc');

  // ── 3. Ack remove da lista de processamento ────────────────────────────────
  await bulk.updateBulkItem(ACC, job.id, 0, { status: 'done', resultId: 'camp-1' });
  await bulk.ackBulkItem(first[0].raw);
  depth = await bulk.bulkQueueDepth();
  assert.strictEqual(depth.processing, 0, 'ack limpa o :proc');

  let j = await bulk.getBulkJob(ACC, job.id);
  assert.strictEqual(j.done, 1);
  assert.strictEqual(j.status, 'running', 'job em andamento');

  // ── 4. Reclaim: item reservado e abandonado volta para a fila ──────────────
  const second = await bulk.reserveBulkItems(1);
  assert.strictEqual(second[0].env.idx, 1);
  // idade 0 → reclaim com corte 0ms resgata imediatamente (worker "morto")
  const moved = await bulk.reclaimBulkItems(0);
  assert.strictEqual(moved, 1, 'reclaim devolveu o órfão para a fila');
  depth = await bulk.bulkQueueDepth();
  assert.strictEqual(depth.queue, 2, 'órfão de volta na fila');
  assert.strictEqual(depth.processing, 0);

  // ── 5. Item falhado NÃO volta sozinho; retry explícito reenfileira ─────────
  const third = await bulk.reserveBulkItems(2); // consome os 2 restantes
  assert.strictEqual(third.length, 2);
  await bulk.updateBulkItem(ACC, job.id, 1, { status: 'failed', error: 'Zernio: orçamento inválido' });
  await bulk.ackBulkItem(third[0].raw);
  await bulk.updateBulkItem(ACC, job.id, 2, { status: 'done', resultId: 'camp-3' });
  await bulk.ackBulkItem(third[1].raw);

  j = await bulk.getBulkJob(ACC, job.id);
  assert.strictEqual(j.done, 2);
  assert.strictEqual(j.failed, 1);
  assert.strictEqual(j.status, 'done', 'job termina mesmo com falha (done+failed = total)');
  assert.strictEqual(j.items[1].error, 'Zernio: orçamento inválido', 'erro da Zernio preservado por item');

  depth = await bulk.bulkQueueDepth();
  assert.strictEqual(depth.queue, 0, 'failed não é reenfileirado automaticamente');

  // reprocesso explícito (como o POST /api/ads/bulk/:jobId/retry faz)
  await bulk.updateBulkItem(ACC, job.id, 1, { status: 'queued', error: null });
  await bulk.enqueueBulkItem({ accountId: ACC, jobId: job.id, idx: 1, task: { kind: 'create', payload: { name: 'A1' } } });
  depth = await bulk.bulkQueueDepth();
  assert.strictEqual(depth.queue, 1, 'retry reenfileirou o item falhado');
  j = await bulk.getBulkJob(ACC, job.id);
  assert.strictEqual(j.status, 'running', 'job volta a rodar com o retry');

  // ── 6. Worker processa a fila (1 por vez) via startBulkWorker ──────────────
  bulk.stopBulkWorker();
  const processed = [];
  const tick = bulk.startBulkWorker(async (env) => {
    processed.push(env.idx);
    return { resultId: 'camp-retry' };
  }, { intervalMs: 999999 }); // tick manual — o intervalo não dispara no teste
  await tick();
  bulk.stopBulkWorker();
  assert.deepStrictEqual(processed, [1], 'worker consumiu o item do retry');
  j = await bulk.getBulkJob(ACC, job.id);
  assert.strictEqual(j.items[1].status, 'done');
  assert.strictEqual(j.items[1].resultId, 'camp-retry');
  assert.strictEqual(j.status, 'done');
  depth = await bulk.bulkQueueDepth();
  assert.strictEqual(depth.queue + depth.processing, 0, 'fila vazia após o worker');

  // ── 7. Rate limit pausa a fila e reagenda o item sem marcá-lo como falha ──
  const job2 = await bulk.createBulkJob(ACC, { kind: 'duplicate', adAccountId: 'adv-2', items: [{ ref: 'Cópia 1' }] });
  await bulk.enqueueBulkItem({ accountId: ACC, jobId: job2.id, idx: 0, task: { kind: 'duplicate_same', sourceId: 'x' } });
  const tick2 = bulk.startBulkWorker(async () => { throw new Error('Zernio HTTP 429'); }, { intervalMs: 999999, backoffMs: 1 });
  await tick2();
  bulk.stopBulkWorker();
  const j2 = await bulk.getBulkJob(ACC, job2.id);
  assert.strictEqual(j2.items[0].status, 'queued');
  assert.match(j2.items[0].error, /retoma automaticamente em 5 minutos/i);
  assert.strictEqual(j2.items[0].attempts, 1);
  assert.ok(j2.items[0].retryAt, 'item registra quando poderá ser retomado');
  assert.strictEqual(j2.status, 'queued');
  const queueStatus = await bulk.bulkQueueStatus();
  assert.strictEqual(queueStatus.paused, true, 'fila inteira entra em pausa');
  assert.match(queueStatus.reason, /429/);
  assert.ok(new Date(queueStatus.pausedUntil).getTime() > Date.now() + 4 * 60_000, 'pausa dura aproximadamente 5 minutos');

  // Limpa o item reagendado sem esperar o relógio real do teste.
  const queuedAgain = await bulk.reserveBulkItems(1);
  assert.strictEqual(queuedAgain.length, 1);
  await bulk.ackBulkItem(queuedAgain[0].raw);

  console.log('ads-bulk-queue.test.js OK — fila durável validada, inclusive pausa automática de 5 minutos em rate limit');
}

main().catch((err) => {
  console.error('FALHOU:', err);
  process.exit(1);
});
