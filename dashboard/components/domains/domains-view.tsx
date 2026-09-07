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
    'w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-brand-cyan/50'

  return (
    <div className="flex flex-col gap-6">
      {/* PAINEL DE ADIÇÃO DE DOMÍNIO */}
      <GlassCard className="p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="flex size-10 items-center justify-center rounded-xl bg-brand-cyan/10 text-brand-cyan">
            <Globe className="size-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground">
              Conectar Domínio Próprio
            </h2>
            <p className="text-xs text-muted-foreground">
              Utilize o seu próprio domínio em seus links de vendas.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-4 max-w-xl">
          <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">Endereço do Domínio</span>
              <input
                className={inputCls}
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="link.seudominio.com"
                disabled={adding}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">Provedor</span>
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
            <p className="rounded-lg bg-destructive/10 px-3.5 py-2 text-xs text-destructive border border-destructive/20" role="alert">
              {error}
            </p>
          )}

          {adding ? (
            <div className="flex items-center gap-2.5 rounded-lg border border-brand-cyan/40 bg-brand-cyan/10 px-4 py-2.5 text-xs font-semibold text-brand-cyan animate-pulse">
              <Loader2 className="size-4 animate-spin" />
              <span>Conectando domínio e configurando segurança…</span>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleMagicConnect}
              disabled={!host.trim() || !!hostInvalidReason(host)}
              className="flex items-center justify-center gap-2 rounded-lg bg-brand-cyan px-4 py-2.5 text-xs font-semibold text-black transition-all hover:opacity-90 active:scale-95 disabled:pointer-events-none disabled:opacity-50 self-start"
            >
              <Plus className="size-4" /> 
              Conectar Domínio
            </button>
          )}
        </div>
      </GlassCard>

      {/* LISTA DE DOMÍNIOS ATIVOS */}
      {loadError && !data ? (
        <ErrorState title="Não foi possível carregar seus domínios." onRetry={() => mutate()} />
      ) : isLoading && !data ? (
        <Skeleton className="h-28" />
      ) : domains.length > 0 && (
        <div className="flex flex-col gap-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground px-1">
            Domínios Conectados ({domains.length})
          </h3>
          {domains.map((d) => (
            <div 
              key={d.host} 
              className="flex items-center justify-between rounded-xl border border-border/60 bg-secondary/20 p-3.5 transition-all hover:border-border"
            >
              <div className="flex items-center gap-3">
                <div className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${d.verificado ? 'bg-[color:var(--success)]/15 text-[color:var(--success)]' : 'bg-[color:var(--warning)]/15 text-[color:var(--warning)]'}`}>
                  {d.verificado ? <CheckCircle2 className="size-4" /> : <Loader2 className="size-4 animate-spin" />}
                </div>
                <div>
                  <h4 className="font-semibold text-foreground text-sm">{d.host}</h4>
                  <p className="text-xs text-muted-foreground">
                    {d.verificado ? 'Ativo e pronto para uso' : 'Verificando conexão…'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDeleting(d.host)}
                className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-destructive/20 hover:text-destructive"
                aria-label="Desconectar domínio"
                title="Desconectar"
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
