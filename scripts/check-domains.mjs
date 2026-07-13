#!/usr/bin/env node
// Bateria E2E real de domínios personalizados (roda pós-deploy).
// Sai com código != 0 se qualquer checagem crítica falhar.
//
// Uso:
//   node --env-file-if-exists=/vercel/share/.env.project scripts/check-domains.mjs [dominio1 dominio2 ...]
//   (sem argumentos, testa os domínios padrão da conta)
//
// Checa, em ordem:
//   1. Token Cloudflare autentica na zona (GET /zones/:id → 200)
//   2. Fallback origin da zona → configurado e "active"
//   3. Origem pública responde /__domain-check
//   4. Por domínio: DNS público resolve → Cloudflare
//   5. Por domínio: TLS via SNI — SAN cobre o domínio (não *.up.railway.app)
//   6. Por domínio: https://<dominio>/__domain-check → 200 {ok:true}
'use strict';

import tls from 'node:tls';
import { promises as dns } from 'node:dns';

const API = 'https://api.cloudflare.com/client/v4';
const APP_CHECK_ID = 'roi-nados-tracker';
const DEFAULT_DOMAINS = ['cromo-seu-premio.top', 'worldlegocup26.top'];

const TOKEN = process.env.CLOUDFLARE_API_TOKEN || '';
const ZONE = process.env.CLOUDFLARE_ZONE_ID || '';
const ORIGIN = String(process.env.CLOUDFLARE_FALLBACK_ORIGIN || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
const domains = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_DOMAINS;

let failures = 0;
function ok(label, detail) { console.log('  PASS  ' + label + (detail ? ' — ' + detail : '')); }
function fail(label, detail) { failures++; console.error('  FAIL  ' + label + (detail ? ' — ' + detail : '')); }
function skip(label, detail) { console.log('  SKIP  ' + label + (detail ? ' — ' + detail : '')); }

async function cf(path) {
  const r = await fetch(API + path, { headers: { Authorization: 'Bearer ' + TOKEN }, signal: AbortSignal.timeout(15000) });
  const body = await r.json().catch(() => null);
  return { status: r.status, body };
}

function checkTls(host) {
  return new Promise((resolve) => {
    const socket = tls.connect({ host, port: 443, servername: host, timeout: 10000, rejectUnauthorized: false }, () => {
      const cert = socket.getPeerCertificate();
      const san = String((cert && cert.subjectaltname) || '');
      const covers = san.split(/,\s*/).some((s) => {
        const v = s.replace(/^DNS:/i, '').toLowerCase();
        return v === host || (v.startsWith('*.') && host.endsWith(v.slice(1)) && host.split('.').length === v.split('.').length);
      });
      socket.destroy();
      resolve({ covers, san });
    });
    socket.on('error', (e) => resolve({ covers: false, error: e.code || e.message }));
    socket.on('timeout', () => { socket.destroy(); resolve({ covers: false, error: 'timeout' }); });
  });
}

console.log('== Bateria E2E de domínios personalizados ==\n');

// 1. Token + zona
console.log('[1] Autenticação Cloudflare');
if (!TOKEN || !ZONE) {
  fail('token/zona', 'CLOUDFLARE_API_TOKEN ou CLOUDFLARE_ZONE_ID ausentes no ambiente');
} else {
  const { status, body } = await cf('/zones/' + encodeURIComponent(ZONE));
  if (status === 200 && body && body.success) ok('GET /zones/:id', 'zona "' + body.result.name + '"');
  else fail('GET /zones/:id', 'HTTP ' + status + ' — ' + JSON.stringify((body && body.errors) || []));
}

// 2. Fallback origin da zona
console.log('\n[2] Fallback origin da zona');
if (!TOKEN || !ZONE) {
  skip('fallback origin', 'sem credenciais');
} else {
  const { status, body } = await cf('/zones/' + encodeURIComponent(ZONE) + '/custom_hostnames/fallback_origin');
  if (status === 200 && body && body.success && body.result) {
    const fo = body.result;
    if (fo.status === 'active') ok('fallback origin', fo.origin + ' (active)');
    else fail('fallback origin', fo.origin + ' com status "' + fo.status + '" (esperado: active)');
    if (ORIGIN && String(fo.origin).toLowerCase() !== ORIGIN.toLowerCase()) {
      fail('fallback origin ≠ env', 'zona tem "' + fo.origin + '", ambiente diz "' + ORIGIN + '"');
    }
  } else {
    fail('fallback origin', 'não configurado na zona (HTTP ' + status + ')');
  }
}

// 3. Origem pública
console.log('\n[3] Origem pública (' + (ORIGIN || 'CLOUDFLARE_FALLBACK_ORIGIN ausente') + ')');
if (!ORIGIN) {
  fail('origem', 'CLOUDFLARE_FALLBACK_ORIGIN ausente');
} else if (/\.railway\.internal$|\.local$|^localhost$/.test(ORIGIN)) {
  fail('origem', '"' + ORIGIN + '" é hostname interno — a Cloudflare não alcança');
} else {
  try {
    const r = await fetch('https://' + ORIGIN + '/__domain-check', { signal: AbortSignal.timeout(10000) });
    const j = r.status === 200 ? await r.json().catch(() => null) : null;
    if (j && j.app === APP_CHECK_ID) ok('/__domain-check na origem', 'HTTP 200, app correto');
    else fail('/__domain-check na origem', 'HTTP ' + r.status + (j ? ', app "' + j.app + '"' : ''));
  } catch (e) {
    fail('/__domain-check na origem', e.name === 'TimeoutError' ? 'timeout' : e.message);
  }
}

// 4–6. Por domínio
for (const host of domains) {
  console.log('\n[dominio] ' + host);

  // 4. DNS público → Cloudflare
  const [cn, a, ns] = await Promise.all([
    dns.resolveCname(host).catch(() => []),
    dns.resolve4(host).catch(() => []),
    dns.resolveNs(host).catch(() => []),
  ]);
  if (!cn.length && !a.length) {
    fail('DNS', 'domínio não resolve (sem CNAME nem A)');
  } else {
    const onCf = ns.some((n) => /cloudflare\.com$/.test(n)) || a.length > 0;
    if (onCf) ok('DNS', cn.length ? 'CNAME → ' + cn[0] : 'A → ' + a.join(', '));
    else fail('DNS', 'resolve mas não parece passar pela Cloudflare');
  }

  // 5. TLS via SNI
  const t = await checkTls(host);
  if (t.covers) ok('TLS/SNI', 'certificado cobre o domínio');
  else if (t.error) fail('TLS/SNI', 'conexão falhou: ' + t.error);
  else if (/up\.railway\.app/.test(t.san || '')) fail('TLS/SNI', 'certificado é *.up.railway.app — CNAME aponta direto para a origem (falta o Managed CNAME target / fallback origin da zona)');
  else fail('TLS/SNI', 'SAN não cobre o domínio: ' + (t.san || 'vazio'));

  // 6. Marcador do app
  try {
    const r = await fetch('https://' + host + '/__domain-check', { redirect: 'manual', signal: AbortSignal.timeout(10000) });
    const j = r.status === 200 ? await r.json().catch(() => null) : null;
    if (j && j.app === APP_CHECK_ID && j.ok) ok('/__domain-check', 'HTTP 200 {ok:true}');
    else fail('/__domain-check', 'HTTP ' + r.status + (j ? ' app="' + j.app + '"' : ''));
  } catch (e) {
    fail('/__domain-check', e.name === 'TimeoutError' ? 'timeout' : e.message);
  }
}

console.log('\n== Resultado: ' + (failures === 0 ? 'TODAS as checagens passaram' : failures + ' falha(s)') + ' ==');
process.exit(failures === 0 ? 0 : 1);
