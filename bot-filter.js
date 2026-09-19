'use strict';
// ── Proteção genérica contra bots e automação ──────────────────────────────
// Correlaciona sinais técnicos do navegador/rede (headless, datacenter,
// inconsistências de Client Hints, WebGL, timezone, coerência e comportamento).
// Nenhum sinal depende de identificar revisores ou infraestrutura de uma
// plataforma de anúncios específica.
//
// RESULTADO: cada visita retorna { verdict:'real'|'bot', score:0-100, signals[] }

const dns  = require('dns').promises;
const crypto = require('crypto');
const uaTools = require('./ua'); // parsing genérico de browser/device e crawlers
const { DATACENTER_ASNS } = require('./cloak-network-risk');
// Redis é opcional: cache de ASN entre processos/restarts. Degrada para o Map
// em memória se o módulo/serviço não estiver disponível.
let _redis = null;
try { _redis = require('./redis'); } catch (_) { _redis = null; }

// ─── 1. ASNs de datacenter / hosting / automação ──────────────────────────
// A lista genérica vive em cloak-network-risk.js e é compartilhada com o V6,
// preservando exatamente o mesmo contrato do motor legado.

// ─── 2. Sinais de request HTTP ──────────────────────────────────────────────
const REQUIRED_BROWSER_HEADERS = ['accept', 'accept-language'];
const SEC_FETCH_HEADERS         = ['sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest'];
const TRUST_HEADERS             = ['sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform'];

// UAs de automação não cobertos pelo ua.js principal
const HEADLESS_UA_RE = [
  /HeadlessChrome/i,
  /\bElectron\//i,
  /\bPhantomJS\//i,
  /wkhtmlto/i,
  /Prerender/i,
  /node-fetch/i,
  /python-requests/i,
  /Go-http-client/i,
  /Dalvik\/\d/i,     // Android WebView automatizado (não tem browser real)
  /CFNetwork\/\d/,   // iOS URLSession puro (sem WKWebView)
  /NetcraftSurveyAgent/i,
  /zgrab/i,
  /masscan/i,
];

// Browser brands legítimas para comparar com sec-ch-ua
// Um spoofing grosseiro coloca "Chrome" mas mantém versão antiga no UA string
const LEGIT_BRANDS_RE = /Chromium|Chrome|Safari|Firefox|Edge|Opera|CriOS|FxiOS/i;

// ─── 3. Cache ASN (DNS Cymru) ───────────────────────────────────────────────
const _asnCache  = new Map();
const ASN_TTL_MS = 4 * 3600e3; // 4 horas (hit válido: asn > 0)
// Item 176: cache NEGATIVO curto. Um lookup que falhou (asn:0/unknown/timeout)
// não pode congelar o IP como "neutro" por 4h — senão um datacenter cujo
// primeiro lookup deu timeout passaria despercebido a tarde toda. TTL curto
// força nova tentativa em minutos, mantendo o benefício de não repetir DNS a
// cada request. IP privado continua definitivo (não usa esse caminho).
const ASN_NEG_TTL_MS = 5 * 60e3; // 5 minutos para resultados sem ASN resolvido
function _asnTtl(entry) {
  return (entry && entry.asn > 0) ? ASN_TTL_MS : ASN_NEG_TTL_MS;
}

// Item 223: métricas de cobertura do cache de ASN. Um hit-rate alto significa
// que o /go quase nunca paga o custo do DNS no caminho quente.
const _asnStats = { memHits: 0, redisHits: 0, liveLookups: 0 };
function getAsnCacheStats() {
  const total = _asnStats.memHits + _asnStats.redisHits + _asnStats.liveLookups;
  const hits = _asnStats.memHits + _asnStats.redisHits;
  return {
    memHits: _asnStats.memHits,
    redisHits: _asnStats.redisHits,
    liveLookups: _asnStats.liveLookups,
    total,
    hitRate: total ? hits / total : 0,
    entries: _asnCache.size,
  };
}

// Item 222: limpar o cache de ASN de UM IP (memória + Redis) para reteste
// imediato quando o lookup ficou errado/negativo. Devolve true se havia algo.
async function clearAsnCache(ip) {
  if (!ip) return false;
  const had = _asnCache.delete(ip);
  let redisHad = false;
  if (_redis && _redis.enabled && typeof _redis.clearAsnCache === 'function') {
    redisHad = await _redis.clearAsnCache(ip).catch(() => false);
  }
  return had || redisHad;
}

