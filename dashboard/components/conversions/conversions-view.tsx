'use client'

import { useEffect, useState, useRef, useMemo, useCallback } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useSWRConfig } from 'swr'
import { Modal } from '@/components/ui/modal'
import {
  Plus,
  Copy,
  Check,
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
  ChevronDown,
  ChevronUp,
  HelpCircle,
  ExternalLink,
  Info,
  ArrowRight,
  Search,
  Filter,
  Link as LinkIcon,
  SlidersHorizontal,
} from 'lucide-react'
import { usePixels, useGateways, useConversionLog, usePixelHealth, apiSend, ApiError } from '@/lib/api'
import { ErrorState } from '@/components/error-state'
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
import { Switch } from '@/components/ui/switch'
import { LinkGatewaysModal } from './link-gateways-modal'
import { apiCacheKeyMatches } from '@/lib/cache-consistency'

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
  const { mutate: mutateCache } = useSWRConfig()
  const { data: gwData, mutate: mutateGateways, isLoading: loadingGateways, error: gatewaysError } = useGateways()
  const { data: convLog, mutate: mutateLog, isLoading: loadingLog, error: logError } = useConversionLog()

  const { data: pixelHealth } = usePixelHealth()
  const [mutatingPixel, setMutatingPixel] = useState<string | null>(null)
  const pixels = pxData?.pixels ?? []
  const gateways = gwData?.gateways ?? []
  const providers = gwData?.providers ?? []

  // Navegação por abas é URL-addressable: redirects, onboarding e diagnósticos
  // podem abrir diretamente Pixels, Checkouts ou Entregas.
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const requestedTab = searchParams.get('tab')
  const initialTab: TabKey = requestedTab === 'gateways' || requestedTab === 'logs' ? requestedTab : 'pixels'
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab)

  useEffect(() => {
    const next: TabKey = requestedTab === 'gateways' || requestedTab === 'logs' ? requestedTab : 'pixels'
    setActiveTab((current) => current === next ? current : next)
  }, [requestedTab])

  const selectTab = useCallback((next: TabKey) => {
    setActiveTab(next)
    const params = new URLSearchParams(searchParams.toString())
    if (next === 'pixels') params.delete('tab')
    else params.set('tab', next)
    const query = params.toString()
    router.replace(pathname + (query ? `?${query}` : ''), { scroll: false })
  }, [pathname, router, searchParams])

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
  const [deletingPixelBusy, setDeletingPixelBusy] = useState(false)
  const [deletingGatewayBusy, setDeletingGatewayBusy] = useState(false)
  const [linkingPixel, setLinkingPixel] = useState<Pixel | null>(null)

  // Ações de teste e cópia
  const [testingPixel, setTestingPixel] = useState<Pixel | null>(null)
  const testingPixelSlug = testingPixel?.slug || null
  const [testingGwId, setTestingGwId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const refreshConversionDependents = useCallback(async () => {
    await mutateCache((key) => apiCacheKeyMatches(key, [
      '/api/pixels/health',
      '/api/pixels/durability',
      '/api/overview/health',
    ]))
  }, [mutateCache])

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
    let lastFailureDate: Date | null = null
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
      const status = conversionStatus(row).kind
      const rowAt = row.at ?? (row as any).createdAt
      const d = rowAt ? new Date(String(rowAt)) : null
      if (status === 'error' && d && !isNaN(d.getTime()) && (!lastFailureDate || d > lastFailureDate)) {
        lastFailureDate = d
        failedLogRow = row
      }
      if (status === 'success' && d && !isNaN(d.getTime()) && (!lastSuccessDate || d > lastSuccessDate)) {
        lastSuccessDate = d
      }
    }

    const unresolvedLogFailure = Boolean(failedLogRow && lastFailureDate && (!lastSuccessDate || lastFailureDate >= lastSuccessDate))
    const hasFailure = Boolean(failedGateway || unresolvedLogFailure)
    if (!unresolvedLogFailure) failedLogRow = null
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
      await Promise.all([mutatePixels(), mutateGateways(), mutateLog(), refreshConversionDependents()])
      toast.success('Status atualizado')
    } catch {
      toast.error('Erro ao atualizar status')
    } finally {
      setIsRefreshing(false)
    }
  }, [mutatePixels, mutateGateways, mutateLog, refreshConversionDependents])

  async function handleTogglePixelActive(px: Pixel) {
    if (mutatingPixel) return
    setMutatingPixel(px.slug)
    const nextState = !px.active
    try {
      await apiSend('/api/pixels', 'POST', {
        slug: px.slug,
        active: nextState,
        _baseUpdatedAt: px.updatedAt,
      })
      toast.success(nextState ? `Pixel ${px.name} ativado` : `Pixel ${px.name} pausado`)
      await Promise.allSettled([mutatePixels(), refreshConversionDependents()])
    } catch (e) {
      if (e instanceof ApiError && e.code === 'pixel_revision_conflict') {
        toast.info('Este Pixel foi alterado em outra aba', { hint: e.hint || e.message })
        await mutatePixels()
      } else {
        toast.error('Erro ao alterar status do pixel', {
          hint: e instanceof Error ? e.message : undefined,
        })
      }
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
    if (!deletingPixel || deletingPixelBusy) return
    const target = deletingPixel
    setDeletingPixelBusy(true)
    try {
      const result = await apiSend<{ ok: boolean; warning?: string | null }>(`/api/pixels/${target.slug}`, 'DELETE', {
        _baseUpdatedAt: target.updatedAt,
      })
      setDeletingPixel(null)
      if (result.warning) toast.info(`Pixel "${target.name}" excluído`, { hint: result.warning })
      else toast.success(`Pixel "${target.name}" excluído`)
      // Pixels alimentam a matriz de roteamento e os cartões de checkout.
      // Revalida as duas fontes depois da exclusão confirmada para não deixar
      // outra aba/cartão apontando para um vínculo que já não existe.
      await Promise.allSettled([mutatePixels(), mutateGateways(), refreshConversionDependents()])
    } catch (e) {
      // Mantém o diálogo aberto: o usuário pode corrigir o vínculo informado
      // pelo backend e tentar de novo sem perder o contexto.
      if (e instanceof ApiError && e.code === 'pixel_revision_conflict') {
        toast.info('Este Pixel mudou desde que a exclusão foi aberta', { hint: e.hint || e.message })
        await mutatePixels()
      } else {
        toast.error('Erro ao excluir pixel', {
          hint: e instanceof Error ? e.message : undefined,
        })
      }
    } finally {
      setDeletingPixelBusy(false)
    }
  }

  async function handleDeleteGateway() {
    if (!deletingGateway || deletingGatewayBusy) return
    const target = deletingGateway
    setDeletingGatewayBusy(true)
    try {
      await apiSend(`/api/gateways/${target.id}`, 'DELETE')
      setDeletingGateway(null)
      toast.success(`Checkout "${target.name}" excluído`)
      await Promise.allSettled([mutateGateways(), mutatePixels(), mutateLog(), refreshConversionDependents()])
    } catch (e) {
      // Em especial, o backend pode bloquear a remoção enquanto houver Pixels
      // explicitamente vinculados a este checkout. Não escondemos esse erro.
      toast.error('Erro ao excluir checkout', {
        hint: e instanceof Error ? e.message : undefined,
      })
    } finally {
      setDeletingGatewayBusy(false)
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

  const logSummary = useMemo(() => {
    const rows = convLog?.log ?? []
    let success = 0
    let error = 0
    let revenue = 0
    let lastSuccessfulRow: ConversionLogRow | null = null
    for (const row of rows) {
      const status = conversionStatus(row).kind
      if (status === 'success') {
        success += 1
        revenue += Number(row.amount || 0)
        const currentAt = new Date(String(row.at ?? (row as any).createdAt ?? 0)).getTime()
        const previousAt = lastSuccessfulRow ? new Date(String(lastSuccessfulRow.at ?? (lastSuccessfulRow as any).createdAt ?? 0)).getTime() : 0
        if (!lastSuccessfulRow || currentAt > previousAt) lastSuccessfulRow = row
      } else if (status === 'error') {
        error += 1
      }
    }
    return { total: rows.length, success, error, revenue, lastSuccessfulRow }
  }, [convLog])

  const activePixels = useMemo(() => pixels.filter((pixel) => pixel.active).length, [pixels])

  const trackingReadiness = useMemo(() => {
    const pixelReady = activePixels > 0
    const gatewayReady = gateways.length > 0
    if (syncValidation.hasFailure) return { label: 'Atenção', tone: 'warning' as const, hint: 'Existe ao menos uma falha recente de processamento.' }
    if (pixelReady && gatewayReady && logSummary.success > 0) return { label: 'Operacional', tone: 'success' as const, hint: 'Pixels, checkouts e entregas estão respondendo.' }
    if (pixelReady || gatewayReady) return { label: 'Configurando', tone: 'accent' as const, hint: 'A estrutura já começou, mas ainda faltam sinais completos.' }
    return { label: 'Iniciar', tone: 'default' as const, hint: 'Cadastre o primeiro pixel e conecte um checkout.' }
  }, [activePixels, gateways.length, logSummary.success, syncValidation.hasFailure])

  const trackingNextAction = useMemo(() => {
    if (activePixels === 0) return { label: 'Crie ou ative um Pixel', detail: 'Sem um Pixel ativo, o ROI-NADOS não consegue distribuir eventos para o TikTok.', action: 'pixel' as const }
    if (gateways.length === 0) return { label: 'Conecte um checkout', detail: 'O checkout envia as vendas que alimentam atribuição, ROAS real e automações.', action: 'gateway' as const }
    if (logSummary.success === 0) return { label: 'Valide a primeira entrega', detail: 'A estrutura está configurada, mas ainda não há uma conversão confirmada neste histórico.', action: 'logs' as const }
    return null
  }, [activePixels, gateways.length, logSummary.success])

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

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-tight text-foreground">Pixel &amp; Conversões</h1>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Configure pixels, conecte checkouts e acompanhe a entrega real das conversões.</p>
          </div>
          <button
            type="button"
            onClick={handleRefreshAll}
            disabled={isRefreshing}
            className="btn-ghost self-start px-2.5 py-2 text-xs sm:self-auto"
            title="Atualizar dados"
          >
            <RefreshCw className={`size-3.5 ${isRefreshing ? 'animate-spin text-brand-cyan' : ''}`} />
            Atualizar
          </button>
        </div>

        <div className="grid grid-cols-2 gap-x-5 gap-y-4 border-y border-border/45 py-4 md:grid-cols-4">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Pixels ativos</p>
            <p className="mt-1 text-xl font-semibold tabular-nums tracking-tight text-foreground">{activePixels}/{pixels.length || 0}</p>
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Checkouts</p>
            <p className="mt-1 text-xl font-semibold tabular-nums tracking-tight text-foreground">{gateways.length}</p>
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Última venda</p>
            <p className="mt-1 truncate text-base font-semibold tracking-tight text-foreground">
              {logSummary.lastSuccessfulRow ? timeAgo(String(logSummary.lastSuccessfulRow.at ?? (logSummary.lastSuccessfulRow as any).createdAt)) : 'Sem sinal'}
            </p>
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Saúde</p>
            <p className={`mt-1 text-base font-semibold tracking-tight ${
              trackingReadiness.tone === 'warning' ? 'text-warning' :
              trackingReadiness.tone === 'success' ? 'text-emerald-300' :
              trackingReadiness.tone === 'accent' ? 'text-brand-cyan' : 'text-foreground'
            }`}>
              {trackingReadiness.label}
            </p>
          </div>
        </div>

        {trackingNextAction ? (
          <div className="flex flex-col gap-2 border-b border-border/45 pb-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-foreground">{trackingNextAction.label}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{trackingNextAction.detail}</p>
            </div>
            <button
              type="button"
              className="shrink-0 text-xs font-semibold text-brand-cyan hover:underline"
              onClick={() => {
                if (trackingNextAction.action === 'pixel') { selectTab('pixels'); setEditingPixel('new'); return }
                if (trackingNextAction.action === 'gateway') { selectTab('gateways'); setEditingGateway('new'); return }
                selectTab('logs')
              }}
            >
              {trackingNextAction.action === 'pixel' ? 'Novo Pixel' : trackingNextAction.action === 'gateway' ? 'Conectar checkout' : 'Ver entregas'}
            </button>
          </div>
        ) : null}
      </div>

      {syncValidation.hasFailure ? (
        <div className="flex flex-col gap-3 border-y border-destructive/20 bg-destructive/[0.035] px-1 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-2.5">
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-destructive" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-destructive">Falha recente no rastreamento</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{syncValidation.failureDescription}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3 self-end sm:self-auto">
            {syncValidation.failedGateway ? (
              <button
                type="button"
                onClick={() => handleTestGateway(syncValidation.failedGateway!)}
                disabled={testingGwId === syncValidation.failedGateway.id}
                className="text-xs font-medium text-destructive transition-colors hover:text-destructive/80 disabled:opacity-50"
              >
                {testingGwId === syncValidation.failedGateway.id ? 'Testando…' : 'Testar novamente'}
              </button>
            ) : null}
            <button type="button" onClick={() => selectTab('logs')} className="text-xs font-medium text-foreground transition-colors hover:text-brand-cyan">
              Ver entregas
            </button>
          </div>
        </div>
      ) : null}

      <div className="border-b border-border/50">
        <div className="flex items-center gap-6 overflow-x-auto" role="tablist" aria-label="Áreas de Pixel e Conversões">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'pixels'}
            onClick={() => selectTab('pixels')}
            className={`relative flex shrink-0 items-center gap-2 py-3 text-sm font-medium transition-colors ${activeTab === 'pixels' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <span>Pixels</span>
            <span className="text-xs tabular-nums text-muted-foreground">{pixels.length}</span>
            {activeTab === 'pixels' ? <span className="absolute inset-x-0 bottom-0 h-px bg-brand-cyan" /> : null}
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'gateways'}
            onClick={() => selectTab('gateways')}
            className={`relative flex shrink-0 items-center gap-2 py-3 text-sm font-medium transition-colors ${activeTab === 'gateways' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <span>Checkouts</span>
            <span className="text-xs tabular-nums text-muted-foreground">{gateways.length}</span>
            {activeTab === 'gateways' ? <span className="absolute inset-x-0 bottom-0 h-px bg-brand-cyan" /> : null}
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'logs'}
            onClick={() => selectTab('logs')}
            className={`relative flex shrink-0 items-center gap-2 py-3 text-sm font-medium transition-colors ${activeTab === 'logs' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <span>Entregas</span>
            <span className="text-xs tabular-nums text-muted-foreground">{logSummary.total}</span>
            {activeTab === 'logs' ? <span className="absolute inset-x-0 bottom-0 h-px bg-brand-cyan" /> : null}
          </button>
        </div>
      </div>

      {/* ── CONTEÚDO DAS ABAS ── */}

      {/* 1. ABA: PIXELS DO TIKTOK */}
      {activeTab === 'pixels' && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="text-[15px] font-semibold text-foreground">Pixels do TikTok</h3>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Buscar pixel…"
                  value={pixelSearch}
                  onChange={(e) => setPixelSearch(e.target.value)}
                  className="h-10 w-full rounded-lg border border-border/70 bg-input/70 pl-9 pr-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-brand-cyan/60 focus:ring-1 focus:ring-brand-cyan/25"
                />
              </div>
              <button type="button" onClick={() => setEditingPixel('new')} className="btn-primary h-10 shrink-0 px-3 text-sm">
                <Plus className="size-3.5" />
                Novo Pixel
              </button>
            </div>
          </div>

          {loadingPixels ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" aria-label="Carregando pixels">
              {[0, 1].map((item) => (
                <div key={item} className="rounded-2xl border border-border/50 bg-card/35 p-5">
                  <div className="h-4 w-32 rounded bg-secondary/45" />
                  <div className="mt-5 h-px bg-border/40" />
                  <div className="mt-4 h-3 w-44 rounded bg-secondary/35" />
                  <div className="mt-4 h-px bg-border/40" />
                  <div className="mt-4 h-3 w-56 max-w-full rounded bg-secondary/35" />
                  <div className="mt-5 flex gap-2">
                    <div className="h-9 w-32 rounded-lg bg-secondary/40" />
                    <div className="h-9 w-28 rounded-lg bg-secondary/30" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredPixels.length === 0 ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center px-6 py-10 text-center">
              <h3 className="text-sm font-semibold text-foreground">
                {pixelSearch ? 'Nenhum pixel encontrado' : 'Nenhum pixel cadastrado'}
              </h3>
              <p className="mt-1.5 max-w-md text-sm leading-6 text-muted-foreground">
                {pixelSearch
                  ? 'Tente outro nome ou ID.'
                  : 'Adicione um pixel para rastrear visitas e enviar conversões ao TikTok.'}
              </p>
              {!pixelSearch && (
                <button
                  type="button"
                  onClick={() => setEditingPixel('new')}
                  className="btn-primary mt-4 h-10 px-3 text-sm"
                >
                  <Plus className="size-3.5" />
                  Novo Pixel
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
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="text-[15px] font-semibold text-foreground">Checkouts &amp; webhooks</h3>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Buscar checkout…"
                  value={gatewaySearch}
                  onChange={(e) => setGatewaySearch(e.target.value)}
                  className="h-10 w-full rounded-lg border border-border/70 bg-input/70 pl-9 pr-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-brand-cyan/60 focus:ring-1 focus:ring-brand-cyan/25"
                />
              </div>
              <button type="button" onClick={() => setEditingGateway('new')} className="btn-primary h-10 shrink-0 px-3 text-sm">
                <Plus className="size-3.5" />
                Conectar checkout
              </button>
            </div>
          </div>

          {loadingGateways ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Carregando checkouts">
              {[0, 1].map((item) => (
                <div key={item} className="rounded-2xl border border-border/50 bg-card/35 p-5">
                  <div className="h-4 w-32 rounded bg-secondary/45" />
                  <div className="mt-2 h-3 w-16 rounded bg-secondary/30" />
                  <div className="mt-5 h-px bg-border/40" />
                  <div className="mt-4 h-3 w-44 rounded bg-secondary/35" />
                  <div className="mt-5 h-px bg-border/40" />
                  <div className="mt-4 h-3 w-48 max-w-full rounded bg-secondary/35" />
                  <div className="mt-5 flex items-center justify-between gap-3">
                    <div className="h-3 w-28 rounded bg-secondary/30" />
                    <div className="h-9 w-28 rounded-lg bg-secondary/35" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredGateways.length === 0 ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center px-6 py-10 text-center">
              <h3 className="text-sm font-semibold text-foreground">
                {gatewaySearch ? 'Nenhum checkout encontrado' : 'Nenhum checkout conectado'}
              </h3>
              <p className="mt-1.5 max-w-md text-sm leading-6 text-muted-foreground">
                {gatewaySearch
                  ? 'Tente outro nome ou provedor.'
                  : 'Conecte sua plataforma de pagamento para receber e distribuir vendas.'}
              </p>
              {!gatewaySearch && (
                <button
                  type="button"
                  onClick={() => setEditingGateway('new')}
                  className="btn-primary mt-4 h-10 px-3 text-sm"
                >
                  <Plus className="size-3.5" />
                  Conectar checkout
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
          <section aria-labelledby="delivery-history-title" className="flex flex-col gap-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h3 id="delivery-history-title" className="text-base font-semibold text-foreground">Entregas e confirmações</h3>
              </div>

              <div className="grid grid-cols-3 gap-x-6 gap-y-3 sm:flex sm:items-end sm:gap-8" aria-label="Resumo das entregas">
                <div className="min-w-0">
                  <p className="text-xl font-semibold tabular-nums text-foreground">{logSummary.total}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">Total</p>
                </div>
                <div className="min-w-0">
                  <p className="text-xl font-semibold tabular-nums text-emerald-400">{logSummary.success}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">Aprovadas</p>
                </div>
                <div className="min-w-0">
                  <p className="text-xl font-semibold tabular-nums text-destructive">{logSummary.error}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">Falhas</p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-5 border-b border-border/50" role="group" aria-label="Filtrar entregas">
              <button
                type="button"
                onClick={() => setLogFilter('all')}
                aria-pressed={logFilter === 'all'}
                className={`relative -mb-px border-b-2 px-0 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan/40 ${logFilter === 'all' ? 'border-brand-cyan text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
              >
                Todas
              </button>
              <button
                type="button"
                onClick={() => setLogFilter('success')}
                aria-pressed={logFilter === 'success'}
                className={`relative -mb-px border-b-2 px-0 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan/40 ${logFilter === 'success' ? 'border-brand-cyan text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
              >
                Aprovadas
              </button>
              <button
                type="button"
                onClick={() => setLogFilter('error')}
                aria-pressed={logFilter === 'error'}
                className={`relative -mb-px border-b-2 px-0 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan/40 ${logFilter === 'error' ? 'border-brand-cyan text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
              >
                Com falha
              </button>
            </div>
          </section>

          {filteredLogs.length === 0 ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center px-6 py-10 text-center">
              <h3 className="text-sm font-semibold text-foreground">
                {logSummary.total === 0 ? 'Nenhuma entrega registrada' : 'Nenhuma entrega neste filtro'}
              </h3>
              <p className="mt-1.5 max-w-md text-sm leading-6 text-muted-foreground">
                {logSummary.total === 0
                  ? 'As vendas recebidas pelos checkouts aparecerão aqui.'
                  : 'Não há registros correspondentes no momento.'}
              </p>
              {logSummary.total === 0 ? (
                <p className="mt-1 text-xs text-muted-foreground/80">Use “Testar integração” em um checkout para validar o fluxo.</p>
              ) : logFilter !== 'all' ? (
                <button type="button" onClick={() => setLogFilter('all')} className="mt-3 text-xs font-semibold text-brand-cyan hover:underline">Limpar filtro</button>
              ) : null}
            </div>
          ) : (
            <div className="border-y border-border/50">
              <div className="hidden grid-cols-[minmax(0,1.8fr)_minmax(160px,0.9fr)_minmax(90px,0.55fr)] items-center gap-4 border-b border-border/50 px-1 py-3 text-xs font-medium text-muted-foreground md:grid">
                <span>Evento</span>
                <span>Status</span>
                <span className="text-right">Recebido</span>
              </div>

              <div>
                {filteredLogs.map((row, idx) => {
                  const outcome = conversionStatus(row)
                  const isErr = outcome.kind === 'error'
                  const eventDate = row.at ?? (row as any).createdAt
                  const capiFailures = Array.isArray(row.capi) ? row.capi.filter(result => !result.ok) : []

                  return (
                    <div
                      key={row.id || idx}
                      className="border-b border-border/40 px-1 py-4 last:border-b-0"
                    >
                      <div className="grid gap-3 md:grid-cols-[minmax(0,1.8fr)_minmax(160px,0.9fr)_minmax(90px,0.55fr)] md:items-start md:gap-4">
                        <div className="min-w-0">
                          <div className="flex items-start justify-between gap-3 md:block">
                            <p className="text-sm font-medium text-foreground">{conversionEvent(row.event)}</p>
                            <span className="shrink-0 text-xs text-muted-foreground md:hidden">
                              {eventDate ? timeAgo(String(eventDate)) : 'recentemente'}
                            </span>
                          </div>

                          <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
                            <span>{row.gateway || 'Checkout'}</span>
                            {row.orderId ? (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="font-mono">#{row.orderId}</span>
                              </>
                            ) : null}
                            {row.amount != null ? (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="font-medium tabular-nums text-brand-cyan">{conversionAmount(row)}</span>
                              </>
                            ) : null}
                          </div>
                        </div>

                        <div className="min-w-0">
                          <div className={`inline-flex items-center gap-2 text-xs font-medium ${isErr ? 'text-destructive' : outcome.kind === 'success' ? 'text-emerald-400' : 'text-muted-foreground'}`}>
                            <span
                              className={`size-1.5 shrink-0 rounded-full ${isErr ? 'bg-destructive' : outcome.kind === 'success' ? 'bg-emerald-400' : 'bg-muted-foreground/70'}`}
                              aria-hidden="true"
                            />
                            <span>{outcome.label}</span>
                          </div>

                          {capiFailures.length > 0 ? (
                            <div className="mt-1.5 space-y-1 text-xs leading-5 text-muted-foreground">
                              {capiFailures.map((result, failureIndex) => (
                                <p key={`${row.id || idx}-capi-${failureIndex}`}>
                                  <span className="font-medium text-foreground">{result.pixel}</span>
                                  <span aria-hidden="true"> · </span>
                                  {result.message || 'Envio não confirmado'}
                                </p>
                              ))}
                            </div>
                          ) : null}
                        </div>

                        <div className="hidden text-right text-xs text-muted-foreground md:block">
                          {eventDate ? timeAgo(String(eventDate)) : 'recentemente'}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'logs' && (
        <div className="grid gap-4 xl:grid-cols-[1.2fr,0.8fr]">
          <section className="min-w-0 py-1" aria-labelledby="delivery-diagnostics-title">
            <div className="mb-4">
              <h3 id="delivery-diagnostics-title" className="text-base font-semibold text-foreground">Diagnóstico de entrega</h3>
              <p className="mt-1.5 max-w-2xl text-xs leading-5 text-muted-foreground">Acompanhe os últimos eventos enviados ao TikTok e o resultado de cada Pixel.</p>
            </div>
            <EventDeliveryPanel pixels={pixels} />
          </section>
          <section className="min-w-0 border-y border-border/60 py-1" aria-label="Fila e quarentena">
            <details className="group">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-3 py-3 outline-none transition-colors hover:text-foreground focus-visible:ring-1 focus-visible:ring-primary/60 [&::-webkit-details-marker]:hidden">
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-foreground">Fila e quarentena</span>
                  <span className="mt-1 block text-xs font-normal leading-5 text-muted-foreground">
                    Use este bloco para diagnosticar atrasos, retries ou webhooks recusados.
                  </span>
                </span>
                <ChevronDown className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              <div className="border-t border-border/60 pt-4">
                <QueueHealthPanel appearance="embedded" />
                <QuarantinePanel appearance="embedded" />
              </div>
            </details>
          </section>
        </div>
      )}

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
            void Promise.allSettled([mutatePixels(), refreshConversionDependents()])
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
            void Promise.allSettled([mutatePixels(), mutateGateways(), refreshConversionDependents()])
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
            void Promise.allSettled([mutateGateways(), mutatePixels(), mutateLog(), refreshConversionDependents()])
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
        appearance="quiet"
        busy={deletingPixelBusy}
        onConfirm={handleDeletePixel}
        onClose={() => setDeletingPixel(null)}
      />

      <ConfirmDialog
        open={deletingGateway !== null}
        title={`Excluir checkout "${deletingGateway?.name}"?`}
        description="O link de webhook exclusivo deixará de responder e novas compras deste checkout não serão mais capturadas."
        confirmLabel="Excluir Checkout"
        tone="danger"
        busy={deletingGatewayBusy}
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
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/75 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pixel-install-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="dialog-surface my-8 w-full max-w-lg max-h-[90dvh] overflow-y-auto rounded-2xl border border-border/70 bg-background p-6 shadow-xl outline-none"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id="pixel-install-title" className="text-base font-semibold text-foreground">Instalar no site</h2>
            <p className="mt-1.5 truncate text-sm text-muted-foreground">
              {pixel.name} · <span className="font-mono">{pixel.pixelCode}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="-mr-1 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <CircleX className="size-5" />
          </button>
        </div>

        <div className="mt-5">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Cole esta linha dentro do <code className="font-mono text-foreground">&lt;head&gt;</code> da página.
          </p>

          <div className="mt-3 overflow-x-auto rounded-lg border border-border/70 bg-black/55 p-4 font-mono text-xs leading-relaxed text-foreground select-all">
            {scriptTag}
          </div>

          <button
            type="button"
            onClick={handleCopy}
            className="mt-3 flex min-h-10 items-center justify-center gap-2 rounded-lg bg-brand-cyan px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-brand-cyan/90"
          >
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? 'Copiado' : 'Copiar código'}
          </button>

          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            O script registra a jornada no site. As compras são confirmadas pelo webhook dos checkouts vinculados.
          </p>

          <div className="mt-5">
            <InstallCheck pixel={pixel} />
          </div>
        </div>

        <div className="mt-6 flex justify-end border-t border-border/50 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="min-h-10 rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            Fechar
          </button>
        </div>
      </div>
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
  const savingRef = useRef(false)
  const { mutate } = useSWRConfig()
  useModalA11y(true, dialogRef, onClose)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState(pixel?.name ?? '')
  const [pixelCode, setPixelCode] = useState(pixel?.pixelCode ?? '')
  const [accessToken, setAccessToken] = useState(pixel?.accessToken ?? '')
  const [clearAccessToken, setClearAccessToken] = useState(false)
  const [showToken, setShowToken] = useState(false)
  const [events, setEvents] = useState(pixel?.events || { ViewContent: true, AddToCart: true, InitiateCheckout: true, AddPaymentInfo: true, CompletePayment: true })
  const [testEventCode, setTestEventCode] = useState(pixel?.testEventCode || '')
  const [active, setActive] = useState(pixel?.active ?? true)
  const [gatewayIds, setGatewayIds] = useState<string[]>(pixel?.gatewayIds ?? [])
  async function handleSave() {
    if (savingRef.current) return
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

    savingRef.current = true
    setSaving(true)
    setError(null)

    try {
      const initialGatewayIds = [...(pixel?.gatewayIds ?? [])].sort()
      const finalGatewayIds = [...gatewayIds].sort()
      const gatewayChanged = initialGatewayIds.length !== finalGatewayIds.length
        || initialGatewayIds.some((id, index) => id !== finalGatewayIds[index])
      const gatewayPatch = !pixel || gatewayChanged
        ? { gatewayIds: finalGatewayIds }
        : {}

      const saved = await apiSend<{ ok: boolean; durable?: boolean; warning?: string | null; pixel?: Pixel }>('/api/pixels', 'POST', {
        slug: pixel?.slug,
        _createOnly: !pixel,
        _baseUpdatedAt: pixel?.updatedAt,
        name: cleanName,
        pixelCode: cleanCode,
        accessToken: clearAccessToken ? undefined : (accessToken.trim() || undefined),
        clearAccessToken: clearAccessToken || undefined,
        active,
        ...gatewayPatch,
        events,
        testEventCode,
      })
      if (saved.warning) {
        toast.info(pixel ? 'Pixel atualizado com aviso' : 'Pixel criado com aviso', {
          hint: saved.warning,
          duration: 7000,
        })
      } else {
        toast.success(pixel ? 'Pixel atualizado com sucesso!' : 'Pixel criado com sucesso!')
      }
      onSaved()
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'pixel_revision_conflict' || e.code === 'pixel_create_conflict')) {
        setError(e.hint || e.message)
        await mutate('/api/pixels')
      } else if (e instanceof ApiError && e.code === 'duplicate_pixel_code') {
        setError(e.hint || e.message)
      } else {
        setError(e instanceof Error ? e.message : 'Erro ao salvar pixel')
      }
      savingRef.current = false
      setSaving(false)
    }
  }

  const inputCls =
    'w-full min-h-10 rounded-lg border border-border/80 bg-input px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground transition-colors focus:border-brand-cyan/60 focus:outline-none focus:ring-1 focus:ring-brand-cyan/25 disabled:cursor-not-allowed disabled:opacity-60'

  const trackedEvents = ['ViewContent', 'AddToCart', 'InitiateCheckout', 'AddPaymentInfo', 'CompletePayment'] as const

  return (
    <DialogPortal><div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/80 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={pixel ? `Editar pixel ${pixel.name}` : 'Criar novo pixel TikTok'}
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose()
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="my-8 flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-border/75 bg-background shadow-xl outline-none"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border/50 px-6 py-4">
          <h2 className="text-lg font-semibold text-foreground">
            {pixel ? 'Editar Pixel' : 'Novo Pixel'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Fechar"
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-foreground disabled:opacity-50"
          >
            <CircleX className="size-5" />
          </button>
        </div>

        <div className="overflow-y-auto px-6 py-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-2">
              <span className="text-[13px] font-medium text-foreground">
                Nome <span className="text-brand-cyan">*</span>
              </span>
              <input
                className={inputCls}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="ex: Oferta Principal"
                disabled={saving}
              />
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-[13px] font-medium text-foreground">
                ID do Pixel <span className="text-brand-cyan">*</span>
              </span>
              <input
                className={`${inputCls} font-mono`}
                value={pixelCode}
                onChange={(e) => setPixelCode(e.target.value)}
                placeholder="ex: C58LMNOPQR1234567890"
                disabled={saving}
              />
              <span className="text-xs leading-relaxed text-muted-foreground sm:col-span-2">
                Encontrado no Gerenciador de Eventos do TikTok Ads.
              </span>
            </label>
          </div>

          <section className="mt-6 border-t border-border/50 pt-5">
            <label className="flex flex-col gap-2">
              <span className="text-[13px] font-medium text-foreground">Token de acesso</span>
              <div className="relative">
                <input
                  type={showToken ? 'text' : 'password'}
                  className={`${inputCls} pr-10 font-mono`}
                  value={accessToken}
                  onChange={(e) => {
                    setAccessToken(e.target.value)
                    if (clearAccessToken) setClearAccessToken(false)
                  }}
                  placeholder={pixel?.hasToken ? '•••••••••••••••••••• (token salvo)' : 'Cole o token de acesso'}
                  disabled={saving || clearAccessToken}
                />
                <button
                  type="button"
                  onClick={() => setShowToken((v) => !v)}
                  disabled={saving}
                  aria-label={showToken ? 'Ocultar token' : 'Mostrar token'}
                  className="absolute inset-y-0 right-2 flex items-center p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                >
                  {showToken ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              <span className="text-xs leading-relaxed text-muted-foreground">
                Necessário para enviar eventos pelo servidor.
              </span>
              {pixel?.hasToken && (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-secondary/20 px-3 py-2.5">
                  <span className="text-xs text-muted-foreground">
                    {clearAccessToken ? 'O token será removido ao salvar.' : 'Há um token salvo para este Pixel.'}
                  </span>
                  <button
                    type="button"
                    className="shrink-0 text-xs font-medium text-destructive transition-opacity hover:opacity-80 disabled:opacity-50"
                    disabled={saving}
                    onClick={() => {
                      if (clearAccessToken) {
                        setClearAccessToken(false)
                        setAccessToken(pixel.accessToken || '')
                      } else {
                        setClearAccessToken(true)
                        setAccessToken('')
                        setShowToken(false)
                      }
                    }}
                  >
                    {clearAccessToken ? 'Manter token' : 'Remover token'}
                  </button>
                </div>
              )}
            </label>
          </section>

          <section className="mt-6 border-t border-border/50 pt-5">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">Status do rastreamento</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {active ? 'Ativo · envio de eventos habilitado.' : 'Pausado · os disparos são ignorados.'}
                </p>
              </div>
              <Switch
                checked={active}
                onChange={setActive}
                label="Status do rastreamento"
                disabled={saving}
              />
            </div>
          </section>

          <section className="mt-6 border-t border-border/50 pt-5">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Eventos enviados</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Selecione quais eventos este pixel pode enviar.
              </p>
            </div>

            <div className="mt-3 grid gap-x-6 gap-y-1 sm:grid-cols-2">
              {trackedEvents.map((event) => (
                <label key={event} className="flex min-h-10 cursor-pointer items-center gap-3 text-sm text-foreground">
                  <input
                    type="checkbox"
                    className="size-4 shrink-0 accent-brand-cyan"
                    checked={events[event] !== false}
                    onChange={(e) => setEvents((previous) => ({ ...previous, [event]: e.target.checked }))}
                    disabled={saving}
                  />
                  <span>{conversionEvent(event)}</span>
                </label>
              ))}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Visitas vêm do script. Carrinho e checkout dependem da ação na página. Pagamento e compra vêm do webhook do checkout.
            </p>
          </section>

          <section className="mt-6 border-t border-border/50 pt-5">
            <label className="flex flex-col gap-2">
              <span className="text-[13px] font-medium text-foreground">Código de teste</span>
              <input
                className={inputCls}
                value={testEventCode}
                onChange={(e) => setTestEventCode(e.target.value)}
                placeholder="Opcional · Test Event Code"
                disabled={saving}
              />
              <span className="text-xs leading-relaxed text-muted-foreground">
                Use o código fornecido pelo TikTok Events Manager durante testes. Eventos reais continuam em produção.
              </span>
            </label>
          </section>

          <section className="mt-6 border-t border-border/50 pt-5">
            <GatewaySelector gateways={gateways} selected={gatewayIds} onChange={setGatewayIds} disabled={saving} />
          </section>

          {error && (
            <p className="mt-5 text-sm leading-relaxed text-destructive">
              Não foi possível salvar: {error}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2.5 border-t border-border/50 px-6 py-4 max-sm:flex-col-reverse max-sm:items-stretch">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="min-h-10 rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-foreground disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-brand-cyan px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-brand-cyan/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Salvando…
              </>
            ) : (
              pixel ? 'Salvar alterações' : 'Criar Pixel'
            )}
          </button>
        </div>
      </div>
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

  const selectedProviderLabel = providers.find(item => item.id === provider)?.label || 'a plataforma'
  const helpText = PROVIDER_HELP[provider] || PROVIDER_HELP.generic
  const inputCls =
    'h-11 w-full rounded-lg border border-border/70 bg-input/70 px-3.5 text-sm text-foreground placeholder:text-muted-foreground transition-colors focus:border-brand-cyan/60 focus:outline-none focus:ring-1 focus:ring-brand-cyan/25'

  return (
    <Modal
      isOpen
      onClose={onClose}
      busy={saving}
      title={gateway ? 'Editar checkout' : 'Conectar checkout'}
      description="Conecte a plataforma que enviará as confirmações de pagamento."
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button type="button" className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Salvando…' : gateway ? 'Salvar alterações' : 'Conectar checkout'}
          </button>
        </div>
      }
    >
      <fieldset disabled={saving} className="space-y-5 disabled:opacity-70">
        <div className="space-y-2">
          <label htmlFor="gateway-provider" className="text-[13px] font-medium text-foreground">
            Plataforma
          </label>
          <select
            id="gateway-provider"
            className={inputCls}
            value={provider}
            onChange={event => setProvider(event.target.value)}
          >
            {providers.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </div>

        <details className="group">
          <summary className="cursor-pointer list-none text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-cyan/35">
            Como configurar {selectedProviderLabel}
          </summary>
          <p className="mt-2 text-[13px] leading-5 text-muted-foreground">{helpText}</p>
        </details>

        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor="gateway-name" className="text-[13px] font-medium text-foreground">
              Nome para identificação
            </label>
            <span className="text-xs text-muted-foreground">Opcional</span>
          </div>
          <input
            id="gateway-name"
            className={inputCls}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={`${selectedProviderLabel === 'a plataforma' ? 'Checkout' : selectedProviderLabel} Principal`}
          />
          <p className="text-xs leading-5 text-muted-foreground">Use um nome para diferenciar este checkout.</p>
        </div>

        <p className="text-[13px] leading-5 text-muted-foreground">
          Depois de conectar, você pode vincular este checkout aos Pixels que devem receber as vendas.
        </p>

        {error && (
          <p className="text-[13px] leading-5 text-destructive" role="alert">
            Não foi possível salvar: {error}
          </p>
        )}
      </fieldset>
    </Modal>
  )
}
