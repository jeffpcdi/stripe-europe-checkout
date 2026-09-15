'use strict';

// Security helpers for user-controlled domains. Network probes must never
// follow DNS into loopback/private/link-local/reserved networks and must pin
// the resolved IP for the duration of the request to avoid DNS rebinding.
const dns = require('dns').promises;
const https = require('https');
const tls = require('tls');
const net = require('net');
const crypto = require('crypto');

const APP_CHECK_ID = 'roi-nados-tracker';

function normalizeIp(raw) {
  let ip = String(raw || '').trim().toLowerCase();
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  const zone = ip.indexOf('%');
  if (zone !== -1) ip = ip.slice(0, zone);
  return ip;
}

function ipv4Int(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return (((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3]) >>> 0;
}

function inV4(ip, base, bits) {
  const n = ipv4Int(ip); const b = ipv4Int(base);
  if (n == null || b == null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (n & mask) === (b & mask);
}

function isPublicIp(raw) {
  const ip = normalizeIp(raw);
  const family = net.isIP(ip);
  if (!family) return false;
  if (family === 4) {
    // Reject RFC1918, loopback, link-local, CGNAT, TEST-NET, benchmarking,
    // multicast and other non-routable/special-use IPv4 ranges.
    const blocked = [
      ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
      ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24],
      ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
      ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4],
      ['240.0.0.0', 4],
    ];
    return !blocked.some(([base, bits]) => inV4(ip, base, bits));
  }
  // IPv6: reject unspecified/loopback, ULA, link-local, multicast and
  // documentation/special-use ranges. Public global-unicast remains allowed.
  if (ip === '::' || ip === '::1') return false;
  if (/^(fc|fd)/.test(ip)) return false; // fc00::/7
  if (/^fe[89ab]/.test(ip)) return false; // fe80::/10
  if (/^ff/.test(ip)) return false; // multicast
  if (/^2001:db8(?::|$)/.test(ip)) return false; // documentation
  if (/^2001:10(?::|$)/.test(ip) || /^2001:2(?::|$)/.test(ip)) return false;
  return true;
}

async function resolvePublicHost(host) {
  const h = String(host || '').trim().toLowerCase().replace(/\.$/, '');
  if (!h || net.isIP(h)) {
    const err = new Error('host inválido para verificação'); err.code = 'invalid_host'; throw err;
  }
  let rows;
  try {
    rows = await dns.lookup(h, { all: true, verbatim: true });
  } catch (cause) {
    const err = new Error('domínio não resolve'); err.code = 'dns_unresolved'; err.cause = cause; throw err;
  }
  const addresses = (rows || []).map((r) => ({ address: normalizeIp(r.address), family: r.family || net.isIP(r.address) })).filter((r) => r.address);
  if (!addresses.length) {
    const err = new Error('domínio não resolve'); err.code = 'dns_unresolved'; throw err;
  }
  // Mixed public + private answers are rejected too: otherwise a resolver can
  // rotate between them after the validation step (DNS rebinding).
  const bad = addresses.find((r) => !isPublicIp(r.address));
  if (bad) {
    const err = new Error('o domínio resolve para uma rede privada ou reservada');
    err.code = 'unsafe_address'; err.address = bad.address; throw err;
  }
  return addresses;
}

function pickAddress(addresses) {
  return addresses.find((a) => a.family === 4) || addresses[0];
}