async function lookupASN(ip) {
  if (!ip) return { asn: 0, org: 'unknown' };
  // IPs privados/loopback: não são datacenters
  if (/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|^$)/.test(ip)) {
    return { asn: 0, org: 'private' };
  }
  // Camada 1: cache em memória (mais rápido, por processo).
  // Hit sem ASN resolvido expira em ASN_NEG_TTL_MS (cache negativo, item 176).
  const cached = _asnCache.get(ip);
  if (cached && Date.now() - cached.ts < _asnTtl(cached)) { _asnStats.memHits++; return cached; }

  // Camada 2: cache no Redis (compartilhado, sobrevive a restart)
  if (_redis && _redis.enabled) {
    const hit = await _redis.getAsnCache(ip).catch(() => null);
    if (hit && typeof hit.asn === 'number') {
      const entry = { asn: hit.asn, org: hit.org || 'unknown', ts: Date.now() };
      _asnCache.set(ip, entry);
      _asnStats.redisHits++;
      return entry;
    }
  }

  _asnStats.liveLookups++; // vai pagar o custo do DNS abaixo

  let entry = { asn: 0, org: 'unknown', ts: Date.now() };
  try {
    // DNS Cymru: <reversed-octets>.origin.asn.cymru.com → "ASN | CIDR | CC | REG | DATE"
    const rev = ip.split('.').reverse().join('.');
    const recs = await dns.resolveTxt(rev + '.origin.asn.cymru.com').catch(() => []);
    for (const rec of recs) {
      const line = Array.isArray(rec) ? rec.join(' ') : rec;
      const m = line.match(/^\s*(\d+)\s*\|/);
      if (m) {
        const parts = line.split('|');
        // Item 180: o org vem de um TXT de terceiros (Cymru). Sanitiza na ORIGEM
        // removendo <>&"' e caracteres de controle antes de qualquer UI (nova em
        // React OU views legadas concatenadas), evitando XSS/quebra de layout.
        const org = (parts[4] || parts[3] || '')
          .replace(/[<>&"'\x00-\x1f\x7f]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 40);
        entry = { asn: Number(m[1]), org, ts: Date.now() };
        break;
      }
    }
  } catch (_) { /* offline — mantém fallback */ }

  _asnCache.set(ip, entry);
  // grava no Redis em background (não bloqueia o caminho quente)
  if (_redis && _redis.enabled) {
    _redis.setAsnCache(ip, { asn: entry.asn, org: entry.org }).catch(() => {});
  }
  return entry;
}

// ─── 4. Tokens de challenge ────────────────────────────────────────────────
// Chave própria, independente de webhook/conversões. Em produção o processo
// recusa iniciar sem TRAFFIC_CHALLENGE_SECRET; em desenvolvimento existe um
// fallback explícito apenas para não bloquear o setup local.
function _secrets() {
  const current = String(process.env.TRAFFIC_CHALLENGE_SECRET || '').trim();
  const previous = String(process.env.TRAFFIC_CHALLENGE_SECRET_PREVIOUS || '').trim();
  if (!current) {
    if (process.env.NODE_ENV === 'production') {
      const err = new Error('TRAFFIC_CHALLENGE_SECRET é obrigatório em produção');
      err.code = 'missing_traffic_challenge_secret';
      throw err;
    }
    return ['roi-nados-traffic-challenge-dev-only'];
  }
  return previous && previous !== current ? [current, previous] : [current];
}
function _secret() { return _secrets()[0]; }

// Emite token HMAC válido por `ttl` ms. 10min reduz a janela de replay sem
// tornar o challenge instável em conexões móveis lentas.
function issueChallengeToken(visitorId, ttl = 600_000) {
  if (!visitorId) return '';
  const exp     = (Date.now() + ttl).toString(36);
  const payload = visitorId + '|' + exp;
  const sig     = crypto.createHmac('sha256', _secret()).update(payload).digest('base64url').slice(0, 24);
  return exp + '.' + sig;
}

// Verifica token; retorna { ok, reason }. Nunca lança — entrada é do cliente.
function verifyChallengeToken(visitorId, token) {
  if (!visitorId || typeof visitorId !== 'string') return { ok: false, reason: 'sem-vid' };
  if (!token || typeof token !== 'string') return { ok: false, reason: 'sem-token' };
  const dot = token.indexOf('.');
  if (dot < 1) return { ok: false, reason: 'formato' };
  const expB36 = token.slice(0, dot);
  const sig    = token.slice(dot + 1);
  // exp precisa ser base36 estrito; parseInt aceita lixo à direita, então valida o formato
  if (!/^[0-9a-z]+$/.test(expB36)) return { ok: false, reason: 'formato' };
  const exp = parseInt(expB36, 36);
  if (isNaN(exp) || Date.now() > exp) return { ok: false, reason: 'expirado' };
  // Aceita a chave anterior durante rotação controlada. Tokens antigos com
  // assinatura de 20 chars continuam válidos por compatibilidade até expirarem.
  const sigBuf = Buffer.from(sig);
  let matched = false;
  for (const secret of _secrets()) {
    for (const length of [24, 20]) {
      const expected = crypto.createHmac('sha256', secret).update(visitorId + '|' + expB36).digest('base64url').slice(0, length);
      const expBuf = Buffer.from(expected);
      if (sigBuf.length !== expBuf.length) continue;
      try { if (crypto.timingSafeEqual(sigBuf, expBuf)) { matched = true; break; } } catch (_) {}
    }
    if (matched) break;
  }
  if (!matched) return { ok: false, reason: 'assinatura' };
  return { ok: true };
}

// ─── 5. Configuração padrão (sobreposta pelo menu da dashboard) ─────────────
// Cada flag liga/desliga uma camada de detecção; threshold é o score mínimo
// para veredito 'bot'. Presets de sensibilidade ajustam o threshold.
const DEFAULT_CONFIG = {
  enabled:          true,  // interruptor mestre do filtro
  shadowMode:       false, // observa/classifica sem alterar o destino do visitante
  threshold:        40,    // score >= threshold ⇒ bot
  deadlineMs:       120,   // teto de latência do lookup de ASN (Camada C)
  blockDatacenter:  true,  // Camada C: ASN de datacenter/hosting
  blockHeadless:    true,  // Camada A: UA headless + Client Hints mismatch
  checkHeaders:     true,  // Camada B: headers obrigatórios / Sec-Fetch
  requireJsChallenge: true, // Camada D1: token HMAC do challenge JS
  checkWebgl:       true,  // Camada D2: WebGL renderer (SwiftShader)
  checkTimezone:    true,  // Camada D3: timezone IANA vs geo do IP
  checkBehavior:    true,  // Camada D6: biometria comportamental
  blockZhLang:      true,  // legado: valida formato/coerência básica de Accept-Language
  checkWebview:     true,  // Camada F: coerência genérica de webview
  checkCoherence:   true,  // Camada G: coerência plataforma/hardware/idioma x UA/geo
  checkEntropy:     true   // Camada H: entropia de movimento e ação-sem-trilha
};

// Presets de sensibilidade → ajustam o threshold (menor = mais agressivo)
const SENSITIVITY_THRESHOLDS = { strict: 30, balanced: 40, loose: 55 };

function resolveConfig(cfg) {
  const c = Object.assign({}, DEFAULT_CONFIG, (cfg && typeof cfg === 'object') ? cfg : {});
  // sensibilidade tem prioridade sobre threshold manual quando informada
  if (c.sensitivity && SENSITIVITY_THRESHOLDS[c.sensitivity]) {
    c.threshold = SENSITIVITY_THRESHOLDS[c.sensitivity];
  }
  c.threshold = Math.max(10, Math.min(90, Number(c.threshold) || 40));
  c.deadlineMs = Math.max(40, Math.min(500, Number(c.deadlineMs) || 120));
  return c;
}

// Executa o lookup de ASN com teto de latência. No estouro, resolve com um
// resultado neutro (asn 0) e o cache em memória segue populando em background,
// então a PRÓXIMA visita do mesmo IP já resolve instantânea.
function lookupASNDeadline(ip, deadlineMs) {
  return Promise.race([
    lookupASN(ip),
    new Promise((resolve) => setTimeout(() => resolve({ asn: 0, org: 'timeout', _timedOut: true }), deadlineMs))
  ]);
}

// ─── 6. Motor principal de julgamento ───────────────────────────────────────
// Recebe sinais do request HTTP + dados coletados pelo JS challenge no browser.
// challengeData: { token, webgl, tz, beh, fp, dt } enviado pelo snippet /t.js
// config: objeto opcional do menu da dashboard (ver DEFAULT_CONFIG)
async function judge(req, visitorId, challengeToken, challengeData, config) {
  const cfg = resolveConfig(config);
  const t0      = Date.now();
  const signals = [];
  let score     = 0;
  let infraAsn  = 0;   // Item 163: ASN resolvido (0 = desconhecido/privado)
  let infraOrg  = '';  // Item 163: organização/operadora do IP

  const ua = String(req.headers['user-agent'] || '');
  const ip = String((req.headers['x-forwarded-for'] || '').split(',')[0].trim()
              || req.socket?.remoteAddress || '');

  // ─── Camada A: UA ─────────────────────────────────────────────────────────

  // A1. UA ausente ou minúsculo
  if (!ua || ua.length < 15) {
    signals.push('ua:ausente'); score += 55;
  } else if (cfg.blockHeadless) {
    // A2. UA headless explícito
    if (HEADLESS_UA_RE.some(r => r.test(ua))) {
      signals.push('ua:headless'); score += 50;
    }

    // A3. sec-ch-ua (Client Hints) vs UA string — inconsistência = spoofing
    // Automação/spoofing pode misturar Client Hints de um ambiente com UA de outro
    const chUA = String(req.headers['sec-ch-ua'] || '');
    if (chUA) {
      // Extrai a primeira brand do sec-ch-ua: "Not/A)Brand";v="8", "Chromium";v="126", ...
      const brandMatch = chUA.match(/"([^"]+)";v="(\d+)"/g) || [];
      const brands = brandMatch.map(b => { const m = b.match(/"([^"]+)"/); return m ? m[1] : ''; });
      const realBrands = brands.filter(b => LEGIT_BRANDS_RE.test(b));

      // Se sec-ch-ua informa Chrome/Chromium mas UA não tem Chrome
      if (realBrands.some(b => /Chrome|Chromium/i.test(b)) && !/Chrome|CriOS/i.test(ua)) {
        signals.push('ch-ua:brand-mismatch'); score += 30;
      }
      // Se UA diz Safari mas sec-ch-ua tem Chrome, o ambiente é incoerente
      if (/Safari/i.test(ua) && !/Chrome/i.test(ua) && realBrands.some(b => /Chrome/i.test(b))) {
        signals.push('ch-ua:safari-chrome-mix'); score += 25;
      }
    }

    // A4. UA diz mobile mas sec-ch-ua-mobile diz desktop (inconsistência de spoofing)
    const chMobile = req.headers['sec-ch-ua-mobile'];
    if (chMobile) {
      const uaIsMobile = /Mobile|Android|iPhone|iPad/i.test(ua);
      const chIsMobile = chMobile.trim() === '?1';
      if (uaIsMobile !== chIsMobile) {
        signals.push('ch-ua:mobile-mismatch'); score += 20;
      }
    }
  }

  // ─── Camada B: Headers HTTP ───────────────────────────────────────────────
  if (cfg.checkHeaders) {
    // B1. Headers obrigatórios ausentes
    const missing = REQUIRED_BROWSER_HEADERS.filter(h => !req.headers[h]);
    if (missing.length) {
      signals.push('headers:missing=' + missing.join(','));
      score += missing.length * 20;
    }

    // B2. Accept sem text/html
    const accept = String(req.headers['accept'] || '');
    if (accept && !/text\/html/i.test(accept)) {
      signals.push('accept:sem-html'); score += 15;
    }

    // B3. Sec-Fetch ausente (browser real Chrome 76+ / Firefox 90+ sempre envia)
    const secFetchCount = SEC_FETCH_HEADERS.filter(h => req.headers[h]).length;
    if (secFetchCount === 0 && ua.length > 20) {
      signals.push('sec-fetch:ausente'); score += 22;
    } else if (secFetchCount >= 2) {
      signals.push('sec-fetch:ok'); score -= 12;
    }

    // B4. Client Hints de plataforma ausentes mas UA diz Chrome moderno (86+)
    const uaChromeVer = ua.match(/Chrome\/(\d+)/);
    if (uaChromeVer && Number(uaChromeVer[1]) >= 90) {
      const chPresent = TRUST_HEADERS.filter(h => req.headers[h]).length;
      if (chPresent === 0) {
        signals.push('ch-ua:ausente-chrome-novo'); score += 18;
      } else {
        signals.push('ch-ua:presente'); score -= 10;
      }
    }

    // B5. Referer: ausência é um sinal fraco; presença coerente recebe crédito
    // mínimo sem privilegiar nenhuma origem/plataforma específica.
    const referer = String(req.headers['referer'] || req.headers['referrer'] || '');
    if (!referer) {
      signals.push('referer:ausente'); score += 8;
    } else {
      signals.push('referer:presente'); score -= 4;
    }
  }

  // ─── Camada C: ASN / Infraestrutura ──────────────────────────────────────
  if (cfg.blockDatacenter && ip) {
    // ASN via DNS Cymru — com teto de latência (deadlineMs). Se o DNS demorar,
    // seguimos sem o sinal; nunca bloqueamos só porque o lookup falhou.
    const r = await lookupASNDeadline(ip, cfg.deadlineMs).catch(() => ({ asn: 0, org: '' }));
    const asn = r.asn;
    infraAsn = asn || 0;
    infraOrg = r.org || (r._timedOut ? 'timeout' : '');
    if (r._timedOut) {
      signals.push('asn:deadline');
    } else if (asn > 0) {
      if (DATACENTER_ASNS.has(asn)) {
        signals.push('asn:datacenter=' + asn);
        score += 38;
      } else {
        signals.push('asn:network=' + asn);
        score -= 8;
      }
    }
  }

  // ─── Camada D: JS Challenge (sinais do browser) ───────────────────────────
  // challengeData é preenchido pelo /api/cloakcheck após o snippet /t.js executar

  const cd = (challengeData && typeof challengeData === 'object') ? challengeData : {};
  const geoCountry = String(req.geoCountry || '').toUpperCase();

  // D1. Token HMAC
  if (cfg.requireJsChallenge) {
    if (challengeToken) {
      const cv = verifyChallengeToken(visitorId, challengeToken);
      if (cv.ok) {
        signals.push('js:token-ok'); score -= 28;
      } else {
        signals.push('js:token-fail=' + cv.reason); score += 22;
      }
    } else {
      signals.push('js:sem-token'); score += 12;
    }
  }

  // D2. WebGL renderer — SwiftShader / llvmpipe / Mesa = headless
  if (cfg.checkWebgl) {
    const webgl = String(cd.webgl || '');
    if (webgl) {
      if (/SwiftShader|llvmpipe|Mesa|VMware|VirtualBox|ANGLE.*SwiftShader/i.test(webgl)) {
        signals.push('webgl:software-renderer'); score += 45;
      } else if (/NVIDIA|AMD|Intel|Apple.*GPU|Radeon|GeForce/i.test(webgl)) {
        signals.push('webgl:gpu-real'); score -= 18;
      } else if (/ANGLE/i.test(webgl)) {
        signals.push('webgl:angle'); score -= 8; // ANGLE normal no Chrome/Windows
      }
    }
  }

  // D3. Timezone vs geo do IP
  if (cfg.checkTimezone) {
    const browserTz = String(cd.tz || '');
    if (browserTz && geoCountry) {
      const tzMismatch = detectTimezoneMismatch(browserTz, geoCountry);
      if (tzMismatch.mismatch) {
        signals.push('tz:mismatch=' + tzMismatch.detail); score += tzMismatch.weight;
      } else {
        signals.push('tz:ok=' + browserTz.split('/').pop()); score -= 8;
      }
    }
  }

  // D4. Canvas fingerprint hash — headless produz hashes determinísticos
  // conhecidos (SwiftShader). Na prática usamos para detectar ausência de
  // renderização (fp muito curto = canvas bloqueado / sem GPU).
  if (cfg.checkWebgl) {
    const fp = String(cd.fp || '');
    if (fp && fp.length < 4) {
      signals.push('canvas:sem-render'); score += 20;
    }
  }

  // D5. Timing do desafio JS
  // Browsers reais levam 1-8ms para 500 loops Math.random();
  // Headless moderno é mais rápido (<0.4ms) ou anormalmente lento (>50ms sem GPU)
  if (cfg.checkBehavior) {
    const dt = Number(cd.dt);
    if (!isNaN(dt)) {
      if (dt < 0.4) {
        signals.push('timing:muito-rapido=' + dt + 'ms'); score += 20;
      } else if (dt > 60) {
        signals.push('timing:muito-lento=' + dt + 'ms'); score += 12;
      } else {
        signals.push('timing:normal=' + dt + 'ms'); score -= 5;
      }
    }

    // D6. Score comportamental (0-100) enviado pelo snippet
    const beh = Number(cd.beh);
    if (!isNaN(beh)) {
      if (beh <= 0) {
        signals.push('beh:zero-interacao'); score += 25;
      } else if (beh >= 60) {
        signals.push('beh:interacao-real'); score -= 20;
      } else {
        signals.push('beh:baixo=' + beh);
      }
    }
  }

  // ─── Camada F: Coerência genérica de WEBVIEW ────────────────────────────
  // Webview é apenas um sinal de ambiente. Não inferimos origem de campanha.
  if (cfg.checkWebview) {
    const wv = String(cd.wv || '');
    const uaDeclaresWebview = /(?:;\s*wv[;)])|\bWebView\b/i.test(ua);
    if (uaDeclaresWebview && cd.wv !== undefined && !wv) {
      signals.push('webview:ua-mismatch'); score += 20;
    } else if (wv) {
      signals.push('webview:present'); score -= 4;
    }
  }

  // ─── Camada G: Coerência de ambiente ─────────────────────────────────────
  // O sinal de MAIOR confiança em 2026 é a INCONSISTÊNCIA entre camadas: um
  // ambiente real tende a ser coerente (UA, plataforma, hardware, tela, idioma
  // e geo fecham entre si); automação/emulação costuma destoar em alguma camada.
  if (cfg.checkCoherence) {
    const uaIsApple = /iPhone|iPad|iPod|Macintosh/i.test(ua);
    const uaIsMobileDev = /Mobile|Android|iPhone|iPad/i.test(ua);
    const plat = String(cd.plat || '');
    const webgl = String(cd.webgl || '');

    // G1. UA Apple mas WebGL renderer não-Apple (ANGLE/Google/NVIDIA no Windows)
    if (uaIsApple && webgl && !/Apple|Metal/i.test(webgl) && /ANGLE|Direct3D|NVIDIA|Intel|Radeon|SwiftShader/i.test(webgl)) {
      signals.push('coh:apple-ua-nonapple-gpu'); score += 28;
    }
    // G2. navigator.platform incoerente com a UA (iPhone/Mac UA com Win32/Linux)
    if (plat) {
      if (uaIsApple && /Win|Linux/i.test(plat)) { signals.push('coh:plat-mismatch=' + plat); score += 30; }
      else if (/Android/i.test(ua) && /Win|MacIntel/i.test(plat)) { signals.push('coh:plat-mismatch=' + plat); score += 28; }
    }
    // G3. "Mobile" com hardware de desktop: núcleos/RAM altos são raros em celular
    if (uaIsMobileDev) {
      const hc = Number(cd.hc), dm = Number(cd.dm);
      if (!isNaN(hc) && hc >= 16) { signals.push('coh:mobile-cpu-alto=' + hc); score += 18; }
      if (!isNaN(dm) && dm >= 16) { signals.push('coh:mobile-ram-alta=' + dm); score += 14; }
      // maxTouchPoints 0 num "celular" = emulador/desktop spoofando mobile
      if (Number(cd.tp) === 0 && cd.tp !== undefined) { signals.push('coh:mobile-sem-touch'); score += 16; }
    }
    // G4. Proporção de tela desktop declarada por UA mobile (ex.: 1920x1080)
    const sw = Number(cd.sw), sh = Number(cd.sh);
    if (uaIsMobileDev && sw > 0 && sh > 0) {
      const maxSide = Math.max(sw, sh);
      if (maxSide >= 1280) { signals.push('coh:mobile-tela-desktop=' + sw + 'x' + sh); score += 14; }
    }
    // G5. Idioma do navegador x timezone/geo — dois batem e um destoa = proxy
    const lang = String(cd.lang || '').split('-')[0].toLowerCase();
    if (lang && geoCountry) {
      const langOkForGeo = LANG_BY_COUNTRY[geoCountry] ? LANG_BY_COUNTRY[geoCountry].includes(lang) : null;
      if (langOkForGeo === false && lang !== 'en') { // en é neutro (aceito em qualquer geo)
        signals.push('coh:lang-fora-geo=' + lang + '/' + geoCountry); score += 12;
      }
    }
  }

  // ─── Camada H: Entropia comportamental ───────────────────────────────────
  // Contar eventos não basta: automação (CDP) injeta eventos "perfeitos demais".
  // Medimos a TEXTURA do movimento — passos sub-pixel (ponteiro físico) e se
  // houve trilha de movimento ANTES do clique/conversão.
  if (cfg.checkEntropy) {
    const ent = Number(cd.ent);
    const beh = Number(cd.beh);
    // Houve interação (beh>0) mas ZERO passos sub-pixel = movimento sintético reto
    if (!isNaN(ent) && !isNaN(beh) && beh > 0 && ent === 0) {
      signals.push('ent:movimento-sintetico'); score += 20;
    } else if (!isNaN(ent) && ent >= 40) {
      signals.push('ent:humano=' + ent); score -= 10; // micro-tremor real
    }
    // Clique/conversão SEM nenhum movimento antes = ação sem trilha (bot)
    if (Number(cd.nt) === 1) { signals.push('ent:acao-sem-trilha'); score += 22; }
  }

  // ─── Camada E: Integridade básica de Accept-Language ────────────────────
  // `blockZhLang` é mantido só por compatibilidade do contrato antigo; a regra
  // V5 não trata nenhum idioma/país como suspeito. Ela detecta apenas formato
  // anômalo típico de headers sintetizados.
  if (cfg.blockZhLang) {
    const acceptLang = String(req.headers['accept-language'] || '');
    if (acceptLang.length > 80 && !acceptLang.includes('q=')) {
      signals.push('lang:formato-suspeito'); score += 8;
    }
  }

  // ─── Normaliza e decide ─────────────────────────────────────────────────��─
  score = Math.max(0, Math.min(100, Math.round(score)));

  // Threshold configurável pelo menu da dashboard (padrão 40):
  // 30 (strict) = agressivo — pega mais automação, risco maior de falso positivo
  // 40 (balanced) = equilíbrio recomendado
  // 55 (loose) = conservador — só pega bots muito óbvios
  const verdict = score >= cfg.threshold ? 'bot' : 'real';

  const resolvedAt = Date.now() - t0;
  // Item 177: alimenta o medidor de latência exposto no /api/health para
  // detectar quando o lookup de ASN está estourando o deadline (DNS lento).
  _recordJudgeLatency(resolvedAt, signals.includes('asn:deadline'));
  return { verdict, score, signals, threshold: cfg.threshold, resolvedAt, asn: infraAsn, org: infraOrg };
}

