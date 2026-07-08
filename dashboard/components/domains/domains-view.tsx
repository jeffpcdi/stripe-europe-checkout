'use client'

import { useState } from 'react'
import { Globe, Plus, Trash2, RefreshCw, CheckCircle2, AlertCircle, Copy, Check } from 'lucide-react'
import { useDomains, apiSend } from '@/lib/api'
import type { CustomDomain, DomainVerifyResult } from '@/lib/types'
import { GlassCard } from '@/components/glass-card'
import { Skeleton } from '@/components/skeleton'

export function DomainsView() {
  const { data, isLoading, mutate } = useDomains()
  const [host, setHost] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [verifying, setVerifying] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, DomainVerifyResult>>({})
  const [deleting, setDeleting] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const appHost = data?.appHost ?? ''
  const domains = data?.domains ?? []

  async function handleAdd() {
    setAdding(true)
    setError(null)
    try {
      await apiSend('/api/domains', 'POST', { host })
      setHost('')
      mutate()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao adicionar')
    } finally {
      setAdding(false)
    }
  }

  async function handleVerify(h: string) {
    setVerifying(h)
    try {
      const res = await apiSend<DomainVerifyResult>('/api/domains/verify', 'POST', { host: h })
      setResults((r) => ({ ...r, [h]: res }))
      mutate()
    } catch (e) {
      setResults((r) => ({
        ...r,
        [h]: {
          host: h,
          appHost,
          dnsOk: false,
          dnsDetail: e instanceof Error ? e.message : 'erro',
          httpOk: false,
          httpDetail: '',
        },
      }))
    } finally {
      setVerifying(null)
    }
  }

  async function handleDelete(h: string) {
    await apiSend(`/api/domains/${encodeURIComponent(h)}`, 'DELETE')
    setDeleting(null)
    mutate()
  }

  async function copyAppHost() {
    await navigator.clipboard.writeText(appHost)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const inputCls =
    'w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring'

  return (
    <div className="flex flex-col gap-4">
      {/* Adicionar domínio */}
      <GlassCard className="p-5">
        <h2 className="section-head mb-1 text-sm font-semibold text-foreground">Adicionar domínio</h2>
        <p className="mb-3 text-xs text-muted-foreground text-pretty">
          Aponte um CNAME do seu domínio para{' '}
          <button
            type="button"
            onClick={copyAppHost}
            className="inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 font-mono text-[color:var(--brand-cyan)]"
          >
            {appHost || 'carregando…'}
            {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          </button>{' '}
          e verifique aqui.
        </p>
        <div className="flex gap-2">
          <input
            className={inputCls}
            value={host}
            onChange={(e) => setHost(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229 && host.trim()) handleAdd()
            }}
            placeholder="link.seudominio.com"
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={adding || !host.trim()}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[color:var(--brand-cyan)] px-3 py-2 text-sm font-semibold text-black shadow-[var(--glow-cyan-soft)] transition-all hover:-translate-y-px hover:shadow-[var(--glow-cyan)] hover:brightness-105 active:scale-[0.98] disabled:opacity-50 disabled:shadow-none"
          >
            <Plus className="size-4" /> Adicionar
          </button>
        </div>
        {error && (
          <p className="mt-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
      </GlassCard>

      {/* Lista de domínios */}
      {isLoading && !data ? (
        <Skeleton className="h-40" />
      ) : domains.length === 0 ? (
        <GlassCard className="flex flex-col items-center gap-3 p-10 text-center">
          <Globe className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Nenhum domínio personalizado ainda.</p>
        </GlassCard>
      ) : (
        <div className="flex flex-col gap-3">
          {domains.map((d) => (
            <DomainCard
              key={d.host}
              domain={d}
              result={results[d.host]}
              verifying={verifying === d.host}
              deleting={deleting === d.host}
              onVerify={() => handleVerify(d.host)}
              onAskDelete={() => setDeleting(d.host)}
              onCancelDelete={() => setDeleting(null)}
              onDelete={() => handleDelete(d.host)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function DomainCard({
  domain,
  result,
  verifying,
  deleting,
  onVerify,
  onAskDelete,
  onCancelDelete,
  onDelete,
}: {
  domain: CustomDomain
  result?: DomainVerifyResult
  verifying: boolean
  deleting: boolean
  onVerify: () => void
  onAskDelete: () => void
  onCancelDelete: () => void
  onDelete: () => void
}) {
  return (
    <GlassCard className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {/* Item 75: check verde com draw-in de SVG path quando verificado */}
          {domain.verificado ? (
            <CheckCircle2 className="check-draw size-5 text-[color:var(--success)]" />
          ) : (
            <AlertCircle className="size-5 text-[color:var(--warning)]" />
          )}
          <div>
            <p className="font-mono text-sm font-semibold text-foreground">{domain.host}</p>
            <p className="text-xs text-muted-foreground">
              {domain.verificado ? 'Verificado e ativo' : 'Aguardando verificação de DNS'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onVerify}
            disabled={verifying}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-50"
          >
            <RefreshCw className={`size-3.5 ${verifying ? 'animate-spin' : ''}`} />
            {verifying ? 'Verificando…' : 'Verificar'}
          </button>
          <button
            type="button"
            onClick={onAskDelete}
            className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
            aria-label="Remover domínio"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      </div>

      {result && (
        <div className="mt-3 flex flex-col gap-1.5 rounded-lg border border-border bg-secondary/40 p-3 text-xs">
          <div className="flex items-center gap-2">
            {result.dnsOk ? (
              <CheckCircle2 className="check-draw size-3.5 text-[color:var(--success)]" />
            ) : (
              <AlertCircle className="size-3.5 text-[color:var(--warning)]" />
            )}
            <span className="text-muted-foreground">DNS: {result.dnsDetail || (result.dnsOk ? 'ok' : 'pendente')}</span>
          </div>
          <div className="flex items-center gap-2">
            {result.httpOk ? (
              <CheckCircle2 className="check-draw size-3.5 text-[color:var(--success)]" />
            ) : (
              <AlertCircle className="size-3.5 text-[color:var(--warning)]" />
            )}
            <span className="text-muted-foreground">HTTPS: {result.httpDetail || (result.httpOk ? 'ok' : 'pendente')}</span>
          </div>
        </div>
      )}

      {deleting && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2">
          <p className="text-sm text-foreground">
            Remover <strong>{domain.host}</strong>?
          </p>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={onCancelDelete}
              className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="rounded-md bg-destructive px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
            >
              Remover
            </button>
          </div>
        </div>
      )}
    </GlassCard>
  )
}
