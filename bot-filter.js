'use strict';
// ── Filtro de Revisores de Anúncios TikTok Ads ───────────────────────────────
// Pesquisa 2025-2026:
//  • TikTok usa iPhones/Androids reais em redes de operadoras — IP/UA sozinhos
//    não bastam. O sistema correlaciona ASN de operadora, Client Hints, timezone,
//    WebGL renderer, biometria comportamental e o JS challenge.
//  • ByteDance opera AS138699 (main) + AS396986 (US legacy) + roteamento via
//    parceiros cloud. Lookup BGP em tempo real é mais confiável que CIDRs fixos.
//  • SwiftShader / llvmpipe no WebGL renderer = headless confirmado (alto valor).
//  • Inconsistência Client Hints (sec-ch-ua brand) vs UA string = spoofing.
//  • Timezone do browser vs geo do IP = sinal de proxy/VPN de revisão.
//  • Behavioral score: zero interação após 3s de página = automação.
//
// RESULTADO: cada visita retorna { verdict:'real'|'bot', score:0-100, signals[] }

const dns  = require('dns').promises;
const crypto = require('crypto');
const uaTools = require('./ua'); // detecção de in-app TikTok (usuário real) e crawlers
// Redis é opcional: cache de ASN entre processos/restarts. Degrada para o Map
// em memória se o módulo/serviço não estiver disponível.
let _redis = null;
try { _redis = require('./redis'); } catch (_) { _redis = null; }

// ─── 1. ASNs de datacenters / ad-review / device-farms (2025-2026) ─────────
const DATACENTER_ASNS = new Set([
  // ByteDance
  396986,  // ByteDance Inc. (US legacy)
  136907,  // ByteDance (APAC)
  138699,  // ByteDance (main 2024+)
  // Hyperscalers usados em revisão automática
  15169,   // Google / GCP
  8075,    // Microsoft / Azure
  16509,   // Amazon AWS us-east
  14618,   // Amazon AWS us-east alternate
  7224,    // Amazon AWS eu
  20940,   // Akamai
  32934,   // Meta / Facebook
  54113,   // Fastly
  13335,   // Cloudflare
  // Ad-verification / fraud detection (tráfego de auditoria de anúncio)
  395747,  // DoubleVerify
  46484,   // HUMAN Security (ex-WhiteOps)
  46664,   // Integral Ad Science (IAS)
  22697,   // Moat / Oracle Advertising
  397155,  // CHEQ AI (ad fraud)
  13649,   // TrafficGuard
  36352,   // ColoCrossing (device farms)
  25820,   // IT7 Networks (device farm)
  36114,   // Cogent (hosting reseller usado em farms)
  30633,   // Limelight Networks
  // Proxies residenciais e mobile-proxy conhecidos por revisores
  212238,  // Datacamp Limited (proxy residencial)
  60068,   // CDN77 (usado como relay)
  // Hosting / VPS de uso geral — origem clássica de scrapers, headless e
  // proxies de datacenter. Usuário pago do TikTok vem de operadora móvel,
  // quase nunca destes ASNs; peso datacenter (+38) é seguro aqui.
  16276,   // OVH
  24940,   // Hetzner Online
  14061,   // DigitalOcean
  20473,   // The Constant Company / Vultr
  63949,   // Akamai / Linode
  51167,   // Contabo
  31898,   // Oracle Cloud (OCI)
  45102,   // Alibaba Cloud (intl)
  132203,  // Tencent Cloud
  37963,   // Alibaba (CN)
  60781,   // LeaseWeb NL
  30633,   // Leaseweb USA (também em farms)
  8100,    // QuadraNet
  62240,   // Clouvider
  9009,    // M247 (VPN/proxy hosting)
  212238,  // Datacamp/CDN (dup-safe: Set deduplica)
  49505,   // Selectel (RU hosting)
  201814,  // Proxy-Seller / mobile proxies
  206092,  // IPXO (proxy leasing)
  212238,  // Datacamp
  50673,   // Serverius (proxy hosting)
  29802,   // HIVELOCITY (VPS/farms)
  40676,   // Psychz Networks (device farms)
  53667,   // FranTech / BuyVM (proxy VPS)
  35916,   // MULTA-ASN / hosting
  46844,   // ReliableSite (VPS)
  19318,   // Interserver (VPS)
  55286,   // ServerMania
  35913,   // DediPath (encerrado, mas ainda visto em logs)
  399629,  // BL Networks (proxy)
  208046,  // Hosting proxies EU
  14618,   // Amazon AWS (dup-safe)
]);