// ─── Métrica de latência do julgamento (item 177) ───────────────────────────
// Janela deslizante em memória (por processo). Barata e sem dependência — o
// health lê getJudgeLatency() para mostrar p50/p95 e a taxa de deadline.
const _judgeLat = { samples: [], deadlineHits: 0, total: 0, max: 200 };
function _recordJudgeLatency(ms, hitDeadline) {
  if (typeof ms !== 'number' || !isFinite(ms)) return;
  _judgeLat.total++;
  if (hitDeadline) _judgeLat.deadlineHits++;
  const s = _judgeLat.samples;
  s.push(ms);
  if (s.length > _judgeLat.max) s.shift(); // mantém só as últimas N amostras
}
function getJudgeLatency() {
  const s = _judgeLat.samples.slice().sort((a, b) => a - b);
  const pct = (p) => (s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : 0);
  return {
    count: _judgeLat.total,
    window: s.length,
    p50: pct(50),
    p95: pct(95),
    max: s.length ? s[s.length - 1] : 0,
    deadlineHits: _judgeLat.deadlineHits,
    // fração de julgamentos que estouraram o deadline do lookup de ASN
    deadlineRate: _judgeLat.total ? Number((_judgeLat.deadlineHits / _judgeLat.total).toFixed(3)) : 0,
  };
}

