'use client'

// Aba TikTok Ads (via Pipeboard) — orquestra verificação de conexão, seleção de
// advertiser, KPIs agregados e a árvore de campanhas. Os fluxos de escrita
// (criar anúncio e Spark Ads) vivem em componentes próprios.

import { AudiencesDialog } from './audiences-dialog'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSWRConfig } from 'swr'
import * as Tabs from '@radix-ui/react-tabs'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Plus, Ban, ChevronDown, Sparkles, UploadCloud, Users } from 'lucide-react'
import {
  useAdsStatus,
  useAdsAccounts,
  useAdsTree,
  useAdsCampaignDecisions,
  useAdsSafetyPolicy,
  useAdsHealth,
  useAdsSyncStatus,
  useAdsRejections,
  apiSend,
} from '@/lib/api'
import { toast } from '@/lib/toast'
import type { AdsTreeCampaign } from '@/lib/types'
import { Skeleton } from '@/components/skeleton'
import { ErrorState } from '@/components/error-state'
import { AdsConnectCard } from './connect-card'
import { AdsContextBar } from './context-bar'
import { CampaignWorkspace } from './campaign-workspace'
import { SparkAdDialog } from './spark-ad-dialog'
import { CampaignDrawer } from './campaign-drawer'
import { DuplicateDialog } from './duplicate-dialog'
import { OpsDialog } from './ops-dialog'
import { HealthDialog } from './health-dialog'
import { AutomationPanel } from './automation-panel'
import { SmartPlusCreateDialog } from './smart-plus-create-dialog'
import { CatalogManager } from './catalog-manager'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { PixelBindingCard } from './pixel-binding-card'
import { adsDateRange, safeAdsTimeZone } from '@/lib/ads-time'
import { MagicOpsPanel } from './magic-ops-panel'
import { NeedsYouInbox } from './needs-you-inbox'
import { UniversalLauncherDialog } from './universal-launcher-dialog'
import { apiCacheKeyMatches } from '@/lib/cache-consistency'
import { useOverviewPeriod } from '@/lib/overview-period'
import { PERIODS } from '@/components/overview/period-picker'
import { cn } from '@/lib/utils'

type CatalogLocalWorkState = { uploading: boolean; pending: number }

function catalogLocalWorkCopy(state: CatalogLocalWorkState, action: 'leave' | 'create') {
  if (state.uploading) {
    return action === 'create'
      ? { title: 'Abrir criação e cancelar o envio atual?', description: 'Há vídeos sendo enviados nesta área do Catálogo. Abrir outro fluxo cancela os uploads locais ainda não concluídos. Vídeos já enviados permanecem disponíveis.', confirmLabel: 'Continuar' }
      : { title: 'Sair e cancelar o envio?', description: 'Há vídeos sendo enviados nesta área do Catálogo. Trocar de área cancela os uploads locais ainda não concluídos. Vídeos já enviados permanecem disponíveis.', confirmLabel: 'Sair e cancelar' }
  }
  return action === 'create'
    ? { title: 'Abrir criação e descartar os envios pendentes?', description: 'Há envios locais pendentes ou com falha. Abrir outro fluxo descartará os itens ainda não concluídos e as opções locais de tentar novamente. Vídeos já enviados permanecem disponíveis.', confirmLabel: 'Continuar' }
    : { title: 'Sair e descartar os envios pendentes?', description: 'Há envios locais pendentes ou com falha. Sair descartará os itens ainda não concluídos e as opções locais de tentar novamente. Vídeos já enviados permanecem disponíveis.', confirmLabel: 'Sair' }
}

