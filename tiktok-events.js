// ── TikTok Events API v1.3 — rastreamento server-side (CAPI) ──────────────
// Dispara eventos direto do servidor para MÚLTIPLOS pixels (um por arquivo em
// pixels/*.json). Deduplica com o pixel do navegador via event_id idêntico.
const crypto = require('crypto');
const pixelStore = require('./pixel-store');
const db  = require('./db');
const rdb = require('./redis');

const TIKTOK_API_URL = 'https://business-api.tiktok.com/open_api/v1.3/event/track/';

// SHA-256 exigido pelo TikTok para todos os dados de identidade (PII)
function hash(value) {
  if (!value) return undefined;
  return crypto.createHash('sha256').update(String(value).trim().toLowerCase()).digest('hex');
}

// Telefone: normaliza para E.164 (+DDDN…) antes do hash, como o TikTok exige.
// "00" internacional vira "+", e o "+" só é mantido no início.
function hashPhone(phone) {
  if (!phone) return undefined;
  let clean = String(phone).replace(/[^0-9+]/g, '');
  if (clean.startsWith('00')) clean = '+' + clean.slice(2);
  clean = clean[0] === '+' ? '+' + clean.slice(1).replace(/\+/g, '') : clean.replace(/\+/g, '');
  const digits = clean.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return undefined; // fora do E.164 → não envia lixo
  return hash(clean);
}

// external_id do lead: hash do v_id (id único salvo no banco). Amarra o funil
// inteiro à mesma pessoa dentro do gerenciador do TikTok.
function externalIdFromLead(vId) {
  return vId ? hash('lead:' + vId) : undefined;
}

// ── Log de disparos em memória (feed rápido do painel) ────────────────────
const LOG_MAX = 200;
const log = [];
function pushLog(entry) {
  const row = {
    id: crypto.randomBytes(8).toString('hex'),
    at: new Date().toISOString(),
    acc: entry.acc || null,                              // conta dona (multi-tenant)
    pixel: entry.pixel,
    event: entry.event,
    eventId: entry.eventId,
    leadId: entry.leadId,
    status: entry.status,
    emq: entry.emq != null ? entry.emq : null,          // score 0–10 de identidade
    emqFields: entry.emqFields || [],                    // sinais enviados (email, ttclid…)
    response: entry.response
  };
  log.unshift(row);
  if (log.length > LOG_MAX) log.length = LOG_MAX;
  // Upstash Redis: write rápido (~1ms), TTL automático de 14 dias
  rdb.pushPixelLog(row).catch(() => {});
  // Neon: backup durável (estruturado para queries analíticas)
  if (db.enabled) db.insertPixelEvent(row.acc, row);
  return row;
}
function recentLog(n, accountId) {
  const rows = accountId ? log.filter((r) => r.acc === accountId) : log;
  return rows.slice(0, n || 50);
}

// Versão async: usa Redis como fallback se memória local estiver vazia
async function recentLogAsync(n, accountId) {
  let rows = log;
  if (!rows.length) {
    // após restart: busca do Redis e re-popula memória local
    const redisRows = await rdb.loadPixelLog(200);
    if (redisRows && redisRows.length) {
      log.push(...redisRows.slice(0, LOG_MAX));
      rows = log;
    }
  }
  if (accountId) rows = rows.filter((r) => r.acc === accountId);
  return rows.slice(0, n || 100);
}

// Guards de qualidade: cada campo só entra no payload se for PERFEITO —
// campo ruim derruba o Event Match Quality inteiro do evento no TikTok.
const SHA256_RE = /^[a-f0-9]{64}$/;
const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6_RE = /^[0-9a-fA-F:]+$/;
const CUR_RE = /^[A-Z]{3}$/;

// Descarta lixo comum vindo de query/localStorage: "null", "undefined", "", "0"
function cleanStr(v, max) {
  if (v == null) return undefined;
  const s = String(v).trim();
  if (!s || s === 'null' || s === 'undefined' || s === 'NaN') return undefined;
  return s.slice(0, max || 500);
}

function validIp(v) {
  const s = cleanStr(v, 45);
  if (!s) return undefined;
  if (IPV4_RE.test(s)) {
    return s.split('.').every((o) => Number(o) <= 255) ? s : undefined;
  }
  return s.includes(':') && IPV6_RE.test(s) ? s : undefined; // IPv6
}

