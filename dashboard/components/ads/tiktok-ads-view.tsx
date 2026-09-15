'use client'

// Aba TikTok Ads (via Pipeboard) — orquestra verificação de conexão, seleção de
// advertiser, KPIs agregados e a árvore de campanhas. Os fluxos de escrita
// (criar anúncio e Spark Ads) vivem em componentes próprios.

import { AudiencesDialog } from './audiences-dialog'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSWRConfig } from 'swr'
import * as Tabs from '@radix-ui/react-tabs'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Megaphone, Plus, FlaskConical, OctagonAlert, Ban, Bot, ShoppingBag, ChevronDown, Sparkles, UploadCloud, Users, TrendingUp, Target, AlertCircle, ArrowRight, ShieldCheck, BarChart3 } from 'lucide-react'
import {
  useAdsStatus,
  useAdsAccounts,
  useAdsTree,
  useAdsCampaignDecisions,
  useAdsSafetyPolicy,
  useAdsHealth,
  useAdsSyncStatus,
  useAdsRejections,
  useAccountSettings,
  apiSend,
} from '@/lib/api'
import { toast } from '@/lib/toast'
import type { AdsTreeCampaign } from '@/lib/types'
import { GlassCard } from '@/components/glass-card'
import { Skeleton } from '@/components/skeleton'
import { ErrorState } from '@/components/error-state'
import { AdsConnectCard } from './connect-card'
import { AdsContextBar } from './context-bar'
import { CampaignTree } from './campaign-tree'
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
import { adsDateRange } from '@/lib/ads-time'
import { MagicOpsPanel } from './magic-ops-panel'
import { NeedsYouInbox } from './needs-you-inbox'
import { UniversalLauncherDialog } from './universal-launcher-dialog'
import { apiCacheKeyMatches } from '@/lib/cache-consistency'
import { useOverviewPeriod } from '@/lib/overview-period'
import { PERIODS } from '@/components/overview/period-picker'

