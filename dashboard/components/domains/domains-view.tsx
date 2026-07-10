'use client'

import { useState } from 'react'
import {
  Globe,
  Plus,
  Trash2,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  BookOpen,
  X,
} from 'lucide-react'
import { useDomains, apiSend } from '@/lib/api'
import type { CustomDomain, DomainVerifyResult, DomainAddResponse, DomainDnsRecords } from '@/lib/types'
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
  // Tutorial de DNS: abre sozinho após adicionar e pode ser reaberto no card
  const [tutorial, setTutorial] = useState<{ host: string; dns: DomainDnsRecords | null; note?: string | null } | null>(
    null,
  )

  const appHost = data?.appHost ?? ''
  const domains = data?.domains ?? []

  async function handleAdd() {
    setAdding(true)
    setError(null)
    try {
      const res = await apiSend<DomainAddResponse>('/api/domains', 'POST', { host })
      setHost('')
      mutate()
      // Abre o tutorial na hora: o lojista sai daqui sabendo exatamente o que
      // criar no DNS, sem depender de acesso a nada além do registrador dele.
      setTutorial({ host: res.host, dns: res.dnsRecords, note: res.providerNote })
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

  const inputCls =
    'w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring'

  return (
    <div className="flex flex-col gap-4">
      {/* Adicionar domínio */}
      <GlassCard className="p-5">
        <h2 className="section-head mb-1 text-sm font-semibold text-foreground">Adicionar domínio</h2>
        <p className="mb-3 text-xs text-muted-foreground text-pretty">
          Digite o domínio (ou subdomínio) que você quer usar nos links. Depois de adicionar, mostramos o passo a passo
          exato do que configurar no DNS.
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
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-cyan px-3 py-2 text-sm font-semibold text-black shadow-[var(--glow-cyan-soft)] transition-all hover:-translate-y-px hover:shadow-[var(--glow-cyan)] hover:brightness-105 active:scale-[0.98] disabled:opacity-50 disabled:shadow-none"
          >
            <Plus className="size-4" /> {adding ? 'Adicionando…' : 'Adicionar'}
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
              onTutorial={() => setTutorial({ host: d.host, dns: d.dns ?? null })}
            />
          ))}
        </div>
      )}

      {tutorial && (
        <DnsTutorialModal
          host={tutorial.host}
          dns={tutorial.dns}
          note={tutorial.note}
          appHost={appHost}
          onClose={() => setTutorial(null)}
          onVerify={() => {
            setTutorial(null)
            handleVerify(tutorial.host)
          }}
        />
      )}
    </div>
  )
}

/* ── Tutorial de DNS — popup autossuficiente para quem só controla o DNS ── */

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <button
        type="button"
        onClick={copy}
        className="flex items-center justify-between gap-2 rounded-lg border border-border bg-secondary/60 px-3 py-2 text-left transition-colors hover:bg-secondary"
        aria-label={`Copiar ${label}: ${value}`}
      >
        <code className="min-w-0 break-all font-mono text-xs text-foreground">{value}</code>
        {copied ? (
          <Check className="size-3.5 shrink-0 text-[color:var(--success)]" />
        ) : (
          <Copy className="size-3.5 shrink-0 text-muted-foreground" />
        )}
      </button>
    </div>
  )
}

