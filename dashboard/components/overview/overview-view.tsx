'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useOncePerSession } from '@/lib/motion'
import { ShieldAlert } from 'lucide-react'
import { useStats, useEmqTrend, useAdsStatus, useAdsRoas } from '@/lib/api'
import { useAfterFirstPaint } from '@/lib/use-after-first-paint'
import { aggregate, money, periodStart } from '@/lib/metrics'
import { countryFlag, fmtPercent } from '@/lib/format'
import { countryName } from '@/lib/countries'
import type { Period } from '@/lib/types'
import { CountUp } from '@/components/count-up'
import { Skeleton } from '@/components/skeleton'
import { GlassCard } from '@/components/glass-card'
import { TopSources } from './top-sources'
import { DecideStrip } from './decide-strip'
import { AdsOverviewCard } from './ads-card'
import { ExportSummaryButton } from './export-summary'
import { TvModeButton } from './tv-mode'
import { PeriodPicker } from './period-picker'
import { HealthDot } from './health-dot'
import { HeroGlobe } from './hero-globe'
import { LiveFeed } from './live-feed'
import { FunnelCompact } from './funnel-compact'
import dynamic from 'next/dynamic'
const LeadsTable = dynamic(() => import('@/components/funnel/leads-table').then(m => m.LeadsTable), {
  ssr: false,
  loading: () => <Skeleton className="h-[400px] w-full rounded-2xl" />
})// Fase 3: gasto de Ads já vem em unidade principal (não centavos), diferente do
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

const PERIOD_LABEL: Record<Period, string> = {
  today: 'hoje',
  '7d': '7 dias',
  '30d': '30 dias',
  all: 'tudo',
}

// Item 3 (Refinamento): período SEMPRE começa em "hoje". A migração antiga
// (PERIOD_MIGRATION_KEY) foi removida — lógica simplificada.
// Precedência: query string → localStorage → default 'today'.
function initialPeriod(): Period {
  if (typeof window === 'undefined') return 'today'
  const fromUrl = new URLSearchParams(window.location.search).get('p') as Period | null
  if (fromUrl && PERIODS.includes(fromUrl)) return fromUrl
  // Fase 5: NÃO restaura do localStorage no primeiro load — SEMPRE "hoje".
  // O localStorage só persiste dentro da mesma sessão (setPeriod salva).
  return 'today'
}

// Redesign: KPI do hero — sem card, sem ícone, sem borda. Só o label minúsculo
// em caixa alta + valor grande em mono. whitespace-nowrap garante que valores
// monetários NUNCA truncam (bug do "€ 11.041,0(").
function HeroKpi({
  label,
  value,
  dim,
  sensitive,
  sub,
  colorClass,
}: {
  label: string
  value: React.ReactNode
  /** true = valor sem dado/zero → cinza apagado */
  dim?: boolean
  /** true = borrado no modo apresentação */
  sensitive?: boolean
  /** Linha secundária discreta (ex.: receita em outras moedas). */
  sub?: React.ReactNode
  /** Classe de cor personalizada para o valor principal (ex: text-brand-cyan) */
  colorClass?: string
}) {
  return (
    <div className="min-w-0">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/45">
        <span className="text-gradient-metallic">{label}</span>
      </p>
      <p
        className={`mt-1 whitespace-nowrap font-mono text-xl font-bold leading-none tabular-nums sm:text-2xl lg:text-3xl ${
          dim ? 'text-muted-foreground' : colorClass || 'text-foreground'
        }`}
        {...(sensitive ? { 'data-sensitive': true } : {})}
      >
        {value}
      </p>
      {sub ? (
        <p
          className="mt-1.5 whitespace-nowrap font-mono text-[11px] font-medium leading-none tabular-nums text-white/45"
          {...(sensitive ? { 'data-sensitive': true } : {})}
        >
          {sub}
        </p>
      ) : null}
    </div>
  )
}

