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
// Item 456: falha de notificação não pode ser invisível — além do console,
// registra um evento no feed da conta (o dono vê "notificação de venda
// falhou" na dashboard em vez de só descobrir que o celular ficou mudo).
function logFailure(accountId, notificationName, reason) {
  try {
    require('./stats').logEvent('info', {
      acc: accountId || null,
      title: '[pushcut] Notificação "' + notificationName + '" falhou: ' + reason,
      ref: null
    });
  } catch (_) { /* stats indisponível não pode derrubar o fluxo */ }
}

async function sendPushcut(notificationName, payload, accountId) {
  try {
    const base = baseEndpoint(accountId);
    if (!base) return false; // sem webhook configurado — silenciosamente off
    const url = base + encodeURIComponent(notificationName || 'Aprovada');
    // Item 472: timeout de 8s — o Pushcut fora do ar nunca pode pendurar o
    // webhook/checkout que disparou a notificação.
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: ctl.signal
      });
    } finally { clearTimeout(timer); }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[pushcut] Falha (${res.status}) em "${notificationName}": ${body}`);
      logFailure(accountId, notificationName, 'HTTP ' + res.status); // item 456
      return false;
    }
    console.log(`[pushcut] Notificação "${notificationName}" enviada.`);
    return true;
  } catch (err) {
    const reason = err.name === 'AbortError' ? 'timeout (8s)' : err.message;
    console.error('[pushcut] Erro ao enviar:', reason);
    logFailure(accountId, notificationName, reason); // item 456
    return false;
  }
}

module.exports = { sendPushcut };
