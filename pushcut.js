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

// ── Canal 2: Web Push nativo (iPhone/Android/desktop) ────────────────
// Fan-out: toda notificação que passaria pelo Pushcut também vai aos
// aparelhos inscritos via Web Push (com copy própria do notify-copy).
// Os toggles de evento são checados ANTES dos call sites — valem para ambos.

// Evento (notify-copy) → grupo de preferência do Web Push. Espelha a
// taxonomia usada na dashboard (notify-prefs.ts). Desconhecidos = system.
function eventGroup(event) {
  switch (event) {
    case 'sale': case 'test': return 'sale';
    case 'failed': return 'failed';
    case 'refund': return 'refund';
    case 'dispute': return 'dispute';
    case 'checkout': return 'checkout';
    case 'login': return 'login';
    case 'ads': case 'ads_breaker': case 'ads_cap': return 'ads';
    default: return 'system'; // daily, watchdog, desconhecidos
  }
}

// Preferências por evento do Web Push (webPush.events no config da conta).
// Ausente = default: tudo ligado EXCETO checkout (muito ruidoso — cada
// checkout aberto viraria push). Independente dos toggles do Pushcut.
function webPushEventEnabled(accountId, event) {
  let events = {};
  try {
    events = (require('./config').get(accountId).webPush || {}).events || {};
  } catch (_) {}
  const group = eventGroup(event);
  if (typeof events[group] === 'boolean') return events[group];
  return group !== 'checkout'; // default
}

async function sendViaWebPush(notificationName, payload, accountId, meta) {
  try {
    const funMode = (require('./config').get(accountId).webPush || {}).funMode !== false;
    const note = require('./notify-copy').build({
      name: notificationName, payload, meta, funMode, accountId
    });
    // Central de notificações do painel (sino no header): registra TODO
    // evento construído — mesmo sem aparelhos inscritos ou com o push do
    // grupo desligado, o histórico é a fonte da verdade. Fire-and-forget.
    try { require('./redis').pushNotifLog(accountId, note).catch(() => {}); } catch (_) {}
    const webPushNotify = require('./web-push-notify');
    if (!webPushNotify.subsFor(accountId).length) return false; // sem aparelhos
    // Toggle por evento (só do canal Web Push; o teste passa sempre para o
    // usuário conseguir validar o aparelho mesmo com "venda" desligada).
    const ev = note.event || '';
    if (ev !== 'test' && !webPushEventEnabled(accountId, ev)) return false;
    return await webPushNotify.sendWebPush(accountId, note);
  } catch (err) {
    console.error('[webpush] Erro no fan-out:', err.message);
    return false;
  }
}

/**
 * Fan-out: envia pelos DOIS canais (Pushcut + Web Push). Retorna true se
 * pelo menos um canal entregou. `meta` (opcional) carrega o evento e os
 * dados para a copy do Web Push ({event, valor, produto, cliente, ...}).
 */
async function sendPushcut(notificationName, payload, accountId, meta) {
  const [pcOk, wpOk] = await Promise.all([
    sendViaPushcut(notificationName, payload, accountId),
    sendViaWebPush(notificationName, payload, accountId, meta)
  ]);
  return pcOk || wpOk;
}

async function sendViaPushcut(notificationName, payload, accountId) {
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
