// ── Autenticação multi-usuário (e-mail + senha + sessão via cookie) ──────
// Substitui o Basic Auth de senha única. Senhas com scrypt (nativo do Node),
// sessões duráveis no Neon (tabela account_sessions) com cache em memória
// para não bater no banco a cada request.
const crypto = require('crypto');
const db = require('./db');

const COOKIE_NAME = 'dash_session';
const SESSION_TTL_DAYS = 30;

// Cache de sessões em memória: token → { account, expiresAt } (5 min).
const sessionCache = new Map();
const SESSION_CACHE_MS = 5 * 60 * 1000;

// ── Senhas (scrypt) ───────────────────────────────────────────────────────
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return salt + ':' + hash;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  try {
    const candidate = crypto.scryptSync(String(password), salt, 64);
    const expected = Buffer.from(hash, 'hex');
    return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
  } catch (_) { return false; }
}

// ── Registro / login ──────────────────────────────────────────────────────
function validEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}

async function register({ email, password, name }) {
  if (!db.enabled) return { error: 'Banco de dados não configurado no servidor (defina DATABASE_URL nas variáveis de ambiente). Confira /api/status.' };
  if (!validEmail(email)) return { error: 'E-mail inválido.' };
  if (!password || String(password).length < 8) return { error: 'A senha precisa ter pelo menos 8 caracteres.' };

  const existing = await db.getAccountByEmail(email);
  if (existing) return { error: 'Este e-mail já está cadastrado.' };

  // O PRIMEIRO usuário vira admin e herda todos os dados legados.
  const isFirst = (await db.countAccounts()) === 0;
  const id = 'acc_' + crypto.randomBytes(12).toString('hex');
  const account = await db.createAccount({
    id,
    email: email.trim(),
    passwordHash: hashPassword(password),
    name: (name || '').trim() || null,
    role: isFirst ? 'admin' : 'user'
  });
  if (!account) return { error: 'Não foi possível criar a conta. Tente novamente.' };

  if (isFirst) {
    await db.claimLegacyData(id);
    console.log('[auth] Primeiro usuário (' + email + ') registrado como admin — dados legados migrados.');
  }

  const token = await db.createAuthSession(id, SESSION_TTL_DAYS);
  return { account, token };
}

// Item 440: bloqueio suave por e-mail após N falhas seguidas — freia
// tentativa de força bruta sem travar o dono de vez. Contagem em memória
// (reinicia com o processo, aceitável) e destrava sozinha após a janela ou
// no primeiro login correto. Chave é o e-mail normalizado.
const LOGIN_MAX_FAILS = 8;
const LOGIN_LOCK_MS = 15 * 60 * 1000; // 15 min
const loginFails = new Map(); // email → { count, until }

function loginLockKey(email) { return String(email || '').trim().toLowerCase(); }

function loginLockState(email) {
  const rec = loginFails.get(loginLockKey(email));
  if (!rec) return null;
  if (rec.until && rec.until <= Date.now()) { loginFails.delete(loginLockKey(email)); return null; }
  return rec;
}

function registerLoginFail(email) {
  const key = loginLockKey(email);
  const rec = loginFails.get(key) || { count: 0, until: 0 };
  rec.count += 1;
  if (rec.count >= LOGIN_MAX_FAILS) rec.until = Date.now() + LOGIN_LOCK_MS;
  loginFails.set(key, rec);
}