// CIDRs ByteDance CONFIRMADOS via BGP.tools (AS138699, jan 2025).
// IMPORTANTE: só entram ranges verificados — CIDR errado = falso positivo
// (usuário real mandado pra white page = venda perdida). A detecção primária
// é o lookup dinâmico de ASN (lookupASN) que cobre todos os ASNs ByteDance
// com precisão; este array é só um fast-path para ranges 100% confirmados.
// Para adicionar: confirme em https://bgp.tools/as/138699#prefixes antes.
const BD_CIDRS_V4 = [
  // 23.54.160.0/20 — infra edge TikTok/ByteDance (CDN + review), confirmado
  [0x1736A000n, 0xFFFFF000n],
];

function ipToInt(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some(n => isNaN(n))) return 0n;
  return (BigInt(p[0]) << 24n) | (BigInt(p[1]) << 16n) | (BigInt(p[2]) << 8n) | BigInt(p[3]);
}

function inByteDanceCidr(ip) {
  if (!ip || ip.includes(':')) return false;
  const n = ipToInt(ip);
  return BD_CIDRS_V4.some(([base, mask]) => (n & mask) === base);
}

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
const ASN_TTL_MS = 4 * 3600e3; // 4 horas

async function lookupASN(ip) {
  if (!ip) return { asn: 0, org: 'unknown' };
  // IPs privados/loopback: não são datacenters
  if (/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|^$)/.test(ip)) {
    return { asn: 0, org: 'private' };
  }
  // Camada 1: cache em memória (mais rápido, por processo)
  const cached = _asnCache.get(ip);
  if (cached && Date.now() - cached.ts < ASN_TTL_MS) return cached;

  // Camada 2: cache no Redis (compartilhado, sobrevive a restart)
  if (_redis && _redis.enabled) {
    const hit = await _redis.getAsnCache(ip).catch(() => null);
    if (hit && typeof hit.asn === 'number') {
      const entry = { asn: hit.asn, org: hit.org || 'unknown', ts: Date.now() };
      _asnCache.set(ip, entry);
      return entry;
    }
  }

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
        entry = { asn: Number(m[1]), org: (parts[4] || parts[3] || '').trim().slice(0, 40), ts: Date.now() };
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

// ─── 4. Tokens de challenge ─────────────────────────────────────────────────
function _secret() {
  return (process.env.CONVERSION_WEBHOOK_SECRET || 'roi-nados-cloak-dev') + '-cloak-v2';
}

// Emite token HMAC válido por `ttl` ms (padrão 15min)
function issueChallengeToken(visitorId, ttl = 900_000) {
  if (!visitorId) return '';
  const exp     = (Date.now() + ttl).toString(36);
  const payload = visitorId + '|' + exp;
  const sig     = crypto.createHmac('sha256', _secret()).update(payload).digest('base64url').slice(0, 20);
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
  const expected = crypto.createHmac('sha256', _secret()).update(visitorId + '|' + expB36).digest('base64url').slice(0, 20);
  // timingSafeEqual EXIGE buffers de mesmo tamanho, senão lança. A assinatura
  // vem do cliente (corpo do POST) e pode ter qualquer tamanho → compara antes.
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return { ok: false, reason: 'assinatura' };
  try {
    if (!crypto.timingSafeEqual(sigBuf, expBuf)) return { ok: false, reason: 'assinatura' };
  } catch (_) {
    return { ok: false, reason: 'assinatura' };
  }
  return { ok: true };
}

