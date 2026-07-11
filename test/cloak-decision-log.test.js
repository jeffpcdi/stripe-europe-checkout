'use strict';
/*
 * Bateria do item 170 do plano — histórico de decisões do cloaker.
 *
 * A. Mascaramento de IP (sem PII): IPv4 perde o último octeto; IPv6 mantém só
 *    o prefixo; string vazia continua vazia. Regressão de privacidade.
 * B. Log limitado e ordenado: pushCloakDecision empilha o mais recente à frente
 *    e getCloakDecisionLog nunca devolve mais que o teto (CLOAK_LOG_MAX=50).
 * C. Escopo por conta + slug: contas/links diferentes não vazam um no outro.
 * D. resetCloakStats zera o log junto (mesma ação de "zerar contadores").
 * E. Só grava o necessário: campos esperados presentes, decisão normalizada
 *    para 'offer'|'white', reason/ua truncados.
 *
 * Sem rede e sem banco: redis real com enabled=false (usa o fallback de memória).
 */
process.env.KV_REST_API_URL = '';
process.env.KV_REST_API_TOKEN = '';
process.env.UPSTASH_REDIS_REST_URL = '';
process.env.UPSTASH_REDIS_REST_TOKEN = '';

const assert = require('assert');
const redis = require('../redis');

(async () => {
  assert.strictEqual(redis.enabled, false, 'teste deve rodar no fallback de memória');

  // ── A. Mascaramento de IP ───────────────────────────────────────────────
  // Não há export direto de maskIp; validamos via o que fica gravado no log.
  await redis.pushCloakDecision('accA', 'cloak:x', {
    decision: 'white', reason: 'mobile', score: 42, ip: '203.0.113.77', ua: 'Mozilla', country: 'br',
  });
  let logA = await redis.getCloakDecisionLog('accA', 'cloak:x');
  assert.strictEqual(logA.length, 1, 'A: uma decisão gravada');
  assert.strictEqual(logA[0].ip, '203.0.113.x', 'A: IPv4 mascarado no último octeto');
  assert.ok(!logA[0].ip.endsWith('.77'), 'A: octeto original não pode vazar');
  assert.strictEqual(logA[0].country, 'BR', 'A: país normalizado p/ ISO-2 maiúsculo');
  assert.strictEqual(logA[0].decision, 'white', 'A: decisão preservada');

  await redis.pushCloakDecision('accA', 'cloak:v6', {
    decision: 'offer', ip: '2001:db8:abcd:1234:5678::1', ua: 'x', country: '',
  });
  const logV6 = await redis.getCloakDecisionLog('accA', 'cloak:v6');
  assert.ok(logV6[0].ip.endsWith('::x'), 'A: IPv6 mascarado no sufixo');
  assert.ok(!logV6[0].ip.includes('5678'), 'A: sufixo IPv6 original não vaza');

  await redis.pushCloakDecision('accA', 'cloak:empty', { decision: 'offer', ip: '', ua: '' });
  const logE = await redis.getCloakDecisionLog('accA', 'cloak:empty');
  assert.strictEqual(logE[0].ip, '', 'A: IP vazio continua vazio');
  console.log('[OK] A — mascaramento de IP (IPv4/IPv6/vazio) sem PII.');

  // ── B. Log limitado e ordenado (mais recente à frente, teto 50) ──────────
  for (let i = 0; i < 60; i++) {
    await redis.pushCloakDecision('accB', 'cloak:cap', {
      decision: i % 2 ? 'offer' : 'white', reason: 'score', score: i, ip: '1.2.3.' + i, ua: 'ua' + i,
    });
  }
  const logB = await redis.getCloakDecisionLog('accB', 'cloak:cap');
  assert.strictEqual(logB.length, 50, 'B: log respeita o teto de 50');
  assert.strictEqual(logB[0].score, 59, 'B: o mais recente (score 59) fica à frente');
  assert.ok(logB[0].ip.endsWith('.x'), 'B: IP também mascarado no lote');
  console.log('[OK] B — log limitado a 50 e ordenado (mais recente primeiro).');

  // ── C. Escopo por conta + slug (sem vazamento cruzado) ───────────────────
  await redis.pushCloakDecision('accC1', 'cloak:s', { decision: 'offer', ip: '8.8.8.8' });
  await redis.pushCloakDecision('accC2', 'cloak:s', { decision: 'white', reason: 'pais', ip: '8.8.4.4' });
  const c1 = await redis.getCloakDecisionLog('accC1', 'cloak:s');
  const c2 = await redis.getCloakDecisionLog('accC2', 'cloak:s');
  assert.strictEqual(c1.length, 1, 'C: conta 1 vê só a própria decisão');
  assert.strictEqual(c1[0].decision, 'offer', 'C: decisão da conta 1');
  assert.strictEqual(c2[0].decision, 'white', 'C: decisão da conta 2 isolada');
  const cOther = await redis.getCloakDecisionLog('accC1', 'cloak:outro');
  assert.strictEqual(cOther.length, 0, 'C: slug diferente não herda decisões');
  console.log('[OK] C — escopo por conta + slug, sem vazamento cruzado.');

  // ── D. resetCloakStats zera o log junto ──────────────────────────────────
  await redis.pushCloakDecision('accD', 'cloak:r', { decision: 'white', reason: 'bot-ua', ip: '9.9.9.9' });
  assert.strictEqual((await redis.getCloakDecisionLog('accD', 'cloak:r')).length, 1, 'D: log populado antes do reset');
  await redis.resetCloakStats('accD', 'cloak:r');
  assert.strictEqual((await redis.getCloakDecisionLog('accD', 'cloak:r')).length, 0, 'D: reset limpou o log');
  console.log('[OK] D — resetCloakStats zera o log de decisões junto dos contadores.');

  // ── E. Normalização/truncamento dos campos ───────────────────────────────
  await redis.pushCloakDecision('accE', 'cloak:n', {
    decision: 'qualquer-coisa', // deve cair para 'white'
    reason: 'r'.repeat(80),
    ua: 'u'.repeat(300),
    ip: '5.6.7.8',
  });
  const e = (await redis.getCloakDecisionLog('accE', 'cloak:n'))[0];
  assert.strictEqual(e.decision, 'white', 'E: decisão inválida normaliza p/ white (fail-safe)');
  assert.ok(e.reason.length <= 40, 'E: reason truncado (<=40)');
  assert.ok(e.ua.length <= 120, 'E: ua truncado (<=120)');
  assert.ok(typeof e.at === 'number' && e.at > 0, 'E: timestamp presente');
  console.log('[OK] E — campos normalizados/truncados, decisão com fail-safe.');

  console.log('\ncloak-decision-log.test.js: todos os cenários passaram.');
  process.exit(0);
})().catch((err) => {
  console.error('[FAIL]', err);
  process.exit(1);
});
