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
  BarChart3,
  Pencil,
  Check,
  X,
} from 'lucide-react'
import { apiSend } from '@/lib/api'
import { toast } from '@/lib/toast'
import type { AdsTreeResponse, AdsTreeCampaign, AdsTreeAd, AdsMetrics, AdsNodeStatus } from '@/lib/types'
import { GlassCard } from '@/components/glass-card'
import { Skeleton } from '@/components/skeleton'
import { ErrorState } from '@/components/error-state'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { fmtCompact, fmtPercent } from '@/lib/format'

function fmtMoney(v: number | undefined, currency: string): string {
  if (v == null) return '—'
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency, maximumFractionDigits: 2 }).format(v)
  } catch {
    return v.toFixed(2)
  }
}

// ── Status → cor/rótulo (dot pulsante para ativo, âmbar para revisão) ──
const STATUS_META: Record<string, { label: string; cls: string; dot: string; pulse?: boolean }> = {
  active: { label: 'Ativa', cls: 'text-success', dot: 'bg-[color:var(--success)]', pulse: true },
  paused: { label: 'Pausada', cls: 'text-muted-foreground', dot: 'bg-muted-foreground' },
  pending_review: { label: 'Em revisão', cls: 'text-warning', dot: 'bg-[color:var(--warning)]', pulse: true },
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
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${meta.cls}`}>
      <span
        className={`size-1.5 rounded-full ${meta.dot} ${meta.pulse ? 'animate-pulse' : ''}`}
        aria-hidden="true"
      />
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

const STATUS_FILTERS = [
  { value: 'active', label: 'Ativas' },
  { value: 'paused', label: 'Pausadas' },
  { value: 'pending_review', label: 'Em revisão' },
  { value: 'rejected', label: 'Rejeitadas' },
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
  rangeDays,
  onRangeDays,
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
  // Janela de descoberta/métricas — campanhas fora do período não aparecem
  rangeDays?: number
  onRangeDays?: (d: number) => void
  onMutate: () => void
  onRetry: () => void
  onOpenDetail?: (c: AdsTreeCampaign) => void
  // Abre o dialog de duplicação (N cópias, mesma conta ou outra conta do BC).
  // Sem a prop, cai no comportamento antigo: 1 cópia rápida na mesma conta.
  onDuplicate?: (c: AdsTreeCampaign) => void
  // Vendas reais por campanha (utm_campaign=__CAMPAIGN_ID__ → lead comprado)
  attribution?: Record<string, { revenueCents: number; sales: number }>
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [busyId, setBusyId] = useState<string | null>(null)
  const [deleteAd, setDeleteAd] = useState<AdsTreeAd | null>(null)
  const [deleting, setDeleting] = useState(false)
  // Ações em lote: seleção por checkbox → barra flutuante pausa/ativa tudo
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  // Edição inline de orçamento: chave do grupo em edição + valor digitado
  const [editingBudget, setEditingBudget] = useState<string | null>(null)
  const [budgetValue, setBudgetValue] = useState('')
  const [budgetBusy, setBudgetBusy] = useState(false)

  // Uma seleção de lote não pode sobreviver à troca de página/filtro/período;
  // do contrário, ações poderiam atingir campanhas que já não estão visíveis.
  useEffect(() => {
    setSelected(new Set())
  }, [page, statusFilter, sort, rangeDays, tree])

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
        { campaigns: Array.from(selected).map((id) => ({ platformCampaignId: id })), status },
      )
      const t = r.totals
      toast.success(
        status === 'paused' ? 'Campanhas pausadas' : 'Campanhas ativadas',
        t ? { hint: `${t.updated} atualizada(s) · ${t.skipped} ignorada(s) · ${t.failed} falha(s)` } : undefined,
      )
      setSelected(new Set())
      onMutate()
    } catch (e) {
      toast.error('Falha na ação em lote', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setBulkBusy(false)
    }
  }

  // Salva o orçamento do grupo via 1º anúncio do grupo (o backend aplica o
  // budget no ad group dono do anúncio — não existe PUT direto de grupo).
  async function saveBudget(groupKey: string, adId: string, type: 'daily' | 'lifetime') {
    const amount = Number(budgetValue.replace(',', '.'))
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Informe um valor de orçamento válido')
      return
    }
    setBudgetBusy(true)
    try {
      await apiSend(`/api/ads/${encodeURIComponent(adId)}`, 'PUT', { budget: { amount, type } })
      toast.success('Orçamento atualizado')
      setEditingBudget(null)
      onMutate()
    } catch (e) {
      toast.error('Falha ao atualizar orçamento', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setBudgetBusy(false)
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
      })
      toast.success(status === 'paused' ? 'Campanha pausada' : 'Campanha ativada')
      onMutate()
    } catch (e) {
      toast.error('Falha ao alterar status', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setBusyId(null)
    }
  }

  async function handleDeleteAd() {
    const ad = deleteAd
    const adId = ad?.platformAdId || ad?._id
    if (!adId) return
    setDeleting(true)
    try {
      await apiSend(`/api/ads/${encodeURIComponent(adId)}`, 'DELETE')
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
    : [...campaigns].sort(
        (a, b) => (STATUS_ORDER[a.status ?? ''] ?? 6) - (STATUS_ORDER[b.status ?? ''] ?? 6),
      )
  const displayCampaigns = grouped ?? campaigns

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
  const colGasto = 'w-24 shrink-0 text-right tabular-nums'
  const colRoas = 'hidden w-16 shrink-0 text-right tabular-nums sm:block'
  const colConv = 'hidden w-16 shrink-0 text-right tabular-nums sm:block'
  const colActions = 'flex w-[4.75rem] shrink-0 items-center justify-end gap-0.5'

  // Cabeçalho de grupo (Ativas/Pausadas/…), reutilizado nos dois modos de render
  function renderGroupHeader(row: Extract<FlatRow, { kind: 'group' }>) {
    return (
      <p className="label-mono flex h-9 items-center border-b border-border bg-secondary/40 px-3 text-[10px] text-muted-foreground">
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
    const isError = c.status === 'error' || c.status === 'rejected' || c.reviewStatus === 'rejected'
    const errorMsg =
      c.reviewStatus === 'rejected'
        ? 'Revisão rejeitada pelo TikTok'
        : c.status === 'error'
          ? 'Erro na campanha'
          : c.status === 'rejected'
            ? 'Campanha rejeitada'
            : null

    return (
      <div className={`border-b border-border/70 ${isError ? 'bg-error/10' : ''}`}>
        {/* Linha compacta */}
        <div className="flex items-center gap-2 px-3 transition-colors hover:bg-secondary/40">
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
            className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left"
          >
            <ChevronRight
              className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${isOpen ? 'rotate-90' : ''}`}
              aria-hidden="true"
            />
            <span
              className={`size-1.5 shrink-0 rounded-full ${meta.dot} ${meta.pulse ? 'animate-pulse' : ''}`}
              aria-hidden="true"
              title={meta.label}
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-[13px] font-medium text-foreground">{c.campaignName || id}</span>
                {c.childStatus && c.childStatus !== c.status && (
                  <AlertTriangle
                    className="size-3 shrink-0 text-warning"
                    aria-hidden="true"
                  />
                )}
              </span>
              {errorMsg && <span className="mt-0.5 block truncate text-[11px] text-error">{errorMsg}</span>}
            </span>
          </button>

          <span className={`${colGasto} text-[13px] font-semibold text-foreground`}>{fmtMoney(c.metrics?.spend, c.currency || currency)}</span>
          <span className={`${colRoas} text-[13px] font-medium ${roas !== null ? 'text-success' : 'text-muted-foreground'}`}>
            {roas !== null ? roas.toFixed(2) : '—'}
          </span>
          <span className={`${colConv} text-[13px] text-foreground`}>{fmtCompact(c.metrics?.conversions)}</span>

          <div className={colActions}>
            {busy ? (
              <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />
            ) : (
              <>
                {c.status === 'active' ? (
                  <button
                    type="button"
                    className="btn-ghost !px-1.5 !py-1"
                    onClick={() => setCampaignStatus(c, 'paused')}
                    aria-label={`Pausar campanha ${c.campaignName || id}`}
                    title="Pausar"
                  >
                    <Pause className="size-3.5" aria-hidden="true" />
                  </button>
                ) : c.status === 'paused' ? (
                  <button
                    type="button"
                    className="btn-ghost !px-1.5 !py-1"
                    onClick={() => setCampaignStatus(c, 'active')}
                    aria-label={`Ativar campanha ${c.campaignName || id}`}
                    title="Ativar"
                  >
                    <Play className="size-3.5" aria-hidden="true" />
                  </button>
                ) : (
                  <span className="size-3.5" aria-hidden="true" />
                )}
                {/* Duplicação (mesma conta) está disponível via Pipeboard —
                    o estado desabilitado era da era Zernio/501. */}
                {onDuplicate && (
                  <button
                    type="button"
                    className="btn-ghost !px-1.5 !py-1"
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
          <div className="anim-content-in border-t border-border/60 bg-background/40 px-3 py-3 pl-9">
            <div className="mb-2 flex flex-wrap items-center gap-3">
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
            {(c.adSets ?? []).length === 0 ? (
              <p className="py-2 text-xs text-muted-foreground">Nenhum grupo de anúncios nesta campanha.</p>
            ) : (
              (c.adSets ?? []).map((s, si) => (
                <div key={s.platformAdSetId ?? si} className="py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Layers className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="text-xs font-medium text-foreground">
                      {s.adSetName || s.name || s.platformAdSetId || `Grupo ${si + 1}`}
                    </span>
                    <StatusPill status={s.status} />
                    {(() => {
                      const groupKey = String(s.platformAdSetId ?? `${id}-${si}`)
                      const firstAdId = s.ads?.[0]?.platformAdId || s.ads?.[0]?._id
                      const budgetType: 'daily' | 'lifetime' = s.budget?.type === 'lifetime' ? 'lifetime' : 'daily'
                      if (editingBudget === groupKey && firstAdId) {
                        return (
                          <span className="inline-flex items-center gap-1">
                            <input
                              type="number"
                              inputMode="decimal"
                              min={1}
                              step="0.01"
                              value={budgetValue}
                              onChange={(e) => setBudgetValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') saveBudget(groupKey, firstAdId, budgetType)
                                if (e.key === 'Escape') setEditingBudget(null)
                              }}
                              autoFocus
                              disabled={budgetBusy}
                              aria-label="Novo orçamento do grupo"
                              className="input-neon w-20 rounded-md border border-border bg-background px-1.5 py-0.5 text-[11px] tabular-nums text-foreground"
                            />
                            <button
                              type="button"
                              className="btn-ghost !p-1 text-success"
                              onClick={() => saveBudget(groupKey, firstAdId, budgetType)}
                              disabled={budgetBusy}
                              aria-label="Salvar orçamento"
                            >
                              {budgetBusy ? (
                                <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                              ) : (
                                <Check className="size-3" aria-hidden="true" />
                              )}
                            </button>
                            <button
                              type="button"
                              className="btn-ghost !p-1 text-muted-foreground"
                              onClick={() => setEditingBudget(null)}
                              disabled={budgetBusy}
                              aria-label="Cancelar edição"
                            >
                              <X className="size-3" aria-hidden="true" />
                            </button>
                          </span>
                        )
                      }
                      return (
                        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                          {s.budget?.amount != null &&
                            `${fmtMoney(s.budget.amount, currency)}/${budgetType === 'lifetime' ? 'total' : 'dia'}`}
                          {firstAdId && (
                            <button
                              type="button"
                              className="btn-ghost !p-1"
                              onClick={() => {
                                setEditingBudget(groupKey)
                                setBudgetValue(s.budget?.amount != null ? String(s.budget.amount) : '')
                              }}
                              aria-label={`Editar orçamento do grupo ${s.adSetName || s.name || groupKey}`}
                              title="Editar orçamento"
                            >
                              <Pencil className="size-3" aria-hidden="true" />
                            </button>
                          )}
                        </span>
                      )
                    })()}
                  </div>
                  <ul className="mt-1 flex flex-col">
                    {(s.ads ?? []).map((ad, ai) => {
                      const adKey = ad.platformAdId || ad._id || String(ai)
                      return (
                        <li
                          key={adKey}
                          className="group flex flex-wrap items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-secondary/50"
                        >
                          <Clapperboard className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                          <span className="min-w-0 flex-1 truncate text-xs text-foreground">{ad.name || adKey}</span>
                          {ad.adType === 'boost' && (
                            <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                              Spark
                            </span>
                          )}
                          <StatusPill status={ad.status} />
                          {ad.rejectionReason && (
                            <span className="max-w-48 truncate text-[11px] text-error" title={ad.rejectionReason}>
                              {ad.rejectionReason}
                            </span>
                          )}
                          <span className="hidden text-[11px] tabular-nums text-muted-foreground sm:inline">
                            {fmtMoney(ad.metrics?.spend, currency)} · {fmtCompact(ad.metrics?.impressions)} impr.
                          </span>
                          {ad.creative?.linkUrl && (
                            <a
                              href={ad.creative.linkUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="btn-ghost px-1.5 py-1 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                              aria-label="Abrir página de destino do anúncio"
                              title="Página de destino"
                            >
                              <ExternalLink className="size-3" aria-hidden="true" />
                            </a>
                          )}
                          <button
                            type="button"
                            className="btn-ghost px-1.5 py-1 text-error opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                            onClick={() => setDeleteAd(ad)}
                            aria-label={`Excluir anúncio ${ad.name || adKey}`}
                            title="Excluir anúncio"
                          >
                            <Trash2 className="size-3" aria-hidden="true" />
                          </button>
                        </li>
                      )
                    })}
                    {(s.ads ?? []).length === 0 && (
                      <li className="px-2 py-1.5 text-[11px] text-muted-foreground">Sem anúncios neste grupo.</li>
                    )}
                  </ul>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    )
  }

  function renderFlatRow(row: FlatRow) {
    return row.kind === 'group' ? renderGroupHeader(row) : renderCampaignRow(row.c)
  }

  return (
    <GlassCard className="anim-content-in overflow-hidden p-0">
      {/* Toolbar: filtros de status + ordenação */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filtrar por status">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => onStatusFilter(f.value)}
              aria-pressed={statusFilter === f.value}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                statusFilter === f.value
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {typeof pagination?.total === 'number' && (
            <span className="text-[11px] text-muted-foreground">
              {pagination.total} campanha{pagination.total === 1 ? '' : 's'}
            </span>
          )}
          {onRangeDays && (
            <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
              Período:
              <select
                className="input-neon rounded-md border border-border bg-background px-2 py-1 text-[11px] text-foreground"
                value={String(rangeDays ?? 365)}
                onChange={(e) => onRangeDays(Number(e.target.value))}
                aria-label="Período de métricas e descoberta de campanhas"
              >
                <option value="7">7 dias</option>
                <option value="30">30 dias</option>
                <option value="90">90 dias</option>
                <option value="365">12 meses</option>
                <option value="730">24 meses</option>
              </select>
            </label>
          )}
          <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
            Ordenar:
            <select
              className="input-neon rounded-md border border-border bg-background px-2 py-1 text-[11px] text-foreground"
              value={sort}
              onChange={(e) => onSort(e.target.value)}
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

      {/* Barra de ações em lote — aparece com ≥1 campanha selecionada */}
      {selected.size > 0 && (
        <div className="anim-content-in flex flex-wrap items-center gap-2 border-b border-border bg-primary/5 px-4 py-2">
          <span className="text-xs font-medium text-foreground">
            {selected.size} selecionada{selected.size === 1 ? '' : 's'}
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              className="btn-ghost !px-2.5 !py-1 text-[11px]"
              onClick={() => bulkStatus('active')}
              disabled={bulkBusy}
            >
              {bulkBusy ? <Loader2 className="size-3 animate-spin" aria-hidden="true" /> : <Play className="size-3" aria-hidden="true" />}
              Ativar
            </button>
            <button
              type="button"
              className="btn-ghost !px-2.5 !py-1 text-[11px]"
              onClick={() => bulkStatus('paused')}
              disabled={bulkBusy}
            >
              <Pause className="size-3" aria-hidden="true" />
              Pausar
            </button>
            <button
              type="button"
              className="btn-ghost !px-2.5 !py-1 text-[11px] text-muted-foreground"
              onClick={() => setSelected(new Set())}
              disabled={bulkBusy}
            >
              <X className="size-3" aria-hidden="true" />
              Limpar
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
            {!statusFilter && onRangeDays && (rangeDays ?? 365) < 730 && (
              <button type="button" className="btn-ghost text-xs" onClick={() => onRangeDays(730)}>
                Buscar nos últimos 24 meses
              </button>
            )}
          </div>
        )
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
        open={Boolean(deleteAd)}
        title="Excluir este anúncio?"
        description={
          <>
            O anúncio <strong>{deleteAd?.name || deleteAd?.platformAdId}</strong> será removido do TikTok Ads.
            Essa ação não pode ser desfeita.
          </>
        }
        confirmLabel="Excluir anúncio"
        busy={deleting}
        onConfirm={handleDeleteAd}
        onClose={() => setDeleteAd(null)}
      />
    </GlassCard>
  )
}
