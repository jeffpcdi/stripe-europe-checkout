'use client'
import { useRef, useState } from 'react'
import type { Pixel, Gateway } from '@/lib/types'
import { apiSend } from '@/lib/api'
import { toast } from '@/lib/toast'
import { useModalA11y } from '@/lib/use-modal-a11y'
import { DialogPortal } from '@/components/ui/dialog-portal'
import { GatewaySelector } from './gateway-selector'

export function LinkGatewaysModal({ pixel, gateways, onClose, onSaved }: { pixel: Pixel; gateways: Gateway[]; onClose: () => void; onSaved: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState(pixel.gatewayIds || [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useModalA11y(true, ref, () => { if (!busy) onClose() })

  async function save() {
    if (busy) return
    setBusy(true); setError('')
    try {
      await apiSend('/api/pixels', 'POST', { slug: pixel.slug, gatewayIds: selected })
      toast.success('Vínculos salvos'); onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível salvar.')
      setBusy(false)
    }
  }

  return (
    <DialogPortal><div
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/75 p-4 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget && !busy) onClose() }}
    >
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="link-gateways-title"
        className="dialog-surface w-full max-w-lg max-h-[90dvh] overflow-y-auto rounded-2xl border border-border/70 bg-background p-6 shadow-xl outline-none"
      >
        <div>
          <h2 id="link-gateways-title" className="text-base font-semibold text-foreground">Checkouts deste pixel</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">{pixel.name}</p>
        </div>

        <div className="mt-5">
          <GatewaySelector gateways={gateways} selected={selected} onChange={setSelected} disabled={busy} />
        </div>

        {error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" className="min-h-10 rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50" disabled={busy} onClick={onClose}>Cancelar</button>
          <button type="button" className="min-h-10 rounded-lg bg-brand-cyan px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-brand-cyan/90 disabled:opacity-50" disabled={busy} onClick={save}>{busy ? 'Salvando…' : 'Salvar vínculos'}</button>
        </div>
      </div>
    </div></DialogPortal>
  )
}
