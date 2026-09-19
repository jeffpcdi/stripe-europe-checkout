'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const edge = require('../edge-domain-auth');
const networkContext = require('../cloak-network-context');
const engine = require('../cloak-decision-engine');
const shadow = require('../cloak-decision-shadow');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const SECRET = 'edge-v16-22-test-secret-with-enough-entropy';
const NOW = 1760000000000;

function signedReq(version, network = {}, pathname = '/d8as97?utm_source=tiktok') {
  const timestamp = String(Math.floor(NOW / 1000));
  const input = {
    version,
    timestamp,
    method: 'GET',
    host: 'cloak.example.com',
    path: pathname,
    clientIp: network.clientIp || '',
    country: network.country || '',
    asn: network.asn || '',
    colo: network.colo || '',
  };
  const signature = edge.sign(SECRET, input);
  const headers = {
    host: 'origin.up.railway.app',
    'x-roi-original-host': 'cloak.example.com',
    'x-roi-edge-version': version,
    'x-roi-edge-timestamp': timestamp,
    'x-roi-edge-signature': signature,
  };
  if (version === edge.VERSION) {
    headers['x-roi-edge-client-ip'] = network.clientIp || '';
    headers['x-roi-edge-country'] = network.country || '';
    headers['x-roi-edge-asn'] = String(network.asn || '');
    headers['x-roi-edge-colo'] = network.colo || '';
  }
  return {
    method: 'GET',
    originalUrl: pathname,
    url: pathname,
    headers,
    socket: { remoteAddress: '10.0.0.2' },
  };
}

// Edge V2: host/path + contexto de rede fazem parte da mesma assinatura.
{
  const req = signedReq('v2', { clientIp: '203.0.113.8', country: 'BR', asn: 12345, colo: 'GRU' });
  const verified = edge.verifyEdgeRequest(req, { secret: SECRET, nowMs: NOW });
  assert.equal(verified.ok, true);
  assert.equal(verified.networkVerified, true);
  assert.equal(verified.clientIp, '203.0.113.8');
  assert.equal(verified.country, 'BR');
  assert.equal(verified.asn, 12345);
  assert.equal(verified.colo, 'GRU');

  const tampered = { ...req, headers: { ...req.headers, 'x-roi-edge-country': 'US' } };
  assert.equal(edge.verifyEdgeRequest(tampered, { secret: SECRET, nowMs: NOW }).ok, false);
}

// V1 continua aceito somente para host/path; rede não vira autoridade.
{
  const req = signedReq('v1');
  req.headers['cf-connecting-ip'] = '198.51.100.55';
  req.headers['cf-ipcountry'] = 'US';
  const verified = edge.verifyEdgeRequest(req, { secret: SECRET, nowMs: NOW });
  assert.equal(verified.ok, true);
  assert.equal(verified.networkVerified, false);
  const ctx = networkContext.fromRequest(req, { edgeOptions: { secret: SECRET, nowMs: NOW }, noCache: true });
  assert.equal(ctx.edgeVerified, true);
  assert.equal(ctx.networkVerified, false);
  assert.equal(ctx.country, '');
  assert.equal(ctx.asn, 0);
}

// Sem envelope assinado, headers Cloudflare/Vercel não são autoridade no V6.
{
  const req = {
    method: 'GET',
    originalUrl: '/x',
    headers: {
      host: 'origin.example.com',
      'x-forwarded-for': '198.51.100.10',
      'cf-connecting-ip': '1.2.3.4',
      'cf-ipcountry': 'BR',
    },
    socket: { remoteAddress: '10.0.0.2' },
  };
  const ctx = networkContext.fromRequest(req, { edgeOptions: { secret: SECRET, nowMs: NOW }, noCache: true });
  assert.equal(ctx.networkVerified, false);
  assert.equal(ctx.country, '');
  assert.equal(ctx.asn, 0);
  assert.equal(ctx.source, 'origin-unverified');
}

