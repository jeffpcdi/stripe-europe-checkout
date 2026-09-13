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
  Search,
  Filter,
  Link as LinkIcon,
  SlidersHorizontal,
} from 'lucide-react'
import { usePixels, useGateways, useConversionLog, usePixelHealth, apiSend } from '@/lib/api'
import { ErrorState } from '@/components/error-state'
import { GlassCard } from '@/components/glass-card'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { toast } from '@/lib/toast'
import { timeAgo, fmtCurrency } from '@/lib/format'
import { conversionStatus, conversionAmount, conversionEvent } from '@/lib/conversion-status'
import { useModalA11y } from '@/lib/use-modal-a11y'
import type { Pixel, Gateway, GatewayProvider, ConversionLogRow } from '@/lib/types'

import { PixelCard } from './pixel-card'
import { GatewayCard } from './gateway-card'
import { PixelTestDialog } from './pixel-test-dialog'
import { InstallCheck } from './install-check'
import { EventDeliveryPanel } from './event-delivery-panel'
import { QueueHealthPanel, QuarantinePanel } from '@/components/gateways/queue-health-panel'
import { GatewaySelector } from './gateway-selector'
import { DialogPortal } from '@/components/ui/dialog-portal'
import { LinkGatewaysModal } from './link-gateways-modal'

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

type TabKey = 'pixels' | 'gateways' | 'logs'

