'use strict';

// Background reconciler for custom domains. It makes provisioning autonomous:
// provider -> DNS -> TLS -> signed app marker, with bounded retry/backoff.
const dns = require('dns').promises;
const config = require('./config');
const railway = require('./domain-provider');
const cloudflare = require('./cloudflare-domain-provider');
const security = require('./domain-security');

let timer = null;
let firstTimer = null;
let running = false;
let lastRunAt = null;
let lastResult = null;
let lastError = null;

function provider() { return cloudflare; }
function providerForDomain(domain) {
  const tagged = String(domain && domain.provider || '').toLowerCase();
  if (tagged === 'cloudflare') return cloudflare;
  if (tagged === 'railway') return railway;
  // Registros legados com providerId foram criados pelo provider Railway antes
  // de o campo `provider` existir. Sem providerId, usa o provider preferencial.
  if (domain && domain.providerId) return railway;
  return provider();
}
function iso(ms) { return new Date(ms).toISOString(); }
function backoffMs(retries) {
  const n = Math.max(0, Math.min(8, Number(retries) || 0));
  return Math.min(15 * 60_000, 30_000 * Math.pow(2, n));
}

async function resolve4Safe(host, sec) {
  try { return (await (sec || security).resolvePublicHost(host)).filter((a) => a.family === 4).map((a) => a.address); }
  catch (_) { return []; }
}

async function inspectDomain(accountId, original, deps = {}) {
  let domain = Object.assign({}, original);
  const host = domain.host;
  const p = deps.provider || providerForDomain(domain);
  const sec = deps.security || security;
  const dnsApi = deps.dns || dns;
  const hadProviderId = !!domain.providerId;
  let providerState = null;
  let providerError = null;

  // Adopt/recreate a missing provider binding automatically. This is best-effort
  // and never erases the local domain when the external provider is unavailable.
  if (p.enabled && (!domain.providerId || (p.name && domain.provider !== p.name))) {
    try {
      const reg = await p.register(host);
      if (reg && reg.providerId) {
        domain.providerId = reg.providerId;
        domain.provider = reg.provider || p.name || domain.provider || null;
        if (reg.dns) domain.dns = reg.dns;
        if (reg.status) domain.status = reg.status;
        domain.providerNote = null;
      }
    } catch (err) {
      providerError = String(err && err.message || 'provider_error').slice(0, 160);
    }
  }

  if (p.enabled && domain.providerId && (!domain.provider || domain.provider === p.name)) {
    try {
      providerState = await p.status(domain.providerId, host);
      if (providerState) {
        if (providerState.dns) domain.dns = providerState.dns;
        domain.provider = providerState.provider || p.name || domain.provider || null;
      } else if (hadProviderId) {
        // O recurso remoto pode ter sido removido fora do app. Re-adota sem
        // apagar o domínio local, tornando a reconciliação auto-reparável.
        const reg = await p.register(host);
        if (reg && reg.providerId) {
          domain.providerId = reg.providerId;
          domain.provider = reg.provider || p.name || domain.provider || null;
          if (reg.dns) domain.dns = reg.dns;
          if (reg.status) domain.status = reg.status;
          domain.providerNote = null;
          providerState = await p.status(domain.providerId, host).catch(() => null);
        }
      }
    } catch (err) {
      providerError = String(err && err.message || 'provider_status_error').slice(0, 160);
    }
  }

  const targets = new Set();
  const configuredTarget = domain.dns && domain.dns.cname && domain.dns.cname.target
    ? String(domain.dns.cname.target).toLowerCase().replace(/\.$/, '') : '';
  if (configuredTarget) targets.add(configuredTarget);
  if (p.name === 'cloudflare') {
    try { const t = String(cloudflare.cnameTarget() || '').toLowerCase().replace(/\.$/, ''); if (t) targets.add(t); } catch (_) {}
  } else if (process.env.PUBLIC_APP_HOST) {
    // Compatibilidade exclusiva de domínios Railway legados. Novos domínios
    // Cloudflare nunca validam apontando direto para a origem Railway.
    targets.add(String(process.env.PUBLIC_APP_HOST).toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, ''));
  }

  let cnames = [];
  try { cnames = (await dnsApi.resolveCname(host)).map((x) => x.toLowerCase().replace(/\.$/, '')); } catch (_) {}
  const targetList = Array.from(targets).filter(Boolean);
  let dnsOk = cnames.some((c) => targets.has(c));
  let providerVerified = !!(providerState && providerState.verified);

  if (!dnsOk && targetList.length) {
    const [hostIps, targetIpGroups] = await Promise.all([
      resolve4Safe(host, sec),
      Promise.all(targetList.map((t) => resolve4Safe(t, sec))),
    ]);
    const targetIps = new Set(targetIpGroups.flat());
    dnsOk = hostIps.some((ip) => targetIps.has(ip));
  }
  if (!dnsOk && providerVerified) dnsOk = true;

  // HTTP DCV pode ter entrado em backoff antes de o cliente criar o CNAME.
  // Quando o CNAME finalmente aponta ao target SaaS, reinicia a validação uma
  // única vez por janela de cooldown e atualiza o estado do provider.
  if (dnsOk && p.name === 'cloudflare' && domain.providerId && providerState && providerState.status === 'pending_dns'
      && typeof p.retriggerValidation === 'function') {
    try {
      const retriggered = await p.retriggerValidation(domain.providerId, host);
      if (retriggered && retriggered.triggered) {
        providerState = await p.status(domain.providerId, host).catch(() => providerState);
        providerVerified = !!(providerState && providerState.verified);
        if (providerState && providerState.dns) domain.dns = providerState.dns;
      }
    } catch (_) { /* best-effort; retry normal do reconciliador */ }
  }

  let tls = { ok: false, error: 'dns_pending' };
  let marker = { ok: false, error: 'dns_pending' };
  if (dnsOk) {
    try { tls = await sec.tlsProbe(host, { timeoutMs: 7000 }); }
    catch (err) { tls = { ok: false, error: err.code || err.message }; }
    try {
      const r = await sec.httpsProbe(host, '/__domain-check', { timeoutMs: 7000, maxBytes: 8192 });
      const j = r.status === 200 ? JSON.parse(r.body || '{}') : null;
      marker = {
        ok: !!(j && j.app === sec.APP_CHECK_ID && sec.verifyDomainProof(host, accountId, j.proof)),
        status: r.status,
      };
    } catch (err) { marker = { ok: false, error: err.code || err.message }; }
  }

  const providerReady = p.name !== 'cloudflare' || !!(providerState && providerState.status === 'active' && providerState.verified);
  const healthy = !!(dnsOk && providerReady && tls.ok && marker.ok);
  const now = Date.now();
  const wasActive = domain.verificado === true && domain.status === 'active';
  const providerStatus = providerState && providerState.status;
  const explicitProviderError = providerStatus === 'error';
  const prevRetries = Math.max(0, Number(domain.retryCount) || 0);
  const retryCount = healthy ? 0 : Math.min(20, prevRetries + 1);
  let status;
  if (healthy) status = 'active';
  else if (wasActive && !explicitProviderError && retryCount < 3) status = 'active';
  else if (explicitProviderError) status = 'error';
  else status = dnsOk ? 'pending_ssl' : 'pending_dns';

  const reasons = [];
  if (providerError) reasons.push('provider: ' + providerError);
  if (!dnsOk) reasons.push('DNS pendente');
  else if (!providerReady) reasons.push('validação/SSL pendente');
  else if (!tls.ok) reasons.push('TLS pendente');
  else if (!marker.ok) reasons.push('roteamento HTTPS pendente');
  const nextDelay = healthy ? 6 * 60 * 60_000 : backoffMs(retryCount);
  if ((original.status || 'pending_dns') !== status) {
    console.log('[domain-reconciler] ' + host + ': ' + (original.status || 'pending_dns') + ' -> ' + status);
  }

  return Object.assign({}, domain, {
    verificado: healthy || (status === 'active' && wasActive),
    verificadoEm: healthy ? (domain.verificadoEm || iso(now)) : domain.verificadoEm || null,
    status,
    sslStatus: providerState && (providerState.sslStatus || providerState.certificateStatus) || (tls.ok ? 'active' : domain.sslStatus || null),
    lastCheckedAt: iso(now),
    lastError: healthy ? null : (reasons.join(' · ') || null),
    retryCount,
    nextCheckAt: iso(now + nextDelay),
    dns: domain.dns || null,
    providerId: domain.providerId || null,
    provider: domain.provider || null,
    providerNote: healthy ? null : domain.providerNote || null,
  });
}

