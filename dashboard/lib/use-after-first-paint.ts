'use client'

import { useEffect, useState } from 'react'

/**
 * Fase 4 — carregamento progressivo.
 *
 * Retorna `false` no primeiro render e vira `true` DEPOIS do first paint,
 * agendado via requestIdleCallback (fallback: setTimeout). Serve para adiar
 * dados secundários (settings, ads/status, emq-trend) para fora da janela de
 * requests simultâneas do carregamento inicial — o hero (stats + live) pinta
 * primeiro, o resto entra quando o navegador está ocioso.
 *
 * Contexto: já tivemos 12,7s de Queueing por estourar o limite de 6 conexões
 * do navegador ao disparar todas as chamadas de uma vez. Escalonar evita isso.
 */
export function useAfterFirstPaint(): boolean {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (ready) return
    type RIC = (cb: () => void, opts?: { timeout: number }) => number
    type CIC = (handle: number) => void
    const ric = (window as unknown as { requestIdleCallback?: RIC }).requestIdleCallback
    const cic = (window as unknown as { cancelIdleCallback?: CIC }).cancelIdleCallback

    let idleId = 0
    let timeoutId = 0
    if (typeof ric === 'function') {
      // timeout garante que não fica preso indefinidamente em abas muito ativas
      idleId = ric(() => setReady(true), { timeout: 2000 })
    } else {
      timeoutId = window.setTimeout(() => setReady(true), 200)
    }

    return () => {
      if (idleId && typeof cic === 'function') cic(idleId)
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [ready])

  return ready
}
