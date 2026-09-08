'use client'

import { DialogPortal } from '@/components/ui/dialog-portal'

// Wrapper fino de modal sobre o DuplicatePanel — preserva a ação por-campanha
// do CampaignTree (onDuplicate). O fluxo inteiro vive em duplicate-panel.tsx,
// que também alimenta a aba "Duplicação" do TikTok Ads.

import { useRef, useState } from 'react'
import { X, Copy } from 'lucide-react'
import type { AdsTreeCampaign, AdsAdvertiser } from '@/lib/types'
import { GlassCard } from '@/components/glass-card'
import { useModalA11y } from '@/lib/use-modal-a11y'
import { DuplicatePanel } from './duplicate-panel'

export function DuplicateDialog({
  campaign,
  onClose,
  advertisers,
  currentAdvertiserId,
  onFinished,
}: {
  campaign: AdsTreeCampaign | null
  onClose: () => void
  advertisers: AdsAdvertiser[]
  currentAdvertiserId: string
  onFinished: () => void
}) {
  const open = Boolean(campaign)
  const ref = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)

  useModalA11y(open, ref, busy ? () => {} : onClose)

  if (!open || !campaign) return null

  return (
    <DialogPortal><div
      className="ads-dialog fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-black/80 p-4 backdrop-blur-md"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div ref={ref} role="dialog" aria-modal="true" aria-label="Duplicar campanha" tabIndex={-1} className="w-full max-w-md outline-none">
        <GlassCard className="anim-pop-in flex flex-col gap-4 p-5 bg-[#040406]/95 border border-white/10 shadow-[0_0_50px_rgba(0,0,0,0.8)]">
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Copy className="size-4 text-primary" aria-hidden="true" />
              Duplicar campanha
            </h2>
            <button type="button" className="btn-ghost px-2 py-1" onClick={onClose} disabled={busy} aria-label="Fechar">
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
          <DuplicatePanel
            campaign={campaign}
            advertisers={advertisers}
            currentAdvertiserId={currentAdvertiserId}
            onFinished={onFinished}
            onClose={onClose}
            onBusyChange={setBusy}
          />
        </GlassCard>
      </div>
    </div></DialogPortal>
  )
}