export function TikTokAdsView() {
  type CatalogRequestAction = 'create' | 'magic' | 'batch'
  const [catalogRequest, setCatalogRequest] = useState<{ action: CatalogRequestAction; id: number } | null>(null)
  const [pendingCatalogAction, setPendingCatalogAction] = useState<CatalogRequestAction | null>(null)
  const [confirmCatalogAction, setConfirmCatalogAction] = useState(false)
  function commitCatalogRequest(action: CatalogRequestAction) {
    setCatalogRequest(previous => ({ action, id: (previous?.id || 0) + 1 }))
    requestTabChange('catalog')
  }
  function requestCatalog(action: CatalogRequestAction) {
    if (tab === 'catalog' && hasCatalogLocalWork) {
      setPendingCatalogAction(action)
      setConfirmCatalogAction(true)
      return
    }
    commitCatalogRequest(action)
  }

  const { data: status, mutate: mutateStatus, isLoading: statusLoading, error: statusError } = useAdsStatus()
  const connected = Boolean(status?.connected)

  // Pipeboard não tem Business Center — as contas vêm direto do token.
  const { data: accounts, mutate: mutateAccounts, error: accountsError, isLoading: accountsLoading } = useAdsAccounts(connected)

  const [advertiserId, setAdvertiserId] = useState<string | null>(null) // null = usa o salvo
  const effectiveAdvertiser = advertiserId ?? accounts?.selected ?? ''
  // O override local existe só enquanto a seleção recém-confirmada pelo backend
  // ainda não voltou em /api/ads/accounts. Assim que o cache confirma o mesmo
  // advertiser, liberamos o override para mudanças feitas em outra aba também
  // poderem aparecer no próximo focus/revalidate.
  useEffect(() => {
    if (advertiserId && accounts?.selected === advertiserId) setAdvertiserId(null)
  }, [advertiserId, accounts?.selected])
  // Abre em "Ativas": há ~8 ativas e ~99 pausadas — abrir em "Todas" enterrava
  // o operador em ruído. Ele filtra para "Todas" quando quiser o histórico.
  const [statusFilter, setStatusFilter] = useState('active')
  const [sort, setSort] = useState('newest')
  const [page, setPage] = useState(1)
  // Trocar pelo workspace global também retorna à primeira página da nova conta.
  useEffect(() => { setPage(1) }, [effectiveAdvertiser])
  // Período global da dashboard. TikTok respeita a mesma seleção do calendário.
  const { period } = useOverviewPeriod()
  const rangeDays = period === 'today' ? 1 : period === '7d' ? 7 : period === '30d' ? 30 : 365
  const periodLabel = PERIODS.find(item => item.id === period)?.label || 'Hoje'
  const selectedAdvertiserInfo = accounts?.accounts.find((a) => String(a.id) === String(effectiveAdvertiser))
  const advertiserContextTimeZone = selectedAdvertiserInfo?.timezone || ''
  const advertiserTimeZone = safeAdsTimeZone(advertiserContextTimeZone || status?.timeZone)
  const [calendarTick, setCalendarTick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setCalendarTick(tick => tick + 1), 60_000)
    return () => clearInterval(timer)
  }, [])
  const { fromDate, toDate } = useMemo(
    () => adsDateRange(rangeDays, advertiserTimeZone),
    [rangeDays, advertiserTimeZone, calendarTick],
  )

  // Sub-abas por tarefa: a página empilhava 12 cards numa coluna só e ninguém
  // achava nada. Cada aba tem UM propósito: ver resultado / operar campanhas /
  // configurar automações / usar a IA. Estado local (não URL) — trocar de aba
  // não recarrega nada, os hooks SWR continuam vivos. Exceção (F4): ?tab= é
  // honrado UMA vez pós-mount (deep-link "ver automações" da home). useEffect
  // em vez de initializer para não divergir da renderização do servidor;
  // window.location em vez de useSearchParams para não exigir Suspense.
  // Três áreas operacionais: criar/acompanhar, catálogo e automações. Smart+
  // e Spark são tipos de criação dentro de Campanhas, não destinos separados.
  type TabKey = 'campaigns' | 'automation' | 'catalog'
  const SUBTABS: { value: TabKey; label: string }[] = [
    { value: 'campaigns', label: 'Campanhas' },
    { value: 'catalog', label: 'Catálogo' },
    { value: 'automation', label: 'Automações' },
  ]
  const [toolsExpanded, setToolsExpanded] = useState(false)
  const [toolsMounted, setToolsMounted] = useState(false)
  const [tab, setTab] = useState<TabKey>('campaigns')
  const [catalogLocalWork, setCatalogLocalWork] = useState<CatalogLocalWorkState>({ uploading: false, pending: 0 })
  const [pendingTab, setPendingTab] = useState<TabKey | null>(null)
  const [confirmTabChange, setConfirmTabChange] = useState(false)
  const hasCatalogLocalWork = catalogLocalWork.uploading || catalogLocalWork.pending > 0
  const catalogLeaveCopy = catalogLocalWorkCopy(catalogLocalWork, 'leave')
  const catalogCreateCopy = catalogLocalWorkCopy(catalogLocalWork, 'create')

  const treeActive = connected && Boolean(effectiveAdvertiser)
  const campaignsActive = treeActive && tab === 'campaigns'
  const automationActive = treeActive && tab === 'automation'
  const { mutate: mutateCache } = useSWRConfig()
  const refreshLock = useRef(false)
  const [refreshing, setRefreshing] = useState(false)
  const {
    data: tree,
    mutate: mutateTree,
    isLoading: treeLoading,
    error: treeError,
  } = useAdsTree(campaignsActive, {
    adAccountId: effectiveAdvertiser || undefined,
    // A árvore completa mantém os contadores e filtros locais coerentes.
    sort,
    page,
    fromDate,
    toDate,
  })

  // Modelo de decisão da lista: vendas/receita first-party + estado da automação.
  // Só roda na aba Campanhas; Catálogo/Automações não pagam este polling.
  const { data: campaignDecisions, mutate: mutateDecisions } = useAdsCampaignDecisions(campaignsActive, effectiveAdvertiser, { fromDate, toDate })

  const validTabs = useMemo(() => new Set<TabKey>(SUBTABS.map((item) => item.value)), [])
  const tabRef = useRef<TabKey>(tab)
  const catalogLocalWorkRef = useRef(catalogLocalWork)
  const requestTabChangeRef = useRef<(value: TabKey, source?: 'ui' | 'tour') => void>(() => {})
  const historyIndexRef = useRef(0)
  const restoringHistoryRef = useRef(false)
  const allowNextPopRef = useRef(false)
  const pendingHistoryNavigationRef = useRef<{ target: TabKey; delta: number } | null>(null)
  useEffect(() => { tabRef.current = tab }, [tab])
  useEffect(() => { catalogLocalWorkRef.current = catalogLocalWork }, [catalogLocalWork])

  function resolveLocationTab(): TabKey {
    const query = new URLSearchParams(window.location.search)
    const requested = query.get('tab') || query.get('view')
    if (requested && validTabs.has(requested as TabKey)) return requested as TabKey
    if (requested === 'overview' || requested === 'today' || requested === 'smartplus') return 'campaigns'
    if (requested === 'ai') return 'automation'
    return 'campaigns'
  }

  function historyIndex(state: unknown): number | null {
    if (!state || typeof state !== 'object') return null
    const value = (state as Record<string, unknown>).roiAdsHistoryIndex
    return typeof value === 'number' && Number.isInteger(value) ? value : null
  }

  function writeTabUrl(value: TabKey, mode: 'push' | 'replace') {
    const url = new URL(window.location.href)
    url.searchParams.delete('view')
    if (value === 'campaigns') url.searchParams.delete('tab')
    else url.searchParams.set('tab', value)
    const next = `${url.pathname}${url.search}${url.hash}`
    const currentState = window.history.state && typeof window.history.state === 'object' ? window.history.state : {}
    if (mode === 'replace') {
      const existingIndex = historyIndex(currentState)
      const index = existingIndex ?? historyIndexRef.current
      historyIndexRef.current = index
      window.history.replaceState({ ...currentState, roiAdsTab: value, roiAdsHistoryIndex: index }, '', next)
      return
    }
    const index = historyIndexRef.current + 1
    historyIndexRef.current = index
    window.history.pushState({ ...currentState, roiAdsTab: value, roiAdsHistoryIndex: index }, '', next)
  }

  function commitTabChange(value: TabKey, historyMode: 'push' | 'none' = 'push') {
    setTab(value)
    tabRef.current = value
    if (historyMode === 'push') writeTabUrl(value, 'push')
  }

  function requestTabChange(value: TabKey, _source: 'ui' | 'tour' = 'ui') {
    const current = tabRef.current
    if (value === current) return
    const work = catalogLocalWorkRef.current
    if (current === 'catalog' && (work.uploading || work.pending > 0)) {
      setPendingTab(value)
      setConfirmTabChange(true)
      return
    }
    commitTabChange(value, 'push')
  }
  requestTabChangeRef.current = requestTabChange
  function changeTab(value: TabKey) { requestTabChange(value, 'ui') }

  useEffect(() => {
    const initial = resolveLocationTab()
    setTab(initial)
    tabRef.current = initial
    const initialState = window.history.state && typeof window.history.state === 'object' ? window.history.state : {}
    historyIndexRef.current = historyIndex(initialState) ?? 0
    window.history.replaceState({ ...initialState, roiAdsTab: initial, roiAdsHistoryIndex: historyIndexRef.current }, '', window.location.href)

    const handlePopState = (event: PopStateEvent) => {
      const target = resolveLocationTab()
      const targetIndex = historyIndex(event.state)

      if (allowNextPopRef.current) {
        allowNextPopRef.current = false
        if (targetIndex !== null) historyIndexRef.current = targetIndex
        setTab(target)
        tabRef.current = target
        return
      }

      if (restoringHistoryRef.current) {
        restoringHistoryRef.current = false
        if (targetIndex !== null) historyIndexRef.current = targetIndex
        setConfirmTabChange(true)
        return
      }

      const current = tabRef.current
      if (target === current) {
        if (targetIndex !== null) historyIndexRef.current = targetIndex
        return
      }

      const work = catalogLocalWorkRef.current
      if (current === 'catalog' && (work.uploading || work.pending > 0) && targetIndex !== null) {
        const delta = targetIndex - historyIndexRef.current
        if (delta !== 0) {
          pendingHistoryNavigationRef.current = { target, delta }
          setPendingTab(target)
          restoringHistoryRef.current = true
          window.history.go(-delta)
          return
        }
      }

      if (targetIndex !== null) historyIndexRef.current = targetIndex
      setTab(target)
      tabRef.current = target
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [validTabs])

  // Tour cross-tab usa o mesmo guard da navegação manual e sempre lê o estado atual.
  useEffect(() => {
    const handleTourTab = (event: Event) => {
      const value = String((event as CustomEvent<string>).detail || '') as TabKey
      if (value === 'campaigns' || value === 'catalog' || value === 'automation') {
        requestTabChangeRef.current(value, 'tour')
      }
    }
    window.addEventListener('roinados:ads-tab', handleTourTab as EventListener)
    return () => window.removeEventListener('roinados:ads-tab', handleTourTab as EventListener)
  }, [])

  const [audiencesOpen, setAudiencesOpen] = useState(false)
  const [launcherOpen, setLauncherOpen] = useState(false)
  const [sparkOpen, setSparkOpen] = useState(false)
  const [smartPlusOpen, setSmartPlusOpen] = useState(false)
  const [opsOpen, setOpsOpen] = useState(false)
  const [opsInitialTab, setOpsInitialTab] = useState<'jobs' | 'safety'>('jobs')
  const [healthOpen, setHealthOpen] = useState(false)
  const [automationDirty, setAutomationDirty] = useState(false)
  const [magicOpsDirty, setMagicOpsDirty] = useState(false)
  const [alertsFocusRequest, setAlertsFocusRequest] = useState(0)
  const [pendingAdvertiserId, setPendingAdvertiserId] = useState<string | null>(null)
  const [confirmAccountSwitch, setConfirmAccountSwitch] = useState(false)
  const [switchingAccount, setSwitchingAccount] = useState(false)
  const hasAutomationDraft = automationDirty || magicOpsDirty

  function openOps(initialTab: 'jobs' | 'safety' = 'jobs') {
    setOpsInitialTab(initialTab)
    setOpsOpen(true)
  }

  function openPerformanceAlerts() {
    setAlertsFocusRequest(value => value + 1)
    if (tabRef.current !== 'automation') requestTabChangeRef.current('automation', 'ui')
  }

  // Política de segurança — alimenta o badge de simulação/bloqueio de ações
  const { data: safety, mutate: mutateSafety } = useAdsSafetyPolicy(connected)
  const dryRunActive = Boolean(safety?.policy?.dryRun)
  const killSwitchActive = Boolean(safety?.policy?.killSwitch)

  const concreteAdvertiser = effectiveAdvertiser

  // Saúde das contas — o GET roda a varredura no backend (detecção de
  // banimento + criação automática de tickets); aqui alimenta o badge.
  const { data: adsHealth } = useAdsHealth(connected)
  const { data: rejections } = useAdsRejections(treeActive, concreteAdvertiser)
  const bannedAccounts = (adsHealth?.health ?? []).filter((h) => h.status === 'banned')
  const openTickets = (adsHealth?.tickets ?? []).filter((t) => t.status === 'open' || t.status === 'submitted')
  const hasAccountAlert = dryRunActive || killSwitchActive || bannedAccounts.length > 0
  const [detailCampaign, setDetailCampaign] = useState<AdsTreeCampaign | null>(null)
  const [duplicateCampaign, setDuplicateCampaign] = useState<AdsTreeCampaign | null>(null)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)

  const { data: syncStatus, mutate: mutateSyncStatus } = useAdsSyncStatus(treeActive, concreteAdvertiser)
  const selectedSyncState = syncStatus?.advertisers?.find((state) => state.advertiserId === concreteAdvertiser)

  async function refreshCampaignSurfaces() {
    await Promise.allSettled([mutateTree(), mutateDecisions(), mutateSyncStatus()])
  }

  useEffect(() => {
    setAudiencesOpen(false)
    setLauncherOpen(false)
    setSmartPlusOpen(false)
    setSparkOpen(false)
    setDetailCampaign(null)
    setDuplicateCampaign(null)
    setOpsOpen(false)
  }, [concreteAdvertiser])

  function openWriteFlow(setOpen: (open: boolean) => void) {
    if (!concreteAdvertiser) {
      toast.info('Selecione uma conta de anúncio específica antes de criar ou publicar.')
      return
    }
    setOpen(true)
  }

  const currency = useMemo(() => {
    const adv = accounts?.accounts.find((a) => String(a.id) === String(concreteAdvertiser))
    return adv?.currency || tree?.campaigns?.[0]?.currency || 'BRL'
  }, [accounts, concreteAdvertiser, tree])

  const adsOperationalSummary = useMemo(() => {
    const campaigns = tree?.campaigns ?? []
    let active = 0
    let spend = 0
    let sales = 0
    let revenue = 0
    let comparable = true
    let noSalesWithSpend = 0
    let highRoas = 0
    let pendingProposals = 0
    let bestRoas: { id: string; name: string; value: number } | null = null

    for (const campaign of campaigns) {
      if (campaign.status === 'active') active += 1
      const campaignSpend = Number(campaign.metrics?.spend) || 0
      spend += campaignSpend
      const decision = campaignDecisions?.byCampaign[campaign.platformCampaignId]
      const campaignSales = Number(decision?.sales) || 0
      sales += campaignSales
      const cents = Number(decision?.revenueCents) || 0
      const campaignCurrency = campaign.currency || currency
      const sameCurrency = !decision?.currency || decision.currency === campaignCurrency
      if (cents > 0 && sameCurrency) revenue += cents / 100
      else if (cents > 0 && !sameCurrency) comparable = false
      if (campaignSpend > 0 && campaignSales === 0) noSalesWithSpend += 1
      const campaignRoas = campaignSpend > 0 && cents > 0 && sameCurrency ? (cents / 100) / campaignSpend : null
      if (campaignRoas !== null && campaignRoas >= 2) {
        highRoas += 1
        if (!bestRoas || campaignRoas > bestRoas.value) {
          bestRoas = { id: campaign.platformCampaignId, name: campaign.campaignName || campaign.platformCampaignId, value: campaignRoas }
        }
      }
      if (decision?.automation.pendingProposal) pendingProposals += 1
    }

    return {
      total: campaigns.length,
      active,
      spend,
      sales,
      roas: campaignDecisions && spend > 0 && comparable ? revenue / spend : null,
      noSalesWithSpend,
      highRoas,
      pendingProposals,
      bestRoas,
    }
  }, [tree, campaignDecisions, currency])

  function formatAdsMoney(value: number) {
    try {
      return new Intl.NumberFormat('pt-BR', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value)
    } catch {
      return `${currency} ${value.toFixed(0)}`
    }
  }

  function applyCampaignShortcut(query: string) {
    changeTab('campaigns')
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('roi:ads-filter', { detail: query }))
    }, 0)
  }

  async function commitAdvertiserChange(id: string) {
    if (!id || switchingAccount || String(id) === String(concreteAdvertiser)) return
    setSwitchingAccount(true)
    try {
      const res = await apiSend<{ ok: boolean; advertiserId: string }>('/api/ads/accounts/select', 'POST', { advertiserId: id })
      setAutomationDirty(false)
      setMagicOpsDirty(false)
      setCatalogLocalWork({ uploading: false, pending: 0 })
      setPendingAdvertiserId(null)
      setConfirmAccountSwitch(false)
      setAdvertiserId(res.advertiserId)
      setPage(1)
      await Promise.allSettled([mutateAccounts(), mutateStatus()])
    } catch (error) {
      toast.error('Falha ao selecionar a conta de anúncio', { hint: error instanceof Error ? error.message : undefined })
    } finally {
      setSwitchingAccount(false)
    }
  }

  async function requestAdvertiserChange(id: string) {
    if (String(id) === String(concreteAdvertiser)) return
    if (hasAutomationDraft || hasCatalogLocalWork) {
      setPendingAdvertiserId(id)
      setConfirmAccountSwitch(true)
      return
    }
    await commitAdvertiserChange(id)
  }

  async function handleDisconnect() {
    if (disconnecting) return
    setDisconnecting(true)
    let disconnected = false
    try {
      await apiSend('/api/ads/disconnect', 'POST')
      disconnected = true
      setConfirmDisconnect(false)
      setAdvertiserId(null)
      toast.success('Conta TikTok Ads desconectada')
    } catch (e) {
      // Mantém a confirmação aberta: o usuário pode tentar novamente e a UI
      // não finge que a conexão foi removida quando o backend recusou.
      toast.error('Falha ao desconectar', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setDisconnecting(false)
    }
    if (disconnected) {
      try {
        await mutateStatus()
      } catch (error) {
        toast.info('Conta desconectada, mas o estado da tela não atualizou completamente', {
          hint: error instanceof Error ? error.message : 'Atualize a página para confirmar o estado.',
        })
      }
    }
  }

  // ── Estado: chave ausente no servidor ────────────────────────────────────
  if (status && !status.enabled) {
    return (
      <div className="flex flex-col gap-5">
        <ErrorState
          title="Integração TikTok Ads não configurada"
          description="A chave do Pipeboard ainda não está configurada no servidor. Configure a integração de servidor e verifique novamente."
          onRetry={() => mutateStatus()}
        />
      </div>
    )
  }

  if (statusError && !status) {
    return (
      <div className="flex flex-col gap-5">
        <ErrorState onRetry={() => mutateStatus()} />
      </div>
    )
  }

  if (statusLoading && !status) {
    return (
      <div className="flex flex-col gap-5">
        <div className="space-y-2"><Skeleton className="h-5 w-32 rounded" /><Skeleton className="h-4 w-80 max-w-full rounded" /></div>
        <Skeleton className="h-10 max-w-xl rounded-lg" />
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <div key={i} className="space-y-2"><Skeleton className="h-6 w-24 rounded" /><Skeleton className="h-3 w-28 rounded" /></div>)}
        </div>
        <Skeleton className="h-40 rounded-lg" />
      </div>
    )
  }

  // ── Estado: não conectado → card de verificação de conexão ───────────────
  if (!connected) {
    return (
      <div className="flex flex-col gap-5">
        <AdsConnectCard onConnected={() => mutateStatus()} />
      </div>
    )
  }

  if (accountsError && !accounts) return <ErrorState title="Não foi possível carregar as contas" onRetry={() => mutateAccounts()} />
  if (accountsLoading && !accounts) return (
    <div className="flex flex-col gap-4">
      <div className="space-y-1"><h1 className="text-lg font-semibold text-foreground">TikTok Ads</h1><p className="text-xs text-muted-foreground">Carregando contas de anúncio…</p></div>
      <Skeleton className="h-10 max-w-xl rounded-lg" />
    </div>
  )

  const advertisers = accounts?.accounts ?? []

  return (
    <div className="tiktok-view min-w-0 flex flex-col gap-4">
      <header className="space-y-1">
        <h1 className="text-lg font-semibold text-foreground">TikTok Ads</h1>
        <p className="text-xs leading-relaxed text-muted-foreground">Gerencie campanhas, resultados e ações da conta selecionada.</p>
      </header>

      {/* Barra de contexto: conta de anúncio + deep-link + desconectar */}
      <AdsContextBar
        advertisers={advertisers}
        selectedAdvertiser={effectiveAdvertiser}
        refreshing={refreshing}
        syncState={selectedSyncState}
        onAdvertiserChangeRequested={requestAdvertiserChange}
        switching={switchingAccount}
        onRefresh={async () => {
          if (refreshLock.current || !concreteAdvertiser) return
          refreshLock.current = true
          setRefreshing(true)
          try {
            const result = await apiSend<{ ok?: boolean; error?: string }>(
              `/api/ads/tree/refresh?adAccountId=${encodeURIComponent(concreteAdvertiser)}`,
              'POST',
              {},
            )
            if (result.ok === false) throw new Error(result.error || 'Atualização incompleta')
            const refreshResults = await Promise.allSettled([
              mutateCache((key) => apiCacheKeyMatches(key, [
                '/api/ads/tree',
                '/api/ads/kpis',
                '/api/ads/roas',
                '/api/ads/profitability',
                '/api/ads/attribution',
                '/api/ads/campaign-decisions',
              ], { adAccountId: concreteAdvertiser })),
              mutateAccounts(), mutateSyncStatus(),
            ])
            toast.success('Dados atualizados')
            if (refreshResults.some((item) => item.status === 'rejected')) toast.info('Sincronização concluída, mas uma parte da tela ainda está atualizando.')
          } catch (e) {
            toast.error('Não foi possível sincronizar agora', { hint: e instanceof Error ? e.message : undefined })
          } finally {
            refreshLock.current = false
            setRefreshing(false)
          }
        }}
        onDisconnect={status?.capabilities?.oauthConnect === false ? null : () => setConfirmDisconnect(true)}
      />


      {effectiveAdvertiser ? (
        <div className="text-xs text-muted-foreground">Período · {periodLabel}</div>
      ) : null}

      {hasAccountAlert ? (
        <section className="space-y-2 border-b border-border/60 pb-4" aria-label="Alertas da conta">
          {killSwitchActive ? (
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <p className="text-error"><span className="font-semibold">Ações bloqueadas</span> · novas alterações não serão publicadas no TikTok.</p>
              <button type="button" className="font-medium text-error hover:underline" onClick={() => openOps('safety')}>Gerenciar</button>
            </div>
          ) : dryRunActive ? (
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <p className="text-warning"><span className="font-semibold">Modo teste ativo</span> · as ações são simuladas, mas não publicadas.</p>
              <button type="button" className="font-medium text-warning hover:underline" onClick={() => openOps('safety')}>Gerenciar</button>
            </div>
          ) : null}
          {bannedAccounts.length > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <p className="text-error"><span className="font-semibold">{bannedAccounts.length === 1 ? 'Conta banida' : `${bannedAccounts.length} contas banidas`}</span>{openTickets.length ? ` · ${openTickets.length} ticket${openTickets.length === 1 ? '' : 's'} em andamento` : ''}</p>
              <button type="button" className="font-medium text-error hover:underline" onClick={() => setHealthOpen(true)}>Ver detalhes</button>
            </div>
          ) : null}
        </section>
      ) : null}

      <div id="tiktok-pixel-binding"><PixelBindingCard active={Boolean(concreteAdvertiser)} advertiserId={concreteAdvertiser} /></div>

      {!effectiveAdvertiser ? (
        <div className="py-8 text-center">
          <p className="text-sm font-medium text-foreground">Escolha uma conta de anúncios</p>
          <p className="mx-auto mt-1 max-w-md text-pretty text-xs text-muted-foreground">Escolha uma conta acima para ver e operar as campanhas.</p>
        </div>
      ) : (
        <Tabs.Root value={tab} onValueChange={value => changeTab(value as TabKey)} className="tiktok-workspace flex min-w-0 flex-col gap-4">
          {/* Sub-abas por tarefa: cada tela tem UM propósito. O padrão visual
              (pill tablist) é o mesmo da aba Atividade. */}
          <div className="flex flex-col gap-3 border-b border-border/60 lg:flex-row lg:items-end lg:justify-between">
            <Tabs.List data-tour="ads-tabs" aria-label="Áreas do TikTok Ads" className="flex min-w-0 gap-6 overflow-x-auto">
              {SUBTABS.map((item) => {
                const attentionCount = item.value === 'automation'
                  ? bannedAccounts.length + openTickets.length + (rejections?.open ?? 0)
                  : item.value === 'campaigns' && tree?.syncError ? 1 : 0
                return (
                  <Tabs.Trigger
                    key={item.value}
                    value={item.value}
                    className="relative -mb-px inline-flex min-h-11 shrink-0 items-center gap-1.5 border-b-2 border-transparent px-0 text-sm font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:border-primary data-[state=active]:text-foreground"
                  >
                    <span>{item.label}</span>
                    {attentionCount > 0 ? <span className="text-xs tabular-nums text-warning" aria-label={`${attentionCount} item(ns) que exigem atenção`}>{attentionCount}</span> : null}
                  </Tabs.Trigger>
                )
              })}
            </Tabs.List>

            {tab === 'campaigns' && (
              <div data-tour="ads-campaign-actions" className="flex flex-wrap items-center gap-2 lg:justify-end">
                <button
                  type="button"
                  className="btn-secondary inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold touch-manipulation cursor-pointer"
                  onClick={() => setAudiencesOpen(true)}
                  title="Gerenciar públicos de remarketing e semelhantes"
                >
                  <Users className="size-3.5" aria-hidden="true" />
                  <span>Públicos</span>
                </button>
                <button
                  type="button"
                  className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 touch-manipulation cursor-pointer"
                  onClick={() => openWriteFlow(() => setLauncherOpen(true))}
                  aria-label="Criar campanha"
                  title="Criar campanhas de venda com um ou vários vídeos"
                >
                  <Plus className="size-4" aria-hidden="true" />
                  <span>Criar campanha</span>
                </button>
              </div>
            )}

            {tab === 'catalog' && (
              <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                <button
                  type="button"
                  className="btn-primary inline-flex h-10 items-center gap-1.5 rounded-lg px-4 text-sm font-semibold touch-manipulation cursor-pointer"
                  onClick={() => requestCatalog('magic')}
                >
                  <Sparkles className="size-3.5" aria-hidden="true" />
                  <span>Criar pelo link</span>
                </button>
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <button
                      type="button"
                      className="btn-secondary inline-flex size-10 items-center justify-center rounded-lg p-0 touch-manipulation cursor-pointer"
                      aria-label="Outras opções de criação"
                    >
                      <ChevronDown className="size-3.5" aria-hidden="true" />
                    </button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content align="end" sideOffset={6} className="z-50 min-w-48 rounded-xl border border-border bg-card p-1 shadow-lg">
                      <DropdownMenu.Item className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg px-3 text-sm outline-none data-[highlighted]:bg-secondary" onSelect={() => requestCatalog('batch')}>
                        <UploadCloud className="size-3.5" aria-hidden="true" /> Importar planilha
                      </DropdownMenu.Item>
                      <DropdownMenu.Item className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg px-3 text-sm outline-none data-[highlighted]:bg-secondary" onSelect={() => requestCatalog('create')}>
                        <Plus className="size-3.5" aria-hidden="true" /> Criar manualmente
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
              </div>
            )}
          </div>

          {/* Aviso de sincronização bloqueada: sem isto a tela mostraria "0
              campanhas / tudo zerado" como se a conta estivesse vazia, quando na
              verdade o Pipeboard bloqueou o acesso. Explica o porquê e o que fazer. */}
          {tree?.syncError && (
            <section className="border-b border-warning/30 pb-4">
              <div className="flex items-start gap-3">
                <Ban className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-semibold text-warning">
                    {tree.syncError.code === 'ACCOUNT_BLOCKED'
                      ? 'Conta bloqueada pelo Pipeboard'
                      : 'Falha ao sincronizar com o TikTok'}
                  </p>
                  {tree.syncError.code === 'ACCOUNT_BLOCKED' ? (
                    <>
                      <p className="text-pretty text-xs leading-relaxed text-muted-foreground">
                        O Pipeboard ainda não liberou os dados desta conta. Suas campanhas seguem intactas no TikTok;
                        o painel tenta de novo automaticamente.
                        {tree.syncError.blockedUntil ? ` Nova tentativa após ${tree.syncError.blockedUntil}.` : ''}
                      </p>
                      <button
                        type="button"
                        className="btn-ghost mt-1 text-xs"
                        onClick={async () => {
                          try {
                            await apiSend(
                              `/api/ads/tree/refresh?adAccountId=${encodeURIComponent(concreteAdvertiser)}`,
                              'POST',
                              {},
                            )
                            toast.success('Conta re-testada — atualizando…')
                            mutateTree()
                          } catch (e) {
                            toast.error('Ainda bloqueada', {
                              hint: e instanceof Error ? e.message : undefined,
                            })
                          }
                        }}
                      >
                        Tentar agora
                      </button>
                    </>
                  ) : (
                    <p className="text-pretty text-xs leading-relaxed text-muted-foreground">
                      {tree.syncError.message}
                    </p>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* ── Aba: Campanhas — uma lista e uma única entrada de criação. ── */}
          {tab === 'campaigns' && (
            <Tabs.Content value="campaigns" data-tour="ads-campaigns" className="space-y-4 outline-none">
              <CampaignWorkspace
              key={`${concreteAdvertiser}:${fromDate}:${toDate}`}
              tree={tree}
              loading={treeLoading && !tree}
              error={treeError ? String((treeError as Error).message || 'erro') : null}
              currency={currency}
              statusFilter={statusFilter}
              onStatusFilter={(s) => {
                setStatusFilter(s)
                setPage(1)
              }}
              sort={sort}
              onSort={(s) => {
                setSort(s)
                setPage(1)
              }}
              page={page}
              onPage={setPage}
              onMutate={() => { void refreshCampaignSurfaces() }}
              onRetry={() => { void refreshCampaignSurfaces() }}
              onOpenDetail={setDetailCampaign}
              onDuplicate={setDuplicateCampaign}
              decisions={campaignDecisions}
              onOpenAutomations={() => changeTab('automation')}
              />
              <NeedsYouInbox
                key={`NeedsYouInbox:campaigns:${concreteAdvertiser}`}
                active={treeActive}
                adAccountId={concreteAdvertiser}
                currency={currency}
                onOpenOps={() => openOps()}
                onOpenHealth={() => setHealthOpen(true)}
                onOpenAlerts={openPerformanceAlerts}
                appearance="embedded"
                showHealthAlarm={false}
              />
            </Tabs.Content>
          )}

          {/* ── Aba: Catálogo — produtos + feed + publicação no TikTok (DPA).
              Antes era página própria no menu; agora vive onde é usado. ── */}
          {tab === 'catalog' && (
            <Tabs.Content value="catalog" data-tour="ads-catalog" className="min-w-0 outline-none" aria-label="Catálogos">
              <CatalogManager key={`CatalogManager:${concreteAdvertiser}`}
                request={catalogRequest}
                onRequestHandled={() => setCatalogRequest(null)}
                advertiserId={concreteAdvertiser}
                advertiserLabel={advertisers.find((a) => String(a.id) === String(concreteAdvertiser))?.name || ''}
                advertiserCurrency={advertisers.find((a) => String(a.id) === String(concreteAdvertiser))?.currency || currency}
                onLocalWorkStateChange={setCatalogLocalWork}
              />
            </Tabs.Content>
          )}

          {/* Aprovações, estado e regras; forceMount preserva drafts locais ao trocar de subaba,
              enquanto `active` desliga polling quando Automações não está visível. */}
          <Tabs.Content forceMount value="automation" data-tour="ads-automation" className="flex flex-col gap-4 outline-none data-[state=inactive]:hidden">
            <NeedsYouInbox key={`NeedsYouInbox:${concreteAdvertiser}`} active={automationActive} adAccountId={concreteAdvertiser} currency={currency} onOpenOps={() => openOps()} onOpenHealth={() => setHealthOpen(true)} onOpenAlerts={openPerformanceAlerts} appearance="automation" />
            <AutomationPanel key={`AutomationPanel:${concreteAdvertiser}`}
              active={automationActive}
              currency={currency}
              adAccountId={concreteAdvertiser}
              onOpenLimits={() => openOps('safety')}
              onDirtyChange={setAutomationDirty}
              focusAlertsRequest={alertsFocusRequest}
            />
            <details className="rounded-xl border border-border p-4" onToggle={event => { const open = event.currentTarget.open; setToolsExpanded(open); if (open) setToolsMounted(true) }}>
              <summary className="cursor-pointer text-sm font-medium">Mais ferramentas</summary>
              {toolsMounted ? <div className="mt-4"><MagicOpsPanel key={`MagicOpsPanel:${concreteAdvertiser}`} active={automationActive && toolsExpanded} advertiserId={concreteAdvertiser} currency={currency} fromDate={fromDate} toDate={toDate} advertiserTimeZone={advertiserContextTimeZone} onDirtyChange={setMagicOpsDirty} externalDirty={automationDirty} /></div> : null}
            </details>
          </Tabs.Content>
        </Tabs.Root>
      )}

      <AudiencesDialog key={`AudiencesDialog:${concreteAdvertiser}`} open={audiencesOpen} onClose={() => setAudiencesOpen(false)} advertiserId={concreteAdvertiser} onConfigurePixel={() => { setAudiencesOpen(false); requestAnimationFrame(() => document.getElementById('tiktok-pixel-binding')?.scrollIntoView({ behavior: 'smooth', block: 'center' })) }} />
      {/* Fluxos de escrita */}
      <UniversalLauncherDialog key={`UniversalLauncherDialog:${concreteAdvertiser}`}
        open={launcherOpen}
        onClose={() => setLauncherOpen(false)}
        advertiserId={concreteAdvertiser}
        currency={currency}
        onSuccess={() => { void refreshCampaignSurfaces() }}
        onSmartPlus={() => { setLauncherOpen(false); setSmartPlusOpen(true) }}
        onSpark={() => { setLauncherOpen(false); setSparkOpen(true) }}
        onConfigurePixel={() => { setLauncherOpen(false); requestAnimationFrame(() => document.getElementById('tiktok-pixel-binding')?.scrollIntoView({ behavior: 'smooth', block: 'center' })) }}
      />
      <SparkAdDialog key={`SparkAdDialog:${concreteAdvertiser}`}
        open={sparkOpen}
        onClose={() => setSparkOpen(false)}
        advertiserId={concreteAdvertiser}
        currency={currency}
        onCreated={() => {
          setSparkOpen(false)
          void refreshCampaignSurfaces()
        }}
      />
      <SmartPlusCreateDialog key={`SmartPlusCreateDialog:${concreteAdvertiser}`}
        open={smartPlusOpen}
        onClose={() => setSmartPlusOpen(false)}
        advertiserId={concreteAdvertiser}
        currency={currency}
        onCreated={() => {
          setSmartPlusOpen(false)
          void refreshCampaignSurfaces()
        }}
        onConfigurePixel={() => { setSmartPlusOpen(false); requestAnimationFrame(() => document.getElementById('tiktok-pixel-binding')?.scrollIntoView({ behavior: 'smooth', block: 'center' })) }}
      />
      <OpsDialog key={`OpsDialog:${concreteAdvertiser}`}
        open={opsOpen}
        onClose={() => setOpsOpen(false)}
        advertiserId={concreteAdvertiser}
        currency={currency}
        initialTab={opsInitialTab}
        onPolicyChanged={() => mutateSafety()}
      />
      <HealthDialog open={healthOpen} onClose={() => setHealthOpen(false)} />
      <DuplicateDialog
        campaign={duplicateCampaign}
        onClose={() => setDuplicateCampaign(null)}
        advertisers={advertisers}
        currentAdvertiserId={duplicateCampaign?.platformAdAccountId || concreteAdvertiser}
        onFinished={() => { void refreshCampaignSurfaces() }}
      />
      <CampaignDrawer
        key={`${concreteAdvertiser}:${detailCampaign?.platformCampaignId}:${fromDate}:${toDate}`}
        fromDate={fromDate}
        toDate={toDate}
        timeZone={advertiserTimeZone}
        campaign={detailCampaign}
        advertiserId={detailCampaign?.platformAdAccountId || concreteAdvertiser}
        currency={currency}
        onClose={() => setDetailCampaign(null)}
        onMutate={refreshCampaignSurfaces}
        onDuplicate={(campaign) => setDuplicateCampaign(campaign)}
        onOpenAutomations={() => {
          setDetailCampaign(null)
          changeTab('automation')
        }}
      />
      <ConfirmDialog
        open={confirmTabChange}
        title={catalogLeaveCopy.title}
        description={catalogLeaveCopy.description}
        confirmLabel={catalogLeaveCopy.confirmLabel}
        appearance="quiet"
        tone="danger"
        onConfirm={() => {
          const historyNavigation = pendingHistoryNavigationRef.current
          const next = pendingTab
          setConfirmTabChange(false)
          setPendingTab(null)
          if (historyNavigation) {
            pendingHistoryNavigationRef.current = null
            allowNextPopRef.current = true
            window.history.go(historyNavigation.delta)
            return
          }
          if (next) commitTabChange(next)
        }}
        onClose={() => { pendingHistoryNavigationRef.current = null; setConfirmTabChange(false); setPendingTab(null) }}
      />
      <ConfirmDialog
        open={confirmCatalogAction}
        title={catalogCreateCopy.title}
        description={catalogCreateCopy.description}
        confirmLabel={catalogCreateCopy.confirmLabel}
        appearance="quiet"
        tone="danger"
        onConfirm={() => { const action = pendingCatalogAction; setConfirmCatalogAction(false); setPendingCatalogAction(null); if (action) commitCatalogRequest(action) }}
        onClose={() => { setConfirmCatalogAction(false); setPendingCatalogAction(null) }}
      />
      <ConfirmDialog
        open={confirmAccountSwitch}
        title="Trocar de conta e descartar alterações?"
        description={hasCatalogLocalWork
          ? (hasAutomationDraft
              ? (catalogLocalWork.uploading
                  ? 'Há configurações não salvas e vídeos sendo enviados nesta conta. Trocar de conta descartará os rascunhos locais e cancelará uploads ainda não concluídos.'
                  : 'Há configurações não salvas e envios locais pendentes ou com falha nesta conta. Trocar de conta descartará os rascunhos e as opções locais de tentar novamente.')
              : (catalogLocalWork.uploading
                  ? 'Há vídeos sendo enviados nesta conta. Trocar de conta cancelará os uploads ainda não concluídos. Vídeos já enviados permanecem vinculados.'
                  : 'Há envios locais pendentes ou com falha nesta conta. Trocar de conta descartará os itens ainda não concluídos e as opções locais de tentar novamente.'))
          : 'Há configurações não salvas nesta conta de anúncios. Trocar de conta descartará esses rascunhos locais.'}
        confirmLabel="Trocar de conta"
        appearance="quiet"
        tone="danger"
        busy={switchingAccount}
        onConfirm={() => { const id = pendingAdvertiserId; if (id) void commitAdvertiserChange(id) }}
        onClose={() => { setConfirmAccountSwitch(false); setPendingAdvertiserId(null) }}
      />
      <ConfirmDialog
        open={confirmDisconnect}
        title="Desconectar a conta TikTok Ads?"
        description={
          <>
            O painel esquece a conexão e as campanhas deixam de aparecer aqui. Os anúncios continuam
            rodando normalmente no TikTok — nada é pausado ou excluído.{hasAutomationDraft ? ' Alterações locais não salvas em Automações também serão descartadas.' : ''}{hasCatalogLocalWork ? (catalogLocalWork.uploading ? ' Uploads locais de criativos do Catálogo ainda não concluídos também serão cancelados.' : ' Envios locais pendentes ou com falha no Catálogo e suas opções de tentar novamente também serão descartados.') : ''}
          </>
        }
        confirmLabel="Desconectar"
        appearance="quiet"
        busy={disconnecting}
        onConfirm={handleDisconnect}
        onClose={() => setConfirmDisconnect(false)}
      />
    </div>
  )
}
