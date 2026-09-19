'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import {
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  CircleAlert,
  Route,
  ShieldCheck,
  Sparkles,
  Target,
  Users,
} from 'lucide-react'
import { useAccountSettings, useOverviewAnalytics, useOverviewHealth } from '@/lib/api'
import { useOverviewPeriod } from '@/lib/overview-period'
import { fmtDelta, fmtInt, fmtPercent, formatMoney } from '@/lib/format'
import { GlassCard } from '@/components/glass-card'
import { Skeleton } from '@/components/skeleton'
import { ErrorState } from '@/components/error-state'
import { AnomaliesPanel } from './anomalies-panel'

type InsightTab = 'performance' | 'funnel' | 'sources' | 'anomalies' | 'quality'

function normalizeTab(value: string | null): InsightTab {
  if (value === 'funnel' || value === 'sources' || value === 'anomalies' || value === 'quality') return value
  return 'performance'
}

function relativeDelta(current: number, previous: number | null | undefined): number | null {
  if (previous == null || !Number.isFinite(previous)) return null
  if (previous === 0) return current === 0 ? 0 : null
  return ((current - previous) / Math.abs(previous)) * 100
}

function conversion(purchased: number, visits: number): number {
  if (!visits) return 0
  return (purchased / visits) * 100
}

function DeltaBadge({ value, suffix = '%' }: { value: number | null; suffix?: '%' | 'pp' }) {
  if (value == null) {
    return <span className="text-[10px] text-muted-foreground">sem base anterior</span>
  }
  const positive = value > 0
  const negative = value < 0
  const label = suffix === 'pp'
    ? `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} p.p.`
    : fmtDelta(value)

  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-medium ${
      positive ? 'text-success' : negative ? 'text-warning' : 'text-muted-foreground'
    }`}>
      {positive ? <ArrowUpRight className="size-3" aria-hidden="true" /> : negative ? <ArrowDownRight className="size-3" aria-hidden="true" /> : null}
      {label}
    </span>
  )
}

function MetricCard({
  label,
  value,
  detail,
  delta,
  deltaSuffix,
  privateValue = false,
}: {
  label: string
  value: string
  detail: string
  delta: number | null
  deltaSuffix?: '%' | 'pp'
  privateValue?: boolean
}) {
  return (
    <GlassCard className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
        <DeltaBadge value={delta} suffix={deltaSuffix} />
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight text-foreground" data-private={privateValue ? 'true' : undefined}>{value}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{detail}</p>
    </GlassCard>
  )
}

function Signal({
  tone,
  title,
  detail,
}: {
  tone: 'success' | 'warning' | 'neutral'
  title: string
  detail: string
}) {
  const toneClass = tone === 'success'
    ? 'border-success/20 bg-success/[0.06]'
    : tone === 'warning'
      ? 'border-warning/20 bg-warning/[0.06]'
      : 'border-border/60 bg-secondary/10'
  const iconClass = tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-warning' : 'text-muted-foreground'

  return (
    <div className={`rounded-2xl border p-4 ${toneClass}`}>
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-black/15 ${iconClass}`}>
          {tone === 'success' ? <CheckCircle2 className="size-4" aria-hidden="true" /> : tone === 'warning' ? <CircleAlert className="size-4" aria-hidden="true" /> : <Sparkles className="size-4" aria-hidden="true" />}
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-foreground">{title}</p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{detail}</p>
        </div>
      </div>
    </div>
  )
}

function CoverageRow({ label, rate, detail }: { label: string; rate: number | null; detail: string }) {
  const safeRate = Math.max(0, Math.min(100, rate ?? 0))
  return (
    <div className="rounded-2xl border border-border/60 bg-secondary/10 p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-foreground">{label}</span>
        <span className="text-xs font-semibold tabular-nums text-foreground">{rate == null ? '—' : fmtPercent(rate)}</span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-secondary/70">
        <div className="h-full rounded-full bg-brand-cyan transition-[width]" style={{ width: `${safeRate}%` }} />
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">{detail}</p>
    </div>
  )
}

