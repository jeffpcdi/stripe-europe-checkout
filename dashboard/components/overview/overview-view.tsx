'use client'

import { useMemo, useState } from 'react'
import { useOncePerSession, useValueFlash } from '@/lib/motion'
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
  Timer,
  TrendingUp,
  Megaphone,
} from 'lucide-react'
import { useStats, useEmqTrend, useAdsStatus, useAdsRoas } from '@/lib/api'
import { useAfterFirstPaint } from '@/lib/use-after-first-paint'
import {
  aggregate,
  deltaPct,
  money,
  periodStart,
  prevWindow,
} from '@/lib/metrics'
import { countryFlag, fmtDurationShort, fmtPercent } from '@/lib/format'
import type { Period } from '@/lib/types'
import { CountUp } from '@/components/count-up'
import { SparkBars, SparkLine } from '@/components/sparkline'
import { Skeleton } from '@/components/skeleton'
import { GlassCard } from '@/components/glass-card'
import { KpiCard } from './kpi-card'
import { MiniStat } from './mini-stat'
import { TopSources } from './top-sources'
import { GatewayDonut } from './gateway-donut'
import { ExportSummaryButton } from './export-summary'
import { TvModeButton } from './tv-mode'
import { OnboardingChecklist } from './onboarding-checklist'
import { PeriodPicker } from './period-picker'
import { RevenueChart } from './revenue-chart'
import { HealthDot } from './health-dot'
import { HeroGlobe } from './hero-globe'
import { GoalCard } from './goal-card'
import { AdsOverviewCard } from './ads-card'
import { LiveFeed } from './live-feed'
import { FunnelCompact } from './funnel-compact'

const NEUTRAL = '#6b7183'
const NEUTRAL_BG = 'rgba(107,113,131,.10)'

// Fase 3: gasto de Ads já vem em unidade principal (não centavos), diferente do
// resto do app — formata direto sem dividir por 100.
function fmtAdsMoney(v: number, currency: string): string {
  try {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: currency || 'BRL',
      maximumFractionDigits: 2,
    }).format(v)
  } catch {
    return v.toFixed(2)
  }
}

// Fase 3: o PeriodPicker único também governa a janela do ROAS de Ads. O
// endpoint /api/ads/roas aceita fromDate/toDate (YYYY-MM-DD); 'all' omite o
// range e usa o default do servidor. A troca de período só refaz essa request
// na INTERAÇÃO do usuário — no load ela dispara uma única vez, pós-first-paint.
function periodToAdsRange(period: Period): { fromDate?: string; toDate?: string } | undefined {
  if (period === 'all') return undefined
  const to = new Date()
  const from = periodStart(period) ?? to
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return { fromDate: fmt(from), toDate: fmt(to) }
}

const PERIODS: Period[] = ['today', '7d', '30d', 'all']
const PERIOD_KEY = 'roi:overview:period'
// Fase 4: marcador da migração para o novo default 'today'. Sem ele, usuários
// que já tinham '7d' gravado ficariam presos e nunca veriam o padrão novo.
const PERIOD_MIGRATION_KEY = 'roi:overview:period:v2'

// Itens 283/284: período escolhido persiste (localStorage) e aceita deep-link
// (?p=30d). Precedência: query string → localStorage → default 'today' (Fase 4).
function initialPeriod(): Period {
  if (typeof window === 'undefined') return 'today'
  // Migração única (Fase 4): limpa a preferência legada UMA vez para que o novo
  // default 'today' valha. Preferências escolhidas DEPOIS da migração persistem.
  try {
    if (!window.localStorage.getItem(PERIOD_MIGRATION_KEY)) {
      window.localStorage.removeItem(PERIOD_KEY)
      window.localStorage.setItem(PERIOD_MIGRATION_KEY, '1')
    }
  } catch {
    /* localStorage indisponível (modo privado): segue com o default */
  }
  const fromUrl = new URLSearchParams(window.location.search).get('p') as Period | null
  if (fromUrl && PERIODS.includes(fromUrl)) return fromUrl
  const saved = window.localStorage.getItem(PERIOD_KEY) as Period | null
  if (saved && PERIODS.includes(saved)) return saved
  return 'today'
}

