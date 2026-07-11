'use strict';
/*
 * Teste do bloco de observabilidade das filas duráveis (Leva 5, bloco I).
 *
 * Cobre os helpers puros que o endpoint GET /api/ops expõe, exercitados no
 * fallback de MEMÓRIA do redis.js (sem REDIS_URL → enabled=false). Nenhuma
 * rede real. Também valida o resumo da fila de retry da CAPI (retryQueueInfo).
 */
const assert = require('assert');

// Garante o modo em memória (sem Redis) para os contadores de fallback.
delete process.env.REDIS_URL;
delete process.env.KV_URL;
delete process.env.UPSTASH_REDIS_REST_URL;

const rdb = require('../redis');
let pass = 0;
function ok(cond, msg) { assert.ok(cond, msg); console.log('  ok  ' + msg); pass++; }

(async () => {
  // ── Item 199: latência webhook→disparo (percentis sobre janela) ──
  // Semeia 1..100ms; p50 ~50, p95 ~95, max 100.
  for (let i = 1; i <= 100; i++) rdb.recordConvLatency(i);
  const lat = rdb.getConvLatency();
  ok(lat.count === 100, 'latência: contou 100 amostras');
  ok(lat.p50 >= 45 && lat.p50 <= 55, `latência: p50 plausível (${lat.p50})`);
  ok(lat.p95 >= 90 && lat.p95 <= 100, `latência: p95 plausível (${lat.p95})`);
  ok(lat.max === 100, 'latência: máximo correto');
  // Valores inválidos são ignorados (não quebram os percentis).
  rdb.recordConvLatency(-5);
  rdb.recordConvLatency(NaN);
  ok(rdb.getConvLatency().count === 100, 'latência: ignora amostras inválidas');

  // ── Item 197: heartbeat do worker ──
  const beat0 = rdb.getConvWorkerBeat();
  ok(beat0.active === false && beat0.at === 0, 'worker: começa ocioso');
  rdb.heartbeatConvWorker();
  const beat1 = rdb.getConvWorkerBeat();
  ok(beat1.active === true && beat1.at > 0, 'worker: ativo logo após o tick');

  // ── Item 192: memória do último reclaim ──
  const rec = rdb.getReclaimInfo();
  ok(typeof rec.at === 'number' && typeof rec.moved === 'number', 'reclaim: shape estável');

  // ── Item 195: contador de reentregas ignoradas, escopado por conta ──
  const A = 'acc-A', B = 'acc-B';
  const baseA = await rdb.getWebhookDedupCount(A);
  await rdb.bumpWebhookDedup(A);
  await rdb.bumpWebhookDedup(A);
  await rdb.bumpWebhookDedup(B);
  const afterA = await rdb.getWebhookDedupCount(A);
  const afterB = await rdb.getWebhookDedupCount(B);
  ok(afterA === baseA + 2, `dedup: conta A somou 2 (${baseA}→${afterA})`);
  ok(afterB === 1, 'dedup: conta B isolada (sem vazamento entre contas)');

  // ── Item 191: profundidade da fila sem Redis é best-effort (zeros) ──
  const depth = await rdb.convQueueDepth();
  ok(depth.queue === 0 && depth.processing === 0, 'fila: profundidade 0 sem Redis');

  // ── Item 193: resumo da fila de retry da CAPI (retryQueueInfo) ──
  const tt = require('../tiktok-events');
  const info = tt.retryQueueInfo('acc-x');
  ok(info.count === 0 && info.oldestAgeMs === 0, 'retry: fila vazia por conta');

  console.log(`\nqueue-observability: ${pass} asserts OK`);
})().catch((e) => { console.error('FALHOU:', e.message); process.exit(1); });
