'use strict';

// ── Pushcut — notificações de vendas ──────────────────────────────────
// Base do webhook. Pode ser sobrescrita via env PUSHCUT_WEBHOOK_URL.
// O nome final da notificação (/notifications/<Nome>) é trocado por evento,
// permitindo criar notificações separadas no app Pushcut (Aprovada, Recusada, etc.).
const DEFAULT_URL = 'https://api.pushcut.io/RHm0FW4CoPcGO6IUEjZyL/notifications/Aprovada';

function baseEndpoint() {
  const url = process.env.PUSHCUT_WEBHOOK_URL || DEFAULT_URL;
  // remove o nome da notificação no fim para poder trocá-lo por evento
  return url.replace(/\/notifications\/[^/?#]*.*$/, '/notifications/');
}

/**
 * Envia uma notificação para o Pushcut.
 * @param {string} notificationName - nome da notificação no Pushcut (ex.: 'Aprovada')
 * @param {object} payload - { title, text, ...extras aceitos pela API do Pushcut }
 */
async function sendPushcut(notificationName, payload) {
  try {
    const url = baseEndpoint() + encodeURIComponent(notificationName || 'Aprovada');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[pushcut] Falha (${res.status}) em "${notificationName}": ${body}`);
      return false;
    }
    console.log(`[pushcut] Notificação "${notificationName}" enviada.`);
    return true;
  } catch (err) {
    console.error('[pushcut] Erro ao enviar:', err.message);
    return false;
  }
}

module.exports = { sendPushcut };
