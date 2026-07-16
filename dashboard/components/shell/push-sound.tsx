'use client'

import { useEffect } from 'react'
import { playSaleSound } from '@/lib/sale-alerts'

/* Som nas notificações push: o service worker (sw.js) recebe o push e manda
   postMessage({type:'roi-sound', sound:'cash'}) para as abas abertas — aqui
   tocamos o cha-ching de dinheiro via WebAudio (mesmo som do feed de vendas).
   Com o app fechado, o sistema toca o som padrão (limite da Apple no iOS). */
export function PushSound() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const onMessage = (event: MessageEvent) => {
      const msg = event.data
      if (msg && msg.type === 'roi-sound' && msg.sound === 'cash') {
        playSaleSound()
      }
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [])

  return null
}
