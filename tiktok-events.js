// ── TikTok Events API 2.0 — rastreamento server-side (CAPI) ───────────
// Dispara eventos direto do servidor (fonte de verdade = webhook Stripe).
// Deduplica com o pixel do navegador via event_id idêntico.
const crypto = require('crypto');

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

/**
 * Envia um evento para a TikTok Events API.
 * @param {object} p
 * @param {string} p.event        Nome do evento (ex.: 'CompletePayment')
 * @param {string} p.eventId      Mesmo event_id usado no pixel do navegador (dedup)
 * @param {number} [p.eventTime]  Unix seconds
 * @param {string} [p.email]      E-mail em texto puro (será hasheado aqui)
 * @param {string} [p.phone]      Telefone em texto puro (será hasheado aqui)
 * @param {string} [p.externalId] ID externo em texto puro (será hasheado aqui)
 * @param {string} [p.ip]         IP do cliente (não hasheado)
 * @param {string} [p.userAgent]  User-Agent do cliente (não hasheado)
 * @param {string} [p.ttclid]     TikTok click ID (cookie/URL ttclid)
 * @param {string} [p.ttp]        Cookie _ttp do pixel
 * @param {string} [p.url]        URL da página de conversão
 * @param {number} [p.value]      Valor da conversão
 * @param {string} [p.currency]   Moeda (ISO 4217)
 * @param {Array}  [p.contents]   Itens (content_id/name/price/quantity)
 */
async function sendTikTokEvent(p) {
  const accessToken = process.env.TIKTOK_ACCESS_TOKEN;
  const pixelCode = process.env.TIKTOK_PIXEL_CODE || 'D8JGKIRC77UDLID6B2O0';

  if (!accessToken) {
    console.warn('[tiktok-capi] TIKTOK_ACCESS_TOKEN não configurado — evento server-side ignorado.');
    return { skipped: true };
  }

  const user = {};
  const e = hash(p.email);            if (e) user.email = e;
  const ph = hashPhone(p.phone);      if (ph) user.phone = ph;
  const ex = hash(p.externalId || p.email); if (ex) user.external_id = ex;
  if (p.ip) user.ip = p.ip;
  if (p.userAgent) user.user_agent = p.userAgent;
  if (p.ttclid) user.ttclid = p.ttclid;
  if (p.ttp) user.ttp = p.ttp;

  const properties = {};
  if (typeof p.value === 'number') properties.value = p.value;
  if (p.currency) properties.currency = String(p.currency).toUpperCase();
  if (p.contents) { properties.contents = p.contents; properties.content_type = 'product'; }

  const payload = {
    event_source: 'web',
    event_source_id: pixelCode,
    data: [{
      event: p.event,
      event_time: p.eventTime || Math.floor(Date.now() / 1000),
      event_id: p.eventId,
      user,
      properties,
      page: p.url ? { url: p.url } : undefined
    }]
  };

  try {
    const resp = await fetch(TIKTOK_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Access-Token': accessToken },
      body: JSON.stringify(payload)
    });
    const json = await resp.json().catch(() => ({}));
    if (json && json.code === 0) {
      console.log(`[tiktok-capi] ${p.event} enviado (event_id=${p.eventId})`);
    } else {
      console.error('[tiktok-capi] Resposta inesperada:', JSON.stringify(json));
    }
    return json;
  } catch (err) {
    console.error('[tiktok-capi] Erro ao enviar evento:', err.message);
    return { error: err.message };
  }
}

module.exports = { sendTikTokEvent, hash, hashPhone };
