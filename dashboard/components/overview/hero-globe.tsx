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

  const [activeMetric, setActiveMetric] = useState<'all' | 'live' | 'sales'>('all')

  const emptyNote = liveError ? (
    <span className="rounded-full border border-amber-500/30 bg-black/60 px-3 py-1 text-[11px] text-amber-400 backdrop-blur-md">
      Reconectando ao tempo real…
    </span>
  ) : !lastLeadAt && onlineNow === 0 ? (
    <Link
      href="/links"
      className="pointer-events-auto rounded-full border border-cyan-500/30 bg-black/60 px-3 py-1 text-[11px] font-medium text-cyan-300 backdrop-blur-md transition-colors hover:bg-cyan-500/20"
    >
      Configurar rastreamento →
    </Link>
  ) : (
    <span className="rounded-full border border-cyan-500/20 bg-black/60 px-3.5 py-1.5 text-[11px] text-white/80 backdrop-blur-md">
      Aguardando visitantes ao vivo ou compras…
    </span>
  )

  // Mostra no globo ESTRITAMENTE: visitantes navegando no site ao vivo e compras
  const liveGlobeCountries = useMemo(() => {
    // 1. Mapa de compras por país
    const purchaseMap = new Map<string, { code: string; name: string; purchased: number }>()
    for (const c of countries) {
      if (!c.code) continue
      const code = c.code.toUpperCase()
      if ((c.purchased || 0) > 0) {
        purchaseMap.set(code, {
          code,
          name: c.name || code,
          purchased: c.purchased,
        })
      }
    }

    // 2. Mapa de visitantes navegando ao vivo no site agora
    const liveMap = new Map<string, { code: string; name: string; liveCount: number }>()
    for (const lc of liveCountries) {
      if (!lc.code) continue
      const code = lc.code.toUpperCase()
      const cnt = lc.count || 1
      if (cnt > 0) {
        liveMap.set(code, {
          code,
          name: lc.name || code,
          liveCount: cnt,
        })
      }
    }

    // Se estiver no modo 'sales', mostra apenas países com compras
    if (activeMetric === 'sales') {
      return Array.from(purchaseMap.values())
        .map((p) => ({
          code: p.code,
          name: p.name,
          count: liveMap.get(p.code)?.liveCount || 0,
          purchased: p.purchased,
        }))
        .sort((a, b) => b.purchased - a.purchased)
    }

    // Se estiver no modo 'live', mostra apenas quem está navegando ao vivo no site
    if (activeMetric === 'live') {
      return Array.from(liveMap.values())
        .map((l) => ({
          code: l.code,
          name: l.name,
          count: l.liveCount,
          purchased: purchaseMap.get(l.code)?.purchased || 0,
        }))
        .sort((a, b) => b.count - a.count)
    }

    // Modo padrão ('all'): apenas países navegando ao vivo E/OU com compras
    const combined = new Map<string, { code: string; name: string; count: number; purchased: number }>()

    for (const [code, l] of liveMap) {
      combined.set(code, {
        code,
        name: l.name,
        count: l.liveCount,
        purchased: purchaseMap.get(code)?.purchased || 0,
      })
    }

    for (const [code, p] of purchaseMap) {
      const existing = combined.get(code)
      if (existing) {
        existing.purchased = p.purchased
      } else {
        combined.set(code, {
          code,
          name: p.name,
          count: 0,
          purchased: p.purchased,
        })
      }
    }

    return Array.from(combined.values()).sort((a, b) => {
      const aScore = (a.count || 0) + (a.purchased || 0) * 3
      const bScore = (b.count || 0) + (b.purchased || 0) * 3
      return bScore - aScore
    })
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
        showArcs={onlineNow > 0 || liveGlobeCountries.length > 1}
        emptyNote={emptyNote}
      />

      {/* Badge Flutuante Refinado no Topo: Navegando Agora + Alternador de Métrica */}
      <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex flex-wrap items-center justify-between gap-2 px-3 sm:px-5">
        {/* Indicador de Presença Online Agora */}
        <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-cyan-500/30 bg-[#070b14]/90 px-3.5 py-1.5 shadow-[0_4px_24px_rgba(0,0,0,0.7),0_0_12px_rgba(34,211,238,0.15)] backdrop-blur-xl">
          <span className="relative flex size-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-80" />
            <span className="relative inline-flex size-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]" />
          </span>
          <span className="font-mono text-xs font-bold tabular-nums text-white">
            <CountUp value={onlineNow} />
          </span>
          <span className="text-[11px] font-medium text-white/80">
            navegando ao vivo
          </span>
          {activeCountries > 0 && (
            <span className="rounded-full bg-white/15 px-2 py-0.5 font-mono text-[9px] font-semibold text-white/90">
              {activeCountries} {activeCountries === 1 ? 'país' : 'países'}
            </span>
          )}
        </div>

        {/* Alternador Interativo em Pílula: Ambos vs Ao Vivo vs Compras */}
        <div className="pointer-events-auto flex items-center rounded-full border border-cyan-500/30 bg-[#070b14]/90 p-1 shadow-[0_4px_24px_rgba(0,0,0,0.7)] backdrop-blur-xl">
          <button
            type="button"
            onClick={() => setActiveMetric('all')}
            className={`rounded-full px-3 py-1 text-[11px] font-semibold transition-all ${
              activeMetric === 'all'
                ? 'bg-cyan-500/30 text-cyan-200 shadow-[0_0_12px_rgba(6,182,212,0.45)]'
                : 'text-white/60 hover:text-white/90'
            }`}
          >
            Ambos
          </button>
          <button
            type="button"
            onClick={() => setActiveMetric('live')}
            className={`rounded-full px-3 py-1 text-[11px] font-semibold transition-all ${
              activeMetric === 'live'
                ? 'bg-cyan-500/30 text-cyan-200 shadow-[0_0_12px_rgba(6,182,212,0.45)]'
                : 'text-white/60 hover:text-white/90'
            }`}
          >
            Ao Vivo
          </button>
          <button
            type="button"
            onClick={() => setActiveMetric('sales')}
            className={`rounded-full px-3 py-1 text-[11px] font-semibold transition-all ${
              activeMetric === 'sales'
                ? 'bg-emerald-500/30 text-emerald-200 shadow-[0_0_12px_rgba(16,185,129,0.45)]'
                : 'text-white/60 hover:text-white/90'
            }`}
          >
            Compras
          </button>
        </div>
      </div>

      {/* Rodapé Flutuante: Legenda dos Pontos de Acesso 3D */}
      <div className="pointer-events-none absolute bottom-3 left-3 z-20 flex items-center gap-2">
        <div className="flex items-center gap-3 rounded-xl border border-white/15 bg-[#070b14]/90 px-3.5 py-1.5 shadow-[0_4px_20px_rgba(0,0,0,0.7)] backdrop-blur-xl">
          <div className="flex items-center gap-1.5">
            <span className="h-3.5 w-1.5 rounded-full bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.9)]" />
            <span className="text-[11px] font-medium text-white/90">Navegando ao Vivo</span>
          </div>
          <span className="text-white/30">|</span>
          <div className="flex items-center gap-1.5">
            <span className="h-3.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.9)]" />
            <span className="text-[11px] font-medium text-white/90">Compras</span>
          </div>
        </div>
      </div>
    </div>
  )
}
