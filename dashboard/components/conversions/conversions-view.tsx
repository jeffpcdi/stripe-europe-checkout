'use client'

import { useState, useRef, useMemo, useCallback } from 'react'
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
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ChevronDown,
  ChevronUp,
  Activity,
  ArrowUpRight,
  ShieldCheck,
  HelpCircle,
  ExternalLink,
  Sparkles,
  Info,
  ArrowRight,
} from 'lucide-react'
import { usePixels, useGateways, useConversionLog, apiSend } from '@/lib/api'
import { GlassCard } from '@/components/glass-card'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { toast } from '@/lib/toast'
import { timeAgo, fmtCurrency } from '@/lib/format'
import { useModalA11y } from '@/lib/use-modal-a11y'
import type { Pixel, Gateway, GatewayProvider, ConversionLogRow } from '@/lib/types'

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

const PROVIDER_HELP: Record<string, string> = {
  kiwify: 'Na Kiwify: vá em Apps > Webhooks > Criar Webhook, cole o link abaixo e selecione os eventos de Compra Aprovada.',
  hotmart: 'Na Hotmart: vá em Ferramentas > Webhook (API e Notificações) > Configurações e cadastre a URL gerada.',
  perfectpay: 'Na PerfectPay: vá em Ferramentas > Postbacks > Adicionar Postback e cole o link com evento de Venda Aprovada.',
  cakto: 'Na Cakto: acesse Configurações > Integrações > Webhook e cole o link da sua notificação.',
  stripe: 'Na Stripe: vá em Desenvolvedores > Webhooks > Adicionar endpoint e selecione checkout.session.completed.',
  eduzz: 'Na Eduzz: acesse o menu Integrações > Webhooks e cole o endereço gerado aqui.',
  generic: 'Na sua plataforma: localize as configurações de Webhook ou Postback e cole o link abaixo para receber compras.',
}

function providerColor(id: string): string {
  return PROVIDER_COLORS[id] ?? PROVIDER_COLORS.generic
}

function providerName(id: string): string {
  return PROVIDER_LABELS[id] ?? id.toUpperCase()
}

/** Formata data e hora no fuso de Brasília de forma segura */
function formatLocalTimestamp(date: Date | string): string {
  try {
    const d = typeof date === 'string' ? new Date(date) : date
    if (isNaN(d.getTime())) return 'recentemente'
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(d)
  } catch {
    return 'recentemente'
  }
}

/** Formata valor monetário de conversão de forma consistente */
function formatRowAmount(amount?: number | string | null): string {
  if (amount == null) return '—'
  const num = typeof amount === 'string' ? parseFloat(amount.replace(',', '.')) : amount
  if (isNaN(num)) return '—'
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num)
}

