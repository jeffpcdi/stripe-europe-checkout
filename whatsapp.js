'use strict';

// WhatsApp Cloud API. Relatórios proativos normalmente precisam de um modelo
// aprovado pela Meta; texto livre só é usado quando o operador o habilita
// explicitamente para uma conversa ainda dentro da janela de atendimento.

function status() {
  return {
    configured: !!(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID),
    templateConfigured: !!process.env.WHATSAPP_DAILY_TEMPLATE,
    apiVersion: process.env.WHATSAPP_API_VERSION || 'v23.0',
  };
}

async function sendDailyReport(to, text, variables) {
  const st = status();
  if (!st.configured) return { ok: false, skipped: true, reason: 'not_configured' };
  const phone = String(to || '').replace(/\D/g, '').slice(0, 20);
  if (phone.length < 8) return { ok: false, skipped: true, reason: 'invalid_phone' };
  const template = String(process.env.WHATSAPP_DAILY_TEMPLATE || '').trim();
  let body;
  if (template) {
    const params = (Array.isArray(variables) ? variables : [text]).slice(0, 10).map((value) => ({
      type: 'text', text: String(value == null ? '-' : value).slice(0, 1024),
    }));
    body = {
      messaging_product: 'whatsapp', to: phone, type: 'template',
      template: {
        name: template,
        language: { code: String(process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'pt_BR') },
        components: [{ type: 'body', parameters: params }],
      },
    };
  } else if (String(process.env.WHATSAPP_ALLOW_FREEFORM || '') === 'true') {
    body = { messaging_product: 'whatsapp', recipient_type: 'individual', to: phone, type: 'text', text: { preview_url: false, body: String(text || '').slice(0, 4096) } };
  } else {
    return { ok: false, skipped: true, reason: 'template_required' };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch('https://graph.facebook.com/' + st.apiVersion + '/'
      + encodeURIComponent(process.env.WHATSAPP_PHONE_NUMBER_ID) + '/messages', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + process.env.WHATSAPP_ACCESS_TOKEN,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || (json.error && json.error.message)) {
      const error = new Error(String(json.error && json.error.message || 'WhatsApp HTTP ' + response.status).slice(0, 240));
      error.status = response.status;
      throw error;
    }
    return { ok: true, messageId: json.messages && json.messages[0] && json.messages[0].id || null };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { status, sendDailyReport };
