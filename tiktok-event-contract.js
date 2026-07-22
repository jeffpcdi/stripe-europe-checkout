'use strict';

// A dashboard mantém `CompletePayment` como nome interno para não quebrar o
// funil, webhooks e configurações antigas. Desde a revisão dos Standard Events
// do TikTok, o nome enviado ao Pixel/Events API para uma compra é `Purchase`.
function canonicalTikTokEvent(eventName) {
  return eventName === 'CompletePayment' ? 'Purchase' : eventName;
}

// Browser Pixel e Events API precisam receber o MESMO event_id para o TikTok
// deduplicar. O identificador do pedido é a única informação estável presente
// tanto na página de confirmação quanto no webhook do gateway.
function purchaseEventId(orderId) {
  const safe = String(orderId == null ? '' : orderId)
    .trim()
    .replace(/[^A-Za-z0-9._:-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 90);
  return safe ? 'Purchase.' + safe : null;
}

module.exports = { canonicalTikTokEvent, purchaseEventId };
