'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const ENV_KEYS = [
  'CLOUDFLARE_API_TOKEN','CLOUDFLARE_ZONE_ID','CLOUDFLARE_CNAME_TARGET','CLOUDFLARE_FALLBACK_ORIGIN',
  'CLOUDFLARE_EDGE_READY','EDGE_DOMAIN_SECRET','EDGE_ORIGIN_HOST'
];
const originalEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const originalFetch = global.fetch;

function setup(overrides = {}) {
  Object.assign(process.env, {
    CLOUDFLARE_API_TOKEN: 'test-token',
    CLOUDFLARE_ZONE_ID: 'zone-123',
    CLOUDFLARE_CNAME_TARGET: 'customers.roi-nados.top',
    CLOUDFLARE_FALLBACK_ORIGIN: 'proxy-fallback.roi-nados.top',
    CLOUDFLARE_EDGE_READY: 'true',
    EDGE_DOMAIN_SECRET: 'edge-secret-test',
    EDGE_ORIGIN_HOST: 'app-production.up.railway.app',
  });
  for (const [k,v] of Object.entries(overrides)) v === undefined ? delete process.env[k] : process.env[k] = String(v);
  delete require.cache[require.resolve('../cloudflare-domain-provider')];
  return require('../cloudflare-domain-provider');
}
function response(body, status = 200, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[String(name).toLowerCase()] || null },
    json: async () => body,
  };
}
function customHost(id='cf-1', hostname='shop.customer.com', extra={}) {
  return Object.assign({ id, hostname, status: 'pending', ssl: { status: 'pending_validation', method: 'http', validation_records: [] } }, extra);
}

test.afterEach(() => {
  global.fetch = originalFetch;
  for (const key of ENV_KEYS) originalEnv[key] === undefined ? delete process.env[key] : process.env[key] = originalEnv[key];
});

test('register cria Custom Hostname com HTTP DCV e CNAME target SaaS', async () => {
  let postBody;
  global.fetch = async (url, options={}) => {
    if (options.method === 'POST') {
      postBody = JSON.parse(options.body);
      return response({ success:true, result: customHost('cf-1','shop.customer.com') }, 201);
    }
    if (String(url).includes('/custom_hostnames/cf-1')) return response({ success:true, result: customHost('cf-1','shop.customer.com') });
    return response({ success:true, result:{} });
  };
  const p = setup();
  const result = await p.register('SHOP.customer.com');
  assert.equal(postBody.hostname, 'shop.customer.com');
  assert.equal(postBody.ssl.method, 'http');
  assert.equal(postBody.custom_metadata, undefined);
  assert.equal(result.provider, 'cloudflare');
  assert.equal(result.dns.cname.target, 'customers.roi-nados.top');
  assert.equal(result.status, 'pending_dns');
});

test('hostname >64 caracteres ativa cloudflare_branding', async () => {
  let body;
  const host = 'very-long-label-abcdefghijklmnopqrstuvwxyz0123456789.customer.example.com';
  assert.equal(host.length > 64, true);
  global.fetch = async (url, options={}) => {
    if (options.method === 'POST') { body = JSON.parse(options.body); return response({success:true,result:customHost('long',host)},201); }
    return response({success:true,result:customHost('long',host)});
  };
  const p = setup();
  await p.register(host);
  assert.equal(body.ssl.cloudflare_branding, true);
});

test('sem edge pronta register falha fechado e nunca cai para Railway', async () => {
  global.fetch = async () => response({success:true,result:{}});
  const p = setup({ CLOUDFLARE_EDGE_READY:'false' });
  await assert.rejects(p.register('shop.customer.com'), /edge_not_ready/);
});

test('mapStatus exige hostname e SSL ativos', () => {
  const p = setup();
  assert.equal(p.mapStatus({status:'pending',ssl:{status:'pending_validation'}}),'pending_dns');
  assert.equal(p.mapStatus({status:'active',ssl:{status:'pending_validation'}}),'pending_ssl');
  assert.equal(p.mapStatus({status:'active',ssl:{status:'active'}}),'active');
  assert.equal(p.mapStatus({status:'blocked',ssl:{status:'pending_validation'}}),'error');
});

test('erro 1406 é duplicado e adota hostname existente', async () => {
  let calls=0;
  global.fetch = async (url, options={}) => {
    calls++;
    if (options.method === 'POST') return response({success:false,errors:[{code:1406,message:'Duplicate custom hostname found.'}]},409);
    if (String(url).includes('?hostname=')) return response({success:true,result:[customHost('existing','dup.customer.com',{status:'active',ssl:{status:'active',method:'http'}})]});
    return response({success:true,result:{}});
  };
  const p=setup();
  const result=await p.register('dup.customer.com');
  assert.equal(result.providerId,'existing');
  assert.equal(result.status,'active');
  assert.equal(calls>=2,true);
});

