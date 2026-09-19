'use client'

import { useMemo, useState } from 'react'
import { RotateCcw, SlidersHorizontal, TrendingUp, Users } from 'lucide-react'
import type { OverviewPeriodMetrics } from '@/lib/types'
import { fmtDelta, fmtInt, fmtPercent, formatMoney } from '@/lib/format'
import { GlassCard } from '@/components/glass-card'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function ScenarioSimulator({
  current,
  currentRevenue,
}: {
  current: OverviewPeriodMetrics
  currentRevenue: number
}) {
  const [trafficDelta, setTrafficDelta] = useState(0)
  const [conversionDelta, setConversionDelta] = useState(0)

  const model = useMemo(() => {
    const baselineVisits = current.visits
    const baselinePurchases = current.purchased
    const baselineConversion = baselineVisits > 0 ? (baselinePurchases / baselineVisits) * 100 : 0
    const revenueSales = current.revenueSales > 0 ? current.revenueSales : baselinePurchases
    const averageTicket = revenueSales > 0 ? currentRevenue / revenueSales : 0

    const projectedVisits = Math.max(0, Math.round(baselineVisits * (1 + trafficDelta / 100)))
    const projectedConversion = clamp(baselineConversion + conversionDelta, 0, 100)
    const projectedPurchases = Math.max(0, Math.round(projectedVisits * (projectedConversion / 100)))
    const projectedRevenue = Math.round(projectedPurchases * averageTicket)
    const revenueDelta = currentRevenue > 0 ? ((projectedRevenue - currentRevenue) / currentRevenue) * 100 : null

    return {
      baselineVisits,
      baselinePurchases,
      baselineConversion,
      averageTicket,
      projectedVisits,
      projectedConversion,
      projectedPurchases,
      projectedRevenue,
      revenueDelta,
    }
  }, [current.visits, current.purchased, current.revenueSales, currentRevenue, trafficDelta, conversionDelta])

  const ready = model.baselineVisits > 0 && model.averageTicket > 0

  return (
    <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
      <GlassCard className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="size-4 text-brand-cyan" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-foreground">Hipóteses</h2>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              Ajuste tráfego e conversão para visualizar um cenário matemático usando o ticket médio atual.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setTrafficDelta(0)
              setConversionDelta(0)
            }}
            className="btn-ghost px-2.5 py-2 text-xs"
            disabled={trafficDelta === 0 && conversionDelta === 0}
          >
            <RotateCcw className="size-3.5" aria-hidden="true" />
            Resetar
          </button>
        </div>

        <div className="mt-6 grid gap-6">
          <label className="grid gap-3">
            <span className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-foreground">Variação de tráfego</span>
              <span className="rounded-lg border border-border/60 bg-secondary/20 px-2 py-1 text-xs font-semibold tabular-nums text-foreground">
                {trafficDelta > 0 ? '+' : ''}{trafficDelta}%
              </span>
            </span>
            <input
              type="range"
              min="-50"
              max="200"
              step="5"
              value={trafficDelta}
              onChange={event => setTrafficDelta(Number(event.target.value))}
              className="w-full accent-cyan-400"
              aria-label="Variação de tráfego em porcentagem"
            />
            <span className="text-[10px] text-muted-foreground">De −50% a +200% sobre as visitas do período atual.</span>
          </label>

          <label className="grid gap-3">
            <span className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-foreground">Variação de conversão</span>
              <span className="rounded-lg border border-border/60 bg-secondary/20 px-2 py-1 text-xs font-semibold tabular-nums text-foreground">
                {conversionDelta > 0 ? '+' : ''}{conversionDelta.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} p.p.
              </span>
            </span>
            <input
              type="range"
              min="-5"
              max="10"
              step="0.5"
              value={conversionDelta}
              onChange={event => setConversionDelta(Number(event.target.value))}
              className="w-full accent-cyan-400"
              aria-label="Variação de conversão em pontos percentuais"
            />
            <span className="text-[10px] text-muted-foreground">Ajuste absoluto em pontos percentuais sobre a conversão atual.</span>
          </label>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-border/60 bg-secondary/10 p-3">
            <p className="text-[9px] uppercase tracking-[0.16em] text-muted-foreground">Conversão base</p>
            <p className="mt-1 text-sm font-semibold text-foreground">{fmtPercent(model.baselineConversion)}</p>
          </div>
          <div className="rounded-2xl border border-border/60 bg-secondary/10 p-3">
            <p className="text-[9px] uppercase tracking-[0.16em] text-muted-foreground">Ticket médio</p>
            <p className="mt-1 text-sm font-semibold text-foreground" data-private="true">{formatMoney(model.averageTicket, current.mainCur)}</p>
          </div>
        </div>
      </GlassCard>

      <GlassCard className="p-4 sm:p-5">
        <div className="flex items-center gap-2">
          <TrendingUp className="size-4 text-brand-cyan" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-foreground">Cenário projetado</h2>
        </div>

        {!ready ? (
          <div className="mt-5 rounded-2xl border border-dashed border-border/70 p-8 text-center">
            <Users className="mx-auto size-5 text-muted-foreground" aria-hidden="true" />
            <p className="mt-2 text-sm font-medium text-foreground">Base insuficiente para simular</p>
            <p className="mt-1 text-[11px] text-muted-foreground">É necessário ter visitas e receita no período para calcular ticket médio e projeção.</p>
          </div>
        ) : (
          <>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-border/60 bg-secondary/10 p-4">
                <p className="text-[9px] uppercase tracking-[0.16em] text-muted-foreground">Visitas</p>
                <p className="mt-2 text-xl font-semibold text-foreground">{fmtInt(model.projectedVisits)}</p>
                <p className="mt-1 text-[10px] text-muted-foreground">base: {fmtInt(model.baselineVisits)}</p>
              </div>
              <div className="rounded-2xl border border-border/60 bg-secondary/10 p-4">
                <p className="text-[9px] uppercase tracking-[0.16em] text-muted-foreground">Conversão</p>
                <p className="mt-2 text-xl font-semibold text-foreground">{fmtPercent(model.projectedConversion)}</p>
                <p className="mt-1 text-[10px] text-muted-foreground">base: {fmtPercent(model.baselineConversion)}</p>
              </div>
              <div className="rounded-2xl border border-brand-cyan/15 bg-brand-cyan/[0.04] p-4">
                <p className="text-[9px] uppercase tracking-[0.16em] text-muted-foreground">Compras estimadas</p>
                <p className="mt-2 text-xl font-semibold text-brand-cyan">{fmtInt(model.projectedPurchases)}</p>
                <p className="mt-1 text-[10px] text-muted-foreground">base: {fmtInt(model.baselinePurchases)}</p>
              </div>
              <div className="rounded-2xl border border-brand-cyan/15 bg-brand-cyan/[0.04] p-4">
                <p className="text-[9px] uppercase tracking-[0.16em] text-muted-foreground">Receita estimada</p>
                <p className="mt-2 text-xl font-semibold text-brand-cyan" data-private="true">{formatMoney(model.projectedRevenue, current.mainCur)}</p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {model.revenueDelta == null ? 'sem base comparável' : `${fmtDelta(model.revenueDelta)} vs. atual`}
                </p>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-border/60 bg-secondary/10 p-4">
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                Simulação determinística: mantém o ticket médio constante e aplica apenas as duas hipóteses acima. Não considera mudanças de mix, custo, sazonalidade ou comportamento de pagamento.
              </p>
            </div>
          </>
        )}
      </GlassCard>
    </div>
  )
}
