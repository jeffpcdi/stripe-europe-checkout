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

/**
 * Envia UM evento para UM pixel específico.
 * @param {object} pixel  Objeto do pixel-store (pixelCode, accessToken, testEventCode)
 * @param {object} p      Payload do evento (event, eventId, identidade, valor…)
 */
async function sendToPixel(pixel, p) {
  if (!pixel || !pixel.pixelCode || !pixel.accessToken) {
    return { skipped: true, reason: 'pixel sem código/token' };
  }

  const payload = {
    event_source: 'web',
    event_source_id: pixel.pixelCode,
    data: [{
      event: p.event,
      event_time: p.eventTime || Math.floor(Date.now() / 1000),
      event_id: p.eventId,
      user: buildUser(p),
      properties: buildProperties(p),
      page: p.url ? { url: p.url } : undefined
    }]
  };
  if (pixel.testEventCode) payload.test_event_code = pixel.testEventCode;

  try {
    const resp = await fetch(TIKTOK_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Access-Token': pixel.accessToken },
      body: JSON.stringify(payload)
    });
    const json = await resp.json().catch(() => ({}));
    const ok = json && json.code === 0;
    pushLog({
      pixel: pixel.slug || pixel.pixelCode,
      event: p.event,
      eventId: p.eventId,
      leadId: p.leadId,
      status: ok ? 'ok' : 'erro',
      response: { code: json.code, message: json.message || json.msg }
    });
    return json;
  } catch (err) {
    pushLog({
      pixel: pixel.slug || pixel.pixelCode,
      event: p.event,
      eventId: p.eventId,
      leadId: p.leadId,
      status: 'erro',
      response: { message: err.message }
    });
    return { error: err.message };
  }
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
  const results = await Promise.all(
    targets.map((px) => sendToPixel(px, { ...p, event: eventName }))
  );
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