export function ConversionsView() {
  const { data: pxData, mutate: mutatePixels, isLoading: loadingPixels } = usePixels()
  const { data: gwData, mutate: mutateGateways, isLoading: loadingGateways } = useGateways()
  const { data: convLog, mutate: mutateLog, isLoading: loadingLog } = useConversionLog()

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
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [showLog, setShowLog] = useState(false)
  const [showHelpGuide, setShowHelpGuide] = useState(false)
  const [selectedSnippetSlug, setSelectedSnippetSlug] = useState<string | null>(null)

  // Mapa de gateways por ID para busca rápida
  const gatewaysById = useMemo(() => {
    const map = new Map<string, Gateway>()
    for (const g of gateways) {
      map.set(g.id, g)
    }
    return map
  }, [gateways])

  // ── Validação Visual de Sincronização e Detecção de Falhas ──
  const syncValidation = useMemo(() => {
    let lastSuccessDate: Date | null = null
    let lastSuccessOrigin = ''
    let failedGateway: Gateway | null = null
    let failedLogRow: ConversionLogRow | null = null

    // 1. Analisa gateways para identificar o último evento bem-sucedido e falhas
    for (const gw of gateways) {
      const isErr = gw.lastEventStatus === 'error' || gw.lastEventStatus === 'falhou'
      if (isErr && !failedGateway) {
        failedGateway = gw
      }
      if (!isErr && gw.lastEventAt) {
        const d = new Date(gw.lastEventAt)
        if (!isNaN(d.getTime()) && (!lastSuccessDate || d > lastSuccessDate)) {
          lastSuccessDate = d
          lastSuccessOrigin = `Checkout ${gw.name}`
        }
      }
    }

    // 2. Analisa log recente de conversões
    const logs = convLog?.log ?? []
    for (const row of logs) {
      const isErr =
        row.status === 'erro' ||
        row.status === 'falhou' ||
        row.status === 'rejeitado' ||
        (Array.isArray(row.capi) && row.capi.some((c) => !c.ok))

      if (isErr && !failedLogRow) {
        failedLogRow = row
      }

      if (!isErr && row.at) {
        const d = new Date(row.at)
        if (!isNaN(d.getTime()) && (!lastSuccessDate || d > lastSuccessDate)) {
          lastSuccessDate = d
          lastSuccessOrigin = `${row.event || 'Compra'} (${row.gateway || 'Checkout'})`
        }
      }
    }

    const hasFailure = Boolean(failedGateway || failedLogRow)
    let failureDescription = ''
    if (failedGateway) {
      failureDescription = `O link do checkout "${failedGateway.name}" reportou falha na última notificação.`
    } else if (failedLogRow) {
      failureDescription = `Falha ao processar a venda ${
        failedLogRow.orderId ? '#' + failedLogRow.orderId : ''
      } via ${failedLogRow.gateway || 'checkout'}.`
    }

    return {
      lastSuccessDate,
      lastSuccessOrigin,
      hasFailure,
      failureDescription,
      failedGateway,
      failedLogRow,
    }
  }, [gateways, convLog])

  function copyText(text: string, id: string, label = 'Copiado!') {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id)
      toast.success(label)
      setTimeout(() => setCopiedId((curr) => (curr === id ? null : curr)), 2000)
    })
  }

  const handleRefreshAll = useCallback(async () => {
    setIsRefreshing(true)
    try {
      await Promise.all([mutatePixels(), mutateGateways(), mutateLog()])
      toast.success('Status atualizado com sucesso')
    } catch {
      toast.error('Erro ao atualizar status')
    } finally {
      setIsRefreshing(false)
    }
  }, [mutatePixels, mutateGateways, mutateLog])

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
          hint: `Evento de teste processado para o pixel ${px.name}`,
        })
        handleRefreshAll()
      } else {
        toast.error(`Falha no envio ao TikTok: ${res.message || 'Verifique a chave de acesso do pixel'}`)
      }
    } catch (e) {
      toast.error('Erro ao testar envio do pixel', {
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
        toast.success(`Venda simulada com sucesso!`, {
          hint: `Uma compra de teste foi recebida para o checkout ${gw.name}`,
        })
        handleRefreshAll()
      } else {
        toast.error('Falha ao simular compra de teste', {
          hint: res.message,
        })
      }
    } catch (e) {
      toast.error('Erro ao enviar teste de compra', {
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
      toast.success(`Pixel ${deletingPixel.name} removido`)
      mutatePixels()
    } catch (e) {
      toast.error('Erro ao remover pixel', {
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
      toast.success(`Checkout ${deletingGateway.name} removido`)
      mutateGateways()
    } catch (e) {
      toast.error('Erro ao remover checkout', {
        hint: e instanceof Error ? e.message : undefined,
      })
    } finally {
      setDeletingGateway(null)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* ── AÇÕES ── */}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={handleRefreshAll}
          disabled={isRefreshing}
          className="flex items-center gap-1.5 rounded-xl border border-border/80 bg-secondary/40 px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground transition-all disabled:opacity-50"
          title="Recarregar status"
        >
          <RefreshCw className={`size-3.5 ${isRefreshing ? 'animate-spin text-brand-cyan' : ''}`} />
          <span>Atualizar</span>
        </button>

        <button
          type="button"
          onClick={() => setEditingPixel('new')}
          className="btn-primary shadow-[0_0_16px_rgba(34,211,238,0.25)]"
        >
          <Plus className="size-4 stroke-[2.5]" />
          Adicionar Pixel
        </button>
      </div>

      {/* ── RESUMO DOS 3 PASSOS DE CONFIGURAÇÃO ── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {/* Passo 1 Status */}
        <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-card/60 p-3.5">
          <div className={`flex size-8 shrink-0 items-center justify-center rounded-lg font-bold text-xs ${
            pixels.length > 0 ? 'bg-emerald-500/15 text-emerald-400' : 'bg-brand-cyan/15 text-brand-cyan'
          }`}>
            {pixels.length > 0 ? <Check className="size-4 stroke-[3]" /> : '1'}
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-semibold text-foreground truncate">1. Pixel do TikTok</span>
            <span className="text-[11px] text-muted-foreground truncate">
              {pixels.length > 0 ? `${pixels.length} cadastrado(s)` : 'Pendente'}
            </span>
          </div>
        </div>

        {/* Passo 2 Status */}
        <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-card/60 p-3.5">
          <div className={`flex size-8 shrink-0 items-center justify-center rounded-lg font-bold text-xs ${
            gateways.length > 0 ? 'bg-emerald-500/15 text-emerald-400' : 'bg-brand-cyan/15 text-brand-cyan'
          }`}>
            {gateways.length > 0 ? <Check className="size-4 stroke-[3]" /> : '2'}
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-semibold text-foreground truncate">2. Checkouts</span>
            <span className="text-[11px] text-muted-foreground truncate">
              {gateways.length > 0 ? `${gateways.length} conectado(s)` : 'Pendente'}
            </span>
          </div>
        </div>

        {/* Passo 3 Status */}
        <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-card/60 p-3.5">
          <div className={`flex size-8 shrink-0 items-center justify-center rounded-lg font-bold text-xs ${
            pixels.length > 0 ? 'bg-emerald-500/15 text-emerald-400' : 'bg-muted text-muted-foreground'
          }`}>
            {pixels.length > 0 ? <Check className="size-4 stroke-[3]" /> : '3'}
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-semibold text-foreground truncate">3. Código no Site</span>
            <span className="text-[11px] text-muted-foreground truncate">
              {pixels.length > 0 ? 'Pronto para colar' : 'Aguardando Pixel'}
            </span>
          </div>
        </div>
      </div>

      {/* ── STATUS COMPACTO DE FALHA (SE HOUVER) ── */}
      {syncValidation.hasFailure ? (
        <div className="flex flex-col gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <span className="status-dot status-dot--err status-dot--pulse" />
            <span className="text-xs font-semibold text-destructive">
              {syncValidation.failureDescription}
            </span>
          </div>
          <div className="flex items-center gap-2 self-end sm:self-auto">
            {syncValidation.failedGateway && (
              <button
                type="button"
                onClick={() => handleTestGateway(syncValidation.failedGateway!)}
                disabled={testingGwId === syncValidation.failedGateway.id}
                className="rounded-lg bg-destructive px-2.5 py-1 text-xs font-bold text-destructive-foreground hover:brightness-110 disabled:opacity-50"
              >
                {testingGwId === syncValidation.failedGateway.id ? 'Testando…' : 'Testar Novamente'}
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowLog(true)}
              className="rounded-lg border border-border/80 bg-secondary/60 px-2.5 py-1 text-xs text-foreground hover:bg-secondary"
            >
              Ver Detalhes
            </button>
          </div>
        </div>
      ) : null}

      {/* ── PASSO 1: PIXELS DO TIKTOK ── */}
      <GlassCard variant="thick" className="flex flex-col gap-4 rounded-2xl border border-border/70 p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-border/40 pb-3.5">
          <div className="flex items-center gap-2.5">
            <span className="flex size-6 items-center justify-center rounded-full bg-brand-cyan/20 text-xs font-bold text-brand-cyan">
              1
            </span>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-foreground">Pixel do TikTok</h2>
              <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                {pixels.length}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setEditingPixel('new')}
            className="flex items-center gap-1.5 self-start sm:self-auto rounded-lg border border-border/80 bg-secondary/40 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary transition-all"
          >
            <Plus className="size-3.5" />
            Adicionar Pixel
          </button>
        </div>

        {loadingPixels ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="h-36 rounded-2xl border border-border/60 bg-secondary/20 animate-pulse" />
            <div className="h-36 rounded-2xl border border-border/60 bg-secondary/20 animate-pulse" />
          </div>
        ) : pixels.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 text-center rounded-xl border border-dashed border-border/80">
            <div className="flex size-10 items-center justify-center rounded-xl bg-brand-cyan/10 text-brand-cyan mb-2">
              <Target className="size-5" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">Nenhum pixel cadastrado</h3>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm">
              Adicione o ID do seu pixel do TikTok para obter o código do site e vincular aos checkouts.
            </p>
            <button
              type="button"
              onClick={() => setEditingPixel('new')}
              className="mt-3.5 btn-primary"
            >
              <Plus className="size-4 stroke-[2.5]" />
              Adicionar Pixel
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {pixels.map((px) => {
              const linkedGateways = (px.gatewayIds ?? [])
                .map((id) => gatewaysById.get(id))
                .filter(Boolean) as Gateway[]

              return (
                <div
                  key={px.slug}
                  className="group flex flex-col justify-between rounded-xl border border-border/70 bg-card/60 p-4 hover:border-border hover:bg-card/80 transition-all gap-3.5"
                >
                  <div className="flex flex-col gap-3">
                    {/* Header do Card: Nome e Status */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-col gap-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`size-2 rounded-full shrink-0 ${
                              px.active ? 'bg-success shadow-[0_0_6px_var(--success)]' : 'bg-muted-foreground'
                            }`}
                          />
                          <h3 className="text-sm font-semibold text-foreground truncate">{px.name}</h3>
                          {px.hasToken ? (
                            <span
                              title="Envio seguro via servidor (CAPI do TikTok), garantindo que nenhuma compra seja perdida por bloqueadores de anúncio."
                              className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400 cursor-help"
                            >
                              <ShieldCheck className="size-3" />
                              Envio via Servidor
                            </span>
                          ) : (
                            <span
                              title="Apenas navegador ativo. Adicione a chave de acesso para envio direto do servidor (CAPI)."
                              className="inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground cursor-help"
                            >
                              Navegador
                            </span>
                          )}
                        </div>

                        {/* Pixel Code com Cópia Rápida */}
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-xs text-muted-foreground bg-secondary/50 px-2 py-0.5 rounded border border-border/50">
                            {px.pixelCode}
                          </span>
                          <button
                            type="button"
                            onClick={() => copyText(px.pixelCode, `code-${px.slug}`, 'Código copiado!')}
                            className="text-muted-foreground hover:text-foreground transition-colors p-1"
                            title="Copiar código do pixel"
                          >
                            {copiedId === `code-${px.slug}` ? (
                              <Check className="size-3 text-success" />
                            ) : (
                              <Copy className="size-3" />
                            )}
                          </button>
                        </div>
                      </div>

                      {/* Switch Ativo */}
                      <label className="flex items-center gap-1.5 cursor-pointer select-none rounded-lg border border-border/60 bg-secondary/20 px-2 py-1">
                        <span className="text-[11px] text-muted-foreground">{px.active ? 'Ativo' : 'Pausado'}</span>
                        <input
                          type="checkbox"
                          checked={px.active}
                          onChange={() => handleTogglePixelActive(px)}
                          className="size-3.5 accent-brand-cyan rounded cursor-pointer"
                        />
                      </label>
                    </div>

                    {/* Checkouts Vinculados */}
                    <div className="flex items-center justify-between text-xs rounded-lg border border-border/60 bg-secondary/20 px-2.5 py-2">
                      <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                        <span className="text-[11px] text-muted-foreground shrink-0">Checkouts:</span>
                        {linkedGateways.length > 0 ? (
                          linkedGateways.map((gw) => (
                            <span
                              key={gw.id}
                              className="rounded bg-background px-1.5 py-0.5 text-[11px] font-medium text-foreground border border-border/50"
                            >
                              {gw.name}
                            </span>
                          ))
                        ) : (
                          <span className="text-[11px] text-muted-foreground italic">Nenhum vinculado</span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => setEditingPixel(px)}
                        className="text-[11px] font-medium text-brand-cyan hover:underline shrink-0 ml-2"
                      >
                        {linkedGateways.length > 0 ? 'Alterar' : 'Vincular'}
                      </button>
                    </div>
                  </div>

                  {/* Rodapé de Ações */}
                  <div className="flex items-center justify-between border-t border-border/40 pt-2.5">
                    <button
                      type="button"
                      onClick={() => setInstallingPixel(px)}
                      className="flex items-center gap-1 text-xs font-semibold text-brand-cyan hover:underline"
                    >
                      <Code2 className="size-3.5" />
                      Código do Site
                    </button>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleTestPixel(px)}
                        disabled={testingPixelSlug === px.slug}
                        className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                        title="Enviar evento de teste para o TikTok"
                      >
                        {testingPixelSlug === px.slug ? 'Testando…' : 'Testar'}
                      </button>
                      <span className="text-border">·</span>
                      <button
                        type="button"
                        onClick={() => setEditingPixel(px)}
                        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Editar
                      </button>
                      <span className="text-border">·</span>
                      <button
                        type="button"
                        onClick={() => setDeletingPixel(px)}
                        className="text-xs text-destructive/80 hover:text-destructive transition-colors"
                      >
                        Excluir
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </GlassCard>

      {/* ── PASSO 2: CHECKOUTS DE PAGAMENTO ── */}
      <GlassCard variant="thick" className="flex flex-col gap-4 rounded-2xl border border-border/70 p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-border/40 pb-3.5">
          <div className="flex items-center gap-2.5">
            <span className="flex size-6 items-center justify-center rounded-full bg-emerald-500/20 text-xs font-bold text-emerald-400">
              2
            </span>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-foreground">Checkouts de Pagamento</h2>
              <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                {gateways.length}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setEditingGateway('new')}
            className="flex items-center gap-1.5 self-start sm:self-auto rounded-lg border border-border/80 bg-secondary/40 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary transition-all"
          >
            <Plus className="size-3.5" />
            Conectar Checkout
          </button>
        </div>

        {gateways.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 text-center rounded-xl border border-dashed border-border/80">
            <div className="flex size-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400 mb-2">
              <CreditCard className="size-5" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">Nenhum checkout conectado</h3>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm">
              Conecte sua plataforma (Kiwify, Hotmart, PerfectPay, Cakto, etc.) para receber compras aprovadas e disparar as conversões.
            </p>
            <button
              type="button"
              onClick={() => setEditingGateway('new')}
              className="mt-3.5 btn-primary"
            >
              <Plus className="size-4 stroke-[2.5]" />
              Conectar Checkout
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {gateways.map((gw) => {
              const isGwError = gw.lastEventStatus === 'error' || gw.lastEventStatus === 'falhou'
              const isGwOk = !isGwError && Boolean(gw.lastEventAt)

              return (
                <div
                  key={gw.id}
                  className="group flex flex-col justify-between rounded-xl border border-border/70 bg-card/60 p-4 hover:border-border hover:bg-card/80 transition-all gap-3"
                >
                  <div className="flex flex-col gap-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className="size-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: providerColor(gw.provider) }}
                        />
                        <span className="text-xs font-semibold text-foreground truncate">{gw.name}</span>
                        <span className="text-[10px] font-mono text-muted-foreground uppercase">
                          ({providerName(gw.provider)})
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setEditingGateway(gw)}
                          className="text-xs text-muted-foreground hover:text-foreground p-1"
                          title="Editar checkout"
                        >
                          <Pencil className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeletingGateway(gw)}
                          className="text-xs text-destructive/70 hover:text-destructive p-1"
                          title="Excluir checkout"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* URL de notificação pronta com 1 botão copiar */}
                    <div className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-input/80 px-2.5 py-1.5">
                      <input
                        readOnly
                        value={gw.webhookUrl}
                        className="w-full bg-transparent font-mono text-[11px] text-muted-foreground focus:outline-none select-all"
                      />
                      <button
                        type="button"
                        onClick={() => copyText(gw.webhookUrl, `gw-${gw.id}`, 'Link copiado!')}
                        className="flex items-center gap-1 rounded bg-secondary px-2 py-1 text-[11px] font-semibold text-foreground hover:bg-secondary/80 transition-colors shrink-0"
                        title="Copiar URL para colar na plataforma"
                      >
                        {copiedId === `gw-${gw.id}` ? (
                          <Check className="size-3 text-success" />
                        ) : (
                          <Copy className="size-3" />
                        )}
                        <span>Copiar</span>
                      </button>
                    </div>
                  </div>

                  {/* Rodapé do Checkout */}
                  <div className="flex items-center justify-between pt-2 border-t border-border/30 text-[11px]">
                    <div className="flex items-center gap-1.5 truncate">
                      {isGwError ? (
                        <span className="text-destructive font-medium truncate">Falha recente</span>
                      ) : isGwOk ? (
                        <span className="text-muted-foreground truncate">Venda {timeAgo(gw.lastEventAt!)}</span>
                      ) : (
                        <span className="text-muted-foreground">Aguardando 1ª compra</span>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => handleTestGateway(gw)}
                      disabled={testingGwId === gw.id}
                      className="font-medium text-brand-cyan hover:underline disabled:opacity-50 shrink-0"
                      title="Dispara uma compra simulada para confirmar a integração"
                    >
                      {testingGwId === gw.id ? 'Simulando…' : 'Simular Venda'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </GlassCard>

      {/* ── PASSO 3: CÓDIGO NO SITE ── */}
      <GlassCard variant="thick" className="flex flex-col gap-4 rounded-2xl border border-border/70 p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-border/40 pb-3.5">
          <div className="flex items-center gap-2.5">
            <span className="flex size-6 items-center justify-center rounded-full bg-blue-500/20 text-xs font-bold text-blue-400">
              3
            </span>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-foreground">Código de Rastreamento no Site</h2>
              <span className="rounded-full bg-brand-cyan/10 px-2 py-0.5 text-[11px] font-medium text-brand-cyan">
                Apenas 1 Linha
              </span>
            </div>
          </div>
        </div>

        {pixels.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/80 p-5 text-center text-xs text-muted-foreground">
            Cadastre um pixel no <strong>Passo 1</strong> acima para gerar automaticamente a linha de código do seu site.
          </div>
        ) : (
          (() => {
            const activeSnippetPixel =
              pixels.find((p) => p.slug === selectedSnippetSlug) || pixels[0]
            const snippetUrl =
              activeSnippetPixel.scriptUrl ||
              (activeSnippetPixel.token ? `/px/${activeSnippetPixel.token}.js` : '')
            const scriptTag = snippetUrl
              ? `<script src="${snippetUrl}" defer></script>`
              : activeSnippetPixel.scriptTag || ''

            return (
              <div className="flex flex-col gap-3">
                {/* Seletor de Pixel caso haja mais de 1 */}
                {pixels.length > 1 && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-muted-foreground">Selecionar Pixel:</span>
                    {pixels.map((p) => (
                      <button
                        key={p.slug}
                        type="button"
                        onClick={() => setSelectedSnippetSlug(p.slug)}
                        className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-all ${
                          activeSnippetPixel.slug === p.slug
                            ? 'bg-foreground text-background font-semibold'
                            : 'bg-secondary/40 text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {p.name}
                      </button>
                    ))}
                  </div>
                )}

                {/* Bloco de Código com Cópia Rápida */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 rounded-xl border border-border/80 bg-black/60 p-3.5">
                  <span className="font-mono text-xs text-brand-cyan select-all break-all">
                    {scriptTag}
                  </span>

                  <button
                    type="button"
                    onClick={() => copyText(scriptTag, 'step3-snippet', 'Código copiado!')}
                    className="flex items-center justify-center gap-1.5 rounded-lg bg-foreground px-4 py-2 text-xs font-bold text-background hover:opacity-90 transition-all shrink-0"
                  >
                    {copiedId === 'step3-snippet' ? (
                      <>
                        <Check className="size-3.5 stroke-[3]" />
                        <span>Copiado!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="size-3.5" />
                        <span>Copiar Código</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Instruções Rápidas */}
                <div className="flex items-start gap-2 rounded-xl border border-border/50 bg-secondary/20 p-3 text-xs text-muted-foreground">
                  <Sparkles className="size-4 text-brand-cyan shrink-0 mt-0.5" />
                  <p className="leading-relaxed">
                    Cole esta linha dentro da tag <code className="rounded bg-secondary/80 px-1 py-0.5 text-foreground font-mono">&lt;head&gt;</code> da sua página de vendas. Visitas, cliques em botões e compras serão rastreados automaticamente.
                  </p>
                </div>
              </div>
            )
          })()
        )}
      </GlassCard>

      {/* ── HISTÓRICO DE VENDAS (COLAPSÁVEL) ── */}
      <div className="border-t border-border/50 pt-4">
        <button
          type="button"
          onClick={() => setShowLog((v) => !v)}
          className="flex items-center justify-between w-full text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors py-1.5"
        >
          <span className="flex items-center gap-2">
            <Clock className="size-3.5 text-brand-cyan" />
            Últimas Vendas Recebidas
          </span>
          {showLog ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </button>

        {showLog && (
          <div className="mt-2.5 rounded-xl border border-border/70 bg-secondary/15 p-3.5">
            {!convLog?.log || convLog.log.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-3">
                Nenhuma venda registrada ainda.
              </p>
            ) : (
              <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto">
                {convLog.log.slice(0, 15).map((row, idx) => {
                  const isErr =
                    row.status === 'erro' ||
                    row.status === 'falhou' ||
                    row.status === 'rejeitado' ||
                    (Array.isArray(row.capi) && row.capi.some((c) => !c.ok))

                  const amountVal = (row as any).value ?? row.amount
                  const eventDate = row.at ?? (row as any).createdAt

                  return (
                    <div
                      key={row.id || idx}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 text-xs py-1.5 px-2 rounded-md border border-border/30 bg-secondary/20 hover:bg-secondary/40 transition-colors"
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`status-dot ${
                            isErr ? 'status-dot--err status-dot--pulse' : 'status-dot--ok'
                          }`}
                        />
                        <span className="font-semibold text-foreground">
                          {row.event === 'Purchase' || !row.event ? 'Compra Confirmada' : row.event}
                        </span>
                        <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                          {row.gateway || 'Checkout'}
                        </span>
                        {row.orderId && (
                          <span className="font-mono text-[10px] text-muted-foreground">
                            #{row.orderId}
                          </span>
                        )}
                        {amountVal != null && (
                          <span className="font-mono font-medium text-brand-cyan">
                            {formatRowAmount(amountVal)}
                          </span>
                        )}
                        <span
                          title="Sincronização de conversão direta com o servidor do TikTok (CAPI)"
                          className={`rounded px-1.5 py-0.2 text-[10px] font-medium cursor-help ${
                            isErr ? 'bg-destructive/15 text-destructive' : 'bg-emerald-500/10 text-emerald-400'
                          }`}
                        >
                          {isErr ? 'TikTok: Falha' : 'TikTok: Enviado'}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span>{eventDate ? timeAgo(String(eventDate)) : 'recentemente'}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── MODAL 1: CÓDIGO DE RASTREAMENTO NO SITE (1 LINHA) ── */}
      {installingPixel && (
        <SimplifiedPixelInstallModal
          pixel={installingPixel}
          onClose={() => setInstallingPixel(null)}
        />
      )}

      {/* ── MODAL 2: ADIÇÃO E EDIÇÃO REESTRUTURADA DE PIXEL ── */}
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
            mutateLog()
          }}
        />
      )}

      {/* ── MODAL 3: CONECTAR CHECKOUT COM INSTRUÇÕES DA PLATAFORMA ── */}
      {editingGateway && (
        <DirectGatewayModal
          gateway={editingGateway === 'new' ? null : editingGateway}
          providers={providers}
          onClose={() => setEditingGateway(null)}
          onSaved={() => {
            setEditingGateway(null)
            mutateGateways()
            mutateLog()
          }}
        />
      )}

      {/* Diálogos de Confirmação de Exclusão */}
      <ConfirmDialog
        open={deletingPixel !== null}
        title={`Excluir pixel "${deletingPixel?.name}"?`}
        description="Esta ação removerá a configuração do pixel. Compras já registradas no TikTok permanecerão salvas lá."
        confirmLabel="Excluir Pixel"
        tone="danger"
        onConfirm={handleDeletePixel}
        onClose={() => setDeletingPixel(null)}
      />

      <ConfirmDialog
        open={deletingGateway !== null}
        title={`Excluir checkout "${deletingGateway?.name}"?`}
        description="O link de notificação deixará de responder e novas compras deste checkout não serão mais recebidas."
        confirmLabel="Excluir Checkout"
        tone="danger"
        onConfirm={handleDeleteGateway}
        onClose={() => setDeletingGateway(null)}
      />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MODAL DE INSTALAÇÃO DO CÓDIGO NO SITE (1 LINHA SIMPLES)
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
      toast.success('Código copiado com sucesso!')
      setTimeout(() => setCopied(false), 2500)
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/75 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label={`Instalar código de ${pixel.name}`}
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
                Código do Pixel: <span className="text-foreground">{pixel.pixelCode}</span>
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
              Código de Rastreamento (Apenas 1 linha)
            </span>
            <span className="rounded-full bg-brand-cyan/10 px-2.5 py-0.5 text-[11px] font-medium text-brand-cyan">
              Instalação Fácil
            </span>
          </div>

          <div className="relative rounded-xl border border-border/80 bg-black/60 p-4 font-mono text-xs leading-relaxed text-foreground break-all select-all">
            {scriptTag}
          </div>

          <button
            type="button"
            onClick={handleCopy}
            className="btn-primary flex w-full items-center justify-center gap-2 py-3 px-4 text-sm font-bold text-black shadow-[0_0_20px_rgba(37,244,238,0.3)] transition-all"
          >
            {copied ? (
              <>
                <Check className="size-4" />
                Código Copiado!
              </>
            ) : (
              <>
                <Copy className="size-4" />
                Copiar Código
              </>
            )}
          </button>

          <div className="rounded-xl border border-border/60 bg-secondary/20 p-3.5 flex flex-col gap-1.5 text-xs text-muted-foreground">
            <p className="font-semibold text-foreground flex items-center gap-1.5">
              <Sparkles className="size-3.5 text-brand-cyan" />
              Onde colar este código?
            </p>
            <p className="leading-relaxed">
              Cole esta linha no início da sua página de vendas (dentro do bloco <code className="rounded bg-secondary/80 px-1 py-0.5 text-foreground font-mono">&lt;head&gt;</code>).
            </p>
            <p className="leading-relaxed">
              Visitas de páginas, cliques nos botões de compra e a sincronização com o TikTok funcionarão automaticamente.
            </p>
          </div>
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
// MODAL REESTRUTURADO: ADIÇÃO E EDIÇÃO DE PIXEL COM VINCULAÇÃO CLARA
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
        toast.success(`Checkout ${res.gateway.name} criado e vinculado ao pixel`)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao criar checkout')
    } finally {
      setCreatingGw(false)
    }
  }

  async function handleSave() {
    const cleanName = name.trim()
    const cleanCode = pixelCode.trim()
    if (!cleanName) {
      setError('Informe um nome para o pixel (ex: Oferta Principal)')
      return
    }
    if (!cleanCode) {
      setError('Informe o código do Pixel do TikTok (código de 20 caracteres)')
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
      toast.success(pixel ? 'Pixel atualizado com sucesso!' : 'Pixel criado com sucesso!')
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
        {/* Cabeçalho do Modal */}
        <div className="flex items-center justify-between border-b border-border/60 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              {pixel ? `Editar Pixel: ${pixel.name}` : 'Novo Pixel'}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Informe os dados do pixel para configurar o rastreamento.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <CircleX className="size-5" />
          </button>
        </div>

        {/* Corpo do Modal */}
        <div className="flex flex-col gap-4 p-6 max-h-[78vh] overflow-y-auto">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-foreground">Nome do Pixel</span>
            <input
              className={inputCls}
              placeholder="ex: Oferta Principal"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={saving}
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-foreground">Código do Pixel (ID do TikTok)</span>
            <input
              className={`${inputCls} font-mono`}
              placeholder="ex: D3VA453C77U53GC01N70"
              value={pixelCode}
              onChange={(e) => setPixelCode(e.target.value)}
              disabled={saving}
            />
          </label>

          {/* Checkouts Vinculados */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground">Checkouts Vinculados</span>
              {!showAddGateway && (
                <button
                  type="button"
                  onClick={() => setShowAddGateway(true)}
                  className="text-xs font-medium text-brand-cyan hover:underline"
                >
                  + Novo Checkout
                </button>
              )}
            </div>

            {gateways.length === 0 && !showAddGateway ? (
              <p className="text-xs text-muted-foreground italic">
                Nenhum checkout conectado ainda.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {gateways.map((g) => {
                  const isChecked = gatewayIds.includes(g.id)
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => toggleGateway(g.id)}
                      className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all ${
                        isChecked
                          ? 'border-brand-cyan/60 bg-brand-cyan/15 text-foreground'
                          : 'border-border/70 bg-secondary/30 text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <span
                        className={`flex size-3.5 items-center justify-center rounded border ${
                          isChecked ? 'border-brand-cyan bg-brand-cyan text-black' : 'border-border'
                        }`}
                      >
                        {isChecked && <Check className="size-2.5 stroke-[3]" />}
                      </span>
                      <span>{g.name}</span>
                    </button>
                  )
                })}
              </div>
            )}

            {/* Criação Rápida de Gateway Inline */}
            {showAddGateway && (
              <div className="mt-1.5 rounded-lg border border-border/80 bg-input/90 p-3 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-foreground">Conectar Checkout</span>
                  <button
                    type="button"
                    onClick={() => setShowAddGateway(false)}
                    className="text-xs text-muted-foreground hover:text-foreground"
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
                      className="rounded-lg border border-border bg-secondary px-2 py-1 text-xs text-foreground"
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
                      <option value="generic">Outro</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] text-muted-foreground">Nome</span>
                    <input
                      type="text"
                      placeholder="ex: Kiwify Principal"
                      value={newGwName}
                      onChange={(e) => setNewGwName(e.target.value)}
                      className="rounded-lg border border-border bg-secondary px-2 py-1 text-xs text-foreground"
                    />
                  </label>
                </div>
                <button
                  type="button"
                  onClick={handleCreateInlineGateway}
                  disabled={creatingGw}
                  className="self-end rounded-lg bg-foreground px-3 py-1 text-xs font-semibold text-background hover:opacity-90 disabled:opacity-50"
                >
                  {creatingGw ? 'Conectando…' : 'Salvar e Vincular'}
                </button>
              </div>
            )}
          </div>

          {/* Chave de Acesso do TikTok */}
          <label className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-foreground">
                Chave de Acesso TikTok (Opcional)
              </span>
              <span
                title="Token de acesso do TikTok para envio seguro via servidor (CAPI), evitando perdas por bloqueadores de anúncios no navegador."
                className="cursor-help text-muted-foreground hover:text-foreground"
              >
                <HelpCircle className="size-3.5" />
              </span>
            </div>
            <div className="relative">
              <input
                type={showToken ? 'text' : 'password'}
                className={`${inputCls} font-mono pr-20`}
                placeholder="Cole a chave de acesso gerada no TikTok"
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
                      toast.success('Chave colada com sucesso!')
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
              Permite o envio seguro das compras direto para o TikTok com alta taxa de entrega.
            </span>
          </label>

          {/* Switch Pixel Ativo */}
          <label className="flex items-center justify-between rounded-xl border border-border/60 bg-secondary/20 p-3">
            <span className="text-xs font-medium text-foreground">Pixel ativo para envio de vendas</span>
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

        {/* Rodapé com botões de ação */}
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
            className="btn-primary"
          >
            {saving ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                Salvando…
              </>
            ) : (
              'Salvar Pixel'
            )}
          </button>
        </div>
      </GlassCard>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MODAL REESTRUTURADO: CONECTAR CHECKOUT COM AJUDA PASSO A PASSO
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
  const [showAdvanced, setShowAdvanced] = useState(Boolean(gateway?.hasSecret))
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
      toast.success(gateway ? 'Checkout atualizado' : 'Checkout conectado com sucesso!')
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar checkout')
    } finally {
      setSaving(false)
    }
  }

  const helpText = PROVIDER_HELP[provider] || PROVIDER_HELP.generic
  const inputCls =
    'w-full rounded-xl border border-border/80 bg-input px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-brand-cyan/60'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/75 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label={gateway ? 'Editar checkout' : 'Conectar checkout'}
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose()
      }}
    >
      <GlassCard ref={dialogRef} tabIndex={-1} variant="thick" className="w-full max-w-lg p-6 outline-none shadow-2xl border-border/80">
        <h2 className="text-base font-semibold text-foreground mb-4">
          {gateway ? `Editar Checkout: ${gateway.name}` : 'Conectar Plataforma de Pagamento'}
        </h2>

        <div className="flex flex-col gap-4">
          {/* Seleção Rápida de Plataforma */}
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold text-foreground">1. Selecione sua Plataforma</span>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {providers.map((p) => {
                const isSelected = provider === p.id
                const color = PROVIDER_COLORS[p.id] || '#94a3b8'
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setProvider(p.id)}
                    className={`flex items-center gap-2 rounded-xl border p-2.5 text-left text-xs font-medium transition-all ${
                      isSelected
                        ? 'border-brand-cyan/80 bg-brand-cyan/10 text-foreground font-semibold shadow-[0_0_12px_rgba(34,211,238,0.15)]'
                        : 'border-border/70 bg-secondary/30 text-muted-foreground hover:bg-secondary hover:text-foreground'
                    }`}
                  >
                    <span className="size-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                    <span className="truncate">{p.label}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Dica da plataforma selecionada */}
          <div className="rounded-xl border border-brand-cyan/30 bg-brand-cyan/5 p-3 text-xs text-muted-foreground flex items-start gap-2.5">
            <HelpCircle className="size-4 shrink-0 text-brand-cyan mt-0.5" />
            <p className="leading-relaxed">{helpText}</p>
          </div>

          {/* Nome para identificação */}
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-foreground">2. Nome para Identificação (opcional)</span>
            <input
              className={inputCls}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`ex: ${providers.find((p) => p.id === provider)?.label || 'Checkout'} Principal`}
            />
          </label>

          {/* Seção Opcional/Avançada para Chave Secreta */}
          <div className="flex flex-col gap-2 border-t border-border/40 pt-2">
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="flex items-center justify-between text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
            >
              <span>Opções Avançadas (Chave Secreta)</span>
              {showAdvanced ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            </button>

            {showAdvanced && (
              <label className="flex flex-col gap-1.5 pt-1">
                <span className="text-xs font-medium text-foreground">Chave Secreta do Webhook (opcional)</span>
                <div className="relative">
                  <input
                    type={showSecret ? 'text' : 'password'}
                    className={`${inputCls} pr-10 font-mono text-xs`}
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    placeholder={gateway?.hasSecret ? 'Mantém a chave atual' : 'Apenas se exigido pela plataforma'}
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecret((v) => !v)}
                    className="absolute inset-y-0 right-2 flex items-center p-1 text-muted-foreground hover:text-foreground"
                  >
                    {showSecret ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  </button>
                </div>
                <span className="text-[11px] text-muted-foreground">
                  A maioria das plataformas não exige chave secreta. Deixe em branco caso não tenha certeza.
                </span>
              </label>
            )}
          </div>

          {error && (
            <p className="rounded-xl bg-destructive/10 border border-destructive/30 p-2.5 text-xs text-destructive">
              {error}
            </p>
          )}

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-border/50">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-3.5 py-2 text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="btn-primary"
            >
              {saving ? 'Conectando…' : 'Salvar e Gerar Link'}
            </button>
          </div>
        </div>
      </GlassCard>
    </div>
  )
}
