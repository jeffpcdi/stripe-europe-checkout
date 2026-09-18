'use client'
import { useState } from 'react'
import { apiSend } from '@/lib/api'
import type { Pixel, PixelVerifyUrlResult } from '@/lib/types'

export function InstallCheck({ pixel }: { pixel: Pixel }) {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  async function verify() {
    setBusy(true); setMessage('')
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'https:') throw new Error('Use o endereço HTTPS da página.')
      const result = await apiSend<PixelVerifyUrlResult>('/api/pixels/verify-url', 'POST', { url })
      const runtimeResult = result as PixelVerifyUrlResult & {
        runtimeCoverageComplete?: boolean
        pixels?: Array<NonNullable<PixelVerifyUrlResult['pixels']>[number] & {
          runtimeSeen?: boolean
          runtimeState?: 'seen' | 'not_seen' | 'unknown'
        }>
      }
      if (!result.ok) throw new Error(result.error || 'Não foi possível verificar a página.')
      const found = runtimeResult.pixels?.find(p => p.slug === pixel.slug)
      if (found?.runtimeSeen) {
        setMessage('Já recebemos visitas deste pixel neste site. Confira os envios recentes no Histórico.')
      } else if (found?.scriptOk || found?.nativeOk) {
        setMessage('Código encontrado. Abra a página para confirmar o recebimento de uma visita.')
      } else if (found?.runtimeState === 'unknown' || runtimeResult.runtimeCoverageComplete === false) {
        setMessage('O código não apareceu no HTML e o histórico durável está indisponível agora. Se usa GTM, SPA ou consentimento, a verificação ficou inconclusiva; tente novamente em instantes.')
      } else {
        setMessage('Código não encontrado no HTML e não houve execução recente confirmada neste site.')
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Falha na verificação.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border-t border-border/60 pt-5">
      <h3 className="text-sm font-semibold text-foreground">Verificar instalação</h3>
      <label className="mt-3 flex flex-col gap-2 text-sm text-muted-foreground">
        URL da página
        <input
          type="url"
          className="h-11 w-full rounded-lg border border-border bg-secondary/30 px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-brand-cyan/70 focus:ring-2 focus:ring-brand-cyan/15"
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="https://seusite.com/produto"
        />
      </label>
      <button type="button" className="mt-3 min-h-10 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-50" disabled={busy || !url.trim()} onClick={verify}>{busy ? 'Verificando…' : 'Verificar página'}</button>
      {message && <p role="status" className="mt-3 text-sm leading-relaxed text-muted-foreground">{message}</p>}

      <details className="group mt-5 border-t border-border/50 pt-4">
        <summary className="min-h-9 cursor-pointer list-none text-sm font-medium text-foreground">Carrinho, checkout e compra</summary>
        <div className="mt-3 flex flex-col gap-3 text-sm leading-relaxed text-muted-foreground">
          <p>Use os eventos nas ações reais do site. Um clique em comprar não é uma compra confirmada.</p>
          <p>Em botões de carrinho, use:</p>
          <code className="break-all font-mono text-xs text-foreground">data-tiktok-event="AddToCart" data-pixel-token="{pixel.token}"</code>
          <p>Em botões de checkout, use:</p>
          <code className="break-all font-mono text-xs text-foreground">data-tiktok-event="InitiateCheckout" data-pixel-token="{pixel.token}"</code>
          <p>Acrescente data-content-id, data-value e data-currency com os dados reais do produto. Links reconhecidos de checkout são detectados automaticamente quando há um pixel na página.</p>
          <p>Para espelhar a compra no navegador, chame apenas na confirmação do pagamento, usando o mesmo pedido, valor e moeda enviados pelo gateway:</p>
          <code className="break-all font-mono text-xs text-foreground">RoiNadosPixel.purchase('{pixel.token}', {'{order_id: pedido.id, value: pedido.valor, currency: pedido.moeda}'})</code>
          <p>O webhook continua necessário para registrar receita e compras pagas depois que o cliente sai da página.</p>
        </div>
      </details>
    </div>
  )
}
