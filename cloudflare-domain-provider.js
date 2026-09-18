// Cloudflare for SaaS / Custom Hostnames provider (V16.20).
// New customer domains live in Cloudflare for SaaS; Railway is only the origin.
'use strict';

const API = 'https://api.cloudflare.com/client/v4';
const dns = require('dns').promises;

function cleanHost(value) {
  return String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '').replace(/\.$/, '');
}

function isPublicHostname(value) {
  const host = cleanHost(value);
  if (!host || !host.includes('.')) return false;
  if (/\.(railway\.internal|internal|local|localhost)$/.test(host) || host === 'localhost') return false;
  const ip = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ip) {
    const [a, b] = [Number(ip[1]), Number(ip[2])];
    if (a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || a === 0) return false;
  }
  return true;
}

function configured() {
  return Boolean(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ZONE_ID && cleanHost(process.env.CLOUDFLARE_CNAME_TARGET));
}

function cnameTarget() { return cleanHost(process.env.CLOUDFLARE_CNAME_TARGET); }
function fallbackOrigin() { return cleanHost(process.env.CLOUDFLARE_FALLBACK_ORIGIN); }
function edgeOrigin() { return cleanHost(process.env.EDGE_ORIGIN_HOST); }
function staticEdgeReady() {
  return Boolean(
    process.env.CLOUDFLARE_EDGE_READY === 'true'
    && process.env.EDGE_DOMAIN_SECRET
    && isPublicHostname(process.env.EDGE_ORIGIN_HOST)
    && cnameTarget()
    && fallbackOrigin()
  );
}

function headers() {
  return { Authorization: 'Bearer ' + process.env.CLOUDFLARE_API_TOKEN, 'Content-Type': 'application/json' };
}

function errorsFrom(body) {
  return body && Array.isArray(body.errors) ? body.errors : [];
}
function errorCodes(body) { return errorsFrom(body).map((e) => Number(e && e.code)).filter(Number.isFinite); }
function errorMessage(body, fallback) {
  return errorsFrom(body).map((e) => e && (e.message || e.code)).filter(Boolean).join('; ') || fallback;
}
function classify(status, body) {
  const codes = errorCodes(body);
  if (codes.includes(1404)) return 'saas_unavailable';
  if (codes.includes(1405)) return 'capacity';
  if (codes.includes(1406)) return 'duplicate';
  if (codes.includes(1413)) return 'metadata_unavailable';
  if (codes.includes(1414)) return 'origin_unavailable';
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'offline';
  const text = errorMessage(body, '').toLowerCase();
  if (text.includes('duplicate') || text.includes('already exists') || text.includes('already been added')) return 'duplicate';
  return 'failure';
}

async function cfEnvelope(path, options = {}) {
  let res;
  try {
    res = await fetch(API + path, Object.assign({ headers: headers(), signal: AbortSignal.timeout(15000) }, options));
  } catch (error) {
    const e = new Error('offline'); e.detail = error.message; throw e;
  }
  let body = null;
  try { body = await res.json(); } catch (_) { body = null; }
  if (!res.ok || !body || body.success !== true) {
    const e = new Error(classify(res.status, body));
    e.detail = errorMessage(body, 'Cloudflare HTTP ' + res.status);
    e.status = res.status;
    e.codes = errorCodes(body);
    const retry = Number(res.headers && res.headers.get && res.headers.get('retry-after'));
    if (Number.isFinite(retry) && retry > 0) e.retryAfterSeconds = retry;
    throw e;
  }
  return body;
}
async function cf(path, options) { return (await cfEnvelope(path, options)).result; }

function mapStatus(result) {
  const hostStatus = String((result && result.status) || 'pending');
  const sslStatus = result && result.ssl ? String(result.ssl.status || '') : '';
  const hasErrors = (Array.isArray(result && result.verification_errors) && result.verification_errors.length > 0)
    || (result && result.ssl && Array.isArray(result.ssl.validation_errors) && result.ssl.validation_errors.length > 0);
  if (hostStatus === 'active' && sslStatus === 'active') return 'active';
  if (hasErrors || hostStatus === 'blocked' || sslStatus === 'blocked') return 'error';
  if (hostStatus === 'active') return 'pending_ssl';
  return 'pending_dns';
}

