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
import { GlassCard } from '@/components/glass-card'
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

export function RevenueChart({
  series,
  currency,
}: {
  series: { day: string; revenue: number; sales: number; visits: number }[]
  currency: string
}) {
  const [metric, setMetric] = useState<Metric>('revenue')
  const conf = METRICS.find((m) => m.id === metric) ?? METRICS[0]
  const isMoney = metric === 'revenue'

  return (
    <GlassCard className="anim-kpi-in p-5" style={{ animationDelay: '280ms' }}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-sub">Desempenho no período</h3>
        <div className="flex gap-0.5 rounded-full bg-[var(--hover)] p-0.5" role="tablist" aria-label="Métrica do gráfico">
          {METRICS.map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={metric === m.id}
              onClick={() => setMetric(m.id)}
              className={cn(
                'rounded-full px-2.5 py-1 text-xs font-medium transition-colors duration-150',
                metric === m.id
                  ? 'bg-[var(--active)] text-foreground'
                  : 'text-muted-foreground hover:text-sub',
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {series.length === 0 ? (
        <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">
          Sem dados no período selecionado
        </div>
      ) : (
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            {metric === 'sales' ? (
              <BarChart data={series} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
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
                  allowDecimals={false}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                  contentStyle={{
                    background: 'var(--lg-tint-thick)',
                    border: '1px solid var(--border)',
                    borderRadius: 10,
                    color: '#f4f4f5',
                    fontSize: 12,
                  }}
                  labelFormatter={fmtDay}
                />
                <Bar dataKey="sales" name="Vendas" fill={conf.color} radius={[3, 3, 0, 0]} />
              </BarChart>
            ) : (
              <AreaChart data={series} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                <defs>
                  <linearGradient id={`grad-${metric}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={conf.color} stopOpacity={0.25} />
                    <stop offset="100%" stopColor={conf.color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
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
                  width={isMoney ? 56 : 36}
                  tickFormatter={(v: number) => (isMoney ? money(v, currency) : String(v))}
                  allowDecimals={false}
                />
                <Tooltip
                  cursor={{ stroke: 'rgba(255,255,255,0.15)' }}
                  contentStyle={{
                    background: 'var(--lg-tint-thick)',
                    border: '1px solid var(--border)',
                    borderRadius: 10,
                    color: '#f4f4f5',
                    fontSize: 12,
                  }}
                  labelFormatter={fmtDay}
                  formatter={(v) => [
                    isMoney ? money(Number(v), currency) : Number(v),
                    conf.label,
                  ]}
                />
                <Area
                  type="monotone"
                  dataKey={metric}
                  name={conf.label}
                  stroke={conf.color}
                  strokeWidth={2}
                  fill={`url(#grad-${metric})`}
                  animationDuration={700}
                />
              </AreaChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
    </GlassCard>
  )
}
