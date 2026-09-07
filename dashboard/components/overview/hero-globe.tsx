'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLive } from '@/lib/api'
import { timeAgo } from '@/lib/format'
import { CountUp } from '@/components/count-up'
import type { GeoPulse } from '@/components/geo/globe'
import type { LiveCountry } from '@/lib/types'

function GlobeSkeleton() {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="relative aspect-square w-[60%] max-w-80" aria-hidden="true">
        <div className="absolute inset-0 animate-pulse rounded-full border border-cyan-400/10 bg-cyan-400/5" />
        <div
          className="anim-orbit-slow absolute -inset-4 rounded-full border border-dashed"
          style={{ borderColor: 'rgba(37,244,238,0.18)' }}
        />
        <div className="brand-spinner absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" />
      </div>
      <span className="sr-only">Carregando presença global</span>
    </div>
  )
}

const GlobePanel = dynamic(() => import('@/components/geo/globe'), {
  ssr: false,
  loading: () => <GlobeSkeleton />,
})

const PULSE_TTL_MS = 6000

function useLeadPulses(countries: LiveCountry[]): GeoPulse[] {
  const [pulses, setPulses] = useState<GeoPulse[]>([])
  const prevCounts = useRef<Map<string, number> | null>(null)
  const keySeq = useRef(0)

  useEffect(() => {
    const next = new Map<string, number>()
    for (const c of countries) next.set(c.code, c.count || 0)

    if (prevCounts.current === null) {
      prevCounts.current = next
      return
    }

    const fresh: GeoPulse[] = []
    for (const [code, count] of next) {
      const before = prevCounts.current.get(code) ?? 0
      if (count > before) fresh.push({ code, key: ++keySeq.current })
    }
    prevCounts.current = next

    if (fresh.length === 0) return
    setPulses((cur) => [...cur, ...fresh])

    const expiring = new Set(fresh.map((p) => p.key))
    const t = window.setTimeout(() => {
      setPulses((cur) => cur.filter((p) => !expiring.has(p.key)))
    }, PULSE_TTL_MS)
    return () => window.clearTimeout(t)
  }, [countries])

  return pulses
}

interface HeroGlobeProps {
  countries: { code: string; name: string; count: number; purchased: number }[]
  lastLeadAt?: string | null
  focusCode?: string | null
}

