'use client'

import { useEffect } from 'react'
import { playEventSound, initAudio } from '@/lib/sale-alerts'
import { isSoundEnabled } from '@/lib/notify-prefs'
import { toast } from '@/lib/toast'

/* Som local do painel: o service worker recebe o push e avisa as abas abertas.
   Só tocamos WebAudio quando a dashboard está VISÍVEL; em background/fechada,
   o navegador e o sistema operacional controlam som, Foco e apresentação. */
export function PushSound() {
  useEffect(() => {
    // 1. Audio Unlocker (iOS Safari)
    // O Safari exige ativação do usuário para WebAudio. Inicializamos no
    // primeiro toque para permitir feedback local quando a dashboard estiver visível.
    const unlockAudio = () => {
      initAudio()
      window.removeEventListener('click', unlockAudio)
      window.removeEventListener('touchstart', unlockAudio)
    }
    window.addEventListener('click', unlockAudio, { once: true })
    window.addEventListener('touchstart', unlockAudio, { once: true })

    // 2. Escuta os eventos do Service Worker
    if (!('serviceWorker' in navigator)) return
    let salePulseTimer: number | null = null
    const onMessage = (event: MessageEvent) => {
      const msg = event.data
      if (!msg || !['roi-notification', 'roi-sound'].includes(msg.type)) return
      if (document.visibilityState !== 'visible') return

      const eventName = String(msg.event || '')
      const title = String(msg.title || '')
      const body = String(msg.body || '')
      const duration = eventName === 'daily' ? 7000 : 4500

      if (msg.type === 'roi-notification') {
        if (eventName === 'sale') {
          toast.success(title || 'Venda aprovada', { hint: body || undefined, duration })
          document.documentElement.dataset.roiSalePulse = 'on'
          if (salePulseTimer !== null) window.clearTimeout(salePulseTimer)
          salePulseTimer = window.setTimeout(() => {
            delete document.documentElement.dataset.roiSalePulse
            salePulseTimer = null
          }, 900)
        } else if (['failed', 'refund', 'dispute', 'ads_failure', 'ads_breaker'].includes(eventName)) {
          toast.error(title || 'Atenção necessária', { hint: body || undefined, duration: 6500 })
        } else if (['daily', 'ads_proposal', 'ads_rejected', 'ads_cap'].includes(eventName)) {
          toast.info(title || 'Atualização do ROI-NADOS', { hint: body || undefined, duration })
        }
        window.dispatchEvent(new CustomEvent('roi:foreground-notification', {
          detail: { event: eventName, title, body, url: msg.url || '/dashboard' },
        }))
      }

      // Preferência local por aparelho/evento: desligado afeta apenas o som,
      // não o feedback visual dentro da dashboard.
      if (msg.sound && isSoundEnabled(eventName)) {
        playEventSound(msg.sound)
      }
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    
    return () => {
      window.removeEventListener('click', unlockAudio)
      window.removeEventListener('touchstart', unlockAudio)
      navigator.serviceWorker.removeEventListener('message', onMessage)
      if (salePulseTimer !== null) window.clearTimeout(salePulseTimer)
      delete document.documentElement.dataset.roiSalePulse
    }
  }, [])

  return null
}
