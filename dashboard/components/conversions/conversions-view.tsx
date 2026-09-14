'use client'

import { useState, useRef, useMemo, useCallback } from 'react'
import { useSWRConfig } from 'swr'
import { Modal } from '@/components/ui/modal'
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

function TrackingSummaryCard({ title, value, hint, tone = 'default', icon: Icon }: { title: string; value: string; hint: string; tone?: 'default' | 'success' | 'warning' | 'accent'; icon: any }) {
  const toneClass = tone === 'success'
    ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
    : tone === 'warning'
      ? 'border-warning/20 bg-warning/10 text-warning'
      : tone === 'accent'
        ? 'border-brand-cyan/20 bg-brand-cyan/10 text-brand-cyan'
        : 'border-border/60 bg-secondary/20 text-foreground'

  return (
    <div className={`rounded-2xl border p-3.5 ${toneClass}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">{title}</p>
          <p className="mt-2 text-lg font-semibold tracking-tight text-foreground">{value}</p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{hint}</p>
        </div>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-black/20 text-inherit">
          <Icon className="size-4.5" aria-hidden="true" />
        </span>
      </div>
    </div>
  )
}

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
      })
      toast.success(nextState ? `Pixel ${px.name} ativado` : `Pixel ${px.name} pausado`)
      await Promise.allSettled([mutatePixels(), refreshConversionDependents()])
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
    if (!deletingPixel || deletingPixelBusy) return
    const target = deletingPixel
    setDeletingPixelBusy(true)
    try {
      const result = await apiSend<{ ok: boolean; warning?: string | null }>(`/api/pixels/${target.slug}`, 'DELETE')
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
      toast.error('Erro ao excluir pixel', {
        hint: e instanceof Error ? e.message : undefined,
      })
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
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0 flex-1">
            <div className="inline-flex items-center gap-2 rounded-full border border-brand-cyan/20 bg-brand-cyan/10 px-3 py-1 text-[11px] font-medium text-brand-cyan">
              <Activity className="size-3.5" />
              Rastreamento operacional
            </div>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight text-foreground">Conversões, Pixels e Checkouts</h1>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Configure a base do rastreamento, acompanhe a saúde das entregas e valide rapidamente se as vendas estão chegando ao TikTok do jeito certo.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 xl:justify-end">
            <button
              type="button"
              onClick={handleRefreshAll}
              disabled={isRefreshing}
              className="btn-ghost px-3 py-2 text-xs"
              title="Atualizar dados"
            >
              <RefreshCw className={`size-3.5 ${isRefreshing ? 'animate-spin text-brand-cyan' : ''}`} />
              Atualizar
            </button>
            <button type="button" onClick={() => setEditingGateway('new')} className="btn-secondary">
              <CreditCard className="size-3.5" />
              <span>Cadastrar checkout</span>
            </button>
            <button type="button" onClick={() => setEditingPixel('new')} className="btn-primary">
              <Plus className="size-3.5 stroke-[2.5]" />
              <span>Novo Pixel</span>
            </button>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.5fr,1fr]">
          <GlassCard className="p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Resumo do rastreamento</p>
                <h2 className="mt-1 text-sm font-semibold text-foreground">Leitura rápida da operação</h2>
              </div>
              <span className="rounded-full border border-white/10 bg-secondary/20 px-2.5 py-1 text-[10px] font-medium text-muted-foreground">
                Atualizado agora
              </span>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <TrackingSummaryCard title="Pixels ativos" value={`${activePixels}/${pixels.length || 0}`} hint={activePixels ? 'Pixels prontos para receber eventos.' : 'Cadastre o primeiro pixel.'} tone={activePixels ? 'success' : 'default'} icon={Target} />
              <TrackingSummaryCard title="Checkouts" value={`${gateways.length}`} hint={gateways.length ? 'Plataformas prontas para enviar compras.' : 'Conecte o primeiro checkout.'} tone={gateways.length ? 'accent' : 'default'} icon={CreditCard} />
              <TrackingSummaryCard title="Última venda" value={logSummary.lastSuccessfulRow ? timeAgo(String(logSummary.lastSuccessfulRow.at ?? (logSummary.lastSuccessfulRow as any).createdAt)) : 'Sem sinal'} hint={logSummary.success ? `${logSummary.success} entregas aprovadas` : 'Ainda sem compra confirmada'} tone={logSummary.success ? 'success' : 'default'} icon={ArrowUpRight} />
              <TrackingSummaryCard title="Saúde" value={trackingReadiness.label} hint={trackingReadiness.hint} tone={trackingReadiness.tone} icon={ShieldCheck} />
            </div>
          </GlassCard>

          <GlassCard className="p-4 sm:p-5">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-brand-cyan" />
              <div>
                <h2 className="text-sm font-semibold text-foreground">Diagnóstico guiado</h2>
                <p className="text-[11px] text-muted-foreground">Siga o fluxo principal para deixar a estrutura pronta sem se perder.</p>
              </div>
            </div>
            <div className="mt-4 space-y-3">
              <div className="rounded-2xl border border-border/60 bg-secondary/15 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-medium text-foreground">1. Pixel do TikTok</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">Cadastre o pixel e instale a tag no site.</p>
                  </div>
                  <button type="button" className="btn-ghost px-3 py-1.5 text-[11px]" onClick={() => setEditingPixel('new')}>Abrir</button>
                </div>
              </div>
              <div className="rounded-2xl border border-border/60 bg-secondary/15 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-medium text-foreground">2. Checkout e webhook</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">Conecte a plataforma que envia as compras para o ROINADOS.</p>
                  </div>
                  <button type="button" className="btn-ghost px-3 py-1.5 text-[11px]" onClick={() => setEditingGateway('new')}>Conectar</button>
                </div>
              </div>
              <div className="rounded-2xl border border-border/60 bg-secondary/15 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-medium text-foreground">3. Vinculação</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">Escolha quais checkouts alimentam cada pixel ativo.</p>
                  </div>
                  <button type="button" className="btn-ghost px-3 py-1.5 text-[11px]" onClick={() => setActiveTab('pixels')}>Revisar pixels</button>
                </div>
              </div>
              <div className="rounded-2xl border border-border/60 bg-secondary/15 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-medium text-foreground">4. Entrega confirmada</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">Acompanhe as compras recebidas e eventuais falhas de entrega.</p>
                  </div>
                  <button type="button" className="btn-ghost px-3 py-1.5 text-[11px]" onClick={() => setActiveTab('logs')}>Ver entregas</button>
                </div>
              </div>
            </div>
          </GlassCard>
        </div>
      </div>

      {syncValidation.hasFailure ? (
        <GlassCard className="border-destructive/30 bg-destructive/5 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 status-dot status-dot--err status-dot--pulse" />
              <div>
                <h3 className="text-sm font-semibold text-destructive">Existe uma falha recente no rastreamento</h3>
                <p className="mt-1 text-xs text-destructive/90">{syncValidation.failureDescription}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 self-end sm:self-auto">
              {syncValidation.failedGateway ? (
                <button
                  type="button"
                  onClick={() => handleTestGateway(syncValidation.failedGateway!)}
                  disabled={testingGwId === syncValidation.failedGateway.id}
                  className="rounded-xl bg-destructive px-3 py-2 text-xs font-semibold text-destructive-foreground hover:brightness-110 disabled:opacity-50"
                >
                  {testingGwId === syncValidation.failedGateway.id ? 'Testando…' : 'Testar novamente'}
                </button>
              ) : null}
              <button type="button" onClick={() => setActiveTab('logs')} className="btn-secondary text-xs">
                Ver entregas
              </button>
            </div>
          </div>
        </GlassCard>
      ) : null}

      <GlassCard className="p-2">
        <div className="grid gap-2 md:grid-cols-3">
          <button
            type="button"
            onClick={() => setActiveTab('pixels')}
            className={`rounded-2xl border px-4 py-3 text-left transition-all ${activeTab === 'pixels' ? 'border-brand-cyan/35 bg-brand-cyan/10 shadow-[0_12px_28px_-18px_rgba(37,244,238,0.6)]' : 'border-transparent bg-secondary/15 hover:border-border/60 hover:bg-secondary/25'}`}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-foreground">
                <Target className="size-4" />
                <span className="text-sm font-semibold">Pixels</span>
              </div>
              <span className="rounded-full bg-black/20 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{pixels.length}</span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">Instalação, token, vínculos e saúde dos pixels.</p>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('gateways')}
            className={`rounded-2xl border px-4 py-3 text-left transition-all ${activeTab === 'gateways' ? 'border-brand-cyan/35 bg-brand-cyan/10 shadow-[0_12px_28px_-18px_rgba(37,244,238,0.6)]' : 'border-transparent bg-secondary/15 hover:border-border/60 hover:bg-secondary/25'}`}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-foreground">
                <CreditCard className="size-4" />
                <span className="text-sm font-semibold">Checkouts</span>
              </div>
              <span className="rounded-full bg-black/20 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{gateways.length}</span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">Webhooks, provedores e roteamento das vendas.</p>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('logs')}
            className={`rounded-2xl border px-4 py-3 text-left transition-all ${activeTab === 'logs' ? 'border-brand-cyan/35 bg-brand-cyan/10 shadow-[0_12px_28px_-18px_rgba(37,244,238,0.6)]' : 'border-transparent bg-secondary/15 hover:border-border/60 hover:bg-secondary/25'}`}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-foreground">
                <Clock className="size-4" />
                <span className="text-sm font-semibold">Entregas</span>
              </div>
              <span className="rounded-full bg-black/20 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{logSummary.total}</span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">Compras recebidas, confirmações e falhas recentes.</p>
          </button>
        </div>
      </GlassCard>

      {/* ── CONTEÚDO DAS ABAS ── */}

      {/* 1. ABA: PIXELS DO TIKTOK */}
      {activeTab === 'pixels' && (
        <div className="flex flex-col gap-4">
          <GlassCard className="p-4 sm:p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Pixels do TikTok</h3>
                <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
                  Cada pixel possui o código de instalação do site, um token opcional para envio pelo servidor e vínculos que definem quais checkouts alimentam suas conversões.
                </p>
              </div>
              <div className="flex items-center gap-2 self-start">
                <div className="relative w-full sm:w-64">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Buscar pixel…"
                    value={pixelSearch}
                    onChange={(e) => setPixelSearch(e.target.value)}
                    className="w-full pl-8 pr-3 py-2 rounded-xl border border-border/80 bg-input text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-brand-cyan/60"
                  />
                </div>
                <button type="button" onClick={() => setEditingPixel('new')} className="btn-primary shrink-0 text-xs py-2">
                  <Plus className="size-3.5" />
                  Novo Pixel
                </button>
              </div>
            </div>
          </GlassCard>

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
          <GlassCard className="p-4 sm:p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Checkouts &amp; webhooks</h3>
                <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
                  Cadastre cada plataforma de pagamento, copie o webhook correspondente e valide se as compras estão chegando ao ROINADOS antes de seguir para o TikTok.
                </p>
              </div>
              <div className="flex items-center gap-2 self-start">
                <div className="relative w-full sm:w-64">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Buscar checkout…"
                    value={gatewaySearch}
                    onChange={(e) => setGatewaySearch(e.target.value)}
                    className="w-full pl-8 pr-3 py-2 rounded-xl border border-border/80 bg-input text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-brand-cyan/60"
                  />
                </div>
                <button type="button" onClick={() => setEditingGateway('new')} className="btn-secondary shrink-0 text-xs py-2">
                  <Plus className="size-3.5" />
                  Conectar checkout
                </button>
              </div>
            </div>
          </GlassCard>

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
          <GlassCard className="p-4 sm:p-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Entregas e confirmações</h3>
                <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
                  Aqui aparecem as compras recebidas dos checkouts. A confirmação final só é considerada concluída depois da resposta do TikTok para cada pixel associado.
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="rounded-xl border border-border/60 bg-secondary/20 px-3 py-2 text-left">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Total</p>
                  <p className="mt-1 text-sm font-semibold text-foreground">{logSummary.total}</p>
                </div>
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-left">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-emerald-300/80">Aprovadas</p>
                  <p className="mt-1 text-sm font-semibold text-emerald-300">{logSummary.success}</p>
                </div>
                <div className="rounded-xl border border-destructive/20 bg-destructive/10 px-3 py-2 text-left">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-destructive/80">Falhas</p>
                  <p className="mt-1 text-sm font-semibold text-destructive">{logSummary.error}</p>
                </div>
              </div>
            </div>
            <div className="mt-4 flex items-center gap-1 rounded-xl border border-border/60 bg-secondary/35 p-1 w-fit">
              <button
                type="button"
                onClick={() => setLogFilter('all')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${logFilter === 'all' ? 'bg-foreground text-background font-semibold' : 'text-muted-foreground hover:text-foreground'}`}
              >
                Todas
              </button>
              <button
                type="button"
                onClick={() => setLogFilter('success')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${logFilter === 'success' ? 'bg-emerald-500 text-white font-semibold' : 'text-muted-foreground hover:text-foreground'}`}
              >
                Aprovadas
              </button>
              <button
                type="button"
                onClick={() => setLogFilter('error')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${logFilter === 'error' ? 'bg-destructive text-white font-semibold' : 'text-muted-foreground hover:text-foreground'}`}
              >
                Com falha
              </button>
            </div>
          </GlassCard>

          {filteredLogs.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 text-center rounded-2xl border border-dashed border-border/80 bg-card/40">
              <Clock className="size-10 text-muted-foreground/50 mb-2" />
              <h3 className="text-sm font-bold text-foreground">Nenhuma venda registrada ainda</h3>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                Vá na aba &quot;Checkouts &amp; Webhooks&quot; e clique em <strong>Simular Venda</strong> para ver uma compra de teste aparecer aqui na hora!
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-border/60 bg-card/45">
              <div className="hidden grid-cols-[1.8fr,1fr,0.8fr] items-center gap-3 border-b border-border/50 bg-secondary/20 px-4 py-3 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground md:grid">
                <span>Evento</span>
                <span>Status</span>
                <span className="text-right">Recebido</span>
              </div>
              <div className="flex flex-col gap-2 p-2">
                {filteredLogs.map((row, idx) => {
                  const outcome = conversionStatus(row)
                  const isErr = outcome.kind === 'error'
                  const eventDate = row.at ?? (row as any).createdAt

                  return (
                    <div
                      key={row.id || idx}
                      className="flex flex-col gap-3 rounded-2xl border border-border/40 bg-card/70 px-4 py-3 text-xs transition-all hover:border-brand-cyan/20 hover:bg-card/90"
                    >
                      <div className="flex flex-col gap-3 md:grid md:grid-cols-[1.8fr,1fr,0.8fr] md:items-center">
                        <div className="flex items-start gap-3">
                          <span className={`mt-1 status-dot ${isErr ? 'status-dot--err' : outcome.kind === 'success' ? 'status-dot--ok' : ''}`} />
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold text-foreground">{conversionEvent(row.event)}</span>
                              <span className="rounded-md bg-secondary px-2 py-0.5 text-[10px] font-mono text-muted-foreground">{row.gateway || 'Checkout'}</span>
                              {row.orderId ? <span className="rounded-md border border-white/5 bg-black/40 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">#{row.orderId}</span> : null}
                              {row.amount != null ? <span className="font-mono text-[11px] font-semibold text-brand-cyan">{conversionAmount(row)}</span> : null}
                            </div>
                            <p className="mt-1 text-[11px] text-muted-foreground">Compra recebida do checkout e encaminhada para os pixels vinculados.</p>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold ${isErr ? 'border border-destructive/30 bg-destructive/15 text-destructive' : outcome.kind === 'success' ? 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-400' : 'border border-border bg-secondary text-muted-foreground'}`}>
                            <ShieldCheck className="size-3" />
                            {outcome.label}
                          </span>
                          {Array.isArray(row.capi) && row.capi.some(result => !result.ok) ? (
                            <span className="text-[11px] text-destructive">{row.capi.filter(result => !result.ok).map(result => `${result.pixel}: ${result.message || 'Envio não confirmado'}`).join(' · ')}</span>
                          ) : null}
                        </div>

                        <div className="text-left text-[11px] text-muted-foreground md:text-right">
                          <span>{eventDate ? timeAgo(String(eventDate)) : 'recentemente'}</span>
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
          <GlassCard className="p-4 sm:p-5">
            <div className="mb-3">
              <h3 className="text-sm font-semibold text-foreground">Diagnóstico de entrega</h3>
              <p className="mt-1 text-[11px] text-muted-foreground">Cobertura dos pixels e status dos últimos envios processados.</p>
            </div>
            <EventDeliveryPanel pixels={pixels} />
          </GlassCard>
          <GlassCard className="p-4 sm:p-5">
            <details className="group">
              <summary className="cursor-pointer list-none text-sm font-semibold text-foreground">
                <div className="flex items-center justify-between gap-2">
                  <span>Fila e notificações recusadas</span>
                  <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
                </div>
              </summary>
              <p className="mt-2 text-[11px] text-muted-foreground">Use este bloco quando houver atraso, erro de fila ou webhooks que precisaram ser isolados.</p>
              <div className="mt-4 flex flex-col gap-4">
                <QueueHealthPanel />
                <QuarantinePanel />
              </div>
            </details>
          </GlassCard>
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

      const saved = await apiSend<{ ok: boolean; durable?: boolean; warning?: string | null }>('/api/pixels', 'POST', {
        slug: pixel?.slug,
        name: cleanName,
        pixelCode: cleanCode,
        accessToken: accessToken.trim() || undefined,
        active,
        gatewayIds: finalGatewayIds,
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

  return (<Modal isOpen onClose={onClose} busy={saving} title={gateway ? 'Editar checkout' : 'Cadastrar checkout'}
    description="Cadastre a plataforma para gerar seu endereço de webhook."
    footer={<div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancelar</button><button type="button" className="btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Salvando…' : gateway ? 'Salvar alterações' : 'Cadastrar e gerar webhook'}</button></div>}>
    <fieldset disabled={saving} className="launch-form">
      <label className="launch-profile">Plataforma<select className={inputCls} value={provider} onChange={event => setProvider(event.target.value)}>{providers.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <details><summary className="cursor-pointer text-sm">Como configurar {providers.find(item => item.id === provider)?.label || 'a plataforma'}</summary><p className="launch-help mt-2">{helpText}</p></details>
          {/* Nome para identificação */}
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-foreground">Nome para identificação (opcional)</span>
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


    </fieldset>
  </Modal>)
}
