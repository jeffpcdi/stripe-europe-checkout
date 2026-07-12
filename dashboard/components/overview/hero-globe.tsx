'use client'

import dynamic from 'next/dynamic'
import { useMemo } from 'react'
import { Globe2, Radio, ShoppingCart } from 'lucide-react'
import { useLive } from '@/lib/api'
import { CountUp } from '@/components/count-up'

function GlobeSkeleton() {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[#080a0d]">
      <div className="aspect-square w-[46%] max-w-72 animate-pulse rounded-full border border-brand-cyan/10 bg-brand-cyan/5" aria-hidden="true" />
      <span className="sr-only">Carregando presença ao vivo</span>
    </div>
  )
}

const GlobePanel = dynamic(() => import('@/components/geo/globe'), {
  ssr: false,
  loading: () => <GlobeSkeleton />,
})

function LiveStat({ icon: Icon, value, label }: { icon: typeof Radio; value: number; label: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 px-3 py-2">
      <Icon className="size-4 shrink-0 text-brand-cyan" aria-hidden="true" />
      <div className="min-w-0">
        <p className="font-mono text-sm font-semibold tabular-nums text-foreground"><CountUp value={value} /></p>
        <p className="truncate text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  )
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
  const leaders = liveCountries.slice(0, 3).map((country) => country.name).join(', ')

  return (
    <section aria-labelledby="live-presence-title" className="overflow-hidden rounded-xl border border-border bg-card">
      <header className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-success" aria-hidden="true" />
            <h2 id="live-presence-title" className="text-base font-semibold text-foreground">Presença ao vivo</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">Distribuição dos visitantes conectados neste momento.</p>
        </div>
        <p className="text-xs text-muted-foreground">Atualização automática</p>
      </header>

      <div className="grid grid-cols-3 divide-x divide-border border-b border-border bg-background/30">
        <LiveStat icon={Radio} value={online} label="Online agora" />
        <LiveStat icon={ShoppingCart} value={checkout} label="No checkout" />
        <LiveStat icon={Globe2} value={countries.length} label="Países ativos" />
      </div>

      <div className="relative h-[280px] w-full sm:h-[320px]">
        {isLoading && !data ? <GlobeSkeleton /> : <GlobePanel countries={countries} metric="visits" />}
      </div>

      <footer className="flex min-h-11 items-center border-t border-border px-4 py-2.5 text-xs text-muted-foreground sm:px-5">
        {leaders ? `Maior presença agora: ${leaders}.` : 'Aguardando os primeiros visitantes para mostrar a distribuição.'}
      </footer>
    </section>
  )
}