function normalize(result) {
  if (!result) return null;
  const ownership = result.ownership_verification || null;
  const ownershipHttp = result.ownership_verification_http || null;
  const validationRecords = result.ssl && Array.isArray(result.ssl.validation_records) ? result.ssl.validation_records : [];
  const validation = validationRecords[0] || null;
  const status = mapStatus(result);
  return {
    provider: 'cloudflare',
    providerId: result.id || null,
    hostname: cleanHost(result.hostname),
    status,
    verified: status === 'active',
    certificateStatus: result.ssl ? result.ssl.status || null : null,
    sslStatus: result.ssl ? result.ssl.status || null : null,
    sslMethod: result.ssl ? result.ssl.method || null : null,
    verificationErrors: result.verification_errors || [],
    sslErrors: result.ssl && result.ssl.validation_errors ? result.ssl.validation_errors.map((x) => x.message || String(x)) : [],
    ownershipHttp: ownershipHttp && ownershipHttp.http_url ? { url: ownershipHttp.http_url, body: ownershipHttp.http_body || '' } : null,
    lastCheckedAt: new Date().toISOString(),
    dns: {
      cname: { host: cleanHost(result.hostname), name: cleanHost(result.hostname), target: cnameTarget() },
      ownership: ownership && ownership.name && ownership.value
        ? { type: ownership.type || 'TXT', host: ownership.name, name: ownership.name, value: ownership.value }
        : null,
      certificate: validation ? {
        type: validation.txt_name ? 'TXT' : 'CNAME',
        host: validation.txt_name || validation.cname || null,
        name: validation.txt_name || validation.cname || null,
        value: validation.txt_value || validation.txt_record || validation.cname_target || null,
      } : null,
    },
  };
}

async function findByHostname(hostname) {
  if (!configured()) return null;
  const host = cleanHost(hostname);
  const result = await cf('/zones/' + encodeURIComponent(process.env.CLOUDFLARE_ZONE_ID) + '/custom_hostnames?hostname=' + encodeURIComponent(host));
  return Array.isArray(result) && result.length ? normalize(result[0]) : null;
}

function sslRequest(host) {
  const ssl = { method: 'http', type: 'dv', settings: { min_tls_version: '1.2' } };
  if (String(host || '').length > 64) ssl.cloudflare_branding = true;
  return ssl;
}

async function register(hostname) {
  if (!configured()) throw new Error('not_configured');
  if (!staticEdgeReady()) throw new Error('edge_not_ready');
  const host = cleanHost(hostname);
  try {
    const result = await cf('/zones/' + encodeURIComponent(process.env.CLOUDFLARE_ZONE_ID) + '/custom_hostnames', {
      method: 'POST',
      body: JSON.stringify({ hostname: host, ssl: sslRequest(host) }),
    });
    // A API pode não devolver os tokens DCV no POST. Uma leitura subsequente é
    // feita quando possível, sem transformar ausência transitória em falha.
    try {
      const fresh = await cf('/zones/' + encodeURIComponent(process.env.CLOUDFLARE_ZONE_ID) + '/custom_hostnames/' + encodeURIComponent(result.id));
      return normalize(fresh || result);
    } catch (_) { return normalize(result); }
  } catch (error) {
    if (error.message === 'duplicate') {
      const existing = await findByHostname(host);
      if (existing) return existing;
    }
    throw error;
  }
}

async function status(providerId, hostname) {
  if (!configured()) return null;
  if (!providerId) return findByHostname(hostname);
  return normalize(await cf('/zones/' + encodeURIComponent(process.env.CLOUDFLARE_ZONE_ID) + '/custom_hostnames/' + encodeURIComponent(providerId)));
}

