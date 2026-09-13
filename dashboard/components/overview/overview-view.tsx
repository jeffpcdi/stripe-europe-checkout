'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import Link from 'next/link'
import { useOncePerSession } from '@/lib/motion'
import {
  useStats,
  useEmqTrend,
  useAdsStatus,
  useAdsRoas,
  useAdsTree,
  useOverviewHealth,
} from '@/lib/api'
import { useAfterFirstPaint } from '@/lib/use-after-first-paint'
import { aggregate, periodStart, prevWindow } from '@/lib/metrics'
import { adsDateRange } from '@/lib/ads-time'
import { countryFlag, timeAgo } from '@/lib/format'
import { countryName } from '@/lib/countries'
import type { Period } from '@/lib/types'
import { Skeleton } from '@/components/skeleton'
import { GlassCard } from '@/components/glass-card'
import { toast } from '@/lib/toast'
import { PeriodPicker } from './period-picker'
import { HeroGlobe, type GlobePurchase } from './hero-globe'
import { LiveFeed } from './live-feed'
import { FunnelGauge } from './funnel-gauge'
import { EmqGauge } from './emq-gauge'
import { ErrorState } from '@/components/error-state'
import { SetupGuide } from './setup-guide'
import {
  TrendingUp,
  RefreshCw,
  ShieldCheck,
  Target,
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

/** Formata data e hora no fuso de Brasília de forma segura */
function formatLocalTimestamp(date: Date | string): string {
  try {
    const d = typeof date === 'string' ? new Date(date) : date
    if (isNaN(d.getTime())) return 'recentemente'
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(d)
  } catch {
    return 'recentemente'
  }
}

function periodToAdsRange(period: Period, timeZone?: string): { fromDate: string; toDate: string } {
  const days = period === 'today' ? 1 : period === '7d' ? 7 : period === '30d' ? 30 : 90
  return adsDateRange(days, timeZone)
}

const PERIODS: Period[] = ['today', '7d', '30d', 'all']
const PERIOD_KEY = 'roi:overview:period'

function initialPeriod(): Period {
  if (typeof window === 'undefined') return 'today'
  const fromUrl = new URLSearchParams(window.location.search).get('p') as Period | null
  if (fromUrl && PERIODS.includes(fromUrl)) return fromUrl
  return 'today'
}

// ══════════════════════════════════════════════════════════════════════════
//  COMPONENTE PRINCIPAL — VISÃO GERAL REFINADA & PADRONIZADA
// ══════════════════════════════════════════════════════════════════════════
export function OverviewView() {
  const [period, setPeriodState] = useState<Period>(initialPeriod)
  const [focusCountry, setFocusCountry] = useState<string | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const { data, error, isLoading, isValidating, mutate: mutateStats } = useStats()
  const firstEnter = useOncePerSession('overview-enter')

  const afterFirstPaint = useAfterFirstPaint()
  const { data: adsStatus, error: adsError, mutate: mutateAdsStatus } = useAdsStatus(afterFirstPaint)
  const adAccountId = adsStatus?.advertiserId || ''
  const adsConnected = Boolean(adsStatus?.enabled && adsStatus?.connected && adAccountId)
  const [calendarTick, setCalendarTick] = useState(0)
  useEffect(() => { const timer = setInterval(() => setCalendarTick(tick => tick + 1), 60_000); return () => clearInterval(timer) }, [])
  const adsRange = useMemo(
    () => periodToAdsRange(period, adsStatus?.timeZone),
    [period, adsStatus?.timeZone, calendarTick],
  )
  const { data: roas, error: roasError, mutate: mutateRoas } = useAdsRoas(adsConnected, adAccountId, adsRange)

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
    return adsTree.campaigns
      .map((c) => {
        const spend = c.metrics?.spend ?? 0
        const conversions = c.metrics?.conversions ?? 0
        const cpa = c.metrics?.cpa ?? (conversions > 0 && spend > 0 ? spend / conversions : null)
        const campaignRoas = c.metrics?.roas ?? null
        return {
          id: c.platformCampaignId,
          name: c.campaignName || c.platformCampaignId,
          status: c.status,
          conversions,
          spend,
          cpa,
          roas: campaignRoas,
        }
      })
      .sort((a, b) => b.conversions - a.conversions || b.spend - a.spend)
      .slice(0, 5)
  }, [adsTree?.campaigns])

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
  const { data: overviewHealth, mutate: mutateHealth } = useOverviewHealth(afterFirstPaint)

  function setPeriod(next: Period) {
    setPeriodState(next)
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(PERIOD_KEY, next)
      const url = new URL(window.location.href)
      url.searchParams.set('p', next)
      window.history.replaceState(null, '', url)
    } catch {
      /* modo privado */
    }
  }

  const handleRefreshAll = useCallback(async () => {
    setIsRefreshing(true)
    try {
      await Promise.all([
        mutateStats(),
        mutateAdsStatus(),
        mutateRoas(),
        mutateAdsTree(),
        mutateEmq(),
        mutateHealth(),
      ])
      toast.success('Visão geral e conexões atualizadas')
    } catch {
      toast.error('Erro ao atualizar métricas')
    } finally {
      setIsRefreshing(false)
    }
  }, [mutateStats, mutateAdsStatus, mutateRoas, mutateAdsTree, mutateEmq, mutateHealth])

  // Métricas do período ATUAL e ANTERIOR
  const { cur, prev } = useMemo(() => {
    if (!data) return { cur: null, prev: null }
    const curMetrics = aggregate(data, periodStart(period))
    const pw = prevWindow(period)
    const prevMetrics = pw ? aggregate(data, pw.prevFrom, pw.prevTo) : null
    return { cur: curMetrics, prev: prevMetrics }
  }, [data, period])

  // Países dos leads para o globo: consolida dados do período selecionado,
  // com fallback gracioso para hoje ou para os totais de países retornados pela API
  const lastLeadAt = useMemo(() => {
    let max = ''
    for (const l of data?.leads ?? []) {
      if (l.at && l.at > max) max = l.at
    }
    return max || null
  }, [data])

  // ── Validação Visual de Sincronização e Detecção de Falhas ──
  const syncValidation = useMemo(() => {
    let lastSuccessDate: Date | null = null
    let lastSuccessOrigin = ''
    let failureTitle = ''
    let failureDescription = ''
    let hasFailure = false

    // 1. Data mais recente de sincronização bem-sucedida
    const candidateDates: { date: Date; origin: string }[] = []

    if (overviewHealth?.freshness?.lastDataAt) {
      const d = new Date(overviewHealth.freshness.lastDataAt)
      if (!isNaN(d.getTime())) {
        candidateDates.push({ date: d, origin: 'Jornada Rastreada' })
      }
    }
    if (overviewHealth?.freshness?.lastPaymentAt) {
      const d = new Date(overviewHealth.freshness.lastPaymentAt)
      if (!isNaN(d.getTime())) {
        candidateDates.push({ date: d, origin: 'Conversão de Checkout' })
      }
    }
    if (lastLeadAt) {
      const d = new Date(lastLeadAt)
      if (!isNaN(d.getTime())) {
        candidateDates.push({ date: d, origin: 'Visita / Lead' })
      }
    }

    if (candidateDates.length > 0) {
      candidateDates.sort((a, b) => b.date.getTime() - a.date.getTime())
      lastSuccessDate = candidateDates[0].date
      lastSuccessOrigin = candidateDates[0].origin
    }

    // 2. Verificação de falhas no ecossistema
    if (overviewHealth?.status === 'critical') {
      hasFailure = true
      failureTitle = 'Falha na Cobertura de Dados do Funil'
      failureDescription =
        overviewHealth.actions[0]?.detail ||
        'Ações necessárias para garantir a integridade do rastreamento.'
    } else if (adsError) {
      hasFailure = true
      failureTitle = 'Falha na Sincronização do TikTok Ads'
      failureDescription =
        (adsError instanceof Error ? adsError.message : String(adsError)) ||
        'Token de acesso expirado ou sem autorização do advertiser.'
    } else if (adsStatus?.enabled && !adsStatus?.connected) {
      hasFailure = true
      failureTitle = 'Conta de TikTok Ads Desconectada'
      failureDescription =
        'Conexão com a Business API do TikTok requer autenticação ou seleção de conta.'
    } else if (emqSummary && emqSummary.alerts > 0) {
      hasFailure = true
      failureTitle = 'Alerta na Dados de conversão'
      failureDescription = `${emqSummary.alerts} ${
        emqSummary.alerts === 1 ? 'alerta identificado' : 'alertas identificados'
      } nos envios para o TikTok.`
    }

    return {
      lastSuccessDate,
      lastSuccessOrigin,
      hasFailure,
      failureTitle,
      failureDescription,
      healthStatus: overviewHealth?.status,
    }
  }, [overviewHealth, adsStatus, adsError, emqSummary, lastLeadAt])

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
      <SetupGuide health={overviewHealth} />
      {(error || roasError || emqError) && <button type="button" className="btn-ghost self-start text-xs text-warning" onClick={handleRefreshAll}>Alguns indicadores não foram atualizados · tentar novamente</button>}
      <HeroGlobe
        focusCode={focusCountry}
        purchases={globePurchases}
        purchasesStale={Boolean(error)}
        onRefresh={handleRefreshAll}
        refreshing={isRefreshing}
        periodPicker={<PeriodPicker value={period} onChange={setPeriod} />}
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
          ? aggregate({ ...data, events: data.events.filter(event => (event.currency || 'BRL').toUpperCase() === cur.mainCur) }, periodStart(period)).series
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
                    data-tooltip="Métricas oficiais lidas da API do TikTok Ads (gasto, compras e ROAS)."
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
                  <div className="flex shrink-0 items-center gap-2 text-right">
                    <span
                      data-tooltip="Compras aprovadas atribuídas a esta campanha."
                      className="font-mono text-xs font-bold text-success cursor-help"
                    >
                      {c.conversions} {c.conversions === 1 ? 'venda' : 'vendas'}
                    </span>
                    {c.roas !== null && c.roas > 0 && (
                      <span
                        data-tooltip="Retorno sobre gasto de anúncios (ROAS) desta campanha."
                        className="rounded-lg border border-brand-cyan/35 bg-brand-cyan/15 px-2 py-0.5 font-mono text-xs font-bold text-brand-cyan cursor-help "
                      >
                        {c.roas.toFixed(2).replace('.', ',')}x
                      </span>
                    )}
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

          <div className="my-auto py-2">
            <EmqGauge
              score={emqError ? null : emqSummary?.recent ?? null}
              dir={emqSummary?.dir ?? 'flat'}
              alerts={emqSummary?.alerts ?? 0}
            />
          </div>
        </GlassCard>
      </section>
    </div>
  )
}
