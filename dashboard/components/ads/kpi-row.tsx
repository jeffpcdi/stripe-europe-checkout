'use client'

import { useAdsKpis, useAdsRoas } from '@/lib/api'
import {
  ChartNoAxesCombined,
  ReceiptText,
  Wallet,
  Target,
  MousePointerClick,
  Eye,
  Percent,
  Coins,
  Sparkles,
  ArrowDownRight,
  ArrowUpRight,
  RefreshCw,
} from 'lucide-react'
import { CountUp } from '@/components/count-up'
import { Skeleton } from '@/components/skeleton'
import { fmtCompact, fmtPercent, fmtSpend, timeAgo } from '@/lib/format'

function MiniSparkline({ values, tone = 'cyan' }: { values: number[]; tone?: 'cyan' | 'green' | 'amber' | 'violet' }) {
  const clean = values.filter(Number.isFinite)
  if (clean.length < 2) return <span className="ads-kpi-sparkline-empty" aria-hidden="true" />
  const width = 132
  const height = 34
  const min = Math.min(...clean)
  const max = Math.max(...clean)
  const spread = Math.max(max - min, 1)
  const points = clean.map((value, index) => {
    const x = (index / Math.max(clean.length - 1, 1)) * width
    const y = height - 3 - ((value - min) / spread) * (height - 8)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  const area = `0,${height} ${points} ${width},${height}`

  return (
    <svg className="ads-kpi-sparkline" data-tone={tone} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Tendência no período">
      <polygon className="ads-kpi-sparkline-area" points={area} />
      <polyline className="ads-kpi-sparkline-line" points={points} />
    </svg>
  )
}

function Delta({ value }: { value: number | null | undefined }) {
  if (value == null || !Number.isFinite(value) || value === 0) return null
  const up = value > 0
  const Icon = up ? ArrowUpRight : ArrowDownRight
  return (
    <span className="ads-kpi-delta" data-direction={up ? 'up' : 'down'}>
      <Icon className="size-3" aria-hidden="true" />
      {Math.abs(value).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%
    </span>
  )
}

export function KpiRow({ currency, active, adAccountId, fromDate, toDate, timeZone }: {
  currency: string
  active: boolean
  adAccountId: string
  fromDate: string
  toDate: string
  timeZone?: string
}) {
  const { data: kpis, error: kpisError, isLoading, mutate: refreshKpis } = useAdsKpis(active, adAccountId, { fromDate, toDate })
  const { data: salesData, error: salesError, mutate: refreshSales } = useAdsRoas(active, adAccountId, { fromDate, toDate })
  const cur = kpis?.scope === 'advertiser_all_campaigns' ? kpis.current : undefined
  const money = kpis?.currency || currency
  const revenueMoney = salesData?.revenueCurrency || salesData?.currency || currency
  const dateLabel = (date: string) => date.split('-').reverse().join('/')
  const period = fromDate === toDate ? dateLabel(fromDate) : `${dateLabel(fromDate)} – ${dateLabel(toDate)}`
  const unavailable = !!kpisError || !!salesError
  const revenue = salesData ? salesData.revenueCents / 100 : null
  const roas = salesData?.currencyMismatch ? null : salesData?.roas ?? null
  const syncAt = kpis?.lastSyncedAt || salesData?.lastSyncedAt || null
  const spendSeries = salesData?.daily?.map(day => day.spend) ?? []
  const revenueSeries = salesData?.daily?.map(day => day.revenueCents / 100) ?? []

  const cards = [
    {
      icon: Wallet,
      label: 'Gasto em ADS',
      value: cur?.spend ?? null,
      money,
      detail: 'Investimento da conta',
      theme: 'amber' as const,
      series: spendSeries,
      delta: kpis?.deltas?.spend,
    },
    {
      icon: ReceiptText,
      label: 'Receita atribuída',
      value: revenue,
      money: revenueMoney,
      detail: salesData ? `${salesData.sales} ${salesData.sales === 1 ? 'venda atribuída' : 'vendas atribuídas'}` : 'Vendas atribuídas aos anúncios',
      theme: 'green' as const,
      series: revenueSeries,
      delta: null,
    },
    {
      icon: ChartNoAxesCombined,
      label: 'ROAS',
      value: roas,
      money: '',
      detail: salesData?.currencyMismatch ? 'Moedas diferentes — cálculo bloqueado' : 'Receita ÷ investimento',
      theme: 'cyan' as const,
      series: [],
      delta: null,
    },
    {
      icon: Target,
      label: 'CPA',
      value: salesData?.currencyMismatch ? null : salesData?.cpa ?? null,
      money,
      detail: 'Investimento ÷ vendas',
      theme: 'violet' as const,
      series: [],
      delta: null,
    },
  ]

  const avgCpc = cur && cur.clicks > 0 ? cur.spend / cur.clicks : null
  const avgTicket = revenue !== null && salesData && salesData.sales > 0 ? revenue / salesData.sales : null

  return (
    <section className="ads-performance-deck" aria-label="Performance da conta de anúncios">
      <header className="ads-performance-head">
        <div className="min-w-0">
          <p className="ads-performance-eyebrow">Performance da conta</p>
          <p className="ads-performance-period" title={timeZone ? `Fuso da conta: ${timeZone}` : undefined}>
            {period}
            {syncAt ? <span>· sincronizado {timeAgo(syncAt)}</span> : null}
          </p>
        </div>
        {unavailable && (
          <button
            type="button"
            className="ads-performance-retry"
            onClick={() => void Promise.all([refreshKpis(), refreshSales()])}
          >
            <RefreshCw className="size-3.5" aria-hidden="true" />
            Dados não atualizados
          </button>
        )}
      </header>

      {isLoading && !kpis ? (
        <div className="ads-performance-grid">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[118px] rounded-2xl" />)}
        </div>
      ) : (
        <div className="ads-performance-grid">
          {cards.map((card) => (
            <article key={card.label} className="ads-kpi-cell" data-tone={card.theme}>
              <div className="ads-kpi-topline">
                <span className="ads-kpi-label"><card.icon className="size-3.5" aria-hidden="true" />{card.label}</span>
                <Delta value={card.delta} />
              </div>
              <div className="ads-kpi-value-row">
                <p className="ads-kpi-value" data-sensitive>
                  {card.value === null || !Number.isFinite(card.value) ? '—' : (
                    <CountUp
                      value={card.value}
                      format={value => card.money
                        ? fmtSpend(value, card.money)
                        : `${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}×`}
                    />
                  )}
                </p>
                <MiniSparkline values={card.series} tone={card.theme === 'violet' ? 'violet' : card.theme} />
              </div>
              <p className="ads-kpi-detail">{card.detail}</p>
            </article>
          ))}
        </div>
      )}

      {cur && (
        <details className="ads-more-metrics">
          <summary>
            <span><Sparkles className="size-3.5" aria-hidden="true" />Mais métricas</span>
            <span className="ads-more-metrics-hint">cliques · exibições · CTR · CPM · CPC · ticket</span>
          </summary>
          <div className="ads-more-metrics-grid">
            <div><span><MousePointerClick className="size-3" />Cliques</span><strong>{fmtCompact(cur.clicks)}</strong></div>
            <div><span><Eye className="size-3" />Exibições</span><strong>{fmtCompact(cur.impressions)}</strong></div>
            <div><span><Percent className="size-3" />CTR médio</span><strong>{fmtPercent(cur.ctr)}</strong></div>
            <div><span><Coins className="size-3" />CPM</span><strong>{fmtSpend(cur.cpm, money)}</strong></div>
            <div><span>CPC médio</span><strong>{avgCpc !== null ? fmtSpend(avgCpc, money) : '—'}</strong></div>
            <div><span>Ticket médio</span><strong>{avgTicket !== null ? fmtSpend(avgTicket, revenueMoney) : '—'}</strong></div>
          </div>
        </details>
      )}
    </section>
  )
}