// URL precisa ser absoluta e válida — truncar no meio de um param quebraria
function validUrl(v) {
  const s = cleanStr(v, 2000);
  if (!s) return undefined;
  try { const u = new URL(s); return (u.protocol === 'http:' || u.protocol === 'https:') ? s : undefined; }
  catch (_) { return undefined; }
}

// Monta o objeto `user` (identidade) a partir do payload comum.
function buildUser(p) {
  const user = {};
  const e = hash(cleanStr(p.email, 320));            if (e) user.email = e;
  const ph = hashPhone(cleanStr(p.phone, 30));       if (ph) user.phone = ph;
  const exRaw = cleanStr(p.externalId, 200) || externalIdFromLead(cleanStr(p.leadId, 200));
  // aceita apenas hex SHA-256 como "já-hasheado"; qualquer outra coisa é hasheada
  if (exRaw) user.external_id = SHA256_RE.test(exRaw) ? exRaw : hash(exRaw);
  const ip = validIp(p.ip);                          if (ip) user.ip = ip;
  const ua = cleanStr(p.userAgent, 500);             if (ua) user.user_agent = ua;
  const tc = cleanStr(p.ttclid, 500);                if (tc) user.ttclid = tc;
  const tp = cleanStr(p.ttp, 500);                   if (tp) user.ttp = tp;
  return user;
}

// Score de correspondência (proxy do Event Match Quality do TikTok):
// pesa os sinais de identidade que REALMENTE entraram no payload.
// ttclid é o sinal mais forte (clique atribuível), depois email/phone (PII).
const MATCH_WEIGHTS = { ttclid: 3, email: 2, phone: 2, external_id: 1, ttp: 1, ip: 0.5, user_agent: 0.5 };
const MATCH_MAX = Object.values(MATCH_WEIGHTS).reduce((a, b) => a + b, 0); // 10
function matchScore(user) {
  let score = 0;
  const fields = [];
  Object.keys(MATCH_WEIGHTS).forEach((k) => {
    if (user[k]) { score += MATCH_WEIGHTS[k]; fields.push(k); }
  });
  return { score: Math.round((score / MATCH_MAX) * 10), fields }; // 0–10
}

function buildProperties(p) {
  const properties = {};
  // NaN e Infinity passam em `typeof === 'number'` — Number.isFinite não
  const v = Number(p.value);
  if (p.value != null && Number.isFinite(v) && v >= 0) {
    properties.value = Math.round(v * 100) / 100; // 2 casas: TikTok espera moeda
    const cur = String(p.currency || '').toUpperCase();
    properties.currency = CUR_RE.test(cur) ? cur : 'EUR'; // value sem currency é rejeitado
  }
  if (Array.isArray(p.contents) && p.contents.length) {
    // sanitiza cada item: só campos válidos, com tipos certos
    const items = p.contents.map((c) => {
      const it = {};
      const cid = cleanStr(c.content_id, 100);       if (cid) it.content_id = cid;
      const cname = cleanStr(c.content_name, 100);   if (cname) it.content_name = cname;
      const ccat = cleanStr(c.content_category, 100); if (ccat) it.content_category = ccat;
      const price = Number(c.price);
      if (c.price != null && Number.isFinite(price) && price >= 0) it.price = Math.round(price * 100) / 100;
      const qty = Number(c.quantity);
      it.quantity = Number.isFinite(qty) && qty >= 1 ? Math.round(qty) : 1;
      return it;
    }).filter((it) => it.content_id || it.content_name);
    if (items.length) { properties.contents = items; properties.content_type = 'product'; }
  }
  return properties;
}

// event_time: TikTok rejeita timestamps no futuro ou com mais de 7 dias.
// Clamp para "agora" em vez de perder o evento inteiro por um relógio torto.
function validEventTime(t) {
  const now = Math.floor(Date.now() / 1000);
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return now;
  const sec = n > 1e12 ? Math.floor(n / 1000) : Math.floor(n); // aceita ms por engano
  if (sec > now + 60 || sec < now - 7 * 86400) return now;
  return sec;
}

// fetch com timeout: a API do TikTok nunca pode pendurar um webhook/checkout.
function fetchWithTimeout(url, opts, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms || 6000);
  return fetch(url, { ...opts, signal: ctl.signal }).finally(() => clearTimeout(t));
}

