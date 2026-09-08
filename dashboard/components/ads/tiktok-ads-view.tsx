'use client'

// Aba TikTok Ads (via Pipeboard) — orquestra verificação de conexão, seleção de
// advertiser, KPIs agregados e a árvore de campanhas. Os fluxos de escrita
// (criar anúncio e Spark Ads) vivem em componentes próprios.

import { AudiencesDialog } from './audiences-dialog'
import { useEffect, useMemo, useState } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import { Megaphone, Plus, FlaskConical, OctagonAlert, Ban, Bot, ShoppingBag } from 'lucide-react'
import {
  useAdsStatus,
  useAdsAccounts,
  useAdsTree,
  useAdsAttribution,
  useAdsSafetyPolicy,
  useAdsHealth,
  useAdsSyncStatus,
  useAdsRejections,
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

export function TikTokAdsView() {
  const { data: status, mutate: mutateStatus, isLoading: statusLoading, error: statusError } = useAdsStatus()
  const connected = Boolean(status?.connected)

  // Pipeboard não tem Business Center — as contas vêm direto do token.
  const { data: accounts, mutate: mutateAccounts, error: accountsError, isLoading: accountsLoading } = useAdsAccounts(connected)

  const [advertiserId, setAdvertiserId] = useState<string | null>(null) // null = usa o salvo
  const effectiveAdvertiser = advertiserId ?? accounts?.selected ?? ''
  // Abre em "Ativas": há ~8 ativas e ~99 pausadas — abrir em "Todas" enterrava
  // o operador em ruído. Ele filtra para "Todas" quando quiser o histórico.
  const [statusFilter, setStatusFilter] = useState('active')
  const [sort, setSort] = useState('newest')
  const [page, setPage] = useState(1)
  // Período global de métricas e campanhas. O dia pertence ao fuso da conta
  // TikTok, não ao navegador do operador nem ao UTC.
  const [rangeDays, setRangeDays] = useState(1) // padrão diário — pedido do produto
  const selectedAdvertiserInfo = accounts?.accounts.find((a) => String(a.id) === String(effectiveAdvertiser))
  const advertiserTimeZone = selectedAdvertiserInfo?.timezone || status?.timeZone
  const [calendarTick, setCalendarTick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setCalendarTick(tick => tick + 1), 60_000)
    return () => clearInterval(timer)
  }, [])
  const { fromDate, toDate } = useMemo(
    () => adsDateRange(rangeDays, advertiserTimeZone),
    [rangeDays, advertiserTimeZone, calendarTick],
  )

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

  // Vendas reais por campanha usam exatamente o mesmo período global.
  const { data: attribution } = useAdsAttribution(treeActive, effectiveAdvertiser, { fromDate, toDate })

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
  const SUBTABS: { value: TabKey; label: string; compactLabel: string; icon: typeof Megaphone }[] = [
    { value: 'campaigns', label: 'Campanhas', compactLabel: 'Campanhas', icon: Megaphone },
    { value: 'catalog', label: 'Catálogo', compactLabel: 'Catálogo', icon: ShoppingBag },
    { value: 'automation', label: 'Automações', compactLabel: 'Automações', icon: Bot },
  ]
  const [toolsExpanded, setToolsExpanded] = useState(false)
  const [tab, setTab] = useState<TabKey>('campaigns')
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
          title="Conecte o TikTok Ads"
          description="Configure a chave do Pipeboard nas configurações do servidor para acessar suas campanhas."
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
        syncState={selectedSyncState}
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
          try {
            const result = await apiSend<{ ok?: boolean; error?: string }>(
              `/api/ads/tree/refresh?adAccountId=${encodeURIComponent(concreteAdvertiser)}`,
              'POST',
              {},
            )
            if (result.ok === false) throw new Error(result.error || 'Atualização incompleta')
            toast.success('Dados atualizados')
          } catch (e) {
            toast.error('Não foi possível sincronizar agora', {
              hint: e instanceof Error ? e.message : undefined,
            })
          } finally {
            await Promise.all([mutateTree(), mutateAccounts(), mutateSyncStatus()])
          }
        }}
        onDisconnect={status?.capabilities?.oauthConnect === false ? null : () => setConfirmDisconnect(true)}
      />

      <PixelBindingCard active={treeActive} advertiserId={concreteAdvertiser} />

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
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <Tabs.List data-tour="ads-tabs" aria-label="Áreas do TikTok Ads" className="grid w-full grid-cols-3 items-center gap-1 rounded-xl border border-border bg-card p-1 sm:w-max">
                {SUBTABS.map((item) => {
                  const attentionCount = item.value === 'automation'
                    ? bannedAccounts.length + openTickets.length + (rejections?.open ?? 0)
                    : item.value === 'campaigns' && tree?.syncError ? 1 : 0
                  return (
                    <Tabs.Trigger
                      key={item.value}
                      value={item.value}
                      className="tiktok-section-tab"
                    >
                      <item.icon className="hidden size-4 sm:block" aria-hidden="true" />
                      <span className="truncate sm:hidden">{item.compactLabel}</span>
                      <span className="hidden sm:inline">{item.label}</span>
                      {attentionCount > 0 && (
                        <span className="flex min-w-5 items-center justify-center rounded-full bg-error/15 px-1.5 text-[10px] font-bold text-error" aria-label={`${attentionCount} item(ns) que exigem atenção`}>
                          {attentionCount}
                        </span>
                      )}
                    </Tabs.Trigger>
                  )
                })}
              </Tabs.List>
            </div>

            {tab === 'campaigns' && (
              <div className="flex flex-wrap gap-2"><button type="button" className="btn-secondary" onClick={() => setAudiencesOpen(true)}>Públicos</button>
              <button
                type="button"
                className="btn-primary shrink-0 justify-center px-4 py-2 text-sm font-semibold"
                onClick={() => openWriteFlow(() => setLauncherOpen(true))}
                aria-label="Criar campanha"
                title="Criar campanhas de venda com um ou vários vídeos"
              >
                <Plus className="size-4" aria-hidden="true" />
                Criar campanha
              </button></div>
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
              onMutate={() => mutateTree()}
              onRetry={() => mutateTree()}
              onOpenDetail={setDetailCampaign}
              onDuplicate={setDuplicateCampaign}
              attribution={attribution?.byCampaign}
              />
            </Tabs.Content>
          )}

          {/* ── Aba: Catálogo — produtos + feed + publicação no TikTok (DPA).
              Antes era página própria no menu; agora vive onde é usado. ── */}
          {tab === 'catalog' && (
            <Tabs.Content value="catalog" className="min-w-0 outline-none" aria-label="Catálogos">
              <CatalogManager key={`CatalogManager:${concreteAdvertiser}`}
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
        onSuccess={() => mutateTree()}
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
          mutateTree()
        }}
      />
      <SmartPlusCreateDialog key={`SmartPlusCreateDialog:${concreteAdvertiser}`}
        open={smartPlusOpen}
        onClose={() => setSmartPlusOpen(false)}
        advertiserId={concreteAdvertiser}
        currency={currency}
        onCreated={() => {
          setSmartPlusOpen(false)
          mutateTree()
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
        onFinished={() => mutateTree()}
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