// Motor V6 é puro: browser coerente + Edge verificada segue PRIMARY.
const goodHeaders = {
  'user-agent': 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36',
  accept: 'text/html,application/xhtml+xml',
  'accept-language': 'pt-BR,pt;q=0.9',
  'sec-fetch-site': 'none',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-dest': 'document',
  'sec-ch-ua-mobile': '?1',
};
{
  const out = engine.decide({
    policy: { sensitivity: 'balanced', blockDatacenter: true, requireJsChallenge: true },
    network: { networkVerified: true, country: 'BR', asn: 12345 },
    request: { headers: goodHeaders, ua: goodHeaders['user-agent'], isMobile: true, language: 'pt' },
    browser: { challenge: 'ok', challengeAgeMs: 1000, webgl: 'ANGLE (Qualcomm Adreno)', beh: 70, ent: 60, nt: 0 },
    state: {},
  });
  assert.equal(out.decision, 'PRIMARY');
  assert.equal(out.policyVersion, engine.POLICY_VERSION);
}

// Estado confirmado e política explícita continuam determinísticos.
{
  assert.equal(engine.decide({
    policy: {}, network: {}, request: { headers: goodHeaders, ua: goodHeaders['user-agent'], isMobile: true },
    state: { knownBot: true },
  }).decision, 'SAFE');

  assert.equal(engine.decide({
    policy: { paises: ['BR'] },
    network: { networkVerified: true, country: 'US', asn: 12345 },
    request: { headers: goodHeaders, ua: goodHeaders['user-agent'], isMobile: true, language: 'pt' },
    browser: { challenge: 'ok', challengeAgeMs: 1000 },
    state: {},
  }).decision, 'SAFE');
}

// Quando uma allowlist depende de país e a rede não é assinada, V6 não inventa
// um país nem libera silenciosamente: classifica como CHALLENGE.
{
  const out = engine.decide({
    policy: { paises: ['BR'] },
    network: { networkVerified: false, country: '', asn: 0 },
    request: { headers: goodHeaders, ua: goodHeaders['user-agent'], isMobile: true, language: 'pt' },
    browser: { challenge: 'ok', challengeAgeMs: 1000 },
    state: {},
  });
  assert.equal(out.decision, 'CHALLENGE');
  assert.ok(out.reasons.includes('network:country-unverified'));
}

// Velocity no V6 é risco ponderado: nunca vira SAFE isoladamente, mas também
// não pode ser apagado por créditos positivos — sobe para CHALLENGE.
{
  const out = engine.decide({
    policy: { sensitivity: 'balanced' },
    network: { networkVerified: true, country: 'BR', asn: 12345 },
    request: { headers: goodHeaders, ua: goodHeaders['user-agent'], isMobile: true, language: 'pt' },
    browser: { challenge: 'ok', challengeAgeMs: 1000 },
    state: { velocityCount: 30, velocityLimit: 12 },
  });
  assert.equal(out.decision, 'CHALLENGE');
  assert.ok(out.reasons.some((r) => r.startsWith('velocity:')));
}

// Datacenter assinado também é no mínimo CHALLENGE quando os demais sinais
// parecem humanos; só evidência adicional forte deve promovê-lo a SAFE.
{
  const out = engine.decide({
    policy: { sensitivity: 'balanced', blockDatacenter: true },
    network: { networkVerified: true, country: 'BR', asn: 16509 },
    request: { headers: goodHeaders, ua: goodHeaders['user-agent'], isMobile: true, language: 'pt' },
    browser: { challenge: 'ok', challengeAgeMs: 1000, beh: 70, ent: 60, nt: 0 },
    state: {},
  });
  assert.equal(out.decision, 'CHALLENGE');
  assert.ok(out.reasons.includes('asn:datacenter'));
}