export function TikTokAdsView() {
  const [catalogRequest, setCatalogRequest] = useState<{ action: 'create' | 'magic' | 'batch'; id: number } | null>(null)
  function requestCatalog(action: 'create' | 'magic' | 'batch') {
    setCatalogRequest(previous => ({ action, id: (previous?.id || 0) + 1 }))
    changeTab('catalog')
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
  const { data: accountSettings } = useAccountSettings()
  const rangeDays = period === 'today' ? 1 : period === '7d' ? 7 : period === '30d' ? 30 : 365
  const periodLabel = PERIODS.find(item => item.id === period)?.label || 'Hoje'
  const selectedAdvertiserInfo = accounts?.accounts.find((a) => String(a.id) === String(effectiveAdvertiser))
  const advertiserTimeZone = selectedAdvertiserInfo?.timezone || status?.timeZone
  const reportingTimeZone = accountSettings?.timezone || 'America/Sao_Paulo'
  const [calendarTick, setCalendarTick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setCalendarTick(tick => tick + 1), 60_000)
    return () => clearInterval(timer)
  }, [])
  const { fromDate, toDate } = useMemo(
    () => adsDateRange(rangeDays, reportingTimeZone),
    [rangeDays, reportingTimeZone, calendarTick],
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
  const SUBTABS: { value: TabKey; label: string; compactLabel: string; description: string; icon: typeof Megaphone }[] = [
    { value: 'campaigns', label: 'Campanhas', compactLabel: 'Campanhas', description: 'Resultado, decisões e operação', icon: Megaphone },
    { value: 'catalog', label: 'Catálogo', compactLabel: 'Catálogo', description: 'Produtos, feed e DPA', icon: ShoppingBag },
    { value: 'automation', label: 'Automações', compactLabel: 'Automações', description: 'Regras, alertas e aprovações', icon: Bot },
  ]
  const [toolsExpanded, setToolsExpanded] = useState(false)
  const [tab, setTab] = useState<TabKey>('campaigns')

  const treeActive = connected && Boolean(effectiveAdvertiser)
  const campaignsActive = treeActive && tab === 'campaigns'
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
  useEffect(() => {
    // Lê ?tab= no mount e a cada navegação (voltar/avançar). Mapa de
    // compatibilidade dos aliases antigos (overview→today, ai→automation,
    // smartplus→campanhas+segmento) para não quebrar favoritos e deep-links.
    const readTab = () => {
      const query = new URLSearchParams(window.location.search)
      // `view` saiu em pushes antigos. Mantê-lo como fallback garante que uma
      // notificação já entregue ainda abra a decisão certa.
      const t = query.get('tab') || query.get('view')
      if (t && validTabs.has(t as TabKey)) setTab(t as TabKey)
      else if (t === 'overview' || t === 'today' || t === 'smartplus') setTab('campaigns')
      else if (t === 'ai') setTab('automation')
      else setTab('campaigns')
    }
    readTab()
    window.addEventListener('popstate', readTab)
    return () => window.removeEventListener('popstate', readTab)
  }, [validTabs])

  // Troca de aba sincronizada com a URL (?tab=) — Campanhas é o padrão.
  function changeTab(value: TabKey) {
    setTab(value)
    const url = new URL(window.location.href)
    url.searchParams.delete('view')
    if (value === 'campaigns') url.searchParams.delete('tab')
    else url.searchParams.set('tab', value)
    window.history.pushState({}, '', `${url.pathname}${url.search}${url.hash}`)
  }

  const [audiencesOpen, setAudiencesOpen] = useState(false)
  const [launcherOpen, setLauncherOpen] = useState(false)
  const [sparkOpen, setSparkOpen] = useState(false)
  const [smartPlusOpen, setSmartPlusOpen] = useState(false)
  const [opsOpen, setOpsOpen] = useState(false)
  const [opsInitialTab, setOpsInitialTab] = useState<'jobs' | 'safety'>('jobs')
  const [healthOpen, setHealthOpen] = useState(false)

  function openOps(initialTab: 'jobs' | 'safety' = 'jobs') {
    setOpsInitialTab(initialTab)
    setOpsOpen(true)
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
          title="Conecte o TikTok Ads"
          description="Configure a chave do Pipeboard nas configurações do servidor para acessar suas campanhas."
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
        <Skeleton className="h-24 rounded-2xl" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 stagger-fade">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton
              key={i}
              className="h-24 rounded-2xl stagger-fade"
              style={{ '--i': i, '--stagger-index': i } as React.CSSProperties}
            />
          ))}
        </div>
        <Skeleton className="h-64 rounded-2xl" />
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
  if (accountsLoading && !accounts) return <Skeleton className="h-48 rounded-2xl" />

  const advertisers = accounts?.accounts ?? []

  return (
    <div className="tiktok-view min-w-0 flex flex-col gap-4">
      <section className="rounded-[28px] border border-border/70 bg-[radial-gradient(circle_at_top_left,rgba(37,244,238,0.09),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0.012))] p-4 shadow-[0_28px_70px_-44px_rgba(0,0,0,0.95)] sm:p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">TikTok Ads</h1>
          </div>
          {effectiveAdvertiser ? (
            <div className="flex flex-wrap items-center gap-2 xl:justify-end">
              <span className="rounded-full border border-border/70 bg-black/20 px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
                {selectedAdvertiserInfo?.name || 'Conta selecionada'}
              </span>
              <span className="rounded-full border border-border/70 bg-black/20 px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
                {periodLabel}
              </span>
            </div>
          ) : null}
        </div>

        {effectiveAdvertiser && tab === 'campaigns' ? (
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <div className="rounded-2xl border border-border/60 bg-black/15 p-3.5">
              <div className="flex items-center justify-between gap-3"><span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Campanhas ativas</span><Megaphone className="size-4 text-brand-cyan" /></div>
              <p className="mt-2 text-xl font-semibold tracking-tight text-foreground">{adsOperationalSummary.active}</p>
                          </div>
            <div className="rounded-2xl border border-border/60 bg-black/15 p-3.5">
              <div className="flex items-center justify-between gap-3"><span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Gasto TikTok</span><BarChart3 className="size-4 text-muted-foreground" /></div>
              <p className="mt-2 text-xl font-semibold tracking-tight text-foreground">{formatAdsMoney(adsOperationalSummary.spend)}</p>
                          </div>
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/8 p-3.5">
              <div className="flex items-center justify-between gap-3"><span className="text-[10px] uppercase tracking-[0.18em] text-emerald-300/80">Vendas reais</span><Target className="size-4 text-emerald-300" /></div>
              <p className="mt-2 text-xl font-semibold tracking-tight text-foreground">{campaignDecisions ? adsOperationalSummary.sales.toLocaleString('pt-BR') : '—'}</p>
                          </div>
            <div className="rounded-2xl border border-brand-cyan/20 bg-brand-cyan/8 p-3.5">
              <div className="flex items-center justify-between gap-3"><span className="text-[10px] uppercase tracking-[0.18em] text-brand-cyan/80">ROAS real</span><TrendingUp className="size-4 text-brand-cyan" /></div>
              <p className="mt-2 text-xl font-semibold tracking-tight text-foreground">{adsOperationalSummary.roas === null ? '—' : `${adsOperationalSummary.roas.toFixed(2)}×`}</p>
                          </div>
            <div className={`rounded-2xl border p-3.5 ${adsOperationalSummary.pendingProposals || adsOperationalSummary.noSalesWithSpend || (rejections?.open ?? 0) ? 'border-warning/25 bg-warning/8' : 'border-border/60 bg-black/15'}`}>
              <div className="flex items-center justify-between gap-3"><span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Prioridades</span><ShieldCheck className={`size-4 ${adsOperationalSummary.pendingProposals || adsOperationalSummary.noSalesWithSpend || (rejections?.open ?? 0) ? 'text-warning' : 'text-success'}`} /></div>
              <p className="mt-2 text-xl font-semibold tracking-tight text-foreground">{adsOperationalSummary.pendingProposals + adsOperationalSummary.noSalesWithSpend + (rejections?.open ?? 0)}</p>
                          </div>
          </div>
        ) : null}
      </section>

      {/* Só existe quando há um estado que exige atenção — sem uma faixa vazia
          acima do contexto da conta. */}
      {hasAccountAlert && (
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Badge de guardrail ativo — o usuário entende por que nada publica */}
          {killSwitchActive ? (
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-full border border-error/40 bg-error/10 px-2.5 py-1 text-[11px] font-semibold text-error"
              onClick={() => openOps('safety')}
              title="Novas ações estão bloqueadas. Campanhas já ativas continuam veiculando."
            >
              <OctagonAlert className="size-3" aria-hidden="true" />
              Ações bloqueadas
            </button>
          ) : dryRunActive ? (
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-2.5 py-1 text-[11px] font-semibold text-warning"
              onClick={() => openOps('safety')}
              title="Modo teste: o robô roda mas nada é publicado no TikTok. Clique para gerenciar."
            >
              <FlaskConical className="size-3" aria-hidden="true" />
              Modo teste
            </button>
          ) : null}
          {/* Badge de conta banida — clica e abre o painel de saúde/tickets */}
          {bannedAccounts.length > 0 && (
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-full border border-error/40 bg-error/10 px-2.5 py-1 text-[11px] font-semibold text-error"
              onClick={() => setHealthOpen(true)}
              title={`${bannedAccounts.length} conta(s) banida(s)${openTickets.length ? ` · ${openTickets.length} ticket(s) de desbanimento` : ''}. Clique para ver.`}
            >
              <Ban className="size-3" aria-hidden="true" />
              {bannedAccounts.length === 1 ? 'Conta banida' : `${bannedAccounts.length} contas banidas`}
            </button>
          )}
        </div>
      )}

      {/* Barra de contexto: conta de anúncio + deep-link + desconectar */}
      <AdsContextBar
        advertisers={advertisers}
        selectedAdvertiser={effectiveAdvertiser}
        refreshing={refreshing}
        onAdvertiserChanged={(id) => {
          setAdvertiserId(id)
          setPage(1)
          void Promise.allSettled([mutateAccounts(), mutateStatus()])
        }}
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

      <PixelBindingCard active={Boolean(concreteAdvertiser)} advertiserId={concreteAdvertiser} />

      {!effectiveAdvertiser ? (
        <GlassCard className="flex flex-col items-center gap-2 p-6 text-center">
          <span className="flex size-12 items-center justify-center rounded-xl bg-secondary text-primary">
            <Megaphone className="size-5" aria-hidden="true" />
          </span>
          <p className="text-sm font-medium text-foreground">Escolha uma conta de anúncios</p>
          <p className="max-w-md text-pretty text-xs text-muted-foreground">Escolha uma conta acima para ver e operar as campanhas.</p>
        </GlassCard>
      ) : (
        <Tabs.Root value={tab} onValueChange={value => changeTab(value as TabKey)} className="tiktok-workspace flex min-w-0 flex-col gap-4">
          {/* Sub-abas por tarefa: cada tela tem UM propósito. O padrão visual
              (pill tablist) é o mesmo da aba Atividade. */}
          <div className="tiktok-tabs-row">
            <Tabs.List data-tour="ads-tabs" aria-label="Áreas do TikTok Ads" className="section-tabs section-tabs--ads">
                {SUBTABS.map((item) => {
                  const attentionCount = item.value === 'automation'
                    ? bannedAccounts.length + openTickets.length + (rejections?.open ?? 0)
                    : item.value === 'campaigns' && tree?.syncError ? 1 : 0

                  return (
                    <Tabs.Trigger
                      key={item.value}
                      value={item.value}
                      className="section-tabs__item tiktok-section-tab touch-manipulation"
                    >
                      <item.icon className="size-4" aria-hidden="true" />
                      <span className="min-w-0 truncate">{item.label}</span>
                      {attentionCount > 0 && (
                        <span className="section-tabs__badge" aria-label={`${attentionCount} item(ns) que exigem atenção`}>
                          {attentionCount}
                        </span>
                      )}
                    </Tabs.Trigger>
                  )
                })}
            </Tabs.List>

            {tab === 'campaigns' && (
              <div className="tiktok-tabs-actions">
                <button
                  type="button"
                  className="btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold h-9 rounded-lg touch-manipulation cursor-pointer"
                  onClick={() => setAudiencesOpen(true)}
                  title="Gerenciar públicos de remarketing e semelhantes"
                >
                  <Users className="size-3.5" aria-hidden="true" />
                  <span>Públicos</span>
                </button>
                <button
                  type="button"
                  className="btn-primary inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold h-9 rounded-lg shrink-0 touch-manipulation cursor-pointer"
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
              <div className="tiktok-tabs-actions">
                <button
                  type="button"
                  className="btn-primary inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold h-9 rounded-lg touch-manipulation cursor-pointer"
                  onClick={() => requestCatalog('magic')}
                >
                  <Sparkles className="size-3.5" aria-hidden="true" />
                  <span>Criar pelo link</span>
                </button>
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <button
                      type="button"
                      className="btn-secondary inline-flex items-center justify-center size-9 p-0 rounded-lg touch-manipulation cursor-pointer"
                      aria-label="Outras opções de criação"
                    >
                      <ChevronDown className="size-3.5" aria-hidden="true" />
                    </button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content align="end" sideOffset={6} className="glass glass-thick anim-pop-in z-50 min-w-44 rounded-xl border border-border bg-background p-1 shadow-xl">
                      <DropdownMenu.Item className="flex min-h-9 cursor-pointer items-center gap-2 rounded-lg px-2.5 text-xs outline-none data-[highlighted]:bg-secondary" onSelect={() => requestCatalog('batch')}>
                        <UploadCloud className="size-3.5" aria-hidden="true" /> Importar planilha
                      </DropdownMenu.Item>
                      <DropdownMenu.Item className="flex min-h-9 cursor-pointer items-center gap-2 rounded-lg px-2.5 text-xs outline-none data-[highlighted]:bg-secondary" onSelect={() => requestCatalog('create')}>
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
            <GlassCard className="border-warning/40 bg-warning/10 p-4">
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
                        className="btn-ghost mt-1 text-[11px]"
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
            </GlassCard>
          )}

          {/* ── Aba: Campanhas — uma lista e uma única entrada de criação. ── */}
          {tab === 'campaigns' && (
            <Tabs.Content value="campaigns" className="space-y-4 outline-none">
              {(adsOperationalSummary.pendingProposals > 0 || adsOperationalSummary.noSalesWithSpend > 0 || adsOperationalSummary.highRoas > 0 || (rejections?.open ?? 0) > 0) && (
                <GlassCard className="p-4 sm:p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="flex items-center gap-2">
                      <Sparkles className="size-4 text-brand-cyan" aria-hidden="true" />
                      <h2 className="text-sm font-semibold text-foreground">Prioridades</h2>
                    </div>
                    <div className="grid flex-1 gap-2 sm:grid-cols-2 xl:grid-cols-4 lg:max-w-4xl">
                      {adsOperationalSummary.noSalesWithSpend > 0 ? (
                        <button type="button" onClick={() => applyCampaignShortcut('sem venda')} className="group rounded-2xl border border-warning/20 bg-warning/8 p-3 text-left transition hover:border-warning/40 hover:bg-warning/12">
                          <div className="flex items-center justify-between gap-2"><AlertCircle className="size-4 text-warning" /><ArrowRight className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" /></div>
                          <p className="mt-2 text-sm font-semibold text-foreground">{adsOperationalSummary.noSalesWithSpend} sem venda</p>
                                                  </button>
                      ) : null}
                      {adsOperationalSummary.pendingProposals > 0 ? (
                        <button type="button" onClick={() => changeTab('automation')} className="group rounded-2xl border border-warning/20 bg-warning/8 p-3 text-left transition hover:border-warning/40 hover:bg-warning/12">
                          <div className="flex items-center justify-between gap-2"><Bot className="size-4 text-warning" /><ArrowRight className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" /></div>
                          <p className="mt-2 text-sm font-semibold text-foreground">{adsOperationalSummary.pendingProposals} decisão{adsOperationalSummary.pendingProposals === 1 ? '' : 'ões'} pendente{adsOperationalSummary.pendingProposals === 1 ? '' : 's'}</p>
                                                  </button>
                      ) : null}
                      {(rejections?.open ?? 0) > 0 ? (
                        <button type="button" onClick={() => changeTab('automation')} className="group rounded-2xl border border-error/20 bg-error/8 p-3 text-left transition hover:border-error/40 hover:bg-error/12">
                          <div className="flex items-center justify-between gap-2"><Ban className="size-4 text-error" /><ArrowRight className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" /></div>
                          <p className="mt-2 text-sm font-semibold text-foreground">{rejections?.open} reprovação{(rejections?.open ?? 0) === 1 ? '' : 'ões'}</p>
                                                  </button>
                      ) : null}
                      {adsOperationalSummary.highRoas > 0 ? (
                        <button type="button" onClick={() => applyCampaignShortcut('roas acima de 2')} className="group rounded-2xl border border-brand-cyan/20 bg-brand-cyan/8 p-3 text-left transition hover:border-brand-cyan/40 hover:bg-brand-cyan/12">
                          <div className="flex items-center justify-between gap-2"><TrendingUp className="size-4 text-brand-cyan" /><ArrowRight className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" /></div>
                          <p className="mt-2 text-sm font-semibold text-foreground">{adsOperationalSummary.highRoas} vencedora{adsOperationalSummary.highRoas === 1 ? '' : 's'}</p>
                                                  </button>
                      ) : null}
                    </div>
                  </div>
                </GlassCard>
              )}
              <NeedsYouInbox
                key={`NeedsYouInbox:campaigns:${concreteAdvertiser}`}
                active={treeActive}
                adAccountId={concreteAdvertiser}
                onOpenOps={() => openOps()}
                onOpenHealth={() => setHealthOpen(true)}
                onGoAutomations={() => changeTab('automation')}
              />
              <CampaignTree
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
            </Tabs.Content>
          )}

          {/* ── Aba: Catálogo — produtos + feed + publicação no TikTok (DPA).
              Antes era página própria no menu; agora vive onde é usado. ── */}
          {tab === 'catalog' && (
            <Tabs.Content value="catalog" className="min-w-0 outline-none" aria-label="Catálogos">
              <CatalogManager key={`CatalogManager:${concreteAdvertiser}`}
                request={catalogRequest}
                onRequestHandled={() => setCatalogRequest(null)}
                advertiserId={concreteAdvertiser}
                advertiserLabel={advertisers.find((a) => String(a.id) === String(concreteAdvertiser))?.name || ''}
                advertiserCurrency={advertisers.find((a) => String(a.id) === String(concreteAdvertiser))?.currency || currency}
              />
            </Tabs.Content>
          )}

          {/* Aprovações, estado e regras; ferramentas extras sob demanda. */}
          {tab === 'automation' && (
            <Tabs.Content value="automation" className="flex flex-col gap-4 outline-none">
              <NeedsYouInbox key={`NeedsYouInbox:${concreteAdvertiser}`} active={treeActive} adAccountId={concreteAdvertiser} onOpenOps={() => openOps()} onOpenHealth={() => setHealthOpen(true)} onGoAutomations={() => openOps('safety')} />
              <AutomationPanel key={`AutomationPanel:${concreteAdvertiser}`}
                active={treeActive}
                currency={currency}
                adAccountId={concreteAdvertiser}
                onOpenLimits={() => openOps('safety')}
              />
              <details className="rounded-xl border border-border p-4" onToggle={event => setToolsExpanded(event.currentTarget.open)}>
                <summary className="cursor-pointer text-sm font-medium">Mais ferramentas</summary>
                {toolsExpanded && <div className="mt-4"><MagicOpsPanel key={`MagicOpsPanel:${concreteAdvertiser}`} active={treeActive} advertiserId={concreteAdvertiser} currency={currency} fromDate={fromDate} toDate={toDate} /></div>}
              </details>
            </Tabs.Content>
          )}
        </Tabs.Root>
      )}

      <AudiencesDialog key={`AudiencesDialog:${concreteAdvertiser}`} open={audiencesOpen} onClose={() => setAudiencesOpen(false)} advertiserId={concreteAdvertiser} />
      {/* Fluxos de escrita */}
      <UniversalLauncherDialog key={`UniversalLauncherDialog:${concreteAdvertiser}`}
        open={launcherOpen}
        onClose={() => setLauncherOpen(false)}
        advertiserId={concreteAdvertiser}
        currency={currency}
        onSuccess={() => { void refreshCampaignSurfaces() }}
        onSmartPlus={() => { setLauncherOpen(false); setSmartPlusOpen(true) }}
        onSpark={() => { setLauncherOpen(false); setSparkOpen(true) }}
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
        open={confirmDisconnect}
        title="Desconectar a conta TikTok Ads?"
        description={
          <>
            O painel esquece a conexão e as campanhas deixam de aparecer aqui. Os anúncios continuam
            rodando normalmente no TikTok — nada é pausado ou excluído.
          </>
        }
        confirmLabel="Desconectar"
        busy={disconnecting}
        onConfirm={handleDisconnect}
        onClose={() => setConfirmDisconnect(false)}
      />
    </div>
  )
}