// ─── Detecção de inconsistência timezone vs país ─────────────────────────────
// Mapeia blocos de países para prefixos de timezone IANA.
// Revisores em proxy residencial de PT com timezone Asia/Shanghai = suspeito.
const COUNTRY_TZ_PREFIXES = {
  // Europa
  PT: ['Europe/Lis'], ES: ['Europe/Mad'], FR: ['Europe/Par'], DE: ['Europe/Ber'],
  GB: ['Europe/Lon'], IT: ['Europe/Rom'], NL: ['Europe/Ams'], BE: ['Europe/Bru'],
  // Américas
  BR: ['America/Sao','America/For','America/Man','America/Bel','America/Mac'],
  US: ['America/New','America/Chi','America/Den','America/Los','America/Anc','Pacific/Hon'],
  MX: ['America/Mex'], AR: ['America/Arg'], CO: ['America/Bog'],
  // Ásia
  CN: ['Asia/Sha','Asia/Cho'], TW: ['Asia/Tai'], HK: ['Asia/Hon'],
  JP: ['Asia/Tok'], KR: ['Asia/Seo'], SG: ['Asia/Sin'],
  // Oriente Médio
  AE: ['Asia/Dub'], SA: ['Asia/Riy'],
};

// Idiomas primários esperados por país (para a Camada G5). Lista permissiva:
// só sinaliza quando o idioma do navegador claramente não pertence ao país e
// não é 'en' (neutro). País ausente do mapa = não penaliza.
const LANG_BY_COUNTRY = {
  BR: ['pt'], PT: ['pt'], US: ['en','es'], GB: ['en'], ES: ['es','ca'],
  FR: ['fr'], DE: ['de'], IT: ['it'], NL: ['nl'], BE: ['nl','fr'],
  MX: ['es'], AR: ['es'], CO: ['es'], CL: ['es'], PE: ['es'],
  CN: ['zh'], TW: ['zh'], HK: ['zh'], JP: ['ja'], KR: ['ko'], SG: ['en','zh'],
  AE: ['ar'], SA: ['ar'],
};

