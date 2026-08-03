'use client'

// Linha de KPIs da aba TikTok Ads. Os valores oficiais e os deltas vêm de
// /api/ads/kpis (advertiser inteiro, todos os status); a página atual da árvore
// só serve de fallback explícito enquanto o total não está disponível.

import type { ReactNode } from 'react'
import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import { useAdsKpis } from '@/lib/api'
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
  // Deltas vs. período anterior — sem base, a seta simplesmente não aparece.
  const { data: kpis, isLoading } = useAdsKpis(active, adAccountId, { fromDate, toDate })
  const deltas = kpis?.deltas

  // Valores: preferem os totais do backend (advertiser INTEIRO no período,
  // mesma base dos deltas — sem "US$ 0,00 com +300%" quando o filtro de
  // status esconde campanhas). Fallback: agregado local da página da árvore.
  const cur = kpis?.current
  const spend = cur?.spend ?? kpi.spend
  const impressions = cur?.impressions ?? kpi.impressions
  const clicks = cur?.clicks ?? kpi.clicks
  const ctr = cur?.ctr ?? kpi.ctr
  const cpm = cur?.cpm ?? kpi.cpm

  const periodLabel = fromDate === toDate ? 'Hoje' : `${fromDate} a ${toDate}`
  const zoneLabel = timeZone ? timeZone.replace(/_/g, ' ') : 'fuso da conta'

  if (isLoading && !kpis) {
    return (
      <section className="space-y-2" aria-label="Carregando totais da conta de anúncios">
        <Skeleton className="h-3 w-64" />
        <Skeleton className="h-[76px] rounded-2xl" />
      </section>
    )
  }

  const isAdvertiserTotal = Boolean(cur && kpis?.scope === 'advertiser_all_campaigns')

  // Um card único com 4 colunas divididas por hairline — antes eram 4 cards
  // soltos (4 bordas, 4 sombras) que poluíam o topo. Menos elementos, leitura
  // em linha. `sub` é a 2ª linha opcional (ex.: cliques do CTR).
  const cells: { label: string; value: ReactNode; delta?: number | null; goodWhenUp?: boolean; sub?: string }[] = [
    {
      label: isAdvertiserTotal ? 'Investimento' : 'Investido (carregado)',
      value: <CountUp value={spend} format={(v) => fmtSpend(v, currency)} />,
      delta: deltas?.spend,
    },
    { label: 'Impressões', value: <CountUp value={impressions} format={fmtCompact} />, delta: deltas?.impressions },
    {
      label: 'CTR',
      value: <CountUp value={ctr} format={(v) => fmtPercent(v)} />,
      delta: deltas?.ctr,
      sub: `${fmtCompact(clicks)} clique${clicks === 1 ? '' : 's'}`,
    },
    { label: 'CPM', value: <CountUp value={cpm} format={(v) => fmtSpend(v, currency)} />, delta: deltas?.cpm, goodWhenUp: false },
  ]

  return (
    <section className="space-y-2" aria-label={isAdvertiserTotal ? 'Totais da conta de anúncios' : 'Subtotal carregado da lista'}>
      <p className="text-[11px] text-muted-foreground">
        {isAdvertiserTotal ? 'Total da conta' : 'Subtotal carregado'} · {periodLabel} · {zoneLabel}
      </p>
      <GlassCard className="overflow-hidden p-0">
        <div className="grid grid-cols-2 divide-x divide-y divide-border/70 sm:grid-cols-4 sm:divide-y-0">
          {cells.map((cell) => (
            <div key={cell.label} className="p-3.5">
              <div className="flex items-center gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{cell.label}</p>
                <Delta value={cell.delta} goodWhenUp={cell.goodWhenUp} />
              </div>
              <p className="mt-1 text-xl font-bold tracking-tight text-foreground sm:text-2xl">{cell.value}</p>
              {cell.sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{cell.sub}</p>}
            </div>
          ))}
        </div>
      </GlassCard>
    </section>
  )
}
