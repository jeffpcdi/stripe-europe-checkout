'use client'

// ROAS/CPA real — cruza o GASTO do TikTok Ads com as VENDAS REAIS reportadas
// pelos gateways (mesma fonte da Visão Geral). É o número que interessa:
// para cada 1 investido em tráfego, quanto voltou em receita de verdade.

import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts'
import { HandCoins } from 'lucide-react'
import { useAdsRoas } from '@/lib/api'
import { GlassCard } from '@/components/glass-card'
import { Skeleton } from '@/components/skeleton'
import { fmtCurrency } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { AdsRoasDaily } from '@/lib/types'

function fmtSpend(v: number, ccy: string) {
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: ccy, maximumFractionDigits: 2 }).format(v)
  } catch {
    return v.toFixed(2)
  }
}

function fmtDay(day: unknown) {
  const [, m, d] = String(day ?? '').split('-')
  return d && m ? `${d}/${m}` : String(day ?? '')
}

function RoasTooltip({
  active,
  payload,
  label,
  currency,
}: {
  active?: boolean
  payload?: { payload?: AdsRoasDaily }[]
  label?: string
  currency: string
}) {
  const row = payload?.[0]?.payload
  if (!active || !row) return null
  return (
    <div className="glass glass-thick rounded-[10px] px-3 py-2 text-xs">
      <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{fmtDay(label)}</p>
      <p className="mt-0.5 font-mono text-[11px] tabular-nums text-foreground">
        gasto {fmtSpend(row.spend, currency)}
      </p>
      <p className="font-mono text-[11px] tabular-nums text-success">
        receita {fmtCurrency(row.revenueCents, currency)} · {row.sales} venda{row.sales === 1 ? '' : 's'}
      </p>
    </div>
  )
}

export function RoasCard({
  active,
  adAccountId,
  fromDate,
  toDate,
  delay = 0,
}: {
  active: boolean
  adAccountId: string
  fromDate?: string
  toDate?: string
  delay?: number
}) {
  const { data, isLoading } = useAdsRoas(active, adAccountId, { fromDate, toDate })

  if (!active) return null

  if (isLoading && !data) {
    return (
      <GlassCard className="anim-kpi-in p-4" style={{ animationDelay: `${delay}ms` }}>
        <Skeleton className="h-4 w-32" />
        <Skeleton className="mt-3 h-8 w-24" />
        <Skeleton className="mt-3 h-16 w-full" />
      </GlassCard>
    )
  }
  if (!data) return null

  const revenue = data.revenueCents / 100
  const profitable = data.roas !== null && data.roas >= 1

  return (
    <GlassCard
      className={cn('p-4', profitable && 'border-success/20')}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">ROAS real · {data.daily.length <= 1 ? 'hoje' : `últimos ${data.daily.length} dias`}</p>
        <HandCoins className="size-4 text-muted-foreground" aria-hidden="true" />
      </div>

      <div className="mt-2 flex flex-wrap items-end gap-x-5 gap-y-2">
        <div>
          <p
            className={cn(
              'font-mono text-2xl font-bold tabular-nums',
              data.roas === null ? 'text-muted-foreground' : profitable ? 'text-success' : 'text-error',
            )}
          >
            {data.roas === null ? '—' : `${data.roas.toFixed(2).replace('.', ',')}×`}
          </p>
          <p className="text-[10px] text-faint">receita ÷ gasto</p>
        </div>
        <div>
          <p className="font-mono text-sm font-semibold tabular-nums text-foreground">
            {data.cpa === null ? '—' : fmtSpend(data.cpa, data.currency)}
          </p>
          <p className="text-[10px] text-faint">CPA (gasto/venda)</p>
        </div>
        <div>
          <p className="font-mono text-sm font-semibold tabular-nums text-foreground">
            {fmtSpend(data.spend, data.currency)} <span className="text-muted-foreground">→</span>{' '}
            <span className="text-success">{fmtSpend(revenue, data.currency)}</span>
          </p>
          <p className="text-[10px] text-faint">
            gasto → receita real · {data.sales} venda{data.sales === 1 ? '' : 's'}
          </p>
        </div>
      </div>

      {/* mini área: receita (verde) sobre gasto (ciano) por dia */}
      {data.daily.length > 1 && (
        <div className="mt-3 h-16">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={data.daily.map((d) => ({ ...d, revenue: d.revenueCents / 100 }))}
              margin={{ top: 2, right: 2, bottom: 0, left: 2 }}
            >
              <XAxis dataKey="date" hide />
              <Tooltip content={<RoasTooltip currency={data.currency} />} />
              <Area
                type="monotone"
                dataKey="spend"
                name="Gasto"
                stroke="#25f4ee"
                strokeWidth={1.5}
                fill="rgba(37,244,238,0.08)"
                animationDuration={500}
              />
              <Area
                type="monotone"
                dataKey="revenue"
                name="Receita"
                stroke="#22c55e"
                strokeWidth={1.5}
                fill="rgba(34,197,94,0.10)"
                animationDuration={700}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      <p className="mt-2 text-[10px] leading-relaxed text-faint">
        Receita real dos gateways cruzada com o gasto do TikTok — não é a conversão estimada do pixel.
      </p>
    </GlassCard>
  )
}
