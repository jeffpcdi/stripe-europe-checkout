// ── test/ua.test.js — item 466 ─────────────────────────────────────────────
// O contrato mais caro do funil: usuário REAL do TikTok in-app NUNCA pode ser
// classificado como bot (perderia o clique pago para a white page), e crawlers
// (inclusive a safra 2026 de AI crawlers) NUNCA podem virar lead.
const assert = require('node:assert');
const { isBot, isInAppTikTok, parse } = require('../ua');

// ── A. UAs REAIS do TikTok in-app (capturadas de tráfego de anúncio) ───────
const TIKTOK_REAL = [
  // Android — WebView do app (musical_ly + app_version)
  'Mozilla/5.0 (Linux; Android 13; SM-A536E Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.230 Mobile Safari/537.36 musical_ly_2022803040 JsSdk/1.0 NetType/WIFI Channel/googleplay AppName/musical_ly app_version/28.3.4 ByteLocale/pt-BR ByteFullLocale/pt-BR Region/BR',
  // Android — BytedanceWebview explícito
  'Mozilla/5.0 (Linux; Android 12; moto g(30) Build/S0RCS32.41-10-9-11; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0.6045.194 Mobile Safari/537.36 BytedanceWebview/d8a21c6 musical_ly_2022705030 JsSdk/1.0 NetType/4G Channel/vivo_1128_64 AppName/musical_ly app_version/27.5.3 ByteLocale/pt ByteFullLocale/pt Region/BR',
  // iOS — app da TikTok (Aweme)
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_31.1.0 JsSdk/2.0 NetType/WIFI Channel/App Store ByteLocale/pt-BR Region/BR AwemeBrowser/31.1.0',
];
for (const ua of TIKTOK_REAL) {
  assert.strictEqual(isInAppTikTok(ua), true, 'in-app TikTok não reconhecido: ' + ua.slice(0, 60));
  assert.strictEqual(isBot(ua), false, 'usuário real do TikTok marcado como bot: ' + ua.slice(0, 60));
}
console.log('A. ' + TIKTOK_REAL.length + ' UAs reais do TikTok in-app reconhecidas como humanas OK');

// ── B. crawlers clássicos e safra 2026 (AI crawlers + scanners) ────────────
const BOTS = [
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  'Mozilla/5.0 (compatible; Bytespider; spider-feedback@bytedance.com)',
  'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)',
  'Mozilla/5.0 (compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)',
  'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot',
  'Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)',
  'Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
  'meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)',
  'Mozilla/5.0 (compatible; Amazonbot/0.1; +https://developer.amazon.com/support/amazonbot)',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)',
  'CCBot/2.0 (https://commoncrawl.org/faq/)',
  'Screaming Frog SEO Spider/19.4',
  'Mozilla/5.0 zgrab/0.x',
  'Expanse, a Palo Alto Networks company, searches across the global IPv4 space',
  'curl/8.5.0',
  'python-requests/2.31.0',
  'Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/120.0.6099.109',
];
for (const ua of BOTS) {
  assert.strictEqual(isBot(ua), true, 'crawler não detectado: ' + ua.slice(0, 60));
}
console.log('B. ' + BOTS.length + ' crawlers (clássicos + safra 2026) detectados OK');

// ── C. navegadores humanos comuns não podem ser falso-positivo ─────────────
const HUMANS = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.64 Mobile Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.2365.66',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Instagram 320.0.2.28.108',
];
for (const ua of HUMANS) {
  assert.strictEqual(isBot(ua), false, 'humano marcado como bot: ' + ua.slice(0, 60));
}
// Sem UA ou UA curta demais = automação
assert.strictEqual(isBot(''), true);
assert.strictEqual(isBot('Mozilla'), true);
console.log('C. ' + HUMANS.length + ' navegadores humanos sem falso-positivo + UA vazia/curta = bot OK');

// ── D. parse de dispositivo nas UAs do TikTok ───────────────────────────────
const p = parse(TIKTOK_REAL[0]);
assert.strictEqual(p.device, 'mobile');
assert.strictEqual(p.os, 'Android');
assert.strictEqual(p.browser, 'TikTok WebView');
const pi = parse(TIKTOK_REAL[2]);
assert.strictEqual(pi.os, 'iOS');
console.log('D. parse de dispositivo/OS/navegador das UAs do TikTok OK');

console.log('\nua.test.js: todos os cenários passaram.');
