'use client'

import { DialogPortal } from '@/components/ui/dialog-portal'
import { useMemo, useRef, useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  X,
  Copy,
  Pencil,
  Play,
  Pause,
  Loader2,
  ExternalLink,
  MoreHorizontal,
  Trash2,
} from 'lucide-react'
import { apiSend, useAdsAudit, useAdsCampaignAnalytics, useAdsCampaignDecisions } from '@/lib/api'
import { fmtCompact, fmtSpend, timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/skeleton'
import { ConfirmDialog } from '@/components/confirm-dialog'
import type { AdsCampaignDecisionEntry, AdsMetrics, AdsNodeStatus, AdsTreeAd, AdsTreeCampaign } from '@/lib/types'
import { adsDateRange, previousAdsRange, shiftAdsDay } from '@/lib/ads-time'
import { useModalA11y } from '@/lib/use-modal-a11y'
import { toast } from '@/lib/toast'
import { campaignStatusOutcome, type CampaignStatusResult } from '@/lib/campaign-metrics'
import { AdEditDialog } from './ad-edit-dialog'
import { TIKTOK_MIN_BUDGET, tiktokMinimumBudgetMessage } from './tiktok-contracts'

type Metric = 'spend' | 'conversions' | 'ctr'
type SectionKey = 'overview' | 'structure' | 'history'

type MetricOption = { id: Metric; label: string; color: string }

const METRICS: MetricOption[] = [
  { id: 'spend', label: 'Gasto', color: '#25f4ee' },
  { id: 'conversions', label: 'Conversões TikTok', color: '#22c55e' },
  { id: 'ctr', label: 'CTR', color: '#fbbf24' },
]

const RANGES = [
  { days: 7, label: '7d' },
  { days: 14, label: '14d' },
  { days: 30, label: '30d' },
] as const

const STATUS_META: Record<string, { label: string; cls: string; dot: string }> = {
  active: { label: 'Ativa', cls: 'text-success', dot: 'bg-[color:var(--success)]' },
  paused: { label: 'Pausada', cls: 'text-muted-foreground', dot: 'bg-muted-foreground' },
  pending_review: { label: 'Em revisão', cls: 'text-warning', dot: 'bg-[color:var(--warning)]' },
  rejected: { label: 'Reprovado', cls: 'text-error', dot: 'bg-[color:var(--error)]' },
  error: { label: 'Erro', cls: 'text-error', dot: 'bg-[color:var(--error)]' },
  completed: { label: 'Concluída', cls: 'text-muted-foreground', dot: 'bg-muted-foreground' },
  cancelled: { label: 'Cancelada', cls: 'text-muted-foreground', dot: 'bg-muted-foreground' },
}

const REVIEW_META: Record<string, { label: string; cls: string }> = {
  approved: { label: 'Aprovada', cls: 'text-success' },
  in_review: { label: 'Em revisão', cls: 'text-warning' },
  rejected: { label: 'Rejeitada', cls: 'text-error' },
  with_issues: { label: 'Com problemas', cls: 'text-warning' },
}

const AUDIT_LABELS: Record<string, string> = {
  campaign_status: 'Status da campanha alterado',
  entity_update: 'Configuração atualizada',
  entity_delete: 'Anúncio removido',
  rule_action: 'Automação executou uma regra',
  'rule_proposal.created': 'Automação criou uma proposta',
  'rule_proposal.approved': 'Proposta aprovada',
  schedule_action: 'Ação agendada executada',
}

function fmtDay(day: unknown) {
  const [, m, d] = String(day ?? '').split('-')
  return d && m ? `${d}/${m}` : String(day ?? '')
}

function fmtMetric(metric: Metric, value: number, currency: string) {
  if (metric === 'spend') return fmtSpend(value, currency)
  if (metric === 'ctr') return `${value.toFixed(2).replace('.', ',')}%`
  return fmtCompact(value)
}

function fmtMoney(value: number, currency: string) {
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value)
  } catch {
    return value.toFixed(2)
  }
}

function sumMetrics(daily: ({ date?: string } & AdsMetrics)[] | undefined) {
  const out = { spend: 0, conversions: 0, clicks: 0, impressions: 0 }
  ;(daily || []).forEach((day) => {
    out.spend += Number(day.spend) || 0
    out.conversions += Number(day.conversions) || 0
    out.clicks += Number(day.clicks) || 0
    out.impressions += Number(day.impressions) || 0
  })
  return out
}

function pctDelta(cur: number, prev: number): number | null {
  if (!prev) return null
  return ((cur - prev) / prev) * 100
}

function statusView(status?: AdsNodeStatus) {
  return STATUS_META[status ?? ''] ?? {
    label: status || '—',
    cls: 'text-muted-foreground',
    dot: 'bg-muted-foreground',
  }
}

function StatusInline({ status }: { status?: AdsNodeStatus }) {
  const meta = statusView(status)
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', meta.cls)}>
      <span className={cn('size-1.5 rounded-full', meta.dot)} aria-hidden="true" />
      {meta.label}
    </span>
  )
}

function reviewView(reviewStatus?: AdsTreeCampaign['reviewStatus']) {
  return reviewStatus ? REVIEW_META[reviewStatus] : null
}

