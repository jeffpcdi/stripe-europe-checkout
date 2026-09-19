'use client'

import { useMemo, useState } from 'react'
import {
  BarChart3,
  Bot,
  ChevronRight,
  Film,
  Layers3,
  Loader2,
  Megaphone,
  Pause,
  Play,
  Search,
  Sparkles,
  TriangleAlert,
} from 'lucide-react'
import { apiSend } from '@/lib/api'
import { toast } from '@/lib/toast'
import { usePersistedState } from '@/lib/use-persisted-state'
import type {
  AdsCampaignDecisionsResponse,
  AdsMetrics,
  AdsNodeStatus,
  AdsTreeAd,
  AdsTreeAdSet,
  AdsTreeCampaign,
  AdsTreeResponse,
} from '@/lib/types'
import { cn } from '@/lib/utils'
import { CampaignTree } from './campaign-tree'

type WorkspaceLevel = 'campaigns' | 'adgroups' | 'ads' | 'creatives' | 'insights'
type NodeFilter = 'all' | 'active' | 'paused' | 'attention'
type MetricPreset = 'performance' | 'delivery' | 'cost'

type Props = {
  tree?: AdsTreeResponse
  loading: boolean
  error: string | null
  currency: string
  statusFilter: string
  onStatusFilter: (value: string) => void
  sort: string
  onSort: (value: string) => void
  page: number
  onPage: (value: number) => void
  onMutate: () => void
  onRetry: () => void
  onOpenDetail?: (campaign: AdsTreeCampaign) => void
  onDuplicate?: (campaign: AdsTreeCampaign) => void
  decisions?: AdsCampaignDecisionsResponse
  onOpenAutomations?: () => void
}

type AdGroupRow = {
  campaign: AdsTreeCampaign
  group: AdsTreeAdSet
}

type AdRow = {
  campaign: AdsTreeCampaign
  group: AdsTreeAdSet
  ad: AdsTreeAd
}

const LEVELS: { value: WorkspaceLevel; label: string; icon: typeof Megaphone }[] = [
  { value: 'campaigns', label: 'Campanhas', icon: Megaphone },
  { value: 'adgroups', label: 'Conjuntos', icon: Layers3 },
  { value: 'ads', label: 'Anúncios', icon: Play },
  { value: 'creatives', label: 'Criativos', icon: Film },
  { value: 'insights', label: 'Insights', icon: Sparkles },
]

function money(value: number | undefined, currency: string) {
  const amount = Number(value) || 0
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount)
  } catch {
    return amount.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
  }
}

function compact(value: number | undefined) {
  return (Number(value) || 0).toLocaleString('pt-BR', { notation: 'compact', maximumFractionDigits: 1 })
}

function pct(value: number | undefined) {
  return `${(Number(value) || 0).toFixed(2).replace('.', ',')}%`
}

function metricCells(metrics: AdsMetrics | undefined, currency: string, preset: MetricPreset) {
  if (preset === 'delivery') {
    return [
      { label: 'Impressões', value: compact(metrics?.impressions) },
      { label: 'Cliques', value: compact(metrics?.clicks) },
      { label: 'Alcance', value: compact(metrics?.reach) },
    ]
  }
  if (preset === 'cost') {
    return [
      { label: 'CPM', value: money(metrics?.cpm, currency) },
      { label: 'CPC', value: money(metrics?.cpc, currency) },
      { label: 'Gasto', value: money(metrics?.spend, currency) },
    ]
  }
  return [
    { label: 'Gasto', value: money(metrics?.spend, currency) },
    { label: 'CTR', value: pct(metrics?.ctr) },
    { label: 'Conv.', value: compact(metrics?.conversions) },
  ]
}

function statusMeta(status?: AdsNodeStatus) {
  const value = String(status || '').toLowerCase()
  if (value === 'active') return { label: 'Ativo', cls: 'text-success' }
  if (value === 'paused') return { label: 'Pausado', cls: 'text-muted-foreground' }
  if (value === 'pending_review') return { label: 'Em análise', cls: 'text-warning' }
  if (value === 'rejected') return { label: 'Reprovado', cls: 'text-error' }
  if (value === 'error') return { label: 'Com problema', cls: 'text-error' }
  if (value === 'completed') return { label: 'Concluído', cls: 'text-muted-foreground' }
  return { label: status || '—', cls: 'text-muted-foreground' }
}

