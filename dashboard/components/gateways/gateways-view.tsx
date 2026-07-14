'use client'

import { useEffect, useState } from 'react'
import {
  Plus,
  Copy,
  Check,
  Trash2,
  Zap,
  CircleCheck,
  CircleX,
  Info,
  Pencil,
  RefreshCw,
  ChevronDown,
  Eye,
  EyeOff,
} from 'lucide-react'
import { useGateways, useConversionLog, apiSend } from '@/lib/api'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { toast } from '@/lib/toast'
import type { Gateway, GatewayProvider, GatewayTestResult, GatewayRotateResult } from '@/lib/types'
import { GlassCard } from '@/components/glass-card'
import { StatusBadge } from '@/components/status-badge'
import { Skeleton } from '@/components/skeleton'
import { ErrorState } from '@/components/error-state'
import { TutorialButton, TutorialModal, type TutorialStep } from '@/components/tutorial-modal'
import { timeAgo } from '@/lib/format'
import { QueueHealthPanel, RetentionPanel, IntegrityPanel, QuarantinePanel } from './queue-health-panel'

// Tutorial da aba Gateways — inclui a regra de ouro: venda só conta quando o
// GATEWAY confirma o pagamento via webhook (nunca pelo navegador do cliente).
const GATEWAY_STEPS: TutorialStep[] = [
  {
    title: 'O que o gateway faz aqui',
    body: (
      <>
        O gateway (Stripe, Hotmart, Kiwify…) é quem processa o pagamento. Quando alguém compra, ele avisa
        o nosso servidor por <strong>webhook</strong> — e só então registramos a venda e disparamos o
        evento de <strong>Compra</strong> para o TikTok.
      </>
    ),
    tip: 'É por isso que venda NUNCA é contada pelo navegador do cliente: só o gateway confirma pagamento real.',
  },
  {
    title: '1. Crie o gateway',
    body: (
      <>
        Clique em <strong>Novo gateway</strong>, escolha o provedor e dê um nome. Geramos uma{' '}
        <strong>URL de webhook única</strong> para ele — essa URL é o seu &quot;script&quot; de integração:
        não precisa colar código nenhum na página.
      </>
    ),
  },
  {
    title: '2. Cole a URL no painel do checkout',
    body: (
      <>
        No painel do seu gateway, procure <strong>Webhooks</strong> (ou &quot;Notificações&quot; /
        &quot;Postback&quot;) e cole a URL copiada. Marque os eventos de <strong>pagamento aprovado</strong>{' '}
        (e reembolso/chargeback, se houver).
      </>
    ),
    tip: 'Cada gateway tem a própria URL — não reutilize a mesma URL em dois gateways.',
  },
  {
    title: '3. Teste o fluxo',
    body: (
      <>
        Use <strong>Testar fluxo</strong> para simular uma confirmação de pagamento e ver o caminho
        completo: webhook recebido → lead casado → evento CompletePayment na fila do TikTok.
      </>
    ),
  },
  {
    title: '4. Acompanhe o diário de conversões',
    body: (
      <>
        O painel ao lado mostra cada webhook que chegou e o que aconteceu com ele (aceito, duplicado,
        recusado e por quê). Se uma venda não apareceu, é aqui que você descobre o motivo.
      </>
    ),
  },
]

// Item 73: cor da marca por provedor — cápsula e borda no hover
// Item 32: mapa ALINHADO ao catálogo real de PROVIDERS do gateway-store.js
// (kiwify, hotmart, perfectpay, cakto, stripe, vega, adoorei, payt, generic).
// paypal/mercadopago não existem no catálogo e foram removidos.
const PROVIDER_COLORS: Record<string, string> = {
  kiwify: '#22c55e',
  hotmart: '#f04e23',
  perfectpay: '#fbbf24',
  cakto: '#7c9a3d',
  stripe: '#635bff',
  vega: '#3b82f6',
  adoorei: '#e879a0',
  payt: '#0ea5a3',
  generic: '#25f4ee',
}

function providerColor(id: string): string {
  return PROVIDER_COLORS[id] ?? PROVIDER_COLORS.generic
}

