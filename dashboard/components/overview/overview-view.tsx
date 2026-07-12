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
  CalendarDays,
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
import { HeroGlobe } from './hero-globe'
import { GoalCard } from './goal-card'

const NEUTRAL = '#6b7183'
const NEUTRAL_BG = 'rgba(107,113,131,.10)'

const PERIODS: Period[] = ['today', '7d', '30d', 'all']
const PERIOD_KEY = 'roi:overview:period'

// Itens 283/284: período escolhido persiste (localStorage) e aceita deep-link
// (?p=30d). Precedência: query string → localStorage → default '7d'.
function initialPeriod(): Period {
  if (typeof window === 'undefined') return '7d'
  const fromUrl = new URLSearchParams(window.location.search).get('p') as Period | null
  if (fromUrl && PERIODS.includes(fromUrl)) return fromUrl
  const saved = window.localStorage.getItem(PERIOD_KEY) as Period | null
  if (saved && PERIODS.includes(saved)) return saved
  return '7d'
}

export function OverviewView() {
  const [period, setPeriodState] = useState<Period>(initialPeriod)
  const { data, error, isLoading } = useStats()

  // Persiste no localStorage e reflete no ?p= sem recarregar (histórico limpo).
  function setPeriod(next: Period) {
    setPeriodState(next)
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(PERIOD_KEY, next)
      const url = new URL(window.location.href)
      url.searchParams.set('p', next)
      window.history.replaceState(null, '', url)
    } catch {
      /* localStorage/URL indisponível (modo privado): degrada para memória */
    }
  }

  const { cur, prev } = useMemo(() => {
    if (!data) return { cur: null, prev: null }
    const w = prevWindow(period)
    return {
      cur: aggregate(data, periodStart(period)),
      prev: w ? aggregate(data, w.prevFrom, w.prevTo) : null,
    }
  }, [data, period])

  // Item 274: melhor dia da semana por receita, derivado da própria série.
  // Fica ANTES dos early returns (regra dos hooks): quando `cur` ainda não
  // existe, devolve null sem custo.
  const bestWeekday = useMemo(() => {
    if (!cur || cur.series.length < 14) return null
    const names = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
    const byDow = Array.from({ length: 7 }, () => ({ revenue: 0, count: 0 }))
    for (const p of cur.series) {
      const dow = new Date(p.day + 'T00:00:00').getDay()
      if (Number.isNaN(dow)) continue
      byDow[dow].revenue += p.revenue
      byDow[dow].count += 1
    }
    let best = -1
    for (let i = 0; i < 7; i++) {
      if (byDow[i].count > 0 && (best < 0 || byDow[i].revenue > byDow[best].revenue)) best = i
    }
    if (best < 0 || byDow[best].revenue <= 0) return null
    return { name: names[best], revenue: byDow[best].revenue }
  }, [cur])

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
  // Item 273 (bug): vendas em OUTRAS moedas sumiam do card — o valor grande
  // é na moeda principal, mas o breakdown das demais precisa aparecer.
  const otherRev = Object.entries(cur.rev)
    .filter(([c, cents]) => c !== cur.mainCur && cents > 0)
    .sort((a, b) => b[1] - a[1])

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

      {/* Item 277: aprovação crítica (<40% com volume relevante) vira alerta
          acionável, não só uma cor. CTA leva ao cloaker (filtro de tráfego). */}
      {attempts >= 10 && cur.approval < 40 && (
        <GlassCard
          role="alert"
          className="flex flex-col gap-3 border-l-2 border-l-[#fe2c55] p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 size-5 shrink-0 text-[#fe2c55]" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold text-foreground">
                Aprovação em {fmtPercent(cur.approval)} — abaixo do saudável
              </p>
              <p className="text-sm text-muted-foreground text-pretty">
                {cur.failed} de {attempts} tentativas falharam neste período. Verifique o cloaker e os gateways para barrar tráfego ruim.
              </p>
            </div>
          </div>
          <a
            href="/cloak"
            className="shrink-0 self-start rounded-lg bg-[#fe2c55] px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 sm:self-auto"
          >
            Abrir cloaker
          </a>
        </GlassCard>
      )}

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
            ariaLabel={`Receita total: ${money(revCents, cur.mainCur)}${revDelta !== null ? `, ${revDelta > 0 ? 'alta' : revDelta < 0 ? 'queda' : 'estável'} de ${Math.abs(revDelta).toFixed(1)}% vs período anterior` : ''}`}
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
            sub={
              otherRev.length > 0 ? (
                /* Item 273: receita nas demais moedas não some do card */
                <span data-sensitive>
                  {'+ '}
                  {otherRev.map(([c, cents]) => money(cents, c)).join(' + ')}
                  {' em outras moedas'}
                </span>
              ) : (
                'no período selecionado'
              )
            }
            delta={revDelta}
            spark={<SparkLine data={revSeries} color="#25f4ee" />}
          />
        </div>
        <KpiCard
          index={1}
          icon={CircleCheck}
          tint="green"
          label="Vendas aprovadas"
          ariaLabel={`Vendas aprovadas: ${cur.sales}, ${cur.failed} recusadas`}
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
          ariaLabel={`Novos leads: ${cur.visits} no período`}
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
          ariaLabel={`Conversão: ${fmtPercent(cur.overall)} de visita para compra${prev ? `, ${cur.overall - prev.overall >= 0 ? 'mais' : 'menos'} ${Math.abs(cur.overall - prev.overall).toFixed(1).replace('.', ',')} pontos percentuais que o período anterior` : ''}`}
          value={
            <CountUp
              value={cur.overall}
              format={(v) => fmtPercent(v)}
              className={cur.overall > 0 ? 'text-warning' : 'text-muted-foreground'}
            />
          }
          sub="visita → compra"
          /* Item 291: conversão JÁ é % — delta correto é a diferença em
             pontos percentuais, não % de % (2%→3% = +1 p.p., não +50%) */
          delta={prev ? +(cur.overall - prev.overall).toFixed(1) : null}
          deltaUnit="pp"
        />
      </section>

      {/* Itens 271+276: meta mensal com progresso e projeção de fim de mês.
          Só aparece quando há meta configurada em Config. */}
      <GoalCard />

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
        {/* Item 292: chips de risco viram drill-down para a Atividade filtrada */}
        <MiniStat
          index={3}
          icon={RotateCcw}
          color={refColor}
          bg={cur.refunds ? 'rgba(251,191,36,.12)' : NEUTRAL_BG}
          label="Reembolsos"
          value={cur.refunds}
          sub={cur.refunds ? 'exige atenção — ver na Atividade' : 'nenhum no período'}
          href={cur.refunds ? '/activity?f=refund' : undefined}
        />
        <MiniStat
          index={4}
          icon={ShieldAlert}
          color={dispColor}
          bg={cur.disputes ? 'rgba(254,44,85,.12)' : NEUTRAL_BG}
          label="Disputas"
          value={cur.disputes}
          sub={cur.disputes ? 'responda o quanto antes' : 'nenhuma aberta'}
          href={cur.disputes ? '/activity?f=dispute' : undefined}
        />
      </section>

      {/* Globo — presença global ao vivo. Fica na página inicial, mas depois
          dos números: primeiro o usuário vê o dinheiro, depois o mundo. */}
      <HeroGlobe />

      {/* Gráfico + saúde — item 177: só renderiza quando visível */}
      <section
        aria-label="Gráficos e saúde"
        className="cv-auto grid gap-4 lg:grid-cols-3"
        data-tour="chart"
      >
        <div className="lg:col-span-2 flex flex-col gap-4">
          {/* Item 272: série anterior vira linha fantasma de comparação */}
          <RevenueChart series={cur.series} currency={cur.mainCur} prevSeries={prev?.series} />
          {/* Item 274: insight do melhor dia da semana (só com histórico suficiente) */}
          {bestWeekday && (
            <GlassCard className="flex items-center gap-3 p-4">
              <div
                className="flex size-10 shrink-0 items-center justify-center rounded-lg"
                style={{ backgroundColor: 'rgba(37,244,238,.1)' }}
              >
                <CalendarDays className="size-5" style={{ color: '#25f4ee' }} aria-hidden="true" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Melhor dia da semana</p>
                <p className="text-sm font-semibold text-foreground text-pretty">
                  {bestWeekday.name} lidera com{' '}
                  <span data-sensitive>{money(bestWeekday.revenue, cur.mainCur)}</span> em receita
                </p>
              </div>
            </GlassCard>
          )}
        </div>
        <HealthCard />
      </section>
    </div>
  )
}
