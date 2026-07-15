'use client'

// Aba TikTok Ads (via Pipeboard) — orquestra verificação de conexão, seleção de
// advertiser, KPIs agregados e a árvore de campanhas. Os fluxos de escrita
// (criar anúncio, Spark Ads, Brand Identity) vivem em componentes próprios.

import { useMemo, useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Megaphone, Plus, Zap, UserRound, Layers, MoreHorizontal, FlaskConical, OctagonAlert, Ban, ShoppingBag } from 'lucide-react'
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
import { RoasCard } from './roas-card'
import { AlertsDialog } from './alerts-dialog'
import { AutomationDialog } from './automation-dialog'
import { OpsDialog } from './ops-dialog'
import { HealthDialog } from './health-dialog'
import { CatalogDialog } from './catalog-dialog'
import { OpsStatusCards } from './ops-status-cards'
import { AutomationPanel } from './automation-panel'
import { McpStatusCard } from './mcp-status-card'
import { KpiRow } from './kpi-row'
import { BriefingCard } from './briefing-card'
import { CopilotPanel } from './copilot-panel'
import { CreativeInsightsCard } from './creative-insights-card'
import { BudgetProposalCard } from './budget-proposal-card'
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
  const [rangeDays, setRangeDays] = useState(365)
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
  // não recarrega nada, os hooks SWR continuam vivos.
  const [tab, setTab] = useState<'overview' | 'campaigns' | 'automation' | 'ai'>('overview')

  const [createOpen, setCreateOpen] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [sparkOpen, setSparkOpen] = useState(false)
  const [identityOpen, setIdentityOpen] = useState(false)
  const [alertsOpen, setAlertsOpen] = useState(false)
  const [rulesOpen, setRulesOpen] = useState(false)
  const [opsOpen, setOpsOpen] = useState(false)
  const [healthOpen, setHealthOpen] = useState(false)
  const [catalogOpen, setCatalogOpen] = useState(false)

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
        <SectionTitle eyebrow="Anúncios">TikTok Ads</SectionTitle>
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
        <SectionTitle eyebrow="Anúncios">TikTok Ads</SectionTitle>
        <ErrorState onRetry={() => mutateStatus()} />
      </div>
    )
  }

  if (statusLoading && !status) {
    return (
      <div className="flex flex-col gap-5">
        <SectionTitle eyebrow="Anúncios">TikTok Ads</SectionTitle>
        <Skeleton className="h-40 rounded-2xl" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
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
        <SectionTitle eyebrow="Anúncios">TikTok Ads</SectionTitle>
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
          <SectionTitle eyebrow="Anúncios">TikTok Ads</SectionTitle>
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
          <span className="empty-icon flex size-12 items-center justify-center rounded-xl bg-[var(--accent-light)] text-brand-cyan">
            <Megaphone className="size-6" aria-hidden="true" />
          </span>
          <span className="empty-icon-shadow -mt-2" aria-hidden="true" />
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
          <div
            className="flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full bg-[var(--hover)] p-0.5 self-start"
            role="tablist"
            aria-label="Seções do TikTok Ads"
          >
            {(
              [
                { value: 'overview', label: 'Visão geral' },
                { value: 'campaigns', label: 'Campanhas' },
                { value: 'automation', label: 'Automações' },
                { value: 'ai', label: 'IA' },
              ] as const
            ).map((t) => (
              <button
                key={t.value}
                type="button"
                role="tab"
                aria-selected={tab === t.value}
                onClick={() => setTab(t.value)}
                className={
                  tab === t.value
                    ? 'flex shrink-0 items-center rounded-full bg-[var(--active)] px-3 py-1.5 text-xs font-medium text-foreground transition-colors'
                    : 'flex shrink-0 items-center rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-sub'
                }
              >
                {t.label}
              </button>
            ))}
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

          {/* ── Aba: Visão geral — "como estou indo?" (KPIs, ROAS, briefing) ── */}
          {tab === 'overview' && (
            <>
              <KpiRow
                kpi={kpi}
                currency={currency}
                active={treeActive}
                adAccountId={concreteAdvertiser}
                fromDate={fromDate}
                toDate={toDate}
              />
              {/* ROAS/CPA: gasto do TikTok × vendas reais dos gateways */}
              <RoasCard active={treeActive} adAccountId={concreteAdvertiser} />
              {/* Briefing diário da IA (se auto-esconde sem AI_GATEWAY_API_KEY) */}
              <BriefingCard adAccountId={concreteAdvertiser} currency={currency} />
            </>
          )}

          {/* ── Aba: Campanhas — "operar" (criar + árvore + ações) ── */}
          {tab === 'campaigns' && (
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
                      <DropdownMenu.Item
                        className="flex cursor-pointer items-center gap-2 rounded-[8px] px-2.5 py-2 text-xs text-sub outline-none transition-colors data-[highlighted]:bg-[var(--hover)] data-[highlighted]:text-foreground"
                        onSelect={() => openWriteFlow(setCatalogOpen)}
                      >
                        <ShoppingBag className="size-3.5" aria-hidden="true" />
                        Catálogo de produtos
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
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

          {/* ── Aba: Automações — regras, alertas, fila e diagnóstico ── */}
          {tab === 'automation' && (
            <>
              <OpsStatusCards
                active={treeActive}
                onOpenAutomation={() => setRulesOpen(true)}
                onOpenAlerts={() => setAlertsOpen(true)}
                onOpenOps={() => setOpsOpen(true)}
                onOpenHealth={() => setHealthOpen(true)}
              />
              {/* Painel inline: regras com toggle de 1 clique + histórico do
                  motor — o dia a dia sem precisar abrir o editor completo */}
              <AutomationPanel
                active={treeActive}
                onOpenRulesEditor={() => setRulesOpen(true)}
                onOpenAlertsEditor={() => setAlertsOpen(true)}
              />
              {/* Diagnóstico da integração MCP Pipeboard (linha fina, expande) */}
              <McpStatusCard active={treeActive} />
            </>
          )}

          {/* ── Aba: IA — copiloto, insights de criativo, realocação ── */}
          {tab === 'ai' && (
            <>
              <CopilotPanel
                active={treeActive}
                adAccountId={concreteAdvertiser}
                currency={currency}
                aiEnabled={aiEnabled}
                onMutateTree={() => mutateTree()}
              />
              <div className="grid gap-3 md:grid-cols-2">
                <CreativeInsightsCard adAccountId={concreteAdvertiser} currency={currency} />
                <BudgetProposalCard
                  adAccountId={concreteAdvertiser}
                  currency={currency}
                  onApplied={() => mutateTree()}
                />
              </div>
            </>
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
      <AlertsDialog open={alertsOpen} onClose={() => setAlertsOpen(false)} currency={currency} />
      <OpsDialog
        open={opsOpen}
        onClose={() => setOpsOpen(false)}
        currency={currency}
        onPolicyChanged={() => mutateSafety()}
      />
      <HealthDialog open={healthOpen} onClose={() => setHealthOpen(false)} />
      <CatalogDialog
        open={catalogOpen}
        onClose={() => setCatalogOpen(false)}
        advertiserId={concreteAdvertiser}
        advertiserLabel={advertisers.find((a) => String(a.id) === String(concreteAdvertiser))?.name || ''}
      />
      <AutomationDialog
        open={rulesOpen}
        onClose={() => setRulesOpen(false)}
        currency={currency}
        onExecuted={() => mutateTree()}
      />
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
