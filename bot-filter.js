// ── Filtro de Revisores de Anúncios TikTok Ads ───────────────────────────
// Pesquisa 2025-2026: o TikTok usa aparelhos reais (iPhone/Android) em redes
// móveis/residenciais para revisar anúncios — IP puro e UA já não bastam.
// A estratégia eficaz é MULTICAMADAS: infraestrutura + heurísticas de request
// + JS challenge assíncrono (o sinal mais forte disponível server-side).
//
// RESULTADO: cada visita retorna { verdict: 'real'|'bot', score: 0-100,
//   signals: [...], resolvedAt: ms } para logar e decidir roteamento.

const dns = require('dns').promises;
const { promises: fs } = require('fs');

// ── 1. CAMADA ASN / INFRAESTRUTURA ──────────────────────────────────────
// ASNs de datacenters e plataformas de moderação/ad-review conhecidos em 2025.
// ByteDance opera principalmente ASN 396986 (US) e 136907 (AS), mas distribui
// o tráfego de revisão por provedores cloud parceiros.
const DATACENTER_ASNS = new Set([
  396986,  // ByteDance Inc. (US)
  136907,  // ByteDance (APAC)
  15169,   // Google
  8075,    // Microsoft / Azure
  16509,   // Amazon AWS
  14618,   // Amazon AWS alternate
  20940,   // Akamai
  32934,   // Facebook / Meta
  54113,   // Fastly
  13335,   // Cloudflare
  22697,   // Ad Review / Moderation Services
  46664,   // Integral Ad Science
  395747,  // DoubleVerify
  46484,   // HUMAN Security (ex-WhiteOps)
  25820,   // IT7 Networks (device farm)
  7922,    // Comcast (used by some review networks)
]);

// CIDR de infraestrutura ByteDance conhecidos (atualizar periodicamente)
const BD_CIDRS = [
  [0x1736_0000n, 0xFFFF_0000n, '23.54.x.x / ByteDance'],      // 23.54.0.0/16 (placeholder — atualizar)
  [0x0D02_0000n, 0xFFFF_0000n, '13.2.0.0/16 ByteDance CDN'],
];

// ── 2. SINAIS DE REQUEST HTTP ────────────────────────────────────────────
// Combinações que aparecem em tráfego de revisão/automação mas raramente
// em usuários orgânicos: falta de Accept-Language, Sec-Fetch vazio,
// headers gerados programaticamente, etc.

// Falta de headers que TODOS os browsers reais enviam
const REQUIRED_BROWSER_HEADERS = [
  'accept',
  'accept-language',
];

// Headers que indicam browser real (presença aumenta confiança)
const BROWSER_TRUST_HEADERS = [
  'sec-fetch-site',
  'sec-fetch-mode',
  'sec-fetch-dest',
  'sec-ch-ua',
];

// UAs de automação / headless que não se anunciam no BOT_RE do ua.js
// (complemento — ua.js já cobre os bem-comportados)
const HEADLESS_UA_HINTS = [
  /HeadlessChrome/i,
  /\bElectron\//i,
  /\bPhantomJS\//i,
  /wkhtmlto/i,
  /Prerender/i,
  /node-fetch/i,
  /python-/i,
  /Go-http-client/i,
  /Dalvik\/\d/i,          // Android WebView automatizado
  /CFNetwork\/\d/,        // iOS URLSession puro (sem WebView)
];

// Combinações suspeitas no Accept (automação costuma enviar genérico ou vazio)
const ACCEPT_BROWSER_RE = /text\/html/i;

// ── 3. CACHE DE CONSULTAS ASN (evita resolver o mesmo IP várias vezes) ──
const _asnCache = new Map();   // ip → { asn, org, ts }
const ASN_CACHE_TTL = 4 * 3600e3; // 4h

