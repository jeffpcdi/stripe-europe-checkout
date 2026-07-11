// Item 444: testes de autenticação — hashing de senha, cookie seguro e o
// bloqueio suave por tentativas (item 440). Rodam sem Neon: exercitam as
// funções puras do auth.js diretamente.
const assert = require('assert');
const auth = require('../auth');

let pass = 0;
function ok(cond, msg) {
  if (!cond) { console.error('  ✗ ' + msg); throw new assert.AssertionError({ message: msg }); }
  pass++;
}

// ── Hash de senha (item 436: scrypt com salt por senha) ────────────────────
const h1 = auth.hashPassword('correct horse battery');
const h2 = auth.hashPassword('correct horse battery');
ok(h1.includes(':') && h1.length > 80, 'hash tem salt:hash e comprimento de scrypt');
ok(h1 !== h2, 'mesma senha gera hashes diferentes (salt aleatório por senha)');
ok(auth.verifyPassword('correct horse battery', h1), 'verifyPassword aceita a senha correta');
ok(!auth.verifyPassword('senha errada', h1), 'verifyPassword rejeita senha errada');
ok(!auth.verifyPassword('x', 'formato-invalido-sem-doispontos'), 'verifyPassword rejeita hash malformado sem crashar');
ok(!auth.verifyPassword('', ''), 'verifyPassword rejeita entradas vazias');

// ── Cookie de sessão (item 434: HttpOnly, Secure, SameSite=Lax) ────────────
const cookie = auth.sessionCookie('tok_abc123', 30);
ok(/HttpOnly/.test(cookie), 'cookie é HttpOnly (não acessível por JS)');
ok(/Secure/.test(cookie), 'cookie é Secure (só HTTPS)');
ok(/SameSite=Lax/.test(cookie), 'cookie é SameSite=Lax (barra CSRF cross-site)');
ok(/Path=\//.test(cookie), 'cookie tem Path=/');
const cleared = auth.clearCookie();
ok(/Max-Age=0/.test(cleared), 'clearCookie expira o cookie (Max-Age=0)');

// ── Bloqueio suave por tentativas (item 440) ───────────────────────────────
const isLocked = (e) => { const s = auth._loginLockState(e); return !!(s && s.until > Date.now()); };
const email = 'bruteforce-' + Date.now() + '@example.com';
ok(!isLocked(email), 'e-mail começa sem bloqueio');
for (let i = 0; i < auth._LOGIN_MAX_FAILS - 1; i++) auth._registerLoginFail(email);
ok(!isLocked(email), 'antes do limite ainda não bloqueia');
auth._registerLoginFail(email); // atinge o limite
ok(isLocked(email), 'ao atingir o limite, bloqueia com prazo futuro');
// e-mail é normalizado (case-insensitive): a MAIÚSCULA cai no mesmo bloqueio
ok(isLocked(email.toUpperCase()), 'bloqueio é case-insensitive no e-mail');

console.log('\n[auth] ' + pass + ' asserts OK');
