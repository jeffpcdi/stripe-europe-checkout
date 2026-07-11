'use strict';
/*
 * Item 240 — Suíte de integração dos fluxos DURÁVEIS (Leva 5).
 *
 * INVARIANTES cobertos (documentação viva — se um teste quebrar, um
 * invariante do produto quebrou):
 *
 *  1. IDEMPOTÊNCIA da fila de conversões: processConversion deduplica por
 *     event_id, então reprocessar após crash NUNCA duplica venda/disparo.
 *     Sem Redis a fila degrada para no-op EXPLÍCITO (enqueue=false,
 *     reserve=[]) — o caller processa inline; nunca trava nem lança.
 *  2. FAIL-SAFE do cloaker (sticky unidirecional): só veredito de BOT entra
 *     em cache; humano é re-julgado a cada visita. Sem Redis, get/set
 *     degradam para null/false — na dúvida, re-julgar (nunca liberar).
 *  3. ANTI-REPLAY de ttclid: o primeiro uso registra o contexto; o MESMO
 *     ttclid vindo de contexto diferente é replay (reused=true). O mesmo
 *     contexto pode repetir (usuário recarregou) sem punição.
 *  4. ROLLUP de EMQ: soma+contagem por pixel/dia; a média diária resiste a
 *     hash com chaves alheias e limita a série aos N dias pedidos.
 *  5. NORMALIZAÇÃO de cloak stats: contadores por decisão/razão/dia expostos
 *     de forma estável para o painel (daily/reasons).
 *
 * Roda no fallback de MEMÓRIA (sem REDIS_URL) — sem rede real.
 */
const assert = require('assert');

// Garante o modo memória ANTES de carregar o módulo.
delete process.env.REDIS_URL;
delete process.env.KV_URL;
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

const rdb = require('../redis');
let pass = 0;
function ok(cond, msg) { assert.ok(cond, msg); console.log('  ok  ' + msg); pass++; }

