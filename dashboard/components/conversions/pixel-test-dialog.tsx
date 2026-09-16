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
      setResult({ ok: reply.ok, message: reply.ok ? 'TikTok confirmou o recebimento deste evento.' : reply.messagePtBr || reply.message || 'TikTok não confirmou o envio.' })
      onSent()
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : 'Falha no envio.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <DialogPortal><div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/75 p-4 backdrop-blur-sm" onClick={e => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="pixel-test-title" className="dialog-surface w-full max-w-md rounded-2xl border border-border/70 bg-background p-6 shadow-xl outline-none">
        <div>
          <h2 id="pixel-test-title" className="text-base font-semibold text-foreground">Testar conexão</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">{pixel.name}</p>
        </div>

        <label className="mt-5 flex flex-col gap-2 text-sm font-medium text-foreground">
          Evento
          <select className="h-11 rounded-lg border border-border bg-secondary/30 px-3 text-sm text-foreground outline-none transition-colors focus:border-brand-cyan/70 focus:ring-2 focus:ring-brand-cyan/15" value={event} disabled={busy} onChange={e => { setEvent(e.target.value); setResult(null) }}>
            {['ViewContent', 'AddToCart', 'InitiateCheckout', 'AddPaymentInfo', 'Purchase'].map(name => <option key={name} value={name}>{conversionEvent(name)}</option>)}
          </select>
        </label>

        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {pixel.testEventCode ? 'O evento será enviado ao modo de teste do TikTok.' : 'Sem código de teste, o evento chega aos eventos reais do TikTok. Configure um código no editor para testar separadamente.'}
        </p>
        {!pixel.hasToken && <p className="mt-3 text-sm text-warning">Configure o token de acesso para enviar o teste.</p>}
        {needsCode && <p className="mt-3 text-sm text-warning">Para testar pagamento ou compra, salve primeiro o código de teste no editor do pixel.</p>}
        {result && <p role="status" className={`mt-4 text-sm ${result.ok ? 'text-success' : 'text-destructive'}`}>{result.ok ? 'Confirmado · ' : 'Falhou · '}{result.message}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" className="min-h-10 rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50" disabled={busy} onClick={onClose}>Fechar</button>
          <button type="button" className="min-h-10 rounded-lg bg-brand-cyan px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-brand-cyan/90 disabled:cursor-not-allowed disabled:opacity-40" disabled={busy || needsCode || !pixel.hasToken} onClick={send}>{busy ? 'Enviando…' : 'Enviar teste'}</button>
        </div>
      </div>
    </div></DialogPortal>
  )
}
