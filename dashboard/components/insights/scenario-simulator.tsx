'use client'

import { useMemo, useState } from 'react'
import { RotateCcw, SlidersHorizontal } from 'lucide-react'
import { fmtDelta, fmtInt, formatMoney } from '@/lib/format'
import { GlassCard } from '@/components/glass-card'

export function ScenarioSimulator({
  currency,
  currentRevenue,
  currentSales,
  baselineSpend,
  baselineCpa,
}: {
  currency: string
  currentRevenue: number
  currentSales: number
  baselineSpend: number | null
  baselineCpa: number | null
}) {
  const [spendDelta, setSpendDelta] = useState(0)
  const [cpaDelta, setCpaDelta] = useState(0)

  const model = useMemo(() => {
    const averageTicket = currentSales > 0 ? currentRevenue / currentSales : 0
    const spend = baselineSpend ?? 0
    const cpa = baselineCpa ?? 0
    const projectedSpend = Math.max(0, spend * (1 + spendDelta / 100))
    const projectedCpa = Math.max(0.01, cpa * (1 + cpaDelta / 100))
    const projectedSales = projectedSpend > 0 && projectedCpa > 0 ? Math.max(0, Math.round(projectedSpend / projectedCpa)) : 0
    const projectedRevenue = Math.round(projectedSales * averageTicket)
    const projectedRoas = projectedSpend > 0 ? (projectedRevenue / 100) / projectedSpend : null
    const revenueDelta = currentRevenue > 0 ? ((projectedRevenue - currentRevenue) / currentRevenue) * 100 : null
    return { averageTicket, projectedSpend, projectedCpa, projectedSales, projectedRevenue, projectedRoas, revenueDelta }
  }, [baselineSpend, baselineCpa, currentRevenue, currentSales, spendDelta, cpaDelta])

  const ready = (baselineSpend ?? 0) > 0 && (baselineCpa ?? 0) > 0 && model.averageTicket > 0

  return (
    <GlassCard className="overflow-hidden">
      <div className="flex items-center justify-between gap-4 px-5 py-4">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="size-4 text-brand-cyan" aria-hidden="true" />
          <h2 className="text-[15px] font-semibold text-foreground">Simular orçamento</h2>
        </div>
        <button
          type="button"
          onClick={() => { setSpendDelta(0); setCpaDelta(0) }}
          className="btn-ghost px-2.5 py-2 text-xs"
          disabled={spendDelta === 0 && cpaDelta === 0}
        >
          <RotateCcw className="size-3.5" aria-hidden="true" />
          Resetar
        </button>
      </div>

      {!ready ? (
        <div className="border-t border-border/60 px-5 py-10 text-center text-sm text-muted-foreground">
          O simulador precisa de gasto, CPA e vendas do período.
        </div>
      ) : (
        <div className="grid border-t border-border/60 xl:grid-cols-[0.85fr_1.15fr]">
          <div className="grid gap-6 border-b border-border/60 p-5 xl:border-b-0 xl:border-r">
            <label className="grid gap-3">
              <span className="flex items-center justify-between gap-3 text-xs">
                <span className="font-medium text-foreground">Investimento</span>
                <span className="font-semibold tabular-nums text-foreground">{spendDelta > 0 ? '+' : ''}{spendDelta}%</span>
              </span>
              <input
                type="range"
                min="-50"
                max="100"
                step="5"
                value={spendDelta}
                onChange={event => setSpendDelta(Number(event.target.value))}
                className="w-full accent-cyan-400"
                aria-label="Variação de investimento"
              />
            </label>

            <label className="grid gap-3">
              <span className="flex items-center justify-between gap-3 text-xs">
                <span className="font-medium text-foreground">CPA</span>
                <span className="font-semibold tabular-nums text-foreground">{cpaDelta > 0 ? '+' : ''}{cpaDelta}%</span>
              </span>
              <input
                type="range"
                min="-30"
                max="50"
                step="5"
                value={cpaDelta}
                onChange={event => setCpaDelta(Number(event.target.value))}
                className="w-full accent-cyan-400"
                aria-label="Variação de CPA"
              />
            </label>

            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <span className="text-muted-foreground">Gasto base</span>
                <p className="mt-1 font-semibold text-foreground">{formatMoney(Math.round((baselineSpend || 0) * 100), currency)}</p>
              </div>
              <div>
                <span className="text-muted-foreground">CPA base</span>
                <p className="mt-1 font-semibold text-foreground">{formatMoney(Math.round((baselineCpa || 0) * 100), currency)}</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4">
            {[
              ['Investimento', formatMoney(Math.round(model.projectedSpend * 100), currency)],
              ['Compras', fmtInt(model.projectedSales)],
              ['Receita', formatMoney(model.projectedRevenue, currency)],
              ['ROAS', model.projectedRoas == null ? '—' : `${model.projectedRoas.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x`],
            ].map(([label, value], index) => (
              <div key={label} className={`p-5 ${index % 2 === 0 ? 'border-r border-border/40' : ''} ${index < 2 ? 'border-b border-border/40 sm:border-b-0' : ''} sm:border-r sm:last:border-r-0`}>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="mt-2 text-xl font-semibold tracking-tight text-foreground" data-private={label === 'Receita' ? 'true' : undefined}>{value}</p>
              </div>
            ))}
            <div className="col-span-2 border-t border-border/40 px-5 py-3 text-xs text-muted-foreground sm:col-span-4">
              {model.revenueDelta == null ? 'Projeção simples.' : `${fmtDelta(model.revenueDelta)} de receita vs. atual.`} Mantém ticket médio constante e não estima saturação do leilão.
            </div>
          </div>
        </div>
      )}
    </GlassCard>
  )
}
