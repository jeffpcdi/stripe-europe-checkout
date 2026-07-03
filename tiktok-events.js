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

// Telefone: normaliza para E.164 (só dígitos com +) antes do hash
function hashPhone(phone) {
  if (!phone) return undefined;
  const clean = String(phone).replace(/[^0-9+]/g, '');
  return clean ? hash(clean) : undefined;
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
    pixel: entry.pixel,
    event: entry.event,
    eventId: entry.eventId,
    leadId: entry.leadId,
    status: entry.status,
    response: entry.response
  };
  log.unshift(row);
  if (log.length > LOG_MAX) log.length = LOG_MAX;
  // Upstash Redis: write rápido (~1ms), TTL automático de 14 dias
  rdb.pushPixelLog(row).catch(() => {});
  // Neon: backup durável (estruturado para queries analíticas)
  if (db.enabled) db.insertPixelEvent(row);
  return row;
}
function recentLog(n) { return log.slice(0, n || 50); }

// Versão async: usa Redis como fallback se memória local estiver vazia
async function recentLogAsync(n) {
  if (log.length > 0) return log.slice(0, n || 100);
  // após restart: busca do Redis
  const redisRows = await rdb.loadPixelLog(n || 100);
  if (redisRows && redisRows.length) {
    // re-popula memória local para próximas chamadas
    log.push(...redisRows.slice(0, LOG_MAX));
    return redisRows;
  }
  return [];
}

// Monta o objeto `user` (identidade) a partir do payload comum.
function buildUser(p) {
  const user = {};
  const e = hash(p.email);                          if (e) user.email = e;
  const ph = hashPhone(p.phone);                    if (ph) user.phone = ph;
  const ex = p.externalId || externalIdFromLead(p.leadId);
  if (ex) user.external_id = ex.length === 64 ? ex : hash(ex); // já-hasheado ou puro
  if (p.ip) user.ip = p.ip;
  if (p.userAgent) user.user_agent = p.userAgent;
  if (p.ttclid) user.ttclid = p.ttclid;
  if (p.ttp) user.ttp = p.ttp;
  return user;
}

function buildProperties(p) {
  const properties = {};
  if (typeof p.value === 'number') properties.value = p.value;
  if (p.currency) properties.currency = String(p.currency).toUpperCase();
  if (p.contents) { properties.contents = p.contents; properties.content_type = 'product'; }
  return properties;
}

// fetch com timeout: a API do TikTok nunca pode pendurar um webhook/checkout.
function fetchWithTimeout(url, opts, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms || 6000);
  return fetch(url, { ...opts, signal: ctl.signal }).finally(() => clearTimeout(t));
}

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

  const payload = {
    event_source: 'web',
    event_source_id: pixel.pixelCode,
    data: [{
      event: p.event,
      event_time: p.eventTime || Math.floor(Date.now() / 1000),
      event_id: eventId,
      user: buildUser(p),
      properties: buildProperties(p),
      page: p.url ? { url: p.url } : undefined
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
        pixel: pixel.slug || pixel.pixelCode,
        event: p.event,
        eventId,
        leadId: p.leadId,
        status: ok ? 'ok' : 'erro',
        response: { code: json.code, message: json.message || json.msg, retry: attempt || undefined }
      });
      return json;
    } catch (err) {
      lastErr = err; // rede/timeout → tenta de novo uma vez
    }
  }
  pushLog({
    pixel: pixel.slug || pixel.pixelCode,
    event: p.event,
    eventId,
    leadId: p.leadId,
    status: 'erro',
    response: { message: (lastErr && lastErr.message) || 'falha desconhecida', retried: true }
  });
  return { error: (lastErr && lastErr.message) || 'falha desconhecida' };
}

/**
 * Dispara um evento para TODOS os pixels ativos que aceitam esse evento na rota.
 * @param {string} eventName
 * @param {object} p           Payload (identidade, valor, url…)
 * @param {string} [routeHint] Rota para filtrar pixels (padrão '*')
 */
async function dispatchToAll(eventName, p, routeHint) {
  const targets = pixelStore.forEvent(eventName, routeHint || '*');
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
async function testPixel(pixel) {
  const eventId = 'test.' + crypto.randomBytes(6).toString('hex');
  const json = await sendToPixel(pixel, {
    event: 'ViewContent',
    eventId,
    url: 'https://example.com/teste-pixel',
    value: 0,
    currency: 'EUR'
  });
  return { eventId, response: json };
}

// Compat: assinatura antiga (1 pixel via env). Redireciona para dispatchToAll.
async function sendTikTokEvent(p) {
  return dispatchToAll(p.event, p, p.route || '*');
}

module.exports = {
  hash, hashPhone, externalIdFromLead,
  sendToPixel, dispatchToAll, testPixel, sendTikTokEvent,
  recentLog, recentLogAsync
};
