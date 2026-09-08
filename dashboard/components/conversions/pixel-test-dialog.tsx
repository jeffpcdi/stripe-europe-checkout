'use client'
import { useRef, useState } from 'react'
import { apiSend } from '@/lib/api'
import type { Pixel } from '@/lib/types'
import { conversionEvent } from '@/lib/conversion-status'
import { useModalA11y } from '@/lib/use-modal-a11y'
import { DialogPortal } from '@/components/ui/dialog-portal'

export function PixelTestDialog({ pixel, onClose, onSent }: { pixel: Pixel; onClose: () => void; onSent: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [event, setEvent] = useState('ViewContent')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const needsCode = ['Purchase', 'AddPaymentInfo'].includes(event) && !pixel.testEventCode
  useModalA11y(true, ref, () => { if (!busy) onClose() })
  async function send() {
    if (busy || needsCode || !pixel.hasToken) return
    setBusy(true); setResult(null)
    try {
      const reply = await apiSend<{ ok: boolean; message?: string; messagePtBr?: string; eventId?: string }>('/api/pixels/test', 'POST', { slug: pixel.slug, event })
      setResult({ ok: reply.ok, message: reply.ok ? 'TikTok confirmou o recebimento deste evento.' : reply.messagePtBr || reply.message || 'TikTok não confirmou o envio.' }); onSent()
    } catch (e) { setResult({ ok: false, message: e instanceof Error ? e.message : 'Falha no envio.' }) }
    finally { setBusy(false) }
  }
  return <DialogPortal><div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4 backdrop-blur-sm">
    <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`Testar ${pixel.name}`} className="w-full max-w-md rounded-2xl border border-border bg-card p-5 flex flex-col gap-4">
      <h2 className="text-base font-semibold">Testar {pixel.name}</h2>
      <label className="text-xs flex flex-col gap-2">Evento<select className="rounded-lg border border-border bg-background p-3 text-sm" value={event} disabled={busy} onChange={e => { setEvent(e.target.value); setResult(null) }}>{['ViewContent', 'AddToCart', 'InitiateCheckout', 'AddPaymentInfo', 'Purchase'].map(name => <option key={name} value={name}>{conversionEvent(name)}</option>)}</select></label>
      <p className="text-xs text-muted-foreground">{pixel.testEventCode ? 'O evento será enviado ao modo de teste do TikTok.' : 'Sem código de teste, visitas e ações de teste chegam aos eventos reais do TikTok. Configure o código no editor para testar separadamente.'}</p>
      {!pixel.hasToken && <p className="text-xs text-warning">Configure o token de acesso no editor.</p>}
      {needsCode && <p className="text-xs text-warning">Para testar pagamento ou compra, salve primeiro o código de teste no editor do pixel.</p>}
      {result && <p role="status" className={result.ok ? 'text-sm text-success' : 'text-sm text-destructive'}>{result.message}</p>}
      <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" disabled={busy} onClick={onClose}>Fechar</button><button type="button" className="btn-primary" disabled={busy || needsCode || !pixel.hasToken} onClick={send}>{busy ? 'Enviando…' : 'Enviar teste'}</button></div>
    </div>
  </div></DialogPortal>
}
