'use client'

// Árvore de campanhas do TikTok Ads — campanha → ad group → ad, com métricas
// por nível, filtros de status, ordenação, paginação e ações rápidas
// (pausar/ativar, duplicar, excluir anúncio). Segue o padrão visual das
// tabelas do dashboard (linhas com stagger, status dots, ações no hover).

import { useState } from 'react'
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
} from 'lucide-react'
import { apiSend } from '@/lib/api'
import { toast } from '@/lib/toast'
import type { AdsTreeResponse, AdsTreeCampaign, AdsTreeAd, AdsMetrics, AdsNodeStatus } from '@/lib/types'
import { GlassCard } from '@/components/glass-card'
import { Skeleton } from '@/components/skeleton'
import { ErrorState } from '@/components/error-state'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { SparkLine } from '@/components/sparkline'
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

function StatusPill({ status }: { status?: AdsNodeStatus }) {
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

function MetricsRow({ m, currency }: { m?: AdsMetrics; currency: string }) {
  return (
    <div className="grid grid-cols-3 gap-x-4 gap-y-1 sm:grid-cols-6">
      <Metric label="Gasto" value={fmtMoney(m?.spend, currency)} />
      <Metric label="Impr." value={fmtCompact(m?.impressions)} />
      <Metric label="Cliques" value={fmtCompact(m?.clicks)} />
      <Metric label="CTR" value={m?.ctr != null ? fmtPercent(m.ctr) : '—'} />
      <Metric label="CPM" value={fmtMoney(m?.cpm, currency)} />
      <Metric label="Conv." value={fmtCompact(m?.conversions)} />
    </div>
  )
}

const STATUS_FILTERS = [
  { value: '', label: 'Todas' },
  { value: 'active', label: 'Ativas' },
  { value: 'paused', label: 'Pausadas' },
  { value: 'pending_review', label: 'Em revisão' },
  { value: 'rejected', label: 'Rejeitadas' },
]

const SORTS = [
  { value: 'newest', label: 'Mais recentes' },
  { value: 'oldest', label: 'Mais antigas' },
  { value: 'spend', label: 'Maior gasto' },
  { value: 'impressions', label: 'Mais impressões' },
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
  onMutate,
  onRetry,
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
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [busyId, setBusyId] = useState<string | null>(null)
  const [deleteAd, setDeleteAd] = useState<AdsTreeAd | null>(null)
  const [deleting, setDeleting] = useState(false)

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

  async function duplicateCampaign(c: AdsTreeCampaign) {
    const id = c.platformCampaignId
    setBusyId(id)
    try {
      await apiSend(`/api/ads/campaigns/${encodeURIComponent(id)}/duplicate`, 'POST', {})
      toast.success('Campanha duplicada', { hint: 'A cópia chega pausada — revise e ative.' })
      onMutate()
    } catch (e) {
      toast.error('Falha ao duplicar', { hint: e instanceof Error ? e.message : undefined })
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
        <label className="ml-auto flex items-center gap-2 text-[11px] text-muted-foreground">
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
        <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-secondary">
            <Megaphone className="size-6 text-muted-foreground" aria-hidden="true" />
          </span>
          <p className="text-sm font-medium text-foreground">
            {statusFilter ? 'Nenhuma campanha com esse status' : 'Nenhuma campanha ainda'}
          </p>
          <p className="max-w-sm text-pretty text-xs text-muted-foreground">
            {statusFilter
              ? 'Ajuste o filtro acima para ver as demais campanhas do advertiser.'
              : 'Crie sua primeira campanha no botão “Nova campanha” ou impulsione um vídeo orgânico com Spark Ads.'}
          </p>
        </div>
      ) : (
        <ul className="stagger divide-y divide-border">
          {campaigns.map((c) => {
            const id = c.platformCampaignId
            const isOpen = expanded.has(id)
            const busy = busyId === id
            const spendSeries = (c.daily ?? []).map((d) => d.spend ?? 0)
            return (
              <li key={id} className="anim-row-in">
                {/* Linha da campanha */}
                <div className="flex flex-wrap items-center gap-3 px-4 py-3 transition-colors hover:bg-secondary/40">
                  <button
                    type="button"
                    onClick={() => toggle(id)}
                    aria-expanded={isOpen}
                    aria-label={`${isOpen ? 'Recolher' : 'Expandir'} campanha ${c.campaignName || id}`}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <ChevronRight
                      className={`size-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? 'rotate-90' : ''}`}
                      aria-hidden="true"
                    />
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary">
                      <Megaphone className="size-4 text-muted-foreground" aria-hidden="true" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {c.campaignName || id}
                      </span>
                      <span className="mt-0.5 flex items-center gap-2">
                        <StatusPill status={c.status} />
                        {c.reviewStatus === 'rejected' && (
                          <span className="inline-flex items-center gap-1 text-[11px] text-error">
                            <AlertTriangle className="size-3" aria-hidden="true" />
                            revisão rejeitada
                          </span>
                        )}
                        <span className="text-[11px] text-muted-foreground">
                          {c.adSetCount ?? c.adSets?.length ?? 0} grupo{(c.adSetCount ?? c.adSets?.length ?? 0) === 1 ? '' : 's'} ·{' '}
                          {c.adCount ?? 0} anúncio{(c.adCount ?? 0) === 1 ? '' : 's'}
                        </span>
                      </span>
                    </span>
                  </button>

                  {spendSeries.length > 1 && (
                    <SparkLine data={spendSeries} color="var(--primary)" width={72} height={24} />
                  )}

                  <div className="hidden w-72 shrink-0 md:block">
                    <MetricsRow m={c.metrics} currency={c.currency || currency} />
                  </div>

                  {/* Ações da campanha */}
                  <div className="flex shrink-0 items-center gap-1">
                    {busy ? (
                      <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />
                    ) : (
                      <>
                        {c.status === 'active' ? (
                          <button
                            type="button"
                            className="btn-ghost px-2 py-1"
                            onClick={() => setCampaignStatus(c, 'paused')}
                            aria-label={`Pausar campanha ${c.campaignName || id}`}
                            title="Pausar"
                          >
                            <Pause className="size-3.5" aria-hidden="true" />
                          </button>
                        ) : c.status === 'paused' ? (
                          <button
                            type="button"
                            className="btn-ghost px-2 py-1"
                            onClick={() => setCampaignStatus(c, 'active')}
                            aria-label={`Ativar campanha ${c.campaignName || id}`}
                            title="Ativar"
                          >
                            <Play className="size-3.5" aria-hidden="true" />
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="btn-ghost px-2 py-1"
                          onClick={() => duplicateCampaign(c)}
                          aria-label={`Duplicar campanha ${c.campaignName || id}`}
                          title="Duplicar"
                        >
                          <Copy className="size-3.5" aria-hidden="true" />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Métricas no mobile */}
                <div className="px-4 pb-3 md:hidden">
                  <MetricsRow m={c.metrics} currency={c.currency || currency} />
                </div>

                {/* Ad groups + ads expandidos */}
                {isOpen && (
                  <div className="anim-content-in border-t border-border/60 bg-background/40 px-4 py-2 pl-10">
                    {(c.adSets ?? []).length === 0 ? (
                      <p className="py-3 text-xs text-muted-foreground">Nenhum grupo de anúncios nesta campanha.</p>
                    ) : (
                      (c.adSets ?? []).map((s, si) => (
                        <div key={s.platformAdSetId ?? si} className="py-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Layers className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                            <span className="text-xs font-medium text-foreground">
                              {s.adSetName || s.name || s.platformAdSetId || `Grupo ${si + 1}`}
                            </span>
                            <StatusPill status={s.status} />
                            {s.budget?.amount != null && (
                              <span className="text-[11px] text-muted-foreground">
                                {fmtMoney(s.budget.amount, currency)}/{s.budget.type === 'lifetime' ? 'total' : 'dia'}
                              </span>
                            )}
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
                                  <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                                    {ad.name || adKey}
                                  </span>
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
              </li>
            )
          })}
        </ul>
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
