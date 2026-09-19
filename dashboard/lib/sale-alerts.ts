/* Itens 335/336: alertas de venda no feed.
   - Som: WebAudio puro, curto e discreto, sem asset externo — não pesa o
     bundle e não depende de rede.
   - Notificação: só faz sentido com a aba em segundo plano; com a aba
     visível o próprio feed já mostra a venda. */

let globalAudioCtx: AudioContext | null = null

export function initAudio() {
  if (globalAudioCtx) return
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    globalAudioCtx = new Ctx()
    // Toca um som mudo (silent buffer) para forçar o desbloqueio no iOS Safari
    const buffer = globalAudioCtx.createBuffer(1, 1, 22050)
    const source = globalAudioCtx.createBufferSource()
    source.buffer = buffer
    source.connect(globalAudioCtx.destination)
    source.start(0)

    if (globalAudioCtx.state === 'suspended') {
      globalAudioCtx.resume()
    }
  } catch (e) {
    // WebAudio indisponível
  }
}

export function playSaleSound() {
  try {
    const ctx = getCtx()
    if (!ctx) return

    // Confirmação curta e limpa: duas notas, sem ruído mecânico ou cauda longa.
    // A intenção é sinalizar uma venda sem competir com o trabalho na tela.
    playTone(ctx, { freq: 880, duration: 0.16, volume: 0.09, type: 'triangle' })
    playTone(ctx, { freq: 1320, startOffset: 0.07, duration: 0.22, volume: 0.07, type: 'sine' })
    playTone(ctx, { freq: 1760, startOffset: 0.12, duration: 0.24, volume: 0.045, type: 'sine' })
  } catch {
    // autoplay bloqueado ou WebAudio indisponível: falha em silêncio
  }
}

/* ── Sons por evento (WebAudio puro, sem assets) ─────────────────────────
   Cada tipo de push tem um timbre próprio, tocado quando o painel está
   aberto (via postMessage do service worker → push-sound.tsx):
   - alert: dois tons graves descendentes (recusa/reembolso/disputa)
   - tick:  click curto e agudo (checkout iniciado)
   - ping:  confirmação curta e limpa (login)
   - info:  duas notas médias ascendentes suaves (ads/resumo)             */

/** Helper: toca um tom simples com envelope ADSR curto. */
function playTone(
  ctx: AudioContext,
  {
    freq,
    startOffset = 0,
    duration = 0.3,
    volume = 0.2,
    type = 'sine' as OscillatorType,
    freqEnd,
  }: {
    freq: number
    startOffset?: number
    duration?: number
    volume?: number
    type?: OscillatorType
    freqEnd?: number
  },
) {
  const t = ctx.currentTime + startOffset
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t)
  if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, t + duration)
  gain.gain.setValueAtTime(0, t)
  gain.gain.linearRampToValueAtTime(volume, t + 0.015)
  gain.gain.exponentialRampToValueAtTime(0.001, t + duration)
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start(t)
  osc.stop(t + duration + 0.05)
}

function getCtx(): AudioContext | null {
  if (!globalAudioCtx) initAudio()
  const ctx = globalAudioCtx
  if (!ctx) return null
  if (ctx.state === 'suspended') ctx.resume()
  return ctx
}

/** Recusa/reembolso/disputa: duas notas curtas e graves, sem alarme agressivo. */
export function playAlertSound() {
  try {
    const ctx = getCtx()
    if (!ctx) return
    playTone(ctx, { freq: 392, duration: 0.16, volume: 0.11, type: 'triangle' })
    playTone(ctx, { freq: 294, startOffset: 0.15, duration: 0.22, volume: 0.10, type: 'triangle' })
  } catch {
    // falha em silêncio
  }
}

/** Checkout iniciado: click sutil agudo — presença sem interromper. */
export function playTickSound() {
  try {
    const ctx = getCtx()
    if (!ctx) return
    playTone(ctx, { freq: 1600, duration: 0.07, volume: 0.07, type: 'triangle', freqEnd: 1350 })
  } catch {
    // falha em silêncio
  }
}

/** Login: confirmação curta em duas notas. */
export function playPingSound() {
  try {
    const ctx = getCtx()
    if (!ctx) return
    playTone(ctx, { freq: 784, duration: 0.22, volume: 0.09, type: 'sine' })
    playTone(ctx, { freq: 1175, startOffset: 0.08, duration: 0.18, volume: 0.05, type: 'sine' })
  } catch {
    // falha em silêncio
  }
}

/** Ads/resumo: duas notas médias ascendentes suaves. */
export function playInfoSound() {
  try {
    const ctx = getCtx()
    if (!ctx) return
    playTone(ctx, { freq: 494, duration: 0.14, volume: 0.08, type: 'sine' })
    playTone(ctx, { freq: 659, startOffset: 0.12, duration: 0.20, volume: 0.08, type: 'sine' })
  } catch {
    // falha em silêncio
  }
}

/** Dispatcher: toca o som certo pelo nome vindo do push (notify-copy SOUNDS). */
export function playEventSound(sound: string) {
  switch (sound) {
    case 'cash':
      playSaleSound()
      break
    case 'alert':
      playAlertSound()
      break
    case 'tick':
      playTickSound()
      break
    case 'ping':
      playPingSound()
      break
    case 'info':
      playInfoSound()
      break
    default:
      break
  }
}

/** Pede permissão se necessário. Retorna true se pode notificar. */
export async function ensureNotifyPermission(): Promise<boolean> {
  if (typeof Notification === 'undefined') return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  try {
    return (await Notification.requestPermission()) === 'granted'
  } catch {
    return false
  }
}

export function notifySale(title: string, body: string) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  // aba visível: o feed já mostra a venda, notificar seria redundante
  if (!document.hidden) return
  try {
    const n = new Notification(title, { body, tag: 'roi-sale', icon: '/favicon.ico' })
    n.onclick = () => {
      window.focus()
      n.close()
    }
  } catch {
    // alguns browsers exigem service worker; falha em silêncio
  }
}
