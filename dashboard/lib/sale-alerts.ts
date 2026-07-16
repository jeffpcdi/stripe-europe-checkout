/* Itens 335/336: alertas de venda no feed.
   - Som: WebAudio puro (dois tons curtos), sem asset externo — não pesa o
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
    if (!globalAudioCtx) {
      initAudio()
    }
    const ctx = globalAudioCtx
    if (!ctx) return
    
    if (ctx.state === 'suspended') {
       ctx.resume()
    }

    const t = ctx.currentTime
    
    // "Ching" - O sino metálico (frequências agudas, ondas mistas)
    const playBell = (freq: number, startOffset: number, volume: number) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'triangle'
      osc.frequency.setValueAtTime(freq, t + startOffset)
      
      gain.gain.setValueAtTime(0, t + startOffset)
      gain.gain.linearRampToValueAtTime(volume, t + startOffset + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, t + startOffset + 0.8)
      
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(t + startOffset)
      osc.stop(t + startOffset + 1.0)
    }

    // "Cha" - Mecanismo mecânico da gaveta abrindo (Ruído Branco / Noise)
    const playClick = (startOffset: number, duration: number, volume: number) => {
      const bufferSize = ctx.sampleRate * duration
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
      const data = buffer.getChannelData(0)
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1 // ruído branco
      }
      const noise = ctx.createBufferSource()
      noise.buffer = buffer
      
      // Filtro para não soar como TV fora do ar, mas sim como um mecanismo metálico
      const filter = ctx.createBiquadFilter()
      filter.type = 'bandpass'
      filter.frequency.value = 1500
      filter.Q.value = 0.5
      
      const gain = ctx.createGain()
      gain.gain.setValueAtTime(volume, t + startOffset)
      gain.gain.exponentialRampToValueAtTime(0.001, t + startOffset + duration)
      
      noise.connect(filter)
      filter.connect(gain)
      gain.connect(ctx.destination)
      noise.start(t + startOffset)
    }

    // O Ritmo do Cha-Ching:
    playClick(0, 0.15, 0.4)          // O mecanismo puxa (Cha)
    playBell(1200, 0.12, 0.15)       // Sino principal (Ching)
    playBell(1500, 0.12, 0.10)       // Harmônico 1
    playBell(2400, 0.12, 0.08)       // Harmônico 2
    playClick(0.12, 0.1, 0.2)        // Barulho da gaveta batendo junto com o sino

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
