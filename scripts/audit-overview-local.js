'use strict';

// Laboratório SOMENTE LOCAL. Não carrega .env, server.js ou workers, não abre
// banco e não chama fornecedores. Os handlers abaixo são extraídos do código
// real; todas as fronteiras externas são substituídas por dados controlados.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const root = path.resolve(__dirname, '..');
const dashboard = process.env.OVERVIEW_AUDIT_DASHBOARD || path.join(root, 'dashboard');
const ts = require(path.join(dashboard, 'node_modules/typescript'));
const reporting = require('../reporting-integrity');
const profitEngine = require('../profit-engine');
const { buildOverviewHealth } = require('../overview-health');

function route(file, url, context) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let callback;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === 'app.get'
      && node.arguments[0]?.text === url) callback = node.arguments[node.arguments.length - 1].getText(tree);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  if (!callback) throw new Error('Handler não encontrado: ' + url);
  return vm.runInNewContext('(' + callback + ')', { Date, console, ...context }, { filename: file + ':' + url });
}

function isolatedStats(seed) {
  const module = { exports: {} };
  const fakeFs = { existsSync: () => true, readFileSync: () => JSON.stringify(seed) };
  const fakeDb = { enabled: false, insertEvent() {}, upsertLead() {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'stats.js'), 'utf8'), {
    module, exports: module.exports, __dirname: '/isolated-audit',
    require: name => {
      if (name === 'fs') return fakeFs;
      if (name === 'path') return path;
      if (name === './db') return fakeDb;
      throw new Error('Dependência não isolada: ' + name);
    },
    process: { once() {} }, Date, console,
    setTimeout: () => 0, clearTimeout() {},
  }, { filename: 'stats.js' });
  return module.exports;
}

function fixture(now = new Date()) {
  const at = new Date(now.getTime() - 60_000).toISOString();
  const older = new Date(now.getTime() - 3 * 864e5).toISOString();
  const leads = Array.from({ length: 10 }, (_, i) => ({
    id: 'audit-' + i, acc: 'audit', at, country: i < 7 ? 'BR' : 'PT',
    stage: i < 2 ? 'purchased' : i < 5 ? 'checkout' : 'visit',
    checkoutAt: i < 5 ? at : undefined, paymentStartedAt: i < 3 ? at : undefined,
    convertedAt: i < 2 ? at : undefined,
    reportedAmount: i === 0 ? 10000 : i === 1 ? 20000 : undefined,
    reportedCurrency: 'BRL', ttclid: 'audit-click-' + i,
    utm: { source: 'tiktok', campaign: i === 1 ? 'campaign-b' : 'campaign-a' },
  }));
  const events = [
    { id: 'sale-a', acc: 'audit', at, type: 'sale', amount: 10000, currency: 'BRL' },
    { id: 'sale-b', acc: 'audit', at, type: 'sale', amount: 20000, currency: 'BRL' },
    { id: 'sale-old', acc: 'audit', at: older, type: 'sale', amount: 5000, currency: 'BRL' },
  ];
  return { leads, events, updatedAt: at };
}

