'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowUpRight, Clapperboard } from 'lucide-react'
import type { AdsMetrics, AdsTreeResponse } from '@/lib/types'
import { formatMoney } from '@/lib/format'
import { GlassCard } from '@/components/glass-card'
import { Skeleton } from '@/components/skeleton'

type CreativeSignal = 'attention' | 'efficient' | 'new' | 'stable' | 'low_volume'
type CreativeFilter = 'all' | 'attention' | 'efficient'

interface CreativeRow {
  id: string
  name: string
  campaign: string
  body: string
  currency: string
  metrics: AdsMetrics
  previous?: AdsMetrics
  signal: CreativeSignal
  signalText: string
  signalDetail: string
}

function number(value: number | undefined | null): number {
  return Number.isFinite(value) ? Number(value) : 0
}

function change(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return null
  return ((current - previous) / previous) * 100
}

function classify(current: AdsMetrics, previous?: AdsMetrics): Pick<CreativeRow, 'signal' | 'signalText' | 'signalDetail'> {
  const impressions = number(current.impressions)
  const clicks = number(current.clicks)
  const conversions = number(current.conversions)
  const enoughVolume = impressions >= 1000 || clicks >= 20 || conversions >= 3

  if (!enoughVolume) {
    return { signal: 'low_volume', signalText: 'Pouco volume', signalDetail: 'Ainda sem base suficiente para comparar.' }
  }

  if (!previous) {
    return { signal: 'new', signalText: 'Novo', signalDetail: 'Sem período anterior comparável.' }
  }

  const previousImpressions = number(previous.impressions)
  const previousClicks = number(previous.clicks)
  const previousConversions = number(previous.conversions)
  const previousEnough = previousImpressions >= 1000 || previousClicks >= 20 || previousConversions >= 3

  if (!previousEnough) {
    return { signal: 'new', signalText: 'Base nova', signalDetail: 'O período anterior tinha pouco volume.' }
  }

  const ctrNow = number(current.ctr)
  const ctrBefore = number(previous.ctr)
  const cpcNow = number(current.cpc)
  const cpcBefore = number(previous.cpc)
  const cpmNow = number(current.cpm)
  const cpmBefore = number(previous.cpm)
  const cpaNow = number(current.cpa)
  const cpaBefore = number(previous.cpa)

  const ctrChange = change(ctrNow, ctrBefore)
  const cpcChange = change(cpcNow, cpcBefore)
  const cpmChange = change(cpmNow, cpmBefore)
  const cpaChange = change(cpaNow, cpaBefore)

  const ctrFalling = ctrChange != null && ctrChange <= -20
  const costRising = (cpcChange != null && cpcChange >= 15) || (cpmChange != null && cpmChange >= 15) || (cpaChange != null && cpaChange >= 20)

  if (ctrFalling && costRising) {
    const pieces = [
      ctrChange == null ? null : `CTR ${ctrChange.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%`,
      cpcChange != null && cpcChange >= 15 ? `CPC +${cpcChange.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%` : null,
      cpaChange != null && cpaChange >= 20 ? `CPA +${cpaChange.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%` : null,
    ].filter(Boolean)

    return {
      signal: 'attention',
      signalText: 'Possível desgaste',
      signalDetail: pieces.join(' · ') || 'Eficiência piorou contra o período anterior.',
    }
  }

  const ctrImproving = ctrChange != null && ctrChange >= 20
  const cpaImproving = cpaChange != null && cpaChange <= -15
  const cpcImproving = cpcChange != null && cpcChange <= -15

  if ((ctrImproving && (cpaImproving || cpcImproving)) || (conversions >= 3 && cpaImproving)) {
    const pieces = [
      ctrChange != null && ctrChange >= 20 ? `CTR +${ctrChange.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%` : null,
      cpaChange != null && cpaChange <= -15 ? `CPA ${cpaChange.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%` : null,
      cpcChange != null && cpcChange <= -15 ? `CPC ${cpcChange.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%` : null,
    ].filter(Boolean)

    return {
      signal: 'efficient',
      signalText: 'Ganhando eficiência',
      signalDetail: pieces.join(' · ') || 'Eficiência melhorou contra o período anterior.',
    }
  }

  if (ctrFalling || costRising) {
    return {
      signal: 'attention',
      signalText: 'Monitorar',
      signalDetail: ctrFalling
        ? `CTR ${ctrChange?.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}% vs. anterior`
        : 'Custos subiram contra o período anterior.',
    }
  }

  return { signal: 'stable', signalText: 'Estável', signalDetail: 'Sem mudança relevante nos sinais principais.' }
}

function flatten(tree?: AdsTreeResponse): Omit<CreativeRow, 'previous' | 'signal' | 'signalText' | 'signalDetail'>[] {
  const rows: Omit<CreativeRow, 'previous' | 'signal' | 'signalText' | 'signalDetail'>[] = []

  for (const campaign of tree?.campaigns ?? []) {
    for (const adSet of campaign.adSets ?? []) {
      for (const ad of adSet.ads ?? []) {
        const id = String(ad.platformAdId || ad._id || '')
        if (!id) continue
        rows.push({
          id,
          name: ad.name || id,
          campaign: campaign.campaignName || campaign.platformCampaignId,
          body: ad.creative?.body || '',
          currency: String(campaign.currency || 'BRL').toUpperCase(),
          metrics: ad.metrics || {},
        })
      }
    }
  }

  return rows
}

function signalClass(signal: CreativeSignal): string {
  if (signal === 'attention') return 'text-warning'
  if (signal === 'efficient') return 'text-success'
  if (signal === 'new') return 'text-brand-cyan'
  return 'text-muted-foreground'
}

