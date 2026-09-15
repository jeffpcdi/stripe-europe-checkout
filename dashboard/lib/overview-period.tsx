'use client'

import { createContext, Suspense, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import type { Period } from './types'

const PERIOD_KEY = 'roi:dashboard:period'
const LEGACY_PERIOD_KEY = 'roi:overview:period'
const isPeriod = (value: string | null): value is Period => ['today', '7d', '30d', 'all'].includes(value || '')
const PeriodContext = createContext<{ period: Period; setPeriod: (value: Period) => void } | null>(null)

/**
 * O período é universal em toda a dashboard.
 * A URL vence a preferência salva; sem ?p usamos a última escolha persistida.
 */
function PeriodFromUrl({ onChange }: { onChange: (value: Period) => void }) {
  const pathname = usePathname()
  const search = useSearchParams()
  useEffect(() => {
    const fromUrl = search.get('p')
    if (isPeriod(fromUrl)) {
      onChange(fromUrl)
      try { localStorage.setItem(PERIOD_KEY, fromUrl) } catch {}
      return
    }
    try {
      const saved = localStorage.getItem(PERIOD_KEY) || localStorage.getItem(LEGACY_PERIOD_KEY)
      onChange(isPeriod(saved) ? saved : 'today')
    } catch {
      onChange('today')
    }
  }, [pathname, search, onChange])
  return null
}

export function OverviewPeriodProvider({ children }: { children: ReactNode }) {
  const [period, setPeriodState] = useState<Period>('today')
  const setPeriod = useCallback((value: Period) => {
    setPeriodState(value)
    try {
      localStorage.setItem(PERIOD_KEY, value)
      localStorage.setItem(LEGACY_PERIOD_KEY, value)
    } catch {}

    const url = new URL(window.location.href)
    url.searchParams.set('p', value)
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
    window.dispatchEvent(new CustomEvent('roi:period-change', { detail: value }))
  }, [])

  useEffect(() => {
    const sync = (event: Event) => {
      const next = (event as CustomEvent<string>).detail
      if (isPeriod(next)) setPeriodState(next)
    }
    const syncStorage = (event: StorageEvent) => {
      if ((event.key === PERIOD_KEY || event.key === LEGACY_PERIOD_KEY) && isPeriod(event.newValue)) setPeriodState(event.newValue)
    }
    window.addEventListener('roi:period-change', sync)
    window.addEventListener('storage', syncStorage)
    return () => {
      window.removeEventListener('roi:period-change', sync)
      window.removeEventListener('storage', syncStorage)
    }
  }, [])

  return <PeriodContext.Provider value={{ period, setPeriod }}>
    <Suspense fallback={null}><PeriodFromUrl onChange={setPeriodState} /></Suspense>
    {children}
  </PeriodContext.Provider>
}

export function useOverviewPeriod() {
  const context = useContext(PeriodContext)
  if (!context) throw new Error('Período global indisponível fora do layout da dashboard')
  return context
}
