'use client'

// Árvore de campanhas do TikTok Ads — campanha → ad group → ad, com métricas
// por nível, filtros de status, ordenação, paginação e ações rápidas
// (pausar/ativar, duplicar, excluir anúncio). Segue o padrão visual das
// tabelas do dashboard; a expansão funciona como estrutura rápida e touch-friendly.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  ChevronRight,
  ChevronDown,
  Play,
  Pause,
  Copy,
  Trash2,
  Loader2,
  Layers,
  ExternalLink,
  AlertTriangle,
  BadgeCheck,
  BarChart3,
  Pencil,
  Check,
  X,
  Search,
  SlidersHorizontal,
  DollarSign,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  MoreHorizontal,
  RotateCcw,
  TrendingUp,
  Zap,
  AlertCircle,
} from 'lucide-react'
import { campaignMatchesStatus, campaignStatusCounts } from '@/lib/campaign-list'
import { apiSend } from '@/lib/api'
import { toast } from '@/lib/toast'
import type { AdsTreeResponse, AdsTreeCampaign, AdsTreeAd, AdsTreeAdSet, AdsNodeStatus, AdsCampaignDecisionsResponse, AdsCampaignDecisionEntry } from '@/lib/types'
import { Skeleton } from '@/components/skeleton'
import { ErrorState } from '@/components/error-state'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { AdEditDialog } from './ad-edit-dialog'
import { TIKTOK_MIN_BUDGET, tiktokMinimumBudgetMessage } from './tiktok-contracts'
import { fmtCompact, cleanCampaignName, timeAgo } from '@/lib/format'
import { Modal } from '@/components/ui/modal'
import { campaignMetrics, campaignBudget, campaignStatusOutcome, type CampaignStatusResult } from '@/lib/campaign-metrics'
import { actionFeedback } from '@/lib/action-feedback'
import { cn } from '@/lib/utils'

function fmtMoney(v: number | undefined, currency: string): string {
  if (v == null) return '—'
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency, maximumFractionDigits: 2 }).format(v)
  } catch {
    return v.toFixed(2)
  }
}

type BulkBudgetMode = 'percent_up' | 'percent_down' | 'fixed'

function adjustedBudgetAmount(currentAmount: number, mode: BulkBudgetMode, value: number) {
  if (mode === 'percent_up') return Math.round(currentAmount * (1 + value / 100))
  if (mode === 'percent_down') return Math.max(TIKTOK_MIN_BUDGET, Math.round(currentAmount * (1 - value / 100)))
  return Math.max(TIKTOK_MIN_BUDGET, value)
}

function budgetSummary(campaigns: AdsTreeCampaign[], currency: string) {
  let dailyCount = 0
  let dailyTotal = 0
  let lifetimeCount = 0
  let lifetimeTotal = 0
  let adSetOwned = 0
  let unavailable = 0

  for (const campaign of campaigns) {
    if (campaign.budgetOwner !== 'campaign') {
      adSetOwned++
      continue
    }
    const amount = Number(campaign.budget?.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      unavailable++
      continue
    }
    if (campaign.budget?.type === 'lifetime') {
      lifetimeCount++
      lifetimeTotal += amount
    } else if (campaign.budget?.type === 'daily') {
      dailyCount++
      dailyTotal += amount
    } else {
      unavailable++
    }
  }

  const parts: string[] = []
  if (dailyCount) parts.push(`${dailyCount} ${dailyCount === 1 ? 'diária' : 'diárias'} · ${fmtMoney(dailyTotal, currency)}/dia`)
  if (lifetimeCount) parts.push(`${lifetimeCount} ${lifetimeCount === 1 ? 'total' : 'totais'} · ${fmtMoney(lifetimeTotal, currency)}/total`)
  if (adSetOwned) parts.push(`${adSetOwned} ${adSetOwned === 1 ? 'ABO nos conjuntos' : 'ABO nos conjuntos'}`)
  if (unavailable) parts.push(`${unavailable} sem orçamento comparável`)
  return parts
}

function budgetImpactSummary(campaigns: AdsTreeCampaign[], mode: BulkBudgetMode, value: number, currency: string) {
  if (!Number.isFinite(value) || value <= 0) return []
  const buckets = {
    daily: { count: 0, before: 0, after: 0 },
    lifetime: { count: 0, before: 0, after: 0 },
  }

  for (const campaign of campaigns) {
    if (campaign.budgetOwner !== 'campaign') continue
    const current = Number(campaign.budget?.amount)
    const type = campaign.budget?.type
    if (!Number.isFinite(current) || current <= 0 || (type !== 'daily' && type !== 'lifetime')) continue
    const next = adjustedBudgetAmount(current, mode, value)
    const bucket = buckets[type]
    bucket.count++
    bucket.before += current
    bucket.after += next
  }

  const parts: { label: string; before: string; after: string; delta: number }[] = []
  if (buckets.daily.count) {
    parts.push({
      label: `${buckets.daily.count} orçamento${buckets.daily.count === 1 ? '' : 's'} diário${buckets.daily.count === 1 ? '' : 's'}`,
      before: `${fmtMoney(buckets.daily.before, currency)}/dia`,
      after: `${fmtMoney(buckets.daily.after, currency)}/dia`,
      delta: buckets.daily.after - buckets.daily.before,
    })
  }
  if (buckets.lifetime.count) {
    parts.push({
      label: `${buckets.lifetime.count} ${buckets.lifetime.count === 1 ? 'orçamento total' : 'orçamentos totais'}`,
      before: `${fmtMoney(buckets.lifetime.before, currency)}/total`,
      after: `${fmtMoney(buckets.lifetime.after, currency)}/total`,
      delta: buckets.lifetime.after - buckets.lifetime.before,
    })
  }
  return parts
}


type CampaignAutomationView = {
  label: string
  detail: string
  tone: 'success' | 'warning' | 'error' | 'primary' | 'muted'
  actionable: boolean
}

const AUTOMATION_ACTION = {
  pause: { proposal: 'Sugere pausar', done: 'Pausou' },
  budget_down: { proposal: 'Sugere reduzir', done: 'Reduziu orçamento' },
  budget_up: { proposal: 'Sugere escalar', done: 'Escalou orçamento' },
  activate: { proposal: 'Sugere ativar', done: 'Ativou' },
} as const

function campaignAutomationView(
  decisions: AdsCampaignDecisionsResponse | undefined,
  decision: AdsCampaignDecisionEntry | undefined,
): CampaignAutomationView {
  if (!decisions) return { label: 'Carregando…', detail: 'Automação', tone: 'muted', actionable: false }

  const proposal = decision?.automation.pendingProposal
  if (proposal) {
    const action = AUTOMATION_ACTION[proposal.action as keyof typeof AUTOMATION_ACTION]
    return {
      label: action?.proposal || 'Decisão pendente',
      detail: proposal.detail ? proposal.detail : proposal.createdAt ? `Proposta ${timeAgo(proposal.createdAt)}` : 'Aguardando sua aprovação',
      tone: 'warning',
      actionable: true,
    }
  }

  const event = decision?.automation.lastEvent
  if (event) {
    const action = AUTOMATION_ACTION[event.action as keyof typeof AUTOMATION_ACTION]
    if (!event.ok) {
      return {
        label: 'Ação falhou',
        detail: event.at ? timeAgo(event.at) : 'Ver automações',
        tone: 'error',
        actionable: true,
      }
    }
    if (event.simulated) {
      return {
        label: action ? `Simulou: ${action.done.toLowerCase()}` : 'Simulação concluída',
        detail: event.at ? timeAgo(event.at) : 'Modo teste',
        tone: 'muted',
        actionable: false,
      }
    }
    if (event.proposed) {
      return {
        label: action?.proposal || 'Proposta criada',
        detail: event.at ? timeAgo(event.at) : 'Aguardando decisão',
        tone: 'warning',
        actionable: true,
      }
    }
    return {
      label: action?.done || 'Automação agiu',
      detail: event.result ? `${event.result}${event.at ? ` · ${timeAgo(event.at)}` : ''}` : event.at ? timeAgo(event.at) : 'Ação registrada',
      tone: 'success',
      actionable: false,
    }
  }

  const engine = decisions.automation
  if (engine.actionsPaused || engine.state === 'blocked' || engine.state === 'paused') {
    return { label: 'Automação pausada', detail: 'Ver proteção', tone: 'error', actionable: true }
  }
  if (engine.state === 'degraded') {
    return { label: 'Automação com atenção', detail: 'Ver diagnóstico', tone: 'warning', actionable: true }
  }
  if (engine.rulesEnabled > 0) {
    return {
      label: 'Monitorando',
      detail: engine.autonomy === 'auto' ? 'Pode agir sozinha' : engine.autonomy === 'propose' ? 'Pede aprovação' : 'Regras ativas',
      tone: 'primary',
      actionable: false,
    }
  }
  if (engine.autonomy === 'notify' || engine.alertsEnabled) {
    return { label: 'Só avisar', detail: 'Sem ações automáticas', tone: 'muted', actionable: false }
  }
  return { label: 'Sem automação', detail: 'Nenhuma regra ativa', tone: 'muted', actionable: true }
}

function automationToneClass(tone: CampaignAutomationView['tone']) {
  if (tone === 'success') return 'text-success'
  if (tone === 'warning') return 'text-warning'
  if (tone === 'error') return 'text-error'
  if (tone === 'primary') return 'text-brand-cyan'
  return 'text-muted-foreground'
}

// ── Status → cor/rótulo ──
const STATUS_META: Record<string, { label: string; cls: string; dot: string }> = {
  active: { label: 'Ativa', cls: 'text-success', dot: 'bg-[color:var(--success)]' },
  paused: { label: 'Pausada', cls: 'text-muted-foreground', dot: 'bg-muted-foreground' },
  pending_review: { label: 'Em revisão', cls: 'text-warning', dot: 'bg-[color:var(--warning)]' },
  rejected: { label: 'Rejeitado', cls: 'text-error', dot: 'bg-[color:var(--error)]' },
  error: { label: 'Erro', cls: 'text-error', dot: 'bg-[color:var(--error)]' },
  completed: { label: 'Concluída', cls: 'text-muted-foreground', dot: 'bg-muted-foreground' },
  cancelled: { label: 'Cancelada', cls: 'text-muted-foreground', dot: 'bg-muted-foreground' },
}

