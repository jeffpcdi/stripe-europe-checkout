'use client'

import { useState } from 'react'
import { CheckCircle2, ChevronDown, Loader2, ShieldAlert } from 'lucide-react'
import { apiSend, useAdsRejections } from '@/lib/api'
import { toast } from '@/lib/toast'
import type { AdsAdRejection } from '@/lib/types'
import { GlassCard } from '@/components/glass-card'
import { Switch } from '@/components/switch'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { cn } from '@/lib/utils'

function appealLabel(item: AdsAdRejection) {
  if (item.appealStatus === 'submitted' || item.appealStatus === 'in_review') return 'Recurso enviado'
  if (item.appealStatus === 'submitting') return 'Enviando…'
  if (item.appealStatus === 'failed') return 'Tentar novamente'
  return 'Recorrer'
}

export function RejectionInbox({
  active,
  adAccountId,
  autoAppeal,
  canAutoAppeal,
  saving,
  onAutoAppealChange,
}: {
  active: boolean
  adAccountId: string
  autoAppeal: boolean
  canAutoAppeal: boolean
  saving: boolean
  onAutoAppealChange: (enabled: boolean) => void
}) {
  const { data, mutate, isLoading } = useAdsRejections(active, adAccountId)
  const [selected, setSelected] = useState<AdsAdRejection | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const items = data?.items ?? []
  const visibleItems = showAll ? items : items.slice(0, 4)

  async function submitAppeal() {
    if (!selected || submitting) return
    setSubmitting(true)
    try {
      await apiSend(`/api/ads/rejections/${encodeURIComponent(selected.id)}/appeal`, 'POST', { adAccountId })
      toast.success('Recurso enviado ao TikTok', { hint: 'A central continuará acompanhando este incidente.' })
      setSelected(null)
      await mutate()
    } catch (error) {
      toast.error('Não foi possível enviar o recurso', { hint: error instanceof Error ? error.message : undefined })
    } finally {
      setSubmitting(false)
    }
  }

  const statusText = isLoading && !data
    ? 'Atualizando…'
    : items.length
      ? `${items.length} ${items.length === 1 ? 'reprovação aberta' : 'reprovações abertas'}`
      : 'Nenhuma reprovação aberta'

  return (
    <GlassCard className="p-3.5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-start gap-3 rounded-lg text-left transition-colors hover:bg-[var(--hover)]/50"
        >
          <span className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-xl',
            items.length ? 'bg-error/10 text-error' : 'bg-success/10 text-success',
          )}>
            {items.length ? <ShieldAlert className="size-4.5" aria-hidden="true" /> : <CheckCircle2 className="size-4.5" aria-hidden="true" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-foreground">Reprovações</span>
              {!items.length ? (
                <span className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">Tudo certo</span>
              ) : null}
            </span>
            <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">{statusText}</span>
          </span>
        </button>

        <div className="flex items-center gap-2 self-end sm:self-start">
          <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setExpanded((value) => !value)}>
            {items.length ? 'Revisar' : 'Configurar'}
            <ChevronDown className={cn('size-3.5 transition-transform', expanded && 'rotate-180')} aria-hidden="true" />
          </button>
        </div>
      </div>

      {expanded ? (
        <div className="mt-3 space-y-3 border-t border-border/60 pt-3">
          <div className="flex flex-col gap-2 rounded-xl border border-border bg-background p-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-medium text-foreground">Recorrer automaticamente</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Envia o primeiro recurso de Smart+ automaticamente quando permitido.
              </p>
            </div>
            <div className="flex items-center gap-2 self-start sm:self-center">
              <span className="text-[11px] text-muted-foreground">Auto recurso</span>
              <Switch
                checked={autoAppeal}
                disabled={saving || !canAutoAppeal}
                onCheckedChange={onAutoAppealChange}
                aria-label={autoAppeal ? 'Desligar recurso automático' : 'Ligar recurso automático'}
              />
            </div>
          </div>

          {!canAutoAppeal ? (
            <p className="text-[11px] text-muted-foreground">Escolha “Aplicar sozinho” para liberar recurso automático.</p>
          ) : null}

          {items.length > 0 ? (
            <ul className="divide-y divide-border/60 border-t border-border/60">
              {visibleItems.map((item) => {
                const appealSent = ['submitted', 'in_review'].includes(item.appealStatus)
                const smart = item.campaignKind === 'smart_plus'
                return (
                  <li key={item.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-xs font-medium text-foreground">{item.adGroupName || item.adName}</span>
                        <span className="rounded-full bg-[var(--hover)] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                          {smart ? 'Smart+' : 'Campanha comum'}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-[10px] text-muted-foreground" title={item.reason}>
                        {item.campaignName} · {item.adIds.length} {item.adIds.length === 1 ? 'anúncio' : 'anúncios'} · {item.reason}
                      </p>
                      {item.appealError ? <p className="mt-1 text-[10px] text-error">{item.appealError}</p> : null}
                    </div>
                    {appealSent ? (
                      <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-success">
                        <CheckCircle2 className="size-3.5" aria-hidden="true" />
                        Recurso enviado
                      </span>
                    ) : smart ? (
                      <button
                        type="button"
                        className="btn-ghost shrink-0 px-2.5 py-1.5 text-[11px]"
                        disabled={item.appealStatus === 'submitting'}
                        onClick={() => setSelected(item)}
                      >
                        {item.appealStatus === 'submitting' ? <Loader2 className="size-3 animate-spin" aria-hidden="true" /> : null}
                        {appealLabel(item)}
                      </button>
                    ) : (
                      <span className="shrink-0 text-[10px] text-muted-foreground">Recurso manual no TikTok</span>
                    )}
                  </li>
                )
              })}
            </ul>
          ) : null}

          {items.length > 4 ? (
            <button
              type="button"
              className="text-[10px] font-medium text-accent transition-colors hover:text-accent/80"
              onClick={() => setShowAll((value) => !value)}
            >
              {showAll ? 'Mostrar menos' : `Ver mais ${items.length - 4}`}
            </button>
          ) : null}
        </div>
      ) : null}

      <ConfirmDialog
        open={Boolean(selected)}
        title="Enviar recurso ao TikTok?"
        description="A dashboard montará uma justificativa objetiva com os dados disponíveis e enviará uma única vez para este incidente. O TikTok reavalia o grupo inteiro."
        confirmLabel="Enviar recurso"
        tone="default"
        busy={submitting}
        onClose={() => !submitting && setSelected(null)}
        onConfirm={submitAppeal}
      />
    </GlassCard>
  )
}
