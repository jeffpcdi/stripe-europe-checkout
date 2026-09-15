'use strict';

// Perfis sintéticos para QA da proteção de tráfego. O catálogo é deliberadamente
// genérico: valida navegador legítimo, webview, headless, infraestrutura de cloud,
// spoofing e crawler sem modelar revisores de nenhuma plataforma específica.

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
};

const BOT_TEST_PROFILES = [
  {
    id: 'real-mobile-br',
    label: 'Navegador mobile legítimo · BR',
    expected: 'real',
    hint: 'Chrome mobile com sinais coerentes de dispositivo e interação.',
    ip: '189.6.44.120',
    country: 'BR',
    query: { utm_source: 'qa' },
    headers: REAL_MOBILE_HEADERS,
    challengeData: {
      webgl: 'ANGLE (Qualcomm, Adreno (TM) 640, OpenGL ES 3.2)',
      tz: 'America/Sao_Paulo', fp: 'a1b2c3d4e5f6a7b8', dt: 3, beh: 75,
      plat: 'Linux armv8l', hc: 8, dm: 4, tp: 5, sw: 393, sh: 852, lang: 'pt-BR',
    },
  },
  {
    id: 'generic-inapp-br',
    label: 'Webview mobile legítima · BR',
    expected: 'real',
    hint: 'Webview Android com bridge, GPU e comportamento coerentes.',
    ip: '179.108.16.30',
    country: 'BR',
    query: {},
    headers: {
      'user-agent':
        'Mozilla/5.0 (Linux; Android 13; SM-A536E Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'pt-BR,pt;q=0.9',
      'sec-fetch-site': 'none', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document',
    },
    challengeData: {
      wv: 'android-jsbridge',
      webgl: 'ANGLE (ARM, Mali-G78 MC14, OpenGL ES 3.2)',
      tz: 'America/Sao_Paulo', fp: 'f0e1d2c3b4a59687', dt: 4, beh: 62,
      plat: 'Linux armv8l', hc: 8, dm: 6, tp: 5, sw: 412, sh: 915, lang: 'pt-BR',
    },
  },
  {
    id: 'headless-puppeteer',
    label: 'Automação headless',
    expected: 'bot',
    hint: 'Chrome headless com GPU emulada e ausência de interação.',
    ip: '34.122.55.10',
    country: 'US',
    query: {},
    headers: {
      'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9',
    },
    challengeData: {
      webgl: 'Google SwiftShader', tz: 'UTC', fp: 'x', dt: 0.2, beh: 0,
      plat: 'Linux x86_64', hc: 2, dm: 8, tp: 0, sw: 800, sh: 600, lang: 'en-US',
    },
  },
  {
    id: 'datacenter-automation',
    label: 'Automação em datacenter',
    expected: 'bot',
    hint: 'Request de infraestrutura de cloud sem challenge nem sinais de interação.',
    ip: '34.122.55.10',
    country: 'US',
    query: {},
    headers: {
      'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      accept: 'text/html,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9',
    },
    challengeData: {},
  },
  {
    id: 'spoofed-headers',
    label: 'Headers incoerentes',
    expected: 'bot',
    hint: 'UA de Safari/Mac combinado com Client Hints e hardware de Windows.',
    ip: '45.83.220.7',
    country: 'BR',
    query: {},
    headers: {
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'pt-BR,pt;q=0.9',
      'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
      'sec-ch-ua-mobile': '?0', 'sec-ch-ua-platform': '"Windows"',
    },
    challengeData: {
      webgl: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)',
      tz: 'America/Sao_Paulo', fp: 'deadbeefcafebabe', dt: 5, beh: 10,
      plat: 'Win32', hc: 12, dm: 16, tp: 0, sw: 1920, sh: 1080, lang: 'pt-BR',
    },
  },
  {
    id: 'generic-crawler',
    label: 'Crawler genérico',
    expected: 'bot',
    hint: 'Robô de indexação sem sinais de um navegador interativo.',
    ip: '85.208.96.50',
    country: 'US', query: {},
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; GenericCrawler/1.0)', accept: '*/*' },
    challengeData: {},
  },
];

function getProfile(id) {
  return BOT_TEST_PROFILES.find((p) => p.id === id) || null;
}
function listProfilesMeta() {
  return BOT_TEST_PROFILES.map((p) => ({ id: p.id, label: p.label, expected: p.expected, hint: p.hint }));
}

module.exports = { BOT_TEST_PROFILES, getProfile, listProfilesMeta };
