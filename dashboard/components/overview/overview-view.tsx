'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useOncePerSession } from '@/lib/motion'
import { ShieldAlert } from 'lucide-react'
import { useStats, useEmqTrend, useAdsStatus, useAdsRoas } from '@/lib/api'
import { useAfterFirstPaint } from '@/lib/use-after-first-paint'
import { aggregate, money, periodStart } from '@/lib/metrics'
import { countryFlag, fmtPercent } from '@/lib/format'
import type { Period } from '@/lib/types'
import { CountUp } from '@/components/count-up'
import { Skeleton } from '@/components/skeleton'
import { GlassCard } from '@/components/glass-card'
import { TopSources } from './top-sources'
import { ExportSummaryButton } from './export-summary'
import { TvModeButton } from './tv-mode'
import { OnboardingChecklist } from './onboarding-checklist'
import { PeriodPicker } from './period-picker'
import { HealthDot } from './health-dot'
import { HeroGlobe } from './hero-globe'
import { LiveFeed } from './live-feed'
import { FunnelCompact } from './funnel-compact'

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

const PERIOD_LABEL: Record<Period, string> = {
  today: 'hoje',
  '7d': '7 dias',
  '30d': '30 dias',
  all: 'tudo',
}

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

// Redesign: KPI do hero — sem card, sem ícone, sem borda. Só o label minúsculo
// em caixa alta + valor grande em mono. whitespace-nowrap garante que valores
// monetários NUNCA truncam (bug do "€ 11.041,0(").
function HeroKpi({
  label,
  value,
  dim,
  sensitive,
}: {
  label: string
  value: React.ReactNode
  /** true = valor sem dado/zero → cinza apagado */
  dim?: boolean
  /** true = borrado no modo apresentação */
  sensitive?: boolean
}) {
  return (
    <div className="min-w-0">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/45">
        {label}
      </p>
      <p
        className={`mt-1 whitespace-nowrap font-mono text-3xl font-bold leading-none tabular-nums xl:text-4xl ${
          dim ? 'text-muted-foreground' : 'text-foreground'
        }`}
        {...(sensitive ? { 'data-sensitive': true } : {})}
      >
        {value}
      </p>
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
    // O hero não exibe deltas (spec: label + valor, nada mais).
    return { cur: aggregate(data, periodStart(period)) }
  }, [data, period])

  // Números DENTRO do globo: leads que entraram HOJE (fixo, independente do
  // período selecionado — o label diz "LEADS HOJE") + países distintos deles.
  const { leadsToday, countriesToday } = useMemo(() => {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const t = start.getTime()
    let n = 0
    const set = new Set<string>()
    for (const l of data?.leads ?? []) {
      const at = new Date(l.at).getTime()
      if (!Number.isFinite(at) || at < t) continue
      n++
      if (l.country) set.add(l.country)
    }
    return { leadsToday: n, countriesToday: set.size }
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
    // Itens 58/59: skeleton mimético — silhueta do NOVO layout (hero único)
    return (
      <div className="flex flex-col gap-4" aria-busy="true" aria-label="Carregando métricas">
        <div className="flex justify-end">
          <Skeleton className="h-8 w-64 rounded-full" />
        </div>
        {/* hero: KPIs | globo | feed */}
        <div className="grid gap-6 rounded-xl border border-white/[0.06] bg-[#060608] p-6 lg:grid-cols-[1fr_1.35fr_1fr] lg:items-center lg:p-8">
          <div className="flex flex-col gap-8">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex flex-col gap-2">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-9 w-36" />
              </div>
            ))}
          </div>
          <div className="mx-auto aspect-square w-full max-w-[560px]">
            <Skeleton className="size-full rounded-full" />
          </div>
          <div className="flex flex-col gap-3">
            <Skeleton className="h-3 w-28" />
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center justify-between">
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
  const attempts = cur.sales + cur.failed
  const hasGeo = cur.countries.length > 0
  const hasSources = cur.topCampaigns.length > 0 || cur.topLinks.length > 0
  // Item 288: onboarding usa o HISTÓRICO TODO (não o período filtrado) —
  // trocar para "hoje" numa conta ativa não pode ressuscitar o checklist.
  const everVisited = (data?.leads?.length ?? 0) > 0
  const everSold = (data?.events ?? []).some((e) => e.type === 'sale')
  const isOnboarding = !everVisited || !everSold

  const revSeries = cur.series.map((s) => s.revenue)

  return (
    /* A1.5: fundo com profundidade. A1.1: cascata só na primeira entrada. */
    <div className={`overview-depth flex flex-col gap-4 ${firstEnter ? 'stagger-fade' : ''}`}>
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

      {/* ── BLOCO HERO — um único painel: fundo mais escuro que a página,
          borda sutil, radius 12px, largura total. Grid 1fr | 1.35fr | 1fr,
          colunas separadas por ESPAÇO, não por linha. ─────────────────── */}
      <section
        aria-label="Painel principal"
        data-tour="chart"
        className="grid gap-8 rounded-xl border border-white/[0.06] bg-[#060608] p-5 sm:p-6 lg:grid-cols-[1fr_1.35fr_1fr] lg:items-center lg:gap-10 lg:p-8"
        style={{ ['--i' as string]: 1 }}
      >
        {/* Esquerda — três KPIs empilhados: label + valor. Nada mais. */}
        <div className="flex flex-row flex-wrap gap-8 lg:flex-col lg:gap-10" data-tour="kpis">
          <HeroKpi
            label="Receita"
            dim={revCents === 0}
            sensitive
            value={<CountUp value={revCents} format={(v) => money(Math.round(v), cur.mainCur)} />}
          />
          <HeroKpi
            label="Gasto"
            dim={!roas}
            sensitive
            value={roas ? fmtAdsMoney(roas.spend, roas.currency) : '—'}
          />
          <HeroKpi
            label="ROAS"
            dim={!roas || roas.roas === null}
            value={
              roas && roas.roas !== null ? roas.roas.toFixed(2).replace('.', ',') : '—'
            }
          />
        </div>

        {/* Centro — o globo, circular, com os números DENTRO dele */}
        <HeroGlobe leadsToday={leadsToday} countriesToday={countriesToday} />

        {/* Direita — CHEGANDO AGORA: últimos leads de /api/stats (poll de 12s,
            zero request nova) */}
        <LiveFeed leads={data?.leads ?? []} />
      </section>

      {/* ── Abaixo: FUNIL | TOP CAMPANHAS — 2 colunas, altura igual,
          governadas pelo MESMO PeriodPicker ─────────────────────────── */}
      <section
        aria-label="Funil e origem dos leads"
        className={`grid items-stretch gap-4 ${hasSources ? 'lg:grid-cols-2' : ''}`}
        style={{ ['--i' as string]: 2 }}
      >
        <FunnelCompact metrics={cur} periodLabel={PERIOD_LABEL[period]} />
        {hasSources && <TopSources campaigns={cur.topCampaigns} links={cur.topLinks} />}
      </section>

      {/* ── Rodapé — Países ativos · EMQ, em linha, discreto ───────────── */}
      <section
        aria-label="Presença e qualidade dos eventos"
        className="flex flex-wrap items-center gap-x-5 gap-y-2 px-1 font-mono text-[11px] tabular-nums text-muted-foreground"
        style={{ ['--i' as string]: 3 }}
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
                .map((c) => `${countryFlag(c.code)} ${c.code}`)
                .join('  ')}
            </span>
          ) : null}
        </span>
        {emqSummary ? (
          <Link href="/pixels" className="transition-colors hover:text-foreground">
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
