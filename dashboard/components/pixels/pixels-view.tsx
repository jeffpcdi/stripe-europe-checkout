'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { Switch } from '@/components/ui/switch'
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
  ClipboardPaste,
  Code2,
  ShieldCheck,
  ExternalLink,
  Globe2,
  Activity,
  Waypoints,
  CreditCard,
} from 'lucide-react'
import {
  usePixels,
  usePixelHealth,
  usePixelLog,
  usePixelDurability,
  useEmqTrend,
  useGateways,
  apiSend,
  ApiError,
} from '@/lib/api'
import type { Pixel, PixelEvents, PixelTestResult, PixelEmqTrend } from '@/lib/types'
import { GlassCard } from '@/components/glass-card'
import { StatusBadge } from '@/components/status-badge'
import { Skeleton } from '@/components/skeleton'
import { ErrorState } from '@/components/error-state'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { SectionTitle } from '@/components/section-title'
import { timeAgo } from '@/lib/format'
import { toast } from '@/lib/toast'
import { readClipboardText } from '@/lib/clipboard'
import { useConfirm } from '@/lib/use-confirm'
import { cn } from '@/lib/utils'
import { useModalA11y } from '@/lib/use-modal-a11y'

// Resultado da verificação de instalação por URL (server-side)
type UrlCheck = {
  ok: boolean
  url?: string
  algumInstalado?: boolean
  /** O /t.js (rastreamento da dashboard) está na página? Sem ele a visita não aparece no funil. */
  trackerOk?: boolean
  trackerStaticOk?: boolean
  runtimeSeen?: boolean
  legacyTracker?: boolean
  pixels?: {
    slug: string
    name: string
    scriptOk: boolean
    nativeOk: boolean
    trackerScoped?: boolean
    runtimeSeen?: boolean
    lastSeenAt?: string | null
    runtimeVisits?: number
    instalado: boolean
  }[]
  error?: string
}

// Removed PIXEL_STEPS

// Rótulos PT-BR dos eventos CAPI — mesma ordem do funil real
const EVENT_LABELS: { key: keyof PixelEvents; label: string }[] = [
  { key: 'ViewContent', label: 'Visita' },
  { key: 'AddToCart', label: 'Carrinho' },
  { key: 'InitiateCheckout', label: 'Checkout' },
  { key: 'AddPaymentInfo', label: 'Pagamento' },
  { key: 'CompletePayment', label: 'Compra' },
]

function isPixelErrorStatus(status: string) {
  return status === 'erro' || status === 'error'
}