function isProductLinkAd(ad: AdsTreeAd) {
  return Boolean(ad.catalogId) && (
    String(ad.websiteType || '').toUpperCase() === 'PRODUCT_LINK'
    || String(ad.adFormat || '').toUpperCase() === 'CATALOG_CAROUSEL'
  )
}

function humanAuditAction(action: string) {
  if (AUDIT_LABELS[action]) return AUDIT_LABELS[action]
  return action
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function automationSummary(decision: AdsCampaignDecisionEntry | undefined) {
  const proposal = decision?.automation?.pendingProposal
  if (proposal) {
    const action = String(proposal.action || '').replaceAll('_', ' ')
    return {
      tone: 'warning',
      label: 'Decisão pendente',
      detail: proposal.detail || `Aguardando aprovação: ${action || 'ação sugerida'}`,
    }
  }
  const event = decision?.automation?.lastEvent
  if (event) {
    if (!event.ok) return { tone: 'error', label: 'Automação com falha', detail: event.detail || event.result || 'A última ação não foi concluída.' }
    if (event.simulated) return { tone: 'muted', label: 'Última ação simulada', detail: event.detail || event.result || 'Nenhuma alteração real foi publicada.' }
    return { tone: 'success', label: 'Automação agiu', detail: event.detail || event.result || (event.at ? timeAgo(event.at) : 'Ação concluída') }
  }
  return { tone: 'muted', label: 'Sem ação recente', detail: 'Nenhuma decisão automática recente para esta campanha.' }
}

function automationTone(tone: string) {
  if (tone === 'success') return 'text-success'
  if (tone === 'warning') return 'text-warning'
  if (tone === 'error') return 'text-error'
  return 'text-muted-foreground'
}

type Row = { day: string; spend: number; conversions: number; ctr: number; ghost?: number }

function DrawerTooltip({
  active,
  payload,
  label,
  metric,
  currency,
}: {
  active?: boolean
  payload?: { value?: number | string }[]
  label?: string
  metric: Metric
  currency: string
}) {
  if (!active || !payload?.length) return null
  const value = Number(payload[payload.length - 1]?.value ?? 0)
  return (
    <div className="rounded-lg border border-border/70 bg-background px-3 py-2 text-xs shadow-lg">
      <p className="text-muted-foreground">{fmtDay(label)}</p>
      <p className="mt-1 font-semibold tabular-nums text-foreground">{fmtMetric(metric, value, currency)}</p>
    </div>
  )
}

function InlineBudgetEditor({
  entityId,
  amount,
  type,
  adAccountId,
  currency,
  label,
  onSaved,
}: {
  entityId: string
  amount: number
  type: 'daily' | 'lifetime'
  adAccountId: string
  currency: string
  label: string
  onSaved: () => void | Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(String(amount))
  const [busy, setBusy] = useState(false)

  async function save() {
    if (busy) return
    const next = Number(value.replace(',', '.'))
    if (!Number.isFinite(next) || next < TIKTOK_MIN_BUDGET) {
      toast.error(tiktokMinimumBudgetMessage(currency))
      return
    }
    if (Math.abs(next - amount) < 0.005) {
      setEditing(false)
      return
    }
    setBusy(true)
    try {
      const result = await apiSend<{ dryRun?: boolean }>(`/api/ads/${encodeURIComponent(entityId)}`, 'PUT', {
        budget: { amount: next, type },
        adAccountId,
      })
      if (result.dryRun) toast.info('Simulação concluída', { hint: 'Modo teste: o orçamento não foi alterado.' })
      else toast.info('Orçamento enviado', { hint: 'O valor exibido será atualizado após a sincronização com o TikTok.' })
      setEditing(false)
      await onSaved()
    } catch (error) {
      toast.error('Falha ao atualizar orçamento', { hint: error instanceof Error ? error.message : undefined })
      setValue(String(amount))
    } finally {
      setBusy(false)
    }
  }

  if (!editing) {
    return (
      <button type="button" onClick={() => { setValue(String(amount)); setEditing(true) }} className="inline-flex min-h-10 items-center rounded-lg px-3 text-xs font-medium text-brand-cyan transition-colors hover:bg-brand-cyan/8">
        Ajustar orçamento
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <input
        autoFocus
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') void save()
          if (event.key === 'Escape' && !busy) setEditing(false)
        }}
        inputMode="decimal"
        aria-label={`Novo orçamento de ${label}`}
        className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 text-sm tabular-nums text-foreground outline-none transition-colors focus:border-brand-cyan/70 focus:ring-2 focus:ring-brand-cyan/10"
        disabled={busy}
      />
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => void save()} disabled={busy} className="inline-flex min-h-10 items-center rounded-lg bg-brand-cyan px-3 text-xs font-semibold text-black transition-colors hover:bg-brand-cyan/90 disabled:opacity-50">
          {busy ? <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden="true" /> : null}Salvar
        </button>
        <button type="button" onClick={() => setEditing(false)} disabled={busy} className="min-h-10 rounded-lg px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground disabled:opacity-50">
          Cancelar
        </button>
      </div>
    </div>
  )
}

