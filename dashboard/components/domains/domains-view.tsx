'use client'

import { useState } from 'react'
import { Plus, RefreshCw, Trash2, Copy, Loader2, ShieldCheck, Clock3, AlertTriangle, ArrowUpRight, Globe } from 'lucide-react'
import { ApiError, useDomains, apiSend } from '@/lib/api'
import type { DomainAddResponse, DomainDnsRecords, DomainVerifyResult } from '@/lib/types'
import { GlassCard } from '@/components/glass-card'
import { Skeleton } from '@/components/skeleton'
import { ErrorState } from '@/components/error-state'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { toast } from '@/lib/toast'

function hostInvalidReason(raw: string): string | null {
  const host = raw.trim().toLowerCase()
  if (!host) return 'Informe o domínio.'
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(host)) return 'Use apenas o endereço, como link.sualoja.com, sem https:// ou barras.'
  return null
}
function apiErrorHint(error: unknown): string | undefined {
  if (error instanceof ApiError) return error.display
  return error instanceof Error ? error.message : undefined
}
function DnsInstructions({ dns }: { dns: DomainDnsRecords | null | undefined }) {
  const records = [
    dns?.cname ? { type: 'CNAME', name: dns.cname.name || dns.cname.host || '', value: dns.cname.target } : null,
    dns?.txt ? { type: 'TXT', name: dns.txt.host, value: dns.txt.value } : null,
    dns?.ownership, dns?.certificate,
  ].filter((record): record is { type: string; name: string; value: string } => !!record)
  if (!records.length) return <p className="text-xs text-muted-foreground">As instruções de conexão ainda não estão disponíveis. Tente verificar novamente.</p>
  return <div className="space-y-3">
    <p className="text-xs text-muted-foreground">Adicione estes registros no painel onde você gerencia o domínio. Depois, clique em Verificar.</p>
    {records.map((record, index) => <div key={index} className="rounded-lg border border-border bg-background p-3 text-xs">
      <p className="font-medium">{record.type} · {record.name || '@'}</p>
      <div className="mt-1 flex items-start gap-2"><code className="min-w-0 flex-1 break-all text-muted-foreground">{record.value}</code><button type="button" aria-label={`Copiar valor ${record.type} ${record.name}`} className="btn-ghost shrink-0 p-1" onClick={async () => { try { await navigator.clipboard.writeText(record.value); toast.success('Valor copiado') } catch { toast.error('Não foi possível copiar. Selecione o valor e copie manualmente.') } }}><Copy className="size-3.5" /></button></div>
    </div>)}
  </div>
}

