'use client'

/**
 * Sistema de movimento único da dashboard.
 * 3 durações + 2 easings — todas as animações derivam daqui (ou dos
 * espelhos CSS --dur/--dur-fast/--dur-slow/--ease/--spring em globals.css).
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

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
  const [first, setFirst] = useState(false)
  const checked = useRef<string | null>(null)
  useEffect(() => {
    if (checked.current === key) return
    checked.current = key
    try {
      const k = `v0-once:${key}`
      const seen = sessionStorage.getItem(k)
      sessionStorage.setItem(k, '1')
      setFirst(!seen)
    } catch {
      setFirst(true)
    }
  }, [key])
  return first
}

// Um único observador atende todos os contadores, cards e o globo.
const motionListeners = new Set<() => void>()
let stopMotionWatch: (() => void) | undefined
function readMotionPreference() {
  return typeof window !== 'undefined' && (window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.anim === 'off')
}
function subscribeMotion(listener: () => void) {
  motionListeners.add(listener)
  if (!stopMotionWatch) {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => motionListeners.forEach(notify => notify())
    const observer = new MutationObserver(on)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-anim'] })
    mq.addEventListener('change', on)
    stopMotionWatch = () => { mq.removeEventListener('change', on); observer.disconnect() }
  }
  return () => {
    motionListeners.delete(listener)
    if (!motionListeners.size) { stopMotionWatch?.(); stopMotionWatch = undefined }
  }
}

/** Respeita a preferência do sistema e o controle de animações da dashboard. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeMotion, readMotionPreference, () => false)
}

/**
 * Flash transitório quando `value` muda (ex.: tick de borda em KPI).
 * Retorna true por `ms` após cada mudança — ligue a classe de animação nele.
 */
export function useValueFlash(value: unknown, ms = 400): boolean {
  const prev = useRef(value)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [flash, setFlash] = useState(false)
  useEffect(() => {
    if (Object.is(prev.current, value)) return
    prev.current = value
    setFlash(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setFlash(false), ms)
  }, [value, ms])
  useEffect(() => () => clearTimeout(timer.current), [])
  return flash
}
