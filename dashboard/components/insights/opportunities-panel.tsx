'use client'

import Link from 'next/link'
import { ArrowUpRight, CheckCircle2, Sparkles, TrendingUp, Zap } from 'lucide-react'
import type { OverviewPeriodMetrics } from '@/lib/types'
import { buildInsightOpportunities } from '@/lib/insight-opportunities'
import { GlassCard } from '@/components/glass-card'

interface OpportunitiesPanelProps {
  current: OverviewPeriodMetrics
  previous: OverviewPeriodMetrics | null
  currentRevenue: number
  previousRevenue: number | null
  purchaseCoverageRate?: number | null
  attributionRate?: number | null
}

export function OpportunitiesPanel(props: OpportunitiesPanelProps) {
  const opportunities = buildInsightOpportunities(props)

  return (
    <div className="flex flex-col gap-4">
      <GlassCard className="p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-brand-cyan" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-foreground">Sinais positivos</h2>
            </div>
            <p className="mt-1 max-w-xl text-[11px] leading-relaxed text-muted-foreground">
              Padrões que melhoraram ou se destacaram no período. São sinais descritivos, não decisões automáticas.
            </p>
          </div>
          <span className="rounded-full border border-brand-cyan/20 bg-brand-cyan/10 px-2.5 py-1 text-[10px] font-medium text-brand-cyan">
            {opportunities.length ? `${opportunities.length} encontrado${opportunities.length === 1 ? '' : 's'}` : 'sem sinal forte'}
          </span>
        </div>

        {opportunities.length ? (
          <div className="mt-5 grid gap-3 lg:grid-cols-2">
            {opportunities.map((item, index) => {
              const Icon = index === 0 ? Zap : TrendingUp
              const body = (
                <div className="h-full rounded-2xl border border-brand-cyan/15 bg-brand-cyan/[0.04] p-4 transition-colors hover:bg-brand-cyan/[0.07]">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl border border-brand-cyan/15 bg-brand-cyan/10 text-brand-cyan">
                      <Icon className="size-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="text-xs font-semibold text-foreground">{item.title}</p>
                        {item.metric ? <span className="text-[10px] font-semibold tabular-nums text-brand-cyan">{item.metric}</span> : null}
                      </div>
                      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{item.detail}</p>
                    </div>
                    {item.href ? <ArrowUpRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /> : null}
                  </div>
                </div>
              )

              return item.href ? <Link key={item.id} href={item.href}>{body}</Link> : <div key={item.id}>{body}</div>
            })}
          </div>
        ) : (
          <div className="mt-5 rounded-2xl border border-dashed border-border/70 p-8 text-center">
            <CheckCircle2 className="mx-auto size-5 text-muted-foreground" aria-hidden="true" />
            <p className="mt-2 text-sm font-medium text-foreground">Ainda sem oportunidade destacada</p>
            <p className="mt-1 text-[11px] text-muted-foreground">O radar precisa de comparação ou volume mínimo antes de destacar crescimento e eficiência.</p>
          </div>
        )}
      </GlassCard>
    </div>
  )
}
