'use client'

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { PeriodMetrics } from '@/lib/metrics'
import { money } from '@/lib/metrics'
import { fmtCompact } from '@/lib/format'

function dayLabel(day: string) {
  const [, month, date] = day.split('-')
  return date && month ? `${date}/${month}` : day
}

function RevenueActiveDot({ cx, cy }: { cx?: number; cy?: number }) {
  if (cx === undefined || cy === undefined) return <g />
  return (
    <g className="overview-revenue-active-dot" aria-hidden="true">
      <circle cx={cx} cy={cy} r={6.5} fill="rgb(37 244 238 / 0.08)" />
      <circle cx={cx} cy={cy} r={4.5} fill="#08131d" stroke="#25f4ee" strokeWidth={1.5} />
      <circle cx={cx} cy={cy} r={1.8} fill="#f4fbff" />
    </g>
  )
}

/** Apenas a série real do período: um dia não representa uma curva. */
export function RevenueTrend({ series, currency }: { series: PeriodMetrics['series']; currency: string }) {
  if (series.length === 0) {
    return <div className="overview-revenue-empty">Sem dados no período selecionado</div>
  }

  if (series.length === 1) {
    const point = series[0]
    return (
      <div className="overview-revenue-empty">
        <p className="overview-revenue-point">
          <span aria-hidden="true" />
          <time dateTime={point.day}>{dayLabel(point.day)}</time>
          <strong data-sensitive>{money(point.revenue, currency)}</strong>
        </p>
        <p>{point.sales} {point.sales === 1 ? 'venda registrada' : 'vendas registradas'} · {point.visits} {point.visits === 1 ? 'visita' : 'visitas'}</p>
        <p className="overview-revenue-hint">Gráfico disponível com 2 dias de dados</p>
      </div>
    )
  }

  return (
    <div className="overview-revenue-chart" data-sensitive>
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <AreaChart data={series} margin={{ top: 12, right: 12, bottom: 0, left: 0 }} accessibilityLayer>
          <defs>
            <linearGradient id="overviewRevenueStroke" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#25f4ee" />
              <stop offset="68%" stopColor="#35d9f0" />
              <stop offset="100%" stopColor="#58b8ff" />
            </linearGradient>
            <linearGradient id="overviewRevenueFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#25f4ee" stopOpacity={0.16} />
              <stop offset="42%" stopColor="#1a8fbf" stopOpacity={0.065} />
              <stop offset="72%" stopColor="#596bd4" stopOpacity={0.018} />
              <stop offset="100%" stopColor="#07111f" stopOpacity={0} />
            </linearGradient>
          </defs>

          <CartesianGrid
            vertical={false}
            stroke="rgba(182,205,223,0.16)"
            strokeWidth={1}
            strokeDasharray="2 7"
          />
          <XAxis
            dataKey="day"
            tickFormatter={dayLabel}
            axisLine={false}
            tickLine={false}
            minTickGap={30}
            tickMargin={9}
            tick={{ fill: 'var(--refine-muted, #aebfd0)', fontSize: 12, fontWeight: 500 }}
          />
          <YAxis
            tickFormatter={value => fmtCompact(value / 100)}
            axisLine={false}
            tickLine={false}
            width={48}
            tickMargin={7}
            tick={{ fill: 'var(--refine-muted, #aebfd0)', fontSize: 12, fontWeight: 500 }}
          />
          <Tooltip
            cursor={{ stroke: 'rgba(92,178,215,0.22)', strokeWidth: 1, strokeDasharray: '3 5' }}
            content={({ active, payload }) => {
              const point = payload?.[0]?.payload as PeriodMetrics['series'][number] | undefined
              if (!active || !point) return null
              return (
                <div className="overview-revenue-tooltip" role="status">
                  <div className="overview-revenue-tooltip__topline">
                    <span className="overview-revenue-tooltip__series-dot" aria-hidden="true" />
                    <span>Faturamento</span>
                    <time dateTime={point.day}>{dayLabel(point.day)}</time>
                  </div>
                  <strong>{money(point.revenue, currency)}</strong>
                  <span className="overview-revenue-tooltip__context">
                    {point.sales} {point.sales === 1 ? 'venda' : 'vendas'} · {point.visits} {point.visits === 1 ? 'visita' : 'visitas'}
                  </span>
                </div>
              )
            }}
          />
          <Area
            type="monotone"
            dataKey="revenue"
            name="Faturamento"
            stroke="url(#overviewRevenueStroke)"
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="url(#overviewRevenueFill)"
            dot={false}
            activeDot={<RevenueActiveDot />}
            isAnimationActive={false}
            className="overview-revenue-series"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