export function CreativeInsightsPanel({
  connected,
  current,
  previous,
  loading,
}: {
  connected: boolean
  current?: AdsTreeResponse
  previous?: AdsTreeResponse
  loading: boolean
}) {
  const [filter, setFilter] = useState<CreativeFilter>('all')

  const rows = useMemo(() => {
    const previousById = new Map(flatten(previous).map(item => [item.id, item.metrics]))
    return flatten(current)
      .map(item => {
        const signal = classify(item.metrics, previousById.get(item.id))
        return { ...item, previous: previousById.get(item.id), ...signal }
      })
      .sort((a, b) => {
        const rank = (signal: CreativeSignal) => signal === 'attention' ? 0 : signal === 'efficient' ? 1 : signal === 'new' ? 2 : signal === 'stable' ? 3 : 4
        return rank(a.signal) - rank(b.signal) || number(b.metrics.spend) - number(a.metrics.spend)
      })
  }, [current, previous])

  if (!connected) {
    return (
      <GlassCard className="flex min-h-56 flex-col items-center justify-center p-8 text-center">
        <p className="text-sm font-semibold text-foreground">TikTok Ads não conectado</p>
        <p className="mt-1 max-w-sm text-xs text-muted-foreground">Conecte a conta para comparar a performance dos criativos.</p>
        <Link href="/ads/tiktok" className="btn-ghost mt-4 text-xs">Abrir TikTok Ads <ArrowUpRight className="size-3.5" /></Link>
      </GlassCard>
    )
  }

  if (loading && !current) return <Skeleton className="h-80 rounded-2xl" />

  const visible = filter === 'all'
    ? rows
    : rows.filter(row => filter === 'attention' ? row.signal === 'attention' : row.signal === 'efficient')

  return (
    <GlassCard className="overflow-hidden">
      <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-[15px] font-semibold text-foreground">Criativos</h2>
          <p className="mt-1 text-xs text-muted-foreground">Comparação com o período anterior usando métricas do TikTok.</p>
        </div>
        <div className="flex items-center gap-1 rounded-xl border border-border/60 bg-secondary/10 p-1" role="tablist" aria-label="Filtro de criativos">
          {([
            ['all', 'Todos'],
            ['attention', 'Atenção'],
            ['efficient', 'Eficiência'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={filter === value}
              onClick={() => setFilter(value)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${filter === value ? 'bg-secondary/70 text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {visible.length ? (
        <div className="overflow-x-auto border-t border-border/60">
          <table className="w-full min-w-[880px] border-collapse text-left">
            <thead>
              <tr className="border-b border-border/60 text-[11px] font-medium text-muted-foreground">
                <th className="px-5 py-3">Criativo</th>
                <th className="px-4 py-3">Campanha</th>
                <th className="px-4 py-3 text-right">Gasto</th>
                <th className="px-4 py-3 text-right">CTR</th>
                <th className="px-4 py-3 text-right">CPC</th>
                <th className="px-4 py-3 text-right">CPA</th>
                <th className="px-5 py-3">Sinal</th>
              </tr>
            </thead>
            <tbody>
              {visible.slice(0, 40).map(row => {
                const spend = number(row.metrics.spend)
                const ctr = number(row.metrics.ctr)
                const cpc = number(row.metrics.cpc)
                const cpa = number(row.metrics.cpa)
                return (
                  <tr key={row.id} className="border-b border-border/40 last:border-0 hover:bg-secondary/10">
                    <td className="max-w-[300px] px-5 py-3.5">
                      <div className="flex items-start gap-2.5">
                        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary/20 text-muted-foreground">
                          <Clapperboard className="size-4" aria-hidden="true" />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] font-medium text-foreground" title={row.name}>{row.name}</span>
                          {row.body ? <span className="mt-0.5 block truncate text-[11px] text-muted-foreground" title={row.body}>{row.body}</span> : null}
                        </span>
                      </div>
                    </td>
                    <td className="max-w-[240px] px-4 py-3.5">
                      <span className="block truncate text-xs text-muted-foreground" title={row.campaign}>{row.campaign}</span>
                    </td>
                    <td className="px-4 py-3.5 text-right text-xs tabular-nums text-foreground">{spend > 0 ? formatMoney(Math.round(spend * 100), row.currency) : '—'}</td>
                    <td className="px-4 py-3.5 text-right text-xs tabular-nums text-foreground">{ctr > 0 ? `${ctr.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%` : '—'}</td>
                    <td className="px-4 py-3.5 text-right text-xs tabular-nums text-foreground">{cpc > 0 ? formatMoney(Math.round(cpc * 100), row.currency) : '—'}</td>
                    <td className="px-4 py-3.5 text-right text-xs tabular-nums text-foreground">{cpa > 0 ? formatMoney(Math.round(cpa * 100), row.currency) : '—'}</td>
                    <td className="max-w-[220px] px-5 py-3.5">
                      <p className={`text-xs font-semibold ${signalClass(row.signal)}`}>{row.signalText}</p>
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={row.signalDetail}>{row.signalDetail}</p>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="border-t border-border/60 px-5 py-12 text-center text-sm text-muted-foreground">
          Nenhum criativo neste filtro.
        </div>
      )}

      <div className="border-t border-border/60 px-5 py-3 text-[11px] leading-relaxed text-muted-foreground">
        “Possível desgaste” é um sinal heurístico: exige volume mínimo, queda relevante de CTR e aumento de custo. Use como prioridade de revisão, não como decisão automática.
      </div>
    </GlassCard>
  )
}
