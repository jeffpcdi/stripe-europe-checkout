'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const onboarding = require('../domain-onboarding');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

(async () => {
  assert.equal(onboarding.providerFromNameservers(['ada.ns.cloudflare.com']).provider, 'cloudflare');
  assert.equal(onboarding.providerFromNameservers(['ns1.dns-parking.com']).provider, 'hostinger');
  assert.equal(onboarding.providerFromNameservers(['a.sec.dns.br']).provider, 'registrobr');
  assert.equal(onboarding.providerFromNameservers(['ns11.domaincontrol.com']).provider, 'godaddy');
  assert.equal(onboarding.providerFromNameservers(['dns1.registrar-servers.com']).provider, 'namecheap');
  assert.equal(onboarding.providerFromNameservers(['ns.example.net']).provider, 'unknown');

  const zones = onboarding.candidateZones('checkout.loja.example.com.br');
  assert.deepEqual(zones, ['checkout.loja.example.com.br', 'loja.example.com.br', 'example.com.br']);
  assert.equal(zones.includes('com.br'), false);

  const calls = [];
  const detected = await onboarding.detectDnsProvider('checkout.example.com', {
    resolveNs: async (zone) => {
      calls.push(zone);
      if (zone === 'checkout.example.com') throw Object.assign(new Error('ENODATA'), { code: 'ENODATA' });
      if (zone === 'example.com') return ['lisa.ns.cloudflare.com', 'mark.ns.cloudflare.com'];
      return [];
    },
  });
  assert.equal(detected.provider, 'cloudflare');
  assert.equal(detected.confidence, 'high');
  assert.equal(detected.zone, 'example.com');
  assert.deepEqual(calls, ['checkout.example.com', 'example.com']);

  const server = read('server.js');
  const ui = read('dashboard/components/domains/domains-view.tsx');
  const types = read('dashboard/lib/types.ts');
  const reconciler = read('domain-reconciler.js');
  const configSource = read('config.js');
  const onboardingSource = read('domain-onboarding.js');

  // O domínio principal do SaaS é exclusivo da aplicação. Clientes só podem
  // cadastrar domínios próprios; nenhuma variável pode reativar subdomínio SaaS.
  assert.doesNotMatch(server, /\/api\/domains\/managed/);
  assert.doesNotMatch(server, /managedDomainCapability|managedLabelError|normalizeManagedLabel/);
  assert.doesNotMatch(ui, /Domínio ROI-NADOS|managedDomain|managedLabel|addManaged/);
  assert.doesNotMatch(types, /managedDomain\?:|managedLabel\?:|managed\?: boolean/);
  assert.doesNotMatch(reconciler, /managedWildcardProvider|domain\.managed === true/);
  assert.doesNotMatch(configSource, /managedLabel|d\.managed === true/);
  assert.doesNotMatch(onboardingSource, /MANAGED_DOMAIN_BASE|MANAGED_DOMAIN_WILDCARD_READY|managedDomainCapability/);

  const guideRoute = server.slice(server.indexOf("app.get('/api/domains/:host/guide'"), server.indexOf("app.delete('/api/domains/:host'"));
  assert.match(guideRoute, /customDomains[\s\S]*find\(\(domain\) => domain\.host === host\)/);
  assert.match(guideRoute, /detectDnsProvider\(host, dnsp\)/);
  assert.doesNotMatch(guideRoute, /setDurable|claimCustomDomain|register\(/);

  assert.match(ui, /Seu domínio/);
  assert.match(ui, /providerLabel/);
  assert.match(ui, /Copiar tudo/);
  assert.match(ui, /Copiar nome/);
  assert.match(ui, /Copiar valor/);
  assert.match(ui, /Cadastrado/);
  assert.match(ui, /Preparado/);
  assert.match(ui, /Configuração DNS/);
  assert.match(ui, /loadGuide\(domain\.host\)/);
  assert.doesNotMatch(ui, /Railway|Cloudflare/);
  assert.match(types, /export interface DomainDnsGuide/);

  console.log('domain-onboarding-v16-19: custom domains only, NS detection, tutorials e UX zero-backend OK');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
