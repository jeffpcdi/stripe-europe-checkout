'use strict';

const { isDatacenterAsn } = require('./cloak-network-risk');

const POLICY_VERSION = 'v6-shadow-1';
const DECISIONS = Object.freeze({ PRIMARY: 'PRIMARY', SAFE: 'SAFE', CHALLENGE: 'CHALLENGE' });

const EXPLICIT_AUTOMATION_UA = [
  /HeadlessChrome/i, /\bPhantomJS\//i, /wkhtmlto/i, /Prerender/i,
  /node-fetch/i, /python-requests/i, /Go-http-client/i, /NetcraftSurveyAgent/i,
  /zgrab/i, /masscan/i,
];

function clamp(n, min, max, fallback) {
  const value = Number(n);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

function normalizedPolicy(input) {
  const p = input && typeof input === 'object' ? input : {};
  const sensitivity = ['strict', 'balanced', 'loose', 'custom'].includes(p.sensitivity) ? p.sensitivity : 'balanced';
  const preset = sensitivity === 'strict' ? 30 : sensitivity === 'loose' ? 55 : 40;
  const threshold = sensitivity === 'custom'
    ? clamp(p.threshold, 10, 90, 40)
    : preset;
  return {
    threshold,
    mobileOnly: p.mobileOnly === true,
    paises: Array.isArray(p.paises) ? p.paises.map((x) => String(x).toUpperCase()).filter(Boolean) : [],
    idiomas: Array.isArray(p.idiomas) ? p.idiomas.map((x) => String(x).toLowerCase()).filter(Boolean) : [],
    blockDatacenter: p.blockDatacenter !== false,
    blockHeadless: p.blockHeadless !== false,
    checkHeaders: p.checkHeaders !== false,
    requireJsChallenge: p.requireJsChallenge !== false,
    checkWebgl: p.checkWebgl !== false,
    checkBehavior: p.checkBehavior !== false,
    checkCoherence: p.checkCoherence !== false,
    checkEntropy: p.checkEntropy !== false,
  };
}

function primaryLanguage(headers) {
  return String((headers && headers['accept-language']) || '')
    .split(',')[0].split('-')[0].trim().toLowerCase();
}

function browserSignalScore(input, reasons) {
  const b = input && typeof input === 'object' ? input : {};
  let score = 0;
  const age = Number(b.challengeAgeMs);
  const fresh = Number.isFinite(age) && age >= 0 && age <= 15 * 60 * 1000;

  if (b.challenge === 'ok' && fresh) { score -= 22; reasons.push('js:fresh-ok'); }
  else if (b.challenge === 'fail') { score += 22; reasons.push('js:fail'); }
  else if (b.challenge === 'ok' && !fresh) { score += 6; reasons.push('js:stale'); }
  else { score += 8; reasons.push('js:missing'); }

  const webgl = String(b.webgl || '');
  if (/SwiftShader|llvmpipe|Mesa|VMware|VirtualBox/i.test(webgl)) {
    score += 48; reasons.push('webgl:software');
  }

  const beh = Number(b.beh);
  if (Number.isFinite(beh)) {
    if (beh <= 0) { score += 12; reasons.push('behavior:none'); }
    else if (beh >= 45) { score -= 8; reasons.push('behavior:interactive'); }
  }
  if (Number(b.nt) === 1) { score += 20; reasons.push('entropy:no-trail'); }
  const ent = Number(b.ent);
  if (Number.isFinite(ent) && ent >= 40) { score -= 7; reasons.push('entropy:human'); }
  return score;
}

function decide(input = {}) {
  const started = Date.now();
  const policy = normalizedPolicy(input.policy);
  const request = input.request || {};
  const network = input.network || {};
  const state = input.state || {};
  const browser = input.browser || {};
  const headers = request.headers || {};
  const ua = String(request.ua || headers['user-agent'] || '');
  const reasons = [];
  let score = 0;
  let policyNeedsChallenge = false;

  // Estado já confirmado por camadas externas é determinístico.
  if (state.denied === true) {
    return finish(DECISIONS.SAFE, 100, ['state:denylist'], 'high', started);
  }
  if (state.sticky === true) {
    return finish(DECISIONS.SAFE, 100, ['state:sticky'], 'high', started);
  }
  if (state.knownBot === true) {
    return finish(DECISIONS.SAFE, 100, ['ua:known-bot'], 'high', started);
  }

  // Regras explícitas de acesso continuam sendo política, não "detecção de bot".
  if (policy.mobileOnly && request.isMobile === false) {
    return finish(DECISIONS.SAFE, 100, ['policy:mobile-only'], 'high', started);
  }
  if (policy.paises.length) {
    if (network.networkVerified && network.country) {
      if (!policy.paises.includes(String(network.country).toUpperCase())) {
        return finish(DECISIONS.SAFE, 100, ['policy:country'], 'high', started);
      }
    } else {
      score += 14; reasons.push('network:country-unverified');
      policyNeedsChallenge = true;
    }
  }
  const lang = String(request.language || primaryLanguage(headers));
  if (policy.idiomas.length) {
    if (lang) {
      if (!policy.idiomas.includes(lang)) return finish(DECISIONS.SAFE, 100, ['policy:language'], 'high', started);
    } else {
      score += 12; reasons.push('request:language-missing');
      policyNeedsChallenge = true;
    }
  }

  // Rede: ASN só é considerado quando veio no envelope Edge V2 assinado.
  if (network.networkVerified) {
    reasons.push('edge:verified');
    score -= 4;
    if (policy.blockDatacenter && isDatacenterAsn(network.asn)) {
      score += 40; reasons.push('asn:datacenter');
    } else if (Number(network.asn) > 0) {
      score -= 5; reasons.push('asn:network');
    }
  } else {
    reasons.push('edge:network-unverified');
  }

  // Request HTTP — apenas sinais genéricos de automação/coerência.
  if (!ua || ua.length < 15) { score += 55; reasons.push('ua:missing'); }
  else if (policy.blockHeadless && EXPLICIT_AUTOMATION_UA.some((re) => re.test(ua))) {
    score += 55; reasons.push('ua:automation');
  }

  if (policy.checkHeaders) {
    if (!headers.accept) { score += 18; reasons.push('headers:accept-missing'); }
    else if (!/text\/html/i.test(String(headers.accept))) { score += 12; reasons.push('headers:no-html'); }
    if (!headers['accept-language']) { score += 16; reasons.push('headers:language-missing'); }

    const secFetch = ['sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest'].filter((h) => headers[h]).length;
    if (secFetch === 0 && ua.length > 20) { score += 14; reasons.push('sec-fetch:missing'); }
    else if (secFetch >= 2) { score -= 8; reasons.push('sec-fetch:present'); }

    const chMobile = String(headers['sec-ch-ua-mobile'] || '');
    if (chMobile === '?0' || chMobile === '?1') {
      const declaredMobile = chMobile === '?1';
      if (typeof request.isMobile === 'boolean' && declaredMobile !== request.isMobile) {
        score += 18; reasons.push('ch:mobile-mismatch');
      }
    }
  }

  // Velocity deixa de ser bloqueio binário no V6: sobe risco e leva o caso
  // ambíguo a CHALLENGE; padrões muito acima do limite podem chegar a SAFE.
  const velocity = Number(state.velocityCount) || 0;
  const velocityLimit = Math.max(1, Number(state.velocityLimit) || 12);
  if (velocity > velocityLimit) {
    const ratio = velocity / velocityLimit;
    score += ratio >= 2 ? 42 : 24;
    reasons.push(ratio >= 2 ? 'velocity:burst-strong' : 'velocity:burst');
  }

  if (state.engineError === true) {
    score += 18; reasons.push('engine:legacy-error');
  }

  if (policy.requireJsChallenge || policy.checkWebgl || policy.checkBehavior || policy.checkEntropy) {
    score += browserSignalScore(browser, reasons);
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const safeThreshold = Math.min(95, policy.threshold + 15);
  const challengeThreshold = Math.max(12, policy.threshold - 10);

  if (score >= safeThreshold) {
    return finish(DECISIONS.SAFE, score, reasons, score >= safeThreshold + 15 ? 'high' : 'medium', started, policy);
  }
  if (policyNeedsChallenge) {
    return finish(DECISIONS.CHALLENGE, score, reasons, 'medium', started, policy);
  }
  if (score >= challengeThreshold) {
    return finish(DECISIONS.CHALLENGE, score, reasons, 'medium', started, policy);
  }
  return finish(DECISIONS.PRIMARY, score, reasons, score <= Math.max(5, challengeThreshold - 10) ? 'high' : 'medium', started, policy);
}

function finish(decision, score, reasons, confidence, started, policy) {
  const p = policy || { threshold: 40 };
  return {
    decision,
    score,
    confidence,
    reasons: Array.from(new Set(reasons || [])).slice(0, 12),
    threshold: p.threshold,
    policyVersion: POLICY_VERSION,
    resolvedAt: Math.max(0, Date.now() - started),
  };
}

module.exports = { DECISIONS, POLICY_VERSION, normalizedPolicy, decide };
