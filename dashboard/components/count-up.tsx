'use client'

import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from '@/lib/motion'

// O primeiro valor é o real. Apenas mudanças posteriores recebem transição.
export function CountUp({ value, format, duration = 350, className }: { value: number; format?: (v: number) => string; duration?: number; className?: string }) {
  const reduced = useReducedMotion()
  const [display, setDisplay] = useState(value)
  const current = useRef(value)
  useEffect(() => {
    const from = current.current
    if (from === value) return
    if (duration <= 0 || document.hidden || reduced) {
      current.current = value
      setDisplay(value)
      return
    }
    let raf = 0
    const start = performance.now()
    function tick(now: number) {
      const progress = Math.min((now - start) / duration, 1)
      current.current = from + (value - from) * (1 - Math.pow(1 - progress, 3))
      setDisplay(current.current)
      if (progress < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, duration, reduced])
  const fmt = format ?? ((v: number) => Math.round(v).toLocaleString('pt-BR'))
  return <span className={className}><span className="sr-only">{fmt(value)}</span><span aria-hidden="true">{fmt(display)}</span></span>
}
