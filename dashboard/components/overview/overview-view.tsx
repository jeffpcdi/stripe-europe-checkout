'use client'

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import { useOncePerSession } from '@/lib/motion'
import {
  useStats,
  useEmqTrend,
  useAdsStatus,
  useAdsRoas,
  useAdsProfitability,
  useAdsTree,
  useAdsCampaignDecisions,
  useAccountSettings,
  useOverviewHealth,
  useOverviewAnalytics,
} from '@/lib/api'
import { useAfterFirstPaint } from '@/lib/use-after-first-paint'
import { aggregate, periodStart, prevWindow } from '@/lib/metrics'
import { adsDateRange } from '@/lib/ads-time'
import { countryFlag } from '@/lib/format'
import { countryName } from '@/lib/countries'
import type { Period } from '@/lib/types'
import { Skeleton } from '@/components/skeleton'
import { GlassCard } from '@/components/glass-card'
import { toast } from '@/lib/toast'
import { useOverviewPeriod } from '@/lib/overview-period'
import { HeroGlobe, type GlobePurchase } from './hero-globe'
import { LiveFeed } from './live-feed'
import { FunnelGauge } from './funnel-gauge'
import { EmqGauge } from './emq-gauge'
import { SetupGuide } from './setup-guide'
import { ErrorState } from '@/components/error-state'
import { ArrowUpRight } from 'lucide-react'

// ── Formatação de Moeda e Data ───────────────────────────────────────────
function overviewCampaignStatus(status?: string | null) {
  const normalized = String(status || '').toLowerCase()
  if (normalized === 'active' || normalized === 'enable' || normalized === 'enabled') return { label: 'Ativa', active: true }
  if (normalized === 'paused' || normalized === 'disable' || normalized === 'disabled') return { label: 'Pausada', active: false }
  if (normalized === 'rejected') return { label: 'Rejeitada', active: false }
  if (normalized === 'error') return { label: 'Erro', active: false }
  if (normalized === 'pending_review' || normalized === 'review') return { label: 'Em análise', active: false }
  return { label: status ? String(status) : 'Desconhecido', active: false }
}

function fmtAdsMoney(v: number, currency: string): string {
  try {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: currency || 'BRL',
      maximumFractionDigits: 2,
    }).format(v)
  } catch {
    return v.toFixed(2)
  }
}

function periodToAdsRange(period: Period, timeZone?: string): { fromDate: string; toDate: string } {
  const days = period === 'today' ? 1 : period === '7d' ? 7 : period === '30d' ? 30 : 365
  return adsDateRange(days, timeZone)
}

