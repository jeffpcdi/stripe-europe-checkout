#!/usr/bin/env node
// Pós-deploy: valida infraestrutura Cloudflare for SaaS + Worker e, opcionalmente,
// um ou mais hostnames de cliente. Não altera nada.
import tls from 'node:tls';
import { promises as dns } from 'node:dns';

const API = 'https://api.cloudflare.com/client/v4';
const APP_CHECK_ID = 'roi-nados-tracker';
const TOKEN = process.env.CLOUDFLARE_API_TOKEN || '';
const ZONE = process.env.CLOUDFLARE_ZONE_ID || '';
const CNAME_TARGET = clean(process.env.CLOUDFLARE_CNAME_TARGET);
const FALLBACK = clean(process.env.CLOUDFLARE_FALLBACK_ORIGIN);
const EDGE_ORIGIN = clean(process.env.EDGE_ORIGIN_HOST);
const EDGE_READY = process.env.CLOUDFLARE_EDGE_READY === 'true';
const domains = process.argv.slice(2).map(clean).filter(Boolean);
let failures = 0;
function clean(v){return String(v||'').trim().toLowerCase().replace(/^https?:\/\//,'').replace(/\/.*$/,'').replace(/\.$/,'');}
function ok(l,d){console.log('  PASS  '+l+(d?' — '+d:''));}
function fail(l,d){failures++;console.error('  FAIL  '+l+(d?' — '+d:''));}
function skip(l,d){console.log('  SKIP  '+l+(d?' — '+d:''));}
async function cf(path){
  const r=await fetch(API+path,{headers:{Authorization:'Bearer '+TOKEN},signal:AbortSignal.timeout(15000)});
  const body=await r.json().catch(()=>null); return {status:r.status,body};
}
function checkTls(host){return new Promise((resolve)=>{
  const socket=tls.connect({host,port:443,servername:host,timeout:10000,rejectUnauthorized:false},()=>{
    const cert=socket.getPeerCertificate(); const san=String(cert?.subjectaltname||'');
    const covers=san.split(/,\s*/).some((s)=>{const v=s.replace(/^DNS:/i,'').toLowerCase(); return v===host||(v.startsWith('*.')&&host.endsWith(v.slice(1))&&host.split('.').length===v.split('.').length);});
    socket.destroy(); resolve({covers,san});
  });
  socket.on('error',(e)=>resolve({covers:false,error:e.code||e.message}));
  socket.on('timeout',()=>{socket.destroy();resolve({covers:false,error:'timeout'});});
});}

console.log('== ROI-NADOS V16.20 — check de domínios ==\n');
console.log('[1] Configuração local');
if (!TOKEN||!ZONE||!CNAME_TARGET||!FALLBACK) fail('Cloudflare env','token/zona/CNAME target/fallback incompletos'); else ok('Cloudflare env');
if (!EDGE_ORIGIN||!process.env.EDGE_DOMAIN_SECRET) fail('Edge env','EDGE_ORIGIN_HOST/EDGE_DOMAIN_SECRET ausentes'); else ok('Edge env');
if (!EDGE_READY) fail('edgeReady','CLOUDFLARE_EDGE_READY não está true'); else ok('edgeReady');

console.log('\n[2] Cloudflare for SaaS');
if (TOKEN&&ZONE) {
  const zone=await cf('/zones/'+encodeURIComponent(ZONE));
  if (zone.status===200&&zone.body?.success) ok('zona',zone.body.result?.name||ZONE); else fail('zona','HTTP '+zone.status);
  const list=await cf('/zones/'+encodeURIComponent(ZONE)+'/custom_hostnames?per_page=1&page=1');
  if (list.status===200&&list.body?.success) ok('Custom Hostnames','API disponível, usados '+(list.body.result_info?.total_count??'?')); else fail('Custom Hostnames','HTTP '+list.status+' '+JSON.stringify(list.body?.errors||[]));
  const fb=await cf('/zones/'+encodeURIComponent(ZONE)+'/custom_hostnames/fallback_origin');
  if (fb.status===200&&fb.body?.success&&fb.body.result) {
    const got=clean(fb.body.result.origin); const active=String(fb.body.result.status||'').toLowerCase()==='active';
    if (active&&got===FALLBACK) ok('fallback origin',got+' (active)'); else fail('fallback origin','origin='+got+' status='+fb.body.result.status+' esperado='+FALLBACK);
  } else fail('fallback origin','HTTP '+fb.status);
}

console.log('\n[3] Edge origin e CNAME target');
if (EDGE_ORIGIN) {
  try {
    const r=await fetch('https://'+EDGE_ORIGIN+'/__domain-check',{signal:AbortSignal.timeout(10000)});
    const j=r.status===200?await r.json().catch(()=>null):null;
    if (j?.app===APP_CHECK_ID) ok('Railway origin','/__domain-check responde app correto'); else fail('Railway origin','HTTP '+r.status);
  } catch(e){fail('Railway origin',e.message);}
}
if (CNAME_TARGET) {
  const [cn,a]=await Promise.all([dns.resolveCname(CNAME_TARGET).catch(()=>[]),dns.resolve4(CNAME_TARGET).catch(()=>[])]);
  if (cn.length||a.length) ok('CNAME target',cn[0]||a.join(', ')); else fail('CNAME target','não resolve');
}

for (const host of domains) {
  console.log('\n[domínio] '+host);
  const found=await cf('/zones/'+encodeURIComponent(ZONE)+'/custom_hostnames?hostname='+encodeURIComponent(host));
  const item=found.body?.success&&Array.isArray(found.body.result)?found.body.result[0]:null;
  if (!item) { fail('Custom Hostname','não encontrado'); continue; }
  if (item.status==='active'&&item.ssl?.status==='active') ok('Custom Hostname','hostname + SSL active');
  else fail('Custom Hostname','status='+item.status+' ssl='+item.ssl?.status);

  const cn=await dns.resolveCname(host).catch(()=>[]);
  if (cn.map(clean).includes(CNAME_TARGET)) ok('DNS','CNAME → '+CNAME_TARGET);
  else if (cn.length) fail('DNS','CNAME → '+cn.join(', ')+' (esperado '+CNAME_TARGET+')');
  else skip('DNS CNAME','apex/flattening pode ocultar CNAME; conferir provider do cliente');

  const t=await checkTls(host);
  if (t.covers) ok('TLS/SNI','certificado cobre hostname'); else fail('TLS/SNI',t.error||t.san||'SAN não cobre');
  try {
    const r=await fetch('https://'+host+'/__domain-check',{redirect:'manual',signal:AbortSignal.timeout(10000)});
    const j=r.status===200?await r.json().catch(()=>null):null;
    if (j?.app===APP_CHECK_ID&&j?.host===host&&j?.proof) ok('/__domain-check','host original preservado e prova presente');
    else fail('/__domain-check','HTTP '+r.status+' payload='+JSON.stringify(j));
  } catch(e){fail('/__domain-check',e.message);}
}

console.log('\n== Resultado: '+(failures===0?'TODAS as checagens passaram':failures+' falha(s)')+' ==');
process.exit(failures===0?0:1);
