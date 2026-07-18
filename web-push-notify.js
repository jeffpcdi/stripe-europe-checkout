'use strict';

// ── Web Push — notificações nativas no iPhone/Android/desktop (sem Pushcut) ─
// iOS 16.4+ suporta Web Push para PWAs adicionadas à Tela de Início. Este
// módulo envia para TODOS os aparelhos inscritos da conta (config.webPush.subs)
// e remove inscrições mortas (404/410) automaticamente.
//
// VAPID: lê VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY do env; se ausentes, gera UMA
// vez e persiste no Neon (linha '_webpush' da tabela config) — zero setup.
// Sem persistência as chaves mudariam a cada boot e TODAS as inscrições
// existentes seriam invalidadas.

const webpush = require('web-push');
const db = require('./db');

const SUBJECT = 'mailto:notify@roi-nados.app';
let vapid = null;          // { publicKey, privateKey }
let vapidPromise = null;   // init 1× por boot

async function ensureVapid() {
  if (vapid) return vapid;
  if (!vapidPromise) {
    vapidPromise = (async () => {
      // 1) Env tem precedência (deploys com chaves fixas)
      if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
        vapid = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
      } else {
        // 2) Neon (linha especial '_webpush' — ignorada pela hidratação de contas)
        try {
          const res = await db.loadConfig('_webpush');
          if (res && res.ok && res.data && res.data.publicKey && res.data.privateKey) {
            vapid = { publicKey: res.data.publicKey, privateKey: res.data.privateKey };
          }
        } catch (_) {}
        // 3) Gera e persiste (primeira vez)
        if (!vapid) {
          vapid = webpush.generateVAPIDKeys();
          try { await db.saveConfig('_webpush', vapid); } catch (err) {
            console.error('[webpush] Falha ao persistir VAPID (inscrições podem invalidar no restart):', err.message);
          }
          console.log('[webpush] Chaves VAPID geradas e persistidas.');
        }
      }
      webpush.setVapidDetails(SUBJECT, vapid.publicKey, vapid.privateKey);
      return vapid;
    })();
  }
  return vapidPromise;
}

async function publicKey() {
  const v = await ensureVapid();
  return v.publicKey;
}

function subsFor(accountId) {
  try {
    const wp = require('./config').get(accountId).webPush || {};
    return Array.isArray(wp.subs) ? wp.subs : [];
  } catch (_) { return []; }
}

function removeSub(accountId, endpoint) {
  try {
    const config = require('./config');
    const wp = config.get(accountId).webPush || {};
    const subs = (Array.isArray(wp.subs) ? wp.subs : []).filter((s) => s.endpoint !== endpoint);
    config.set(accountId, { webPush: Object.assign({}, wp, { subs }) });
  } catch (err) { console.error('[webpush] Falha ao remover inscrição morta:', err.message); }
}

function logFailure(accountId, reason) {
  try {
    require('./stats').logEvent('info', {
      acc: accountId || null,
      title: '[webpush] Notificação falhou: ' + reason,
      ref: null
    });
  } catch (_) { /* stats indisponível não pode derrubar o fluxo */ }
}

/**
 * Envia uma notificação Web Push a todos os aparelhos da conta.
 * @param {string} accountId
 * @param {object} note { title, body, url, tag }
 * @returns {boolean} true se pelo menos um aparelho recebeu
 */
async function sendWebPush(accountId, note) {
  const subs = subsFor(accountId);
  if (!subs.length) return false; // sem aparelhos = silenciosamente off
  try { await ensureVapid(); } catch (err) {
    logFailure(accountId, 'VAPID indisponível: ' + err.message);
    return false;
  }
  const payload = JSON.stringify({
    title: String(note.title || 'ROI-NADOS').slice(0, 120),
    body: String(note.body || '').slice(0, 400),
    url: String(note.url || '/dashboard').slice(0, 300),
    tag: String(note.tag || 'roinados').slice(0, 60),
    // som por evento nas abas abertas (WebAudio via SW postMessage):
    // cash | alert | tick | ping | info
    sound: String(note.sound || '').slice(0, 20),
    // evento original (sale, failed, checkout…) — usado pelas preferências
    // de som por evento no painel (notify-prefs)
    event: String(note.event || '').slice(0, 30)
  });
  let delivered = 0;
  await Promise.all(subs.map(async (sub) => {
    try {
      // Timeout de 8s (mesmo padrão do Pushcut) — push service fora do ar
      // nunca pode pendurar o webhook/checkout que disparou a notificação.
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys },
        payload,
        { TTL: 3600, timeout: 8000 }
      );
      delivered++;
    } catch (err) {
      const code = err && err.statusCode;
      if (code === 404 || code === 410) {
        // Inscrição morta (app removido / permissão revogada) — limpa.
        removeSub(accountId, sub.endpoint);
        console.log('[webpush] Inscrição expirada removida (' + code + ').');
      } else {
        console.error('[webpush] Falha no envio:', code || err.message);
        logFailure(accountId, 'HTTP ' + (code || err.message));
      }
    }
  }));
  if (delivered) console.log('[webpush] Notificação entregue a ' + delivered + ' aparelho(s).');
  return delivered > 0;
}

module.exports = { sendWebPush, publicKey, ensureVapid, subsFor };