function laboratory(scenario = 'normal', advertiser = 'a') {
  const seed = fixture();
  if (scenario === 'empty') { seed.leads = []; seed.events = []; }
  if (scenario === 'mixed') seed.events.push({ ...seed.events[0], id: 'sale-eur', amount: 4000, currency: 'EUR' });
  if (scenario === 'large') {
    seed.leads = Array.from({ length: 3501 }, (_, i) => ({ ...seed.leads[2], id: 'volume-' + i, stage: i === 3500 ? 'purchased' : 'visit', checkoutAt: i === 3500 ? seed.updatedAt : undefined, paymentStartedAt: i === 3500 ? seed.updatedAt : undefined, convertedAt: i === 3500 ? seed.updatedAt : undefined, reportedAmount: 10000 }));
    seed.events = [seed.events[0]];
  }
  const stats = isolatedStats(seed);
  const spend = scenario === 'cold' || scenario === 'empty' ? 0 : advertiser === 'a' ? 50 : 100;
  const syncState = {
    last_synced_at: scenario === 'cold' ? null : new Date(Date.now() - 5 * 60_000).toISOString(),
    status: ['cold', 'stale'].includes(scenario) ? 'error' : 'idle',
    last_error: 'Falha de sincronização controlada',
  };
  const timeZone = scenario === 'timezone' ? 'America/Los_Angeles' : 'America/Sao_Paulo';
  const configValue = { settings: { timezone: 'America/Sao_Paulo', defaultCurrency: 'BRL' }, profitability: { gatewayFeePct: 10, taxPct: 5, fixedCostCurrency: 'BRL' } };
  const campaigns = scenario === 'empty' || scenario === 'cold' ? [] : [{
    platformCampaignId: 'campaign-' + advertiser, campaignName: 'Campanha ' + advertiser.toUpperCase() + ' · teste isolado', status: 'ENABLE', metrics: { spend },
  }];
  const visitors = scenario === 'empty' ? [] : [{ id: 'v1', acc: 'audit', country: 'BR', countryName: 'Brasil', pageviews: 1, idleMs: 0, durationMs: 1000 }];
  const context = {
    stats, reportingIntegrity: reporting, profitEngine, buildOverviewHealth,
    config: { get: () => configValue },
    effectiveProfitabilityConfig: () => configValue.profitability,
    safeAdsTimeZone: reporting.safeTimeZone, DEFAULT_ADS_TIME_ZONE: reporting.DEFAULT_TIME_ZONE, adsDay: reporting.dayAt,
    requireAdvertiser: async (_account, _unused, id) => ({ advertiserId: id }),
    pipeboard: { enabled: true, resolveAdvertiserId: async () => advertiser,
      getAdvertiserInfo: async () => ({ currency: 'BRL', timezone: timeZone }) },
    adsCache: { enabled: true, getSyncState: async () => ({ ...syncState }),
      readAdvertiserDaily: async () => ({ spend, conversions: 1, currency: 'BRL', spendByDay: { [reporting.dayAt(new Date(), timeZone)]: spend } }),
      readTree: async () => ({ campaigns, total: campaigns.length }) },
    adsSync: { ensureFresh: async () => { if (['cold', 'stale'].includes(scenario)) throw new Error('Sync controlado indisponível'); } },
    adsSweepHook: { fn: null },
    STATS_CACHE: new Map(), STATS_CACHE_TTL: 3000, rateLimited: () => false, checkDailyReport() {},
    fail: (res, error) => res.status(500).json({ error: error.message }),
    linkStore: { list: () => [{ active: true }] }, pixelStore: { list: () => [] }, gatewayStore: { list: () => [] },
    presence: {
      list: async () => visitors,
      summary: async () => ({ online: visitors.length, countries: visitors.length ? [{ code: 'BR', name: 'Brasil', count: 1 }] : [] }),
    },
  };
  const handlers = new Map();
  for (const url of ['/api/stats', '/api/overview/health', '/api/live']) handlers.set(url, route('server.js', url, context));
  for (const url of ['/api/ads/roas', '/api/ads/profitability', '/api/ads/tree']) handlers.set(url, route('ads-routes.js', url, context));
  return { handlers, stats, context, seed };
}

async function invoke(lab, url, query = {}) {
  let status = 200, body;
  const headers = {};
  const res = { set: (key, value) => { headers[key] = value; return res; }, status: value => { status = value; return res; }, json: value => { body = value; return res; } };
  await lab.handlers.get(url)({ account: { id: 'audit' }, query }, res);
  return { status, headers, body };
}

