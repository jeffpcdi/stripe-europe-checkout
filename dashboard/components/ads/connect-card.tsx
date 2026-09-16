'use client'

// Estado operacional da integração TikTok Ads via Pipeboard. NÃO há OAuth por
// usuário: o frontend apenas verifica se a integração de servidor está pronta
// e se existe advertiser visível. Quando a chave está válida, mas nenhuma conta
// aparece, o vínculo é feito no painel do Pipeboard.

import { useState } from 'react'
import { ExternalLink, Loader2, RefreshCw } from 'lucide-react'
import { apiSend } from '@/lib/api'
import { toast } from '@/lib/toast'

function TikTokMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z" />
    </svg>
  )
}

export function AdsConnectCard({ onConnected }: { onConnected: () => void }) {
  const [checking, setChecking] = useState(false)
  const [needsLink, setNeedsLink] = useState(false)

  async function handleVerify() {
    setChecking(true)
    try {
      const r = await apiSend<{ alreadyConnected?: boolean }>('/api/ads/connect', 'POST')
      if (r.alreadyConnected) {
        const c = await apiSend<{ connected: boolean }>('/api/ads/connected', 'POST')
        if (c.connected) {
          setNeedsLink(false)
          toast.success('Integração TikTok Ads verificada')
          onConnected()
          return
        }
      }
      setNeedsLink(true)
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      if (msg.includes('advertiser') || msg.includes('Pipeboard')) {
        setNeedsLink(true)
      } else {
        toast.error('Falha ao verificar a integração', { hint: msg || undefined })
      }
    } finally {
      setChecking(false)
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-5 sm:p-6" aria-labelledby="ads-connect-title">
      <div className="flex items-start gap-3">
        <TikTokMark className="mt-0.5 size-5 shrink-0 text-foreground" />
        <div className="min-w-0 max-w-2xl">
          <h2 id="ads-connect-title" className="text-base font-semibold text-foreground">Verificar integração TikTok Ads</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            O ROI-NADOS acessa o TikTok Ads por uma integração de servidor via Pipeboard. Verifique se a integração está pronta e se existe uma conta de anúncios disponível.
          </p>
        </div>
      </div>

      {needsLink ? (
        <div className="mt-5 border-l-2 border-warning pl-3">
          <p className="text-sm font-medium text-foreground">Integração do servidor pronta</p>
          <p className="mt-1 text-xs text-muted-foreground">● Pipeboard disponível</p>
          <p className="mt-3 text-sm font-medium text-warning">Nenhuma conta de anúncios disponível</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Vincule a conta TikTok Ads no painel do Pipeboard e volte para verificar.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href="https://pipeboard.co" target="_blank" rel="noopener noreferrer" className="btn-secondary min-h-10 text-xs">
              <ExternalLink className="size-3.5" aria-hidden="true" />
              Abrir Pipeboard
            </a>
            <button type="button" className="btn-primary min-h-10 text-xs" onClick={handleVerify} disabled={checking}>
              {checking ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="size-4" aria-hidden="true" />}
              {checking ? 'Verificando…' : 'Verificar novamente'}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-5">
          <button type="button" className="btn-primary min-h-10 text-xs" onClick={handleVerify} disabled={checking}>
            {checking ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="size-4" aria-hidden="true" />}
            {checking ? 'Verificando…' : 'Verificar integração'}
          </button>
        </div>
      )}
    </section>
  )
}