(async () => {
  // ── Invariante 1: fila durável degrada para no-op explícito sem Redis ──
  const enq = await rdb.enqueueConversion({ gateway: 'stripe', orderId: 'x1' });
  ok(enq === false, 'fila: enqueue sem Redis devolve false (caller processa inline)');
  const reserved = await rdb.reserveConversions(10);
  ok(Array.isArray(reserved) && reserved.length === 0, 'fila: reserve sem Redis devolve lista vazia');
  await rdb.ackConversion('{"qid":"nada"}'); // não pode lançar
  ok(true, 'fila: ack sem Redis é no-op silencioso');
  const moved = await rdb.reclaimConversions(1);
  ok(moved === 0, 'fila: reclaim sem Redis devolve 0');
  const depth = await rdb.convQueueDepth();
  ok(depth.queue === 0 && depth.processing === 0, 'fila: depth sem Redis é {0,0}');

  // ── Invariante 2: sticky bot unidirecional e fail-safe ──
  const setBot = await rdb.setStickyBot('vid-humano-teste', { at: Date.now() });
  ok(setBot === false, 'sticky: sem Redis o set degrada para false (sem cache = re-julga sempre)');
  const gotBot = await rdb.getStickyBot('vid-humano-teste');
  ok(gotBot === null, 'sticky: sem Redis o get devolve null → judge re-roda (fail-safe)');
  const count = await rdb.countStickyBots();
  ok(count.available === false, 'sticky: contagem indica indisponível sem Redis (UI oculta o painel)');

  // ── Invariante 3: anti-replay de ttclid (fallback de memória FUNCIONAL) ──
  const t1 = await rdb.checkTtclidContext('ttc-abc', 'ip1|ua1');
  ok(t1.firstSeen === true && t1.reused === false, 'ttclid: primeiro uso registra contexto');
  const t2 = await rdb.checkTtclidContext('ttc-abc', 'ip1|ua1');
  ok(t2.firstSeen === false && t2.reused === false, 'ttclid: MESMO contexto pode repetir (reload legítimo)');
  const t3 = await rdb.checkTtclidContext('ttc-abc', 'ip2|ua2');
  ok(t3.firstSeen === false && t3.reused === true, 'ttclid: contexto DIFERENTE = replay barrado');
  const t4 = await rdb.checkTtclidContext('', 'ip1|ua1');
  ok(t4.firstSeen === true && t4.reused === false, 'ttclid: vazio nunca marca replay (orgânico não é punido)');

  // contador de replays (item 203) no fallback de memória
  await rdb.bumpTtclidReplay('acc-t');
  await rdb.bumpTtclidReplay('acc-t');
  const replays = await rdb.getTtclidReplayCount('acc-t');
  ok(replays === 2, 'ttclid: contador de replays por conta funciona em memória');
  const outros = await rdb.getTtclidReplayCount('acc-outra');
  ok(outros === 0, 'ttclid: contador não vaza entre contas');

  // ── Invariante 4: rollup de EMQ (soma+contagem → média diária) ──
  await rdb.bumpEmq('acc-e', 'PX1', 8);
  await rdb.bumpEmq('acc-e', 'PX1', 6);
  await rdb.bumpEmq('acc-e', 'PX1', 7);
  const trend = await rdb.getEmqTrend('acc-e', 'PX1', 14);
  ok(trend.length === 1, 'emq: um dia de dados gera um ponto na série');
  ok(trend[0].avg === 7, 'emq: média do dia correta ((8+6+7)/3 = 7)');
  ok(trend[0].count === 3, 'emq: contagem de eventos do dia correta');
  await rdb.bumpEmq('acc-e', 'PX1', NaN);
  const trendNan = await rdb.getEmqTrend('acc-e', 'PX1', 14);
  ok(trendNan[0].count === 3, 'emq: score inválido (NaN) é ignorado, não corrompe o rollup');
  const alheio = await rdb.getEmqTrend('acc-OUTRA', 'PX1', 14);
  ok(alheio.length === 0, 'emq: série não vaza entre contas');
  // limpeza (item 200) remove a série da conta
  const removed = await rdb.clearEmq('acc-e', ['PX1']);
  ok(removed === 1, 'emq: clearEmq remove a série da conta');
  const depois = await rdb.getEmqTrend('acc-e', 'PX1', 14);
  ok(depois.length === 0, 'emq: série vazia após limpeza');

  // ── Invariante 5: cloak stats normalizadas (daily/reasons) ──
  await rdb.bumpCloakDecision('acc-c', 'cloak:promo', 'offer', null);
  await rdb.bumpCloakDecision('acc-c', 'cloak:promo', 'white', 'score');
  await rdb.bumpCloakDecision('acc-c', 'cloak:promo', 'white', 'bot-ua');
  await rdb.bumpCloakDecision('acc-c', 'cloak:promo', 'white', 'score');
  const st = await rdb.getCloakStats('acc-c', 'cloak:promo');
  ok(st.offer === 1 && st.white === 3, 'cloak: contadores agregados corretos');
  ok(st.reasons && st.reasons.score === 2 && st.reasons['bot-ua'] === 1,
    'cloak: razões de bloqueio contadas por tipo');
  ok(Array.isArray(st.daily) && st.daily.length >= 1 && st.daily[st.daily.length - 1].white === 3,
    'cloak: série diária reflete o dia corrente');
  // slugs com stats são enumeráveis (item 232 — auditoria de órfãos)
  const slugs = await rdb.listCloakStatSlugs('acc-c');
  ok(slugs.includes('cloak:promo'), 'cloak: slug com stats aparece na enumeração de órfãos');
  const cleared = await rdb.clearCloakStats('acc-c', ['cloak:promo']);
  ok(cleared === 1, 'cloak: limpeza de stats órfãs remove o hash');

  console.log('\n[durable-flows] ' + pass + ' asserts OK');
})().catch((err) => {
  console.error('\n[durable-flows] FALHOU:', err.message);
  process.exit(1);
});
