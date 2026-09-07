import type { AdsMetrics, AdsTreeCampaign } from './types'

const valid = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0

// Custos usam exclusivamente o relatório TikTok da mesma campanha e janela.
export function campaignMetrics(metrics?: AdsMetrics) {
  const spend = valid(metrics?.spend) ? metrics.spend : null
  const clicks = valid(metrics?.clicks) ? metrics.clicks : null
  const impressions = valid(metrics?.impressions) ? metrics.impressions : null
  const conversions = valid(metrics?.conversions) ? metrics.conversions : null
  const ratio = (base: number | null, multiplier = 1) => spend !== null && base !== null && base > 0 ? spend / base * multiplier : null
  return { spend, clicks, impressions, conversions, cpa: ratio(conversions), cpc: ratio(clicks), cpm: ratio(impressions, 1000), ctr: clicks !== null && impressions !== null && impressions > 0 ? clicks / impressions * 100 : null }
}

// CBO pertence à campanha. ABO só soma conjuntos quando o escopo está completo e a duração é igual.
export function campaignBudget(campaign: AdsTreeCampaign): { amount: number | null; detail: string } {
  if (campaign.budgetOwner === 'campaign') {
    const budget = campaign.budget
    return { amount: valid(budget?.amount) ? budget.amount : null, detail: budget?.type === 'lifetime' ? 'Total · campanha' : 'Por dia · campanha' }
  }
  if (campaign.budgetOwner !== 'adgroup') return { amount: null, detail: 'Orçamento não informado' }
  const groups = campaign.adSets || []
  if (!groups.length || (campaign.adSetCount != null && campaign.adSetCount !== groups.length) || groups.some(group => !valid(group.budget?.amount))) return { amount: null, detail: 'Definido nos conjuntos' }
  const types = new Set(groups.map(group => group.budget?.type))
  if (types.size !== 1 || !['daily', 'lifetime'].includes(groups[0].budget?.type || '')) return { amount: null, detail: 'Períodos diferentes · conjuntos' }
  return { amount: groups.reduce((sum, group) => sum + group.budget!.amount!, 0), detail: groups[0].budget?.type === 'lifetime' ? 'Total · soma dos conjuntos' : 'Por dia · soma dos conjuntos' }
}

export interface CampaignStatusResult { dryRun?: boolean; ok?: boolean; totals?: { updated: number; skipped: number; failed: number } }
export function campaignStatusOutcome(result: CampaignStatusResult, requested: number) {
  if (result.dryRun) return 'simulated'
  if (result.ok === false || !result.totals || result.totals.updated === 0) return 'failed'
  if (result.totals.failed > 0 || result.totals.skipped > 0 || result.totals.updated !== requested) return 'partial'
  return 'accepted'
}
