'use client'

import { useState } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { TrendingDown, TrendingUp } from 'lucide-react'
import { GlassCard } from '@/components/glass-card'
import { fmtCompact } from '@/lib/format'
import { money } from '@/lib/metrics'
import { cn } from '@/lib/utils'

type Metric = 'revenue' | 'sales' | 'visits'

const METRICS: { id: Metric; label: string; color: string }[] = [
  { id: 'revenue', label: 'Receita', color: '#22c55e' },
  { id: 'sales', label: 'Vendas', color: '#22c55e' },
  { id: 'visits', label: 'Leads', color: '#25f4ee' },
]

function fmtDay(day: unknown) {
  const [, m, d] = String(day ?? '').split('-')
  return d && m ? `${d}/${m}` : String(day ?? '')
}

type Row = { day: string; revenue: number; sales: number; visits: number }

/* Item 141: tooltip glass com valor + delta vs. dia anterior */
function ChartTooltip({
  active,
  payload,
  label,
  metric,
  series,
  currency,
  metricLabel,
}: {
  active?: boolean
  payload?: { value?: number | string }[]
  label?: string
  metric: Metric
  series: Row[]
  currency: string
  metricLabel: string
}) {
  if (!active || !payload?.length) return null
  const idx = series.findIndex((s) => s.day === label)
  const row = idx >= 0 ? series[idx] : null
  const val = Number(row?.[metric] ?? payload[0]?.value ?? 0)
  const prev = idx > 0 ? Number(series[idx - 1][metric] ?? 0) : null
  const delta = prev !== null && prev > 0 ? ((val - prev) / prev) * 100 : null
  const isMoney = metric === 'revenue'
  const up = delta !== null && delta >= 0

  return (
    <div className="glass glass-thick rounded-[10px] border border-brand-cyan/20 shadow-[0_0_15px_rgba(37,244,238,0.15)] px-3 py-2 text-xs backdrop-blur-xl">
      <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {fmtDay(label)}
      </p>
      <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-foreground">
        {isMoney ? money(val, currency) : val}{' '}
        <span className="text-[10px] font-normal text-muted-foreground">{metricLabel}</span>
      </p>
      {delta !== null ? (
        <p
          className={cn(
            'mt-0.5 flex items-center gap-1 font-mono text-[10px] tabular-nums',
            up ? 'text-success' : 'text-error',
          )}
        >
          {up ? <TrendingUp className="size-2.5" /> : <TrendingDown className="size-2.5" />}
          {`${up ? '+' : ''}${delta.toFixed(1).replace('.', ',')}% vs. dia anterior`}
        </p>
      ) : null}
      {/* Item 281: contexto completo do dia — vendas e leads junto do valor */}
      {row ? (
        <p className="mt-1 border-t border-border/50 pt-1 font-mono text-[10px] tabular-nums text-muted-foreground">
          {row.sales} {row.sales === 1 ? 'venda' : 'vendas'} · {row.visits}{' '}
          {row.visits === 1 ? 'lead' : 'leads'}
        </p>
      ) : null}
    </div>
  )
}

