// Item 445: guarda automática de autorização das rotas /api.
// Varre as declarações de rota do server.js e garante que TODA rota /api ou
// exige sessão (dashboardAuth/adminAuth) ou está numa allowlist explícita de
// rotas públicas / que se autenticam sozinhas (webhooks, tracking, token).
// Assim, uma rota nova nasce "reprovada" até ser conscientemente classificada.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

let pass = 0;
function ok(cond, msg) {
  if (!cond) { console.error('  ✗ ' + msg); throw new assert.AssertionError({ message: msg }); }
  pass++;
}

const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const productionStart = fs.readFileSync(path.join(__dirname, '..', 'start.js'), 'utf8');
const railway = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'railway.json'), 'utf8'));

// Rotas /api públicas ou com autenticação própria (token/HMAC/tracking).
// Cada entrada exige uma justificativa consciente — não é para crescer à toa.
const PUBLIC_API = new Set([
  '/api/cloakcheck',     // julgamento do cloaker (chamado pela página pública)
  '/api/track',          // tracking de funil (visitante, sem sessão)
  '/api/px/event',       // pixel client-side (visitante)
  '/api/pulse',          // heartbeat de presença (visitante)
  '/api/pulse/leave',    // saída de presença (visitante)
  '/api/conversion',     // webhook de gateway (autentica por HMAC/token no corpo)
  '/api/v1/summary',     // API pública read-only (autentica por ?token= via safeEqual)
  '/api/status',         // health público (sem dados sensíveis)
  '/api/client-error',   // item 561: write-only, rate-limited, sem eco de dados (GET é dashboardAuth)
]);

const re = /app\.(get|post|put|delete)\(\s*'(\/api\/[^']*)'\s*(?:,\s*([a-zA-Z_$][\w$]*))?/g;
let m;
let total = 0, guarded = 0, publicCount = 0;
const offenders = [];
while ((m = re.exec(src)) !== null) {
  const [, method, route, firstArg] = m;
  total++;
  const usesAuth = firstArg === 'dashboardAuth' || firstArg === 'adminAuth';
  if (usesAuth) { guarded++; continue; }
  if (PUBLIC_API.has(route)) { publicCount++; continue; }
  offenders.push(method.toUpperCase() + ' ' + route + (firstArg ? ' (mw: ' + firstArg + ')' : ' (sem middleware)'));
}

console.log('[route-auth] ' + total + ' rotas /api — ' + guarded + ' com sessão, ' + publicCount + ' públicas allowlisted');

ok(total > 40, 'varredura encontrou as rotas /api do server (sanity)');
ok(
  offenders.length === 0,
  'toda rota /api é protegida ou allowlistada. Não classificadas:\n    ' + offenders.join('\n    '),
);
ok(/const DEV_LOGIN_ENABLED = process\.env\.NODE_ENV !== 'production'/.test(src), 'login rápido continua condicionado ao ambiente');
ok(
  productionStart.indexOf("process.env.NODE_ENV = 'production'") < productionStart.indexOf("require('./server.js')"),
  'start de produção força NODE_ENV antes de carregar o Express',
);
ok(productionStart.includes("NODE_ENV: 'production'"), 'Next de produção também recebe NODE_ENV explícito');
ok(/^NODE_ENV=production\s+node start\.js$/.test(railway.deploy.startCommand), 'Railway reforça NODE_ENV no comando de entrada');
// Garante que a allowlist não tem entradas mortas (rota removida do server).
for (const p of PUBLIC_API) {
  ok(src.includes("'" + p + "'"), 'allowlist pública sem rota morta: ' + p);
}

console.log('\n[route-auth] ' + pass + ' asserts OK');