test('códigos 1404/1405/1406 têm classificação estruturada', async () => {
  const cases = [[1404,403,'saas_unavailable'],[1405,403,'capacity'],[1406,409,'duplicate']];
  for (const [code,status,msg] of cases) {
    global.fetch = async () => response({success:false,errors:[{code,message:'x'}]},status);
    const p=setup();
    await assert.rejects(p._cfEnvelope('/x'), (e) => e.message === msg && e.codes.includes(code));
  }
});

test('429 preserva Retry-After', async () => {
  global.fetch = async () => response({success:false,errors:[{code:1015,message:'rate limited'}]},429,{'retry-after':'17'});
  const p=setup();
  await assert.rejects(p._cfEnvelope('/x'), (e) => e.message==='rate_limit' && e.retryAfterSeconds===17);
});

test('health só fica healthy com auth + SaaS + edge + fallback ativo', async () => {
  global.fetch = async (url) => {
    const u=String(url);
    if (/\/zones\/zone-123$/.test(u)) return response({success:true,result:{id:'zone-123',name:'roi-nados.top'}});
    if (u.includes('/custom_hostnames?per_page=1')) return response({success:true,result:[],result_info:{total_count:7}});
    if (u.endsWith('/custom_hostnames/fallback_origin')) return response({success:true,result:{origin:'proxy-fallback.roi-nados.top',status:'active'}});
    throw new Error('unmocked '+u);
  };
  const p=setup();
  const h=await p.health({force:true});
  assert.equal(h.healthy,true);
  assert.equal(h.configured,true);
  assert.equal(h.authenticated,true);
  assert.equal(h.saasAvailable,true);
  assert.equal(h.edgeReady,true);
  assert.equal(h.fallbackReady,true);
  assert.equal(h.used,7);
});

test('fallback pending mantém auto provider não saudável', async () => {
  global.fetch = async (url) => {
    const u=String(url);
    if (/\/zones\/zone-123$/.test(u)) return response({success:true,result:{name:'roi-nados.top'}});
    if (u.includes('/custom_hostnames?per_page=1')) return response({success:true,result:[],result_info:{total_count:0}});
    if (u.endsWith('/fallback_origin')) return response({success:true,result:{origin:'proxy-fallback.roi-nados.top',status:'pending_deployment'}});
    return response({success:true,result:{}});
  };
  const p=setup();
  const h=await p.health({force:true});
  assert.equal(h.healthy,false);
  assert.equal(h.reason,'fallback_not_ready');
});

test('auth inválida deixa health falhar sem vazar token', async () => {
  global.fetch = async () => response({success:false,errors:[{code:1000,message:'Unauthorized'}]},401);
  const p=setup();
  const h=await p.health({force:true});
  assert.equal(h.healthy,false);
  assert.equal(h.reason,'auth');
  assert.equal(JSON.stringify(h).includes('test-token'),false);
});

test('retrigger HTTP DCV usa PATCH e cooldown', async () => {
  let patches=0;
  global.fetch = async (url,options={}) => {
    if (options.method==='PATCH') { patches++; return response({success:true,result:customHost('cf-1','shop.customer.com')},202); }
    return response({success:true,result:{}});
  };
  const p=setup();
  const one=await p.retriggerValidation('cf-1','shop.customer.com',{nowMs:1_000_000});
  const two=await p.retriggerValidation('cf-1','shop.customer.com',{nowMs:1_000_001});
  assert.equal(one.triggered,true);
  assert.equal(two.triggered,false);
  assert.equal(two.reason,'cooldown');
  assert.equal(patches,1);
});

test('normalize separa ownership HTTP, TXT e certificate validation', () => {
  const p=setup();
  const n=p._normalize(customHost('x','shop.customer.com',{
    ownership_verification:{type:'txt',name:'_cf-custom-hostname.shop.customer.com',value:'owner'},
    ownership_verification_http:{http_url:'http://shop.customer.com/.well-known/cf',http_body:'token'},
    ssl:{status:'pending_validation',method:'http',validation_records:[{txt_name:'_acme-challenge.shop.customer.com',txt_value:'cert'}]},
  }));
  assert.equal(n.dns.ownership.value,'owner');
  assert.equal(n.ownershipHttp.body,'token');
  assert.equal(n.dns.certificate.value,'cert');
});

test('isPublicHostname rejeita rede privada e aceita Railway público', () => {
  const p=setup();
  assert.equal(p.isPublicHostname('app-production.up.railway.app'),true);
  assert.equal(p.isPublicHostname('x.railway.internal'),false);
  assert.equal(p.isPublicHostname('127.0.0.1'),false);
  assert.equal(p.isPublicHostname('10.0.0.1'),false);
});