// Consulta rápida ao WHOIS da CYMRU (TCP txt) — sem dependência extra.
// Fallback: /tmp/rdap se offline.
async function lookupASN(ip) {
  if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
    return { asn: 0, org: 'private' };
  }
  const cached = _asnCache.get(ip);
  if (cached && Date.now() - cached.ts < ASN_CACHE_TTL) return cached;

  try {
    // DNS TXT: <reversed-ip>.origin.asn.cymru.com → "ASN | IP/CIDR | CC | REGISTRY | DATE"
    const parts = ip.includes(':') ? [] : ip.split('.').reverse();
    if (parts.length === 4) {
      const host = parts.join('.') + '.origin.asn.cymru.com';
      const records = await dns.resolveTxt(host).catch(() => []);
      for (const rec of records) {
        const line = rec.join(' ');
        const m = line.match(/^\s*(\d+)\s*\|\s*/);
        if (m) {
          const entry = { asn: Number(m[1]), org: line.split('|').pop().trim(), ts: Date.now() };
          _asnCache.set(ip, entry);
          return entry;
        }
      }
    }
  } catch (_) { /* ignora — fallback abaixo */ }

  const entry = { asn: 0, org: 'unknown', ts: Date.now() };
  _asnCache.set(ip, entry);
  return entry;
}

// ── 4. TOKEN JS CHALLENGE ────────────────────────────────────────────────
// O servidor emite um token assinado para cada visita. O snippet /t.js
// executa um pequeno desafio (canvas fingerprint + timing) e retorna o
// token ao /api/cloakcheck para confirmar que há um browser real rodando JS.
// Revisores com JS desabilitado ou headless que não executam scripts falham.

const crypto = require('crypto');

function _challengeSecret() {
  // Usa CONVERSION_WEBHOOK_SECRET como material de chave (disponível em prod)
  return (process.env.CONVERSION_WEBHOOK_SECRET || 'roi-nados-cloak-dev') + '-cloak';
}

// Gera um token de desafio válido por `ttl` ms (default 10min)
function issueChallengeToken(visitorId, ttl = 600_000) {
  const exp = (Date.now() + ttl).toString(36);
  const payload = visitorId + '|' + exp;
  const sig = crypto.createHmac('sha256', _challengeSecret()).update(payload).digest('base64url').slice(0, 16);
  return exp + '.' + sig;
}

// Verifica token emitido pelo servidor + respondido pelo browser
// Retorna { ok, reason }
function verifyChallengeToken(visitorId, token) {
  if (!token || typeof token !== 'string') return { ok: false, reason: 'sem token' };
  const [expB36, sig] = token.split('.');
  if (!expB36 || !sig) return { ok: false, reason: 'formato inválido' };
  const exp = parseInt(expB36, 36);
  if (isNaN(exp) || Date.now() > exp) return { ok: false, reason: 'expirado' };
  const payload = visitorId + '|' + expB36;
  const expected = crypto.createHmac('sha256', _challengeSecret()).update(payload).digest('base64url').slice(0, 16);
  if (sig !== expected) return { ok: false, reason: 'assinatura inválida' };
  return { ok: true };
}

// ── 5. MOTOR PRINCIPAL DE JULGAMENTO ─────────────────────────────────────
// score 0-100: quanto MAIOR, mais provável ser revisor/bot.
// Retorna { verdict, score, signals }