// ─── 5. Configuração padrão (sobreposta pelo menu da dashboard) ─────────────
// Cada flag liga/desliga uma camada de detecção; threshold é o score mínimo
// para veredito 'bot'. Presets de sensibilidade ajustam o threshold.
const DEFAULT_CONFIG = {
  enabled:          true,  // interruptor mestre do cloaking
  threshold:        40,    // score >= threshold ⇒ bot
  deadlineMs:       120,   // teto de latência do lookup de ASN (Camada C)
  blockDatacenter:  true,  // Camada C: ASN datacenter / ByteDance
  blockHeadless:    true,  // Camada A: UA headless + Client Hints mismatch
  checkHeaders:     true,  // Camada B: headers obrigatórios / Sec-Fetch
  requireJsChallenge: true, // Camada D1: token HMAC do challenge JS
  checkWebgl:       true,  // Camada D2: WebGL renderer (SwiftShader)
  checkTimezone:    true,  // Camada D3: timezone IANA vs geo do IP
  checkBehavior:    true,  // Camada D6: biometria comportamental
  blockZhLang:      true,  // Camada E: accept-language zh fora do bloco CN
  checkWebview:     true,  // Camada F: integridade de webview (UA in-app x globals)
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

  const ua = String(req.headers['user-agent'] || '');
  const ip = String((req.headers['x-forwarded-for'] || '').split(',')[0].trim()
              || req.socket?.remoteAddress || '');

  // ─── Camada A: UA ─────────────────────────────────────────────────────────

  // A0. Navegador in-app da TikTok = USUÁRIO REAL do anúncio. O webview envia
  // headers "incompletos" (sec-fetch/client-hints parciais) que as camadas B/C
  // penalizariam — este crédito forte evita jogar o usuário pago para a white.
  // Bots reais em datacenter/headless que spoofam essa UA continuam sendo
  // pegos pelos sinais de ASN (+38/55) e WebGL software (+45), que dominam.
  const inAppTikTok = uaTools.isInAppTikTok(ua);
  if (inAppTikTok) { signals.push('ua:tiktok-inapp'); score -= 40; }

  // A1. UA ausente ou minúsculo
  if (!ua || ua.length < 15) {
    signals.push('ua:ausente'); score += 55;
  } else if (cfg.blockHeadless) {
    // A2. UA headless explícito
    if (HEADLESS_UA_RE.some(r => r.test(ua))) {
      signals.push('ua:headless'); score += 50;
    }

    // A3. sec-ch-ua (Client Hints) vs UA string — inconsistência = spoofing
    // Revisores às vezes copiam sec-ch-ua de um dispositivo mas usam UA de outro
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
      // Se UA diz Safari mas sec-ch-ua tem Chrome (revisores copiando headers misturados)
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

    // B5. Referer
    const referer = String(req.headers['referer'] || req.headers['referrer'] || '');
    if (!referer) {
      signals.push('referer:ausente'); score += 8;
    } else if (/tiktok\.com|snssdk|musical\.ly|vm\.tiktok/i.test(referer)) {
      signals.push('referer:tiktok'); score -= 15;
    } else if (/google\.|facebook\.|instagram\.|youtube\./i.test(referer)) {
      signals.push('referer:social-legit'); score -= 8;
    }
  }

  // ─── Camada C: ASN / Infraestrutura ──────────────────────────────────────
  if (cfg.blockDatacenter) {
    // C1. CIDR ByteDance hardcoded (resposta imediata, sem DNS)
    if (inByteDanceCidr(ip)) {
      signals.push('ip:bytedance-cidr'); score += 50;
    }

    // C2. ASN via DNS Cymru — com teto de latência (deadlineMs). Se o DNS
    // demorar, seguimos sem esse sinal; o cache popula p/ a próxima visita.
    if (ip && !signals.includes('ip:bytedance-cidr')) {
      const r = await lookupASNDeadline(ip, cfg.deadlineMs).catch(() => ({ asn: 0, org: '' }));
      const asn = r.asn;
      if (r._timedOut) {
        signals.push('asn:deadline');
      } else if (asn > 0) {
        if (DATACENTER_ASNS.has(asn)) {
          signals.push('asn:datacenter=' + asn);
          // ByteDance ASNs têm peso maior
          score += ([396986, 136907, 138699].includes(asn)) ? 55 : 38;
        } else {
          signals.push('asn:carrier=' + asn);
          score -= 10; // ISP/operadora = usuário real
        }
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

  // ─── Camada F: Integridade de WEBVIEW ────────────────────────────────────
  // O usuário PAGO vive no webview do app da TikTok. Esse webview expõe globals
  // (webkit.messageHandlers no iOS, flag "; wv)" no Android, JSBridge Bytedance)
  // que um Chrome/Safari comum — onde o revisor COLA o link — não tem. Se a UA
  // diz in-app mas o browser não expõe NENHUM desses, é UA falsificada (bot).
  if (cfg.checkWebview) {
    const wv = String(cd.wv || '');
    if (inAppTikTok) {
      if (cd.wv !== undefined && !wv) {
        // UA in-app + zero globals de webview = revisor spoofando a UA no desktop
        signals.push('webview:ua-spoof'); score += 45;
      } else if (wv) {
        signals.push('webview:ok=' + wv); score -= 15; // webview real confirmado
      }
      // Chrome desktop "de verdade" (window.chrome.runtime) sob UA in-app = incoerente
      if (Number(cd.hasChrome) === 1) { signals.push('webview:chrome-runtime-inapp'); score += 22; }
    }
  }

  // ─── Camada G: Coerência de ambiente ─────────────────────────────────────
  // O sinal de MAIOR confiança em 2026 é a INCONSISTÊNCIA entre camadas: um
  // ambiente real é coerente (UA, plataforma, hardware, tela, idioma e geo
  // fecham entre si); revisores em proxy/emulador destoam em pelo menos uma.
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

  // ─── Camada E: Accept-Language e geo ─────────────────────────────────────
  if (cfg.blockZhLang) {
    const acceptLang = String(req.headers['accept-language'] || '');
    if (acceptLang) {
      const primaryLang = acceptLang.split(',')[0].split('-')[0].toLowerCase();
      const geo = geoCountry.toLowerCase();
      // Revisor chinês em IP fora do bloco chinês
      if (primaryLang === 'zh' && !['cn', 'tw', 'hk', 'sg', 'mo'].includes(geo)) {
        signals.push('lang:zh-fora-geo'); score += 22;
      }
      // Sem separador de qualidade mas com muitos idiomas = header gerado
      if (acceptLang.length > 50 && !acceptLang.includes('q=')) {
        signals.push('lang:sem-quality-factor'); score += 8;
      }
    }
  }

  // ─── Normaliza e decide ─────────────────────────────────────────────────��─
  score = Math.max(0, Math.min(100, Math.round(score)));

  // Threshold configurável pelo menu da dashboard (padrão 40):
  // 30 (strict) = agressivo — pega mais revisores, risco maior de falso positivo
  // 40 (balanced) = equilíbrio recomendado
  // 55 (loose) = conservador — só pega bots muito óbvios
  const verdict = score >= cfg.threshold ? 'bot' : 'real';

  return { verdict, score, signals, threshold: cfg.threshold, resolvedAt: Date.now() - t0 };
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

    // 2b. Integridade de WEBVIEW: o app do TikTok roda num webview que expõe
    // marcadores que um Chrome/Safari normal (onde o revisor COLA o link) não
    // tem. Montamos flags: iw=webkit.messageHandlers (iOS in-app), aw=window
    // sem chrome real, jb=JSBridge do Bytedance, mh=nomes de handlers nativos.
    try{
      var wv='';
      if(window.webkit&&window.webkit.messageHandlers) wv+='iw';           // iOS WKWebView
      if(/(; ?wv[;)])/i.test(navigator.userAgent)) wv+='aw';               // Android WebView flag
      if(window.ByteBridge||window.JSBridge||window.__bytedance||window.TTJSBridge) wv+='jb'; // Bytedance bridge
      if(window.ReactNativeWebView) wv+='rn';
      // Chrome desktop "de verdade" tem window.chrome com runtime; webview não.
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

module.exports = {
  judge,
  issueChallengeToken,
  verifyChallengeToken,
  challengeSnippet,
  resolveConfig,
  DEFAULT_CONFIG,
  SENSITIVITY_THRESHOLDS
};