// ══════════════════════════════════════════════════════════════════════════
//  COMPONENTE PRINCIPAL — VISÃO GERAL REFINADA & PADRONIZADA
// ══════════════════════════════════════════════════════════════════════════
export function OverviewView() {
  const { period } = useOverviewPeriod()
  const [focusCountry, setFocusCountry] = useState<string | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const { data, error, isLoading, isValidating, mutate: mutateStats } = useStats()
  const previousPeriod = useRef(period)
  useEffect(() => {
    if (previousPeriod.current === period) return
    previousPeriod.current = period
    // Recalcula o cache imediatamente e busca vendas recebidas desde a última leitura.
    void mutateStats().catch(() => { /* O erro do SWR aparece no indicador de atualização. */ })
  }, [period, mutateStats])
  const firstEnter = useOncePerSession('overview-enter')

  const afterFirstPaint = useAfterFirstPaint()
  const { data: accountSettings } = useAccountSettings(afterFirstPaint)
  const accountTimeZone = accountSettings?.timezone || 'America/Sao_Paulo'
  const {
    data: overviewAnalytics,
    error: overviewAnalyticsError,
    mutate: mutateOverviewAnalytics,
  } = useOverviewAnalytics(period, accountTimeZone, true)
  useEffect(() => {
    const onForegroundNotification = (event: Event) => {
      const detail = (event as CustomEvent<{ event?: string }>).detail
      if (detail?.event !== 'sale') return
      void Promise.all([mutateStats(), mutateOverviewAnalytics()]).catch(() => {})
    }
    window.addEventListener('roi:foreground-notification', onForegroundNotification)
    return () => window.removeEventListener('roi:foreground-notification', onForegroundNotification)
  }, [mutateStats, mutateOverviewAnalytics])

  const { data: adsStatus, error: adsError, mutate: mutateAdsStatus } = useAdsStatus(afterFirstPaint)
  const adAccountId = adsStatus?.advertiserId || ''
  const adsConnected = Boolean(adsStatus?.enabled && adsStatus?.connected && adAccountId)
  const [calendarTick, setCalendarTick] = useState(0)
  useEffect(() => { const timer = setInterval(() => setCalendarTick(tick => tick + 1), 60_000); return () => clearInterval(timer) }, [])
  const adsRange = useMemo(
    () => periodToAdsRange(period, accountTimeZone),
    [period, accountTimeZone, calendarTick],
  )
  const { data: roas, error: roasError, mutate: mutateRoas } = useAdsRoas(adsConnected, adAccountId, adsRange)
  const { data: profitability, error: profitabilityError, mutate: mutateProfitability } = useAdsProfitability(true, adAccountId, adsRange)
  const { data: campaignDecisions, error: decisionsError, mutate: mutateDecisions } = useAdsCampaignDecisions(
    adsConnected,
    adAccountId,
    adsRange,
  )

  // Campanhas sincronizadas com a aba TikTok Ads
  const { data: adsTree, mutate: mutateAdsTree } = useAdsTree(adsConnected, {
    adAccountId,
    fromDate: adsRange.fromDate,
    toDate: adsRange.toDate,
    sort: 'conversions',
  })

  const [campaignTab, setCampaignTab] = useState<'tiktok' | 'utm'>('tiktok')

  const tikTokCampaigns = useMemo(() => {
    if (!adsTree?.campaigns || adsTree.campaigns.length === 0) return []
    const adCurrency = String(roas?.currency || adsStatus?.currency || '').toUpperCase()
    return adsTree.campaigns
      .map((c) => {
        const campaignId = String(c.platformCampaignId || '')
        const spend = typeof c.metrics?.spend === 'number' && Number.isFinite(c.metrics.spend) ? c.metrics.spend : null
        const decision = campaignDecisions?.byCampaign?.[campaignId]
        const sales = decision ? Number(decision.sales) || 0 : null
        const revenueCents = decision ? Number(decision.revenueCents) || 0 : null
        const decisionCurrency = String(decision?.currency || adCurrency || 'BRL').toUpperCase()
        const comparableCurrency = !adCurrency || decisionCurrency === adCurrency
        const cpa = sales != null && sales > 0 && spend != null && spend > 0 ? spend / sales : null
        const campaignRoas = revenueCents != null && spend != null && spend > 0 && comparableCurrency
          ? (revenueCents / 100) / spend
          : null
        return {
          id: campaignId,
          name: c.campaignName || campaignId,
          status: c.status,
          sales,
          revenueCents,
          currency: decisionCurrency,
          spend,
          cpa,
          roas: campaignRoas,
        }
      })
      .sort((a, b) => (b.sales ?? -1) - (a.sales ?? -1) || (b.revenueCents ?? -1) - (a.revenueCents ?? -1) || (b.spend ?? -1) - (a.spend ?? -1))
      .slice(0, 5)
  }, [adsTree?.campaigns, campaignDecisions?.byCampaign, roas?.currency, adsStatus?.currency])



  // EMQ CAPI
  const { data: emqData, error: emqError, mutate: mutateEmq } = useEmqTrend(afterFirstPaint)
  const emqSummary = useMemo(() => {
    const pixels = emqData?.pixels?.filter((p) => p.recentAvg != null) ?? []
    if (pixels.length === 0) return null
    const recent = pixels.reduce((s, p) => s + (p.recentAvg ?? 0), 0) / pixels.length
    const withBase = pixels.filter((p) => p.baseAvg != null)
    const base = withBase.length
      ? withBase.reduce((s, p) => s + (p.baseAvg ?? 0), 0) / withBase.length
      : null
    const dir: 'up' | 'down' | 'flat' =
      base == null || Math.abs(recent - base) < 0.15 ? 'flat' : recent > base ? 'up' : 'down'
    return { recent, dir, alerts: emqData?.alerts ?? 0 }
  }, [emqData])

  // Saúde do pipeline geral
  const { data: overviewHealth, error: overviewHealthError, mutate: mutateHealth } = useOverviewHealth(afterFirstPaint)

  const handleRefreshAll = useCallback(async () => {
    setIsRefreshing(true)
    try {
      await Promise.all([
        mutateStats(),
        mutateOverviewAnalytics(),
        mutateAdsStatus(),
        mutateRoas(),
        mutateProfitability(),
        mutateAdsTree(),
        mutateDecisions(),
        mutateEmq(),
        mutateHealth(),
      ])
      toast.success('Visão geral e conexões atualizadas')
    } catch {
      toast.error('Erro ao atualizar métricas')
    } finally {
      setIsRefreshing(false)
    }
  }, [mutateStats, mutateOverviewAnalytics, mutateAdsStatus, mutateRoas, mutateProfitability, mutateAdsTree, mutateDecisions, mutateEmq, mutateHealth])

  // Métricas do período ATUAL e ANTERIOR
  const { cur, prev, durableOverview } = useMemo(() => {
    if (overviewAnalytics?.complete) {
      return { cur: overviewAnalytics.current, prev: overviewAnalytics.previous, durableOverview: true }
    }
    // Enquanto o agregado durável está carregando, não exibir números derivados
    // do snapshot truncado. O snapshot só vira fallback se o Neon falhar.
    if (!overviewAnalyticsError) return { cur: null, prev: null, durableOverview: false }
    if (!data) return { cur: null, prev: null, durableOverview: false }
    const now = new Date()
    const curMetrics = aggregate(data, periodStart(period, now, accountTimeZone), now, accountTimeZone)
    const pw = prevWindow(period, now, accountTimeZone)
    const prevMetrics = pw ? aggregate(data, pw.prevFrom, pw.prevTo, accountTimeZone) : null
    return { cur: curMetrics, prev: prevMetrics, durableOverview: false }
  }, [overviewAnalytics, data, period, accountTimeZone, calendarTick])


  // Estado de Erro
  if (error && !data) {
    return (
      <ErrorState
        title="Não foi possível carregar as métricas"
        description="Verifique a conexão com o servidor e tente novamente."
        onRetry={() => mutateStats()}
        retrying={isValidating}
      />
    )
  }

  // O carregamento reserva a composição integrada, sem quatro cards antigos.
  if (isLoading || !cur) {
    return (
      <div className="overview-observatory" aria-busy="true" aria-label="Carregando visão geral">
        <div className="observatory-header"><Skeleton className="h-10 w-36" /><Skeleton className="h-12 w-full max-w-72" /></div>
        <div className="observatory-metrics">
          <div className="observatory-metric-rail observatory-metric-rail--left">
            {['revenue', 'profit'].map(name => <div key={name} className={`observatory-metric observatory-metric--${name}`}><Skeleton className="h-4 w-20 mb-3" /><Skeleton className={name === 'revenue' ? 'h-12 w-full max-w-52' : 'h-10 w-full max-w-44'} /></div>)}
          </div>
          <div className="observatory-globe flex items-center justify-center">
            <Skeleton className="aspect-square w-full max-w-96 rounded-full" />
          </div>
          <div className="observatory-metric-rail observatory-metric-rail--right">
            {['spend', 'conversion', 'return'].map(name => <div key={name} className={`observatory-metric observatory-metric--${name}`}><Skeleton className="h-4 w-20 mb-3" /><Skeleton className="h-10 w-full max-w-44" /></div>)}
          </div>
        </div>
        <div className="observatory-activity">
          <section aria-label="Carregando top países">
            <Skeleton className="h-4 w-20 mb-4" />
            <div className="grid gap-3">{[0, 1, 2].map(index => <Skeleton key={index} className="h-8 w-full" />)}</div>
          </section>
          <section aria-label="Carregando compras recentes">
            <Skeleton className="h-4 w-24 mb-4" />
            <div className="grid gap-3">{[0, 1, 2].map(index => <Skeleton key={index} className="h-8 w-full" />)}</div>
          </section>
        </div>
      </div>
    )
  }

  // Dados computados
  const revCents = cur.rev[cur.mainCur] || 0
  const prevRevCents = prev && prev.mainCur === cur.mainCur ? prev.rev[cur.mainCur] || 0 : null

  const otherRev = Object.entries(cur.rev)
    .filter(([c, v]) => c !== cur.mainCur && v > 0)
    .sort((a, b) => b[1] - a[1])

  const showingTikTokCampaigns = campaignTab === 'tiktok' && adsConnected && tikTokCampaigns.length > 0
  const campaignDrilldownHref = showingTikTokCampaigns ? '/ads/tiktok' : '/activity'
  const campaignDrilldownLabel = showingTikTokCampaigns ? 'Abrir TikTok Ads' : 'Abrir atividade'
  const healthIssueCount = overviewHealth?.actions?.length ?? 0

  const globePurchases: GlobePurchase[] = (data?.leads ?? [])
    .flatMap((lead) => {
      const at = lead.convertedAt || lead.purchasedAt || (lead.stage === 'purchased' ? lead.at : null)
      if (!at) return []
      return [{
        at,
        country: lead.country,
        amount: lead.amount,
        currency: lead.currency,
      }]
    })

  return (
    <div
      className={`overview-view w-full max-w-none flex flex-col gap-5 sm:gap-6 ${
        firstEnter ? 'stagger-fade' : ''
      }`}
    >
      {/* Métricas e presença compartilham a composição, não a janela de dados. */}
      {(error || overviewAnalyticsError || roasError || profitabilityError || decisionsError || emqError || overviewHealthError) && <button type="button" className="btn-ghost self-start text-xs text-warning" onClick={handleRefreshAll}>Alguns indicadores não foram atualizados · tentar novamente</button>}
      <SetupGuide health={overviewHealth} />
      <HeroGlobe
        focusCode={focusCountry}
        purchases={globePurchases}
        purchasesStale={Boolean(error)}
        onRefresh={handleRefreshAll}
        refreshing={isRefreshing}
        metrics={{
          revenueCents: revCents,
          currency: cur.mainCur,
          sales: cur.revenueSales,
          visits: cur.visits,
          purchased: cur.purchased,
          approval: cur.approval,
          otherCurrencies: otherRev.length,
          previousRevenueCents: prevRevCents,
          ads: roas,
          profitability,
          adsError: Boolean(roasError || profitabilityError),
          allPeriod: period === 'all',
          series: !durableOverview && data && otherRev.length > 0
          ? aggregate({ ...data, events: data.events.filter(event => (event.currency || 'BRL').toUpperCase() === cur.mainCur) }, periodStart(period, new Date(), accountTimeZone), new Date(), accountTimeZone).series
          : cur.series,
        }}
      />


      {/* ── SEÇÃO 3: FUNIL DE VENDAS E ATIVIDADE RECENTE ──────────────────── */}
      <section
        className="overview-detail-grid"
        aria-label="Funil de vendas e atividade recente"
      >
        <FunnelGauge
          visits={cur.visits}
          checkout={cur.reachedCheckout}
          payment={cur.paymentStarted}
          purchased={cur.purchased}
        />
        <LiveFeed leads={data?.leads ?? []} timeZone={accountTimeZone} />
      </section>

      {/* ── SEÇÃO 4: MOSTRADORES DE DESEMPENHO E SAÚDE ──────────────────── */}
      <section
        aria-label="Desempenho e conformidade"
        className="overview-insight-grid"
      >
        {/* Campanhas */}
        <GlassCard variant="thick" className="overview-insight-card overview-campaign-card flex flex-col gap-4 p-5">
          <div className="overview-insight-heading overview-campaign-heading">
            <div className="overview-campaign-heading-main">
              <span className="overview-campaign-title">Campanhas</span>
              {adsConnected && tikTokCampaigns.length > 0 && cur.topCampaigns.length > 0 && (
                <div className="overview-campaign-tabs" role="tablist" aria-label="Fonte das campanhas">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={campaignTab === 'tiktok'}
                    onClick={() => setCampaignTab('tiktok')}
                    className={`overview-campaign-tab ${campaignTab === 'tiktok' ? 'is-active' : ''}`}
                  >
                    TikTok Ads
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={campaignTab === 'utm'}
                    onClick={() => setCampaignTab('utm')}
                    className={`overview-campaign-tab ${campaignTab === 'utm' ? 'is-active' : ''}`}
                  >
                    UTMs
                  </button>
                </div>
              )}
            </div>
            <Link href={campaignDrilldownHref} className="overview-campaign-view-all" aria-label={campaignDrilldownLabel}>
              Ver tudo <ArrowUpRight className="size-3" aria-hidden="true" />
            </Link>
          </div>

          {showingTikTokCampaigns ? (
            <div className="overview-campaign-table" role="table" aria-label="Campanhas do TikTok Ads">
              <div className="overview-campaign-table-head overview-campaign-grid overview-campaign-grid--tiktok" role="row">
                <span role="columnheader">Campanha</span>
                <span role="columnheader">Gasto</span>
                <span role="columnheader">Vendas</span>
                <span role="columnheader">CPA</span>
                <span role="columnheader">ROAS</span>
              </div>
              <div className="overview-campaign-table-body" role="rowgroup">
                {tikTokCampaigns.slice(0, 4).map((c) => {
                  const campaignStatus = overviewCampaignStatus(c.status)
                  return (
                    <div key={c.id || c.name} className="overview-campaign-row overview-campaign-grid overview-campaign-grid--tiktok" role="row">
                      <div className="overview-campaign-name-cell" role="cell">
                        <span className="overview-campaign-name" title={c.name}>{c.name}</span>
                        <span className={`overview-campaign-status ${campaignStatus.active ? 'is-active' : 'is-paused'}`}>
                          <span className="overview-campaign-status-dot" aria-hidden="true" />
                          {campaignStatus.label}
                        </span>
                      </div>
                      <span className="overview-campaign-value" role="cell">{c.spend == null ? '—' : fmtAdsMoney(c.spend, roas?.currency || 'BRL')}</span>
                      <span className="overview-campaign-value" role="cell">{c.sales == null ? '—' : c.sales}</span>
                      <span className="overview-campaign-value" role="cell">{c.cpa !== null ? fmtAdsMoney(c.cpa, roas?.currency || 'BRL') : '—'}</span>
                      <span className="overview-campaign-value overview-campaign-roas" role="cell">
                        {c.roas !== null ? `${c.roas.toFixed(2).replace('.', ',')}x` : '—'}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : cur.topCampaigns.length > 0 ? (
            <div className="overview-campaign-table" role="table" aria-label="Campanhas por UTM">
              <div className="overview-campaign-table-head overview-campaign-grid overview-campaign-grid--utm" role="row">
                <span role="columnheader">Campanha</span>
                <span role="columnheader">Compras</span>
                <span role="columnheader">Conversão</span>
              </div>
              <div className="overview-campaign-table-body" role="rowgroup">
                {cur.topCampaigns.slice(0, 4).map((c) => (
                  <div key={c.name} className="overview-campaign-row overview-campaign-grid overview-campaign-grid--utm" role="row">
                    <span className="overview-campaign-name" title={c.name} role="cell">{c.name}</span>
                    <span className="overview-campaign-value" role="cell">{c.purchased}</span>
                    <span className="overview-campaign-value" role="cell">{c.conv.toFixed(1).replace('.', ',')}%</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="overview-campaign-empty">Nenhuma campanha com dados no período selecionado.</div>
          )}
        </GlassCard>

        {/* Distribuição Global Interativa */}
        <GlassCard variant="thick" className="overview-insight-card flex flex-col gap-4 p-5">
          <div className="overview-insight-heading">
            <span className="text-sm font-semibold text-foreground">Países</span>
          </div>

          {cur.countries.length === 0 ? (
            <div className="flex flex-1 items-center justify-center py-6 text-center text-xs text-muted-foreground">
              Nenhum país identificado neste período.
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {cur.countries.slice(0, 4).map((c) => {
                const total = cur.visits || 1
                const pct = Math.min(100, Math.max(0, (c.count / total) * 100))
                const isSelected = focusCountry === c.code

                const label = countryName(c.code) || c.name || c.code
                const visitLabel = `${c.count} ${c.count === 1 ? 'visita' : 'visitas'}`
                const purchaseLabel = `${c.purchased} ${c.purchased === 1 ? 'compra' : 'compras'}`

                return (
                  <button
                    key={c.code}
                    type="button"
                    onClick={() =>
                      setFocusCountry((prevVal) => (prevVal === c.code ? null : c.code))
                    }
                    data-tooltip={isSelected ? `Remover foco de ${label}` : `Focar ${label} no globo`}
                    aria-label={`${label}: ${visitLabel}, ${purchaseLabel}. ${isSelected ? 'Remover foco do globo.' : 'Focar no globo.'}`}
                    aria-pressed={isSelected}
                    className="overview-country-row"
                  >
                    <span className="overview-country-main">
                      <span className="overview-country-flag" aria-hidden="true">
                        {countryFlag(c.code)}
                      </span>
                      <span className="overview-country-name">{label}</span>
                    </span>

                    <span className="overview-country-stats">
                      <span>{visitLabel}</span>
                      <span className="overview-country-separator" aria-hidden="true">·</span>
                      <span>{purchaseLabel}</span>
                    </span>

                    <span className="overview-country-share" aria-hidden="true">
                      <span style={{ width: `${pct}%` }} />
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </GlassCard>

        {/* Dados */}
        <GlassCard variant="thick" data-tour="confidence" className="overview-insight-card flex flex-col justify-between p-5">
          <div className="overview-insight-heading overview-data-heading">
            <span className="text-sm font-semibold text-foreground">Dados</span>
            {overviewHealth ? (
              <span className="overview-health-state" data-state={overviewHealth.status}>
                {healthIssueCount > 0 ? `${healthIssueCount} ${healthIssueCount === 1 ? 'pendência' : 'pendências'}` : 'Operação estável'}
              </span>
            ) : null}
          </div>

          <div className="my-auto space-y-3 py-2">
            <EmqGauge
              score={emqError ? null : emqSummary?.recent ?? null}
              dir={emqSummary?.dir ?? 'flat'}
              alerts={emqSummary?.alerts ?? 0}
            />
            {overviewHealth ? (
              <>
                <div className="overview-data-coverage">
                  <span><small>Compras rastreadas</small><strong>{overviewHealth.coverage.purchases.rate == null ? '—' : `${overviewHealth.coverage.purchases.rate}%`}</strong></span>
                  <span><small>Origem identificada</small><strong>{overviewHealth.coverage.attribution.rate == null ? '—' : `${overviewHealth.coverage.attribution.rate}%`}</strong></span>
                </div>
                {overviewHealth.actions?.[0] ? (
                  <Link href={overviewHealth.actions[0].href} className="overview-data-action" data-severity={overviewHealth.actions[0].severity}>
                    <span>{overviewHealth.actions[0].title}</span>
                    <ArrowUpRight size={13} aria-hidden="true" />
                  </Link>
                ) : null}
              </>
            ) : overviewHealthError ? (
              <button type="button" className="overview-data-action" onClick={() => void mutateHealth()}>Saúde dos dados indisponível · tentar novamente</button>
            ) : (
              <span className="overview-data-loading">Verificando cobertura…</span>
            )}
          </div>
        </GlassCard>
      </section>
    </div>
  )
}
