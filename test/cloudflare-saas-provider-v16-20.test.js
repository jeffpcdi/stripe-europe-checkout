'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const edge = require('../edge-domain-auth');
const protectedDomains = require('../protected-domains');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function req({host='app-production.up.railway.app', originalHost, method='GET', url='/offer?a=1', timestamp, signature, secret='edge-secret'}={}) {
  const ts = String(timestamp || Math.floor(Date.now()/1000));
  const headers = { host };
  if (originalHost) {
    headers['x-roi-original-host'] = originalHost;
    headers['x-roi-edge-version'] = 'v1';
    headers['x-roi-edge-timestamp'] = ts;
    headers['x-roi-edge-signature'] = signature || edge.sign(secret, {version:'v1',timestamp:ts,method,host:originalHost,path:url});
  }
  return { method, originalUrl:url, url, headers, socket:{remoteAddress:'127.0.0.1'} };
}

test('edge válida usa hostname original assinado', () => {
  const r=req({originalHost:'shop.customer.com'});
  const result=edge.resolveTrustedRequestHost(r,{secret:'edge-secret'});
  assert.equal(result.viaEdge,true);
  assert.equal(result.host,'shop.customer.com');
});

test('header original sem assinatura nunca é confiável', () => {
  const r={method:'GET',originalUrl:'/x',headers:{host:'app-production.up.railway.app','x-roi-original-host':'victim.com'}};
  const result=edge.resolveTrustedRequestHost(r,{secret:'edge-secret'});
  assert.equal(result.viaEdge,false);
  assert.equal(result.host,'app-production.up.railway.app');
});

test('assinatura para outro path falha', () => {
  const ts=String(Math.floor(Date.now()/1000));
  const sig=edge.sign('edge-secret',{version:'v1',timestamp:ts,method:'GET',host:'shop.customer.com',path:'/a'});
  const r=req({originalHost:'shop.customer.com',url:'/b',timestamp:ts,signature:sig});
  assert.equal(edge.verifyEdgeRequest(r,{secret:'edge-secret'}).ok,false);
});

test('assinatura para outro hostname falha', () => {
  const ts=String(Math.floor(Date.now()/1000));
  const sig=edge.sign('edge-secret',{version:'v1',timestamp:ts,method:'GET',host:'a.customer.com',path:'/x'});
  const r=req({originalHost:'b.customer.com',url:'/x',timestamp:ts,signature:sig});
  assert.equal(edge.verifyEdgeRequest(r,{secret:'edge-secret'}).ok,false);
});

test('replay expirado é rejeitado', () => {
  const now=Date.now();
  const ts=String(Math.floor((now-10*60_000)/1000));
  const r=req({originalHost:'shop.customer.com',timestamp:ts});
  const result=edge.verifyEdgeRequest(r,{secret:'edge-secret',nowMs:now});
  assert.equal(result.ok,false);
  assert.equal(result.reason,'replay');
});

test('secret anterior permite rotação sem downtime', () => {
  const r=req({originalHost:'shop.customer.com',secret:'old-secret'});
  assert.equal(edge.verifyEdgeRequest(r,{secret:'new-secret',previousSecret:'old-secret'}).ok,true);
});

test('comparação timing-safe não aceita tamanhos diferentes', () => {
  assert.equal(edge.safeEqualHex('aa','aaaa'),false);
  assert.equal(edge.safeEqualHex('zz','aa'),false);
});

test('roi-nados.top e todos seus subdomínios são reservados', () => {
  const old=process.env.PRIMARY_SAAS_DOMAIN; process.env.PRIMARY_SAAS_DOMAIN='roi-nados.top';
  try {
    assert.equal(protectedDomains.isProtectedSaasHost('roi-nados.top'),true);
    assert.equal(protectedDomains.isProtectedSaasHost('www.roi-nados.top'),true);
    assert.equal(protectedDomains.isProtectedSaasHost('abc.roi-nados.top'),true);
    assert.equal(protectedDomains.isProtectedSaasHost('customer.com'),false);
  } finally { old===undefined ? delete process.env.PRIMARY_SAAS_DOMAIN : process.env.PRIMARY_SAAS_DOMAIN=old; }
});

test('Railway public origin também é reservado quando configurado', () => {
  const old=process.env.RAILWAY_PUBLIC_DOMAIN; process.env.RAILWAY_PUBLIC_DOMAIN='app-production.up.railway.app';
  try { assert.equal(protectedDomains.isProtectedSaasHost('app-production.up.railway.app'),true); }
  finally { old===undefined ? delete process.env.RAILWAY_PUBLIC_DOMAIN : process.env.RAILWAY_PUBLIC_DOMAIN=old; }
});

