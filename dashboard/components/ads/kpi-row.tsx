'use client'

// Linha de KPIs da aba TikTok Ads. Os valores oficiais e os deltas vêm de
// /api/ads/kpis (advertiser inteiro, todos os status); a página atual da árvore
// só serve de fallback explícito enquanto o total não está disponível.

import type { ReactNode } from 'react'
import { ArrowDownRight, ArrowUpRight, TrendingUp, DollarSign, Target, ShoppingCart } from 'lucide-react'
import { useAdsKpis, useAdsRoas } from '@/lib/api'
import { GlassCard } from '@/components/glass-card'
import { CountUp } from '@/components/count-up'
import { Skeleton } from '@/components/skeleton'
import { fmtCompact, fmtPercent, fmtSpend } from '@/lib/format'

// Seta + % de variação. `goodWhenUp=false` inverte a cor (CPM subir é ruim).
function Delta({ value, goodWhenUp = true }: { value: number | null | undefined; goodWhenUp?: boolean }) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null
  const up = value >= 0
  const good = goodWhenUp ? up : !up
  return (
    <span
      className={`flex items-center gap-0.5 text-[11px] font-bold tabular-nums ${good ? 'text-success drop-shadow-[0_0_6px_rgba(34,197,94,0.6)]' : 'text-error drop-shadow-[0_0_6px_rgba(239,68,68,0.6)]'}`}
      title="vs. período anterior de mesma duração"
    >
      {up ? (
        <ArrowUpRight className="size-3" aria-hidden="true" />
      ) : (
        <ArrowDownRight className="size-3" aria-hidden="true" />
      )}
      {Math.abs(value).toFixed(1)}%
      <span className="sr-only">{up ? 'acima' : 'abaixo'} do período anterior</span>
    </span>
  )
}

export interface KpiRowData {
  spend: number
  impressions: number
  clicks: number
  ctr: number
  cpm: number
  activeCount: number
  spendSeries: number[]
}

