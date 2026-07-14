'use client'

import dynamic from 'next/dynamic'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Globe2, Radio, ShoppingCart } from 'lucide-react'
import { useLive } from '@/lib/api'
import { CountUp } from '@/components/count-up'
import type { GeoPulse } from '@/components/geo/globe'
import type { LiveCountry } from '@/lib/types'

/* V2-54: skeleton do globo agora é um "planeta carregando" — esfera com
   anel orbital girando, no lugar do círculo pulsante genérico */
function GlobeSkeleton() {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[#080a0d]">
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

function LiveStat({
  icon: Icon,
  value,
  label,
  active,
}: {
  icon: typeof Radio
  value: number
  label: string
  /** destaque ciano quando há atividade */
  active?: boolean
}) {
  return (
    /* V2-55: stat com hover que acende o tile do ícone e levanta o número */
    <div className="group flex min-w-0 items-center gap-3 px-4 py-3.5 transition-colors hover:bg-white/[0.02]">
      <span
        className={`icon-tilt flex size-9 shrink-0 items-center justify-center rounded-lg transition-all ${
          active
            ? 'bg-brand-cyan/15 text-brand-cyan shadow-[0_0_14px_rgba(37,244,238,0.2)]'
            : 'bg-secondary/60 text-muted-foreground'
        }`}
      >
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="font-mono text-xl font-bold leading-none tabular-nums text-foreground">
          <CountUp value={value} />
        </p>
        <p className="label-mono mt-1 truncate">{label}</p>
      </div>
    </div>
  )
}

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

export function HeroGlobe() {
  const { data, isLoading } = useLive()
  const online = data?.summary.online ?? 0
  const checkout = data?.checkout.externalEst ?? 0
  const liveCountries = data?.summary.countries ?? []
  const countries = useMemo(
    () => liveCountries.map((country) => ({ ...country, purchased: 0 })),
    [liveCountries],
  )
  // Fase 5: pulsos de leads novos alimentam os anéis do globo
  const pulses = useLeadPulses(liveCountries)
  const leaders = liveCountries.slice(0, 3).map((country) => country.name).join(', ')

  return (
    /* V2-56: card hero com borda energia + hairline superior — o globo é a
       peça central do overview e merece a moldura de assinatura */
    <section
      aria-labelledby="live-presence-title"
      className="energy-border top-hairline overflow-hidden rounded-xl border border-border bg-card"
    >
      <header className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div>
          <div className="flex items-center gap-2">
            {/* V2-57: dot de "ao vivo" com ping — era estático */}
            <span className="live-dot" aria-hidden="true" />
            <h2 id="live-presence-title" className="text-base font-semibold text-foreground">
              Presença ao vivo
            </h2>
          </div>
          <p className="mt-1 text-sm text-pretty text-muted-foreground">
            Distribuição dos visitantes conectados neste momento.
          </p>
        </div>
        {/* V2-58: selo de auto-refresh em mono uppercase com respiração */}
        <p className="label-mono anim-breathe">Atualização automática</p>
      </header>

      <div className="grid grid-cols-3 divide-x divide-border border-b border-border bg-background/30">
        <LiveStat icon={Radio} value={online} label="Online agora" active={online > 0} />
        <LiveStat icon={ShoppingCart} value={checkout} label="No checkout" active={checkout > 0} />
        <LiveStat icon={Globe2} value={countries.length} label="Países ativos" active={countries.length > 0} />
      </div>

      {/* V2-100: grade de pontos ciano ultra-sutil atrás do globo */}
      <div className="dot-matrix relative h-[400px] w-full sm:h-[500px]">
        {isLoading && !data ? (
          <GlobeSkeleton />
        ) : (
          <GlobePanel countries={countries} metric="visits" pulses={pulses} />
        )}
      </div>

      <footer className="flex min-h-11 items-center border-t border-border px-4 py-2.5 text-xs text-muted-foreground sm:px-5">
        {leaders ? `Maior presença agora: ${leaders}.` : 'Aguardando os primeiros visitantes para mostrar a distribuição.'}
      </footer>
    </section>
  )
}
