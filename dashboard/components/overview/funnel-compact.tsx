'use client'

// Redesign: funil compacto do overview — barras horizontais enxutas no formato
// "label · barra · número", SEM sub-legendas por etapa. O alerta de gargalo é
// uma faixa vermelha discreta no rodapé do card (não um badge por linha).
// Recebe as métricas JÁ agregadas (PeriodMetrics) por prop — não refaz
// aggregate() nem dispara request. A página /funnel segue com a análise cheia.

import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import type { PeriodMetrics } from '@/lib/metrics'
import { fmtPercent } from '@/lib/format'
import { CountUp } from '@/components/count-up'
import { SectionTitle } from '@/components/section-title'

export function FunnelCompact({
  metrics: m,
  periodLabel,
}: {
  metrics: PeriodMetrics
  /** rótulo do período do PeriodPicker único (ex.: "hoje", "7 dias") */
  periodLabel: string
}) {
  const max = Math.max(m.visits, 1)
  const v2c = m.visits ? +((m.reachedCheckout / m.visits) * 100).toFixed(1) : 0
  const c2p = m.reachedCheckout ? +((m.purchased / m.reachedCheckout) * 100).toFixed(1) : 0

  // Gargalo: a maior queda percentual entre etapas (item 146).
  const dropV2C = m.visits ? 100 - v2c : 0
  const dropC2P = m.reachedCheckout ? 100 - c2p : 0
  const hasFlow = m.visits > 0 || m.reachedCheckout > 0
  const bottleneck =
    !hasFlow
      ? null
      : dropV2C >= dropC2P
        ? { where: 'Visita \u2192 Checkout', drop: dropV2C }
        : { where: 'Checkout \u2192 Compra', drop: dropC2P }

  const attempts = m.sales + m.failed
  const showAttempts = attempts > 0

  const steps = [
    { label: 'Visitaram', value: m.visits, alpha: 1 },
    { label: 'Checkout', value: m.reachedCheckout, alpha: 0.72 },
    ...(showAttempts ? [{ label: 'Tentaram pagar', value: attempts, alpha: 0.58 }] : []),
    { label: 'Compraram', value: m.purchased, alpha: 0.44 },
  ]

  return (
    <div className="hero-glass-panel flex h-full flex-col p-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <SectionTitle>
          Funil · {periodLabel}
        </SectionTitle>
        <Link
          href="/funnel"
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          ver completo
          <ArrowUpRight className="size-3" aria-hidden="true" />
        </Link>
      </div>

      {/* label · barra · número — nada mais por etapa */}
      <div className="flex flex-1 flex-col justify-center gap-3">
        {steps.map((st, i) => {
          const w = Math.max(4, (st.value / max) * 100)
          return (
            <div
              key={st.label}
              className="grid grid-cols-[96px_1fr_56px] items-center gap-3"
            >
              <span className="truncate text-xs font-medium text-muted-foreground">
                {st.label}
              </span>
              <div className="h-5 overflow-hidden rounded bg-white/[0.04]">
                <div
                  className="funnel-bar h-full rounded"
                  style={{
                    width: `${w}%`,
                    background: `linear-gradient(90deg, color-mix(in oklab, var(--accent) ${st.alpha * 100}%, transparent), color-mix(in oklab, var(--accent) ${st.alpha * 50}%, transparent))`,
                    boxShadow: `0 0 12px color-mix(in oklab, var(--accent) ${st.alpha * 40}%, transparent)`,
                    animationDelay: `${i * 200}ms`,
                  }}
                />
              </div>
              <span className="text-right font-mono text-sm font-semibold tabular-nums text-foreground">
                <CountUp value={st.value} />
              </span>
            </div>
          )
        })}
      </div>

      {/* Gargalo — faixa vermelha discreta no rodapé */}
      {bottleneck && bottleneck.drop > 0 ? (
        <p className="mt-4 rounded border-l-2 border-l-[#fe2c55] bg-[rgba(254,44,85,.06)] px-3 py-2 font-mono text-[10.5px] tabular-nums text-[#fe2c55]/90">
          Gargalo: {bottleneck.where} ({'\u2212'}{fmtPercent(bottleneck.drop)})
        </p>
      ) : null}
    </div>
  )
}