function serve() {
  let scenario = 'normal', advertiser = 'a', lab = laboratory(), log = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1:3000');
    const json = (body, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
    try {
      if (url.pathname === '/__audit/log') return json(log);
      if (url.pathname === '/__audit') {
        scenario = ['normal', 'failure', 'tree-error', 'stats-error', 'live-error', 'cold', 'stale', 'timezone', 'empty', 'mixed', 'large'].includes(url.searchParams.get('scenario')) ? url.searchParams.get('scenario') : 'normal';
        lab = laboratory(scenario, advertiser); log = [];
        const size = url.searchParams.get('size') || '1440x1000';
        const [width, height] = ['1440x1000', '390x844', '844x390'].includes(size) ? size.split('x').map(Number) : [1440, 1000];
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': 'dash_session=audit-local-only; HttpOnly; SameSite=Lax; Path=/' });
        return res.end(`<!doctype html><html lang="pt-BR"><title>Auditoria local · Visão Geral</title><body style="margin:12px;background:#10121d;color:white;font:14px system-ui"><h2>AUDITORIA LOCAL — dados controlados, sem serviços externos</h2><form><label>Cenário <select name="scenario">${['normal','failure','tree-error','cold','stale','timezone','empty','mixed','large'].map(s => `<option ${s === scenario ? 'selected' : ''}>${s}</option>`).join('')}</select></label> <label>Viewport <select name="size">${['1440x1000','390x844','844x390'].map(s => `<option ${s === size ? 'selected' : ''}>${s}</option>`).join('')}</select></label> <button>Aplicar</button></form><p id="result">Carregando medição</p><iframe id="preview" title="Dashboard em viewport ${size}" width="${width}" height="${height}" style="border:1px solid #697087;max-width:none" src="/dashboard?p=today"></iframe><script>const frame=document.getElementById('preview');setInterval(()=>{try{const d=frame.contentDocument;const e=d.documentElement;document.getElementById('result').textContent='Viewport '+e.clientWidth+'×'+e.clientHeight+' · largura do documento '+e.scrollWidth+' · overflow horizontal: '+(e.scrollWidth>e.clientWidth?'SIM':'não')}catch{}},1000);</script></body></html>`);
      }
      if (url.pathname.startsWith('/api/')) {
        log.push({ at: new Date().toISOString(), method: req.method, url: req.url, scenario, advertiser });
        if ((scenario === 'failure' && ['/api/ads/roas', '/api/ads/profitability'].includes(url.pathname))
          || (scenario === 'tree-error' && url.pathname === '/api/ads/tree')
          || (scenario === 'stats-error' && url.pathname === '/api/stats')
          || (scenario === 'live-error' && url.pathname === '/api/live')) return json({ error: 'Falha controlada para auditoria', code: 'AUDIT_UNAVAILABLE' }, 503);
        if (lab.handlers.has(url.pathname)) {
          const result = await invoke(lab, url.pathname, Object.fromEntries(url.searchParams));
          res.writeHead(result.status, { ...result.headers, 'Content-Type': 'application/json' });
          return res.end(JSON.stringify(result.body));
        }
        if (url.pathname === '/api/me') return json({ name: 'Auditoria local', email: 'audit@example.invalid', role: 'admin' });
        if (url.pathname === '/api/settings') return json(lab.context.config.get().settings);
        if (url.pathname === '/api/ads/status') return json({ enabled: true, connected: true, advertiserId: advertiser, currency: 'BRL', timezone: 'America/Sao_Paulo' });
        if (url.pathname === '/api/ads/accounts') return json({ accounts: [{ id: 'a', name: 'Conta A · teste' }, { id: 'b', name: 'Conta B · teste' }], selected: advertiser });
        if (url.pathname === '/api/ads/accounts/select' && req.method === 'POST') {
          let body = ''; for await (const chunk of req) body += chunk;
          advertiser = JSON.parse(body).advertiserId === 'b' ? 'b' : 'a'; lab = laboratory(scenario, advertiser);
          return json({ advertiserId: advertiser });
        }
        if (url.pathname === '/api/ads/campaign-decisions') return json({ advertiserId: advertiser, byCampaign: { ['campaign-' + advertiser]: { sales: 1, revenueCents: advertiser === 'a' ? 10000 : 20000, currency: 'BRL' } } });
        if (url.pathname === '/api/pixels/emq-trend') return json({ pixels: [{ slug: 'audit', recentAvg: 7.5, baseAvg: 7 }], alerts: 0 });
        if (url.pathname === '/api/health') return json({ db: true, redis: true, redisEnabled: true, migrations: true, tiktok: false, conversionWebhook: false, queues: { conv: { queue: 0, processing: 0 }, capiRetry: 0 } });
        if (url.pathname === '/api/pixels/durability') return json({ durable: true, db: true, redis: true, pixels: [] });
        if (url.pathname === '/api/pixels') return json({ pixels: [] });
        if (url.pathname === '/api/gateways') return json({ gateways: [] });
        if (url.pathname === '/api/notifications') return json({ notifications: [], items: [], unread: 0 });
        return json({ error: 'Endpoint fora do laboratório: ' + url.pathname }, 501);
      }
      if (!url.pathname.startsWith('/dashboard')) { res.writeHead(302, { Location: '/__audit' }); return res.end(); }
      const upstream = http.request({ hostname: '127.0.0.1', port: 3001, path: req.url, method: req.method, headers: { ...req.headers, host: 'localhost:3001', cookie: 'dash_session=audit-local-only' } }, response => {
        res.writeHead(response.statusCode, response.headers); response.pipe(res);
      });
      upstream.on('error', error => { if (!res.headersSent) json({ error: error.message }, 502); });
      req.pipe(upstream);
    } catch (error) { if (!res.headersSent) json({ error: error.message }, 500); }
  });
  server.listen(3000, '127.0.0.1', () => console.log('Auditoria isolada: http://127.0.0.1:3000/__audit'));
}

module.exports = { laboratory, invoke, isolatedStats, fixture, route };
if (require.main === module) serve();
