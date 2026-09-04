'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useOncePerSession } from '@/lib/motion'
import { useStats, useEmqTrend, useAdsStatus, useAdsRoas } from '@/lib/api'
import { useAfterFirstPaint } from '@/lib/use-after-first-paint'
import { aggregate, money, periodStart, prevWindow } from '@/lib/metrics'
import { adsDateRange } from '@/lib/ads-time'
import { countryFlag } from '@/lib/format'
import { countryName } from '@/lib/countries'
import type { Period } from '@/lib/types'
import { CountUp } from '@/components/count-up'
import { Skeleton } from '@/components/skeleton'
import { ExportSummaryButton } from './export-summary'
import { TvModeButton } from './tv-mode'
import { PeriodPicker } from './period-picker'
import { HealthDot } from './health-dot'
import { HeroGlobe } from './hero-globe'
import { LiveFeed } from './live-feed'
import { DataConfidence } from './data-confidence'
import { OnboardingChecklist } from './onboarding-checklist'
import { ErrorState } from '@/components/error-state'
import { AutopilotCard } from '@/components/ads/autopilot-card'

// Componentes do Feed Copiloto
import { NeedsYouInbox } from '@/components/ads/needs-you-inbox'
import { RejectionInbox } from '@/components/ads/rejection-inbox'
import { BriefingCard } from '@/components/ads/briefing-card'
import { useAdsRules, useAdsSafetyPolicy } from '@/lib/api'

// ── Helpers de formatação ──────────────────────────────────────────────────
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

const PERIOD_LABEL: Record<Period, string> = {
  today: 'hoje',
  '7d': '7 dias',
  '30d': '30 dias',
  all: 'tudo',
}

function initialPeriod(): Period {
  if (typeof window === 'undefined') return 'today'
  const fromUrl = new URLSearchParams(window.location.search).get('p') as Period | null
  if (fromUrl && PERIODS.includes(fromUrl)) return fromUrl
  return 'today'
}

