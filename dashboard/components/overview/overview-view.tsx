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
import { countryFlag, fmtPercent } from '@/lib/format'
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
    // Itens 58/59: skeleton mimético (silhueta real do card) com stagger de 60ms
    return (
      <div className="flex flex-col gap-4" aria-busy="true" aria-label="Carregando métricas">
        <div className="flex justify-end">
          <Skeleton className="h-8 w-64 rounded-full" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="glass anim-kpi-in flex flex-col gap-4 p-5"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <Skeleton className="size-8 rounded-[10px]" />
                  <Skeleton className="h-3 w-20" />
                </div>
                <Skeleton className="h-5 w-12 rounded-full" />
              </div>
              <div className="flex items-end justify-between gap-3">
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-8 w-28" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-7 w-24" />
              </div>
            </div>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="glass anim-kpi-in flex items-center gap-3 p-4"
              style={{ animationDelay: `${240 + i * 60}ms` }}
            >
              <Skeleton className="size-9 rounded-[10px]" />
              <div className="flex flex-col gap-1.5">
                <Skeleton className="h-4 w-14" />
                <Skeleton className="h-3 w-20" />
              </div>
            </div>
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          {/* Item 142: skeleton do gráfico com forma de onda fantasma */}
          <div
            className="glass anim-kpi-in flex flex-col gap-4 p-5 lg:col-span-2"
            style={{ animationDelay: '540ms' }}
          >
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-44" />
              <Skeleton className="h-7 w-40 rounded-full" />
            </div>
            <svg
              viewBox="0 0 400 140"
              className="h-56 w-full"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <path
                d="M0,110 C40,100 60,60 100,70 C140,80 160,30 200,45 C240,60 260,90 300,75 C340,60 360,40 400,50 L400,140 L0,140 Z"
                fill="rgba(255,255,255,0.06)"
              />
              <path
                d="M0,110 C40,100 60,60 100,70 C140,80 160,30 200,45 C240,60 260,90 300,75 C340,60 360,40 400,50"
                fill="none"
                stroke="rgba(37,244,238,0.15)"
                strokeWidth="2"
              />
            </svg>
          </div>
          <div
            className="glass anim-kpi-in flex flex-col gap-3 p-5"
            style={{ animationDelay: '600ms' }}
          >
            <Skeleton className="h-4 w-36" />
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center justify-between">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-3.5 w-14" />
              </div>
            ))}
          </div>
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
        ? '#fbbf24'
        : '#fe2c55'
  const apBg = !attempts
    ? NEUTRAL_BG
    : cur.approval >= 70
      ? 'rgba(34,197,94,.12)'
      : cur.approval >= 40
        ? 'rgba(251,191,36,.12)'
        : 'rgba(254,44,85,.12)'

  const hasSales = cur.sales > 0
  const hasGeo = cur.countries.length > 0
  // Item 111: sistema fixo — ciano = métrica, verde = sucesso, âmbar = atenção, rosa = risco
  const refColor = cur.refunds ? '#fbbf24' : NEUTRAL
  const dispColor = cur.disputes ? '#fe2c55' : NEUTRAL

  return (
    <div className="flex flex-col gap-4">
      {/* Item 171: sticky no topo em mobile ao rolar */}
      <div className="picker-sticky flex justify-end" data-tour="period">
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>

      {/* KPIs principais — mesma ordem e semântica do legado.
          Item 167: carrossel horizontal com snap em <640px */}
      <section
        aria-label="Indicadores principais"
        className="kpi-carousel grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
        data-tour="kpis"
      >
        {/* Item 96: glow do card de receita cresce com o delta do período */}
        <div
          className="kpi-glow rounded-[var(--radius)]"
          style={{
            ['--glow' as string]: String(
              revDelta && revDelta > 0 ? Math.min(1, revDelta / 100) : 0,
            ),
          }}
        >
          <KpiCard
            hero
            index={0}
            icon={Banknote}
            tint="green"
            label="Receita total"
          value={
            /* Item 125: borrado no modo apresentação */
            <span data-sensitive>
              <CountUp
                value={revCents}
                format={(v) => money(Math.round(v), cur.mainCur)}
                className={revCents > 0 ? 'text-success' : 'text-muted-foreground'}
              />
            </span>
          }
            sub="no período selecionado"
            delta={revDelta}
            spark={<SparkLine data={revSeries} color="#25f4ee" />}
          />
        </div>
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
          sub={`${cur.sales} de ${attempts} transações`}
          extra={attempts ? <SparkBars data={salesSeries} color={apColor} width={64} height={22} /> : undefined}
        />
        <MiniStat
          index={1}
          icon={Coins}
          color={hasSales ? '#25f4ee' : NEUTRAL}
          bg={hasSales ? 'rgba(37,244,238,.1)' : NEUTRAL_BG}
          label="Ticket médio"
          value={<span data-sensitive>{money(cur.avgTicket, cur.mainCur)}</span>}
          sub="por venda aprovada"
        />
        <MiniStat
          index={2}
          icon={Globe2}
          color={hasGeo ? '#25f4ee' : NEUTRAL}
          bg={hasGeo ? 'rgba(37,244,238,.1)' : NEUTRAL_BG}
          label="Países ativos"
          value={cur.countries.length}
          sub={
            hasGeo
              ? cur.countries
                  .slice(0, 3)
                  .map((c) => `${countryFlag(c.code)} ${c.code}`)
                  .join('  ')
              : 'aguardando leads'
          }
        />
        <MiniStat
          index={3}
          icon={RotateCcw}
          color={refColor}
          bg={cur.refunds ? 'rgba(251,191,36,.12)' : NEUTRAL_BG}
          label="Reembolsos"
          value={cur.refunds}
          sub={cur.refunds ? 'exige atenção' : 'nenhum no período'}
        />
        <MiniStat
          index={4}
          icon={ShieldAlert}
          color={dispColor}
          bg={cur.disputes ? 'rgba(254,44,85,.12)' : NEUTRAL_BG}
          label="Disputas"
          value={cur.disputes}
          sub={cur.disputes ? 'responda o quanto antes' : 'nenhuma aberta'}
        />
      </section>

      {/* Gráfico + saúde — item 177: só renderiza quando visível */}
      <section
        aria-label="Gráficos e saúde"
        className="cv-auto grid gap-4 lg:grid-cols-3"
        data-tour="chart"
      >
        <div className="lg:col-span-2">
          <RevenueChart series={cur.series} currency={cur.mainCur} />
        </div>
        <HealthCard />
      </section>
    </div>
  )
}
