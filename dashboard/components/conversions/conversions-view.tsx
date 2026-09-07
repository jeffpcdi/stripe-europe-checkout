'use client'

import { useState, useRef, useMemo } from 'react'
import {
  Target,
  CreditCard,
  Plus,
  Copy,
  Check,
  Code2,
  Trash2,
  Pencil,
  Zap,
  Eye,
  EyeOff,
  ClipboardPaste,
  CircleX,
  Loader2,
  RefreshCw,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Clock,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { usePixels, useGateways, useConversionLog, apiSend } from '@/lib/api'
import { GlassCard } from '@/components/glass-card'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { toast } from '@/lib/toast'
import { timeAgo } from '@/lib/format'
import { useModalA11y } from '@/lib/use-modal-a11y'
import type { Pixel, Gateway, GatewayProvider, PixelEvents } from '@/lib/types'

// Provedores de checkout suportados e cores de marca
const PROVIDER_COLORS: Record<string, string> = {
  kiwify: '#22c55e',
  hotmart: '#f04e23',
  perfectpay: '#fbbf24',
  cakto: '#7c9a3d',
  stripe: '#635bff',
  vega: '#3b82f6',
  adoorei: '#e879a0',
  payt: '#0ea5a3',
  eduzz: '#0055ff',
  monetizze: '#10b981',
  braip: '#8b5cf6',
  generic: '#25f4ee',
}

const PROVIDER_LABELS: Record<string, string> = {
  kiwify: 'Kiwify',
  hotmart: 'Hotmart',
  perfectpay: 'PerfectPay',
  cakto: 'Cakto',
  stripe: 'Stripe',
  vega: 'Vega Checkout',
  adoorei: 'Adoorei',
  payt: 'PayT',
  eduzz: 'Eduzz',
  monetizze: 'Monetizze',
  braip: 'Braip',
  generic: 'Outro Checkout',
}

function providerColor(id: string): string {
  return PROVIDER_COLORS[id] ?? PROVIDER_COLORS.generic
}

function providerName(id: string): string {
  return PROVIDER_LABELS[id] ?? id.toUpperCase()
}

export function ConversionsView() {
  const { data: pxData, mutate: mutatePixels, isLoading: loadingPixels } = usePixels()
  const { data: gwData, mutate: mutateGateways, isLoading: loadingGateways } = useGateways()
  const { data: convLog, mutate: mutateLog } = useConversionLog()

  const pixels = pxData?.pixels ?? []
  const gateways = gwData?.gateways ?? []
  const providers = gwData?.providers ?? []

  // Estados dos Modais
  const [installingPixel, setInstallingPixel] = useState<Pixel | null>(null)
  const [editingPixel, setEditingPixel] = useState<Pixel | null | 'new'>(null)
  const [editingGateway, setEditingGateway] = useState<Gateway | null | 'new'>(null)
  const [deletingPixel, setDeletingPixel] = useState<Pixel | null>(null)
  const [deletingGateway, setDeletingGateway] = useState<Gateway | null>(null)

  // Ações de teste e cópia
  const [testingPixelSlug, setTestingPixelSlug] = useState<string | null>(null)
  const [testingGwId, setTestingGwId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [showLog, setShowLog] = useState(false)

  // Mapa de gateways por ID para busca rápida
  const gatewaysById = useMemo(() => {
    const map = new Map<string, Gateway>()
    for (const g of gateways) {
      map.set(g.id, g)
    }
    return map
  }, [gateways])

  function copyText(text: string, id: string, label = 'Copiado!') {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id)
      toast.success(label)
      setTimeout(() => setCopiedId((curr) => (curr === id ? null : curr)), 2000)
    })
  }

  async function handleTogglePixelActive(px: Pixel) {
    const nextState = !px.active
    try {
      await apiSend('/api/pixels', 'POST', {
        slug: px.slug,
        active: nextState,
      })
      toast.success(nextState ? `Pixel ${px.name} ativado` : `Pixel ${px.name} pausado`)
      mutatePixels()
    } catch (e) {
      toast.error('Erro ao alterar status do pixel', {
        hint: e instanceof Error ? e.message : undefined,
      })
    }
  }

  async function handleTestPixel(px: Pixel) {
    if (testingPixelSlug) return
    setTestingPixelSlug(px.slug)
    try {
      const res = await apiSend<{ ok: boolean; status?: string; message?: string }>('/api/pixels/test', 'POST', {
        slug: px.slug,
        event: 'ViewContent',
      })
      if (res.ok) {
        toast.success(`Disparo de teste enviado com sucesso ao TikTok!`, {
          hint: `Evento ViewContent processado para ${px.name}`,
        })
      } else {
        toast.error(`Falha no teste: ${res.message || 'Verifique o token CAPI'}`)
      }
    } catch (e) {
      toast.error('Erro ao testar disparo do pixel', {
        hint: e instanceof Error ? e.message : undefined,
      })
    } finally {
      setTestingPixelSlug(null)
    }
  }

  async function handleTestGateway(gw: Gateway) {
    if (testingGwId) return
    setTestingGwId(gw.id)
    try {
      const res = await apiSend<{ ok: boolean; message?: string }>(`/api/gateways/${gw.id}/test`, 'POST', {})
      if (res.ok) {
        toast.success(`Webhook de teste simulado com sucesso!`, {
          hint: `Uma compra de teste foi recebida para ${gw.name}`,
        })
        mutateLog()
      } else {
        toast.error(`Erro no teste: ${res.message || 'Verifique o webhook'}`)
      }
    } catch (e) {
      toast.error('Erro ao testar webhook', {
        hint: e instanceof Error ? e.message : undefined,
      })
    } finally {
      setTestingGwId(null)
    }
  }

  async function handleDeletePixel() {
    if (!deletingPixel) return
    try {
      await apiSend(`/api/pixels/${deletingPixel.slug}`, 'DELETE', {})
      toast.success(`Pixel ${deletingPixel.name} excluído`)
      mutatePixels()
    } catch (e) {
      toast.error('Erro ao excluir pixel', {
        hint: e instanceof Error ? e.message : undefined,
      })
    } finally {
      setDeletingPixel(null)
    }
  }

  async function handleDeleteGateway() {
    if (!deletingGateway) return
    try {
      await apiSend(`/api/gateways/${deletingGateway.id}`, 'DELETE', {})
      toast.success(`Gateway ${deletingGateway.name} excluído`)
      mutateGateways()
      mutatePixels()
    } catch (e) {
      toast.error('Erro ao excluir gateway', {
        hint: e instanceof Error ? e.message : undefined,
      })
    } finally {
      setDeletingGateway(null)
    }
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Cabeçalho Unificado e Limpo */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border/50 pb-5">
        <div>
          <h1 className="text-xl font-bold text-foreground">Pixels & Conversões</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Rastreie visitas com tag única e sincronize seus checkouts para disparar compras na CAPI do TikTok.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setEditingPixel('new')}
            className="flex items-center gap-2 rounded-xl bg-brand-cyan px-4 py-2.5 text-xs font-bold text-black shadow-[0_0_15px_rgba(37,244,238,0.25)] transition-all hover:brightness-110 active:scale-[0.98]"
          >
            <Plus className="size-4 stroke-[2.5]" />
            Novo Pixel
          </button>
        </div>
      </div>

      {/* Seção Principal: Pixels TikTok CAPI */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Target className="size-4 text-brand-cyan" />
            <h2 className="text-sm font-semibold text-foreground">Pixels TikTok & Checkouts Sincronizados</h2>
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {pixels.length}
            </span>
          </div>
        </div>

        {loadingPixels ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="h-44 rounded-2xl border border-border/60 bg-secondary/20 animate-pulse" />
            <div className="h-44 rounded-2xl border border-border/60 bg-secondary/20 animate-pulse" />
          </div>
        ) : pixels.length === 0 ? (
          <GlassCard className="flex flex-col items-center justify-center p-8 text-center border-dashed border-border/80">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-brand-cyan/10 text-brand-cyan mb-3">
              <Target className="size-6" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">Nenhum pixel cadastrado</h3>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm">
              Crie seu primeiro pixel do TikTok, sincronize seu gateway de pagamento e instale o script na sua página.
            </p>
            <button
              type="button"
              onClick={() => setEditingPixel('new')}
              className="mt-4 flex items-center gap-2 rounded-xl bg-brand-cyan px-4 py-2 text-xs font-bold text-black hover:brightness-110 transition-all"
            >
              <Plus className="size-4 stroke-[2.5]" />
              Criar Primeiro Pixel
            </button>
          </GlassCard>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {pixels.map((px) => {
              const linkedGateways = (px.gatewayIds ?? [])
                .map((id) => gatewaysById.get(id))
                .filter(Boolean) as Gateway[]

              return (
                <GlassCard
                  key={px.slug}
                  variant="thick"
                  className="flex flex-col justify-between border-border/80 p-5 transition-all hover:border-border"
                >
                  <div className="flex flex-col gap-4">
                    {/* Linha Superior: Nome, Código e Toggle Ativo */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex flex-col gap-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`size-2.5 rounded-full shrink-0 ${
                              px.active ? 'bg-success shadow-[0_0_8px_var(--success)]' : 'bg-muted-foreground'
                            }`}
                            title={px.active ? 'Pixel ativo' : 'Pixel pausado'}
                          />
                          <h3 className="text-sm font-semibold text-foreground truncate">{px.name}</h3>
                          {px.hasToken ? (
                            <span className="rounded-md bg-success/15 px-2 py-0.5 text-[10px] font-semibold text-success">
                              CAPI Ativa
                            </span>
                          ) : (
                            <span className="rounded-md bg-warning/15 px-2 py-0.5 text-[10px] font-semibold text-warning">
                              Apenas Browser
                            </span>
                          )}
                        </div>

                        {/* Pixel Code com botão de copiar */}
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="font-mono text-xs text-muted-foreground bg-secondary/50 px-2 py-0.5 rounded-md border border-border/60">
                            {px.pixelCode}
                          </span>
                          <button
                            type="button"
                            onClick={() => copyText(px.pixelCode, `code-${px.slug}`, 'Pixel Code copiado!')}
                            className="text-muted-foreground hover:text-foreground transition-colors p-1"
                            title="Copiar Pixel Code"
                          >
                            {copiedId === `code-${px.slug}` ? (
                              <Check className="size-3 text-success" />
                            ) : (
                              <Copy className="size-3" />
                            )}
                          </button>
                        </div>
                      </div>

                      {/* Switch Ativo/Pausado */}
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <span className="text-[11px] font-medium text-muted-foreground">
                          {px.active ? 'Ativo' : 'Pausado'}
                        </span>
                        <input
                          type="checkbox"
                          checked={px.active}
                          onChange={() => handleTogglePixelActive(px)}
                          className="size-4 accent-brand-cyan rounded cursor-pointer"
                        />
                      </label>
                    </div>

                    {/* Bloco Central 1: Gateways Sincronizados & Webhook */}
                    <div className="rounded-xl border border-border/70 bg-secondary/20 p-3.5 flex flex-col gap-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                          <CreditCard className="size-3.5 text-brand-cyan" />
                          Checkout Sincronizado
                        </span>
                        <button
                          type="button"
                          onClick={() => setEditingPixel(px)}
                          className="text-[11px] font-medium text-brand-cyan hover:underline"
                        >
                          {linkedGateways.length > 0 ? 'Alterar' : '+ Sincronizar'}
                        </button>
                      </div>

                      {linkedGateways.length > 0 ? (
                        <div className="flex flex-col gap-2">
                          <div className="flex flex-wrap gap-1.5">
                            {linkedGateways.map((gw) => (
                              <span
                                key={gw.id}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-border/80 bg-background/80 px-2.5 py-1 text-xs font-medium text-foreground"
                              >
                                <span
                                  className="size-2 rounded-full"
                                  style={{ backgroundColor: providerColor(gw.provider) }}
                                />
                                {gw.name}
                              </span>
                            ))}
                          </div>

                          {/* URL do Webhook do primeiro gateway vinculado para cópia rápida */}
                          {linkedGateways[0]?.webhookUrl && (
                            <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-input/80 px-2.5 py-1.5 mt-1">
                              <span className="text-[10px] uppercase font-semibold text-muted-foreground shrink-0">
                                Webhook:
                              </span>
                              <input
                                readOnly
                                value={linkedGateways[0].webhookUrl}
                                className="w-full bg-transparent font-mono text-[11px] text-muted-foreground focus:outline-none select-all"
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  copyText(
                                    linkedGateways[0].webhookUrl,
                                    `whk-${px.slug}`,
                                    'Webhook copiado para a área de transferência!',
                                  )
                                }
                                className="flex items-center gap-1 rounded bg-secondary px-2 py-1 text-[11px] font-semibold text-foreground hover:bg-secondary/80 transition-colors shrink-0"
                              >
                                {copiedId === `whk-${px.slug}` ? (
                                  <>
                                    <Check className="size-3 text-success" />
                                    Copiado
                                  </>
                                ) : (
                                  <>
                                    <Copy className="size-3" />
                                    Copiar
                                  </>
                                )}
                              </button>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>Nenhum gateway vinculado a este pixel.</span>
                          <button
                            type="button"
                            onClick={() => setEditingPixel(px)}
                            className="rounded-lg bg-secondary px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-secondary/70 transition-colors"
                          >
                            + Vincular Gateway
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Bloco Central 2: Botão de Instalar Script */}
                    <div className="flex items-center justify-between rounded-xl border border-brand-cyan/25 bg-brand-cyan/5 p-3">
                      <div className="flex items-center gap-2.5">
                        <div className="flex size-8 items-center justify-center rounded-lg bg-brand-cyan/15 text-brand-cyan">
                          <Code2 className="size-4" />
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-foreground">Tag Única no Site</p>
                          <p className="text-[11px] text-muted-foreground">1 linha no &lt;head&gt; da sua página</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setInstallingPixel(px)}
                        className="flex items-center gap-1.5 rounded-lg bg-brand-cyan px-3 py-1.5 text-xs font-bold text-black hover:brightness-110 transition-all shadow-[0_0_12px_rgba(37,244,238,0.2)]"
                      >
                        <Code2 className="size-3.5" />
                        Instalar Script
                      </button>
                    </div>
                  </div>

                  {/* Rodapé de Ações */}
                  <div className="flex items-center justify-between border-t border-border/50 pt-4 mt-4">
                    <button
                      type="button"
                      onClick={() => handleTestPixel(px)}
                      disabled={testingPixelSlug === px.slug}
                      className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                    >
                      <Zap
                        className={`size-3.5 ${
                          testingPixelSlug === px.slug ? 'animate-bounce text-brand-cyan' : 'text-muted-foreground'
                        }`}
                      />
                      {testingPixelSlug === px.slug ? 'Enviando…' : 'Testar Disparo'}
                    </button>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setEditingPixel(px)}
                        className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                      >
                        <Pencil className="size-3.5" />
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeletingPixel(px)}
                        className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-destructive/80 hover:bg-destructive/10 hover:text-destructive transition-colors"
                      >
                        <Trash2 className="size-3.5" />
                        Excluir
                      </button>
                    </div>
                  </div>
                </GlassCard>
              )
            })}
          </div>
        )}
      </div>

      {/* Seção Secundária Integrada: Gateways & Webhooks Conectados */}
      <div className="flex flex-col gap-4 border-t border-border/50 pt-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <CreditCard className="size-4 text-brand-cyan" />
              Checkouts & Gateways Conectados
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              URLs de webhook para colar nos painéis da Kiwify, Hotmart, PerfectPay, Stripe, etc.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setEditingGateway('new')}
            className="flex items-center gap-1.5 rounded-xl border border-border/80 bg-secondary/40 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary hover:text-foreground transition-all"
          >
            <Plus className="size-3.5" />
            Conectar Checkout
          </button>
        </div>

        {gateways.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/80 p-6 text-center text-xs text-muted-foreground">
            Nenhum gateway conectado ainda. Clique em “Conectar Checkout” ou vincule diretamente ao criar um Pixel.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {gateways.map((gw) => (
              <GlassCard key={gw.id} className="p-4 flex flex-col justify-between gap-3 border-border/70">
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className="size-2.5 rounded-full"
                        style={{ backgroundColor: providerColor(gw.provider) }}
                      />
                      <span className="text-xs font-semibold text-foreground">{gw.name}</span>
                      <span className="text-[10px] font-mono text-muted-foreground uppercase">
                        ({providerName(gw.provider)})
                      </span>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setEditingGateway(gw)}
                        className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                        title="Editar"
                      >
                        <Pencil className="size-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeletingGateway(gw)}
                        className="p-1 text-destructive/70 hover:text-destructive transition-colors"
                        title="Excluir"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </div>
                  </div>

                  {/* Webhook URL Input */}
                  <div className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-input/80 px-2 py-1">
                    <input
                      readOnly
                      value={gw.webhookUrl}
                      className="w-full bg-transparent font-mono text-[11px] text-muted-foreground focus:outline-none select-all"
                    />
                    <button
                      type="button"
                      onClick={() => copyText(gw.webhookUrl, `gw-${gw.id}`, 'Webhook copiado!')}
                      className="p-1 text-muted-foreground hover:text-foreground transition-colors shrink-0"
                      title="Copiar URL do Webhook"
                    >
                      {copiedId === `gw-${gw.id}` ? (
                        <Check className="size-3.5 text-success" />
                      ) : (
                        <Copy className="size-3.5" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-border/40 text-[11px] text-muted-foreground">
                  <span>
                    {gw.lastEventAt ? `Último evento ${timeAgo(gw.lastEventAt)}` : 'Aguardando webhook'}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleTestGateway(gw)}
                    disabled={testingGwId === gw.id}
                    className="font-medium text-brand-cyan hover:underline disabled:opacity-50"
                  >
                    {testingGwId === gw.id ? 'Testando…' : 'Testar Webhook'}
                  </button>
                </div>
              </GlassCard>
            ))}
          </div>
        )}
      </div>

      {/* Histórico Recente de Conversões (Recolhível) */}
      <div className="border-t border-border/50 pt-5">
        <button
          type="button"
          onClick={() => setShowLog((v) => !v)}
          className="flex items-center justify-between w-full text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors py-2"
        >
          <span className="flex items-center gap-2">
            <Clock className="size-3.5" />
            Atividade Recente de Conversões
          </span>
          {showLog ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </button>

        {showLog && (
          <div className="mt-3 rounded-xl border border-border/70 bg-secondary/15 p-4">
            {(!convLog?.log || convLog.log.length === 0) ? (
              <p className="text-xs text-muted-foreground text-center py-4">Nenhuma conversão registrada ainda.</p>
            ) : (
              <div className="flex flex-col gap-2 max-h-60 overflow-y-auto">
                {convLog.log.slice(0, 10).map((row, idx) => (
                  <div
                    key={row.id || idx}
                    className="flex items-center justify-between text-xs py-1.5 border-b border-border/40 last:border-0"
                  >
                    <div className="flex items-center gap-2">
                      <span className="size-1.5 rounded-full bg-success" />
                      <span className="font-semibold text-foreground">{row.event || 'Purchase'}</span>
                      <span className="text-muted-foreground">({row.gateway || 'Webhook'})</span>
                      {row.value != null && (
                        <span className="font-mono text-brand-cyan">
                          R$ {Number(row.value).toFixed(2)}
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] text-muted-foreground">
                      {row.createdAt ? timeAgo(String(row.createdAt)) : 'recentemente'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* MODAL 1: Instalação de Script Ultra-Simplificada (APENAS 1 SCRIPT) */}
      {installingPixel && (
        <SimplifiedPixelInstallModal
          pixel={installingPixel}
          onClose={() => setInstallingPixel(null)}
        />
      )}

      {/* MODAL 2: Configuração do Pixel & Sincronização com Gateway */}
      {editingPixel && (
        <PixelEditorWithGatewaySync
          pixel={editingPixel === 'new' ? null : editingPixel}
          gateways={gateways}
          providers={providers}
          onClose={() => setEditingPixel(null)}
          onSaved={() => {
            setEditingPixel(null)
            mutatePixels()
            mutateGateways()
          }}
        />
      )}

      {/* MODAL 3: Criação/Edição Direta de Gateway */}
      {editingGateway && (
        <DirectGatewayModal
          gateway={editingGateway === 'new' ? null : editingGateway}
          providers={providers}
          onClose={() => setEditingGateway(null)}
          onSaved={() => {
            setEditingGateway(null)
            mutateGateways()
          }}
        />
      )}

      {/* Diálogos de Confirmação de Exclusão */}
      <ConfirmDialog
        open={deletingPixel !== null}
        title={`Excluir pixel "${deletingPixel?.name}"?`}
        description="Esta ação removerá o pixel e o script associado. Eventos anteriores no TikTok não serão apagados."
        confirmLabel="Excluir Pixel"
        tone="danger"
        onConfirm={handleDeletePixel}
        onClose={() => setDeletingPixel(null)}
      />

      <ConfirmDialog
        open={deletingGateway !== null}
        title={`Excluir gateway "${deletingGateway?.name}"?`}
        description="A URL de webhook deixará de responder e as compras enviadas por esta plataforma não serão mais processadas."
        confirmLabel="Excluir Gateway"
        tone="danger"
        onConfirm={handleDeleteGateway}
        onClose={() => setDeletingGateway(null)}
      />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MODAL DE INSTALAÇÃO ULTRA-SIMPLIFICADO (APENAS UM SCRIPT)
// ─────────────────────────────────────────────────────────────────────────────
function SimplifiedPixelInstallModal({
  pixel,
  onClose,
}: {
  pixel: Pixel
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  useModalA11y(true, dialogRef, onClose)

  const pixelUrl = pixel.scriptUrl || (pixel.token ? `/px/${pixel.token}.js` : '')
  const scriptTag = pixelUrl
    ? `<script src="${pixelUrl}" defer></script>`
    : pixel.scriptTag || ''

  function handleCopy() {
    navigator.clipboard.writeText(scriptTag).then(() => {
      setCopied(true)
      toast.success('Script copiado com sucesso!')
      setTimeout(() => setCopied(false), 2500)
    })
  }

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
      <GlassCard
        ref={dialogRef}
        tabIndex={-1}
        variant="thick"
        className="w-full max-w-lg p-0 outline-none overflow-hidden border-border/80 shadow-2xl"
      >
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
            {scriptTag}
          </div>

          <button
            type="button"
            onClick={handleCopy}
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
            Cole esta linha dentro da tag <code className="rounded bg-secondary/80 px-1 py-0.5 text-foreground font-mono">&lt;head&gt;</code> da sua página ou landing page. Visitas, cliques no checkout e deduplicação com a CAPI funcionam automaticamente.
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

// ─────────────────────────────────────────────────────────────────────────────
// MODAL DE CONFIGURAÇÃO DO PIXEL & SINCRONIZAÇÃO COM GATEWAY
// ─────────────────────────────────────────────────────────────────────────────
function PixelEditorWithGatewaySync({
  pixel,
  gateways,
  providers,
  onClose,
  onSaved,
}: {
  pixel: Pixel | null
  gateways: Gateway[]
  providers: GatewayProvider[]
  onClose: () => void
  onSaved: () => void
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
  const [gatewayIds, setGatewayIds] = useState<string[]>(pixel?.gatewayIds ?? [])

  // Criação rápida de gateway inline caso o usuário queira conectar na hora
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
      const providerLabel = providers.find((p) => p.id === newGwProvider)?.label || newGwProvider
      const gwNameToUse = newGwName.trim() || providerLabel
      const res = await apiSend<{ ok: boolean; gateway: { id: string; name: string } }>('/api/gateways', 'POST', {
        name: gwNameToUse,
        provider: newGwProvider,
      })
      if (res.gateway?.id) {
        setGatewayIds((prev) => [...prev, res.gateway.id])
        setShowAddGateway(false)
        setNewGwName('')
        toast.success(`Gateway ${res.gateway.name} conectado e vinculado ao pixel`)
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
      setError('Informe o Pixel Code oficial do TikTok Ads (20 dígitos)')
      return
    }

    setSaving(true)
    setError(null)

    try {
      await apiSend('/api/pixels', 'POST', {
        slug: pixel?.slug,
        name: cleanName,
        pixelCode: cleanCode,
        accessToken: accessToken.trim() || undefined,
        active,
        gatewayIds,
        events: pixel?.events ?? {
          ViewContent: true,
          AddToCart: true,
          InitiateCheckout: true,
          AddPaymentInfo: true,
          CompletePayment: true,
        },
      })
      toast.success(pixel ? 'Pixel atualizado!' : 'Pixel criado com sucesso!')
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar pixel')
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
      <GlassCard
        ref={dialogRef}
        tabIndex={-1}
        variant="thick"
        className="w-full max-w-lg p-0 outline-none overflow-hidden border-border/80 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border/60 px-6 py-5">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              {pixel ? `Configurar Pixel: ${pixel.name}` : 'Novo Pixel & Sincronização'}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Defina seu pixel TikTok e selecione o gateway de checkout vinculado.
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

        <div className="flex flex-col gap-4 p-6 max-h-[80vh] overflow-y-auto">
          {/* Nome */}
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-foreground">Nome do Pixel</span>
            <input
              className={inputCls}
              placeholder="ex: Produto Principal, Oferta TikTok"
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
              Código de 20 caracteres gerado no Gerenciador de Eventos do TikTok.
            </span>
          </label>

          {/* Access Token CAPI */}
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-foreground">Access Token da CAPI</span>
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
                <button
                  type="button"
                  onClick={async () => {
                    const text = await navigator?.clipboard?.readText?.().catch(() => '')
                    if (text) {
                      setAccessToken(text.trim())
                      toast.success('Token colado!')
                    }
                  }}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
                >
                  <ClipboardPaste className="size-3.5" />
                  Colar
                </button>
              </div>
            </div>
            <span className="text-[11px] text-muted-foreground">
              Permite o envio seguro e server-side das compras confirmadas no checkout.
            </span>
          </label>

          {/* Sincronização do Gateway de Pagamento */}
          <div className="rounded-xl border border-border/80 bg-secondary/20 p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <CreditCard className="size-3.5 text-brand-cyan" />
                  Sincronizar Gateway de Pagamento
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Selecione os checkouts que enviarão vendas para este pixel:
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

            {/* Criação Rápida de Gateway Inline */}
            {showAddGateway && (
              <div className="mt-2 rounded-lg border border-border/80 bg-input/80 p-3 flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-foreground">Novo Gateway de Checkout</span>
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
                      <option value="eduzz">Eduzz</option>
                      <option value="generic">Outro / Genérico</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] text-muted-foreground">Nome (opcional)</span>
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
                  {creatingGw ? 'Conectando…' : 'Criar e Vincular ao Pixel'}
                </button>
              </div>
            )}
          </div>

          {/* Ativo Switch */}
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

// ─────────────────────────────────────────────────────────────────────────────
// MODAL DE CRIAÇÃO/EDIÇÃO DIRETA DE GATEWAY
// ─────────────────────────────────────────────────────────────────────────────
function DirectGatewayModal({
  gateway,
  providers,
  onClose,
  onSaved,
}: {
  gateway: Gateway | null
  providers: GatewayProvider[]
  onClose: () => void
  onSaved: () => void
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  useModalA11y(true, dialogRef, onClose)

  const [provider, setProvider] = useState(gateway?.provider ?? providers[0]?.id ?? 'kiwify')
  const [name, setName] = useState(gateway?.name ?? '')
  const [secret, setSecret] = useState('')
  const [showSecret, setShowSecret] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      await apiSend('/api/gateways', 'POST', {
        id: gateway?.id,
        provider,
        name: name.trim() || undefined,
        secret: secret.trim() || undefined,
      })
      toast.success(gateway ? 'Gateway atualizado' : 'Gateway conectado!')
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar gateway')
    } finally {
      setSaving(false)
    }
  }

  const inputCls =
    'w-full rounded-xl border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-brand-cyan/60'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/75 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label={gateway ? 'Editar gateway' : 'Conectar checkout'}
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose()
      }}
    >
      <GlassCard ref={dialogRef} tabIndex={-1} variant="thick" className="w-full max-w-md p-6 outline-none">
        <h2 className="text-base font-semibold text-foreground mb-4">
          {gateway ? `Editar Gateway: ${gateway.name}` : 'Conectar Novo Checkout'}
        </h2>

        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-foreground">Plataforma</span>
            <select className={inputCls} value={provider} onChange={(e) => setProvider(e.target.value)}>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-foreground">Nome de Identificação (opcional)</span>
            <input
              className={inputCls}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ex: Kiwify Oferta Principal"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-foreground">Token Secreto do Webhook (opcional)</span>
            <div className="relative">
              <input
                type={showSecret ? 'text' : 'password'}
                className={`${inputCls} pr-10`}
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder={gateway?.hasSecret ? 'Mantém o atual' : 'Se o checkout exigir segredo'}
              />
              <button
                type="button"
                onClick={() => setShowSecret((v) => !v)}
                className="absolute inset-y-0 right-2 flex items-center p-1 text-muted-foreground hover:text-foreground"
              >
                {showSecret ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </button>
            </div>
          </label>

          {error && (
            <p className="rounded-lg bg-destructive/10 p-2 text-xs text-destructive">{error}</p>
          )}

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-border/50">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="rounded-lg bg-brand-cyan px-4 py-1.5 text-xs font-bold text-black hover:brightness-110 disabled:opacity-50"
            >
              {saving ? 'Salvando…' : 'Salvar Gateway'}
            </button>
          </div>
        </div>
      </GlassCard>
    </div>
  )
}
