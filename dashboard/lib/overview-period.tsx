'use client'

import { createContext, Suspense, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import type { Period } from './types'

const PERIOD_KEY = 'roi:overview:period'
const isPeriod = (value: string | null): value is Period => ['today', '7d', '30d', 'all'].includes(value || '')
const PeriodContext = createContext<{ period: Period; setPeriod: (value: Period) => void } | null>(null)

/** URL vence a preferência salva; navegação e Voltar também atualizam o filtro. */
function PeriodFromUrl({ onChange }: { onChange: (value: Period) => void }) {
  const pathname = usePathname()
  const search = useSearchParams()
  useEffect(() => {
    if (pathname !== '/') return
    const fromUrl = search.get('p')
    if (isPeriod(fromUrl)) { onChange(fromUrl); return }
    try {
      const saved = localStorage.getItem(PERIOD_KEY)
      onChange(isPeriod(saved) ? saved : 'today')
    } catch { onChange('today') }
  }, [pathname, search, onChange])
  return null
}

export function OverviewPeriodProvider({ children }: { children: ReactNode }) {
  // O primeiro render é igual no servidor e no navegador.
  const [period, setPeriodState] = useState<Period>('today')
  const setPeriod = useCallback((value: Period) => {
    setPeriodState(value)
    try { localStorage.setItem(PERIOD_KEY, value) } catch { /* Preferência apenas em memória. */ }
    const url = new URL(window.location.href)
    url.searchParams.set('p', value)
    window.history.replaceState(window.history.state, '', url)
  }, [])
  return <PeriodContext.Provider value={{ period, setPeriod }}>
    <Suspense fallback={null}><PeriodFromUrl onChange={setPeriodState} /></Suspense>
    {children}
  </PeriodContext.Provider>
}

export function useOverviewPeriod() {
  const context = useContext(PeriodContext)
  if (!context) throw new Error('Período da Visão geral indisponível fora do layout')
  return context
}