export function PixelsView() {
  const { data, mutate, isLoading, error } = usePixels()
  const { data: health } = usePixelHealth()
  const { data: log, mutate: mutateLog } = usePixelLog()
  const { data: durability } = usePixelDurability()
  const { data: emqTrend } = useEmqTrend()
  // Vínculo pixel↔gateway: nomes dos gateways para exibir o selo no card
  const { data: gwData } = useGateways()
  const gatewayNameById = new Map((gwData?.gateways ?? []).map((g) => [g.id, g.name]))

  // Filtros do log de disparos (item 81) e linha expandida (item 82)
  const [logPixel, setLogPixel] = useState('')
  const [logEvent, setLogEvent] = useState('')
  const [logStatus, setLogStatus] = useState('')
  const [expandedLog, setExpandedLog] = useState<string | null>(null)
  // Item 233: paginação incremental do log (50 por vez — o log pode ter 500 linhas)
  const [logShown, setLogShown] = useState(50)
  const [copiedEventId, setCopiedEventId] = useState<string | null>(null)

  const [editing, setEditing] = useState<Pixel | null>(null)
  const [installing, setInstalling] = useState<Pixel | null>(null)
  const [creating, setCreating] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [testing, setTesting] = useState<string | null>(null)
  // A6.4: etapa atual do teste de disparo — 'send' (enviando) → 'wait' (TikTok processando)
  const [testStage, setTestStage] = useState<'send' | 'wait'>('send')
  const [testResult, setTestResult] = useState<{ slug: string; ok: boolean; msg: string } | null>(null)
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
          const result = await apiSend<{ ok: boolean; warning?: string | null }>(
            `/api/pixels/${encodeURIComponent(p.slug)}`,
            'DELETE',
          )
          await mutate(
            (current) => current
              ? { ...current, pixels: current.pixels.filter((pixel) => pixel.slug !== p.slug) }
              : current,
          )
          if (result.warning) toast.info(`Pixel "${p.name}" removido`, { hint: result.warning })
          else toast.success(`Pixel "${p.name}" removido`)
        } catch (error) {
          toast.error(
            error instanceof Error ? error.message : 'Não foi possível remover o pixel',
            { hint: error instanceof ApiError ? error.hint : 'Tente novamente em instantes.' },
          )
          return false
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
      gatewayIds: p.gatewayIds ?? [],
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
    const event: keyof PixelEvents = 'ViewContent'
    setTesting(p.slug)
    setTestStage('send')
    setTestResult(null)
    // A6.4: após o envio sair, a etapa vira "aguardando resposta do TikTok"
    const stageTimer = setTimeout(() => setTestStage('wait'), 500)
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
      clearTimeout(stageTimer)
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
    <div className="project-page project-page--pixels flex flex-col gap-5">
      {/* Item 55/93: anúncio acessível das cópias (fora de tela, polido) */}
      <span className="sr-only" role="status" aria-live="polite">
        {copyAnnounce}
      </span>
      {/* Item 51: cabeçalho de saúde consolidado. "Durável" = há uma camada de
          persistência disponível (banco OU Redis); é a capacidade que garante que
          a config sobrevive a um restart, independente de já ter havido gravação. */}
      {/* Config durável removida do painel do usuário final */}

      {/* Diagnóstico: por que a config pode não estar chegando ao pixel */}
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
        {/* Pixels cadastrados */}
        <GlassCard className="min-w-0 p-5">
          <div className="mb-4">
            <div className="flex items-center justify-between gap-2">
              <SectionTitle>Pixels TikTok</SectionTitle>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  data-tour="pixels-new"
                  onClick={() => setCreating(true)}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-xs font-semibold text-background transition-all hover:opacity-90 active:scale-[0.98]"
                >
                  <Plus className="size-3.5" /> Novo pixel
                </button>
              </div>
            </div>
          </div>

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
              </div>
            </div>
          ) : (
            <ul className="flex flex-col gap-2" data-tour="pixels-list">
              {pixels.map((p, index) => {
                // A6.1/A6.2: disparos deste pixel no log (para o anel de saúde
                // e a timeline de dots) — o log identifica por nome/slug/código
                const pixelRows = (log?.log ?? []).filter(
                  (r) => r.pixel === p.name || r.pixel === p.slug || r.pixel === p.pixelCode,
                )
                const pixelRate =
                  pixelRows.length > 0
                    ? (pixelRows.filter((r) => r.status === 'ok').length / pixelRows.length) * 100
                    : null
                // Presença de token não significa credencial válida. O último
                // retorno real da Events API é a evidência: sucesso valida;
                // uma rejeição explícita pede troca do token.
                const latestApiRow = pixelRows.find((r) => r.status === 'ok' || isPixelErrorStatus(r.status))
                const latestApiMessage = String(latestApiRow?.response?.message ?? '').toLowerCase()
                const tokenRejected = !!latestApiRow && isPixelErrorStatus(latestApiRow.status)
                  && /access token|unauthori[sz]ed|revoked/.test(latestApiMessage)
                const tokenValidated = latestApiRow?.status === 'ok'
                return (
                <li
                  key={p.slug}
                  style={{ animationDelay: `${Math.min(index * 75, 1500)}ms` }}
                  className={cn(
                    "rounded-xl border bg-secondary/30 p-4.5 transition-all duration-300 hover:border-brand-cyan/30 hover:bg-secondary/50 hover:shadow-[0_8px_24px_-6px_rgba(0,0,0,0.4)] animate-in fade-in slide-in-from-bottom-3 fill-mode-both",
                    p.active ? "border-border/80" : "border-border/50 opacity-75"
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      {/* A6.1: anel SVG de saúde (verde/âmbar/vermelho) em volta
                          do ícone, proporcional à taxa de sucesso dos disparos */}
                      <span className="relative flex size-9 shrink-0 items-center justify-center" aria-hidden="true">
                        <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90">
                          <circle cx="18" cy="18" r="16" fill="none" stroke="var(--border)" strokeWidth="2.5" />
                          {pixelRate != null && (
                            <circle
                              cx="18"
                              cy="18"
                              r="16"
                              fill="none"
                              stroke={
                                pixelRate >= 90
                                  ? 'var(--success)'
                                  : pixelRate >= 60
                                    ? 'var(--warning)'
                                    : 'var(--error)'
                              }
                              strokeWidth="2.5"
                              strokeLinecap="round"
                              strokeDasharray={`${(pixelRate / 100) * 100.5} 100.5`}
                              className="transition-[stroke-dasharray] duration-600 ease-out"
                            />
                          )}
                        </svg>
                        <span className="flex size-6 items-center justify-center rounded-full bg-brand-cyan/15 text-brand-cyan">
                          <Target className="size-3.5" />
                        </span>
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
                      <Switch
                        checked={p.active}
                        onChange={() => handleToggleActive(p)}
                        label={p.active ? `Pausar pixel ${p.name}` : `Ativar pixel ${p.name}`}
                      />
                      <StatusBadge status={p.active ? 'success' : 'neutral'} dot={p.active}>
                        {p.active ? 'ativo' : 'pausado'}
                      </StatusBadge>
                      {tokenRejected ? (
                        <StatusBadge status="error">token rejeitado</StatusBadge>
                      ) : tokenValidated ? (
                        <StatusBadge status="success">token validado</StatusBadge>
                      ) : p.hasToken ? (
                        <StatusBadge status="info">token salvo</StatusBadge>
                      ) : (
                        <StatusBadge status="warning">sem token</StatusBadge>
                      )}
                    </div>
                  </div>

                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {EVENT_LABELS.filter(({ key }) => p.events?.[key]).length} eventos ligados
                    {pixelRows[0] ? ` · último disparo ${timeAgo(pixelRows[0].at)}` : ' · nenhum disparo ainda'}
                    {pixelRate != null ? ` · ${pixelRate.toFixed(0)}% aceitos` : ''}
                  </p>
                  {(p.gatewayIds?.length ?? 0) > 0 && (
                    <p className="mt-1 truncate text-[11px] text-muted-foreground">
                      Gateway: {(p.gatewayIds ?? []).map((id) => gatewayNameById.get(id) ?? id).join(', ')}
                    </p>
                  )}

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

                  {tokenRejected && (
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-error/10 px-3 py-2 text-xs text-error">
                      <span className="flex min-w-0 items-start gap-2 text-pretty">
                        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                        O TikTok rejeitou o Access Token mais recente. Gere outro no Events Manager e atualize este pixel.
                      </span>
                      <button type="button" onClick={() => setEditing(p)} className="shrink-0 font-semibold underline underline-offset-2">
                        Atualizar token
                      </button>
                    </div>
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
                          <Link href="/conversions?tab=gateways" className="font-semibold text-brand-cyan hover:underline">
                            Conectar gateway
                          </Link>
                        </span>
                      </p>
                    )}

                  {/* A6.4: progresso do teste em etapas — Enviando → TikTok
                      respondendo, com check por etapa concluída */}
                  {testing === p.slug && (
                    <div
                      className="mt-2 flex items-center gap-3 rounded-lg bg-secondary/60 px-3 py-2 text-xs text-muted-foreground"
                      role="status"
                      aria-live="polite"
                    >
                      <span className="flex items-center gap-1.5">
                        {testStage === 'send' ? (
                          <Loader2 className="size-3.5 animate-spin text-brand-cyan" aria-hidden="true" />
                        ) : (
                          <CircleCheck className="size-3.5 text-success" aria-hidden="true" />
                        )}
                        Enviando evento
                      </span>
                      <span className="text-faint" aria-hidden="true">→</span>
                      <span className={`flex items-center gap-1.5 ${testStage === 'send' ? 'opacity-40' : ''}`}>
                        {testStage === 'wait' ? (
                          <Loader2 className="size-3.5 animate-spin text-brand-cyan" aria-hidden="true" />
                        ) : (
                          <span className="size-3.5 rounded-full border border-border" aria-hidden="true" />
                        )}
                        TikTok respondendo…
                      </span>
                    </div>
                  )}

                  {testResult?.slug === p.slug && (
                    <p
                      className={`mt-2 flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${
                        testResult.ok
                          ? 'bg-[var(--success-light)] text-success'
                          : 'bg-destructive/10 text-destructive border border-destructive/20'
                      }`}
                      role="status"
                    >
                      {testResult.ok ? <CircleCheck className="size-3.5" /> : <CircleX className="size-3.5" />}
                      {testResult.msg}
                    </p>
                  )}

                  <div className="mt-3 flex flex-wrap items-center justify-end gap-1 border-t border-border pt-3">
                    {p.scriptTag && (
                      <button type="button" onClick={() => setInstalling(p)} className="mr-auto flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-brand-cyan hover:bg-brand-cyan/10">
                        <Code2 className="size-3.5" aria-hidden="true" /> Instalar
                      </button>
                    )}
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
                      onClick={() => setEditing(p)}
                      className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                    >
                      <Pencil className="size-3.5" /> Editar
                    </button>
                    <details className="group relative">
                      <summary className="flex cursor-pointer list-none items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground">
                        Mais <ChevronDown className="size-3 transition-transform group-open:rotate-180" aria-hidden="true" />
                      </summary>
                      <div className="absolute bottom-full right-0 z-20 mb-1 flex w-40 flex-col rounded-lg border border-border bg-popover p-1 shadow-xl">
                        <button
                          type="button"
                          onClick={() => handleDuplicate(p)}
                          title="Clona sem o Access Token"
                          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
                        >
                          <CopyPlus className="size-3.5" /> Duplicar pixel
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(p)}
                          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                        >
                          <Trash2 className="size-3.5" /> Remover pixel
                        </button>
                      </div>
                    </details>
                  </div>
                </li>
                )
              })}
            </ul>
          )}
        </GlassCard>

        {/* Verificar instalação + saúde da CAPI + log de disparos */}
        <div className="flex min-w-0 flex-col gap-5">
          <GlassCard className="p-5" data-tour="pixels-verify">
            <div className="mb-4">
              <SectionTitle>Verificar instalação</SectionTitle>
            </div>
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
                          ? urlCheck.runtimeSeen
                            ? 'Execução confirmada: esta página já enviou dados para a dashboard.'
                            : 'Código completo encontrado. Abra a página uma vez para confirmar a execução.'
                          : 'Nenhum pixel seu foi encontrado nessa página. Cole o bloco logo após <body> e tente de novo.'}
                      </span>
                    </p>
                    {/* O caso mais confuso: pixel ok mas SEM o /t.js — os eventos vão
                        ao TikTok, mas a visita não aparece na dashboard. Aviso dedicado. */}
                    {urlCheck.trackerOk === false && (
                      <p className="flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
                        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                        <span className="text-pretty">
                          O script de <strong>Rastreamento</strong> (<code>/t.js</code>) não está nessa página —
                          por isso as visitas <strong>não aparecem na sua dashboard</strong> (funil, leads).
                          Copie o bloco completo do pixel (a parte 1 é o rastreamento) e cole logo após{' '}
                          <code>{'<body>'}</code>.
                        </span>
                      </p>
                    )}
                    {urlCheck.legacyTracker && (
                      <p className="flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
                        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                        <span className="text-pretty">
                          Foi encontrado um <code>/t.js</code> antigo, sem o token <code>?px=...</code>. Ele registra a jornada, mas não identifica com segurança qual pixel deve receber a CAPI. Substitua pelo bloco atual de instalação.
                        </span>
                      </p>
                    )}
                    {urlCheck.trackerOk === true && (
                      <p className="flex items-center justify-between gap-2 rounded-lg bg-secondary/50 px-3 py-1.5 text-[11px]">
                        <span className="truncate font-medium text-foreground">Rastreamento da dashboard (/t.js)</span>
                        <span className="shrink-0 font-mono text-success">
                          {urlCheck.runtimeSeen && !urlCheck.trackerStaticOk ? 'execução confirmada' : 'instalado'}
                        </span>
                      </p>
                    )}
                    {(urlCheck.pixels ?? []).map((p) => (
                      <p key={p.slug} className="flex items-center justify-between gap-2 rounded-lg bg-secondary/50 px-3 py-1.5 text-[11px]">
                        <span className="truncate font-medium text-foreground">{p.name}</span>
                        <span className={`shrink-0 font-mono ${p.instalado ? 'text-success' : 'text-muted-foreground'}`}>
                          {p.instalado
                            ? p.runtimeSeen
                              ? `executou ${p.lastSeenAt ? timeAgo(p.lastSeenAt) : 'recentemente'}`
                              : 'código completo encontrado'
                            : p.scriptOk
                              ? 'falta rastreador vinculado'
                              : p.nativeOk
                                ? 'somente pixel nativo'
                                : 'não encontrado'}
                        </span>
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </GlassCard>

          <details className="group rounded-xl border border-border bg-card">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-xs font-semibold text-foreground">
              Diagnóstico avançado
              <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <div className="flex flex-col gap-5 border-t border-border p-3">
          <GlassCard className="p-5" data-tour="pixels-health">
            <div className="mb-4">
              <SectionTitle>Saúde dos disparos</SectionTitle>
            </div>
            {!health ? (
              <Skeleton className="h-16" />
            ) : health.total === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">Nenhum disparo nas últimas 24h.</p>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3">
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
                    </span>
                  </div>
                  {/* A6.3: EMQ como gauge semicircular 0–10 com faixa de cor */}
                  {health.emq != null && <EmqGauge value={health.emq} />}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Janela móvel de 24h; falhas antigas saem desta taxa automaticamente.
                </p>
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

          {(health?.coverage?.length ?? 0) > 0 && (
            <GlassCard className="p-5">
              <div className="mb-4">
                <SectionTitle>Cobertura real</SectionTitle>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Execução observada por hospedagem, não apenas código encontrado no HTML.
                </p>
              </div>
              <div className="flex flex-col gap-2">
                {(health?.coverage ?? []).map((item) => {
                  const healthy = item.status === 'saudavel'
                  const attention = item.status === 'atencao'
                  return (
                    <details key={item.slug} className="group rounded-xl border border-border bg-secondary/25 px-3 py-2.5">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                        <span className="flex min-w-0 items-center gap-2.5">
                          <span
                            className={`size-2 shrink-0 rounded-full ${
                              healthy ? 'bg-success' : attention ? 'bg-error' : item.status === 'pausado' ? 'bg-muted-foreground' : 'bg-warning'
                            }`}
                            aria-hidden="true"
                          />
                          <span className="min-w-0">
                            <span className="block truncate text-xs font-semibold text-foreground">{item.name}</span>
                            <span className="block truncate text-[10px] text-muted-foreground">
                              {item.domains.length > 0
                                ? `${item.domains.length} ${item.domains.length === 1 ? 'hospedagem ativa' : 'hospedagens ativas'}`
                                : 'nenhuma hospedagem observada'}
                            </span>
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-3 text-[10px] text-muted-foreground">
                          <span title="Última execução do navegador" className="flex items-center gap-1">
                            <Activity className="size-3 text-brand-cyan" aria-hidden="true" />
                            {item.lastBrowserAt ? timeAgo(item.lastBrowserAt) : '—'}
                          </span>
                          <span title="Última resposta da CAPI" className="flex items-center gap-1">
                            <Waypoints className="size-3 text-brand-pink" aria-hidden="true" />
                            {item.lastCapiAt ? timeAgo(item.lastCapiAt) : '—'}
                          </span>
                          <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
                        </span>
                      </summary>
                      <div className="mt-3 border-t border-border/70 pt-3">
                        {item.domains.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {item.domains.map((domain) => (
                              <span key={domain.host} className="inline-flex items-center gap-1 rounded-md bg-input px-2 py-1 text-[10px] text-foreground">
                                <Globe2 className="size-3 text-brand-cyan" aria-hidden="true" />
                                {domain.host}
                                <span className="text-muted-foreground">· {domain.visits}</span>
                              </span>
                            ))}
                          </div>
                        )}
                        <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
                          {[
                            ['ttclid', item.signals.ttclid],
                            ['e-mail', item.signals.email],
                            ['telefone', item.signals.phone],
                            ['_ttp', item.signals.ttp],
                          ].map(([label, value]) => (
                            <span key={String(label)} className="rounded-md border border-border px-2 py-1 text-muted-foreground">
                              {label}: <strong className="font-mono text-foreground">{value == null ? '—' : `${value}%`}</strong>
                            </span>
                          ))}
                        </div>
                        {item.recommendations[0] && (
                          <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-warning">
                            <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                            {item.recommendations[0]}
                          </p>
                        )}
                      </div>
                    </details>
                  )
                })}
              </div>
            </GlassCard>
          )}

          {/* Tendência de EMQ (item 79): o backend já calcula, mas nada exibia.
              Sparkline por pixel + alerta de EMQ baixo ou em queda. */}
          {emqTrend && emqTrend.pixels.some((p) => p.trend.length > 0) && (
            <GlassCard className="p-5">
              <div className="mb-4">
                <SectionTitle>Qualidade do match (EMQ)</SectionTitle>
              </div>
              <div className="flex flex-col gap-4">
                {emqTrend.pixels
                  .filter((p) => p.trend.length > 0)
                  .map((p) => (
                    <EmqSparkline key={p.pixelCode} pixel={p} />
                  ))}
              </div>
            </GlassCard>
          )}

      {/* V2-91: log de disparos com scanline ciano "ao vivo" */}
      <GlassCard className="scan-live p-5">
        <div className="mb-4">
          <SectionTitle>Disparos recentes</SectionTitle>
        </div>
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
                        ? r.status !== 'ok' && !isPixelErrorStatus(r.status)
                        : logStatus === 'erro'
                          ? isPixelErrorStatus(r.status)
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
                        <option value="erro">Erro</option>
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
                            <li key={key} className="rounded-lg text-xs hover:bg-white/[.04] even:bg-white/[.02] transition-colors">
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
                                        : isPixelErrorStatus(row.status)
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
          </details>
        </div>
      </div>

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
            if (warning) toast.info('Pixel salvo com aviso', { hint: warning, duration: 7000 })
            else toast.success('Pixel salvo')
          }}
        />
      )}

      {installing && (
        <PixelInstallModal
          pixel={installing}
          onClose={() => setInstalling(null)}
          onCopy={(code) => handleCopy(`${installing.slug}:modal`, code, 'Código de instalação')}
          copied={copied === `${installing.slug}:modal`}
        />
      )}

      <ConfirmDialog {...dialogProps} />
    </div>
  )
}