// ── Mini Sparkline SVG (inline, sem dependência) ───────────────────────────
function MiniSparkline({ data, color = 'var(--accent)', height = 32 }: { data: number[]; color?: string; height?: number }) {
  if (!data.length) return null
  const width = 80
  const max = Math.max(...data, 1)
  const min = Math.min(...data, 0)
  const range = max - min || 1
  const points = data.map((v, i) => {
    const x = (i / Math.max(data.length - 1, 1)) * width
    const y = height - ((v - min) / range) * (height - 4) - 2
    return `${x},${y}`
  }).join(' ')

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="opacity-40" aria-hidden="true">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// ── Badge de variação (↑12% / ↓5%) ────────────────────────────────────────
function VariationBadge({ current, previous }: { current: number; previous: number }) {
  if (previous === 0 && current === 0) return null
  if (previous === 0) return (
    <span className="inline-flex items-center gap-0.5 rounded-full bg-success/15 px-1.5 py-0.5 text-[10px] font-bold text-success">
      novo
    </span>
  )
  const pct = ((current - previous) / previous) * 100
  const isUp = pct >= 0
  const display = Math.abs(pct) > 999 ? '999+' : Math.abs(pct).toFixed(0)
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${
      isUp ? 'bg-success/15 text-success' : 'bg-error/15 text-error'
    }`}>
      {isUp ? '↑' : '↓'} {display}%
    </span>
  )
}

// ── KPI Card glassmorphism ─────────────────────────────────────────────────
function KpiCard({
  icon,
  label,
  value,
  sub,
  sparkData,
  sparkColor,
  variation,
  sensitive,
  dim,
}: {
  icon: React.ReactNode
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  sparkData?: number[]
  sparkColor?: string
  variation?: { current: number; previous: number }
  sensitive?: boolean
  dim?: boolean
}) {
  return (
    <div className="glass group relative flex flex-col gap-2 overflow-hidden rounded-2xl border border-white/[0.06] p-4 transition-all duration-300 hover:border-white/[0.12] hover:shadow-lg">
      {sparkData && sparkData.length > 1 && (
        <div className="absolute bottom-2 right-3 transition-opacity duration-300 group-hover:opacity-70">
          <MiniSparkline data={sparkData} color={sparkColor} height={36} />
        </div>
      )}
      <div className="flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-lg bg-white/[0.06]" aria-hidden="true">
          {icon}
        </span>
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/50">{label}</span>
        {variation && <VariationBadge current={variation.current} previous={variation.previous} />}
      </div>
      <p
        className={`relative z-10 whitespace-nowrap font-mono text-2xl font-bold leading-none tabular-nums sm:text-3xl ${
          dim ? 'text-muted-foreground' : 'text-foreground'
        }`}
        {...(sensitive ? { 'data-sensitive': true } : {})}
      >
        {value}
      </p>
      {sub && (
        <p className="relative z-10 text-[11px] font-medium text-white/40" {...(sensitive ? { 'data-sensitive': true } : {})}>
          {sub}
        </p>
      )}
    </div>
  )
}

// ── Quick Funnel (mini horizontal) ─────────────────────────────────────────
function QuickFunnel({ visits, checkout, payment, purchased }: {
  visits: number; checkout: number; payment: number; purchased: number
}) {
  const steps = [
    { label: 'Visitas', value: visits, color: 'bg-blue' },
    { label: 'Checkout', value: checkout, color: 'bg-warning' },
    { label: 'Pagamento', value: payment, color: 'bg-[color:var(--accent)]' },
    { label: 'Compra', value: purchased, color: 'bg-success' },
  ]
  const maxVal = Math.max(visits, 1)

  return (
    <div className="glass flex flex-col gap-3 rounded-2xl border border-white/[0.06] p-4">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/50">Funil Rápido</p>
      <div className="flex flex-col gap-2.5">
        {steps.map((step, i) => {
          const pct = (step.value / maxVal) * 100
          const convRate = i > 0 && steps[i - 1].value > 0
            ? ((step.value / steps[i - 1].value) * 100).toFixed(1) + '%'
            : null
          return (
            <div key={step.label} className="flex items-center gap-3">
              <span className="w-16 shrink-0 text-[11px] font-medium text-white/60">{step.label}</span>
              <div className="relative h-5 flex-1 overflow-hidden rounded-full bg-white/[0.04]">
                <div
                  className={`h-full rounded-full ${step.color} transition-all duration-700 ease-out`}
                  style={{ width: `${Math.max(pct, 2)}%`, opacity: 0.7 }}
                />
              </div>
              <span className="w-10 shrink-0 text-right font-mono text-[11px] font-bold tabular-nums text-foreground">
                {step.value}
              </span>
              {convRate && (
                <span className="w-10 shrink-0 text-right text-[10px] font-medium tabular-nums text-white/40">
                  {convRate}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Top Campaigns card ─────────────────────────────────────────────────────
function TopCampaignsCard({ campaigns }: {
  campaigns: { name: string; leads: number; purchased: number; conv: number }[]
}) {
  const top = campaigns.slice(0, 4)
  return (
    <div className="glass flex flex-col gap-3 rounded-2xl border border-white/[0.06] p-4">
      <div className="flex items-center justify-between">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/50">Top Campanhas</p>
        <Link href="/ads/tiktok" className="text-[10px] font-medium text-white/30 transition-colors hover:text-foreground">
          Ver todas →
        </Link>
      </div>
      {top.length === 0 ? (
        <p className="py-3 text-center text-xs text-muted-foreground">Nenhuma campanha rastreada.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {top.map((c, i) => (
            <div key={c.name} className="flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-white/[0.04]">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-[10px] font-bold text-white/40">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{c.name}</span>
              <span className="shrink-0 font-mono text-[11px] font-bold tabular-nums text-success">
                {c.purchased}
              </span>
              <span className="shrink-0 text-[10px] tabular-nums text-white/40">
                {c.conv.toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Geo Distribution card ──────────────────────────────────────────────────
function GeoCard({ countries }: {
  countries: { code: string; name: string; count: number; purchased: number }[]
}) {
  const top = countries.slice(0, 5)
  const total = countries.reduce((s, c) => s + c.count, 0) || 1
  return (
    <div className="glass flex flex-col gap-3 rounded-2xl border border-white/[0.06] p-4">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/50">Distribuição Geográfica</p>
      {top.length === 0 ? (
        <p className="py-3 text-center text-xs text-muted-foreground">Aguardando visitantes.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {top.map((c) => {
            const pct = (c.count / total) * 100
            return (
              <div key={c.code} className="flex items-center gap-2.5">
                <span className="text-base leading-none drop-shadow-md" aria-hidden="true">{countryFlag(c.code)}</span>
                <span className="w-14 shrink-0 truncate text-[11px] font-medium text-foreground">{c.code}</span>
                <div className="relative h-3.5 flex-1 overflow-hidden rounded-full bg-white/[0.04]">
                  <div
                    className="h-full rounded-full bg-[color:var(--accent)] transition-all duration-500"
                    style={{ width: `${Math.max(pct, 3)}%`, opacity: 0.6 }}
                  />
                </div>
                <span className="w-8 shrink-0 text-right font-mono text-[10px] font-bold tabular-nums text-foreground">
                  {c.count}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── EMQ Health card ────────────────────────────────────────────────────────
function EmqHealthCard({ emqSummary }: {
  emqSummary: { recent: number; dir: 'up' | 'down' | 'flat'; alerts: number } | null
}) {
  const score = emqSummary?.recent ?? 0
  const max = 10
  const pct = (score / max) * 100
  const color = score >= 7 ? 'var(--success)' : score >= 4 ? 'var(--warning)' : 'var(--error)'
  const label = score >= 7 ? 'Excelente' : score >= 4 ? 'Regular' : 'Baixa'

  return (
    <Link href="/conversions?tab=pixels" className="glass flex flex-col gap-3 rounded-2xl border border-white/[0.06] p-4 transition-all hover:border-white/[0.12]">
      <div className="flex items-center justify-between">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/50">Saúde do Pixel (EMQ)</p>
        {emqSummary && emqSummary.alerts > 0 && (
          <span className="rounded-full bg-error/15 px-2 py-0.5 text-[10px] font-bold text-error">
            {emqSummary.alerts} alerta{emqSummary.alerts === 1 ? '' : 's'}
          </span>
        )}
      </div>
      {!emqSummary ? (
        <p className="py-3 text-center text-xs text-muted-foreground">Sem dados de EMQ.</p>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <div className="relative h-4 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${pct}%`, backgroundColor: color }}
              />
            </div>
            <span className="font-mono text-lg font-bold tabular-nums" style={{ color }}>
              {score.toFixed(1)}
            </span>
          </div>
          <div className="flex items-center justify-between text-[10px]">
            <span className="font-medium" style={{ color }}>{label}</span>
            <span className="text-white/40">
              {emqSummary.dir === 'up' ? '↑ Subindo' : emqSummary.dir === 'down' ? '↓ Caindo' : '→ Estável'}
            </span>
          </div>
        </div>
      )}
    </Link>
  )
}


