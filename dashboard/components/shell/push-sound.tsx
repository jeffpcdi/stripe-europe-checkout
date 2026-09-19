'use client'

import { useEffect } from 'react'
import { playEventSound, initAudio } from '@/lib/sale-alerts'
import { isSoundEnabled } from '@/lib/notify-prefs'

/* Som local do painel: o service worker recebe o push e avisa as abas abertas.
   Só tocamos WebAudio quando a dashboard está VISÍVEL; em background/fechada,
   o navegador e o sistema operacional controlam som, Foco e apresentação. */
export function PushSound() {
  useEffect(() => {
    // 1. Audio Unlocker (iOS Safari)
    // O Safari bloqueia sons reproduzidos fora de um evento de clique.
    // Para que as notificações toquem som em background quando o app estiver
    // aberto, interceptamos o PRIMEIRO clique/toque na tela e inicializamos
    // o AudioContext com um buffer mudo. A partir desse momento, ele fica destravado.
    const unlockAudio = () => {
      initAudio()
      window.removeEventListener('click', unlockAudio)
      window.removeEventListener('touchstart', unlockAudio)
    }
    window.addEventListener('click', unlockAudio, { once: true })
    window.addEventListener('touchstart', unlockAudio, { once: true })

    // 2. Escuta os eventos do Service Worker
    if (!('serviceWorker' in navigator)) return
    const onMessage = (event: MessageEvent) => {
      const msg = event.data
      if (msg && msg.type === 'roi-sound' && msg.sound) {
        // Em segundo plano, o SO já decide som/Foco da notificação. Evita
        // duplicar o alerta com WebAudio em uma aba escondida.
        if (document.visibilityState !== 'visible') return
        // Preferência local por aparelho/evento: desligado → silêncio.
        if (!isSoundEnabled(msg.event || '')) return
        playEventSound(msg.sound)
      }
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    
    return () => {
      window.removeEventListener('click', unlockAudio)
      window.removeEventListener('touchstart', unlockAudio)
      navigator.serviceWorker.removeEventListener('message', onMessage)
    }
  }, [])

  return null
}
