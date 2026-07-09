'use client'

import dynamic from 'next/dynamic'
import { useMemo } from 'react'
import { Radio, ShoppingCart, Globe2 } from 'lucide-react'
import { useLive } from '@/lib/api'
import { Skeleton } from '@/components/skeleton'
import { CountUp } from '@/components/count-up'

// Globo 3D (three.js) é pesado — carrega sob demanda, sem SSR.
const GlobePanel = dynamic(() => import('@/components/geo/globe'), {
  ssr: false,
  loading: () => <div className="absolute inset-0 animate-pulse bg-[color:var(--globe-bg,#05060a)]" />,
})

// Pílula compacta sobreposta ao globo (item do print: Online / Checkout / Países).
function StatPill({
  icon: Icon,
  value,
  label,
  tint,
}: {
  icon: typeof Radio
  value: number
  label: string
  tint: string
}) {
  return (
    <div className="glass flex items-center gap-2.5 rounded-full py-1.5 pl-2 pr-3.5 backdrop-blur-md">
      <span
        className="flex size-7 items-center justify-center rounded-full"
        style={{ background: `color-mix(in oklab, ${tint} 16%, transparent)`, color: tint }}
      >
        <Icon className="size-3.5" aria-hidden="true" />
      </span>
      <div className="leading-none">
        <p className="font-mono text-sm font-semibold tabular-nums text-foreground">
          <CountUp value={value} />
        </p>
        <p className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      </div>
    </div>
  )
}

export function HeroGlobe() {
  const { data, isLoading } = useLive()

  const online = data?.summary.online ?? 0
  const checkout = data?.checkout.externalEst ?? 0
  const liveCountries = data?.summary.countries ?? []

  // Adapta o formato do /api/live para o contrato do globo (sem vendas ao vivo).
  const countries = useMemo(
    () => liveCountries.map((c) => ({ code: c.code, name: c.name, count: c.count, purchased: 0 })),
    [liveCountries],
  )

  return (
    <section
      aria-label="Presença global em tempo real"
      className="hero-globe relative overflow-hidden rounded-2xl border border-border/60"
    >
      {/* Palco do globo — altura contida para não dominar a página nem gerar
          faixa vazia; o globo é coadjuvante dos KPIs, não o herói. */}
      <div className="relative h-[340px] w-full sm:h-[400px] lg:h-[440px]">
        {isLoading && !data ? (
          <Skeleton className="absolute inset-0 rounded-2xl" />
        ) : (
          <GlobePanel countries={countries} metric="visits" />
        )}

        {/* Overlay compacto no topo — 3 números de contexto sobre o globo */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-wrap items-center gap-2 p-4 sm:p-5">
          <span className="mr-1 flex items-center gap-1.5 rounded-full bg-success/10 py-1 pl-2 pr-3 text-[11px] font-semibold text-success backdrop-blur-md">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-success" />
            </span>
            AO VIVO
          </span>
          <StatPill icon={Radio} value={online} label="Online agora" tint="var(--brand-cyan)" />
          <StatPill icon={ShoppingCart} value={checkout} label="No checkout" tint="var(--brand-pink)" />
          <StatPill icon={Globe2} value={countries.length} label="Países ativos" tint="var(--foreground)" />
        </div>
      </div>
    </section>
  )
}
