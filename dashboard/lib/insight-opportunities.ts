import type { OverviewPeriodMetrics } from './types'

export interface InsightOpportunity {
  id: string
  title: string
  detail: string
  metric?: string
  href?: string
  strength: number
}

export interface InsightOpportunityInput {
  current: OverviewPeriodMetrics
  previous: OverviewPeriodMetrics | null
  currentRevenue: number
  previousRevenue: number | null
  purchaseCoverageRate?: number | null
  attributionRate?: number | null
}

function pctDelta(current: number, previous: number | null | undefined): number | null {
  if (previous == null || !Number.isFinite(previous) || previous === 0) return null
  return ((current - previous) / Math.abs(previous)) * 100
}

function conversion(metrics: OverviewPeriodMetrics): number {
  return metrics.visits > 0 ? (metrics.purchased / metrics.visits) * 100 : 0
}

export function buildInsightOpportunities(input: InsightOpportunityInput): InsightOpportunity[] {
  const { current, previous } = input
  const opportunities: InsightOpportunity[] = []
  const revenueDelta = pctDelta(input.currentRevenue, input.previousRevenue)
  const currentConversion = conversion(current)
  const previousConversion = previous ? conversion(previous) : null
  const conversionDelta = previousConversion == null ? null : currentConversion - previousConversion

  if (revenueDelta != null && revenueDelta >= 15) {
    opportunities.push({
      id: 'revenue-growth',
      title: 'Faturamento em aceleração',
      detail: `O faturamento está ${revenueDelta.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% acima do período anterior comparável.`,
      metric: `+${revenueDelta.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`,
      href: '/insights',
      strength: revenueDelta,
    })
  }

  if (conversionDelta != null && conversionDelta >= 1) {
    opportunities.push({
      id: 'conversion-growth',
      title: 'Conversão ganhou eficiência',
      detail: `A taxa de visita até compra melhorou ${conversionDelta.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} p.p. frente ao período anterior.`,
      metric: `+${conversionDelta.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} p.p.`,
      href: '/insights?tab=funnel',
      strength: conversionDelta * 10,
    })
  }

  if (current.paymentStarted >= 5 && current.approval >= 85) {
    opportunities.push({
      id: 'approval-strong',
      title: 'Aprovação saudável',
      detail: `A aprovação está em ${current.approval.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% com volume suficiente para leitura operacional.`,
      metric: `${current.approval.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`,
      href: '/insights?tab=quality',
      strength: current.approval - 80,
    })
  }

  const previousCampaigns = new Map((previous?.topCampaigns ?? []).map(item => [item.name, item]))
  const campaignSignals = (current.topCampaigns ?? [])
    .filter(item => item.leads >= 10 && item.purchased >= 2)
    .map(item => {
      const before = previousCampaigns.get(item.name)
      const purchaseGrowth = before ? pctDelta(item.purchased, before.purchased) : null
      return { item, before, purchaseGrowth }
    })
    .sort((a, b) => {
      const growthA = a.purchaseGrowth ?? (a.before ? 0 : 100)
      const growthB = b.purchaseGrowth ?? (b.before ? 0 : 100)
      return growthB - growthA || b.item.purchased - a.item.purchased
    })

  const growingCampaign = campaignSignals.find(signal =>
    (!signal.before && signal.item.purchased >= 3) ||
    (signal.purchaseGrowth != null && signal.purchaseGrowth >= 40),
  )
  if (growingCampaign) {
    const { item, before, purchaseGrowth } = growingCampaign
    opportunities.push({
      id: `campaign-growth:${item.name}`,
      title: 'Campanha ganhando participação',
      detail: before
        ? `${item.name} aumentou as compras rastreadas frente ao período anterior e mantém ${item.conv.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% de conversão.`
        : `${item.name} apareceu com ${item.purchased.toLocaleString('pt-BR')} compras e ${item.conv.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% de conversão.`,
      metric: purchaseGrowth == null
        ? `${item.purchased.toLocaleString('pt-BR')} compras`
        : `+${purchaseGrowth.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% compras`,
      href: '/insights?tab=sources',
      strength: purchaseGrowth ?? item.purchased * 10,
    })
  }

  const portfolioConversion = current.topCampaigns?.length
    ? current.topCampaigns.reduce((sum, item) => sum + item.conv, 0) / current.topCampaigns.length
    : 0
  const efficientCampaign = [...(current.topCampaigns ?? [])]
    .filter(item => item.leads >= 15 && item.purchased >= 2 && item.conv >= Math.max(2, portfolioConversion * 1.4))
    .sort((a, b) => b.conv - a.conv)[0]

  if (efficientCampaign && efficientCampaign.name !== growingCampaign?.item.name) {
    opportunities.push({
      id: `campaign-efficiency:${efficientCampaign.name}`,
      title: 'Origem com eficiência acima da média',
      detail: `${efficientCampaign.name} converte ${efficientCampaign.conv.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% dos leads identificados.`,
      metric: `${efficientCampaign.conv.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% conversão`,
      href: '/insights?tab=sources',
      strength: efficientCampaign.conv * 5,
    })
  }

  if (
    input.purchaseCoverageRate != null &&
    input.attributionRate != null &&
    input.purchaseCoverageRate >= 95 &&
    input.attributionRate >= 90
  ) {
    opportunities.push({
      id: 'tracking-confidence',
      title: 'Base confiável para leitura',
      detail: 'Cobertura de compras e atribuição estão altas, reduzindo o risco de decisões baseadas em dados incompletos.',
      metric: `${input.purchaseCoverageRate.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}% cobertura`,
      href: '/insights?tab=quality',
      strength: 15,
    })
  }

  return opportunities.sort((a, b) => b.strength - a.strength).slice(0, 8)
}
