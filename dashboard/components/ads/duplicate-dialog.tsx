'use client'

import { useRef, useState } from 'react'
import { X } from 'lucide-react'
import { DialogPortal } from '@/components/ui/dialog-portal'
import type { AdsTreeCampaign, AdsAdvertiser } from '@/lib/types'
import { useModalA11y } from '@/lib/use-modal-a11y'
import { DuplicatePanel } from './duplicate-panel'

export function DuplicateDialog({ campaign, onClose, advertisers, currentAdvertiserId, onFinished }: { campaign: AdsTreeCampaign | null; onClose: () => void; advertisers: AdsAdvertiser[]; currentAdvertiserId: string; onFinished: () => void }) {
  const open = Boolean(campaign)
  const ref = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  useModalA11y(open, ref, busy ? () => {} : onClose)
  if (!open || !campaign) return null

  return <DialogPortal><div className="ads-dialog fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-background/80 p-3 backdrop-blur-sm sm:p-4" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}>
    <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="duplicate-dialog-title" tabIndex={-1} className="relative flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl outline-none">
      <div className="flex items-start justify-between gap-4 border-b border-border/60 px-4 py-4 sm:px-5"><div><h2 id="duplicate-dialog-title" className="text-base font-semibold text-foreground">Duplicar campanha</h2><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Crie cópias da estrutura atual na mesma conta e revise qualquer ajuste necessário antes de enviar.</p></div><button type="button" className="flex size-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary/60 hover:text-foreground" onClick={onClose} disabled={busy} aria-label="Fechar"><X className="size-4" /></button></div>
      <div className="flex-1 overflow-y-auto p-4 sm:p-5"><DuplicatePanel campaign={campaign} advertisers={advertisers} currentAdvertiserId={currentAdvertiserId} onFinished={onFinished} onClose={onClose} onBusyChange={setBusy} /></div>
    </div>
  </div></DialogPortal>
}
