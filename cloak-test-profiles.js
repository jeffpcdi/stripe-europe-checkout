'use strict';

// ─── Item 165/208: catálogo de perfis para o simulador do teste de cloaking ──
//
// O botão "Testar" da aba Cloaker julga o request REAL do admin (deve dar
// 'real'). Isso responde "eu passo?", mas não "e um revisor da ByteDance? e um
// headless? e um usuário do anúncio no webview?". Este catálogo alimenta um
// modo de simulação: cada perfil é um conjunto FIEL de headers + IP + país +
// query + sinais de fingerprint (challengeData) que representa um visitante
// típico. O motor de julgamento (bot-filter.judge) roda sobre o perfil e a
// dashboard mostra o veredito que a rota /c/:slug daria de verdade.
//
// Regras:
// - Estes dados são sintéticos e não contêm PII real (IPs de exemplo/documentação
//   ou de faixas públicas conhecidas de datacenter).
// - Nenhum perfil traz challengeToken válido (HMAC é por-visitante); por isso
//   todos recebem o sinal `js:sem-token` (+12), igual ao 1º hit real do /c.
// - O objetivo é ILUSTRAR a decisão, não cravar um score exato: os pesos do
//   motor podem evoluir. Mantemos margem folgada em cada perfil.

// Baseline de headers de um Chrome moderno "de verdade" (bons sinais).
const REAL_MOBILE_HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language': 'pt-BR,pt;q=0.9',
  'sec-fetch-site': 'none',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-dest': 'document',
  'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
  'sec-ch-ua-mobile': '?1',
  'sec-ch-ua-platform': '"Android"',
  referer: 'https://www.tiktok.com/',
};

const BOT_TEST_PROFILES = [
  {
    id: 'real-mobile-br',
    label: 'Usuário real (Android · BR)',
    // Verdict esperado: real → offer
    expected: 'real',
    hint: 'Comprador legítimo vindo do anúncio no Chrome do Android, no Brasil. Deve ver a offer.',
    ip: '189.6.44.120', // faixa residencial BR (exemplo)
    country: 'BR',
    query: { ttclid: 'E1F2a3B4c5D6e7F8g9H0i1J2' }, // ttclid válido (>=20 chars)
    headers: REAL_MOBILE_HEADERS,
    challengeData: {
      webgl: 'ANGLE (Qualcomm, Adreno (TM) 640, OpenGL ES 3.2)',
      tz: 'America/Sao_Paulo',
      fp: 'a1b2c3d4e5f6a7b8',
      dt: 3,
      beh: 75,
      plat: 'Linux armv8l',
      hc: 8,
      dm: 4,
      tp: 5,
      sw: 393,
      sh: 852,
      lang: 'pt-BR',
    },
  },
  {
    id: 'tiktok-inapp-br',
    label: 'Usuário do anúncio (webview TikTok)',
    expected: 'real',
    hint: 'Tráfego pago dentro do app da TikTok. Headers parciais, mas o webview é real — deve ver a offer.',
    ip: '179.108.16.30',
    country: 'BR',
    query: { ttclid: 'Z9y8X7w6V5u4T3s2R1q0P9o8' },
    headers: {
      'user-agent':
        'Mozilla/5.0 (Linux; Android 13; SM-A536E Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 musical_ly_2023 trill_310204 BytedanceWebview/d8a21c',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'pt-BR,pt;q=0.9',
      'sec-fetch-site': 'none',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-dest': 'document',
    },
    challengeData: {
      wv: 'android-jsbridge', // globals de webview presentes = webview real
      webgl: 'ANGLE (ARM, Mali-G78 MC14, OpenGL ES 3.2)',
      tz: 'America/Sao_Paulo',
      fp: 'f0e1d2c3b4a59687',
      dt: 4,
      beh: 62,
      plat: 'Linux armv8l',
      hc: 8,
      dm: 6,
      tp: 5,
      sw: 412,
      sh: 915,
      lang: 'pt-BR',
    },
  },
  {
    id: 'headless-puppeteer',
    label: 'Bot headless (Puppeteer)',
    expected: 'bot',
    hint: 'Navegador automatizado sem GPU real. Deve cair na white page.',
    ip: '34.122.55.10', // faixa cloud (exemplo)
    country: 'US',
    query: {},
    headers: {
      'user-agent':
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9',
    },
    challengeData: {
      webgl: 'Google SwiftShader', // renderer de software = headless
      tz: 'UTC',
      fp: 'x', // canvas sem render
      dt: 0.2, // rápido demais
      beh: 0, // zero interação
      plat: 'Linux x86_64',
      hc: 2,
      dm: 8,
      tp: 0,
      sw: 800,
      sh: 600,
      lang: 'en-US',
    },
  },
  {
    id: 'datacenter-reviewer',
    label: 'Revisor em datacenter (ByteDance)',
    expected: 'bot',
    hint: 'Revisor de anúncio abrindo o link de uma faixa de IP da ByteDance. Deve cair na white page.',
    ip: '23.54.160.5', // dentro do CIDR ByteDance hardcoded (23.54.160.0/20)
    country: 'US',
    query: {},
    headers: {
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9',
    },
    challengeData: {}, // revisor abre o link "cru", sem completar o desafio JS
  },
  {
    id: 'spoofed-headers',
    label: 'Headers falsificados (Safari + CH Chrome)',
    expected: 'bot',
    hint: 'UA de Safari/Mac mas Client Hints e hardware de Chrome/Windows — incoerência clássica de spoofing.',
    ip: '45.83.220.7',
    country: 'BR',
    query: {},
    headers: {
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'pt-BR,pt;q=0.9',
      'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
    },
    challengeData: {
      webgl: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)', // GPU Windows sob UA Apple
      tz: 'America/Sao_Paulo',
      fp: 'deadbeefcafebabe',
      dt: 5,
      beh: 10,
      plat: 'Win32', // navigator.platform Windows sob UA Mac
      hc: 12,
      dm: 16,
      tp: 0,
      sw: 1920,
      sh: 1080,
      lang: 'pt-BR',
    },
  },
  {
    id: 'generic-crawler',
    label: 'Crawler genérico (SEO bot)',
    expected: 'bot',
    hint: 'Robô de indexação sem headers de navegador. Deve cair na white page.',
    ip: '85.208.96.50',
    country: 'US',
    query: {},
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; SemrushBot/7~bl; +http://www.semrush.com/bot.html)',
      accept: '*/*',
    },
    challengeData: {}, // crawler não executa JS
  },
];

function getProfile(id) {
  return BOT_TEST_PROFILES.find((p) => p.id === id) || null;
}

// Metadados leves para a dashboard listar os perfis (sem vazar os headers/IPs).
function listProfilesMeta() {
  return BOT_TEST_PROFILES.map((p) => ({
    id: p.id,
    label: p.label,
    expected: p.expected,
    hint: p.hint,
  }));
}

module.exports = { BOT_TEST_PROFILES, getProfile, listProfilesMeta };
