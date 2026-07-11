'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  Plus,
  Target,
  Copy,
  Check,
  Trash2,
  Zap,
  Pencil,
  CircleCheck,
  CircleX,
  TriangleAlert,
  Search,
  Loader2,
  TrendingDown,
  RefreshCw,
  ChevronDown,
  CopyPlus,
  Eye,
  EyeOff,
} from 'lucide-react'
import {
  usePixels,
  usePixelHealth,
  usePixelLog,
  usePixelDurability,
  useEmqTrend,
  apiSend,
} from '@/lib/api'
import type { Pixel, PixelEvents, PixelTestResult, PixelEmqTrend } from '@/lib/types'
import { GlassCard } from '@/components/glass-card'
import { StatusBadge } from '@/components/status-badge'
import { Skeleton } from '@/components/skeleton'
import { ErrorState } from '@/components/error-state'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { TutorialButton, TutorialModal, type TutorialStep } from '@/components/tutorial-modal'
import { timeAgo } from '@/lib/format'
import { toast } from '@/lib/toast'
import { useConfirm } from '@/lib/use-confirm'

// Resultado da verificação de instalação por URL (server-side)
type UrlCheck = {
  ok: boolean
  url?: string
  algumInstalado?: boolean
  pixels?: { slug: string; name: string; scriptOk: boolean; nativeOk: boolean; instalado: boolean }[]
  error?: string
}

// Passos do tutorial da aba Pixels
const PIXEL_STEPS: TutorialStep[] = [
  {
    title: 'O que é o Pixel TikTok aqui',
    body: (
      <>
        Cada pixel dispara eventos <strong>server-side</strong> (Events API / CAPI) direto do nosso servidor
        para o TikTok. Isso é mais confiável que o pixel do navegador, que costuma ser bloqueado dentro do
        app do TikTok.
      </>
    ),
    tip: 'Você precisa do Pixel Code e do Access Token, ambos gerados no TikTok Events Manager.',
  },
  {
    title: '1. Crie o pixel',
    body: (
      <>
        Clique em <strong>Novo pixel</strong> e cole o <code>Pixel Code</code> (ex.: C0ABC123) e o{' '}
        <code>Access Token</code>. Deixe ligados os eventos que quer enviar: Visita, Carrinho, Checkout,
        Pagamento e Compra.
      </>
    ),
  },
  {
    title: '2. Instale o script na sua página',
    body: (
      <>
        Copie a tag <code>&lt;script&gt;</code> do pixel e cole antes do <code>&lt;/head&gt;</code> da sua
        landing page. Ela rastreia visita, carrinho e checkout automaticamente.
      </>
    ),
    tip: 'A tag é individual por pixel — cada campanha pode ter a sua.',
  },
  {
    title: '3. Confirme que está instalado',
    body: (
      <>
        Use o painel <strong>Verificar instalação</strong>: cole a URL da sua página e nós buscamos o HTML
        dela para confirmar se o script está presente. Você também pode usar <strong>Testar disparo</strong>{' '}
        para enviar um evento de teste e ver a resposta do TikTok.
      </>
    ),
  },
  {
    title: '4. Evento de Compra só vem do gateway',
    body: (
      <>
        A <strong>Visita/Carrinho/Checkout</strong> saem do script na página. Mas a{' '}
        <strong>Compra (CompletePayment)</strong> só dispara quando o <strong>gateway confirma o pagamento</strong>{' '}
        via webhook — é assim que garantimos que só venda real conta. Configure um gateway na aba Gateways.
      </>
    ),
    tip: 'Sem gateway conectado, o evento de Compra nunca dispara — por design, para não contar venda falsa.',
  },
]

// Rótulos PT-BR dos eventos CAPI — mesma ordem do funil real
const EVENT_LABELS: { key: keyof PixelEvents; label: string }[] = [
  { key: 'ViewContent', label: 'Visita' },
  { key: 'AddToCart', label: 'Carrinho' },
  { key: 'InitiateCheckout', label: 'Checkout' },
  { key: 'AddPaymentInfo', label: 'Pagamento' },
  { key: 'CompletePayment', label: 'Compra' },
]

