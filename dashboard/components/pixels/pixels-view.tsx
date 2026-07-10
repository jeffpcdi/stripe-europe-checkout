'use client'

import { useState } from 'react'
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
} from 'lucide-react'
import {
  usePixels,
  usePixelHealth,
  usePixelLog,
  usePixelDurability,
  apiSend,
} from '@/lib/api'
import type { Pixel, PixelEvents, PixelTestResult } from '@/lib/types'
import { GlassCard } from '@/components/glass-card'
import { StatusBadge } from '@/components/status-badge'
import { Skeleton } from '@/components/skeleton'
import { TutorialButton, TutorialModal, type TutorialStep } from '@/components/tutorial-modal'
import { timeAgo } from '@/lib/format'

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
  const { data, mutate, isLoading } = usePixels()
  const { data: health } = usePixelHealth()
  const { data: log, mutate: mutateLog } = usePixelLog()
  const { data: durability } = usePixelDurability()

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

  function handleCopy(slug: string, text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(slug)
      setTimeout(() => setCopied(null), 2000)
    })
  }

  async function handleDelete(p: Pixel) {
    if (!window.confirm(`Remover o pixel "${p.name}"? Os eventos dele param de disparar.`)) return
    await apiSend(`/api/pixels/${encodeURIComponent(p.slug)}`, 'DELETE')
    mutate()
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
      {/* Diagnóstico: por que a config pode não estar chegando ao pixel */}
      {warnings.length > 0 && (
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
                onClick={() => setCreating(true)}
                className="flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-cyan px-3 py-1.5 text-xs font-semibold text-black shadow-[var(--glow-cyan-soft)] transition-all hover:-translate-y-px hover:shadow-[var(--glow-cyan)] hover:brightness-105 active:scale-[0.98]"
              >
                <Plus className="size-3.5" /> Novo pixel
              </button>
            </div>
          </div>

          {isLoading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-28" />
              <Skeleton className="h-28" />
            </div>
          ) : pixels.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground text-pretty">
              Nenhum pixel configurado. Adicione o Pixel Code e o Access Token do TikTok Events API.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
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

                  {/* Script tag para instalar */}
                  {p.scriptTag && (
                    <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-input px-3 py-2">
                      <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
                        {p.scriptTag}
                      </code>
                      <button
                        type="button"
                        onClick={() => handleCopy(p.slug, p.scriptTag!)}
                        className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-brand-cyan transition-colors hover:bg-secondary"
                      >
                        {copied === p.slug ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
                        {copied === p.slug ? 'Copiado' : 'Copiar'}
                      </button>
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
          <GlassCard className="p-5">
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

          <GlassCard className="p-5">
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
                  <div key={ev.event} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{ev.event}</span>
                    <span className={`font-mono ${ev.rate >= 90 ? 'text-success' : ev.rate >= 60 ? 'text-warning' : 'text-error'}`}>
                      {ev.ok}/{ev.total}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </GlassCard>

          <GlassCard className="p-5">
            <h2 className="section-head mb-1 text-sm font-semibold text-foreground">Disparos recentes</h2>
            <p className="mb-3 text-xs text-muted-foreground">Log da Events API — inclui descartes e o motivo</p>
            {!log || log.log.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Nenhum disparo registrado ainda.</p>
            ) : (
              <ul className="flex max-h-96 flex-col gap-1 overflow-y-auto">
                {log.log.map((row, i) => (
                  <li
                    key={row.id ?? i}
                    className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-secondary/60"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className={`size-1.5 shrink-0 rounded-full ${
                          row.status === 'ok' ? 'bg-success' : row.status === 'error' ? 'bg-error' : 'bg-warning'
                        }`}
                        aria-hidden="true"
                      />
                      <span className="truncate font-mono text-foreground">{row.event}</span>
                      <span className="truncate text-muted-foreground">
                        {row.status !== 'ok' && row.response?.message ? row.response.message : row.pixel}
                      </span>
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{timeAgo(row.at)}</span>
                  </li>
                ))}
              </ul>
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
            <input
              className={inputCls}
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder={pixel?.hasToken ? 'mantém o atual se não alterar' : 'cole o token do TikTok'}
              autoComplete="off"
            />
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