function detectTimezoneMismatch(browserTz, geoCountry) {
  if (!browserTz || !geoCountry) return { mismatch: false };
  const expected = COUNTRY_TZ_PREFIXES[geoCountry.toUpperCase()];
  if (!expected) return { mismatch: false }; // país sem regra = não penaliza

  const matches = expected.some(prefix => browserTz.startsWith(prefix));
  if (matches) return { mismatch: false };

  // Exceções legítimas: viajante, VPN pessoal, território ultramarino
  // Peso reduzido quando o sinal é isolado
  return {
    mismatch: true,
    detail: geoCountry + '≠' + browserTz.split('/').pop(),
    weight: 18
  };
}

// ─── JS snippet injetado no /t.js ────────────────────────────────────────────
// Coleta: token HMAC, WebGL renderer, timezone IANA, biometria comportamental,
// canvas hash, timing do loop. Envia uma única vez via sendBeacon ao /api/cloakcheck.
// Projetado para ser leve (<2KB) e não bloquear o carregamento da página.
function challengeSnippet(visitorId, token) {
  if (!visitorId || !token) return '';
  return `
(function(){
  if(sessionStorage.getItem('_ck2'))return;
  sessionStorage.setItem('_ck2','1');
  var _vid=${JSON.stringify(visitorId)};
  var _tok=${JSON.stringify(token)};
  var _api=(function(){
    var s=document.currentScript||(function(){var a=document.getElementsByTagName('script');return a[a.length-1];})();
    try{return new URL(s.src).origin;}catch(_){return '';}
  })();
  if(!_api)return;

  function _collect(){
    var d={vid:_vid,tok:_tok};

    // 1. WebGL renderer (SwiftShader/llvmpipe = headless)
    try{
      var c=document.createElement('canvas');
      var gl=c.getContext('webgl')||c.getContext('experimental-webgl');
      if(gl){
        var ext=gl.getExtension('WEBGL_debug_renderer_info');
        if(ext) d.webgl=(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)||'').slice(0,80);
      }
    }catch(_){}

    // 2. Timezone IANA
    try{ d.tz=Intl.DateTimeFormat().resolvedOptions().timeZone||''; }catch(_){}

    // 2b. Sinais genéricos de WEBVIEW. Não identificam a origem do tráfego;
    // apenas descrevem o ambiente para checagens de coerência.
    try{
      var wv='';
      if(window.webkit&&window.webkit.messageHandlers) wv+='iw';
      if(/(; ?wv[;)])/i.test(navigator.userAgent)) wv+='aw';
      if(window.ReactNativeWebView) wv+='rn';
      d.hasChrome=!!(window.chrome&&window.chrome.runtime)?1:0;
      d.wv=wv;
    }catch(_){}

    // 2c. Coerência de ambiente: plataforma, hardware e locale declarados pelo
    // browser. Servem para cruzar com a UA/geo no servidor (ex.: UA de iPhone
    // com platform Win32, ou "mobile" com 16 núcleos = spoofing).
    try{ d.plat=(navigator.platform||'').slice(0,20); }catch(_){}
    try{ d.dm=Number(navigator.deviceMemory)||0; }catch(_){}
    try{ d.hc=Number(navigator.hardwareConcurrency)||0; }catch(_){}
    try{ d.lang=(navigator.language||'').slice(0,10); }catch(_){}
    try{ d.tp=Number(navigator.maxTouchPoints)||0; }catch(_){}
    try{ d.sw=screen.width||0; d.sh=screen.height||0; }catch(_){}

    // 3. Canvas fingerprint hash leve (últimos 20 chars do dataURL)
    try{
      var cv=document.createElement('canvas');
      cv.width=80;cv.height=20;
      var ctx=cv.getContext('2d');
      ctx.font='13px Arial';
      ctx.fillStyle='#e2d';
      ctx.fillText('roi\u25ba'+_vid.slice(0,6),2,15);
      ctx.fillStyle='rgba(0,100,200,0.5)';
      ctx.fillRect(10,2,40,8);
      d.fp=(cv.toDataURL('image/png').slice(-24)||'').replace(/[^a-zA-Z0-9+/=]/g,'').slice(0,20);
    }catch(_){}

    // 4. Timing: 500 loops Math.random (headless <0.5ms, real 1-8ms)
    try{
      var t0=performance.now();
      for(var i=0;i<500;i++)Math.random();
      d.dt=Math.round((performance.now()-t0)*10)/10;
    }catch(_){}

    // 5. Score comportamental + ENTROPIA: além de contar eventos, medimos se o
    // movimento parece humano. Automação (CDP/injeção) costuma mover em linha
    // reta, com passos de pixel inteiro e sem micro-tremor — ou dispara clique
    // SEM nenhum mousemove/touch antes (ação sem trilha = bot).
    var events=0;
    var moves=0, fracSteps=0, lastX=null, lastY=null, sumJit=0, moveBeforeAction=0, actioned=0;
    function onMove(e){
      events++; moves++;
      var x=e.clientX, y=e.clientY;
      if(lastX!=null){
        var dx=x-lastX, dy=y-lastY;
        // passo com componente fracionária (sub-pixel) = ponteiro físico real
        if((dx%1)!==0||(dy%1)!==0) fracSteps++;
        sumJit+=Math.abs(dx)+Math.abs(dy);
      }
      lastX=x; lastY=y;
      if(!actioned) moveBeforeAction=1;
    }
    function onTouch(e){ events+=3; moves++; if(!actioned) moveBeforeAction=1; }
    function onAction(){ events+=5; actioned=1; }
    var listeners=[
      ['mousemove',onMove],
      ['scroll',function(){events+=2;}],
      ['touchstart',onTouch],['touchmove',onTouch],
      ['click',onAction],['pointerdown',onAction],
      ['keydown',function(){events+=4;}]
    ];
    listeners.forEach(function(l){document.addEventListener(l[0],l[1],{passive:true,once:false});});
    setTimeout(function(){
      // normaliza em 0-100: 0 = zero interação (bot), 60+ = interação humana real
      d.beh=Math.min(100,events*3);
      // entropia 0-100: proporção de passos sub-pixel (humano ~alto). Sem moves = 0.
      d.ent=moves>1?Math.round((fracSteps/(moves-1))*100):0;
      // clicou/converteu sem NENHUM movimento antes = ação sem trilha (bot)
      d.nt=(actioned&&!moveBeforeAction)?1:0;
      listeners.forEach(function(l){document.removeEventListener(l[0],l[1]);});
      _send(d);
    },3000);
    return null; // envia assincronamente
  }

  function _send(d){
    var body=JSON.stringify(d);
    try{
      if(navigator.sendBeacon){navigator.sendBeacon(_api+'/api/cloakcheck',new Blob([body],{type:'application/json'}));return;}
    }catch(_){}
    try{fetch(_api+'/api/cloakcheck',{method:'POST',headers:{'Content-Type':'application/json'},body:body,keepalive:true}).catch(function(){});}catch(_){}
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',_collect);
  }else{
    _collect();
  }
})();`;
}


function assertSecurityConfig() {
  if (process.env.NODE_ENV === 'production') _secrets();
  return true;
}

module.exports = {
  judge,
  lookupASN,
  getAsnCacheStats,   // Item 223
  clearAsnCache,      // Item 222
  issueChallengeToken,
  verifyChallengeToken,
  challengeSnippet,
  resolveConfig,
  getJudgeLatency,
  DEFAULT_CONFIG,
  SENSITIVITY_THRESHOLDS,
  // Item 224: TTLs efetivos das camadas de cache, para o painel técnico
  assertSecurityConfig,
  CACHE_TTLS: {
    presence: 60,
    dedup: 2 * 3600,
    sticky: 6 * 3600,
    ttclid: 12 * 3600,
    asn: Math.round(ASN_TTL_MS / 1000),
    asnNegative: Math.round(ASN_NEG_TTL_MS / 1000),
  }
};