async function remove(providerId, hostname) {
  if (!configured()) return false;
  let id = providerId;
  if (!id) {
    const existing = await findByHostname(hostname);
    id = existing && existing.providerId;
  }
  if (!id) return true;
  await cf('/zones/' + encodeURIComponent(process.env.CLOUDFLARE_ZONE_ID) + '/custom_hostnames/' + encodeURIComponent(id), { method: 'DELETE' });
  return true;
}

const revalidationAt = new Map();
const REVALIDATE_COOLDOWN_MS = 5 * 60_000;
async function retriggerValidation(providerId, hostname, options = {}) {
  if (!configured() || !providerId) return { triggered: false, reason: 'unavailable' };
  const host = cleanHost(hostname);
  const now = Number(options.nowMs) || Date.now();
  const last = revalidationAt.get(providerId) || 0;
  if (now - last < REVALIDATE_COOLDOWN_MS) return { triggered: false, reason: 'cooldown' };
  revalidationAt.set(providerId, now);
  try {
    await cf('/zones/' + encodeURIComponent(process.env.CLOUDFLARE_ZONE_ID) + '/custom_hostnames/' + encodeURIComponent(providerId), {
      method: 'PATCH',
      body: JSON.stringify({ ssl: sslRequest(host) }),
    });
    return { triggered: true };
  } catch (error) {
    // Em erro transitório libera uma nova tentativa após um intervalo menor pelo
    // reconciliador, sem loop imediato na mesma execução.
    if (error.message === 'offline' || error.message === 'rate_limit') revalidationAt.set(providerId, now - REVALIDATE_COOLDOWN_MS + 60_000);
    throw error;
  }
}

async function cnamePointsToTarget(hostname, dnsApi = dns) {
  const host = cleanHost(hostname); const target = cnameTarget();
  if (!host || !target) return false;
  try {
    const cnames = (await dnsApi.resolveCname(host)).map(cleanHost);
    if (cnames.includes(target)) return true;
  } catch (_) {}
  return false;
}

const preflight = {
  checked: false, ok: false, cause: 'not_checked', detail: null, zone: null,
  configured: false, authenticated: false, saasAvailable: false,
  edgeReady: false, fallbackReady: false, capacityAvailable: true,
  fallbackOrigin: null, cnameTarget: null, used: null, at: null,
};
let lastHealthAt = 0;
let lastCapacityErrorAt = 0;

async function fallbackStatus() {
  const result = await cf('/zones/' + encodeURIComponent(process.env.CLOUDFLARE_ZONE_ID) + '/custom_hostnames/fallback_origin');
  return result || null;
}

