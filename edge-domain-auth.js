'use strict';

const crypto = require('crypto');

const VERSION = 'v2';
const LEGACY_VERSION = 'v1';
const MAX_SKEW_SECONDS = 5 * 60;

function cleanHost(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
    .replace(/\.$/, '');
}

function cleanEdgeIp(value) {
  return String(value || '').split(',')[0].trim().slice(0, 80);
}

function cleanEdgeCountry(value) {
  const out = String(value || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(out) ? out : '';
}

function cleanEdgeAsn(value) {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n > 0 && n <= 4294967295 ? String(n) : '';
}

function cleanEdgeColo(value) {
  const out = String(value || '').trim().toUpperCase();
  return /^[A-Z0-9-]{2,12}$/.test(out) ? out : '';
}

function rawRequestHost(req) {
  return cleanHost((req && req.headers && (req.headers.host || req.headers['x-forwarded-host'])) || '');
}

function canonicalPayload(input = {}) {
  const version = String(input.version || VERSION);
  const base = [
    version,
    String(input.timestamp || ''),
    String(input.method || 'GET').toUpperCase(),
    cleanHost(input.host),
    String(input.path || '/'),
  ];
  if (version === VERSION) {
    base.push(
      cleanEdgeIp(input.clientIp),
      cleanEdgeCountry(input.country),
      cleanEdgeAsn(input.asn),
      cleanEdgeColo(input.colo),
    );
  }
  return base.join('\n');
}

function sign(secret, input) {
  return crypto.createHmac('sha256', String(secret || '')).update(canonicalPayload(input)).digest('hex');
}

function safeEqualHex(a, b) {
  try {
    const aa = Buffer.from(String(a || ''), 'hex');
    const bb = Buffer.from(String(b || ''), 'hex');
    return aa.length > 0 && aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
  } catch (_) { return false; }
}

function requestPath(req) {
  return String((req && (req.originalUrl || req.url)) || '/');
}

function verifyEdgeRequest(req, options = {}) {
  const h = (req && req.headers) || {};
  const version = String(h['x-roi-edge-version'] || '');
  const timestamp = String(h['x-roi-edge-timestamp'] || '');
  const originalHost = cleanHost(h['x-roi-original-host']);
  const signature = String(h['x-roi-edge-signature'] || '').trim().toLowerCase();
  const nowSeconds = Math.floor((options.nowMs == null ? Date.now() : Number(options.nowMs)) / 1000);
  const maxSkew = Math.max(30, Number(options.maxSkewSeconds) || MAX_SKEW_SECONDS);

  if (![VERSION, LEGACY_VERSION].includes(version)) return { ok: false, reason: 'version' };
  if (!/^\d{10,13}$/.test(timestamp)) return { ok: false, reason: 'timestamp' };
  const tsSeconds = timestamp.length > 10 ? Math.floor(Number(timestamp) / 1000) : Number(timestamp);
  if (!Number.isFinite(tsSeconds) || Math.abs(nowSeconds - tsSeconds) > maxSkew) return { ok: false, reason: 'replay' };
  if (!originalHost || !originalHost.includes('.')) return { ok: false, reason: 'host' };
  if (!/^[a-f0-9]{64}$/.test(signature)) return { ok: false, reason: 'signature' };

  const input = {
    version,
    timestamp,
    method: req && req.method,
    host: originalHost,
    path: requestPath(req),
  };
  if (version === VERSION) {
    input.clientIp = cleanEdgeIp(h['x-roi-edge-client-ip']);
    input.country = cleanEdgeCountry(h['x-roi-edge-country']);
    input.asn = cleanEdgeAsn(h['x-roi-edge-asn']);
    input.colo = cleanEdgeColo(h['x-roi-edge-colo']);
  }

  const secrets = [
    options.secret != null ? options.secret : process.env.EDGE_DOMAIN_SECRET,
    options.previousSecret != null ? options.previousSecret : process.env.EDGE_DOMAIN_SECRET_PREVIOUS,
  ].filter(Boolean);
  if (!secrets.length) return { ok: false, reason: 'secret_missing' };

  for (const secret of secrets) {
    if (safeEqualHex(signature, sign(secret, input))) {
      return {
        ok: true,
        host: originalHost,
        version,
        timestamp,
        viaEdge: true,
        networkVerified: version === VERSION,
        clientIp: version === VERSION ? input.clientIp : '',
        country: version === VERSION ? input.country : '',
        asn: version === VERSION ? (Number(input.asn) || 0) : 0,
        colo: version === VERSION ? input.colo : '',
      };
    }
  }
  return { ok: false, reason: 'signature' };
}

function resolveTrustedRequestHost(req, options = {}) {
  const edge = verifyEdgeRequest(req, options);
  if (edge.ok) return { host: edge.host, viaEdge: true, edge };
  return { host: rawRequestHost(req), viaEdge: false, edge };
}

function resolveTrustedClientIp(req, options = {}) {
  const edge = verifyEdgeRequest(req, options);
  if (edge.ok && edge.networkVerified && edge.clientIp) return edge.clientIp;
  if (edge.ok && edge.version === LEGACY_VERSION) {
    const cfIp = String((req.headers && req.headers['cf-connecting-ip']) || '').split(',')[0].trim();
    if (cfIp) return cfIp;
  }
  return String((req.headers && req.headers['x-forwarded-for']) || (req.socket && req.socket.remoteAddress) || '')
    .split(',')[0].trim();
}

module.exports = {
  VERSION,
  LEGACY_VERSION,
  MAX_SKEW_SECONDS,
  cleanHost,
  cleanEdgeIp,
  cleanEdgeCountry,
  cleanEdgeAsn,
  cleanEdgeColo,
  canonicalPayload,
  sign,
  safeEqualHex,
  verifyEdgeRequest,
  resolveTrustedRequestHost,
  resolveTrustedClientIp,
};
