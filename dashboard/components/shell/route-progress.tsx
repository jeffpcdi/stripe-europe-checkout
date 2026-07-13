'use client'

// Item 61: barra de progresso de rota — 2px, gradiente ciano→rosa,
// aparece no topo da viewport a cada navegação e completa em ~500ms.

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'

export function RouteProgress() {
  const pathname = usePathname()
  const [phase, setPhase] = useState<'idle' | 'loading' | 'done'>('idle')
  const first = useRef(true)

  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    setPhase('loading')
    const t1 = setTimeout(() => setPhase('done'), 450)
    const t2 = setTimeout(() => setPhase('idle'), 750)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [pathname])

  if (phase === 'idle') return null

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5"
    >
      {/* V2-74: barra com gradiente ciano→rosa real + cometa de glow na ponta */}
      <div
        className="progress-glow h-full rounded-r-full transition-all duration-300 ease-out"
        style={{
          width: phase === 'loading' ? '70%' : '100%',
          opacity: phase === 'done' ? 0 : 1,
          background: 'linear-gradient(90deg, var(--accent), var(--pink))',
          boxShadow: '0 0 12px rgba(37,244,238,.55)',
        }}
      />
    </div>
  )
}
