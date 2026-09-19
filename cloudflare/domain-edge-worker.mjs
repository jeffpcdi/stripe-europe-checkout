const VERSION = 'v2';

function cleanHost(value) {
  return String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '').replace(/\.$/, '');
}

function cleanIp(value) {
  return String(value || '').split(',')[0].trim().slice(0, 80);
}

function cleanCountry(value) {
  const out = String(value || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(out) ? out : '';
}

function cleanAsn(value) {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n > 0 && n <= 4294967295 ? String(n) : '';
}

function cleanColo(value) {
  const out = String(value || '').trim().toUpperCase();
  return /^[A-Z0-9-]{2,12}$/.test(out) ? out : '';
}

function canonicalPayload({ timestamp, method, host, path, clientIp, country, asn, colo }) {
  return [
    VERSION,
    String(timestamp),
    String(method || 'GET').toUpperCase(),
    cleanHost(host),
    String(path || '/'),
    cleanIp(clientIp),
    cleanCountry(country),
    cleanAsn(asn),
    cleanColo(colo),
  ].join('\n');
}

function bytesToHex(buffer) {
  return Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmac(secret, payload) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return bytesToHex(await crypto.subtle.sign('HMAC', key, enc.encode(payload)));
}

export async function buildOriginRequest(request, env, nowMs = Date.now()) {
  const originHost = cleanHost(env && env.EDGE_ORIGIN_HOST);
  const secret = String((env && env.EDGE_DOMAIN_SECRET) || '');
  if (!originHost || !originHost.includes('.')) throw new Error('EDGE_ORIGIN_HOST inválido');
  if (!secret) throw new Error('EDGE_DOMAIN_SECRET ausente');

  const incoming = new URL(request.url);
  const originalHost = cleanHost(request.headers.get('host') || incoming.hostname);
  if (!originalHost || !originalHost.includes('.')) throw new Error('hostname original inválido');

  // O Worker é a fronteira de confiança. Captura os metadados produzidos pela
  // própria Cloudflare e os inclui no HMAC; o origin nunca precisa confiar em
  // CF-Connecting-IP/CF-IPCountry isoladamente.
  const cf = request.cf || {};
  const clientIp = cleanIp(request.headers.get('cf-connecting-ip'));
  const country = cleanCountry(cf.country || request.headers.get('cf-ipcountry'));
  const asn = cleanAsn(cf.asn);
  const colo = cleanColo(cf.colo);

  const timestamp = String(Math.floor(Number(nowMs) / 1000));
  const path = incoming.pathname + incoming.search;
  const signature = await hmac(secret, canonicalPayload({
    timestamp, method: request.method, host: originalHost, path,
    clientIp, country, asn, colo,
  }));

  const target = new URL(request.url);
  target.protocol = 'https:';
  target.hostname = originHost;
  target.port = '';

  const headers = new Headers(request.headers);
  // Remove qualquer envelope ROI enviado pelo cliente e recria tudo no Edge.
  for (const name of [
    'X-ROI-Original-Host', 'X-ROI-Edge-Timestamp', 'X-ROI-Edge-Version',
    'X-ROI-Edge-Signature', 'X-ROI-Edge-Client-IP', 'X-ROI-Edge-Country',
    'X-ROI-Edge-ASN', 'X-ROI-Edge-Colo',
  ]) headers.delete(name);

  headers.set('X-ROI-Original-Host', originalHost);
  headers.set('X-ROI-Edge-Timestamp', timestamp);
  headers.set('X-ROI-Edge-Version', VERSION);
  headers.set('X-ROI-Edge-Client-IP', clientIp);
  headers.set('X-ROI-Edge-Country', country);
  headers.set('X-ROI-Edge-ASN', asn);
  headers.set('X-ROI-Edge-Colo', colo);
  headers.set('X-ROI-Edge-Signature', signature);

  const init = {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    redirect: 'manual',
  };
  if (typeof process !== 'undefined' && init.body) init.duplex = 'half';
  return new Request(target.toString(), init);
}

export default {
  async fetch(request, env) {
    const originRequest = await buildOriginRequest(request, env);
    return fetch(originRequest);
  },
};
