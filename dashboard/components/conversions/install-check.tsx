'use client'
import { useState } from 'react'
import { apiSend } from '@/lib/api'
import type { Pixel } from '@/lib/types'

export function InstallCheck({ pixel }: { pixel: Pixel }) {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  async function verify() {
    setBusy(true); setMessage('')
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'https:') throw new Error('Use o endereço HTTPS da página.')
      const result = await apiSend<{ ok: boolean; error?: string; pixels?: { slug: string; scriptOk: boolean; runtimeSeen: boolean; lastSeenAt?: string }[] }>('/api/pixels/verify-url', 'POST', { url })
      if (!result.ok) throw new Error(result.error || 'Não foi possível verificar a página.')
      const found = result.pixels?.find(p => p.slug === pixel.slug)
      setMessage(found?.runtimeSeen ? 'Já recebemos visitas deste pixel neste site. Confira os envios recentes no Histórico.' : found?.scriptOk ? 'Código encontrado. Abra a página para confirmar o recebimento de uma visita.' : 'Código não encontrado no HTML. Se usa GTM, publique o contêiner e abra a página; a execução será confirmada pelos eventos recebidos.')
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Falha na verificação.') }
    finally { setBusy(false) }
  }
  return <div className="flex flex-col gap-3 border-t border-border pt-4">
    <label className="text-xs font-semibold flex flex-col gap-2">Verificar instalação<input type="url" className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://seusite.com/produto" /></label>
    <button type="button" className="btn-ghost self-start" disabled={busy || !url.trim()} onClick={verify}>{busy ? 'Verificando…' : 'Verificar página'}</button>
    {message && <p role="status" className="text-xs text-muted-foreground">{message}</p>}
    <details><summary className="cursor-pointer text-xs font-semibold min-h-9">Carrinho, checkout e compra</summary>
      <div className="mt-2 flex flex-col gap-3 text-xs text-muted-foreground"><p>Use os eventos nas ações reais do site. Um clique em comprar não é uma compra confirmada.</p>
        <p>Em botões de carrinho, use:</p><code className="break-all">data-tiktok-event="AddToCart" data-pixel-token="{pixel.token}"</code>
        <p>Em botões de checkout, use:</p><code className="break-all">data-tiktok-event="InitiateCheckout" data-pixel-token="{pixel.token}"</code>
        <p>Acrescente data-content-id, data-value e data-currency com os dados reais do produto. Links reconhecidos de checkout são detectados automaticamente quando há um pixel na página.</p>
        <p>Para espelhar a compra no navegador, chame apenas na confirmação do pagamento, usando o mesmo pedido, valor e moeda enviados pelo gateway:</p>
        <code className="break-all">RoiNadosPixel.purchase('{pixel.token}', {'{order_id: pedido.id, value: pedido.valor, currency: pedido.moeda}'})</code>
        <p>O webhook continua necessário para registrar receita e compras pagas depois que o cliente sai da página.</p>
      </div>
    </details>
  </div>
}
