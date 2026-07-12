'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const ENV_KEYS = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ZONE_ID', 'CLOUDFLARE_FALLBACK_ORIGIN'];
const originalEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const originalFetch = global.fetch;

function setup() {
  process.env.CLOUDFLARE_API_TOKEN = 'test-token';
  process.env.CLOUDFLARE_ZONE_ID = 'zone-123';
  process.env.CLOUDFLARE_FALLBACK_ORIGIN = 'customers.roi-nados.top';
  delete require.cache[require.resolve('../cloudflare-domain-provider')];
  return require('../cloudflare-domain-provider');
}

function response(result, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => result };
}

test.afterEach(() => {
  global.fetch = originalFetch;
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

test('register cria custom hostname e normaliza DNS/status', async () => {
  let request;
  global.fetch = async (url, options) => {
    request = { url, options };
    return response({ success: true, result: {
      id: 'cf-host-1', hostname: 'link.exemplo.com', status: 'pending',
      ownership_verification: { type: 'txt', name: '_cf-custom-hostname.link.exemplo.com', value: 'owner-token' },
      ssl: { status: 'pending_validation', validation_records: [{ txt_name: '_acme-challenge.link.exemplo.com', txt_value: 'ssl-token' }] },
    } });
  };
  const provider = setup();
  const result = await provider.register('https://LINK.exemplo.com/');
  assert.equal(request.url, 'https://api.cloudflare.com/client/v4/zones/zone-123/custom_hostnames');
  assert.equal(request.options.method, 'POST');
  assert.equal(JSON.parse(request.options.body).hostname, 'link.exemplo.com');
  assert.equal(result.provider, 'cloudflare');
  assert.equal(result.providerId, 'cf-host-1');
  assert.equal(result.dns.cname.target, 'customers.roi-nados.top');
  assert.equal(result.dns.ownership.value, 'owner-token');
  assert.equal(result.dns.certificate.value, 'ssl-token');
  assert.equal(result.verified, false);
});

test('status exige hostname e certificado ativos', async () => {
  global.fetch = async () => response({ success: true, result: {
    id: 'cf-host-2', hostname: 'go.exemplo.com', status: 'active', ssl: { status: 'active', validation_records: [] },
  } });
  const provider = setup();
  const result = await provider.status('cf-host-2', 'go.exemplo.com');
  assert.equal(result.verified, true);
  assert.equal(result.certificateStatus, 'active');
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