function DnsTutorialModal({
  host,
  dns,
  note,
  appHost,
  onClose,
  onVerify,
}: {
  host: string
  dns: DomainDnsRecords | null
  note?: string | null
  appHost: string
  onClose: () => void
  onVerify: () => void
}) {
  // Sem registros do provedor (modo manual), o CNAME aponta para o host do app.
  const cnameHost = dns?.cname?.host || host
  const cnameTarget = dns?.cname?.target || appHost
  const txt = dns?.txt ?? null

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dns-tutorial-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border border-border bg-card p-5 sm:max-w-lg sm:rounded-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 id="dns-tutorial-title" className="text-base font-semibold text-foreground">
              Configurar DNS do domínio
            </h3>
            <p className="mt-0.5 font-mono text-xs text-brand-cyan">{host}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            aria-label="Fechar tutorial"
          >
            <X className="size-4" />
          </button>
        </div>

        {note && (
          <p className="mb-4 rounded-lg border border-[color:var(--warning)]/30 bg-[color:var(--warning)]/10 px-3 py-2 text-xs text-foreground text-pretty">
            {note}
          </p>
        )}

        <ol className="flex flex-col gap-4">
          <li className="flex gap-3">
            <StepNumber n={1} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">Abra o painel de DNS do seu domínio</p>
              <p className="mt-0.5 text-xs text-muted-foreground text-pretty">
                É o site onde você comprou ou gerencia o domínio (Cloudflare, GoDaddy, Registro.br, Hostinger,
                Namecheap…). Procure a seção &quot;DNS&quot; ou &quot;Zona DNS&quot;.
              </p>
            </div>
          </li>

          <li className="flex gap-3">
            <StepNumber n={2} />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <p className="text-sm font-medium text-foreground">
                Crie um registro <span className="font-mono">CNAME</span>
              </p>
              <CopyField label="Nome / Host" value={cnameHost} />
              <CopyField label="Valor / Destino" value={cnameTarget} />
              <p className="text-xs text-muted-foreground text-pretty">
                Na Cloudflare, deixe o proxy <strong>desligado</strong> (nuvem cinza, &quot;Somente DNS&quot;) — com a
                nuvem laranja a verificação falha.
              </p>
            </div>
          </li>

          {txt && (
            <li className="flex gap-3">
              <StepNumber n={3} />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <p className="text-sm font-medium text-foreground">
                  Crie também um registro <span className="font-mono">TXT</span> (verificação)
                </p>
                <CopyField label="Nome / Host" value={txt.host} />
                <CopyField label="Valor" value={txt.value} />
              </div>
            </li>
          )}

          <li className="flex gap-3">
            <StepNumber n={txt ? 4 : 3} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">Aguarde e verifique</p>
              <p className="mt-0.5 text-xs text-muted-foreground text-pretty">
                A propagação do DNS leva de alguns minutos a algumas horas. O SSL é emitido automaticamente — você não
                precisa configurar mais nada além do DNS. Volte aqui e clique em Verificar.
              </p>
            </div>
          </li>
        </ol>

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary"
          >
            Fechar
          </button>
          <button
            type="button"
            onClick={onVerify}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand-cyan px-3 py-2 text-sm font-semibold text-black transition-all hover:brightness-105 active:scale-[0.98]"
          >
            <RefreshCw className="size-3.5" /> Verificar agora
          </button>
        </div>
      </div>
    </div>
  )
}

function StepNumber({ n }: { n: number }) {
  return (
    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-cyan/15 font-mono text-xs font-bold text-brand-cyan">
      {n}
    </span>
  )
}

/* ── Card de domínio ── */

function DomainCard({
  domain,
  result,
  verifying,
  deleting,
  onVerify,
  onAskDelete,
  onCancelDelete,
  onDelete,
  onTutorial,
}: {
  domain: CustomDomain
  result?: DomainVerifyResult
  verifying: boolean
  deleting: boolean
  onVerify: () => void
  onAskDelete: () => void
  onCancelDelete: () => void
  onDelete: () => void
  onTutorial: () => void
}) {
  return (
    <GlassCard className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {/* Item 75: check verde com draw-in de SVG path quando verificado */}
          {domain.verificado ? (
            <CheckCircle2 className="check-draw size-5 shrink-0 text-[color:var(--success)]" />
          ) : (
            <AlertCircle className="size-5 shrink-0 text-[color:var(--warning)]" />
          )}
          <div className="min-w-0">
            <p className="break-all font-mono text-sm font-semibold text-foreground">{domain.host}</p>
            <p className="text-xs text-muted-foreground">
              {domain.verificado ? 'Verificado e ativo' : 'Aguardando verificação de DNS'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {!domain.verificado && (
            <button
              type="button"
              onClick={onTutorial}
              className="flex items-center gap-1.5 rounded-lg border border-brand-cyan/40 px-3 py-1.5 text-xs font-medium text-brand-cyan transition-colors hover:bg-brand-cyan/10"
            >
              <BookOpen className="size-3.5" />
              Tutorial DNS
            </button>
          )}
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
          <div className="flex items-start gap-2">
            {result.dnsOk ? (
              <CheckCircle2 className="check-draw mt-0.5 size-3.5 shrink-0 text-[color:var(--success)]" />
            ) : (
              <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-[color:var(--warning)]" />
            )}
            <span className="text-muted-foreground text-pretty">
              DNS: {result.dnsDetail || (result.dnsOk ? 'ok' : 'pendente')}
            </span>
          </div>
          <div className="flex items-start gap-2">
            {result.httpOk ? (
              <CheckCircle2 className="check-draw mt-0.5 size-3.5 shrink-0 text-[color:var(--success)]" />
            ) : (
              <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-[color:var(--warning)]" />
            )}
            <span className="text-muted-foreground text-pretty">
              HTTPS: {result.httpDetail || (result.httpOk ? 'ok' : 'pendente')}
            </span>
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
