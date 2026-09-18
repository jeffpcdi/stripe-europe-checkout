'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

async function railwayProviderContract() {
  const providerPath = require.resolve('../domain-provider');
  const previous = {
    token: process.env.RAILWAY_API_TOKEN,
    project: process.env.RAILWAY_PROJECT_ID,
    environment: process.env.RAILWAY_ENVIRONMENT_ID,
    service: process.env.RAILWAY_SERVICE_ID,
    fetch: global.fetch,
  };
  process.env.RAILWAY_API_TOKEN = 'test-token';
  process.env.RAILWAY_PROJECT_ID = 'project-test';
  process.env.RAILWAY_ENVIRONMENT_ID = 'environment-test';
  process.env.RAILWAY_SERVICE_ID = 'service-test';

  const dnsRecords = [{
    recordType: 'CNAME', hostlabel: 'checkout', fqdn: 'checkout.example.com',
    requiredValue: 'edge-test.up.railway.app', currentValue: null, purpose: 'ROUTING', status: 'PENDING',
  }];
  const statusPending = {
    dnsRecords,
    verificationDnsHost: '_railway-verify.checkout.example.com',
    verificationToken: 'railway-verify=abc123',
    verified: false,
    certificateStatus: 'PENDING',
  };
  const statusIssued = { ...statusPending, verified: true, certificateStatus: 'ISSUED' };

  global.fetch = async (_url, options = {}) => {
    const body = JSON.parse(options.body || '{}');
    const query = String(body.query || '');
    if (query.includes('project(id:')) {
      return { json: async () => ({ data: { project: { id: 'project-test' } } }) };
    }
    if (query.includes('customDomainCreate')) {
      return { json: async () => ({ data: { customDomainCreate: { id: 'domain-1', status: statusPending } } }) };
    }
    if (query.includes('customDomain(id:')) {
      return { json: async () => ({ data: { customDomain: { id: 'domain-1', status: statusIssued } } }) };
    }
    if (query.includes('customDomains')) {
      return { json: async () => ({ data: { domains: { customDomains: [{ id: 'domain-1', domain: 'checkout.example.com', status: statusPending }] } } }) };
    }
    if (query.includes('serviceDomains')) {
      return { json: async () => ({ data: { domains: { serviceDomains: [{ id: 'service-domain-1' }] } } }) };
    }
    throw new Error('query inesperada no teste: ' + query.slice(0, 100));
  };

  delete require.cache[providerPath];
  const provider = require('../domain-provider');
  try {
    assert.equal(provider.mapStatus({ verified: false, certificateStatus: 'PENDING' }), 'pending_dns');
    assert.equal(provider.mapStatus({ verified: true, certificateStatus: 'PENDING' }), 'pending_ssl');
    assert.equal(provider.mapStatus({ verified: true, certificateStatus: 'ISSUED' }), 'active');
    assert.equal(provider.mapStatus({ verified: false, certificateStatus: 'FAILED' }), 'error');

    const registered = await provider.register('checkout.example.com');
    assert.equal(registered.provider, 'railway');
    assert.equal(registered.status, 'pending_dns');
    assert.deepEqual(registered.dns.cname, { host: 'checkout.example.com', target: 'edge-test.up.railway.app' });
    assert.deepEqual(registered.dns.txt, { host: '_railway-verify.checkout.example.com', value: 'railway-verify=abc123' });

    const current = await provider.status('domain-1');
    assert.equal(current.status, 'active');
    assert.equal(current.sslStatus, 'ISSUED');
    assert.deepEqual(current.dns.txt, registered.dns.txt, 'TXT precisa sobreviver ao refresh/status');

    const health = await provider.health();
    assert.equal(health.enabled, true);
  } finally {
    delete require.cache[providerPath];
    global.fetch = previous.fetch;
    for (const [key, value] of [
      ['RAILWAY_API_TOKEN', previous.token],
      ['RAILWAY_PROJECT_ID', previous.project],
      ['RAILWAY_ENVIRONMENT_ID', previous.environment],
      ['RAILWAY_SERVICE_ID', previous.service],
    ]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

async function reconcilerPreservesDns() {
  const reconciler = require('../domain-reconciler');
  const originalDns = {
    cname: { host: 'checkout.example.com', target: 'edge-test.up.railway.app' },
    txt: { host: '_railway-verify.checkout.example.com', value: 'railway-verify=abc123' },
  };
  const updated = await reconciler.inspectDomain('acc-test', {
    host: 'checkout.example.com', providerId: 'domain-1', provider: 'railway',
    status: 'pending_dns', verificado: false, dns: originalDns,
  }, {
    provider: {
      name: 'railway', enabled: true,
      status: async () => ({ provider: 'railway', status: 'pending_ssl', verified: true, sslStatus: 'PENDING', dns: null }),
      register: async () => { throw new Error('não deveria registrar novamente'); },
    },
    dns: { resolveCname: async () => ['edge-test.up.railway.app'] },
    security: {
      resolvePublicHost: async () => [{ address: '8.8.8.8', family: 4 }],
      tlsProbe: async () => ({ ok: false, error: 'pending' }),
      httpsProbe: async () => ({ status: 404, body: '' }),
      APP_CHECK_ID: 'test',
      verifyDomainProof: () => false,
    },
  });
  assert.deepEqual(updated.dns, originalDns, 'status temporário sem DNS não pode apagar instruções persistidas');
  assert.equal(updated.status, 'pending_ssl');
}

function sourceContracts() {
  const server = read('server.js');
  const ui = read('dashboard/components/domains/domains-view.tsx');
  const types = read('dashboard/lib/types.ts');
  const { normHost } = require('../security-helpers');

  assert.equal(normHost('  HTTPS://WWW.Example.COM./x '), 'www.example.com');
  assert.equal(normHost('checkout.example.com'), 'checkout.example.com');
  assert.equal(normHost('127.0.0.1'), null);
  assert.equal(normHost('8.8.8.8'), null);
  assert.equal(normHost('localhost'), null);
  assert.equal(normHost('example.123'), null);
  assert.equal(normHost('xn--mnich-kva.de'), 'xn--mnich-kva.de');

  const diag = server.slice(server.indexOf("app.get('/api/custom-domains/:host/diagnostics'"), server.indexOf('// ═══ Pushcut'));
  assert.match(diag, /providerForDomainEntry\(entry\)/, 'diagnóstico precisa usar o provider real do domínio');
  assert.match(diag, /domainProvider\.status\(entry\.providerId, host\)/, 'status deve vir da abstração selecionada');
  assert.doesNotMatch(diag, /cloudflareDomainProvider\.status\(/, 'diagnóstico não pode consultar Cloudflare diretamente');

  const verify = server.slice(server.indexOf("app.post('/api/domains/verify'"), server.indexOf("app.get('/api/custom-domains/:host/diagnostics'"));
  assert.match(verify, /providerForDomainEntry\(registeredDomain\)/, 'verify precisa respeitar provider persistido');
  assert.match(server, /function publicAppHost\(req\)/, 'fallback DNS deve usar um host público centralizado do SaaS');
  assert.match(server, /RAILWAY_PUBLIC_DOMAIN/, 'fallback deve preferir o domínio público do serviço quando disponível');

  assert.match(ui, /await verify\(domain\)/, 'diagnóstico saudável deve consolidar o estado usando /verify');
  assert.match(ui, /!result\.dnsOk[\s\S]*result\.dnsDetail[\s\S]*!result\.httpOk[\s\S]*result\.httpDetail/, 'feedback deve priorizar DNS e depois HTTPS');
  assert.match(ui, /data && data\.autoProvision === false/, 'UI precisa sinalizar indisponibilidade da automação');
  assert.match(ui, /manualDns/, 'UI precisa oferecer apontamento útil no fallback manual');
  assert.doesNotMatch(ui, /Railway|Cloudflare/, 'infraestrutura não deve aparecer na subaba Domínios');
  assert.match(types, /providerState\?:/, 'contrato de diagnóstico deve ser genérico por provider');
}

(async () => {
  await railwayProviderContract();
  await reconcilerPreservesDns();
  sourceContracts();
  console.log('domain-managed-v16-17: TXT Railway, provider routing, lifecycle, fallback e hostname OK');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
