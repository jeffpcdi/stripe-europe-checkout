'use client'

// Card de conexão OAuth do TikTok Ads. Abre a autorização do TikTok Business
// em popup/nova aba e, na volta do usuário, confirma a conexão no backend
// (POST /api/ads/connected descobre a SocialAccount criada pela Zernio).

import { useEffect, useRef, useState } from 'react'
import { ExternalLink, ShieldCheck, LineChart, Clapperboard, Loader2, RefreshCw } from 'lucide-react'
import { apiSend, apiErrorHint } from '@/lib/api'
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
    title: 'Conexão oficial',
    text: 'Autorização OAuth do TikTok for Business. Você pode revogar quando quiser.',
  },
]

export function AdsConnectCard({ onConnected }: { onConnected: () => void }) {
  const [starting, setStarting] = useState(false)
  // 'idle' → 'waiting' (popup aberto) → confirmação
  const [waiting, setWaiting] = useState(false)
  const [checking, setChecking] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Ao voltar o foco para o painel com a espera ativa, confirma a conexão.
  useEffect(() => {
    if (!waiting) return
    let cancelled = false

    async function check() {
      if (cancelled) return
      setChecking(true)
      try {
        const r = await apiSend<{ connected: boolean }>('/api/ads/connected', 'POST')
        if (r.connected && !cancelled) {
          toast.success('Conta TikTok Ads conectada')
          setWaiting(false)
          onConnected()
        }
      } catch {
        // silencioso: o usuário pode ainda estar no meio do OAuth
      } finally {
        if (!cancelled) setChecking(false)
      }
    }

    function onFocus() {
      check()
    }
    window.addEventListener('focus', onFocus)
    // fallback: tenta a cada 5s enquanto espera (o OAuth pode fechar sozinho)
    pollRef.current = setInterval(check, 5000)
    return () => {
      cancelled = true
      window.removeEventListener('focus', onFocus)
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [waiting, onConnected])

  async function handleConnect() {
    setStarting(true)
    try {
      const r = await apiSend<{ authUrl: string }>('/api/ads/connect', 'POST')
      // abre em nova aba (o OAuth do TikTok não funciona bem em iframe)
      window.open(r.authUrl, '_blank', 'noopener')
      setWaiting(true)
    } catch (e) {
      toast.error('Falha ao iniciar a conexão', { hint: apiErrorHint(e) })
    } finally {
      setStarting(false)
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
              painel. A autorização é feita direto no TikTok for Business.
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

        <div className="flex flex-wrap items-center gap-3">
          {!waiting ? (
            <button type="button" className="btn-primary" onClick={handleConnect} disabled={starting}>
              {starting ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <ExternalLink className="size-4" aria-hidden="true" />
              )}
              Conectar TikTok Ads
            </button>
          ) : (
            <>
              <span className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                <Loader2 className="size-4 animate-spin text-brand-cyan" aria-hidden="true" />
                Aguardando a autorização na aba do TikTok…
              </span>
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={async () => {
                  setChecking(true)
                  try {
                    const r = await apiSend<{ connected: boolean }>('/api/ads/connected', 'POST')
                    if (r.connected) {
                      toast.success('Conta TikTok Ads conectada')
                      setWaiting(false)
                      onConnected()
                    } else {
                      toast.info('Ainda não detectamos a autorização', {
                        hint: 'Conclua o login no TikTok e tente de novo.',
                      })
                    }
                  } catch (e) {
                    toast.error('Falha ao verificar a conexão', {
                      hint: apiErrorHint(e),
                    })
                  } finally {
                    setChecking(false)
                  }
                }}
                disabled={checking}
              >
                <RefreshCw className={`size-3.5 ${checking ? 'animate-spin' : ''}`} aria-hidden="true" />
                Já autorizei
              </button>
            </>
          )}
        </div>
      </div>
    </GlassCard>
  )
}
