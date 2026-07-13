// Cloudflare for SaaS / Custom Hostnames provider.
// Provisions arbitrary customer domains without consuming Railway custom-domain slots.
//
// ARQUITETURA (correção definitiva — ver plano de domínios):
//   - CLOUDFLARE_FALLBACK_ORIGIN  = origem Railway PÚBLICA (ex.: app-production.up.railway.app).
//     Registrada na zona via API como fallback origin. NUNCA aparece nas instruções DNS.
//   - CLOUDFLARE_CNAME_TARGET     = Managed CNAME target público (ex.: domains.roi-nados.top).
//     É o alvo que o LOJISTA aponta no CNAME dele. Sem ele, operamos em modo degradado
//     (instruções usam o fallback origin) com aviso claro no diagnóstico.
//   - Preflight rígido no boot: token autentica + origem é pública + origem responde
//     /__domain-check. Qualquer falha → enabled=false com causa exata, e o app cai
//     para o provider legado (Railway) sem quebrar nada.
//
// SEGURANÇA: o token é lido só de process.env, nunca logado nem devolvido em erro.
'use strict';

const API = 'https://api.cloudflare.com/client/v4';

function cleanHost(value) {
  return String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, '');
}

// Hostname público válido para servir de origem/alvo? Rejeita hosts internos
// (railway.internal, .local, localhost), IPs privados e valores vazios.
function isPublicHostname(value) {
  const host = cleanHost(value);
  if (!host || !host.includes('.')) return false;
  if (/\.(railway\.internal|internal|local|localhost)$/.test(host) || host === 'localhost') return false;
  // IP literal? rejeita faixas privadas/loopback/link-local
  const ip = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ip) {
    const [a, b] = [Number(ip[1]), Number(ip[2])];
    if (a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || a === 0) return false;
  }
  return true;
}

function configured() {
  return Boolean(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ZONE_ID && process.env.CLOUDFLARE_FALLBACK_ORIGIN);
}

// Alvo do CNAME mostrado ao lojista. Preferência: CLOUDFLARE_CNAME_TARGET
// (Managed CNAME target). Fallback degradado: a própria origem (funciona só
// se a Cloudflare estiver na frente — o diagnóstico avisa).
function cnameTarget() {
  const t = cleanHost(process.env.CLOUDFLARE_CNAME_TARGET);
  return t || cleanHost(process.env.CLOUDFLARE_FALLBACK_ORIGIN);
}