export function ConversionsView() {
  const { data: pxData, mutate: mutatePixels, isLoading: loadingPixels, error: pixelsError } = usePixels()
  const { data: gwData, mutate: mutateGateways, isLoading: loadingGateways, error: gatewaysError } = useGateways()
  const { data: convLog, mutate: mutateLog, isLoading: loadingLog, error: logError } = useConversionLog()

  const { data: pixelHealth } = usePixelHealth()
  const [mutatingPixel, setMutatingPixel] = useState<string | null>(null)
  const pixels = pxData?.pixels ?? []
  const gateways = gwData?.gateways ?? []
  const providers = gwData?.providers ?? []

  // Navegação por Abas (foco em Pixels e Checkouts)
  const [activeTab, setActiveTab] = useState<TabKey>('pixels')

  // Filtros e Buscas
  const [pixelSearch, setPixelSearch] = useState('')
  const [gatewaySearch, setGatewaySearch] = useState('')
  const [logFilter, setLogFilter] = useState<'all' | 'success' | 'error'>('all')

  // Estados dos Modais
  const [installingPixel, setInstallingPixel] = useState<Pixel | null>(null)
  const [editingPixel, setEditingPixel] = useState<Pixel | null | 'new'>(null)
  const [editingGateway, setEditingGateway] = useState<Gateway | null | 'new'>(null)
  const [deletingPixel, setDeletingPixel] = useState<Pixel | null>(null)
  const [deletingGateway, setDeletingGateway] = useState<Gateway | null>(null)
  const [linkingPixel, setLinkingPixel] = useState<Pixel | null>(null)

  // Ações de teste e cópia
  const [testingPixel, setTestingPixel] = useState<Pixel | null>(null)
  const testingPixelSlug = testingPixel?.slug || null
  const [testingGwId, setTestingGwId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)

  // Mapa de gateways por ID
  const gatewaysById = useMemo(() => {
    const map = new Map<string, Gateway>()
    for (const g of gateways) {
      map.set(g.id, g)
    }
    return map
  }, [gateways])

  // Validação de sincronização
  const syncValidation = useMemo(() => {
    let lastSuccessDate: Date | null = null
    let failedGateway: Gateway | null = null
    let failedLogRow: ConversionLogRow | null = null

    for (const gw of gateways) {
      const isErr = /erro|error|falh|inválid|invalid|rejeitad/i.test(gw.lastEventStatus || '')
      if (isErr && !failedGateway) failedGateway = gw
      if (/^ok\b/i.test(gw.lastEventStatus || '') && gw.lastEventAt) {
        const d = new Date(gw.lastEventAt)
        if (!isNaN(d.getTime()) && (!lastSuccessDate || d > lastSuccessDate)) {
          lastSuccessDate = d
        }
      }
    }

    const logs = convLog?.log ?? []
    for (const row of logs) {
      const isErr = conversionStatus(row).kind === 'error'

      if (isErr && !failedLogRow) failedLogRow = row
      if (conversionStatus(row).kind === 'success' && row.at) {
        const d = new Date(row.at)
        if (!isNaN(d.getTime()) && (!lastSuccessDate || d > lastSuccessDate)) {
          lastSuccessDate = d
        }
      }
    }

    const hasFailure = Boolean(failedGateway || failedLogRow)
    let failureDescription = ''
    if (failedGateway) {
      failureDescription = `O checkout "${failedGateway.name}" reportou falha na última notificação.`
    } else if (failedLogRow) {
      failureDescription = `Falha ao processar conversão ${
        failedLogRow.orderId ? '#' + failedLogRow.orderId : ''
      } via ${failedLogRow.gateway || 'checkout'}.`
    }

    return {
      lastSuccessDate,
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
    }).catch(() => toast.error('Não foi possível copiar. Selecione o texto e copie manualmente.'))
  }

  const handleRefreshAll = useCallback(async () => {
    setIsRefreshing(true)
    try {
      await Promise.all([mutatePixels(), mutateGateways(), mutateLog()])
      toast.success('Status atualizado')
    } catch {
      toast.error('Erro ao atualizar status')
    } finally {
      setIsRefreshing(false)
    }
  }, [mutatePixels, mutateGateways, mutateLog])

  async function handleTogglePixelActive(px: Pixel) {
    if (mutatingPixel) return
    setMutatingPixel(px.slug)
    const nextState = !px.active
    try {
      await apiSend('/api/pixels', 'POST', {
        slug: px.slug,
        active: nextState,
      })
      toast.success(nextState ? `Pixel ${px.name} ativado` : `Pixel ${px.name} pausado`)
      await mutatePixels()
    } catch (e) {
      toast.error('Erro ao alterar status do pixel', {
        hint: e instanceof Error ? e.message : undefined,
      })
    } finally { setMutatingPixel(null) }
  }

  function handleTestPixel(px: Pixel) { setTestingPixel(px) }

  async function handleTestGateway(gw: Gateway) {
    if (testingGwId) return
    setTestingGwId(gw.id)
    try {
      const res = await apiSend<{ ok: boolean; message?: string }>(`/api/gateways/${gw.id}/test`, 'POST', {})
      if (res.ok) {
        toast.success(`Teste interno concluído`, {
          hint: `O teste não envia ao TikTok nem contabiliza receita. Checkout: ${gw.name}`,
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
      await apiSend(`/api/pixels/${deletingPixel.slug}`, 'DELETE')
      toast.success(`Pixel "${deletingPixel.name}" excluído`)
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
      await apiSend(`/api/gateways/${deletingGateway.id}`, 'DELETE')
      toast.success(`Checkout "${deletingGateway.name}" excluído`)
      mutateGateways()
    } catch (e) {
      toast.error('Erro ao excluir checkout', {
        hint: e instanceof Error ? e.message : undefined,
      })
    } finally {
      setDeletingGateway(null)
    }
  }

  // Filtragem de pixels
  const filteredPixels = useMemo(() => {
    if (!pixelSearch.trim()) return pixels
    const term = pixelSearch.toLowerCase()
    return pixels.filter(
      (p) =>
        p.name.toLowerCase().includes(term) ||
        p.pixelCode.toLowerCase().includes(term) ||
        p.slug.toLowerCase().includes(term)
    )
  }, [pixels, pixelSearch])

  // Filtragem de gateways
  const filteredGateways = useMemo(() => {
    if (!gatewaySearch.trim()) return gateways
    const term = gatewaySearch.toLowerCase()
    return gateways.filter(
      (g) =>
        g.name.toLowerCase().includes(term) ||
        g.provider.toLowerCase().includes(term)
    )
  }, [gateways, gatewaySearch])

  // Filtragem de logs
  const filteredLogs = useMemo(() => {
    const logs = convLog?.log ?? []
    if (logFilter === 'all') return logs
    return logs.filter((r) => {
      return conversionStatus(r).kind === logFilter
    })
  }, [convLog, logFilter])

  if ((!pxData && pixelsError) || (!gwData && gatewaysError)) return <ErrorState title="Não foi possível carregar as conexões" onRetry={handleRefreshAll} />

  return (
    <div className="flex flex-col gap-5">
      {(pixelsError || gatewaysError || logError) && (
        <button
          type="button"
          className="btn-ghost self-start text-xs text-warning"
          onClick={handleRefreshAll}
        >
          Conexões não sincronizadas · clique para tentar novamente
        </button>
      )}

      {/* ── CABEÇALHO LIMPO E DIRETO ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-foreground tracking-tight">Pixels &amp; Conversões</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Conecte seus pixels do TikTok e vincule aos seus checkouts de venda.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={handleRefreshAll}
            disabled={isRefreshing}
            className="p-2 rounded-xl border border-border/80 bg-secondary/30 text-muted-foreground hover:text-foreground hover:bg-secondary transition-all disabled:opacity-50"
            title="Atualizar dados"
          >
            <RefreshCw className={`size-4 ${isRefreshing ? 'animate-spin text-brand-cyan' : ''}`} />
          </button>

          <button
            type="button"
            onClick={() => setEditingGateway('new')}
            className="flex items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2 text-xs font-semibold text-emerald-400 hover:bg-emerald-500/20 transition-all"
          >
            <CreditCard className="size-3.5" />
            <span>Conectar Checkout</span>
          </button>

          <button
            type="button"
            onClick={() => setEditingPixel('new')}
            className="btn-primary"
          >
            <Plus className="size-3.5 stroke-[2.5]" />
            <span>Novo Pixel</span>
          </button>
        </div>
      </div>

      {/* ── ALERTA DE FALHA (SE HOUVER) ── */}
      {syncValidation.hasFailure && (
        <div className="flex flex-col gap-2 rounded-2xl border border-destructive/40 bg-destructive/10 p-3.5 sm:flex-row sm:items-center sm:justify-between">
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
                className="rounded-lg bg-destructive px-3 py-1 text-xs font-bold text-destructive-foreground hover:brightness-110 disabled:opacity-50 transition-all"
              >
                {testingGwId === syncValidation.failedGateway.id ? 'Testando…' : 'Testar novamente'}
              </button>
            )}
            <button
              type="button"
              onClick={() => setActiveTab('logs')}
              className="rounded-lg border border-border/80 bg-secondary/60 px-2.5 py-1 text-xs text-foreground hover:bg-secondary transition-all"
            >
              Ver Detalhes
            </button>
          </div>
        </div>
      )}

      {/* ── NAVEGAÇÃO LIMPA POR APENAS 3 ABAS ── */}
      <div className="flex items-center gap-2 border-b border-border/40 pb-2">
        <button
          type="button"
          onClick={() => setActiveTab('pixels')}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all ${
            activeTab === 'pixels'
              ? 'bg-foreground text-background shadow-sm'
              : 'text-muted-foreground hover:text-foreground hover:bg-secondary/40'
          }`}
        >
          <Target className="size-3.5" />
          <span>Pixels do TikTok</span>
          <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
            activeTab === 'pixels' ? 'bg-background/20 text-background' : 'bg-secondary text-muted-foreground'
          }`}>
            {pixels.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('gateways')}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all ${
            activeTab === 'gateways'
              ? 'bg-foreground text-background shadow-sm'
              : 'text-muted-foreground hover:text-foreground hover:bg-secondary/40'
          }`}
        >
          <CreditCard className="size-3.5" />
          <span>Checkouts &amp; Webhooks</span>
          <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
            activeTab === 'gateways' ? 'bg-background/20 text-background' : 'bg-secondary text-muted-foreground'
          }`}>
            {gateways.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('logs')}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all ${
            activeTab === 'logs'
              ? 'bg-foreground text-background shadow-sm'
              : 'text-muted-foreground hover:text-foreground hover:bg-secondary/40'
          }`}
        >
          <Clock className="size-3.5" />
          <span>Vendas Recebidas</span>
          {convLog?.log && convLog.log.length > 0 && (
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
              activeTab === 'logs' ? 'bg-background/20 text-background' : 'bg-secondary text-muted-foreground'
            }`}>
              {convLog.log.length}
            </span>
          )}
        </button>
      </div>

      {/* ── CONTEÚDO DAS ABAS ── */}

      {/* 1. ABA: PIXELS DO TIKTOK */}
      {activeTab === 'pixels' && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Cada pixel possui seu código de instalação no site e pode receber compras de todos ou apenas de checkouts específicos.
            </p>

            <div className="flex items-center gap-2">
              <div className="relative w-full sm:w-60">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Buscar pixel…"
                  value={pixelSearch}
                  onChange={(e) => setPixelSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-border/80 bg-input text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-brand-cyan/60"
                />
              </div>

              <button
                type="button"
                onClick={() => setEditingPixel('new')}
                className="btn-primary shrink-0 text-xs py-1.5"
              >
                <Plus className="size-3.5" />
                Novo Pixel
              </button>
            </div>
          </div>

          {loadingPixels ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="h-40 rounded-2xl border border-border/60 bg-secondary/20 animate-pulse" />
              <div className="h-40 rounded-2xl border border-border/60 bg-secondary/20 animate-pulse" />
            </div>
          ) : filteredPixels.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-10 text-center rounded-2xl border border-dashed border-border/80 bg-card/40">
              <Target className="size-10 text-muted-foreground/60 mb-2" />
              <h3 className="text-sm font-bold text-foreground">
                {pixelSearch ? 'Nenhum pixel encontrado' : 'Nenhum pixel cadastrado'}
              </h3>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                {pixelSearch
                  ? 'Tente buscar com outro termo ou limpe a busca.'
                  : 'Adicione seus pixels do TikTok para gerar os códigos e receber as vendas dos seus checkouts.'}
              </p>
              {!pixelSearch && (
                <button
                  type="button"
                  onClick={() => setEditingPixel('new')}
                  className="btn-primary mt-4 text-xs"
                >
                  <Plus className="size-3.5" />
                  Cadastrar Primeiro Pixel
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {filteredPixels.map((px) => (
                <PixelCard
                  key={px.slug}
                  pixel={px}
                  busy={mutatingPixel === px.slug}
                  coverage={pixelHealth?.coverage?.find(row => row.slug === px.slug)}
                  gatewaysById={gatewaysById}
                  copiedId={copiedId}
                  testingPixelSlug={testingPixelSlug}
                  onCopyText={copyText}
                  onToggleActive={handleTogglePixelActive}
                  onTestPixel={handleTestPixel}
                  onEditPixel={(p) => setEditingPixel(p)}
                  onDeletePixel={(p) => setDeletingPixel(p)}
                  onInstallPixel={(p) => setInstallingPixel(p)}
                  onOpenLinkModal={(p) => setLinkingPixel(p)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* 2. ABA: CHECKOUTS & WEBHOOKS */}
      {activeTab === 'gateways' && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Copie o link do webhook e cole na Kiwify, Hotmart, PerfectPay ou qualquer outra plataforma para receber as compras.
            </p>

            <div className="flex items-center gap-2">
              <div className="relative w-full sm:w-60">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Buscar checkout…"
                  value={gatewaySearch}
                  onChange={(e) => setGatewaySearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-border/80 bg-input text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-brand-cyan/60"
                />
              </div>

              <button
                type="button"
                onClick={() => setEditingGateway('new')}
                className="flex items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-400 hover:bg-emerald-500/20 transition-all shrink-0"
              >
                <Plus className="size-3.5" />
                Conectar Checkout
              </button>
            </div>
          </div>

          {loadingGateways ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              <div className="h-40 rounded-2xl border border-border/60 bg-secondary/20 animate-pulse" />
              <div className="h-40 rounded-2xl border border-border/60 bg-secondary/20 animate-pulse" />
            </div>
          ) : filteredGateways.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-10 text-center rounded-2xl border border-dashed border-border/80 bg-card/40">
              <CreditCard className="size-10 text-emerald-400/60 mb-2" />
              <h3 className="text-sm font-bold text-foreground">
                {gatewaySearch ? 'Nenhum checkout encontrado' : 'Nenhum checkout conectado'}
              </h3>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                {gatewaySearch
                  ? 'Tente buscar com outro termo.'
                  : 'Conecte sua plataforma de pagamento (Kiwify, Hotmart, PerfectPay, Cakto, Stripe, etc.) para capturar vendas.'}
              </p>
              {!gatewaySearch && (
                <button
                  type="button"
                  onClick={() => setEditingGateway('new')}
                  className="btn-primary mt-4 text-xs"
                >
                  <Plus className="size-3.5" />
                  Conectar Checkout
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filteredGateways.map((gw) => (
                <GatewayCard
                  key={gw.id}
                  gateway={gw}
                  pixels={pixels}
                  copiedId={copiedId}
                  testingGwId={testingGwId}
                  onCopyText={copyText}
                  onTestGateway={handleTestGateway}
                  onEditGateway={(g) => setEditingGateway(g)}
                  onDeleteGateway={(g) => setDeletingGateway(g)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* 3. ABA: VENDAS RECEBIDAS */}
      {activeTab === 'logs' && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Eventos recebidos dos checkouts. O envio só aparece confirmado após a resposta do TikTok.
            </p>

            <div className="flex items-center gap-1 rounded-xl bg-secondary/50 p-1 border border-border/60">
              <button
                type="button"
                onClick={() => setLogFilter('all')}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                  logFilter === 'all' ? 'bg-foreground text-background font-bold' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Todas
              </button>
              <button
                type="button"
                onClick={() => setLogFilter('success')}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                  logFilter === 'success' ? 'bg-emerald-500 text-white font-bold' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Aprovadas
              </button>
              <button
                type="button"
                onClick={() => setLogFilter('error')}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                  logFilter === 'error' ? 'bg-destructive text-white font-bold' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Com Falha
              </button>
            </div>
          </div>

          {filteredLogs.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 text-center rounded-2xl border border-dashed border-border/80 bg-card/40">
              <Clock className="size-10 text-muted-foreground/50 mb-2" />
              <h3 className="text-sm font-bold text-foreground">Nenhuma venda registrada ainda</h3>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                Vá na aba &quot;Checkouts &amp; Webhooks&quot; e clique em <strong>Simular Venda</strong> para ver uma compra de teste aparecer aqui na hora!
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {filteredLogs.map((row, idx) => {
                const outcome = conversionStatus(row)
                const isErr = outcome.kind === 'error'

                const eventDate = row.at ?? (row as any).createdAt

                return (
                  <div
                    key={row.id || idx}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs py-3 px-4 rounded-2xl border border-border/50 bg-card/60 hover:bg-card/90 transition-all shadow-sm"
                  >
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span
                        className={`status-dot ${
                          isErr ? 'status-dot--err' : outcome.kind === 'success' ? 'status-dot--ok' : ''
                        }`}
                      />
                      <span className="font-bold text-foreground">
                        {conversionEvent(row.event)}
                      </span>
                      <span className="rounded-md bg-secondary px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
                        {row.gateway || 'Checkout'}
                      </span>
                      {row.orderId && (
                        <span className="font-mono text-[10px] text-muted-foreground bg-black/40 px-2 py-0.5 rounded border border-white/5">
                          #{row.orderId}
                        </span>
                      )}
                      {row.amount != null && (
                        <span className="font-mono font-bold text-brand-cyan">
                          {conversionAmount(row)}
                        </span>
                      )}
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${
                          isErr
                            ? 'bg-destructive/15 text-destructive border border-destructive/30'
                            : outcome.kind === 'success' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-secondary text-muted-foreground border border-border'
                        }`}
                      >
                        <ShieldCheck className="size-3" />
                        {outcome.label}
                      </span>
                    </div>

                    {Array.isArray(row.capi) && row.capi.some(result => !result.ok) && <p className="text-xs text-destructive">{row.capi.filter(result => !result.ok).map(result => `${result.pixel}: ${result.message || 'Envio não confirmado'}`).join(' · ')}</p>}
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground shrink-0">
                      <span>{eventDate ? timeAgo(String(eventDate)) : 'recentemente'}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {activeTab === 'logs' && <><EventDeliveryPanel pixels={pixels} /><details className="rounded-xl border border-border p-4"><summary className="text-sm cursor-pointer">Fila e notificações recusadas</summary><div className="mt-4 flex flex-col gap-4"><QueueHealthPanel /><QuarantinePanel /></div></details></>}

      {testingPixel && <PixelTestDialog pixel={testingPixel} onClose={() => setTestingPixel(null)} onSent={() => { void mutateLog(); void mutatePixels() }} />}
      {/* ── MODAL: CÓDIGO DO SITE ── */}
      {installingPixel && (
        <SimplifiedPixelInstallModal
          pixel={installingPixel}
          onClose={() => setInstallingPixel(null)}
        />
      )}

      {/* ── MODAL: VINCULAR CHECKOUTS AO PIXEL ── */}
      {linkingPixel && (
        <LinkGatewaysModal
          pixel={linkingPixel}
          gateways={gateways}
          onClose={() => setLinkingPixel(null)}
          onSaved={() => {
            setLinkingPixel(null)
            mutatePixels()
          }}
        />
      )}

      {/* ── MODAL: EDITAR / CRIAR PIXEL ── */}
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

      {/* ── MODAL: EDITAR / CONECTAR CHECKOUT ── */}
      {editingGateway && (
        <DirectGatewayModal
          gateway={editingGateway === 'new' ? null : editingGateway}
          providers={providers}
          pixels={pixels}
          onClose={() => setEditingGateway(null)}
          onSaved={() => {
            setEditingGateway(null)
            mutateGateways()
            mutatePixels()
            mutateLog()
          }}
        />
      )}

      {/* ── DIÁLOGOS DE CONFIRMAÇÃO DE EXCLUSÃO ── */}
      <ConfirmDialog
        open={deletingPixel !== null}
        title={`Excluir pixel "${deletingPixel?.name}"?`}
        description="Esta ação removerá a configuração deste pixel e suas vinculações. Compras já registradas no TikTok permanecerão salvas lá."
        confirmLabel="Excluir Pixel"
        tone="danger"
        onConfirm={handleDeletePixel}
        onClose={() => setDeletingPixel(null)}
      />

      <ConfirmDialog
        open={deletingGateway !== null}
        title={`Excluir checkout "${deletingGateway?.name}"?`}
        description="O link de webhook exclusivo deixará de responder e novas compras deste checkout não serão mais capturadas."
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
    }).catch(() => toast.error('Não foi possível copiar. Selecione o código e copie manualmente.'))
  }

  return (
    <DialogPortal><div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/80 p-4 backdrop-blur-md"
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
            <div className="flex size-10 items-center justify-center rounded-xl bg-brand-cyan/15 text-brand-cyan border border-brand-cyan/25">
              <Code2 className="size-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">{pixel.name}</h2>
              <p className="font-mono text-xs text-muted-foreground">
                Código: <span className="text-foreground">{pixel.pixelCode}</span>
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
              Tag de Rastreamento (Cole dentro de &lt;head&gt;)
            </span>
            <span className="rounded-full bg-brand-cyan/10 px-2.5 py-0.5 text-[11px] font-medium text-brand-cyan">
              Instalação Simples
            </span>
          </div>

          <div className="relative rounded-xl border border-border/80 bg-black/70 p-4 font-mono text-xs leading-relaxed text-brand-cyan break-all select-all">
            {scriptTag}
          </div>

          <button
            type="button"
            onClick={handleCopy}
            className="btn-primary flex w-full items-center justify-center gap-2 py-3 px-4 text-sm font-bold text-black shadow-[0_0_20px_rgba(37,244,238,0.3)] transition-all"
          >
            {copied ? (
              <>
                <Check className="size-4 stroke-[3]" />
                Código Copiado!
              </>
            ) : (
              <>
                <Copy className="size-4" />
                Copiar Código do Site
              </>
            )}
          </button>

          <div className="rounded-xl border border-border/60 bg-secondary/20 p-3.5 flex flex-col gap-1.5 text-xs text-muted-foreground">
            <p className="font-semibold text-foreground flex items-center gap-1.5">
              <Sparkles className="size-3.5 text-brand-cyan" />
              Onde instalar este código?
            </p>
            <p className="leading-relaxed">
              Cole esta linha no início da sua página de vendas (dentro do bloco <code className="rounded bg-secondary/80 px-1 py-0.5 text-foreground font-mono">&lt;head&gt;</code>).
            </p>
            <p className="leading-relaxed">
              O script registra a jornada no site. As compras são confirmadas pelo webhook dos checkouts vinculados.
            </p>
          </div>
          <InstallCheck pixel={pixel} />
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
    </div></DialogPortal>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MODAL DE EDIÇÃO/CRIAÇÃO DE PIXEL COM VINCULAÇÃO MULTI-GATEWAY
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
  const [events, setEvents] = useState(pixel?.events || { ViewContent: true, AddToCart: true, InitiateCheckout: true, AddPaymentInfo: true, CompletePayment: true })
  const [testEventCode, setTestEventCode] = useState(pixel?.testEventCode || '')
  const [active, setActive] = useState(pixel?.active ?? true)
  const [gatewayIds, setGatewayIds] = useState<string[]>(pixel?.gatewayIds ?? [])
  async function handleSave() {
    const cleanName = name.trim()
    const cleanCode = pixelCode.trim()
    if (!cleanName) {
      setError('Informe um nome para o pixel (ex: Oferta Principal)')
      return
    }
    if (!cleanCode) {
      setError('Informe o código do Pixel do TikTok (código alfanumérico)')
      return
    }

    setSaving(true)
    setError(null)

    try {
      const finalGatewayIds = gatewayIds

      await apiSend('/api/pixels', 'POST', {
        slug: pixel?.slug,
        name: cleanName,
        pixelCode: cleanCode,
        accessToken: accessToken.trim() || undefined,
        active,
        gatewayIds: finalGatewayIds,
        events,
        testEventCode,
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
    <DialogPortal><div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/80 p-4 backdrop-blur-md"
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
        className="w-full max-w-xl p-0 outline-none overflow-hidden border-border/80 shadow-2xl my-8 max-h-[90vh] flex flex-col"
      >
        {/* Cabeçalho */}
        <div className="flex items-center justify-between border-b border-border/60 px-6 py-4 shrink-0">
          <div>
            <h2 className="text-base font-bold text-foreground">
              {pixel ? `Editar Pixel: ${pixel.name}` : 'Novo Pixel TikTok'}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Preencha os dados do pixel e escolha quais checkouts devem enviar vendas para ele.
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

        {/* Corpo com scroll */}
        <div className="flex flex-col gap-4 p-6 overflow-y-auto">
          {/* Nome do Pixel */}
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-foreground">
              Nome do Pixel <span className="text-brand-cyan">*</span>
            </span>
            <input
              className={inputCls}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ex: Oferta Principal, Produto X, Contingência"
            />
          </label>

          {/* Código do Pixel */}
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-foreground">
              Código do Pixel no TikTok <span className="text-brand-cyan">*</span>
            </span>
            <input
              className={`${inputCls} font-mono text-xs`}
              value={pixelCode}
              onChange={(e) => setPixelCode(e.target.value)}
              placeholder="ex: C58LMNOPQR1234567890"
            />
            <span className="text-[11px] text-muted-foreground">
              Encontrado no Gerenciador de Eventos do TikTok Ads.
            </span>
          </label>

          {/* Token de acesso do TikTok */}
          <label className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <ShieldCheck className="size-3.5 text-emerald-400" />
                Token de acesso do TikTok
              </span>
              <span className="text-[10px] text-muted-foreground">Necessário para enviar eventos</span>
            </div>
            <div className="relative">
              <input
                type={showToken ? 'text' : 'password'}
                className={`${inputCls} pr-10 font-mono text-xs`}
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder={pixel?.hasToken ? '•••••••••••••••••••• (Salvo com sucesso)' : 'Cole o token de acesso'}
              />
              <button
                type="button"
                onClick={() => setShowToken((v) => !v)}
                className="absolute inset-y-0 right-2 flex items-center p-1 text-muted-foreground hover:text-foreground"
              >
                {showToken ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            <span className="text-[11px] text-muted-foreground">
              Permite o envio direto das vendas do servidor sem bloqueios de navegador.
            </span>
          </label>

          {/* Switch Ativo / Pausado */}
          <label className="flex items-center justify-between p-3 rounded-xl border border-border/70 bg-secondary/30 cursor-pointer select-none">
            <div className="flex flex-col">
              <span className="text-xs font-semibold text-foreground">Status do Rastreamento</span>
              <span className="text-[11px] text-muted-foreground">
                {active ? 'Envio habilitado para eventos reais' : 'Pixel pausado (ignora disparos)'}
              </span>
            </div>
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="size-4 accent-brand-cyan rounded cursor-pointer"
            />
          </label>

          <details className="rounded-xl border border-border p-3"><summary className="text-sm cursor-pointer">Eventos e modo de teste</summary><div className="mt-3 flex flex-col gap-3">
            {(['ViewContent', 'AddToCart', 'InitiateCheckout', 'AddPaymentInfo', 'CompletePayment'] as const).map(event => <label key={event} className="flex items-center gap-3 min-h-9 text-sm"><input type="checkbox" className="size-4 accent-brand-cyan" checked={events[event] !== false} onChange={e => setEvents(previous => ({ ...previous, [event]: e.target.checked }))} />{conversionEvent(event)}</label>)}
            <p className="text-xs text-muted-foreground">Visitas vêm do script. Carrinho e checkout dependem da ação na página. Pagamento e compra vêm do webhook do checkout.</p>
            <label className="text-xs flex flex-col gap-2">Código de teste do TikTok<input className={inputCls} value={testEventCode} onChange={e => setTestEventCode(e.target.value)} placeholder="Opcional · Test Event Code" /></label>
            <p className="text-xs text-muted-foreground">Usado apenas nos testes do painel. Eventos reais continuam em produção.</p>
          </div></details>
          <GatewaySelector gateways={gateways} selected={gatewayIds} onChange={setGatewayIds} disabled={saving} />

          {error && (
            <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-xs text-destructive">
              {error}
            </p>
          )}
        </div>

        {/* Rodapé */}
        <div className="flex items-center justify-end gap-2.5 border-t border-border/60 bg-secondary/20 px-6 py-4 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-xl px-4 py-2 text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors disabled:opacity-50"
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
    </div></DialogPortal>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MODAL DE CONEXÃO DE CHECKOUT COM SELEÇÃO DIRETA DE PIXELS
// ─────────────────────────────────────────────────────────────────────────────
function DirectGatewayModal({
  gateway,
  providers,
  pixels,
  onClose,
  onSaved,
}: {
  gateway: Gateway | null
  providers: GatewayProvider[]
  pixels: Pixel[]
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
      const res = await apiSend<{ ok: boolean; gateway: Gateway }>('/api/gateways', 'POST', {
        id: gateway?.id,
        provider,
        name: name.trim() || undefined,
        secret: secret.trim() || undefined,
      })

      toast.success(gateway ? 'Checkout atualizado' : 'Checkout cadastrado. Copie o webhook e configure no provedor.')
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar checkout')
      setSaving(false)
    }
  }

  const helpText = PROVIDER_HELP[provider] || PROVIDER_HELP.generic
  const inputCls =
    'w-full rounded-xl border border-border/80 bg-input px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-brand-cyan/60'

  return (
    <DialogPortal><div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/80 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label={gateway ? 'Editar checkout' : 'Conectar checkout'}
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose()
      }}
    >
      <GlassCard
        ref={dialogRef}
        tabIndex={-1}
        variant="thick"
        className="w-full max-w-lg p-6 outline-none shadow-2xl border-border/80 my-8 max-h-[90vh] overflow-y-auto"
      >
        <h2 className="text-base font-bold text-foreground mb-4">
          {gateway ? `Editar Checkout: ${gateway.name}` : 'Conectar Plataforma de Pagamento'}
        </h2>

        <div className="flex flex-col gap-4">
          {/* Seleção de Plataforma */}
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold text-foreground">1. Selecione a Plataforma</span>
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

          {/* Pixels que recebem deste checkout */}
          <p className="text-xs text-muted-foreground">Depois de cadastrar, escolha os checkouts no cartão de cada pixel.</p>

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
    </div></DialogPortal>
  )
}
