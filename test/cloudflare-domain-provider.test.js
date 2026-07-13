'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const ENV_KEYS = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ZONE_ID', 'CLOUDFLARE_FALLBACK_ORIGIN', 'CLOUDFLARE_CNAME_TARGET'];
const originalEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const originalFetch = global.fetch;

function setup(env) {
  process.env.CLOUDFLARE_API_TOKEN = 'test-token';
  process.env.CLOUDFLARE_ZONE_ID = 'zone-123';
  process.env.CLOUDFLARE_FALLBACK_ORIGIN = 'app-production.up.railway.app';
  process.env.CLOUDFLARE_CNAME_TARGET = 'domains.roi-nados.top';
  for (const [k, v] of Object.entries(env || {})) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  delete require.cache[require.resolve('../cloudflare-domain-provider')];
  return require('../cloudflare-domain-provider');
}

function response(result, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => result };
}

// fetch mockado que responde por prefixo de URL (Cloudflare API vs origem HTTP)
function routedFetch(routes) {
  return async (url, options) => {
    for (const [prefix, handler] of routes) {
      if (String(url).startsWith(prefix)) return handler(url, options);
    }
    throw new Error('unmocked fetch: ' + url);
  };
}

test.beforeEach(() => {
  // Silencia os logs de boot do provider nos testes
  global.fetch = async () => response({ success: true, result: {} });
});

