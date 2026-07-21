'use client'

// Linha de KPIs da aba TikTok Ads — extraída do tiktok-ads-view.tsx.
// Os VALORES continuam vindo da página atual da árvore (client-side, como
// antes); o que vem do backend é o DELTA vs. período anterior (/api/ads/kpis,
// espelho Neon). Sem base de comparação → a seta simplesmente não aparece.

import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import { useAdsKpis } from '@/lib/api'
import { GlassCard } from '@/components/glass-card'
import { CountUp } from '@/components/count-up'
import { SparkLine } from '@/components/sparkline'
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
}: {
  kpi: KpiRowData
  currency: string
  active: boolean
  adAccountId: string
  fromDate: string
  toDate: string
}) {
  // Deltas vs. período anterior — falha silenciosa: sem Neon/sem dado, os
  // cards ficam idênticos ao comportamento antigo (sem seta).
  const { data: kpis } = useAdsKpis(active, adAccountId, { fromDate, toDate })
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

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <GlassCard className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Investimento</p>
              <Delta value={deltas?.spend} />
            </div>
            <p className="mt-1 text-2xl font-bold tracking-tight text-foreground">
              <CountUp value={spend} format={(v) => fmtSpend(v, currency)} />
            </p>
          </div>
          {kpi.spendSeries.length > 1 && (
            <div className="opacity-70">
              <SparkLine data={kpi.spendSeries} color="var(--brand-cyan, #25f4ee)" width={72} height={26} />
            </div>
          )}
        </div>
      </GlassCard>
      
      <GlassCard className="p-4">
        <div className="flex items-center gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Impressões</p>
          <Delta value={deltas?.impressions} />
        </div>
        <p className="mt-1 text-2xl font-bold tracking-tight text-foreground">
          <CountUp value={impressions} format={fmtCompact} />
        </p>
      </GlassCard>

      <GlassCard className="p-4">
        <div className="flex items-center gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">CTR</p>
          <Delta value={deltas?.ctr} />
        </div>
        <p className="mt-1 text-2xl font-bold tracking-tight text-foreground">
          <CountUp value={ctr} format={(v) => fmtPercent(v)} />
        </p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {fmtCompact(clicks)} clique{clicks === 1 ? '' : 's'}
        </p>
      </GlassCard>

      <GlassCard className="p-4">
        <div className="flex items-center gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">CPM</p>
          {/* CPM subir é ruim: cor invertida */}
          <Delta value={deltas?.cpm} goodWhenUp={false} />
        </div>
        <p className="mt-1 text-2xl font-bold tracking-tight text-foreground">
          <CountUp value={cpm} format={(v) => fmtSpend(v, currency)} />
        </p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {kpi.activeCount} campanha{kpi.activeCount === 1 ? '' : 's'} ativa{kpi.activeCount === 1 ? '' : 's'}
        </p>
      </GlassCard>
    </div>
  )
}
