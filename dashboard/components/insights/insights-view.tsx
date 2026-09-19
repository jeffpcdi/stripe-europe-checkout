'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ArrowUpRight, CheckCircle2, CircleAlert, Route, SlidersHorizontal, Target, Users } from 'lucide-react'
import {
  useAccountSettings,
  useAdsCampaignDecisions,
  useAdsProfitability,
  useAdsRoas,
  useAdsStatus,
  useAdsTree,
  useOverviewAnalytics,
  useOverviewHealth,
} from '@/lib/api'
import { adsDateRange, previousAdsRange } from '@/lib/ads-time'
import { useOverviewPeriod } from '@/lib/overview-period'
import { fmtDelta, fmtInt, fmtPercent, formatMoney } from '@/lib/format'
import { GlassCard } from '@/components/glass-card'
import { Skeleton } from '@/components/skeleton'
import { ErrorState } from '@/components/error-state'
import { InsightsCampaignsPanel } from './campaigns-panel'
import { InsightsDiagnosisPanel } from './diagnosis-panel'
import { CreativeInsightsPanel } from './creative-insights-panel'
import { ScenarioSimulator } from './scenario-simulator'

type InsightTab = 'performance' | 'campaigns' | 'creatives' | 'funnel' | 'diagnosis'

function normalizeTab(value: string | null): InsightTab {
  if (value === 'campaigns' || value === 'sources') return 'campaigns'
  if (value === 'creatives') return 'creatives'
  if (value === 'funnel') return 'funnel'
  if (value === 'diagnosis' || value === 'opportunities' || value === 'anomalies' || value === 'quality') return 'diagnosis'
  return 'performance'
}

function relativeDelta(current: number, previous: number | null | undefined): number | null {
  if (previous == null || !Number.isFinite(previous) || previous === 0) return null
  return ((current - previous) / Math.abs(previous)) * 100
}

function periodToDays(period: 'today' | '7d' | '30d' | 'all') {
  if (period === 'today') return 1
  if (period === '7d') return 7
  if (period === '30d') return 30
  return 365
}

function KpiCell({
  label,
  value,
  detail,
  privateValue = false,
}: {
  label: string
  value: string
  detail?: string | null
  privateValue?: boolean
}) {
  return (
    <div className="min-w-0 border-b border-border/40 p-5 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-2 truncate text-[26px] font-semibold tracking-tight text-foreground" data-private={privateValue ? 'true' : undefined}>{value}</p>
      {detail ? <p className="mt-1 text-xs font-medium text-muted-foreground">{detail}</p> : null}
    </div>
  )
}

