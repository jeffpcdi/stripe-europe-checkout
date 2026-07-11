'use client'

import { useEffect, useRef, useState } from 'react'
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
  CloudOff,
} from 'lucide-react'
import { useDomains, apiSend } from '@/lib/api'
import type { CustomDomain, DomainVerifyResult, DomainAddResponse, DomainDnsRecords, DomainUso } from '@/lib/types'
import { GlassCard } from '@/components/glass-card'
import { Skeleton } from '@/components/skeleton'
import { ErrorState } from '@/components/error-state'
import { TutorialButton, TutorialModal, type TutorialStep } from '@/components/tutorial-modal'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { toast } from '@/lib/toast'

// Tutorial conceitual da aba (o "porquê"); o passo a passo de DNS por domínio
// continua no DnsTutorialModal, que já traz os valores exatos para copiar.
const DOMAIN_STEPS: TutorialStep[] = [
  {
    title: 'Para que serve um domínio personalizado',
    body: (
      <>
        Em vez de compartilhar links no nosso domínio, você usa o <strong>seu próprio</strong> (ex.:{' '}
        <code>link.seudominio.com</code>). Isso passa mais confiança, melhora a entrega dos anúncios e
        deixa a marca com a sua cara.
      </>
    ),
  },
  {
    title: '1. Adicione o domínio',
    body: (
      <>
        Digite o subdomínio que quer usar e clique em <strong>Adicionar</strong>. Nós já registramos ele
        na hospedagem automaticamente — <strong>sem aprovação manual</strong>, funciona para qualquer conta.
      </>
    ),
    tip: 'Recomendamos um subdomínio (link., go., etc.) em vez do domínio raiz.',
  },
  {
    title: '2. Aponte o DNS',
    body: (
      <>
        Abrimos o <strong>tutorial de DNS</strong> na hora, com o registro <code>CNAME</code> (e o{' '}
        <code>TXT</code> quando necessário) já preenchidos para você copiar e colar no seu registrador.
      </>
    ),
    tip: 'Na Cloudflare, deixe o proxy como "Somente DNS" (nuvem cinza).',
  },
  {
    title: '3. Verifique e pronto',
    body: (
      <>
        Clique em <strong>Verificar</strong>. Quando o DNS propagar, o domínio fica verde e o{' '}
        <strong>SSL é emitido automaticamente</strong> — você não configura mais nada.
      </>
    ),
  },
]

// Rótulos PT-BR do uso do domínio
const USO_LABELS: { value: DomainUso; label: string; hint: string }[] = [
  { value: 'ambos', label: 'Ambos', hint: 'links de checkout e cloaker' },
  { value: 'checkout', label: 'Checkout', hint: 'só links de checkout' },
  { value: 'cloaker', label: 'Cloaker', hint: 'só rotas do cloaker' },
]

