'use client'

import type { AdsTreeCampaign } from '@/lib/types'
import { campaignBudget, campaignMetrics } from '@/lib/campaign-metrics'
import { CountUp } from '@/components/count-up'

export function CampaignMetricGrid({
  campaign,
  currency,
  attribution,
}: {
  campaign: AdsTreeCampaign
  currency: string
  attribution?: { revenueCents: number; sales: number; currency?: string | null }
}) {
  const metrics = campaignMetrics(campaign.metrics)
  const budget = campaignBudget(campaign)
  const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: campaign.currency || currency })
  const number = (value: number) => value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
  const spend = metrics.spend ?? 0
  const realSales = attribution?.sales ?? 0
  const realRevenue = (attribution?.revenueCents ?? 0) / 100
  const realRoas = attribution?.currency === (campaign.currency || currency) && realSales > 0 && spend > 0 ? realRevenue / spend : null
  const realCpa = realSales > 0 && spend > 0 ? spend / realSales : null

  const items = [
    { label: 'Orçamento', value: budget.amount, format: money, detail: budget.detail, highlight: false, real: false },
    { label: 'Gasto', value: metrics.spend, format: money, detail: 'No período selecionado', highlight: true, real: false },
    ...(realSales > 0
      ? [
          { label: 'Vendas Reais', value: realSales, format: number, detail: 'Atribuídas pelo ROI-NADOS', highlight: true, real: true },
          { label: 'Receita Real', value: attribution?.currency ? realRevenue : null, format: (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: attribution!.currency! }), detail: attribution?.currency ? 'Faturamento rastreado' : 'Sem moeda única confirmada', highlight: true, real: true },
          { label: 'ROAS Real', value: realRoas, format: (v: number) => `${v.toFixed(2)}×`, detail: 'Receita ÷ Gasto', highlight: true, real: true },
          { label: 'CPA Real', value: realCpa, format: money, detail: 'Gasto ÷ Vendas reais', highlight: false, real: true },
        ]
      : [
          { label: 'Compras', value: metrics.conversions, format: number, detail: 'Informadas pelo TikTok', highlight: false, real: false },
          { label: 'CPA', value: metrics.cpa, format: money, detail: 'Custo por compra', highlight: false, real: false },
        ]),
    { label: 'CPM', value: metrics.cpm, format: money, detail: 'Custo por mil exibições', highlight: false, real: false },
    { label: 'CPC', value: metrics.cpc, format: money, detail: 'Custo por clique', highlight: false, real: false },
    { label: 'Cliques', value: metrics.clicks, format: number, detail: 'No anúncio', highlight: false, real: false },
    { label: 'CTR', value: metrics.ctr, format: (value: number) => `${number(value)}%`, detail: 'Taxa de cliques', highlight: false, real: false },
    { label: 'Exibições', value: metrics.impressions, format: number, detail: 'Vezes que apareceu', highlight: false, real: false },
  ]
  return (
    <dl className="campaign-metric-grid stagger-fade">
      {items.map((item, idx) => (
        <div
          key={item.label}
          className="campaign-metric-cell stagger-fade"
          style={{ '--i': idx, '--stagger-index': idx } as React.CSSProperties}
          data-primary={item.highlight}
          data-real={item.real ? 'true' : undefined}
        >
          <dt title={item.detail}>{item.label}</dt>
          <dd data-sensitive>
            {item.value !== null && item.value !== undefined ? (
              <CountUp value={item.value} format={item.format} />
            ) : (
              '—'
            )}
          </dd>
          <span>{item.detail}</span>
        </div>
      ))}
    </dl>
  )
}
