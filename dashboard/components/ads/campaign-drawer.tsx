'use client'

// Drawer de detalhe da campanha TikTok Ads — série temporal com recharts,
// toggle de métrica (gasto/conversões/CTR), seletor de período e comparação
// com o período anterior (curva fantasma + deltas nos KPIs), no mesmo padrão
// visual do RevenueChart da Visão geral.

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { X, TrendingDown, TrendingUp, History } from 'lucide-react'
import { useAdsAudit, useAdsCampaignAnalytics } from '@/lib/api'
import { fmtCompact } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/skeleton'
import { StatusPill } from '@/components/ads/campaign-tree'
import type { AdsMetrics, AdsTreeCampaign } from '@/lib/types'
import { toLocalIsoDate } from './tiktok-contracts'

type Metric = 'spend' | 'conversions' | 'ctr'

const METRICS: { id: Metric; label: string; color: string }[] = [
  { id: 'spend', label: 'Gasto', color: '#25f4ee' },
  { id: 'conversions', label: 'Conversões', color: '#22c55e' },
  { id: 'ctr', label: 'CTR', color: '#fbbf24' },
]

const RANGES = [
  { days: 7, label: '7d' },
  { days: 14, label: '14d' },
  { days: 30, label: '30d' },
] as const

function rangeDates(days: number, offsetPeriods = 0) {
  const to = new Date(Date.now() - offsetPeriods * days * 864e5)
  const from = new Date(to.getTime() - (days - 1) * 864e5)
  return { fromDate: toLocalIsoDate(from), toDate: toLocalIsoDate(to) }
}

function fmtDay(day: unknown) {
  const [, m, d] = String(day ?? '').split('-')
  return d && m ? `${d}/${m}` : String(day ?? '')
}

function fmtMetric(metric: Metric, v: number, currency: string) {
  if (metric === 'spend') return `${v.toFixed(2).replace('.', ',')} ${currency}`
  if (metric === 'ctr') return `${v.toFixed(2).replace('.', ',')}%`
  return fmtCompact(v)
}

type Row = { day: string; spend: number; conversions: number; ctr: number; ghost?: number }

function DrawerTooltip({
  active,
  payload,
  label,
  metric,
  currency,
}: {
  active?: boolean
  payload?: { value?: number | string }[]
  label?: string
  metric: Metric
  currency: string
}) {
  if (!active || !payload?.length) return null
  const val = Number(payload[0]?.value ?? 0)
  return (
    <div className="glass glass-thick rounded-[10px] px-3 py-2 text-xs">
      <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{fmtDay(label)}</p>
      <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-foreground">
        {fmtMetric(metric, val, currency)}
      </p>
    </div>
  )
}

/* KPI com delta vs. período anterior */
function DeltaKpi({
  label,
  value,
  prev,
  invert,
}: {
  label: string
  value: string
  prev: number | null // variação % vs. período anterior (null = sem base)
  invert?: boolean // true quando MENOR é melhor (ex.: CPA)
}) {
  const good = prev !== null && (invert ? prev <= 0 : prev >= 0)
  return (
    <div className="rounded-[10px] bg-[var(--hover)] px-3 py-2.5">
      <p className="label-mono text-[10px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-mono text-base font-semibold tabular-nums text-foreground">{value}</p>
      {prev !== null ? (
        <p
          className={cn(
            'mt-0.5 flex items-center gap-1 font-mono text-[10px] tabular-nums',
            good ? 'text-success' : 'text-error',
          )}
        >
          {prev >= 0 ? <TrendingUp className="size-2.5" aria-hidden /> : <TrendingDown className="size-2.5" aria-hidden />}
          {`${prev >= 0 ? '+' : ''}${prev.toFixed(1).replace('.', ',')}%`}
          <span className="sr-only">em relação ao período anterior</span>
        </p>
      ) : (
        <p className="mt-0.5 text-[10px] text-faint">sem base anterior</p>
      )}
    </div>
  )
}

function sumMetrics(daily: ({ date?: string } & AdsMetrics)[] | undefined) {
  const out = { spend: 0, conversions: 0, clicks: 0, impressions: 0 }
  ;(daily || []).forEach((d) => {
    out.spend += Number(d.spend) || 0
    out.conversions += Number(d.conversions) || 0
    out.clicks += Number(d.clicks) || 0
    out.impressions += Number(d.impressions) || 0
  })
  return out
}

function pctDelta(cur: number, prev: number): number | null {
  if (!prev) return null
  return ((cur - prev) / prev) * 100
}

