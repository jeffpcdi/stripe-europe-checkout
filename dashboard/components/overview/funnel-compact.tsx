'use client'

// Fase 3: funil compacto para o overview unificado. Extraído de funnel-view.tsx
// SEM a tabela de leads, os filtros de link/campanha, o benchmark 30d e os
// tempos medianos (essas ferramentas de trabalho seguem na página /funnel). Aqui
// recebe as métricas JÁ agregadas do overview (PeriodMetrics) por prop — não
// refaz aggregate() nem dispara request. Mesma barra/identidade do funil cheio.

import Link from 'next/link'
import { AlertTriangle, ChevronDown, ArrowUpRight } from 'lucide-react'
import type { PeriodMetrics } from '@/lib/metrics'
import { fmtPercent, formatMoney } from '@/lib/format'
import { CountUp } from '@/components/count-up'
import { GlassCard } from '@/components/glass-card'

export function FunnelCompact({ metrics: m }: { metrics: PeriodMetrics }) {
  const max = Math.max(m.visits, 1)
  const v2c = m.visits ? +((m.reachedCheckout / m.visits) * 100).toFixed(1) : 0
  const c2p = m.reachedCheckout ? +((m.purchased / m.reachedCheckout) * 100).toFixed(1) : 0

  // Gargalo: a maior queda percentual entre etapas (item 146).
  const dropV2C = m.visits ? 100 - v2c : 0
  const dropC2P = m.reachedCheckout ? 100 - c2p : 0
  const bottleneck: 1 | 2 | null =
    !m.visits && !m.reachedCheckout ? null : dropV2C >= dropC2P ? 1 : 2

  // Tentativas do gateway (item 302): vendas + recusas. Sem filtro aqui, então
  // aparece sempre que houver ao menos uma tentativa registrada.
  const attempts = m.sales + m.failed
  const showAttempts = attempts > 0
  const a2p = attempts ? +((m.sales / attempts) * 100).toFixed(1) : 0

  const purchasedValue = m.rev[m.mainCur] ?? 0

  // Fase 2: fatia rastreada vs órfã, só quando há venda órfã.
  const orphanNote =
    m.orphanPurchases > 0
      ? `${m.purchased} rastreada${m.purchased === 1 ? '' : 's'} · ${m.orphanPurchases} não rastreada${m.orphanPurchases === 1 ? '' : 's'}`
      : null

  const steps = [
    {
      label: 'Visitaram',
      sub: 'topo do funil',
      value: m.visits,
      bar: 'var(--brand-grad)',
      rate: fmtPercent(100),
      stepRate: null as string | null,
      isBottleneck: false,
      money: null as string | null,
      orphanNote: null as string | null,
    },
    {
      label: 'Checkout',
      sub: 'entraram no checkout',
      value: m.reachedCheckout,
      bar: 'color-mix(in oklab, var(--accent) 72%, transparent)',
      rate: fmtPercent(v2c),
      stepRate: `${fmtPercent(v2c)} das visitas`,
      isBottleneck: bottleneck === 1,
      money: null as string | null,
      orphanNote: null as string | null,
    },
    ...(showAttempts
      ? [
          {
            label: 'Tentaram pagar',
            sub: 'tentativas no gateway',
            value: attempts,
            bar: 'color-mix(in oklab, var(--accent) 58%, transparent)',
            rate: fmtPercent(m.visits ? +((attempts / m.visits) * 100).toFixed(1) : 0),
            stepRate: `${m.failed} recusada${m.failed === 1 ? '' : 's'}`,
            isBottleneck: false,
            money: null as string | null,
            orphanNote: null as string | null,
          },
        ]
      : []),
    {
      label: 'Compraram',
      sub: 'pagamento aprovado',
      value: m.purchased,
      bar: 'color-mix(in oklab, var(--accent) 44%, transparent)',
      rate: fmtPercent(m.overall),
      stepRate: showAttempts ? `${fmtPercent(a2p)} de aprovação` : `${fmtPercent(c2p)} do checkout`,
      isBottleneck: bottleneck === 2,
      money: purchasedValue > 0 ? `${formatMoney(purchasedValue, m.mainCur)} em receita` : null,
      orphanNote,
    },
  ]

  return (
    <GlassCard className="p-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h3 className="section-head text-sm font-semibold text-foreground">Funil de conversão</h3>
        <Link
          href="/funnel"
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          ver funil completo
          <ArrowUpRight className="size-3" aria-hidden="true" />
        </Link>
      </div>

      <div className="flex flex-col gap-3">
        {steps.map((st, i) => {
          const w = Math.max(5, (st.value / max) * 100)
          return (
            <div key={st.label} className="flex flex-col gap-1">
              {i > 0 && st.stepRate ? (
                <div className="flex items-center gap-1.5 pb-0.5 font-mono text-[10px] tabular-nums text-faint">
                  <ChevronDown className="size-3" aria-hidden="true" />
                  <span>{st.stepRate}</span>
                  {st.isBottleneck ? (
                    <span className="badge-new rounded-full bg-[rgba(254,44,85,.12)] px-1.5 py-px font-semibold uppercase tracking-wider text-[#fe2c55]">
                      gargalo
                    </span>
                  ) : null}
                </div>
              ) : null}
              <div className="grid grid-cols-[104px_1fr_48px] items-center gap-2.5">
                <div className="flex min-w-0 items-center gap-1.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{st.label}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{st.sub}</p>
                  </div>
                  {st.isBottleneck ? (
                    <AlertTriangle
                      className="size-3.5 shrink-0 text-warning"
                      aria-label="Maior queda do funil"
                    />
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <div
                    className={
                      st.isBottleneck
                        ? 'h-7 flex-1 overflow-hidden rounded-md bg-muted/30 ring-1 ring-warning/40'
                        : 'h-7 flex-1 overflow-hidden rounded-md bg-muted/30'
                    }
                  >
                    <div
                      className="funnel-bar relative h-full rounded-md"
                      style={{ width: `${w}%`, background: st.bar, animationDelay: `${i * 300}ms` }}
                    >
                      {st.value > 0 ? <span className="funnel-flow" aria-hidden="true" /> : null}
                    </div>
                  </div>
                  <span className="glass shrink-0 rounded-full px-2 py-0.5 font-mono text-xs font-semibold tabular-nums text-[var(--accent)]">
                    <CountUp value={st.value} />
                  </span>
                </div>
                <span className="text-right font-mono text-sm font-semibold tabular-nums text-muted-foreground">
                  {st.rate}
                </span>
              </div>
              {st.money || st.orphanNote ? (
                <p className="font-mono text-[10.5px] tabular-nums text-faint">
                  {st.money ? <span data-sensitive>{st.money}</span> : null}
                  {st.orphanNote ? (
                    <span
                      className="text-warning"
                      title="Vendas confirmadas por webhook que não casaram com um lead rastreado. A receita as inclui; a taxa de conversão, não."
                    >
                      {st.money ? ' · ' : ''}
                      {st.orphanNote}
                    </span>
                  ) : null}
                </p>
              ) : null}
            </div>
          )
        })}
      </div>
    </GlassCard>
  )
}