export function RevenueChart({
  series,
  currency,
  prevSeries,
}: {
  series: Row[]
  currency: string
  /* Item 272: série do período anterior — vira linha fantasma alinhada por posição */
  prevSeries?: Row[]
}) {
  const [metric, setMetric] = useState<Metric>('revenue')
  const conf = METRICS.find((m) => m.id === metric) ?? METRICS[0]
  const isMoney = metric === 'revenue'

  // Item 272: alinha o dia N do período anterior com o dia N do atual (por
  // índice, não por data) para comparar as curvas na mesma escala de tempo.
  const rows = series.map((s, i) => ({
    ...s,
    ghost: prevSeries && prevSeries[i] ? Number(prevSeries[i][metric] ?? 0) : undefined,
  }))
  const hasGhost = metric !== 'sales' && rows.some((r) => r.ghost !== undefined)

  // Item 135: melhor dia do período (maior valor da métrica ativa)
  const bestIdx = series.reduce(
    (best, s, i) => (Number(s[metric]) > Number(series[best]?.[metric] ?? -1) ? i : best),
    0,
  )

  // Item 26/139: re-dispara as animações ao trocar métrica ou período
  const chartKey = `${metric}-${series.length}-${series[0]?.day ?? ''}`

  // Item 140: labels compactos no eixo Y (1,2 mil em vez de 1.200,00 €)
  const yTick = (v: number) => (isMoney ? fmtCompact(Math.round(v / 100)) : fmtCompact(v))

  const tooltip = (
    <Tooltip
      cursor={
        metric === 'sales'
          ? { fill: 'rgba(37,244,238,0.05)' }
          : { stroke: 'rgba(37,244,238,0.35)', strokeDasharray: '4 4' }
      }
      content={
        <ChartTooltip
          metric={metric}
          series={series}
          currency={currency}
          metricLabel={conf.label}
        />
      }
    />
  )

  return (
    <GlassCard className="anim-kpi-in p-5" style={{ animationDelay: '280ms' }}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h3 className="section-head text-sm font-semibold text-foreground">Desempenho no período</h3>
          {hasGhost && (
            <span className="hidden items-center gap-1.5 text-[10px] text-faint sm:inline-flex">
              <span
                className="inline-block h-0 w-5 border-t border-dashed border-muted-foreground/60"
                aria-hidden="true"
              />
              período anterior
            </span>
          )}
        </div>
        {/* V2-66: tab ativa ganha a cor da métrica na borda + glow sutil */}
        <div className="flex gap-0.5 rounded-full bg-[var(--hover)] p-0.5" role="tablist" aria-label="Métrica do gráfico">
          {METRICS.map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={metric === m.id}
              onClick={() => setMetric(m.id)}
              className={cn(
                'rounded-full px-2.5 py-1 text-xs font-medium transition-all duration-150',
                metric === m.id
                  ? 'bg-[var(--active)] text-foreground'
                  : 'text-muted-foreground hover:text-sub',
              )}
              style={
                metric === m.id
                  ? { boxShadow: `inset 0 0 0 1px ${m.color}55, 0 0 10px ${m.color}22` }
                  : undefined
              }
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {series.length === 0 ? (
        <div className="flex h-52 items-center justify-center text-sm text-muted-foreground md:h-72">
          Sem dados no período selecionado
        </div>
      ) : (
        /* Item 170: altura adaptativa — 208px mobile, 288px desktop */
        <div className="h-52 md:h-72" key={chartKey}>
          <ResponsiveContainer width="100%" height="100%">
            {metric === 'sales' ? (
              <BarChart data={series} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
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
                  width={36}
                  tickFormatter={yTick}
                  allowDecimals={false}
                />
                {tooltip}
                <Bar dataKey="sales" name="Vendas" fill={conf.color} radius={[3, 3, 0, 0]} />
              </BarChart>
            ) : (
              <AreaChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                <defs>
                  {/* Item 24: gradiente duplo — cor da métrica no topo, ciano fraco no meio, transparente */}
                  <linearGradient id={`grad-${metric}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={conf.color} stopOpacity={0.6} />
                    <stop offset="55%" stopColor="#25f4ee" stopOpacity={0.15} />
                    <stop offset="100%" stopColor="#25f4ee" stopOpacity={0} />
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
                  tickFormatter={yTick}
                  allowDecimals={false}
                />
                {tooltip}
                {/* Item 272: curva fantasma do período anterior — tracejada,
                    sem preenchimento, atrás da curva principal */}
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
                  fill={`url(#grad-${metric})`}
                  animationDuration={700}
                  /* Item 24: linha com drop-shadow neon */
                  style={{ filter: `drop-shadow(0 0 6px ${conf.color}66)` }}
                  /* Item 135: anel dourado no melhor dia do período */
                  dot={(props: { cx?: number; cy?: number; index?: number }) => {
                    const { cx, cy, index } = props
                    if (index !== bestIdx || cx === undefined || cy === undefined)
                      return <g key={`d-${index}`} />
                    return (
                      <g key={`best-${index}`}>
                        <circle cx={cx} cy={cy} r={6} fill="none" stroke="#fbbf24" strokeWidth={1.5} opacity={0.9} />
                        <circle cx={cx} cy={cy} r={2.5} fill={conf.color} />
                      </g>
                    )
                  }}
                  activeDot={{ r: 4, strokeWidth: 0, fill: conf.color }}
                />
              </AreaChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
    </GlassCard>
  )
}