function degradedMode() {
  return !cleanHost(process.env.CLOUDFLARE_CNAME_TARGET);
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

// ── Estados de provisionamento ───────────────────────────────────────────────
// Mapeia a resposta da Cloudflare para um estado único e explícito:
//   pending_dns  → hostname ainda não verificado (CNAME não chegou / posse pendente)
//   pending_ssl  → posse ok, certificado em emissão/validação
//   active       → hostname E certificado ativos (tráfego servido com TLS válido)
//   error        → erro de verificação/validação reportado pela Cloudflare
function mapStatus(result) {
  const hostStatus = String(result.status || 'pending');
  const sslStatus = result.ssl ? String(result.ssl.status || '') : '';
  const hasErrors = (Array.isArray(result.verification_errors) && result.verification_errors.length > 0)
    || (result.ssl && Array.isArray(result.ssl.validation_errors) && result.ssl.validation_errors.length > 0);
  if (hostStatus === 'active' && sslStatus === 'active') return 'active';
  if (hasErrors) return 'error';
  if (hostStatus === 'active') return 'pending_ssl';
  return 'pending_dns';
}

function normalize(result) {
  if (!result) return null;
  const ownership = result.ownership_verification || null;
  const validation = result.ssl && Array.isArray(result.ssl.validation_records) ? result.ssl.validation_records[0] : null;
  const status = mapStatus(result);
  return {
    provider: 'cloudflare',
    providerId: result.id,
    hostname: cleanHost(result.hostname),
    status,
    verified: status === 'active',
    certificateStatus: result.ssl ? result.ssl.status : null,
    sslStatus: result.ssl ? result.ssl.status : null,
    verificationErrors: result.verification_errors || [],
    sslErrors: result.ssl && result.ssl.validation_errors ? result.ssl.validation_errors.map((x) => x.message || String(x)) : [],
    lastCheckedAt: new Date().toISOString(),
    dns: {
      // O lojista aponta para o Managed CNAME target — NUNCA para a origem Railway.
      cname: { name: cleanHost(result.hostname), target: cnameTarget() },
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

// ── Fallback origin da zona (idempotente) ────────────────────────────────────
// A zona precisa saber para ONDE mandar o tráfego dos custom hostnames. Sem
// isso, os hostnames ficam 404. GET → compara → PUT só se divergir.
async function ensureFallbackOrigin() {
  const zone = process.env.CLOUDFLARE_ZONE_ID;
  const want = cleanHost(process.env.CLOUDFLARE_FALLBACK_ORIGIN);
  let current = null;
  try {
    current = await cf('/zones/' + encodeURIComponent(zone) + '/custom_hostnames/fallback_origin');
  } catch (e) {
    // 404 = nunca configurado; qualquer outro erro propaga
    if (e.status !== 404) throw e;
  }
  const currentOrigin = current ? cleanHost(current.origin) : '';
  if (currentOrigin === want && current && current.status === 'active') {
    return { origin: want, status: 'active', changed: false };
  }
  const updated = await cf('/zones/' + encodeURIComponent(zone) + '/custom_hostnames/fallback_origin', {
    method: 'PUT',
    body: JSON.stringify({ origin: want }),
  });
  return { origin: cleanHost(updated.origin), status: updated.status || 'pending_deployment', changed: true };
}

// ── Preflight rígido ─────────────────────────────────────────────────────────
// enabled=true SÓ se: (a) token autentica na zona, (b) fallback origin é
// hostname público, (c) a origem responde 200 no /__domain-check.
// Falha → causa exata registrada + provider desabilitado (cai para o legado).
const preflight = {
  checked: false,     // já rodou?
  ok: false,          // passou?
  cause: null,        // 'missing_env' | 'auth' | 'origem privada' | 'origem offline' | 'offline'
  detail: null,       // texto legível (sem segredos)
  zone: null,         // nome da zona autenticada
  fallbackOrigin: null,     // { origin, status, changed }
  cnameTarget: null,
  degraded: false,    // sem CLOUDFLARE_CNAME_TARGET
  at: null,
};

async function runPreflight() {
  preflight.checked = true;
  preflight.at = new Date().toISOString();
  preflight.cnameTarget = cnameTarget();
  preflight.degraded = degradedMode();

  if (!configured()) {
    preflight.ok = false; preflight.cause = 'missing_env';
    preflight.detail = 'faltam CLOUDFLARE_API_TOKEN / CLOUDFLARE_ZONE_ID / CLOUDFLARE_FALLBACK_ORIGIN';
    return preflight;
  }
  // (b) origem pública — checagem estática, primeiro (não gasta rede)
  if (!isPublicHostname(process.env.CLOUDFLARE_FALLBACK_ORIGIN)) {
    preflight.ok = false; preflight.cause = 'origem privada';
    preflight.detail = 'CLOUDFLARE_FALLBACK_ORIGIN não é um hostname público (hosts *.railway.internal / IPs privados não são alcançáveis pela Cloudflare)';
    return preflight;
  }
  // (a) token autentica na zona
  try {
    const zone = await cf('/zones/' + encodeURIComponent(process.env.CLOUDFLARE_ZONE_ID));
    preflight.zone = zone.name || null;
  } catch (e) {
    preflight.ok = false;
    preflight.cause = e.message === 'auth' ? 'auth' : 'offline';
    preflight.detail = e.message === 'auth'
      ? 'CLOUDFLARE_API_TOKEN rejeitado — gere um token com "SSL and Certificates: Edit" + "Zone: Read" na zona'
      : 'API da Cloudflare inacessível agora (' + (e.detail || e.message) + ')';
    return preflight;
  }
  // (c) origem responde o marcador deste app
  try {
    const origin = cleanHost(process.env.CLOUDFLARE_FALLBACK_ORIGIN);
    const r = await fetch('https://' + origin + '/__domain-check', { redirect: 'manual', signal: AbortSignal.timeout(10000) });
    if (r.status !== 200) {
      preflight.ok = false; preflight.cause = 'origem offline';
      preflight.detail = 'a origem ' + origin + ' respondeu HTTP ' + r.status + ' no /__domain-check';
      return preflight;
    }
  } catch (e) {
    preflight.ok = false; preflight.cause = 'origem offline';
    preflight.detail = 'a origem não respondeu o /__domain-check (' + (e.name === 'TimeoutError' ? 'timeout' : e.message) + ')';
    return preflight;
  }
  // Fallback origin da zona — idempotente; falha aqui NÃO desabilita o provider
  // (registro de hostname ainda funciona), mas fica visível no diagnóstico.
  try {
    preflight.fallbackOrigin = await ensureFallbackOrigin();
  } catch (e) {
    preflight.fallbackOrigin = { error: e.message, detail: e.detail || null };
  }
  preflight.ok = true;
  preflight.cause = null;
  preflight.detail = preflight.degraded
    ? 'operacional em modo degradado — defina CLOUDFLARE_CNAME_TARGET (ex.: domains.' + (preflight.zone || 'sua-zona') + ') para instruções DNS corretas'
    : null;
  return preflight;
}

// health() — visão consolidada para diagnóstico (roda o preflight na hora).
async function health() {
  if (!configured()) return { enabled: false, reason: 'missing_env' };
  const p = await runPreflight();
  return {
    enabled: p.ok,
    reason: p.cause,
    detail: p.detail,
    zone: p.zone,
    fallbackOrigin: cleanHost(process.env.CLOUDFLARE_FALLBACK_ORIGIN),
    fallbackOriginZoneStatus: p.fallbackOrigin,
    cnameTarget: p.cnameTarget,
    degraded: p.degraded,
  };
}

// Preflight no boot — não bloqueia; loga a causa exata. Sem rede no boot, a
// próxima chamada de health()/verificação re-roda o preflight.
if (configured()) {
  runPreflight().then((p) => {
    if (p.ok) {
      console.log('[cloudflare-domains] preflight OK — zona "' + p.zone + '"' +
        (p.degraded ? ' (MODO DEGRADADO: defina CLOUDFLARE_CNAME_TARGET)' : '') +
        (p.fallbackOrigin && p.fallbackOrigin.changed ? ' — fallback origin atualizado na zona' : ''));
    } else {
      console.warn('[cloudflare-domains] preflight FALHOU (' + p.cause + '): ' + p.detail + ' — usando provider legado');
    }
  }).catch((e) => {
    console.warn('[cloudflare-domains] preflight não completou (' + e.message + ') — re-tenta na próxima verificação');
  });
} else {
  console.log('[cloudflare-domains] variáveis ausentes — provider desativado (modo legado/manual)');
}

module.exports = {
  name: 'cloudflare',
  // enabled reflete configuração + resultado do preflight. Antes do preflight
  // rodar (boot), considera habilitado se a checagem estática passa — o
  // preflight assíncrono derruba para false se token/origem falharem.
  get enabled() {
    if (!configured()) return false;
    if (!isPublicHostname(process.env.CLOUDFLARE_FALLBACK_ORIGIN)) return false;
    return preflight.checked ? preflight.ok : true;
  },
  get preflightState() { return Object.assign({}, preflight); },
  register,
  status,
  remove,
  health,
  findByHostname,
  runPreflight,
  ensureFallbackOrigin,
  cnameTarget,
  isPublicHostname,
};