test.afterEach(() => {
  global.fetch = originalFetch;
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

// ── register / status / normalização ─────────────────────────────────────────

test('register cria custom hostname e instrui CNAME para o Managed target (não a origem)', async () => {
  let request;
  global.fetch = async (url, options) => {
    if (String(url).includes('/custom_hostnames') && options && options.method === 'POST') {
      request = { url, options };
      return response({ success: true, result: {
        id: 'cf-host-1', hostname: 'link.exemplo.com', status: 'pending',
        ownership_verification: { type: 'txt', name: '_cf-custom-hostname.link.exemplo.com', value: 'owner-token' },
        ssl: { status: 'pending_validation', validation_records: [{ txt_name: '_acme-challenge.link.exemplo.com', txt_value: 'ssl-token' }] },
      } });
    }
    return response({ success: true, result: {} });
  };
  const provider = setup();
  const result = await provider.register('https://LINK.exemplo.com/');
  assert.equal(request.url, 'https://api.cloudflare.com/client/v4/zones/zone-123/custom_hostnames');
  assert.equal(JSON.parse(request.options.body).hostname, 'link.exemplo.com');
  assert.equal(result.provider, 'cloudflare');
  assert.equal(result.providerId, 'cf-host-1');
  // CORREÇÃO CENTRAL: o CNAME do lojista aponta para o Managed target,
  // nunca para a origem Railway (que serve o certificado errado).
  assert.equal(result.dns.cname.target, 'domains.roi-nados.top');
  assert.equal(result.dns.ownership.value, 'owner-token');
  assert.equal(result.dns.certificate.value, 'ssl-token');
  assert.equal(result.verified, false);
  assert.equal(result.status, 'pending_dns');
});

test('sem CLOUDFLARE_CNAME_TARGET degrada para a origem nas instruções', async () => {
  global.fetch = async () => response({ success: true, result: {
    id: 'cf-host-9', hostname: 'x.exemplo.com', status: 'pending', ssl: { status: 'pending_validation' },
  } });
  const provider = setup({ CLOUDFLARE_CNAME_TARGET: undefined });
  const result = await provider.register('x.exemplo.com');
  assert.equal(result.dns.cname.target, 'app-production.up.railway.app');
  assert.equal(provider.preflightState.degraded === true || provider.cnameTarget() === 'app-production.up.railway.app', true);
});

test('status mapeia estados: pending_dns / pending_ssl / active / error', async () => {
  const cases = [
    [{ status: 'pending', ssl: { status: 'pending_validation' } }, 'pending_dns'],
    [{ status: 'active', ssl: { status: 'pending_validation' } }, 'pending_ssl'],
    [{ status: 'active', ssl: { status: 'active' } }, 'active'],
    [{ status: 'pending', verification_errors: ['DNS mismatch'], ssl: { status: 'pending_validation' } }, 'error'],
    [{ status: 'active', ssl: { status: 'pending_validation', validation_errors: [{ message: 'CAA blocked' }] } }, 'error'],
  ];
  const provider = setup();
  for (const [cfResult, expected] of cases) {
    global.fetch = async () => response({ success: true, result: Object.assign({ id: 'cf-x', hostname: 'go.exemplo.com' }, cfResult) });
    const st = await provider.status('cf-x', 'go.exemplo.com');
    assert.equal(st.status, expected, JSON.stringify(cfResult) + ' → ' + expected);
  }
});

test('status active exige hostname E certificado ativos (verified=true)', async () => {
  global.fetch = async () => response({ success: true, result: {
    id: 'cf-host-2', hostname: 'go.exemplo.com', status: 'active', ssl: { status: 'active', validation_records: [] },
  } });
  const provider = setup();
  const result = await provider.status('cf-host-2', 'go.exemplo.com');
  assert.equal(result.verified, true);
  assert.equal(result.status, 'active');
  assert.equal(result.certificateStatus, 'active');
});

test('register duplicado adota o hostname existente em vez de falhar', async () => {
  let calls = 0;
  global.fetch = async (url, options) => {
    calls++;
    if (options && options.method === 'POST') {
      return response({ success: false, errors: [{ message: 'custom hostname already exists' }] }, 409);
    }
    return response({ success: true, result: [{ id: 'cf-existing', hostname: 'dup.exemplo.com', status: 'active', ssl: { status: 'active' } }] });
  };
  const provider = setup();
  const result = await provider.register('dup.exemplo.com');
  assert.equal(result.providerId, 'cf-existing');
  assert.equal(result.status, 'active');
  assert.equal(calls >= 2, true);
});

test('classifica erro de autenticação sem vazar o token', async () => {
  global.fetch = async () => response({ success: false, errors: [{ message: 'Authentication error' }] }, 403);
  const provider = setup();
  await assert.rejects(provider.register('go.exemplo.com'), (error) => {
    assert.equal(error.message, 'auth');
    assert.equal(String(error.detail).includes('test-token'), false);
    return true;
  });
});

// ── isPublicHostname ─────────────────────────────────────────────────────────

test('isPublicHostname rejeita hosts internos e IPs privados', () => {
  const provider = setup();
  assert.equal(provider.isPublicHostname('app-production.up.railway.app'), true);
  assert.equal(provider.isPublicHostname('domains.roi-nados.top'), true);
  assert.equal(provider.isPublicHostname('teste.railway.internal'), false);
  assert.equal(provider.isPublicHostname('localhost'), false);
  assert.equal(provider.isPublicHostname('meu-app.local'), false);
  assert.equal(provider.isPublicHostname('10.0.0.5'), false);
  assert.equal(provider.isPublicHostname('192.168.1.1'), false);
  assert.equal(provider.isPublicHostname('172.20.0.1'), false);
  assert.equal(provider.isPublicHostname('127.0.0.1'), false);
  assert.equal(provider.isPublicHostname(''), false);
  assert.equal(provider.isPublicHostname('https://app.exemplo.com/path'), true);
});

// ── preflight ────────────────────────────────────────────────────────────────

test('preflight falha com causa "origem privada" quando a origem é interna', async () => {
  const provider = setup({ CLOUDFLARE_FALLBACK_ORIGIN: 'teste.railway.internal' });
  const p = await provider.runPreflight();
  assert.equal(p.ok, false);
  assert.equal(p.cause, 'origem privada');
  assert.equal(provider.enabled, false);
});

test('preflight falha com causa "auth" quando o token é rejeitado', async () => {
  global.fetch = routedFetch([
    ['https://api.cloudflare.com', () => response({ success: false, errors: [{ message: 'Authentication error' }] }, 403)],
  ]);
  const provider = setup();
  const p = await provider.runPreflight();
  assert.equal(p.ok, false);
  assert.equal(p.cause, 'auth');
  assert.equal(String(p.detail).includes('test-token'), false);
  assert.equal(provider.enabled, false);
});

test('preflight falha com causa "origem offline" quando o marcador não responde 200', async () => {
  global.fetch = routedFetch([
    ['https://api.cloudflare.com/client/v4/zones/zone-123/custom_hostnames/fallback_origin', () => response({ success: true, result: { origin: 'app-production.up.railway.app', status: 'active' } })],
    ['https://api.cloudflare.com', () => response({ success: true, result: { id: 'zone-123', name: 'roi-nados.top' } })],
    ['https://app-production.up.railway.app', () => response({ ok: false }, 404)],
  ]);
  const provider = setup();
  const p = await provider.runPreflight();
  assert.equal(p.ok, false);
  assert.equal(p.cause, 'origem offline');
  assert.equal(provider.enabled, false);
});

test('preflight OK ativa o provider e sincroniza o fallback origin da zona', async () => {
  let fallbackPut = null;
  global.fetch = routedFetch([
    ['https://api.cloudflare.com/client/v4/zones/zone-123/custom_hostnames/fallback_origin', (url, options) => {
      if (options && options.method === 'PUT') {
        fallbackPut = JSON.parse(options.body);
        return response({ success: true, result: { origin: fallbackPut.origin, status: 'pending_deployment' } });
      }
      // GET: zona ainda sem fallback origin
      return response({ success: false, errors: [{ message: 'not found' }] }, 404);
    }],
    ['https://api.cloudflare.com', () => response({ success: true, result: { id: 'zone-123', name: 'roi-nados.top' } })],
    ['https://app-production.up.railway.app', () => response({ app: 'roi-nados-tracker', ok: true })],
  ]);
  const provider = setup();
  const p = await provider.runPreflight();
  assert.equal(p.ok, true);
  assert.equal(p.zone, 'roi-nados.top');
  assert.equal(fallbackPut.origin, 'app-production.up.railway.app');
  assert.equal(p.fallbackOrigin.changed, true);
  assert.equal(provider.enabled, true);
});

test('preflight idempotente: fallback origin já correto não dispara PUT', async () => {
  let putCalled = false;
  global.fetch = routedFetch([
    ['https://api.cloudflare.com/client/v4/zones/zone-123/custom_hostnames/fallback_origin', (url, options) => {
      if (options && options.method === 'PUT') { putCalled = true; }
      return response({ success: true, result: { origin: 'app-production.up.railway.app', status: 'active' } });
    }],
    ['https://api.cloudflare.com', () => response({ success: true, result: { id: 'zone-123', name: 'roi-nados.top' } })],
    ['https://app-production.up.railway.app', () => response({ app: 'roi-nados-tracker', ok: true })],
  ]);
  const provider = setup();
  const p = await provider.runPreflight();
  assert.equal(p.ok, true);
  assert.equal(putCalled, false);
  assert.equal(p.fallbackOrigin.changed, false);
});

test('health() reporta modo degradado sem CLOUDFLARE_CNAME_TARGET', async () => {
  global.fetch = routedFetch([
    ['https://api.cloudflare.com/client/v4/zones/zone-123/custom_hostnames/fallback_origin', () => response({ success: true, result: { origin: 'app-production.up.railway.app', status: 'active' } })],
    ['https://api.cloudflare.com', () => response({ success: true, result: { id: 'zone-123', name: 'roi-nados.top' } })],
    ['https://app-production.up.railway.app', () => response({ app: 'roi-nados-tracker', ok: true })],
  ]);
  const provider = setup({ CLOUDFLARE_CNAME_TARGET: undefined });
  const h = await provider.health();
  assert.equal(h.enabled, true);
  assert.equal(h.degraded, true);
  assert.equal(h.cnameTarget, 'app-production.up.railway.app');
});
