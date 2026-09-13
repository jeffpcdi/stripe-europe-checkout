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
} from 'lucide-react'
import { CountUp } from '@/components/count-up'
import { Skeleton } from '@/components/skeleton'
import { fmtCompact, fmtPercent, fmtSpend } from '@/lib/format'

export interface KpiRowData {
  spend: number; impressions: number; clicks: number; ctr: number; cpm: number; activeCount: number; spendSeries: number[]
}

export function KpiRow({ currency, active, adAccountId, fromDate, toDate, timeZone }: {
  kpi: KpiRowData; currency: string; active: boolean; adAccountId: string; fromDate: string; toDate: string; timeZone?: string
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

  const cards = [
    { icon: Wallet, label: 'Gasto em ADS', value: cur?.spend ?? null, money, detail: 'Todas as campanhas da conta', theme: 'amber' },
    { icon: ReceiptText, label: 'Receita', value: revenue, money: revenueMoney, detail: salesData ? `${salesData.sales} ${salesData.sales === 1 ? 'venda atribuída' : 'vendas atribuídas'}` : 'Vendas atribuídas aos anúncios', theme: 'green' },
    { icon: ChartNoAxesCombined, label: 'Retorno', value: roas, money: '', detail: 'Receita ÷ investimento (ROAS)', theme: 'cyan' },
    { icon: Target, label: 'Custo por venda', value: salesData?.currencyMismatch ? null : salesData?.cpa ?? null, money, detail: 'Investimento ÷ vendas', theme: 'amber' },
  ]

  // Métricas derivadas
  const avgCpc = cur && cur.clicks > 0 ? cur.spend / cur.clicks : null
  const avgTicket = revenue !== null && salesData && salesData.sales > 0 ? revenue / salesData.sales : null

  return (
    <section className="ads-account-results space-y-3" aria-label="Resultados da conta de anúncios">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <p className="flex items-center gap-1.5" title={timeZone ? `Fuso da conta: ${timeZone}` : undefined}>
          <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
          <span>Total da conta · {period}</span>
        </p>
        {unavailable && (
          <button
            type="button"
            className="text-warning underline underline-offset-4 hover:text-foreground transition-colors"
            onClick={() => void Promise.all([refreshKpis(), refreshSales()])}
          >
            Dados não atualizados · tentar novamente
          </button>
        )}
      </div>

      {isLoading && !kpis ? (
        <div className="overview-metrics stagger-fade">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton
              key={i}
              className="h-28 rounded-2xl stagger-fade"
              style={{ '--i': i, '--stagger-index': i } as React.CSSProperties}
            />
          ))}
        </div>
      ) : (
        <div className="overview-metrics stagger-fade">
          {cards.map((card, index) => (
            <article
              key={card.label}
              aria-label={card.label}
              className="overview-metric surface-card stagger-fade"
              data-theme={card.theme}
              style={{
                '--i': index,
                '--stagger-index': index,
                '--metric-index': index,
              } as React.CSSProperties}
            >
              <div className="overview-metric-heading">
                <h2>{card.label}</h2>
                <span className="overview-metric-icon">
                  <card.icon className="size-5" aria-hidden="true" />
                </span>
              </div>
              <div className="overview-metric-main">
                <p className="overview-metric-value" data-sensitive>
                  {card.value === null || !Number.isFinite(card.value) ? (
                    '—'
                  ) : (
                    <CountUp
                      value={card.value}
                      format={value => card.money ? fmtSpend(value, card.money) : `${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}×`}
                    />
                  )}
                </p>

              </div>
              <p className="overview-metric-footer">{card.detail}</p>
            </article>
          ))}
        </div>
      )}

      {cur && (
        <details className="group text-xs text-muted-foreground">
          <summary className="w-fit cursor-pointer rounded-md py-1 hover:text-foreground select-none transition-colors font-medium">
            <span className="inline-flex items-center gap-1.5">
              <Sparkles className="size-3.5 text-primary" aria-hidden="true" />
              Mais métricas
            </span>
          </summary>
          <div className="mt-2.5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 rounded-xl border border-border/60 bg-card/60 p-3 shadow-sm stagger-fade">
            <div className="flex flex-col gap-0.5 p-1.5 stagger-fade" style={{ '--i': 0, '--stagger-index': 0 } as React.CSSProperties}>
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <MousePointerClick className="size-3" aria-hidden="true" />
                Cliques
              </span>
              <strong className="text-sm font-semibold text-foreground tabular-nums">
                {fmtCompact(cur.clicks)}
              </strong>
            </div>
            <div className="flex flex-col gap-0.5 p-1.5 stagger-fade" style={{ '--i': 1, '--stagger-index': 1 } as React.CSSProperties}>
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Eye className="size-3" aria-hidden="true" />
                Exibições
              </span>
              <strong className="text-sm font-semibold text-foreground tabular-nums">
                {fmtCompact(cur.impressions)}
              </strong>
            </div>
            <div className="flex flex-col gap-0.5 p-1.5 stagger-fade" style={{ '--i': 2, '--stagger-index': 2 } as React.CSSProperties}>
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Percent className="size-3" aria-hidden="true" />
                CTR Médio
              </span>
              <strong className="text-sm font-semibold text-foreground tabular-nums">
                {fmtPercent(cur.ctr)}
              </strong>
            </div>
            <div className="flex flex-col gap-0.5 p-1.5 stagger-fade" style={{ '--i': 3, '--stagger-index': 3 } as React.CSSProperties}>
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Coins className="size-3" aria-hidden="true" />
                CPM
              </span>
              <strong className="text-sm font-semibold text-foreground tabular-nums">
                {fmtSpend(cur.cpm, money)}
              </strong>
            </div>
            <div className="flex flex-col gap-0.5 p-1.5 stagger-fade" style={{ '--i': 4, '--stagger-index': 4 } as React.CSSProperties}>
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                CPC Médio
              </span>
              <strong className="text-sm font-semibold text-foreground tabular-nums">
                {avgCpc ? fmtSpend(avgCpc, money) : '—'}
              </strong>
            </div>
            <div className="flex flex-col gap-0.5 p-1.5 stagger-fade" style={{ '--i': 5, '--stagger-index': 5 } as React.CSSProperties}>
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                Ticket Médio
              </span>
              <strong className="text-sm font-semibold text-foreground tabular-nums">
                {avgTicket ? fmtSpend(avgTicket, revenueMoney) : '—'}
              </strong>
            </div>
          </div>
        </details>
      )}
    </section>
  )
}
