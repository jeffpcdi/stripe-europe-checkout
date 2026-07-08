'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useStats } from '@/lib/api'
import { aggregate, periodStart } from '@/lib/metrics'
import { GlassCard } from '@/components/glass-card'
import { Skeleton } from '@/components/skeleton'
import { CountUp } from '@/components/count-up'
import { PeriodPicker } from '@/components/overview/period-picker'
import { LeadsTable } from './leads-table'
import { fmtPercent, gwLabel } from '@/lib/format'
import type { Period } from '@/lib/types'

// Cores de gateway dentro da paleta da identidade (sem azul fora da paleta)
const GW_COLORS = ['#25f4ee', '#fe2c55', '#22c55e', '#fbbf24', '#0ec2bd', '#f4f4f5']

export function FunnelView() {
  const { data, isLoading } = useStats()
  const [period, setPeriod] = useState<Period>('7d')

  const m = useMemo(() => {
    if (!data) return null
    return aggregate(data, periodStart(period))
  }, [data, period])

  if (isLoading && !data) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-40" />
        <Skeleton className="h-64" />
      </div>
    )
  }

  const max = Math.max(m?.visits ?? 1, 1)
  const v2c = m && m.visits ? +((m.reachedCheckout / m.visits) * 100).toFixed(1) : 0
  // Item 145: taxa entre etapas (não só do topo)
  const c2p =
    m && m.reachedCheckout ? +((m.purchased / m.reachedCheckout) * 100).toFixed(1) : 0
  // Item 146: identifica o gargalo — a maior queda percentual entre etapas
  const dropV2C = m && m.visits ? 100 - v2c : 0
  const dropC2P = m && m.reachedCheckout ? 100 - c2p : 0
  const bottleneck: 1 | 2 | null =
    !m || (!m.visits && !m.reachedCheckout)
      ? null
      : dropV2C >= dropC2P
        ? 1
        : 2

  // Itens 107–109: barras na identidade (gradiente na 1ª etapa, ciano com
  // opacidade decrescente nas seguintes); rótulos nunca truncados.
  const steps = [
    {
      label: 'Visitaram',
      sub: 'topo do funil',
      value: m?.visits ?? 0,
      bar: 'var(--brand-grad)',
      color: 'var(--accent)',
      rate: fmtPercent(100),
      stepRate: null as string | null,
      isBottleneck: false,
    },
    {
      label: 'Checkout',
      sub: 'iniciaram pagamento',
      value: m?.reachedCheckout ?? 0,
      bar: 'color-mix(in oklab, var(--accent) 72%, transparent)',
      color: 'var(--accent)',
      rate: fmtPercent(v2c),
      stepRate: `${fmtPercent(v2c)} das visitas`,
      isBottleneck: bottleneck === 1,
    },
    {
      label: 'Compraram',
      sub: 'pagamento aprovado',
      value: m?.purchased ?? 0,
      bar: 'color-mix(in oklab, var(--accent) 44%, transparent)',
      color: 'var(--accent)',
      rate: fmtPercent(m?.overall ?? 0),
      stepRate: `${fmtPercent(c2p)} do checkout`,
      isBottleneck: bottleneck === 2,
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-end">
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>

      {/* Funil */}
      <GlassCard className="p-5">
        <h2 className="section-head mb-4 text-sm font-semibold text-foreground">Funil de conversão</h2>
        <div className="flex flex-col gap-4">
          {steps.map((st, i) => {
            const w = Math.max(5, (st.value / max) * 100)
            return (
              <div key={st.label} className="flex flex-col gap-1">
                <div className="grid grid-cols-[140px_1fr_60px] items-center gap-3">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground">{st.label}</p>
                      <p className="text-xs text-muted-foreground">{st.sub}</p>
                    </div>
                    {/* Item 146: maior queda destacada com alerta âmbar */}
                    {st.isBottleneck ? (
                      <span
                        className="flex shrink-0 items-center"
                        title="Maior queda do funil — atenção nesta etapa"
                      >
                        <AlertTriangle className="size-3.5 text-warning" aria-hidden="true" />
                        <span className="sr-only">Maior queda do funil</span>
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2.5">
                    <div
                      className={
                        st.isBottleneck
                          ? 'h-8 flex-1 overflow-hidden rounded-md bg-muted/30 ring-1 ring-warning/40'
                          : 'h-8 flex-1 overflow-hidden rounded-md bg-muted/30'
                      }
                    >
                      {/* Item 143: preenchimento da esquerda com stagger de 300ms */}
                      <div
                        key={`${period}-${st.value}`}
                        className="funnel-bar h-full rounded-md"
                        style={{
                          width: `${w}%`,
                          background: st.bar,
                          animationDelay: `${i * 300}ms`,
                        }}
                      />
                    </div>
                    {/* Itens 108/147: cápsula glass com CountUp mono */}
                    <span
                      className="glass shrink-0 rounded-full px-2.5 py-0.5 font-mono text-xs font-semibold tabular-nums"
                      style={{ color: st.color }}
                    >
                      <CountUp value={st.value} />
                    </span>
                  </div>
                  <span className="text-right font-mono text-sm font-semibold tabular-nums text-muted-foreground">
                    {st.rate}
                  </span>
                </div>
                {/* Item 145: taxa de conversão da etapa anterior */}
                {st.stepRate ? (
                  <p className="pl-[152px] font-mono text-[10.5px] tabular-nums text-faint">
                    {st.stepRate}
                  </p>
                ) : null}
              </div>
            )
          })}
        </div>
      </GlassCard>

      {/* Cards por gateway */}
      <div>
        <h2 className="section-head mb-3 text-sm font-semibold text-foreground">Conversão por gateway</h2>
        {m && m.byGateway.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {m.byGateway.map((g, i) => {
              const conv = g.checkout ? +((g.purchased / g.checkout) * 100).toFixed(1) : 0
              const color = GW_COLORS[i % GW_COLORS.length]
              return (
                <GlassCard key={g.name} className="p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <span
                      className="rounded-md px-2 py-0.5 text-xs font-semibold text-white"
                      style={{ backgroundColor: color }}
                    >
                      {gwLabel(g.name)}
                    </span>
                    <span className="ml-auto text-xs text-muted-foreground">{conv}% conversão</span>
                  </div>
                  <div className="flex gap-5">
                    <div>
                      <p className="label-mono">Checkouts</p>
                      <p className="font-mono text-lg font-semibold text-foreground">{g.checkout}</p>
                    </div>
                    <div>
                      <p className="label-mono">Compras</p>
                      <p className="font-mono text-lg font-semibold" style={{ color }}>
                        {g.purchased}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted/30">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${Math.min(100, conv)}%`, backgroundColor: color }}
                    />
                  </div>
                </GlassCard>
              )
            })}
          </div>
        ) : (
          <GlassCard className="p-8 text-center text-sm text-muted-foreground">
            Nenhum checkout registrado neste período.
          </GlassCard>
        )}
      </div>

      {/* Tabela de leads */}
      <LeadsTable leads={data?.leads ?? []} periodStart={periodStart(period)} />
    </div>
  )
}
