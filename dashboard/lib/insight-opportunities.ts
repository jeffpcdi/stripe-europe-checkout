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
      href: '/insights?tab=diagnosis',
      strength: current.approval - 80,
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
      href: '/insights?tab=diagnosis',
      strength: 15,
    })
  }

  return opportunities.sort((a, b) => b.strength - a.strength).slice(0, 8)
}