async function runPreflight() {
  Object.assign(preflight, {
    checked: true, ok: false, cause: null, detail: null, zone: null,
    configured: configured(), authenticated: false, saasAvailable: false,
    edgeReady: staticEdgeReady(), fallbackReady: false,
    capacityAvailable: Date.now() - lastCapacityErrorAt > 10 * 60_000,
    fallbackOrigin: fallbackOrigin(), cnameTarget: cnameTarget(), used: null,
    at: new Date().toISOString(),
  });
  lastHealthAt = Date.now();
  if (!configured()) {
    preflight.cause = 'missing_env';
    preflight.detail = 'configuração do provider incompleta';
    return Object.assign({}, preflight);
  }
  if (!preflight.edgeReady) {
    preflight.cause = 'edge_not_ready';
    preflight.detail = 'edge/fallback ainda não foi ativado';
  }
  try {
    const zone = await cf('/zones/' + encodeURIComponent(process.env.CLOUDFLARE_ZONE_ID));
    preflight.authenticated = true;
    preflight.zone = zone && zone.name || null;
  } catch (error) {
    preflight.cause = error.message === 'auth' ? 'auth' : error.message;
    preflight.detail = 'API do provider indisponível';
    return Object.assign({}, preflight);
  }

  try {
    const listEnvelope = await cfEnvelope('/zones/' + encodeURIComponent(process.env.CLOUDFLARE_ZONE_ID) + '/custom_hostnames?per_page=1&page=1');
    preflight.saasAvailable = true;
    if (listEnvelope.result_info && Number.isFinite(Number(listEnvelope.result_info.total_count))) preflight.used = Number(listEnvelope.result_info.total_count);
  } catch (error) {
    if (error.message === 'saas_unavailable') {
      preflight.cause = 'saas_unavailable'; preflight.detail = 'Cloudflare for SaaS não provisionado';
    } else if (error.message === 'capacity') {
      lastCapacityErrorAt = Date.now(); preflight.capacityAvailable = false; preflight.saasAvailable = true;
      preflight.cause = 'capacity'; preflight.detail = 'capacidade de custom hostnames esgotada';
    } else {
      preflight.cause = error.message; preflight.detail = 'não foi possível consultar custom hostnames';
    }
    return Object.assign({}, preflight);
  }

  try {
    const fb = await fallbackStatus();
    preflight.fallbackReady = !!(fb && String(fb.status || '').toLowerCase() === 'active'
      && (!fallbackOrigin() || cleanHost(fb.origin) === fallbackOrigin()));
  } catch (error) {
    preflight.fallbackReady = false;
    if (!preflight.cause) preflight.cause = 'fallback_not_ready';
  }

  if (!preflight.edgeReady) preflight.cause = preflight.cause || 'edge_not_ready';
  else if (!preflight.fallbackReady) preflight.cause = preflight.cause || 'fallback_not_ready';
  else if (!preflight.capacityAvailable) preflight.cause = preflight.cause || 'capacity';

  preflight.ok = !!(
    preflight.configured && preflight.authenticated && preflight.saasAvailable
    && preflight.edgeReady && preflight.fallbackReady && preflight.capacityAvailable
  );
  if (preflight.ok) { preflight.cause = null; preflight.detail = null; }
  return Object.assign({}, preflight);
}

async function health(options = {}) {
  const maxAge = Math.max(0, Number(options.maxAgeMs) || 60_000);
  const current = Date.now();
  if (!options.force && preflight.checked && current - lastHealthAt < maxAge) {
    return {
      enabled: preflight.ok, healthy: preflight.ok,
      configured: preflight.configured, authenticated: preflight.authenticated,
      saasAvailable: preflight.saasAvailable, edgeReady: preflight.edgeReady,
      fallbackReady: preflight.fallbackReady, capacityAvailable: preflight.capacityAvailable,
      used: preflight.used, reason: preflight.cause, detail: preflight.detail,
      zone: preflight.zone, cnameTarget: preflight.cnameTarget, fallbackOrigin: preflight.fallbackOrigin,
    };
  }
  const p = await runPreflight();
  return {
    enabled: p.ok, healthy: p.ok,
    configured: p.configured, authenticated: p.authenticated,
    saasAvailable: p.saasAvailable, edgeReady: p.edgeReady,
    fallbackReady: p.fallbackReady, capacityAvailable: p.capacityAvailable,
    used: p.used, reason: p.cause, detail: p.detail,
    zone: p.zone, cnameTarget: p.cnameTarget, fallbackOrigin: p.fallbackOrigin,
  };
}

if (configured()) {
  runPreflight().then((p) => {
    if (p.ok) console.log('[cloudflare-domains] provider SaaS pronto — novos domínios usam Cloudflare');
    else console.warn('[cloudflare-domains] provider SaaS aguardando infraestrutura (' + (p.cause || 'pending') + ')');
  }).catch((e) => console.warn('[cloudflare-domains] preflight não completou:', e.message));
} else {
  console.log('[cloudflare-domains] configuração ausente — novos domínios ficam bloqueados até Cloudflare SaaS estar pronta');
}

module.exports = {
  name: 'cloudflare',
  get preferred() { return true; },
  get configured() { return configured(); },
  get enabled() { return preflight.checked ? preflight.ok : false; },
  get preflightState() { return Object.assign({}, preflight); },
  register, status, remove, health, findByHostname, runPreflight,
  cnameTarget, fallbackOrigin, edgeOrigin, isPublicHostname, mapStatus,
  retriggerValidation, cnamePointsToTarget, sslRequest,
  _classify: classify, _normalize: normalize, _cfEnvelope: cfEnvelope,
};
