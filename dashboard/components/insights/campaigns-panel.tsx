'use client'

import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import type { AdsCampaignDecisionsResponse, AdsTreeResponse } from '@/lib/types'
import { fmtSpend, formatMoney } from '@/lib/format'
import { GlassCard } from '@/components/glass-card'
import { Skeleton } from '@/components/skeleton'

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
  currency,
  loading,
}: {
  connected: boolean
  tree?: AdsTreeResponse
  decisions?: AdsCampaignDecisionsResponse
  currency: string
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
          <table className="w-full min-w-[760px] border-collapse text-left">
            <thead>
              <tr className="border-b border-border/60 text-[11px] font-medium text-muted-foreground">
                <th className="px-5 py-3">Campanha</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Gasto</th>
                <th className="px-4 py-3 text-right">Receita</th>
                <th className="px-4 py-3 text-right">Compras</th>
                <th className="px-4 py-3 text-right">CPA</th>
                <th className="px-5 py-3 text-right">ROAS</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 20).map(row => (
                <tr key={row.id || row.name} className="border-b border-border/40 last:border-0 hover:bg-secondary/10">
                  <td className="max-w-[320px] px-5 py-3.5">
                    <span className="block truncate text-[13px] font-medium text-foreground" title={row.name}>{row.name}</span>
                  </td>
                  <td className={`px-4 py-3.5 text-xs font-medium ${statusClass(row.status)}`}>{statusLabel(row.status)}</td>
                  <td className="px-4 py-3.5 text-right text-xs tabular-nums text-foreground">{row.spend == null ? '—' : fmtSpend(row.spend, row.spendCurrency)}</td>
                  <td className="px-4 py-3.5 text-right text-xs tabular-nums text-foreground" data-private="true">{row.revenueCents == null ? '—' : formatMoney(row.revenueCents, row.decisionCurrency)}</td>
                  <td className="px-4 py-3.5 text-right text-xs tabular-nums text-foreground">{row.sales == null ? '—' : row.sales.toLocaleString('pt-BR')}</td>
                  <td className="px-4 py-3.5 text-right text-xs tabular-nums text-foreground">{row.cpa == null ? '—' : fmtSpend(row.cpa, row.spendCurrency)}</td>
                  <td className="px-5 py-3.5 text-right text-xs font-semibold tabular-nums text-brand-cyan">{row.roas == null ? '—' : `${row.roas.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x`}</td>
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
