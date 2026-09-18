const VERSION = 'v1';

function cleanHost(value) {
  return String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '').replace(/\.$/, '');
}

function canonicalPayload({ timestamp, method, host, path }) {
  return [VERSION, String(timestamp), String(method || 'GET').toUpperCase(), cleanHost(host), String(path || '/')].join('\n');
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

  const timestamp = String(Math.floor(Number(nowMs) / 1000));
  const path = incoming.pathname + incoming.search;
  const signature = await hmac(secret, canonicalPayload({ timestamp, method: request.method, host: originalHost, path }));

  const target = new URL(request.url);
  target.protocol = 'https:';
  target.hostname = originHost;
  target.port = '';

  const headers = new Headers(request.headers);
  // Headers de contexto sempre são sobrescritos; valores enviados pelo cliente
  // nunca atravessam como autoridade para o backend.
  headers.set('X-ROI-Original-Host', originalHost);
  headers.set('X-ROI-Edge-Timestamp', timestamp);
  headers.set('X-ROI-Edge-Version', VERSION);
  headers.set('X-ROI-Edge-Signature', signature);

  const init = {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    redirect: 'manual',
  };
  // Node exige duplex para ReadableStream em testes; Workers ignora esse campo.
  if (typeof process !== 'undefined' && init.body) init.duplex = 'half';
  return new Request(target.toString(), init);
}

export default {
  async fetch(request, env) {
    const originRequest = await buildOriginRequest(request, env);
    return fetch(originRequest);
  },
};
