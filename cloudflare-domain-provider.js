// Cloudflare for SaaS / Custom Hostnames provider.
// Provisions arbitrary customer domains without consuming Railway custom-domain slots.
'use strict';

const API = 'https://api.cloudflare.com/client/v4';

function cleanHost(value) {
  return String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '').replace(/\.$/, '');
}

function configured() {
  return Boolean(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ZONE_ID && process.env.CLOUDFLARE_FALLBACK_ORIGIN);
}

function headers() {
  return {
    Authorization: 'Bearer ' + process.env.CLOUDFLARE_API_TOKEN,
    'Content-Type': 'application/json',
  };
}

function message(body, fallback) {
  const errors = body && Array.isArray(body.errors) ? body.errors : [];
  return errors.map((e) => e.message || e.code).filter(Boolean).join('; ') || fallback;
}

function classify(status, text) {
  const s = String(text || '').toLowerCase();
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'limite';
  if (status >= 500) return 'offline';
  if (s.includes('already exists') || s.includes('already been added')) return 'duplicado';
  return 'falha';
}

async function cf(path, options) {
  let res;
  try {
    res = await fetch(API + path, Object.assign({ headers: headers(), signal: AbortSignal.timeout(15000) }, options || {}));
  } catch (error) {
    const e = new Error('offline');
    e.detail = error.message;
    throw e;
  }
  let body = null;
  try { body = await res.json(); } catch (_) { /* response may be empty */ }
  if (!res.ok || !body || body.success !== true) {
    const detail = message(body, 'Cloudflare HTTP ' + res.status);
    const e = new Error(classify(res.status, detail));
    e.detail = detail;
    e.status = res.status;
    throw e;
  }
  return body.result;
}

function normalize(result) {
  if (!result) return null;
  const ownership = result.ownership_verification || null;
  const validation = result.ssl && Array.isArray(result.ssl.validation_records) ? result.ssl.validation_records[0] : null;
  return {
    provider: 'cloudflare',
    providerId: result.id,
    hostname: cleanHost(result.hostname),
    status: result.status || 'pending',
    verified: result.status === 'active' && result.ssl && result.ssl.status === 'active',
    certificateStatus: result.ssl ? result.ssl.status : null,
    verificationErrors: result.verification_errors || [],
    sslErrors: result.ssl && result.ssl.validation_errors ? result.ssl.validation_errors.map((x) => x.message || String(x)) : [],
    dns: {
      cname: { name: cleanHost(result.hostname), target: cleanHost(process.env.CLOUDFLARE_FALLBACK_ORIGIN) },
      ownership: ownership && ownership.name && ownership.value
        ? { type: ownership.type || 'TXT', name: ownership.name, value: ownership.value }
        : null,
      certificate: validation
        ? { type: validation.txt_name ? 'TXT' : 'CNAME', name: validation.txt_name || validation.cname, value: validation.txt_value || validation.cname_target }
        : null,
    },
  };
}

async function findByHostname(hostname) {
  const host = cleanHost(hostname);
  const zone = process.env.CLOUDFLARE_ZONE_ID;
  const result = await cf('/zones/' + encodeURIComponent(zone) + '/custom_hostnames?hostname=' + encodeURIComponent(host));
  return Array.isArray(result) && result.length ? normalize(result[0]) : null;
}

async function register(hostname) {
  if (!configured()) throw new Error('desativado');
  const host = cleanHost(hostname);
  try {
    const result = await cf('/zones/' + encodeURIComponent(process.env.CLOUDFLARE_ZONE_ID) + '/custom_hostnames', {
      method: 'POST',
      body: JSON.stringify({
        hostname: host,
        ssl: { method: 'http', type: 'dv', settings: { min_tls_version: '1.2' } },
        custom_metadata: { source: 'roi-nados' },
      }),
    });
    return normalize(result);
  } catch (error) {
    if (error.message === 'duplicado') {
      const existing = await findByHostname(host);
      if (existing) return existing;
    }
    throw error;
  }
}

async function status(providerId, hostname) {
  if (!configured()) return null;
  if (!providerId) return findByHostname(hostname);
  const result = await cf('/zones/' + encodeURIComponent(process.env.CLOUDFLARE_ZONE_ID) + '/custom_hostnames/' + encodeURIComponent(providerId));
  return normalize(result);
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

async function health() {
  if (!configured()) return { enabled: false, reason: 'missing_env' };
  const zone = await cf('/zones/' + encodeURIComponent(process.env.CLOUDFLARE_ZONE_ID));
  return { enabled: true, zone: zone.name, fallbackOrigin: cleanHost(process.env.CLOUDFLARE_FALLBACK_ORIGIN) };
}

module.exports = {
  name: 'cloudflare',
  get enabled() { return configured(); },
  register,
  status,
  remove,
  health,
  findByHostname,
};
