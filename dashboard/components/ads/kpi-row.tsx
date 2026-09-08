'use client'

import { useAdsKpis, useAdsRoas } from '@/lib/api'
import { ChartNoAxesCombined, ReceiptText, Wallet, Target } from 'lucide-react'
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
  const cards = [
    { icon: Wallet, label: 'Gasto em ADS', value: cur?.spend ?? null, money, detail: 'Todas as campanhas da conta' },
    { icon: ReceiptText, label: 'Receita', value: revenue, money: revenueMoney, detail: salesData ? `${salesData.sales} ${salesData.sales === 1 ? 'venda atribuída' : 'vendas atribuídas'}` : 'Vendas atribuídas aos anúncios' },
    { icon: ChartNoAxesCombined, label: 'Retorno', value: salesData?.currencyMismatch ? null : salesData?.roas ?? null, money: '', detail: 'Receita ÷ investimento (ROAS)' },
    { icon: Target, label: 'Custo por venda', value: salesData?.currencyMismatch ? null : salesData?.cpa ?? null, money, detail: 'Investimento ÷ vendas' },
  ]
  return (
    <section className="ads-account-results space-y-3" aria-label="Resultados da conta de anúncios">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <p title={timeZone ? `Fuso da conta: ${timeZone}` : undefined}>Total da conta · {period}</p>
        {unavailable && <button type="button" className="text-warning underline underline-offset-4" onClick={() => void Promise.all([refreshKpis(), refreshSales()])}>Dados não atualizados · tentar novamente</button>}
      </div>
      {isLoading && !kpis ? <Skeleton className="h-28 rounded-2xl" /> : (
          <div className="overview-metrics">
            {cards.map((card, index) => <article key={card.label} aria-label={card.label} className="overview-metric" style={{ '--metric-index': index } as React.CSSProperties}>
              <div className="overview-metric-heading"><h2>{card.label}</h2><span className="overview-metric-icon"><card.icon className="size-5" aria-hidden="true" /></span></div>
              <div className="overview-metric-main"><p className="overview-metric-value" data-sensitive>
                {card.value === null || !Number.isFinite(card.value) ? '—' : <CountUp value={card.value} format={value => card.money ? fmtSpend(value, card.money) : `${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}×`} />}
              </p></div>
              <p className="overview-metric-footer">{card.detail}</p>
            </article>)}
          </div>
      )}
      {cur && <details className="group text-xs text-muted-foreground">
        <summary className="w-fit cursor-pointer rounded-md py-1 hover:text-foreground">Mais métricas</summary>
        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2 rounded-xl border border-border p-3">
          <span>Cliques <strong className="ml-1 text-foreground">{fmtCompact(cur.clicks)}</strong></span>
          <span>Exibições <strong className="ml-1 text-foreground">{fmtCompact(cur.impressions)}</strong></span>
          <span>Taxa de cliques <strong className="ml-1 text-foreground">{fmtPercent(cur.ctr)}</strong></span>
          <span>Custo por mil exibições <strong className="ml-1 text-foreground">{fmtSpend(cur.cpm, money)}</strong></span>
        </div>
      </details>}
    </section>
  )
}
