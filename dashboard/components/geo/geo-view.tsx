'use client'

import dynamic from 'next/dynamic'
import { useMemo, useState } from 'react'
import { Globe2, MapPin, ShoppingCart, TrendingUp } from 'lucide-react'
import { useStats } from '@/lib/api'
import { aggregate, periodStart } from '@/lib/metrics'
import { countryFlag } from '@/lib/format'
import type { Period } from '@/lib/types'
import { GlassCard } from '@/components/glass-card'
import { Skeleton } from '@/components/skeleton'
import { PeriodPicker } from '@/components/overview/period-picker'
import { MiniStat } from '@/components/overview/mini-stat'

// Globo 3D é pesado (three.js) — carrega sob demanda, sem SSR
const GlobePanel = dynamic(() => import('@/components/geo/globe'), {
  ssr: false,
  loading: () => <Skeleton className="h-[420px] w-full rounded-xl" />,
})

export function GeoView() {
  const { data, isLoading } = useStats()
  const [period, setPeriod] = useState<Period>('7d')

  const agg = useMemo(
    () => (data ? aggregate(data, periodStart(period)) : null),
    [data, period],
  )

  if (isLoading || !agg) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-9 w-64" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-[420px] rounded-xl" />
      </div>
    )
  }

  const totalVisits = agg.countries.reduce((s, c) => s + c.count, 0)
  const totalSales = agg.countries.reduce((s, c) => s + c.purchased, 0)
  const top = agg.countries[0]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-end">
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MiniStat
          icon={Globe2}
          color="var(--brand-cyan)"
          bg="color-mix(in oklab, var(--brand-cyan) 14%, transparent)"
          label="Países"
          value={String(agg.countries.length)}
          sub="com visitas no período"
          index={0}
        />
        <MiniStat
          icon={MapPin}
          color="var(--foreground)"
          bg="color-mix(in oklab, var(--foreground) 10%, transparent)"
          label="Visitas"
          value={String(totalVisits)}
          sub="total geolocalizado"
          index={1}
        />
        <MiniStat
          icon={ShoppingCart}
          color="var(--brand-pink)"
          bg="color-mix(in oklab, var(--brand-pink) 14%, transparent)"
          label="Vendas"
          value={String(totalSales)}
          sub="compras confirmadas"
          index={2}
        />
        <MiniStat
          icon={TrendingUp}
          color="var(--success)"
          bg="color-mix(in oklab, var(--success) 14%, transparent)"
          label="Top país"
          value={top ? `${countryFlag(top.code)} ${top.name}` : '—'}
          sub={top ? `${top.count} visitas` : 'sem dados'}
          index={3}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <GlassCard className="p-5">
          <div className="mb-3">
            <h2 className="text-sm font-semibold text-foreground">Mapa global</h2>
            <p className="text-xs text-muted-foreground">Visitas e vendas por país</p>
          </div>
          <GlobePanel countries={agg.countries} />
        </GlassCard>

        <GlassCard className="p-5">
          <div className="mb-3">
            <h2 className="text-sm font-semibold text-foreground">Ranking de países</h2>
            <p className="text-xs text-muted-foreground">
              {agg.countries.length} países no período
            </p>
          </div>
          <div className="flex max-h-[420px] flex-col gap-1 overflow-y-auto pr-1">
            {agg.countries.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Sem dados no período selecionado.
              </p>
            ) : (
              agg.countries.map((c) => {
                const pct =
                  totalVisits > 0 ? Math.round((c.count / totalVisits) * 100) : 0
                return (
                  <div
                    key={c.code}
                    className="flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-secondary/60"
                  >
                    <span className="w-7 text-center text-base leading-none">
                      {countryFlag(c.code)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm text-foreground">
                          {c.name}
                        </span>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          {c.count} · {pct}%
                        </span>
                      </div>
                      <div className="mt-1 h-1 overflow-hidden rounded-full bg-secondary">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-[color:var(--brand-cyan)] to-[color:var(--brand-pink)]"
                          style={{ width: `${Math.max(4, pct)}%` }}
                        />
                      </div>
                    </div>
                    {c.purchased > 0 && (
                      <span className="shrink-0 rounded-md bg-[color:var(--brand-pink)]/15 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-[color:var(--brand-pink)]">
                        {c.purchased} venda{c.purchased > 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </GlassCard>
      </div>
    </div>
  )
}
