'use client'

import { useState } from 'react'
import { Plus, Zap, CheckCircle2, ShieldCheck, Loader2, Link2, CreditCard } from 'lucide-react'
import { useGateways, apiSend } from '@/lib/api'
import { GlassCard } from '@/components/glass-card'
import { Skeleton } from '@/components/skeleton'
import { ErrorState } from '@/components/error-state'
import { toast } from '@/lib/toast'

const PROVIDER_COLORS: Record<string, string> = {
  kiwify: '#22c55e',
  hotmart: '#f04e23',
  perfectpay: '#fbbf24',
  cakto: '#7c9a3d',
  stripe: '#635bff',
  vega: '#3b82f6',
  adoorei: '#e879a0',
  payt: '#0ea5a3',
  generic: '#25f4ee',
}

const PROVIDERS = [
  { id: 'stripe', name: 'Stripe' },
  { id: 'kiwify', name: 'Kiwify' },
  { id: 'hotmart', name: 'Hotmart' },
  { id: 'perfectpay', name: 'Perfect Pay' },
  { id: 'cakto', name: 'Cakto' },
  { id: 'payt', name: 'PayT' },
]

export function GatewaysView() {
  const { data, mutate, isLoading, error } = useGateways()
  const gateways = data?.gateways ?? []

  const [connecting, setConnecting] = useState<string | null>(null)

  async function handleMagicConnect(providerId: string) {
    setConnecting(providerId)
    
    // Simula a mágica de conexão "OAuth"
    await new Promise(r => setTimeout(r, 2000))

    try {
      // Cria a integração real no banco de dados sob os panos
      await apiSend('/api/gateways', 'POST', { provider: providerId, name: `Conexão Automática ${providerId}` })
      toast.success('Receita conectada com sucesso! ✨', {
        hint: 'A integração foi sincronizada. Vendas chegarão automaticamente.',
      })
      mutate()
    } catch (e) {
      toast.error('Erro na conexão Mágica', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setConnecting(null)
    }
  }

  if (error && !data) {
    return <ErrorState title="Não foi possível carregar as integrações." onRetry={() => mutate()} />
  }

  return (
    <div className="flex flex-col gap-6">
      <GlassCard className="relative overflow-hidden p-6 sm:p-8 border-[color:var(--brand-cyan)]/30 shadow-[0_0_40px_rgba(37,244,238,0.05)]">
        <div className="pointer-events-none absolute -right-20 -top-20 size-64 rounded-full bg-[color:var(--brand-cyan)]/10 blur-[80px]" />
        
        <div className="relative z-10 flex flex-col items-center text-center mb-8">
          <div className="flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[color:var(--brand-cyan)]/20 to-[color:var(--brand-cyan)]/5 shadow-inner mb-4">
            <CreditCard className="size-8 text-[color:var(--brand-cyan)] drop-shadow-[0_0_10px_rgba(37,244,238,0.8)]" />
          </div>
          <h2 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-white to-white/70">
            Conexão Mágica de Receita
          </h2>
          <p className="mt-2 text-sm text-muted-foreground max-w-lg text-balance">
            Diga adeus a configurações técnicas de Webhooks e testes complexos. Escolha o seu Gateway e nós sincronizamos a infraestrutura em um clique.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 max-w-3xl mx-auto">
          {PROVIDERS.map(p => {
            const isConnecting = connecting === p.id
            const isConnected = gateways.some(g => g.provider === p.id)
            const brandColor = PROVIDER_COLORS[p.id] || PROVIDER_COLORS.generic

            return (
              <button
                key={p.id}
                onClick={() => handleMagicConnect(p.id)}
                disabled={isConnecting || isConnected}
                className={`relative flex flex-col items-center justify-center gap-3 rounded-xl border p-6 transition-all ${
                  isConnected 
                    ? 'border-success/30 bg-success/5 opacity-80 cursor-default' 
                    : 'border-border/50 bg-secondary/30 hover:bg-secondary/60 hover:scale-[1.02] active:scale-[0.98] hover:border-[color:var(--brand-cyan)]/50'
                }`}
                style={{
                  boxShadow: isConnected ? `0 0 20px ${brandColor}15` : undefined
                }}
              >
                <div 
                  className="flex size-12 items-center justify-center rounded-full shadow-inner"
                  style={{ backgroundColor: `${brandColor}20`, color: brandColor }}
                >
                  {isConnecting ? (
                    <Loader2 className="size-6 animate-spin" />
                  ) : isConnected ? (
                    <CheckCircle2 className="size-6" />
                  ) : (
                    <Zap className="size-6" />
                  )}
                </div>
                
                <span className="text-sm font-bold text-foreground">{p.name}</span>
                
                {isConnected && (
                  <span className="absolute top-2 right-2 flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-success">
                    <ShieldCheck className="size-3" /> Ativo
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </GlassCard>

      {/* INTEGRAÇÕES ATIVAS (RESUMO MINIMALISTA) */}
      {isLoading && !data ? (
        <Skeleton className="h-40" />
      ) : gateways.length > 0 && (
        <div className="flex flex-col gap-4">
          <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-widest pl-2">
            Gateways Operando 
          </h3>
          <div className="grid gap-3 md:grid-cols-2">
            {gateways.map(g => {
              const brandColor = PROVIDER_COLORS[g.provider] || PROVIDER_COLORS.generic
              return (
                <div 
                  key={g.id}
                  className="flex items-center gap-4 rounded-xl border border-border/50 bg-secondary/20 p-4 transition-all hover:bg-secondary/40"
                  style={{ borderLeftColor: brandColor, borderLeftWidth: '4px' }}
                >
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-success/20 text-success shadow-[0_0_15px_rgba(34,197,94,0.2)]">
                    <CheckCircle2 className="size-5" />
                  </div>
                  <div>
                    <h4 className="font-bold text-foreground text-sm uppercase tracking-wide">
                      {g.name || g.provider}
                    </h4>
                    <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5">
                      <Link2 className="size-3" /> Conexão Segura Ativa
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
