import type { OverviewHealthResponse, OverviewPeriodMetrics } from './types'

export type InsightAnomalySeverity = 'critical' | 'warning' | 'info'

export interface InsightAnomaly {
  id: string
  severity: InsightAnomalySeverity
  title: string
  detail: string
  metric?: string
  href?: string
}

export interface InsightAnomalyInput {
  current: OverviewPeriodMetrics
  previous: OverviewPeriodMetrics | null
  health?: OverviewHealthResponse | null
  currentRevenue: number
  previousRevenue: number | null
  bottleneck?: {
    from: string
    to: string
    drop: number
    lost: number
  } | null
}

function pctDelta(current: number, previous: number | null | undefined): number | null {
  if (previous == null || !Number.isFinite(previous) || previous === 0) return null
  return ((current - previous) / Math.abs(previous)) * 100
}

function funnelConversion(metrics: OverviewPeriodMetrics): number {
  return metrics.visits > 0 ? (metrics.purchased / metrics.visits) * 100 : 0
}

function severityRank(severity: InsightAnomalySeverity): number {
  if (severity === 'critical') return 0
  if (severity === 'warning') return 1
  return 2
}

export function buildInsightAnomalies(input: InsightAnomalyInput): InsightAnomaly[] {
  const { current, previous, health, bottleneck } = input
  const anomalies: InsightAnomaly[] = []
  const currentConversion = funnelConversion(current)
  const previousConversion = previous ? funnelConversion(previous) : null
  const revenueDelta = pctDelta(input.currentRevenue, input.previousRevenue)
  const approvalDelta = previous ? current.approval - previous.approval : null
  const conversionDelta = previousConversion == null ? null : currentConversion - previousConversion

  if (current.visits >= 20 && current.purchased === 0) {
    anomalies.push({
      id: 'traffic-without-sales',
      severity: current.visits >= 100 ? 'critical' : 'warning',
      title: 'Tráfego sem compras',
      detail: `${current.visits.toLocaleString('pt-BR')} visitas chegaram no período, mas nenhuma compra rastreada foi confirmada.`,
      metric: `${current.visits.toLocaleString('pt-BR')} visitas · 0 compras`,
      href: '/insights?tab=funnel',
    })
  }

  if (revenueDelta != null && revenueDelta <= -20 && input.previousRevenue && input.previousRevenue > 0) {
    anomalies.push({
      id: 'revenue-drop',
      severity: revenueDelta <= -45 ? 'critical' : 'warning',
      title: 'Queda de faturamento',
      detail: `O faturamento caiu ${Math.abs(revenueDelta).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% contra o período anterior comparável.`,
      metric: `−${Math.abs(revenueDelta).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`,
      href: '/insights',
    })
  }

  if (conversionDelta != null && conversionDelta <= -1.5 && previousConversion != null && previousConversion > 0) {
    anomalies.push({
      id: 'conversion-drop',
      severity: conversionDelta <= -4 || currentConversion <= previousConversion * 0.5 ? 'critical' : 'warning',
      title: 'Conversão perdeu eficiência',
      detail: `A conversão caiu ${Math.abs(conversionDelta).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} p.p. em relação ao período anterior.`,
      metric: `${currentConversion.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% agora`,
      href: '/insights?tab=funnel',
    })
  }

  if (current.paymentStarted >= 5 && current.approval < 75) {
    anomalies.push({
      id: 'approval-low',
      severity: current.approval < 50 ? 'critical' : 'warning',
      title: 'Aprovação de pagamentos baixa',
      detail: `A taxa de aprovação está em ${current.approval.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% com ${current.paymentStarted.toLocaleString('pt-BR')} tentativas de pagamento.`,
      metric: approvalDelta == null
        ? `${current.approval.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
        : `${approvalDelta > 0 ? '+' : ''}${approvalDelta.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} p.p.`,
      href: '/activity?f=failed',
    })
  }

  const lossEvents = current.refunds + current.disputes
  if (lossEvents >= 2 && current.purchased > 0) {
    const lossRate = (lossEvents / Math.max(1, current.purchased)) * 100
    if (lossRate >= 5) {
      anomalies.push({
        id: 'post-sale-loss',
        severity: lossRate >= 15 ? 'critical' : 'warning',
        title: 'Pressão pós-venda',
        detail: `${lossEvents.toLocaleString('pt-BR')} reembolsos/contestações equivalem a ${lossRate.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% das compras rastreadas do período.`,
        metric: `${lossRate.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`,
        href: current.disputes > 0 ? '/activity?f=dispute' : '/activity?f=refund',
      })
    }
  }

  if (bottleneck && bottleneck.drop >= 65 && bottleneck.lost >= 10) {
    anomalies.push({
      id: 'funnel-bottleneck',
      severity: bottleneck.drop >= 85 ? 'critical' : 'warning',
      title: `Gargalo em ${bottleneck.from} → ${bottleneck.to}`,
      detail: `${bottleneck.lost.toLocaleString('pt-BR')} pessoas não avançaram nessa transição, uma perda de ${bottleneck.drop.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%.`,
      metric: `${bottleneck.drop.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% de perda`,
      href: '/insights?tab=funnel',
    })
  }

  const purchaseCoverage = health?.coverage.purchases
  if (purchaseCoverage && purchaseCoverage.total >= 3 && purchaseCoverage.rate != null && purchaseCoverage.rate < 90) {
    anomalies.push({
      id: 'purchase-coverage',
      severity: purchaseCoverage.rate < 70 ? 'critical' : 'warning',
      title: 'Compras fora da jornada rastreada',
      detail: `${purchaseCoverage.orphan.toLocaleString('pt-BR')} compra${purchaseCoverage.orphan === 1 ? '' : 's'} não ${purchaseCoverage.orphan === 1 ? 'foi ligada' : 'foram ligadas'} a uma jornada identificada.`,
      metric: `${purchaseCoverage.rate.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% coberto`,
      href: '/insights?tab=diagnosis',
    })
  }

  const attribution = health?.coverage.attribution
  if (attribution && attribution.total >= 20 && attribution.rate != null && attribution.rate < 80) {
    anomalies.push({
      id: 'attribution-low',
      severity: attribution.rate < 55 ? 'critical' : 'warning',
      title: 'Atribuição incompleta',
      detail: `${(attribution.total - attribution.identified).toLocaleString('pt-BR')} visitas não têm origem identificada no período observado pela saúde do rastreamento.`,
      metric: `${attribution.rate.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% identificado`,
      href: '/insights?tab=diagnosis',
    })
  }


  for (const action of health?.actions ?? []) {
    if (anomalies.some(item => item.id === `health-${action.id}`)) continue
    anomalies.push({
      id: `health-${action.id}`,
      severity: action.severity === 'critical' ? 'critical' : 'warning',
      title: action.title,
      detail: action.detail,
      href: action.href,
    })
  }

  const deduped = Array.from(new Map(anomalies.map(item => [item.id, item])).values())
  return deduped.sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
}
