'use client'

import { useState } from 'react'
import { Plus, RefreshCw, Trash2, Copy, Loader2, Globe } from 'lucide-react'
import { useDomains, apiSend } from '@/lib/api'
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
      const result = await apiSend<DomainAddResponse>('/api/domains', 'POST', { host: normalized, uso: 'ambos' })
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
    } catch (err) { toast.error('Não foi possível verificar', { hint: err instanceof Error ? err.message : undefined }) }
    finally { setVerifying(null) }
  }
  async function remove() {
    if (!deleting) return
    setDeleteBusy(true)
    try { await apiSend(`/api/domains/${encodeURIComponent(deleting)}`, 'DELETE'); setDeleting(null); await mutate(); toast.success('Domínio removido') }
    catch (err) { toast.error('Não foi possível remover', { hint: err instanceof Error ? err.message : undefined }) }
    finally { setDeleteBusy(false) }
  }
  return <div className="space-y-4">
    <GlassCard className="p-4 sm:p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold"><Globe className="size-4 text-primary" />Usar seu domínio</h2>
      <p className="mt-1 text-xs text-muted-foreground">Cadastre o endereço e configure a conexão no seu provedor.</p>
      <form className="mt-4 flex max-w-2xl flex-col items-start gap-3 sm:flex-row sm:items-end" onSubmit={event => { event.preventDefault(); void add() }}>
        <label className="w-full flex-1 text-xs text-muted-foreground">Endereço<input className="input mt-1 w-full" value={host} onChange={event => setHost(event.target.value)} placeholder="link.sualoja.com" disabled={adding} autoCapitalize="none" autoCorrect="off" spellCheck={false} /></label>
        <button type="submit" className="btn-primary shrink-0 text-sm" disabled={adding || !host.trim()}>{adding ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}{adding ? 'Cadastrando…' : 'Adicionar domínio'}</button>
      </form>
      {error && <p role="alert" className="mt-3 text-xs text-error">{error}</p>}
    </GlassCard>
    {loadError && <ErrorState title="Não foi possível atualizar os domínios" onRetry={() => mutate()} />}
    {isLoading && !data ? <Skeleton className="h-28" /> : data?.domains.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">Seus domínios aparecerão aqui.</p> : (data?.domains ?? []).map(domain => {
      const check = checks[domain.host]
      const ready = domain.verificado
      const dns = check?.dnsRecords || domain.dns || addedDns[domain.host]
      return <GlassCard key={domain.host} className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0"><h3 className="break-all text-sm font-semibold">{domain.host}</h3><p className={`mt-1 text-xs ${ready ? 'text-primary' : 'text-warning'}`}>{ready ? 'Pronto para usar' : domain.status === 'pending_ssl' ? 'Aguardando certificado de segurança' : domain.status === 'error' ? 'A conexão precisa de ajuste' : 'Aguardando conexão'}</p></div>
          <div className="flex items-center gap-2"><button type="button" className="btn-secondary text-xs" disabled={!!verifying} onClick={() => void verify(domain.host)}><RefreshCw className={`size-3.5 ${verifying === domain.host ? 'animate-spin' : ''}`} />{verifying === domain.host ? 'Verificando…' : 'Verificar'}</button><button type="button" className="btn-ghost p-2" aria-label={`Remover domínio ${domain.host}`} onClick={() => setDeleting(domain.host)}><Trash2 className="size-4" /></button></div>
        </div>
        {!ready && domain.lastError && <p className="mt-3 text-xs text-warning">{domain.lastError}</p>}
        <details className="mt-3 border-t border-border pt-3" open={!ready}>
          <summary className="cursor-pointer text-xs text-muted-foreground">Como conectar</summary><div className="mt-3"><DnsInstructions dns={dns} /></div>
        </details>
      </GlassCard>
    })}
    <ConfirmDialog open={!!deleting} title={`Remover ${deleting || 'domínio'}?`} description="Os links que usam este domínio poderão parar de funcionar. O domínio continuará registrado no seu provedor." confirmLabel="Remover domínio" confirmText={data?.domains.find(domain => domain.host === deleting)?.verificado ? deleting || undefined : undefined} busy={deleteBusy} onConfirm={remove} onClose={() => setDeleting(null)} />
  </div>
}