async function login({ email, password }) {
  if (!db.enabled) return { error: 'Banco de dados não configurado no servidor (defina DATABASE_URL nas variáveis de ambiente). Confira /api/status.' };

  // Bloqueio ativo? Não vaza se o e-mail existe — mensagem é sobre tentativas.
  const locked = loginLockState(email);
  if (locked && locked.until) {
    const mins = Math.max(1, Math.ceil((locked.until - Date.now()) / 60000));
    return { error: 'Muitas tentativas. Tente novamente em ' + mins + ' min.', locked: true };
  }

  const row = await db.getAccountByEmail(email || '');
  if (!row || !verifyPassword(password, row.password_hash)) {
    registerLoginFail(email);
    return { error: 'E-mail ou senha incorretos.' };
  }
  loginFails.delete(loginLockKey(email)); // sucesso zera o contador
  const token = await db.createAuthSession(row.id, SESSION_TTL_DAYS);
  const account = { id: row.id, email: row.email, name: row.name, role: row.role };
  return { account, token };
}

async function logout(token) {
  if (token) {
    sessionCache.delete(token);
    await db.deleteAuthSession(token);
  }
}

// ── Resolução de sessão (com cache) ───────────────────────────────────────
async function resolveSession(token) {
  if (!token) return null;
  const cached = sessionCache.get(token);
  if (cached && cached.expiresAt > Date.now()) return cached.account;

  const row = await db.getAuthSession(token);
  if (!row) { sessionCache.delete(token); return null; }
  const account = { id: row.account_id, email: row.email, name: row.name, role: row.role };
  sessionCache.set(token, { account, expiresAt: Date.now() + SESSION_CACHE_MS });
  return account;
}

// ── Helpers de cookie ─────────────────────────────────────────────────────
function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx > -1) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  });
  return out;
}

// COOKIE_DOMAIN (ex: ".dominio.com") compartilha a sessão com o subdomínio
// da dashboard Next.js (app.dominio.com). Sem a env, comportamento inalterado.
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN ? '; Domain=' + process.env.COOKIE_DOMAIN : '';

function sessionCookie(token, maxAgeDays) {
  const maxAge = (maxAgeDays || SESSION_TTL_DAYS) * 24 * 60 * 60;
  return COOKIE_NAME + '=' + encodeURIComponent(token) +
    '; Path=/; HttpOnly; SameSite=Lax; Secure' + COOKIE_DOMAIN + '; Max-Age=' + maxAge;
}

function clearCookie() {
  return COOKIE_NAME + '=; Path=/; HttpOnly; SameSite=Lax; Secure' + COOKIE_DOMAIN + '; Max-Age=0';
}

// Middleware: exige sessão válida. Popula req.account.
// Para páginas HTML redireciona a /login; para APIs responde 401 JSON.
function requireAuth(options) {
  const isApi = options && options.api;
  return async function (req, res, next) {
    try {
      const token = parseCookies(req)[COOKIE_NAME];
      const account = await resolveSession(token);
      if (account) { req.account = account; req.sessionToken = token; return next(); }
    } catch (err) {
      console.error('[auth] requireAuth:', err.message);
    }
    if (isApi) return res.status(401).json({ error: 'não autenticado' });
    return res.redirect('/login');
  };
}

// Middleware opcional: popula req.account se logado, mas nunca bloqueia.
function optionalAuth() {
  return async function (req, res, next) {
    try {
      const token = parseCookies(req)[COOKIE_NAME];
      const account = await resolveSession(token);
      if (account) { req.account = account; req.sessionToken = token; }
    } catch (_) { /* silencioso */ }
    next();
  };
}

// Limpeza periódica de sessões expiradas (1x/h).
setInterval(() => {
  db.pruneAuthSessions().catch(() => {});
  const now = Date.now();
  for (const [k, v] of sessionCache) { if (v.expiresAt <= now) sessionCache.delete(k); }
}, 60 * 60 * 1000).unref();

module.exports = {
  COOKIE_NAME,
  register, login, logout, resolveSession,
  parseCookies, sessionCookie, clearCookie,
  requireAuth, optionalAuth,
  hashPassword, verifyPassword,
  // Item 440/444: expostos para teste isolado do bloqueio suave.
  _loginLockState: loginLockState, _registerLoginFail: registerLoginFail,
  _LOGIN_MAX_FAILS: LOGIN_MAX_FAILS
};