// Item 102: marca visual por provedor no lugar do ícone genérico Webhook.
// Stripe e Hotmart têm o mark oficial (via theSVG.org, inline em currentColor
// para herdar a cor da marca); os demais provedores (gateways BR de nicho sem
// SVG público) usam monograma com a cor do catálogo — consistente e legível.
const PROVIDER_MARKS: Record<string, { viewBox: string; d: string }> = {
  stripe: {
    viewBox: '0 0 24 24',
    d: 'M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.594-7.305h.003z',
  },
  hotmart: {
    viewBox: '0 0 27 37',
    d: 'M25.7756 17.3698C25.2893 15.6249 24.5666 13.9548 23.6276 12.4058H23.6296C23.6296 12.4058 22.7026 10.8678 22.3136 10.4028H22.3106C22.2146 10.2818 22.0216 10.4158 22.0956 10.5538C22.2046 10.7828 22.3036 11.0648 22.2346 11.3398C22.1206 11.6758 21.7456 11.9088 21.4006 11.7898C21.3051 11.7512 21.2186 11.6933 21.1466 11.6198C20.7936 11.2548 20.6096 10.6508 20.3806 9.8838C20.1746 9.2008 19.9196 8.35279 19.4596 7.43479C18.7116 5.94279 17.8266 5.25279 17.7906 5.22379C17.7686 5.20662 17.7416 5.19721 17.7137 5.19703C17.6859 5.19685 17.6587 5.20591 17.6366 5.2228C17.6142 5.23992 17.5976 5.26346 17.5891 5.29028C17.5805 5.31709 17.5803 5.34588 17.5886 5.3728C17.5926 5.3848 17.9646 6.61479 17.2466 7.54579C16.9606 7.91679 16.5256 8.1408 16.0186 8.1728C15.5086 8.2058 15.0036 8.0368 14.7006 7.7328C13.9496 6.9778 13.8616 5.63979 13.8756 4.90979C13.9226 2.47579 14.6576 0.770795 15.0406 0.209795C15.0567 0.185815 15.0649 0.157376 15.064 0.12849C15.0631 0.0996036 15.0532 0.071728 15.0356 0.048795C15.018 0.0265184 14.9936 0.0106996 14.9661 0.00382184C14.9385 -0.00305591 14.9095 -0.000603202 14.8836 0.010795C11.9096 1.2998 9.75456 3.50679 8.65356 6.38379C8.03456 8.09479 7.76456 8.8748 7.54556 9.3658C7.34356 9.8148 7.15656 10.0218 6.96556 10.1358C6.86056 10.1998 6.73256 10.2358 6.60056 10.2408C6.40656 10.2208 5.44656 10.0448 6.28256 8.4388C6.35156 8.3038 6.16856 8.1698 6.06656 8.2788L5.40856 9.0058C5.37923 9.0378 5.3499 9.0698 5.32056 9.1018L5.21156 9.2228C5.1929 9.24413 5.1759 9.2648 5.16056 9.2848C3.08056 11.6618 1.62756 14.7038 0.790564 17.5138C0.0405639 20.2138 -0.00643612 22.3708 0.000563879 23.1908L0.00156388 23.3728C0.00156388 27.0068 1.38356 30.4228 3.89256 32.9928C6.40156 35.5628 9.73956 36.9778 13.2876 36.9778C16.8356 36.9778 20.1736 35.5628 22.6826 32.9928C25.1926 30.4228 26.5736 27.0058 26.5736 23.3728C26.5736 21.0578 26.2756 19.1718 25.7706 17.3698H25.7756ZM13.2896 30.4168C9.49156 30.4168 6.41056 27.2648 6.41056 23.3738C6.41056 19.4828 9.49056 16.3298 13.2896 16.3298C17.0886 16.3298 20.1686 19.4838 20.1686 23.3738C20.1686 27.2638 17.0886 30.4168 13.2896 30.4168Z',
  },
}

function ProviderIcon({ provider, label }: { provider: string; label: string }) {
  const mark = PROVIDER_MARKS[provider]
  if (mark) {
    return (
      <svg viewBox={mark.viewBox} className="size-4" fill="currentColor" aria-hidden="true">
        <path d={mark.d} />
      </svg>
    )
  }
  return <span className="text-sm font-bold leading-none">{(label || provider).charAt(0).toUpperCase()}</span>
}

