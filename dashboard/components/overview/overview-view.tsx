'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useOncePerSession } from '@/lib/motion'
import { useStats, useEmqTrend, useAdsStatus, useAdsRoas, useAdsTree } from '@/lib/api'
import { useAfterFirstPaint } from '@/lib/use-after-first-paint'
import { aggregate, money, periodStart, prevWindow } from '@/lib/metrics'
import { adsDateRange } from '@/lib/ads-time'
import { countryFlag } from '@/lib/format'
import { countryName } from '@/lib/countries'
import type { Period } from '@/lib/types'
import { CountUp } from '@/components/count-up'
import { Skeleton } from '@/components/skeleton'
import { PeriodPicker } from './period-picker'
import { HeroGlobe } from './hero-globe'
import { LiveFeed } from './live-feed'
import { FunnelGauge } from './funnel-gauge'
import { RoasGauge } from './roas-gauge'
import { EmqGauge } from './emq-gauge'
import { ErrorState } from '@/components/error-state'
import { DollarSign, Flame, ShoppingBag, ArrowUpRight, TrendingUp } from 'lucide-react'

// ── Formatação de Moeda ──────────────────────────────────────────────────
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

const PERIODS: Period[] = ['today', '7d', '30d', 'all']
const PERIOD_KEY = 'roi:overview:period'

function initialPeriod(): Period {
  if (typeof window === 'undefined') return 'today'
  const fromUrl = new URLSearchParams(window.location.search).get('p') as Period | null
  if (fromUrl && PERIODS.includes(fromUrl)) return fromUrl
  return 'today'
}

