'use client'

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import { useOncePerSession } from '@/lib/motion'
import {
  useStats,
  useEmqTrend,
  useAdsStatus,
  useAdsRoas,
  useAdsTree,
  useAdsCampaignDecisions,
  useAccountSettings,
  useOverviewHealth,
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
import { OverviewAttention } from './overview-attention'
import { ErrorState } from '@/components/error-state'
import {
  TrendingUp,
  ShieldCheck,
  ArrowUpRight,
  Globe2,
} from 'lucide-react'

// ── Formatação de Moeda e Data ───────────────────────────────────────────
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
  const days = period === 'today' ? 1 : period === '7d' ? 7 : period === '30d' ? 30 : 90
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
  const { data: adsStatus, error: adsError, mutate: mutateAdsStatus } = useAdsStatus(afterFirstPaint)
  const adAccountId = adsStatus?.advertiserId || ''
  const adsConnected = Boolean(adsStatus?.enabled && adsStatus?.connected && adAccountId)
  const [calendarTick, setCalendarTick] = useState(0)
  useEffect(() => { const timer = setInterval(() => setCalendarTick(tick => tick + 1), 60_000); return () => clearInterval(timer) }, [])
  const adsRange = useMemo(
    () => periodToAdsRange(period, adsStatus?.timeZone || accountTimeZone),
    [period, adsStatus?.timeZone, accountTimeZone, calendarTick],
  )
  const { data: roas, error: roasError, mutate: mutateRoas } = useAdsRoas(adsConnected, adAccountId, adsRange)
  const { data: campaignDecisions, error: decisionsError, mutate: mutateDecisions } = useAdsCampaignDecisions(
    adsConnected,
    adAccountId,
    adsRange,
  )

  // Campanhas em destaque sincronizadas com a aba TikTok Ads
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
        const spend = c.metrics?.spend ?? 0
        const decision = campaignDecisions?.byCampaign?.[campaignId]
        const sales = decision ? Number(decision.sales) || 0 : null
        const revenueCents = decision ? Number(decision.revenueCents) || 0 : null
        const decisionCurrency = String(decision?.currency || adCurrency || 'BRL').toUpperCase()
        const comparableCurrency = !adCurrency || decisionCurrency === adCurrency
        const cpa = sales != null && sales > 0 && spend > 0 ? spend / sales : null
        const campaignRoas = revenueCents != null && spend > 0 && comparableCurrency
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
      .sort((a, b) => (b.sales ?? -1) - (a.sales ?? -1) || (b.revenueCents ?? -1) - (a.revenueCents ?? -1) || b.spend - a.spend)
      .slice(0, 5)
  }, [adsTree?.campaigns, campaignDecisions?.byCampaign, roas?.currency, adsStatus?.currency])

  const pendingAutomation = useMemo(() => {
    if (!campaignDecisions?.byCampaign) return 0
    return Object.values(campaignDecisions.byCampaign).filter((item) => Boolean(item.automation?.pendingProposal)).length
  }, [campaignDecisions?.byCampaign])

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
        mutateAdsStatus(),
        mutateRoas(),
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
  }, [mutateStats, mutateAdsStatus, mutateRoas, mutateAdsTree, mutateDecisions, mutateEmq, mutateHealth])

  // Métricas do período ATUAL e ANTERIOR
  const { cur, prev } = useMemo(() => {
    if (!data) return { cur: null, prev: null }
    const now = new Date()
    const curMetrics = aggregate(data, periodStart(period, now, accountTimeZone), null, accountTimeZone)
    const pw = prevWindow(period, now, accountTimeZone)
    const prevMetrics = pw ? aggregate(data, pw.prevFrom, pw.prevTo, accountTimeZone) : null
    return { cur: curMetrics, prev: prevMetrics }
  }, [data, period, accountTimeZone, calendarTick])


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
          {['revenue', 'spend', 'conversion', 'return'].map(name => <div key={name} className={`observatory-metric observatory-metric--${name}`}>
            <Skeleton className="h-5 w-24 mb-4" /><Skeleton className="h-10 w-full max-w-48 mb-3" /><Skeleton className="h-4 w-24" />
          </div>)}
          <div className="observatory-globe flex items-center justify-center">
            <Skeleton className="aspect-square w-full max-w-96 rounded-full" />
          </div>
        </div>
        <div className="observatory-activity">{[0, 1, 2].map(index => <section key={index}><Skeleton className="h-6 w-24 mb-4" /><Skeleton className="h-12 w-full" /></section>)}</div>
      </div>
    )
  }

  // Dados computados
  const revCents = cur.rev[cur.mainCur] || 0
  const prevRevCents = prev && prev.mainCur === cur.mainCur ? prev.rev[cur.mainCur] || 0 : null

  const otherRev = Object.entries(cur.rev)
    .filter(([c, v]) => c !== cur.mainCur && v > 0)
    .sort((a, b) => b[1] - a[1])

  const globePurchases: GlobePurchase[] = (data?.leads ?? [])
    .flatMap((lead) => {
      const at = lead.purchasedAt || (lead.stage === 'purchased' ? lead.at : null)
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
      {(error || roasError || decisionsError || emqError || overviewHealthError) && <button type="button" className="btn-ghost self-start text-xs text-warning" onClick={handleRefreshAll}>Alguns indicadores não foram atualizados · tentar novamente</button>}
      <HeroGlobe
        focusCode={focusCountry}
        purchases={globePurchases}
        purchasesStale={Boolean(error)}
        onRefresh={handleRefreshAll}
        refreshing={isRefreshing}
        metrics={{
          revenueCents: revCents,
          currency: cur.mainCur,
          sales: cur.sales,
          visits: cur.visits,
          purchased: cur.purchased,
          approval: cur.approval,
          otherCurrencies: otherRev.length,
          previousRevenueCents: prevRevCents,
          ads: roas,
          adsError: Boolean(roasError),
          allPeriod: period === 'all',
          series: data && otherRev.length > 0
          ? aggregate({ ...data, events: data.events.filter(event => (event.currency || 'BRL').toUpperCase() === cur.mainCur) }, periodStart(period, new Date(), accountTimeZone), null, accountTimeZone).series
          : cur.series,
        }}
      />

      <OverviewAttention
        health={overviewHealth}
        pendingAutomation={pendingAutomation}
        loading={afterFirstPaint && !overviewHealth && !overviewHealthError}
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
        <LiveFeed leads={data?.leads ?? []} />
      </section>

      {/* ── SEÇÃO 4: MOSTRADORES DE DESEMPENHO E SAÚDE ──────────────────── */}
      <section
        aria-label="Desempenho e conformidade"
        className="overview-insight-grid"
      >
        {/* Campanhas em destaque */}
        <GlassCard variant="thick" className="overview-insight-card flex flex-col gap-4 p-5">
          <div className="overview-insight-heading">
            <div className="flex flex-wrap items-center gap-2">
              <span
                data-tooltip="Campanhas com mais compras convertidas no período selecionado."
                className="text-sm font-semibold text-foreground inline-flex items-center gap-1.5 cursor-help"
              >
                <TrendingUp className="size-3.5 text-brand-cyan" />
                Campanhas em destaque
              </span>
              {adsConnected && tikTokCampaigns.length > 0 && cur.topCampaigns.length > 0 && (
                <div className="flex items-center rounded-lg border border-border/70 bg-secondary/50 p-0.5 text-xs font-medium shadow-inner">
                  <button
                    type="button"
                    onClick={() => setCampaignTab('tiktok')}
                    data-tooltip="Gasto e status do TikTok Ads combinados com vendas reais atribuídas pelo ROINADOS."
                    className={`rounded-md px-2 py-0.5 transition-all cursor-pointer ${
                      campaignTab === 'tiktok'
                        ? 'bg-brand-cyan/20 text-brand-cyan font-bold shadow-[0_0_8px_rgba(37,244,238,0.2)]'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    TikTok Ads
                  </button>
                  <button
                    type="button"
                    onClick={() => setCampaignTab('utm')}
                    data-tooltip="Métricas rastreadas pelo parâmetro de link utm_campaign."
                    className={`rounded-md px-2 py-0.5 transition-all cursor-pointer ${
                      campaignTab === 'utm'
                        ? 'bg-brand-cyan/20 text-brand-cyan font-bold shadow-[0_0_8px_rgba(37,244,238,0.2)]'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    UTMs
                  </button>
                </div>
              )}
            </div>
            <Link
              href="/ads/tiktok"
              data-tooltip="Abrir gerenciador e listagem de anúncios."
              className="group text-xs font-semibold text-brand-cyan transition-colors hover:underline flex items-center gap-1"
            >
              Ver anúncios <ArrowUpRight className="size-3 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </Link>
          </div>

          {campaignTab === 'tiktok' && adsConnected && tikTokCampaigns.length > 0 ? (
            <div className="flex flex-col gap-2">
              {tikTokCampaigns.slice(0, 4).map((c, i) => (
                <div
                  key={c.id || c.name}
                  className="overview-campaign-row"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="overview-rank"
                    >
                      {i + 1}
                    </span>
                    <div className="flex min-w-0 flex-col">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-xs font-semibold text-foreground group-hover:text-brand-cyan transition-colors">
                          {c.name}
                        </span>
                        <span
                          data-tooltip={
                            c.status === 'active' || c.status === 'ENABLE'
                              ? 'Campanha ativa veiculando anúncios.'
                              : 'Campanha pausada no TikTok.'
                          }
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium cursor-help ${
                            c.status === 'active' || c.status === 'ENABLE'
                              ? 'border border-brand-cyan/30 bg-brand-cyan/10 text-brand-cyan font-semibold'
                              : 'bg-secondary text-muted-foreground'
                          }`}
                        >
                          {c.status === 'active' || c.status === 'ENABLE' ? 'Ativa' : 'Pausada'}
                        </span>
                      </div>
                      <span
                        data-tooltip="Valor total consumido por esta campanha no período."
                        className="text-xs text-muted-foreground cursor-help font-mono"
                      >
                        {fmtAdsMoney(c.spend, roas?.currency || 'BRL')} investidos
                      </span>
                    </div>
                  </div>
                  <div className="overview-campaign-metrics">
                    <span data-tooltip="Vendas reais atribuídas pelo rastreamento do ROINADOS a esta campanha.">
                      <small>Vendas</small>
                      <strong className="text-success">{c.sales == null ? '—' : c.sales}</strong>
                    </span>
                    <span data-tooltip="Custo real por venda com base nas vendas atribuídas pelo ROINADOS.">
                      <small>CPA</small>
                      <strong>{c.cpa !== null ? fmtAdsMoney(c.cpa, roas?.currency || 'BRL') : '—'}</strong>
                    </span>
                    <span data-tooltip="Retorno sobre gasto de anúncios (ROAS) desta campanha.">
                      <small>ROAS</small>
                      <strong className={c.roas !== null && c.roas > 0 ? 'text-brand-cyan' : undefined}>
                        {c.roas !== null && c.roas > 0 ? `${c.roas.toFixed(2).replace('.', ',')}x` : '—'}
                      </strong>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : cur.topCampaigns.length > 0 ? (
            <div className="flex flex-col gap-2">
              {cur.topCampaigns.slice(0, 4).map((c, i) => (
                <div
                  key={c.name}
                  className="overview-campaign-row"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="overview-rank"
                    >
                      {i + 1}
                    </span>
                    <span className="truncate text-xs font-semibold text-foreground group-hover:text-brand-cyan transition-colors">
                      {c.name}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-right">
                    <span
                      data-tooltip="Compras confirmadas desta UTM."
                      className="font-mono text-xs font-bold text-success cursor-help"
                    >
                      {c.purchased} {c.purchased === 1 ? 'venda' : 'vendas'}
                    </span>
                    <span
                      data-tooltip="Taxa de conversão de visitantes desta campanha."
                      className="font-mono text-xs text-muted-foreground cursor-help"
                    >
                      {c.conv.toFixed(1).replace('.', ',')}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center py-6 text-center text-xs text-muted-foreground">
              Nenhuma campanha com dados no período selecionado.
            </div>
          )}
        </GlassCard>

        {/* Distribuição Global Interativa */}
        <GlassCard variant="thick" className="overview-insight-card flex flex-col gap-4 p-5">
          <div className="overview-insight-heading">
            <span
              data-tooltip="Países com maior volume de acessos. Clique em qualquer país para centralizar o globo 3D."
              className="text-sm font-semibold text-foreground flex items-center gap-1.5 cursor-help"
            >
              <Globe2 className="size-3.5 text-brand-cyan" />
              Países no período
            </span>
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

                return (
                  <button
                    key={c.code}
                    type="button"
                    onClick={() =>
                      setFocusCountry((prevVal) => (prevVal === c.code ? null : c.code))
                    }
                    data-tooltip={`Focar no globo: ${c.name || c.code} (${c.count} visitas, ${c.purchased} compras)`}
                    aria-pressed={isSelected}
                    className={`overview-country-row flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left transition-all cursor-pointer ${
                      isSelected
                        ? 'border-brand-cyan/80 bg-brand-cyan/20 shadow-[0_0_16px_rgba(37,244,238,0.25)] ring-1 ring-brand-cyan/50 translate-x-0.5'
                        : 'border-border/50 bg-secondary/20 hover:border-brand-cyan/40 hover:bg-secondary/40 hover:translate-x-0.5'
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="text-base leading-none transition-transform hover:scale-110">
                        {countryFlag(c.code)}
                      </span>
                      <span className="truncate text-xs font-semibold text-foreground">
                        {countryName(c.code) || c.name || c.code}
                      </span>
                      {c.purchased > 0 && (
                        <span className="rounded-full border border-success/30 bg-success/15 px-2 py-0.5 font-mono text-[11px] font-bold text-success shadow-[0_0_8px_rgba(34,197,94,0.15)]">
                          {c.purchased} {c.purchased === 1 ? 'venda' : 'vendas'}
                        </span>
                      )}
                    </div>

                    <div className="flex shrink-0 items-center gap-3">
                      <div className="hidden w-16 overflow-hidden rounded-full bg-secondary sm:block h-1.5">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${pct}%`,
                            background: 'var(--accent)',
                          }}
                        />
                      </div>
                      <span className="font-mono text-xs font-bold tabular-nums text-foreground">
                        {c.count}
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </GlassCard>

        {/* Dados de conversão */}
        <GlassCard variant="thick" className="overview-insight-card flex flex-col justify-between p-5">
          <div className="overview-insight-heading">
            <span
              data-tooltip="Completude dos dados enviados ao TikTok. Consulte os pixels para ver erros de envio."
              className="text-sm font-semibold text-foreground flex items-center gap-1.5 cursor-help"
            >
              <ShieldCheck className="size-3.5 text-brand-cyan" />
              Dados de conversão
            </span>
          </div>

          <div className="my-auto space-y-3 py-2">
            <EmqGauge
              score={emqError ? null : emqSummary?.recent ?? null}
              dir={emqSummary?.dir ?? 'flat'}
              alerts={emqSummary?.alerts ?? 0}
            />
            {overviewHealth ? (
              <div className="overview-data-coverage">
                <span><small>Compras rastreadas</small><strong>{overviewHealth.coverage.purchases.rate == null ? '—' : `${overviewHealth.coverage.purchases.rate}%`}</strong></span>
                <span><small>Origem identificada</small><strong>{overviewHealth.coverage.attribution.rate == null ? '—' : `${overviewHealth.coverage.attribution.rate}%`}</strong></span>
              </div>
            ) : null}
          </div>
        </GlassCard>
      </section>
    </div>
  )
}