// Validação leve de hostname no cliente — evita ida ao servidor com valor
// obviamente inválido (espaços, protocolo, sem ponto)
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
  const [uso, setUso] = useState<DomainUso>('ambos')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [verifying, setVerifying] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, DomainVerifyResult>>({})
  // Item 184: exclusão via ConfirmDialog padronizado; domínio verificado
  // exige digitar o host (links/entries ao vivo dependem dele)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  // Tutorial de DNS: abre sozinho após adicionar e pode ser reaberto no card
  const [tutorial, setTutorial] = useState<{ host: string; dns: DomainDnsRecords | null; note?: string | null } | null>(
    null,
  )
  // Tutorial conceitual da aba (visão geral do fluxo)
  const [showIntro, setShowIntro] = useState(false)

  const appHost = data?.appHost ?? ''
  const domains = data?.domains ?? []

  // Polling automático: enquanto houver domínio pendente, re-verifica a cada
  // 45s — o lojista não precisa ficar clicando em Verificar durante a propagação
  const pendingHosts = domains.filter((d) => !d.verificado).map((d) => d.host)
  const pendingKey = pendingHosts.join(',')
  const pollBusy = useRef(false)
  useEffect(() => {
    if (!pendingKey) return
    const id = setInterval(async () => {
      if (pollBusy.current) return
      pollBusy.current = true
      try {
        for (const h of pendingKey.split(',')) {
          const res = await apiSend<DomainVerifyResult>('/api/domains/verify', 'POST', { host: h })
          setResults((r) => ({ ...r, [h]: res }))
        }
        mutate()
      } catch {
        /* silencioso: o polling tenta de novo no próximo ciclo */
      } finally {
        pollBusy.current = false
      }
    }, 45_000)
    return () => clearInterval(id)
  }, [pendingKey, mutate])

  async function handleAdd() {
    const invalid = hostInvalidReason(host)
    if (invalid) {
      setError(invalid)
      return
    }
    setAdding(true)
    setError(null)
    try {
      const res = await apiSend<DomainAddResponse>('/api/domains', 'POST', { host, uso })
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
      // Item 127: falha de REDE (fetch caiu) é diferente de "DNS pendente" —
      // marca networkError para a UI oferecer retry em vez do estado genérico
      setResults((r) => ({
        ...r,
        [h]: {
          host: h,
          appHost,
          dnsOk: false,
          dnsDetail: e instanceof Error ? e.message : 'erro',
          httpOk: false,
          httpDetail: '',
          networkError: true,
        },
      }))
    } finally {
      setVerifying(null)
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
    'w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring'

  return (
    /* Item 58: gap-5 na raiz — mesmo ritmo vertical nas 5 abas da Gestão */
    <div className="flex flex-col gap-5">
      {/* Adicionar domínio */}
      <GlassCard className="p-5" data-tour="domains-add">
        <div className="mb-1 flex items-center justify-between gap-2">
          <h2 className="section-head text-sm font-semibold text-foreground">Adicionar domínio</h2>
          <TutorialButton onClick={() => setShowIntro(true)} />
        </div>
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
            disabled={adding || !host.trim() || !!hostInvalidReason(host)}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-cyan px-3 py-2 text-sm font-semibold text-black shadow-[var(--glow-cyan-soft)] transition-all hover:-translate-y-px hover:shadow-[var(--glow-cyan)] hover:brightness-105 active:scale-[0.98] disabled:opacity-50 disabled:shadow-none"
          >
            <Plus className="size-4" /> {adding ? 'Adicionando…' : 'Adicionar'}
          </button>
        </div>
        {/* Validação inline enquanto digita — mensagem antes de bater no servidor */}
        {host.trim() && hostInvalidReason(host) && (
          <p className="mt-2 text-xs text-warning" role="alert">
            {hostInvalidReason(host)}
          </p>
        )}
        {/* Uso do domínio: checkout, cloaker ou ambos */}
        <fieldset className="mt-3" data-tour="domains-use">
          <legend className="mb-1.5 text-xs font-medium text-muted-foreground">Onde este domínio vale</legend>
          <div className="flex flex-wrap gap-2">
            {USO_LABELS.map((u) => (
              <label
                key={u.value}
                className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                  uso === u.value
                    ? 'border-brand-cyan/50 bg-brand-cyan/10 text-brand-cyan'
                    : 'border-border text-muted-foreground hover:bg-secondary'
                }`}
                title={u.hint}
              >
                <input
                  type="radio"
                  name="domain-uso"
                  className="sr-only"
                  checked={uso === u.value}
                  onChange={() => setUso(u.value)}
                />
                {u.label}
              </label>
            ))}
          </div>
        </fieldset>
        {error && (
          <p className="mt-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
      </GlassCard>

      {/* Lista de domínios */}
      {loadError && !data ? (
        /* Item 182: erro de carregamento com retry consistente */
        <ErrorState title="Não foi possível carregar seus domínios." onRetry={() => mutate()} />
      ) : isLoading && !data ? (
        <Skeleton className="h-40" />
      ) : domains.length === 0 ? (
        <GlassCard className="flex flex-col items-center gap-3 p-10 text-center">
          <Globe className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Nenhum domínio personalizado ainda.</p>
          {/* Item 129: estado vazio guiado — explica o benefício e abre o tutorial */}
          <p className="max-w-sm text-xs text-muted-foreground text-pretty">
            Com um domínio seu (ex.: <code>link.seudominio.com</code>), os links ficam com a sua marca e passam mais
            confiança nos anúncios.
          </p>
          <button
            type="button"
            onClick={() => setShowIntro(true)}
            className="flex items-center gap-1.5 rounded-lg border border-brand-cyan/40 px-3 py-1.5 text-xs font-medium text-brand-cyan transition-colors hover:bg-brand-cyan/10"
          >
            <BookOpen className="size-3.5" /> Ver como funciona
          </button>
        </GlassCard>
      ) : (
        <div className="flex flex-col gap-3" data-tour="domains-list">
          {domains.map((d) => (
            <DomainCard
              key={d.host}
              domain={d}
              result={results[d.host]}
              verifying={verifying === d.host}
              onVerify={() => handleVerify(d.host)}
              onAskDelete={() => setDeleting(d.host)}
              onTutorial={() => setTutorial({ host: d.host, dns: d.dns ?? null })}
            />
          ))}
        </div>
      )}

      <TutorialModal
        open={showIntro}
        onClose={() => setShowIntro(false)}
        title="Domínio personalizado nos seus links"
        steps={DOMAIN_STEPS}
      />

      {/* Item 184: confirmação padronizada — domínio verificado exige o host digitado */}
      {(() => {
        const dd = deleting ? domains.find((d) => d.host === deleting) : undefined
        return (
          <ConfirmDialog
            open={Boolean(dd)}
            title={dd ? `Remover ${dd.host}?` : ''}
            description={
              dd?.verificado ? (
                <>
                  Este domínio está <strong className="text-foreground">verificado e em uso</strong> — links e rotas de
                  cloaker que apontam para ele param de funcionar na hora.
                </>
              ) : (
                <>O domínio sai da lista e o provisionamento é desfeito. Você pode adicioná-lo de novo depois.</>
              )
            }
            confirmLabel="Remover"
            confirmText={dd?.verificado ? dd.host : undefined}
            busy={deleteBusy}
            onConfirm={() => deleting && handleDelete(deleting)}
            onClose={() => setDeleting(null)}
          />
        )
      })()}

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

  // Item 121: bloco completo em formato de zona — cola tudo de uma vez em
  // registradores que aceitam edição em texto (ou serve de "colinha" completa)
  const [blockCopied, setBlockCopied] = useState(false)
  const dnsBlock = [
    `${cnameHost}  CNAME  ${cnameTarget}`,
    ...(txt ? [`${txt.host}  TXT  "${txt.value}"`] : []),
  ].join('\n')
  async function copyBlock() {
    await navigator.clipboard.writeText(dnsBlock)
    setBlockCopied(true)
    setTimeout(() => setBlockCopied(false), 1500)
  }

  // Item 123: apex (domínio raiz, sem subdomínio) não aceita CNAME em muitos
  // registradores — detectar e orientar para subdomínio
  const isApex = host.split('.').length === 2

  // Item 122: checagem RÁPIDA de propagação direto do navegador via DoH
  // (DNS-over-HTTPS da Cloudflare, com CORS liberado) — feedback em segundos,
  // sem esperar o verify oficial do servidor
  const [doh, setDoh] = useState<{ state: 'idle' | 'busy' | 'ok' | 'pending' | 'error'; detail?: string }>({
    state: 'idle',
  })
  async function checkPropagation() {
    setDoh({ state: 'busy' })
    try {
      const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(cnameHost)}&type=CNAME`, {
        headers: { accept: 'application/dns-json' },
      })
      const json = (await res.json()) as { Answer?: { type: number; data: string }[] }
      const cname = (json.Answer ?? []).find((a) => a.type === 5)
      if (cname && cname.data.replace(/\.$/, '').toLowerCase() === cnameTarget.replace(/\.$/, '').toLowerCase()) {
        setDoh({ state: 'ok', detail: 'O CNAME já propagou! Pode clicar em Verificar agora.' })
      } else if (cname) {
        setDoh({ state: 'pending', detail: `O DNS responde, mas aponta para ${cname.data} — confira o Valor/Destino.` })
      } else {
        setDoh({ state: 'pending', detail: 'O CNAME ainda não propagou — aguarde alguns minutos e cheque de novo.' })
      }
    } catch {
      setDoh({ state: 'error', detail: 'Não foi possível checar agora — tente o botão Verificar mesmo assim.' })
    }
  }

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
              {/* Item 121: copiar CNAME + TXT de uma vez */}
              <button
                type="button"
                onClick={copyBlock}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                {blockCopied ? (
                  <Check className="size-3.5 text-[color:var(--success)]" />
                ) : (
                  <Copy className="size-3.5" />
                )}
                {blockCopied ? 'Bloco copiado!' : txt ? 'Copiar tudo (CNAME + TXT)' : 'Copiar registro completo'}
              </button>
              <p className="text-xs text-muted-foreground text-pretty">
                Na Cloudflare, deixe o proxy <strong>desligado</strong> (nuvem cinza, &quot;Somente DNS&quot;) — com a
                nuvem laranja a verificação falha.
              </p>
              {/* Item 123: TTL + aviso de apex */}
              <p className="text-xs text-muted-foreground text-pretty">
                Se o registrador pedir <strong>TTL</strong>, use o menor disponível (300s/&quot;Auto&quot;) — a
                propagação fica mais rápida.
              </p>
              {isApex && (
                <p className="rounded-lg border border-[color:var(--warning)]/30 bg-[color:var(--warning)]/10 px-3 py-2 text-xs text-foreground text-pretty">
                  <strong>{host}</strong> é um domínio raiz (sem subdomínio) — muitos registradores não aceitam
                  CNAME nele. Se o seu recusar, use um subdomínio como <code>link.{host}</code> (ou o recurso
                  &quot;ALIAS&quot;/&quot;CNAME flattening&quot; se o registrador tiver).
                </p>
              )}
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
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <p className="text-sm font-medium text-foreground">Aguarde e verifique</p>
              <p className="text-xs text-muted-foreground text-pretty">
                A propagação do DNS leva de alguns minutos a algumas horas. O SSL é emitido automaticamente — você não
                precisa configurar mais nada além do DNS. Volte aqui e clique em Verificar.
              </p>
              {/* Item 122: checagem instantânea de propagação via DoH */}
              <button
                type="button"
                onClick={checkPropagation}
                disabled={doh.state === 'busy'}
                className="flex items-center gap-1.5 self-start rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
              >
                <RefreshCw className={`size-3 ${doh.state === 'busy' ? 'animate-spin' : ''}`} />
                {doh.state === 'busy' ? 'Checando propagação…' : 'Já propagou? Checar agora'}
              </button>
              {doh.detail && (
                <p
                  className={`text-xs text-pretty ${
                    doh.state === 'ok' ? 'font-medium text-[color:var(--success)]' : 'text-muted-foreground'
                  }`}
                  role="status"
                >
                  {doh.detail}
                </p>
              )}
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
  onVerify,
  onAskDelete,
  onTutorial,
}: {
  domain: CustomDomain
  result?: DomainVerifyResult
  verifying: boolean
  onVerify: () => void
  onAskDelete: () => void
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
              {/* Item 120: data da verificação + "reconectado" quando o verify re-registrou o host */}
              {domain.verificado
                ? `Verificado e ativo${domain.verificadoEm ? ` desde ${new Date(domain.verificadoEm).toLocaleDateString('pt-BR')}` : ''}`
                : 'Aguardando verificação de DNS'}
              {result?.reconectado ? ' — reconectado à hospedagem' : ''}
            </p>
          </div>
          {/* Item 54: badge de uso do domínio (checkout / cloaker / ambos) */}
          <span
            className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
              !domain.uso || domain.uso === 'ambos'
                ? 'border-border text-muted-foreground'
                : 'border-brand-cyan/40 bg-brand-cyan/10 text-brand-cyan'
            }`}
          >
            {domain.uso === 'checkout' ? 'só checkout' : domain.uso === 'cloaker' ? 'só cloaker' : 'checkout + cloaker'}
          </span>
          {/* Badge dedicada: proxy da Cloudflare (nuvem laranja) mascara o CNAME */}
          {result?.cloudflareProxy && (
            <span className="flex shrink-0 items-center gap-1 rounded-full border border-[#f6821f]/40 bg-[#f6821f]/10 px-2 py-0.5 text-[11px] font-medium text-[#f6821f]">
              <CloudOff className="size-3" aria-hidden="true" /> proxy Cloudflare ativo
            </span>
          )}
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
          {/* Item 124: domínio verificado → atalho que abre a criação de link
              já com este domínio selecionado (?dominio= lido pelo links-view) */}
          {domain.verificado && domain.uso !== 'cloaker' && (
            <a
              href={`/dashboard/links?novo=1&dominio=${encodeURIComponent(domain.host)}`}
              className="flex items-center gap-1.5 rounded-lg border border-brand-cyan/40 px-3 py-1.5 text-xs font-medium text-brand-cyan transition-colors hover:bg-brand-cyan/10"
            >
              <Plus className="size-3.5" />
              Usar em um link
            </a>
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

      {/* Item 127: falha de REDE ganha estado próprio com retry — não é "DNS pendente" */}
      {result?.networkError ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[color:var(--warning)]/30 bg-[color:var(--warning)]/10 px-3 py-2 text-xs">
          <span className="text-foreground text-pretty">
            Não conseguimos completar a verificação (falha de conexão) — o DNS pode estar certo. Tente de novo.
          </span>
          <button
            type="button"
            onClick={onVerify}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 font-medium text-foreground transition-colors hover:bg-secondary"
          >
            <RefreshCw className="size-3" /> Tentar de novo
          </button>
        </div>
      ) : result ? (
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
          {/* Item 125: diagnóstico dirigido — aponta ONDE está o problema
              (DNS vs. HTTPS vs. proxy) e reabre o tutorial no passo certo */}
          {!result.verified && !result.dnsOk && !result.cloudflareProxy && (
            <button
              type="button"
              onClick={onTutorial}
              className="mt-1 flex items-center gap-1.5 self-start rounded-lg border border-brand-cyan/40 px-3 py-1.5 font-medium text-brand-cyan transition-colors hover:bg-brand-cyan/10"
            >
              <BookOpen className="size-3" /> O DNS ainda não aponta pra cá — rever o passo a passo
            </button>
          )}
          {!result.verified && result.dnsOk && !result.httpOk && (
            <p className="mt-1 text-muted-foreground text-pretty">
              O DNS já está certo — falta só o certificado HTTPS, que é emitido sozinho. Aguarde alguns minutos e
              verifique de novo.
            </p>
          )}
        </div>
      ) : null}

    </GlassCard>
  )
}
