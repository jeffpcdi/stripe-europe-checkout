'use client'

// Refinamento: o globo é a peça central IMERSIVA do BLOCO HERO — ocupa toda a
// largura do hero com KPIs e LiveFeed sobrepostos via absolute. O counter na
// base mostra "ONLINE AGORA" (tempo real de /api/live), não "leads hoje".
// Badge com glassmorphism na base do globo.

import dynamic from 'next/dynamic'
import { useEffect, useRef, useState } from 'react'
import { useLive } from '@/lib/api'
import { CountUp } from '@/components/count-up'
import type { GeoPulse } from '@/components/geo/globe'
import type { LiveCountry } from '@/lib/types'

/* V2-54: skeleton do globo — esfera com anel orbital girando */
function GlobeSkeleton() {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="relative aspect-square w-[60%] max-w-96" aria-hidden="true">
        <div className="absolute inset-0 animate-pulse rounded-full border border-brand-cyan/10 bg-brand-cyan/5" />
        <div
          className="anim-orbit-slow absolute -inset-4 rounded-full border border-dashed"
          style={{ borderColor: 'rgba(37,244,238,0.18)' }}
        />
        <div className="brand-spinner absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" />
      </div>
      <span className="sr-only">Carregando presença ao vivo</span>
    </div>
  )
}

const GlobePanel = dynamic(() => import('@/components/geo/globe'), {
  ssr: false,
  loading: () => <GlobeSkeleton />,
})

// Fase 5: quanto tempo um anel de "lead novo" fica visível no globo.
const PULSE_TTL_MS = 6000

/**
 * Detecta leads novos comparando a contagem por país entre polls consecutivos
 * do /api/live (cadência de 5s). Um aumento de `count` num país vira um pulso
 * com TTL, que o globo desenha como anel temporário. Robusto a:
 *  - primeiro poll: só semeia a baseline, NÃO dispara pulsos (evita enxurrada
 *    inicial ao abrir a tela);
 *  - quedas de count (visitante saiu): ignoradas;
 *  - países novos na lista: contam do zero como pulso.
 * Não guarda PII — apenas o código do país e um contador.
 */
function useLeadPulses(countries: LiveCountry[]): GeoPulse[] {
  const [pulses, setPulses] = useState<GeoPulse[]>([])
  const prevCounts = useRef<Map<string, number> | null>(null)
  const keySeq = useRef(0)

  useEffect(() => {
    const next = new Map<string, number>()
    for (const c of countries) next.set(c.code, c.count || 0)

    // primeiro poll → só estabelece baseline, sem pulsos
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

    // expira esse lote após o TTL (cada lote tem seu próprio timer)
    const expiring = new Set(fresh.map((p) => p.key))
    const t = window.setTimeout(() => {
      setPulses((cur) => cur.filter((p) => !expiring.has(p.key)))
    }, PULSE_TTL_MS)
    return () => window.clearTimeout(t)
  }, [countries])

  return pulses
}

export function HeroGlobe({
  countries,
}: {
  /** países dos leads de HOJE — colorem o globo (mesma história do contador).
      Antes o globo pintava só quem estava online AGORA: ficava apagado com
      "Aguardando tráfego" por cima do contador. */
  countries: { code: string; name: string; count: number; purchased: number }[]
}) {
  // /api/live alimenta: 1) o counter "online agora" e 2) os PULSOS (anéis de
  // lead novo, Fase 5). A coloração estática vem do prop `countries`.
  const { data } = useLive()
  const liveCountries = data?.summary.countries ?? []
  const onlineNow = data?.summary.online ?? 0
  const activeCountries = liveCountries.length
  const pulses = useLeadPulses(liveCountries)

  return (
    /* O globo agora ocupa TODA a largura/altura do hero. Sem max-w — o
       container externo (overview-view) controla o tamanho. */
    <div
      className="hero-globe-container relative w-full"
      style={{ minHeight: 640 }}
      aria-label={`Presença ao vivo: ${onlineNow} online agora em ${activeCountries} ${activeCountries === 1 ? 'país' : 'países'}`}
    >
      {/* Glow atmosférico e Elementos Orbitais (Mega Plano) */}
      <div className="hero-globe-glow-outer" aria-hidden="true" />
      <div className="hero-globe-glow-core" aria-hidden="true" />
      <div className="hero-stardust" aria-hidden="true" />
      
      <div className="hero-orbit-ring" aria-hidden="true" />
      <div className="hero-orbit-ring outer" aria-hidden="true" />

      {/* A coloração vem de `countries` (stats, já carregado quando o overview
          renderiza) — não espera o /api/live; ele só adiciona pulsos depois.
          Arcos de tráfego só com gente online AGORA — com 0 online, arcos
          voando contradizem o contador logo abaixo. */}
      <GlobePanel
        countries={countries}
        metric="visits"
        pulses={pulses}
        showArcs={onlineNow > 0}
      />

      {/* Badge glassmorphism sobreposto na base — "ONLINE AGORA · N PAÍSES".
          pointer-events-none para não interceptar arraste/zoom do globo. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-[6%] flex flex-col items-center gap-1.5 text-center">
        <div className="hero-globe-badge glass glass-pulse pointer-events-auto inline-flex flex-col items-center gap-1.5 px-8 py-3.5 rounded-[24px]">
          <div className="flex items-center gap-2.5">
            <span className="live-dot" aria-hidden="true" />
            <p
              className="font-mono text-3xl font-bold leading-none tabular-nums text-white xl:text-4xl"
              data-sensitive
            >
              <CountUp value={onlineNow} />
            </p>
          </div>
          <p className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-white/55">
            online agora · {activeCountries}{' '}
            {activeCountries === 1 ? 'país' : 'países'}
          </p>
        </div>
      </div>
    </div>
  )
}
