/* Itens 335/336: alertas de venda no feed.
   - Som: WebAudio puro (dois tons curtos), sem asset externo — não pesa o
     bundle e não depende de rede.
   - Notificação: só faz sentido com a aba em segundo plano; com a aba
     visível o próprio feed já mostra a venda. */

export function playSaleSound() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new Ctx()
    const play = (freq: number, at: number, dur: number) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      // envelope curto para não estalar
      gain.gain.setValueAtTime(0, ctx.currentTime + at)
      gain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + at + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + at + dur)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(ctx.currentTime + at)
      osc.stop(ctx.currentTime + at + dur + 0.05)
    }
    // "cha-ching": Mi5 → Lá5
    play(659.25, 0, 0.18)
    play(880, 0.14, 0.28)
    window.setTimeout(() => void ctx.close(), 800)
  } catch {
    // autoplay bloqueado ou WebAudio indisponível: falha em silêncio
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
