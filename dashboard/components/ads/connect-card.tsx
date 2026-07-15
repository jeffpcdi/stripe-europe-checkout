'use client'

// Card de conexão do TikTok Ads via Pipeboard. NÃO há OAuth por usuário:
// a integração usa uma chave de servidor (PIPEBOARD_API_KEY) que já escopa
// os advertisers. "Conectar" aqui é uma VERIFICAÇÃO: se a chave está de pé e
// há advertiser visível, a conta já está conectada. Se a chave está ok mas
// nenhum advertiser aparece, o vínculo é feito no painel do Pipeboard.

import { useState } from 'react'
import { ShieldCheck, LineChart, Clapperboard, Loader2, RefreshCw, ExternalLink } from 'lucide-react'
import { apiSend } from '@/lib/api'
import { toast } from '@/lib/toast'
import { GlassCard } from '@/components/glass-card'

// Logomark do TikTok (nota musical) — inline em currentColor
function TikTokMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z" />
    </svg>
  )
}

const BENEFITS = [
  {
    icon: LineChart,
    title: 'Campanhas e métricas',
    text: 'Investimento, impressões, CTR e CPM em tempo real, campanha por campanha.',
  },
  {
    icon: Clapperboard,
    title: 'Suba anúncios daqui',
    text: 'Crie campanhas completas com criativo de vídeo ou impulsione posts com Spark Ads.',
  },
  {
    icon: ShieldCheck,
    title: 'Integração de servidor',
    text: 'Conexão via Pipeboard com chave gerenciada no servidor — sem tokens no navegador.',
  },
]

export function AdsConnectCard({ onConnected }: { onConnected: () => void }) {
  const [checking, setChecking] = useState(false)
  // 422 NO_ADVERTISER_VISIBLE: chave ok, mas falta vincular a conta no Pipeboard
  const [needsLink, setNeedsLink] = useState(false)

  async function handleConnect() {
    setChecking(true)
    try {
      const r = await apiSend<{ alreadyConnected?: boolean }>('/api/ads/connect', 'POST')
      if (r.alreadyConnected) {
        const c = await apiSend<{ connected: boolean }>('/api/ads/connected', 'POST')
        if (c.connected) {
          toast.success('Conta TikTok Ads conectada')
          onConnected()
          return
        }
      }
      setNeedsLink(true)
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      // o backend responde 422 com instruções quando falta vincular a conta
      if (msg.includes('advertiser') || msg.includes('Pipeboard')) {
        setNeedsLink(true)
      } else {
        toast.error('Falha ao verificar a conexão', { hint: msg || undefined })
      }
    } finally {
      setChecking(false)
    }
  }

  return (
    <GlassCard sheen className="overflow-hidden">
      <div className="flex flex-col gap-8 p-8 md:p-10">
        <div className="flex flex-col items-start gap-4">
          <span className="flex size-12 items-center justify-center rounded-2xl border border-border bg-[var(--hover)] text-foreground">
            <TikTokMark className="size-6" />
          </span>
          <div>
            <h3 className="text-lg font-semibold text-foreground text-balance">
              Conecte sua conta do TikTok Ads
            </h3>
            <p className="mt-1 max-w-xl text-pretty text-sm leading-relaxed text-muted-foreground">
              Veja campanhas e métricas, suba anúncios com criativos de vídeo e gerencie tudo sem sair do
              painel. A integração é feita pelo Pipeboard, com a chave configurada no servidor.
            </p>
          </div>
        </div>

        <ul className="grid gap-4 sm:grid-cols-3">
          {BENEFITS.map((b) => (
            <li key={b.title} className="flex flex-col gap-1.5 rounded-xl border border-border bg-card/50 p-4">
              <b.icon className="size-4 text-brand-cyan" aria-hidden="true" />
              <p className="text-xs font-semibold text-foreground">{b.title}</p>
              <p className="text-pretty text-xs leading-relaxed text-muted-foreground">{b.text}</p>
            </li>
          ))}
        </ul>

        {needsLink && (
          <div className="flex flex-col gap-3 rounded-lg border border-warning/25 bg-warning/10 px-4 py-3">
            <p className="text-pretty text-xs leading-relaxed text-warning">
              A chave do Pipeboard está ativa, mas nenhuma conta de anúncio está visível ainda. Vincule a sua
              conta TikTok Ads no painel do Pipeboard e verifique novamente.
            </p>
            <a
              href="https://pipeboard.co"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-fit items-center gap-1.5 text-xs font-medium text-warning underline underline-offset-2"
            >
              <ExternalLink className="size-3.5" aria-hidden="true" />
              Abrir painel do Pipeboard
            </a>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn-primary" onClick={handleConnect} disabled={checking}>
            {checking ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="size-4" aria-hidden="true" />
            )}
            {needsLink ? 'Verificar novamente' : 'Conectar TikTok Ads'}
          </button>
        </div>
      </div>
    </GlassCard>
  )
}