async function httpsProbe(host, path = '/', options = {}) {
  const addresses = options.addresses || await resolvePublicHost(host);
  const chosen = pickAddress(addresses);
  const timeoutMs = Math.max(500, Math.min(15000, Number(options.timeoutMs) || 8000));
  const maxBytes = Math.max(1024, Math.min(256 * 1024, Number(options.maxBytes) || 32768));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      if (err) reject(err); else resolve(value);
    };
    const req = https.request({
      host: chosen.address,
      family: chosen.family,
      port: 443,
      servername: host,
      method: options.method || 'GET',
      path,
      headers: { Host: host, 'User-Agent': 'ROINADOS-Domain-Check/4', Accept: 'application/json,text/plain;q=0.8,*/*;q=0.2' },
      rejectUnauthorized: options.rejectUnauthorized !== false,
      agent: false,
    }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          const err = new Error('resposta excede o limite de verificação'); err.code = 'response_too_large';
          req.destroy(err); return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => finish(null, {
        status: res.statusCode || 0,
        headers: res.headers || {},
        body: Buffer.concat(chunks).toString('utf8'),
        address: chosen.address,
        family: chosen.family,
      }));
    });
    req.setTimeout(timeoutMs, () => {
      const err = new Error('timeout'); err.code = 'timeout'; req.destroy(err);
    });
    req.on('error', (err) => finish(err));
    req.end();
  });
}

async function tlsProbe(host, options = {}) {
  const addresses = options.addresses || await resolvePublicHost(host);
  const chosen = pickAddress(addresses);
  const timeoutMs = Math.max(500, Math.min(15000, Number(options.timeoutMs) || 8000));
  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => { if (!done) { done = true; resolve(value); } };
    try {
      const socket = tls.connect({
        host: chosen.address,
        family: chosen.family,
        port: 443,
        servername: host,
        timeout: timeoutMs,
        rejectUnauthorized: false,
      }, () => {
        const cert = socket.getPeerCertificate();
        const san = String((cert && cert.subjectaltname) || '');
        const covers = san.split(/,\s*/).some((s) => {
          const v = s.replace(/^DNS:/i, '').toLowerCase();
          return v === host || (v.startsWith('*.') && host.endsWith(v.slice(1)) && host.split('.').length === v.split('.').length);
        });
        const authorized = socket.authorized === true;
        socket.destroy();
        finish({ ok: covers && authorized, authorized, covers, subject: cert && cert.subject ? cert.subject.CN : null, san: san || null, address: chosen.address });
      });
      socket.on('error', (e) => finish({ ok: false, error: e.code || e.message, address: chosen.address }));
      socket.on('timeout', () => { socket.destroy(); finish({ ok: false, error: 'timeout', address: chosen.address }); });
    } catch (e) { finish({ ok: false, error: e.message, address: chosen.address }); }
  });
}

function domainSecrets() {
  const current = String(process.env.DOMAIN_PROOF_SECRET || '').trim();
  const previous = String(process.env.DOMAIN_PROOF_SECRET_PREVIOUS || '').trim();
  if (!current) {
    if (process.env.NODE_ENV === 'production') {
      const err = new Error('DOMAIN_PROOF_SECRET é obrigatório em produção'); err.code = 'missing_domain_proof_secret'; throw err;
    }
    return ['roi-nados-domain-proof-dev-only'];
  }
  return previous && previous !== current ? [current, previous] : [current];
}
function domainSecret() { return domainSecrets()[0]; }

function proofWith(secret, host, accountId) {
  return crypto.createHmac('sha256', secret)
    .update(String(host || '').toLowerCase() + '|' + String(accountId || ''))
    .digest('base64url').slice(0, 32);
}

function domainProof(host, accountId) {
  return proofWith(domainSecret(), host, accountId);
}

function verifyDomainProof(host, accountId, proof) {
  if (!proof || typeof proof !== 'string') return false;
  const actual = Buffer.from(proof);
  let secrets;
  try { secrets = domainSecrets(); } catch (_) { return false; }
  for (const secret of secrets) {
    const expected = Buffer.from(proofWith(secret, host, accountId));
    if (actual.length !== expected.length) continue;
    try { if (crypto.timingSafeEqual(actual, expected)) return true; } catch (_) {}
  }
  return false;
}

function assertProductionConfig() {
  if (process.env.NODE_ENV !== 'production') return true;
  domainSecrets(); // throws with a clear boot-time error when missing
  return true;
}

module.exports = {
  APP_CHECK_ID,
  isPublicIp,
  resolvePublicHost,
  httpsProbe,
  tlsProbe,
  domainProof,
  verifyDomainProof,
  assertProductionConfig,
};
