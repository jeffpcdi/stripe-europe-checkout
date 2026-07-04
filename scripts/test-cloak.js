// Bateria de testes do Filtro de Bots (cloaking) — sem dependências externas.
// Roda: node scripts/test-cloak.js
'use strict';
const assert = require('assert');
const bot = require('../bot-filter');
const cfg = require('../config');

let pass = 0, fail = 0;
const pending = [];
function t(name, fn) {
  pending.push(Promise.resolve().then(fn).then(
    () => { pass++; console.log('  ok   ' + name); },
    (e) => { fail++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
  ));
}

function reqWith(headers, ip) {
  return { headers: Object.assign({ 'x-forwarded-for': ip || '' }, headers), socket: { remoteAddress: ip || '' } };
}

// ── 1. Sanitização de schema (replica a intenção de link-store.normalize) ──
const cleanPaises = (arr) => (Array.isArray(arr) ? arr : [])
  .map((c) => String(c || '').trim().toUpperCase())
  .filter((c) => /^[A-Z]{2}$/.test(c))
  .filter((c, i, a) => a.indexOf(c) === i).slice(0, 30);
const cleanPixelSlug = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40);

t('paises: normaliza caixa e descarta inválidos/duplicados', () => {
  assert.deepStrictEqual(cleanPaises(['br', 'PT', 'usa', '', 'BR', 'x1']), ['BR', 'PT']);
});
t('paises: limita a 30 entradas', () => {
  const many = Array.from({ length: 50 }, () => 'BR' + Math.random());
  assert.ok(cleanPaises(many).length <= 30);
});
t('pixelSlug: remove espaços e símbolos', () => {
  assert.strictEqual(cleanPixelSlug('Meu Pixel!! #1'), 'meupixel1');
});

// ── 2. config.cloak.deadlineMs ─────────────────────────────────────────────
t('config: deadlineMs default no range 40–500', () => {
  const c = cfg.get().cloak;
  assert.ok(typeof c.deadlineMs === 'number' && c.deadlineMs >= 40 && c.deadlineMs <= 500);
});

// ── 3. Token de challenge robusto (NUNCA lança) ────────────────────────────
t('verifyChallengeToken: token vazio → {ok:false}', () => {
  const r = bot.verifyChallengeToken('vid1', '');
  assert.strictEqual(r.ok, false);
});
t('verifyChallengeToken: lixo aleatório → {ok:false} sem lançar', () => {
  const r = bot.verifyChallengeToken('vid1', 'zzz.!!!###');
  assert.strictEqual(r.ok, false);
});
t('verifyChallengeToken: assinatura de tamanho errado → {ok:false}', () => {
  const r = bot.verifyChallengeToken('vid1', 'abc.d');
  assert.strictEqual(r.ok, false);
});
t('verifyChallengeToken: sem visitorId → {ok:false}', () => {
  const r = bot.verifyChallengeToken('', 'abc.def');
  assert.strictEqual(r.ok, false);
});
t('issue/verify: round-trip válido → {ok:true}', () => {
  const tok = bot.issueChallengeToken('vid-xyz');
  assert.ok(tok && tok.indexOf('.') > 0);
  assert.strictEqual(bot.verifyChallengeToken('vid-xyz', tok).ok, true);
});
t('issue/verify: token de outro visitorId → {ok:false}', () => {
  const tok = bot.issueChallengeToken('vid-A');
  assert.strictEqual(bot.verifyChallengeToken('vid-B', tok).ok, false);
});

// ── 4. resolveConfig aplica deadline dentro dos limites ────────────────────
t('resolveConfig: clampa deadlineMs para o range', () => {
  assert.strictEqual(bot.resolveConfig({ deadlineMs: 5 }).deadlineMs, 40);
  assert.strictEqual(bot.resolveConfig({ deadlineMs: 9999 }).deadlineMs, 500);
  assert.strictEqual(bot.resolveConfig({ deadlineMs: 200 }).deadlineMs, 200);
});

// ── 5. judge respeita o deadline mesmo forçando lookup de ASN ──────────────
t('judge: navegador real → verdict real e rápido', async () => {
  const req = reqWith({
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    'accept': 'text/html,application/xhtml+xml', 'accept-language': 'pt-BR,pt;q=0.9',
    'sec-fetch-site': 'none', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document'
  }, '8.8.8.8');
  const t0 = Date.now();
  const r = await bot.judge(req, 'vid-real', null, {}, { enabled: true, sensitivity: 'balanced', deadlineMs: 60 });
  const dt = Date.now() - t0;
  assert.ok(r && typeof r.score === 'number', 'retorna score');
  assert.ok(dt < 60 + 500, 'não estoura muito além do deadline (dt=' + dt + 'ms)');
});
t('judge: headless/datacenter → score alto', async () => {
  const req = reqWith({
    'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120 Safari/537.36'
  }, '1.2.3.4');
  const r = await bot.judge(req, 'vid-bot', null, {}, { enabled: true, sensitivity: 'balanced', deadlineMs: 60 });
  assert.ok(r.score > 0, 'headless soma score (score=' + r.score + ')');
});

Promise.all(pending).then(() => {
  console.log('\n' + pass + ' passaram, ' + fail + ' falharam');
  process.exit(fail ? 1 : 0);
});