export function GatewaysView() {
  const { data, mutate, isLoading, error } = useGateways()
  const { data: convLog, mutate: mutateLog } = useConversionLog()

  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Gateway | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [testing, setTesting] = useState(false)
  // Teste por card: resultado atrelado ao id do gateway
  const [cardTest, setCardTest] = useState<{ id: string; ok: boolean; msg: string; note?: string } | null>(null)
  const [cardTesting, setCardTesting] = useState<string | null>(null)
  const [rotating, setRotating] = useState<string | null>(null)
  const [showTutorial, setShowTutorial] = useState(false)
  // Item 110: anúncio acessível da cópia (aria-live), padrão da aba Pixels (93)
  const [copyAnnounce, setCopyAnnounce] = useState('')
  // Item 104: linha do log expandida (detalhe do webhook)
  const [expandedRow, setExpandedRow] = useState<string | null>(null)
  // Item 198: reprocessamento manual de uma conversão do log
  const [reprocessing, setReprocessing] = useState<string | null>(null)
  // Item 233: paginação incremental do log (50 por vez, não trava a UI)
  const [logShown, setLogShown] = useState(50)

  async function handleReprocess(row: { id?: string }) {
    if (!row.id || reprocessing) return
    setReprocessing(row.id)
    try {
      const r = await apiSend<{ ok: boolean; receipt?: { status?: string; dispatched?: number } }>(
        '/api/ops/reprocess-conversion',
        'POST',
        { id: row.id },
      )
      const st = r.receipt?.status ?? 'ok'
      if (st === 'ok' || st.startsWith('ok')) {
        toast.success('Conversão reenviada para o TikTok', {
          hint: r.receipt?.dispatched ? `${r.receipt.dispatched} pixel(s) receberam o evento.` : undefined,
        })
      } else {
        toast.error(`Reprocessamento terminou com status: ${st}`, {
          hint: st === 'sem pixel' ? 'Nenhum pixel ativo com Access Token para esta conta.' : undefined,
        })
      }
      mutateLog()
    } catch (e) {
      toast.error('Falha ao reprocessar a conversão', {
        hint: e instanceof Error ? e.message : undefined,
      })
    } finally {
      setReprocessing(null)
    }
  }
  // Item 184: confirmação destrutiva padronizada (substitui window.confirm)
  const [confirm, setConfirm] = useState<{
    title: string
    description: React.ReactNode
    confirmLabel: string
    confirmText?: string
    run: () => Promise<void>
  } | null>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)

  const providers = data?.providers ?? []
  const gateways = data?.gateways ?? []

  // A7.4: relógio relativo vivo — re-renderiza a cada 30s para o
  // "recebeu há X min" não congelar entre polls
  const [, setClockTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setClockTick((t) => t + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  function handleCopy(id: string, url: string) {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(id)
      setCopyAnnounce('URL do webhook copiada para a área de transferência.')
      setTimeout(() => setCopied(null), 2000)
    })
  }

  function handleDelete(g: Gateway) {
    // Item 184: gateway com tráfego exige digitar o nome (mesma trava do link, item 76)
    const hasTraffic = Boolean(g.lastEventAt)
    setConfirm({
      title: `Remover o gateway "${g.name}"?`,
      description: (
        <>
          Os webhooks dele deixam de ser processados imediatamente. Esta ação não pode ser desfeita.
          {hasTraffic && ' Este gateway já recebeu eventos.'}
        </>
      ),
      confirmLabel: 'Remover gateway',
      confirmText: hasTraffic ? g.name : undefined,
      run: async () => {
        try {
          await apiSend(`/api/gateways/${encodeURIComponent(g.id)}`, 'DELETE')
          mutate()
          toast.success(`Gateway "${g.name}" removido`)
        } catch (e) {
          toast.error('Falha ao remover o gateway', {
            hint: e instanceof Error ? e.message : undefined,
          })
        }
      },
    })
  }

  // Teste POR gateway: usa o token real daquele gateway e mostra a nota de assinatura
  async function handleCardTest(g: Gateway) {
    setCardTesting(g.id)
    setCardTest(null)
    try {
      const r = await apiSend<GatewayTestResult>(`/api/gateways/${encodeURIComponent(g.id)}/test`, 'POST')
      const rc = r.receipt as { status?: string; matched?: boolean } | undefined
      setCardTest({
        id: g.id,
        ok: r.ok !== false && !r.error,
        msg: r.ok
          ? `Fluxo OK — status "${rc?.status ?? 'paid'}"${rc?.matched ? ', lead casado' : ' (dry-run)'}`
          : r.error || 'Falha no teste',
        note: r.signatureNote,
      })
      mutateLog()
    } catch (e) {
      setCardTest({ id: g.id, ok: false, msg: e instanceof Error ? e.message : 'Falha no teste' })
    } finally {
      setCardTesting(null)
    }
  }

  // Rotação do webhook: a URL antiga para de funcionar imediatamente
  function handleRotate(g: Gateway) {
    setConfirm({
      title: `Rotacionar o webhook de "${g.name}"?`,
      description: (
        <>
          A URL atual <strong>para de funcionar na hora</strong> — você precisará colar a nova no painel
          do checkout. A nova URL é copiada automaticamente.
        </>
      ),
      confirmLabel: 'Rotacionar webhook',
      run: async () => {
        setRotating(g.id)
        try {
          const r = await apiSend<GatewayRotateResult>(`/api/gateways/${encodeURIComponent(g.id)}/rotate`, 'POST')
          if (r.ok) {
            await navigator.clipboard.writeText(r.webhookUrl).catch(() => {})
            mutate()
            toast.success('Novo webhook gerado e copiado', { hint: 'Cole no painel do seu gateway.' })
          }
        } catch (e) {
          toast.error('Falha ao rotacionar o webhook', {
            hint: e instanceof Error ? e.message : undefined,
          })
        } finally {
          setRotating(null)
        }
      },
    })
  }

  async function handleTest() {
    setTesting(true)
    setTestResult(null)
    try {
      const r = await apiSend<{ ok?: boolean; error?: string; receipt?: { status?: string; matched?: boolean } }>(
        '/api/conversion/test',
        'POST',
      )
      if (r.ok) {
        const rc = r.receipt
        setTestResult({
          ok: true,
          msg: `Fluxo OK — status "${rc?.status ?? 'paid'}"${rc?.matched ? ', lead casado' : ' (dry-run)'}`,
        })
        mutateLog()
      } else {
        setTestResult({ ok: false, msg: r.error || 'Falha no teste' })
      }
    } catch (e) {
      setTestResult({ ok: false, msg: e instanceof Error ? e.message : 'Falha no teste' })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Item 110: anúncio acessível das cópias (fora de tela, polido) */}
      <span className="sr-only" role="status" aria-live="polite">
        {copyAnnounce}
      </span>
      {/* Item 57: minmax(0,·) — sem isso os grid items têm min-width:auto e o
          conteúdo intrínseco (log de webhooks) estoura a viewport no mobile */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        {/* Gateways cadastrados */}
        <GlassCard className="min-w-0 p-5">
          {/* Item 57: flex-wrap para o grupo de botões quebrar linha no mobile
              (sem isso o card estoura a viewport e a página inteira rola na horizontal) */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="section-head text-sm font-semibold text-foreground">Gateways de pagamento</h2>
              <p className="text-xs text-muted-foreground">
                Webhook único por gateway — cole a URL no painel do checkout
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <TutorialButton onClick={() => setShowTutorial(true)} />
              <button
                type="button"
                onClick={handleTest}
                disabled={testing}
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-50"
              >
                <Zap className="size-3.5" /> {testing ? 'Testando…' : 'Testar fluxo'}
              </button>
              <button
                type="button"
                data-tour="gateways-new"
                onClick={() => setCreating(true)}
                className="flex items-center gap-1.5 rounded-lg bg-[color:var(--brand-cyan)] px-3 py-1.5 text-xs font-semibold text-black shadow-[var(--glow-cyan-soft)] transition-all hover:-translate-y-px hover:shadow-[var(--glow-cyan)] hover:brightness-105 active:scale-[0.98]"
              >
                <Plus className="size-3.5" /> Novo gateway
              </button>
            </div>
          </div>

          {/* Regra de ouro (venda só conta via webhook) vive no tutorial
              "Como funciona" — fora da tela para reduzir poluição visual */}
          {testResult && (
            <p
              className={`mb-3 flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${
                testResult.ok ? 'bg-[var(--success-light)] text-success' : 'bg-destructive/10 text-destructive'
              }`}
              role="status"
            >
              {testResult.ok ? <CircleCheck className="size-3.5" /> : <CircleX className="size-3.5" />}
              {testResult.msg}
            </p>
          )}

          {error && !data ? (
            /* Item 182: erro de carregamento com retry consistente */
            <ErrorState title="Não foi possível carregar seus gateways." onRetry={() => mutate()} />
          ) : isLoading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
            </div>
            ) : gateways.length === 0 ? (
              /* Item 53 + A7.5: estado vazio ilustrado — ícone + 1 linha + CTA */
              <div className="flex flex-col items-center gap-3 py-8 text-center">
                <span
                  className="flex size-12 items-center justify-center rounded-2xl bg-brand-cyan/12 text-brand-cyan"
                  aria-hidden="true"
                >
                  <Zap className="size-6" />
                </span>
                <p className="text-sm text-muted-foreground text-pretty">
                  Nenhum gateway conectado. Adicione um para receber webhooks de conversão.
                </p>
                {/* Item 106: consequência concreta de não ter gateway (par do aviso 86 na aba Pixels) */}
                <p className="max-w-md text-xs text-warning text-pretty">
                  Sem gateway, os eventos de dinheiro do pixel (Compra e Pagamento) nunca disparam — eles
                  só saem do webhook do seu checkout.
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => setCreating(true)}
                    className="rounded-lg bg-[color:var(--brand-cyan)] px-3 py-1.5 text-xs font-semibold text-black transition-all hover:brightness-105 active:scale-[0.98]"
                  >
                    Conectar primeiro gateway
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
            <ul className="flex flex-col gap-2" data-tour="gateways-list">
              {gateways.map((g) => {
                const prov = providers.find((p) => p.id === g.provider)
                const brand = providerColor(g.provider)
                return (
                  /* Item 73: cápsula e borda na cor da marca do provedor */
                  <li
                    key={g.id}
                    className="group rounded-xl border border-border bg-secondary/40 p-4 transition-colors duration-150"
                    style={{ ['--gw-brand' as string]: brand }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = `color-mix(in oklab, ${brand} 45%, transparent)`
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = ''
                    }}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <span
                          className="flex size-8 items-center justify-center rounded-[10px]"
                          style={{
                            color: brand,
                            background: `color-mix(in oklab, ${brand} 14%, transparent)`,
                          }}
                          aria-hidden="true"
                        >
                          <ProviderIcon provider={g.provider} label={prov?.label ?? g.provider} />
                        </span>
                        <div>
                          <p className="text-sm font-semibold text-foreground">{g.name}</p>
                          <p className="text-[11px] text-muted-foreground">{prov?.label ?? g.provider}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {g.hasSecret && <StatusBadge status="info">assinado</StatusBadge>}
                        {/* A7.2: status com .status-dot — conectado (verde,
                            pulso lento), erro (vermelho + tooltip com a causa),
                            aguardando eventos (âmbar) */}
                        {g.lastEventAt ? (
                          g.lastEventStatus === 'ok' ? (
                            <span className="flex items-center gap-1.5 rounded-md bg-[color:var(--success)]/15 px-1.5 py-0.5 text-[11px] font-medium text-[color:var(--success)]">
                              <span className="status-dot status-dot--ok status-dot--pulse" aria-hidden="true" />
                              recebeu {timeAgo(g.lastEventAt)}
                            </span>
                          ) : (
                            <span
                              className="flex items-center gap-1.5 rounded-md bg-[color:var(--error)]/15 px-1.5 py-0.5 text-[11px] font-medium text-[color:var(--error)]"
                              title={`Último webhook falhou: ${g.lastEventStatus}`}
                            >
                              <span className="status-dot status-dot--err" aria-hidden="true" />
                              erro {timeAgo(g.lastEventAt)}
                            </span>
                          )
                        ) : (
                          <span className="flex items-center gap-1.5 rounded-md bg-[color:var(--warning)]/12 px-1.5 py-0.5 text-[11px] font-medium text-[color:var(--warning)]">
                            <span className="status-dot status-dot--warn" aria-hidden="true" />
                            aguardando eventos
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Motivo do erro fica no tooltip do badge "erro" acima —
                        sem caixa amarela extra poluindo cada card */}
                    {/* Webhook URL para colar no gateway */}
                    <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-input px-3 py-2">
                      <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
                        {g.webhookUrl}
                      </code>
                      <button
                        type="button"
                        onClick={() => handleCopy(g.id, g.webhookUrl)}
                        className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-[color:var(--brand-cyan)] transition-colors hover:bg-secondary"
                      >
                        {copied === g.id ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
                        {copied === g.id ? 'Copiado' : 'Copiar'}
                      </button>
                    </div>

                    {/* A7.3: saúde dos webhooks deste gateway — mini-barra
                        empilhada processados/outros/falhos a partir do log */}
                    {(() => {
                      const rows = (convLog?.log ?? []).filter((r) => r.gateway === g.name)
                      if (rows.length === 0) return null
                      const ok = rows.filter((r) => r.status === 'paid' || r.matched).length
                      const failed = rows.filter(
                        (r) => typeof r.status === 'string' && /erro|invalid|fail|recusad/i.test(r.status),
                      ).length
                      const other = rows.length - ok - failed
                      return (
                        <div className="mt-2 flex items-center gap-2">
                          <div
                            className="flex h-1.5 w-36 overflow-hidden rounded-full bg-secondary/60"
                            role="img"
                            aria-label={`Webhooks: ${ok} processados, ${other} outros, ${failed} falhos`}
                          >
                            {ok > 0 && (
                              <div className="h-full bg-[color:var(--success)]" style={{ width: `${(ok / rows.length) * 100}%` }} />
                            )}
                            {other > 0 && (
                              <div className="h-full bg-[color:var(--warning)]/70" style={{ width: `${(other / rows.length) * 100}%` }} />
                            )}
                            {failed > 0 && (
                              <div className="h-full bg-[color:var(--error)]" style={{ width: `${(failed / rows.length) * 100}%` }} />
                            )}
                          </div>
                          <span className="font-mono text-[10px] tabular-nums text-faint">
                            {ok}/{rows.length} ok{failed > 0 ? ` · ${failed} falho${failed === 1 ? '' : 's'}` : ''}
                          </span>
                        </div>
                      )
                    })()}

                    {/* Instruções do provedor (prov.docs) só no editor —
                        menos texto repetido em cada card */}
                    {/* Resultado do teste/rotação POR card */}
                    {cardTest?.id === g.id && (
                      <div
                        className={`mt-3 rounded-lg px-3 py-2 text-xs ${
                          cardTest.ok ? 'bg-[var(--success-light)] text-success' : 'bg-destructive/10 text-destructive'
                        }`}
                        role="status"
                      >
                        <p className="flex items-center gap-2">
                          {cardTest.ok ? <CircleCheck className="size-3.5" /> : <CircleX className="size-3.5" />}
                          {cardTest.msg}
                        </p>
                        {cardTest.note && (
                          <p className="mt-1 pl-5 text-[11px] text-muted-foreground text-pretty">{cardTest.note}</p>
                        )}
                      </div>
                    )}

                    <div className="mt-3 flex flex-wrap items-center justify-end gap-1 border-t border-border pt-3">
                      <button
                        type="button"
                        onClick={() => handleCardTest(g)}
                        disabled={cardTesting === g.id}
                        className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
                      >
                        <Zap className="size-3.5" /> {cardTesting === g.id ? 'Testando…' : 'Testar'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing(g)}
                        className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                      >
                        <Pencil className="size-3.5" /> Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRotate(g)}
                        disabled={rotating === g.id}
                        className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
                      >
                        <RefreshCw className={`size-3.5 ${rotating === g.id ? 'animate-spin' : ''}`} /> Rotacionar
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(g)}
                        className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
                      >
                        <Trash2 className="size-3.5" /> Remover
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </GlassCard>

        {/* V2-88: painel do log com scanline ciano — sinaliza "ao vivo" */}
        <GlassCard className="scan-live min-w-0 p-5" data-tour="gateways-webhooks">
          <h2 className="section-head mb-1 text-sm font-semibold text-foreground">Webhooks recebidos</h2>
          <p className="mb-3 text-xs text-muted-foreground">Últimas conversões processadas dos seus gateways</p>
          {!convLog || convLog.log.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nenhum webhook recebido ainda.</p>
          ) : (
            <ul className="flex max-h-[32rem] flex-col gap-1 overflow-y-auto">
              {/* Item 104/105: linha expansível — clique revela orderId, valor,
                  e-mail e se o lead casou com um clique rastreado (matched) */}
              {/* Item 233: paginação incremental — renderiza 50 por vez para
                  não travar a UI com as 200 linhas do log */}
              {convLog.log.slice(0, logShown).map((row, i) => {
                const rowKey = String(row.id ?? i)
                const isOpen = expandedRow === rowKey
                return (
                  <li key={rowKey} className="rounded-lg text-xs">
                    <button
                      type="button"
                      onClick={() => setExpandedRow(isOpen ? null : rowKey)}
                      aria-expanded={isOpen}
                      className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-secondary/60"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          className={`size-1.5 shrink-0 rounded-full ${
                            row.status === 'paid' || row.matched ? 'bg-success' : 'bg-muted-foreground'
                          }`}
                          aria-hidden="true"
                        />
                        <span className="truncate font-mono text-foreground">{row.gateway ?? 'gateway'}</span>
                        <span className="truncate text-muted-foreground">{row.status ?? row.event ?? '—'}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                        {timeAgo(row.at)}
                        <ChevronDown
                          className={`size-3 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                          aria-hidden="true"
                        />
                      </span>
                    </button>
                    {isOpen && (
                      <dl className="mx-2 mb-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg bg-secondary/40 px-3 py-2 text-[11px]">
                        {row.orderId != null && (
                          <>
                            <dt className="text-muted-foreground">Pedido</dt>
                            <dd className="truncate font-mono text-foreground">{String(row.orderId)}</dd>
                          </>
                        )}
                        {row.amount != null && (
                          <>
                            <dt className="text-muted-foreground">Valor</dt>
                            <dd className="font-mono text-foreground">
                              {String(row.amount)} {row.currency ? String(row.currency).toUpperCase() : ''}
                            </dd>
                          </>
                        )}
                        {row.email != null && String(row.email) !== '' && (
                          <>
                            <dt className="text-muted-foreground">E-mail</dt>
                            <dd className="truncate text-foreground">{String(row.email)}</dd>
                          </>
                        )}
                        {row.event != null && (
                          <>
                            <dt className="text-muted-foreground">Evento</dt>
                            <dd className="text-foreground">{String(row.event)}</dd>
                          </>
                        )}
                        <dt className="text-muted-foreground">Lead</dt>
                        <dd className={row.matched ? 'font-medium text-success' : 'text-muted-foreground'}>
                          {row.matched
                            ? 'casou com um clique rastreado'
                            : 'não casou — venda órfã (sem leadId, e-mail ou telefone que batesse com um lead)'}
                        </dd>
                        {/* Item 198: reenfileirar manualmente quando o disparo CAPI
                            falhou mas o pagamento é válido. Não duplica a venda no
                            painel — só re-dispara o evento para o TikTok. */}
                        {row.id != null && !row.teste && (
                          <>
                            <dt className="text-muted-foreground">Ações</dt>
                            <dd>
                              <button
                                type="button"
                                onClick={() => handleReprocess(row)}
                                disabled={reprocessing !== null}
                                className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-50"
                                title="Re-dispara o evento para o TikTok sem duplicar a venda no painel"
                              >
                                <RefreshCw
                                  className={`size-3 ${reprocessing === row.id ? 'animate-spin' : ''}`}
                                  aria-hidden="true"
                                />
                                {reprocessing === row.id ? 'Reprocessando…' : 'Reprocessar disparo'}
                              </button>
                            </dd>
                          </>
                        )}
                      </dl>
                    )}
                  </li>
                )
              })}
              {/* Item 233: carrega mais 50 sob demanda */}
              {convLog.log.length > logShown && (
                <li>
                  <button
                    type="button"
                    onClick={() => setLogShown((n) => n + 50)}
                    className="w-full rounded-lg border border-dashed border-border px-2 py-1.5 text-center text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  >
                    Mostrar mais ({convLog.log.length - logShown} restantes)
                  </button>
                </li>
              )}
            </ul>
          )}
        </GlassCard>
      </div>

      {/* Painéis técnicos (integridade, fila, retenção) recolhidos por padrão —
          quem precisa expande; o resto da página fica limpo */}
      <details className="group rounded-xl border border-border">
        <summary className="flex cursor-pointer select-none items-center justify-between gap-2 rounded-xl px-4 py-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary/40 hover:text-foreground [&::-webkit-details-marker]:hidden">
          <span className="flex items-center gap-2">
            <Info className="size-3.5" aria-hidden="true" />
            Diagnóstico avançado — webhooks em quarentena, integridade, fila e retenção
          </span>
          <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="flex flex-col gap-5 border-t border-border p-4">
          <QuarantinePanel />
          <IntegrityPanel />
          <QueueHealthPanel />
          <RetentionPanel />
        </div>
      </details>

      <TutorialModal
        open={showTutorial}
        onClose={() => setShowTutorial(false)}
        title="Como conectar seu gateway de pagamento"
        steps={GATEWAY_STEPS}
      />

      {(creating || editing) && (
        <GatewayEditor
          providers={providers}
          gateway={editing}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
          onSaved={() => {
            setCreating(false)
            setEditing(null)
            mutate()
          }}
        />
      )}

      {/* Item 184: confirmação destrutiva padronizada e acessível */}
      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.title ?? ''}
        description={confirm?.description}
        confirmLabel={confirm?.confirmLabel ?? 'Confirmar'}
        confirmText={confirm?.confirmText}
        busy={confirmBusy}
        onClose={() => {
          if (!confirmBusy) setConfirm(null)
        }}
        onConfirm={async () => {
          if (!confirm) return
          setConfirmBusy(true)
          try {
            await confirm.run()
            setConfirm(null)
          } finally {
            setConfirmBusy(false)
          }
        }}
      />
    </div>
  )
}

// ── Editor inline (modal) — cria ou edita um gateway ──────────────────
function GatewayEditor({
  providers,
  gateway,
  onClose,
  onSaved,
}: {
  providers: GatewayProvider[]
  gateway: Gateway | null
  onClose: () => void
  onSaved: () => void
}) {
  const [provider, setProvider] = useState(gateway?.provider ?? providers[0]?.id ?? 'generic')
  const [name, setName] = useState(gateway?.name ?? '')
  const [secret, setSecret] = useState('')
  // Item 103: revelar/ocultar o que está sendo digitado no campo do segredo
  const [showSecret, setShowSecret] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const prov = providers.find((p) => p.id === provider)

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      await apiSend('/api/gateways', 'POST', {
        // Na edição enviamos o id: o backend preserva o webhookToken e só troca
        // o segredo se um novo for digitado (campo em branco mantém o atual).
        id: gateway?.id,
        provider,
        name: name.trim() || undefined,
        secret: secret.trim() || undefined,
      })
      onSaved()
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
      aria-label={gateway ? 'Editar gateway' : 'Novo gateway'}
    >
      <GlassCard variant="thick" className="my-8 w-full max-w-lg p-6">
        <h2 className="mb-5 text-base font-semibold text-foreground">
          {gateway ? `Editar gateway: ${gateway.name}` : 'Novo gateway de pagamento'}
        </h2>
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Provedor</span>
            <select className={inputCls} value={provider} onChange={(e) => setProvider(e.target.value)}>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Nome (opcional)</span>
            <input
              className={inputCls}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={prov?.label ?? 'Meu gateway'}
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">{prov?.secretLabel ?? 'Segredo (opcional)'}</span>
            {/* Item 103: segredo mascarado por padrão com Revelar/Ocultar —
                o backend nunca devolve o segredo salvo (só hasSecret) */}
            <div className="relative">
              <input
                type={showSecret ? 'text' : 'password'}
                className={`${inputCls} w-full pr-16`}
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder={
                  gateway?.hasSecret ? 'mantém o segredo atual se deixar em branco' : 'deixe em branco se não usar'
                }
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setShowSecret((v) => !v)}
                aria-label={showSecret ? 'Ocultar segredo' : 'Revelar segredo'}
                aria-pressed={showSecret}
                className="absolute inset-y-0 right-2 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                {showSecret ? <EyeOff className="size-3.5" aria-hidden="true" /> : <Eye className="size-3.5" aria-hidden="true" />}
                {showSecret ? 'Ocultar' : 'Revelar'}
              </button>
            </div>
            {gateway?.hasSecret && (
              <span className="text-[11px] text-muted-foreground">
                Este gateway já tem um segredo salvo — deixe em branco para manter ou cole um novo para substituir.
              </span>
            )}
          </label>

          {prov?.docs && (
            <p className="flex items-start gap-1.5 rounded-lg bg-secondary/60 px-3 py-2 text-[11px] text-muted-foreground">
              <Info className="mt-0.5 size-3 shrink-0" />
              {prov.docs}
            </p>
          )}

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
              className="rounded-lg bg-[color:var(--brand-cyan)] px-4 py-2 text-sm font-semibold text-black shadow-[var(--glow-cyan-soft)] transition-all hover:-translate-y-px hover:shadow-[var(--glow-cyan)] hover:brightness-105 active:scale-[0.98] disabled:opacity-50 disabled:shadow-none"
            >
              {saving ? 'Salvando…' : 'Criar gateway'}
            </button>
          </div>
        </div>
      </GlassCard>
    </div>
  )
}