function EntityStatusToggle({
  id,
  status,
  advertiserId,
  label,
  onMutate,
}: {
  id?: string
  status?: AdsNodeStatus
  advertiserId?: string
  label: string
  onMutate: () => void
}) {
  const [busy, setBusy] = useState(false)
  const active = status === 'active'
  const paused = status === 'paused'
  const meta = statusMeta(status)

  if (!id || (!active && !paused)) {
    return <span className={cn('text-xs font-medium', meta.cls)}>{meta.label}</span>
  }

  async function toggle() {
    if (busy) return
    setBusy(true)
    try {
      const result = await apiSend<{ dryRun?: boolean; simulated?: boolean }>(
        `/api/ads/${encodeURIComponent(id)}`,
        'PUT',
        { status: active ? 'paused' : 'active', adAccountId: advertiserId },
      )
      if (result.dryRun || result.simulated) {
        toast.info('Simulação concluída', { hint: `${label} não foi alterado no TikTok.` })
      } else {
        toast.info(active ? 'Pausa solicitada' : 'Ativação solicitada', { hint: `${label} será atualizado após a sincronização.` })
      }
      onMutate()
    } catch (error) {
      toast.error('Não foi possível alterar o status', { hint: error instanceof Error ? error.message : undefined })
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={busy}
      className={cn(
        'inline-flex min-h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition-colors disabled:opacity-50',
        active
          ? 'border-success/25 bg-success/8 text-success hover:bg-success/15'
          : 'border-border/70 bg-secondary/30 text-muted-foreground hover:bg-secondary hover:text-foreground',
      )}
      aria-label={`${active ? 'Pausar' : 'Ativar'} ${label}`}
    >
      {busy ? <Loader2 className="size-3 animate-spin" /> : active ? <Pause className="size-3" /> : <Play className="size-3" />}
      {active ? 'Ativo' : 'Pausado'}
    </button>
  )
}

function CreativePreview({ ad, large = false }: { ad: AdsTreeAd; large?: boolean }) {
  const videoUrl = /^https:\/\//i.test(ad.creative?.videoUrl || '') ? ad.creative?.videoUrl : ''
  const imageUrl = /^https:\/\//i.test(ad.creative?.imageUrl || '') ? ad.creative?.imageUrl : ''

  if (!videoUrl && !imageUrl) {
    return (
      <div className={cn('flex shrink-0 items-center justify-center rounded-xl border border-border/55 bg-secondary/20 text-muted-foreground', large ? 'aspect-[9/16] w-full' : 'h-20 w-14')}>
        <Film className="size-4" />
      </div>
    )
  }

  return (
    <div className={cn('relative shrink-0 overflow-hidden rounded-xl border border-border/55 bg-black', large ? 'aspect-[9/16] w-full' : 'h-20 w-14')}>
      {videoUrl ? (
        <video
          src={videoUrl}
          poster={imageUrl || undefined}
          controls={large}
          muted
          playsInline
          preload="metadata"
          className="h-full w-full object-cover"
          aria-label={`Prévia do anúncio ${ad.name || ad.platformAdId || ''}`}
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
      )}
      {videoUrl && !large ? (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/10">
          <span className="flex size-6 items-center justify-center rounded-full bg-black/55 text-white"><Play className="size-3 fill-current" /></span>
        </span>
      ) : null}
    </div>
  )
}

export function CampaignWorkspace(props: Props) {
  const [level, setLevel] = usePersistedState<WorkspaceLevel>('ads:campaign-workspace-level', 'campaigns')
  const [nodeFilter, setNodeFilter] = usePersistedState<NodeFilter>('ads:campaign-workspace-status', 'all')
  const [metricPreset, setMetricPreset] = usePersistedState<MetricPreset>('ads:campaign-workspace-metrics', 'performance')
  const [query, setQuery] = useState('')
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set())
  const [selectedAds, setSelectedAds] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const campaigns = props.tree?.campaigns ?? []

  const groups = useMemo<AdGroupRow[]>(() =>
    campaigns.flatMap((campaign) => (campaign.adSets ?? []).map((group) => ({ campaign, group }))),
  [campaigns])

  const ads = useMemo<AdRow[]>(() =>
    groups.flatMap(({ campaign, group }) => (group.ads ?? []).map((ad) => ({ campaign, group, ad }))),
  [groups])

  const q = query.trim().toLowerCase()
  const matchesNodeStatus = (status?: AdsNodeStatus) => {
    if (nodeFilter === 'all') return true
    if (nodeFilter === 'active') return status === 'active'
    if (nodeFilter === 'paused') return status === 'paused'
    return ['rejected', 'error', 'pending_review'].includes(String(status || ''))
  }
  const visibleGroups = groups.filter(({ campaign, group }) =>
    matchesNodeStatus(group.status) && (!q || [
      campaign.campaignName,
      campaign.platformCampaignId,
      group.adSetName,
      group.name,
      group.platformAdSetId,
    ].some((value) => String(value || '').toLowerCase().includes(q))),
  )

  const visibleAds = ads.filter(({ campaign, group, ad }) =>
    matchesNodeStatus(ad.status) && (!q || [
      campaign.campaignName,
      campaign.platformCampaignId,
      group.adSetName,
      group.name,
      ad.name,
      ad.platformAdId,
      ad.creative?.body,
    ].some((value) => String(value || '').toLowerCase().includes(q))),
  )

  const activeGroups = groups.filter(({ group }) => group.status === 'active').length
  const activeAds = ads.filter(({ ad }) => ad.status === 'active').length
  const videoAds = ads.filter(({ ad }) => /^https:\/\//i.test(ad.creative?.videoUrl || '')).length

  const insightRows = useMemo(() => campaigns.map((campaign) => {
    const spend = Number(campaign.metrics?.spend) || 0
    const decision = props.decisions?.byCampaign?.[campaign.platformCampaignId]
    const sales = Number(decision?.sales) || 0
    const sameCurrency = !decision?.currency || decision.currency === (campaign.currency || props.currency)
    const revenue = sameCurrency ? (Number(decision?.revenueCents) || 0) / 100 : null
    const roas = spend > 0 && revenue != null ? revenue / spend : null
    return { campaign, spend, sales, revenue, roas }
  }), [campaigns, props.decisions, props.currency])

  const noSales = insightRows.filter((row) => row.spend > 0 && row.sales === 0).sort((a, b) => b.spend - a.spend)
  const winners = insightRows.filter((row) => row.roas != null && row.roas >= 2).sort((a, b) => (b.roas || 0) - (a.roas || 0))
  const attention = campaigns.filter((campaign) => ['rejected', 'error', 'pending_review'].includes(String(campaign.status)))

  function toggleSelection(setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) {
    setter((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function bulkChildStatus(kind: 'adgroups' | 'ads', status: 'active' | 'paused') {
    if (bulkBusy) return
    const selected = kind === 'adgroups' ? selectedGroups : selectedAds
    if (selected.size === 0) return
    setBulkBusy(true)
    try {
      const advertiserId = campaigns[0]?.platformAdAccountId || ''
      const result = await apiSend<{
        dryRun?: boolean
        simulated?: number
        totals?: { updated: number; skipped: number; failed: number }
      }>('/api/ads/entities/bulk-status', 'POST', {
        ids: [...selected].slice(0, 50),
        status,
        adAccountId: advertiserId,
      })
      if (result.dryRun) {
        toast.info('Simulação concluída', { hint: `${result.simulated || selected.size} item(ns) seriam alterados.` })
      } else if (result.totals?.failed) {
        toast.error('Parte da seleção não foi alterada', { hint: `${result.totals.updated} atualizados · ${result.totals.failed} falhas.` })
      } else {
        toast.info(status === 'paused' ? 'Pausa em lote solicitada' : 'Ativação em lote solicitada', { hint: `${result.totals?.updated || selected.size} item(ns) enviados ao TikTok.` })
      }
      if (kind === 'adgroups') setSelectedGroups(new Set())
      else setSelectedAds(new Set())
      props.onMutate()
    } catch (error) {
      toast.error('Não foi possível concluir a ação em lote', { hint: error instanceof Error ? error.message : undefined })
    } finally {
      setBulkBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-border/65 bg-card/45">
        <div className="flex flex-col gap-3 border-b border-border/55 px-4 py-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 items-center gap-1 overflow-x-auto" role="tablist" aria-label="Níveis da operação TikTok">
            {LEVELS.map((item) => {
              const Icon = item.icon
              const active = level === item.value
              const count = item.value === 'campaigns' ? campaigns.length
                : item.value === 'adgroups' ? groups.length
                  : item.value === 'ads' ? ads.length
                    : item.value === 'creatives' ? videoAds
                      : null
              return (
                <button
                  key={item.value}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setLevel(item.value)}
                  className={cn(
                    'inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-3 text-xs font-semibold transition-colors',
                    active ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/55 hover:text-foreground',
                  )}
                >
                  <Icon className="size-3.5" />
                  {item.label}
                  {count != null ? <span className="rounded-md bg-background/70 px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">{count}</span> : null}
                </button>
              )
            })}
          </div>

          {level !== 'campaigns' && level !== 'insights' ? (
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
              <label className="shrink-0">
                <span className="sr-only">Visualização de métricas</span>
                <select
                  value={metricPreset}
                  onChange={(event) => setMetricPreset(event.target.value as MetricPreset)}
                  className="h-10 rounded-lg border border-border/65 bg-background/35 px-2.5 text-[11px] font-medium text-foreground outline-none focus:border-brand-cyan/50"
                  aria-label="Visualização de métricas"
                >
                  <option value="performance">Performance</option>
                  <option value="delivery">Entrega</option>
                  <option value="cost">Custos</option>
                </select>
              </label>
              <div className="flex shrink-0 items-center gap-1 rounded-lg border border-border/65 bg-background/35 p-1" role="group" aria-label="Filtrar por status">
                {([
                  ['all', 'Todos'],
                  ['active', 'Ativos'],
                  ['paused', 'Pausados'],
                  ['attention', 'Problemas'],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setNodeFilter(value)}
                    aria-pressed={nodeFilter === value}
                    className={cn(
                      'min-h-8 rounded-md px-2 text-[11px] font-medium transition-colors',
                      nodeFilter === value ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className="relative min-w-0 sm:w-72">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={level === 'adgroups' ? 'Buscar conjunto ou campanha' : level === 'ads' ? 'Buscar anúncio, conjunto ou campanha' : 'Buscar criativo'}
                  className="h-10 w-full rounded-lg border border-border/70 bg-background/45 pl-9 pr-3 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-brand-cyan/50"
                />
              </label>
            </div>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-px bg-border/45 sm:grid-cols-4">
          <div className="bg-background/45 px-4 py-3"><p className="text-lg font-semibold tabular-nums text-foreground">{campaigns.filter((c) => c.status === 'active').length}</p><p className="text-[11px] text-muted-foreground">Campanhas ativas</p></div>
          <div className="bg-background/45 px-4 py-3"><p className="text-lg font-semibold tabular-nums text-foreground">{activeGroups}</p><p className="text-[11px] text-muted-foreground">Conjuntos ativos</p></div>
          <div className="bg-background/45 px-4 py-3"><p className="text-lg font-semibold tabular-nums text-foreground">{activeAds}</p><p className="text-[11px] text-muted-foreground">Anúncios ativos</p></div>
          <div className="bg-background/45 px-4 py-3"><p className="text-lg font-semibold tabular-nums text-foreground">{videoAds}</p><p className="text-[11px] text-muted-foreground">Vídeos carregados</p></div>
        </div>
      </section>

      {level === 'campaigns' ? <CampaignTree {...props} /> : null}

      {level === 'adgroups' ? (
        <section className="overflow-hidden rounded-2xl border border-border/65 bg-card/35">
          <header className="flex flex-col gap-3 border-b border-border/55 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Conjuntos de anúncios</h3>
              <p className="mt-1 text-xs text-muted-foreground">Controle orçamento e veiculação no nível de audiência sem precisar abrir a campanha.</p>
            </div>
            {selectedGroups.size > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">{selectedGroups.size} selecionado{selectedGroups.size === 1 ? '' : 's'}</span>
                <button type="button" className="btn-secondary min-h-9 px-3 text-xs" disabled={bulkBusy} onClick={() => void bulkChildStatus('adgroups', 'active')}><Play className="size-3.5" /> Ativar</button>
                <button type="button" className="btn-secondary min-h-9 px-3 text-xs" disabled={bulkBusy} onClick={() => void bulkChildStatus('adgroups', 'paused')}><Pause className="size-3.5" /> Pausar</button>
              </div>
            ) : null}
          </header>
          {visibleGroups.length === 0 ? <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nenhum conjunto encontrado.</p> : (
            <div className="divide-y divide-border/45">
              {visibleGroups.map(({ campaign, group }, index) => {
                const id = group.platformAdSetId || `${campaign.platformCampaignId}:${index}`
                return (
                  <div key={id} className="grid gap-3 px-4 py-3 lg:grid-cols-[28px_minmax(240px,1.4fr)_110px_110px_90px_150px] lg:items-center">
                    <label className="flex items-center">
                      <input type="checkbox" checked={selectedGroups.has(String(group.platformAdSetId || ''))} disabled={!group.platformAdSetId} onChange={() => group.platformAdSetId && toggleSelection(setSelectedGroups, group.platformAdSetId)} className="size-4 accent-[color:var(--brand-cyan)]" aria-label={`Selecionar conjunto ${group.adSetName || group.name || ''}`} />
                    </label>
                    <div className="min-w-0">
                      <button type="button" onClick={() => props.onOpenDetail?.(campaign)} className="max-w-full text-left">
                        <p className="truncate text-sm font-semibold text-foreground">{group.adSetName || group.name || 'Conjunto sem nome'}</p>
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{campaign.campaignName || campaign.platformCampaignId}</p>
                      </button>
                    </div>
                    {metricCells(group.metrics, campaign.currency || props.currency, metricPreset).slice(0, 2).map((cell) => (
                      <div key={cell.label}><p className="text-[10px] uppercase tracking-wide text-muted-foreground">{cell.label}</p><p className="mt-0.5 text-xs font-semibold tabular-nums text-foreground">{cell.value}</p></div>
                    ))}
                    <div><p className="text-[10px] uppercase tracking-wide text-muted-foreground">Anúncios</p><p className="mt-0.5 text-xs font-semibold tabular-nums text-foreground">{group.ads?.length ?? 0}</p></div>
                    <div className="flex justify-start lg:justify-end">
                      <EntityStatusToggle id={group.platformAdSetId} status={group.status} advertiserId={campaign.platformAdAccountId} label="conjunto" onMutate={props.onMutate} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      ) : null}

      {level === 'ads' ? (
        <section className="overflow-hidden rounded-2xl border border-border/65 bg-card/35">
          <header className="flex flex-col gap-3 border-b border-border/55 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Anúncios</h3>
              <p className="mt-1 text-xs text-muted-foreground">Veja o criativo e controle cada anúncio independentemente do conjunto.</p>
            </div>
            {selectedAds.size > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">{selectedAds.size} selecionado{selectedAds.size === 1 ? '' : 's'}</span>
                <button type="button" className="btn-secondary min-h-9 px-3 text-xs" disabled={bulkBusy} onClick={() => void bulkChildStatus('ads', 'active')}><Play className="size-3.5" /> Ativar</button>
                <button type="button" className="btn-secondary min-h-9 px-3 text-xs" disabled={bulkBusy} onClick={() => void bulkChildStatus('ads', 'paused')}><Pause className="size-3.5" /> Pausar</button>
              </div>
            ) : null}
          </header>
          {visibleAds.length === 0 ? <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nenhum anúncio encontrado.</p> : (
            <div className="divide-y divide-border/45">
              {visibleAds.map(({ campaign, group, ad }, index) => {
                const id = ad.platformAdId || ad._id || `${campaign.platformCampaignId}:${index}`
                return (
                  <div key={id} className="flex flex-col gap-3 px-4 py-3 xl:flex-row xl:items-center">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <input type="checkbox" checked={selectedAds.has(String(ad.platformAdId || ad._id || ''))} disabled={!(ad.platformAdId || ad._id)} onChange={() => {
                        const adId = String(ad.platformAdId || ad._id || '')
                        if (adId) toggleSelection(setSelectedAds, adId)
                      }} className="size-4 shrink-0 accent-[color:var(--brand-cyan)]" aria-label={`Selecionar anúncio ${ad.name || ''}`} />
                      <CreativePreview ad={ad} />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">{ad.name || 'Anúncio sem nome'}</p>
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{group.adSetName || group.name || 'Conjunto'} · {campaign.campaignName || campaign.platformCampaignId}</p>
                        {ad.rejectionReason ? <p className="mt-1 line-clamp-1 text-[11px] text-error">{ad.rejectionReason}</p> : null}
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-4 xl:w-[330px]">
                      {metricCells(ad.metrics, campaign.currency || props.currency, metricPreset).map((cell) => (
                        <div key={cell.label}><p className="text-[10px] uppercase tracking-wide text-muted-foreground">{cell.label}</p><p className="mt-0.5 text-xs font-semibold tabular-nums text-foreground">{cell.value}</p></div>
                      ))}
                    </div>
                    <div className="xl:w-32 xl:text-right">
                      <EntityStatusToggle id={ad.platformAdId || ad._id} status={ad.status} advertiserId={campaign.platformAdAccountId} label="anúncio" onMutate={props.onMutate} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      ) : null}

      {level === 'creatives' ? (
        <section>
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Biblioteca em veiculação</h3>
              <p className="mt-1 text-xs text-muted-foreground">Criativos que já estão dentro das campanhas, com contexto de performance e status.</p>
            </div>
          </div>
          {visibleAds.length === 0 ? <div className="rounded-2xl border border-border/65 py-10 text-center text-sm text-muted-foreground">Nenhum criativo encontrado.</div> : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {visibleAds.map(({ campaign, group, ad }, index) => {
                const id = ad.platformAdId || ad._id || `creative:${index}`
                return (
                  <article key={id} className="overflow-hidden rounded-2xl border border-border/65 bg-card/40">
                    <div className="mx-auto w-full max-w-[220px] p-3 pb-0"><CreativePreview ad={ad} large /></div>
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-foreground">{ad.name || 'Criativo sem nome'}</p>
                          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{group.adSetName || group.name || 'Conjunto'}</p>
                        </div>
                        <EntityStatusToggle id={ad.platformAdId || ad._id} status={ad.status} advertiserId={campaign.platformAdAccountId} label="anúncio" onMutate={props.onMutate} />
                      </div>
                      <div className="mt-4 grid grid-cols-3 gap-2 border-t border-border/45 pt-3">
                        <div><p className="text-[10px] text-muted-foreground">Gasto</p><p className="mt-0.5 text-xs font-semibold tabular-nums text-foreground">{money(ad.metrics?.spend, campaign.currency || props.currency)}</p></div>
                        <div><p className="text-[10px] text-muted-foreground">CTR</p><p className="mt-0.5 text-xs font-semibold tabular-nums text-foreground">{pct(ad.metrics?.ctr)}</p></div>
                        <div><p className="text-[10px] text-muted-foreground">Conv.</p><p className="mt-0.5 text-xs font-semibold tabular-nums text-foreground">{compact(ad.metrics?.conversions)}</p></div>
                      </div>
                      <button type="button" onClick={() => props.onOpenDetail?.(campaign)} className="mt-3 inline-flex min-h-9 items-center gap-1 text-xs font-medium text-brand-cyan hover:underline">
                        Abrir campanha <ChevronRight className="size-3" />
                      </button>
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </section>
      ) : null}

      {level === 'insights' ? (
        <section className="grid gap-4 xl:grid-cols-3">
          <article className="rounded-2xl border border-border/65 bg-card/40 p-4">
            <div className="flex items-start justify-between gap-3">
              <div><h3 className="text-sm font-semibold text-foreground">Gasto sem venda real</h3><p className="mt-1 text-xs text-muted-foreground">Prioridade para revisão de criativo, página ou segmentação.</p></div>
              <TriangleAlert className="size-4 text-warning" />
            </div>
            <div className="mt-4 divide-y divide-border/45">
              {noSales.slice(0, 5).map((row) => <button key={row.campaign.platformCampaignId} type="button" onClick={() => props.onOpenDetail?.(row.campaign)} className="flex w-full items-center justify-between gap-3 py-2.5 text-left"><span className="min-w-0 truncate text-xs text-foreground">{row.campaign.campaignName || row.campaign.platformCampaignId}</span><span className="shrink-0 text-xs font-semibold tabular-nums text-warning">{money(row.spend, row.campaign.currency || props.currency)}</span></button>)}
              {noSales.length === 0 ? <p className="py-4 text-xs text-muted-foreground">Nenhuma campanha com gasto e zero vendas reais.</p> : null}
            </div>
          </article>

          <article className="rounded-2xl border border-border/65 bg-card/40 p-4">
            <div className="flex items-start justify-between gap-3">
              <div><h3 className="text-sm font-semibold text-foreground">Vencedoras</h3><p className="mt-1 text-xs text-muted-foreground">Campanhas com ROAS first-party acima de 2× no período.</p></div>
              <BarChart3 className="size-4 text-success" />
            </div>
            <div className="mt-4 divide-y divide-border/45">
              {winners.slice(0, 5).map((row) => <button key={row.campaign.platformCampaignId} type="button" onClick={() => props.onOpenDetail?.(row.campaign)} className="flex w-full items-center justify-between gap-3 py-2.5 text-left"><span className="min-w-0 truncate text-xs text-foreground">{row.campaign.campaignName || row.campaign.platformCampaignId}</span><span className="shrink-0 text-xs font-semibold tabular-nums text-success">{row.roas?.toFixed(2)}×</span></button>)}
              {winners.length === 0 ? <p className="py-4 text-xs text-muted-foreground">Nenhuma vencedora identificada neste período.</p> : null}
            </div>
          </article>

          <article className="rounded-2xl border border-border/65 bg-card/40 p-4">
            <div className="flex items-start justify-between gap-3">
              <div><h3 className="text-sm font-semibold text-foreground">Operação autônoma</h3><p className="mt-1 text-xs text-muted-foreground">Leve sinais da campanha para regras e decisões automáticas com guardrails.</p></div>
              <Bot className="size-4 text-brand-cyan" />
            </div>
            <div className="mt-4 space-y-3">
              <div className="rounded-xl border border-border/55 bg-secondary/15 p-3"><p className="text-xs font-medium text-foreground">{attention.length} campanha{attention.length === 1 ? '' : 's'} pedindo atenção</p><p className="mt-1 text-[11px] text-muted-foreground">Revisão, rejeição ou erro de entrega.</p></div>
              <div className="rounded-xl border border-border/55 bg-secondary/15 p-3"><p className="text-xs font-medium text-foreground">{noSales.length} oportunidade{noSales.length === 1 ? '' : 's'} de regra</p><p className="mt-1 text-[11px] text-muted-foreground">Campanhas com gasto e nenhuma venda first-party.</p></div>
              {props.onOpenAutomations ? <button type="button" onClick={props.onOpenAutomations} className="btn-secondary min-h-10 w-full text-xs"><Bot className="size-3.5" /> Abrir automações</button> : null}
            </div>
          </article>
        </section>
      ) : null}
    </div>
  )
}
