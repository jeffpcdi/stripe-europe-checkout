'use strict';

function cleanHost(value) {
  return String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '').replace(/\.$/, '');
}

function primarySaasDomain() {
  return cleanHost(process.env.PRIMARY_SAAS_DOMAIN || 'roi-nados.top');
}

function exactProtectedHosts() {
  return new Set([
    primarySaasDomain(),
    process.env.PRIMARY_HOST,
    process.env.RAILWAY_PUBLIC_DOMAIN,
    process.env.RAILWAY_STATIC_URL,
    process.env.CLOUDFLARE_CNAME_TARGET,
    process.env.CLOUDFLARE_FALLBACK_ORIGIN,
    process.env.EDGE_ORIGIN_HOST,
  ].map(cleanHost).filter(Boolean));
}

function isProtectedSaasHost(value) {
  const host = cleanHost(value);
  if (!host) return false;
  const root = primarySaasDomain();
  if (root && (host === root || host.endsWith('.' + root))) return true;
  return exactProtectedHosts().has(host);
}

module.exports = { cleanHost, primarySaasDomain, exactProtectedHosts, isProtectedSaasHost };
