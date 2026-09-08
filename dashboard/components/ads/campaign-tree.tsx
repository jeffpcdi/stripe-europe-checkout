'use client'

// Árvore de campanhas do TikTok Ads — campanha → ad group → ad, com métricas
// por nível, filtros de status, ordenação, paginação e ações rápidas
// (pausar/ativar, duplicar, excluir anúncio). Segue o padrão visual das
// tabelas do dashboard (linhas com stagger, status dots, ações no hover).

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
  Megaphone,
  Layers,
  Clapperboard,
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
  LayoutList,
  LayoutGrid,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  MoreHorizontal,
} from 'lucide-react'
import { apiSend } from '@/lib/api'
import { toast } from '@/lib/toast'
import type { AdsTreeResponse, AdsTreeCampaign, AdsTreeAd, AdsNodeStatus } from '@/lib/types'
import { GlassCard } from '@/components/glass-card'
import { Skeleton } from '@/components/skeleton'
import { ErrorState } from '@/components/error-state'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { AdEditDialog } from './ad-edit-dialog'
import { TIKTOK_MIN_BUDGET, tiktokMinimumBudgetMessage } from './tiktok-contracts'
import { fmtCompact, cleanCampaignName } from '@/lib/format'
import { Modal } from '@/components/ui/modal'
import { CampaignMetricGrid } from './campaign-metric-grid'
import { campaignBudget, campaignStatusOutcome, type CampaignStatusResult } from '@/lib/campaign-metrics'
import { actionFeedback } from '@/lib/action-feedback'

function fmtMoney(v: number | undefined, currency: string): string {
  if (v == null) return '—'
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency, maximumFractionDigits: 2 }).format(v)
  } catch {
    return v.toFixed(2)
  }
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