// ══════════════════════════════════════════════════════════════════════════════
//  COMPONENTE PRINCIPAL — CONTROL ROOM
// ══════════════════════════════════════════════════════════════════════════════
export function OverviewView() {
  const [period, setPeriodState] = useState<Period>(initialPeriod)
  const { data, error, isLoading, isValidating, mutate } = useStats()
  const firstEnter = useOncePerSession('overview-enter')

  const afterFirstPaint = useAfterFirstPaint()
  const { data: adsStatus } = useAdsStatus(afterFirstPaint)
  const adAccountId = adsStatus?.advertiserId || ''
  const adsConnected = Boolean(adsStatus?.enabled && adsStatus?.connected && adAccountId)
  const adsRange = useMemo(() => periodToAdsRange(period, adsStatus?.timeZone), [period, adsStatus?.timeZone])
  const { data: roas } = useAdsRoas(adsConnected, adAccountId, adsRange)

  // Feed Copiloto
  const { data: safety } = useAdsSafetyPolicy(adsConnected)
  const { data: rulesData } = useAdsRules(adsConnected, adAccountId)
  const autoAppealSmartPlus = rulesData?.alerts?.autoAppealSmartPlus === true
  const canAutoAppeal = rulesData?.autonomy === 'auto'

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
    } catch { /* modo privado */ }
  }

  // Métricas do período ATUAL e ANTERIOR (para badges de variação)
  const { cur, prev } = useMemo(() => {
    if (!data) return { cur: null, prev: null }
    const curMetrics = aggregate(data, periodStart(period))
    const pw = prevWindow(period)
    const prevMetrics = pw ? aggregate(data, pw.prevFrom, pw.prevTo) : null
    return { cur: curMetrics, prev: prevMetrics }
  }, [data, period])

  // Países dos leads de hoje (para o globo)
  const todayCountries = useMemo(() => {
    const t = periodStart('today')?.getTime() ?? 0
    const byCountry = new Map<string, number>()
    for (const l of data?.leads ?? []) {
      const at = new Date(l.at).getTime()
      if (!Number.isFinite(at) || at < t) continue
      if (l.country) byCountry.set(l.country, (byCountry.get(l.country) ?? 0) + 1)
    }
    return Array.from(byCountry, ([code, count]) => ({
      code,
      name: countryName(code),
      count,
      purchased: 0,
    }))
  }, [data])

  const lastLeadAt = useMemo(() => {
    let max = ''
    for (const l of data?.leads ?? []) {
      if (l.at && l.at > max) max = l.at
    }
    return max || null
  }, [data])

  // ── Error state ────────────────────────────────────────────────────────
  if (error) {
    return (
      <ErrorState
        title="Não foi possível carregar a Visão Geral"
        description="Os dados preservados não foram alterados. Tente atualizar a conexão com o servidor."
        onRetry={() => mutate()}
        retrying={isValidating}
      />
    )
  }

  // ── Loading skeleton ───────────────────────────────────────────────────
  if (isLoading || !cur) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true" aria-label="Carregando métricas">
        <div className="flex justify-end">
          <Skeleton className="h-8 w-64 rounded-full" />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="glass flex flex-col gap-3 rounded-2xl border border-white/[0.06] p-4">
              <div className="flex items-center gap-2">
                <Skeleton className="size-7 rounded-lg" />
                <Skeleton className="h-3 w-16" />
              </div>
              <Skeleton className="h-8 w-32" />
            </div>
          ))}
        </div>
        <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
          <div className="glass flex items-center justify-center rounded-2xl border border-white/[0.06] p-8">
            <Skeleton className="aspect-square w-full max-w-[340px] rounded-full" />
          </div>
          <div className="glass flex flex-col gap-3 rounded-2xl border border-white/[0.06] p-4">
            <Skeleton className="h-3 w-28" />
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center justify-between gap-4">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-3.5 w-12" />
              </div>
            ))}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="glass flex flex-col gap-3 rounded-2xl border border-white/[0.06] p-4">
              <Skeleton className="h-3 w-24" />
              {[0, 1, 2].map((j) => (
                <div key={j} className="flex items-center gap-3">
                  <Skeleton className="h-3.5 w-20" />
                  <Skeleton className="h-4 flex-1 rounded" />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    )
  }

  // ── Dados computados ───────────────────────────────────────────────────
  const revCents = cur.rev[cur.mainCur] || 0
  const prevRevCents = prev ? (prev.rev[prev.mainCur] || 0) : 0

  const currencyMismatch = Boolean(
    roas &&
      (roas.currencyMismatch ??
        (roas.roas !== null &&
          roas.currency &&
          revCents > 0 &&
          cur.mainCur !== roas.currency.toUpperCase())),
  )

  const otherRev = Object.entries(cur.rev)
    .filter(([c, v]) => c !== cur.mainCur && v > 0)
    .sort((a, b) => b[1] - a[1])

  const revSeries = cur.series.map((s) => s.revenue)
  const hasAnyData = (data?.leads?.length ?? 0) > 0 || (data?.events?.length ?? 0) > 0

  // ══════════════════════════════════════════════════════════════════════
  //  RENDER — CONTROL ROOM LAYOUT
  // ══════════════════════════════════════════════════════════════════════
  return (
    <div className={`mx-auto max-w-[1600px] flex flex-col gap-4 ${firstEnter ? 'stagger-fade' : ''}`}>
      {/* ── BARRA DE CONTROLES ──────────────────────────────────────────── */}
      <div
        className="picker-sticky flex flex-wrap items-center justify-end gap-2"
        data-tour="period"
        style={{ ['--i' as string]: 0 }}
      >
        <TvModeButton />
        <ExportSummaryButton
          period={period}
          summary={{
            revenue: revCents,
            mainCur: cur.mainCur,
            sales: cur.sales,
            visits: cur.visits,
            overall: cur.overall,
            approval: cur.approval,
            series: revSeries,
          }}
        />
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>

      {/* ── SEÇÃO 1: KPI CARDS ─────────────────────────────────────────── */}
      <section
        aria-label="KPIs principais"
        className="grid gap-3 sm:grid-cols-3"
        style={{ ['--i' as string]: 1 }}
      >
        <KpiCard
          icon={<svg className="size-4 text-[color:var(--accent)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>}
          label="Receita"
          sensitive
          dim={revCents === 0}
          value={<CountUp value={revCents} format={(v) => money(Math.round(v), cur.mainCur)} />}
          sub={otherRev.length ? '+ ' + otherRev.map(([c, v]) => money(v, c)).join(' + ') : undefined}
          sparkData={revSeries}
          sparkColor="var(--accent)"
          variation={{ current: revCents, previous: prevRevCents }}
        />

        <KpiCard
          icon={<svg className="size-4 text-[color:var(--pink)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 20h.01M7 20v-4M12 20v-8M17 20V8M22 4v16"/></svg>}
          label={period === 'all' ? 'Gasto (90 dias)' : 'Gasto'}
          sensitive
          dim={!roas}
          value={roas ? fmtAdsMoney(roas.spend, roas.currency) : '—'}
          sparkColor="var(--pink)"
        />

        <KpiCard
          icon={<svg className="size-4 text-success" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>}
          label={period === 'all' ? 'ROAS (90 dias)' : 'ROAS'}
          dim={!roas || roas.roas === null || currencyMismatch}
          value={
            currencyMismatch
              ? '—'
              : roas && roas.roas !== null
                ? roas.roas.toFixed(2).replace('.', ',')
                : '—'
          }
          sub={
            currencyMismatch
              ? `moedas diferentes (${roas?.currency} × ${cur.mainCur})`
              : undefined
          }
          sparkColor="var(--success)"
        />
      </section>

      {/* ── SEÇÃO 2: GLOBO + LIVE FEED (lado a lado) ───────────────────── */}
      <section
        aria-label="Presença global e atividade"
        className="grid gap-3 lg:grid-cols-[1fr_320px]"
        style={{ ['--i' as string]: 2 }}
      >
        <div className="glass relative flex items-center justify-center overflow-hidden rounded-2xl border border-white/[0.06]" style={{ minHeight: 340 }}>
          <HeroGlobe countries={todayCountries} lastLeadAt={lastLeadAt} />
          <div className="absolute bottom-3 left-3 flex items-center gap-3">
            <HealthDot />
            <span className="font-mono text-[11px] tabular-nums text-white/50">
              {cur.visits} visita{cur.visits === 1 ? '' : 's'} · {cur.sales} venda{cur.sales === 1 ? '' : 's'}
            </span>
          </div>
        </div>

        <div className="glass flex flex-col rounded-2xl border border-white/[0.06] p-4">
          <LiveFeed leads={data?.leads ?? []} />
        </div>
      </section>

      {/* ── SEÇÃO 3: GRADE 2x2 CONTEXTUAL ──────────────────────────────── */}
      <section
        aria-label="Métricas secundárias"
        className="grid gap-3 sm:grid-cols-2"
        style={{ ['--i' as string]: 3 }}
      >
        <QuickFunnel
          visits={cur.visits}
          checkout={cur.reachedCheckout}
          payment={cur.paymentStarted}
          purchased={cur.purchased}
        />
        <TopCampaignsCard campaigns={cur.topCampaigns} />
        <GeoCard countries={cur.countries} />
        <EmqHealthCard emqSummary={emqSummary} />
      </section>

      {/* ── SEÇÃO 4: FEED COPILOTO ─────────────────────────────────────── */}
      {adsConnected ? (
        <section
          aria-label="Feed Copiloto"
          className="mx-auto flex w-full max-w-3xl flex-col gap-3"
          style={{ ['--i' as string]: 4 }}
        >
          <NeedsYouInbox
            active={adsConnected && afterFirstPaint}
            adAccountId={adAccountId}
            onOpenOps={() => { window.location.href = '/ads/tiktok' }}
            onOpenHealth={() => { window.location.href = '/ads/tiktok' }}
            onGoAutomations={() => { window.location.href = '/ads/tiktok?tab=automation' }}
          />
          <RejectionInbox
            active={adsConnected && afterFirstPaint}
            adAccountId={adAccountId}
            autoAppeal={autoAppealSmartPlus}
            canAutoAppeal={canAutoAppeal}
            saving={false}
            onAutoAppealChange={() => {}}
          />
          <BriefingCard adAccountId={adAccountId} currency={roas?.currency || cur.mainCur} />
        </section>
      ) : null}
    </div>
  )
}
