'use strict';

// Central de notificações da conta. O canal principal é o Web Push nativo da
// dashboard (PWA no iPhone); Pushcut é apenas um adaptador legado opcional.
// A API pública antiga `sendPushcut` foi preservada para não quebrar call sites.

function accountConfig(accountId) {
  try { return require('./config').get(accountId) || {}; } catch (_) { return {}; }
}

function baseEndpoint(accountId) {
  const cfg = accountConfig(accountId);
  let url = (cfg.pushcut || {}).url || process.env.PUSHCUT_WEBHOOK_URL || null;
  if (!url) return null;
  return String(url).replace(/\/notifications\/[^/?#]*.*$/, '/notifications/');
}

function nativePreferencesFor(accountId) {
  const wp = accountConfig(accountId).webPush || {};
  const saved = wp.preferences || {};
  const legacy = wp.events || {};
  return {
    sales: typeof saved.sales === 'boolean'
      ? saved.sales
      : (typeof legacy.sale === 'boolean' ? legacy.sale : true),
    risks: typeof saved.risks === 'boolean'
      ? saved.risks
      : ([legacy.failed, legacy.refund, legacy.dispute, legacy.login, legacy.system].some((v) => v === true)
          || ![legacy.failed, legacy.refund, legacy.dispute, legacy.login, legacy.system].some((v) => typeof v === 'boolean')),
    automation: typeof saved.automation === 'boolean'
      ? saved.automation
      : (typeof legacy.ads === 'boolean' ? legacy.ads : true),
  };
}

function nativeGroup(event) {
  if (event === 'sale' || event === 'test') return 'sales';
  if (['failed', 'refund', 'dispute', 'login', 'watchdog'].includes(event)) return 'risks';
  if (String(event || '').startsWith('ads_') || event === 'ads') return 'automation';
  return null;
}

function nativePreferenceEnabled(accountId, event) {
  if (event === 'test') return true;
  const group = nativeGroup(event);
  return group ? nativePreferencesFor(accountId)[group] !== false : false;
}

// Só eventos úteis entram no sino. Simulações, checkouts, relatórios e
// execuções automáticas bem-sucedidas continuam nos seus painéis próprios.
function shouldRecord(event) {
  return [
    'sale', 'failed', 'refund', 'dispute', 'login', 'watchdog',
    'ads_attention', 'ads_rejected', 'ads_proposal', 'ads_failure',
    'ads_breaker', 'ads_cap',
  ].includes(event);
}

function pushcutEventEnabled(accountId, event) {
  const events = (accountConfig(accountId).pushcut || {}).events || {};
  const key = {
    sale: 'sale', failed: 'failed', refund: 'refund', dispute: 'dispute',
    checkout: 'checkout', daily: 'daily', login: 'login', watchdog: 'watchdog',
  }[event];
  if (!key) return true; // integrações antigas de Ads não tinham toggles próprios
  const defaults = {
    sale: true, failed: true, refund: true, dispute: true,
    checkout: false, daily: false, login: false, watchdog: false,
  };
  return typeof events[key] === 'boolean' ? events[key] : defaults[key];
}

function logFailure(accountId, channel, notificationName, reason) {
  try {
    require('./stats').logEvent('info', {
      acc: accountId || null,
      title: '[' + channel + '] Notificação "' + notificationName + '" falhou: ' + reason,
      ref: null,
    });
  } catch (_) {}
}

async function sendViaWebPush(notificationName, payload, accountId, meta) {
  try {
    const cfg = accountConfig(accountId).webPush || {};
    const note = require('./notify-copy').build({
      name: notificationName,
      payload,
      meta,
      funMode: cfg.funMode === true,
      accountId,
    });
    const event = note.event || '';
    note.priority = (meta && meta.priority) || (['dispute', 'ads_failure', 'ads_breaker'].includes(event) ? 'critical' : 'normal');
    note.dedupeKey = meta && meta.dedupeKey ? String(meta.dedupeKey).slice(0, 160) : '';

    if (shouldRecord(event)) {
      try { await require('./redis').pushNotifLog(accountId, note); } catch (_) {}
    }

    const webPushNotify = require('./web-push-notify');
    if (!webPushNotify.subsFor(accountId).length) return false;
    if (!nativePreferenceEnabled(accountId, event)) return false;
    return await webPushNotify.sendWebPush(accountId, note);
  } catch (err) {
    console.error('[webpush] Erro no envio:', err.message);
    return false;
  }
}

async function sendViaPushcut(notificationName, payload, accountId, meta) {
  try {
    const base = baseEndpoint(accountId);
    if (!base) return false;
    const event = meta && meta.event ? String(meta.event) : '';
    if (!pushcutEventEnabled(accountId, event)) return false;
    const url = base + encodeURIComponent(notificationName || 'Aprovada');
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: ctl.signal,
      });
    } finally { clearTimeout(timer); }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[pushcut] Falha (${res.status}) em "${notificationName}": ${body}`);
      logFailure(accountId, 'pushcut', notificationName, 'HTTP ' + res.status);
      return false;
    }
    return true;
  } catch (err) {
    const reason = err.name === 'AbortError' ? 'timeout (8s)' : err.message;
    console.error('[pushcut] Erro ao enviar:', reason);
    logFailure(accountId, 'pushcut', notificationName, reason);
    return false;
  }
}

/**
 * Envia primeiro pelo canal nativo e, se configurado, também pelo Pushcut.
 * `meta.event` determina prioridade, preferência e deep link.
 */
async function sendNotification(notificationName, payload, accountId, meta) {
  if (meta && meta.event === 'sale') {
    const compact = require('./notify-copy').compactSale(payload, meta);
    payload = Object.assign({}, payload, { title: compact.title, text: compact.body });
  }
  const [nativeOk, legacyOk] = await Promise.all([
    sendViaWebPush(notificationName, payload || {}, accountId, meta || {}),
    sendViaPushcut(notificationName, payload || {}, accountId, meta || {}),
  ]);
  return nativeOk || legacyOk;
}

const sendPushcut = sendNotification;

module.exports = {
  sendNotification,
  sendPushcut,
  nativePreferencesFor,
  nativePreferenceEnabled,
  _nativeGroup: nativeGroup,
  _shouldRecord: shouldRecord,
};
