'use client'

import { useEffect, useState } from 'react'
import { Tv, Minimize2 } from 'lucide-react'

/* Item 294: modo TV/fullscreen da Overview para telão.
   Ao ativar: fullscreen nativo + `data-tv` no <html>, que o CSS global usa
   para esconder o chrome (sidebar/header) e ampliar o conteúdo. ESC (ou sair
   do fullscreen por qualquer via) desfaz tudo — o estado segue o evento
   `fullscreenchange`, nunca o clique, então não há como dessincronizar. */
export function TvModeButton() {
  const [active, setActive] = useState(false)

  useEffect(() => {
    function onChange() {
      const on = Boolean(document.fullscreenElement)
      setActive(on)
      document.documentElement.toggleAttribute('data-tv', on)
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => {
      document.removeEventListener('fullscreenchange', onChange)
      document.documentElement.removeAttribute('data-tv')
    }
  }, [])

  async function toggle() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await document.documentElement.requestFullscreen()
    } catch {
      /* fullscreen bloqueado (iframe sem allow, iOS) — degrada sem quebrar */
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="btn-ghost !px-2.5 !py-1.5"
      aria-pressed={active}
      aria-label={active ? 'Sair do modo TV' : 'Modo TV: tela cheia para telão'}
      title={active ? 'Sair do modo TV (Esc)' : 'Modo TV (tela cheia)'}
    >
      {active ? (
        <Minimize2 className="size-4" aria-hidden="true" />
      ) : (
        <Tv className="size-4" aria-hidden="true" />
      )}
    </button>
  )
}
