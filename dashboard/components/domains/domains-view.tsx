'use client'

import { useState } from 'react'
import { Plus, RefreshCw, Trash2, Copy, Loader2, ArrowUpRight, Globe, Stethoscope, Check } from 'lucide-react'
import { ApiError, useDomains, apiSend, fetcher } from '@/lib/api'
import type { DomainAddResponse, DomainDnsRecords, DomainVerifyResult, DomainDiagnostics } from '@/lib/types'
import { GlassCard } from '@/components/glass-card'
import { Skeleton } from '@/components/skeleton'
import { ErrorState } from '@/components/error-state'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { toast } from '@/lib/toast'

function normalizeHostInput(raw: string): string {
  const value = raw.trim().toLowerCase()
  if (!value) return ''
  try {
    const parsed = new URL(value.includes('://') ? value : `https://${value}`)
    return parsed.hostname.toLowerCase().replace(/\.$/, '')
  } catch {
    return value.replace(/^https?:\/\//, '').split('/')[0].split(':')[0].replace(/\.$/, '')
  }
}
function hostInvalidReason(raw: string): string | null {
  const host = normalizeHostInput(raw)
  if (!host) return 'Informe o domínio.'
  if (host.length > 253 || host.split('.').some((label) => !label || label.length > 63)) return 'O domínio é longo demais.'
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(host)) return 'Use um domínio válido, como link.sualoja.com.'
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
  if (!records.length) return <p className="text-xs text-muted-foreground">Registros ainda indisponíveis.</p>
  return <div className="space-y-2">
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
  const [verifying, setVerifying] = useState<Record<string, boolean>>({})
  const [diagnosing, setDiagnosing] = useState<Record<string, boolean>>({})
  const [diagnostics, setDiagnostics] = useState<Record<string, DomainDiagnostics>>({})
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [checks, setChecks] = useState<Record<string, DomainVerifyResult>>({})
  const [addedDns, setAddedDns] = useState<Record<string, DomainDnsRecords | null>>({})
  const [expandedHost, setExpandedHost] = useState<string | null>(null)
  async function add() {
    const invalid = hostInvalidReason(host)
    if (invalid || adding) { setError(invalid); return }
    setAdding(true); setError(null)
    const normalized = normalizeHostInput(host)
    try {
      const result = await apiSend<DomainAddResponse>('/api/domains', 'POST', { host: normalized, uso: 'ambos' })
      if (!result.ok) throw new Error(result.providerNote || 'Não foi possível cadastrar o domínio.')
      setAddedDns(previous => ({ ...previous, [normalized]: result.dnsRecords }))
      setHost('')
      setExpandedHost(normalized)
      toast.success('Domínio cadastrado', { hint: 'A conexão será acompanhada automaticamente.' })
      await mutate()
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível cadastrar.') }
    finally { setAdding(false) }
  }
  async function verify(domain: string) {
    if (verifying[domain]) return
    setVerifying(previous => ({ ...previous, [domain]: true }))
    try {
      const result = await apiSend<DomainVerifyResult>('/api/domains/verify', 'POST', { host: domain })
      setChecks(previous => ({ ...previous, [domain]: result }))
      if (result.verified) toast.success('Domínio verificado')
      else toast.info('Conexão ainda pendente', { hint: result.dnsPropagating ? 'O registro ainda está se espalhando pela rede. Tente mais tarde.' : result.dnsDetail || result.httpDetail })
      await mutate()
    } catch (err) { toast.error('Não foi possível verificar', { hint: apiErrorHint(err) }) }
    finally { setVerifying(previous => ({ ...previous, [domain]: false })) }
  }
  async function diagnose(domain: string) {
    if (diagnosing[domain]) return
    setDiagnosing(previous => ({ ...previous, [domain]: true }))
    try {
      const result = await fetcher<DomainDiagnostics>(`/api/custom-domains/${encodeURIComponent(domain)}/diagnostics`)
      setDiagnostics(previous => ({ ...previous, [domain]: result }))
      if (result.healthy) { toast.success('Domínio saudável'); await mutate() }
      else toast.info('Diagnóstico concluído', { hint: result.likelyCause || 'A conexão ainda não terminou.' })
    } catch (err) {
      toast.error('Não foi possível diagnosticar', { hint: apiErrorHint(err) })
    } finally {
      setDiagnosing(previous => ({ ...previous, [domain]: false }))
    }
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
  const isReady = (domain: (typeof domains)[number]) => domain.verificado && (!domain.status || domain.status === 'active')
  const readyCount = domains.filter(isReady).length
  const errorCount = domains.filter((domain) => domain.status === 'error').length
  const pendingCount = domains.filter((domain) => !isReady(domain) && domain.status !== 'error').length

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Domínios</h1>
        </div>
      </div>

      {domains.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-0.5 text-[11px] text-muted-foreground">
          <span><strong className="font-semibold text-foreground">{domains.length}</strong> domínio{domains.length === 1 ? '' : 's'}</span>
          <span className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-success" /><strong className="font-semibold text-foreground">{readyCount}</strong> ativos</span>
          {pendingCount > 0 && <span className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-warning" /><strong className="font-semibold text-foreground">{pendingCount}</strong> configurando</span>}
          {errorCount > 0 && <span className="inline-flex items-center gap-1.5 text-destructive"><span className="size-1.5 rounded-full bg-destructive" /><strong>{errorCount}</strong> com atenção</span>}
        </div>
      )}

      <GlassCard variant="thick" className="p-4 sm:p-5" title="A verificação é automática">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Adicionar domínio</h2>
          </div>
          <form className="flex w-full max-w-2xl flex-col gap-2 sm:flex-row" onSubmit={event => { event.preventDefault(); void add() }}>
            <label className="min-w-0 flex-1">
              <span className="sr-only">Endereço do domínio</span>
              <input className="input w-full rounded-xl border border-border/80 bg-secondary/40 px-3 py-2.5 text-xs text-foreground focus:border-brand-cyan/50" value={host} onChange={event => setHost(event.target.value)} onBlur={() => host && setHost(normalizeHostInput(host))} placeholder="link.sualoja.com" disabled={adding} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
            </label>
            <button type="submit" className="btn-primary shrink-0" disabled={adding || !host.trim()}>
              {adding ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              {adding ? 'Cadastrando…' : 'Adicionar'}
            </button>
          </form>
        </div>
        {error && <p role="alert" className="mt-3 text-xs text-error">{error}</p>}
        {data?.providerDegraded ? <p className="mt-3 rounded-xl border border-warning/25 bg-warning/10 px-3 py-2 text-xs text-warning">Provisionamento automático indisponível. A conexão pode exigir ajuste manual.</p> : null}
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
            const diagnostic = diagnostics[domain.host]
            const ready = isReady(domain)
            const dns = check?.dnsRecords || domain.dns || addedDns[domain.host]
            const statusLabel = ready
              ? 'Ativo'
              : domain.status === 'pending_ssl'
                ? 'Ativando HTTPS'
                : domain.status === 'error'
                  ? 'Atenção'
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
                    {!ready && (domain.status === 'error' || domain.lastError) ? (
                      <button type="button" className="btn-secondary px-3 py-1.5 text-xs" disabled={!!diagnosing[domain.host]} onClick={() => void diagnose(domain.host)}>
                        {diagnosing[domain.host] ? <Loader2 className="size-3.5 animate-spin text-brand-cyan" /> : <Stethoscope className="size-3.5" />}
                        {diagnosing[domain.host] ? 'Analisando…' : 'Diagnosticar'}
                      </button>
                    ) : (
                      <button type="button" className={ready ? 'btn-ghost p-2' : 'btn-secondary px-3 py-1.5 text-xs'} aria-label={ready ? `Verificar ${domain.host} novamente` : undefined} disabled={!!verifying[domain.host]} onClick={() => void verify(domain.host)}>
                        <RefreshCw className={`size-3.5 ${verifying[domain.host] ? 'animate-spin text-brand-cyan' : ''}`} />
                        {!ready && <span>{verifying[domain.host] ? 'Verificando…' : 'Verificar agora'}</span>}
                      </button>
                    )}
                    <button type="button" className="btn-ghost p-2 text-muted-foreground hover:text-destructive" aria-label={`Remover domínio ${domain.host}`} onClick={() => setDeleting(domain.host)}><Trash2 className="size-4" /></button>
                  </div>
                </div>

                <div className="flex items-center gap-2 rounded-xl border border-border/50 bg-secondary/10 px-3 py-2.5 text-[10px]">
                  {[
                    { label: 'DNS', done: ready || domain.status === 'pending_ssl' },
                    { label: 'HTTPS', done: ready },
                    { label: 'Ativo', done: ready },
                  ].map((step, stepIndex) => (
                    <div key={step.label} className="flex min-w-0 flex-1 items-center gap-2">
                      <span className={`flex size-4 shrink-0 items-center justify-center rounded-full border ${step.done ? 'border-success/40 bg-success/15 text-success' : domain.status === 'error' ? 'border-destructive/40 text-destructive' : 'border-border text-muted-foreground'}`}>{step.done ? <Check className="size-2.5" /> : stepIndex + 1}</span>
                      <span className={step.done ? 'text-foreground' : 'text-muted-foreground'}>{step.label}</span>
                      {stepIndex < 2 && <span className={`ml-auto h-px min-w-3 flex-1 ${step.done ? 'bg-success/35' : 'bg-border'}`} />}
                    </div>
                  ))}
                </div>

                {diagnostic && !diagnostic.healthy ? <div className="rounded-xl border border-warning/25 bg-warning/10 px-3 py-2 text-xs text-warning"><span className="font-medium">Próxima ação:</span> {diagnostic.likelyCause || 'Tente verificar novamente em instantes.'}</div> : !ready && (domain.lastError || domain.providerNote) ? <p className="rounded-xl border border-warning/25 bg-warning/10 px-3 py-2 text-xs text-warning">{domain.lastError || domain.providerNote}</p> : null}

                <details className="rounded-xl border border-border/60 bg-secondary/10 p-3" open={expandedHost === domain.host} onToggle={(event) => setExpandedHost(event.currentTarget.open ? domain.host : null)}>
                  <summary className="cursor-pointer text-xs font-medium text-foreground">DNS e detalhes</summary>
                  <div className="mt-3"><DnsInstructions dns={dns} /></div>
                </details>

                <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-3">
                  <span className="text-[10px] text-muted-foreground">{domain.lastCheckedAt ? `Atualizado ${new Date(domain.lastCheckedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : 'Verificação automática ativa'}</span>
                  {ready ? (
                    <div className="flex flex-wrap items-center gap-3">
                      {domain.uso !== 'cloaker' ? <a href={`/links?novo=1&dominio=${encodeURIComponent(domain.host)}`} className="inline-flex items-center gap-1 text-xs font-medium text-brand-cyan hover:underline">Usar em Links <ArrowUpRight className="size-3" /></a> : null}
                      {domain.uso !== 'checkout' ? <a href={`/cloak?novo=1&dominio=${encodeURIComponent(domain.host)}`} className="inline-flex items-center gap-1 text-xs font-medium text-brand-cyan hover:underline">Usar no Cloaker <ArrowUpRight className="size-3" /></a> : null}
                    </div>
                  ) : null}
                </div>
              </GlassCard>
            )
          })}
        </div>
      )}

      <ConfirmDialog open={!!deleting} title={`Remover ${deleting || 'domínio'}?`} description="Domínios em uso precisam ser trocados antes. Quando gerenciado automaticamente, o recurso remoto também é removido." confirmLabel="Remover domínio" confirmText={domains.find(domain => domain.host === deleting)?.verificado ? deleting || undefined : undefined} busy={deleteBusy} onConfirm={remove} onClose={() => setDeleting(null)} />
    </div>
  )
}
