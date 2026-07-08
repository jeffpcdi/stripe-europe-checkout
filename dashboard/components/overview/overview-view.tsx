'use client'

import { useMemo, useState } from 'react'
import {
  Banknote,
  CircleCheck,
  Users,
  Percent,
  Globe2,
  RotateCcw,
  ShieldAlert,
  Coins,
} from 'lucide-react'
import { useStats } from '@/lib/api'
import {
  aggregate,
  deltaPct,
  money,
  periodStart,
  prevWindow,
} from '@/lib/metrics'
import { fmtPercent } from '@/lib/format'
import type { Period } from '@/lib/types'
import { CountUp } from '@/components/count-up'
import { SparkBars, SparkLine } from '@/components/sparkline'
import { Skeleton } from '@/components/skeleton'
import { GlassCard } from '@/components/glass-card'
import { KpiCard } from './kpi-card'
import { MiniStat } from './mini-stat'
import { PeriodPicker } from './period-picker'
import { RevenueChart } from './revenue-chart'
import { HealthCard } from './health-card'

const NEUTRAL = '#6b7183'
const NEUTRAL_BG = 'rgba(107,113,131,.10)'

export function OverviewView() {
  const [period, setPeriod] = useState<Period>('7d')
  const { data, error, isLoading } = useStats()

  const { cur, prev } = useMemo(() => {
    if (!data) return { cur: null, prev: null }
    const w = prevWindow(period)
    return {
      cur: aggregate(data, periodStart(period)),
      prev: w ? aggregate(data, w.prevFrom, w.prevTo) : null,
    }
  }, [data, period])

  if (error) {
    return (
      <GlassCard className="flex min-h-64 flex-col items-center justify-center gap-2 p-8 text-center">
        <p className="text-sm font-medium text-error">Falha ao carregar as métricas</p>
        <p className="text-sm text-muted-foreground text-pretty">
          Verifique se o servidor Express está rodando e se você está autenticado.
        </p>
      </GlassCard>
    )
  }

  if (isLoading || !cur) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true" aria-label="Carregando métricas">
        <div className="flex justify-end">
          <Skeleton className="h-8 w-64 rounded-full" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-36" />
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-72 lg:col-span-2" />
          <Skeleton className="h-72" />
        </div>
      </div>
    )
  }

  const d = (k: keyof typeof cur, invert = false) =>
    prev ? deltaPct(Number(cur[k]) || 0, Number(prev[k]) || 0) : null

  const revCents = cur.rev[cur.mainCur] || 0
  const prevRev = prev ? prev.rev[cur.mainCur] || 0 : 0
  const revDelta = prev ? deltaPct(revCents, prevRev) : null

  const revSeries = cur.series.map((s) => s.revenue)
  const salesSeries = cur.series.map((s) => s.sales)
  const visitSeries = cur.series.map((s) => s.visits)

  const attempts = cur.sales + cur.failed
  const apColor = !attempts
    ? NEUTRAL
    : cur.approval >= 70
      ? '#22c55e'
      : cur.approval >= 40
        ? '#d97706'
        : '#dc2626'
  const apBg = !attempts
    ? NEUTRAL_BG
    : cur.approval >= 70
      ? 'rgba(34,197,94,.12)'
      : cur.approval >= 40
        ? 'rgba(217,119,6,.12)'
        : 'rgba(220,38,38,.12)'

  const hasSales = cur.sales > 0
  const hasGeo = cur.countries.length > 0
  const refColor = cur.refunds ? '#d97706' : NEUTRAL
  const dispColor = cur.disputes ? '#dc2626' : NEUTRAL

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>

      {/* KPIs principais — mesma ordem e semântica do legado */}
      <section
        aria-label="Indicadores principais"
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <KpiCard
          hero
          index={0}
          icon={Banknote}
          tint="green"
          label="Receita total"
          value={
            <CountUp
              value={revCents}
              format={(v) => money(Math.round(v), cur.mainCur)}
              className={revCents > 0 ? 'text-success' : 'text-muted-foreground'}
            />
          }
          sub="no período selecionado"
          delta={revDelta}
          spark={<SparkLine data={revSeries} color="#22c55e" />}
        />
        <KpiCard
          index={1}
          icon={CircleCheck}
          tint="green"
          label="Vendas aprovadas"
          value={
            <CountUp
              value={cur.sales}
              className={cur.sales > 0 ? 'text-success' : 'text-muted-foreground'}
            />
          }
          sub={
            <>
              <span className={cur.failed > 0 ? 'text-error' : ''}>{cur.failed}</span>{' '}
              recusadas
            </>
          }
          delta={d('sales')}
          spark={<SparkBars data={salesSeries} color="#22c55e" />}
        />
        <KpiCard
          index={2}
          icon={Users}
          tint="cyan"
          label="Novos leads"
          value={
            <CountUp
              value={cur.visits}
              className={cur.visits > 0 ? 'text-brand-cyan' : 'text-muted-foreground'}
            />
          }
          sub="entraram no funil"
          delta={d('visits')}
          spark={<SparkLine data={visitSeries} color="#25f4ee" />}
        />
        <KpiCard
          index={3}
          icon={Percent}
          tint="amber"
          label="Conversão"
          value={
            <CountUp
              value={cur.overall}
              format={(v) => fmtPercent(v)}
              className={cur.overall > 0 ? 'text-warning' : 'text-muted-foreground'}
            />
          }
          sub="visita → compra"
          delta={d('overall')}
        />
      </section>

      {/* Ministats — réplica dos chips do legado */}
      <section
        aria-label="Métricas secundárias"
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"
      >
        <MiniStat
          index={0}
          icon={CircleCheck}
          color={apColor}
          bg={apBg}
          label="Aprovação"
          value={fmtPercent(cur.approval)}
          sub={`${cur.sales} aprovadas de ${attempts} tentativas`}
          extra={attempts ? <SparkBars data={salesSeries} color={apColor} width={64} height={22} /> : undefined}
        />
        <MiniStat
          index={1}
          icon={Coins}
          color={hasSales ? '#22c55e' : NEUTRAL}
          bg={hasSales ? 'rgba(34,197,94,.12)' : NEUTRAL_BG}
          label="Ticket médio"
          value={money(cur.avgTicket, cur.mainCur)}
          sub="por venda aprovada"
        />
        <MiniStat
          index={2}
          icon={Globe2}
          color={hasGeo ? '#06b6d4' : NEUTRAL}
          bg={hasGeo ? 'rgba(6,182,212,.1)' : NEUTRAL_BG}
          label="Países ativos"
          value={cur.countries.length}
          sub={hasGeo ? cur.countries.slice(0, 3).map((c) => c.code).join(' · ') : 'aguardando leads'}
        />
        <MiniStat
          index={3}
          icon={RotateCcw}
          color={refColor}
          bg={cur.refunds ? 'rgba(217,119,6,.12)' : 'rgba(34,197,94,.1)'}
          label="Reembolsos"
          value={cur.refunds}
          sub={cur.refunds ? 'exige atenção' : 'nenhum no período'}
        />
        <MiniStat
          index={4}
          icon={ShieldAlert}
          color={dispColor}
          bg={cur.disputes ? 'rgba(220,38,38,.12)' : 'rgba(34,197,94,.1)'}
          label="Disputas"
          value={cur.disputes}
          sub={cur.disputes ? 'responda o quanto antes' : 'nenhuma aberta'}
        />
      </section>

      {/* Gráfico + saúde */}
      <section aria-label="Gráficos e saúde" className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <RevenueChart series={cur.series} currency={cur.mainCur} />
        </div>
        <HealthCard />
      </section>
    </div>
  )
}
