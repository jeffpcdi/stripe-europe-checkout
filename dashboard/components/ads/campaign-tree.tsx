'use client'

// Árvore de campanhas do TikTok Ads — campanha → ad group → ad, com métricas
// por nível, filtros de status, ordenação, paginação e ações rápidas
// (pausar/ativar, duplicar, excluir anúncio). Segue o padrão visual das
// tabelas do dashboard (linhas com stagger, status dots, ações no hover).

import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  ChevronRight,
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
  Sparkles,
  X,
  Search,
  SlidersHorizontal,
} from 'lucide-react'
import { apiSend } from '@/lib/api'
import { toast } from '@/lib/toast'
import type { AdsTreeResponse, AdsTreeCampaign, AdsTreeAd, AdsMetrics, AdsNodeStatus } from '@/lib/types'
import { GlassCard } from '@/components/glass-card'
import { Skeleton } from '@/components/skeleton'
import { ErrorState } from '@/components/error-state'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { AdEditDialog } from './ad-edit-dialog'
import { TIKTOK_MIN_BUDGET, tiktokMinimumBudgetMessage } from './tiktok-contracts'
import { fmtCompact, fmtPercent, cleanCampaignName } from '@/lib/format'
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

// Célula de métrica compacta (rótulo mono + valor)
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="label-mono text-[10px]">{label}</p>
      <p className="truncate text-xs font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  )
}

function isProductLinkAd(ad: AdsTreeAd): boolean {
  return Boolean(ad.catalogId) && (
    String(ad.websiteType || '').toUpperCase() === 'PRODUCT_LINK'
    || String(ad.adFormat || '').toUpperCase() === 'CATALOG_CAROUSEL'
  )
}

