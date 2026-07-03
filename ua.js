// ── User-Agent: detecção de bots + parse de dispositivo ───────────────────
// Bots (crawlers, monitoramento, curl) NÃO viram leads, NÃO disparam CAPI e
// NÃO contam cliques — poluem o funil e derrubam o Event Match Quality do
// pixel (o TikTok penaliza eventos com identidade de máquina).

// Crawlers/ferramentas conhecidos. "bot|crawler|spider" pega a maioria dos
// bem-comportados; o resto são libs HTTP e headless que não se anunciam.
const BOT_RE = new RegExp([
  'bot\\b', 'crawler', 'spider', 'crawling',
  'facebookexternalhit', 'whatsapp', 'telegrambot', 'slackbot', 'discordbot',
  'bytespider', 'bytedance', 'tiktok',                       // crawlers da própria ByteDance
  'googlebot', 'adsbot', 'bingpreview', 'yandex', 'duckduckbot', 'baiduspider',
  'ahrefs', 'semrush', 'mj12bot', 'dotbot', 'petalbot', 'gptbot', 'claudebot',
  'headlesschrome', 'phantomjs', 'puppeteer', 'playwright', 'selenium',
  'lighthouse', 'pagespeed', 'gtmetrix', 'pingdom', 'uptimerobot', 'statuscake',
  'curl/', 'wget/', 'python-requests', 'python-urllib', 'aiohttp', 'httpx',
  'go-http-client', 'okhttp', 'java/', 'libwww-perl', 'node-fetch', 'undici',
  'axios/', 'postmanruntime', 'insomnia', 'vercel-screenshot', 'checkly'
].join('|'), 'i');

function isBot(ua) {
  if (!ua) return true;                 // sem UA = automação (browsers sempre enviam)
  const s = String(ua);
  if (s.length < 12) return true;       // "Mozilla" sozinho, "test", etc.
  return BOT_RE.test(s);
}

// Parse leve (sem dependências): device / OS / navegador.
// A ordem dos testes importa — ex.: Edge contém "Chrome", iPad contém "Mac".
function parse(ua) {
  const s = String(ua || '');
  const out = { device: 'desktop', os: null, browser: null };
  if (!s) return out;

  // ── dispositivo ──
  if (/ipad|tablet|kindle|silk|playbook/i.test(s) || (/android/i.test(s) && !/mobile/i.test(s))) {
    out.device = 'tablet';
  } else if (/mobi|iphone|ipod|android|blackberry|windows phone|opera mini/i.test(s)) {
    out.device = 'mobile';
  }

  // ── sistema operacional ──
  if (/windows nt/i.test(s)) out.os = 'Windows';
  else if (/iphone|ipad|ipod/i.test(s)) out.os = 'iOS';
  else if (/mac os x|macintosh/i.test(s)) out.os = 'macOS';
  else if (/android/i.test(s)) out.os = 'Android';
  else if (/cros/i.test(s)) out.os = 'ChromeOS';
  else if (/linux/i.test(s)) out.os = 'Linux';

  // ── navegador (ordem: específicos antes de genéricos) ──
  if (/edg(e|a|ios)?\//i.test(s)) out.browser = 'Edge';
  else if (/samsungbrowser\//i.test(s)) out.browser = 'Samsung Internet';
  else if (/opr\/|opera/i.test(s)) out.browser = 'Opera';
  else if (/musical_ly|bytedancewebview|tiktok/i.test(s)) out.browser = 'TikTok WebView';
  else if (/instagram/i.test(s)) out.browser = 'Instagram WebView';
  else if (/fban|fbav|fb_iab/i.test(s)) out.browser = 'Facebook WebView';
  else if (/firefox\/|fxios\//i.test(s)) out.browser = 'Firefox';
  else if (/crios\//i.test(s)) out.browser = 'Chrome iOS';
  else if (/chrome\//i.test(s)) out.browser = 'Chrome';
  else if (/safari\//i.test(s) && /version\//i.test(s)) out.browser = 'Safari';

  return out;
}

module.exports = { isBot, parse };
