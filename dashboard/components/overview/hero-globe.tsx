'use client'

// Redesign: o globo é a peça central do BLOCO HERO — circular (aspect 1),
// sem chrome de card próprio (o painel do hero é um bloco só no overview).
// Os números moram DENTRO do globo, sobrepostos na base: contagem de leads
// de hoje (grande, ciano, mono) + linha "LEADS HOJE · N PAÍSES".
// Os cards "online/checkout/países" saíram — essa informação vive aqui.

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
      <div className="relative aspect-square w-[46%] max-w-72" aria-hidden="true">
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
  leadsToday,
  countriesToday,
  countries,
}: {
  /** leads que entraram HOJE (de /api/stats — o overview já tem esse dado) */
  leadsToday: number
  /** países distintos dos leads de hoje */
  countriesToday: number
  /** países dos leads de HOJE — colorem o globo (mesma história do contador).
      Antes o globo pintava só quem estava online AGORA: ficava apagado com
      "Aguardando tráfego" por cima de "87 leads hoje". */
  countries: { code: string; name: string; count: number; purchased: number }[]
}) {
  // /api/live continua alimentando os PULSOS (anéis de lead novo, Fase 5) —
  // é a única razão do hook aqui; a coloração vem do prop `countries`.
  const { data } = useLive()
  const liveCountries = data?.summary.countries ?? []
  const pulses = useLeadPulses(liveCountries)

  return (
    /* Circular, aspect 1, ocupa toda a coluna central do hero. mx-auto centra
       quando a coluna é mais larga que alta. */
    <div
      className="relative mx-auto aspect-square w-full max-w-[560px]"
      aria-label={`Presença ao vivo: ${leadsToday} leads hoje em ${countriesToday} ${countriesToday === 1 ? 'país' : 'países'}`}
    >
      {/* A coloração vem de `countries` (stats, já carregado quando o overview
          renderiza) — não espera o /api/live; ele só adiciona pulsos depois. */}
      <GlobePanel countries={countries} metric="visits" pulses={pulses} />

      {/* Números DENTRO do globo, sobrepostos na base. pointer-events-none
          para não interceptar arraste/zoom do globo. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-[8%] flex flex-col items-center gap-1 text-center">
        <p
          className="font-mono text-4xl font-bold leading-none tabular-nums text-brand-cyan xl:text-5xl"
          data-sensitive
        >
          <CountUp value={leadsToday} />
        </p>
        <p className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-white/45">
          {leadsToday === 1 ? 'Lead hoje' : 'Leads hoje'} · {countriesToday}{' '}
          {countriesToday === 1 ? 'país' : 'países'}
        </p>
      </div>
    </div>
  )
}