function AdActions({
  ad,
  onEdit,
  onDelete,
}: {
  ad: AdsTreeAd
  onEdit: () => void
  onDelete: () => void
}) {
  const adId = ad.platformAdId || ad._id || ad.name || 'anúncio'
  const productLink = isProductLinkAd(ad)
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground" aria-label={`Ações do anúncio ${ad.name || adId}`}>
          <MoreHorizontal className="size-4" aria-hidden="true" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} className="z-[90] min-w-44 rounded-xl border border-border bg-background p-1.5 shadow-xl">
          <DropdownMenu.Item onSelect={onEdit} className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg px-3 text-xs text-foreground outline-none hover:bg-secondary/60 focus:bg-secondary/60">
            <Pencil className="size-3.5" aria-hidden="true" /> Editar anúncio
          </DropdownMenu.Item>
          {ad.creative?.linkUrl && !productLink ? (
            <DropdownMenu.Item asChild>
              <a href={ad.creative.linkUrl} target="_blank" rel="noreferrer" className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg px-3 text-xs text-foreground outline-none hover:bg-secondary/60 focus:bg-secondary/60">
                <ExternalLink className="size-3.5" aria-hidden="true" /> Abrir destino
              </a>
            </DropdownMenu.Item>
          ) : null}
          <DropdownMenu.Separator className="my-1 h-px bg-border/60" />
          <DropdownMenu.Item onSelect={onDelete} className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg px-3 text-xs text-error outline-none hover:bg-error/10 focus:bg-error/10">
            <Trash2 className="size-3.5" aria-hidden="true" /> Remover anúncio
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