export function StatusPill({ status }: { status?: AdsNodeStatus }) {
  const meta = STATUS_META[status ?? ''] ?? {
    label: status || '—',
    cls: 'text-muted-foreground',
    dot: 'bg-muted-foreground',
  }
  
  let bgClass = 'bg-white/5 border-white/5'
  if (status === 'active') bgClass = 'bg-success/10 border-success/20 text-success'
  else if (status === 'pending_review') bgClass = 'bg-warning/10 border-warning/20 text-warning'
  else if (status === 'rejected' || status === 'error') bgClass = 'bg-error/10 border-error/20 text-error'
  else bgClass = 'bg-muted/10 border-white/5 text-muted-foreground'

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${bgClass}`}>
      <span className={`size-1.5 rounded-full ${meta.dot}`} aria-hidden="true" />
      {meta.label}
    </span>
  )
}


function StatusInline({ status }: { status?: AdsNodeStatus }) {
  const meta = STATUS_META[status ?? ''] ?? {
    label: status || '—',
    cls: 'text-muted-foreground',
    dot: 'bg-muted-foreground',
  }
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', meta.cls)}>
      <span className={cn('size-1.5 rounded-full', meta.dot)} aria-hidden="true" />
      {meta.label}
    </span>
  )
}

function sourceWeightedCtr(items: Array<{ metrics?: AdsTreeAd['metrics'] }>) {
  const impressions = items.reduce((sum, item) => sum + Number(item.metrics?.impressions || 0), 0)
  if (!impressions) return 0
  const clicks = items.reduce((sum, item) => sum + Number(item.metrics?.clicks || 0), 0)
  return clicks > 0 ? (clicks / impressions) * 100 : items.reduce((sum, item) => sum + Number(item.metrics?.ctr || 0) * Number(item.metrics?.impressions || 0), 0) / impressions
}

function creativeSignal(ad: AdsTreeAd) {
  const impressions = Number(ad.metrics?.impressions || 0)
  const spend = Number(ad.metrics?.spend || 0)
  const conversions = Number(ad.metrics?.conversions || 0)
  const ctr = Number(ad.metrics?.ctr || 0)
  // Não chama isto de "fadiga": sem série temporal não existe evidência para
  // essa conclusão. O sinal é deliberadamente conservador e auditável.
  if (impressions < 1000) return { label: 'Aprendendo', cls: 'text-muted-foreground', title: 'Menos de 1.000 impressões no período' }
  if (conversions > 0) return { label: 'Convertendo', cls: 'text-success', title: `${conversions} conversão(ões) no período` }
  if (spend > 0 && ctr < 0.5) return { label: 'Atenção', cls: 'text-warning', title: 'Há gasto, nenhuma conversão e CTR abaixo de 0,5% no período' }
  return { label: 'Observando', cls: 'text-primary', title: 'Volume suficiente para acompanhamento; sem diagnóstico forte' }
}

export function CampaignActivationToggle({
  status,
  busy,
  disabled,
  onToggle,
  name,
  entityLabel = 'campanha',
}: {
  status?: AdsNodeStatus
  busy?: boolean
  disabled?: boolean
  onToggle: () => void
  name?: string
  entityLabel?: string
}) {
  const isActive = status === 'active'
  const isPaused = status === 'paused'

  if (!isActive && !isPaused) {
    const meta = STATUS_META[status ?? ''] ?? { label: status || '—', cls: 'text-muted-foreground', dot: 'bg-muted-foreground' }
    return <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', meta.cls)}><span className={cn('size-1.5 rounded-full', meta.dot)} aria-hidden="true" />{meta.label}</span>
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isActive}
      disabled={disabled || busy}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      title={isActive ? `${entityLabel} ativo — Clique para pausar` : `${entityLabel} pausado — Clique para ativar`}
      aria-label={`${isActive ? 'Pausar' : 'Ativar'} ${entityLabel} ${name || ''}`}
      className={`group relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${
        isActive
          ? 'bg-emerald-500'
          : 'bg-muted-foreground/30 hover:bg-muted-foreground/45'
      }`}
    >
      <span
        className={`pointer-events-none absolute left-0.5 top-1/2 -translate-y-1/2 flex size-4 items-center justify-center rounded-full bg-white shadow-xs transition-transform duration-200 ${
          isActive ? 'translate-x-4' : 'translate-x-0'
        }`}
      >
        {busy ? (
          <Loader2 className="size-2.5 animate-spin text-muted-foreground" />
        ) : isActive ? (
          <span className="size-1.5 rounded-full bg-emerald-600" />
        ) : (
          <span className="size-1.5 rounded-full bg-muted-foreground/60" />
        )}
      </span>
    </button>
  )
}

export function CampaignQuickActionsDropdown({
  campaign,
  currency,
  busy,
  disabled,
  isOpen,
  onToggleExpand,
  onDuplicate,
  onOpenDetail,
  onToggleStatus,
}: {
  campaign: AdsTreeCampaign
  currency: string
  busy?: boolean
  disabled?: boolean
  isOpen?: boolean
  onToggleExpand?: () => void
  onDuplicate?: (c: AdsTreeCampaign) => void
  onOpenDetail?: (c: AdsTreeCampaign) => void
  onToggleStatus?: () => void
}) {
  const c = campaign
  const id = c.platformCampaignId
  const isActive = c.status === 'active'
  const isPaused = c.status === 'paused'

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className="flex size-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
          aria-label={`Ações rápidas da campanha ${c.campaignName || id}`}
          title="Ações rápidas e status"
        >
          <MoreHorizontal className="size-4" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 min-w-52 rounded-lg border border-border bg-background p-1.5 text-xs shadow-lg"
        >
          {/* Toggle status action */}
          {(isActive || isPaused) && onToggleStatus && (
            <DropdownMenu.Item
              className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-foreground outline-none data-[highlighted]:bg-secondary transition-colors"
              onSelect={() => onToggleStatus()}
              disabled={disabled || busy}
            >
              {isActive ? (
                <>
                  <Pause className="size-3.5 text-warning" />
                  <span>Pausar campanha</span>
                </>
              ) : (
                <>
                  <Play className="size-3.5 text-emerald-400" />
                  <span>Ativar campanha</span>
                </>
              )}
            </DropdownMenu.Item>
          )}

          {/* Duplicar campanha */}
          {onDuplicate && (
            <DropdownMenu.Item
              className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-foreground outline-none data-[highlighted]:bg-secondary transition-colors"
              disabled={disabled || busy}
              onSelect={() => onDuplicate(c)}
            >
              <Copy className="size-3.5 text-muted-foreground" />
              <span>Duplicar campanha</span>
            </DropdownMenu.Item>
          )}

          {/* Métricas e gráficos */}
          {onOpenDetail && (
            <DropdownMenu.Item
              className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-foreground outline-none data-[highlighted]:bg-secondary transition-colors"
              onSelect={() => onOpenDetail(c)}
            >
              <BarChart3 className="size-3.5 text-muted-foreground" />
              <span>Abrir detalhes</span>
            </DropdownMenu.Item>
          )}

          {/* Expandir / Recolher Estrutura */}
          {onToggleExpand && (
            <DropdownMenu.Item
              className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-foreground outline-none data-[highlighted]:bg-secondary transition-colors"
              onSelect={() => onToggleExpand()}
            >
              <Layers className="size-3.5 text-muted-foreground" />
              <span>{isOpen ? 'Recolher conjuntos/anúncios' : 'Ver conjuntos e anúncios'}</span>
            </DropdownMenu.Item>
          )}

          <DropdownMenu.Separator className="my-1 h-px bg-border/40" />

          {/* Copiar ID */}
          <DropdownMenu.Item
            className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground outline-none data-[highlighted]:bg-secondary data-[highlighted]:text-foreground transition-colors"
            onSelect={() => {
              void navigator.clipboard.writeText(id).then(
                () => toast.success('ID da campanha copiado'),
                () => toast.error('Não foi possível copiar o ID'),
              )
            }}
          >
            <Copy className="size-3.5" />
            <span>Copiar ID</span>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

function isProductLinkAd(ad: AdsTreeAd): boolean {
  return Boolean(ad.catalogId) && (
    String(ad.websiteType || '').toUpperCase() === 'PRODUCT_LINK'
    || String(ad.adFormat || '').toUpperCase() === 'CATALOG_CAROUSEL'
  )
}

function BudgetControl({
  entityId,
  amount: currentAmount,
  type,
  adAccountId,
  currency,
  label,
  onSaved,
  compact = false,
}: {
  entityId: string
  amount: number
  type: 'daily' | 'lifetime'
  adAccountId: string
  currency: string
  label: string
  onSaved: () => void
  compact?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(String(currentAmount || ''))
  const [busy, setBusy] = useState(false)
  async function save(nextValue = value) {
    if (busy) return
    const next = Number(String(nextValue).replace(',', '.'))
    if (!Number.isFinite(next) || next < TIKTOK_MIN_BUDGET) return toast.error(tiktokMinimumBudgetMessage(currency))
    if (Math.abs(next - currentAmount) < 0.005) { setEditing(false); return }
    setBusy(true)
    try {
      const amount = next
      const result = await apiSend<{ dryRun?: boolean }>(`/api/ads/${encodeURIComponent(entityId)}`, 'PUT', { budget: { amount, type }, adAccountId })
      if (result.dryRun) { toast.info('Simulação concluída', { hint: 'O orçamento não foi alterado.' }); setEditing(false); return }
      toast.info('Orçamento enviado', { hint: 'Aguardando atualização dos dados do TikTok.' })
      actionFeedback()
      setEditing(false)
      onSaved()
    } catch (error) {
      toast.error('Falha ao atualizar orçamento', { hint: error instanceof Error ? error.message : undefined })
      setValue(String(currentAmount || ''))
    } finally { setBusy(false) }
  }

  if (compact) {
    return (
      <div className="inline-flex items-center justify-end">
        {editing ? (
          <span className="inline-flex items-center gap-1">
            <input
              autoFocus
              type="number"
              min={TIKTOK_MIN_BUDGET}
              step="0.01"
              value={value}
              disabled={busy}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void save()
                if (event.key === 'Escape' && !busy) setEditing(false)
              }}
              className="h-9 w-24 rounded-lg border border-border bg-background px-2 text-xs tabular-nums text-foreground focus:border-primary/60 focus:outline-none focus:ring-1 focus:ring-primary/30"
              aria-label={`Novo orçamento de ${label}`}
            />
            <button
              type="button"
              className="size-8 inline-flex items-center justify-center rounded text-success hover:bg-success/15"
              onClick={() => void save()}
              disabled={busy}
              aria-label="Salvar"
            >
              {busy ? <Loader2 className="size-2.5 animate-spin" /> : <Check className="size-2.5" />}
            </button>
            <button
              type="button"
              className="size-8 inline-flex items-center justify-center rounded text-muted-foreground hover:bg-secondary"
              onClick={() => setEditing(false)}
              disabled={busy}
              aria-label="Cancelar"
            >
              <X className="size-2.5" />
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="group inline-flex items-center gap-1 text-xs font-medium tabular-nums text-foreground transition-colors hover:text-primary cursor-pointer"
            onClick={() => {
              setValue(String(currentAmount))
              setEditing(true)
            }}
            title="Clique para editar orçamento"
          >
            <span>{fmtMoney(currentAmount, currency)}</span>
            <span className="text-xs text-muted-foreground">/{type === 'lifetime' ? 'total' : 'dia'}</span>
            <Pencil className="size-3 text-muted-foreground/70 transition-colors group-hover:text-primary" />
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="campaign-budget-editor">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {editing ? (
          <span className="inline-flex items-center gap-1">
            <input
              autoFocus type="number" min={TIKTOK_MIN_BUDGET} step="0.01" value={value}
              disabled={busy} onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') void save(); if (event.key === 'Escape' && !busy) setEditing(false) }}
              className="h-9 w-28 rounded-lg border border-border bg-background px-2 text-xs tabular-nums text-foreground focus:border-primary/60 focus:outline-none focus:ring-1 focus:ring-primary/30"
              aria-label={`Novo orçamento de ${label}`}
            />
            <button type="button" className="btn-secondary text-xs" onClick={() => void save()} disabled={busy} aria-label="Salvar">
              {busy ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />} Salvar
            </button>
            <button type="button" className="btn-ghost !p-1" onClick={() => setEditing(false)} disabled={busy} aria-label="Cancelar"><X className="size-3" /></button>
          </span>
        ) : (
          <button type="button" className="inline-flex items-center gap-1 text-xs font-semibold tabular-nums text-foreground" onClick={() => { setValue(String(currentAmount)); setEditing(true) }}>
            {fmtMoney(currentAmount, currency)}/{type === 'lifetime' ? 'total' : 'dia'} <Pencil className="size-3 text-muted-foreground" />
          </button>
        )}
      </div>

    </div>
  )
}

const STATUS_FILTERS = [
  { value: 'active', label: 'Ativas' },
  { value: 'paused', label: 'Pausadas' },
  { value: '', label: 'Todas' },
  { value: 'approved', label: 'Aprovadas' },
  { value: 'pending_review', label: 'Em revisão' },
  { value: 'rejected', label: 'Rejeitadas' },
]

const ALL_STATUS_OPTIONS = [
  { value: 'active', label: 'Ativas' },
  { value: 'paused', label: 'Pausadas' },
  { value: '', label: 'Todas' },
  { value: 'approved', label: 'Aprovadas' },
  { value: 'pending_review', label: 'Em revisão' },
  { value: 'rejected', label: 'Rejeitadas' },
]

// Valores alinhados com o backend (['newest','oldest','spend_desc','spend_asc']).
// Antes usava 'spend'/'impressions' — o backend rejeitava e caía em 'newest'
// silenciosamente, dando impressão de ordenação quebrada.
const SORTS = [
  { value: 'newest', label: 'Mais recentes' },
  { value: 'oldest', label: 'Mais antigas' },
  { value: 'spend_desc', label: 'Maior gasto' },
  { value: 'spend_asc', label: 'Menor gasto' },
]

function normalizeSearch(value: string) {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

export function parseNaturalCampaignFilter(value: string) {
  const q = normalizeSearch(value)
  const numberAfter = (pattern: RegExp) => {
    const match = q.match(pattern)
    return match ? Number(match[1].replace(',', '.')) : null
  }
  const spendAbove = numberAfter(/(?:gast(?:ou|aram|o)|gasto).*?(?:mais|acima|>|maior)\s*(?:de\s*)?(\d+(?:[.,]\d+)?)/)
  const spendBelow = numberAfter(/(?:gast(?:ou|aram|o)|gasto).*?(?:menos|abaixo|<|menor)\s*(?:de\s*)?(\d+(?:[.,]\d+)?)/)
  const roasAbove = numberAfter(/roas.*?(?:mais|acima|>|maior)\s*(?:de\s*)?(\d+(?:[.,]\d+)?)/)
  const roasBelow = numberAfter(/roas.*?(?:menos|abaixo|<|menor)\s*(?:de\s*)?(\d+(?:[.,]\d+)?)/)
  const ctrBelow = numberAfter(/ctr.*?(?:menos|abaixo|<|menor)\s*(?:de\s*)?(\d+(?:[.,]\d+)?)/)
  const structured = [spendAbove, spendBelow, roasAbove, roasBelow, ctrBelow].some((n) => n != null)
    || /sem (?:venda|conversao)|nao venderam|com vendas?|ativas?|pausadas?/.test(q)
  return {
    raw: q, structured, spendAbove, spendBelow, roasAbove, roasBelow, ctrBelow,
    noSales: /sem (?:venda|conversao)|nao venderam|zero vendas?/.test(q),
    withSales: /com vendas?|venderam/.test(q) && !/nao venderam/.test(q),
    status: /pausadas?/.test(q) ? 'paused' : /ativas?/.test(q) ? 'active' : null,
  }
}

export function CampaignTree({
  tree,
  loading,
  error,
  currency,
  statusFilter,
  onStatusFilter,
  sort,
  onSort,
  page,
  onPage,
  onMutate,
  onRetry,
  onOpenDetail,
  onDuplicate,
  decisions,
  onOpenAutomations,
}: {
  tree?: AdsTreeResponse
  loading: boolean
  error: string | null
  currency: string
  statusFilter: string
  onStatusFilter: (s: string) => void
  sort: string
  onSort: (s: string) => void
  page: number
  onPage: (p: number) => void
  onMutate: () => void
  onRetry: () => void
  onOpenDetail?: (c: AdsTreeCampaign) => void
  // Abre o dialog de duplicação durável na mesma conta de anúncio.
  onDuplicate?: (c: AdsTreeCampaign) => void
  // Modelo de decisão: vendas/receita first-party + estado da automação.
  decisions?: AdsCampaignDecisionsResponse
  onOpenAutomations?: () => void
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [entityLevel, setEntityLevel] = useState<'campaign' | 'adgroup' | 'ad'>('campaign')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [deleteAd, setDeleteAd] = useState<{ ad: AdsTreeAd; adAccountId: string } | null>(null)
  const [deleting, setDeleting] = useState(false)
  // Edição de anúncio (texto/CTA/link) sem recriar
  const [editAd, setEditAd] = useState<{ ad: AdsTreeAd; adAccountId: string } | null>(null)
  // Ações em lote: seleção por checkbox → barra flutuante pausa/ativa tudo
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [selectedEntities, setSelectedEntities] = useState<Set<string>>(new Set())
  const [creativeInspect, setCreativeInspect] = useState<{ campaign: AdsTreeCampaign; group: AdsTreeAdSet; ad: AdsTreeAd } | null>(null)
  const [entityStatusFilter, setEntityStatusFilter] = useState<'all' | 'active' | 'paused' | 'issues'>('all')
  const [entitySort, setEntitySort] = useState<'spend_desc' | 'ctr_desc' | 'conversions_desc'>('spend_desc')
  const [bulkBusy, setBulkBusy] = useState(false)
  const [activation, setActivation] = useState<{ kind: 'single'; campaign: AdsTreeCampaign } | { kind: 'bulk' } | null>(null)
  
  // Ajuste de orçamento em lote
  const [bulkBudgetOpen, setBulkBudgetOpen] = useState(false)
  const [bulkBudgetMode, setBulkBudgetMode] = useState<BulkBudgetMode>('percent_up')
  const [bulkBudgetValue, setBulkBudgetValue] = useState('20')
  const [bulkBudgetBusy, setBulkBudgetBusy] = useState(false)

  // Busca por nome + "só com gasto" — filtros CLIENT-SIDE: o backend devolve a
  // lista inteira numa página só (readTree → pages:1), então filtrar aqui nunca
  // esconde resultados de outras páginas. "Só com gasto" nasce desligado.
  const [query, setQuery] = useState('')
  const [onlyWithSpend, setOnlyWithSpend] = useState(false)
  const [quickFilter, setQuickFilter] = useState<'all' | 'with_sales' | 'high_roas' | 'no_sales'>('all')
  const [showFilters, setShowFilters] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)')
    const sync = () => setIsMobile(media.matches)
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])
  useEffect(() => {
    const apply = (value: string) => {
      if (!value) return
      setQuery(value)
      setShowFilters(true)
      const parsed = parseNaturalCampaignFilter(value)
      if (parsed.status && parsed.status !== statusFilter) onStatusFilter(parsed.status)
      try { localStorage.removeItem('roi_ads_natural_filter') } catch {}
    }
    try { apply(localStorage.getItem('roi_ads_natural_filter') || '') } catch {}
    const onFilter = (event: Event) => apply(String((event as CustomEvent).detail || ''))
    window.addEventListener('roi:ads-filter', onFilter)
    return () => window.removeEventListener('roi:ads-filter', onFilter)
  }, [onStatusFilter, statusFilter])

  const selectionScope = (tree?.campaigns || []).map(campaign => `${campaign.platformCampaignId}:${campaign.status}`).sort().join('|')

  // Uma seleção de lote não pode sobreviver à troca de página/filtro/período;
  // do contrário, ações poderiam atingir campanhas que já não estão visíveis.
  useEffect(() => {
    setSelected(new Set())
  }, [page, statusFilter, sort, selectionScope, query, onlyWithSpend, quickFilter])

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function bulkStatus(status: 'active' | 'paused') {
    if (selected.size === 0 || bulkBusy || busyId) return false
    const targets = campaigns.filter((campaign) =>
      selected.has(campaign.platformCampaignId)
      && (status === 'active' ? campaign.status === 'paused' : campaign.status === 'active'),
    )
    if (targets.length === 0) {
      toast.info(status === 'active' ? 'Nenhuma campanha pausada selecionada' : 'Nenhuma campanha ativa selecionada')
      return false
    }
    if (targets.length > 50) { toast.error('Selecione até 50 campanhas por vez'); return false }
    setBulkBusy(true)
    try {
      const r = await apiSend<CampaignStatusResult>(
        '/api/ads/campaigns/bulk-status',
        'POST',
        {
          campaigns: targets.map((campaign) => ({ platformCampaignId: campaign.platformCampaignId })),
          status,
          adAccountId: targets[0]?.platformAdAccountId,
        },
      )
      const outcome = campaignStatusOutcome(r, targets.length)
      if (outcome === 'simulated') { toast.info('Simulação concluída', { hint: 'Modo teste: nenhuma campanha foi alterada.' }); return true }
      if (outcome === 'failed') throw new Error('Nenhuma alteração foi aceita. Atualize a lista e tente novamente.')
      if (outcome === 'partial') toast.error('Parte das campanhas não foi alterada', { hint: `${r.totals?.updated} enviada(s), ${r.totals?.skipped} ignorada(s), ${r.totals?.failed} falha(s).` })
      else toast.info('Solicitação enviada', { hint: `${targets.length} ${targets.length === 1 ? 'campanha elegível' : 'campanhas elegíveis'} enviada${targets.length === 1 ? '' : 's'}. O status será atualizado após a sincronização com o TikTok.` })
      actionFeedback()
      setSelected(new Set())
      onMutate()
      return true
    } catch (e) {
      toast.error('Falha na ação em lote', { hint: e instanceof Error ? e.message : undefined })
      return false
    } finally {
      setBulkBusy(false)
    }
  }

  async function applyBulkBudget() {
    if (selected.size === 0 || bulkBudgetBusy) return
    const val = Number(bulkBudgetValue.replace(',', '.'))
    if (!Number.isFinite(val) || val <= 0) {
      toast.error('Informe um valor numérico válido')
      return
    }
    if (bulkBudgetMode === 'fixed' && val < TIKTOK_MIN_BUDGET) {
      toast.error(tiktokMinimumBudgetMessage(currency))
      return
    }

    const budgetTargets = campaigns.filter(c => selected.has(c.platformCampaignId))
    if (budgetTargets.some(c => c.budgetOwner !== 'campaign' || !Number.isFinite(c.budget?.amount) || !['daily', 'lifetime'].includes(c.budget?.type || ''))) {
      toast.error('Ajuste o orçamento nos conjuntos', { hint: 'O ajuste em lote exige orçamento definido na campanha. Abra os conjuntos para editar os demais.' })
      return
    }
    setBulkBudgetBusy(true)
    let updated = 0
    let simulated = 0
    let failed = 0

    const selectedCampaigns = campaigns.filter((c) => selected.has(c.platformCampaignId))

    for (const c of selectedCampaigns) {
      try {
        const curAmount = Number(c.budget?.amount)
        const newAmount = adjustedBudgetAmount(curAmount, bulkBudgetMode, val)

        const result = await apiSend<{ dryRun?: boolean }>(`/api/ads/${encodeURIComponent(c.platformCampaignId)}`, 'PUT', {
          budget: { amount: newAmount, type: c.budget?.type || 'daily' },
          adAccountId: c.platformAdAccountId,
        })
        if (result.dryRun) simulated++
        else updated++
      } catch {
        failed++
      }
    }

    setBulkBudgetBusy(false)
    setBulkBudgetOpen(false)
    if (updated > 0) {
      toast.info(`${updated} orçamento(s) enviado(s)`, { hint: 'Aguardando atualização do TikTok.' })
      actionFeedback()
      onMutate()
    }
    if (simulated > 0) toast.info(`${simulated} orçamento(s) simulado(s)`, { hint: 'Modo teste: nenhuma alteração publicada para essas campanhas.' })
    if (failed > 0) {
      toast.error(`${failed} falha(s) ao atualizar orçamento`)
    }
  }

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function setCampaignStatus(c: AdsTreeCampaign, status: 'active' | 'paused') {
    const id = c.platformCampaignId
    if (busyId || bulkBusy) return false
    setBusyId(id)
    try {
      const result = await apiSend<CampaignStatusResult>('/api/ads/campaigns/bulk-status', 'POST', {
        campaigns: [{ platformCampaignId: id }],
        status,
        adAccountId: c.platformAdAccountId,
      })
      const outcome = campaignStatusOutcome(result, 1)
      if (outcome === 'simulated') { toast.info('Simulação concluída', { hint: 'Modo teste: a campanha não foi alterada.' }); return true }
      if (outcome !== 'accepted') throw new Error('A alteração não foi confirmada. Atualize a lista e tente novamente.')
      toast.info(status === 'paused' ? 'Pausa solicitada' : 'Ativação solicitada', { hint: 'Aguardando atualização do status na lista.' })
      actionFeedback()
      onMutate()
      return true
    } catch (e) {
      toast.error('Falha ao alterar status', { hint: e instanceof Error ? e.message : undefined })
      return false
    } finally {
      setBusyId(null)
    }
  }

  async function setEntityStatus(id: string, status: 'active' | 'paused', label: string) {
    if (busyId || bulkBusy) return
    setBusyId(id)
    try {
      const result = await apiSend<{ dryRun?: boolean; simulated?: boolean }>(`/api/ads/${encodeURIComponent(id)}`, 'PUT', { status })
      if (result.dryRun || result.simulated) toast.info('Simulação concluída', { hint: `${label} não foi alterado no TikTok.` })
      else toast.info(status === 'paused' ? 'Pausa solicitada' : 'Ativação solicitada', { hint: `${label} será atualizado após a sincronização.` })
      actionFeedback()
      onMutate()
    } catch (e) {
      toast.error('Falha ao alterar status', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setBusyId(null)
    }
  }

  async function applyEntityBulkStatus(status: 'active' | 'paused') {
    if (!selectedEntities.size || bulkBusy) return
    setBulkBusy(true)
    let updated = 0
    let simulated = 0
    let failed = 0
    for (const id of selectedEntities) {
      try {
        const result = await apiSend<{ dryRun?: boolean; simulated?: boolean }>(`/api/ads/${encodeURIComponent(id)}`, 'PUT', { status })
        if (result.dryRun || result.simulated) simulated++
        else updated++
      } catch {
        failed++
      }
    }
    setBulkBusy(false)
    if (updated) {
      toast.success(`${updated} ${entityLevel === 'ad' ? 'anúncio(s)' : 'conjunto(s)'} atualizado(s)`, { hint: 'Aguardando sincronização do TikTok.' })
      actionFeedback()
      onMutate()
    }
    if (simulated) toast.info(`${simulated} alteração(ões) simulada(s)`, { hint: 'Modo teste: nada foi publicado.' })
    if (failed) toast.error(`${failed} alteração(ões) falharam`)
    if (!failed) setSelectedEntities(new Set())
  }

  function toggleEntitySelection(id: string) {
    setSelectedEntities((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleDeleteAd() {
    const ad = deleteAd?.ad
    const adId = ad?.platformAdId || ad?._id
    if (!adId || deleting) return
    setDeleting(true)
    try {
      const result = await apiSend<{ ok?: boolean; dryRun?: boolean; simulated?: boolean }>(
        `/api/ads/${encodeURIComponent(adId)}`,
        'DELETE',
        { adAccountId: deleteAd?.adAccountId },
      )
      setDeleteAd(null)
      if (result.dryRun || result.simulated) {
        toast.info('Simulação concluída', { hint: 'Modo teste: o anúncio não foi excluído do TikTok.' })
      } else {
        toast.success('Anúncio excluído')
      }
      onMutate()
    } catch (e) {
      // Falha real: mantém a confirmação aberta para retry.
      toast.error('Falha ao excluir anúncio', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setDeleting(false)
    }
  }

  const campaigns = tree?.campaigns ?? []
  const pagination = tree?.pagination

  const commandCenter = useMemo(() => {
    const groups = campaigns.flatMap((campaign) => campaign.adSets || [])
    const ads = groups.flatMap((group) => group.ads || [])
    const source = entityLevel === 'campaign' ? campaigns : entityLevel === 'adgroup' ? groups : ads
    const active = source.filter((item) => item.status === 'active').length
    const issues = source.filter((item) => item.status === 'error' || item.status === 'rejected' || item.status === 'pending_review').length
    const spentNoSales = entityLevel === 'campaign' && decisions ? campaigns.filter((campaign) => Number(campaign.metrics?.spend || 0) > 0 && Number(decisions.byCampaign[campaign.platformCampaignId]?.sales || 0) === 0).length : 0
    const spend = source.reduce((sum, item) => sum + Number(item.metrics?.spend || 0), 0)
    const conversions = source.reduce((sum, item) => sum + Number(item.metrics?.conversions || 0), 0)
    const pendingProposals = decisions ? Object.values(decisions.byCampaign).filter((entry) => Boolean(entry.automation?.pendingProposal)).length : 0
    const campaignSales = decisions ? Object.values(decisions.byCampaign).reduce((sum, entry) => sum + Number(entry.sales || 0), 0) : null
    const campaignRevenueCents = decisions ? Object.values(decisions.byCampaign).reduce((sum, entry) => sum + Number(entry.revenueCents || 0), 0) : null
    const roas = entityLevel === 'campaign' && campaignRevenueCents != null && spend > 0 ? (campaignRevenueCents / 100) / spend : null
    return { total: source.length, active, issues, spentNoSales, spend, conversions, pendingProposals, campaignSales, roas }
  }, [campaigns, decisions, entityLevel])

  const statusCounts = useMemo(() => campaignStatusCounts(campaigns), [campaigns])
  const adGroupCount = useMemo(() => campaigns.reduce((total, campaign) => total + (campaign.adSets?.length || 0), 0), [campaigns])
  const adCount = useMemo(() => campaigns.reduce((total, campaign) => total + (campaign.adSets || []).reduce((sum, group) => sum + (group.ads?.length || 0), 0), 0), [campaigns])
  useEffect(() => { setSelectedEntities(new Set()); setEntityStatusFilter('all'); setEntitySort('spend_desc') }, [entityLevel])

  // Aplica busca + "só com gasto" sobre a lista carregada
  const q = normalizeSearch(query.trim())
  const natural = parseNaturalCampaignFilter(query)
  const visible = campaigns.filter((c) => {
    if (!campaignMatchesStatus(c, statusFilter)) return false
    // Busca bate no nome cru E no limpo — o usuário vê o limpo na tela
    if (
      q && !natural.structured &&
      !normalizeSearch(String(c.campaignName || c.platformCampaignId)).includes(q) &&
      !normalizeSearch(cleanCampaignName(c.campaignName)).includes(q)
    )
      return false
    if (onlyWithSpend && !(Number(c.metrics?.spend) > 0)) return false
    const spend = Number(c.metrics?.spend) || 0
    const attr = decisions?.byCampaign[c.platformCampaignId]
    const sales = Number(attr?.sales) || 0
    const roas = attr?.currency && attr.currency === (c.currency || currency) && spend > 0 ? (Number(attr.revenueCents) || 0) / 100 / spend : null
    const ctr = Number(c.metrics?.ctr) || 0
    const needsRealDecision = quickFilter !== 'all'
      || natural.roasAbove != null
      || natural.roasBelow != null
      || natural.noSales
      || natural.withSales
    if (needsRealDecision && !decisions) return false

    // Filtros rápidos
    if (quickFilter === 'with_sales' && sales <= 0) return false
    if (quickFilter === 'high_roas' && (roas === null || roas < 2.0)) return false
    if (quickFilter === 'no_sales' && (sales > 0 || spend <= 0)) return false

    if (natural.spendAbove != null && !(spend > natural.spendAbove)) return false
    if (natural.spendBelow != null && !(spend < natural.spendBelow)) return false
    if (natural.roasAbove != null && !(roas !== null && roas > natural.roasAbove)) return false
    if (natural.roasBelow != null && !(roas !== null && roas < natural.roasBelow)) return false
    if (natural.ctrBelow != null && !(ctr < natural.ctrBelow)) return false
    if (natural.noSales && sales !== 0) return false
    if (natural.withSales && sales <= 0) return false
    return true
  })

  const visibleSelectionScope = visible.map(c => c.platformCampaignId).sort().join('|')
  useEffect(() => { setSelected(new Set()) }, [visibleSelectionScope])

  const allVisibleSelected = visible.length > 0 && visible.every((c) => selected.has(c.platformCampaignId))

  function toggleSelectAll() {
    if (allVisibleSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set(visible.map((c) => c.platformCampaignId)))
    }
  }

  // Organização: sem filtro de status, agrupa em seções com ativas primeiro —
  // era fácil perder uma campanha ativa no meio de dezenas de pausadas.
  const STATUS_ORDER: Record<string, number> = {
    active: 0,
    pending_review: 1,
    error: 2,
    rejected: 2,
    paused: 3,
    completed: 4,
    cancelled: 5,
  }
  const GROUP_LABELS: Record<number, string> = {
    0: 'Ativas',
    1: 'Em revisão',
    2: 'Com problemas',
    3: 'Pausadas',
    4: 'Concluídas',
    5: 'Canceladas',
  }
  const grouped = statusFilter
    ? null
    : [...visible].sort(
        (a, b) => (STATUS_ORDER[a.status ?? ''] ?? 6) - (STATUS_ORDER[b.status ?? ''] ?? 6),
      )
  const displayCampaigns = grouped ?? visible

  // Lista achatada (cabeçalhos de grupo + campanhas) para virtualizar de forma
  // uniforme. Cabeçalhos só existem quando não há filtro (modo agrupado).
  type FlatRow =
    | { kind: 'group'; groupIdx: number; count: number; key: string }
    | { kind: 'campaign'; c: AdsTreeCampaign; key: string }
  const flatRows: FlatRow[] = []
  displayCampaigns.forEach((c, idx) => {
    const groupIdx = STATUS_ORDER[c.status ?? ''] ?? 6
    const prevGroupIdx = idx > 0 ? STATUS_ORDER[displayCampaigns[idx - 1].status ?? ''] ?? 6 : -1
    if (grouped !== null && groupIdx !== prevGroupIdx) {
      const count = displayCampaigns.filter((x) => (STATUS_ORDER[x.status ?? ''] ?? 6) === groupIdx).length
      flatRows.push({ kind: 'group', groupIdx, count, key: `g-${groupIdx}` })
    }
    flatRows.push({ kind: 'campaign', c, key: c.platformCampaignId })
  })

  // Virtualiza só quando vale a pena (>50 linhas). O virtualizer é sempre
  // instanciado (regra de hooks), mas só consumimos sua saída no modo virtual.
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualize = flatRows.length > 50
  const rowVirtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => {
      const row = flatRows[index]
      if (row?.kind === 'group') return 34
      const isExp = row?.c ? expanded.has(row.c.platformCampaignId) : false
      return isExp ? 460 : 50
    },
    overscan: 8,
    getItemKey: (i) => flatRows[i].key,
  })

  const allExpanded = visible.length > 0 && visible.every((c) => expanded.has(c.platformCampaignId))

  function toggleAllExpanded() {
    if (allExpanded) {
      setExpanded(new Set())
    } else {
      setExpanded(new Set(visible.map((c) => c.platformCampaignId)))
    }
  }

  // Cabeçalho de grupo: a lista usa uma única visualização compacta no desktop.
  function renderGroupHeader(row: Extract<FlatRow, { kind: 'group' }>, _index?: number, mobile = false) {
    return (
      <div className={cn('flex h-9 items-center gap-2 border-y border-border/60 px-3 text-xs font-medium text-muted-foreground', !mobile && 'min-w-[1160px] bg-secondary/20')}>
        <span className="size-1.5 rounded-full bg-muted-foreground/70" aria-hidden="true" />
        <span>{GROUP_LABELS[row.groupIdx] ?? 'Outras'} · {row.count}</span>
      </div>
    )
  }

  // Bloco expandido: estrutura rápida. Performance detalhada fica na Central da campanha.
  function renderExpandedContent(c: AdsTreeCampaign) {
    const id = c.platformCampaignId
    const groupCount = c.adSetCount ?? c.adSets?.length ?? 0
    const adCount = c.adCount ?? (c.adSets ?? []).reduce((sum, group) => sum + (group.ads?.length ?? 0), 0)

    return (
      <div id={`campaign-details-${id}`} className="border-t border-border/50 bg-secondary/10 px-4 py-4 sm:px-5">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Estrutura rápida</h3>
            <p className="mt-1 text-xs text-muted-foreground">{groupCount} {groupCount === 1 ? 'grupo' : 'grupos'} · {adCount} {adCount === 1 ? 'anúncio' : 'anúncios'}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {onOpenDetail ? (
              <button type="button" className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-xs font-medium text-brand-cyan transition-colors hover:bg-brand-cyan/8" onClick={() => onOpenDetail(c)}>
                Abrir Central da campanha
                <ChevronRight className="size-3.5" aria-hidden="true" />
              </button>
            ) : null}
            {onDuplicate ? (
              <button type="button" className="btn-ghost min-h-10 px-3 text-xs" onClick={() => onDuplicate(c)}>
                <Copy className="size-3.5" aria-hidden="true" /> Duplicar
              </button>
            ) : null}
          </div>
        </div>

        <div className="mb-4 border-y border-border/45 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-foreground">{c.budgetOwner === 'campaign' ? 'Orçamento da campanha · CBO' : 'Orçamento nos conjuntos · ABO'}</p>
              <p className="mt-1 text-xs text-muted-foreground">{c.budgetOwner === 'campaign' ? 'O valor é controlado no nível da campanha.' : 'Cada conjunto controla o próprio orçamento.'}</p>
            </div>
            {c.budgetOwner === 'campaign' && c.budget?.amount != null ? (
              <BudgetControl
                entityId={id}
                amount={Number(c.budget.amount)}
                type={c.budget.type === 'lifetime' ? 'lifetime' : 'daily'}
                adAccountId={c.platformAdAccountId || ''}
                currency={c.currency || currency}
                label="Orçamento da campanha"
                onSaved={onMutate}
                compact
              />
            ) : null}
          </div>
        </div>

        {(c.adSets ?? []).length === 0 ? (
          <p className="py-5 text-sm text-muted-foreground">Nenhum conjunto de anúncios carregado para esta campanha.</p>
        ) : (
          <div className="divide-y divide-border/45">
            {(c.adSets ?? []).map((group, groupIndex) => {
              const ads = group.ads ?? []
              return (
                <section key={group.platformAdSetId ?? groupIndex} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">{group.adSetName || group.name || `Grupo ${groupIndex + 1}`}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        <StatusInline status={group.status} />
                        <span aria-hidden="true">·</span>
                        <span>{ads.length} {ads.length === 1 ? 'anúncio' : 'anúncios'}</span>
                        {c.budgetOwner === 'campaign' ? <><span aria-hidden="true">·</span><span>Orçamento controlado pela campanha</span></> : null}
                      </div>
                    </div>
                    {c.budgetOwner !== 'campaign' && group.platformAdSetId && group.budget?.amount != null ? (
                      <BudgetControl
                        entityId={group.platformAdSetId}
                        amount={Number(group.budget.amount)}
                        type={group.budget.type === 'lifetime' ? 'lifetime' : 'daily'}
                        adAccountId={c.platformAdAccountId || ''}
                        currency={c.currency || currency}
                        label="Orçamento do conjunto"
                        onSaved={onMutate}
                        compact
                      />
                    ) : null}
                  </div>

                  {ads.length === 0 ? (
                    <p className="mt-3 text-xs text-muted-foreground">Sem anúncios neste grupo.</p>
                  ) : (
                    <ul className="mt-3 grid gap-3 lg:grid-cols-2">
                      {ads.map((ad, adIndex) => {
                        const adKey = ad.platformAdId || ad._id || String(adIndex)
                        const videoUrl = /^https:\/\//i.test(ad.creative?.videoUrl || '') ? ad.creative?.videoUrl : ''
                        return (
                          <li key={adKey} className="rounded-xl border border-border/55 bg-background/35 p-3">
                            <div className="flex gap-3">
                              {(ad.creative?.imageUrl || videoUrl || ad.creative?.videoId || ad.creative?.imageIds?.length) ? (
                                <div className="relative flex h-20 w-28 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border/50 bg-black">
                                  {videoUrl ? (
                                    <video src={videoUrl} poster={ad.creative?.imageUrl} controls muted playsInline preload="metadata" className="h-full w-full object-cover" aria-label={`Prévia do anúncio ${ad.name || adKey}`} />
                                  ) : ad.creative?.imageUrl ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={ad.creative.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                                  ) : (
                                    <div className="flex flex-col items-center gap-1 px-2 text-center text-[10px] leading-tight text-white/65" title={ad.creative?.videoId ? `Vídeo TikTok ${ad.creative.videoId}` : 'Asset de imagem do TikTok'}>
                                      <span className="flex size-7 items-center justify-center rounded-full bg-white/10"><Play className="size-3.5 fill-current" aria-hidden="true" /></span>
                                      <span>Prévia carregando</span>
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <div className="flex h-20 w-28 shrink-0 items-center justify-center rounded-lg border border-dashed border-border/50 bg-secondary/20 px-2 text-center text-[10px] leading-tight text-muted-foreground">
                                  Criativo não informado
                                </div>
                              )}

                              <div className="min-w-0 flex-1">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <p className="truncate text-sm font-semibold text-foreground" title={ad.name || adKey}>{ad.name || `Anúncio ${adIndex + 1}`}</p>
                                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                                      <StatusInline status={ad.status} />
                                      {ad.adType === 'boost' ? <><span aria-hidden="true">·</span><span>Spark</span></> : null}
                                    </div>
                                  </div>
                                  <DropdownMenu.Root>
                                    <DropdownMenu.Trigger asChild>
                                      <button type="button" className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground" aria-label={`Ações do anúncio ${ad.name || adKey}`}>
                                        <MoreHorizontal className="size-4" aria-hidden="true" />
                                      </button>
                                    </DropdownMenu.Trigger>
                                    <DropdownMenu.Portal>
                                      <DropdownMenu.Content align="end" sideOffset={6} className="z-[80] min-w-44 rounded-xl border border-border bg-background p-1.5 shadow-xl">
                                        <DropdownMenu.Item className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg px-3 text-xs text-foreground outline-none hover:bg-secondary/60 focus:bg-secondary/60" onSelect={() => setEditAd({ ad, adAccountId: c.platformAdAccountId || '' })}>
                                          <Pencil className="size-3.5" aria-hidden="true" /> Editar anúncio
                                        </DropdownMenu.Item>
                                        {ad.creative?.linkUrl && !isProductLinkAd(ad) ? (
                                          <DropdownMenu.Item asChild>
                                            <a href={ad.creative.linkUrl} target="_blank" rel="noopener noreferrer" className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg px-3 text-xs text-foreground outline-none hover:bg-secondary/60 focus:bg-secondary/60">
                                              <ExternalLink className="size-3.5" aria-hidden="true" /> Abrir destino
                                            </a>
                                          </DropdownMenu.Item>
                                        ) : null}
                                        <DropdownMenu.Separator className="my-1 h-px bg-border/60" />
                                        <DropdownMenu.Item className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg px-3 text-xs text-error outline-none hover:bg-error/10 focus:bg-error/10" onSelect={() => setDeleteAd({ ad, adAccountId: c.platformAdAccountId || '' })}>
                                          <Trash2 className="size-3.5" aria-hidden="true" /> Remover anúncio
                                        </DropdownMenu.Item>
                                      </DropdownMenu.Content>
                                    </DropdownMenu.Portal>
                                  </DropdownMenu.Root>
                                </div>

                                {ad.creative?.body ? <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{ad.creative.body}</p> : null}
                                <p className="mt-2 text-xs tabular-nums text-muted-foreground">{fmtMoney(ad.metrics?.spend, c.currency || currency)} · {fmtCompact(ad.metrics?.impressions)} impr.</p>
                                {isProductLinkAd(ad) ? <p className="mt-2 text-xs text-muted-foreground">Destino definido pelos produtos do catálogo.</p> : null}
                              </div>
                            </div>

                            {ad.rejectionReason ? (
                              <div className="mt-3 border-t border-error/20 pt-3">
                                <p className="text-xs font-semibold text-error">Reprovado pelo TikTok</p>
                                <p className="mt-1 text-xs leading-relaxed text-error/90">{ad.rejectionReason}</p>
                              </div>
                            ) : null}
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </section>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  // Linha principal = leitura de decisão: gasto do TikTok + vendas reais do
  // ROINADOS + ação da automação. CPC/CPM/CTR continuam no detalhe expandido.
  function renderCampaignTableRow(c: AdsTreeCampaign, index?: number) {
    const id = c.platformCampaignId
    const isOpen = expanded.has(id)
    const busy = busyId === id
    const metrics = campaignMetrics(c.metrics)
    const budget = campaignBudget(c)
    const campaignCurrency = c.currency || currency
    const money = (value: number | null) => value === null ? '—' : fmtMoney(value, campaignCurrency)
    const decision = decisions?.byCampaign[id]
    const decisionsLoaded = Boolean(decisions)
    const realSales = decisionsLoaded ? Number(decision?.sales) || 0 : null
    const realRevenue = decisionsLoaded ? (Number(decision?.revenueCents) || 0) / 100 : null
    const realCpa = realSales !== null && realSales > 0 && metrics.spend !== null ? metrics.spend / realSales : null
    const revenueComparable = realRevenue === 0 || (decision?.currency && decision.currency === campaignCurrency)
    const realRoas = decisionsLoaded && metrics.spend !== null && metrics.spend > 0 && realRevenue !== null && revenueComparable
      ? realRevenue / metrics.spend
      : null
    const automation = campaignAutomationView(decisions, decision)
    const automationTitle = decision?.automation.pendingProposal?.detail
      || decision?.automation.lastEvent?.result
      || decision?.automation.lastEvent?.detail
      || automation.detail
    const isError = c.status === 'error' || c.status === 'rejected' || c.reviewStatus === 'rejected' || c.childStatus === 'rejected'
    const adSetCount = c.adSetCount ?? c.adSets?.length ?? 0
    const adCount = c.adCount ?? 0

    let baseError =
      c.reviewStatus === 'rejected'
        ? 'Revisão rejeitada pelo TikTok'
        : c.status === 'error'
          ? 'Erro na campanha'
          : c.status === 'rejected'
            ? 'Campanha rejeitada'
            : null

    const rejectionReasons = new Set<string>()
    if (c.adSets) {
      for (const s of c.adSets) {
        if (s.ads) {
          for (const ad of s.ads) {
            if (ad.rejectionReason) rejectionReasons.add(ad.rejectionReason)
          }
        }
      }
    }

    let detailedError = baseError
    if (rejectionReasons.size > 0) {
      detailedError = Array.from(rejectionReasons).join(' • ')
    } else if (isError && !detailedError) {
      detailedError = 'Problema na conta ou orçamento (Verifique o TikTok Ads)'
    }

    const automationContent = (
      <>
        <span className="flex items-center gap-1.5">
          <span
            className={cn(
              'size-1.5 shrink-0 rounded-full',
              automation.tone === 'success' && 'bg-success',
              automation.tone === 'warning' && 'bg-warning',
              automation.tone === 'error' && 'bg-error',
              automation.tone === 'primary' && 'bg-brand-cyan',
              automation.tone === 'muted' && 'bg-muted-foreground/60',
            )}
            aria-hidden="true"
          />
          <span className={cn('truncate text-xs font-medium', automationToneClass(automation.tone))}>
            {automation.label}
          </span>
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">{automation.detail}</span>
      </>
    )

    return (
      <div
        key={id}
        className={`campaign-table-row border-b border-border/50 transition-colors ${
          selected.has(id) ? 'bg-primary/5' : isOpen ? 'bg-secondary/15' : 'hover:bg-muted/20'
        } ${isError ? 'border-l-2 border-l-error' : ''}`}
      >
        <div className="grid grid-cols-[38px_68px_minmax(230px,2fr)_150px_95px_70px_95px_80px_160px_110px_60px] items-center px-3 py-2.5 text-xs min-w-[1160px]">
          <div className="flex items-center justify-center">
            <input
              type="checkbox"
              checked={selected.has(id)}
              onChange={() => toggleSelect(id)}
              disabled={Boolean(busyId) || bulkBusy}
              className="size-3.5 rounded accent-primary cursor-pointer"
              aria-label={`Selecionar ${c.campaignName || id}`}
            />
          </div>

          <div className="flex items-center">
            <CampaignActivationToggle
              status={c.status}
              busy={busy}
              disabled={Boolean(busyId) || bulkBusy}
              onToggle={() =>
                c.status === 'active'
                  ? void setCampaignStatus(c, 'paused')
                  : setActivation({ kind: 'single', campaign: c })
              }
              name={c.campaignName || id}
            />
          </div>

          <div className="min-w-0 pr-3">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                aria-expanded={isOpen}
                className="truncate text-left text-sm font-semibold text-foreground transition-colors hover:text-primary"
                onClick={() => toggle(id)}
                title={c.campaignName || id}
              >
                {cleanCampaignName(c.campaignName || id)}
              </button>
              {c.campaignKind === 'smart_plus' && <span className="shrink-0 text-xs text-muted-foreground">· Smart+</span>}
              {c.reviewStatus === 'approved' && (
                <span title="Aprovada pelo TikTok" className="inline-flex">
                  <BadgeCheck className="size-3.5 shrink-0 text-success" />
                </span>
              )}
              {isError && (
                <span title={detailedError || 'Problema na campanha'} className="inline-flex">
                  <AlertTriangle className="size-3.5 shrink-0 text-error" />
                </span>
              )}
            </div>
            {c.childStatus && c.childStatus !== c.status ? (
              <div className="mt-0.5 text-xs text-warning">Anúncios · {STATUS_META[c.childStatus]?.label || 'ver detalhes'}</div>
            ) : null}
          </div>

          <div className="pr-2 text-right">
            {c.budgetOwner === 'campaign' && c.budget?.amount != null ? (
              <BudgetControl
                entityId={id}
                amount={Number(c.budget.amount)}
                type={c.budget.type === 'lifetime' ? 'lifetime' : 'daily'}
                adAccountId={c.platformAdAccountId || ''}
                currency={campaignCurrency}
                label="Orçamento"
                onSaved={onMutate}
                compact
              />
            ) : (
              <span className="text-xs text-muted-foreground" title="Orçamento definido no nível dos conjuntos (ABO)">
                Nos conjuntos
                <span className="block text-xs">{budget.detail}</span>
              </span>
            )}
          </div>

          <div className="pr-2 text-right font-mono tabular-nums" title="Investimento informado pelo TikTok">{money(metrics.spend)}</div>
          <div className="pr-2 text-right font-mono tabular-nums" title="Vendas rastreadas pelo ROINADOS">
            {realSales === null ? '—' : realSales.toLocaleString('pt-BR')}
          </div>
          <div className="pr-2 text-right font-mono tabular-nums" title="Gasto TikTok ÷ vendas reais rastreadas pelo ROINADOS">
            {money(realCpa)}
          </div>
          <div
            className={cn('pr-2 text-right font-mono font-semibold tabular-nums', realRoas !== null && realRoas >= 2 ? 'text-success' : realRoas !== null && realRoas < 1 ? 'text-warning' : 'text-foreground')}
            title={!decisionsLoaded ? 'Carregando atribuição real' : !revenueComparable ? 'Receita em moeda diferente ou múltiplas moedas' : 'Receita real ÷ gasto TikTok'}
          >
            {realRoas === null ? '—' : `${realRoas.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}×`}
          </div>

          <div className="min-w-0 pr-2" title={automationTitle}>
            {automation.actionable && onOpenAutomations ? (
              <button type="button" onClick={onOpenAutomations} className="block w-full rounded-md text-left hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {automationContent}
              </button>
            ) : (
              <div>{automationContent}</div>
            )}
          </div>

          <div className="px-1 text-center">
            <button
              type="button"
              onClick={() => toggle(id)}
              className={`inline-flex w-full items-center justify-center gap-1 px-1 py-1 text-xs font-medium transition-colors ${isOpen ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
              title={isOpen ? 'Recolher estrutura' : 'Ver conjuntos e anúncios'}
              aria-expanded={isOpen}
            >
              <Layers className="size-3 shrink-0" />
              <span className="truncate">{adSetCount} {adSetCount === 1 ? 'grupo' : 'grupos'} · {adCount} {adCount === 1 ? 'anúncio' : 'anúncios'}</span>
              <ChevronRight className={`size-3 shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
            </button>
          </div>

          <div className="flex items-center justify-end">
            <CampaignQuickActionsDropdown
              campaign={c}
              currency={currency}
              busy={busy}
              disabled={Boolean(busyId) || bulkBusy}
              isOpen={isOpen}
              onToggleExpand={() => toggle(id)}
              onDuplicate={onDuplicate}
              onOpenDetail={onOpenDetail}
              onToggleStatus={() =>
                c.status === 'active'
                  ? void setCampaignStatus(c, 'paused')
                  : setActivation({ kind: 'single', campaign: c })
              }
            />
          </div>
        </div>

        {detailedError && (
          <div className="flex min-w-[1160px] items-center gap-2 border-t border-error/20 px-4 py-2 text-xs text-error">
            <AlertTriangle className="size-3.5 shrink-0" />
            <span>{detailedError}</span>
          </div>
        )}

        {isOpen && renderExpandedContent(c)}
      </div>
    )
  }

  // Leitura operacional para telas pequenas: sem tabela horizontal.
  function renderCampaignCardRow(c: AdsTreeCampaign) {
    const id = c.platformCampaignId
    const isOpen = expanded.has(id)
    const busy = busyId === id
    const metrics = campaignMetrics(c.metrics)
    const budget = campaignBudget(c)
    const campaignCurrency = c.currency || currency
    const decision = decisions?.byCampaign[id]
    const decisionsLoaded = Boolean(decisions)
    const realSales = decisionsLoaded ? Number(decision?.sales) || 0 : null
    const realRevenue = decisionsLoaded ? (Number(decision?.revenueCents) || 0) / 100 : null
    const realCpa = realSales !== null && realSales > 0 && metrics.spend !== null ? metrics.spend / realSales : null
    const revenueComparable = realRevenue === 0 || (decision?.currency && decision.currency === campaignCurrency)
    const realRoas = decisionsLoaded && metrics.spend !== null && metrics.spend > 0 && realRevenue !== null && revenueComparable ? realRevenue / metrics.spend : null
    const automation = campaignAutomationView(decisions, decision)
    const adSetCount = c.adSetCount ?? c.adSets?.length ?? 0
    const adCount = c.adCount ?? 0
    const isError = c.status === 'error' || c.status === 'rejected' || c.reviewStatus === 'rejected' || c.childStatus === 'rejected'
    const rejectionReasons = new Set<string>()
    for (const adSet of c.adSets ?? []) for (const ad of adSet.ads ?? []) if (ad.rejectionReason) rejectionReasons.add(ad.rejectionReason)
    const detailedError = rejectionReasons.size > 0
      ? Array.from(rejectionReasons).join(' • ')
      : c.reviewStatus === 'rejected' ? 'Revisão rejeitada pelo TikTok'
        : c.status === 'error' ? 'Erro na campanha'
          : c.status === 'rejected' ? 'Campanha rejeitada'
            : isError ? 'Problema na conta ou orçamento (Verifique o TikTok Ads)' : null

    return (
      <article className={cn('border-b border-border/60 px-1 py-4', selected.has(id) && 'bg-primary/[0.03]')} aria-label={c.campaignName || id}>
        <div className="flex items-start gap-3">
          <input type="checkbox" checked={selected.has(id)} onChange={() => toggleSelect(id)} disabled={Boolean(busyId) || bulkBusy} aria-label={`Selecionar campanha ${c.campaignName || id}`} className="mt-1 size-4 rounded accent-primary" />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-semibold text-foreground">{cleanCampaignName(c.campaignName || id)}</h3>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span className={cn('inline-flex items-center gap-1.5', STATUS_META[c.status ?? '']?.cls || 'text-muted-foreground')}><span className={cn('size-1.5 rounded-full', STATUS_META[c.status ?? '']?.dot || 'bg-muted-foreground')} />{STATUS_META[c.status ?? '']?.label || c.status || '—'}</span>
                  {c.campaignKind === 'smart_plus' ? <span>· Smart+</span> : null}
                  {c.reviewStatus === 'approved' ? <span className="text-success">· Aprovada</span> : null}
                  {c.childStatus && c.childStatus !== c.status ? <span className="text-warning">· Anúncios {STATUS_META[c.childStatus]?.label || 'ver detalhes'}</span> : null}
                </div>
              </div>
              <CampaignQuickActionsDropdown campaign={c} currency={currency} busy={busy} disabled={Boolean(busyId) || bulkBusy} isOpen={isOpen} onToggleExpand={() => toggle(id)} onDuplicate={onDuplicate} onOpenDetail={onOpenDetail} onToggleStatus={() => c.status === 'active' ? void setCampaignStatus(c, 'paused') : setActivation({ kind: 'single', campaign: c })} />
            </div>

            {detailedError ? <p className="mt-2 flex items-start gap-1.5 text-xs text-error"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{detailedError}</p> : null}

            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs tabular-nums">
              <p><span className="text-muted-foreground">Gasto · </span><span className="font-medium text-foreground">{metrics.spend === null ? '—' : fmtMoney(metrics.spend, campaignCurrency)}</span></p>
              <p><span className="text-muted-foreground">Vendas · </span><span className="font-medium text-foreground">{realSales === null ? '—' : realSales.toLocaleString('pt-BR')}</span></p>
              <p><span className="text-muted-foreground">CPA · </span><span className="font-medium text-foreground">{realCpa === null ? '—' : fmtMoney(realCpa, campaignCurrency)}</span></p>
              <p><span className="text-muted-foreground">ROAS · </span><span className={cn('font-semibold', realRoas !== null && realRoas >= 2 ? 'text-success' : realRoas !== null && realRoas < 1 ? 'text-warning' : 'text-foreground')}>{realRoas === null ? '—' : `${realRoas.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}×`}</span></p>
            </div>

            <div className="mt-3 flex flex-col gap-2 border-t border-border/50 pt-3 text-xs">
              <div className="flex items-center justify-between gap-3"><span className="text-muted-foreground">Orçamento</span>{c.budgetOwner === 'campaign' && c.budget?.amount != null ? <BudgetControl entityId={id} amount={Number(c.budget.amount)} type={c.budget.type === 'lifetime' ? 'lifetime' : 'daily'} adAccountId={c.platformAdAccountId || ''} currency={campaignCurrency} label="Orçamento" onSaved={onMutate} compact /> : <span className="font-medium text-foreground">Nos conjuntos</span>}</div>
              <button type="button" onClick={automation.actionable && onOpenAutomations ? onOpenAutomations : undefined} disabled={!automation.actionable || !onOpenAutomations} className="flex items-center justify-between gap-3 text-left disabled:cursor-default"><span className="text-muted-foreground">Automação</span><span className={cn('font-medium', automationToneClass(automation.tone))}>{automation.label}</span></button>
              <div className="flex items-center justify-between gap-3"><span className="text-muted-foreground">Estrutura</span><button type="button" onClick={() => toggle(id)} aria-expanded={isOpen} className="inline-flex items-center gap-1 font-medium text-foreground hover:text-primary">{adSetCount} {adSetCount === 1 ? 'grupo' : 'grupos'} · {adCount} {adCount === 1 ? 'anúncio' : 'anúncios'}<ChevronRight className={cn('size-3.5 transition-transform', isOpen && 'rotate-90')} /></button></div>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <CampaignActivationToggle status={c.status} busy={busy} disabled={Boolean(busyId) || bulkBusy} onToggle={() => c.status === 'active' ? void setCampaignStatus(c, 'paused') : setActivation({ kind: 'single', campaign: c })} name={c.campaignName || id} />
              <span className="text-xs text-muted-foreground">{c.status === 'active' ? 'Pausar campanha' : c.status === 'paused' ? 'Ativar campanha' : STATUS_META[c.status ?? '']?.label || ''}</span>
            </div>
          </div>
        </div>
        {isOpen && <div className="mt-3">{renderExpandedContent(c)}</div>}
      </article>
    )
  }

  function TableHeader() {
    return (
      <div className="sticky top-0 z-10 grid min-w-[1160px] grid-cols-[38px_68px_minmax(230px,2fr)_150px_95px_70px_95px_80px_160px_110px_60px] items-center border-b border-border bg-background px-3 py-2.5 text-xs font-medium text-muted-foreground">
        <div className="flex items-center justify-center"><input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAll} aria-label="Selecionar todas as campanhas visíveis" className="size-3.5 cursor-pointer rounded accent-primary" /></div>
        <div>Status</div>
        <button type="button" className="flex items-center gap-1 pr-3 text-left transition-colors hover:text-foreground" onClick={() => onSort(sort === 'newest' ? 'oldest' : 'newest')} title="Clique para alternar ordenação por data"><span>Campanha</span><ArrowUpDown className="size-3" /></button>
        <div className="pr-2 text-right">Orçamento</div>
        <button type="button" className="flex items-center justify-end gap-1 pr-2 transition-colors hover:text-foreground" onClick={() => onSort(sort === 'spend_desc' ? 'spend_asc' : 'spend_desc')} title="Clique para ordenar por gasto (maior / menor)"><span>Gasto</span>{sort === 'spend_desc' ? <ArrowDown className="size-3 text-primary" /> : sort === 'spend_asc' ? <ArrowUp className="size-3 text-primary" /> : <ArrowUpDown className="size-3" />}</button>
        <div className="pr-2 text-right" title="Vendas rastreadas pelo ROINADOS">Vendas</div>
        <div className="pr-2 text-right" title="Gasto TikTok ÷ vendas reais">CPA real</div>
        <div className="pr-2 text-right" title="Receita real ÷ gasto TikTok">ROAS real</div>
        <div className="pr-2 text-left">Automação</div>
        <div className="text-center"><button type="button" onClick={toggleAllExpanded} className="text-xs text-muted-foreground transition-colors hover:text-foreground hover:underline" title={allExpanded ? 'Recolher todas as campanhas' : 'Expandir todas as campanhas'}>{allExpanded ? 'Recolher tudo' : 'Estrutura'}</button></div>
        <div className="text-right">Ações</div>
      </div>
    )
  }

  function renderFlatRow(row: FlatRow, index?: number) {
    if (row.kind === 'group') return renderGroupHeader(row, index)
    return renderCampaignTableRow(row.c, index)
  }

  function entityStatusMatches(status?: AdsNodeStatus) {
    if (entityStatusFilter === 'all') return true
    if (entityStatusFilter === 'issues') return status === 'error' || status === 'rejected' || status === 'pending_review'
    return status === entityStatusFilter
  }

  function sortEntityRows<T extends { metrics?: AdsTreeAd['metrics'] }>(rows: T[]) {
    return [...rows].sort((a, b) => {
      if (entitySort === 'ctr_desc') return Number(b.metrics?.ctr || 0) - Number(a.metrics?.ctr || 0)
      if (entitySort === 'conversions_desc') return Number(b.metrics?.conversions || 0) - Number(a.metrics?.conversions || 0)
      return Number(b.metrics?.spend || 0) - Number(a.metrics?.spend || 0)
    })
  }

  function EntityToolbar({ visibleCount, totalCount }: { visibleCount: number; totalCount: number }) {
    return <div className="flex flex-wrap items-center gap-2 border-b border-border/60 bg-secondary/5 px-3 py-2.5">
      <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-background p-1">
        {([['all', 'Todos'], ['active', 'Ativos'], ['paused', 'Pausados'], ['issues', 'Atenção']] as const).map(([value, label]) => <button key={value} type="button" onClick={() => setEntityStatusFilter(value)} className={cn('h-7 rounded-md px-2.5 text-xs font-medium transition-colors', entityStatusFilter === value ? 'bg-secondary text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>{label}</button>)}
      </div>
      <label className="inline-flex h-9 items-center gap-2 rounded-lg border border-border/60 bg-background px-2.5 text-xs text-muted-foreground"><ArrowUpDown className="size-3.5" /><select value={entitySort} onChange={(e) => setEntitySort(e.target.value as typeof entitySort)} className="bg-transparent font-medium text-foreground outline-none"><option value="spend_desc">Maior gasto</option><option value="ctr_desc">Maior CTR</option><option value="conversions_desc">Mais conversões</option></select></label>
      <button type="button" onClick={() => setOnlyWithSpend((value) => !value)} className={cn('inline-flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium', onlyWithSpend ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border/60 bg-background text-muted-foreground')}><DollarSign className="size-3.5" />Com gasto</button>
      <span className="ml-auto text-xs tabular-nums text-muted-foreground">{visibleCount} de {totalCount}</span>
    </div>
  }

  function EntityWorkspace() {
    const bulkBar = selectedEntities.size ? <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 border-b border-primary/20 bg-background/95 px-3 py-2.5 shadow-sm backdrop-blur">
      <span className="text-xs font-semibold text-foreground">{selectedEntities.size} selecionado{selectedEntities.size === 1 ? '' : 's'}</span>
      <button type="button" disabled={bulkBusy} onClick={() => void applyEntityBulkStatus('active')} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-success/30 bg-success/10 px-2.5 text-xs font-medium text-success disabled:opacity-50"><Play className="size-3" />Ativar</button>
      <button type="button" disabled={bulkBusy} onClick={() => void applyEntityBulkStatus('paused')} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-warning/30 bg-warning/10 px-2.5 text-xs font-medium text-warning disabled:opacity-50"><Pause className="size-3" />Pausar</button>
      <button type="button" disabled={bulkBusy} onClick={() => setSelectedEntities(new Set())} className="ml-auto text-xs text-muted-foreground hover:text-foreground">Limpar seleção</button>
    </div> : null

    if (entityLevel === 'campaign') return null
    if (entityLevel === 'adgroup') {
      const allRows = campaigns.flatMap((campaign) => (campaign.adSets || []).map((group) => ({ campaign, group })))
      const rows = sortEntityRows(allRows.filter(({ campaign, group }) => {
        if (onlyWithSpend && !(Number(group.metrics?.spend) > 0)) return false
        if (!q || natural.structured) return true
        return normalizeSearch(String(group.adSetName || group.name || group.platformAdSetId)).includes(q)
          || normalizeSearch(String(campaign.campaignName || campaign.platformCampaignId)).includes(q)
      }).filter(({ group }) => entityStatusMatches(group.status)).map(({ campaign, group }) => ({ campaign, group, metrics: group.metrics }))).map(({ campaign, group }) => ({ campaign, group }))
      const all = rows.length > 0 && rows.every(({ group }) => selectedEntities.has(String(group.platformAdSetId)))
      return <div className="overflow-x-auto border-b border-border/60">{bulkBar}<EntityToolbar visibleCount={rows.length} totalCount={allRows.length} /><div className="min-w-[980px]">
        <div className="grid grid-cols-[36px_minmax(240px,1.5fr)_minmax(220px,1.2fr)_110px_120px_100px_100px_110px] items-center gap-3 border-b border-border/60 px-3 py-2.5 text-xs font-medium text-muted-foreground"><input type="checkbox" checked={all} onChange={() => setSelectedEntities(all ? new Set() : new Set(rows.map(({ group }) => String(group.platformAdSetId))))} aria-label="Selecionar todos os conjuntos" className="size-3.5 accent-primary" /><span>Conjunto</span><span>Campanha</span><span>Status</span><span className="text-right">Orçamento</span><span className="text-right">Gasto</span><span className="text-right">CTR</span><span className="text-right">Conversões</span></div>
        {rows.map(({ campaign, group }) => <div key={group.platformAdSetId} className="grid grid-cols-[36px_minmax(240px,1.5fr)_minmax(220px,1.2fr)_110px_120px_100px_100px_110px] items-center gap-3 border-b border-border/40 px-3 py-3 text-xs hover:bg-muted/20">
          <input type="checkbox" checked={selectedEntities.has(String(group.platformAdSetId))} onChange={() => toggleEntitySelection(String(group.platformAdSetId))} aria-label={`Selecionar conjunto ${group.adSetName || group.platformAdSetId}`} className="size-3.5 accent-primary" />
          <div className="min-w-0"><p className="truncate font-semibold text-foreground">{group.adSetName || group.name || group.platformAdSetId}</p><p className="mt-0.5 text-muted-foreground">{group.ads?.length || 0} anúncio{(group.ads?.length || 0) === 1 ? '' : 's'} · controle independente</p></div>
          <p className="truncate text-muted-foreground">{cleanCampaignName(campaign.campaignName || campaign.platformCampaignId)}</p><CampaignActivationToggle entityLabel="conjunto" status={group.status} busy={busyId === String(group.platformAdSetId)} disabled={Boolean(busyId) || bulkBusy} onToggle={() => void setEntityStatus(String(group.platformAdSetId), group.status === 'active' ? 'paused' : 'active', 'Conjunto')} name={group.adSetName || group.platformAdSetId} />
          <p className="text-right tabular-nums text-foreground">{group.budget?.amount != null ? fmtMoney(Number(group.budget.amount), campaign.currency || currency) : '—'}</p><p className="text-right tabular-nums text-foreground">{fmtMoney(Number(group.metrics?.spend || 0), campaign.currency || currency)}</p><p className="text-right tabular-nums text-foreground">{Number(group.metrics?.ctr || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%</p><p className="text-right tabular-nums text-foreground">{Number(group.metrics?.conversions || 0).toLocaleString('pt-BR')}</p>
        </div>)}{!rows.length ? <p className="px-3 py-10 text-center text-sm text-muted-foreground">Nenhum conjunto disponível nesta conta.</p> : null}
      </div></div>
    }
    const allRows = campaigns.flatMap((campaign) => (campaign.adSets || []).flatMap((group) => (group.ads || []).map((ad) => ({ campaign, group, ad }))))
    const rows = sortEntityRows(allRows.filter(({ campaign, group, ad }) => {
      if (onlyWithSpend && !(Number(ad.metrics?.spend) > 0)) return false
      if (!q || natural.structured) return true
      return normalizeSearch(String(ad.name || ad.platformAdId || ad._id)).includes(q)
        || normalizeSearch(String(ad.creative?.body || '')).includes(q)
        || normalizeSearch(String(group.adSetName || group.name || group.platformAdSetId)).includes(q)
        || normalizeSearch(String(campaign.campaignName || campaign.platformCampaignId)).includes(q)
    }).filter(({ ad }) => entityStatusMatches(ad.status)).map(({ campaign, group, ad }) => ({ campaign, group, ad, metrics: ad.metrics }))).map(({ campaign, group, ad }) => ({ campaign, group, ad }))
    const all = rows.length > 0 && rows.every(({ ad }) => selectedEntities.has(String(ad.platformAdId || ad._id)))
    return <div className="overflow-x-auto border-b border-border/60">{bulkBar}<EntityToolbar visibleCount={rows.length} totalCount={allRows.length} /><div className="min-w-[1160px]">
      <div className="grid grid-cols-[36px_86px_minmax(220px,1.4fr)_minmax(180px,1fr)_minmax(180px,1fr)_100px_90px_90px_110px_100px] items-center gap-3 border-b border-border/60 px-3 py-2.5 text-xs font-medium text-muted-foreground"><input type="checkbox" checked={all} onChange={() => setSelectedEntities(all ? new Set() : new Set(rows.map(({ ad }) => String(ad.platformAdId || ad._id))))} aria-label="Selecionar todos os anúncios" className="size-3.5 accent-primary" /><span>Criativo</span><span>Anúncio</span><span>Conjunto</span><span>Campanha</span><span>Status</span><span className="text-right">Gasto</span><span className="text-right">CTR</span><span className="text-right">Conversões</span><span>Sinal</span></div>
      {rows.map(({ campaign, group, ad }) => { const id = String(ad.platformAdId || ad._id); const videoUrl = /^https:\/\//i.test(ad.creative?.videoUrl || '') ? ad.creative?.videoUrl : ''; const imageUrl = /^https:\/\//i.test(ad.creative?.imageUrl || '') ? ad.creative?.imageUrl : ''; const hasAsset = Boolean(videoUrl || imageUrl || ad.creative?.videoId || ad.creative?.imageIds?.length); return <div key={id} className="grid grid-cols-[36px_86px_minmax(220px,1.4fr)_minmax(180px,1fr)_minmax(180px,1fr)_100px_90px_90px_110px_100px] items-center gap-3 border-b border-border/40 px-3 py-2.5 text-xs hover:bg-muted/20">
        <input type="checkbox" checked={selectedEntities.has(id)} onChange={() => toggleEntitySelection(id)} aria-label={`Selecionar anúncio ${ad.name || id}`} className="size-3.5 accent-primary" />
        <button type="button" onClick={() => setCreativeInspect({ campaign, group, ad })} className="group relative flex h-16 w-11 items-center justify-center overflow-hidden rounded-md border border-border/50 bg-black focus-visible:ring-2 focus-visible:ring-primary" title="Abrir central do criativo">{videoUrl ? <video src={videoUrl} poster={imageUrl || undefined} muted playsInline preload="metadata" className="h-full w-full object-cover" /> : imageUrl ? <img src={imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" /> : hasAsset ? <Play className="size-4 text-white/70" aria-label="Asset TikTok identificado; prévia pendente" /> : <span className="text-[9px] text-white/45">—</span>}<span className="absolute inset-0 hidden items-center justify-center bg-black/35 group-hover:flex"><Play className="size-4 fill-white text-white" /></span></button>
        <button type="button" onClick={() => setCreativeInspect({ campaign, group, ad })} className="min-w-0 text-left"><p className="truncate font-semibold text-foreground hover:text-primary">{ad.name || ad.platformAdId}</p><p className="mt-0.5 truncate text-muted-foreground">{ad.creative?.body || (hasAsset ? 'Asset TikTok identificado' : 'Sem criativo informado')}</p></button><p className="truncate text-muted-foreground">{group.adSetName || group.name || group.platformAdSetId}</p><p className="truncate text-muted-foreground">{cleanCampaignName(campaign.campaignName || campaign.platformCampaignId)}</p><CampaignActivationToggle entityLabel="anúncio" status={ad.status} busy={busyId === id} disabled={Boolean(busyId) || bulkBusy} onToggle={() => void setEntityStatus(id, ad.status === 'active' ? 'paused' : 'active', 'Anúncio')} name={ad.name || ad.platformAdId} /><p className="text-right tabular-nums text-foreground">{fmtMoney(Number(ad.metrics?.spend || 0), campaign.currency || currency)}</p><p className="text-right tabular-nums text-foreground">{Number(ad.metrics?.ctr || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%</p><p className="text-right tabular-nums text-foreground">{Number(ad.metrics?.conversions || 0).toLocaleString('pt-BR')}</p><span className={cn('text-xs font-medium', creativeSignal(ad).cls)} title={creativeSignal(ad).title}>{creativeSignal(ad).label}</span>
      </div>})}{!rows.length ? <p className="px-3 py-10 text-center text-sm text-muted-foreground">Nenhum anúncio disponível nesta conta.</p> : null}
    </div></div>
  }

  const selectedCampaigns = campaigns.filter((campaign) => selected.has(campaign.platformCampaignId))
  const selectedActiveCampaigns = selectedCampaigns.filter((campaign) => campaign.status === 'active')
  const selectedPausedCampaigns = selectedCampaigns.filter((campaign) => campaign.status === 'paused')
  const selectedNotPausedCount = selectedCampaigns.length - selectedPausedCampaigns.length
  const activationBudgetSummary = budgetSummary(selectedPausedCampaigns, currency)
  const ineligibleBudgetCount = selectedCampaigns.filter((campaign) => campaign.budgetOwner !== 'campaign' || !Number.isFinite(campaign.budget?.amount) || !['daily', 'lifetime'].includes(campaign.budget?.type || '')).length
  const bulkBudgetEligible = selectedCampaigns.length > 0 && ineligibleBudgetCount === 0
  const bulkBudgetNumericValue = Number(bulkBudgetValue.replace(',', '.'))
  const bulkBudgetValueValid = Number.isFinite(bulkBudgetNumericValue)
    && bulkBudgetNumericValue > 0
    && (bulkBudgetMode !== 'fixed' || bulkBudgetNumericValue >= TIKTOK_MIN_BUDGET)
  const bulkBudgetImpact = budgetImpactSummary(selectedCampaigns, bulkBudgetMode, bulkBudgetValueValid ? bulkBudgetNumericValue : Number.NaN, currency)

  return (
    <section className="min-w-0">
      <div className="space-y-3 border-b border-border/60 pb-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex rounded-lg border border-border/70 bg-secondary/20 p-1" role="tablist" aria-label="Nível da estrutura de mídia">
                {([['campaign', 'Campanhas', campaigns.length], ['adgroup', 'Conjuntos', adGroupCount], ['ad', 'Anúncios', adCount]] as const).map(([level, label, count]) => <button key={level} type="button" role="tab" aria-selected={entityLevel === level} onClick={() => setEntityLevel(level)} className={cn('inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-semibold transition-colors', entityLevel === level ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>{label}<span className="tabular-nums opacity-60">{count}</span></button>)}
              </div>
              <span className="text-xs text-muted-foreground">{entityLevel === 'campaign' ? 'Visão de resultado e automação' : entityLevel === 'adgroup' ? 'Estrutura e orçamento por conjunto' : 'Performance e criativos por anúncio'}</span>
            </div>
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-2 lg:max-w-2xl lg:items-end">
            <div className="flex w-full min-w-0 flex-wrap items-center justify-end gap-2">
              <div className="relative min-w-[220px] flex-1 lg:max-w-md">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={entityLevel === 'campaign' ? 'Buscar campanha ou filtrar por resultado…' : entityLevel === 'adgroup' ? 'Buscar conjunto ou campanha…' : 'Buscar anúncio, copy, conjunto ou campanha…'} aria-label="Buscar campanha ou filtrar por resultado" className="h-10 w-full rounded-lg border border-border/70 bg-background pl-9 pr-8 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-primary/60 focus:outline-none focus:ring-1 focus:ring-primary/30" />
                {query ? <button type="button" onClick={() => setQuery('')} aria-label="Limpar busca" className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"><X className="size-3.5" /></button> : null}
              </div>
              {entityLevel === 'campaign' ? <>
                <button type="button" onClick={() => setQuickFilter((curr) => curr === 'no_sales' ? 'all' : 'no_sales')} aria-pressed={quickFilter === 'no_sales'} disabled={!decisions} className={cn('inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors', quickFilter === 'no_sales' ? 'border-warning/40 bg-warning/10 text-warning' : 'border-border/70 bg-background text-muted-foreground hover:text-foreground')} title="Campanhas com gasto e sem vendas"><AlertCircle className="size-3.5" aria-hidden="true" />Gastou sem vender</button>
                <button type="button" onClick={() => setShowFilters((value) => !value)} aria-expanded={showFilters} className={cn('inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors', showFilters ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border/70 bg-background text-muted-foreground hover:text-foreground')}><SlidersHorizontal className="size-3.5" aria-hidden="true" />Filtros</button>
              </> : null}
            </div>
            {!query && entityLevel === 'campaign' ? <p className="w-full text-xs text-muted-foreground lg:text-right">Ex.: sem venda · ROAS acima de 2 · gasto acima de 100</p> : null}
          </div>
        </div>

        {showFilters && entityLevel === 'campaign' ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtrar por status">
              {STATUS_FILTERS.map((filter) => {
                const count = filter.value === '' ? statusCounts.all : (statusCounts[filter.value] ?? 0)
                const isSelected = statusFilter === filter.value
                return <button key={filter.value} type="button" onClick={() => onStatusFilter(filter.value)} aria-pressed={isSelected} className={cn('inline-flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors', isSelected ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border/60 bg-background text-muted-foreground hover:text-foreground')}>{filter.label}<span className="tabular-nums opacity-70">{count}</span></button>
              })}
            </div>
            <button type="button" onClick={() => setOnlyWithSpend((value) => !value)} aria-pressed={onlyWithSpend} className={cn('inline-flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium', onlyWithSpend ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border/60 bg-background text-muted-foreground')}><DollarSign className="size-3.5" />Com gasto</button>
            <button type="button" disabled={!decisions} onClick={() => setQuickFilter((curr) => curr === 'with_sales' ? 'all' : 'with_sales')} aria-pressed={quickFilter === 'with_sales'} className={cn('inline-flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium', quickFilter === 'with_sales' ? 'border-success/30 bg-success/10 text-success' : 'border-border/60 bg-background text-muted-foreground')}><TrendingUp className="size-3.5" />Com vendas</button>
            <button type="button" disabled={!decisions} onClick={() => setQuickFilter((curr) => curr === 'high_roas' ? 'all' : 'high_roas')} aria-pressed={quickFilter === 'high_roas'} className={cn('inline-flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium', quickFilter === 'high_roas' ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border/60 bg-background text-muted-foreground')}><Zap className="size-3.5" />ROAS &gt; 2×</button>
            <div className="ml-auto flex items-center gap-1.5">
              <div className="relative flex items-center"><ArrowUpDown className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><select className="h-9 rounded-lg border border-border/60 bg-background pl-7 pr-3 text-xs font-medium text-foreground focus:border-primary/50 focus:outline-none" value={sort} onChange={(e) => onSort(e.target.value)} aria-label="Ordenar campanhas">{SORTS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>
              {(quickFilter !== 'all' || onlyWithSpend || sort !== 'newest' || statusFilter !== 'active' || query) ? <button type="button" onClick={() => { setOnlyWithSpend(false); setQuickFilter('all'); onSort('newest'); onStatusFilter('active'); setQuery('') }} className="flex h-9 items-center gap-1 rounded-lg border border-border/60 bg-background px-2.5 text-xs text-muted-foreground hover:text-foreground"><RotateCcw className="size-3" />Limpar</button> : null}
            </div>
          </div>
        ) : null}
      </div>

      {!loading && !error && campaigns.length ? <div className="grid grid-cols-2 gap-2 border-b border-border/60 py-3 sm:grid-cols-3 xl:grid-cols-6">
        <div className="rounded-lg border border-border/60 bg-background px-3 py-2.5"><p className="text-[11px] font-medium text-muted-foreground">{entityLevel === 'campaign' ? 'Campanhas' : entityLevel === 'adgroup' ? 'Conjuntos' : 'Anúncios'}</p><p className="mt-1 text-lg font-semibold tabular-nums text-foreground">{commandCenter.total}</p><p className="text-[11px] text-muted-foreground">{commandCenter.active} ativos</p></div>
        <div className="rounded-lg border border-border/60 bg-background px-3 py-2.5"><p className="text-[11px] font-medium text-muted-foreground">Gasto no período</p><p className="mt-1 text-lg font-semibold tabular-nums text-foreground">{fmtMoney(commandCenter.spend, currency)}</p><p className="text-[11px] text-muted-foreground">{entityLevel === 'campaign' && commandCenter.campaignSales != null ? `${commandCenter.campaignSales} ${commandCenter.campaignSales === 1 ? 'venda real' : 'vendas reais'}` : `${commandCenter.conversions} conversão${commandCenter.conversions === 1 ? '' : 'ões'} TikTok`}</p></div>
        <div className="rounded-lg border border-border/60 bg-background px-3 py-2.5"><p className="text-[11px] font-medium text-muted-foreground">{entityLevel === 'campaign' ? 'ROAS real' : 'CTR médio ponderado'}</p><p className="mt-1 text-lg font-semibold tabular-nums text-foreground">{entityLevel === 'campaign' ? (commandCenter.roas == null ? '—' : `${commandCenter.roas.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}×`) : (commandCenter.spend > 0 ? `${(sourceWeightedCtr(entityLevel === 'adgroup' ? campaigns.flatMap((c) => c.adSets || []) : campaigns.flatMap((c) => (c.adSets || []).flatMap((g) => g.ads || [])))).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%` : '—')}</p><p className="text-[11px] text-muted-foreground">{entityLevel === 'campaign' ? 'Receita first-party ÷ gasto' : 'Sinal de entrega'}</p></div>
        <button type="button" onClick={() => entityLevel === 'campaign' ? setQuickFilter('no_sales') : setEntityStatusFilter('issues')} className={cn('rounded-lg border px-3 py-2.5 text-left transition-colors hover:bg-secondary/20', (entityLevel === 'campaign' ? commandCenter.spentNoSales : commandCenter.issues) ? 'border-warning/30 bg-warning/5' : 'border-border/60 bg-background')}><p className="text-[11px] font-medium text-muted-foreground">Precisa de atenção</p><p className={cn('mt-1 text-lg font-semibold tabular-nums', (entityLevel === 'campaign' ? commandCenter.spentNoSales : commandCenter.issues) ? 'text-warning' : 'text-foreground')}>{entityLevel === 'campaign' ? commandCenter.spentNoSales : commandCenter.issues}</p><p className="text-[11px] text-muted-foreground">{entityLevel === 'campaign' ? 'Com gasto e sem venda real' : 'Revisão, erro ou rejeição'}</p></button>
        <button type="button" onClick={onOpenAutomations} disabled={!onOpenAutomations} className="rounded-lg border border-border/60 bg-background px-3 py-2.5 text-left transition-colors hover:bg-secondary/20 disabled:cursor-default"><p className="text-[11px] font-medium text-muted-foreground">Propostas ROI NADOS</p><p className={cn('mt-1 text-lg font-semibold tabular-nums', commandCenter.pendingProposals ? 'text-primary' : 'text-foreground')}>{commandCenter.pendingProposals}</p><p className="text-[11px] text-muted-foreground">Aguardando decisão</p></button>
        <button type="button" onClick={onOpenAutomations} disabled={!onOpenAutomations} className="rounded-lg border border-border/60 bg-background px-3 py-2.5 text-left transition-colors hover:bg-secondary/20 disabled:cursor-default"><p className="text-[11px] font-medium text-muted-foreground">Autonomia</p><p className="mt-1 truncate text-sm font-semibold text-foreground">{!decisions ? 'Indisponível' : decisions.automation.actionsPaused ? 'Pausada' : decisions.automation.executionMode === 'automatic' ? 'Autopilot' : decisions.automation.executionMode === 'proposal' ? 'Assistida' : decisions.automation.executionMode === 'notify' ? 'Monitorar' : decisions.automation.executionMode === 'simulation' ? 'Simulação' : 'Personalizada'}</p><p className="text-[11px] text-muted-foreground">{decisions ? `${decisions.automation.rulesEnabled} regra${decisions.automation.rulesEnabled === 1 ? '' : 's'} ativa${decisions.automation.rulesEnabled === 1 ? '' : 's'}` : 'Sem estado do motor'}</p></button>
      </div> : null}

      {decisions ? <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border/60 bg-secondary/10 px-3 py-2.5 text-xs">
        <div className="flex items-center gap-2"><span className={cn('size-2 rounded-full', decisions.automation.actionsPaused ? 'bg-warning' : decisions.automation.state === 'running' ? 'bg-success' : 'bg-primary')} /><span className="font-semibold text-foreground">ROI NADOS Control</span></div>
        <span className="text-muted-foreground">Modo <strong className="font-medium text-foreground">{decisions.automation.actionsPaused ? 'Pausado' : decisions.automation.executionMode === 'proposal' ? 'Assistido' : decisions.automation.executionMode === 'automatic' ? 'Autopilot' : decisions.automation.executionMode === 'notify' ? 'Monitorar' : decisions.automation.executionMode === 'simulation' ? 'Simulação' : 'Personalizado'}</strong></span>
        <span className="text-muted-foreground">{decisions.automation.rulesEnabled} regra{decisions.automation.rulesEnabled === 1 ? '' : 's'} ativa{decisions.automation.rulesEnabled === 1 ? '' : 's'}</span>
        <span className="text-muted-foreground">{decisions.automation.alertsEnabled ? 'Alertas ativos' : 'Alertas desativados'}</span>
        {onOpenAutomations ? <button type="button" onClick={onOpenAutomations} className="ml-auto inline-flex items-center gap-1 font-medium text-primary hover:underline"><Zap className="size-3" />Configurar autonomia</button> : null}
      </div> : null}

      {entityLevel !== 'campaign' && !loading && !error ? <EntityWorkspace /> : null}

      {entityLevel === 'campaign' && isMobile && visible.length > 0 ? (
        <label className="flex items-center gap-2 border-b border-border/60 py-2.5 text-xs font-medium text-foreground">
          <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAll} aria-label="Selecionar todas as campanhas visíveis" className="size-4 rounded accent-primary" />
          Selecionar tudo · {visible.length} campanha{visible.length === 1 ? '' : 's'}
        </label>
      ) : null}

      {entityLevel === 'campaign' && tree?.backfillPending && (
        <p className="flex items-center gap-2 border-b border-border/60 py-2.5 text-xs text-warning">
          <Loader2 className="size-3 animate-spin" aria-hidden="true" />
          Importando histórico do TikTok — as métricas podem levar alguns minutos para completar.
        </p>
      )}

      {/* Corpo: loading / erro / vazio / linhas */}
      {entityLevel === 'campaign' && (loading ? (
        <div className="flex flex-col divide-y divide-border/50">
          {[0, 1, 2, 3].map((i) => <div key={i} className="space-y-2 py-4"><Skeleton className="h-4 w-56 max-w-full rounded" /><Skeleton className="h-3 w-80 max-w-full rounded" /></div>)}
        </div>
      ) : error ? (
        <div className="p-6">
          <ErrorState title="Não foi possível carregar as campanhas" description={error} onRetry={onRetry} />
        </div>
      ) : campaigns.length > 0 && visible.length === 0 ? (
        /* Há campanhas, mas a busca/filtro local não achou nada */
        <div className="py-12 text-center">
          <p className="text-sm font-medium text-foreground">Nenhuma campanha corresponde à busca.</p>
          <button type="button" className="btn-ghost mt-2 text-xs" onClick={() => { setQuery(''); onStatusFilter('active'); setOnlyWithSpend(false); setQuickFilter('all') }}>Limpar busca e filtros</button>
        </div>
      ) : campaigns.length === 0 ? (
        tree?.backfillPending ? (
          /* Conta recém-conectada: o sync ainda está importando do TikTok —
             NÃO é "sem campanhas", é sincronização em andamento. */
          <div className="py-12 text-center">
            <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" aria-hidden="true" />
            <p className="mt-3 text-sm font-medium text-foreground">Sincronizando campanhas do TikTok…</p>
            <p className="mx-auto mt-1 max-w-sm text-pretty text-xs text-muted-foreground">A primeira importação pode levar de 1 a 3 minutos. Suas campanhas vão aparecer aqui automaticamente — não precisa reconectar.</p>
          </div>
        ) : (
          <div className="py-12 text-center">
            <p className="text-sm font-medium text-foreground">{statusFilter ? 'Nenhuma campanha com esse status' : 'Nenhuma campanha neste período'}</p>
            <p className="mx-auto mt-1 max-w-sm text-pretty text-xs text-muted-foreground">{statusFilter ? 'Escolha Todas para ver as demais campanhas da conta.' : 'Esta conta de anúncio não tem campanhas neste período. Aumente o Período acima ou use “Criar campanha”.'}</p>
          </div>
        )
      ) : (
        isMobile ? (
          <div className="min-w-0">
            {flatRows.map((row) => row.kind === 'group' ? <div key={row.key}>{renderGroupHeader(row, undefined, true)}</div> : <div key={row.key}>{renderCampaignCardRow(row.c)}</div>)}
          </div>
        ) : (
          <div ref={scrollRef} style={{ overflow: 'auto' }} className={`${virtualize ? 'h-[72vh]' : 'max-h-[72vh]'} campaign-table-container overflow-auto`}>
            <TableHeader />
            {virtualize ? (
              <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative', minWidth: '1160px' }}>
                {rowVirtualizer.getVirtualItems().map((vi) => {
                  const row = flatRows[vi.index]
                  return <div key={vi.key} data-index={vi.index} ref={rowVirtualizer.measureElement} style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vi.start}px)` }}>{renderFlatRow(row, vi.index)}</div>
                })}
              </div>
            ) : (
              <div style={{ minWidth: '1160px' }}>{flatRows.map((row, index) => <div key={row.key}>{renderFlatRow(row, index)}</div>)}</div>
            )}
          </div>
        )
      )}

      {/* Paginação */}
      {entityLevel === 'campaign' && pagination && pagination.pages > 1 && (
        <div className="flex items-center justify-between border-t border-border/60 py-3 text-xs text-muted-foreground">
          <span>
            Página {pagination.page} de {pagination.pages} · {pagination.total} campanha{pagination.total === 1 ? '' : 's'}
          </span>
          <div className="flex items-center gap-1">
            <button type="button" className="btn-ghost min-h-10 px-3 text-xs" disabled={page <= 1} onClick={() => onPage(page - 1)}>
              Anterior
            </button>
            <button
              type="button"
              className="btn-ghost min-h-10 px-3 text-xs"
              disabled={page >= pagination.pages}
              onClick={() => onPage(page + 1)}
            >
              Próxima
            </button>
          </div>
        </div>
      ))}

      {creativeInspect ? <Modal open onClose={() => setCreativeInspect(null)} title="Central do criativo" description="Preview, contexto e performance do anúncio em um só lugar.">
        <div className="grid gap-5 md:grid-cols-[220px_minmax(0,1fr)]">
          <div className="mx-auto w-full max-w-[220px] overflow-hidden rounded-xl border border-border bg-black aspect-[9/16]">
            {/^(https:\/\/)/i.test(creativeInspect.ad.creative?.videoUrl || '') ? <video src={creativeInspect.ad.creative?.videoUrl} poster={creativeInspect.ad.creative?.imageUrl || undefined} controls playsInline preload="metadata" className="h-full w-full object-contain" /> : /^(https:\/\/)/i.test(creativeInspect.ad.creative?.imageUrl || '') ? <img src={creativeInspect.ad.creative?.imageUrl} alt="" className="h-full w-full object-contain" /> : <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-xs text-white/60"><Play className="size-7" /><span>Asset identificado<br />preview público indisponível</span></div>}
          </div>
          <div className="min-w-0 space-y-4">
            <div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Anúncio</p><p className="mt-1 text-base font-semibold text-foreground">{creativeInspect.ad.name || creativeInspect.ad.platformAdId}</p><p className="mt-1 text-sm text-muted-foreground">{creativeInspect.ad.creative?.body || 'Sem texto informado'}</p></div>
            <div className="grid grid-cols-3 gap-2 rounded-lg border border-border/60 bg-secondary/10 p-3"><div><p className="text-[11px] text-muted-foreground">Gasto</p><p className="mt-1 text-sm font-semibold">{fmtMoney(Number(creativeInspect.ad.metrics?.spend || 0), creativeInspect.campaign.currency || currency)}</p></div><div><p className="text-[11px] text-muted-foreground">CTR</p><p className="mt-1 text-sm font-semibold">{Number(creativeInspect.ad.metrics?.ctr || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%</p></div><div><p className="text-[11px] text-muted-foreground">Conversões</p><p className="mt-1 text-sm font-semibold">{Number(creativeInspect.ad.metrics?.conversions || 0).toLocaleString('pt-BR')}</p></div></div>
            <div className="space-y-2 text-xs"><p><span className="text-muted-foreground">Campanha:</span> {cleanCampaignName(creativeInspect.campaign.campaignName || creativeInspect.campaign.platformCampaignId)}</p><p><span className="text-muted-foreground">Conjunto:</span> {creativeInspect.group.adSetName || creativeInspect.group.name || creativeInspect.group.platformAdSetId}</p><p className="break-all"><span className="text-muted-foreground">Ad ID:</span> {creativeInspect.ad.platformAdId || creativeInspect.ad._id}</p>{creativeInspect.ad.creative?.videoId ? <p className="break-all"><span className="text-muted-foreground">Video ID:</span> {creativeInspect.ad.creative.videoId}</p> : null}{creativeInspect.ad.creative?.linkUrl ? <p className="break-all"><span className="text-muted-foreground">Destino:</span> {creativeInspect.ad.creative.linkUrl}</p> : null}</div>
            <div className="flex flex-wrap gap-2"><button type="button" className="btn-secondary text-xs" onClick={() => { setEditAd({ ad: creativeInspect.ad, adAccountId: creativeInspect.campaign.platformAdAccountId }); setCreativeInspect(null) }}><Pencil className="size-3.5" />Editar anúncio</button><button type="button" className="btn-ghost text-xs" onClick={() => void navigator.clipboard.writeText(String(creativeInspect.ad.platformAdId || creativeInspect.ad._id))}><Copy className="size-3.5" />Copiar ID</button></div>
          </div>
        </div>
      </Modal> : null}

      {/* Confirmação de exclusão de anúncio */}
      <ConfirmDialog
        open={Boolean(activation)}
        title={activation?.kind === 'bulk' ? `Ativar ${selectedPausedCampaigns.length} ${selectedPausedCampaigns.length === 1 ? 'campanha' : 'campanhas'}?` : 'Ativar esta campanha?'}
        description={activation?.kind === 'single' ? <><strong>{activation.campaign.campaignName || activation.campaign.platformCampaignId}</strong><br />Conta: {activation.campaign.platformAdAccountName || activation.campaign.platformAdAccountId}<br />Orçamento: {campaignBudget(activation.campaign).amount !== null ? fmtMoney(campaignBudget(activation.campaign).amount!, activation.campaign.currency || currency) : 'Definido nos conjuntos'} · {campaignBudget(activation.campaign).detail}<br />Ao ativar, a campanha poderá começar a gastar.</> : <>{selectedPausedCampaigns.length} {selectedPausedCampaigns.length === 1 ? 'campanha pausada será enviada' : 'campanhas pausadas serão enviadas'} para ativação.{activationBudgetSummary.length ? <><br />Orçamentos: {activationBudgetSummary.join(' · ')}</> : null}{selectedNotPausedCount > 0 ? <><br />{selectedNotPausedCount}{selectedNotPausedCount === 1 ? ' selecionada que já está ativa ou usa outro status não será enviada.' : ' selecionadas que já estão ativas ou usam outro status não serão enviadas.'}</> : null}<br />Ao ativar, essas campanhas poderão começar a gastar.</>}
        confirmLabel="Ativar"
        appearance="quiet"
        busy={activation?.kind === 'bulk' ? bulkBusy : Boolean(activation?.kind === 'single' && busyId === activation.campaign.platformCampaignId)}
        onConfirm={async () => {
          const ok = activation?.kind === 'bulk'
            ? await bulkStatus('active')
            : activation?.kind === 'single'
              ? await setCampaignStatus(activation.campaign, 'active')
              : false
          if (ok) setActivation(null)
        }}
        onClose={() => setActivation(null)}
      />

      <ConfirmDialog
        open={Boolean(deleteAd)}
        title="Excluir este anúncio?"
        description={
          <>
            O anúncio <strong>{deleteAd?.ad.name || deleteAd?.ad.platformAdId}</strong> será removido do TikTok Ads.
            Essa ação não pode ser desfeita.
          </>
        }
        confirmLabel="Excluir anúncio"
        appearance="quiet"
        busy={deleting}
        onConfirm={handleDeleteAd}
        onClose={() => setDeleteAd(null)}
      />

      {/* Edição de anúncio (texto/CTA/link) sem recriar */}
      <AdEditDialog key={`${editAd?.adAccountId}:${editAd?.ad.platformAdId || editAd?.ad._id || 'closed'}`}
        ad={editAd?.ad ?? null}
        adAccountId={editAd?.adAccountId ?? ''}
        onClose={() => setEditAd(null)}
        onSaved={() => onMutate?.()}
      />

      {/* Barra de ações em lote */}
      {entityLevel === 'campaign' && selected.size > 0 && (
        <div className="campaign-bulk-actions fixed bottom-5 left-1/2 z-40 flex max-w-[calc(100vw-24px)] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-xl border border-border bg-background px-3 py-2.5 shadow-lg sm:gap-3 sm:px-4">
          <span className="text-xs font-semibold text-foreground">{selected.size} selecionada{selected.size === 1 ? '' : 's'}</span>
          <button type="button" className="btn-secondary h-9 px-3 text-xs" onClick={() => void bulkStatus('paused')} disabled={bulkBusy || selectedActiveCampaigns.length === 0} title={selectedActiveCampaigns.length === 0 ? 'Nenhuma campanha ativa selecionada' : `Pausar ${selectedActiveCampaigns.length} campanha${selectedActiveCampaigns.length === 1 ? '' : 's'} ativa${selectedActiveCampaigns.length === 1 ? '' : 's'}`}><Pause className="size-3.5" />Pausar{selectedActiveCampaigns.length ? ` · ${selectedActiveCampaigns.length}` : ''}</button>
          <button type="button" className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50" onClick={() => setActivation({ kind: 'bulk' })} disabled={bulkBusy || selectedPausedCampaigns.length === 0} title={selectedPausedCampaigns.length === 0 ? 'Nenhuma campanha pausada selecionada' : `Ativar ${selectedPausedCampaigns.length} campanha${selectedPausedCampaigns.length === 1 ? '' : 's'} pausada${selectedPausedCampaigns.length === 1 ? '' : 's'}`}><Play className="size-3.5" />Ativar{selectedPausedCampaigns.length ? ` · ${selectedPausedCampaigns.length}` : ''}</button>
          <button type="button" className="btn-secondary h-9 px-3 text-xs" onClick={() => { if (bulkBudgetEligible) setBulkBudgetOpen(true) }} disabled={bulkBusy || !bulkBudgetEligible} title={!bulkBudgetEligible ? `${ineligibleBudgetCount} campanha${ineligibleBudgetCount === 1 ? '' : 's'} usam orçamento nos conjuntos ou não têm orçamento compatível.` : 'Ajustar orçamentos'}><DollarSign className="size-3.5" />Orçamento</button>
          <button type="button" className="btn-ghost h-9 px-2 text-xs text-muted-foreground" onClick={() => setSelected(new Set())} disabled={bulkBusy}>Limpar</button>
          {!bulkBudgetEligible && ineligibleBudgetCount > 0 ? <p className="basis-full text-center text-xs text-warning">Orçamento em massa indisponível · {ineligibleBudgetCount} {ineligibleBudgetCount === 1 ? 'campanha usa' : 'campanhas usam'} orçamento nos conjuntos ou formato incompatível.</p> : null}
        </div>
      )}

      {/* Modal de Ajuste de Orçamento em Lote */}
      {bulkBudgetOpen && <Modal isOpen={bulkBudgetOpen} onClose={() => { if (!bulkBudgetBusy) setBulkBudgetOpen(false) }} title="Ajustar orçamentos" description={`${selected.size} ${selected.size === 1 ? 'campanha selecionada' : 'campanhas selecionadas'}. O período de cada orçamento será mantido.`}>
            <div className="mb-4 flex items-center gap-5 overflow-x-auto border-b border-border/60" role="tablist" aria-label="Tipo de ajuste de orçamento">
              <button
                type="button"
                role="tab"
                aria-selected={bulkBudgetMode === 'percent_up'}
                className={cn('min-h-10 shrink-0 border-b-2 px-1 text-xs font-medium transition-colors', bulkBudgetMode === 'percent_up' ? 'border-brand-cyan text-brand-cyan' : 'border-transparent text-muted-foreground hover:text-foreground')}
                onClick={() => { setBulkBudgetMode('percent_up'); setBulkBudgetValue('20') }}
              >
                Aumentar (%)
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={bulkBudgetMode === 'percent_down'}
                className={cn('min-h-10 shrink-0 border-b-2 px-1 text-xs font-medium transition-colors', bulkBudgetMode === 'percent_down' ? 'border-brand-cyan text-brand-cyan' : 'border-transparent text-muted-foreground hover:text-foreground')}
                onClick={() => { setBulkBudgetMode('percent_down'); setBulkBudgetValue('20') }}
              >
                Reduzir (%)
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={bulkBudgetMode === 'fixed'}
                className={cn('min-h-10 shrink-0 border-b-2 px-1 text-xs font-medium transition-colors', bulkBudgetMode === 'fixed' ? 'border-brand-cyan text-brand-cyan' : 'border-transparent text-muted-foreground hover:text-foreground')}
                onClick={() => { setBulkBudgetMode('fixed'); setBulkBudgetValue('100') }}
              >
                Definir valor
              </button>
            </div>

            <div className="mb-4">
              <label htmlFor="campaign-bulk-budget" className="block text-xs font-medium text-muted-foreground mb-1">
                {bulkBudgetMode === 'fixed' ? `Novo orçamento (${currency})` : 'Porcentagem de ajuste (%)'}
              </label>
              <input
                type="number"
                min={bulkBudgetMode === 'fixed' ? TIKTOK_MIN_BUDGET : 1}
                step="1"
                id="campaign-bulk-budget"
                value={bulkBudgetValue}
                onChange={(e) => setBulkBudgetValue(e.target.value)}
                className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm font-semibold tabular-nums text-foreground focus:border-primary/60 focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
              {bulkBudgetMode === 'fixed' ? <p className="mt-1.5 text-xs text-muted-foreground">Mínimo aceito: {fmtMoney(TIKTOK_MIN_BUDGET, currency)} por orçamento.</p> : null}
            </div>

            {bulkBudgetImpact.length > 0 ? (
              <div className="mb-5 border-y border-border/50 py-3">
                <p className="text-xs font-semibold text-foreground">Impacto antes de salvar</p>
                <div className="mt-2 divide-y divide-border/40">
                  {bulkBudgetImpact.map((item) => (
                    <div key={item.label} className="flex flex-col gap-1 py-2 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                      <span className="text-xs text-muted-foreground">{item.label}</span>
                      <span className="text-xs font-medium tabular-nums text-foreground">{item.before} → {item.after}</span>
                    </div>
                  ))}
                </div>
                {bulkBudgetImpact.some((item) => item.delta > 0) ? <p className="mt-2 text-xs leading-relaxed text-warning">Este ajuste aumenta o potencial de gasto das campanhas selecionadas. Revise os valores antes de aplicar.</p> : null}
              </div>
            ) : null}

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => setBulkBudgetOpen(false)}
                disabled={bulkBudgetBusy}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primary text-xs font-semibold px-4 py-2"
                onClick={applyBulkBudget}
                disabled={bulkBudgetBusy || !bulkBudgetValueValid}
              >
                {bulkBudgetBusy ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    Aplicando...
                  </>
                ) : (
                  bulkBudgetMode === 'percent_up' ? 'Aplicar aumento' : bulkBudgetMode === 'percent_down' ? 'Aplicar redução' : 'Salvar orçamentos'
                )}
              </button>
            </div>
      </Modal>}
    </section>
  )
}