// Telemetria shadow é agregada, sem armazenar IP/UA.
{
  shadow.reset('acc-v622');
  shadow.record({
    accountId: 'acc-v622',
    campaignId: 'ck_abc',
    legacyAction: 'PRIMARY',
    legacyReason: '',
    v6: { decision: 'CHALLENGE', score: 35, confidence: 'medium', reasons: ['velocity:burst'] },
    edgeVerified: true,
    networkVerified: true,
  });
  const snap = shadow.snapshot('acc-v622');
  assert.equal(snap.total, 1);
  assert.equal(snap.diverged, 1);
  assert.equal(snap.v6.challenge, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(snap.recent[0], 'ip'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(snap.recent[0], 'ua'), false);
}

// Regressões estruturais da V16.21.1 + wiring V16.22.
{
  const server = read('server.js');
  const store = read('cloak-campaign-store.js');
  const worker = read('cloudflare/domain-edge-worker.mjs');
  const netCtx = read('cloak-network-context.js');
  const v6 = read('cloak-decision-engine.js');
  const bot = read('bot-filter.js');

  assert.match(server, /versao:\s*2/);
  assert.match(server, /validKeys\.add\('campaign:' \+ campaign\.id\)/);
  assert.match(server, /keys\.add\('campaign:' \+ campaign\.id\)/);
  assert.match(server, /gatewayRef = 'cloak:' \+ \(campaign \? campaign\.id : entry\.slug\)/);
  assert.match(server, /cloakDecisionShadow\.record/);
  assert.match(server, /app\.get\('\/api\/cloak\/engine-health'/);
  assert.match(server, /CLOAK_DECISION_ENGINE_MODE/);
  assert.match(store, /decisionEngineVersion/);
  assert.match(server, /\['v5', 'v6-shadow'\]\.includes\(b\.decisionEngineVersion\)/);

  const goStart = server.indexOf('async function handleCheckoutPublic');
  const goEnd = server.indexOf("app.get('/go/:slug'", goStart);
  assert.ok(goStart >= 0 && goEnd > goStart);
  const goBlock = server.slice(goStart, goEnd);
  assert.doesNotMatch(goBlock, /cloakDecisionEngine/);
  assert.doesNotMatch(goBlock, /roiNetworkContext/);
  assert.doesNotMatch(goBlock, /observedCountry\(\)/);

  const cloakStart = server.indexOf('async function handleCloakPublic');
  const cloakEnd = server.indexOf("app.get('/c/:slug'", cloakStart);
  assert.ok(cloakStart >= 0 && cloakEnd > cloakStart);
  const cloakBlock = server.slice(cloakStart, cloakEnd);
  assert.match(cloakBlock, /roiNetworkContext: networkContext && networkContext\.networkVerified/);
  assert.match(cloakBlock, /geoCountry: observedCountry\(\)/);
  assert.match(cloakBlock, /networkContext && networkContext\.networkVerified[\s\S]*networkContext\.ip \|\| ''/);
  assert.match(cloakBlock, /networkContext && networkContext\.networkVerified[\s\S]*networkContext\.country \|\| ''/);

  assert.match(worker, /const VERSION = 'v2'/);
  assert.match(worker, /X-ROI-Edge-Client-IP/);
  assert.match(worker, /X-ROI-Edge-ASN/);
  assert.doesNotMatch(netCtx, /require\(['"]dns['"]\)/);
  assert.doesNotMatch(v6, /require\(['"]dns['"]\)/);
  assert.doesNotMatch(v6, /require\(['"]\.\/redis['"]\)/);
  assert.match(bot, /roiNetworkContext/);
  assert.match(bot, /asn:edge-signed/);
  assert.match(bot, /trustedNetwork[\s\S]*\? \(trustedNetwork\.ip \|\| ''\)[\s\S]*: \(\(req\.headers\['x-forwarded-for'\]/);
  assert.match(server, /roiNetworkContext: networkContext && networkContext\.networkVerified/);
}

console.log('cloak-fast-decision-v16-22: trusted edge, pure V6 shadow e closeout V16.21.1 OK');