test('Worker mantém origin fixa, path, query e método', async () => {
  const worker = await import(path.join(root,'cloudflare/domain-edge-worker.mjs'));
  const incoming=new Request('https://shop.customer.com/pay?a=1',{method:'POST',headers:{'content-type':'text/plain','cookie':'v=1'},body:'hello',duplex:'half'});
  const out=await worker.buildOriginRequest(incoming,{EDGE_ORIGIN_HOST:'app-production.up.railway.app',EDGE_DOMAIN_SECRET:'edge-secret'},1_700_000_000_000);
  const u=new URL(out.url);
  assert.equal(u.hostname,'app-production.up.railway.app');
  assert.equal(u.pathname,'/pay');
  assert.equal(u.search,'?a=1');
  assert.equal(out.method,'POST');
  assert.equal(out.headers.get('x-roi-original-host'),'shop.customer.com');
  assert.equal(out.headers.get('cookie'),'v=1');
  assert.equal(await out.text(),'hello');
});

test('Worker sobrescreve headers edge enviados pelo cliente', async () => {
  const worker = await import(path.join(root,'cloudflare/domain-edge-worker.mjs'));
  const incoming=new Request('https://shop.customer.com/x',{headers:{'x-roi-original-host':'victim.com','x-roi-edge-signature':'forged'}});
  const out=await worker.buildOriginRequest(incoming,{EDGE_ORIGIN_HOST:'app-production.up.railway.app',EDGE_DOMAIN_SECRET:'edge-secret'},1_700_000_000_000);
  assert.equal(out.headers.get('x-roi-original-host'),'shop.customer.com');
  assert.notEqual(out.headers.get('x-roi-edge-signature'),'forged');
});

test('Worker não aceita origin controlada por request', async () => {
  const worker = await import(path.join(root,'cloudflare/domain-edge-worker.mjs'));
  const incoming=new Request('https://shop.customer.com/x?origin=evil.com',{headers:{'x-origin':'evil.com'}});
  const out=await worker.buildOriginRequest(incoming,{EDGE_ORIGIN_HOST:'app-production.up.railway.app',EDGE_DOMAIN_SECRET:'edge-secret'});
  assert.equal(new URL(out.url).hostname,'app-production.up.railway.app');
});

test('source contract: novos domínios não caem no Railway', () => {
  const server=read('server.js');
  const post=server.slice(server.indexOf("app.post('/api/domains'"),server.indexOf('// Guia de onboarding DNS'));
  assert.match(server,/function activeDomainProvider\(\)[\s\S]*return cloudflareDomainProvider/);
  assert.doesNotMatch(post,/railwayDomainProvider\.register/);
  assert.match(post,/cloudflareDomainProvider\.health\(\{ force: true \}\)/);
  assert.match(post,/domain_reserved/);
});

test('source contract: provider persistido mantém Railway legado', () => {
  const server=read('server.js');
  const block=server.slice(server.indexOf('function providerForDomainEntry'),server.indexOf('// normHost'));
  assert.match(block,/tagged === 'railway'/);
  assert.match(block,/return railwayDomainProvider/);
  assert.match(block,/tagged === 'cloudflare'/);
});

test('source contract: Cloudflare DNS não aceita origem Railway como target', () => {
  const server=read('server.js');
  const verify=server.slice(server.indexOf("app.post('/api/domains/verify'"),server.indexOf("app.get('/api/custom-domains/:host/diagnostics'"));
  assert.match(verify,/domainProvider\.name === 'cloudflare'[\s\S]*cloudflareDomainProvider\.cnameTarget\(\)/);
  assert.match(verify,/providerActiveForVerify/);
});

test('source contract: reconciliador exige provider Cloudflare active', () => {
  const reconciler=read('domain-reconciler.js');
  assert.match(reconciler,/providerReady = p\.name !== 'cloudflare'/);
  assert.match(reconciler,/retriggerValidation/);
});

test('source contract: limite não é mais hardcoded em 20', () => {
  const server=read('server.js');
  const config=read('config.js');
  assert.doesNotMatch(server,/limite de 20 domínios/);
  assert.doesNotMatch(config,/customDomains\.slice\(0, 20\)/);
  assert.match(server,/customDomainLimit\(\)/);
});

test('source contract: UI não expõe infraestrutura e não oferece fallback manual Railway', () => {
  const ui=read('dashboard/components/domains/domains-view.tsx');
  assert.doesNotMatch(ui,/Railway|Cloudflare for SaaS|fallback origin/i);
  assert.match(ui,/manualDnsAllowed/);
  assert.match(ui,/configuração automática de domínios ainda está sendo preparada/i);
});
