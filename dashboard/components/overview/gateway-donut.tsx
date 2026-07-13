'use client'

// Item 298: receita por gateway em donut compacto — responde "de onde vem o
// dinheiro" num olhar. Só aparece com 2+ gateways (com um único, o donut é
// um círculo cheio que não informa nada).

import { useMemo } from 'react'
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'
import { GlassCard } from '@/components/glass-card'
import { money } from '@/lib/metrics'
import { fmtPercent } from '@/lib/format'

const COLORS = ['#25f4ee', '#22c55e', '#f59e0b', '#8b5cf6', '#64748b']

export function GatewayDonut({
  data,
  mainCur,
}: {
  data: { name: string; revenue: number; sales: number }[]
  mainCur: string
}) {
  const total = useMemo(() => data.reduce((s, g) => s + g.revenue, 0), [data])

  if (data.length < 2 || total <= 0) return null

  return (
    /* V2-67: donut anima na entrada + hover no card levanta com glow */
    <GlassCard className="hover-glow p-5">
      <h3 className="section-head text-sm font-semibold text-foreground">Receita por gateway</h3>
      <div className="mt-3 flex items-center gap-4">
        <div className="relative size-28 shrink-0" aria-hidden="true">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="revenue"
                nameKey="name"
                innerRadius="68%"
                outerRadius="100%"
                paddingAngle={2}
                stroke="none"
                isAnimationActive
                animationDuration={800}
              >
                {data.map((g, i) => (
                  <Cell key={g.name} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="label-mono">total</span>
            <span className="text-xs font-semibold text-foreground" data-sensitive>
              {money(total, mainCur)}
            </span>
          </div>
        </div>
        {/* V2-68: dots da legenda com anel da própria cor (dot-ring) */}
        <ul className="min-w-0 flex-1 space-y-2" aria-label="Receita por gateway">
          {data.map((g, i) => (
            <li key={g.name} className="anim-row-in flex items-start gap-2" style={{ animationDelay: `${i * 60}ms` }}>
              <span
                className="dot-ring mt-1 size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: COLORS[i % COLORS.length], color: COLORS[i % COLORS.length] }}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium capitalize text-foreground">{g.name}</p>
                <p className="text-xs tabular-nums text-muted-foreground">
                  <span data-sensitive>{money(g.revenue, mainCur)}</span>
                  {' · '}
                  {fmtPercent((g.revenue / total) * 100)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </GlassCard>
  )
}
