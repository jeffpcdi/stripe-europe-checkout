'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Plus, RefreshCw, Trash2, Copy, Loader2, ArrowUpRight, Stethoscope, Check, ChevronDown } from 'lucide-react'
import { ApiError, useDomains, apiSend, fetcher } from '@/lib/api'
import type { DomainAddResponse, DomainDnsRecords, DomainVerifyResult, DomainDiagnostics, DomainDnsGuide, DomainUso } from '@/lib/types'
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
function DnsInstructions({ dns, manual = false, guide, guideLoading = false }: { dns: DomainDnsRecords | null | undefined; manual?: boolean; guide?: DomainDnsGuide; guideLoading?: boolean }) {
  const records = [
    dns?.cname ? { type: 'CNAME', name: dns.cname.name || dns.cname.host || '', value: dns.cname.target } : null,
    dns?.txt ? { type: 'TXT', name: dns.txt.host, value: dns.txt.value } : null,
    dns?.ownership,
    dns?.certificate,
  ].filter((record): record is { type: string; name: string; value: string } => !!record)

  async function copy(text: string, message = 'Copiado') {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(message)
    } catch {
      toast.error('Não foi possível copiar. Selecione o texto e copie manualmente.')
    }
  }

  const allRecords = records.map((record) => `${record.type}\nNome: ${record.name || '@'}\nValor: ${record.value}`).join('\n\n')

  return (
    <div className="space-y-4">
      {guideLoading ? (
        <p className="text-[13px] text-muted-foreground">Identificando onde o DNS é administrado…</p>
      ) : guide ? (
        <div className="rounded-xl border border-border/60 bg-secondary/20 p-3.5">
          <p className="text-[13px] font-medium text-foreground">Como configurar em {guide.providerLabel}</p>
          <ol className="mt-2 space-y-1.5 pl-4 text-xs leading-5 text-muted-foreground sm:text-[13px]">
            {guide.steps.map((step, index) => <li key={`${index}-${step}`} className="list-decimal pl-1">{step}</li>)}
          </ol>
        </div>
      ) : null}

      {guide?.apex ? (
        <p className="rounded-lg border border-warning/25 bg-warning/5 px-3 py-2 text-xs leading-5 text-warning">Este é um domínio raiz. Seu provedor DNS precisa aceitar CNAME flattening, ALIAS ou ANAME. Se ele não oferecer uma dessas opções, use um subdomínio como <code className="font-mono">go.seudominio.com</code>.</p>
      ) : null}

      {!records.length ? (
        <p className="text-[13px] text-muted-foreground">Os registros serão exibidos assim que a configuração automática estiver disponível.</p>
      ) : (
        <div>
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <p className="max-w-xl text-[13px] leading-5 text-muted-foreground">{manual ? 'A configuração automática está temporariamente indisponível. Você pode adiantar este apontamento no DNS; a ativação será retomada pelo SaaS quando o serviço voltar.' : 'Crie estes registros onde o DNS do domínio é administrado. O ROI-NADOS acompanha a propagação e o HTTPS automaticamente.'}</p>
            {records.length > 1 && <button type="button" className="btn-ghost h-8 px-2 text-xs" onClick={() => void copy(allRecords, 'Registros copiados')}><Copy className="size-3.5" />Copiar tudo</button>}
          </div>
          <div className="divide-y divide-border/50 border-y border-border/50">
            {records.map((record, index) => {
              const displayName = record.name || '@'
              return (
                <div key={`${record.type}-${record.name}-${index}`} className="py-3.5 first:pt-3 last:pb-3">
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-xs">
                      <span className="font-medium text-foreground">{record.type}</span>
                      <span className="text-border">·</span>
                      <code className="min-w-0 break-all text-muted-foreground">{displayName}</code>
                    </div>
                    <button type="button" aria-label={`Copiar nome ${record.type}`} className="btn-ghost h-7 px-2 text-[11px]" onClick={() => void copy(displayName, 'Nome copiado')}><Copy className="size-3" />Copiar nome</button>
                  </div>
                  <div className="mt-2 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start">
                    <code className="min-w-0 flex-1 break-all text-xs leading-5 text-foreground/85">{record.value}</code>
                    <button type="button" aria-label={`Copiar valor ${record.type} ${displayName}`} className="inline-flex h-8 shrink-0 items-center gap-1.5 self-start rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-cyan/40" onClick={() => void copy(record.value, 'Valor copiado')}>
                      <Copy className="size-3.5" aria-hidden="true" />
                      Copiar valor
                    </button>
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

export function DomainsView() {
  const { data, isLoading, mutate, error: loadError } = useDomains()
  const [host, setHost] = useState('')
  const [usage, setUsage] = useState<Exclude<DomainUso, 'ambos'>>('checkout')
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
  const [guides, setGuides] = useState<Record<string, DomainDnsGuide>>({})
  const [guideLoading, setGuideLoading] = useState<Record<string, boolean>>({})
  const [usageChanging, setUsageChanging] = useState<Record<string, boolean>>({})

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const requested = params.get('uso')
    if (requested === 'cloaker' || requested === 'checkout') setUsage(requested)
  }, [])

  async function add() {
    const invalid = hostInvalidReason(host)
    if (invalid || adding) { setError(invalid); return }
    setAdding(true); setError(null)
    const normalized = normalizeHostInput(host)
    try {
      const result = await apiSend<DomainAddResponse>('/api/domains', 'POST', { host: normalized, uso: usage })
      if (!result.ok) throw new Error(result.providerNote || 'Não foi possível cadastrar o domínio.')
      setAddedDns(previous => ({ ...previous, [normalized]: result.dnsRecords }))
      setHost('')
      setExpandedHost(normalized)
      toast.success('Domínio cadastrado', { hint: 'O ROI-NADOS vai acompanhar a conexão, a validação DNS e o HTTPS automaticamente.' })
      await mutate()
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível cadastrar.') }
    finally { setAdding(false) }
  }
  async function loadGuide(domain: string) {
    if (guides[domain] || guideLoading[domain]) return
    setGuideLoading(previous => ({ ...previous, [domain]: true }))
    try {
      const result = await fetcher<DomainDnsGuide>(`/api/domains/${encodeURIComponent(domain)}/guide`)
      setGuides(previous => ({ ...previous, [domain]: result }))
    } catch {
      // Tutorial universal continua no backend; se nem ele carregar, os registros
      // DNS permanecem visíveis e o fluxo não é bloqueado.
    } finally {
      setGuideLoading(previous => ({ ...previous, [domain]: false }))
    }
  }
  async function verify(domain: string) {
    if (verifying[domain]) return
    setVerifying(previous => ({ ...previous, [domain]: true }))
    try {
      const result = await apiSend<DomainVerifyResult>('/api/domains/verify', 'POST', { host: domain })
      setChecks(previous => ({ ...previous, [domain]: result }))
      if (result.verified) toast.success('Domínio verificado')
      else {
        const hint = result.dnsPropagating
          ? 'O registro ainda está se espalhando pela rede. O tempo varia conforme o seu provedor de DNS.'
          : !result.dnsOk
            ? result.dnsDetail
            : !result.httpOk
              ? result.httpDetail
              : result.httpDetail || result.dnsDetail
        toast.info('Conexão ainda pendente', { hint })
      }
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
      if (result.healthy) {
        // Diagnóstico continua read-only; a promoção durável para `active` passa
        // pelo fluxo oficial de verificação para a lista não ficar contraditória.
        await verify(domain)
      } else toast.info('Diagnóstico concluído', { hint: result.likelyCause || 'A conexão ainda não terminou.' })
    } catch (err) {
      toast.error('Não foi possível diagnosticar', { hint: apiErrorHint(err) })
    } finally {
      setDiagnosing(previous => ({ ...previous, [domain]: false }))
    }
  }

  async function changeUsage(domain: string, nextUsage: Exclude<DomainUso, 'ambos'>) {
    if (usageChanging[domain]) return
    setUsageChanging(previous => ({ ...previous, [domain]: true }))
    try {
      await apiSend(`/api/domains/${encodeURIComponent(domain)}/usage`, 'POST', {
        uso: nextUsage,
        _baseUpdatedAt: data?.configUpdatedAt || undefined,
      })
      toast.success(nextUsage === 'cloaker' ? 'Domínio dedicado ao Cloaker' : 'Domínio dedicado aos Links')
      await mutate()
    } catch (err) {
      toast.error('Não foi possível alterar o uso do domínio', { hint: apiErrorHint(err) })
    } finally {
      setUsageChanging(previous => ({ ...previous, [domain]: false }))
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
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-lg font-semibold tracking-tight text-foreground">Domínios</h1>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Conecte domínios próprios e defina claramente se cada endereço será usado em Links ou no Cloaker.</p>
      </header>

      {domains.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground sm:text-[13px]">
          <span><strong className="font-semibold tabular-nums text-foreground">{domains.length}</strong> domínio{domains.length === 1 ? '' : 's'}</span>
          <span className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-success" /><strong className="font-semibold tabular-nums text-foreground">{readyCount}</strong> ativos</span>
          {pendingCount > 0 && <span className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-warning" /><strong className="font-semibold tabular-nums text-foreground">{pendingCount}</strong> configurando</span>}
          {errorCount > 0 && <span className="inline-flex items-center gap-1.5 text-destructive"><span className="size-1.5 rounded-full bg-destructive" /><strong className="tabular-nums">{errorCount}</strong> com atenção</span>}
        </div>
      )}

      <section className="space-y-3" data-tour="domains-add">
        <div className="space-y-1">
          <h2 className="text-[15px] font-semibold text-foreground">Adicionar domínio</h2>
          <p className="text-xs text-muted-foreground">Publique seus links sem precisar acessar a infraestrutura. O ROI-NADOS acompanha DNS e HTTPS para você.</p>
        </div>

        <form className="grid max-w-3xl gap-2 sm:grid-cols-[minmax(0,1fr)_190px_auto]" onSubmit={event => { event.preventDefault(); void add() }}>
          <label className="min-w-0">
            <span className="mb-1.5 block text-xs font-medium text-foreground">Seu domínio</span>
            <input className="input h-10 w-full rounded-lg border border-border/80 bg-secondary/30 px-3 text-sm text-foreground outline-none transition-colors hover:border-border focus:border-brand-cyan/60 focus:ring-1 focus:ring-brand-cyan/20" value={host} onChange={event => setHost(event.target.value)} onBlur={() => host && setHost(normalizeHostInput(host))} placeholder="oferta.sualoja.com" disabled={adding} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
          </label>
          <label>
            <span className="mb-1.5 block text-xs font-medium text-foreground">Usar em</span>
            <select
              className="input h-10 w-full rounded-lg border border-border/80 bg-secondary/30 px-3 text-sm text-foreground outline-none transition-colors hover:border-border focus:border-brand-cyan/60 focus:ring-1 focus:ring-brand-cyan/20"
              value={usage}
              onChange={event => setUsage(event.target.value as Exclude<DomainUso, 'ambos'>)}
              disabled={adding}
            >
              <option value="checkout">Links de venda</option>
              <option value="cloaker">Cloaker</option>
            </select>
          </label>
          <button type="submit" className="btn-primary mt-auto h-10 shrink-0 px-4 text-sm" disabled={adding || !host.trim() || data?.autoProvision === false}>
            {adding ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            {adding ? 'Cadastrando…' : 'Continuar'}
          </button>
        </form>
        {error && <p role="alert" className="text-[13px] text-error">{error}</p>}
        {data && data.autoProvision === false ? <p className="flex items-start gap-2 text-[13px] leading-5 text-warning"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-warning" />A configuração automática de domínios ainda está sendo preparada. Aguarde alguns instantes e tente novamente.</p> : data?.providerDegraded ? <p className="flex items-start gap-2 text-[13px] leading-5 text-warning"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-warning" />A configuração automática está operando em modo degradado. O acompanhamento continua ativo.</p> : null}
      </section>

      {loadError && <ErrorState title="Não foi possível atualizar os domínios" onRetry={() => mutate()} />}
      {isLoading && !data ? (
        <div className="grid gap-4 xl:grid-cols-2" aria-hidden="true">
          <Skeleton className="h-56 rounded-2xl" />
          <Skeleton className="hidden h-56 rounded-2xl xl:block" />
        </div>
      ) : domains.length === 0 ? (
        <section className="flex min-h-[180px] flex-col items-center justify-center px-4 py-10 text-center">
          <h3 className="text-[15px] font-semibold text-foreground">Nenhum domínio conectado</h3>
          <p className="mt-1.5 max-w-md text-[13px] leading-5 text-muted-foreground">Conecte um domínio que você já possui; o ROI-NADOS orienta o DNS e acompanha a ativação.</p>
        </section>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2" data-tour="domains-list">
          {domains.map((domain) => {
            const check = checks[domain.host]
            const diagnostic = diagnostics[domain.host]
            const ready = isReady(domain)
            const manualDns: DomainDnsRecords | null = data?.manualDnsAllowed && data?.autoProvision === false && data.appHost
              ? { cname: { host: domain.host, target: data.appHost }, txt: null }
              : null
            const dns = check?.dnsRecords || domain.dns || addedDns[domain.host] || manualDns
            const usingManualDns = !!(manualDns && !check?.dnsRecords && !domain.dns && !addedDns[domain.host])
            const statusLabel = ready
              ? 'Ativo'
              : domain.status === 'pending_ssl'
                ? 'Ativando HTTPS'
                : domain.status === 'error'
                  ? 'Atenção'
                  : 'Aguardando DNS'
            const usageLabel = domain.uso === 'checkout' ? 'Links' : domain.uso === 'cloaker' ? 'Cloaker' : 'Links + Cloaker'
            const currentUsage = domain.uso || 'ambos'
            const changingUsage = !!usageChanging[domain.host]
            const statusDotClass = ready ? 'bg-success' : domain.status === 'error' ? 'bg-destructive' : 'bg-warning'
            const statusTextClass = ready ? 'text-success' : domain.status === 'error' ? 'text-destructive' : 'text-warning'
            const infrastructureReady = !!(domain.providerId || dns)
            const dnsReady = !!(ready || domain.status === 'pending_ssl')
            const steps = [
              { label: 'Cadastrado', done: true },
              { label: 'Preparado', done: infrastructureReady },
              { label: 'DNS', done: dnsReady },
              { label: 'HTTPS', done: ready },
              { label: 'Pronto', done: ready },
            ]
            return (
              <section key={domain.host} className="flex flex-col gap-4 rounded-2xl border border-border/60 bg-secondary/[0.08] p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="break-all text-[15px] font-semibold leading-5 text-foreground">{domain.host}</h3>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs sm:text-[13px]">
                      <span className={`inline-flex items-center gap-1.5 font-medium ${statusTextClass}`}><span className={`size-1.5 shrink-0 rounded-full ${statusDotClass}`} />{statusLabel}</span>
                      <span className="text-border">·</span>
                      <span className="text-muted-foreground">{usageLabel}</span>
                      {currentUsage === 'ambos' && <span className="text-warning">· defina um uso para novas campanhas</span>}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {!ready && (domain.status === 'error' || domain.lastError) ? (
                      <button type="button" className="btn-secondary h-8 px-3 text-xs" disabled={!!diagnosing[domain.host]} onClick={() => void diagnose(domain.host)}>
                        {diagnosing[domain.host] ? <Loader2 className="size-3.5 animate-spin text-brand-cyan" /> : <Stethoscope className="size-3.5" />}
                        {diagnosing[domain.host] ? 'Analisando…' : 'Diagnosticar'}
                      </button>
                    ) : (
                      <button type="button" className={ready ? 'btn-ghost p-2' : 'btn-secondary h-8 px-3 text-xs'} aria-label={ready ? `Verificar ${domain.host} novamente` : undefined} disabled={!!verifying[domain.host]} onClick={() => void verify(domain.host)}>
                        <RefreshCw className={`size-3.5 ${verifying[domain.host] ? 'animate-spin text-brand-cyan' : ''}`} />
                        {!ready && <span>{verifying[domain.host] ? 'Verificando…' : 'Verificar agora'}</span>}
                      </button>
                    )}
                    <button type="button" className="btn-ghost p-2 text-muted-foreground hover:text-destructive" aria-label={`Remover domínio ${domain.host}`} onClick={() => setDeleting(domain.host)}><Trash2 className="size-4" /></button>
                  </div>
                </div>

                <div className="flex items-center gap-2 py-1 text-xs sm:text-[13px]" aria-label={`Provisionamento de ${domain.host}: ${statusLabel}`}>
                  {steps.map((step, stepIndex) => (
                    <div key={step.label} className="flex min-w-0 flex-1 items-center gap-2">
                      <span className={`flex size-5 shrink-0 items-center justify-center rounded-full border text-xs ${step.done ? 'border-success/40 bg-success/10 text-success' : domain.status === 'error' ? 'border-destructive/45 text-destructive' : 'border-border text-muted-foreground'}`}>{step.done ? <Check className="size-3" /> : stepIndex + 1}</span>
                      <span className={step.done ? 'text-foreground' : domain.status === 'error' ? 'text-destructive' : 'text-muted-foreground'}>{step.label}</span>
                      {stepIndex < steps.length - 1 && <span className={`ml-auto h-px min-w-3 flex-1 ${step.done ? 'bg-success/35' : domain.status === 'error' ? 'bg-destructive/25' : 'bg-border/80'}`} />}
                    </div>
                  ))}
                </div>

                {diagnostic && !diagnostic.healthy ? (
                  <p className="flex items-start gap-2 text-[13px] leading-5 text-warning"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-warning" /><span><strong className="font-medium">Próxima ação</strong> · {diagnostic.likelyCause || 'Tente verificar novamente em instantes.'}</span></p>
                ) : !ready && (domain.lastError || domain.providerNote) ? (
                  <p className="flex items-start gap-2 text-[13px] leading-5 text-warning"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-warning" /><span>{domain.lastError || domain.providerNote}</span></p>
                ) : null}

                {ready && (
                  <div className="flex flex-wrap items-end gap-3 border-t border-border/50 pt-3">
                    <label className="min-w-44">
                      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Uso deste domínio</span>
                      <select
                        className="input h-9 w-full rounded-lg border border-border/70 bg-secondary/25 px-2.5 text-xs text-foreground outline-none focus:border-brand-cyan/60"
                        value={currentUsage}
                        disabled={changingUsage}
                        onChange={event => {
                          const next = event.target.value
                          if (next === 'checkout' || next === 'cloaker') void changeUsage(domain.host, next)
                        }}
                      >
                        {currentUsage === 'ambos' && <option value="ambos">Links + Cloaker (legado)</option>}
                        <option value="checkout">Links de venda</option>
                        <option value="cloaker">Cloaker</option>
                      </select>
                    </label>
                    <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
                      Novas campanhas do Cloaker precisam de um domínio dedicado. A troca é bloqueada se este domínio ainda estiver em uso na outra área.
                    </p>
                  </div>
                )}

                <details className="group border-t border-border/50 pt-3" open={expandedHost === domain.host} onToggle={(event) => {
                  const open = event.currentTarget.open
                  setExpandedHost(open ? domain.host : null)
                  if (open) void loadGuide(domain.host)
                }}>
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-md py-1 text-[13px] font-medium text-foreground outline-none transition-colors hover:text-foreground/90 focus-visible:ring-1 focus-visible:ring-brand-cyan/35 [&::-webkit-details-marker]:hidden">
                    <span>{ready ? 'Detalhes técnicos' : 'Configuração DNS'}</span>
                    <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-open:rotate-180" aria-hidden="true" />
                  </summary>
                  <div className="mt-3">
                    <DnsInstructions dns={dns} manual={usingManualDns} guide={guides[domain.host]} guideLoading={!!guideLoading[domain.host]} />
                  </div>
                </details>

                <div className="mt-auto flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border/50 pt-3">
                  <span className="text-xs text-muted-foreground">{domain.lastCheckedAt ? `Atualizado ${new Date(domain.lastCheckedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : 'Gerenciado pelo ROI-NADOS · verificação automática ativa'}</span>
                  {ready ? (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground" onClick={async () => {
                        try { await navigator.clipboard.writeText(domain.host); toast.success('Domínio copiado') }
                        catch { toast.error('Não foi possível copiar o domínio') }
                      }}><Copy className="size-3" />Copiar domínio</button>
                      {currentUsage === 'checkout' || currentUsage === 'ambos' ? <Link href={`/links?novo=1&dominio=${encodeURIComponent(domain.host)}`} className="inline-flex items-center gap-1 text-xs font-medium text-brand-cyan hover:underline">Usar em Links <ArrowUpRight className="size-3" /></Link> : null}
                      {currentUsage === 'cloaker' ? <Link href={`/cloak?novo=1&dominio=${encodeURIComponent(domain.host)}`} className="inline-flex items-center gap-1 text-xs font-medium text-brand-cyan hover:underline">Usar no Cloaker <ArrowUpRight className="size-3" /></Link> : null}
                    </div>
                  ) : null}
                </div>
              </section>
            )
          })}
        </div>
      )}

      <ConfirmDialog open={!!deleting} title={`Remover ${deleting || 'domínio'}?`} description="Domínios em uso precisam ser trocados antes. Quando gerenciado automaticamente, o recurso remoto também é removido." confirmLabel="Remover domínio" confirmText={domains.find(domain => domain.host === deleting)?.verificado ? deleting || undefined : undefined} tone="danger" appearance="quiet" busy={deleteBusy} onConfirm={remove} onClose={() => setDeleting(null)} />
    </div>
  )
}