export function OverviewView() {
  const [period, setPeriodState] = useState<Period>(initialPeriod)
  const { data, error, isLoading } = useStats()
  // A1.1: entrada orquestrada roda UMA vez por sessão — navegações seguintes
  // pulam a cascata (os cards aparecem direto, sem re-animar).
  const firstEnter = useOncePerSession('overview-enter')

  // Fase 3: TikTok Ads alimenta os KPIs "Gasto" e "ROAS". Só resolve
  // pós-first-paint (chave null até lá — NÃO entra no orçamento de requests do
  // load) e só quando a conta está conectada. Sem Ads, mostram "—".
  const afterFirstPaint = useAfterFirstPaint()
  const { data: adsStatus } = useAdsStatus(afterFirstPaint)
  const adAccountId = adsStatus?.advertiserId || ''
  const adsConnected = Boolean(adsStatus?.enabled && adsStatus?.connected && adAccountId)
  const adsRange = useMemo(() => periodToAdsRange(period), [period])
  const { data: roas } = useAdsRoas(adsConnected, adAccountId, adsRange)

  // Rodapé "EMQ" — mesma chave SWR do popover de saúde (dedup, zero request).
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

  const { cur } = useMemo(() => {
    if (!data) return { cur: null }
    // Item 2: receita FILTRADA pelo período — aggregate já faz o corte correto.
    return { cur: aggregate(data, periodStart(period)) }
  }, [data, period])

  // Países dos leads de HOJE — colorem o globo (mesma história do mundo real).
  const todayCountries = useMemo(() => {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const t = start.getTime()
    const byCountry = new Map<string, number>()
    for (const l of data?.leads ?? []) {
      const at = new Date(l.at).getTime()
      if (!Number.isFinite(at) || at < t) continue
      if (l.country) byCountry.set(l.country, (byCountry.get(l.country) ?? 0) + 1)
    }
    return Array.from(byCountry, ([code, count]) => ({
      code,
      name: countryName(code),
      count,
      purchased: 0,
    }))
  }, [data])

  // Lead mais recente (qualquer período) — o globo usa para distinguir
  // "tracking nunca configurado" (null) de "só está quieto agora".
  const lastLeadAt = useMemo(() => {
    let max = ''
    for (const l of data?.leads ?? []) {
      if (l.at && l.at > max) max = l.at
    }
    return max || null
  }, [data])

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
    // Skeleton mimético — silhueta do novo layout imersivo
    return (
      <div className="flex flex-col gap-4" aria-busy="true" aria-label="Carregando métricas">
        <div className="flex justify-end">
          <Skeleton className="h-8 w-64 rounded-full" />
        </div>
        {/* hero: globo full-width com overlays */}
        <div className="relative overflow-hidden rounded-2xl border border-white/[0.06] bg-[#040406]" style={{ minHeight: 680 }}>
          <div className="flex items-center justify-center p-16">
            <Skeleton className="aspect-square w-full max-w-[440px] rounded-full" />
          </div>
          {/* overlay esquerdo */}
          <div className="absolute left-6 top-6 flex flex-col gap-6">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex flex-col gap-2">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-9 w-36" />
              </div>
            ))}
          </div>
          {/* overlay direito */}
          <div className="absolute right-6 top-6 flex flex-col gap-3">
            <Skeleton className="h-3 w-28" />
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center justify-between gap-8">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-3.5 w-12" />
              </div>
            ))}
          </div>
        </div>
        {/* funil | campanhas */}
        <div className="grid gap-4 lg:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="glass flex flex-col gap-3 p-5">
              <Skeleton className="h-3 w-24" />
              {[0, 1, 2, 3].map((j) => (
                <div key={j} className="flex items-center gap-3">
                  <Skeleton className="h-3.5 w-20" />
                  <Skeleton className="h-5 flex-1 rounded" />
                  <Skeleton className="h-3.5 w-10" />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    )
  }

  const revCents = cur.rev[cur.mainCur] || 0
  // F2 (guarda de moeda): conta de anúncio em EUR e receita em BRL → dividir
  // um pelo outro dá um "ROAS" sem significado. O servidor já zera o roas e
  // manda a flag; aqui só decidimos a mensagem. Fallback local para respostas
  // antigas em cache (sem a flag).
  const currencyMismatch = Boolean(
    roas &&
      (roas.currencyMismatch ??
        (roas.roas !== null &&
          roas.currency &&
          revCents > 0 &&
          cur.mainCur !== roas.currency.toUpperCase())),
  )
  // Receita em OUTRAS moedas (além da dominante). Sem isto o card mostrava só a
  // moeda principal e escondia, por ex., uma venda em BRL — o que fazia a receita
  // "parecer travada" ao trocar de período quando a diferença era noutra moeda.
  // Não somamos moedas diferentes (câmbio distinto): listamos cada uma.
  const otherRev = Object.entries(cur.rev)
    .filter(([c, v]) => c !== cur.mainCur && v > 0)
    .sort((a, b) => b[1] - a[1])
  const attempts = cur.sales + cur.failed
  const hasGeo = cur.countries.length > 0
  const hasSources = cur.topCampaigns.length > 0 || cur.topLinks.length > 0

  const revSeries = cur.series.map((s) => s.revenue)

  return (
    /* A1.5: fundo com profundidade. A1.1: cascata só na primeira entrada. */
    <div className={`overview-depth mx-auto max-w-[1600px] flex flex-col gap-4 ${firstEnter ? 'stagger-fade' : ''}`}>
      {/* Redesign: barra compacta de controles — o shell Header já traz kicker +
          título + badge AO VIVO. Sem card "Operacional" separado (a saúde vive
          no rodapé). Item 171: sticky em mobile. */}
      <div
        className="picker-sticky flex items-center justify-end gap-2"
        data-tour="period"
        style={{ ['--i' as string]: 0 }}
      >
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



      {/* ── BLOCO HERO IMERSIVO — desktop (lg+): globo full-bleed com KPIs e
          LiveFeed sobrepostos em glassmorphism. Mobile (<lg): coluna real —
          globo compacto no topo, KPIs e feed empilhados abaixo, SEM
          sobreposição (fix do bug de overlap no iPhone). Items 4-9. ────── */}
      <section
        aria-label="Painel principal"
        data-tour="chart"
        className="hero-globe-section relative flex flex-col overflow-hidden rounded-2xl border border-white/[0.06] lg:block"
        style={{ ['--i' as string]: 1 }}
      >


        {/* Globo — mobile: bloco compacto (~340px) no topo do fluxo;
            desktop: fundo absoluto ocupando 100% do painel */}
        <div className="relative z-0 h-[340px] w-full overflow-hidden lg:absolute lg:inset-0 lg:h-auto lg:overflow-visible">
          <HeroGlobe countries={todayCountries} lastLeadAt={lastLeadAt} />
        </div>

        {/* KPIs — mobile: painel em fluxo (grid 2 col) abaixo do globo;
            desktop: overlay glassmorphism absoluto (item 8) */}
        <div
          className="hero-overlay-left px-3 pt-3 lg:pointer-events-none lg:absolute lg:left-8 lg:top-8 lg:z-10 lg:p-0"
          data-tour="kpis"
        >
          <div className="hero-glass-panel grid grid-cols-2 gap-4 p-4 lg:pointer-events-auto lg:flex lg:flex-col lg:gap-10 lg:p-5">
            {/* Mobile: Receita ocupa a linha inteira do grid; desktop:
                lg:contents remove o wrapper e preserva o flex-col original */}
            <div className="col-span-2 min-w-0 lg:contents">
            <HeroKpi
              label="Receita"
              dim={revCents === 0}
              sensitive
              colorClass="text-brand-cyan"
              value={<CountUp value={revCents} format={(v) => money(Math.round(v), cur.mainCur)} />}
              sub={
                [
                  otherRev.length
                    ? '+ ' + otherRev.map(([c, v]) => money(v, c)).join('  +  ')
                    : null,
                  // F2: receita com purchased=0 no funil era "divergência" —
                  // agora declara a base: vendas órfãs (webhook sem lead)
                  cur.orphanPurchases > 0
                    ? `inclui ${cur.orphanPurchases} ${cur.orphanPurchases === 1 ? 'venda não rastreada' : 'vendas não rastreadas'}`
                    : null,
                  cur.suspectSales > 0
                    ? `${cur.suspectSales} ${cur.suspectSales === 1 ? 'valor atípico' : 'valores atípicos'} (fora do ticket médio)`
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ') || undefined
              }
            />
            </div>
            <HeroKpi
              label="Gasto"
              dim={!roas}
              sensitive
              value={roas ? fmtAdsMoney(roas.spend, roas.currency) : '—'}
            />
            {/* F2: moeda do gasto ≠ moeda da receita → ROAS seria número
                errado (R$ ÷ US$). Mostra o porquê em vez de calcular. */}
            <HeroKpi
              label="ROAS"
              dim={!roas || roas.roas === null || currencyMismatch}
              colorClass="text-success"
              value={
                currencyMismatch
                  ? '—'
                  : roas && roas.roas !== null
                    ? roas.roas.toFixed(2).replace('.', ',')
                    : '—'
              }
              sub={
                currencyMismatch
                  ? `moedas diferentes (gasto ${roas?.currency} × receita ${roas?.revenueCurrency || cur.mainCur})`
                  : undefined
              }
            />
          </div>
        </div>

        {/* CHEGANDO AGORA — mobile: bloco em fluxo, largura total, abaixo dos
            KPIs; desktop: overlay glassmorphism absoluto (item 9) */}
        <div className="hero-overlay-right px-3 pb-3 pt-3 lg:pointer-events-none lg:absolute lg:bottom-12 lg:right-8 lg:z-10 lg:p-0">
          <div className="hero-glass-panel p-4 lg:pointer-events-auto lg:max-w-[280px] lg:p-5">
            <LiveFeed leads={data?.leads ?? []} />
          </div>
        </div>
      </section>

      {/* ── F4: decisões pendentes + ROAS de Ads — abaixo da dobra, gated por
          adsConnected (quem não usa Ads não vê nem paga a request). O card
          reusa o MESMO range/chave SWR do hook do hero → dedup, +0 requests;
          a faixa é o +1 request declarado no plano. Boundary próprio na faixa:
          se quebrar, o globo não cai junto. ──────────────────────────── */}
      {adsConnected ? (
        <section
          aria-label="Decisões pendentes e desempenho de anúncios"
          className="grid items-start gap-4 lg:grid-cols-2"
          style={{ ['--i' as string]: 2 }}
        >
          <DecideStrip active={adsConnected && afterFirstPaint} />
          <AdsOverviewCard range={adsRange} rangeLabel={PERIOD_LABEL[period]} />
        </section>
      ) : null}

      {/* ── Abaixo: FUNIL | TOP CAMPANHAS — 2 colunas, altura igual,
          governadas pelo MESMO PeriodPicker ─────────────────────────── */}
      <section
        aria-label="Funil e origem dos leads"
        className={`grid items-stretch gap-4 ${hasSources ? 'lg:grid-cols-2' : ''}`}
        style={{ ['--i' as string]: 3 }}
      >
        <FunnelCompact metrics={cur} periodLabel={PERIOD_LABEL[period]} />
        {hasSources && <TopSources campaigns={cur.topCampaigns} links={cur.topLinks} />}
      </section>

      {/* ── Abaixo: Integração do Funil (Leads Table) ─────────────────── */}
      <section
        aria-label="Tabela de Leads Integrada"
        className="animate-in-up delay-3 w-full"
        style={{ ['--i' as string]: 4 }}
      >
        <LeadsTable leads={data?.leads ?? []} periodStart={periodStart(period)} />
      </section>

      {/* ── Rodapé — Países ativos · EMQ, em linha, discreto ───────────── */}
      <section
        aria-label="Presença e qualidade dos eventos"
        className="glass animate-in-up delay-4 inline-flex flex-wrap items-center gap-x-5 gap-y-2 rounded-full px-5 py-2.5 font-mono text-[11px] tabular-nums text-muted-foreground self-start"
        style={{ ['--i' as string]: 5 }}
      >
        <HealthDot />
        <span>
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/40">
            Países ativos{' '}
          </span>
          <span className="text-foreground">{cur.countries.length}</span>
          {hasGeo ? (
            <span className="ml-2 text-faint">
              {cur.countries
                .slice(0, 4)
                .map((c) => (
                  <span key={c.code} className="mr-2">
                    <span className="drop-shadow-md mr-1">{countryFlag(c.code)}</span>
                    {c.code}
                  </span>
                ))}
            </span>
          ) : null}
        </span>
        {emqSummary ? (
          <Link href="/conversions?tab=pixels" className="transition-colors hover:text-foreground">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/40">
              EMQ{' '}
            </span>
            <span className={emqSummary.alerts > 0 ? 'text-error' : 'text-foreground'}>
              {emqSummary.recent.toFixed(1)}
              {emqSummary.dir === 'up' ? ' \u2191' : emqSummary.dir === 'down' ? ' \u2193' : ''}
            </span>
            {emqSummary.alerts > 0 ? (
              <span className="ml-1 text-error">
                · {emqSummary.alerts} alerta{emqSummary.alerts === 1 ? '' : 's'}
              </span>
            ) : null}
          </Link>
        ) : null}
      </section>
    </div>
  )
}
