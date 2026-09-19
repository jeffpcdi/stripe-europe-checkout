'use client'

import Link from 'next/link'
import { AlertTriangle, ArrowUpRight, CheckCircle2, CircleAlert, Info, Radar } from 'lucide-react'
import type { OverviewHealthResponse, OverviewPeriodMetrics } from '@/lib/types'
import { buildInsightAnomalies } from '@/lib/insight-anomalies'
import { GlassCard } from '@/components/glass-card'
import { fmtInt } from '@/lib/format'

interface AnomaliesPanelProps {
  current: OverviewPeriodMetrics
  previous: OverviewPeriodMetrics | null
  health?: OverviewHealthResponse | null
  currentRevenue: number
  previousRevenue: number | null
  bottleneck?: {
    from: string
    to: string
    drop: number
    lost: number
  } | null
  sourceConcentration?: number | null
}

export function AnomaliesPanel(props: AnomaliesPanelProps) {
  const anomalies = buildInsightAnomalies(props)
  const critical = anomalies.filter(item => item.severity === 'critical').length
  const warning = anomalies.filter(item => item.severity === 'warning').length
  const info = anomalies.filter(item => item.severity === 'info').length

  return (
    <div className="flex flex-col gap-4">
      <section className="grid gap-3 sm:grid-cols-3" aria-label="Resumo de anomalias">
        <GlassCard className="p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Críticas</span>
            <AlertTriangle className="size-4 text-destructive" aria-hidden="true" />
          </div>
          <p className="mt-3 text-2xl font-semibold text-foreground">{fmtInt(critical)}</p>
          <p className="mt-1 text-[10px] text-muted-foreground">Mudanças com maior risco operacional.</p>
        </GlassCard>
        <GlassCard className="p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Atenção</span>
            <CircleAlert className="size-4 text-warning" aria-hidden="true" />
          </div>
          <p className="mt-3 text-2xl font-semibold text-foreground">{fmtInt(warning)}</p>
          <p className="mt-1 text-[10px] text-muted-foreground">Sinais que merecem investigação.</p>
        </GlassCard>
        <GlassCard className="p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Contexto</span>
            <Info className="size-4 text-brand-cyan" aria-hidden="true" />
          </div>
          <p className="mt-3 text-2xl font-semibold text-foreground">{fmtInt(info)}</p>
          <p className="mt-1 text-[10px] text-muted-foreground">Concentrações e padrões informativos.</p>
        </GlassCard>
      </section>

      <GlassCard className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Radar className="size-4 text-brand-cyan" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-foreground">Radar automático</h2>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">Prioridades calculadas a partir do período atual, período anterior e saúde do rastreamento.</p>
          </div>
          <span className={`rounded-full border px-2.5 py-1 text-[10px] font-medium ${
            critical > 0
              ? 'border-destructive/20 bg-destructive/10 text-destructive'
              : warning > 0
                ? 'border-warning/20 bg-warning/10 text-warning'
                : 'border-success/20 bg-success/10 text-success'
          }`}>
            {anomalies.length ? `${fmtInt(anomalies.length)} sinal${anomalies.length === 1 ? '' : 'is'}` : 'estável'}
          </span>
        </div>

        {anomalies.length ? (
          <div className="mt-4 grid gap-2">
            {anomalies.map(item => {
              const Icon = item.severity === 'critical' ? AlertTriangle : item.severity === 'warning' ? CircleAlert : Info
              const tone = item.severity === 'critical'
                ? 'border-destructive/20 bg-destructive/[0.05]'
                : item.severity === 'warning'
                  ? 'border-warning/20 bg-warning/[0.05]'
                  : 'border-brand-cyan/15 bg-brand-cyan/[0.04]'
              const iconTone = item.severity === 'critical' ? 'text-destructive' : item.severity === 'warning' ? 'text-warning' : 'text-brand-cyan'

              const body = (
                <div className={`rounded-2xl border p-4 transition-colors ${tone} ${item.href ? 'hover:bg-secondary/20' : ''}`}>
                  <div className="flex items-start gap-3">
                    <span className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-black/15 ${iconTone}`}>
                      <Icon className="size-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-foreground">{item.title}</p>
                        {item.metric ? <span className="text-[10px] font-medium tabular-nums text-muted-foreground">{item.metric}</span> : null}
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
          <div className="mt-5 rounded-2xl border border-success/20 bg-success/[0.05] p-7 text-center">
            <CheckCircle2 className="mx-auto size-6 text-success" aria-hidden="true" />
            <p className="mt-2 text-sm font-semibold text-foreground">Nenhuma anomalia relevante</p>
            <p className="mt-1 text-[11px] text-muted-foreground">Os principais indicadores, funil e cobertura não ultrapassaram os limites automáticos de atenção.</p>
          </div>
        )}
      </GlassCard>
    </div>
  )
}