export function CampaignDrawer({
  campaign,
  advertiserId,
  currency,
  onClose,
  fromDate,
  toDate,
  timeZone,
  onMutate,
  onDuplicate,
  onOpenAutomations,
}: {
  campaign: AdsTreeCampaign | null
  advertiserId: string
  currency: string
  onClose: () => void
  fromDate: string
  toDate: string
  timeZone?: string
  onMutate?: () => void | Promise<void>
  onDuplicate?: (campaign: AdsTreeCampaign) => void
  onOpenAutomations?: () => void
}) {
  const [metric, setMetric] = useState<Metric>('spend')
  const [days, setDays] = useState<number | null>(null)
  const [section, setSection] = useState<SectionKey>('overview')
  const [statusBusy, setStatusBusy] = useState(false)
  const [activationOpen, setActivationOpen] = useState(false)
  const [editAd, setEditAd] = useState<AdsTreeAd | null>(null)
  const [deleteAd, setDeleteAd] = useState<AdsTreeAd | null>(null)
  const [deleting, setDeleting] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  const id = campaign?.platformCampaignId ?? null
  const cur = useMemo(() => days ? adsDateRange(days, timeZone) : { fromDate, toDate }, [days, timeZone, fromDate, toDate])
  const prev = useMemo(() => previousAdsRange(cur), [cur])

  const { data, isLoading, error } = useAdsCampaignAnalytics(id, advertiserId, cur)
  const { data: prevData, error: prevError } = useAdsCampaignAnalytics(id, advertiserId, prev)
  const { data: decisions, mutate: mutateDecisions } = useAdsCampaignDecisions(Boolean(id), advertiserId, cur)
  const { data: audit, error: auditError, isLoading: auditLoading } = useAdsAudit(Boolean(id), {
    advertiserId,
    campaignId: id || undefined,
    limit: 80,
  })

  useModalA11y(Boolean(id), panelRef, onClose)

  if (!campaign || !id) return null

  const conf = METRICS.find((item) => item.id === metric) ?? METRICS[0]
  const ccy = campaign.currency || currency
  const decision = decisions?.byCampaign[id]
  const decisionsLoaded = Boolean(decisions)
  const realSales = decisionsLoaded ? Number(decision?.sales) || 0 : null
  const realRevenue = decisionsLoaded ? (Number(decision?.revenueCents) || 0) / 100 : null
  const realCurrencyComparable = realRevenue === 0 || !decision?.currency || decision.currency === ccy

  const daily = [...(data?.daily || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)))
  const analyticsLoaded = Boolean(data) && !isLoading && !error && !data?.backfillPending
  const prevDaily = !prevError && !prevData?.backfillPending ? prevData?.daily || [] : []
  const previousByDate = new Map(prevDaily.map((day) => [String(day.date).slice(0, 10), day]))
  const offsetDays = Math.round((Date.parse(prev.fromDate) - Date.parse(cur.fromDate)) / 864e5)
  const rows: Row[] = daily.map((day) => {
    const clicks = Number(day.clicks) || 0
    const impressions = Number(day.impressions) || 0
    const previous = day.date ? previousByDate.get(shiftAdsDay(String(day.date), offsetDays)) : undefined
    const previousClicks = Number(previous?.clicks) || 0
    const previousImpressions = Number(previous?.impressions) || 0
    const ghost = previous === undefined ? undefined : metric === 'spend'
      ? Number(previous.spend) || 0
      : metric === 'conversions'
        ? Number(previous.conversions) || 0
        : previousImpressions > 0 ? (previousClicks / previousImpressions) * 100 : 0
    return {
      day: String(day.date || '').slice(0, 10),
      spend: +(Number(day.spend) || 0).toFixed(2),
      conversions: Number(day.conversions) || 0,
      ctr: impressions > 0 ? +((clicks / impressions) * 100).toFixed(2) : 0,
      ghost,
    }
  })
  const hasGhost = rows.some((row) => row.ghost !== undefined)

  const totals = sumMetrics(daily)
  const previousTotals = sumMetrics(prevDaily)
  const ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0
  const cpm = totals.impressions > 0 ? (totals.spend / totals.impressions) * 1000 : null
  const cpc = totals.clicks > 0 ? totals.spend / totals.clicks : null
  const cpaReal = analyticsLoaded && realSales !== null && realSales > 0 ? totals.spend / realSales : null
  const roasReal = analyticsLoaded && decisionsLoaded && realCurrencyComparable && totals.spend > 0 && realRevenue !== null
    ? realRevenue / totals.spend
    : null
  const spendDelta = analyticsLoaded ? pctDelta(totals.spend, previousTotals.spend) : null

  // A API já filtra por campanha antes do LIMIT. Mantemos só o teto visual aqui.
  const timeline = (audit?.events || []).slice(0, 30)

  const automation = automationSummary(decision)
  const groups = campaign.adSets ?? []
  const ads = groups.flatMap((group) => group.ads ?? [])
  const rejectedAds = ads.filter((ad) => ad.status === 'rejected' || Boolean(ad.rejectionReason))
  const review = reviewView(campaign.reviewStatus)
  const budgetAmount = Number(campaign.budget?.amount)
  const canEditCampaignBudget = campaign.budgetOwner === 'campaign' && Number.isFinite(budgetAmount) && budgetAmount > 0
  const budgetType = campaign.budget?.type === 'lifetime' ? 'lifetime' : 'daily'

  async function refreshAfterMutation() {
    await Promise.allSettled([
      Promise.resolve(onMutate?.()),
      mutateDecisions(),
    ])
  }

  async function setCampaignStatus(next: 'active' | 'paused') {
    if (statusBusy) return false
    setStatusBusy(true)
    try {
      const result = await apiSend<CampaignStatusResult>('/api/ads/campaigns/bulk-status', 'POST', {
        campaigns: [{ platformCampaignId: id }],
        status: next,
        adAccountId: advertiserId,
      })
      const outcome = campaignStatusOutcome(result, 1)
      if (outcome === 'simulated') toast.info('Simulação concluída', { hint: 'Modo teste: a campanha não foi alterada.' })
      else if (outcome === 'accepted') toast.info(next === 'paused' ? 'Pausa solicitada' : 'Ativação solicitada', { hint: 'O status será atualizado após a sincronização com o TikTok.' })
      else throw new Error('A alteração não foi confirmada pelo backend.')
      await refreshAfterMutation()
      return true
    } catch (cause) {
      toast.error('Falha ao alterar status', { hint: cause instanceof Error ? cause.message : undefined })
      return false
    } finally {
      setStatusBusy(false)
    }
  }

  async function handleDeleteAd() {
    const adId = deleteAd?.platformAdId || deleteAd?._id
    if (!adId || deleting) return
    setDeleting(true)
    try {
      const result = await apiSend<{ ok?: boolean; dryRun?: boolean; simulated?: boolean }>(
        `/api/ads/${encodeURIComponent(adId)}`,
        'DELETE',
        { adAccountId: advertiserId },
      )
      setDeleteAd(null)
      if (result.dryRun || result.simulated) toast.info('Simulação concluída', { hint: 'Modo teste: o anúncio não foi excluído do TikTok.' })
      else toast.success('Anúncio excluído')
      await refreshAfterMutation()
    } catch (cause) {
      toast.error('Falha ao excluir anúncio', { hint: cause instanceof Error ? cause.message : undefined })
    } finally {
      setDeleting(false)
    }
  }

  function copyCampaignId() {
    if (!id) return
    void navigator.clipboard?.writeText(id)
    toast.success('ID da campanha copiado')
  }

  const sectionTab = (key: SectionKey, label: string) => (
    <button
      type="button"
      onClick={() => setSection(key)}
      aria-current={section === key ? 'page' : undefined}
      className={cn(
        'relative min-h-10 px-1 text-sm font-medium transition-colors after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full',
        section === key ? 'text-brand-cyan after:bg-brand-cyan' : 'text-muted-foreground after:bg-transparent hover:text-foreground',
      )}
    >
      {label}
    </button>
  )

  const primaryMetrics = [
    {
      label: 'Gasto TikTok',
      value: analyticsLoaded ? fmtSpend(totals.spend, ccy) : '—',
      detail: spendDelta !== null ? `${spendDelta >= 0 ? '+' : ''}${spendDelta.toFixed(1).replace('.', ',')}% vs. período anterior` : 'Métrica da plataforma',
      valueClass: 'text-foreground',
    },
    {
      label: 'Vendas reais',
      value: realSales !== null ? fmtCompact(realSales) : '—',
      detail: 'Conversões first-party do ROI-NADOS',
      valueClass: 'text-foreground',
    },
    {
      label: 'CPA real',
      value: cpaReal !== null ? fmtSpend(cpaReal, ccy) : '—',
      detail: 'Gasto TikTok ÷ vendas reais',
      valueClass: 'text-foreground',
    },
    {
      label: 'ROAS real',
      value: roasReal !== null ? `${roasReal.toFixed(2)}×` : '—',
      detail: realCurrencyComparable ? 'Receita real ÷ gasto TikTok' : 'Moedas diferentes no período',
      valueClass: roasReal !== null && roasReal >= 2 ? 'text-success' : roasReal !== null && roasReal < 1 ? 'text-warning' : 'text-foreground',
    },
  ]

  const secondaryMetrics = [
    { label: 'Receita real', value: realRevenue !== null ? fmtMoney(realRevenue, decision?.currency || ccy) : '—', source: 'ROI-NADOS' },
    { label: 'Conversões TikTok', value: analyticsLoaded ? fmtCompact(totals.conversions) : '—', source: 'TikTok' },
    { label: 'CPM', value: analyticsLoaded && cpm !== null ? fmtSpend(cpm, ccy) : '—', source: 'TikTok' },
    { label: 'CPC', value: analyticsLoaded && cpc !== null ? fmtSpend(cpc, ccy) : '—', source: 'TikTok' },
    { label: 'Cliques', value: analyticsLoaded ? fmtCompact(totals.clicks) : '—', source: 'TikTok' },
    { label: 'CTR', value: analyticsLoaded ? `${ctr.toFixed(2).replace('.', ',')}%` : '—', source: 'TikTok' },
    { label: 'Impressões', value: analyticsLoaded ? fmtCompact(totals.impressions) : '—', source: 'TikTok' },
  ]

  return (
    <>
      <DialogPortal>
        <div className="ads-dialog fixed inset-0 z-50">
          <button type="button" aria-label="Fechar painel" onClick={onClose} className="absolute inset-0 bg-black/55 backdrop-blur-[3px]" />
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Central da campanha"
            tabIndex={-1}
            className="anim-drawer-in absolute inset-y-0 right-0 flex w-full max-w-[980px] flex-col overflow-hidden border-l border-border/60 bg-background/98 shadow-2xl outline-none"
          >
            <header className="shrink-0 border-b border-border/60 bg-background/96 px-5 py-4 sm:px-6">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="max-w-3xl truncate text-lg font-semibold tracking-tight text-foreground">{campaign.campaignName || 'Campanha sem nome'}</h2>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <StatusInline status={campaign.status} />
                    {campaign.campaignKind === 'smart_plus' ? <><span aria-hidden="true">·</span><span>Smart+</span></> : null}
                    {review ? <><span aria-hidden="true">·</span><span className={review.cls}>{review.label}</span></> : null}
                    {campaign.platformAdAccountName || advertiserId ? <><span aria-hidden="true">·</span><span>{campaign.platformAdAccountName || advertiserId}</span></> : null}
                  </div>
                </div>
                <button type="button" onClick={onClose} className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground" aria-label="Fechar">
                  <X className="size-4" aria-hidden="true" />
                </button>
              </div>

              <div className="mt-4 flex flex-col gap-3 border-t border-border/45 pt-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-center gap-5 overflow-x-auto" role="tablist" aria-label="Seções da Central da campanha">
                  {sectionTab('overview', 'Resultado')}
                  {sectionTab('structure', 'Estrutura')}
                  {sectionTab('history', 'Histórico')}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {['active', 'paused'].includes(String(campaign.status)) ? (
                    campaign.status === 'active' ? (
                      <button type="button" className="btn-secondary min-h-10 text-xs" onClick={() => void setCampaignStatus('paused')} disabled={statusBusy}>
                        {statusBusy ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Pause className="size-3.5" aria-hidden="true" />} Pausar
                      </button>
                    ) : (
                      <button type="button" className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-brand-cyan px-3 text-xs font-semibold text-black transition-colors hover:bg-brand-cyan/90 disabled:opacity-50" onClick={() => setActivationOpen(true)} disabled={statusBusy}>
                        <Play className="size-3.5" aria-hidden="true" /> Ativar
                      </button>
                    )
                  ) : null}
                  {onDuplicate ? <button type="button" className="btn-secondary min-h-10 text-xs" onClick={() => onDuplicate(campaign)}><Copy className="size-3.5" aria-hidden="true" /> Duplicar</button> : null}
                  {onOpenAutomations ? <button type="button" className="btn-secondary min-h-10 text-xs" onClick={onOpenAutomations}>Automações</button> : null}
                  <button type="button" className="btn-ghost min-h-10 px-3 text-xs" onClick={copyCampaignId}>Copiar ID</button>
                </div>
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
              {section === 'overview' ? (
                <div className="flex flex-col gap-6">
                  <section aria-label="Indicadores principais" className="grid gap-x-5 gap-y-4 border-b border-border/50 pb-5 sm:grid-cols-2 xl:grid-cols-4">
                    {primaryMetrics.map((item) => (
                      <div key={item.label} className="min-w-0">
                        <p className="text-xs font-medium text-muted-foreground">{item.label}</p>
                        <p className={cn('mt-1 text-xl font-semibold tabular-nums', item.valueClass)}>{item.value}</p>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.detail}</p>
                      </div>
                    ))}
                  </section>

                  <section className="border-b border-border/50 pb-6">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-foreground">Performance no período</h3>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">O gráfico usa métricas do TikTok. Vendas, CPA e ROAS acima usam a atribuição real do ROI-NADOS.</p>
                        <p className="mt-1 text-xs text-muted-foreground">{fmtDay(cur.fromDate)} a {fmtDay(cur.toDate)}{timeZone ? ` · ${timeZone}` : ''}</p>
                      </div>
                      <div className="flex flex-col gap-3 sm:items-end">
                        <div className="flex flex-wrap gap-4" role="group" aria-label="Período do gráfico">
                          <button type="button" onClick={() => setDays(null)} className={cn('min-h-10 border-b-2 px-1 text-xs font-medium', days === null ? 'border-brand-cyan text-brand-cyan' : 'border-transparent text-muted-foreground hover:text-foreground')}>Selecionado</button>
                          {RANGES.map((range) => <button key={range.days} type="button" onClick={() => setDays(range.days)} className={cn('min-h-10 border-b-2 px-1 text-xs font-medium', days === range.days ? 'border-brand-cyan text-brand-cyan' : 'border-transparent text-muted-foreground hover:text-foreground')}>{range.label}</button>)}
                        </div>
                        <div className="flex flex-wrap gap-4" role="group" aria-label="Métrica do gráfico">
                          {METRICS.map((option) => <button key={option.id} type="button" onClick={() => setMetric(option.id)} className={cn('min-h-10 border-b-2 px-1 text-xs font-medium', metric === option.id ? 'border-brand-cyan text-brand-cyan' : 'border-transparent text-muted-foreground hover:text-foreground')}>{option.label}</button>)}
                        </div>
                      </div>
                    </div>

                    {prevError ? <p className="mt-3 text-xs text-warning">Comparação anterior indisponível.</p> : null}
                    {isLoading && !data ? (
                      <Skeleton className="mt-4 h-64 rounded-xl" />
                    ) : error ? (
                      <p role="alert" className="mt-4 border-l-2 border-warning pl-3 text-xs leading-relaxed text-warning">{error instanceof Error ? error.message : 'Erro ao carregar as métricas.'}</p>
                    ) : rows.length === 0 ? (
                      <div className="mt-4 flex h-56 items-center justify-center border-y border-border/45 text-sm text-muted-foreground">{data?.backfillPending ? 'Coletando métricas do TikTok…' : 'Sem dados diários no período.'}</div>
                    ) : (
                      <div className="mt-4 h-64">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                            <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
                            <XAxis dataKey="day" tickFormatter={fmtDay} tick={{ fill: '#a1a1aa', fontSize: 12 }} axisLine={false} tickLine={false} />
                            <YAxis tick={{ fill: '#a1a1aa', fontSize: 12 }} axisLine={false} tickLine={false} width={48} tickFormatter={(value: number) => fmtCompact(value)} />
                            <Tooltip cursor={{ stroke: 'rgba(37,244,238,0.25)', strokeDasharray: '4 4' }} content={<DrawerTooltip metric={metric} currency={ccy} />} />
                            {hasGhost ? <Line type="monotone" dataKey="ghost" name="Período anterior" stroke="rgba(161,161,170,0.45)" strokeWidth={1.5} strokeDasharray="5 4" dot={false} activeDot={false} isAnimationActive={false} /> : null}
                            <Line type="monotone" dataKey={metric} name={conf.label} stroke={conf.color} strokeWidth={2} dot={false} isAnimationActive={false} activeDot={{ r: 4, strokeWidth: 0, fill: conf.color }} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </section>

                  <section className="border-b border-border/50 pb-6">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">Métricas secundárias</h3>
                      <p className="mt-1 text-xs text-muted-foreground">A origem de cada dado continua explícita para não misturar TikTok com atribuição first-party.</p>
                    </div>
                    <div className="mt-4 grid gap-x-5 sm:grid-cols-2 lg:grid-cols-4">
                      {secondaryMetrics.map((item) => (
                        <div key={item.label} className="border-t border-border/45 py-3">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs text-muted-foreground">{item.label}</p>
                            <span className="text-xs text-muted-foreground">{item.source}</span>
                          </div>
                          <p className="mt-1 text-base font-semibold tabular-nums text-foreground">{item.value}</p>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="grid gap-6 lg:grid-cols-3">
                    <div className="border-t border-border/45 pt-4">
                      <h3 className="text-sm font-semibold text-foreground">Automação</h3>
                      <p className={cn('mt-2 text-xs font-medium', automationTone(automation.tone))}>{automation.label}</p>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{automation.detail}</p>
                      {onOpenAutomations ? <button type="button" className="mt-3 inline-flex min-h-10 items-center rounded-lg px-3 text-xs font-medium text-brand-cyan transition-colors hover:bg-brand-cyan/8" onClick={onOpenAutomations}>Ver regras e decisões</button> : null}
                    </div>

                    <div className="border-t border-border/45 pt-4">
                      <h3 className="text-sm font-semibold text-foreground">Orçamento</h3>
                      <p className="mt-2 text-base font-semibold tabular-nums text-foreground">{canEditCampaignBudget ? `${fmtMoney(budgetAmount, ccy)}/${budgetType === 'lifetime' ? 'total' : 'dia'}` : 'Nos conjuntos'}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{campaign.budgetOwner === 'campaign' ? 'CBO · controlado no nível da campanha.' : 'ABO · cada conjunto controla o próprio orçamento.'}</p>
                      {canEditCampaignBudget ? (
                        <div className="mt-3">
                          <InlineBudgetEditor entityId={id} amount={budgetAmount} type={budgetType} adAccountId={advertiserId} currency={ccy} label="Orçamento da campanha" onSaved={refreshAfterMutation} />
                          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">A alteração é enviada ao TikTok. O valor exibido será atualizado após a sincronização.</p>
                        </div>
                      ) : null}
                    </div>

                    <div className="border-t border-border/45 pt-4">
                      <h3 className="text-sm font-semibold text-foreground">Estrutura</h3>
                      <p className="mt-2 text-base font-semibold text-foreground">{campaign.adSetCount ?? groups.length} {(campaign.adSetCount ?? groups.length) === 1 ? 'conjunto' : 'conjuntos'} · {campaign.adCount ?? ads.length} {(campaign.adCount ?? ads.length) === 1 ? 'anúncio' : 'anúncios'}{rejectedAds.length > 0 ? ` · ${rejectedAds.length} reprovado${rejectedAds.length === 1 ? '' : 's'}` : ''}</p>
                      <p className="mt-1 text-xs text-muted-foreground">Abra a estrutura para revisar criativos, orçamento por conjunto e ações de cada anúncio.</p>
                      <button type="button" className="mt-3 inline-flex min-h-10 items-center rounded-lg px-3 text-xs font-medium text-brand-cyan transition-colors hover:bg-brand-cyan/8" onClick={() => setSection('structure')}>Abrir estrutura</button>
                    </div>
                  </section>
                </div>
              ) : null}

              {section === 'structure' ? (
                <div className="flex flex-col gap-5">
                  <div>
                    <h3 className="text-base font-semibold text-foreground">Campanha → conjuntos → anúncios</h3>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Edite cada configuração no nível em que ela realmente é controlada. CBO fica na campanha; ABO fica nos conjuntos.</p>
                  </div>

                  {groups.length === 0 ? (
                    <p className="border-y border-border/45 py-8 text-center text-sm text-muted-foreground">Nenhum conjunto de anúncios carregado para esta campanha.</p>
                  ) : (
                    <div className="divide-y divide-border/50 border-y border-border/50">
                      {groups.map((group, groupIndex) => {
                        const groupAds = group.ads ?? []
                        return (
                          <section key={group.platformAdSetId || groupIndex} className="py-5">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-foreground">{group.adSetName || group.name || `Conjunto ${groupIndex + 1}`}</p>
                                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                                  <StatusInline status={group.status} />
                                  <span aria-hidden="true">·</span>
                                  <span>{groupAds.length} {groupAds.length === 1 ? 'anúncio' : 'anúncios'}</span>
                                  {campaign.budgetOwner === 'campaign' ? <><span aria-hidden="true">·</span><span>Orçamento controlado pela campanha</span></> : null}
                                </div>
                              </div>
                              {campaign.budgetOwner !== 'campaign' && group.platformAdSetId && group.budget?.amount != null ? (
                                <div className="sm:text-right">
                                  <p className="text-xs text-muted-foreground">Orçamento do conjunto</p>
                                  <p className="mt-1 text-sm font-semibold tabular-nums text-foreground">{fmtMoney(Number(group.budget.amount), ccy)}/{group.budget.type === 'lifetime' ? 'total' : 'dia'}</p>
                                  <div className="mt-1 sm:flex sm:justify-end">
                                    <InlineBudgetEditor entityId={group.platformAdSetId} amount={Number(group.budget.amount)} type={group.budget.type === 'lifetime' ? 'lifetime' : 'daily'} adAccountId={advertiserId} currency={ccy} label="Orçamento do conjunto" onSaved={refreshAfterMutation} />
                                  </div>
                                </div>
                              ) : null}
                            </div>

                            {groupAds.length === 0 ? (
                              <p className="mt-4 text-xs text-muted-foreground">Nenhum anúncio neste conjunto.</p>
                            ) : (
                              <div className="mt-4 grid gap-3 md:grid-cols-2">
                                {groupAds.map((ad, adIndex) => {
                                  const adId = ad.platformAdId || ad._id || String(adIndex)
                                  const videoUrl = /^https:\/\//i.test(ad.creative?.videoUrl || '') ? ad.creative?.videoUrl : ''
                                  const productLink = isProductLinkAd(ad)
                                  return (
                                    <article key={adId} className="rounded-xl border border-border/55 bg-background/35 p-3.5">
                                      <div className="flex items-start gap-3">
                                        {(ad.creative?.imageUrl || videoUrl) ? (
                                          <div className="h-24 w-32 shrink-0 overflow-hidden rounded-lg border border-border/50 bg-black">
                                            {videoUrl ? (
                                              <video src={videoUrl} poster={ad.creative?.imageUrl} controls muted playsInline preload="metadata" className="h-full w-full object-cover" aria-label={`Prévia do anúncio ${ad.name || adId}`} />
                                            ) : (
                                              // eslint-disable-next-line @next/next/no-img-element
                                              <img src={ad.creative?.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                                            )}
                                          </div>
                                        ) : null}
                                        <div className="min-w-0 flex-1">
                                          <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0">
                                              <p className="truncate text-sm font-semibold text-foreground">{ad.name || `Anúncio ${adIndex + 1}`}</p>
                                              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                                                <StatusInline status={ad.status} />
                                                {ad.adType === 'boost' ? <><span aria-hidden="true">·</span><span>Spark</span></> : null}
                                              </div>
                                            </div>
                                            <AdActions ad={ad} onEdit={() => setEditAd(ad)} onDelete={() => setDeleteAd(ad)} />
                                          </div>

                                          {ad.creative?.body ? <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{ad.creative.body}</p> : null}
                                          <p className="mt-2 text-xs tabular-nums text-muted-foreground">{ad.metrics?.spend == null ? '—' : fmtMoney(Number(ad.metrics.spend), ccy)} · {ad.metrics?.impressions == null ? '—' : fmtCompact(Number(ad.metrics.impressions))} impr.</p>
                                          {productLink ? <p className="mt-2 text-xs text-muted-foreground">Destino definido pelos produtos do catálogo.</p> : ad.creative?.linkUrl ? <a href={ad.creative.linkUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex min-h-10 items-center gap-1.5 text-xs font-medium text-brand-cyan hover:underline">Abrir destino <ExternalLink className="size-3.5" aria-hidden="true" /></a> : null}
                                        </div>
                                      </div>

                                      {ad.rejectionReason ? (
                                        <div className="mt-3 border-t border-error/20 pt-3">
                                          <p className="text-xs font-semibold text-error">Reprovado pelo TikTok</p>
                                          <p className="mt-1 text-xs leading-relaxed text-error/90">{ad.rejectionReason}</p>
                                        </div>
                                      ) : null}
                                    </article>
                                  )
                                })}
                              </div>
                            )}
                          </section>
                        )
                      })}
                    </div>
                  )}
                </div>
              ) : null}

              {section === 'history' ? (
                <div className="flex flex-col gap-4">
                  <div>
                    <h3 className="text-base font-semibold text-foreground">Histórico operacional</h3>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Mudanças manuais, decisões da automação e eventos registrados para esta campanha.</p>
                  </div>
                  {auditError ? (
                    <p role="alert" className="border-l-2 border-warning pl-3 text-xs text-warning">Não foi possível carregar o histórico.</p>
                  ) : auditLoading ? (
                    <p className="text-xs text-muted-foreground">Carregando histórico…</p>
                  ) : timeline.length ? (
                    <ol className="relative ml-2 border-l border-border pl-5">
                      {timeline.map((event) => (
                        <li key={event.id} className="relative pb-5 last:pb-0">
                          <span className="absolute -left-[1.47rem] top-1.5 size-2 rounded-full bg-brand-cyan" aria-hidden="true" />
                          <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-foreground">{event.reason || humanAuditAction(event.action)}</p>
                              {event.reason ? <p className="mt-1 text-xs text-muted-foreground">{humanAuditAction(event.action)}</p> : null}
                            </div>
                            <time className="shrink-0 text-xs text-muted-foreground">{new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', ...(timeZone ? { timeZone } : {}) }).format(new Date(event.created_at))}</time>
                          </div>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="text-xs text-muted-foreground">Ainda não há alterações registradas para esta campanha.</p>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </DialogPortal>

      <ConfirmDialog
        open={activationOpen}
        title="Ativar esta campanha?"
        description={<><strong>{campaign.campaignName || id}</strong><br />Conta: {campaign.platformAdAccountName || advertiserId}<br />Orçamento: {canEditCampaignBudget ? `${fmtMoney(budgetAmount, ccy)}/${budgetType === 'lifetime' ? 'total' : 'dia'} · CBO` : 'Definido nos conjuntos · ABO'}<br />Ao ativar, a campanha poderá começar a gastar.</>}
        confirmLabel="Ativar"
        tone="default"
        appearance="quiet"
        busy={statusBusy}
        onConfirm={async () => { if (await setCampaignStatus('active')) setActivationOpen(false) }}
        onClose={() => setActivationOpen(false)}
      />

      <ConfirmDialog
        open={Boolean(deleteAd)}
        title="Excluir este anúncio?"
        description={<>O anúncio <strong>{deleteAd?.name || deleteAd?.platformAdId}</strong> será removido do TikTok Ads. Essa ação não pode ser desfeita.</>}
        confirmLabel="Excluir anúncio"
        appearance="quiet"
        busy={deleting}
        onConfirm={handleDeleteAd}
        onClose={() => setDeleteAd(null)}
      />

      <AdEditDialog
        key={`${advertiserId}:${editAd?.platformAdId || editAd?._id || 'closed'}`}
        ad={editAd}
        adAccountId={advertiserId}
        onClose={() => setEditAd(null)}
        onSaved={() => { void refreshAfterMutation() }}
      />
    </>
  )
}