export function DomainsView() {
  const { data, isLoading, mutate, error: loadError } = useDomains()
  const [host, setHost] = useState('')
  const [adding, setAdding] = useState(false)
  const [verifying, setVerifying] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [checks, setChecks] = useState<Record<string, DomainVerifyResult>>({})
  const [addedDns, setAddedDns] = useState<Record<string, DomainDnsRecords | null>>({})
  async function add() {
    const invalid = hostInvalidReason(host)
    if (invalid || adding) { setError(invalid); return }
    setAdding(true); setError(null)
    const normalized = host.trim().toLowerCase()
    try {
      const result = await apiSend<DomainAddResponse>('/api/domains', 'POST', { host: normalized, uso: 'ambos', _baseUpdatedAt: data?.configUpdatedAt || undefined })
      if (!result.ok) throw new Error(result.providerNote || 'Não foi possível cadastrar o domínio.')
      setAddedDns(previous => ({ ...previous, [normalized]: result.dnsRecords }))
      setHost('')
      toast.success('Domínio cadastrado', { hint: 'Confira os registros de conexão abaixo.' })
      await mutate()
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível cadastrar.') }
    finally { setAdding(false) }
  }
  async function verify(domain: string) {
    if (verifying) return
    setVerifying(domain)
    try {
      const result = await apiSend<DomainVerifyResult>('/api/domains/verify', 'POST', { host: domain })
      setChecks(previous => ({ ...previous, [domain]: result }))
      if (result.verified) toast.success('Domínio verificado')
      else toast.info('Conexão ainda pendente', { hint: result.dnsPropagating ? 'O registro ainda está se espalhando pela rede. Tente mais tarde.' : result.dnsDetail || result.httpDetail })
      await mutate()
    } catch (err) { toast.error('Não foi possível verificar', { hint: apiErrorHint(err) }) }
    finally { setVerifying(null) }
  }
  async function remove() {
    if (!deleting || deleteBusy) return
    const removed = deleting
    setDeleteBusy(true)
    let deleted = false
    try {
      await apiSend(`/api/domains/${encodeURIComponent(removed)}`, 'DELETE')
      deleted = true
      setDeleting(null)
      setChecks((current) => {
        const next = { ...current }
        delete next[removed]
        return next
      })
      setAddedDns((current) => {
        const next = { ...current }
        delete next[removed]
        return next
      })
      toast.success('Domínio removido')
    } catch (err) {
      toast.error('Não foi possível remover', { hint: apiErrorHint(err) })
    } finally {
      setDeleteBusy(false)
    }
    if (deleted) {
      try {
        await mutate()
      } catch (error) {
        toast.info('Domínio removido, mas a lista não atualizou completamente', { hint: apiErrorHint(error) })
      }
    }
  }
  const domains = data?.domains ?? []
  const readyCount = domains.filter((domain) => domain.verificado).length
  const errorCount = domains.filter((domain) => domain.status === 'error').length
  const pendingCount = Math.max(0, domains.length - readyCount - errorCount)

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Domínios</h1>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <GlassCard className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Prontos</p>
              <p className="mt-2 text-xl font-semibold text-success">{readyCount}</p>
                          </div>
            <ShieldCheck className="size-4 text-success" />
          </div>
        </GlassCard>
        <GlassCard className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Em configuração</p>
              <p className="mt-2 text-xl font-semibold text-foreground">{pendingCount}</p>
                          </div>
            <Clock3 className="size-4 text-warning" />
          </div>
        </GlassCard>
        <GlassCard className={`p-4 ${errorCount ? 'border-destructive/30 bg-destructive/5' : ''}`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Precisam de atenção</p>
              <p className={`mt-2 text-xl font-semibold ${errorCount ? 'text-destructive' : 'text-success'}`}>{errorCount}</p>
                          </div>
            <AlertTriangle className={`size-4 ${errorCount ? 'text-destructive' : 'text-muted-foreground'}`} />
          </div>
        </GlassCard>
      </div>

      <GlassCard variant="thick" className="p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-xl">
            <h2 className="text-sm font-semibold text-foreground">Adicionar domínio</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Informe apenas o endereço, sem https://. Depois o ROINADOS mostra exatamente quais registros precisam ser criados.</p>
          </div>
          <form className="flex w-full max-w-2xl flex-col gap-2 sm:flex-row" onSubmit={event => { event.preventDefault(); void add() }}>
            <label className="min-w-0 flex-1">
              <span className="sr-only">Endereço do domínio</span>
              <input className="input w-full rounded-xl border border-border/80 bg-secondary/40 px-3 py-2.5 text-xs text-foreground focus:border-brand-cyan/50" value={host} onChange={event => setHost(event.target.value)} placeholder="link.sualoja.com" disabled={adding} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
            </label>
            <button type="submit" className="btn-primary shrink-0" disabled={adding || !host.trim()}>
              {adding ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              {adding ? 'Cadastrando…' : 'Adicionar'}
            </button>
          </form>
        </div>
        {error && <p role="alert" className="mt-3 text-xs text-error">{error}</p>}
        {data?.providerDegraded ? <p className="mt-3 rounded-xl border border-warning/25 bg-warning/10 px-3 py-2 text-xs text-warning">O provedor de domínio está em modo degradado. O cadastro continua disponível, mas pode exigir configuração manual adicional.</p> : null}
      </GlassCard>

      {loadError && <ErrorState title="Não foi possível atualizar os domínios" onRetry={() => mutate()} />}
      {isLoading && !data ? (
        <Skeleton className="h-32 rounded-2xl" />
      ) : domains.length === 0 ? (
        <GlassCard className="flex flex-col items-center justify-center gap-3 border-dashed p-10 text-center">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-brand-cyan/10 text-brand-cyan"><Globe className="size-6" /></div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">Nenhum domínio conectado</h3>
            <p className="mt-1 max-w-md text-xs text-muted-foreground">Adicione um subdomínio próprio para usar URLs com a identidade da sua operação.</p>
          </div>
        </GlassCard>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {domains.map((domain, index) => {
            const check = checks[domain.host]
            const ready = domain.verificado
            const dns = check?.dnsRecords || domain.dns || addedDns[domain.host]
            const statusLabel = ready
              ? 'Pronto para usar'
              : domain.status === 'pending_ssl'
                ? 'DNS conectado · finalizando segurança'
                : domain.status === 'error'
                  ? 'Conexão precisa de ajuste'
                  : 'Aguardando DNS'
            return (
              <GlassCard key={domain.host} className="flex flex-col gap-4 rounded-[24px] border border-border/70 p-4 sm:p-5 transition-all hover:border-brand-cyan/25" style={{ animationDelay: `${index * 50}ms` }}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`size-2.5 shrink-0 rounded-full ${ready ? 'bg-success' : domain.status === 'error' ? 'bg-destructive' : 'bg-warning'}`} />
                      <h3 className="break-all text-sm font-semibold text-foreground">{domain.host}</h3>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${ready ? 'border-success/20 bg-success/10 text-success' : domain.status === 'error' ? 'border-destructive/25 bg-destructive/10 text-destructive' : 'border-warning/25 bg-warning/10 text-warning'}`}>{statusLabel}</span>
                      <span className="rounded-full border border-border/60 bg-secondary/20 px-2 py-0.5 text-[10px] text-muted-foreground">{domain.uso === 'checkout' ? 'Links' : domain.uso === 'cloaker' ? 'Cloaker' : 'Links + Cloaker'}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button type="button" className="btn-secondary px-3 py-1.5 text-xs" disabled={!!verifying} onClick={() => void verify(domain.host)}>
                      <RefreshCw className={`size-3.5 ${verifying === domain.host ? 'animate-spin text-brand-cyan' : ''}`} />
                      {verifying === domain.host ? 'Verificando…' : 'Verificar'}
                    </button>
                    <button type="button" className="btn-ghost p-2 text-muted-foreground hover:text-destructive" aria-label={`Remover domínio ${domain.host}`} onClick={() => setDeleting(domain.host)}><Trash2 className="size-4" /></button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div className="rounded-xl border border-border/50 bg-secondary/15 p-3">
                    <p className="uppercase tracking-[0.16em] text-muted-foreground">DNS</p>
                    <p className={`mt-1 font-medium ${domain.status === 'error' ? 'text-destructive' : ready || domain.status === 'pending_ssl' ? 'text-success' : 'text-warning'}`}>{ready || domain.status === 'pending_ssl' ? 'Conectado' : domain.status === 'error' ? 'Revisar' : 'Pendente'}</p>
                  </div>
                  <div className="rounded-xl border border-border/50 bg-secondary/15 p-3">
                    <p className="uppercase tracking-[0.16em] text-muted-foreground">HTTPS</p>
                    <p className={`mt-1 font-medium ${ready ? 'text-success' : 'text-muted-foreground'}`}>{ready ? 'Seguro' : domain.status === 'pending_ssl' ? 'Emitindo certificado' : 'Aguardando DNS'}</p>
                  </div>
                </div>

                {!ready && (domain.lastError || domain.providerNote) ? <p className="rounded-xl border border-warning/25 bg-warning/10 px-3 py-2 text-xs text-warning">{domain.lastError || domain.providerNote}</p> : null}

                <details className="rounded-xl border border-border/60 bg-secondary/10 p-3" open={!ready}>
                  <summary className="cursor-pointer text-xs font-medium text-foreground">{ready ? 'Ver configuração técnica' : 'O que preciso fazer agora?'}</summary>
                  <div className="mt-3"><DnsInstructions dns={dns} /></div>
                </details>

                <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-3">
                  <span className="text-[10px] text-muted-foreground">{domain.lastCheckedAt ? `Última verificação: ${new Date(domain.lastCheckedAt).toLocaleString('pt-BR')}` : 'Ainda não verificado manualmente'}</span>
                  {ready && domain.uso !== 'cloaker' ? (
                    <a href={`/links?novo=1&dominio=${encodeURIComponent(domain.host)}`} className="inline-flex items-center gap-1 text-xs font-medium text-brand-cyan hover:underline">Criar link com este domínio <ArrowUpRight className="size-3" /></a>
                  ) : null}
                </div>
              </GlassCard>
            )
          })}
        </div>
      )}

      <ConfirmDialog open={!!deleting} title={`Remover ${deleting || 'domínio'}?`} description="O ROINADOS não remove domínios que ainda estejam sendo usados por links. O domínio continuará registrado no seu provedor." confirmLabel="Remover domínio" confirmText={domains.find(domain => domain.host === deleting)?.verificado ? deleting || undefined : undefined} busy={deleteBusy} onConfirm={remove} onClose={() => setDeleting(null)} />
    </div>
  )
}
