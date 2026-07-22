'use client'

import { useState } from 'react'
import { CheckCircle2, Loader2, ShieldAlert } from 'lucide-react'
import { apiSend, useAdsRejections } from '@/lib/api'
import { toast } from '@/lib/toast'
import type { AdsAdRejection } from '@/lib/types'
import { GlassCard } from '@/components/glass-card'
import { Switch } from '@/components/switch'
import { ConfirmDialog } from '@/components/confirm-dialog'

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
  const items = data?.items ?? []
  const visibleItems = expanded ? items : items.slice(0, 5)

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

  return (
    <GlassCard className="p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-error/10 text-error">
            <ShieldAlert className="size-4.5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">Reprovações</h3>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {isLoading && !data
                ? 'Atualizando…'
                : items.length
                  ? `${items.length} ${items.length === 1 ? 'grupo precisa' : 'grupos precisam'} de atenção`
                  : 'Nenhuma reprovação aberta nesta conta'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 self-start rounded-lg border border-border bg-background px-2.5 py-1.5">
          <span className="text-[11px] text-muted-foreground">Recorrer sozinho</span>
          <Switch
            checked={autoAppeal}
            disabled={saving || !canAutoAppeal}
            onCheckedChange={onAutoAppealChange}
            aria-label={autoAppeal ? 'Desligar recurso automático' : 'Ligar recurso automático'}
          />
        </div>
      </div>

      {!canAutoAppeal && (
        <p className="mt-2 text-[10px] text-muted-foreground">Selecione “Agir sozinho” para liberar o envio automático; detectar e listar continua ativo.</p>
      )}

      {items.length > 0 && (
        <ul className="mt-3 divide-y divide-border/60 border-t border-border/60">
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
      )}

      {items.length > 5 ? (
        <button
          type="button"
          className="mt-1 text-[10px] font-medium text-accent transition-colors hover:text-accent/80"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? 'Mostrar menos' : `Ver mais ${items.length - 5}`}
        </button>
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
