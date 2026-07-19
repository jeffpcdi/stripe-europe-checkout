'use client'

// Aba TikTok Ads (via Pipeboard) — orquestra verificação de conexão, seleção de
// advertiser, KPIs agregados e a árvore de campanhas. Os fluxos de escrita
// (criar anúncio, Spark Ads, Brand Identity) vivem em componentes próprios.

import { useEffect, useMemo, useState } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Megaphone, Plus, Zap, UserRound, Layers, MoreHorizontal, FlaskConical, OctagonAlert, Ban, Gauge, Sparkles, Bot, BrainCircuit, ShoppingBag } from 'lucide-react'
import {
  useAdsStatus,
  useAdsAccounts,
  useAdsTree,
  useAdsAttribution,
  useAdsSafetyPolicy,
  useAdsHealth,
  useAdsBriefing,
  apiSend,
} from '@/lib/api'
import { toast } from '@/lib/toast'
import type { AdsMetrics, AdsTreeCampaign } from '@/lib/types'
import { GlassCard } from '@/components/glass-card'
import { SectionTitle } from '@/components/section-title'
import { Skeleton } from '@/components/skeleton'
import { ErrorState } from '@/components/error-state'
import { AdsConnectCard } from './connect-card'
import { AdsContextBar } from './context-bar'
import { BulkUploadDialog } from './bulk-upload-dialog'
import { CampaignTree } from './campaign-tree'
import { CreateAdPanel } from './create-ad-panel'
import { SparkAdDialog } from './spark-ad-dialog'
import { IdentityDialog } from './identity-dialog'
import { CampaignDrawer } from './campaign-drawer'
import { DuplicateDialog } from './duplicate-dialog'
import { OpsDialog } from './ops-dialog'
import { HealthDialog } from './health-dialog'
import { AutomationPanel } from './automation-panel'
import { SmartPlusPanel } from './smart-plus-panel'
import { CatalogManager } from './catalog-manager'
import { OperationsCenter } from './operations-center'
import { TodayPanel } from './today-panel'
import { usePersistedState } from '@/lib/use-persisted-state'
import { ConfirmDialog } from '@/components/confirm-dialog'

