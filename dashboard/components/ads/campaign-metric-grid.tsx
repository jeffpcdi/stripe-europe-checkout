'use client'

import type { AdsTreeCampaign } from '@/lib/types'
import { campaignBudget, campaignMetrics } from '@/lib/campaign-metrics'
import { CountUp } from '@/components/count-up'

export function CampaignMetricGrid({ campaign, currency }: { campaign: AdsTreeCampaign; currency: string }) {
  const metrics = campaignMetrics(campaign.metrics)
  const budget = campaignBudget(campaign)
  const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: campaign.currency || currency })
  const number = (value: number) => value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
  const items = [
    { label: 'Orçamento', value: budget.amount, format: money, detail: budget.detail },
    { label: 'Gasto', value: metrics.spend, format: money, detail: 'No período selecionado' },
    { label: 'Compras', value: metrics.conversions, format: number, detail: 'Informadas pelo TikTok' },
    { label: 'CPA', value: metrics.cpa, format: money, detail: 'Custo por compra' },
    { label: 'CPM', value: metrics.cpm, format: money, detail: 'Custo por mil exibições' },
    { label: 'CPC', value: metrics.cpc, format: money, detail: 'Custo por clique' },
    { label: 'Cliques', value: metrics.clicks, format: number, detail: 'No anúncio' },
    { label: 'CTR', value: metrics.ctr, format: (value: number) => `${number(value)}%`, detail: 'Taxa de cliques' },
    { label: 'Exibições', value: metrics.impressions, format: number, detail: 'Vezes que apareceu' },
  ]
  return <dl className="campaign-metric-grid">{items.map(item => <div key={item.label} className="campaign-metric-cell" data-primary={item.label === 'Gasto' || item.label === 'Orçamento'}>
    <dt title={item.detail}>{item.label}</dt><dd data-sensitive>{item.value !== null ? <CountUp value={item.value} format={item.format} /> : '—'}</dd><span>{item.detail}</span>
  </div>)}</dl>
}