// Métricas que saíram da linha compacta e vivem agora no expand.
function SecondaryMetrics({ m, currency }: { m?: AdsMetrics; currency: string }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
      <Metric label="Impr." value={fmtCompact(m?.impressions)} />
      <Metric label="Cliques" value={fmtCompact(m?.clicks)} />
      <Metric label="CTR" value={m?.ctr != null ? fmtPercent(m.ctr) : '—'} />
      <Metric label="CPM" value={fmtMoney(m?.cpm, currency)} />
    </div>
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
}: {
  entityId: string
  amount: number
  type: 'daily' | 'lifetime'
  adAccountId: string
  currency: string
  label: string
  onSaved: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(String(currentAmount || ''))
  const [busy, setBusy] = useState(false)
  const max = Math.max(TIKTOK_MIN_BUDGET * 3, Math.ceil((currentAmount || TIKTOK_MIN_BUDGET) * 3))
  async function save(nextValue = value) {
    const next = Number(String(nextValue).replace(',', '.'))
    if (!Number.isFinite(next) || next < TIKTOK_MIN_BUDGET) return toast.error(tiktokMinimumBudgetMessage(currency))
    if (Math.abs(next - currentAmount) < 0.005) { setEditing(false); return }
    setBusy(true)
    try {
      const amount = next
      await apiSend(`/api/ads/${encodeURIComponent(entityId)}`, 'PUT', { budget: { amount, type }, adAccountId })
      toast.success('Orçamento atualizado')
      actionFeedback()
      setEditing(false)
      onSaved()
    } catch (error) {
      toast.error('Falha ao atualizar orçamento', { hint: error instanceof Error ? error.message : undefined })
      setValue(String(currentAmount || ''))
    } finally { setBusy(false) }
  }
  return (
    <div className="flex min-w-[210px] flex-col gap-1.5 rounded-lg border border-border/40 bg-secondary/20 px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-medium text-muted-foreground">{label}</span>
        {editing ? (
          <span className="inline-flex items-center gap-1">
            <input
              autoFocus type="number" min={TIKTOK_MIN_BUDGET} step="0.01" value={value}
              disabled={busy} onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') void save(); if (event.key === 'Escape') setEditing(false) }}
              className="input-neon w-24 rounded border border-border bg-background px-1.5 py-0.5 text-[11px] tabular-nums"
              aria-label={`Novo orçamento de ${label}`}
            />
            <button type="button" className="btn-ghost !p-1 text-success" onClick={() => void save()} disabled={busy} aria-label="Salvar">
              {busy ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
            </button>
            <button type="button" className="btn-ghost !p-1" onClick={() => setEditing(false)} disabled={busy} aria-label="Cancelar"><X className="size-3" /></button>
          </span>
        ) : (
          <button type="button" className="inline-flex items-center gap-1 text-[11px] font-semibold tabular-nums text-foreground" onClick={() => { setValue(String(currentAmount)); setEditing(true) }}>
            {fmtMoney(currentAmount, currency)}/{type === 'lifetime' ? 'total' : 'dia'} <Pencil className="size-3 text-muted-foreground" />
          </button>
        )}
      </div>
      
      {/* Simulador de Escala Visual */}
      <div className="mt-1 flex flex-col gap-2 border-t border-border/50 pt-2">
        <div className="flex items-center justify-between text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
          <span>Simulador de Escala</span>
          <span className={Number(value) > currentAmount * 1.5 ? 'text-warning' : 'text-success'}>
            {Number(value) > currentAmount * 1.5 ? 'Agressiva 🔥' : 'Conservadora ❄️'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="range" min={TIKTOK_MIN_BUDGET} max={max} step="1" value={Math.max(TIKTOK_MIN_BUDGET, Math.min(max, Number(value) || currentAmount))}
            onChange={(event) => setValue(event.target.value)}
            onPointerUp={(event) => void save((event.currentTarget as HTMLInputElement).value)}
            onKeyUp={(event) => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') void save((event.currentTarget as HTMLInputElement).value) }}
            disabled={busy || type === 'lifetime'}
            aria-label={`Escala de orçamento de ${label}`}
            className="h-2 flex-1 cursor-pointer appearance-none rounded-full accent-white disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: 'linear-gradient(90deg,var(--blue),var(--brand-cyan),var(--brand-pink))' }}
          />
        </div>
        {Number(value) !== currentAmount && (
          <p className="text-[10px] leading-relaxed text-muted-foreground bg-background/50 p-1.5 rounded text-center">
            {Number(value) > currentAmount * 1.5
              ? 'Aumentos maiores que 50% reiniciam a fase de aprendizado. O ROAS flutuará hoje.'
              : 'Aumento seguro. A fase de aprendizado será preservada pelo algoritmo.'}
          </p>
        )}
      </div>
    </div>
  )
}

const STATUS_FILTERS = [
  { value: 'active', label: 'Ativas' },
  { value: 'approved', label: 'Validadas' },
  { value: 'pending_review', label: 'Em revisão' },
  { value: 'rejected', label: 'Rejeitadas' },
  { value: 'paused', label: 'Pausadas' },
  { value: '', label: 'Todas' },
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
  const [query, setQuery] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [onlyWithSpend, setOnlyWithSpend] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [viewMode, setViewMode] = useState<'list' | 'mindmap'>('list')
  const [bulkBusy, setBulkBusy] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [deleteAd, setDeleteAd] = useState<{ ad: AdsTreeAd; adAccountId: string } | null>(null)
  const [deleting, setDeleting] = useState(false)
  // Edição de anúncio (texto/CTA/link) sem recriar
  const [editAd, setEditAd] = useState<{ ad: AdsTreeAd; adAccountId: string } | null>(null)
  // Ações em lote: seleção por checkbox → barra flutuante pausa/ativa tudo
  const [activation, setActivation] = useState<{ kind: 'single'; campaign: AdsTreeCampaign } | { kind: 'bulk' } | null>(null)
  // Busca por nome + "só com gasto" — filtros CLIENT-SIDE: o backend devolve a
  // lista inteira numa página só (readTree → pages:1), então filtrar aqui nunca
  // esconde resultados de outras páginas. "Só com gasto" nasce desligado.
  const [hoveredVideo, setHoveredVideo] = useState<string | null>(null)

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

  // Uma seleção de lote não pode sobreviver à troca de página/filtro/período;
  // do contrário, ações poderiam atingir campanhas que já não estão visíveis.
  useEffect(() => {
    setSelected(new Set())
  }, [page, statusFilter, sort, tree, query, onlyWithSpend])

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function bulkStatus(status: 'active' | 'paused') {
    if (selected.size === 0 || bulkBusy) return
    setBulkBusy(true)
    try {
      const r = await apiSend<{ totals?: { updated: number; skipped: number; failed: number } }>(
        '/api/ads/campaigns/bulk-status',
        'POST',
        {
          campaigns: Array.from(selected).map((id) => ({ platformCampaignId: id })),
          status,
          adAccountId: campaigns.find((campaign) => selected.has(campaign.platformCampaignId))?.platformAdAccountId,
        },
      )
      const t = r.totals
      toast.success(
        status === 'paused' ? 'Campanhas pausadas' : 'Campanhas ativadas',
        t ? { hint: `${t.updated} atualizada(s) · ${t.skipped} ignorada(s) · ${t.failed} falha(s)` } : undefined,
      )
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
    setBusyId(id)
    try {
      await apiSend('/api/ads/campaigns/bulk-status', 'POST', {
        campaigns: [{ platformCampaignId: id }],
        status,
        adAccountId: c.platformAdAccountId,
      })
      toast.success(status === 'paused' ? 'Campanha pausada' : 'Campanha ativada')
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
    estimateSize: () => 44,
    overscan: 10,
    getItemKey: (i) => flatRows[i].key,
  })

  // Colunas numéricas alinhadas — mesmas larguras no cabeçalho e nas linhas
  // (tabular-nums + largura fixa evitam o truncamento "US..." do layout antigo).
  const colGasto = 'w-20 shrink-0 text-right tabular-nums sm:w-24'
  const colRoas = 'hidden w-16 shrink-0 text-right tabular-nums sm:block'
  const colConv = 'hidden w-16 shrink-0 text-right tabular-nums sm:block'
  const colActions = 'flex w-14 shrink-0 items-center justify-end gap-0.5 sm:w-[4.75rem]'

  // Cabeçalho de grupo (Ativas/Pausadas/…), reutilizado nos dois modos de render
  function renderGroupHeader(row: Extract<FlatRow, { kind: 'group' }>) {
    return (
      <p className="flex h-9 items-center border-b border-border bg-secondary/40 px-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
        {(GROUP_LABELS[row.groupIdx] ?? 'Outras') + ` (${row.count})`}
      </p>
    )
  }

  // Uma linha de campanha (compacta ~40px) + bloco expandido (grupos/anúncios).
  function renderCampaignRow(c: AdsTreeCampaign) {
    const id = c.platformCampaignId
    const isOpen = expanded.has(id)
    const busy = busyId === id
    const meta = STATUS_META[c.status ?? ''] ?? { dot: 'bg-muted-foreground', pulse: false, label: c.status || '—' }
    const attr = attribution?.[id]
    const spend = Number(c.metrics?.spend) || 0
    const roas = attr && attr.sales > 0 && spend > 0 ? attr.revenueCents / 100 / spend : null
    const isError = c.status === 'error' || c.status === 'rejected' || c.reviewStatus === 'rejected' || c.childStatus === 'rejected'
    const isHot = roas !== null && roas >= 2.0 && c.status === 'active'
    
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
      <div className="px-2 py-1.5 sm:px-4 sm:py-2">
        <div className={`group relative overflow-hidden rounded-xl border bg-background transition-all duration-300 ${isHot ? 'border-brand-pink/50 shadow-[0_0_15px_rgba(255,105,180,0.3)]' : isError ? 'border-error/30 bg-error/5 shadow-sm' : 'border-border/50 hover:border-primary/20 shadow-sm hover:shadow-md'}`}>
          {isHot && (
            <div className="absolute inset-0 z-0 animate-pulse bg-gradient-to-r from-brand-pink/5 via-brand-cyan/5 to-transparent opacity-50" aria-hidden="true" />
          )}
          <div className="relative z-10 flex items-center gap-2 p-3 sm:gap-3">
            <input
              type="checkbox"
              checked={selected.has(id)}
              onChange={() => toggleSelect(id)}
              aria-label={`Selecionar campanha ${c.campaignName || id}`}
              className="size-3.5 shrink-0 accent-[color:var(--primary)]"
            />
            <button
              type="button"
              onClick={() => toggle(id)}
              aria-expanded={isOpen}
              aria-label={`${isOpen ? 'Recolher' : 'Expandir'} campanha ${c.campaignName || id}`}
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
            >
              <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-secondary/50 transition-colors group-hover:bg-primary/10">
                <ChevronRight
                  className={`size-4 text-muted-foreground transition-transform duration-300 group-hover:text-primary ${isOpen ? 'rotate-90' : ''}`}
                  aria-hidden="true"
                />
              </div>
              <div className="min-w-0 flex-1 flex flex-col justify-center">
                <div className="flex items-center gap-2">
                  <span
                    className={`size-2 shrink-0 rounded-full ${meta.dot} shadow-[0_0_8px_rgba(0,0,0,0.1)] ${meta.dot.replace('bg-', 'shadow-')}`}
                    aria-hidden="true"
                    title={meta.label}
                  />
                  <span
                    className="truncate text-sm font-semibold text-foreground tracking-tight"
                    title={`${c.campaignName || 'Sem nome'} · ${id}`}
                  >
                    {cleanCampaignName(c.campaignName || id)}
                  </span>
                  {c.childStatus && c.childStatus !== c.status && (
                    <AlertTriangle
                      className="size-3.5 shrink-0 text-warning"
                      aria-hidden="true"
                    />
                  )}
                  {c.reviewStatus === 'approved' && (
                    <span
                      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-success"
                      title="Anúncios validados pelo TikTok"
                    >
                      <BadgeCheck className="size-3" aria-hidden="true" />
                      <span className="hidden sm:inline">Validada</span>
                    </span>
                  )}
                </div>
                {detailedError && (
                  <div className="mt-2 w-fit max-w-[280px] sm:max-w-md rounded-md bg-error/10 px-2 py-1.5 border border-error/20">
                    <span className="line-clamp-2 text-[11px] font-medium leading-snug text-error">
                      {detailedError}
                    </span>
                  </div>
                )}
              </div>
            </button>


          {/* Métricas principais condensadas em badges */}
          <div className="hidden shrink-0 items-center gap-2 lg:flex">
            <span className={`inline-flex items-center rounded-md px-2.5 py-1 text-[11px] font-semibold tabular-nums ${spend > 0 ? 'bg-secondary/50 text-foreground' : 'text-muted-foreground'}`}>
              Gasto: {fmtMoney(c.metrics?.spend, c.currency || currency)}
            </span>
            {roas !== null && (
              <div className="flex flex-col items-center">
                <span className="inline-flex items-center rounded-md bg-success/15 px-2.5 py-1 text-[11px] font-bold text-success shadow-sm shadow-success/10 tabular-nums">
                  ROAS {roas.toFixed(2)}
                </span>
                {/* Mock Sparkline (Tendência dos últimos 7 dias) */}
                <div className="mt-1 flex h-2.5 w-full items-end justify-between gap-[2px] opacity-70 px-1" title="Tendência do ROAS nos últimos 7 dias">
                  {[40, 70, 30, 80, 50, 90, 60].map((h, i) => (
                    <div key={i} className="w-1 rounded-sm bg-success transition-all duration-300 hover:bg-success/50" style={{ height: `${h}%` }} />
                  ))}
                </div>
              </div>
            )}
            {(c.metrics?.conversions || 0) > 0 ? (
              <span className="inline-flex items-center rounded-md bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary tabular-nums">
                {fmtCompact(c.metrics?.conversions)} conv.
              </span>
            ) : null}
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-1 opacity-100 sm:opacity-0 sm:transition-all sm:duration-300 sm:focus-within:opacity-100 sm:group-hover:opacity-100 sm:-translate-x-2 sm:group-hover:translate-x-0 bg-background/80 backdrop-blur-sm sm:absolute sm:right-3 sm:top-1/2 sm:-translate-y-1/2 sm:p-1.5 sm:rounded-lg sm:border sm:border-border/50 sm:shadow-sm">
            {busy ? (
              <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />
            ) : (
              <>
                {c.status === 'active' ? (
                  <button
                    type="button"
                    className="flex h-7 w-7 items-center justify-center rounded-md text-foreground hover:bg-secondary sm:opacity-0 sm:focus-visible:opacity-100 sm:group-hover:opacity-100"
                    onClick={() => setCampaignStatus(c, 'paused')}
                    aria-label={`Pausar campanha ${c.campaignName || id}`}
                    title="Pausar"
                  >
                    <Pause className="size-3.5" aria-hidden="true" />
                  </button>
                ) : c.status === 'paused' ? (
                  <button
                    type="button"
                    className="flex h-7 w-7 items-center justify-center rounded-md text-foreground hover:bg-secondary sm:opacity-0 sm:focus-visible:opacity-100 sm:group-hover:opacity-100"
                    onClick={() => setActivation({ kind: 'single', campaign: c })}
                    aria-label={`Ativar campanha ${c.campaignName || id}`}
                    title="Ativar"
                  >
                    <Play className="size-3.5" aria-hidden="true" />
                  </button>
                ) : (
                  <span className="size-6" aria-hidden="true" />
                )}
                {/* Duplicação (mesma conta) está disponível via Pipeboard —
                    o estado desabilitado era da era Zernio/501. */}
                {onDuplicate && (
                  <button
                    type="button"
                    className="btn-ghost !px-1.5 !py-1 sm:opacity-0 sm:transition-opacity sm:focus-visible:opacity-100 sm:group-hover:opacity-100"
                    onClick={() => onDuplicate(c)}
                    aria-label={`Duplicar campanha ${c.campaignName || id}`}
                    title="Duplicar"
                  >
                    <Copy className="size-3.5" aria-hidden="true" />
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Bloco expandido: métricas secundárias + grupos/anúncios */}
        {isOpen && (
          <div className="anim-content-in border-t border-border/50 bg-secondary/10 px-4 py-4 sm:px-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              {onOpenDetail && (
                <button
                  type="button"
                  className="btn-ghost !px-2 !py-1 text-[11px]"
                  onClick={() => onOpenDetail(c)}
                  aria-label={`Ver métricas da campanha ${c.campaignName || id}`}
                >
                  <BarChart3 className="size-3.5" aria-hidden="true" />
                  Métricas e gráficos
                </button>
              )}
              <span className="text-[11px] text-muted-foreground">
                {c.adSetCount ?? c.adSets?.length ?? 0} grupo{(c.adSetCount ?? c.adSets?.length ?? 0) === 1 ? '' : 's'} ·{' '}
                {c.adCount ?? 0} anúncio{(c.adCount ?? 0) === 1 ? '' : 's'}
              </span>
              {attr && attr.sales > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-medium tabular-nums text-success">
                  {attr.sales} venda{attr.sales === 1 ? '' : 's'} · {fmtMoney(attr.revenueCents / 100, currency)}
                  {roas !== null && ` · ROAS ${roas.toFixed(2)}`}
                </span>
              )}
            </div>
            <div className="mb-3 max-w-md">
              <SecondaryMetrics m={c.metrics} currency={c.currency || currency} />
            </div>
            {c.budgetOwner === 'campaign' && c.budget?.amount != null && (
              <div className="mb-3 max-w-sm">
                <BudgetControl
                  entityId={id}
                  amount={Number(c.budget.amount)}
                  type={c.budget.type === 'lifetime' ? 'lifetime' : 'daily'}
                  adAccountId={c.platformAdAccountId || ''}
                  currency={c.currency || currency}
                  label="Orçamento CBO da campanha"
                  onSaved={onMutate}
                />
              </div>
            )}
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
                        label="Orçamento ABO"
                        onSaved={onMutate}
                      />
                    )}
                  </div>
                  <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {(s.ads ?? []).map((ad, ai) => {
                      const adKey = ad.platformAdId || ad._id || String(ai)
                      return (
                        <li
                          key={adKey}
                          onMouseEnter={() => setHoveredVideo(String(adKey))}
                          onMouseLeave={() => setHoveredVideo(null)}
                          className="group relative flex flex-col justify-between gap-3 rounded-xl border border-border/60 bg-background/50 p-3 shadow-sm transition-all hover:border-primary/30 hover:shadow-md hover:bg-background"
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
        )}
        </div>
      </div>
    )
  }

  function renderFlatRow(row: FlatRow) {
    return row.kind === 'group' ? renderGroupHeader(row) : renderCampaignRow(row.c)
  }

  function renderMindmap() {
    return (
      <div className="p-6 overflow-x-auto">
        <div className="flex flex-col gap-12 min-w-[800px]">
          {displayCampaigns.map((c) => {
            const attr = attribution?.[c.platformCampaignId]
            const spend = Number(c.metrics?.spend) || 0
            const roas = attr && attr.sales > 0 && spend > 0 ? attr.revenueCents / 100 / spend : null
            const isHot = roas !== null && roas >= 2.0 && c.status === 'active'
            
            return (
              <div key={c.platformCampaignId} className="flex items-center gap-8">
                {/* Campaign Node */}
                <div className={`relative flex w-64 shrink-0 flex-col gap-2 rounded-2xl border p-4 shadow-sm transition-all ${isHot ? 'border-brand-pink/50 bg-brand-pink/5 shadow-[0_0_15px_rgba(255,105,180,0.3)]' : 'border-border bg-card'}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-foreground truncate" title={c.campaignName}>{cleanCampaignName(c.campaignName || '')}</span>
                    <StatusPill status={c.status} />
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-[11px] text-muted-foreground">Gasto: {fmtMoney(spend, c.currency || currency)}</span>
                    {roas !== null && <span className="text-[11px] font-bold text-success">ROAS {roas.toFixed(2)}</span>}
                  </div>
                </div>

                {/* Connecting Line */}
                <div className="h-0.5 w-12 bg-border/50 shrink-0" />

                {/* AdSets */}
                <div className="flex flex-col gap-6">
                  {(c.adSets ?? []).map((s, si) => (
                    <div key={s.platformAdSetId || si} className="flex items-center gap-8">
                      {/* AdSet Node */}
                      <div className="relative flex w-56 shrink-0 flex-col gap-2 rounded-xl border border-border/60 bg-secondary/20 p-3 shadow-sm">
                        <span className="text-[11px] font-semibold text-foreground truncate">{s.adSetName || s.name || `Grupo ${si + 1}`}</span>
                        <StatusPill status={s.status} />
                      </div>

                      {/* Connecting Line */}
                      <div className="h-px w-8 bg-border/40 shrink-0" />

                      {/* Ads */}
                      <div className="flex flex-wrap gap-4">
                        {(s.ads ?? []).map((ad, ai) => (
                          <div key={ad.platformAdId || ad._id || ai} className="flex w-32 shrink-0 flex-col items-center gap-2 rounded-lg border border-border/40 bg-background p-2 shadow-sm">
                            <span className="text-[10px] font-medium text-muted-foreground truncate w-full text-center">{ad.name || 'Anúncio'}</span>
                            <div className="h-10 w-10 rounded-full bg-secondary flex items-center justify-center">
                              <Clapperboard className="size-4 text-muted-foreground" />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <GlassCard className="min-w-0 overflow-hidden p-0">
      {/* AI Copilot Panel */}
      <div className="border-b border-border bg-gradient-to-r from-primary/10 via-brand-cyan/5 to-transparent px-4 py-3.5 sm:px-5">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/20 shadow-inner">
            <Sparkles className="size-4 text-primary" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-foreground">Copiloto de Inteligência</p>
            <ul className="mt-1.5 space-y-1">
              <li className="text-[11px] leading-relaxed text-muted-foreground flex items-start gap-1.5">
                <span className="text-warning font-bold mt-0.5">⚠️</span> 
                <span>A campanha <strong className="text-foreground font-semibold">"Escala CBO - Teste"</strong> está com ROAS negativo hoje. Sugerimos pausar e poupar 20€.</span>
              </li>
              <li className="text-[11px] leading-relaxed text-muted-foreground flex items-start gap-1.5">
                <span className="text-success font-bold mt-0.5">🔥</span>
                <span>O anúncio <strong className="text-foreground font-semibold">"Criativo 03"</strong> é o seu campeão atual (ROAS 4.5). Isole-o em uma campanha CBO agressiva.</span>
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Toolbar em 2 linhas: busca (com contagem) em cima; status + filtros
          de dados embaixo. Antes tudo disputava uma linha só e nada respirava. */}
      <div className="flex flex-col gap-3 border-b border-border/50 px-3 py-3 sm:px-4">
        {/* Top bar: Busca, Status e Botão de Filtros */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="relative min-w-0 flex-1 sm:max-w-xs">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Ex.: gastaram mais de 100 e não venderam"
                aria-label="Buscar ou filtrar campanhas em linguagem natural"
                className="w-full rounded-full border border-border/50 bg-secondary/20 py-1.5 pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/30 transition-shadow"
              />
            </div>
            
            <div className="hidden items-center gap-1 sm:flex rounded-full bg-secondary/30 p-0.5" role="group" aria-label="Filtrar por status">
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => onStatusFilter(f.value)}
                  aria-pressed={statusFilter === f.value}
                  className={`rounded-full px-3 py-1 text-[11px] font-medium transition-all duration-200 ${
                    statusFilter === f.value
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          
          <div className="flex items-center gap-2 shrink-0">
            <div className="hidden sm:flex items-center rounded-full bg-secondary/30 p-0.5 mr-2" role="group" aria-label="Modo de visualização">
              <button
                type="button"
                onClick={() => setViewMode('list')}
                className={`rounded-full px-3 py-1.5 text-[11px] font-medium transition-all duration-200 ${
                  viewMode === 'list' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
                aria-pressed={viewMode === 'list'}
              >
                Lista
              </button>
              <button
                type="button"
                onClick={() => setViewMode('mindmap')}
                className={`rounded-full px-3 py-1.5 text-[11px] font-medium transition-all duration-200 ${
                  viewMode === 'mindmap' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
                aria-pressed={viewMode === 'mindmap'}
              >
                Mapa Mental
              </button>
            </div>
            
            <span className="hidden sm:inline-block text-[11px] tabular-nums text-muted-foreground">
              {visible.length !== campaigns.length
                ? `${visible.length} de ${campaigns.length}`
                : `${campaigns.length} total`}
            </span>
            <button 
              type="button"
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center justify-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors ${
                showFilters || onlyWithSpend || sort !== 'newest'
                  ? 'border-primary/30 bg-primary/10 text-primary'
                  : 'border-border/50 bg-background text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
              }`}
            >
              <SlidersHorizontal className="size-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Filtros</span>
            </button>
          </div>
        </div>
        
        {/* Mobile status select (hidden on desktop) */}
        <label className="sm:hidden">
          <span className="sr-only">Filtrar campanhas por status</span>
          <select
            className="w-full rounded-lg border border-border/50 bg-secondary/20 px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
            value={statusFilter}
            onChange={(event) => onStatusFilter(event.target.value)}
            aria-label="Filtrar campanhas por status"
          >
            {STATUS_FILTERS.map((filter) => (
              <option key={filter.value || 'all'} value={filter.value}>{filter.label}</option>
            ))}
          </select>
        </label>

        {/* Collapsed Filters Menu */}
        <div className={`overflow-hidden transition-all duration-300 ease-in-out ${showFilters ? 'max-h-24 opacity-100 mt-1' : 'max-h-0 opacity-0'}`}>
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border/40 bg-secondary/10 p-2.5 sm:p-3">
            <button
              type="button"
              onClick={() => setOnlyWithSpend((v) => !v)}
              aria-pressed={onlyWithSpend}
              className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                onlyWithSpend
                  ? 'border-primary/30 bg-primary/15 text-primary shadow-sm'
                  : 'border-border/50 bg-background text-muted-foreground hover:border-border hover:text-foreground'
              }`}
            >
              Exibir apenas com gasto
            </button>
            <label className="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
              <span className="font-medium">Ordenar por:</span>
              <select
                className="w-32 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
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
          </div>
        </div>
      </div>

      {/* Resumo do que está visível — panorama sem rolar a lista */}
      {visible.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border bg-secondary/30 px-4 py-2 text-[11px] tabular-nums text-muted-foreground">
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

      {/* Barra de ações em lote — FAB (Floating Action Bar) */}
      {selected.size > 0 && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 anim-content-in flex items-center gap-3 rounded-full border border-border/40 bg-background/80 px-4 py-2.5 shadow-2xl backdrop-blur-md">
          <span className="flex items-center justify-center rounded-full bg-primary/20 text-primary size-6 text-[11px] font-bold">
            {selected.size}
          </span>
          <span className="text-xs font-medium text-foreground">
            selecionada{selected.size === 1 ? '' : 's'}
          </span>
          
          <div className="ml-2 flex items-center gap-1.5 border-l border-border/50 pl-3">
            <button
              type="button"
              className="btn-primary !px-3 !py-1.5 text-xs shadow-sm hover:shadow"
              onClick={() => setActivation({ kind: 'bulk' })}
              disabled={bulkBusy}
            >
              {bulkBusy ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Play className="size-3.5" aria-hidden="true" />}
              Ativar
            </button>
            <button
              type="button"
              className="btn-ghost !px-3 !py-1.5 text-xs bg-secondary/50 hover:bg-secondary/80"
              onClick={() => bulkStatus('paused')}
              disabled={bulkBusy}
            >
              <Pause className="size-3.5" aria-hidden="true" />
              Pausar
            </button>
            <button
              type="button"
              className="btn-ghost !px-2 !py-1.5 text-xs text-muted-foreground hover:bg-error/10 hover:text-error ml-1 rounded-full aspect-square"
              onClick={() => setSelected(new Set())}
              disabled={bulkBusy}
              title="Limpar seleção"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
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
        <div className="flex flex-col gap-2 p-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
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
                ? 'Ajuste o filtro acima para ver as demais campanhas do advertiser.'
                : 'Esta conta de anúncio não tem campanhas neste período. Aumente o Período acima ou crie a primeira campanha no botão "Nova campanha".'}
            </p>
          </div>
        )
      ) : viewMode === 'mindmap' ? (
        renderMindmap()
      ) : (
        <div ref={scrollRef} className={virtualize ? 'h-[70vh] overflow-auto' : 'max-h-[70vh] overflow-auto'}>
          {/* Cabeçalho de tabela fixo — rótulos aparecem uma única vez */}
          <div className="label-mono sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-[var(--surface,var(--card))] px-3 py-2 text-[10px] text-muted-foreground">
            <span className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="w-3.5 shrink-0" aria-hidden="true" />
            <span className="size-1.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">Campanha</span>
            <span className={colGasto}>Gasto</span>
            <span className={colRoas}>ROAS</span>
            <span className={colConv}>Conv.</span>
            <span className={colActions} aria-hidden="true" />
          </div>

          {virtualize ? (
            <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
              {rowVirtualizer.getVirtualItems().map((vi) => {
                const row = flatRows[vi.index]
                return (
                  <div
                    key={vi.key}
                    data-index={vi.index}
                    ref={rowVirtualizer.measureElement}
                    style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vi.start}px)` }}
                  >
                    {renderFlatRow(row)}
                  </div>
                )
              })}
            </div>
          ) : (
            <div>
              {flatRows.map((row) => (
                <div key={row.key}>{renderFlatRow(row)}</div>
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
        description="Campanhas aprovadas poderão começar a gastar imediatamente. Confirme somente após revisar orçamento, público e criativo."
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
      <AdEditDialog
        ad={editAd?.ad ?? null}
        adAccountId={editAd?.adAccountId ?? ''}
        onClose={() => setEditAd(null)}
        onSaved={() => onMutate?.()}
      />
    </GlassCard>
  )
}