export function CampaignDrawer({
  campaign,
  advertiserId,
  currency,
  onClose,
  attribution,
}: {
  campaign: AdsTreeCampaign | null
  advertiserId: string
  currency: string
  onClose: () => void
  // vendas reais desta campanha (leads convertidos com utm_campaign = ID)
  attribution?: { revenueCents: number; sales: number }
}) {
  const [metric, setMetric] = useState<Metric>('spend')
  const [days, setDays] = useState<number>(7)
  const panelRef = useRef<HTMLDivElement>(null)

  const id = campaign?.platformCampaignId ?? null
  const cur = useMemo(() => rangeDates(days), [days])
  const prev = useMemo(() => rangeDates(days, 1), [days])

  const { data, isLoading, error } = useAdsCampaignAnalytics(id, advertiserId, cur)
  // comparação: mesmo tamanho de janela, imediatamente anterior
  const { data: prevData } = useAdsCampaignAnalytics(id, advertiserId, prev)
  const { data: audit } = useAdsAudit(Boolean(id))

  useEffect(() => {
    if (!id) return
    panelRef.current?.focus()
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [id, onClose])

  if (!campaign || !id) return null

  const conf = METRICS.find((m) => m.id === metric) ?? METRICS[0]
  const ccy = campaign.currency || currency

  // séries alinhadas por índice (dia N atual × dia N anterior)
  const daily = data?.daily || []
  const prevDaily = prevData?.daily || []
  const rows: Row[] = daily.map((d, i) => {
    const clicks = Number(d.clicks) || 0
    const imp = Number(d.impressions) || 0
    const p = prevDaily[i]
    const pClicks = Number(p?.clicks) || 0
    const pImp = Number(p?.impressions) || 0
    const ghost =
      p === undefined
        ? undefined
        : metric === 'spend'
          ? Number(p.spend) || 0
          : metric === 'conversions'
            ? Number(p.conversions) || 0
            : pImp > 0
              ? (pClicks / pImp) * 100
              : 0
    return {
      day: String(d.date || '').slice(0, 10),
      spend: +(Number(d.spend) || 0).toFixed(2),
      conversions: Number(d.conversions) || 0,
      ctr: imp > 0 ? +((clicks / imp) * 100).toFixed(2) : 0,
      ghost,
    }
  })
  const hasGhost = rows.some((r) => r.ghost !== undefined)

  // KPIs do período + delta vs. anterior
  const tot = sumMetrics(daily)
  const pTot = sumMetrics(prevDaily)
  const ctrCur = tot.impressions > 0 ? (tot.clicks / tot.impressions) * 100 : 0
  const ctrPrev = pTot.impressions > 0 ? (pTot.clicks / pTot.impressions) * 100 : 0
  const cpaCur = tot.conversions > 0 ? tot.spend / tot.conversions : 0
  const cpaPrev = pTot.conversions > 0 ? pTot.spend / pTot.conversions : 0

  const chartKey = `${metric}-${days}-${id}`
  const timeline = (audit?.events || []).filter((event) => {
    if (event.target_id === id) return true
    const meta = event.metadata || {}
    return String(meta.campaignId || meta.winnerId || meta.donorId || '') === id
  }).slice(0, 20)

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Detalhe da campanha">
      <button
        type="button"
        aria-label="Fechar painel"
        onClick={onClose}
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        className="anim-drawer-in absolute inset-y-0 right-0 flex w-full max-w-lg flex-col overflow-y-auto border-l border-border/60 bg-card shadow-2xl outline-none"
      >
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border/50 bg-card/95 px-5 py-4 backdrop-blur">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-sm font-semibold text-foreground">
                {campaign.campaignName || 'Campanha sem nome'}
              </h2>
              <StatusPill status={campaign.status} />
            </div>
            <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{id}</p>
          </div>
          <button type="button" onClick={onClose} className="btn-ghost !p-2" aria-label="Fechar">
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>

        <div className="flex flex-col gap-4 px-5 py-4">
          {/* período + métrica */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-0.5 rounded-full bg-[var(--hover)] p-0.5" role="tablist" aria-label="Período">
              {RANGES.map((r) => (
                <button
                  key={r.days}
                  type="button"
                  role="tab"
                  aria-selected={days === r.days}
                  onClick={() => setDays(r.days)}
                  className={cn(
                    'rounded-full px-2.5 py-1 text-xs font-medium transition-colors duration-150',
                    days === r.days ? 'bg-[var(--active)] text-foreground' : 'text-muted-foreground hover:text-sub',
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <div className="flex gap-0.5 rounded-full bg-[var(--hover)] p-0.5" role="tablist" aria-label="Métrica">
              {METRICS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="tab"
                  aria-selected={metric === m.id}
                  onClick={() => setMetric(m.id)}
                  className={cn(
                    'rounded-full px-2.5 py-1 text-xs font-medium transition-colors duration-150',
                    metric === m.id ? 'bg-[var(--active)] text-foreground' : 'text-muted-foreground hover:text-sub',
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {isLoading && !data ? (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-2">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-[72px] rounded-[10px]" />
                ))}
              </div>
              <Skeleton className="h-56 rounded-[10px]" />
            </div>
          ) : error ? (
            <p className="text-sm text-warning">
              {error instanceof Error ? error.message : 'Erro ao carregar as métricas.'}
            </p>
          ) : (
            <>
              {/* Vendas REAIS atribuídas (gateways → utm_campaign) */}
              {attribution && attribution.sales > 0 && (
                <div className="flex items-center justify-between gap-3 rounded-[10px] border border-success/25 bg-success/10 px-4 py-3">
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-wide text-success">
                      Vendas reais atribuídas
                    </p>
                    <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
                      {attribution.sales} venda{attribution.sales === 1 ? '' : 's'} ·{' '}
                      {(attribution.revenueCents / 100).toFixed(2).replace('.', ',')} {ccy}
                    </p>
                  </div>
                  {tot.spend > 0 && (
                    <div className="text-right">
                      <p className="text-[11px] text-muted-foreground">ROAS real</p>
                      <p className="text-lg font-bold tabular-nums text-success">
                        {(attribution.revenueCents / 100 / tot.spend).toFixed(2).replace('.', ',')}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* KPIs com delta vs. período anterior */}
              <div className="grid grid-cols-2 gap-2">
                <DeltaKpi
                  label="Gasto"
                  value={`${tot.spend.toFixed(2).replace('.', ',')} ${ccy}`}
                  prev={pctDelta(tot.spend, pTot.spend)}
                  invert
                />
                <DeltaKpi
                  label="Conversões"
                  value={fmtCompact(tot.conversions)}
                  prev={pctDelta(tot.conversions, pTot.conversions)}
                />
                <DeltaKpi
                  label="CTR"
                  value={`${ctrCur.toFixed(2).replace('.', ',')}%`}
                  prev={pctDelta(ctrCur, ctrPrev)}
                />
                <DeltaKpi
                  label="CPA"
                  value={cpaCur > 0 ? `${cpaCur.toFixed(2).replace('.', ',')} ${ccy}` : '—'}
                  prev={cpaCur > 0 && cpaPrev > 0 ? pctDelta(cpaCur, cpaPrev) : null}
                  invert
                />
              </div>

              {/* gráfico com curva fantasma do período anterior */}
              {rows.length === 0 ? (
                <div className="flex h-56 items-center justify-center rounded-[10px] bg-[var(--hover)] text-sm text-muted-foreground">
                  {data?.backfillPending
                    ? 'Coletando métricas do TikTok… volte em alguns minutos.'
                    : 'Sem dados diários no período.'}
                </div>
              ) : (
                <div className="h-56" key={chartKey}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                      <defs>
                        <linearGradient id={`ads-grad-${metric}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={conf.color} stopOpacity={0.3} />
                          <stop offset="100%" stopColor={conf.color} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
                      <XAxis
                        dataKey="day"
                        tickFormatter={fmtDay}
                        tick={{ fill: '#a1a1aa', fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fill: '#a1a1aa', fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                        width={44}
                        tickFormatter={(v: number) => fmtCompact(v)}
                      />
                      <Tooltip
                        cursor={{ stroke: 'rgba(37,244,238,0.35)', strokeDasharray: '4 4' }}
                        content={<DrawerTooltip metric={metric} currency={ccy} />}
                      />
                      {hasGhost && (
                        <Area
                          type="monotone"
                          dataKey="ghost"
                          name="Período anterior"
                          stroke="rgba(161,161,170,0.45)"
                          strokeWidth={1.5}
                          strokeDasharray="5 4"
                          fill="none"
                          dot={false}
                          activeDot={false}
                          animationDuration={500}
                        />
                      )}
                      <Area
                        type="monotone"
                        dataKey={metric}
                        name={conf.label}
                        stroke={conf.color}
                        strokeWidth={2}
                        fill={`url(#ads-grad-${metric})`}
                        animationDuration={700}
                        style={{ filter: `drop-shadow(0 0 6px ${conf.color}66)` }}
                        activeDot={{ r: 4, strokeWidth: 0, fill: conf.color }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
              {hasGhost && (
                <p className="flex items-center gap-1.5 text-[10px] text-faint">
                  <span
                    className="inline-block h-0 w-5 border-t border-dashed border-muted-foreground/60"
                    aria-hidden="true"
                  />
                  período anterior ({prev.fromDate} → {prev.toDate})
                </p>
              )}
            </>
          )}

          <section className="rounded-[10px] border border-border bg-secondary/15 p-4" aria-label="Linha do tempo de alterações">
            <div className="mb-3 flex items-center gap-2">
              <History className="size-4 text-primary" aria-hidden="true" />
              <h3 className="text-xs font-semibold text-foreground">Time Machine</h3>
              <span className="text-[10px] text-muted-foreground">histórico auditável</span>
            </div>
            {timeline.length ? (
              <ol className="relative ml-1 border-l border-border pl-4">
                {timeline.map((event) => (
                  <li key={event.id} className="relative pb-4 last:pb-0">
                    <span className="absolute -left-[1.22rem] top-1 size-2 rounded-full bg-primary shadow-[0_0_8px_rgba(37,244,238,.55)]" />
                    <p className="text-[11px] font-medium text-foreground">{event.reason || event.action.replace(/[._]/g, ' ')}</p>
                    <p className="mt-0.5 font-mono text-[9px] text-muted-foreground">
                      {new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(event.created_at))}
                      {' · '}{event.action}
                    </p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-[11px] text-muted-foreground">Ainda não há alterações registradas para esta campanha.</p>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
