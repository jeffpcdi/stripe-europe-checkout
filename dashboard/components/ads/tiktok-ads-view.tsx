'use client'

// Aba TikTok Ads (via Zernio) — orquestra conexão OAuth, seleção de
// advertiser, KPIs agregados e a árvore de campanhas. Os fluxos de escrita
// (criar anúncio, Spark Ads, Brand Identity) vivem em componentes próprios.

import { useMemo, useState } from 'react'
import { Megaphone, Plus, Zap, UserRound, BellRing, Bot, Layers } from 'lucide-react'
import {
  useAdsStatus,
  useAdsAccounts,
  useAdsBusinessCenters,
  useAdsTree,
  useAdsAttribution,
  apiSend,
} from '@/lib/api'
import { toast } from '@/lib/toast'
import type { AdsMetrics, AdsTreeCampaign } from '@/lib/types'
import { GlassCard } from '@/components/glass-card'
import { SectionTitle } from '@/components/section-title'
import { Skeleton } from '@/components/skeleton'
import { ErrorState } from '@/components/error-state'
import { CountUp } from '@/components/count-up'
import { SparkLine } from '@/components/sparkline'
import { fmtCompact, fmtPercent } from '@/lib/format'
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
import { ConfirmDialog } from '@/components/confirm-dialog'

// Moeda dos advertisers TikTok (spend vem em unidades inteiras da moeda)
function fmtSpend(v: number, currency?: string | null): string {
  try {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 2,
    }).format(v)
  } catch {
    return v.toFixed(2)
  }
}

export function TikTokAdsView() {
  const { data: status, mutate: mutateStatus, isLoading: statusLoading, error: statusError } = useAdsStatus()
  const connected = Boolean(status?.connected)

  // Business Center selecionado (camada acima do advertiser). null = usa o salvo.
  const { data: bcs, mutate: mutateBcs } = useAdsBusinessCenters(connected)
  const [bcId, setBcId] = useState<string | null>(null)
  const effectiveBc = bcId ?? bcs?.selected ?? ''

  const { data: accounts, mutate: mutateAccounts } = useAdsAccounts(connected, effectiveBc || undefined)

  const [advertiserId, setAdvertiserId] = useState<string | null>(null) // null = usa o salvo
  const effectiveAdvertiser = advertiserId ?? accounts?.selected ?? ''
  const [statusFilter, setStatusFilter] = useState('')
  const [sort, setSort] = useState('newest')
  const [page, setPage] = useState(1)
  // Período das métricas/descoberta de campanhas. Default 365d — a janela
  // curta (90d da Zernio) escondia campanhas antigas e parecia "faltando".
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

  const [createOpen, setCreateOpen] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [sparkOpen, setSparkOpen] = useState(false)
  const [identityOpen, setIdentityOpen] = useState(false)
  const [alertsOpen, setAlertsOpen] = useState(false)
  const [rulesOpen, setRulesOpen] = useState(false)
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
      setBcId(null)
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
          description="A variável ZERNIO_API_KEY não está definida (ou é inválida). Adicione a chave sk_… da Zernio nas variáveis de ambiente do servidor e reinicie."
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

  // ── Estado: n��o conectado → card de conexão OAuth ────────────────────────
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
        <SectionTitle eyebrow="Anúncios">TikTok Ads</SectionTitle>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-ghost text-xs" onClick={() => setRulesOpen(true)}>
            <Bot className="size-3.5" aria-hidden="true" />
            Automação
          </button>
          <button type="button" className="btn-ghost text-xs" onClick={() => setAlertsOpen(true)}>
            <BellRing className="size-3.5" aria-hidden="true" />
            Alertas
          </button>
          <button type="button" className="btn-ghost text-xs" onClick={() => setIdentityOpen(true)}>
            <UserRound className="size-3.5" aria-hidden="true" />
            {status?.identity ? 'Identidade: ' + status.identity.displayName : 'Brand Identity'}
          </button>
          <button type="button" className="btn-ghost text-xs" onClick={() => openWriteFlow(setSparkOpen)}>
            <Zap className="size-3.5" aria-hidden="true" />
            Spark Ads
          </button>
          <button type="button" className="btn-ghost text-xs" onClick={() => openWriteFlow(setBulkOpen)}>
            <Layers className="size-3.5" aria-hidden="true" />
            Subir em massa
          </button>
          <button type="button" className="btn-primary text-xs" onClick={() => openWriteFlow(setCreateOpen)}>
            <Plus className="size-3.5" aria-hidden="true" />
            Nova campanha
          </button>
        </div>
      </div>

      {/* Barra de contexto: BC → conta de anúncio + deep-link + desconectar */}
      <AdsContextBar
        accountLabel={status?.account?.displayName || status?.account?.username || status?.account?.id || ''}
        businessCenters={bcs?.businessCenters ?? []}
        bcUnsupported={Boolean(bcs?.unsupported)}
        selectedBc={effectiveBc}
        advertisers={advertisers}
        selectedAdvertiser={effectiveAdvertiser}
        refreshing={treeValidating}
        onBcChanged={(newBc, newAdvertiser) => {
          setBcId(newBc)
          setAdvertiserId(newAdvertiser || '')
          setPage(1)
          mutateBcs()
          mutateAccounts()
        }}
        onAdvertiserChanged={(id) => {
          setAdvertiserId(id)
          setPage(1)
          mutateAccounts()
        }}
        onRefresh={() => {
          mutateTree()
          mutateAccounts()
          mutateBcs()
        }}
        onDisconnect={() => setConfirmDisconnect(true)}
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
          {/* Linha de KPIs agregados (página atual da árvore) */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <GlassCard hover className="anim-kpi-in p-4" style={{ animationDelay: '0ms' }}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="label-mono">Investimento</p>
                  <p className="kpi-value-hero mt-1 text-xl font-semibold text-foreground">
                    <CountUp value={kpi.spend} format={(v) => fmtSpend(v, currency)} />
                  </p>
                </div>
                {kpi.spendSeries.length > 1 && (
                  <SparkLine data={kpi.spendSeries} color="var(--brand-cyan, #25f4ee)" width={72} height={26} />
                )}
              </div>
            </GlassCard>
            <GlassCard hover className="anim-kpi-in p-4" style={{ animationDelay: '40ms' }}>
              <p className="label-mono">Impressões</p>
              <p className="kpi-value-hero mt-1 text-xl font-semibold text-foreground">
                <CountUp value={kpi.impressions} format={fmtCompact} />
              </p>
            </GlassCard>
            <GlassCard hover className="anim-kpi-in p-4" style={{ animationDelay: '80ms' }}>
              <p className="label-mono">CTR</p>
              <p className="kpi-value-hero mt-1 text-xl font-semibold text-foreground">
                <CountUp value={kpi.ctr} format={(v) => fmtPercent(v)} />
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{fmtCompact(kpi.clicks)} cliques</p>
            </GlassCard>
            <GlassCard hover className="anim-kpi-in p-4" style={{ animationDelay: '120ms' }}>
              <p className="label-mono">CPM</p>
              <p className="kpi-value-hero mt-1 text-xl font-semibold text-foreground">
                <CountUp value={kpi.cpm} format={(v) => fmtSpend(v, currency)} />
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {kpi.activeCount} campanha{kpi.activeCount === 1 ? '' : 's'} ativa{kpi.activeCount === 1 ? '' : 's'}
              </p>
            </GlassCard>
          </div>

          {/* ROAS/CPA: gasto do TikTok × vendas reais dos gateways */}
          <RoasCard active={treeActive} adAccountId={concreteAdvertiser} />

          {/* Árvore de campanhas */}
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