export function TikTokAdsView() {
  const { data: status, mutate: mutateStatus, isLoading: statusLoading, error: statusError } = useAdsStatus()
  const connected = Boolean(status?.connected)

  // Pipeboard não tem Business Center — as contas vêm direto do token.
  const { data: accounts, mutate: mutateAccounts } = useAdsAccounts(connected)

  const [advertiserId, setAdvertiserId] = useState<string | null>(null) // null = usa o salvo
  const effectiveAdvertiser = advertiserId ?? accounts?.selected ?? ''
  // Abre em "Ativas": há ~8 ativas e ~99 pausadas — abrir em "Todas" enterrava
  // o operador em ruído. Ele filtra para "Todas" quando quiser o histórico.
  const [statusFilter, setStatusFilter] = useState('active')
  const [sort, setSort] = useState('newest')
  const [page, setPage] = useState(1)
  // Período das métricas/descoberta de campanhas. Default 365d — janela
  // curta escondia campanhas antigas e parecia "faltando".
  const [rangeDays, setRangeDays] = useState(1) // padrão diário — pedido do produto
  const { fromDate, toDate } = useMemo(() => {
    const iso = (d: Date) => d.toISOString().slice(0, 10)
    const now = new Date()
    return { fromDate: iso(new Date(now.getTime() - rangeDays * 86_400_000)), toDate: iso(now) }
  }, [rangeDays])

  const treeActive = connected && Boolean(effectiveAdvertiser)
  const {
    data: tree,
    mutate: mutateTree,
    isLoading: treeLoading,
    isValidating: treeValidating,
    error: treeError,
  } = useAdsTree(treeActive, {
    adAccountId: effectiveAdvertiser || undefined,
    status: statusFilter || undefined,
    sort,
    page,
    fromDate,
    toDate,
  })

  // Vendas reais por campanha — mesmo lookback padrão da árvore (7 dias)
  const { data: attribution } = useAdsAttribution(treeActive, effectiveAdvertiser)

  // Sub-abas por tarefa: a página empilhava 12 cards numa coluna só e ninguém
  // achava nada. Cada aba tem UM propósito: ver resultado / operar campanhas /
  // configurar automações / usar a IA. Estado local (não URL) — trocar de aba
  // não recarrega nada, os hooks SWR continuam vivos. Exceção (F4): ?tab= é
  // honrado UMA vez pós-mount (deep-link "ver automações" da home). useEffect
  // em vez de initializer para não divergir da renderização do servidor;
  // window.location em vez de useSearchParams para não exigir Suspense.
  // 4 abas por tarefa: Hoje (centro de comando) · Campanhas (absorve Smart+) ·
  // Automações (absorve IA) · Catálogo. Smart+ e IA deixaram de ser abas — o
  // gestor não deve caçar em 6 portas o que é um fluxo só.
  type TabKey = 'today' | 'campaigns' | 'automation' | 'catalog'
  const SUBTABS: { value: TabKey; label: string; icon: typeof Gauge }[] = [
    { value: 'today', label: 'Hoje', icon: Gauge },
    { value: 'campaigns', label: 'Campanhas', icon: Megaphone },
    { value: 'automation', label: 'Automações', icon: Bot },
    { value: 'catalog', label: 'Catálogo', icon: ShoppingBag },
  ]
  const [tab, setTab] = useState<TabKey>('today')
  // Dentro de Campanhas: "Manuais" (árvore + criação) ou "Smart+".
  const [campaignsView, setCampaignsView] = usePersistedState<'manual' | 'smartplus'>('ads:campaigns:view', 'manual')
  const validTabs = useMemo(() => new Set<TabKey>(SUBTABS.map((item) => item.value)), [])
  useEffect(() => {
    // Lê ?tab= no mount e a cada navegação (voltar/avançar). Mapa de
    // compatibilidade dos aliases antigos (overview→today, ai→automation,
    // smartplus→campanhas+segmento) para não quebrar favoritos e deep-links.
    const readTab = () => {
      const t = new URLSearchParams(window.location.search).get('tab')
      if (t && validTabs.has(t as TabKey)) setTab(t as TabKey)
      else if (t === 'overview') setTab('today')
      else if (t === 'ai') setTab('automation')
      else if (t === 'smartplus') { setTab('campaigns'); setCampaignsView('smartplus') }
      else setTab('today')
    }
    readTab()
    window.addEventListener('popstate', readTab)
    return () => window.removeEventListener('popstate', readTab)
  }, [validTabs, setCampaignsView])

  // Troca de aba sincronizada com a URL (?tab=) — 'today' é o default (sem query).
  function changeTab(value: TabKey) {
    setTab(value)
    const url = new URL(window.location.href)
    if (value === 'today') url.searchParams.delete('tab')
    else url.searchParams.set('tab', value)
    window.history.pushState({}, '', `${url.pathname}${url.search}${url.hash}`)
  }

  const [createOpen, setCreateOpen] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [sparkOpen, setSparkOpen] = useState(false)
  const [identityOpen, setIdentityOpen] = useState(false)
  const [opsOpen, setOpsOpen] = useState(false)
  const [healthOpen, setHealthOpen] = useState(false)

  // Política de segurança — alimenta o badge de simulação/kill switch
  const { data: safety, mutate: mutateSafety } = useAdsSafetyPolicy(connected)
  const dryRunActive = Boolean(safety?.policy?.dryRun)
  const killSwitchActive = Boolean(safety?.policy?.killSwitch)

  // Saúde das contas — o GET roda a varredura no backend (detecção de
  // banimento + criação automática de tickets); aqui alimenta o badge.
  const { data: adsHealth } = useAdsHealth(connected)
  const bannedAccounts = (adsHealth?.health ?? []).filter((h) => h.status === 'banned')
  const openTickets = (adsHealth?.tickets ?? []).filter((t) => t.status === 'open' || t.status === 'submitted')
  const [detailCampaign, setDetailCampaign] = useState<AdsTreeCampaign | null>(null)
  const [duplicateCampaign, setDuplicateCampaign] = useState<AdsTreeCampaign | null>(null)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)

  const concreteAdvertiser = effectiveAdvertiser

  function openWriteFlow(setOpen: (open: boolean) => void) {
    if (!concreteAdvertiser) {
      toast.info('Selecione uma conta de anúncio específica antes de criar ou publicar.')
      return
    }
    setOpen(true)
  }

  const currency = useMemo(() => {
    const adv = accounts?.accounts.find((a) => a.id === concreteAdvertiser)
    return adv?.currency || tree?.campaigns?.[0]?.currency || 'USD'
  }, [accounts, concreteAdvertiser, tree])

  // IA configurada no servidor? (resposta do briefing carrega a flag `ai`;
  // SWR dedupa com o fetch do BriefingCard — custo zero extra)
  const { data: briefingData } = useAdsBriefing(treeActive)
  const aiEnabled = briefingData?.ai ?? false

  // KPIs agregados sobre a página atual da árvore + série p/ sparkline
  const kpi = useMemo(() => {
    const zero = { spend: 0, impressions: 0, clicks: 0, conversions: 0 }
    if (!tree?.campaigns?.length) return { ...zero, ctr: 0, cpm: 0, activeCount: 0, spendSeries: [] as number[] }
    let spend = 0
    let impressions = 0
    let clicks = 0
    let conversions = 0
    let activeCount = 0
    const byDay = new Map<number, number>()
    tree.campaigns.forEach((c) => {
      const m = c.metrics ?? {}
      spend += m.spend ?? 0
      impressions += m.impressions ?? 0
      clicks += m.clicks ?? 0
      conversions += m.conversions ?? 0
      if (c.status === 'active') activeCount++
      c.daily?.forEach((d: AdsMetrics & { date?: string }, i: number) => {
        byDay.set(i, (byDay.get(i) ?? 0) + (d.spend ?? 0))
      })
    })
    const spendSeries = [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v)
    return {
      spend,
      impressions,
      clicks,
      conversions,
      ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
      cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
      activeCount,
      spendSeries: spendSeries.slice(-30),
    }
  }, [tree])

  async function handleDisconnect() {
    setDisconnecting(true)
    try {
      await apiSend('/api/ads/disconnect', 'POST')
      toast.success('Conta TikTok Ads desconectada')
      setAdvertiserId(null)
      mutateStatus()
    } catch (e) {
      toast.error('Falha ao desconectar', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setDisconnecting(false)
      setConfirmDisconnect(false)
    }
  }

  // ── Estado: chave ausente no servidor ────────────────────────────────────
  if (status && !status.enabled) {
    return (
      <div className="flex flex-col gap-5">
        <ErrorState
          title="Integração não configurada no servidor"
          description="A variável PIPEBOARD_API_KEY não está definida no servidor. Gere o token no painel do Pipeboard (pipeboard.co), adicione às variáveis de ambiente e tente novamente."
          onRetry={() => mutateStatus()}
        />
      </div>
    )
  }

  if (statusError) {
    return (
      <div className="flex flex-col gap-5">
        <ErrorState onRetry={() => mutateStatus()} />
      </div>
    )
  }

  if (statusLoading && !status) {
    return (
      <div className="flex flex-col gap-5">
        <Skeleton className="h-40 rounded-2xl bg-brand-cyan/5 shadow-[0_0_15px_rgba(37,244,238,0.1)] border border-brand-cyan/10" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 rounded-2xl bg-brand-cyan/5 shadow-[0_0_15px_rgba(37,244,238,0.1)] border border-brand-cyan/10" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-2xl bg-brand-cyan/5 shadow-[0_0_15px_rgba(37,244,238,0.1)] border border-brand-cyan/10" />
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

  const advertisers = accounts?.accounts ?? []

  return (
    <div className="flex flex-col gap-5">
      {/* Cabeçalho: título + conta conectada + ações principais */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Badge de guardrail ativo — o usuário entende por que nada publica */}
          {killSwitchActive ? (
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-full border border-error/40 bg-error/10 px-2.5 py-1 text-[11px] font-semibold text-error"
              onClick={() => setOpsOpen(true)}
              title="Kill switch ativo: todas as ações de escrita estão bloqueadas. Clique para gerenciar."
            >
              <OctagonAlert className="size-3" aria-hidden="true" />
              Kill switch ativo
            </button>
          ) : dryRunActive ? (
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-2.5 py-1 text-[11px] font-semibold text-warning"
              onClick={() => setOpsOpen(true)}
              title="Modo simulação: operações rodam mas nada é publicado no TikTok. Clique para gerenciar."
            >
              <FlaskConical className="size-3" aria-hidden="true" />
              Modo simulação
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
        {/* O header ficou só com identidade + estado (badges). As AÇÕES moram
            nas abas onde são usadas: criar/subir/Spark na aba Campanhas, saúde
            na aba Automações — antes 6 ações disputavam o topo da página. */}
      </div>

      {/* Barra de contexto: conta de anúncio + deep-link + desconectar */}
      <AdsContextBar
        accountLabel={status?.account?.displayName || status?.account?.username || status?.account?.id || ''}
        advertisers={advertisers}
        selectedAdvertiser={effectiveAdvertiser}
        refreshing={treeValidating}
        rangeDays={rangeDays}
        onRangeDays={(days) => {
          setRangeDays(days)
          setPage(1)
        }}
        onAdvertiserChanged={(id) => {
          setAdvertiserId(id)
          setPage(1)
          mutateAccounts()
        }}
        onRefresh={async () => {
          // Derruba o cache do servidor ANTES de revalidar — sem isso o
          // mutate() só re-lia o mesmo cache de 45s e o status parecia velho.
          try {
            await apiSend('/api/ads/tree/refresh', 'POST', {})
          } catch {
            /* cache-bust é melhor-esforço; a revalidação abaixo roda igual */
          }
          mutateTree()
          mutateAccounts()
        }}
        onDisconnect={status?.capabilities?.oauthConnect === false ? null : () => setConfirmDisconnect(true)}
      />

      {!effectiveAdvertiser ? (
        /* V2-94: empty state do Ads com ícone flutuante + sombra que respira */
        <GlassCard className="flex flex-col items-center gap-3 p-10 text-center">
          <span className="empty-icon flex size-14 items-center justify-center rounded-xl bg-gradient-to-br from-brand-cyan/20 to-purple-500/10 text-brand-cyan shadow-[0_0_30px_rgba(37,244,238,0.3)] animate-bounce border border-brand-cyan/30">
            <Megaphone className="size-6 drop-shadow-[0_0_8px_rgba(37,244,238,0.8)]" aria-hidden="true" />
          </span>
          <p className="text-sm font-medium text-foreground">Selecione um advertiser</p>
          <p className="max-w-md text-pretty text-xs text-muted-foreground">
            Escolha acima qual conta de anúncio do TikTok você quer gerenciar. As campanhas, métricas e a
            criação de anúncios valem para o advertiser selecionado.
          </p>
        </GlassCard>
      ) : (
        <>
          {/* Sub-abas por tarefa: cada tela tem UM propósito. O padrão visual
              (pill tablist) é o mesmo da aba Atividade. */}
          <Tabs.Root value={tab} onValueChange={(value) => changeTab(value as TabKey)}>
            <Tabs.List aria-label="Áreas do TikTok Ads" className="flex w-full items-center gap-1 overflow-x-auto rounded-2xl border border-border bg-card p-1.5 hide-scrollbar sm:w-max sm:self-center">
              {SUBTABS.map((item) => {
                const attentionCount = item.value === 'automation' ? bannedAccounts.length + openTickets.length : item.value === 'campaigns' && tree?.syncError ? 1 : 0
                return (
                  <Tabs.Trigger
                    key={item.value}
                    value={item.value}
                    className="flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground data-[state=active]:bg-secondary data-[state=active]:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <item.icon className="size-4" aria-hidden="true" />
                    {item.label}
                    {attentionCount > 0 && (
                      <span className="flex min-w-5 items-center justify-center rounded-full bg-error/15 px-1.5 text-[10px] font-bold text-error" aria-label={`${attentionCount} item(ns) que exigem atenção`}>
                        {attentionCount}
                      </span>
                    )}
                  </Tabs.Trigger>
                )
              })}
            </Tabs.List>
          </Tabs.Root>

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
                        O Pipeboard limita o time a 10 contas de anúncio por mês (limite compartilhado por
                        todos, não por pessoa). Esta conta ficou fora do limite
                        {tree.syncError.blockedUntil ? ` e volta a liberar em ${tree.syncError.blockedUntil}` : ''}.
                        Por isso as campanhas e métricas aparecem zeradas — os dados existem no TikTok, mas o
                        acesso via API está bloqueado. O servidor re-testa sozinho a cada 30 min; se o estado
                        estiver apenas desatualizado, o botão abaixo destrava na hora.
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

          {/* ── Aba: Hoje — centro de comando (decisões → resultado → robô) ── */}
          {tab === 'today' && (
            <>
            <TodayPanel
              active={treeActive}
              adAccountId={concreteAdvertiser}
              currency={currency}
              kpi={kpi}
              fromDate={fromDate}
              toDate={toDate}
              onOpenOps={() => setOpsOpen(true)}
              onOpenHealth={() => setHealthOpen(true)}
              onGoAutomations={() => changeTab('automation')}
              onCreate={() => openWriteFlow(setCreateOpen)}
              onBulk={() => openWriteFlow(setBulkOpen)}
              onSpark={() => openWriteFlow(setSparkOpen)}
              onNewSmartPlus={() => { changeTab('campaigns'); setCampaignsView('smartplus') }}
            />
            {/* Centro de operações (metas, anomalias, timeline, relatórios) — do main */}
            <OperationsCenter
              active={treeActive}
              advertiserId={concreteAdvertiser}
              currency={currency}
              campaigns={tree?.campaigns || []}
              conversions={kpi.conversions}
              revenue={Object.values(attribution?.byCampaign || {}).reduce((sum, item) => sum + item.revenueCents, 0) / 100}
              onNavigate={(nextTab, id) => {
                const t = nextTab === 'ai' ? 'automation' : nextTab
                changeTab(t)
                if (t === 'campaigns' && id) {
                  const campaign = tree?.campaigns.find((item) => item.platformCampaignId === id)
                  if (campaign) setDetailCampaign(campaign)
                }
              }}
            />
            </>
          )}

          {/* ── Aba: Campanhas — Manuais (árvore + criação) ou Smart+ ── */}
          {tab === 'campaigns' && (
            <>
              {/* Segmento: campanhas manuais × Smart+ (o antigo tab absorvido) */}
              <div className="flex items-center gap-1 self-start rounded-xl bg-white/[0.03] p-1 text-xs">
                {([['manual', 'Manuais'], ['smartplus', 'Smart+']] as const).map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={campaignsView === v}
                    onClick={() => setCampaignsView(v)}
                    className={`rounded-lg px-3 py-1 font-semibold transition-colors ${
                      campaignsView === v ? 'bg-white/10 text-white' : 'text-muted-foreground hover:text-white'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {campaignsView === 'smartplus' ? (
                <SmartPlusPanel active={treeActive} adAccountId={concreteAdvertiser} currency={currency} />
              ) : (
              <>
              {/* Barra de criação: tudo que PUBLICA vive junto da lista que
                  mostra o resultado. Primário = Nova campanha; o resto apoia. */}
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className="btn-primary text-xs" onClick={() => openWriteFlow(setCreateOpen)}>
                  <Plus className="size-3.5" aria-hidden="true" />
                  Nova campanha
                </button>
                <button type="button" className="btn-ghost text-xs" onClick={() => openWriteFlow(setBulkOpen)}>
                  <Layers className="size-3.5" aria-hidden="true" />
                  Subir em massa
                </button>
                <button type="button" className="btn-ghost text-xs" onClick={() => openWriteFlow(setSparkOpen)}>
                  <Zap className="size-3.5" aria-hidden="true" />
                  Spark Ads
                </button>
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <button type="button" className="btn-ghost text-xs" aria-label="Mais ações de criação">
                      <MoreHorizontal className="size-3.5" aria-hidden="true" />
                    </button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content
                      align="start"
                      sideOffset={8}
                      className="glass glass-thick anim-pop-in z-50 min-w-56 rounded-[12px] p-1.5"
                    >
                      {/* F6: identidade customizada foi descontinuada pelo TikTok —
                          só aparece se o backend disser que suporta (capability). */}
                      {status?.capabilities?.customIdentity !== false && (
                        <DropdownMenu.Item
                          className="flex cursor-pointer items-center gap-2 rounded-[8px] px-2.5 py-2 text-xs text-sub outline-none transition-colors data-[highlighted]:bg-[var(--hover)] data-[highlighted]:text-foreground"
                          onSelect={() => setIdentityOpen(true)}
                        >
                          <UserRound className="size-3.5" aria-hidden="true" />
                          <span className="truncate">
                            {status?.identity ? 'Identidade: ' + status.identity.displayName : 'Brand Identity'}
                          </span>
                        </DropdownMenu.Item>
                      )}
                      {/* O catálogo de produtos virou página própria no menu
                          (Gestão → Catálogo) — o atalho daqui foi removido. */}
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
                <span className="ml-auto text-[11px] text-muted-foreground">
                  Duplicar? Use o ícone de cópia em cada campanha da lista.
                </span>
              </div>
              <CampaignTree
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
              rangeDays={rangeDays}
              onRangeDays={(d) => {
                setRangeDays(d)
                setPage(1)
              }}
              onMutate={() => mutateTree()}
              onRetry={() => mutateTree()}
              onOpenDetail={setDetailCampaign}
              onDuplicate={setDuplicateCampaign}
              attribution={attribution?.byCampaign}
              />
              </>
              )}
            </>
          )}

          {/* ── Aba: Catálogo — produtos + feed + publicação no TikTok (DPA).
              Antes era página própria no menu; agora vive onde é usado. ── */}
          {tab === 'catalog' && (
            <GlassCard className="flex flex-col gap-4 p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <ShoppingBag className="size-4 text-primary" aria-hidden="true" />
                Catálogos de produtos
              </h2>
              <CatalogManager
                advertiserId={concreteAdvertiser}
                advertiserLabel={advertisers.find((a) => String(a.id) === String(concreteAdvertiser))?.name || ''}
              />
            </GlassCard>
          )}

          {/* ── Aba: Automações — Pilotos + Modo avançado + Copiloto (IA). O
              inbox de decisões vive na aba Hoje (superfície única de decisão). ── */}
          {tab === 'automation' && (
            <AutomationPanel
              active={treeActive}
              currency={currency}
              adAccountId={concreteAdvertiser}
              aiEnabled={aiEnabled}
              onMutateTree={() => mutateTree()}
            />
          )}
        </>
      )}

      {/* Fluxos de escrita */}
      <CreateAdPanel
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        advertiserId={concreteAdvertiser}
        currency={currency}
        identity={status?.identity ?? null}
        onCreated={() => {
          setCreateOpen(false)
          mutateTree()
        }}
      />
      <BulkUploadDialog
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        advertiserId={concreteAdvertiser}
        currency={currency}
        onFinished={() => mutateTree()}
      />
      <SparkAdDialog
        open={sparkOpen}
        onClose={() => setSparkOpen(false)}
        advertiserId={concreteAdvertiser}
        currency={currency}
        onCreated={() => {
          setSparkOpen(false)
          mutateTree()
        }}
      />
      <IdentityDialog
        open={identityOpen}
        onClose={() => setIdentityOpen(false)}
        identity={status?.identity ?? null}
        onSaved={() => {
          setIdentityOpen(false)
          mutateStatus()
        }}
      />
      <OpsDialog
        open={opsOpen}
        onClose={() => setOpsOpen(false)}
        currency={currency}
        onPolicyChanged={() => mutateSafety()}
      />
      <HealthDialog open={healthOpen} onClose={() => setHealthOpen(false)} />
      <DuplicateDialog
        campaign={duplicateCampaign}
        onClose={() => setDuplicateCampaign(null)}
        advertisers={advertisers}
        currentAdvertiserId={duplicateCampaign?.platformAdAccountId || concreteAdvertiser}
        onFinished={() => mutateTree()}
      />
      <CampaignDrawer
        campaign={detailCampaign}
        currency={currency}
        onClose={() => setDetailCampaign(null)}
        attribution={detailCampaign ? attribution?.byCampaign?.[detailCampaign.platformCampaignId] : undefined}
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
