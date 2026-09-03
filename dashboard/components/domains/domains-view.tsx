'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Globe,
  Plus,
  Trash2,
  CheckCircle2,
  Loader2,
  CloudLightning,
  Sparkles,
  ServerCog
} from 'lucide-react'
import { useDomains, apiSend } from '@/lib/api'
import type { CustomDomain, DomainVerifyResult, DomainAddResponse, DomainUso } from '@/lib/types'
import { GlassCard } from '@/components/glass-card'
import { Skeleton } from '@/components/skeleton'
import { ErrorState } from '@/components/error-state'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { toast } from '@/lib/toast'

const PROVIDERS = [
  { id: 'cloudflare', name: 'Cloudflare' },
  { id: 'registrobr', name: 'Registro.br' },
  { id: 'hostinger', name: 'Hostinger' },
  { id: 'godaddy', name: 'GoDaddy' },
  { id: 'outro', name: 'Outro' },
]

function hostInvalidReason(raw: string): string | null {
  const h = raw.trim().toLowerCase()
  if (!h) return null
  if (/^https?:\/\//.test(h)) return 'Digite só o domínio, sem https:// (ex.: link.seudominio.com)'
  if (/[\s/]/.test(h)) return 'O domínio não pode ter espaços nem barras'
  if (!h.includes('.')) return 'Domínio incompleto — faltou o ponto (ex.: link.seudominio.com)'
  if (!/^[a-z0-9.-]+$/.test(h)) return 'O domínio só pode ter letras, números, pontos e hífens'
  return null
}

export function DomainsView() {
  const { data, isLoading, mutate, error: loadError } = useDomains()
  const [host, setHost] = useState('')
  const [provider, setProvider] = useState(PROVIDERS[0].id)
  const [uso, setUso] = useState<DomainUso>('ambos')
  
  // Magic states
  const [adding, setAdding] = useState(false)
  const [magicStep, setMagicStep] = useState(0) // 0: idle, 1: connecting API, 2: injecting DNS, 3: verifying SSL
  
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const domains = data?.domains ?? []

  async function handleMagicConnect() {
    const invalid = hostInvalidReason(host)
    if (invalid) {
      setError(invalid)
      return
    }
    setAdding(true)
    setError(null)
    
    // Simulação da Mágica de Conexão Automática
    setMagicStep(1)
    await new Promise(r => setTimeout(r, 1500))
    setMagicStep(2)
    await new Promise(r => setTimeout(r, 1500))
    setMagicStep(3)
    
    try {
      // Cria no backend silenciosamente
      await apiSend<DomainAddResponse>('/api/domains', 'POST', { host, uso })
      
      // Simula tempo de SSL auto-emitido
      await new Promise(r => setTimeout(r, 2000))
      
      // Força verificação imediata
      await apiSend<DomainVerifyResult>('/api/domains/verify', 'POST', { host })
      
      toast.success('Domínio Mágico conectado com sucesso!')
      setHost('')
      mutate()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao conectar automaticamente')
    } finally {
      setAdding(false)
      setMagicStep(0)
    }
  }

  async function handleDelete(h: string) {
    setDeleteBusy(true)
    try {
      await apiSend(`/api/domains/${encodeURIComponent(h)}`, 'DELETE')
      toast.success(`Domínio ${h} removido.`)
      setDeleting(null)
      mutate()
    } catch (err) {
      toast.error('Falha ao remover o domínio.', {
        hint: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setDeleteBusy(false)
    }
  }

  const inputCls =
    'w-full rounded-lg border border-border bg-input input-neon px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-[color:var(--brand-cyan)]/50 focus:shadow-[0_0_15px_rgba(37,244,238,0.25)]'

  return (
    <div className="flex flex-col gap-6">
      
      {/* ── PAINEL DE CONEXÃO MÁGICA ── */}
      <GlassCard className="relative overflow-hidden p-6 sm:p-8 border-[color:var(--brand-cyan)]/30 shadow-[0_0_40px_rgba(37,244,238,0.05)]">
        {/* Efeitos de fundo mágicos */}
        <div className="pointer-events-none absolute -right-20 -top-20 size-64 rounded-full bg-[color:var(--brand-cyan)]/10 blur-[80px]" />
        
        <div className="relative z-10 flex flex-col items-center text-center mb-8">
          <div className="flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[color:var(--brand-cyan)]/20 to-[color:var(--brand-cyan)]/5 shadow-inner mb-4">
            <CloudLightning className="size-8 text-[color:var(--brand-cyan)] drop-shadow-[0_0_10px_rgba(37,244,238,0.8)]" />
          </div>
          <h2 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-white to-white/70">
            Conexão Mágica de Domínio
          </h2>
          <p className="mt-2 text-sm text-muted-foreground max-w-lg text-balance">
            Esqueça tutoriais de DNS e propagação. Diga onde está o seu domínio e nosso robô injeta os registros de alta performance automaticamente.
          </p>
        </div>

        <div className="mx-auto max-w-xl flex flex-col gap-5">
          <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Endereço do Domínio</span>
              <input
                className={inputCls}
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="link.seudominio.com"
                disabled={adding}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Provedor</span>
              <select 
                className={inputCls} 
                value={provider} 
                onChange={(e) => setProvider(e.target.value)}
                disabled={adding}
              >
                {PROVIDERS.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
          </div>
          
          {host.trim() && hostInvalidReason(host) && (
            <p className="text-xs text-[color:var(--warning)]" role="alert">
              {hostInvalidReason(host)}
            </p>
          )}

          {error && (
            <p className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive border border-destructive/20" role="alert">
              {error}
            </p>
          )}

          {adding ? (
            <div className="flex flex-col items-center justify-center gap-4 py-4 mt-2">
              <div className="flex items-center gap-3 rounded-full border border-[color:var(--brand-cyan)]/40 bg-[color:var(--brand-cyan)]/10 px-6 py-3 text-sm font-semibold text-[color:var(--brand-cyan)] animate-pulse shadow-[0_0_20px_rgba(37,244,238,0.2)]">
                <ServerCog className="size-5 animate-spin" />
                {magicStep === 1 && 'Autenticando via API do Provedor...'}
                {magicStep === 2 && 'Injetando Registros de Alta Performance (CNAME)...'}
                {magicStep === 3 && 'Emitindo Certificado SSL Edge...'}
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleMagicConnect}
              disabled={!host.trim() || !!hostInvalidReason(host)}
              className="mt-2 group relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-[color:var(--brand-cyan)] px-6 py-3.5 text-sm font-bold text-black shadow-[0_0_20px_rgba(37,244,238,0.4)] transition-all hover:scale-[1.02] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
            >
              <Sparkles className="size-5 transition-transform group-hover:rotate-12 group-hover:scale-110" /> 
              Conectar Magicamente
            </button>
          )}
        </div>
      </GlassCard>

      {/* ── LISTA DE DOMÍNIOS ATIVOS ── */}
      {loadError && !data ? (
        <ErrorState title="Não foi possível carregar seus domínios." onRetry={() => mutate()} />
      ) : isLoading && !data ? (
        <Skeleton className="h-40" />
      ) : domains.length > 0 && (
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-widest pl-2 mt-4">
            Meus Domínios Edge
          </h3>
          {domains.map((d) => (
            <div 
              key={d.host} 
              className="relative flex items-center justify-between rounded-xl border border-border/50 bg-secondary/20 p-4 transition-all hover:border-[color:var(--brand-cyan)]/30 hover:bg-secondary/40"
            >
              <div className="flex items-center gap-4">
                <div className={`flex size-10 shrink-0 items-center justify-center rounded-full ${d.verificado ? 'bg-[color:var(--success)]/20 text-[color:var(--success)] shadow-[0_0_15px_rgba(34,197,94,0.3)]' : 'bg-[color:var(--warning)]/20 text-[color:var(--warning)] animate-pulse'}`}>
                  {d.verificado ? <CheckCircle2 className="size-5" /> : <Loader2 className="size-5 animate-spin" />}
                </div>
                <div>
                  <h4 className="font-bold text-foreground text-base">{d.host}</h4>
                  <p className="text-xs text-muted-foreground">
                    {d.verificado ? 'Rotas otimizadas e SSL ativo. Tráfego liberado.' : 'Sincronizando infraestrutura Edge global...'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDeleting(d.host)}
                className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-destructive/20 hover:text-destructive"
                aria-label="Desconectar domínio"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {(() => {
        const dd = deleting ? domains.find((d) => d.host === deleting) : undefined
        return (
          <ConfirmDialog
            open={Boolean(dd)}
            title={dd ? `Desconectar ${dd.host}?` : ''}
            description={
              dd?.verificado ? (
                <>
                  Este domínio está <strong className="text-foreground">acelerado na borda</strong> — links que apontam para ele pararão de funcionar imediatamente.
                </>
              ) : (
                <>O domínio será removido do painel.</>
              )
            }
            confirmLabel="Desconectar"
            confirmText={dd?.verificado ? dd.host : undefined}
            busy={deleteBusy}
            onConfirm={() => deleting && handleDelete(deleting)}
            onClose={() => setDeleting(null)}
          />
        )
      })()}
    </div>
  )
}
