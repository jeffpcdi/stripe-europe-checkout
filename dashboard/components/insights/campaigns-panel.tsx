'use client'

import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import type { AdsCampaignDecisionsResponse, AdsTreeCampaign, AdsTreeResponse } from '@/lib/types'
import { formatMoney } from '@/lib/format'
import { GlassCard } from '@/components/glass-card'
import { Skeleton } from '@/components/skeleton'


function dailyBudget(campaign: AdsTreeCampaign): number | null {
  if (campaign.budgetOwner === 'campaign') {
    return campaign.budget?.type === 'daily' && Number(campaign.budget.amount) > 0 ? Number(campaign.budget.amount) : null
  }
  const budgets = (campaign.adSets ?? [])
    .map(adSet => adSet.budget)
    .filter(budget => budget?.type === 'daily' && Number(budget.amount) > 0)
    .map(budget => Number(budget?.amount) || 0)
  if (!budgets.length) return null
  return budgets.reduce((sum, value) => sum + value, 0)
}

function dayProgress(timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date())
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
    const minutes = Number(values.hour || 0) * 60 + Number(values.minute || 0)
    return Math.max(0.05, Math.min(1, minutes / 1440))
  } catch {
    return 0.5
  }
}

function pacingView(spend: number | null, budget: number | null, timeZone: string) {
  if (spend == null || budget == null || budget <= 0) return null
  const consumed = (spend / budget) * 100
  const expected = dayProgress(timeZone) * 100
  const gap = consumed - expected
  if (gap >= 20) return { label: 'Acima do ritmo', tone: 'text-warning', consumed }
  if (gap <= -20) return { label: 'Abaixo do ritmo', tone: 'text-muted-foreground', consumed }
  return { label: 'No ritmo', tone: 'text-success', consumed }
}

function statusLabel(status?: string) {
  const value = String(status || '').toLowerCase()
  if (value === 'active' || value === 'enable') return 'Ativa'
  if (value === 'paused' || value === 'disable') return 'Pausada'
  if (value === 'pending_review') return 'Em revisão'
  if (value === 'rejected') return 'Reprovada'
  if (value === 'completed') return 'Concluída'
  return status || '—'
}

function statusClass(status?: string) {
  const value = String(status || '').toLowerCase()
  if (value === 'active' || value === 'enable') return 'text-success'
  if (value === 'rejected' || value === 'error') return 'text-destructive'
  if (value === 'pending_review') return 'text-warning'
  return 'text-muted-foreground'
}