export function HeroGlobe({ countries, lastLeadAt, focusCode }: HeroGlobeProps) {
  const { data, error: liveError } = useLive()
  const liveCountries = data?.summary.countries ?? []
  const onlineNow = data?.summary.online ?? 0
  const activeCountries = liveCountries.length
  const pulses = useLeadPulses(liveCountries)

  const [activeMetric, setActiveMetric] = useState<'visits' | 'sales'>('visits')

  const emptyNote = liveError ? (
    <span className="rounded-full border border-amber-500/30 bg-black/60 px-3 py-1 text-[11px] text-amber-400 backdrop-blur-md">
      Reconectando ao tempo real…
    </span>
  ) : !lastLeadAt ? (
    <Link
      href="/links"
      className="pointer-events-auto rounded-full border border-cyan-500/30 bg-black/60 px-3 py-1 text-[11px] font-medium text-cyan-300 backdrop-blur-md transition-colors hover:bg-cyan-500/20"
    >
      Configurar rastreamento →
    </Link>
  ) : null

  // Combina presença ao vivo com métricas de hoje
  const liveGlobeCountries = useMemo(() => {
    const purchasedByCode = new Map(countries.map((c) => [c.code, c.purchased]))
    const countsByCode = new Map(countries.map((c) => [c.code, c.count]))

    // Se estiver no modo 'sales', mostra todos os países que tiveram compras
    if (activeMetric === 'sales') {
      return countries.filter((c) => c.purchased > 0)
    }

    // Se no modo 'visits', prioriza os que estão online agora, ou os top do dia se zero online
    if (liveCountries.length > 0) {
      return liveCountries.map((c) => ({
        code: c.code,
        name: c.name,
        count: c.count,
        purchased: purchasedByCode.get(c.code) ?? 0,
      }))
    }

    // Fallback gracioso com tráfego do dia
    return countries.slice(0, 15).map((c) => ({
      code: c.code,
      name: c.name,
      count: countsByCode.get(c.code) ?? c.count,
      purchased: c.purchased,
    }))
  }, [liveCountries, countries, activeMetric])

  return (
    <div
      className="hero-globe-container absolute inset-0 overflow-hidden"
      aria-label={`Presença global: ${onlineNow} online agora em ${activeCountries} países`}
    >
      {/* Brilho atmosférico central suave e etéreo */}
      <div className="hero-globe-glow-soft" aria-hidden="true" />
      <div className="hero-globe-glow-core" aria-hidden="true" />

      {/* Globo 3D WebGL */}
      <GlobePanel
        countries={liveGlobeCountries}
        focusCode={focusCode}
        metric={activeMetric}
        pulses={pulses}
        showArcs={onlineNow > 0 || activeMetric === 'sales'}
        emptyNote={emptyNote}
      />

      {/* Badge Flutuante Refinado no Topo: Online Agora + Alternador de Métrica */}
      <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex flex-wrap items-center justify-between gap-2 px-3 sm:px-5">
        {/* Indicador de Presença Online Agora */}
        <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-white/10 bg-[#090b10]/75 px-3 py-1.5 shadow-[0_4px_20px_rgba(0,0,0,0.5)] backdrop-blur-xl">
          <span className="relative flex size-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
          </span>
          <span className="font-mono text-xs font-bold tabular-nums text-white">
            <CountUp value={onlineNow} />
          </span>
          <span className="text-[10px] font-medium text-white/60">
            online agora
          </span>
          {activeCountries > 0 && (
            <span className="rounded-full bg-white/10 px-1.5 py-0.2 font-mono text-[9px] text-white/50">
              {activeCountries} {activeCountries === 1 ? 'país' : 'países'}
            </span>
          )}
        </div>

        {/* Alternador Interativo em Pílula: Visitas vs Vendas */}
        <div className="pointer-events-auto flex items-center rounded-full border border-white/10 bg-[#090b10]/75 p-0.5 shadow-[0_4px_20px_rgba(0,0,0,0.5)] backdrop-blur-xl">
          <button
            type="button"
            onClick={() => setActiveMetric('visits')}
            className={`rounded-full px-2.5 py-1 text-[10px] font-medium transition-all ${
              activeMetric === 'visits'
                ? 'bg-cyan-500/20 text-cyan-300 shadow-[0_0_10px_rgba(6,182,212,0.3)]'
                : 'text-white/50 hover:text-white/80'
            }`}
          >
            Tráfego
          </button>
          <button
            type="button"
            onClick={() => setActiveMetric('sales')}
            className={`rounded-full px-2.5 py-1 text-[10px] font-medium transition-all ${
              activeMetric === 'sales'
                ? 'bg-emerald-500/20 text-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.3)]'
                : 'text-white/50 hover:text-white/80'
            }`}
          >
            Vendas
          </button>
        </div>
      </div>

      {/* Rodapé Flutuante: Legenda dos Pontos de Acesso 3D (Shopify Live View) */}
      <div className="pointer-events-none absolute bottom-3 left-3 z-20 flex items-center gap-2">
        <div className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-[#090b10]/80 px-3 py-1.5 shadow-[0_4px_16px_rgba(0,0,0,0.6)] backdrop-blur-xl">
          <div className="flex items-center gap-1.5">
            <span className="h-3 w-1 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
            <span className="text-[10px] font-medium text-white/70">Acessos Ativos</span>
          </div>
          <span className="text-white/20">|</span>
          <div className="flex items-center gap-1.5">
            <span className="h-3 w-1 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
            <span className="text-[10px] font-medium text-white/70">Conversões</span>
          </div>
        </div>
      </div>
    </div>
  )
}