// ── Fila de retry persistente ──────────────────────────────────────────────
// Se o TikTok falhar mesmo após os retries imediatos (instabilidade longa,
// restart no meio do disparo), o evento entra aqui e é re-tentado com
// backoff crescente por até 24h. Nenhuma venda fica sem CompletePayment.
const RETRY_BACKOFF_MS = [2 * 60e3, 10 * 60e3, 30 * 60e3, 2 * 3600e3, 6 * 3600e3]; // 2m→6h
const RETRY_MAX_AGE_MS = 24 * 3600e3;
const RETRY_QUEUE_CAP = 300;
let retryQueue = [];
let retryLoaded = false;

function persistRetryQueue() { rdb.saveCapiRetryQueue(retryQueue).catch(() => {}); }

async function ensureRetryLoaded() {
  if (retryLoaded) return;
  retryLoaded = true;
  const saved = await rdb.loadCapiRetryQueue();
  if (saved && saved.length) retryQueue = saved.concat(retryQueue).slice(0, RETRY_QUEUE_CAP);
}

function queueRetry(pixel, p, eventId) {
  // payload mínimo e serializável (sem funções, sem objetos circulares)
  const item = {
    slug: pixel.slug || pixel.pixelCode,
    eventId,
    p: {
      event: p.event, eventId, leadId: p.leadId, email: p.email, phone: p.phone,
      externalId: p.externalId, ip: p.ip, userAgent: p.userAgent, ttclid: p.ttclid,
      ttp: p.ttp, url: p.url, value: p.value, currency: p.currency,
      contents: p.contents, eventTime: p.eventTime || Math.floor(Date.now() / 1000)
    },
    attempt: 0,
    firstAt: Date.now(),
    nextAt: Date.now() + RETRY_BACKOFF_MS[0]
  };
  retryQueue.push(item);
  if (retryQueue.length > RETRY_QUEUE_CAP) retryQueue = retryQueue.slice(-RETRY_QUEUE_CAP);
  persistRetryQueue();
}

async function drainRetryQueue() {
  await ensureRetryLoaded();
  if (!retryQueue.length) return;
  const now = Date.now();
  const due = retryQueue.filter((it) => it.nextAt <= now);
  if (!due.length) return;
  for (const item of due) {
    // expirou (24h) ou esgotou o backoff → descarta de vez
    if (now - item.firstAt > RETRY_MAX_AGE_MS || item.attempt >= RETRY_BACKOFF_MS.length) {
      retryQueue = retryQueue.filter((x) => x !== item);
      continue;
    }
    // re-resolve o pixel: token pode ter sido atualizado no painel
    const pixel = pixelStore.get(item.slug);
    if (!pixel || !pixel.active) { retryQueue = retryQueue.filter((x) => x !== item); continue; }
    const json = await sendToPixel(pixel, { ...item.p, _fromRetryQueue: true });
    if (json && json.code === 0) {
      retryQueue = retryQueue.filter((x) => x !== item);          // sucesso
    } else if (json && json.code != null && json.code !== 0) {
      retryQueue = retryQueue.filter((x) => x !== item);          // 4xx: rejeição definitiva
    } else {
      item.attempt += 1;                                          // rede/5xx: reagenda
      item.nextAt = now + (RETRY_BACKOFF_MS[item.attempt] || RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1]);
    }
  }
  persistRetryQueue();
}

// varre a cada 60s; unref() para não segurar o processo vivo no shutdown
const retryTimer = setInterval(() => { drainRetryQueue().catch(() => {}); }, 60e3);
if (retryTimer.unref) retryTimer.unref();

function retryQueueSize() { return retryQueue.length; }

/**
 * Envia UM evento para UM pixel específico.
 * Timeout de 6s por tentativa + 1 retry automático em falha transitória
 * (erro de rede/timeout/5xx) — o evento mais valioso (CompletePayment)
 * não pode se perder por um soluço de rede.
 * @param {object} pixel  Objeto do pixel-store (pixelCode, accessToken, testEventCode)
 * @param {object} p      Payload do evento (event, eventId, identidade, valor…)
 */