export function CampaignActivationToggle({
  status,
  busy,
  disabled,
  onToggle,
  name,
}: {
  status?: AdsNodeStatus
  busy?: boolean
  disabled?: boolean
  onToggle: () => void
  name?: string
}) {
  const isActive = status === 'active'
  const isPaused = status === 'paused'

  if (!isActive && !isPaused) {
    return <StatusPill status={status} />
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
      title={isActive ? 'Campanha ativa — Clique para pausar' : 'Campanha pausada — Clique para ativar'}
      aria-label={`${isActive ? 'Pausar' : 'Ativar'} campanha ${name || ''}`}
      className={`group relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${
        isActive
          ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.35)]'
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
          className="flex size-7 items-center justify-center rounded-md border border-border/50 bg-secondary/40 text-muted-foreground hover:text-foreground hover:bg-secondary hover:border-border transition-colors cursor-pointer"
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
          className="glass glass-thick anim-pop-in z-50 min-w-56 rounded-xl border border-white/10 bg-background/95 p-1.5 shadow-2xl backdrop-blur-xl text-xs"
        >
          {/* Status info header */}
          <div className="px-2 py-1.5 border-b border-border/40 mb-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">Status</span>
              <StatusPill status={c.status} />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
              <span>{c.campaignKind === 'smart_plus' ? 'Smart+' : 'Campanha padrão'}</span>
              {c.reviewStatus === 'approved' && (
                <span className="inline-flex items-center gap-0.5 text-emerald-400 font-medium">
                  <BadgeCheck className="size-3 text-emerald-400" /> Aprovada
                </span>
              )}
              {c.childStatus && c.childStatus !== c.status && (
                <span className="text-warning">Anúncios: {STATUS_META[c.childStatus]?.label || c.childStatus}</span>
              )}
            </div>
          </div>

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
              <span>Métricas e gráficos</span>
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
              void navigator.clipboard.writeText(id)
              toast.success('ID da campanha copiado')
            }}
          >
            <Copy className="size-3.5" />
            <span className="font-mono">Copiar ID ({id})</span>
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
                if (event.key === 'Escape') setEditing(false)
              }}
              className="w-16 rounded border border-border bg-background px-1 py-0.5 text-[10px] font-mono tabular-nums text-foreground"
              aria-label={`Novo orçamento de ${label}`}
            />
            <button
              type="button"
              className="p-0.5 rounded text-success hover:bg-success/15"
              onClick={() => void save()}
              disabled={busy}
              aria-label="Salvar"
            >
              {busy ? <Loader2 className="size-2.5 animate-spin" /> : <Check className="size-2.5" />}
            </button>
            <button
              type="button"
              className="p-0.5 rounded text-muted-foreground hover:bg-secondary"
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
            className="group inline-flex items-center gap-1 text-[11px] font-mono font-medium text-foreground hover:text-primary transition-colors cursor-pointer"
            onClick={() => {
              setValue(String(currentAmount))
              setEditing(true)
            }}
            title="Clique para editar orçamento"
          >
            <span>{fmtMoney(currentAmount, currency)}</span>
            <span className="text-[10px] text-muted-foreground">/{type === 'lifetime' ? 'tot' : 'd'}</span>
            <Pencil className="size-2.5 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground" />
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
              onKeyDown={(event) => { if (event.key === 'Enter') void save(); if (event.key === 'Escape') setEditing(false) }}
              className="input-neon w-24 rounded border border-border bg-background px-1.5 py-0.5 text-[11px] tabular-nums"
              aria-label={`Novo orçamento de ${label}`}
            />
            <button type="button" className="btn-secondary text-xs" onClick={() => void save()} disabled={busy} aria-label="Salvar">
              {busy ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />} Salvar
            </button>
            <button type="button" className="btn-ghost !p-1" onClick={() => setEditing(false)} disabled={busy} aria-label="Cancelar"><X className="size-3" /></button>
          </span>
        ) : (
          <button type="button" className="inline-flex items-center gap-1 text-[11px] font-semibold tabular-nums text-foreground" onClick={() => { setValue(String(currentAmount)); setEditing(true) }}>
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
  { value: 'pending_review', label: 'Em revisão' },
  { value: 'rejected', label: 'Rejeitadas' },
]

const ALL_STATUS_OPTIONS = [
  { value: 'active', label: 'Ativas' },
  { value: 'paused', label: 'Pausadas' },
  { value: '', label: 'Todas' },
  { value: 'approved', label: 'Validadas' },
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
  attribution,
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
  // Vendas reais por campanha (utm_campaign=__CAMPAIGN_ID__ → lead comprado)
  attribution?: Record<string, { revenueCents: number; sales: number }>
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [busyId, setBusyId] = useState<string | null>(null)
  const [deleteAd, setDeleteAd] = useState<{ ad: AdsTreeAd; adAccountId: string } | null>(null)
  const [deleting, setDeleting] = useState(false)
  // Edição de anúncio (texto/CTA/link) sem recriar
  const [editAd, setEditAd] = useState<{ ad: AdsTreeAd; adAccountId: string } | null>(null)
  // Ações em lote: seleção por checkbox → barra flutuante pausa/ativa tudo
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [activation, setActivation] = useState<{ kind: 'single'; campaign: AdsTreeCampaign } | { kind: 'bulk' } | null>(null)
  
  // Ajuste de orçamento em lote
  const [bulkBudgetOpen, setBulkBudgetOpen] = useState(false)
  const [bulkBudgetMode, setBulkBudgetMode] = useState<'percent_up' | 'percent_down' | 'fixed'>('percent_up')
  const [bulkBudgetValue, setBulkBudgetValue] = useState('20')
  const [bulkBudgetBusy, setBulkBudgetBusy] = useState(false)

  // Busca por nome + "só com gasto" — filtros CLIENT-SIDE: o backend devolve a
  // lista inteira numa página só (readTree → pages:1), então filtrar aqui nunca
  // esconde resultados de outras páginas. "Só com gasto" nasce desligado.
  const [query, setQuery] = useState('')
  const [onlyWithSpend, setOnlyWithSpend] = useState(false)
  const [quickFilter, setQuickFilter] = useState<'all' | 'with_sales' | 'high_roas' | 'no_sales'>('all')
  const [showFilters, setShowFilters] = useState(false)
  const [hoveredVideo, setHoveredVideo] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table')

  useEffect(() => {
    try {
      const saved = localStorage.getItem('roi_campaigns_view_mode')
      if (saved === 'cards' || saved === 'table') setViewMode(saved)
    } catch {}
  }, [])

  const handleViewModeChange = (mode: 'table' | 'cards') => {
    setViewMode(mode)
    try {
      localStorage.setItem('roi_campaigns_view_mode', mode)
    } catch {}
  }

  useEffect(() => {
    const apply = (value: string) => {
      if (!value) return
      setQuery(value)
      setShowFilters(true)
      const parsed = parseNaturalCampaignFilter(value)
      if (parsed.status && parsed.status !== statusFilter) onStatusFilter(parsed.status)
      localStorage.removeItem('roi_ads_natural_filter')
    }
    apply(localStorage.getItem('roi_ads_natural_filter') || '')
    const onFilter = (event: Event) => apply(String((event as CustomEvent).detail || ''))
    window.addEventListener('roi:ads-filter', onFilter)
    return () => window.removeEventListener('roi:ads-filter', onFilter)
  }, [onStatusFilter, statusFilter])

  const selectionScope = (tree?.campaigns || []).map(campaign => `${campaign.platformCampaignId}:${campaign.status}`).sort().join('|')

  // Uma seleção de lote não pode sobreviver à troca de página/filtro/período;
  // do contrário, ações poderiam atingir campanhas que já não estão visíveis.
  useEffect(() => {
    setSelected(new Set())
  }, [page, statusFilter, sort, selectionScope, query, onlyWithSpend])

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function bulkStatus(status: 'active' | 'paused') {
    if (selected.size === 0 || bulkBusy || busyId) return
    if (selected.size > 50) { toast.error('Selecione até 50 campanhas por vez'); return false }
    setBulkBusy(true)
    try {
      const r = await apiSend<CampaignStatusResult>(
        '/api/ads/campaigns/bulk-status',
        'POST',
        {
          campaigns: Array.from(selected).map((id) => ({ platformCampaignId: id })),
          status,
          adAccountId: campaigns.find((campaign) => selected.has(campaign.platformCampaignId))?.platformAdAccountId,
        },
      )
      const outcome = campaignStatusOutcome(r, selected.size)
      if (outcome === 'simulated') { toast.info('Simulação concluída', { hint: 'Modo teste: nenhuma campanha foi alterada.' }); return true }
      if (outcome === 'failed') throw new Error('Nenhuma alteração foi aceita. Atualize a lista e tente novamente.')
      if (outcome === 'partial') toast.error('Parte das campanhas não foi alterada', { hint: `${r.totals?.updated} enviada(s), ${r.totals?.skipped} ignorada(s), ${r.totals?.failed} falha(s).` })
      else toast.info('Solicitação enviada', { hint: 'A lista mostrará o status após a sincronização com o TikTok.' })
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
        let newAmount = curAmount
        if (bulkBudgetMode === 'percent_up') {
          newAmount = Math.round(curAmount * (1 + val / 100))
        } else if (bulkBudgetMode === 'percent_down') {
          newAmount = Math.max(TIKTOK_MIN_BUDGET, Math.round(curAmount * (1 - val / 100)))
        } else {
          newAmount = Math.max(TIKTOK_MIN_BUDGET, val)
        }

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

  async function handleDeleteAd() {
    const ad = deleteAd?.ad
    const adId = ad?.platformAdId || ad?._id
    if (!adId) return
    setDeleting(true)
    try {
      await apiSend(`/api/ads/${encodeURIComponent(adId)}`, 'DELETE', { adAccountId: deleteAd?.adAccountId })
      toast.success('Anúncio excluído')
      setDeleteAd(null)
      onMutate()
    } catch (e) {
      toast.error('Falha ao excluir anúncio', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setDeleting(false)
    }
  }

  const campaigns = tree?.campaigns ?? []
  const pagination = tree?.pagination

  // Contagem em tempo real de campanhas por status na conta
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {
      active: 0,
      paused: 0,
      pending_review: 0,
      rejected: 0,
      all: campaigns.length,
    }
    for (const c of campaigns) {
      if (c.status === 'active') counts.active++
      else if (c.status === 'paused') counts.paused++
      else if (c.status === 'pending_review') counts.pending_review++
      else if (c.status === 'rejected' || c.status === 'error') counts.rejected++
    }
    return counts
  }, [campaigns])

  // Aplica busca + "só com gasto" sobre a lista carregada
  const q = normalizeSearch(query.trim())
  const natural = parseNaturalCampaignFilter(query)
  const visible = campaigns.filter((c) => {
    // Busca bate no nome cru E no limpo — o usuário vê o limpo na tela
    if (
      q && !natural.structured &&
      !normalizeSearch(String(c.campaignName || c.platformCampaignId)).includes(q) &&
      !normalizeSearch(cleanCampaignName(c.campaignName)).includes(q)
    )
      return false
    if (onlyWithSpend && !(Number(c.metrics?.spend) > 0)) return false
    const spend = Number(c.metrics?.spend) || 0
    const attr = attribution?.[c.platformCampaignId]
    const sales = Number(attr?.sales) || 0
    const roas = spend > 0 ? (Number(attr?.revenueCents) || 0) / 100 / spend : 0
    const ctr = Number(c.metrics?.ctr) || 0

    // Filtros rápidos
    if (quickFilter === 'with_sales' && sales <= 0) return false
    if (quickFilter === 'high_roas' && roas < 2.0) return false
    if (quickFilter === 'no_sales' && (sales > 0 || spend <= 0)) return false

    if (natural.spendAbove != null && !(spend > natural.spendAbove)) return false
    if (natural.spendBelow != null && !(spend < natural.spendBelow)) return false
    if (natural.roasAbove != null && !(roas > natural.roasAbove)) return false
    if (natural.roasBelow != null && !(roas < natural.roasBelow)) return false
    if (natural.ctrBelow != null && !(ctr < natural.ctrBelow)) return false
    if (natural.noSales && sales !== 0) return false
    if (natural.withSales && sales <= 0) return false
    return true
  })

  // Resumo do que está visível: contagem por status + gasto total — dá o
  // panorama sem precisar rolar 100 linhas.
  const summary = useMemo(() => {
    let active = 0
    let paused = 0
    let review = 0
    let problem = 0
    let spend = 0
    for (const c of visible) {
      if (c.status === 'active') active++
      else if (c.status === 'paused') paused++
      else if (c.status === 'pending_review') review++
      else if (c.status === 'rejected' || c.status === 'error') problem++
      spend += Number(c.metrics?.spend) || 0
    }
    return { active, paused, review, problem, spend }
  }, [visible])

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
      if (viewMode === 'table') {
        return isExp ? 460 : 50
      }
      return isExp ? 580 : 285
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

  // Cabeçalho de grupo (Ativas/Pausadas/…), adaptado para tabela ou cards
  function renderGroupHeader(row: Extract<FlatRow, { kind: 'group' }>, index?: number) {
    if (viewMode === 'table') {
      return (
        <div
          className="flex h-8 items-center gap-2 border-y border-border bg-secondary/50 px-3 text-[11px] font-semibold text-muted-foreground tracking-wide uppercase min-w-[1225px]"
          style={index !== undefined ? ({ '--i': Math.min(index, 20), '--stagger-index': Math.min(index, 20) } as React.CSSProperties) : undefined}
        >
          <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
          <span>{GROUP_LABELS[row.groupIdx] ?? 'Outras'}</span>
          <span className="rounded-full bg-secondary/80 px-2 py-0.5 text-[10px] font-bold tabular-nums text-foreground border border-border/40">
            {row.count}
          </span>
        </div>
      )
    }
    return (
      <p
        className="stagger-fade flex h-9 items-center border-b border-border bg-secondary/40 px-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground"
        style={index !== undefined ? ({ '--i': Math.min(index, 20), '--stagger-index': Math.min(index, 20) } as React.CSSProperties) : undefined}
      >
        {(GROUP_LABELS[row.groupIdx] ?? 'Outras') + ` (${row.count})`}
      </p>
    )
  }

  // Bloco expandido: métricas completas + grupos/anúncios (compartilhado entre Tabela e Cards)
  function renderExpandedContent(c: AdsTreeCampaign) {
    const id = c.platformCampaignId
    const attr = attribution?.[id]
    const spend = Number(c.metrics?.spend) || 0
    const sales = Number(attr?.sales) || 0
    const realRevenue = (Number(attr?.revenueCents) || 0) / 100
    const roas = sales > 0 && spend > 0 ? realRevenue / spend : null

    return (
      <div id={`campaign-details-${id}`} className="anim-content-in border-t border-border/50 bg-secondary/15 px-4 py-4 sm:px-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {onOpenDetail && (
              <button
                type="button"
                className="btn-ghost !px-2.5 !py-1 text-xs"
                onClick={() => onOpenDetail(c)}
                aria-label={`Ver métricas da campanha ${c.campaignName || id}`}
              >
                <BarChart3 className="size-3.5 mr-1" aria-hidden="true" />
                Métricas detalhadas e gráficos
              </button>
            )}
            {onDuplicate && (
              <button
                type="button"
                className="btn-ghost !px-2.5 !py-1 text-xs"
                onClick={() => onDuplicate(c)}
                aria-label={`Duplicar campanha ${c.campaignName || id}`}
              >
                <Copy className="size-3.5 mr-1" aria-hidden="true" />
                Duplicar
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {c.adSetCount ?? c.adSets?.length ?? 0} grupo{(c.adSetCount ?? c.adSets?.length ?? 0) === 1 ? '' : 's'} ·{' '}
              {c.adCount ?? 0} anúncio{(c.adCount ?? 0) === 1 ? '' : 's'}
            </span>
            {attr && attr.sales > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-success/15 border border-success/30 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-success">
                {attr.sales} venda{attr.sales === 1 ? '' : 's'} · {fmtMoney(attr.revenueCents / 100, currency)}
                {roas !== null && ` · ROAS ${roas.toFixed(2)}×`}
              </span>
            )}
          </div>
        </div>

        {c.budgetOwner === 'campaign' && c.budget?.amount != null && (
          <div className="mb-4 max-w-sm">
            <BudgetControl
              entityId={id}
              amount={Number(c.budget.amount)}
              type={c.budget.type === 'lifetime' ? 'lifetime' : 'daily'}
              adAccountId={c.platformAdAccountId || ''}
              currency={c.currency || currency}
              label="Orçamento da campanha (CBO)"
              onSaved={onMutate}
            />
          </div>
        )}

        {/* Grade detalhada de métricas */}
        <div className="mb-4 rounded-xl border border-border/60 bg-card/60 overflow-hidden shadow-xs">
          <CampaignMetricGrid
            campaign={c}
            currency={currency}
            attribution={attribution?.[id] || attribution?.[c.platformCampaignId]}
          />
        </div>

        {/* Grupos e Anúncios */}
        {(c.adSets ?? []).length === 0 ? (
          <p className="py-2 text-xs text-muted-foreground">Nenhum grupo de anúncios nesta campanha.</p>
        ) : (
          (c.adSets ?? []).map((s, si) => (
            <div key={s.platformAdSetId ?? si} className="py-3">
              <div className="flex flex-wrap items-center gap-2 border-b border-border/30 pb-2">
                <Layers className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="text-sm font-semibold text-foreground tracking-tight">
                  {s.adSetName || s.name || s.platformAdSetId || `Grupo ${si + 1}`}
                </span>
                <StatusPill status={s.status} />
                {c.budgetOwner !== 'campaign' && s.platformAdSetId && s.budget?.amount != null && (
                  <BudgetControl
                    entityId={s.platformAdSetId}
                    amount={Number(s.budget.amount)}
                    type={s.budget.type === 'lifetime' ? 'lifetime' : 'daily'}
                    adAccountId={c.platformAdAccountId || ''}
                    currency={c.currency || currency}
                    label="Orçamento do conjunto"
                    onSaved={onMutate}
                  />
                )}
              </div>
              <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 stagger-fade">
                {(s.ads ?? []).map((ad, ai) => {
                  const adKey = ad.platformAdId || ad._id || String(ai)
                  return (
                    <li
                      key={adKey}
                      onMouseEnter={() => setHoveredVideo(String(adKey))}
                      onMouseLeave={() => setHoveredVideo(null)}
                      className="group relative flex flex-col justify-between gap-3 rounded-xl border border-border/60 bg-background/50 p-3 shadow-sm transition-all hover:border-primary/30 hover:shadow-md hover:bg-background stagger-fade"
                      style={{ '--i': Math.min(ai, 15), '--stagger-index': Math.min(ai, 15) } as React.CSSProperties}
                    >
                      {(ad.creative?.imageUrl || /^https:\/\//i.test(ad.creative?.videoUrl || '')) && (
                        <div className="relative aspect-video overflow-hidden rounded-lg border border-border/50 bg-black">
                          {hoveredVideo === String(adKey) && /^https:\/\//i.test(ad.creative?.videoUrl || '') ? (
                            <video
                              src={ad.creative?.videoUrl}
                              poster={ad.creative?.imageUrl}
                              autoPlay muted loop playsInline preload="metadata"
                              className="h-full w-full object-cover"
                              aria-label={`Prévia do anúncio ${ad.name || adKey}`}
                            />
                          ) : ad.creative?.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={ad.creative.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full items-center justify-center text-[10px] text-muted-foreground">Passe o mouse para reproduzir</div>
                          )}
                          <span className="absolute bottom-1.5 left-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[9px] text-white/80">sem som</span>
                        </div>
                      )}
                      <div className="flex items-start gap-2">
                        <Clapperboard className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" aria-hidden="true" />
                        <div className="flex flex-col min-w-0">
                          <span className="truncate text-[13px] font-semibold text-foreground" title={ad.name || adKey}>{ad.name || adKey}</span>
                          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                            <StatusPill status={ad.status} />
                            {ad.adType === 'boost' && (
                              <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                                Spark
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      
                      {ad.rejectionReason && (
                        <div className="rounded-md bg-error/10 p-1.5">
                          <span className="line-clamp-2 text-[10px] text-error" title={ad.rejectionReason}>
                            {ad.rejectionReason}
                          </span>
                        </div>
                      )}

                      <div className="mt-auto flex items-center justify-between border-t border-border/40 pt-2">
                        <span className="text-[11px] font-medium tabular-nums text-muted-foreground">
                          {fmtMoney(ad.metrics?.spend, currency)} · {fmtCompact(ad.metrics?.impressions)} impr.
                        </span>
                        
                        {isProductLinkAd(ad) ? (
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary" title="O destino vem do campo Link dos produtos deste catálogo">
                            Link Catálogo
                          </span>
                        ) : null}
                      </div>

                      {/* Hover Actions Bar */}
                      <div className="absolute right-2 top-2 flex items-center gap-0.5 rounded-lg border border-border/50 bg-background/80 p-0.5 opacity-100 backdrop-blur-sm transition-all sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100 shadow-sm">
                        {ad.creative?.linkUrl && !isProductLinkAd(ad) && (
                          <a
                            href={ad.creative.linkUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary/80 hover:text-foreground"
                            aria-label="Abrir página de destino do anúncio"
                            title="Página de destino"
                          >
                            <ExternalLink className="size-3.5" aria-hidden="true" />
                          </a>
                        )}
                        <button
                          type="button"
                          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary/80 hover:text-foreground"
                          onClick={() => setEditAd({ ad, adAccountId: c.platformAdAccountId || '' })}
                          aria-label={`Editar anúncio ${ad.name || adKey}`}
                          title={isProductLinkAd(ad) ? 'Editar texto e botão' : 'Editar texto, botão e link'}
                        >
                          <Pencil className="size-3.5" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-error/15 hover:text-error"
                          onClick={() => setDeleteAd({ ad, adAccountId: c.platformAdAccountId || '' })}
                          aria-label={`Excluir anúncio ${ad.name || adKey}`}
                          title="Excluir anúncio"
                        >
                          <Trash2 className="size-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    </li>
                  )
                })}
                {(s.ads ?? []).length === 0 && (
                  <li className="col-span-full rounded-xl border border-dashed border-border/60 p-4 text-center text-[11px] text-muted-foreground">
                    Sem anúncios neste grupo.
                  </li>
                )}
              </ul>
            </div>
          ))
        )}
      </div>
    )
  }

  // Linha em formato Tabela: alta densidade, perfeita para dezenas/centenas de campanhas
  function renderCampaignTableRow(c: AdsTreeCampaign, index?: number) {
    const id = c.platformCampaignId
    const isOpen = expanded.has(id)
    const busy = busyId === id
    const attr = attribution?.[id]
    const spend = Number(c.metrics?.spend) || 0
    const sales = Number(attr?.sales) || 0
    const conversions = Number(c.metrics?.conversions) || 0
    const realRevenue = (Number(attr?.revenueCents) || 0) / 100
    const roas = sales > 0 && spend > 0 ? realRevenue / spend : null
    const realCpa = sales > 0 && spend > 0 ? spend / sales : null
    const metricsCpa = Number(c.metrics?.cpa) || null
    const ctr = Number(c.metrics?.ctr) || 0
    const clicks = Number(c.metrics?.clicks) || 0
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

    return (
      <div
        key={id}
        className={`campaign-table-row border-b border-border/50 transition-colors ${
          selected.has(id) ? 'bg-primary/5' : isOpen ? 'bg-secondary/15' : 'hover:bg-muted/20'
        } ${isError ? 'border-l-2 border-l-error' : ''}`}
        style={index !== undefined ? ({ '--i': Math.min(index, 20), '--stagger-index': Math.min(index, 20) } as React.CSSProperties) : undefined}
      >
        {/* Linha compacta: 12 colunas com alinhamento rigoroso */}
        <div className="grid grid-cols-[38px_82px_minmax(240px,2fr)_110px_105px_75px_100px_80px_95px_100px_130px_70px] items-center px-3 py-2.5 text-xs min-w-[1225px]">
          {/* 1. Checkbox */}
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

          {/* 2. Status & Quick Toggle */}
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

          {/* 3. Campanha: Nome, ID, Badges */}
          <div className="min-w-0 pr-3">
            <div className="flex items-center gap-1.5">
              <span
                className="font-semibold text-foreground truncate cursor-pointer hover:text-primary transition-colors text-sm"
                onClick={() => toggle(id)}
                title={c.campaignName || id}
              >
                {cleanCampaignName(c.campaignName || id)}
              </span>
              {c.campaignKind === 'smart_plus' && (
                <span className="shrink-0 rounded bg-secondary px-1.5 py-0.2 text-[10px] font-medium text-muted-foreground border border-border/50">
                  Smart+
                </span>
              )}
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
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
              <span className="font-mono">ID: {id}</span>
              {c.childStatus && c.childStatus !== c.status && (
                <span className="text-warning">Anúncios: {STATUS_META[c.childStatus]?.label || 'ver detalhes'}</span>
              )}
            </div>
          </div>

          {/* 4. Orçamento */}
          <div className="text-right pr-2">
            {c.budgetOwner === 'campaign' && c.budget?.amount != null ? (
              <BudgetControl
                entityId={id}
                amount={Number(c.budget.amount)}
                type={c.budget.type === 'lifetime' ? 'lifetime' : 'daily'}
                adAccountId={c.platformAdAccountId || ''}
                currency={c.currency || currency}
                label="Orçamento"
                onSaved={onMutate}
                compact
              />
            ) : (
              <span className="text-[11px] text-muted-foreground" title="Orçamento definido no nível dos conjuntos (ABO)">
                Conjuntos
              </span>
            )}
          </div>

          {/* 5. Gasto */}
          <div className="text-right font-mono font-semibold text-foreground tabular-nums pr-2">
            {fmtMoney(spend, currency)}
          </div>

          {/* 6. Vendas */}
          <div className="text-right pr-2">
            {sales > 0 ? (
              <span className="inline-flex items-center rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-[11px] font-bold text-emerald-400 tabular-nums" title={`${sales} venda(s) real(is) rastreada(s)`}>
                {sales}
              </span>
            ) : conversions > 0 ? (
              <span className="text-[11px] font-mono text-muted-foreground tabular-nums" title={`${conversions} conversão(ões) reportada(s) pelo TikTok`}>
                {conversions}
              </span>
            ) : (
              <span className="text-muted-foreground/40 font-mono text-xs">—</span>
            )}
          </div>

          {/* 7. Receita */}
          <div className="text-right font-mono text-xs tabular-nums pr-2">
            {realRevenue > 0 ? (
              <span className="font-semibold text-foreground">{fmtMoney(realRevenue, currency)}</span>
            ) : (
              <span className="text-muted-foreground/40">—</span>
            )}
          </div>

          {/* 8. ROAS */}
          <div className="text-right pr-2">
            {roas !== null ? (
              <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-bold tabular-nums ${
                roas >= 2.0
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25'
                  : roas >= 1.0
                    ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/25'
                    : 'bg-secondary text-muted-foreground'
              }`}>
                {roas.toFixed(2)}×
              </span>
            ) : (
              <span className="text-muted-foreground/40 font-mono text-xs">—</span>
            )}
          </div>

          {/* 9. CPA */}
          <div className="text-right font-mono text-xs tabular-nums pr-2">
            {realCpa !== null ? (
              <span className="font-medium text-foreground">{fmtMoney(realCpa, currency)}</span>
            ) : metricsCpa ? (
              <span className="text-muted-foreground">{fmtMoney(metricsCpa, currency)}</span>
            ) : (
              <span className="text-muted-foreground/40">—</span>
            )}
          </div>

          {/* 10. CTR / Cliques */}
          <div className="text-right font-mono text-[11px] tabular-nums pr-2">
            <div className="font-medium text-foreground">{ctr ? `${ctr.toFixed(2)}%` : '0,00%'}</div>
            <div className="text-[10px] text-muted-foreground">{clicks} cliq.</div>
          </div>

          {/* 11. Estrutura (Conjuntos e Anúncios) */}
          <div className="text-center px-1">
            <button
              type="button"
              onClick={() => toggle(id)}
              className={`inline-flex items-center justify-center gap-1 w-full py-1 px-2 rounded-md text-[11px] font-medium transition-all cursor-pointer ${
                isOpen
                  ? 'bg-primary/20 text-primary border border-primary/30 font-semibold'
                  : 'bg-secondary/60 text-muted-foreground hover:text-foreground hover:bg-secondary border border-border/40'
              }`}
              title={isOpen ? 'Recolher estrutura' : 'Ver conjuntos e anúncios'}
              aria-expanded={isOpen}
            >
              <Layers className="size-3 shrink-0" />
              <span className="truncate">{adSetCount} grp · {adCount} ad</span>
              <ChevronRight className={`size-3 shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
            </button>
          </div>

          {/* 12. Ações rápidas */}
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

        {/* Banner de erro quando houver problema */}
        {detailedError && (
          <div className="flex items-center gap-2 border-t border-error/20 bg-error/10 px-4 py-1.5 text-xs text-error min-w-[1225px]">
            <AlertTriangle className="size-3.5 shrink-0" />
            <span>{detailedError}</span>
          </div>
        )}

        {/* Accordion Expandido */}
        {isOpen && renderExpandedContent(c)}
      </div>
    )
  }

  // Linha em formato Card (modo clássico em blocos)
  function renderCampaignCardRow(c: AdsTreeCampaign, index?: number) {
    const id = c.platformCampaignId
    const isOpen = expanded.has(id)
    const busy = busyId === id
    const isError = c.status === 'error' || c.status === 'rejected' || c.reviewStatus === 'rejected' || c.childStatus === 'rejected'

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

    return (
      <div className="campaign-row-wrap" key={id}>
        <article
          className="campaign-operation-card stagger-fade"
          style={index !== undefined ? ({ '--i': Math.min(index, 20), '--stagger-index': Math.min(index, 20) } as React.CSSProperties) : undefined}
          data-error={isError}
          data-selected={selected.has(id)}
          aria-label={c.campaignName || id}
        >
          <div className="campaign-operation-heading">
            <input
              type="checkbox"
              checked={selected.has(id)}
              onChange={() => toggleSelect(id)}
              disabled={Boolean(busyId) || bulkBusy}
              aria-label={`Selecionar campanha ${c.campaignName || id}`}
            />
            <div className="campaign-operation-identity">
              <h3 title={c.campaignName || id}>{cleanCampaignName(c.campaignName || id)}</h3>
              <div className="campaign-operation-meta">
                <span className="font-mono text-[11px] text-muted-foreground">ID: {id}</span>
                <span>·</span>
                <span>{c.campaignKind === 'smart_plus' ? 'Smart+' : 'Campanha padrão'}</span>
                {c.reviewStatus === 'approved' && (
                  <span className="campaign-approved" title="Anúncios aprovados pelo TikTok">
                    <BadgeCheck size={13} aria-hidden="true" />
                    Aprovada
                  </span>
                )}
              </div>
            </div>
            <div className="campaign-operation-actions">
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
            <p className="campaign-operation-error">
              <AlertTriangle size={14} aria-hidden="true" />
              {detailedError}
            </p>
          )}
          <CampaignMetricGrid campaign={c} currency={currency} attribution={attribution?.[id] || attribution?.[c.platformCampaignId]} />
          <button
            type="button"
            className="campaign-expand-action"
            onClick={() => toggle(id)}
            aria-expanded={isOpen}
            aria-controls={`campaign-details-${id}`}
          >
            <Layers size={14} aria-hidden="true" />
            {c.adSetCount ?? c.adSets?.length ?? 0} {(c.adSetCount ?? c.adSets?.length ?? 0) === 1 ? 'conjunto' : 'conjuntos'} · {c.adCount ?? 0}{' '}
            {c.adCount === 1 ? 'anúncio' : 'anúncios'}
            <span>{isOpen ? 'Recolher' : 'Ver conjuntos e anúncios'}</span>
            <ChevronRight size={15} className={isOpen ? 'rotate-90' : ''} aria-hidden="true" />
          </button>

          {isOpen && renderExpandedContent(c)}
        </article>
      </div>
    )
  }

  function TableHeader() {
    return (
      <div className="sticky top-0 z-10 grid grid-cols-[38px_82px_minmax(240px,2fr)_110px_105px_75px_100px_80px_95px_100px_130px_70px] items-center border-b border-border bg-card/95 backdrop-blur px-3 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider min-w-[1225px] shadow-xs">
        {/* 1. Checkbox Select All */}
        <div className="flex items-center justify-center">
          <input
            type="checkbox"
            checked={allVisibleSelected}
            onChange={toggleSelectAll}
            aria-label="Selecionar todas as campanhas visíveis"
            className="size-3.5 rounded accent-primary cursor-pointer"
          />
        </div>

        {/* 2. Status */}
        <div>Status</div>

        {/* 3. Campanha */}
        <div
          className="flex items-center gap-1 cursor-pointer hover:text-foreground transition-colors pr-3"
          onClick={() => onSort(sort === 'newest' ? 'oldest' : 'newest')}
          title="Clique para alternar ordenação por data"
        >
          <span>Campanha</span>
          <ArrowUpDown className="size-3" />
        </div>

        {/* 4. Orçamento */}
        <div className="text-right pr-2">Orçamento</div>

        {/* 5. Gasto */}
        <div
          className="flex items-center justify-end gap-1 cursor-pointer hover:text-foreground transition-colors pr-2"
          onClick={() => onSort(sort === 'spend_desc' ? 'spend_asc' : 'spend_desc')}
          title="Clique para ordenar por gasto (maior / menor)"
        >
          <span>Gasto</span>
          {sort === 'spend_desc' ? (
            <ArrowDown className="size-3 text-primary" />
          ) : sort === 'spend_asc' ? (
            <ArrowUp className="size-3 text-primary" />
          ) : (
            <ArrowUpDown className="size-3" />
          )}
        </div>

        {/* 6. Vendas */}
        <div className="text-right pr-2">Vendas</div>

        {/* 7. Receita */}
        <div className="text-right pr-2">Receita</div>

        {/* 8. ROAS */}
        <div className="text-right pr-2">ROAS</div>

        {/* 9. CPA */}
        <div className="text-right pr-2">CPA</div>

        {/* 10. CTR / Cliq. */}
        <div className="text-right pr-2">CTR / Cliq.</div>

        {/* 11. Estrutura */}
        <div className="text-center">
          <button
            type="button"
            onClick={toggleAllExpanded}
            className="text-[10px] lowercase text-muted-foreground hover:text-foreground hover:underline transition-colors cursor-pointer"
            title={allExpanded ? 'Recolher todas as campanhas' : 'Expandir todas as campanhas'}
          >
            {allExpanded ? 'recolher tudo' : 'expandir tudo'}
          </button>
        </div>

        {/* 12. Ações */}
        <div className="text-right">Ações</div>
      </div>
    )
  }

  function renderFlatRow(row: FlatRow, index?: number) {
    if (row.kind === 'group') return renderGroupHeader(row, index)
    return viewMode === 'table' ? renderCampaignTableRow(row.c, index) : renderCampaignCardRow(row.c, index)
  }

  return (
    <GlassCard className="campaign-workspace min-w-0 overflow-hidden p-0">
      <div className="campaign-toolbar">
        <div className="campaign-toolbar-title flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2>Suas campanhas</h2>
            <p>Métricas do TikTok no período selecionado</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-0.5 rounded-lg border border-border/60 bg-secondary/40 p-0.5" role="group" aria-label="Modo de visualização">
              <button
                type="button"
                onClick={() => handleViewModeChange('table')}
                aria-pressed={viewMode === 'table'}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all cursor-pointer ${
                  viewMode === 'table'
                    ? 'bg-background text-foreground shadow-xs font-semibold'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                title="Modo Tabela: visualização compacta de alta densidade (ideal para 100+ campanhas)"
              >
                <LayoutList className="size-3.5" />
                <span>Tabela</span>
              </button>
              <button
                type="button"
                onClick={() => handleViewModeChange('cards')}
                aria-pressed={viewMode === 'cards'}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all cursor-pointer ${
                  viewMode === 'cards'
                    ? 'bg-background text-foreground shadow-xs font-semibold'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                title="Modo Cards: visualização em blocos"
              >
                <LayoutGrid className="size-3.5" />
                <span>Cards</span>
              </button>
            </div>
            <span className="rounded-full bg-secondary/80 border border-border/50 px-2.5 py-1 text-xs font-medium text-foreground tabular-nums">
              {visible.length} {visible.length === 1 ? 'campanha' : 'campanhas'}
            </span>
          </div>
        </div>
        <div className="campaign-status-filters" role="group" aria-label="Filtrar por status">
          {STATUS_FILTERS.map(filter => {
            const count = filter.value === '' ? statusCounts.all : (statusCounts[filter.value] ?? 0)
            const isSelected = statusFilter === filter.value
            return (
              <button
                key={filter.value}
                type="button"
                onClick={() => onStatusFilter(filter.value)}
                aria-pressed={isSelected}
                className="inline-flex items-center gap-1.5"
              >
                <span>{filter.label}</span>
                <span
                  className={`inline-flex items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums transition-colors ${
                    isSelected ? 'bg-primary/20 text-primary' : 'bg-secondary text-muted-foreground'
                  }`}
                >
                  {count}
                </span>
              </button>
            )
          })}
        </div>
        <div className="campaign-search-row">
          <label className="campaign-search">
            <Search size={17} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Buscar pelo nome da campanha"
              aria-label="Buscar campanha"
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} aria-label="Limpar busca">
                <X size={15} />
              </button>
            )}
          </label>
          <button
            type="button"
            className="campaign-secondary-action"
            onClick={() => setShowFilters(!showFilters)}
            aria-expanded={showFilters}
          >
            <SlidersHorizontal size={16} />
            Mais filtros
          </button>
        </div>

        {/* Atalhos Rápidos de Seleção e Desempenho */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1 px-1">
          <span className="text-[11px] font-medium text-muted-foreground mr-0.5">Atalhos:</span>
          <button
            type="button"
            onClick={() => setOnlyWithSpend(v => !v)}
            aria-pressed={onlyWithSpend}
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-all ${
              onlyWithSpend
                ? 'border-primary/50 bg-primary/15 text-primary font-semibold shadow-xs'
                : 'border-border/60 bg-secondary/40 text-muted-foreground hover:bg-secondary hover:text-foreground'
            }`}
          >
            🔥 Com gasto
          </button>
          <button
            type="button"
            onClick={() => setQuickFilter(curr => curr === 'with_sales' ? 'all' : 'with_sales')}
            aria-pressed={quickFilter === 'with_sales'}
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-all ${
              quickFilter === 'with_sales'
                ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-400 font-semibold shadow-xs'
                : 'border-border/60 bg-secondary/40 text-muted-foreground hover:bg-secondary hover:text-foreground'
            }`}
          >
            💰 Com vendas
          </button>
          <button
            type="button"
            onClick={() => setQuickFilter(curr => curr === 'high_roas' ? 'all' : 'high_roas')}
            aria-pressed={quickFilter === 'high_roas'}
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-all ${
              quickFilter === 'high_roas'
                ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-400 font-semibold shadow-xs'
                : 'border-border/60 bg-secondary/40 text-muted-foreground hover:bg-secondary hover:text-foreground'
            }`}
          >
            ⚡ ROAS &gt; 2×
          </button>
          <button
            type="button"
            onClick={() => setQuickFilter(curr => curr === 'no_sales' ? 'all' : 'no_sales')}
            aria-pressed={quickFilter === 'no_sales'}
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-all ${
              quickFilter === 'no_sales'
                ? 'border-amber-500/50 bg-amber-500/15 text-amber-400 font-semibold shadow-xs'
                : 'border-border/60 bg-secondary/40 text-muted-foreground hover:bg-secondary hover:text-foreground'
            }`}
          >
            ⚠️ Gastando sem venda
          </button>
          {(onlyWithSpend || quickFilter !== 'all') && (
            <button
              type="button"
              onClick={() => {
                setOnlyWithSpend(false)
                setQuickFilter('all')
              }}
              className="ml-auto text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2"
            >
              Limpar atalhos
            </button>
          )}
        </div>
        {/* Menu de Filtros Adicionais (simples e direto) */}
        {showFilters && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/40 bg-secondary/10 p-3 mt-1">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setOnlyWithSpend((v) => !v)}
                aria-pressed={onlyWithSpend}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                  onlyWithSpend
                    ? 'border-primary/40 bg-primary/15 text-primary shadow-sm font-semibold'
                    : 'border-border/50 bg-background text-muted-foreground hover:border-border hover:text-foreground'
                }`}
              >
                Apenas com gasto
              </button>

              <label className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium">Ordenar:</span>
                <select
                  className="rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
                  value={sort}
                  onChange={(e) => onSort(e.target.value)}
                  aria-label="Ordenar campanhas"
                >
                  {SORTS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>

              {/* Status avançado para casos especiais */}
              <label className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium">Status:</span>
                <select
                  className="rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
                  value={statusFilter}
                  onChange={(e) => onStatusFilter(e.target.value)}
                  aria-label="Filtrar por status"
                >
                  {ALL_STATUS_OPTIONS.map((s) => (
                    <option key={s.value || 'all'} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {(onlyWithSpend || sort !== 'newest' || statusFilter !== 'active' || query) && (
              <button
                type="button"
                onClick={() => {
                  setOnlyWithSpend(false)
                  onSort('newest')
                  onStatusFilter('active')
                  setQuery('')
                }}
                className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
              >
                Limpar filtros
              </button>
            )}
          </div>
        )}
      </div>

      {/* Resumo do que está visível + Selecionar todas */}
      {visible.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border bg-secondary/30 px-3 sm:px-4 py-2 text-[11px] tabular-nums text-muted-foreground">
          <label className="flex items-center gap-1.5 cursor-pointer font-medium text-foreground mr-1">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={toggleSelectAll}
              aria-label="Selecionar todas as campanhas visíveis"
              className="size-3.5 rounded accent-[color:var(--primary)]"
            />
            <span className="text-[11px]">Selecionar tudo</span>
          </label>
          <span className="text-border">|</span>
          {summary.active > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-[color:var(--success)]" aria-hidden="true" />
              {summary.active} ativa{summary.active === 1 ? '' : 's'}
            </span>
          )}
          {summary.review > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-[color:var(--warning)]" aria-hidden="true" />
              {summary.review} em revisão
            </span>
          )}
          {summary.problem > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-[color:var(--error)]" aria-hidden="true" />
              {summary.problem} com problema{summary.problem === 1 ? '' : 's'}
            </span>
          )}
          {summary.paused > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-muted-foreground" aria-hidden="true" />
              {summary.paused} pausada{summary.paused === 1 ? '' : 's'}
            </span>
          )}
          <span className="ml-auto font-medium text-foreground">
            Gasto neste filtro: {fmtMoney(summary.spend, currency)}
          </span>
        </div>
      )}

      {tree?.backfillPending && (
        <p className="flex items-center gap-2 border-b border-border bg-warning/5 px-4 py-2 text-[11px] text-warning">
          <Loader2 className="size-3 animate-spin" aria-hidden="true" />
          Importando histórico do TikTok — as métricas podem levar alguns minutos para completar.
        </p>
      )}

      {/* Corpo: loading / erro / vazio / linhas */}
      {loading ? (
        <div className="flex flex-col gap-2 p-4 stagger-fade">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton
              key={i}
              className="h-16 rounded-xl stagger-fade"
              style={{ '--i': i, '--stagger-index': i } as React.CSSProperties}
            />
          ))}
        </div>
      ) : error ? (
        <div className="p-6">
          <ErrorState title="Não foi possível carregar as campanhas" description={error} onRetry={onRetry} />
        </div>
      ) : campaigns.length > 0 && visible.length === 0 ? (
        /* Há campanhas, mas a busca/filtro local não achou nada */
        <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-secondary">
            <Search className="size-6 text-muted-foreground" aria-hidden="true" />
          </span>
          <p className="text-sm font-medium text-foreground">Nada encontrado</p>
          <p className="max-w-sm text-pretty text-xs text-muted-foreground">
            {onlyWithSpend
              ? 'Nenhuma campanha corresponde à busca com o filtro "Só com gasto" ligado.'
              : 'Nenhuma campanha corresponde à busca.'}
          </p>
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={() => {
              setQuery('')
              setOnlyWithSpend(false)
            }}
          >
            Limpar busca e filtros
          </button>
        </div>
      ) : campaigns.length === 0 ? (
        tree?.backfillPending ? (
          /* Conta recém-conectada: o sync ainda está importando do TikTok —
             NÃO é "sem campanhas", é sincronização em andamento. */
          <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-secondary">
              <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
            </span>
            <p className="text-sm font-medium text-foreground">Sincronizando campanhas do TikTok…</p>
            <p className="max-w-sm text-pretty text-xs text-muted-foreground">
              A primeira importação pode levar de 1 a 3 minutos. Suas campanhas vão aparecer aqui
              automaticamente — não precisa reconectar.
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-secondary">
              <Megaphone className="size-6 text-muted-foreground" aria-hidden="true" />
            </span>
            <p className="text-sm font-medium text-foreground">
              {statusFilter ? 'Nenhuma campanha com esse status' : 'Nenhuma campanha neste período'}
            </p>
            <p className="max-w-sm text-pretty text-xs text-muted-foreground">
              {statusFilter
                ? 'Escolha Todas para ver as demais campanhas da conta.'
                : 'Esta conta de anúncio não tem campanhas neste período. Aumente o Período acima ou crie a primeira campanha no botão "Nova campanha".'}
            </p>
          </div>
        )
      ) : (
        <div
          ref={scrollRef}
          className={`${virtualize ? 'h-[72vh]' : 'max-h-[72vh]'} overflow-auto ${
            viewMode === 'table' ? 'campaign-table-container' : ''
          }`}
        >
          {viewMode === 'table' && <TableHeader />}
          {virtualize ? (
            <div
              style={{
                height: rowVirtualizer.getTotalSize(),
                position: 'relative',
                minWidth: viewMode === 'table' ? '1225px' : undefined,
              }}
            >
              {rowVirtualizer.getVirtualItems().map((vi) => {
                const row = flatRows[vi.index]
                return (
                  <div
                    key={vi.key}
                    data-index={vi.index}
                    ref={rowVirtualizer.measureElement}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${vi.start}px)`,
                    }}
                  >
                    {renderFlatRow(row, vi.index)}
                  </div>
                )
              })}
            </div>
          ) : (
            <div
              className="stagger-fade"
              style={{ minWidth: viewMode === 'table' ? '1225px' : undefined }}
            >
              {flatRows.map((row, index) => (
                <div
                  key={row.key}
                  className="stagger-fade"
                  style={{ '--i': Math.min(index, 20), '--stagger-index': Math.min(index, 20) } as React.CSSProperties}
                >
                  {renderFlatRow(row, index)}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Paginação */}
      {pagination && pagination.pages > 1 && (
        <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
          <span>
            Página {pagination.page} de {pagination.pages} · {pagination.total} campanha{pagination.total === 1 ? '' : 's'}
          </span>
          <div className="flex items-center gap-1">
            <button type="button" className="btn-ghost px-2 py-1 text-xs" disabled={page <= 1} onClick={() => onPage(page - 1)}>
              Anterior
            </button>
            <button
              type="button"
              className="btn-ghost px-2 py-1 text-xs"
              disabled={page >= pagination.pages}
              onClick={() => onPage(page + 1)}
            >
              Próxima
            </button>
          </div>
        </div>
      )}

      {/* Confirmação de exclusão de anúncio */}
      <ConfirmDialog
        open={Boolean(activation)}
        title={activation?.kind === 'bulk' ? `Ativar ${selected.size} campanhas?` : 'Ativar esta campanha?'}
        description={activation?.kind === 'single' ? <><strong>{activation.campaign.campaignName || activation.campaign.platformCampaignId}</strong><br />Conta: {activation.campaign.platformAdAccountName || activation.campaign.platformAdAccountId}<br />Orçamento: {campaignBudget(activation.campaign).amount !== null ? fmtMoney(campaignBudget(activation.campaign).amount!, activation.campaign.currency || currency) : 'Definido nos conjuntos'} · {campaignBudget(activation.campaign).detail}<br />Ao ativar, a campanha poderá começar a gastar.</> : 'As campanhas selecionadas poderão começar a gastar. Confira os orçamentos antes de ativar.'}
        confirmLabel="Ativar"
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

      {/* Barra Flutuante de Ações em Lote */}
      {selected.size > 0 && (
        <div className="campaign-bulk-actions fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 sm:gap-3 rounded-2xl border border-white/20 bg-[#09090b]/95 px-4 py-2.5 sm:px-5 sm:py-3 shadow-[0_10px_40px_rgba(0,0,0,0.85)] backdrop-blur-xl anim-pop-in">
          <div className="flex items-center gap-2 border-r border-border/50 pr-3">
            <span className="flex size-5 items-center justify-center rounded-full bg-primary/20 text-[11px] font-bold text-primary">
              {selected.size}
            </span>
            <span className="text-xs font-semibold text-foreground hidden sm:inline">
              selecionada{selected.size === 1 ? '' : 's'}
            </span>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              className="btn-secondary !py-1.5 !px-3 text-xs gap-1.5"
              onClick={() => bulkStatus('paused')}
              disabled={bulkBusy}
            >
              <Pause className="size-3.5" />
              Pausar
            </button>
            <button
              type="button"
              className="btn-primary !py-1.5 !px-3 text-xs gap-1.5 font-semibold"
              onClick={() => setActivation({ kind: 'bulk' })}
              disabled={bulkBusy}
            >
              <Play className="size-3.5" />
              Ativar
            </button>
            <button
              type="button"
              className="btn-secondary !py-1.5 !px-3 text-xs gap-1.5"
              onClick={() => setBulkBudgetOpen(true)}
              disabled={bulkBusy}
            >
              <DollarSign className="size-3.5 text-success" />
              Orçamento
            </button>
            <button
              type="button"
              className="btn-ghost !p-1.5 text-muted-foreground hover:text-foreground ml-1"
              onClick={() => setSelected(new Set())}
              disabled={bulkBusy}
              title="Limpar seleção"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      )}

      {/* Modal de Ajuste de Orçamento em Lote */}
      {bulkBudgetOpen && <Modal isOpen={bulkBudgetOpen} onClose={() => { if (!bulkBudgetBusy) setBulkBudgetOpen(false) }} title="Ajustar orçamentos" description={`${selected.size} ${selected.size === 1 ? 'campanha selecionada' : 'campanhas selecionadas'}. O período de cada orçamento será mantido.`}>
            <div className="grid grid-cols-3 gap-1.5 rounded-xl bg-secondary/30 p-1 mb-4 border border-border/40">
              <button
                type="button"
                className={`py-1 text-xs font-semibold rounded-lg transition-colors ${
                  bulkBudgetMode === 'percent_up' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'
                }`}
                onClick={() => { setBulkBudgetMode('percent_up'); setBulkBudgetValue('20') }}
              >
                Aumentar
              </button>
              <button
                type="button"
                className={`py-1 text-xs font-semibold rounded-lg transition-colors ${
                  bulkBudgetMode === 'percent_down' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'
                }`}
                onClick={() => { setBulkBudgetMode('percent_down'); setBulkBudgetValue('20') }}
              >
                Reduzir
              </button>
              <button
                type="button"
                className={`py-1 text-xs font-semibold rounded-lg transition-colors ${
                  bulkBudgetMode === 'fixed' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'
                }`}
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
                min="1"
                step="1"
                id="campaign-bulk-budget"
                value={bulkBudgetValue}
                onChange={(e) => setBulkBudgetValue(e.target.value)}
                className="input-neon w-full rounded-xl border border-border bg-background px-3 py-2 text-sm font-mono font-semibold text-foreground"
              />
            </div>

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
                disabled={bulkBudgetBusy}
              >
                {bulkBudgetBusy ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    Aplicando...
                  </>
                ) : (
                  'Salvar orçamentos'
                )}
              </button>
            </div>
      </Modal>}
    </GlassCard>
  )
}
