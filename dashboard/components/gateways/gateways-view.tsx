'use client'

import { useState } from 'react'
import {
  Plus,
  Webhook,
  Copy,
  Check,
  Trash2,
  Zap,
  CircleCheck,
  CircleX,
  Info,
  Pencil,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react'
import { useGateways, useConversionLog, apiSend } from '@/lib/api'
import type { Gateway, GatewayProvider, GatewayTestResult, GatewayRotateResult } from '@/lib/types'
import { GlassCard } from '@/components/glass-card'
import { StatusBadge } from '@/components/status-badge'
import { Skeleton } from '@/components/skeleton'
import { TutorialButton, TutorialModal, type TutorialStep } from '@/components/tutorial-modal'
import { timeAgo } from '@/lib/format'

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

export function GatewaysView() {
  const { data, mutate, isLoading } = useGateways()
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

  const providers = data?.providers ?? []
  const gateways = data?.gateways ?? []

  function handleCopy(id: string, url: string) {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(id)
      setTimeout(() => setCopied(null), 2000)
    })
  }

  async function handleDelete(g: Gateway) {
    if (!window.confirm(`Remover o gateway "${g.name}"? Os webhooks dele deixam de ser processados.`)) return
    await apiSend(`/api/gateways/${encodeURIComponent(g.id)}`, 'DELETE')
    mutate()
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
  async function handleRotate(g: Gateway) {
    if (
      !window.confirm(
        `Rotacionar o webhook de "${g.name}"? A URL atual PARA de funcionar na hora — você precisará colar a nova no painel do checkout.`,
      )
    )
      return
    setRotating(g.id)
    try {
      const r = await apiSend<GatewayRotateResult>(`/api/gateways/${encodeURIComponent(g.id)}/rotate`, 'POST')
      if (r.ok) {
        await navigator.clipboard.writeText(r.webhookUrl).catch(() => {})
        setCardTest({ id: g.id, ok: true, msg: 'Novo webhook gerado e copiado. Cole no painel do seu gateway.' })
        mutate()
      }
    } catch (e) {
      setCardTest({ id: g.id, ok: false, msg: e instanceof Error ? e.message : 'Falha ao rotacionar' })
    } finally {
      setRotating(null)
    }
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
      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        {/* Gateways cadastrados */}
        <GlassCard className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="section-head text-sm font-semibold text-foreground">Gateways de pagamento</h2>
              <p className="text-xs text-muted-foreground">
                Webhook único por gateway — cole a URL no painel do checkout
              </p>
            </div>
            <div className="flex items-center gap-2">
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

          {/* Item 17: regra de ouro sempre visível — venda só conta via webhook */}
          <p className="mb-3 flex items-start gap-2 rounded-lg border border-[color:var(--warning)]/25 bg-[color:var(--warning)]/8 px-3 py-2 text-xs text-muted-foreground text-pretty">
            <Info className="mt-0.5 size-3.5 shrink-0 text-[color:var(--warning)]" aria-hidden="true" />
            <span>
              Eventos de pagamento (<strong className="text-foreground">Compra / CompletePayment</strong>) só
              disparam quando um gateway conectado confirma via webhook — nunca pelo navegador do cliente.
            </span>
          </p>

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

          {isLoading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
            </div>
          ) : gateways.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nenhum gateway conectado. Adicione um para receber webhooks de conversão.
            </p>
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
                          <Webhook className="size-4" />
                        </span>
                        <div>
                          <p className="text-sm font-semibold text-foreground">{g.name}</p>
                          <p className="text-[11px] text-muted-foreground">{prov?.label ?? g.provider}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {g.hasSecret && <StatusBadge status="info">assinado</StatusBadge>}
                        {g.lastEventAt ? (
                          <StatusBadge status={g.lastEventStatus === 'ok' ? 'success' : 'warning'}>
                            recebeu {timeAgo(g.lastEventAt)}
                          </StatusBadge>
                        ) : (
                          <StatusBadge status="neutral">sem eventos</StatusBadge>
                        )}
                      </div>
                    </div>

                    {/* Item 52: motivo do último evento quando não foi 'ok' —
                        ajuda a debugar assinatura/payload sem abrir logs */}
                    {g.lastEventAt && g.lastEventStatus && g.lastEventStatus !== 'ok' && (
                      <p className="mt-2 flex items-start gap-1.5 rounded-md bg-[color:var(--warning)]/10 px-2.5 py-1.5 text-[11px] text-[color:var(--warning)] text-pretty">
                        <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                        <span>
                          Último webhook falhou: <strong>{g.lastEventStatus}</strong> — veja o
                          detalhe no painel "Webhooks recebidos" abaixo.
                        </span>
                      </p>
                    )}

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

                    {prov?.docs && (
                      <p className="mt-2 flex items-start gap-1.5 text-[11px] text-muted-foreground">
                        <Info className="mt-0.5 size-3 shrink-0" />
                        {prov.docs}
                      </p>
                    )}

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

        {/* Log de webhooks recebidos */}
        <GlassCard className="p-5" data-tour="gateways-webhooks">
          <h2 className="section-head mb-1 text-sm font-semibold text-foreground">Webhooks recebidos</h2>
          <p className="mb-3 text-xs text-muted-foreground">Últimas conversões processadas dos seus gateways</p>
          {!convLog || convLog.log.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nenhum webhook recebido ainda.</p>
          ) : (
            <ul className="flex max-h-[32rem] flex-col gap-1 overflow-y-auto">
              {convLog.log.map((row, i) => (
                <li
                  key={row.id ?? i}
                  className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-secondary/60"
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
                  <span className="shrink-0 text-[11px] text-muted-foreground">{timeAgo(row.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </GlassCard>
      </div>

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
            <input
              className={inputCls}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder={
                gateway?.hasSecret ? 'mantém o segredo atual se deixar em branco' : 'deixe em branco se não usar'
              }
              autoComplete="off"
            />
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
