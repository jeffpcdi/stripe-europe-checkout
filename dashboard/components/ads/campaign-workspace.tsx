'use client'

import { useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import {
  ArrowUpDown,
  BarChart3,
  Bot,
  ChevronRight,
  ExternalLink,
  Film,
  Layers3,
  Loader2,
  Megaphone,
  Pause,
  Pencil,
  Play,
  Search,
  Sparkles,
  TriangleAlert,
} from 'lucide-react'
import { apiSend, useAdsCreativeInsights, useAdsRulePresets, useAdsRules } from '@/lib/api'
import { toast } from '@/lib/toast'
import { usePersistedState } from '@/lib/use-persisted-state'
import type {
  AdsCampaignDecisionsResponse,
  AdsMetrics,
  AdsRule,
  AdsRulesResponse,
  AdsNodeStatus,
  AdsTreeAd,
  AdsTreeAdSet,
  AdsTreeCampaign,
  AdsTreeResponse,
} from '@/lib/types'
import { cn } from '@/lib/utils'
import { CampaignTree } from './campaign-tree'
import { AdEditDialog } from './ad-edit-dialog'
import { TIKTOK_MIN_BUDGET, tiktokMinimumBudgetMessage } from './tiktok-contracts'

type WorkspaceLevel = 'overview' | 'campaigns' | 'adgroups' | 'ads' | 'creatives' | 'insights' | 'approvals' | 'playbooks'
type NodeFilter = 'all' | 'active' | 'paused' | 'attention'
type MetricPreset = 'performance' | 'delivery' | 'cost' | 'video'
type ChildSort = 'spend_desc' | 'ctr_desc' | 'conversions_desc' | 'name'

type Props = {
  tree?: AdsTreeResponse
  loading: boolean
  error: string | null
  currency: string
  adAccountId: string
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
  approvals?: ReactNode
  approvalsCount?: number
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
  { value: 'overview', label: 'Visão', icon: BarChart3 },
  { value: 'campaigns', label: 'Campanhas', icon: Megaphone },
  { value: 'adgroups', label: 'Conjuntos', icon: Layers3 },
  { value: 'ads', label: 'Anúncios', icon: Play },
  { value: 'creatives', label: 'Criativos', icon: Film },
  { value: 'insights', label: 'Oportunidades', icon: Sparkles },
  { value: 'approvals', label: 'Aprovações', icon: TriangleAlert },
  { value: 'playbooks', label: 'Playbooks', icon: Bot },
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

function optionalCompact(value: number | undefined) {
  return value == null ? '—' : compact(value)
}

function optionalPct(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? '—' : `${value.toFixed(1).replace('.', ',')}%`
}

function videoMetricSummary(metrics?: AdsMetrics) {
  const watched2s = metrics?.videoWatched2s
  const watched6s = metrics?.videoWatched6s
  const plays = metrics?.videoPlayActions ?? metrics?.videoViews
  const completed = metrics?.videoViewsP100
  return {
    watched2s: optionalCompact(watched2s),
    hold6s: optionalPct(watched2s && watched6s != null ? watched6s / watched2s * 100 : null),
    completion: optionalPct(plays && completed != null ? completed / plays * 100 : null),
    average: metrics?.averageVideoPlay == null ? '—' : `${Number(metrics.averageVideoPlay).toFixed(1).replace('.', ',')}s`,
  }
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
  if (preset === 'video') {
    const video = videoMetricSummary(metrics)
    return [
      { label: 'Views 2s', value: video.watched2s },
      { label: 'Retenção 6s', value: video.hold6s },
      { label: 'Conclusão', value: video.completion },
    ]
  }
  return [
    { label: 'Gasto', value: money(metrics?.spend, currency) },
    { label: 'CTR', value: pct(metrics?.ctr) },
    { label: 'Conv.', value: compact(metrics?.conversions) },
  ]
}

function playbookSummary(rule: AdsRule, currency: string) {
  if (rule.metric === 'spend_no_conv') return `Gasto ≥ ${money(rule.threshold, currency)} sem conversão → proposta de pausa.`
  if (rule.metric === 'cpa_max') return `CPA > ${money(rule.threshold, currency)} com volume mínimo → proposta de pausa.`
  if (rule.metric === 'ctr_min') return `CTR < ${String(rule.threshold).replace('.', ',')}% após o piso de impressões → proposta de pausa.`
  if (rule.metric === 'roas_min') return `ROAS < ${rule.threshold.toFixed(1).replace('.', ',')}× com atribuição real → proposta de pausa.`
  if (rule.metric === 'roas_scale') return `ROAS ≥ ${rule.threshold.toFixed(1).replace('.', ',')}× → proposta de escalar +${rule.pct}% com teto.`
  if (rule.metric === 'self_heal') return `Realoca até ${rule.pct}% de uma doadora ruim para uma vencedora sem aumentar o orçamento total.`
  if (rule.metric === 'scheduled_scale') return `Escala em dias/horário definidos somente quando o ROAS mínimo for atingido.`
  if (rule.metric === 'schedule') return `Liga e pausa campanhas automaticamente dentro da janela de veiculação configurada.`
  if (rule.metric === 'cpm_max') return `CPM alto → proposta de reduzir orçamento em ${rule.pct}%.`
  if (rule.metric === 'cpc_max') return `CPC alto → proposta de reduzir orçamento em ${rule.pct}%.`
  return 'Monitora a condição e gera uma proposta de ação dentro dos guardrails.'
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

function AdGroupBudgetControl({
  campaign,
  group,
  currency,
  onMutate,
}: {
  campaign: AdsTreeCampaign
  group: AdsTreeAdSet
  currency: string
  onMutate: () => void
}) {
  const amount = Number(group.budget?.amount)
  const budgetType = group.budget?.type === 'lifetime' ? 'lifetime' : 'daily'
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(Number.isFinite(amount) ? String(amount) : '')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!editing) setValue(Number.isFinite(amount) ? String(amount) : '')
  }, [amount, editing])

  if (campaign.budgetOwner === 'campaign') {
    return <span className="text-[11px] font-medium text-muted-foreground">CBO · na campanha</span>
  }
  if (!group.platformAdSetId || !Number.isFinite(amount)) {
    return <span className="text-[11px] text-muted-foreground">—</span>
  }

  async function save() {
    const next = Number(value.replace(',', '.'))
    if (!Number.isFinite(next) || next < TIKTOK_MIN_BUDGET) {
      toast.error(tiktokMinimumBudgetMessage(currency))
      return
    }
    if (Math.abs(next - amount) < 0.000001) {
      setEditing(false)
      return
    }

    setBusy(true)
    try {
      const result = await apiSend<{ dryRun?: boolean; simulated?: boolean }>(
        `/api/ads/${encodeURIComponent(group.platformAdSetId || '')}`,
        'PUT',
        {
          budget: { amount: next, type: budgetType },
          adAccountId: campaign.platformAdAccountId,
        },
      )
      if (result.dryRun || result.simulated) toast.info('Simulação concluída', { hint: 'O orçamento não foi alterado no TikTok.' })
      else toast.success('Orçamento do conjunto atualizado', { hint: 'A lista será reconciliada com o TikTok.' })
      setEditing(false)
      onMutate()
    } catch (error) {
      toast.error('Não foi possível alterar o orçamento', { hint: error instanceof Error ? error.message : undefined })
    } finally {
      setBusy(false)
    }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          type="number"
          min={TIKTOK_MIN_BUDGET}
          step="0.01"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          disabled={busy}
          className="h-8 w-24 rounded-lg border border-border/70 bg-background px-2 text-xs tabular-nums text-foreground outline-none focus:border-brand-cyan/60"
          aria-label="Novo orçamento do conjunto"
        />
        <button type="button" onClick={() => void save()} disabled={busy} className="inline-flex size-8 items-center justify-center rounded-lg bg-brand-cyan/10 text-brand-cyan hover:bg-brand-cyan/15 disabled:opacity-50" aria-label="Salvar orçamento">
          {busy ? <Loader2 className="size-3 animate-spin" /> : <span className="text-xs font-bold">✓</span>}
        </button>
        <button type="button" onClick={() => setEditing(false)} disabled={busy} className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label="Cancelar edição de orçamento">×</button>
      </div>
    )
  }

  return (
    <button type="button" onClick={() => setEditing(true)} className="group text-left" title="Editar orçamento do conjunto">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Orçamento</p>
      <p className="mt-0.5 inline-flex items-center gap-1 text-xs font-semibold tabular-nums text-foreground group-hover:text-brand-cyan">
        {money(amount, currency)}
        <Pencil className="size-3 opacity-60" />
      </p>
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
  const [level, setLevel] = usePersistedState<WorkspaceLevel>('ads:campaign-workspace-level', 'overview')
  const [nodeFilter, setNodeFilter] = usePersistedState<NodeFilter>('ads:campaign-workspace-status', 'all')
  const [metricPreset, setMetricPreset] = usePersistedState<MetricPreset>('ads:campaign-workspace-metrics', 'performance')
  const [childSort, setChildSort] = usePersistedState<ChildSort>('ads:campaign-workspace-sort', 'spend_desc')
  const [query, setQuery] = useState('')
  const [editAd, setEditAd] = useState<{ ad: AdsTreeAd; advertiserId: string } | null>(null)
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set())
  const [selectedAds, setSelectedAds] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [playbookBusy, setPlaybookBusy] = useState<string | null>(null)
  const campaigns = props.tree?.campaigns ?? []
  const advertiserId = props.adAccountId || campaigns[0]?.platformAdAccountId || ''
  const rulesQuery = useAdsRules(level === 'playbooks', advertiserId)
  const presetsQuery = useAdsRulePresets(level === 'playbooks')
  const creativeInsights = useAdsCreativeInsights(level === 'creatives', advertiserId)

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

  const sortMetricRows = <T extends AdGroupRow | AdRow>(rows: T[], metricsFor: (row: T) => AdsMetrics | undefined, nameFor: (row: T) => string) =>
    [...rows].sort((a, b) => {
      if (childSort === 'name') return nameFor(a).localeCompare(nameFor(b), 'pt-BR')
      const am = metricsFor(a)
      const bm = metricsFor(b)
      if (childSort === 'ctr_desc') return (Number(bm?.ctr) || 0) - (Number(am?.ctr) || 0)
      if (childSort === 'conversions_desc') return (Number(bm?.conversions) || 0) - (Number(am?.conversions) || 0)
      return (Number(bm?.spend) || 0) - (Number(am?.spend) || 0)
    })

  const orderedGroups = sortMetricRows(
    visibleGroups,
    (row) => row.group.metrics,
    (row) => row.group.adSetName || row.group.name || '',
  )
  const orderedAds = sortMetricRows(
    visibleAds,
    (row) => row.ad.metrics,
    (row) => row.ad.name || '',
  )

  const activeGroups = groups.filter(({ group }) => group.status === 'active').length
  const activeAds = ads.filter(({ ad }) => ad.status === 'active').length
  const videoAds = ads.filter(({ ad }) => /^https:\/\//i.test(ad.creative?.videoUrl || '')).length
  const groupsWithFewCreatives = groups
    .filter(({ group }) => group.status === 'active' && (group.ads?.filter((ad) => ad.status !== 'rejected').length ?? 0) < 3)
    .sort((a, b) => (a.group.ads?.length ?? 0) - (b.group.ads?.length ?? 0))
  const activeGroupsWithoutActiveAds = groups.filter(({ group }) =>
    group.status === 'active' && !(group.ads ?? []).some((ad) => ad.status === 'active'),
  )

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

  const totalSpend = insightRows.reduce((sum, row) => sum + row.spend, 0)
  const totalSales = props.decisions ? insightRows.reduce((sum, row) => sum + row.sales, 0) : null
  const comparableRevenue = insightRows.every((row) => row.revenue != null)
  const totalRevenue = comparableRevenue ? insightRows.reduce((sum, row) => sum + Number(row.revenue || 0), 0) : null
  const realRoas = totalRevenue != null && totalSpend > 0 ? totalRevenue / totalSpend : null

  const groupSelectionScope = orderedGroups.map(({ group }) => group.platformAdSetId).filter(Boolean).sort().join('|')
  const adSelectionScope = orderedAds.map(({ ad }) => ad.platformAdId || ad._id).filter(Boolean).sort().join('|')

  useEffect(() => {
    setSelectedGroups(new Set())
  }, [level, nodeFilter, query, groupSelectionScope])

  useEffect(() => {
    setSelectedAds(new Set())
  }, [level, nodeFilter, query, adSelectionScope])

  async function togglePlaybook(preset: AdsRule) {
    if (!advertiserId || !rulesQuery.data || playbookBusy) return
    const current = rulesQuery.data
    const existing = current.rules.find((rule) => rule.id === preset.id)
    const enabling = !existing?.enabled
    if (!existing && current.rules.length >= 12) {
      toast.error('Limite de 12 regras atingido', { hint: 'Remova uma regra em Automações antes de adicionar outro playbook.' })
      return
    }
    const nextRule: AdsRule = {
      ...(existing || preset),
      enabled: enabling,
      mode: existing?.mode || 'proposal',
    }
    const nextRules = existing
      ? current.rules.map((rule) => rule.id === preset.id ? nextRule : rule)
      : [...current.rules, nextRule]

    setPlaybookBusy(preset.id)
    try {
      const saved = await apiSend<AdsRulesResponse>('/api/ads/rules', 'PUT', {
        adAccountId: advertiserId,
        revision: current.revision,
        rules: nextRules,
      })
      await rulesQuery.mutate(saved, { revalidate: false })
      toast.success(enabling ? 'Playbook ativado em modo proposta' : 'Playbook pausado', {
        hint: enabling ? 'O motor monitora e propõe ações; execução direta depende do nível de autonomia configurado.' : undefined,
      })
    } catch (error) {
      toast.error('Não foi possível alterar o playbook', { hint: error instanceof Error ? error.message : undefined })
      await rulesQuery.mutate()
    } finally {
      setPlaybookBusy(null)
    }
  }

  function toggleSelection(setter: Dispatch<SetStateAction<Set<string>>>, id: string) {
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
      const advertiserId = props.adAccountId || campaigns[0]?.platformAdAccountId || ''
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
                      : item.value === 'approvals' ? (props.approvalsCount || null)
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

          {(['adgroups', 'ads', 'creatives'] as WorkspaceLevel[]).includes(level) ? (
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
              <label className="shrink-0">
                <span className="sr-only">Ordenar itens</span>
                <div className="relative">
                  <ArrowUpDown className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <select
                    value={childSort}
                    onChange={(event) => setChildSort(event.target.value as ChildSort)}
                    className="h-10 rounded-lg border border-border/65 bg-background/35 pl-8 pr-2.5 text-[11px] font-medium text-foreground outline-none focus:border-brand-cyan/50"
                    aria-label="Ordenar itens"
                  >
                    <option value="spend_desc">Maior gasto</option>
                    <option value="ctr_desc">Maior CTR</option>
                    <option value="conversions_desc">Mais conversões</option>
                    <option value="name">Nome</option>
                  </select>
                </div>
              </label>
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
                  {(level === 'ads' || level === 'creatives') && <option value="video">Vídeo</option>}
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

      </section>

      {level === 'overview' ? (
        <section className="space-y-4">
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border/65 bg-border/45 md:grid-cols-3 xl:grid-cols-6">
            <div className="bg-card/55 px-4 py-4"><p className="text-xl font-semibold tabular-nums text-foreground">{campaigns.filter((c) => c.status === 'active').length}</p><p className="mt-1 text-[11px] text-muted-foreground">Campanhas ativas</p></div>
            <div className="bg-card/55 px-4 py-4"><p className="text-xl font-semibold tabular-nums text-foreground">{activeGroups}</p><p className="mt-1 text-[11px] text-muted-foreground">Conjuntos ativos</p></div>
            <div className="bg-card/55 px-4 py-4"><p className="text-xl font-semibold tabular-nums text-foreground">{activeAds}</p><p className="mt-1 text-[11px] text-muted-foreground">Anúncios ativos</p></div>
            <div className="bg-card/55 px-4 py-4"><p className="text-xl font-semibold tabular-nums text-foreground">{money(totalSpend, props.currency)}</p><p className="mt-1 text-[11px] text-muted-foreground">Gasto TikTok</p></div>
            <div className="bg-card/55 px-4 py-4"><p className="text-xl font-semibold tabular-nums text-success">{totalSales == null ? '—' : totalSales.toLocaleString('pt-BR')}</p><p className="mt-1 text-[11px] text-muted-foreground">Vendas reais</p></div>
            <div className="bg-card/55 px-4 py-4"><p className={cn('text-xl font-semibold tabular-nums', realRoas != null && realRoas >= 2 ? 'text-success' : 'text-foreground')}>{realRoas == null ? '—' : `${realRoas.toFixed(2)}×`}</p><p className="mt-1 text-[11px] text-muted-foreground">ROAS real</p></div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
            <article className="rounded-2xl border border-border/65 bg-card/40 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Agora na operação</h3>
                  <p className="mt-1 text-xs text-muted-foreground">O que merece ação antes de abrir o TikTok Ads Manager.</p>
                </div>
                <Sparkles className="size-4 text-brand-cyan" />
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <button type="button" onClick={() => setLevel('insights')} className="rounded-xl border border-warning/25 bg-warning/[0.05] p-3 text-left transition-colors hover:bg-warning/10">
                  <p className="text-lg font-semibold tabular-nums text-warning">{noSales.length}</p>
                  <p className="mt-1 text-xs font-medium text-foreground">Gastando sem venda</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">Revisar ou automatizar.</p>
                </button>
                <button type="button" onClick={() => setLevel('insights')} className="rounded-xl border border-success/25 bg-success/[0.05] p-3 text-left transition-colors hover:bg-success/10">
                  <p className="text-lg font-semibold tabular-nums text-success">{winners.length}</p>
                  <p className="mt-1 text-xs font-medium text-foreground">Vencedoras</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">ROAS real acima de 2×.</p>
                </button>
                <button type="button" onClick={() => setLevel('insights')} className="rounded-xl border border-error/20 bg-error/[0.04] p-3 text-left transition-colors hover:bg-error/10">
                  <p className="text-lg font-semibold tabular-nums text-error">{attention.length}</p>
                  <p className="mt-1 text-xs font-medium text-foreground">Com atenção</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">Revisão, rejeição ou erro.</p>
                </button>
              </div>
            </article>

            <article className="rounded-2xl border border-border/65 bg-card/40 p-4">
              <div className="flex items-start justify-between gap-3">
                <div><h3 className="text-sm font-semibold text-foreground">Operação autônoma</h3><p className="mt-1 text-xs text-muted-foreground">Playbooks monitoram sinais e propõem ações com guardrails.</p></div>
                <Bot className="size-4 text-brand-cyan" />
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setLevel('playbooks')} className="btn-secondary min-h-10 text-xs"><Bot className="size-3.5" /> Ver playbooks</button>
                {props.onOpenAutomations ? <button type="button" onClick={props.onOpenAutomations} className="btn-secondary min-h-10 text-xs"><Sparkles className="size-3.5" /> Automações</button> : null}
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">A execução direta continua condicionada ao modo de autonomia, kill switch e política de segurança da conta.</p>
            </article>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <article className="rounded-2xl border border-border/65 bg-card/40 p-4">
              <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold text-foreground">Top vencedoras</h3><button type="button" onClick={() => setLevel('insights')} className="text-xs font-medium text-brand-cyan hover:underline">Ver oportunidades</button></div>
              <div className="mt-3 divide-y divide-border/45">
                {winners.slice(0, 4).map((row) => <button key={row.campaign.platformCampaignId} type="button" onClick={() => props.onOpenDetail?.(row.campaign)} className="flex w-full items-center justify-between gap-3 py-2.5 text-left"><span className="truncate text-xs text-foreground">{row.campaign.campaignName || row.campaign.platformCampaignId}</span><span className="shrink-0 text-xs font-semibold tabular-nums text-success">{row.roas?.toFixed(2)}×</span></button>)}
                {winners.length === 0 ? <p className="py-4 text-xs text-muted-foreground">Ainda não há vencedoras suficientes neste período.</p> : null}
              </div>
            </article>
            <article className="rounded-2xl border border-border/65 bg-card/40 p-4">
              <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold text-foreground">Maior desperdício</h3><button type="button" onClick={() => setLevel('insights')} className="text-xs font-medium text-brand-cyan hover:underline">Revisar</button></div>
              <div className="mt-3 divide-y divide-border/45">
                {noSales.slice(0, 4).map((row) => <button key={row.campaign.platformCampaignId} type="button" onClick={() => props.onOpenDetail?.(row.campaign)} className="flex w-full items-center justify-between gap-3 py-2.5 text-left"><span className="truncate text-xs text-foreground">{row.campaign.campaignName || row.campaign.platformCampaignId}</span><span className="shrink-0 text-xs font-semibold tabular-nums text-warning">{money(row.spend, row.campaign.currency || props.currency)}</span></button>)}
                {noSales.length === 0 ? <p className="py-4 text-xs text-muted-foreground">Nenhum gasto sem venda identificado.</p> : null}
              </div>
            </article>
          </div>
        </section>
      ) : null}

      {level === 'campaigns' ? <CampaignTree {...props} /> : null}

      {level === 'adgroups' ? (
        <section className="overflow-hidden rounded-2xl border border-border/65 bg-card/35">
          <header className="flex flex-col gap-3 border-b border-border/55 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Conjuntos de anúncios</h3>
              <p className="mt-1 text-xs text-muted-foreground">Controle orçamento e veiculação no nível de audiência sem precisar abrir a campanha.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {orderedGroups.length > 0 ? <button type="button" className="btn-ghost min-h-9 px-2.5 text-xs" onClick={() => setSelectedGroups(new Set(orderedGroups.map(({ group }) => group.platformAdSetId).filter(Boolean) as string[]))}>Selecionar visíveis</button> : null}
              {selectedGroups.size > 0 ? (
              <>
                <span className="text-xs font-medium text-muted-foreground">{selectedGroups.size} selecionado{selectedGroups.size === 1 ? '' : 's'}</span>
                <button type="button" className="btn-secondary min-h-9 px-3 text-xs" disabled={bulkBusy} onClick={() => void bulkChildStatus('adgroups', 'active')}><Play className="size-3.5" /> Ativar</button>
                <button type="button" className="btn-secondary min-h-9 px-3 text-xs" disabled={bulkBusy} onClick={() => void bulkChildStatus('adgroups', 'paused')}><Pause className="size-3.5" /> Pausar</button>
              </>
              ) : null}
            </div>
          </header>
          {orderedGroups.length === 0 ? <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nenhum conjunto encontrado.</p> : (
            <div className="divide-y divide-border/45">
              {orderedGroups.map(({ campaign, group }, index) => {
                const id = group.platformAdSetId || `${campaign.platformCampaignId}:${index}`
                return (
                  <div key={id} className="grid gap-3 px-4 py-3 lg:grid-cols-[28px_minmax(220px,1.35fr)_105px_105px_120px_80px_145px] lg:items-center">
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
                    <AdGroupBudgetControl campaign={campaign} group={group} currency={campaign.currency || props.currency} onMutate={props.onMutate} />
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
            <div className="flex flex-wrap items-center gap-2">
              {orderedAds.length > 0 ? <button type="button" className="btn-ghost min-h-9 px-2.5 text-xs" onClick={() => setSelectedAds(new Set(orderedAds.map(({ ad }) => ad.platformAdId || ad._id).filter(Boolean) as string[]))}>Selecionar visíveis</button> : null}
              {selectedAds.size > 0 ? (
              <>
                <span className="text-xs font-medium text-muted-foreground">{selectedAds.size} selecionado{selectedAds.size === 1 ? '' : 's'}</span>
                <button type="button" className="btn-secondary min-h-9 px-3 text-xs" disabled={bulkBusy} onClick={() => void bulkChildStatus('ads', 'active')}><Play className="size-3.5" /> Ativar</button>
                <button type="button" className="btn-secondary min-h-9 px-3 text-xs" disabled={bulkBusy} onClick={() => void bulkChildStatus('ads', 'paused')}><Pause className="size-3.5" /> Pausar</button>
              </>
              ) : null}
            </div>
          </header>
          {orderedAds.length === 0 ? <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nenhum anúncio encontrado.</p> : (
            <div className="divide-y divide-border/45">
              {orderedAds.map(({ campaign, group, ad }, index) => {
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
                    <div className="flex items-center gap-1.5 xl:w-52 xl:justify-end">
                      <button type="button" onClick={() => setEditAd({ ad, advertiserId: campaign.platformAdAccountId || props.adAccountId })} className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label={`Editar anúncio ${ad.name || id}`} title="Editar anúncio"><Pencil className="size-3.5" /></button>
                      {ad.creative?.linkUrl ? <a href={ad.creative.linkUrl} target="_blank" rel="noopener noreferrer" className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label="Abrir destino do anúncio" title="Abrir destino"><ExternalLink className="size-3.5" /></a> : null}
                      <EntityStatusToggle id={ad.platformAdId || ad._id} status={ad.status} advertiserId={campaign.platformAdAccountId || props.adAccountId} label="anúncio" onMutate={props.onMutate} />
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
          {creativeInsights.data?.content || creativeInsights.data?.patterns ? (
            <div className="mb-4 rounded-2xl border border-brand-cyan/20 bg-brand-cyan/[0.04] p-4">
              <div className="flex items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-brand-cyan/20 bg-brand-cyan/10 text-brand-cyan"><Sparkles className="size-4" /></span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-foreground">Creative Intelligence</h3>
                    <span className="rounded-md border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">{creativeInsights.data.windowDays || 1}d</span>
                  </div>
                  {creativeInsights.data.content ? <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{creativeInsights.data.content}</p> : null}
                  {creativeInsights.data.patterns ? <p className="mt-2 text-xs leading-relaxed text-foreground/85">{creativeInsights.data.patterns}</p> : null}
                </div>
              </div>
            </div>
          ) : creativeInsights.isLoading ? (
            <div className="mb-4 flex items-center gap-2 rounded-xl border border-border/60 px-4 py-3 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Analisando padrões dos criativos…</div>
          ) : null}

          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Biblioteca em veiculação</h3>
              <p className="mt-1 text-xs text-muted-foreground">Criativos que já estão dentro das campanhas, com contexto de performance e status.</p>
            </div>
          </div>
          {visibleAds.length === 0 ? <div className="rounded-2xl border border-border/65 py-10 text-center text-sm text-muted-foreground">Nenhum criativo encontrado.</div> : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {orderedAds.map(({ campaign, group, ad }, index) => {
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
                        {metricCells(ad.metrics, campaign.currency || props.currency, metricPreset).map((cell) => (
                          <div key={cell.label}><p className="text-[10px] text-muted-foreground">{cell.label}</p><p className="mt-0.5 text-xs font-semibold tabular-nums text-foreground">{cell.value}</p></div>
                        ))}
                      </div>
                      {metricPreset === 'video' ? (
                        <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
                          Tempo médio · {videoMetricSummary(ad.metrics).average}. Métricas aparecem somente quando o reporting do TikTok as disponibiliza.
                        </p>
                      ) : null}
                      <div className="mt-3 flex items-center justify-between gap-2">
                        <button type="button" onClick={() => setEditAd({ ad, advertiserId: campaign.platformAdAccountId || props.adAccountId })} className="inline-flex min-h-9 items-center gap-1 text-xs font-medium text-foreground hover:text-brand-cyan"><Pencil className="size-3" /> Editar anúncio</button>
                        <button type="button" onClick={() => props.onOpenDetail?.(campaign)} className="inline-flex min-h-9 items-center gap-1 text-xs font-medium text-brand-cyan hover:underline">Campanha <ChevronRight className="size-3" /></button>
                      </div>
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </section>
      ) : null}

      {level === 'approvals' ? (
        <section className="space-y-4">
          <div className="rounded-2xl border border-border/65 bg-card/40 p-4">
            <div className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-warning/25 bg-warning/[0.06] text-warning"><TriangleAlert className="size-4" /></span>
              <div>
                <h3 className="text-sm font-semibold text-foreground">Central de aprovações</h3>
                <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">Itens que a automação não deve decidir sozinha aparecem aqui: propostas, reprovações, alertas de conta e exceções operacionais.</p>
              </div>
            </div>
          </div>
          {props.approvals || (
            <div className="rounded-2xl border border-border/65 py-10 text-center">
              <p className="text-sm font-medium text-foreground">Nada aguardando decisão</p>
              <p className="mt-1 text-xs text-muted-foreground">A operação pode continuar sem intervenção manual neste momento.</p>
            </div>
          )}
        </section>
      ) : null}

      {level === 'playbooks' ? (
        <section className="space-y-4">
          <div className="flex flex-col gap-3 rounded-2xl border border-border/65 bg-card/40 p-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex items-center gap-2"><Bot className="size-4 text-brand-cyan" /><h3 className="text-sm font-semibold text-foreground">Playbooks de operação</h3></div>
              <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">Estratégias prontas para monitorar a conta. Ao ligar aqui, o padrão é <strong className="font-medium text-foreground">propor</strong> a ação; execução automática continua protegida pela política e pelo nível de autonomia.</p>
            </div>
            {props.onOpenAutomations ? <button type="button" className="btn-secondary min-h-10 shrink-0 text-xs" onClick={props.onOpenAutomations}><Bot className="size-3.5" /> Configurar automações</button> : null}
          </div>

          {rulesQuery.error || presetsQuery.error ? (
            <div className="rounded-xl border border-warning/30 bg-warning/5 px-4 py-3 text-xs text-warning">Não foi possível carregar os playbooks. Abra Automações para revisar as regras diretamente.</div>
          ) : rulesQuery.isLoading || presetsQuery.isLoading ? (
            <div className="flex min-h-40 items-center justify-center rounded-2xl border border-border/65"><Loader2 className="size-5 animate-spin text-brand-cyan" /></div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {(presetsQuery.data?.presets ?? []).map((preset) => {
                const current = rulesQuery.data?.rules.find((rule) => rule.id === preset.id)
                const enabled = current?.enabled === true
                return (
                  <article key={preset.id} className={cn('rounded-2xl border p-4 transition-colors', enabled ? 'border-brand-cyan/25 bg-brand-cyan/[0.04]' : 'border-border/65 bg-card/35')}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground">{preset.name || preset.metric}</p>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{playbookSummary(current || preset, props.currency)}</p>
                      </div>
                      <button
                        type="button"
                        disabled={Boolean(playbookBusy)}
                        onClick={() => void togglePlaybook(preset)}
                        className={cn(
                          'inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-semibold transition-colors disabled:opacity-50',
                          enabled ? 'border-brand-cyan/25 bg-brand-cyan/10 text-brand-cyan' : 'border-border/70 bg-secondary/30 text-muted-foreground hover:text-foreground',
                        )}
                      >
                        {playbookBusy === preset.id ? <Loader2 className="size-3 animate-spin" /> : enabled ? <Pause className="size-3" /> : <Play className="size-3" />}
                        {enabled ? 'Monitorando' : 'Ativar'}
                      </button>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/45 pt-3 text-[10px] text-muted-foreground">
                      <span className="rounded-md bg-secondary/50 px-1.5 py-0.5">modo {current?.mode === 'execute' ? 'automático' : 'proposta'}</span>
                      <span>{preset.lookbackDays || 1}d de janela</span>
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </section>
      ) : null}

      {level === 'insights' ? (
        <section className="grid gap-4 xl:grid-cols-2">
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
              <div><h3 className="text-sm font-semibold text-foreground">Saúde dos conjuntos</h3><p className="mt-1 text-xs text-muted-foreground">Estrutura que pode limitar teste criativo ou entrega.</p></div>
              <Film className="size-4 text-brand-cyan" />
            </div>
            <div className="mt-4 divide-y divide-border/45">
              {groupsWithFewCreatives.slice(0, 4).map(({ campaign, group }) => (
                <button
                  key={group.platformAdSetId || group.adSetName || group.name}
                  type="button"
                  onClick={() => { setLevel('adgroups'); setQuery(group.adSetName || group.name || campaign.campaignName || '') }}
                  className="flex w-full items-center justify-between gap-3 py-2.5 text-left"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-xs text-foreground">{group.adSetName || group.name || 'Conjunto sem nome'}</span>
                    <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{campaign.campaignName || campaign.platformCampaignId}</span>
                  </span>
                  <span className="shrink-0 text-xs font-semibold tabular-nums text-warning">{group.ads?.length ?? 0} criativo{(group.ads?.length ?? 0) === 1 ? '' : 's'}</span>
                </button>
              ))}
              {groupsWithFewCreatives.length === 0 ? <p className="py-4 text-xs text-muted-foreground">Nenhum conjunto ativo com poucos criativos detectado.</p> : null}
            </div>
            {activeGroupsWithoutActiveAds.length > 0 ? (
              <button type="button" onClick={() => { setLevel('adgroups'); setNodeFilter('active') }} className="mt-3 w-full rounded-xl border border-warning/20 bg-warning/[0.04] px-3 py-2.5 text-left text-xs text-warning">
                {activeGroupsWithoutActiveAds.length} conjunto{activeGroupsWithoutActiveAds.length === 1 ? '' : 's'} ativo{activeGroupsWithoutActiveAds.length === 1 ? '' : 's'} sem anúncio ativo
              </button>
            ) : null}
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

      <AdEditDialog
        ad={editAd?.ad ?? null}
        adAccountId={editAd?.advertiserId || props.adAccountId}
        onClose={() => setEditAd(null)}
        onSaved={() => {
          setEditAd(null)
          props.onMutate()
        }}
      />
    </div>
  )
}
