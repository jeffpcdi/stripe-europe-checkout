'use strict';

// Item 165/208: garante que o catálogo de perfis do simulador é coerente e que
// o motor de julgamento (bot-filter.judge) classifica cada perfil sintético do
// lado esperado — reals passam, bots caem na white page. Isso trava regressões
// no motor: se um ajuste de peso deixar de barrar o revisor da ByteDance ou
// passar a barrar o usuário real do anúncio, este teste quebra.

const assert = require('assert');
const bf = require('../bot-filter');
const profilesMod = require('../cloak-test-profiles');
const { BOT_TEST_PROFILES } = profilesMod;

let passed = 0;
function test(name, fn) {
  return fn()
    .then(() => { console.log('  ok  ' + name); passed++; })
    .catch((e) => { console.error('  XX  ' + name + '\n     ' + e.message); process.exitCode = 1; });
}

// Constrói o request sintético do mesmo jeito que a rota /api/cloak/test faz.
function buildReq(p) {
  const headers = Object.assign({}, p.headers);
  if (p.country) headers['x-vercel-ip-country'] = p.country;
  if (p.ip) headers['x-forwarded-for'] = p.ip;
  return {
    headers,
    query: Object.assign({}, p.query || {}),
    socket: { remoteAddress: p.ip || '' },
    geoCountry: p.country || '',
  };
}

async function main() {
  console.log('cloak-test-profiles.test.js');

  await test('catálogo não é vazio e tem ids únicos', async () => {
    assert.ok(Array.isArray(BOT_TEST_PROFILES) && BOT_TEST_PROFILES.length >= 4, 'esperado >=4 perfis');
    const ids = BOT_TEST_PROFILES.map((p) => p.id);
    assert.strictEqual(new Set(ids).size, ids.length, 'ids duplicados no catálogo');
  });

  await test('cada perfil tem label, expected válido e hint', async () => {
    for (const p of BOT_TEST_PROFILES) {
      assert.ok(p.label && typeof p.label === 'string', p.id + ' sem label');
      assert.ok(p.expected === 'real' || p.expected === 'bot', p.id + ' expected inválido');
      assert.ok(p.hint && typeof p.hint === 'string', p.id + ' sem hint');
      assert.ok(p.headers && typeof p.headers === 'object', p.id + ' sem headers');
    }
  });

  await test('listProfilesMeta não vaza headers/ip sintéticos', async () => {
    const meta = profilesMod.listProfilesMeta();
    assert.strictEqual(meta.length, BOT_TEST_PROFILES.length);
    for (const m of meta) {
      assert.deepStrictEqual(Object.keys(m).sort(), ['expected', 'hint', 'id', 'label']);
    }
  });

  await test('getProfile devolve perfil por id e null para desconhecido', async () => {
    const first = BOT_TEST_PROFILES[0];
    assert.strictEqual(profilesMod.getProfile(first.id).id, first.id);
    assert.strictEqual(profilesMod.getProfile('nao-existe'), null);
    assert.strictEqual(profilesMod.getProfile(''), null);
  });

  await test('o motor classifica cada perfil do lado esperado', async () => {
    for (const p of BOT_TEST_PROFILES) {
      const j = await bf.judge(buildReq(p), 'sim-test', null, p.challengeData || {}, {});
      const gotBot = j.verdict === 'bot';
      const wantBot = p.expected === 'bot';
      assert.strictEqual(
        gotBot,
        wantBot,
        `${p.id}: esperado ${p.expected}, veio verdict=${j.verdict} score=${j.score}/${j.threshold} sinais=[${(j.signals || []).join(',')}]`,
      );
    }
  });

  if (passed >= 5 && !process.exitCode) console.log('\n5 cenários OK');
}

main();
