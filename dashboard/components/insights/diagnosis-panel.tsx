'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowUpRight, CheckCircle2, CircleAlert, Sparkles } from 'lucide-react'
import type { OverviewHealthResponse, OverviewPeriodMetrics } from '@/lib/types'
import { buildInsightAnomalies } from '@/lib/insight-anomalies'
import { buildInsightOpportunities } from '@/lib/insight-opportunities'
import { fmtPercent } from '@/lib/format'
import { GlassCard } from '@/components/glass-card'

type Filter = 'all' | 'attention' | 'opportunity'

export function InsightsDiagnosisPanel({
  current,
  previous,
  health,
  currentRevenue,
  previousRevenue,
  bottleneck,
}: {
  current: OverviewPeriodMetrics
  previous: OverviewPeriodMetrics | null
  health?: OverviewHealthResponse | null
  currentRevenue: number
  previousRevenue: number | null
  bottleneck?: { from: string; to: string; drop: number; lost: number } | null
}) {
  const [filter, setFilter] = useState<Filter>('all')

  const anomalies = useMemo(() => buildInsightAnomalies({
    current,
    previous,
    health,
    currentRevenue,
    previousRevenue,
    bottleneck,
  }), [current, previous, health, currentRevenue, previousRevenue, bottleneck, sourceConcentration])

  const opportunities = useMemo(() => buildInsightOpportunities({
    current,
    previous,
    currentRevenue,
    previousRevenue,
    purchaseCoverageRate: health?.coverage.purchases.rate ?? null,
    attributionRate: health?.coverage.attribution.rate ?? null,
  }), [current, previous, currentRevenue, previousRevenue, health])

  const items = [
    ...anomalies.map(item => ({ ...item, kind: 'attention' as const, rank: item.severity === 'critical' ? 0 : item.severity === 'warning' ? 1 : 3 })),
    ...opportunities.map(item => ({ ...item, kind: 'opportunity' as const, severity: 'info' as const, rank: 2 })),
  ].sort((a, b) => a.rank - b.rank)

  const visible = filter === 'all' ? items : items.filter(item => item.kind === filter)
  const attentionCount = anomalies.filter(item => item.severity !== 'info').length

  const coverage = [
    { label: 'Compras', rate: health?.coverage.purchases.rate ?? null },
    { label: 'Atribuição', rate: health?.coverage.attribution.rate ?? null },
    { label: 'Geografia', rate: health?.coverage.geography.rate ?? null },
    {
      label: 'Hosts',
      rate: health
        ? health.coverage.hosts.total > 0
          ? ((health.coverage.hosts.total - health.coverage.hosts.uncovered) / health.coverage.hosts.total) * 100
          : 100
        : null,
    },
  ]

  return (
    <div className="grid gap-4">
      <GlassCard className="overflow-hidden">
        <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-[15px] font-semibold text-foreground">Diagnóstico</h2>
            {attentionCount > 0 ? <span className="rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning">{attentionCount}</span> : null}
          </div>
          <div className="flex items-center gap-1 rounded-xl border border-border/60 bg-secondary/10 p-1" role="tablist" aria-label="Filtro do diagnóstico">
            {([
              ['all', 'Tudo'],
              ['attention', 'Atenção'],
              ['opportunity', 'Oportunidades'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={filter === value}
                onClick={() => setFilter(value)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${filter === value ? 'bg-secondary/70 text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="border-t border-border/60">
          {visible.length ? visible.map(item => {
            const critical = item.kind === 'attention' && item.severity === 'critical'
            const Icon = item.kind === 'opportunity' ? Sparkles : critical ? AlertTriangle : CircleAlert
            const iconClass = item.kind === 'opportunity' ? 'text-brand-cyan' : critical ? 'text-destructive' : 'text-warning'
            const row = (
              <div className="flex items-start gap-3 border-b border-border/40 px-5 py-4 last:border-0 transition-colors hover:bg-secondary/10">
                <span className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-secondary/20 ${iconClass}`}>
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[13px] font-semibold text-foreground">{item.title}</p>
                    {item.metric ? <span className="text-[11px] font-medium tabular-nums text-muted-foreground">{item.metric}</span> : null}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.detail}</p>
                </div>
                {item.href ? <ArrowUpRight className="mt-1 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /> : null}
              </div>
            )
            return item.href ? <Link key={item.id} href={item.href}>{row}</Link> : <div key={item.id}>{row}</div>
          }) : (
            <div className="px-5 py-12 text-center">
              <CheckCircle2 className="mx-auto size-5 text-success" aria-hidden="true" />
              <p className="mt-2 text-sm font-medium text-foreground">Sem sinais relevantes</p>
            </div>
          )}
        </div>
      </GlassCard>

      <GlassCard className="px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[15px] font-semibold text-foreground">Saúde dos dados</h2>
          <Link href="/conversions" className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
            Rastreamento <ArrowUpRight className="size-3.5" />
          </Link>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-4">
          {coverage.map(item => (
            <div key={item.label}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs text-muted-foreground">{item.label}</span>
                <span className="text-sm font-semibold tabular-nums text-foreground">{item.rate == null ? '—' : fmtPercent(item.rate)}</span>
              </div>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-secondary/60">
                <div className="h-full rounded-full bg-brand-cyan" style={{ width: `${Math.max(0, Math.min(100, item.rate ?? 0))}%` }} />
              </div>
            </div>
          ))}
        </div>
      </GlassCard>
    </div>
  )
}
