'use client'

import { useState } from 'react'
import { CheckCircle2, ChevronDown, Loader2 } from 'lucide-react'
import { useAdsRejections, apiSend } from '@/lib/api'
import type { AdsAdRejection } from '@/lib/types'
import { toast } from '@/lib/toast'
import { Switch } from '@/components/switch'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { cn } from '@/lib/utils'

function appealLabel(item: AdsAdRejection) {
  if (item.appealStatus === 'failed') return 'Tentar novamente'
  return 'Recorrer'
}

export function RejectionInbox({ active, adAccountId, autoAppeal, canAutoAppeal, saving, onAutoAppealChange }: {
  active: boolean
  adAccountId: string
  autoAppeal: boolean
  canAutoAppeal: boolean
  saving: boolean
  onAutoAppealChange: (enabled: boolean) => void
}) {
  const { data, mutate } = useAdsRejections(active, adAccountId)
  const items = data?.items ?? []
  const [expanded, setExpanded] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [selected, setSelected] = useState<AdsAdRejection | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [confirmAuto, setConfirmAuto] = useState(false)
  const visibleItems = showAll ? items : items.slice(0, 4)

  async function submitAppeal() {
    if (!selected || submitting) return
    setSubmitting(true)
    try {
      await apiSend(`/api/ads/rejections/${selected.id}/appeal`, 'POST', { adAccountId })
      toast.success('Recurso enviado')
      setSelected(null)
      await mutate()
    } catch (error) { toast.error('Não foi possível enviar o recurso', { hint: error instanceof Error ? error.message : undefined }) }
    finally { setSubmitting(false) }
  }

  const statusText = items.length ? `${items.length} ${items.length === 1 ? 'reprovação aguardando revisão' : 'reprovações aguardando revisão'}` : 'Nenhuma reprovação aberta'

  return <section className="border-b border-border/60 pb-4">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <button type="button" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded} className="min-w-0 text-left">
        <h3 className="text-sm font-semibold text-foreground">Reprovações de anúncios</h3>
        <p className="mt-1 text-xs text-muted-foreground">{statusText}</p>
      </button>
      <button type="button" className="btn-ghost min-h-10 px-3 text-xs" onClick={() => setExpanded((v) => !v)}>{items.length ? 'Revisar' : 'Configurar'}<ChevronDown className={cn('size-3.5 transition-transform', expanded && 'rotate-180')} /></button>
    </div>
    {expanded ? <div className="mt-4 space-y-4 border-t border-border/60 pt-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div><p className="text-sm font-medium text-foreground">Recurso automático de anúncios Smart+</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Quando um anúncio Smart+ for reprovado e o TikTok permitir, o ROI-NADOS envia o primeiro recurso automaticamente. Banimentos da conta continuam em Saúde das contas.</p>{!canAutoAppeal ? <p className="mt-1 text-xs text-muted-foreground">Escolha “Aplicar sozinho” para permitir recurso automático.</p> : null}</div>
        <Switch checked={autoAppeal} disabled={saving || !canAutoAppeal} onCheckedChange={(value) => value ? setConfirmAuto(true) : onAutoAppealChange(false)} aria-label={autoAppeal ? 'Desligar recurso automático' : 'Ligar recurso automático'} />
      </div>
      {items.length ? <ul className="divide-y divide-border/60 border-y border-border/60">{visibleItems.map((item) => {
        const appealSent = ['submitted', 'in_review'].includes(item.appealStatus)
        const smart = item.campaignKind === 'smart_plus'
        return <li key={item.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="text-sm font-medium text-foreground">{item.adGroupName || item.adName}</p><p className="mt-1 text-xs text-muted-foreground">{smart ? 'Smart+' : 'Campanha comum'} · {item.campaignName} · {item.adIds.length} {item.adIds.length === 1 ? 'anúncio' : 'anúncios'}</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.reason}</p>{item.appealError ? <p className="mt-1 text-xs text-error">{item.appealError}</p> : null}</div>{appealSent ? <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-success"><CheckCircle2 className="size-4" />Recurso enviado</span> : smart ? <button type="button" className="btn-ghost min-h-10 shrink-0 text-xs" disabled={item.appealStatus === 'submitting'} onClick={() => setSelected(item)}>{item.appealStatus === 'submitting' ? <Loader2 className="size-3.5 animate-spin" /> : null}{appealLabel(item)}</button> : <span className="text-xs text-muted-foreground">Recurso manual no TikTok</span>}</li>
      })}</ul> : null}
      {items.length > 4 ? <button type="button" className="btn-ghost min-h-10 text-xs" onClick={() => setShowAll((v) => !v)}>{showAll ? 'Mostrar menos' : `Ver mais ${items.length - 4}`}</button> : null}
    </div> : null}

    <ConfirmDialog open={Boolean(selected)} title="Enviar recurso ao TikTok?" description="O recurso será enviado uma vez para o incidente atual. O TikTok reavalia o grupo inteiro." confirmLabel="Enviar recurso" tone="default" appearance="quiet" busy={submitting} onClose={() => !submitting && setSelected(null)} onConfirm={submitAppeal} />
    <ConfirmDialog open={confirmAuto} title="Enviar recursos Smart+ automaticamente?" description="O ROI-NADOS poderá enviar o primeiro recurso de anúncios Smart+ reprovados sem uma confirmação individual." confirmLabel="Ativar recurso automático" appearance="quiet" tone="default" onClose={() => setConfirmAuto(false)} onConfirm={() => { onAutoAppealChange(true); setConfirmAuto(false) }} />
  </section>
}