function cleanInstallCode(code?: string | null) {
  return (code ?? '').replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*[\r\n]/gm, '').trim()
}

function PixelInstallModal({
  pixel,
  onClose,
  onCopy,
  copied,
}: {
  pixel: Pixel
  onClose: () => void
  onCopy: (code: string) => void
  copied: boolean
}) {
  const pixelUrl = pixel.scriptUrl || (pixel.token ? `/px/${pixel.token}.js` : '')
  const singleTagCode = pixelUrl ? `<script src="${pixelUrl}" defer></script>` : cleanInstallCode(pixel.scriptTag)
  const dialogRef = useRef<HTMLDivElement>(null)
  useModalA11y(true, dialogRef, onClose)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/75 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label={`Instalar script de ${pixel.name}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <GlassCard ref={dialogRef} tabIndex={-1} variant="thick" className="w-full max-w-lg p-0 outline-none overflow-hidden border-border/80 shadow-2xl">
        <div className="flex items-center justify-between border-b border-border/60 px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-brand-cyan/15 text-brand-cyan">
              <Code2 className="size-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">{pixel.name}</h2>
              <p className="font-mono text-xs text-muted-foreground">
                Pixel Code: <span className="text-foreground">{pixel.pixelCode}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <CircleX className="size-5" />
          </button>
        </div>

        <div className="flex flex-col gap-4 p-6">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Script de Rastreamento (Tag &lt;head&gt;)
            </span>
            <span className="rounded-full bg-brand-cyan/10 px-2.5 py-0.5 text-[11px] font-medium text-brand-cyan">
              Apenas 1 linha
            </span>
          </div>

          <div className="relative rounded-xl border border-border/80 bg-black/60 p-4 font-mono text-xs leading-relaxed text-foreground break-all select-all">
            {singleTagCode}
          </div>

          <button
            type="button"
            onClick={() => onCopy(singleTagCode)}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-cyan py-3 px-4 text-sm font-bold text-black shadow-[0_0_20px_rgba(37,244,238,0.3)] transition-all hover:brightness-110 active:scale-[0.99]"
          >
            {copied ? (
              <>
                <Check className="size-4" />
                Script Copiado!
              </>
            ) : (
              <>
                <Copy className="size-4" />
                Copiar Script
              </>
            )}
          </button>

          <p className="text-center text-xs text-muted-foreground text-pretty">
            Cole esta linha dentro da tag <code className="rounded bg-secondary/80 px-1 py-0.5 text-foreground font-mono">&lt;head&gt;</code> da sua página ou landing page. O rastreamento de visitas, cliques e conexão com a CAPI é feito automaticamente.
          </p>
        </div>

        <div className="border-t border-border/50 bg-secondary/20 px-6 py-3.5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            Fechar
          </button>
        </div>
      </GlassCard>
    </div>
  )
}

// ── A6.3: gauge semicircular de EMQ (escala 0–10) ─────────────────────
// Arco de fundo + arco de valor com cor semântica (verde ≥7, âmbar ≥5,
// vermelho abaixo). O arco anima via transição de stroke-dasharray.
function EmqGauge({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(10, value))
  // Semicírculo r=20: comprimento do arco = π·r ≈ 62.8
  const arcLen = Math.PI * 20
  const filled = (clamped / 10) * arcLen
  const color = clamped >= 7 ? 'var(--success)' : clamped >= 5 ? 'var(--warning)' : 'var(--error)'
  return (
    <div
      className="flex flex-col items-center"
      role="img"
      aria-label={`EMQ ${clamped.toFixed(1)} de 10`}
      title="Event Match Quality médio (0–10)"
    >
      <svg viewBox="0 0 48 28" className="h-7 w-12">
        <path
          d="M 4 24 A 20 20 0 0 1 44 24"
          fill="none"
          stroke="var(--border)"
          strokeWidth="3.5"
          strokeLinecap="round"
        />
        <path
          d="M 4 24 A 20 20 0 0 1 44 24"
          fill="none"
          stroke={color}
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${arcLen}`}
          className="transition-[stroke-dasharray] duration-600 ease-out"
        />
        <text
          x="24"
          y="24"
          textAnchor="middle"
          className="fill-foreground font-mono text-[9px] font-bold tabular-nums"
        >
          {clamped.toFixed(1)}
        </text>
      </svg>
      <span className="text-[9px] uppercase tracking-wider text-faint">EMQ</span>
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

// Botão "Colar" explícito — dentro de iframes (preview do v0, embeds) o
// Ctrl+V / menu de contexto nem sempre chega ao input, então os campos de
// código/token oferecem colagem via clipboard API, que pede permissão ao
// usuário na primeira vez. Fora de iframe continua funcionando igual.
function PasteButton({ label, onPaste }: { label: string; onPaste: (text: string) => void }) {
  return (
    <button
      type="button"
      aria-label={`Colar ${label} da área de transferência`}
      title={`Colar ${label} da área de transferência`}
      onClick={async () => {
        const text = await readClipboardText()
        if (text && text.trim()) {
          onPaste(text.trim())
          toast.info('Colado')
        } else {
          toast.error('Não consegui ler a área de transferência', {
            hint: 'Permita o acesso quando o navegador pedir, ou cole com Ctrl+V no campo.',
          })
        }
      }}
      className="absolute inset-y-0 right-2 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
    >
      <ClipboardPaste className="size-3.5" aria-hidden="true" />
      Colar
    </button>
  )
}

// ── Editor inline (modal) — cria ou edita um pixel ────────────────────
// ── Editor inline (modal) — Pixel Auto-Bind ────────────────────
function PixelEditor({
  pixel,
  onClose,
  onSaved,
}: {
  pixel: Pixel | null
  onClose: () => void
  onSaved: (warning?: string | null) => void
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  useModalA11y(true, dialogRef, onClose)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState(pixel?.name ?? '')
  const [pixelCode, setPixelCode] = useState(pixel?.pixelCode ?? '')
  const [accessToken, setAccessToken] = useState(pixel?.accessToken ?? '')
  const [showToken, setShowToken] = useState(false)
  const [active, setActive] = useState(pixel?.active ?? true)
  const [events] = useState<PixelEvents>(
    pixel?.events ?? {
      ViewContent: true,
      AddToCart: true,
      InitiateCheckout: true,
      AddPaymentInfo: true,
      CompletePayment: true,
    },
  )

  const { data: gwData, mutate: mutateGateways } = useGateways()
  const gateways = gwData?.gateways ?? []
  const [gatewayIds, setGatewayIds] = useState<string[]>(pixel?.gatewayIds ?? [])

  // Criação rápida de gateway inline caso o usuário ainda não tenha
  const [showAddGateway, setShowAddGateway] = useState(false)
  const [newGwProvider, setNewGwProvider] = useState('kiwify')
  const [newGwName, setNewGwName] = useState('')
  const [creatingGw, setCreatingGw] = useState(false)

  function toggleGateway(id: string) {
    setGatewayIds((prev) => (prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]))
  }

  async function handleCreateInlineGateway() {
    if (creatingGw) return
    setCreatingGw(true)
    setError(null)
    try {
      const providerLabel = gwData?.providers?.find((p) => p.id === newGwProvider)?.label || newGwProvider
      const gwNameToUse = newGwName.trim() || providerLabel
      const res = await apiSend<{ ok: boolean; gateway: { id: string; name: string } }>('/api/gateways', 'POST', {
        name: gwNameToUse,
        provider: newGwProvider,
      })
      if (res.gateway?.id) {
        setGatewayIds((prev) => [...prev, res.gateway.id])
        await mutateGateways()
        setShowAddGateway(false)
        setNewGwName('')
        toast.success(`Gateway ${res.gateway.name} criado e vinculado`)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao criar gateway')
    } finally {
      setCreatingGw(false)
    }
  }

  async function handleSave() {
    const cleanName = name.trim()
    const cleanCode = pixelCode.trim()
    if (!cleanName) {
      setError('Informe um nome para o pixel')
      return
    }
    if (!cleanCode) {
      setError('Informe o Pixel Code do TikTok Ads (20 dígitos)')
      return
    }

    setSaving(true)
    setError(null)

    try {
      const r = await apiSend<{ ok: boolean; durable?: boolean; warning?: string | null }>('/api/pixels', 'POST', {
        slug: pixel?.slug,
        name: cleanName,
        pixelCode: cleanCode,
        accessToken: accessToken.trim() || undefined,
        active,
        events,
        gatewayIds,
      })
      onSaved(r.warning)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar o pixel')
      setSaving(false)
    }
  }

  const inputCls =
    'w-full rounded-xl border border-border/80 bg-input px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-brand-cyan/60 focus:ring-1 focus:ring-brand-cyan/40 transition-all'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/75 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label={pixel ? `Editar pixel ${pixel.name}` : 'Criar novo pixel TikTok'}
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose()
      }}
    >
      <GlassCard ref={dialogRef} tabIndex={-1} variant="thick" className="w-full max-w-lg p-0 outline-none overflow-hidden border-border/80 shadow-2xl">
        <div className="flex items-center justify-between border-b border-border/60 px-6 py-5">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              {pixel ? `Editar Pixel: ${pixel.name}` : 'Novo Pixel TikTok & Gateway'}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Configure seu pixel e sincronize com seu gateway de checkout.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <CircleX className="size-5" />
          </button>
        </div>

        <div className="flex flex-col gap-4.5 p-6 max-h-[80vh] overflow-y-auto">
          {/* Nome do Pixel */}
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-foreground">Nome do Pixel</span>
            <input
              className={inputCls}
              placeholder="ex: Produto Principal, Oferta iPhone"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={saving}
            />
          </label>

          {/* Pixel Code */}
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-foreground">Pixel Code (TikTok Ads)</span>
            <input
              className={`${inputCls} font-mono`}
              placeholder="ex: D3VA453C77U53GC01N70"
              value={pixelCode}
              onChange={(e) => setPixelCode(e.target.value)}
              disabled={saving}
            />
            <span className="text-[11px] text-muted-foreground">
              Código de identificação do pixel gerado no Gerenciador de Eventos do TikTok.
            </span>
          </label>

          {/* Access Token CAPI */}
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-foreground">Access Token da CAPI (Opcional se usar só navegador)</span>
            <div className="relative">
              <input
                type={showToken ? 'text' : 'password'}
                className={`${inputCls} font-mono pr-20`}
                placeholder="Cole o Access Token gerado no TikTok Events Manager"
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                disabled={saving}
              />
              <div className="absolute inset-y-0 right-2 flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setShowToken((v) => !v)}
                  className="p-1 text-muted-foreground hover:text-foreground"
                  title={showToken ? 'Ocultar' : 'Mostrar'}
                >
                  {showToken ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
                <PasteButton label="Access Token" onPaste={(val) => setAccessToken(val)} />
              </div>
            </div>
            <span className="text-[11px] text-muted-foreground">
              Necessário para que as compras confirmadas no checkout disparem via servidor (CAPI).
            </span>
          </label>

          {/* Sincronização de Gateway */}
          <div className="rounded-xl border border-border/80 bg-secondary/20 p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <CreditCard className="size-3.5 text-brand-cyan" />
                  Sincronizar Gateway de Pagamento
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Selecione o checkout que processa as vendas deste produto:
                </p>
              </div>
              {!showAddGateway && (
                <button
                  type="button"
                  onClick={() => setShowAddGateway(true)}
                  className="text-[11px] font-semibold text-brand-cyan hover:underline"
                >
                  + Conectar outro
                </button>
              )}
            </div>

            {gateways.length === 0 && !showAddGateway ? (
              <div className="flex flex-col items-center justify-center p-3 rounded-lg border border-dashed border-border text-center">
                <p className="text-xs text-muted-foreground">Nenhum checkout cadastrado ainda.</p>
                <button
                  type="button"
                  onClick={() => setShowAddGateway(true)}
                  className="mt-2 rounded-lg bg-secondary px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-secondary/70"
                >
                  + Conectar Checkout (Kiwify, Hotmart, etc.)
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {gateways.map((g) => {
                  const isChecked = gatewayIds.includes(g.id)
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => toggleGateway(g.id)}
                      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-all ${
                        isChecked
                          ? 'border-brand-cyan/60 bg-brand-cyan/15 text-foreground shadow-xs'
                          : 'border-border/80 bg-secondary/40 text-muted-foreground hover:border-border hover:text-foreground'
                      }`}
                    >
                      <span
                        className={`flex size-4 items-center justify-center rounded border ${
                          isChecked ? 'border-brand-cyan bg-brand-cyan text-black' : 'border-border'
                        }`}
                      >
                        {isChecked && <Check className="size-3 stroke-[3]" />}
                      </span>
                      <span>{g.name}</span>
                      <span className="text-[10px] text-muted-foreground uppercase">({g.provider})</span>
                    </button>
                  )
                })}
              </div>
            )}

            {/* Inline Add Gateway */}
            {showAddGateway && (
              <div className="mt-2 rounded-lg border border-border/80 bg-input/80 p-3 flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-foreground">Novo Gateway</span>
                  <button
                    type="button"
                    onClick={() => setShowAddGateway(false)}
                    className="text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    Cancelar
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] text-muted-foreground">Plataforma</span>
                    <select
                      value={newGwProvider}
                      onChange={(e) => setNewGwProvider(e.target.value)}
                      className="rounded-lg border border-border bg-secondary px-2.5 py-1.5 text-xs text-foreground"
                    >
                      <option value="kiwify">Kiwify</option>
                      <option value="hotmart">Hotmart</option>
                      <option value="perfectpay">PerfectPay</option>
                      <option value="cakto">Cakto</option>
                      <option value="stripe">Stripe</option>
                      <option value="vega">Vega Checkout</option>
                      <option value="adoorei">Adoorei</option>
                      <option value="payt">PayT</option>
                      <option value="generic">Outro / Genérico</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] text-muted-foreground">Identificação (opcional)</span>
                    <input
                      type="text"
                      placeholder="ex: Kiwify Principal"
                      value={newGwName}
                      onChange={(e) => setNewGwName(e.target.value)}
                      className="rounded-lg border border-border bg-secondary px-2.5 py-1.5 text-xs text-foreground"
                    />
                  </label>
                </div>
                <button
                  type="button"
                  onClick={handleCreateInlineGateway}
                  disabled={creatingGw}
                  className="self-end rounded-lg bg-foreground px-3 py-1.5 text-xs font-semibold text-background hover:opacity-90 disabled:opacity-50"
                >
                  {creatingGw ? 'Criando…' : 'Criar e Vincular ao Pixel'}
                </button>
              </div>
            )}
          </div>

          {/* Ativo switch */}
          <label className="flex items-center justify-between rounded-xl border border-border/60 bg-secondary/20 p-3">
            <span className="text-xs font-medium text-foreground">Pixel ativo para disparos</span>
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="size-4 accent-brand-cyan rounded cursor-pointer"
            />
          </label>

          {error && (
            <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-xs text-destructive">
              {error}
            </p>
          )}
        </div>

        {/* Rodapé */}
        <div className="flex items-center justify-end gap-2.5 border-t border-border/60 bg-secondary/20 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-xl px-4 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 rounded-xl bg-brand-cyan px-5 py-2.5 text-xs font-bold text-black shadow-[0_0_15px_rgba(37,244,238,0.25)] transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
          >
            {saving ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                Salvando…
              </>
            ) : (
              'Salvar Pixel & Sincronizar'
            )}
          </button>
        </div>
      </GlassCard>
    </div>
  )
}