export function InsightsView() {
  const searchParams = useSearchParams()
  const tab = normalizeTab(searchParams.get('tab'))
  const { period } = useOverviewPeriod()
  const { data: accountSettings } = useAccountSettings()
  const accountTimeZone = accountSettings?.timezone || 'America/Sao_Paulo'
  const {
    data: analytics,
    error: analyticsError,
    isLoading,
    isValidating,
    mutate: mutateAnalytics,
  } = useOverviewAnalytics(period, accountTimeZone, true)
  const {
    data: health,
    error: healthError,
    mutate: mutateHealth,
  } = useOverviewHealth(true)

  const computed = useMemo(() => {
    if (!analytics?.current) return null
    const current = analytics.current
    const previous = analytics.previous
    const currentRevenue = current.rev[current.mainCur] || 0
    const previousRevenue = previous?.mainCur === current.mainCur ? previous.rev[current.mainCur] || 0 : null
    const currentConversion = conversion(current.purchased, current.visits)
    const previousConversion = previous ? conversion(previous.purchased, previous.visits) : null

    const stages = [
      { key: 'visits', label: 'Entrada', value: current.visits, icon: Users },
      { key: 'checkout', label: 'Checkout', value: current.reachedCheckout, icon: Target },
      { key: 'payment', label: 'Pagamento', value: current.paymentStarted, icon: Route },
      { key: 'purchase', label: 'Compra', value: current.purchased, icon: CheckCircle2 },
    ]

    const transitions = stages.slice(1).map((stage, index) => {
      const from = stages[index]
      const rate = from.value > 0 ? (stage.value / from.value) * 100 : 0
      return {
        from: from.label,
        to: stage.label,
        rate,
        drop: Math.max(0, 100 - rate),
        lost: Math.max(0, from.value - stage.value),
      }
    })
    const bottleneck = [...transitions].sort((a, b) => b.drop - a.drop)[0] ?? null

    const campaigns = [...(current.topCampaigns || [])]
      .filter(item => item.leads > 0)
      .sort((a, b) => b.purchased - a.purchased || b.conv - a.conv || b.leads - a.leads)
      .slice(0, 10)

    const campaignPurchases = campaigns.reduce((sum, item) => sum + item.purchased, 0)
    const concentration = campaignPurchases > 0 && campaigns[0]
      ? (campaigns[0].purchased / campaignPurchases) * 100
      : null

    return {
      current,
      previous,
      currentRevenue,
      previousRevenue,
      currentConversion,
      previousConversion,
      stages,
      transitions,
      bottleneck,
      campaigns,
      concentration,
    }
  }, [analytics])

  if (analyticsError && !analytics) {
    return (
      <ErrorState
        title="Não foi possível montar a Inteligência"
        description="Os dados analíticos não responderam. Tente carregar novamente."
        onRetry={() => void mutateAnalytics()}
        retrying={isValidating}
      />
    )
  }

  if (isLoading || !computed) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true" aria-label="Carregando Inteligência">
        <Skeleton className="h-20 rounded-2xl" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map(index => <Skeleton key={index} className="h-32 rounded-2xl" />)}
        </div>
        <Skeleton className="h-72 rounded-2xl" />
      </div>
    )
  }

  const { current, previous } = computed
  const revenueDelta = relativeDelta(computed.currentRevenue, computed.previousRevenue)
  const purchaseDelta = relativeDelta(current.purchased, previous?.purchased)
  const conversionDelta = previous ? computed.currentConversion - (computed.previousConversion ?? 0) : null
  const approvalDelta = previous ? current.approval - previous.approval : null
  const healthActions = health?.actions ?? []

  const revenueSignalTone = revenueDelta == null ? 'neutral' : revenueDelta >= 0 ? 'success' : 'warning'
  const revenueSignalTitle = revenueDelta == null
    ? 'Comparação ainda sem base'
    : revenueDelta >= 0
      ? 'Faturamento avançou'
      : 'Faturamento recuou'
  const revenueSignalDetail = revenueDelta == null
    ? 'O período anterior não possui uma base comparável na mesma moeda.'
    : `${fmtDelta(revenueDelta)} contra o período anterior, mantendo a moeda principal em ${current.mainCur}.`

  return (
    <div className="flex flex-col gap-5">
      {(analyticsError || healthError) ? (
        <button
          type="button"
          className="btn-ghost self-start text-xs text-warning"
          onClick={() => void Promise.all([mutateAnalytics(), mutateHealth()])}
        >
          Alguns sinais não foram atualizados · tentar novamente
        </button>
      ) : null}

      <section className="flex flex-col gap-2" aria-labelledby="insights-title">
        <div className="inline-flex w-fit items-center gap-2 rounded-full border border-brand-cyan/20 bg-brand-cyan/10 px-3 py-1 text-[11px] font-medium text-brand-cyan">
          <Sparkles className="size-3.5" aria-hidden="true" />
          Leitura automática
        </div>
        <h1 id="insights-title" className="text-2xl font-semibold tracking-tight text-foreground">Inteligência</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Diagnósticos do período atual usando os mesmos dados da Visão Geral, sem duplicar rastreamento.
        </p>
      </section>

      {tab === 'performance' ? (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Indicadores comparativos">
            <MetricCard
              label="Faturamento"
              value={formatMoney(computed.currentRevenue, current.mainCur)}
              detail="Receita confirmada na moeda principal."
              delta={revenueDelta}
              privateValue
            />
            <MetricCard
              label="Compras"
              value={fmtInt(current.purchased)}
              detail="Compras rastreadas no período."
              delta={purchaseDelta}
            />
            <MetricCard
              label="Conversão"
              value={fmtPercent(computed.currentConversion)}
              detail="Visitas que chegaram até compra."
              delta={conversionDelta}
              deltaSuffix="pp"
            />
            <MetricCard
              label="Aprovação"
              value={fmtPercent(current.approval)}
              detail="Pagamentos aprovados entre as tentativas."
              delta={approvalDelta}
              deltaSuffix="pp"
            />
          </section>

          <GlassCard className="p-4 sm:p-5">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-brand-cyan" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-foreground">Leitura do período</h2>
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-3">
              <Signal tone={revenueSignalTone} title={revenueSignalTitle} detail={revenueSignalDetail} />
              <Signal
                tone={computed.bottleneck && computed.bottleneck.drop >= 50 ? 'warning' : 'neutral'}
                title={computed.bottleneck ? `Maior perda: ${computed.bottleneck.from} → ${computed.bottleneck.to}` : 'Funil sem base suficiente'}
                detail={computed.bottleneck ? `${fmtPercent(computed.bottleneck.drop)} não avançaram nessa transição (${fmtInt(computed.bottleneck.lost)} pessoas).` : 'Ainda não há volume suficiente para localizar um gargalo.'}
              />
              <Signal
                tone={healthActions.length ? 'warning' : 'success'}
                title={healthActions.length ? `${fmtInt(healthActions.length)} ponto${healthActions.length === 1 ? '' : 's'} de atenção` : 'Rastreamento sem alertas'}
                detail={healthActions.length ? 'A aba Qualidade detalha cobertura, atribuição e ações recomendadas.' : 'A cobertura não gerou ações críticas ou de aviso neste momento.'}
              />
            </div>
          </GlassCard>
        </>
      ) : null}

      {tab === 'funnel' ? (
        <>
          <GlassCard className="p-4 sm:p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Jornada</p>
                <h2 className="mt-1 text-base font-semibold text-foreground">Onde o funil perde força</h2>
              </div>
              {computed.bottleneck ? (
                <span className="rounded-full border border-warning/20 bg-warning/10 px-2.5 py-1 text-[10px] font-medium text-warning">
                  gargalo: {computed.bottleneck.from.toLowerCase()}
                </span>
              ) : null}
            </div>

            <div className="mt-5 grid gap-3">
              {computed.stages.map((stage, index) => {
                const previousStage = index > 0 ? computed.stages[index - 1] : null
                const stepRate = previousStage && previousStage.value > 0 ? (stage.value / previousStage.value) * 100 : 100
                const relativeWidth = computed.stages[0].value > 0 ? (stage.value / computed.stages[0].value) * 100 : 0
                const Icon = stage.icon
                return (
                  <div key={stage.key} className="rounded-2xl border border-border/60 bg-secondary/10 p-4">
                    <div className="flex items-center gap-3">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-black/15 text-brand-cyan">
                        <Icon className="size-4" aria-hidden="true" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-xs font-medium text-foreground">{stage.label}</span>
                          <span className="text-sm font-semibold tabular-nums text-foreground">{fmtInt(stage.value)}</span>
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary/70">
                          <div className="h-full rounded-full bg-brand-cyan transition-[width]" style={{ width: `${Math.max(0, Math.min(100, relativeWidth))}%` }} />
                        </div>
                        <p className="mt-2 text-[10px] text-muted-foreground">
                          {index === 0 ? 'Base de entrada do período.' : `${fmtPercent(stepRate)} avançaram da etapa anterior.`}
                        </p>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </GlassCard>

          {computed.bottleneck ? (
            <Signal
              tone={computed.bottleneck.drop >= 50 ? 'warning' : 'neutral'}
              title={`${computed.bottleneck.from} → ${computed.bottleneck.to}`}
              detail={`É a maior perda proporcional do funil: ${fmtInt(computed.bottleneck.lost)} não avançaram, equivalente a ${fmtPercent(computed.bottleneck.drop)}.`}
            />
          ) : null}
        </>
      ) : null}

      {tab === 'sources' ? (
        <GlassCard className="overflow-hidden p-4 sm:p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Aquisição</p>
              <h2 className="mt-1 text-base font-semibold text-foreground">Campanhas identificadas</h2>
              <p className="mt-1 text-[11px] text-muted-foreground">Ranking por compras rastreadas via UTM.</p>
            </div>
            {computed.concentration != null ? (
              <div className="rounded-xl border border-border/60 bg-secondary/10 px-3 py-2 text-right">
                <p className="text-[9px] uppercase tracking-[0.16em] text-muted-foreground">Concentração #1</p>
                <p className="mt-0.5 text-sm font-semibold text-foreground">{fmtPercent(computed.concentration)}</p>
              </div>
            ) : null}
          </div>

          {computed.campaigns.length ? (
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[620px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-border/60 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                    <th className="pb-3 pr-4 font-medium">Campanha</th>
                    <th className="pb-3 px-4 text-right font-medium">Leads</th>
                    <th className="pb-3 px-4 text-right font-medium">Compras</th>
                    <th className="pb-3 pl-4 text-right font-medium">Conversão</th>
                  </tr>
                </thead>
                <tbody>
                  {computed.campaigns.map((campaign, index) => (
                    <tr key={campaign.name} className="border-b border-border/40 last:border-0">
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-3">
                          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-secondary/20 text-[10px] font-semibold text-muted-foreground">{index + 1}</span>
                          <span className="max-w-[360px] truncate text-xs font-medium text-foreground" title={campaign.name}>{campaign.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-xs tabular-nums text-muted-foreground">{fmtInt(campaign.leads)}</td>
                      <td className="px-4 py-3 text-right text-xs font-medium tabular-nums text-foreground">{fmtInt(campaign.purchased)}</td>
                      <td className="py-3 pl-4 text-right text-xs font-semibold tabular-nums text-brand-cyan">{fmtPercent(campaign.conv)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="mt-5 rounded-2xl border border-dashed border-border/70 p-8 text-center">
              <Target className="mx-auto size-5 text-muted-foreground" aria-hidden="true" />
              <p className="mt-2 text-sm font-medium text-foreground">Nenhuma campanha identificada</p>
              <p className="mt-1 text-xs text-muted-foreground">As UTMs válidas aparecem aqui assim que houver tráfego no período.</p>
            </div>
          )}
        </GlassCard>
      ) : null}

      {tab === 'anomalies' ? (
        <AnomaliesPanel
          current={current}
          previous={previous ?? null}
          health={health}
          currentRevenue={computed.currentRevenue}
          previousRevenue={computed.previousRevenue}
          bottleneck={computed.bottleneck}
          sourceConcentration={computed.concentration}
        />
      ) : null}

      {tab === 'quality' ? (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Qualidade da operação">
            <MetricCard
              label="Aprovação"
              value={fmtPercent(current.approval)}
              detail="Pagamentos aprovados no período."
              delta={approvalDelta}
              deltaSuffix="pp"
            />
            <MetricCard
              label="Reembolsos"
              value={fmtInt(current.refunds)}
              detail="Eventos de reembolso recebidos."
              delta={relativeDelta(current.refunds, previous?.refunds)}
            />
            <MetricCard
              label="Contestações"
              value={fmtInt(current.disputes)}
              detail="Disputas registradas no período."
              delta={relativeDelta(current.disputes, previous?.disputes)}
            />
            <MetricCard
              label="Alertas"
              value={fmtInt(healthActions.length)}
              detail="Ações geradas pela saúde do rastreamento."
              delta={null}
            />
          </section>

          <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <GlassCard className="p-4 sm:p-5">
              <div className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-brand-cyan" aria-hidden="true" />
                <h2 className="text-sm font-semibold text-foreground">Cobertura</h2>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <CoverageRow
                  label="Compras rastreadas"
                  rate={health?.coverage.purchases.rate ?? null}
                  detail={health ? `${fmtInt(health.coverage.purchases.tracked)} de ${fmtInt(health.coverage.purchases.total)} compras ligadas à jornada.` : 'Carregando cobertura de compras.'}
                />
                <CoverageRow
                  label="Atribuição"
                  rate={health?.coverage.attribution.rate ?? null}
                  detail={health ? `${fmtInt(health.coverage.attribution.identified)} de ${fmtInt(health.coverage.attribution.total)} visitas com origem identificada.` : 'Carregando atribuição.'}
                />
                <CoverageRow
                  label="Geografia"
                  rate={health?.coverage.geography.rate ?? null}
                  detail={health ? `${fmtInt(health.coverage.geography.identified)} de ${fmtInt(health.coverage.geography.total)} visitas com país identificado.` : 'Carregando geografia.'}
                />
                <CoverageRow
                  label="Hosts cobertos"
                  rate={health && health.coverage.hosts.total > 0 ? ((health.coverage.hosts.total - health.coverage.hosts.uncovered) / health.coverage.hosts.total) * 100 : health ? 100 : null}
                  detail={health ? `${fmtInt(health.coverage.hosts.uncovered)} host${health.coverage.hosts.uncovered === 1 ? '' : 's'} sem cobertura detectada.` : 'Carregando cobertura de hosts.'}
                />
              </div>
            </GlassCard>

            <GlassCard className="p-4 sm:p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Próximas ações</p>
                  <h2 className="mt-1 text-sm font-semibold text-foreground">O que merece atenção</h2>
                </div>
                <span className={`rounded-full border px-2.5 py-1 text-[10px] font-medium ${
                  healthActions.length ? 'border-warning/20 bg-warning/10 text-warning' : 'border-success/20 bg-success/10 text-success'
                }`}>
                  {healthActions.length ? fmtInt(healthActions.length) : 'ok'}
                </span>
              </div>

              <div className="mt-4 grid gap-2">
                {healthActions.length ? healthActions.slice(0, 6).map(action => (
                  <Link
                    key={action.id}
                    href={action.href}
                    className="group rounded-xl border border-border/60 bg-secondary/10 p-3 transition-colors hover:bg-secondary/20"
                  >
                    <div className="flex items-start gap-3">
                      <CircleAlert className={`mt-0.5 size-4 shrink-0 ${action.severity === 'critical' ? 'text-destructive' : 'text-warning'}`} aria-hidden="true" />
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-foreground group-hover:text-brand-cyan">{action.title}</p>
                        <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">{action.detail}</p>
                      </div>
                    </div>
                  </Link>
                )) : (
                  <div className="rounded-2xl border border-success/20 bg-success/[0.06] p-5 text-center">
                    <CheckCircle2 className="mx-auto size-5 text-success" aria-hidden="true" />
                    <p className="mt-2 text-sm font-medium text-foreground">Nenhuma ação pendente</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">A saúde do rastreamento não encontrou alertas acionáveis.</p>
                  </div>
                )}
              </div>
            </GlassCard>
          </div>
        </>
      ) : null}
    </div>
  )
}
