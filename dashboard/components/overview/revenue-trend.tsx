'use client'

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { PeriodMetrics } from '@/lib/metrics'
import { money } from '@/lib/metrics'
import { fmtCompact } from '@/lib/format'

function dayLabel(day: string) {
  const [, month, date] = day.split('-')
  return date && month ? `${date}/${month}` : day
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
        <p className="overview-revenue-hint">Ponto único no período · o gráfico aparece a partir de 2 dias de dados</p>
      </div>
    )
  }

  return (
    <div className="overview-revenue-chart" data-sensitive>
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <LineChart data={series} margin={{ top: 12, right: 12, bottom: 0, left: 0 }} accessibilityLayer>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="2 4" />
          <XAxis dataKey="day" tickFormatter={dayLabel} axisLine={false} tickLine={false}
            minTickGap={28} tick={{ fill: 'var(--text-faint)', fontSize: 11 }} />
          <YAxis tickFormatter={value => fmtCompact(value / 100)} axisLine={false} tickLine={false}
            width={48} tick={{ fill: 'var(--text-faint)', fontSize: 11 }} />
          <Tooltip cursor={{ stroke: 'var(--border-strong)', strokeDasharray: '3 4' }}
            content={({ active, payload }) => {
              const point = payload?.[0]?.payload as PeriodMetrics['series'][number] | undefined
              if (!active || !point) return null
              return (
                <div className="overview-revenue-tooltip">
                  <time dateTime={point.day}>{dayLabel(point.day)}</time>
                  <strong>{money(point.revenue, currency)}</strong>
                  <span>{point.sales} {point.sales === 1 ? 'venda' : 'vendas'} · {point.visits} {point.visits === 1 ? 'visita' : 'visitas'}</span>
                </div>
              )
            }} />
          <Line type="linear" dataKey="revenue" name="Faturamento" stroke="var(--accent)" strokeWidth={1.75}
            dot={{ r: 2.5, fill: 'var(--accent)', strokeWidth: 0 }}
            activeDot={{ r: 4, fill: 'var(--accent)', stroke: 'var(--surface-inset)', strokeWidth: 2 }}
            isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