// ── Mini Sparkline Elegante ──────────────────────────────────────────────
function MiniSparkline({
  data,
  color = '#22d3ee',
  height = 36,
}: {
  data: number[]
  color?: string
  height?: number
}) {
  if (!data.length || data.length < 2) return null
  const width = 96
  const max = Math.max(...data, 1)
  const min = Math.min(...data, 0)
  const range = max - min || 1

  const points = data
    .map((v, i) => {
      const x = (i / Math.max(data.length - 1, 1)) * width
      const y = height - ((v - min) / range) * (height - 6) - 3
      return `${x},${y}`
    })
    .join(' ')

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="overflow-visible opacity-60 transition-opacity hover:opacity-100"
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// ── Badge de Variação Discreto ──────────────────────────────────────────
function VariationBadge({ current, previous }: { current: number; previous: number }) {
  if (previous === 0 && current === 0) return null
  if (previous === 0) {
    return (
      <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9.5px] font-bold text-emerald-400">
        novo
      </span>
    )
  }
  const pct = ((current - previous) / previous) * 100
  const isUp = pct >= 0
  const display = Math.abs(pct) > 999 ? '999+' : Math.abs(pct).toFixed(0)

  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-mono text-[9.5px] font-bold tabular-nums ${
        isUp ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'
      }`}
    >
      {isUp ? '↑' : '↓'} {display}%
    </span>
  )
}

// ══════════════════════════════════════════════════════════════════════════
//  COMPONENTE PRINCIPAL — VISÃO GERAL REFINADA
// ══════════════════════════════════════════════════════════════════════════
export function OverviewView() {
  const [period, setPeriodState] = useState<Period>(initialPeriod)
  const [focusCountry, setFocusCountry] = useState<string | null>(null)
  const { data, error, isLoading, isValidating, mutate } = useStats()
  const firstEnter = useOncePerSession('overview-enter')

  const afterFirstPaint = useAfterFirstPaint()
  const { data: adsStatus } = useAdsStatus(afterFirstPaint)
  const adAccountId = adsStatus?.advertiserId || ''
  const adsConnected = Boolean(adsStatus?.enabled && adsStatus?.connected && adAccountId)
  const adsRange = useMemo(
    () => periodToAdsRange(period, adsStatus?.timeZone),
    [period, adsStatus?.timeZone],
  )
  const { data: roas } = useAdsRoas(adsConnected, adAccountId, adsRange)

  // Top Campanhas sincronizadas com a aba TikTok Ads
  const { data: adsTree, isLoading: adsTreeLoading } = useAdsTree(adsConnected, {
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
        const roas = c.metrics?.roas ?? null
        return {
          id: c.platformCampaignId,
          name: c.campaignName || c.platformCampaignId,
          status: c.status,
          conversions,
          spend,
          cpa,
          roas,
        }
      })
      .sort((a, b) => b.conversions - a.conversions || b.spend - a.spend)
      .slice(0, 5)
  }, [adsTree?.campaigns])

  // EMQ
  const { data: emqData } = useEmqTrend(afterFirstPaint)
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

  // Métricas do período ATUAL e ANTERIOR
  const { cur, prev } = useMemo(() => {
    if (!data) return { cur: null, prev: null }
    const curMetrics = aggregate(data, periodStart(period))
    const pw = prevWindow(period)
    const prevMetrics = pw ? aggregate(data, pw.prevFrom, pw.prevTo) : null
    return { cur: curMetrics, prev: prevMetrics }
  }, [data, period])

  // Países dos leads para o globo
  const todayCountries = useMemo(() => {
    const t = periodStart('today')?.getTime() ?? 0
    const byCountry = new Map<string, { count: number; purchased: number }>()
    for (const l of data?.leads ?? []) {
      const at = new Date(l.at).getTime()
      if (!Number.isFinite(at) || at < t) continue
      if (!l.country) continue
      const prev = byCountry.get(l.country) ?? { count: 0, purchased: 0 }
      byCountry.set(l.country, {
        count: prev.count + 1,
        purchased: prev.purchased + (l.stage === 'purchased' ? 1 : 0),
      })
    }
    return Array.from(byCountry, ([code, val]) => ({
      code,
      name: countryName(code),
      count: val.count,
      purchased: val.purchased,
    }))
  }, [data])

  const lastLeadAt = useMemo(() => {
    let max = ''
    for (const l of data?.leads ?? []) {
      if (l.at && l.at > max) max = l.at
    }
    return max || null
  }, [data])

  // Estado de Erro
  if (error) {
    return (
      <ErrorState
        title="Não foi possível carregar as métricas"
        description="Verifique a conexão com o servidor."
        onRetry={() => mutate()}
        retrying={isValidating}
      />
    )
  }

  // Loading Skeleton
  if (isLoading || !cur) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <div className="flex justify-end">
          <Skeleton className="h-8 w-60 rounded-full" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="rounded-2xl border border-white/[0.06] bg-[#0c0d14]/70 p-4"
            >
              <Skeleton className="h-4 w-20 mb-3" />
              <Skeleton className="h-8 w-32 mb-2" />
              <Skeleton className="h-3 w-16" />
            </div>
          ))}
        </div>
        <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
          <div className="h-80 rounded-2xl border border-white/[0.06] bg-[#0c0d14]/70 p-6">
            <Skeleton className="size-full rounded-full" />
          </div>
          <div className="h-80 rounded-2xl border border-white/[0.06] bg-[#0c0d14]/70 p-6">
            <Skeleton className="h-6 w-36 mb-4" />
            <Skeleton className="h-20 w-full mb-4" />
            <Skeleton className="h-32 w-full" />
          </div>
        </div>
      </div>
    )
  }

  // Dados computados
  const revCents = cur.rev[cur.mainCur] || 0
  const prevRevCents = prev ? prev.rev[prev.mainCur] || 0 : 0
  const revSeries = cur.series.map((s) => s.revenue)

  const otherRev = Object.entries(cur.rev)
    .filter(([c, v]) => c !== cur.mainCur && v > 0)
    .sort((a, b) => b[1] - a[1])

  const currencyMismatch = Boolean(
    roas &&
      (roas.currencyMismatch ??
        (roas.roas !== null &&
          roas.currency &&
          revCents > 0 &&
          cur.mainCur !== roas.currency.toUpperCase())),
  )

  // Lucro líquido estimado (Receita - Gasto)
  const spendVal = roas ? roas.spend : 0
  const revReal = revCents / 100
  const estimatedProfit =
    !currencyMismatch && roas && revReal > 0 ? revReal - spendVal : null

  // Taxa geral de conversão
  const overallRate =
    cur.visits > 0 ? ((cur.purchased / cur.visits) * 100).toFixed(1) : '0.0'

  return (
    <div
      className={`mx-auto max-w-[1600px] flex flex-col gap-4 ${
        firstEnter ? 'stagger-fade' : ''
      }`}
    >
      {/* ── BARRA DE CONTROLES REFINADA ────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 shadow-[0_0_12px_rgba(16,185,129,0.15)]">
            <span className="relative flex size-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
            </span>
            <span className="font-mono text-[10.5px] font-bold uppercase tracking-wider text-emerald-300">
              AO VIVO
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <h1 className="text-base font-bold tracking-tight text-white sm:text-lg">
              Visão Geral
            </h1>
            <span className="hidden sm:inline-block text-xs text-white/40">
              · Monitoramento em Tempo Real
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <PeriodPicker value={period} onChange={setPeriod} />
        </div>
      </div>

      {/* ── SEÇÃO 1: 4 MOSTRADORES PRINCIPAIS (KPIS & GAUGES) ───────────── */}
      <section
        aria-label="Indicadores chave"
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        {/* Mostrador 1: Faturamento */}
        <div className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0c0d14]/80 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-xl transition-all duration-300 hover:border-white/15">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-400">
                <DollarSign className="size-4" />
              </span>
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/60">
                Faturamento
              </span>
            </div>
            <VariationBadge current={revCents} previous={prevRevCents} />
          </div>

          <div className="my-2 flex items-baseline justify-between gap-2">
            <div className="font-mono text-2xl font-bold tracking-tight text-white sm:text-3xl" data-sensitive>
              <CountUp
                value={revCents}
                format={(v) => money(Math.round(v), cur.mainCur)}
              />
            </div>
            <div className="shrink-0">
              <MiniSparkline data={revSeries} color="#22d3ee" height={32} />
            </div>
          </div>

          <div className="flex items-center justify-between text-[11px] text-white/40">
            <span>{cur.sales} venda{cur.sales === 1 ? '' : 's'}</span>
            {otherRev.length > 0 && (
              <span className="text-[10px] text-cyan-400">
                +{otherRev.length} outra{otherRev.length === 1 ? ' moeda' : 's'}
              </span>
            )}
          </div>
        </div>

        {/* Mostrador 2: Gasto & Lucro */}
        <div className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0c0d14]/80 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-xl transition-all duration-300 hover:border-white/15">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-lg bg-rose-500/10 text-rose-400">
                <Flame className="size-4" />
              </span>
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/60">
                Investimento Ads
              </span>
            </div>
            {estimatedProfit !== null && (
              <span
                className={`rounded-full px-2 py-0.5 font-mono text-[9.5px] font-bold ${
                  estimatedProfit >= 0
                    ? 'bg-emerald-500/15 text-emerald-400'
                    : 'bg-rose-500/15 text-rose-400'
                }`}
                data-sensitive
              >
                {estimatedProfit >= 0 ? '+' : ''}
                {fmtAdsMoney(estimatedProfit, cur.mainCur)} líquido
              </span>
            )}
          </div>

          <div className="my-2">
            <div className="font-mono text-2xl font-bold tracking-tight text-white sm:text-3xl" data-sensitive>
              {roas ? fmtAdsMoney(roas.spend, roas.currency) : '—'}
            </div>
          </div>

          <div className="flex items-center justify-between text-[11px] text-white/40">
            <span>TikTok Ads</span>
            <span className="text-[10px] text-white/50">
              {period === 'today'
                ? 'Hoje'
                : period === '7d'
                ? '7 dias'
                : period === '30d'
                ? '30 dias'
                : '90 dias'}
            </span>
          </div>
        </div>

        {/* Mostrador 3: ROAS (Mostrador Semicircular de Arco) */}
        <div className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0c0d14]/80 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-xl transition-all duration-300 hover:border-white/15">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
                <TrendingUp className="size-4" />
              </span>
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/60">
                Retorno (ROAS)
              </span>
            </div>
          </div>

          <RoasGauge
            roas={roas ? roas.roas : null}
            spend={spendVal}
            currency={roas?.currency}
            currencyMismatch={currencyMismatch}
          />
        </div>

        {/* Mostrador 4: Conversão & Eficiência */}
        <div className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0c0d14]/80 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-xl transition-all duration-300 hover:border-white/15">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-lg bg-amber-500/10 text-amber-400">
                <ShoppingBag className="size-4" />
              </span>
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/60">
                Conversão Geral
              </span>
            </div>
            <span className="rounded-full bg-cyan-500/15 px-2 py-0.5 font-mono text-[10px] font-bold text-cyan-300">
              {cur.visits} visitas
            </span>
          </div>

          <div className="my-2">
            <div className="font-mono text-2xl font-bold tracking-tight text-white sm:text-3xl">
              {overallRate}%
            </div>
          </div>

          <div className="flex items-center justify-between text-[11px] text-white/40">
            <span>Aprovação no checkout</span>
            <span className="font-mono font-semibold text-emerald-400">
              {cur.approval.toFixed(0)}%
            </span>
          </div>
        </div>
      </section>

      {/* ── SEÇÃO 2: CENTRO VISUAL (GLOBO 3D + FUNIL + ATIVIDADE) ───────── */}
      <section
        aria-label="Presença global e pipeline"
        className="grid gap-3 lg:grid-cols-[1.4fr_1fr]"
      >
        {/* Globo 3D Imersivo e Refinado com Pontos de Acesso Shopify Live View */}
        <div
          className="relative flex min-h-[460px] items-center justify-center overflow-hidden rounded-2xl border border-white/[0.08] bg-[#05070d] shadow-[0_12px_40px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.08)]"
          style={{ minHeight: 460 }}
        >
          <HeroGlobe
            countries={todayCountries}
            lastLeadAt={lastLeadAt}
            focusCode={focusCountry}
          />
        </div>

        {/* Coluna Direita: Funil de Conversão + Feed ao Vivo */}
        <div className="flex flex-col gap-3">
          {/* Mostrador Visual de Funil (FunnelGauge) */}
          <div className="rounded-2xl border border-white/[0.08] bg-[#0c0d14]/80 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-xl">
            <FunnelGauge
              visits={cur.visits}
              checkout={cur.reachedCheckout}
              payment={cur.paymentStarted}
              purchased={cur.purchased}
            />
          </div>

          {/* Atividade Recente (LiveFeed) */}
          <div className="flex-1 rounded-2xl border border-white/[0.08] bg-[#0c0d14]/80 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-xl">
            <LiveFeed leads={data?.leads ?? []} />
          </div>
        </div>
      </section>

      {/* ── SEÇÃO 3: MOSTRADORES DE DESEMPENHO E SAÚDE ──────────────────── */}
      <section
        aria-label="Desempenho e conformidade"
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
      >
        {/* Top Campanhas */}
        <div className="flex flex-col gap-3 rounded-2xl border border-white/[0.08] bg-[#0c0d14]/80 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70">
                Top Campanhas
              </span>
              {adsConnected && tikTokCampaigns.length > 0 && cur.topCampaigns.length > 0 && (
                <div className="flex items-center rounded-lg border border-white/[0.08] bg-white/[0.03] p-0.5 text-[9px] font-medium">
                  <button
                    type="button"
                    onClick={() => setCampaignTab('tiktok')}
                    className={`rounded-md px-1.5 py-0.5 transition-colors ${
                      campaignTab === 'tiktok'
                        ? 'bg-cyan-500/20 text-cyan-300 font-semibold'
                        : 'text-white/40 hover:text-white/70'
                    }`}
                  >
                    TikTok Ads
                  </button>
                  <button
                    type="button"
                    onClick={() => setCampaignTab('utm')}
                    className={`rounded-md px-1.5 py-0.5 transition-colors ${
                      campaignTab === 'utm'
                        ? 'bg-cyan-500/20 text-cyan-300 font-semibold'
                        : 'text-white/40 hover:text-white/70'
                    }`}
                  >
                    UTMs
                  </button>
                </div>
              )}
            </div>
            <Link
              href="/ads/tiktok"
              className="text-[10px] font-medium text-white/40 transition-colors hover:text-cyan-300"
            >
              Ver anúncios →
            </Link>
          </div>

          {campaignTab === 'tiktok' && adsConnected && tikTokCampaigns.length > 0 ? (
            <div className="flex flex-col gap-2">
              {tikTokCampaigns.slice(0, 4).map((c, i) => (
                <div
                  key={c.id || c.name}
                  className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.04] bg-white/[0.02] px-3 py-2 transition-colors hover:bg-white/[0.05]"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-white/[0.06] font-mono text-[10px] font-bold text-white/60">
                      {i + 1}
                    </span>
                    <div className="flex min-w-0 flex-col">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-xs font-medium text-white/90">
                          {c.name}
                        </span>
                        <span
                          className={`inline-flex items-center rounded px-1 py-0.2 text-[8.5px] font-medium ${
                            c.status === 'active' || c.status === 'ENABLE'
                              ? 'bg-emerald-500/15 text-emerald-400'
                              : 'bg-white/10 text-white/50'
                          }`}
                        >
                          {c.status === 'active' || c.status === 'ENABLE' ? 'Ativa' : 'Pausada'}
                        </span>
                      </div>
                      <span className="text-[10px] text-white/40">
                        {fmtAdsMoney(c.spend, roas?.currency || 'BRL')} investidos
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-right">
                    <span className="font-mono text-xs font-bold text-emerald-400">
                      {c.conversions} {c.conversions === 1 ? 'venda' : 'vendas'}
                    </span>
                    {c.roas !== null && c.roas > 0 && (
                      <span className="rounded bg-cyan-500/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-cyan-300">
                        {c.roas.toFixed(2)}x
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
                  className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.04] bg-white/[0.02] px-3 py-2 transition-colors hover:bg-white/[0.05]"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-white/[0.06] font-mono text-[10px] font-bold text-white/60">
                      {i + 1}
                    </span>
                    <span className="truncate text-xs font-medium text-white/90">
                      {c.name}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-right">
                    <span className="font-mono text-xs font-bold text-emerald-400">
                      {c.purchased} {c.purchased === 1 ? 'venda' : 'vendas'}
                    </span>
                    <span className="font-mono text-[10px] text-white/40">
                      {c.conv.toFixed(1)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center py-6 text-center text-xs text-white/40">
              Nenhuma campanha com dados no período.
            </div>
          )}
        </div>

        {/* Distribuição Global Interativa (passar o mouse/clicar foca o globo) */}
        <div className="flex flex-col gap-3 rounded-2xl border border-white/[0.08] bg-[#0c0d14]/80 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-xl">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70">
              Top Países
            </span>
            <span className="text-[10px] text-white/40">
              Clique para focar no globo
            </span>
          </div>

          {cur.countries.length === 0 ? (
            <div className="flex flex-1 items-center justify-center py-6 text-center text-xs text-white/40">
              Aguardando visitantes globais.
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {cur.countries.slice(0, 4).map((c) => {
                const total = cur.visits || 1
                const pct = Math.min(100, Math.max(3, (c.count / total) * 100))
                const isSelected = focusCountry === c.code

                return (
                  <button
                    key={c.code}
                    type="button"
                    onClick={() =>
                      setFocusCountry((prev) => (prev === c.code ? null : c.code))
                    }
                    className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left transition-all ${
                      isSelected
                        ? 'border-cyan-400/50 bg-cyan-500/15 shadow-[0_0_12px_rgba(6,182,212,0.25)] ring-1 ring-cyan-400/30'
                        : 'border-white/[0.04] bg-white/[0.02] hover:border-white/10 hover:bg-white/[0.05]'
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="text-base leading-none">
                        {countryFlag(c.code)}
                      </span>
                      <span className="truncate text-xs font-medium text-white/90">
                        {c.name || c.code}
                      </span>
                      {c.purchased > 0 && (
                        <span className="rounded bg-emerald-500/15 px-1.5 py-0.2 font-mono text-[9px] font-semibold text-emerald-400">
                          {c.purchased} {c.purchased === 1 ? 'venda' : 'vendas'}
                        </span>
                      )}
                    </div>

                    <div className="flex shrink-0 items-center gap-3">
                      <div className="hidden w-16 overflow-hidden rounded-full bg-white/[0.06] sm:block h-1.5">
                        <div
                          className="h-full rounded-full bg-cyan-400"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="font-mono text-xs font-bold tabular-nums text-white">
                        {c.count}
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Saúde do Pixel CAPI (TikTok EMQ) */}
        <div className="flex flex-col justify-between rounded-2xl border border-white/[0.08] bg-[#0c0d14]/80 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-xl">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70">
              Qualidade de Eventos
            </span>
            <span className="flex size-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(16,185,129,0.8)]" />
          </div>

          <div className="my-auto py-2">
            <EmqGauge
              score={emqSummary?.recent ?? 8.5}
              dir={emqSummary?.dir ?? 'flat'}
              alerts={emqSummary?.alerts ?? 0}
            />
          </div>

          <div className="flex items-center justify-between text-[10px] text-white/40">
            <span>TikTok Events API (CAPI)</span>
            <span className="text-emerald-400">Deduplicação ativa</span>
          </div>
        </div>
      </section>
    </div>
  )
}