async function sendToPixel(pixel, p) {
  if (!pixel || !pixel.pixelCode || !pixel.accessToken) {
    return { skipped: true, reason: 'pixel sem código/token' };
  }
  // event_id é obrigatório para dedup — gera fallback se faltar
  const eventId = p.eventId || (p.event + '.' + crypto.randomBytes(8).toString('hex'));

  const pageUrl = validUrl(p.url);
  const user = buildUser(p);
  const emq = matchScore(user);
  const payload = {
    event_source: 'web',
    event_source_id: pixel.pixelCode,
    data: [{
      event: p.event,
      event_time: validEventTime(p.eventTime),
      event_id: eventId,
      user,
      properties: buildProperties(p),
      page: pageUrl ? { url: pageUrl } : undefined
    }]
  };
  if (pixel.testEventCode) payload.test_event_code = pixel.testEventCode;
  const body = JSON.stringify(payload); // serializa UMA vez (reusado no retry)

  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 600)); // backoff curto
    try {
      const resp = await fetchWithTimeout(TIKTOK_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Access-Token': pixel.accessToken },
        body
      }, 6000);
      // 5xx = instabilidade do TikTok → vale retry; 4xx = erro nosso → não vale
      if (resp.status >= 500 && attempt === 0) { lastErr = new Error('HTTP ' + resp.status); continue; }
      const json = await resp.json().catch(() => ({}));
      const ok = json && json.code === 0;
      pushLog({
        acc: pixel.acc || null,
        pixel: pixel.slug || pixel.pixelCode,
        event: p.event,
        eventId,
        leadId: p.leadId,
        status: ok ? 'ok' : 'erro',
        emq: emq.score,
        emqFields: emq.fields,
        response: { code: json.code, message: json.message || json.msg, retry: attempt || undefined }
      });
      return json;
    } catch (err) {
      lastErr = err; // rede/timeout → tenta de novo uma vez
    }
  }
  pushLog({
    acc: pixel.acc || null,
    pixel: pixel.slug || pixel.pixelCode,
    event: p.event,
    eventId,
    leadId: p.leadId,
    status: 'erro',
    emq: emq.score,
    emqFields: emq.fields,
    response: { message: (lastErr && lastErr.message) || 'falha desconhecida', retried: true }
  });
  // falha de rede/5xx persistente → entra na fila de retry de longo prazo
  // (_fromRetryQueue evita re-enfileirar o que a própria fila disparou)
  if (!p._fromRetryQueue) queueRetry(pixel, p, eventId);
  return { error: (lastErr && lastErr.message) || 'falha desconhecida' };
}

/**
 * Dispara um evento para TODOS os pixels ativos que aceitam esse evento na rota.
 * Multi-tenant: quando accountId é informado, só dispara para os pixels da conta.
 * @param {string} eventName
 * @param {object} p           Payload (identidade, valor, url…)
 * @param {string} [routeHint] Rota para filtrar pixels (padrão '*')
 * @param {string} [accountId] Conta dona dos pixels (isola tenants)
 */
async function dispatchToAll(eventName, p, routeHint, accountId) {
  const acc = accountId || p.acc || null;
  const targets = pixelStore.forEvent(acc, eventName, routeHint || '*');
  if (!targets.length) return { dispatched: 0 };
  // allSettled: um pixel com problema NUNCA derruba o disparo dos demais
  const settled = await Promise.allSettled(
    targets.map((px) => sendToPixel(px, { ...p, event: eventName }))
  );
  const results = settled.map((s) => (s.status === 'fulfilled' ? s.value : { error: String(s.reason) }));
  return { dispatched: targets.length, results };
}

/**
 * Envio de teste (painel): valida token/pixel na hora e retorna a resposta crua.
 */
async function testPixel(pixel, ctx) {
  ctx = ctx || {};
  const eventId = 'test.' + crypto.randomBytes(6).toString('hex');
  // A Events API exige AO MENOS UM identificador de usuário (ip+ua, email,
  // phone, ttclid ou external_id). Sem isso o teste falhava SEMPRE com erro
  // de parâmetro, mesmo com código/token corretos. Usa o ip/ua reais de quem
  // clicou em "Testar" + um external_id sintético como sinal extra.
  const json = await sendToPixel(pixel, {
    event: 'ViewContent',
    eventId,
    url: 'https://example.com/teste-pixel',
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    externalId: hash('teste-painel.' + eventId),
    value: 0,
    currency: 'EUR'
  });
  return { eventId, response: json };
}

// Compat: assinatura antiga (1 pixel via env). Redireciona para dispatchToAll.
async function sendTikTokEvent(p) {
  return dispatchToAll(p.event, p, p.route || '*', p.acc || null);
}

module.exports = {
  hash, hashPhone, externalIdFromLead,
  sendToPixel, dispatchToAll, testPixel, sendTikTokEvent,
  recentLog, recentLogAsync,
  retryQueueSize, drainRetryQueue
};
