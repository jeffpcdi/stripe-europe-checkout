'use strict';

// ── Pushcut — notificações de eventos do gateway ─────────────────────
// A URL do webhook é configurada pela dashboard (aba Configurações) e fica
// persistida no config store (Neon); a env PUSHCUT_WEBHOOK_URL é fallback.
// O nome final da notificação (/notifications/<Nome>) é trocado por evento,
// permitindo criar notificações separadas no app Pushcut (Aprovada, Recusada, etc.).
function baseEndpoint(accountId) {
  let url = null;
  try {
    const pc = require('./config').get(accountId).pushcut || {};
    if (pc.url) url = pc.url;
  } catch (_) {}
  if (!url) url = process.env.PUSHCUT_WEBHOOK_URL || null;
  if (!url) return null; // sem URL configurada = notificações desligadas
  // remove o nome da notificação no fim para poder trocá-lo por evento
  return url.replace(/\/notifications\/[^/?#]*.*$/, '/notifications/');
}

/**
 * Envia uma notificação para o Pushcut.
 * @param {string} notificationName - nome da notificação no Pushcut (ex.: 'Aprovada')
 * @param {object} payload - { title, text, ...extras aceitos pela API do Pushcut }
 */
async function sendPushcut(notificationName, payload, accountId) {
  try {
    const base = baseEndpoint(accountId);
    if (!base) return false; // sem webhook configurado — silenciosamente off
    const url = base + encodeURIComponent(notificationName || 'Aprovada');
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
