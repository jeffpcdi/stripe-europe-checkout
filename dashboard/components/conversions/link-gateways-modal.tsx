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
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível salvar.'); setBusy(false) }
  }
  return <DialogPortal><div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4 backdrop-blur-sm" onClick={e => { if (e.target === e.currentTarget && !busy) onClose() }}>
    <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`Checkouts de ${pixel.name}`} className="w-full max-w-lg max-h-[90dvh] overflow-y-auto rounded-2xl border border-border bg-card p-5 flex flex-col gap-4">
      <h2 className="text-base font-semibold">Checkouts de {pixel.name}</h2>
      <GatewaySelector gateways={gateways} selected={selected} onChange={setSelected} disabled={busy} />
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" disabled={busy} onClick={onClose}>Cancelar</button><button type="button" className="btn-primary" disabled={busy} onClick={save}>{busy ? 'Salvando…' : 'Salvar vínculos'}</button></div>
    </div>
  </div></DialogPortal>
}
