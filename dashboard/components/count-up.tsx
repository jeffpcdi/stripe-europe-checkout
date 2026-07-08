'use client'

import { useEffect, useRef, useState } from 'react'

// Réplica do countUp() legado: número sobe animado de 0 → valor em ~900ms
// com easing de desaceleração; re-anima quando o valor muda (com valFlash).
export function CountUp({
  value,
  format,
  duration = 900,
  className,
}: {
  value: number
  format?: (v: number) => string
  duration?: number
  className?: string
}) {
  const [display, setDisplay] = useState(0)
  const [flash, setFlash] = useState(false)
  const prevRef = useRef<number | null>(null)
  const rafRef = useRef(0)

  useEffect(() => {
    const from = prevRef.current ?? 0
    const isUpdate = prevRef.current !== null && prevRef.current !== value
    prevRef.current = value
    if (from === value) {
      setDisplay(value)
      return
    }
    if (isUpdate) {
      setFlash(true)
      const t = setTimeout(() => setFlash(false), 800)
      const start = performance.now()
      const tick = (now: number) => {
        const p = Math.min((now - start) / duration, 1)
        const eased = 1 - Math.pow(1 - p, 3)
        setDisplay(from + (value - from) * eased)
        if (p < 1) rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
      return () => {
        clearTimeout(t)
        cancelAnimationFrame(rafRef.current)
      }
    }
    const start = performance.now()
    const tick = (now: number) => {
      const p = Math.min((now - start) / duration, 1)
      const eased = 1 - Math.pow(1 - p, 3)
      setDisplay(from + (value - from) * eased)
      if (p < 1) rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [value, duration])

  const text = format ? format(display) : Math.round(display).toLocaleString('pt-BR')

  return (
    <span className={`${className ?? ''} ${flash ? 'anim-val-flash' : ''}`.trim()}>
      {text}
    </span>
  )
}