async function judge(req, visitorId, challengeToken) {
  const signals = [];
  let score = 0;

  const ua = String(req.headers['user-agent'] || '');
  const ip = String((req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '');

  // ── Sinal: UA headless/automação ──────────────────────────────────────
  for (const re of HEADLESS_UA_HINTS) {
    if (re.test(ua)) {
      signals.push('ua:headless'); score += 45; break;
    }
  }

  // ── Sinal: UA ausente ou muito curto ──────────────────────────────────
  if (!ua || ua.length < 20) {
    signals.push('ua:ausente'); score += 50;
  }

  // ── Sinal: headers obrigatórios de browser ausentes ───────────────────
  const missingRequired = REQUIRED_BROWSER_HEADERS.filter((h) => !req.headers[h]);
  if (missingRequired.length) {
    signals.push('headers:faltam=' + missingRequired.join(','));
    score += missingRequired.length * 18;
  }

  // ── Sinal: Accept sem text/html (automação envia */* ou application/json) ─
  const accept = String(req.headers['accept'] || '');
  if (accept && !ACCEPT_BROWSER_RE.test(accept)) {
    signals.push('accept:sem-html'); score += 15;
  }

  // ── Sinal: presença de headers Sec-Fetch (browser real 2019+) ─────────
  const trustCount = BROWSER_TRUST_HEADERS.filter((h) => req.headers[h]).length;
  if (trustCount === 0 && ua.length > 20) {
    // UA real sem Sec-Fetch = WebView antigo ou automação
    signals.push('sec-fetch:ausente'); score += 20;
  } else if (trustCount >= 3) {
    signals.push('sec-fetch:ok'); score -= 15;
  }

  // ── Sinal: Referer (clique do TikTok sempre tem referer tiktok/snssdk) ─
  const referer = String(req.headers['referer'] || '');
  if (!referer) {
    signals.push('referer:ausente'); score += 8;
  } else if (/tiktok\.com|snssdk|musical\.ly/i.test(referer)) {
    signals.push('referer:tiktok'); score -= 12;
  }

  // ── Sinal: ASN datacenter ─────────────────────────────────────────────
  if (ip) {
    const { asn, org } = await lookupASN(ip);
    if (asn && DATACENTER_ASNS.has(asn)) {
      signals.push('asn:datacenter=' + asn + '(' + org.slice(0, 30) + ')');
      score += 40;
    } else if (asn) {
      signals.push('asn:ok=' + asn);
      score -= 8;
    }
  }

  // ── Sinal: JS challenge ───────────────────────────────────────────────
  if (challengeToken) {
    const cv = verifyChallengeToken(visitorId, challengeToken);
    if (cv.ok) {
      signals.push('js:challenge-ok');
      score -= 30;  // browser executou JS real — maior sinal de confiança
    } else {
      signals.push('js:challenge-fail=' + cv.reason);
      score += 25;
    }
  } else {
    // sem token: não pune fortemente (primeira visita ainda não completou)
    signals.push('js:sem-token');
    score += 10;
  }

  // ── Sinal: Accept-Language fora do geo esperado ───────────────────────
  const acceptLang = String(req.headers['accept-language'] || '');
  if (acceptLang) {
    // Idioma principal (ex.: "en-US,en;q=0.9" → "en")
    const primaryLang = acceptLang.split(',')[0].split('-')[0].toLowerCase();
    // Se geoip for disponível no chamador, pode passar req.geoCountry
    const geoCountry = String(req.geoCountry || '').toLowerCase();
    if (geoCountry && primaryLang === 'zh' && !['cn', 'tw', 'hk', 'sg'].includes(geoCountry)) {
      // Revisor chinês em IP europeu/americano
      signals.push('lang:zh-fora-geo');
      score += 20;
    }
    signals.push('lang:' + primaryLang);
  }

  // ── Normaliza score ───────────────────────────────────────────────────
  score = Math.max(0, Math.min(100, score));
  const verdict = score >= 45 ? 'bot' : 'real';

  return { verdict, score, signals, resolvedAt: Date.now() };
}

// ── JS snippet injetado no /t.js para completar o challenge ──────────────
// O challenge é simples de propósito: o objetivo não é ser "impossível de
// quebrar", mas adicionar uma camada de custo suficiente para revisar em
// escala. Faz canvas fingerprint + timing + devolve o token ao servidor.
function challengeSnippet(visitorId, token) {
  // Evita injetar em contexto de SSR/template se não houver visitId
  if (!visitorId || !token) return '';
  return `
(function(){
  var _cvid=${JSON.stringify(visitorId)};
  var _ctok=${JSON.stringify(token)};
  function _runCloak(){
    try{
      // Canvas fingerprint leve (detects headless)
      var c=document.createElement('canvas');
      c.width=64;c.height=16;
      var ctx=c.getContext('2d');
      if(!ctx) return;
      ctx.font='11px sans-serif';
      ctx.fillText('roi\u25ba'+_cvid.slice(0,8),2,12);
      var fp=c.toDataURL().slice(-20);
      // Timing: browsers reais têm ~2ms de latência mínima; headless <0.5ms
      var t0=performance.now();
      for(var i=0;i<500;i++){Math.random();}
      var dt=Math.round(performance.now()-t0);
      // Envia ao servidor apenas uma vez por visita
      if(sessionStorage.getItem('_cksent')) return;
      sessionStorage.setItem('_cksent','1');
      var body=JSON.stringify({vid:_cvid,tok:_ctok,fp:fp,dt:dt});
      if(navigator.sendBeacon){navigator.sendBeacon('/api/cloakcheck',new Blob([body],{type:'application/json'}));}
      else{fetch('/api/cloakcheck',{method:'POST',headers:{'Content-Type':'application/json'},body:body,keepalive:true}).catch(function(){});}
    }catch(_){}
  }
  if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',_runCloak);}
  else{_runCloak();}
})();`;
}

module.exports = { judge, issueChallengeToken, verifyChallengeToken, challengeSnippet };
