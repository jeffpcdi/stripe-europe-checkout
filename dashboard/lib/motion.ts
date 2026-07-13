'use client'

/**
 * Sistema de movimento único da dashboard.
 * 3 durações + 2 easings — todas as animações derivam daqui (ou dos
 * espelhos CSS --dur/--dur-fast/--dur-slow/--ease/--spring em globals.css).
 */
import { useEffect, useRef, useState } from 'react'

export const DUR_MICRO = 120 // micro-feedback (hover, tick)
export const DUR_BASE = 240 // transições padrão
export const DUR_ENTER = 600 // entradas de seção/página

export const EASE_OUT = 'cubic-bezier(0.25, 1, 0.5, 1)' // ease-out-quart
export const SPRING = 'cubic-bezier(0.34, 1.56, 0.64, 1)' // spring leve

/**
 * True apenas na primeira montagem da chave nesta sessão do navegador.
 * Usado para rodar entradas em cascata uma única vez (não a cada navegação).
 */
export function useOncePerSession(key: string): boolean {
  const [first] = useState(() => {
    if (typeof window === 'undefined') return false
    try {
      const k = `v0-once:${key}`
      if (sessionStorage.getItem(k)) return false
      sessionStorage.setItem(k, '1')
      return true
    } catch {
      return true
    }
  })
  return first
}

/** Detecta prefers-reduced-motion (SSR-safe; default false). */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const on = (e: MediaQueryListEvent) => setReduced(e.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return reduced
}

/**
 * Flash transitório quando `value` muda (ex.: tick de borda em KPI).
 * Retorna true por `ms` após cada mudança — ligue a classe de animação nele.
 */
export function useValueFlash(value: unknown, ms = 400): boolean {
  const prev = useRef(value)
  const [flash, setFlash] = useState(false)
  useEffect(() => {
    if (Object.is(prev.current, value)) return
    prev.current = value
    setFlash(true)
    const t = window.setTimeout(() => setFlash(false), ms)
    return () => window.clearTimeout(t)
  }, [value, ms])
  return flash
}
