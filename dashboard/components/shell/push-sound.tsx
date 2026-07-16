'use client'

import { useEffect } from 'react'
import { playSaleSound, initAudio } from '@/lib/sale-alerts'

/* Som nas notificações push: o service worker (sw.js) recebe o push e manda
   postMessage({type:'roi-sound', sound:'cash'}) para as abas abertas — aqui
   tocamos o cha-ching de dinheiro via WebAudio (mesmo som do feed de vendas).
   Com o app fechado, o sistema toca o som padrão (limite da Apple no iOS). */
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
      if (msg && msg.type === 'roi-sound' && msg.sound === 'cash') {
        playSaleSound()
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