export function KpiRow({
  kpi,
  currency,
  active,
  adAccountId,
  fromDate,
  toDate,
  timeZone,
}: {
  kpi: KpiRowData
  currency: string
  active: boolean
  adAccountId: string
  fromDate: string
  toDate: string
  timeZone?: string
}) {
  // Deltas vs. período anterior
  const { data: kpis, isLoading: kpisLoading } = useAdsKpis(active, adAccountId, { fromDate, toDate })
  const { data: roasData, isLoading: roasLoading } = useAdsRoas(active, adAccountId, { fromDate, toDate })
  const deltas = kpis?.deltas

  // Valores oficiais com fallback
  const cur = kpis?.current
  const spend = cur?.spend ?? kpi.spend
  const impressions = cur?.impressions ?? kpi.impressions
  const clicks = cur?.clicks ?? kpi.clicks
  const ctr = cur?.ctr ?? kpi.ctr
  const cpm = cur?.cpm ?? kpi.cpm

  const revenue = (roasData?.revenueCents ?? 0) / 100
  const sales = roasData?.sales ?? 0
  const roas = roasData?.roas ?? (spend > 0 && revenue > 0 ? revenue / spend : null)
  const cpa = roasData?.cpa ?? (sales > 0 && spend > 0 ? spend / sales : null)

  const periodLabel = fromDate === toDate ? 'Hoje' : `${fromDate} a ${toDate}`
  const zoneLabel = timeZone ? timeZone.replace(/_/g, ' ') : 'fuso da conta'

  if (kpisLoading && !kpis && roasLoading && !roasData) {
    return (
      <section className="space-y-2" aria-label="Carregando totais da conta de anúncios">
        <Skeleton className="h-3 w-64" />
        <Skeleton className="h-[96px] rounded-2xl" />
      </section>
    )
  }

  const isAdvertiserTotal = Boolean(cur && kpis?.scope === 'advertiser_all_campaigns')
  const isProfitable = roas !== null && roas >= 1

  return (
    <section className="space-y-2" aria-label="Métricas principais de conversão">
      <div className="flex items-center justify-between text-[11px] text-muted-foreground px-0.5">
        <p>
          {isAdvertiserTotal ? 'Total da conta' : 'Subtotal carregado'} · {periodLabel} · {zoneLabel}
        </p>
        <div className="hidden sm:flex items-center gap-3 text-[11px] text-muted-foreground">
          <span>CTR: <strong className="text-foreground">{fmtPercent(ctr)}</strong></span>
          <span>CPM: <strong className="text-foreground">{fmtSpend(cpm, currency)}</strong></span>
          <span>Cliques: <strong className="text-foreground">{fmtCompact(clicks)}</strong></span>
          <span>Impr.: <strong className="text-foreground">{fmtCompact(impressions)}</strong></span>
        </div>
      </div>

      <GlassCard className="overflow-hidden p-0 border-white/10 shadow-sm">
        <div className="grid grid-cols-2 divide-x divide-y divide-border/60 sm:grid-cols-4 sm:divide-y-0">
          {/* 1. INVESTIMENTO */}
          <div className="p-3.5 sm:p-4">
            <div className="flex items-center justify-between gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground flex items-center gap-1">
                <DollarSign className="size-3 text-muted-foreground" aria-hidden="true" />
                Investimento
              </span>
              <Delta value={deltas?.spend} />
            </div>
            <p className="mt-1.5 text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              <CountUp value={spend} format={(v) => fmtSpend(v, currency)} />
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground truncate">
              {impressions > 0 ? `${fmtCompact(impressions)} impressões` : 'Gasto em tráfego'}
            </p>
          </div>

          {/* 2. VENDAS REAIS */}
          <div className="p-3.5 sm:p-4">
            <div className="flex items-center justify-between gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground flex items-center gap-1">
                <ShoppingCart className="size-3 text-success" aria-hidden="true" />
                Vendas Reais
              </span>
              {sales > 0 && (
                <span className="inline-flex items-center rounded-full bg-success/10 px-1.5 py-0.2 text-[10px] font-semibold text-success">
                  {sales} {sales === 1 ? 'venda' : 'vendas'}
                </span>
              )}
            </div>
            <p className="mt-1.5 text-xl font-bold tracking-tight text-success sm:text-2xl">
              <CountUp value={revenue} format={(v) => fmtSpend(v, currency)} />
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground truncate">
              Receita rastreada via gateway
            </p>
          </div>

          {/* 3. ROAS REAL */}
          <div className="p-3.5 sm:p-4">
            <div className="flex items-center justify-between gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground flex items-center gap-1">
                <TrendingUp className="size-3 text-primary" aria-hidden="true" />
                ROAS Real
              </span>
              {roas !== null && (
                <span
                  className={`inline-flex items-center rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                    isProfitable ? 'bg-success/15 text-success' : 'bg-error/15 text-error'
                  }`}
                >
                  {isProfitable ? 'Lucro' : 'Abaixo de 1x'}
                </span>
              )}
            </div>
            <p
              className={`mt-1.5 text-xl font-bold tracking-tight sm:text-2xl ${
                roas === null
                  ? 'text-muted-foreground'
                  : isProfitable
                    ? 'text-success drop-shadow-[0_0_8px_rgba(34,197,94,0.3)]'
                    : 'text-error'
              }`}
            >
              {roas === null ? '—' : `${roas.toFixed(2).replace('.', ',')}x`}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground truncate">
              Receita ÷ Investimento
            </p>
          </div>

          {/* 4. CPA MÉDIO */}
          <div className="p-3.5 sm:p-4">
            <div className="flex items-center justify-between gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground flex items-center gap-1">
                <Target className="size-3 text-muted-foreground" aria-hidden="true" />
                CPA Médio
              </span>
            </div>
            <p className="mt-1.5 text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              {cpa === null ? '—' : fmtSpend(cpa, currency)}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground truncate">
              {sales > 0 ? `${sales} conversões confirmadas` : 'Custo por aquisição'}
            </p>
          </div>
        </div>
      </GlassCard>
    </section>
  )
}