export function InsightsView() {
  const searchParams = useSearchParams()
  const rawTab = searchParams.get('tab')
  const tab = normalizeTab(rawTab)
  const [showSimulator, setShowSimulator] = useState(rawTab === 'simulator')
  const { period } = useOverviewPeriod()

  useEffect(() => {
    if (rawTab === 'simulator') setShowSimulator(true)
  }, [rawTab])

  const { data: accountSettings } = useAccountSettings()
  const accountTimeZone = accountSettings?.timezone || 'America/Sao_Paulo'
  const {
    data: analytics,
    error: analyticsError,
    isLoading,
    isValidating,
    mutate: mutateAnalytics,
  } = useOverviewAnalytics(period, accountTimeZone, true)
  const {
    data: health,
    error: healthError,
    mutate: mutateHealth,
  } = useOverviewHealth(true)

  const { data: adsStatus } = useAdsStatus(true)
  const adAccountId = adsStatus?.advertiserId || ''
  const adsConnected = Boolean(adsStatus?.enabled && adsStatus?.connected && adAccountId)
  const adsRange = useMemo(() => adsDateRange(periodToDays(period), accountTimeZone), [period, accountTimeZone])
  const previousCreativeRange = useMemo(() => previousAdsRange(adsRange), [adsRange])
  const todayAdsRange = useMemo(() => adsDateRange(1, accountTimeZone), [accountTimeZone])

  const adsOverviewActive = adsConnected && tab === 'performance'
  const campaignsActive = adsConnected && tab === 'campaigns'
  const creativesActive = adsConnected && tab === 'creatives'
  const { data: roas, error: roasError } = useAdsRoas(adsOverviewActive, adAccountId, adsRange)
  const { data: profitability, error: profitabilityError } = useAdsProfitability(adsOverviewActive, adAccountId, adsRange)
  const { data: adsTree, error: adsTreeError, isLoading: adsTreeLoading } = useAdsTree(campaignsActive, {
    adAccountId,
    fromDate: adsRange.fromDate,
    toDate: adsRange.toDate,
    sort: 'conversions',
  })
  const { data: campaignDecisions, error: decisionsError } = useAdsCampaignDecisions(campaignsActive, adAccountId, adsRange)
  const { data: pacingTree, error: pacingTreeError } = useAdsTree(campaignsActive, {
    adAccountId,
    fromDate: todayAdsRange.fromDate,
    toDate: todayAdsRange.toDate,
  })
  const { data: creativeTree, error: creativeTreeError, isLoading: creativeTreeLoading } = useAdsTree(creativesActive, {
    adAccountId,
    fromDate: adsRange.fromDate,
    toDate: adsRange.toDate,
  })
  const { data: previousCreativeTree, error: previousCreativeTreeError } = useAdsTree(creativesActive, {
    adAccountId,
    fromDate: previousCreativeRange.fromDate,
    toDate: previousCreativeRange.toDate,
  })

  const computed = useMemo(() => {
    if (!analytics?.current) return null
    const current = analytics.current
    const previous = analytics.previous
    const currentRevenue = current.rev[current.mainCur] || 0
    const previousRevenue = previous?.mainCur === current.mainCur ? previous.rev[current.mainCur] || 0 : null
    const stages = [
      { key: 'visits', label: 'Visitas', value: current.visits, icon: Users },
      { key: 'checkout', label: 'Checkout', value: current.reachedCheckout, icon: Target },
      { key: 'payment', label: 'Pagamento', value: current.paymentStarted, icon: Route },
      { key: 'purchase', label: 'Compras', value: current.purchased, icon: CheckCircle2 },
    ]
    const transitions = stages.slice(1).map((stage, index) => {
      const from = stages[index]
      const rate = from.value > 0 ? (stage.value / from.value) * 100 : 0
      return { from: from.label, to: stage.label, rate, drop: Math.max(0, 100 - rate), lost: Math.max(0, from.value - stage.value) }
    })
    const bottleneck = [...transitions].sort((a, b) => b.drop - a.drop)[0] ?? null
    return { current, previous, currentRevenue, previousRevenue, stages, transitions, bottleneck }
  }, [analytics])

  if (analyticsError && !analytics) {
    return (
      <ErrorState
        title="Não foi possível carregar os insights"
        onRetry={() => void mutateAnalytics()}
        retrying={isValidating}
      />
    )
  }

  if (isLoading || !computed) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true" aria-label="Carregando insights">
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-36 rounded-2xl" />
        <Skeleton className="h-72 rounded-2xl" />
      </div>
    )
  }

  const { current, previous } = computed
  const revenueDelta = relativeDelta(computed.currentRevenue, computed.previousRevenue)
  const healthActions = health?.actions ?? []
  const spendCurrency = roas?.currency || current.mainCur
  const revenueCurrency = roas?.revenueCurrency || spendCurrency
  const profitCurrency = profitability?.currency || current.mainCur
  const attributedRevenue = adsConnected ? roas?.revenueCents ?? null : computed.currentRevenue

  const summarySignals = [
    revenueDelta == null ? null : {
      label: revenueDelta >= 0 ? 'Faturamento avançou' : 'Faturamento recuou',
      value: fmtDelta(revenueDelta),
      href: '/insights',
    },
    computed.bottleneck ? {
      label: `Maior perda · ${computed.bottleneck.from} → ${computed.bottleneck.to}`,
      value: fmtPercent(computed.bottleneck.drop),
      href: '/insights?tab=funnel',
    } : null,
    healthActions.length ? {
      label: `${healthActions.length} ponto${healthActions.length === 1 ? '' : 's'} de atenção`,
      value: 'Diagnóstico',
      href: '/insights?tab=diagnosis',
    } : {
      label: 'Rastreamento sem alertas',
      value: 'OK',
      href: '/insights?tab=diagnosis',
    },
  ].filter(Boolean) as { label: string; value: string; href: string }[]

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-[26px] font-semibold tracking-tight text-foreground">Insights</h1>
        {tab === 'performance' ? (
          <button type="button" className="btn-ghost text-xs" onClick={() => setShowSimulator(value => !value)}>
            <SlidersHorizontal className="size-3.5" aria-hidden="true" />
            {showSimulator ? 'Fechar simulação' : 'Simular orçamento'}
          </button>
        ) : null}
      </div>

      {(analyticsError || healthError || roasError || profitabilityError || adsTreeError || decisionsError || pacingTreeError || creativeTreeError || previousCreativeTreeError) ? (
        <button
          type="button"
          className="btn-ghost self-start text-xs text-warning"
          onClick={() => void Promise.all([mutateAnalytics(), mutateHealth()])}
        >
          Alguns dados não foram atualizados · tentar novamente
        </button>
      ) : null}

      {tab === 'performance' ? (
        <>
          <GlassCard className="grid overflow-hidden sm:grid-cols-2 xl:grid-cols-5">
            <KpiCell
              label="Faturamento"
              value={attributedRevenue == null ? '—' : formatMoney(attributedRevenue, adsConnected ? revenueCurrency : current.mainCur)}
              detail={adsConnected ? 'TikTok atribuído' : revenueDelta == null ? null : `${fmtDelta(revenueDelta)} vs. anterior`}
              privateValue
            />
            <KpiCell
              label="Investimento"
              value={roas ? formatMoney(Math.round(roas.spend * 100), spendCurrency) : '—'}
              detail={adsConnected ? null : 'TikTok não conectado'}
              privateValue
            />
            <KpiCell
              label="Lucro"
              value={profitability ? formatMoney(profitability.netProfitCents, profitCurrency) : '—'}
              detail={profitability ? `${fmtPercent(profitability.netMarginPct)} margem` : null}
              privateValue
            />
            <KpiCell
              label="ROAS"
              value={roas?.roas == null ? '—' : `${roas.roas.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x`}
              detail={roas?.currencyMismatch ? 'moedas diferentes' : null}
            />
            <KpiCell
              label="CPA"
              value={roas?.cpa == null ? '—' : formatMoney(Math.round(roas.cpa * 100), spendCurrency)}
            />
          </GlassCard>

          {!adsConnected ? (
            <Link href="/ads/tiktok" className="inline-flex w-fit items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
              Conectar TikTok Ads para investimento, lucro, ROAS e CPA <ArrowUpRight className="size-3.5" />
            </Link>
          ) : null}

          {showSimulator ? (
            <ScenarioSimulator
              currency={spendCurrency}
              currentRevenue={roas?.revenueCents ?? 0}
              currentSales={roas?.sales ?? 0}
              baselineSpend={roas && !roas.currencyMismatch ? roas.spend : null}
              baselineCpa={roas && !roas.currencyMismatch ? roas.cpa : null}
            />
          ) : null}

          <GlassCard className="overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-5 py-4">
              <h2 className="text-[15px] font-semibold text-foreground">Agora</h2>
              <Link href="/insights?tab=diagnosis" className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
                Diagnóstico <ArrowUpRight className="size-3.5" />
              </Link>
            </div>
            <div className="border-t border-border/60">
              {summarySignals.map(signal => (
                <Link key={signal.label} href={signal.href} className="flex items-center justify-between gap-4 border-b border-border/40 px-5 py-3.5 last:border-0 hover:bg-secondary/10">
                  <span className="text-[13px] font-medium text-foreground">{signal.label}</span>
                  <span className="text-xs font-semibold tabular-nums text-muted-foreground">{signal.value}</span>
                </Link>
              ))}
            </div>
          </GlassCard>
        </>
      ) : null}

      {tab === 'campaigns' ? (
        <InsightsCampaignsPanel
          connected={adsConnected}
          tree={adsTree}
          decisions={campaignDecisions}
          pacingTree={pacingTree}
          currency={spendCurrency}
          timeZone={accountTimeZone}
          advertiserId={adAccountId}
          fromDate={adsRange.fromDate}
          toDate={adsRange.toDate}
          loading={adsTreeLoading}
        />
      ) : null}

      {tab === 'creatives' ? (
        <CreativeInsightsPanel
          connected={adsConnected}
          current={creativeTree}
          previous={previousCreativeTree}
          loading={creativeTreeLoading}
          advertiserId={adAccountId}
        />
      ) : null}

      {tab === 'funnel' ? (
        <GlassCard className="overflow-hidden">
          <div className="flex items-center justify-between gap-4 px-5 py-4">
            <h2 className="text-[15px] font-semibold text-foreground">Funil</h2>
            {computed.bottleneck ? <span className="text-xs font-medium text-warning">Maior perda: {computed.bottleneck.from} → {computed.bottleneck.to}</span> : null}
          </div>
          <div className="grid border-t border-border/60 sm:grid-cols-2 xl:grid-cols-4">
            {computed.stages.map((stage, index) => {
              const previousStage = index > 0 ? computed.stages[index - 1] : null
              const rate = previousStage && previousStage.value > 0 ? (stage.value / previousStage.value) * 100 : null
              const Icon = stage.icon
              return (
                <div key={stage.key} className="border-b border-border/40 p-5 last:border-b-0 sm:border-r sm:[&:nth-child(2)]:border-r-0 xl:border-b-0 xl:[&:nth-child(2)]:border-r xl:last:border-r-0">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-medium text-muted-foreground">{stage.label}</span>
                    <Icon className="size-4 text-brand-cyan" aria-hidden="true" />
                  </div>
                  <p className="mt-3 text-[28px] font-semibold tracking-tight text-foreground">{fmtInt(stage.value)}</p>
                  {rate != null ? <p className="mt-1 text-xs text-muted-foreground">{fmtPercent(rate)} da etapa anterior</p> : null}
                </div>
              )
            })}
          </div>
          {computed.bottleneck ? (
            <div className="flex items-center gap-2 border-t border-border/60 px-5 py-3 text-xs text-muted-foreground">
              <CircleAlert className="size-3.5 text-warning" aria-hidden="true" />
              {fmtInt(computed.bottleneck.lost)} não avançaram em {computed.bottleneck.from} → {computed.bottleneck.to}.
            </div>
          ) : null}
        </GlassCard>
      ) : null}

      {tab === 'diagnosis' ? (
        <InsightsDiagnosisPanel
          current={current}
          previous={previous ?? null}
          health={health}
          currentRevenue={computed.currentRevenue}
          previousRevenue={computed.previousRevenue}
          bottleneck={computed.bottleneck}
        />
      ) : null}
    </div>
  )
}
