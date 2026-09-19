'use strict';

const net = require('net');
const edgeDomainAuth = require('./edge-domain-auth');
const { normalizeAsn, isDatacenterAsn } = require('./cloak-network-risk');

const CACHE = Symbol('roi.cloak.networkContext');

function cleanIp(value) {
  let out = String(value || '').split(',')[0].trim().replace(/^["']|["']$/g, '');
  if (out.startsWith('[') && out.includes(']')) out = out.slice(1, out.indexOf(']'));
  if (out.startsWith('::ffff:') && net.isIP(out.slice(7)) === 4) out = out.slice(7);
  return net.isIP(out) ? out : '';
}

function cleanCountry(value) {
  const out = String(value || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(out) && out !== 'XX' && out !== 'T1' ? out : '';
}

function cleanColo(value) {
  const out = String(value || '').trim().toUpperCase();
  return /^[A-Z0-9-]{2,12}$/.test(out) ? out : '';
}

function bestEffortOriginIp(req) {
  const h = (req && req.headers) || {};
  const fwd = String(h['x-forwarded-for'] || '').split(',').map(cleanIp).find(Boolean);
  return fwd || cleanIp(h['x-real-ip']) || cleanIp(req && req.socket && req.socket.remoteAddress) || '';
}

function fromRequest(req, options = {}) {
  if (req && req[CACHE] && !options.noCache) return req[CACHE];

  let edge;
  try { edge = edgeDomainAuth.verifyEdgeRequest(req, options.edgeOptions || {}); }
  catch (_) { edge = { ok: false, reason: 'verify_error' }; }

  let out;
  if (edge.ok && edge.networkVerified) {
    const asn = normalizeAsn(edge.asn);
    out = {
      ip: cleanIp(edge.clientIp),
      country: cleanCountry(edge.country),
      asn,
      colo: cleanColo(edge.colo),
      host: edge.host || '',
      source: 'edge-v2',
      edgeVerified: true,
      networkVerified: true,
      datacenter: isDatacenterAsn(asn),
      edgeVersion: edge.version,
      edgeReason: null,
    };
  } else {
    // Sem envelope V2 assinado, o IP serve somente como contexto best-effort.
    // O V6 nunca transforma headers CF/Vercel/XFF não assinados em autoridade.
    out = {
      ip: bestEffortOriginIp(req),
      country: '',
      asn: 0,
      colo: '',
      host: edge && edge.ok ? (edge.host || '') : edgeDomainAuth.resolveTrustedRequestHost(req, options.edgeOptions || {}).host || '',
      source: edge && edge.ok ? 'edge-host-only' : 'origin-unverified',
      edgeVerified: !!(edge && edge.ok),
      networkVerified: false,
      datacenter: false,
      edgeVersion: edge && edge.version || null,
      edgeReason: edge && !edge.ok ? edge.reason || 'unverified' : 'network_unsigned',
    };
  }

  if (req && !options.noCache) {
    try { Object.defineProperty(req, CACHE, { value: out, configurable: true }); } catch (_) {}
  }
  return out;
}

module.exports = {
  cleanIp,
  cleanCountry,
  cleanColo,
  bestEffortOriginIp,
  fromRequest,
};