async function reconcileOne(accountId, domain) {
  const updated = await inspectDomain(accountId, domain);
  await config.setDurable(accountId, (latest) => ({
    customDomains: (latest.customDomains || []).map((d) => d.host === updated.host ? updated : d),
  }));
  return updated;
}

function due(domain, now) {
  if (!domain || !domain.host) return false;
  const next = domain.nextCheckAt ? Date.parse(domain.nextCheckAt) : 0;
  if (!next) return true;
  return next <= now;
}

async function runOnce(options = {}) {
  if (running) return { skipped: true };
  running = true;
  const max = Math.max(1, Math.min(25, Number(options.max) || 8));
  let checked = 0; let failed = 0;
  try {
    const now = Date.now();
    outer: for (const accountId of config.accountIds()) {
      const domains = config.get(accountId).customDomains || [];
      for (const d of domains) {
        if (checked >= max) break outer;
        if (!due(d, now)) continue;
        checked++;
        try { await reconcileOne(accountId, d); }
        catch (err) { failed++; console.warn('[domain-reconciler] ' + d.host + ':', err && err.message); }
      }
    }
    lastRunAt = new Date().toISOString();
    lastResult = { checked, failed };
    lastError = null;
    return lastResult;
  } catch (err) {
    lastRunAt = new Date().toISOString();
    lastError = String(err && err.message || 'reconcile_error').slice(0, 160);
    lastResult = { checked, failed: failed + 1 };
    throw err;
  } finally { running = false; }
}

function start() {
  if (timer) return timer;
  // Small initial delay lets provider preflight settle after boot.
  firstTimer = setTimeout(() => { firstTimer = null; runOnce({ max: 5 }).catch(() => {}); }, 15_000);
  if (firstTimer.unref) firstTimer.unref();
  timer = setInterval(() => { runOnce({ max: 8 }).catch(() => {}); }, 90_000);
  if (timer.unref) timer.unref();
  return timer;
}

function stop() {
  if (timer) clearInterval(timer);
  if (firstTimer) clearTimeout(firstTimer);
  timer = null;
  firstTimer = null;
}

function health() {
  const failed = lastResult ? Number(lastResult.failed) || 0 : 0;
  return {
    status: lastError ? 'degraded' : (lastRunAt ? (failed > 0 ? 'degraded' : 'healthy') : 'warming'),
    running,
    started: !!timer,
    initialCheckPending: !!firstTimer,
    lastRunAt,
    lastResult,
    lastError,
    intervalMs: 90_000,
  };
}

module.exports = { start, stop, runOnce, reconcileOne, inspectDomain, backoffMs, health };