export function OverviewView() {
  const [period, setPeriodState] = useState<Period>(initialPeriod)
  const { data, error, isLoading } = useStats()
  // A1.1: entrada orquestrada roda UMA vez por sessão — navegações seguintes
  // pulam a cascata (os cards aparecem direto, sem re-animar).
  const firstEnter = useOncePerSession('overview-enter')
  // A1.4: nova venda detectada no poll → varredura de glow verde no card de
  // receita (800ms). Observa a contagem de vendas de TODO o histórico para o
  // flash não disparar ao trocar de período.
  const totalSales = useMemo(
    () => (data?.events ?? []).filter((e) => e.type === 'sale').length,
    [data],
  )
  const saleFlash = useValueFlash(totalSales, 800)

  // Fase 3: TikTok Ads alimenta os KPIs "Gasto" e "ROAS". Só resolve
  // pós-first-paint (chave null até lá — NÃO entra no orçamento de requests do
  // load) e só quando a conta está conectada. Sem Ads, os KPIs caem para
  // métricas do próprio funil (Vendas + Conversão). Mesmas chaves SWR do
  // AdsOverviewCard legado → SWR deduplica, zero request extra.
  const afterFirstPaint = useAfterFirstPaint()
  const { data: adsStatus } = useAdsStatus(afterFirstPaint)
  const adAccountId = adsStatus?.advertiserId || ''
  const adsConnected = Boolean(adsStatus?.enabled && adsStatus?.connected && adAccountId)
  const adsRange = useMemo(() => periodToAdsRange(period), [period])
  const { data: roas } = useAdsRoas(adsConnected, adAccountId, adsRange)
  const showAdsKpis = adsConnected && !!roas
  // Também alimenta o rodapé "EMQ" — mesma chave do popover de saúde (dedup).
  const { data: emqData } = useEmqTrend(afterFirstPaint)
  const emqSummary = useMemo(() => {
    const pixels = emqData?.pixels?.filter((p) => p.recentAvg != null) ?? []
    if (pixels.length === 0) return null
    const recent = pixels.reduce((s, p) => s + (p.recentAvg ?? 0), 0) / pixels.length
    const withBase = pixels.filter((p) => p.baseAvg != null)
    const base = withBase.length
      ? withBase.reduce((s, p) => s + (p.baseAvg ?? 0), 0) / withBase.length
      : null
    const dir: 'up' | 'down' | 'flat' =
      base == null || Math.abs(recent - base) < 0.15 ? 'flat' : recent > base ? 'up' : 'down'
    return { recent, dir, alerts: emqData?.alerts ?? 0 }
  }, [emqData])

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

  // Item 296: tempo médio da primeira visita até a compra, mediana dos leads
  // comprados no período (mediana > média: um outlier de dias não distorce).
  const timeToBuy = useMemo(() => {
    if (!data?.leads) return null
    const from = periodStart(period)
    const deltas: number[] = []
    for (const l of data.leads) {
      if (l.stage !== 'purchased' || !l.purchasedAt || !l.at) continue
      const bought = new Date(l.purchasedAt).getTime()
      const first = new Date(l.at).getTime()
      if (Number.isNaN(bought) || Number.isNaN(first) || bought <= first) continue
      if (from && bought < from.getTime()) continue
      deltas.push(bought - first)
    }
    if (deltas.length < 3) return null // amostra pequena demais para afirmar algo
    deltas.sort((a, b) => a - b)
    const mid = Math.floor(deltas.length / 2)
    const median = deltas.length % 2 ? deltas[mid] : (deltas[mid - 1] + deltas[mid]) / 2
    return { median, count: deltas.length }
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
  // Item 288: onboarding usa o HISTÓRICO TODO (não o período filtrado) —
  // trocar para "hoje" numa conta ativa não pode ressuscitar o checklist.
  const everVisited = (data?.leads?.length ?? 0) > 0
  const everSold = (data?.events ?? []).some((e) => e.type === 'sale')
  const isOnboarding = !everVisited || !everSold
  // Item 111: sistema fixo — ciano = métrica, verde = sucesso, âmbar = atenção, rosa = risco
  const refColor = cur.refunds ? '#fbbf24' : NEUTRAL
  const dispColor = cur.disputes ? '#fe2c55' : NEUTRAL

  return (
    /* A1.5: fundo com profundidade (radial ciano + grid de pontos) atrás do
       hero. A1.1: cascata só na primeira entrada da sessão. */
    <div className={`overview-depth flex flex-col gap-4 ${firstEnter ? 'stagger-fade' : ''}`}>
      {/* Fase 3: barra própria do overview. O shell Header já traz
          kicker + título + LiveBadge — aqui fica o dot único de saúde
          (health-card → health-dot, detalhe em popover) à esquerda e os
          controles + PeriodPicker único à direita. Item 171: sticky em mobile. */}
      <div
        className="picker-sticky flex flex-wrap items-center justify-between gap-2"
        data-tour="period"
        style={{ ['--i' as string]: 0 }}
      >
        {/* Dot único de saúde — substitui o antigo HealthCard de coluna inteira */}
        <HealthDot />
        <div className="flex items-center gap-2">
          {/* Item 294: fullscreen para telão — esconde o chrome via data-tv */}
          <TvModeButton />
          {/* Item 278: baixa o resumo do período como PNG (canvas) */}
          <ExportSummaryButton
            period={period}
            summary={{
              revenue: revCents,
              mainCur: cur.mainCur,
              sales: cur.sales,
              visits: cur.visits,
              overall: cur.overall,
              approval: cur.approval,
              series: revSeries,
            }}
          />
          {/* Item 296 (Fase 3): PeriodPicker ÚNICO governa KPIs + funil + campanhas */}
          <PeriodPicker value={period} onChange={setPeriod} />
        </div>
      </div>

      {/* Item 288: conta que ainda não fechou o ciclo (visita + venda) vê o
          checklist guiado no topo, com progresso derivado de dados reais */}
      {isOnboarding && <OnboardingChecklist hasVisits={everVisited} hasSales={everSold} />}

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

      {/* Fase 3 — HERO em 3 colunas: KPIs (esquerda) · globo (centro) ·
          "Chegando agora" (direita). O globo ganha a coluna mais larga. */}
      <section
        aria-label="Painel principal"
        className="grid gap-4 lg:grid-cols-12"
        data-tour="chart"
        style={{ ['--i' as string]: 1 }}
      >
        {/* Coluna 1 — KPIs cortados de 8 → 4, em 2×2.
            Item 167: carrossel com snap horizontal em <640px */}
        <div
          className="kpi-carousel grid grid-cols-2 gap-3 lg:col-span-4 lg:content-start"
          data-tour="kpis"
        >
        {/* Item 96: glow do card de receita cresce com o delta do período.
            A1.4: venda nova no poll → varredura verde na borda (800ms). */}
        <div
          className={`kpi-glow rounded-[var(--radius)] ${saleFlash ? 'sale-flash' : ''}`}
          style={{
            ['--glow' as string]: String(
              revDelta && revDelta > 0 ? Math.min(1, revDelta / 100) : 0,
            ),
          }}
        >
          {/* Item 279: cada KPI vira drill-down para a aba correspondente */}
          <KpiCard
            index={0}
            icon={Banknote}
            tint="green"
            href="/activity?f=sale"
            watch={revCents}
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
        {/* KPIs 2–4 adaptativos: com TikTok Ads conectado mostram Gasto e ROAS
            (dados pós-first-paint da integração); sem Ads, caem para Vendas e
            Conversão do próprio funil. Leads aparece nos dois modos. */}
        {showAdsKpis && roas ? (
          <>
            <KpiCard
              index={1}
              icon={Megaphone}
              tint="cyan"
              href="/ads/tiktok"
              label="Investimento"
              ariaLabel={`Investimento em anúncios: ${fmtAdsMoney(roas.spend, roas.currency)} na janela do período`}
              value={<span data-sensitive>{fmtAdsMoney(roas.spend, roas.currency)}</span>}
              sub="TikTok Ads · gasto"
            />
            <KpiCard
              index={2}
              icon={TrendingUp}
              tint={roas.roas !== null && roas.roas >= 1 ? 'green' : 'amber'}
              href="/ads/tiktok"
              label="ROAS"
              ariaLabel={`ROAS: ${roas.roas === null ? 'sem dados' : roas.roas.toFixed(2).replace('.', ',')}, com ${roas.sales} vendas atribuídas`}
              value={
                <span
                  className={
                    roas.roas === null
                      ? 'text-muted-foreground'
                      : roas.roas >= 1
                        ? 'text-success'
                        : 'text-error'
                  }
                >
                  {roas.roas === null ? '—' : roas.roas.toFixed(2).replace('.', ',')}
                </span>
              }
              sub={`${roas.sales} vendas atribuídas`}
            />
            <KpiCard
              index={3}
              icon={Users}
              tint="cyan"
              href="/funnel"
              watch={cur.visits}
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
          </>
        ) : (
          <>
            <KpiCard
              index={1}
              icon={Users}
              tint="cyan"
              href="/funnel"
              watch={cur.visits}
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
              index={2}
              icon={CircleCheck}
              tint="green"
              href="/activity?f=sale"
              watch={cur.sales}
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
              index={3}
              icon={Percent}
              tint="amber"
              href="/funnel"
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
              /* Item 291: conversão JÁ é % — delta em pontos percentuais */
              delta={prev ? +(cur.overall - prev.overall).toFixed(1) : null}
              deltaUnit="pp"
            />
          </>
        )}
        </div>

        {/* Coluna 2 — globo (peça central do overview) */}
        <div className="lg:col-span-5">
          <HeroGlobe />
        </div>

        {/* Coluna 3 — feed "Chegando agora": últimos leads de /api/stats,
            sem request nova (o poll de 12s já atualiza data.leads) */}
        <div className="lg:col-span-3">
          <LiveFeed leads={data?.leads ?? []} />
        </div>
      </section>

      {/* Fase 3 — abaixo do hero, 2 colunas: funil compacto | top campanhas.
          Ambos governados pelo PeriodPicker único (elimina a divergência de
          período que havia entre Overview/Funil/Atividade). TopSources some
          quando não há campanhas/links no período; aí o funil ocupa a largura. */}
      <section
        aria-label="Funil e origem dos leads"
        className={`grid gap-4 ${hasSources ? 'lg:grid-cols-2' : ''}`}
        style={{ ['--i' as string]: 2 }}
      >
        <FunnelCompact metrics={cur} />
        {hasSources && <TopSources campaigns={cur.topCampaigns} links={cur.topLinks} />}
      </section>

      {/* Fase 3 — rodapé: presença (países ativos) + qualidade dos eventos (EMQ).
          O detalhe de saúde por serviço vive no popover do HealthDot; aqui fica
          o resumo. EMQ usa a mesma chave SWR do popover (dedup, zero request). */}
      <section
        aria-label="Presença e qualidade dos eventos"
        className="grid gap-4 sm:grid-cols-2"
        style={{ ['--i' as string]: 3 }}
      >
        <GlassCard className="flex items-center gap-3 p-4">
          <span
            className="flex size-10 shrink-0 items-center justify-center rounded-lg"
            style={{ backgroundColor: hasGeo ? 'rgba(37,244,238,.1)' : NEUTRAL_BG }}
            aria-hidden="true"
          >
            <Globe2 className="size-5" style={{ color: hasGeo ? '#25f4ee' : NEUTRAL }} />
          </span>
          <div className="min-w-0">
            <p className="label-mono">Países ativos</p>
            <p className="font-mono text-2xl font-semibold tabular-nums text-foreground">
              {cur.countries.length}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {hasGeo
                ? cur.countries
                    .slice(0, 4)
                    .map((c) => `${countryFlag(c.code)} ${c.code}`)
                    .join('  ')
                : 'aguardando os primeiros leads'}
            </p>
          </div>
        </GlassCard>

        {/* EMQ — drill-down para a aba Pixels; só aparece com dados de pixel */}
        {emqSummary ? (
          <Link
            href="/pixels"
            className="block rounded-[var(--radius)] focus-visible:outline-2 focus-visible:outline-ring"
          >
            <GlassCard hover className="flex h-full items-center gap-3 p-4">
              <span
                className="flex size-10 shrink-0 items-center justify-center rounded-lg"
                style={{ backgroundColor: 'rgba(37,244,238,.1)' }}
                aria-hidden="true"
              >
                {emqSummary.dir === 'down' ? (
                  <TrendingUp className="size-5 rotate-180 text-warning" />
                ) : (
                  <TrendingUp
                    className={emqSummary.dir === 'up' ? 'size-5 text-success' : 'size-5 text-brand-cyan'}
                  />
                )}
              </span>
              <div className="min-w-0">
                <p className="label-mono">Qualidade dos eventos · EMQ</p>
                <p className="font-mono text-2xl font-semibold tabular-nums text-foreground">
                  {emqSummary.recent.toFixed(1)}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {emqSummary.alerts > 0
                    ? `${emqSummary.alerts} pixel(s) em alerta — ver detalhe`
                    : 'média dos pixels ativos — ver detalhe'}
                </p>
              </div>
            </GlassCard>
          </Link>
        ) : (
          <GlassCard className="flex items-center gap-3 p-4">
            <span
              className="flex size-10 shrink-0 items-center justify-center rounded-lg"
              style={{ backgroundColor: NEUTRAL_BG }}
              aria-hidden="true"
            >
              <TrendingUp className="size-5" style={{ color: NEUTRAL }} />
            </span>
            <div className="min-w-0">
              <p className="label-mono">Qualidade dos eventos · EMQ</p>
              <p className="text-sm text-muted-foreground text-pretty">
                Sem dados de pixel ainda.
              </p>
            </div>
          </GlassCard>
        )}
      </section>
    </div>
  )
}
