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
import { aggregate, money, periodStart, prevWindow } from '@/lib/metrics'
import { adsDateRange } from '@/lib/ads-time'
import { countryFlag, timeAgo } from '@/lib/format'
import { countryName } from '@/lib/countries'
import type { Period } from '@/lib/types'
import { CountUp } from '@/components/count-up'
import { Skeleton } from '@/components/skeleton'
import { GlassCard } from '@/components/glass-card'
import { toast } from '@/lib/toast'
import { PeriodPicker } from './period-picker'
import { HeroGlobe } from './hero-globe'
import { LiveFeed } from './live-feed'
import { FunnelGauge } from './funnel-gauge'
import { EmqGauge } from './emq-gauge'
import { ErrorState } from '@/components/error-state'
import {
  DollarSign,
  Flame,
  ShoppingBag,
  TrendingUp,
  RefreshCw,
  ShieldCheck,
  Target,
  ArrowUpRight,
  Globe2,
  Wallet,
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
      className="overflow-visible opacity-70 transition-opacity hover:opacity-100"
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
      <span className="inline-flex items-center rounded-full bg-success/15 px-1.5 py-0.5 text-[10px] font-bold text-success">
        novo
      </span>
    )
  }
  const pct = ((current - previous) / previous) * 100
  const isUp = pct >= 0
  const display = Math.abs(pct) > 999 ? '999+' : Math.abs(pct).toFixed(0)

  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums ${
        isUp ? 'bg-success/15 text-success' : 'bg-destructive/15 text-destructive'
      }`}
    >
      {isUp ? '↑' : '↓'} {display}%
    </span>
  )
}

function getRoasStatus(
  currencyMismatch: boolean,
  roas: { roas: number | null } | null | undefined,
  spendVal: number,
) {
  if (currencyMismatch) {
    return { label: 'Moedas divergentes', badgeClass: 'bg-warning/15 text-warning' }
  }
  if (!roas || roas.roas === null || spendVal === 0) {
    return { label: 'Sem veiculação', badgeClass: 'bg-secondary text-muted-foreground' }
  }
  if (roas.roas >= 2.5) {
    return { label: 'Alta Lucratividade', badgeClass: 'bg-emerald-500/15 text-emerald-400' }
  }
  if (roas.roas >= 1.5) {
    return { label: 'Retorno acima de 1×', badgeClass: 'bg-cyan-500/15 text-brand-cyan' }
  }
  if (roas.roas >= 1.0) {
    return { label: 'Equilíbrio', badgeClass: 'bg-amber-500/15 text-amber-400' }
  }
  return { label: 'Abaixo da Meta', badgeClass: 'bg-rose-500/15 text-rose-400' }
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
  if (error) {
    return (
      <ErrorState
        title="Não foi possível carregar as métricas"
        description="Verifique a conexão com o servidor e tente novamente."
        onRetry={() => mutateStats()}
        retrying={isValidating}
      />
    )
  }

  // Loading Skeleton
  if (isLoading || !cur) {
    return (
      <div className="flex flex-col gap-6" aria-busy="true">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border/60 pb-5">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-6 w-48 rounded-lg" />
            <Skeleton className="h-4 w-72 rounded-lg" />
          </div>
          <div className="flex items-center gap-3">
            <Skeleton className="h-9 w-28 rounded-xl" />
            <Skeleton className="h-9 w-40 rounded-full" />
          </div>
        </div>
        <Skeleton className="h-16 w-full rounded-2xl" />
        <div className="overview-kpis grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="rounded-2xl border border-border/60 bg-secondary/20 p-5">
              <Skeleton className="h-4 w-24 mb-3" />
              <Skeleton className="h-8 w-36 mb-2" />
              <Skeleton className="h-3 w-20" />
            </div>
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <div className="h-96 rounded-2xl border border-border/60 bg-secondary/20 p-6">
            <Skeleton className="size-full rounded-2xl" />
          </div>
          <div className="h-96 rounded-2xl border border-border/60 bg-secondary/20 p-6">
            <Skeleton className="h-6 w-36 mb-4" />
            <Skeleton className="h-24 w-full mb-4" />
            <Skeleton className="h-36 w-full" />
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

  // Lucro líquido estimado (Receita - Gasto de Anúncios)
  const spendVal = roas ? roas.spend : 0
  const revReal = revCents / 100
  const estimatedProfit =
    !currencyMismatch && roas && Number.isFinite(roas.revenueCents) ? roas.revenueCents / 100 - spendVal : null

  // Métricas derivadas de alta densidade
  const aov = cur.sales > 0 ? revReal / cur.sales : 0
  const cpa = roas?.cpa ?? null
  const profitMargin =
    roas && roas.revenueCents > 0 && estimatedProfit !== null ? (estimatedProfit / (roas.revenueCents / 100)) * 100 : null
  const spendSharePct =
    roas && roas.revenueCents > 0 && spendVal > 0 ? (spendVal / (roas.revenueCents / 100)) * 100 : null

  const roasStatus = getRoasStatus(currencyMismatch, roas, spendVal)

  // Taxa geral de conversão
  const overallRate =
    cur.visits > 0 ? ((cur.purchased / cur.visits) * 100).toFixed(1) : '0.0'

  return (
    <div
      className={`mx-auto max-w-[1600px] flex flex-col gap-6 ${
        firstEnter ? 'stagger-fade' : ''
      }`}
    >
      {/* ── SELETOR DE PERÍODO ── */}
      <div className="flex items-center justify-end pb-1">
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>

      {/* ── SEÇÃO 1: 4 PRINCIPAIS KPIS CONSOLIDADOS (ALTA DENSIDADE) ───────────── */}
      {(roasError || emqError) && <button type="button" className="btn-ghost self-start text-xs text-warning" onClick={handleRefreshAll}>Alguns indicadores não foram atualizados · tentar novamente</button>}
      <section
        aria-label="Indicadores chave"
        className="overview-kpis grid grid-cols-2 gap-3 lg:grid-cols-4"
      >
        {/* Mostrador 1: Faturamento Bruto */}
        <GlassCard
          variant="thick"
          className="group relative flex flex-col justify-between p-5 rounded-2xl border border-cyan-500/25 bg-gradient-to-b from-cyan-950/20 via-card/90 to-card shadow-[0_8px_30px_rgba(0,0,0,0.4),0_0_20px_rgba(34,211,238,0.06)] hover:border-cyan-400/50 hover:-translate-y-0.5 hover:shadow-[0_12px_36px_rgba(0,0,0,0.5),0_0_28px_rgba(34,211,238,0.14)] transition-all duration-300"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="flex size-8 items-center justify-center rounded-xl bg-cyan-500/15 text-brand-cyan shadow-[0_0_12px_rgba(34,211,238,0.25)]">
                <DollarSign className="size-4" />
              </span>
              <span
                data-tooltip="Faturamento total gerado pelas vendas aprovadas no período selecionado."
                className="text-xs font-semibold uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1 cursor-help hover:text-foreground transition-colors"
              >
                Faturamento
              </span>
            </div>
            <div
              data-tooltip="Comparação percentual de faturamento com o período imediatamente anterior."
              className="cursor-help"
            >
              <VariationBadge current={revCents} previous={prevRevCents} />
            </div>
          </div>

          <div className="my-3 flex items-baseline justify-between gap-2">
            <div className="font-mono text-2xl font-bold tracking-tight text-foreground sm:text-3xl" data-sensitive>
              <CountUp
                value={revCents}
                format={(v) => money(Math.round(v), cur.mainCur)}
              />
            </div>
            <div
              className="shrink-0 cursor-help"
              data-tooltip="Curva temporal de evolução do faturamento ao longo do período."
            >
              <MiniSparkline data={revSeries} color="#22d3ee" height={34} />
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-border/40 pt-2.5 text-xs text-muted-foreground">
            <span
              data-tooltip="Total de vendas aprovadas e Ticket Médio (valor médio pago por cliente)."
              className="cursor-help"
            >
              <strong className="font-mono text-foreground font-semibold">{cur.sales}</strong> venda{cur.sales === 1 ? '' : 's'} · Médio <strong className="font-mono text-foreground font-semibold">{cur.sales > 0 ? fmtAdsMoney(aov, cur.mainCur) : '—'}</strong>
            </span>
            {otherRev.length > 0 && (
              <span
                data-tooltip={`Vendas em outras moedas: ${otherRev.map(([code]) => code).join(', ')}`}
                className="text-[10px] text-brand-cyan font-medium cursor-help"
              >
                +{otherRev.length} moeda{otherRev.length === 1 ? '' : 's'}
              </span>
            )}
          </div>
        </GlassCard>

        {/* Mostrador 2: Após anúncios Real */}
        <GlassCard
          variant="thick"
          className="group relative flex flex-col justify-between p-5 rounded-2xl border border-emerald-500/25 bg-gradient-to-b from-emerald-950/20 via-card/90 to-card shadow-[0_8px_30px_rgba(0,0,0,0.4),0_0_20px_rgba(52,211,153,0.06)] hover:border-emerald-400/50 hover:-translate-y-0.5 hover:shadow-[0_12px_36px_rgba(0,0,0,0.5),0_0_28px_rgba(52,211,153,0.14)] transition-all duration-300"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="flex size-8 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.25)]">
                <Wallet className="size-4" />
              </span>
              <span
                data-tooltip="Receita atribuída aos anúncios menos o investimento. Não inclui taxas, impostos ou outros custos."
                className="text-xs font-semibold uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1 cursor-help hover:text-foreground transition-colors"
              >
                Após anúncios
              </span>
            </div>
            {profitMargin !== null && (
              <span
                data-tooltip="Percentual da receita atribuída que resta após o gasto com anúncios, antes de outros custos."
                className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-bold cursor-help ${
                  profitMargin >= 0
                    ? 'bg-emerald-500/15 text-emerald-400'
                    : 'bg-rose-500/15 text-rose-400'
                }`}
                data-sensitive
              >
                {profitMargin >= 0 ? '+' : ''}
                {profitMargin.toFixed(1).replace('.', ',')}% margem
              </span>
            )}
          </div>

          <div className="my-3">
            <div
              className={`font-mono text-2xl font-bold tracking-tight sm:text-3xl ${
                estimatedProfit !== null
                  ? estimatedProfit >= 0
                    ? 'text-emerald-400'
                    : 'text-rose-400'
                  : 'text-foreground'
              }`}
              data-sensitive
            >
              {estimatedProfit !== null ? fmtAdsMoney(estimatedProfit, roas?.currency || cur.mainCur) : '—'}
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-border/40 pt-2.5 text-xs text-muted-foreground">
            <span
              data-tooltip="Gasto total consumido pelas campanhas no TikTok Ads no período."
              className="cursor-help"
            >
              Anúncios: <strong className="font-mono text-foreground font-semibold">{roas ? fmtAdsMoney(roas.spend, roas.currency || cur.mainCur) : '—'}</strong>
            </span>
            {spendSharePct !== null && (
              <span
                data-tooltip="Percentual da receita comprometido com investimento em tráfego."
                className="text-[11px] font-medium text-foreground/80 cursor-help"
              >
                {`${spendSharePct.toFixed(0)}% receita`}
              </span>
            )}
          </div>
        </GlassCard>

        {/* Mostrador 3: ROAS & Retorno de Mídia */}
        <GlassCard
          variant="thick"
          className="group relative flex flex-col justify-between p-5 rounded-2xl border border-rose-500/25 bg-gradient-to-b from-rose-950/20 via-card/90 to-card shadow-[0_8px_30px_rgba(0,0,0,0.4),0_0_20px_rgba(244,63,94,0.06)] hover:border-rose-400/50 hover:-translate-y-0.5 hover:shadow-[0_12px_36px_rgba(0,0,0,0.5),0_0_28px_rgba(244,63,94,0.14)] transition-all duration-300"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="flex size-8 items-center justify-center rounded-xl bg-rose-500/15 text-rose-400 shadow-[0_0_12px_rgba(244,63,94,0.25)]">
                <Flame className="size-4" />
              </span>
              <span
                data-tooltip="ROAS (Return on Ad Spend): Multiplicador financeiro. Ex: 2,50x significa R$ 2,50 faturados para cada R$ 1,00 gasto em anúncios."
                className="text-xs font-semibold uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1 cursor-help hover:text-foreground transition-colors"
              >
                Retorno (ROAS)
              </span>
            </div>
          </div>

          <div className="my-3">
            <div className="font-mono text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              {roas?.roas !== null && roas?.roas !== undefined
                ? `${roas.roas.toFixed(2).replace('.', ',')}x`
                : spendVal > 0
                ? '0,00x'
                : '—'}
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-border/40 pt-2.5 text-xs text-muted-foreground">
            <span
              data-tooltip="CPA (Custo por Aquisição): Valor médio de anúncios no TikTok gasto para gerar cada venda aprovada."
              className="cursor-help"
            >
              Custo por venda: <strong className="font-mono text-foreground font-semibold">{cpa !== null ? fmtAdsMoney(cpa, roas?.currency || cur.mainCur) : '—'}</strong>
            </span>
            <Link
              href="/ads/tiktok"
              data-tooltip="Gerenciar campanhas e lances no TikTok Ads."
              className="text-[11px] font-medium text-brand-cyan hover:underline inline-flex items-center gap-0.5"
            >
              Anúncios <ArrowUpRight className="size-3" />
            </Link>
          </div>
        </GlassCard>

        {/* Mostrador 4: Conversão do Funil */}
        <GlassCard
          variant="thick"
          className="group relative flex flex-col justify-between p-5 rounded-2xl border border-amber-500/25 bg-gradient-to-b from-amber-950/20 via-card/90 to-card shadow-[0_8px_30px_rgba(0,0,0,0.4),0_0_20px_rgba(245,158,11,0.06)] hover:border-amber-400/50 hover:-translate-y-0.5 hover:shadow-[0_12px_36px_rgba(0,0,0,0.5),0_0_28px_rgba(245,158,11,0.14)] transition-all duration-300"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="flex size-8 items-center justify-center rounded-xl bg-amber-500/15 text-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.25)]">
                <ShoppingBag className="size-4" />
              </span>
              <span
                data-tooltip="Taxa de conversão geral: proporção de visitantes da página que chegaram até a compra aprovada."
                className="text-xs font-semibold uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1 cursor-help hover:text-foreground transition-colors"
              >
                Conversão Geral
              </span>
            </div>
          </div>

          <div className="my-3">
            <div className="font-mono text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              {overallRate.replace('.', ',')}%
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-border/40 pt-2.5 text-xs text-muted-foreground">
            <span
              data-tooltip="Taxa de aprovação de checkout: percentual de pedidos pagos com sucesso dentre os que abriram o checkout."
              className="cursor-help"
            >
              Aprovação checkout: <strong className="font-mono text-emerald-400 font-semibold">{cur.approval.toFixed(0)}%</strong>
            </span>
            <span
              data-tooltip="Total de pedidos confirmados com pagamento aprovado pelo gateway."
              className="font-mono font-semibold text-foreground cursor-help"
            >
              {cur.purchased} {cur.purchased === 1 ? 'pedido' : 'pedidos'}
            </span>
          </div>
        </GlassCard>
      </section>

      {/* ── SEÇÃO 2: CENTRO VISUAL (GLOBO 3D + FUNIL + ATIVIDADE) ───────── */}
      <section
        aria-label="Visitantes online e funil de vendas"
        className="grid gap-4 lg:grid-cols-[1.65fr_1fr]"
      >
        {/* Globo 3D Imersivo com Pontos de Acesso Shopify Live View */}
        <GlassCard
          variant="thick"
          className="relative flex h-[360px] items-center justify-center overflow-hidden rounded-2xl border border-border bg-background p-0 sm:h-[460px] xl:h-[520px]"
        >
          <HeroGlobe
            focusCode={focusCountry}
          />
        </GlassCard>

        {/* Coluna Direita: Funil de Conversão + Feed ao Vivo */}
        <div className="flex flex-col gap-4">
          {/* Mostrador Visual de Funil (FunnelGauge) */}
          <GlassCard variant="thick" className="p-5 border-border/80 rounded-2xl bg-gradient-to-b from-card/90 to-card/60 shadow-[0_8px_30px_rgba(0,0,0,0.4)] hover:border-cyan-500/30 transition-all duration-300">
            <FunnelGauge
              visits={cur.visits}
              checkout={cur.reachedCheckout}
              payment={cur.paymentStarted}
              purchased={cur.purchased}
            />
          </GlassCard>

          {/* Atividade Recente (LiveFeed) */}
          <GlassCard variant="thick" className="flex-1 p-5 border-border/80 rounded-2xl bg-gradient-to-b from-card/90 to-card/60 shadow-[0_8px_30px_rgba(0,0,0,0.4)] hover:border-emerald-500/30 transition-all duration-300">
            <LiveFeed leads={data?.leads ?? []} />
          </GlassCard>
        </div>
      </section>

      {/* ── SEÇÃO 3: MOSTRADORES DE DESEMPENHO E SAÚDE ──────────────────── */}
      <section
        aria-label="Desempenho e conformidade"
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        {/* Campanhas em destaque */}
        <GlassCard variant="thick" className="flex flex-col gap-3.5 p-5 border-border/80">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span
                data-tooltip="Campanhas com mais compras convertidas no período selecionado."
                className="text-xs font-semibold uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1 cursor-help"
              >
                Campanhas em destaque
              </span>
              {adsConnected && tikTokCampaigns.length > 0 && cur.topCampaigns.length > 0 && (
                <div className="flex items-center rounded-lg border border-border/80 bg-secondary/40 p-0.5 text-[10px] font-medium">
                  <button
                    type="button"
                    onClick={() => setCampaignTab('tiktok')}
                    data-tooltip="Métricas oficiais lidas da API do TikTok Ads (gasto, compras e ROAS)."
                    className={`rounded-md px-2 py-0.5 transition-colors cursor-pointer ${
                      campaignTab === 'tiktok'
                        ? 'bg-brand-cyan/20 text-brand-cyan font-semibold'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    TikTok Ads
                  </button>
                  <button
                    type="button"
                    onClick={() => setCampaignTab('utm')}
                    data-tooltip="Métricas rastreadas pelo parâmetro de link utm_campaign."
                    className={`rounded-md px-2 py-0.5 transition-colors cursor-pointer ${
                      campaignTab === 'utm'
                        ? 'bg-brand-cyan/20 text-brand-cyan font-semibold'
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
              className="text-xs font-medium text-brand-cyan transition-colors hover:underline flex items-center gap-1"
            >
              Ver anúncios <ArrowUpRight className="size-3" />
            </Link>
          </div>

          {campaignTab === 'tiktok' && adsConnected && tikTokCampaigns.length > 0 ? (
            <div className="flex flex-col gap-2">
              {tikTokCampaigns.slice(0, 4).map((c, i) => (
                <div
                  key={c.id || c.name}
                  className="flex items-center justify-between gap-2 rounded-xl border border-border/60 bg-secondary/20 px-3 py-2 transition-colors hover:bg-secondary/40"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-secondary font-mono text-[10px] font-bold text-muted-foreground">
                      {i + 1}
                    </span>
                    <div className="flex min-w-0 flex-col">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-xs font-medium text-foreground">
                          {c.name}
                        </span>
                        <span
                          data-tooltip={
                            c.status === 'active' || c.status === 'ENABLE'
                              ? 'Campanha ativa veiculando anúncios.'
                              : 'Campanha pausada no TikTok.'
                          }
                          className={`inline-flex items-center rounded px-1.5 py-0.2 text-[9px] font-medium cursor-help ${
                            c.status === 'active' || c.status === 'ENABLE'
                              ? 'bg-success/15 text-success'
                              : 'bg-secondary text-muted-foreground'
                          }`}
                        >
                          {c.status === 'active' || c.status === 'ENABLE' ? 'Ativa' : 'Pausada'}
                        </span>
                      </div>
                      <span
                        data-tooltip="Valor total consumido por esta campanha no período."
                        className="text-[10px] text-muted-foreground cursor-help"
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
                        className="rounded bg-brand-cyan/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-brand-cyan cursor-help"
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
                  className="flex items-center justify-between gap-2 rounded-xl border border-border/60 bg-secondary/20 px-3 py-2 transition-colors hover:bg-secondary/40"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-secondary font-mono text-[10px] font-bold text-muted-foreground">
                      {i + 1}
                    </span>
                    <span className="truncate text-xs font-medium text-foreground">
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
                      className="font-mono text-[10px] text-muted-foreground cursor-help"
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
        <GlassCard variant="thick" className="flex flex-col gap-3.5 p-5 border-border/80">
          <div className="flex items-center justify-between">
            <span
              data-tooltip="Países com maior volume de acessos. Clique em qualquer país para centralizar o globo 3D."
              className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 cursor-help"
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
                const pct = Math.min(100, Math.max(3, (c.count / total) * 100))
                const isSelected = focusCountry === c.code

                return (
                  <button
                    key={c.code}
                    type="button"
                    onClick={() =>
                      setFocusCountry((prevVal) => (prevVal === c.code ? null : c.code))
                    }
                    data-tooltip={`Focar no globo: ${c.name || c.code} (${c.count} visitas, ${c.purchased} compras)`}
                    className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left transition-all cursor-pointer ${
                      isSelected
                        ? 'border-brand-cyan/60 bg-brand-cyan/15 shadow-[0_0_12px_rgba(37,244,238,0.2)] ring-1 ring-brand-cyan/40'
                        : 'border-border/60 bg-secondary/20 hover:border-border hover:bg-secondary/40'
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="text-base leading-none">
                        {countryFlag(c.code)}
                      </span>
                      <span className="truncate text-xs font-medium text-foreground">
                        {c.name || c.code}
                      </span>
                      {c.purchased > 0 && (
                        <span className="rounded bg-success/15 px-1.5 py-0.2 font-mono text-[9px] font-semibold text-success">
                          {c.purchased} {c.purchased === 1 ? 'venda' : 'vendas'}
                        </span>
                      )}
                    </div>

                    <div className="flex shrink-0 items-center gap-3">
                      <div className="hidden w-16 overflow-hidden rounded-full bg-secondary sm:block h-1.5">
                        <div
                          className="h-full rounded-full bg-brand-cyan"
                          style={{ width: `${pct}%` }}
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
        <GlassCard variant="thick" className="flex flex-col justify-between p-5 border-border/80">
          <div className="flex items-center justify-between">
            <span
              data-tooltip="Completude dos dados enviados ao TikTok. Consulte os pixels para ver erros de envio."
              className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 cursor-help"
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