export function InsightsCampaignsPanel({
  connected,
  tree,
  decisions,
  pacingTree,
  currency,
  timeZone,
  loading,
}: {
  connected: boolean
  tree?: AdsTreeResponse
  decisions?: AdsCampaignDecisionsResponse
  pacingTree?: AdsTreeResponse
  currency: string
  timeZone: string
  loading: boolean
}) {
  if (!connected) {
    return (
      <GlassCard className="flex min-h-56 flex-col items-center justify-center p-8 text-center">
        <p className="text-sm font-semibold text-foreground">TikTok Ads não conectado</p>
        <p className="mt-1 max-w-sm text-xs text-muted-foreground">Conecte a conta para cruzar gasto, receita, CPA e ROAS por campanha.</p>
        <Link href="/ads/tiktok" className="btn-ghost mt-4 text-xs">Abrir TikTok Ads <ArrowUpRight className="size-3.5" /></Link>
      </GlassCard>
    )
  }

  if (loading && !tree) {
    return <Skeleton className="h-80 rounded-2xl" />
  }

  const todayByCampaign = new Map((pacingTree?.campaigns ?? []).map(campaign => [String(campaign.platformCampaignId || ''), campaign]))

  const rows = (tree?.campaigns ?? []).map(campaign => {
    const id = String(campaign.platformCampaignId || '')
    const spend = typeof campaign.metrics?.spend === 'number' ? campaign.metrics.spend : null
    const decision = decisions?.byCampaign?.[id]
    const sales = decision ? Number(decision.sales) || 0 : null
    const revenueCents = decision ? Number(decision.revenueCents) || 0 : null
    const decisionCurrency = String(decision?.currency || campaign.currency || currency || 'BRL').toUpperCase()
    const spendCurrency = String(campaign.currency || currency || decisionCurrency).toUpperCase()
    const comparable = decisionCurrency === spendCurrency
    const cpa = sales != null && sales > 0 && spend != null ? spend / sales : null
    const roas = revenueCents != null && spend != null && spend > 0 && comparable ? (revenueCents / 100) / spend : null
    const todayCampaign = todayByCampaign.get(id)
    const todaySpend = typeof todayCampaign?.metrics?.spend === 'number' ? todayCampaign.metrics.spend : null
    const budget = dailyBudget(campaign)
    const pacing = pacingView(todaySpend, budget, timeZone)

    return {
      id,
      name: campaign.campaignName || id,
      status: campaign.childStatus || campaign.status,
      spend,
      spendCurrency,
      sales,
      revenueCents,
      decisionCurrency,
      cpa,
      roas,
      pacing,
    }
  }).sort((a, b) => (b.revenueCents ?? -1) - (a.revenueCents ?? -1) || (b.spend ?? -1) - (a.spend ?? -1))

  return (
    <GlassCard className="overflow-hidden">
      <div className="flex items-center justify-between gap-4 px-5 py-4">
        <h2 className="text-[15px] font-semibold text-foreground">Campanhas</h2>
        <Link href="/ads/tiktok" className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
          TikTok Ads <ArrowUpRight className="size-3.5" />
        </Link>
      </div>

      {rows.length ? (
        <div className="overflow-x-auto border-t border-border/60">
          <table className="w-full min-w-[920px] border-collapse text-left">
            <thead>
              <tr className="border-b border-border/60 text-[11px] font-medium text-muted-foreground">
                <th className="px-5 py-3">Campanha</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Gasto</th>
                <th className="px-4 py-3 text-right">Receita</th>
                <th className="px-4 py-3 text-right">Compras</th>
                <th className="px-4 py-3 text-right">CPA</th>
                <th className="px-4 py-3 text-right">ROAS</th>
                <th className="px-5 py-3">Ritmo hoje</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 20).map(row => (
                <tr key={row.id || row.name} className="border-b border-border/40 last:border-0 hover:bg-secondary/10">
                  <td className="max-w-[320px] px-5 py-3.5">
                    <span className="block truncate text-[13px] font-medium text-foreground" title={row.name}>{row.name}</span>
                  </td>
                  <td className={`px-4 py-3.5 text-xs font-medium ${statusClass(row.status)}`}>{statusLabel(row.status)}</td>
                  <td className="px-4 py-3.5 text-right text-xs tabular-nums text-foreground">{row.spend == null ? '—' : formatMoney(Math.round(row.spend * 100), row.spendCurrency)}</td>
                  <td className="px-4 py-3.5 text-right text-xs tabular-nums text-foreground" data-private="true">{row.revenueCents == null ? '—' : formatMoney(row.revenueCents, row.decisionCurrency)}</td>
                  <td className="px-4 py-3.5 text-right text-xs tabular-nums text-foreground">{row.sales == null ? '—' : row.sales.toLocaleString('pt-BR')}</td>
                  <td className="px-4 py-3.5 text-right text-xs tabular-nums text-foreground">{row.cpa == null ? '—' : formatMoney(Math.round(row.cpa * 100), row.spendCurrency)}</td>
                  <td className="px-4 py-3.5 text-right text-xs font-semibold tabular-nums text-brand-cyan">{row.roas == null ? '—' : `${row.roas.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x`}</td>
                  <td className="px-5 py-3.5">
                    {row.pacing ? (
                      <span>
                        <span className={`block text-xs font-semibold ${row.pacing.tone}`}>{row.pacing.label}</span>
                        <span className="mt-0.5 block text-[11px] tabular-nums text-muted-foreground">{row.pacing.consumed.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}% do orçamento diário</span>
                      </span>
                    ) : <span className="text-xs text-muted-foreground">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="border-t border-border/60 px-5 py-12 text-center text-sm text-muted-foreground">
          Nenhuma campanha encontrada no período.
        </div>
      )}
    </GlassCard>
  )
}