export function PixelsView() {
  const { data, mutate, isLoading, error } = usePixels()
  const { data: health } = usePixelHealth()
  const { data: log, mutate: mutateLog } = usePixelLog()
  const { data: durability } = usePixelDurability()
  const { data: emqTrend } = useEmqTrend()

  // Filtros do log de disparos (item 81) e linha expandida (item 82)
  const [logPixel, setLogPixel] = useState('')
  const [logEvent, setLogEvent] = useState('')
  const [logStatus, setLogStatus] = useState('')
  const [expandedLog, setExpandedLog] = useState<string | null>(null)
  // Item 233: paginação incremental do log (50 por vez — o log pode ter 500 linhas)
  const [logShown, setLogShown] = useState(50)
  const [copiedEventId, setCopiedEventId] = useState<string | null>(null)

  const [editing, setEditing] = useState<Pixel | null>(null)
  const [creating, setCreating] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [testing, setTesting] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ slug: string; ok: boolean; msg: string } | null>(null)
  // Evento escolhido para o teste, por pixel (default ViewContent)
  const [testEvent, setTestEvent] = useState<Record<string, keyof PixelEvents>>({})
  const [showTutorial, setShowTutorial] = useState(false)
  const [checkUrl, setCheckUrl] = useState('')
  const [checking, setChecking] = useState(false)
  const [urlCheck, setUrlCheck] = useState<UrlCheck | null>(null)

  const pixels = data?.pixels ?? []

  // Item 93: feedback de cópia acessível — além do destaque visual no botão,
  // anunciamos via aria-live para leitores de tela.
  const [copyAnnounce, setCopyAnnounce] = useState('')

  // Item 184: confirmação destrutiva padronizada (substitui window.confirm)
  const { confirm, dialogProps } = useConfirm()

  function handleCopy(slug: string, text: string, label = 'Script') {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(slug)
      setCopyAnnounce(`${label} copiado para a área de transferência.`)
      setTimeout(() => setCopied(null), 2000)
    })
  }

  function handleDelete(p: Pixel) {
    confirm({
      title: `Remover o pixel "${p.name}"?`,
      description: 'Os eventos dele param de disparar imediatamente. Esta ação não pode ser desfeita.',
      confirmLabel: 'Remover pixel',
      run: async () => {
        try {
          await apiSend(`/api/pixels/${encodeURIComponent(p.slug)}`, 'DELETE')
          mutate()
          toast.success(`Pixel "${p.name}" removido`)
        } catch {
          toast.error('Não foi possível remover o pixel', { hint: 'Tente novamente em instantes.' })
        }
      },
    })
  }

  // Item 92: duplicar pixel — clona nome/código/eventos SEM o Access Token
  // (cada conta de anúncio tem o seu). A cópia nasce pausada e sem token,
  // pronta para receber as credenciais da outra conta.
  async function handleDuplicate(p: Pixel) {
    const base = `${p.slug}-copia`
    let slug = base
    let n = 2
    while (pixels.some((x) => x.slug === slug)) slug = `${base}-${n++}`
    await apiSend('/api/pixels', 'POST', {
      slug,
      name: `${p.name} (cópia)`,
      pixelCode: p.pixelCode,
      accessToken: '',
      testEventCode: '',
      events: p.events,
      active: false,
    })
    mutate()
  }

  // Item 49: toggle ativo/pausado inline com atualização OTIMISTA — o backend
  // faz merge-patch (só `active` muda; token/eventos são preservados).
  async function handleToggleActive(p: Pixel) {
    const next = !p.active
    mutate(
      (cur) =>
        cur ? { ...cur, pixels: cur.pixels.map((x) => (x.slug === p.slug ? { ...x, active: next } : x)) } : cur,
      { revalidate: false },
    )
    try {
      await apiSend('/api/pixels', 'POST', { slug: p.slug, active: next })
      mutate()
    } catch {
      mutate() // reverte para o estado do servidor em caso de erro
    }
  }

  async function handleTest(p: Pixel) {
    const event = testEvent[p.slug] || 'ViewContent'
    setTesting(p.slug)
    setTestResult(null)
    try {
      const r = await apiSend<PixelTestResult>('/api/pixels/test', 'POST', { slug: p.slug, event })
      const ok = r.ok !== false && !r.error
      const evLabel = EVENT_LABELS.find((e) => e.key === (r.event || event))?.label || (r.event || event)
      setTestResult({
        slug: p.slug,
        ok,
        msg: ok
          ? `TikTok aceitou o evento de teste (${evLabel}).`
          : r.messagePtBr || r.error || r.message || 'TikTok recusou o evento',
      })
      mutateLog()
    } catch (e) {
      setTestResult({ slug: p.slug, ok: false, msg: e instanceof Error ? e.message : 'Falha no teste' })
    } finally {
      setTesting(null)
    }
  }

  // Verificação server-side: o backend busca o HTML da URL e procura o script
  async function handleCheckUrl() {
    const url = checkUrl.trim()
    if (!url || checking) return
    setChecking(true)
    setUrlCheck(null)
    try {
      const r = await apiSend<UrlCheck>('/api/pixels/verify-url', 'POST', { url })
      setUrlCheck(r)
    } catch (e) {
      setUrlCheck({ ok: false, error: e instanceof Error ? e.message : 'Falha na verificação' })
    } finally {
      setChecking(false)
    }
  }

  const warnings = durability?.warnings ?? []

  return (
    <div className="flex flex-col gap-5">
      {/* Item 55/93: anúncio acessível das cópias (fora de tela, polido) */}
      <span className="sr-only" role="status" aria-live="polite">
        {copyAnnounce}
      </span>
      {/* Item 51: cabeçalho de saúde consolidado. "Durável" = há uma camada de
          persistência disponível (banco OU Redis); é a capacidade que garante que
          a config sobrevive a um restart, independente de já ter havido gravação. */}
      {durability &&
        (() => {
          const persistente = durability.dbEnabled || durability.redisEnabled
          return (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border border-border bg-card/60 px-4 py-2.5 text-xs">
              <span
                className={`flex items-center gap-1.5 font-semibold ${persistente ? 'text-success' : 'text-warning'}`}
              >
                <span
                  className={`size-2 rounded-full ${persistente ? 'bg-[color:var(--success)]' : 'bg-[color:var(--warning)]'}`}
                  aria-hidden="true"
                />
                {persistente ? 'Config durável' : 'Config volátil (só em memória)'}
              </span>
              <span className="text-muted-foreground">
                Banco:{' '}
                <strong className={durability.dbEnabled ? 'text-success' : 'text-warning'}>
                  {durability.dbEnabled ? 'conectado' : 'off'}
                </strong>
              </span>
              <span className="text-muted-foreground">
                Redis:{' '}
                <strong className={durability.redisEnabled ? 'text-success' : 'text-muted-foreground'}>
                  {durability.redisEnabled ? 'conectado' : 'off'}
                </strong>
              </span>
              {!persistente && (
                <span className="text-pretty text-muted-foreground">
                  — pixels criados agora podem sumir num restart do servidor
                </span>
              )}
              {/* Erro real de gravação durável (banco/Redis habilitado mas falhou) */}
              {persistente && durability.lastError && (
                <span className="text-pretty text-warning">— {durability.lastError}</span>
              )}
            </div>
          )
        })()}

      {/* Diagnóstico: por que a config pode não estar chegando ao pixel.
          Item 87: além dos warnings gerais, lista pixel a pixel o que falta
          (credencial ausente) — antes só a string agregada aparecia. */}
      {(warnings.length > 0 || (durability?.incomplete?.length ?? 0) > 0) && (
        <div
          className="flex flex-col gap-1.5 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3"
          role="alert"
        >
          {warnings.map((w, i) => (
            <p key={i} className="flex items-start gap-2 text-xs text-warning">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span className="text-pretty">{w}</span>
            </p>
          ))}
          {(durability?.incomplete ?? []).map((inc) => (
            <p key={inc.slug} className="flex items-start gap-2 text-xs text-warning">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span className="text-pretty">
                <strong>{inc.name}</strong> está com configuração incompleta: falta{' '}
                {inc.missing.join(', ')}. Edite o pixel para completar.
              </span>
            </p>
          ))}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        {/* Pixels cadastrados — min-w-0 para o script longo truncar em vez de
            alargar a coluna além da viewport no mobile */}
        <GlassCard className="min-w-0 p-5">
          <div className="mb-4 flex items-center justify-between gap-2">
            <div>
              <h2 className="section-head text-sm font-semibold text-foreground">Pixels TikTok</h2>
              <p className="text-xs text-muted-foreground">
                Eventos server-side (CAPI) — cole o script em qualquer página
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <TutorialButton onClick={() => setShowTutorial(true)} />
              <button
                type="button"
                data-tour="pixels-new"
                onClick={() => setCreating(true)}
                className="flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-cyan px-3 py-1.5 text-xs font-semibold text-black shadow-[var(--glow-cyan-soft)] transition-all hover:-translate-y-px hover:shadow-[var(--glow-cyan)] hover:brightness-105 active:scale-[0.98]"
              >
                <Plus className="size-3.5" /> Novo pixel
              </button>
            </div>
          </div>

          {/* Item 12: aviso permanente — Compra só dispara com gateway conectado */}
          <p className="mb-3 rounded-lg border border-[color:var(--warning)]/25 bg-[color:var(--warning)]/8 px-3 py-2 text-xs text-muted-foreground text-pretty">
            O script cobre Visita, Carrinho e Checkout. O evento de{' '}
            <strong className="text-foreground">Compra (CompletePayment)</strong> só dispara quando um
            gateway confirma o pagamento —{' '}
            <Link href="/gateways" className="font-semibold text-[color:var(--brand-cyan)] hover:underline">
              conecte um gateway
            </Link>
            .
          </p>

          {error && !data ? (
            /* Item 182: erro de carregamento com retry consistente */
            <ErrorState title="Não foi possível carregar seus pixels." onRetry={() => mutate()} />
          ) : isLoading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-28" />
              <Skeleton className="h-28" />
            </div>
          ) : pixels.length === 0 ? (
            /* Item 53: estado vazio guiado — CTA de criação + tutorial */
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <p className="text-sm text-muted-foreground text-pretty">
                Nenhum pixel configurado. Adicione o Pixel Code e o Access Token do TikTok Events API.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => setCreating(true)}
                  className="rounded-lg bg-brand-cyan px-3 py-1.5 text-xs font-semibold text-black transition-all hover:brightness-105 active:scale-[0.98]"
                >
                  Criar primeiro pixel
                </button>
                <button
                  type="button"
                  onClick={() => setShowTutorial(true)}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  Ver tutorial
                </button>
              </div>
            </div>
          ) : (
            <ul className="flex flex-col gap-2" data-tour="pixels-list">
              {pixels.map((p) => (
                <li key={p.slug} className="rounded-xl border border-border bg-secondary/40 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span
                        className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-brand-cyan/15 text-brand-cyan"
                        aria-hidden="true"
                      >
                        <Target className="size-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">{p.name}</p>
                        <p className="truncate font-mono text-[11px] text-muted-foreground">
                          {p.pixelCode || 'sem pixel code'}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {/* Item 49: toggle inline ativo/pausado (otimista) */}
                      <button
                        type="button"
                        role="switch"
                        aria-checked={p.active}
                        aria-label={p.active ? `Pausar pixel ${p.name}` : `Ativar pixel ${p.name}`}
                        onClick={() => handleToggleActive(p)}
                        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                          p.active ? 'bg-brand-cyan' : 'bg-secondary'
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 size-4 rounded-full bg-background shadow transition-transform ${
                            p.active ? 'translate-x-4' : 'translate-x-0.5'
                          }`}
                        />
                      </button>
                      <StatusBadge status={p.active ? 'success' : 'neutral'}>
                        {p.active ? 'ativo' : 'pausado'}
                      </StatusBadge>
                      {p.hasToken ? (
                        <StatusBadge status="info">token ok</StatusBadge>
                      ) : (
                        <StatusBadge status="warning">sem token</StatusBadge>
                      )}
                    </div>
                  </div>

                  {/* Eventos ligados */}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {EVENT_LABELS.map(({ key, label }) => (
                      <span
                        key={key}
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          p.events?.[key]
                            ? 'bg-brand-cyan/12 text-brand-cyan'
                            : 'bg-secondary text-muted-foreground line-through opacity-60'
                        }`}
                      >
                        {label}
                      </span>
                    ))}
                  </div>

                  {/* Item 85: pixel ativo mas sem nenhum evento ligado = config
                      inócua (nunca dispara nada). Aviso direto no card. */}
                  {p.active && !EVENT_LABELS.some(({ key }) => p.events?.[key]) && (
                    <p className="mt-2 flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
                      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                      <span className="text-pretty">
                        Este pixel está ativo mas <strong>nenhum evento está ligado</strong> — ele nunca
                        vai disparar. Edite e ligue ao menos um evento.
                      </span>
                    </p>
                  )}

                  {/* Item 86: eventos de dinheiro ligados sem nenhum gateway
                      conectado — CompletePayment/AddPaymentInfo só saem do
                      webhook do gateway (trava trusted), então nunca disparam. */}
                  {p.active &&
                    (p.events?.CompletePayment || p.events?.AddPaymentInfo) &&
                    durability != null &&
                    durability.trustedGateways === 0 && (
                      <p className="mt-2 flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
                        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                        <span className="text-pretty">
                          {p.events?.CompletePayment ? 'Compra' : 'Pagamento'} está ligada, mas{' '}
                          <strong>nenhum gateway está conectado</strong> — eventos de dinheiro só
                          disparam via webhook do gateway.{' '}
                          <Link href="/gateways" className="font-semibold text-brand-cyan hover:underline">
                            Conectar gateway
                          </Link>
                        </span>
                      </p>
                    )}

                  {/* Script para instalar. Item 89: copiar a tag <script> inteira
                      OU só a URL do script (para colar em GTM/Tag Manager). */}
                  {p.scriptTag && (
                    <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-input px-3 py-2">
                      <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
                        {p.scriptTag}
                      </code>
                      <button
                        type="button"
                        onClick={() => handleCopy(`${p.slug}:tag`, p.scriptTag!, 'Tag do script')}
                        className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-brand-cyan transition-colors hover:bg-secondary"
                      >
                        {copied === `${p.slug}:tag` ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
                        {copied === `${p.slug}:tag` ? 'Copiado' : 'Copiar tag'}
                      </button>
                      {p.scriptUrl && (
                        <button
                          type="button"
                          onClick={() => handleCopy(`${p.slug}:url`, p.scriptUrl!, 'URL do script')}
                          title="Copiar só a URL (para GTM)"
                          className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                        >
                          {copied === `${p.slug}:url` ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
                          {copied === `${p.slug}:url` ? 'Copiado' : 'Só URL'}
                        </button>
                      )}
                    </div>
                  )}

                  {testResult?.slug === p.slug && (
                    <p
                      className={`mt-2 flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${
                        testResult.ok
                          ? 'bg-[var(--success-light)] text-success'
                          : 'bg-destructive/10 text-destructive'
                      }`}
                      role="status"
                    >
                      {testResult.ok ? <CircleCheck className="size-3.5" /> : <CircleX className="size-3.5" />}
                      {testResult.msg}
                    </p>
                  )}

                  <div className="mt-3 flex items-center justify-end gap-1 border-t border-border pt-3">
                    {/* Seletor de evento de teste: permite validar qualquer
                        etapa do funil, não só a Visita (item 33) */}
                    <select
                      value={testEvent[p.slug] || 'ViewContent'}
                      onChange={(e) =>
                        setTestEvent((prev) => ({ ...prev, [p.slug]: e.target.value as keyof PixelEvents }))
                      }
                      disabled={!p.hasToken}
                      aria-label={`Evento de teste para ${p.name}`}
                      className="mr-auto rounded-md border border-border bg-input px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-40"
                    >
                      {EVENT_LABELS.map(({ key, label }) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => handleTest(p)}
                      disabled={testing === p.slug || !p.hasToken}
                      className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
                    >
                      <Zap className="size-3.5" /> {testing === p.slug ? 'Testando…' : 'Testar disparo'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDuplicate(p)}
                      title="Clona nome, código e eventos — sem o Access Token (para outra conta de anúncio)"
                      className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                    >
                      <CopyPlus className="size-3.5" /> Duplicar
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing(p)}
                      className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                    >
                      <Pencil className="size-3.5" /> Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(p)}
                      className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" /> Remover
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </GlassCard>

        {/* Verificar instalação + saúde da CAPI + log de disparos */}
        <div className="flex min-w-0 flex-col gap-5">
          <GlassCard className="p-5" data-tour="pixels-verify">
            <h2 className="section-head mb-1 text-sm font-semibold text-foreground">Verificar instalação</h2>
            <p className="mb-3 text-xs text-muted-foreground text-pretty">
              Cole a URL da sua página e confirmamos, pelo servidor, se o script do pixel está presente
            </p>
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                handleCheckUrl()
              }}
            >
              <input
                type="url"
                inputMode="url"
                value={checkUrl}
                onChange={(e) => setCheckUrl(e.target.value)}
                placeholder="https://minhapagina.com/oferta"
                className="min-w-0 flex-1 rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                aria-label="URL da página para verificar o pixel"
              />
              <button
                type="submit"
                disabled={checking || !checkUrl.trim()}
                className="flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-cyan px-3 py-2 text-xs font-semibold text-black transition-all hover:brightness-105 active:scale-[0.98] disabled:opacity-40"
              >
                {checking ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
                {checking ? 'Verificando…' : 'Verificar'}
              </button>
            </form>

            {urlCheck && (
              <div className="mt-3" role="status">
                {urlCheck.error ? (
                  <p className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    <CircleX className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                    <span className="text-pretty">{urlCheck.error}</span>
                  </p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    <p
                      className={`flex items-start gap-2 rounded-lg px-3 py-2 text-xs ${
                        urlCheck.algumInstalado
                          ? 'bg-[var(--success-light)] text-success'
                          : 'bg-warning/10 text-warning'
                      }`}
                    >
                      {urlCheck.algumInstalado ? (
                        <CircleCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                      ) : (
                        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                      )}
                      <span className="text-pretty">
                        {urlCheck.algumInstalado
                          ? 'Pixel encontrado na página!'
                          : 'Nenhum pixel seu foi encontrado nessa página. Cole a tag do script antes do </head> e tente de novo.'}
                      </span>
                    </p>
                    {(urlCheck.pixels ?? []).map((p) => (
                      <p key={p.slug} className="flex items-center justify-between gap-2 rounded-lg bg-secondary/50 px-3 py-1.5 text-[11px]">
                        <span className="truncate font-medium text-foreground">{p.name}</span>
                        <span className={`shrink-0 font-mono ${p.instalado ? 'text-success' : 'text-muted-foreground'}`}>
                          {p.instalado ? (p.scriptOk ? 'script ok' : 'pixel nativo ok') : 'não encontrado'}
                        </span>
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </GlassCard>

          <GlassCard className="p-5" data-tour="pixels-health">
            <h2 className="section-head mb-1 text-sm font-semibold text-foreground">Saúde dos disparos</h2>
            <p className="mb-3 text-xs text-muted-foreground">Taxa de sucesso da Events API (24h)</p>
            {!health ? (
              <Skeleton className="h-16" />
            ) : health.total === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">Nenhum disparo nas últimas 24h.</p>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="flex items-baseline gap-2">
                  <span
                    className={`font-mono text-2xl font-bold ${
                      (health.rate ?? 0) >= 90 ? 'text-success' : (health.rate ?? 0) >= 60 ? 'text-warning' : 'text-error'
                    }`}
                  >
                    {health.rate != null ? `${health.rate.toFixed(0)}%` : '—'}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {health.success} de {health.total} eventos aceitos
                    {health.emq != null && ` · EMQ ${health.emq.toFixed(1)}`}
                  </span>
                </div>
                {health.events.map((ev) => (
                  <div key={ev.event} className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate text-muted-foreground">{ev.event}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      {/* Item 216: EMQ por evento — acha qual evento tem match ruim */}
                      {ev.emq != null && (
                        <span
                          title="EMQ médio deste evento (0–10)"
                          className={`font-mono ${ev.emq >= 7 ? 'text-success' : ev.emq >= 5 ? 'text-warning' : 'text-error'}`}
                        >
                          EMQ {ev.emq.toFixed(1)}
                        </span>
                      )}
                      <span className={`font-mono ${ev.rate >= 90 ? 'text-success' : ev.rate >= 60 ? 'text-warning' : 'text-error'}`}>
                        {ev.ok}/{ev.total}
                      </span>
                    </span>
                  </div>
                ))}
                {/* Fila de reenvio da CAPI (item 80): eventos que falharam e
                    aguardam nova tentativa automática. Zero = tudo entregue. */}
                {health.retryQueue > 0 && (
                  <div className="mt-1 flex items-center gap-1.5 rounded-lg bg-warning/10 px-2 py-1.5 text-xs text-warning">
                    <RefreshCw className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="text-pretty">
                      {health.retryQueue} {health.retryQueue === 1 ? 'evento aguarda' : 'eventos aguardam'} reenvio
                      automático à Events API
                    </span>
                  </div>
                )}
              </div>
            )}
          </GlassCard>

          {/* Tendência de EMQ (item 79): o backend já calcula, mas nada exibia.
              Sparkline por pixel + alerta de EMQ baixo ou em queda. */}
          {emqTrend && emqTrend.pixels.some((p) => p.trend.length > 0) && (
            <GlassCard className="p-5">
              <h2 className="section-head mb-1 text-sm font-semibold text-foreground">Qualidade do match (EMQ)</h2>
              {/* Item 215: explicação curta da escala 0–10 e do impacto na otimização.
                  Item 218: com vários pixels, os cards ficam lado a lado para comparar. */}
              <p className="mb-3 text-xs text-muted-foreground text-pretty">
                O Event Match Quality vai de <strong className="text-foreground">0 a 10</strong> e mede o quão bem
                o TikTok casa seus eventos com pessoas reais. Abaixo de ~5 o algoritmo otimiza no escuro; para
                subir, envie e-mail/telefone com hash, <code className="rounded bg-secondary px-1 font-mono">ttclid</code>{' '}
                e IP/User-Agent. Compare os pixels abaixo para achar o que precisa de atenção.
              </p>
              <div className="flex flex-col gap-4">
                {emqTrend.pixels
                  .filter((p) => p.trend.length > 0)
                  .map((p) => (
                    <EmqSparkline key={p.pixelCode} pixel={p} />
                  ))}
              </div>
            </GlassCard>
          )}

          <GlassCard className="p-5">
            <h2 className="section-head mb-1 text-sm font-semibold text-foreground">Disparos recentes</h2>
            <p className="mb-3 text-xs text-muted-foreground">Log da Events API — inclui descartes e o motivo</p>
            {!log || log.log.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Nenhum disparo registrado ainda.</p>
            ) : (
              (() => {
                // Filtros do log (item 81) — derivados do próprio log carregado.
                const pixelOpts = Array.from(new Set(log.log.map((r) => r.pixel))).sort()
                const eventOpts = Array.from(new Set(log.log.map((r) => r.event))).sort()
                const rows = log.log.filter(
                  (r) =>
                    (!logPixel || r.pixel === logPixel) &&
                    (!logEvent || r.event === logEvent) &&
                    (!logStatus ||
                      (logStatus === 'descarte'
                        ? r.status !== 'ok' && r.status !== 'error'
                        : r.status === logStatus)),
                )
                return (
                  <>
                    <div className="mb-3 flex flex-wrap gap-2">
                      <select
                        value={logPixel}
                        onChange={(e) => setLogPixel(e.target.value)}
                        aria-label="Filtrar por pixel"
                        className="min-w-0 flex-1 rounded-lg border border-border bg-input px-2 py-1 text-xs text-foreground"
                      >
                        <option value="">Todos os pixels</option>
                        {pixelOpts.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                      <select
                        value={logEvent}
                        onChange={(e) => setLogEvent(e.target.value)}
                        aria-label="Filtrar por evento"
                        className="min-w-0 flex-1 rounded-lg border border-border bg-input px-2 py-1 text-xs text-foreground"
                      >
                        <option value="">Todos os eventos</option>
                        {eventOpts.map((ev) => (
                          <option key={ev} value={ev}>
                            {ev}
                          </option>
                        ))}
                      </select>
                      <select
                        value={logStatus}
                        onChange={(e) => setLogStatus(e.target.value)}
                        aria-label="Filtrar por status"
                        className="min-w-0 flex-1 rounded-lg border border-border bg-input px-2 py-1 text-xs text-foreground"
                      >
                        <option value="">Qualquer status</option>
                        <option value="ok">Sucesso</option>
                        <option value="error">Erro</option>
                        <option value="descarte">Descarte</option>
                      </select>
                    </div>
                    {rows.length === 0 ? (
                      <p className="py-6 text-center text-sm text-muted-foreground">
                        Nenhum disparo com esses filtros.
                      </p>
                    ) : (
                      <ul className="flex max-h-96 flex-col gap-1 overflow-y-auto">
                        {/* Item 233: renderiza 50 por vez (o log pode ter 500 linhas) */}
                        {rows.slice(0, logShown).map((row, i) => {
                          const key = row.id ?? String(i)
                          const open = expandedLog === key
                          return (
                            <li key={key} className="rounded-lg text-xs hover:bg-secondary/60">
                              <button
                                type="button"
                                onClick={() => setExpandedLog(open ? null : key)}
                                aria-expanded={open}
                                className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left"
                              >
                                <span className="flex min-w-0 items-center gap-2">
                                  <span
                                    className={`size-1.5 shrink-0 rounded-full ${
                                      row.status === 'ok'
                                        ? 'bg-success'
                                        : row.status === 'error'
                                          ? 'bg-error'
                                          : 'bg-warning'
                                    }`}
                                    aria-hidden="true"
                                  />
                                  <span className="truncate font-mono text-foreground">{row.event}</span>
                                  <span className="truncate text-muted-foreground">
                                    {row.status !== 'ok' && row.response?.message
                                      ? row.response.message
                                      : row.pixel}
                                  </span>
                                </span>
                                <span className="flex shrink-0 items-center gap-1.5">
                                  <span className="text-[11px] text-muted-foreground">{timeAgo(row.at)}</span>
                                  <ChevronDown
                                    className={`size-3.5 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
                                    aria-hidden="true"
                                  />
                                </span>
                              </button>
                              {open && (
                                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t border-border/60 px-2 py-2 font-mono text-[11px]">
                                  <dt className="text-muted-foreground">Pixel</dt>
                                  <dd className="truncate text-foreground">{row.pixel}</dd>
                                  {row.eventId && (
                                    <>
                                      <dt className="text-muted-foreground">Event ID</dt>
                                      <dd className="flex items-center gap-1.5">
                                        <span className="truncate text-foreground">{row.eventId}</span>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            navigator.clipboard.writeText(row.eventId!).then(() => {
                                              setCopiedEventId(key)
                                              setTimeout(() => setCopiedEventId(null), 2000)
                                            })
                                          }}
                                          aria-label="Copiar Event ID"
                                          className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
                                        >
                                          {copiedEventId === key ? (
                                            <Check className="size-3 text-success" aria-hidden="true" />
                                          ) : (
                                            <Copy className="size-3" aria-hidden="true" />
                                          )}
                                        </button>
                                        <span className="sr-only" aria-live="polite">
                                          {copiedEventId === key ? 'Event ID copiado' : ''}
                                        </span>
                                      </dd>
                                    </>
                                  )}
                                  {row.leadId && (
                                    <>
                                      <dt className="text-muted-foreground">Lead</dt>
                                      <dd className="truncate text-foreground">{row.leadId}</dd>
                                    </>
                                  )}
                                  {row.emq != null && (
                                    <>
                                      <dt className="text-muted-foreground">EMQ</dt>
                                      <dd className="text-foreground">{row.emq.toFixed(1)}</dd>
                                    </>
                                  )}
                                  <dt className="text-muted-foreground">Status</dt>
                                  <dd className="text-foreground">{row.status}</dd>
                                  {row.response?.code != null && (
                                    <>
                                      <dt className="text-muted-foreground">Código</dt>
                                      <dd className="text-foreground">{row.response.code}</dd>
                                    </>
                                  )}
                                  {row.response?.message && (
                                    <>
                                      <dt className="text-muted-foreground">Resposta</dt>
                                      <dd className="text-pretty text-foreground">{row.response.message}</dd>
                                    </>
                                  )}
                                </dl>
                              )}
                            </li>
                          )
                        })}
                        {/* Item 233: carrega mais 50 sob demanda */}
                        {rows.length > logShown && (
                          <li>
                            <button
                              type="button"
                              onClick={() => setLogShown((n) => n + 50)}
                              className="w-full rounded-lg border border-dashed border-border px-2 py-1.5 text-center text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                            >
                              Mostrar mais ({rows.length - logShown} restantes)
                            </button>
                          </li>
                        )}
                      </ul>
                    )}
                  </>
                )
              })()
            )}
          </GlassCard>
        </div>
      </div>

      <TutorialModal
        open={showTutorial}
        onClose={() => setShowTutorial(false)}
        title="Como configurar seu pixel TikTok"
        steps={PIXEL_STEPS}
      />

      {(creating || editing) && (
        <PixelEditor
          pixel={editing}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
          onSaved={(warning) => {
            setCreating(false)
            setEditing(null)
            mutate()
            if (warning) window.alert(warning)
          }}
        />
      )}

      <ConfirmDialog {...dialogProps} />
    </div>
  )
}

// ── Sparkline de EMQ por pixel (item 79) ──────────────────────────────
// Barras simples via flexbox (sem SVG). Escala EMQ 0–10 do TikTok.
function EmqSparkline({ pixel }: { pixel: PixelEmqTrend }) {
  const max = 10
  const alertLabel =
    pixel.alert === 'queda'
      ? 'EMQ em queda vs. média anterior'
      : pixel.alert === 'baixo'
        ? 'EMQ baixo — melhore os dados enviados'
        : null
  // Item 217: volume total do período ao lado da qualidade (volume × qualidade)
  const totalEvents = pixel.trend.reduce((s, d) => s + d.count, 0)
  // Item 219: badge de qualidade derivado do EMQ médio recente
  const quality =
    pixel.recentAvg == null
      ? null
      : pixel.recentAvg >= 7
        ? { label: 'bom', cls: 'bg-[var(--success-light)] text-success' }
        : pixel.recentAvg >= 5
          ? { label: 'médio', cls: 'bg-warning/15 text-warning' }
          : { label: 'ruim', cls: 'bg-destructive/15 text-destructive' }
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-medium text-foreground">{pixel.pixel}</span>
          {quality && (
            <span className={`shrink-0 rounded px-1.5 py-px text-[10px] font-medium ${quality.cls}`}>
              {quality.label}
            </span>
          )}
        </span>
        <span className="flex items-center gap-1.5">
          {pixel.recentAvg != null && (
            <span
              className={`font-mono ${
                pixel.recentAvg >= 7 ? 'text-success' : pixel.recentAvg >= 5 ? 'text-warning' : 'text-error'
              }`}
            >
              {pixel.recentAvg.toFixed(1)}
            </span>
          )}
          {alertLabel && (
            <span
              title={alertLabel}
              className="flex items-center gap-0.5 rounded bg-warning/15 px-1.5 py-0.5 text-[10px] text-warning"
            >
              <TrendingDown className="size-3" aria-hidden="true" />
              {pixel.alert === 'queda' ? 'queda' : 'baixo'}
            </span>
          )}
        </span>
      </div>
      <div className="flex h-10 items-end gap-0.5" role="img" aria-label={`Tendência de EMQ do pixel ${pixel.pixel}`}>
        {pixel.trend.map((d) => {
          const h = Math.max(6, Math.round((d.avg / max) * 100))
          return (
            <div
              key={d.day}
              title={`${d.day}: EMQ ${d.avg.toFixed(1)} (${d.count} eventos)`}
              className={`min-w-0 flex-1 rounded-sm ${
                d.avg >= 7 ? 'bg-success/70' : d.avg >= 5 ? 'bg-warning/70' : 'bg-error/70'
              }`}
              style={{ height: `${h}%` }}
            />
          )
        })}
      </div>
      {/* Item 217: volume total ao lado da qualidade — EMQ alto com pouco
          volume importa menos que EMQ médio com muito volume */}
      <p className="text-[10px] text-muted-foreground">
        {totalEvents.toLocaleString('pt-BR')} evento{totalEvents === 1 ? '' : 's'} no período
      </p>
    </div>
  )
}

// ── Editor inline (modal) — cria ou edita um pixel ────────────────────
function PixelEditor({
  pixel,
  onClose,
  onSaved,
}: {
  pixel: Pixel | null
  onClose: () => void
  onSaved: (warning?: string | null) => void
}) {
  const [name, setName] = useState(pixel?.name ?? '')
  const [pixelCode, setPixelCode] = useState(pixel?.pixelCode ?? '')
  const [accessToken, setAccessToken] = useState(pixel?.accessToken ?? '')
  // Item 83: revelar/ocultar o que está no campo do token
  const [showToken, setShowToken] = useState(false)
  const [testEventCode, setTestEventCode] = useState(pixel?.testEventCode ?? '')
  const [active, setActive] = useState(pixel?.active ?? true)
  const [events, setEvents] = useState<PixelEvents>(
    pixel?.events ?? {
      ViewContent: true,
      AddToCart: true,
      InitiateCheckout: true,
      AddPaymentInfo: true,
      CompletePayment: true,
    },
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    if (!pixelCode.trim()) {
      setError('Pixel Code é obrigatório')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const r = await apiSend<{ ok: boolean; durable?: boolean; warning?: string | null }>('/api/pixels', 'POST', {
        slug: pixel?.slug,
        name: name.trim() || pixelCode.trim(),
        pixelCode: pixelCode.trim(),
        accessToken: accessToken.trim(),
        testEventCode: testEventCode.trim() || undefined,
        active,
        events,
      })
      onSaved(r.warning)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  const inputCls =
    'w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring'

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm md:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={pixel ? 'Editar pixel' : 'Novo pixel'}
    >
      <GlassCard variant="thick" className="my-8 w-full max-w-lg p-6">
        <h2 className="mb-5 text-base font-semibold text-foreground">
          {pixel ? `Editar pixel: ${pixel.name}` : 'Novo pixel TikTok'}
        </h2>
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Nome</span>
            <input
              className={inputCls}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Campanha principal"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Pixel Code</span>
            <input
              className={inputCls}
              value={pixelCode}
              onChange={(e) => setPixelCode(e.target.value)}
              placeholder="C0ABC123DEF456"
              autoComplete="off"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Access Token (Events API)</span>
            {/* Item 83: campo mascarado por padrão com botão revelar/ocultar.
                O backend nunca devolve o token completo (só ••••XXXX), então o
                toggle vale para o que está sendo digitado — e o sufixo atual
                fica visível para conferir sem redigitar. */}
            <div className="relative">
              <input
                type={showToken ? 'text' : 'password'}
                className={`${inputCls} w-full pr-16`}
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder={pixel?.hasToken ? 'mantém o atual se não alterar' : 'cole o token do TikTok'}
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setShowToken((v) => !v)}
                aria-label={showToken ? 'Ocultar token' : 'Revelar token'}
                aria-pressed={showToken}
                className="absolute inset-y-0 right-2 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                {showToken ? <EyeOff className="size-3.5" aria-hidden="true" /> : <Eye className="size-3.5" aria-hidden="true" />}
                {showToken ? 'Ocultar' : 'Revelar'}
              </button>
            </div>
            {pixel?.hasToken && pixel.accessToken && (
              <span className="text-[11px] text-muted-foreground">
                Token atual termina em{' '}
                <code className="font-mono text-foreground">{pixel.accessToken.slice(-4)}</code> — não
                altere o campo para mantê-lo; cole um novo para substituir.
              </span>
            )}
            {/* Item 50: sem token os eventos server-side (CAPI) não disparam */}
            {!accessToken.trim() && !pixel?.hasToken && (
              <span className="rounded-md bg-[color:var(--warning)]/10 px-2 py-1.5 text-[11px] text-[color:var(--warning)] text-pretty">
                Sem o Access Token, os eventos server-side (Events API) não disparam — o pixel só
                funciona no navegador. Gere o token no TikTok Events Manager.
              </span>
            )}
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Test Event Code (opcional)</span>
            <input
              className={inputCls}
              value={testEventCode}
              onChange={(e) => setTestEventCode(e.target.value)}
              placeholder="TEST12345"
              autoComplete="off"
            />
            {/* Item 94: o que é o testEventCode e onde encontrá-lo */}
            <span className="text-[11px] text-muted-foreground text-pretty">
              Com esse código, os disparos aparecem na aba{' '}
              <a
                href="https://ads.tiktok.com/help/article/events-api-test-events"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-brand-cyan hover:underline"
              >
                Eventos de teste
              </a>{' '}
              do TikTok Events Manager, sem contaminar os dados reais. Pegue o código lá e remova
              quando for ao ar.
            </span>
          </label>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-xs font-medium text-muted-foreground">Eventos disparados</legend>
            <div className="flex flex-wrap gap-2">
              {EVENT_LABELS.map(({ key, label }) => (
                <label
                  key={key}
                  className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                    events[key]
                      ? 'border-brand-cyan/50 bg-brand-cyan/10 text-brand-cyan'
                      : 'border-border text-muted-foreground'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={events[key]}
                    onChange={() => setEvents((prev) => ({ ...prev, [key]: !prev[key] }))}
                  />
                  {events[key] ? <Check className="size-3" aria-hidden="true" /> : null}
                  {label}
                </label>
              ))}
            </div>
          </fieldset>

          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={active} onChange={() => setActive((v) => !v)} className="accent-brand-cyan" />
            Pixel ativo
          </label>

          {error && (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="rounded-lg bg-brand-cyan px-4 py-2 text-sm font-semibold text-black shadow-[var(--glow-cyan-soft)] transition-all hover:-translate-y-px hover:shadow-[var(--glow-cyan)] hover:brightness-105 active:scale-[0.98] disabled:opacity-50 disabled:shadow-none"
            >
              {saving ? 'Salvando…' : pixel ? 'Salvar alterações' : 'Criar pixel'}
            </button>
          </div>
        </div>
      </GlassCard>
    </div>
  )
}
