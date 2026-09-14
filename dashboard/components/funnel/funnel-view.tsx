'use client'

import { useMemo, useState } from 'react'
import {
  ArrowRight,
  CheckCircle2,
  DollarSign,
  Filter,
  MousePointerClick,
  ShoppingCart,
  Sparkles,
  Users,
  X,
} from 'lucide-react'
import { useAccountSettings, useStats } from '@/lib/api'
import { aggregate, periodStart, isMacroCampaign } from '@/lib/metrics'
import { GlassCard } from '@/components/glass-card'
import { ErrorState } from '@/components/error-state'
import { Skeleton } from '@/components/skeleton'
import { CountUp } from '@/components/count-up'
import { PeriodPicker } from '@/components/overview/period-picker'
import { LeadsTable } from './leads-table'
import { fmtPercent, formatMoney } from '@/lib/format'
import type { Period } from '@/lib/types'

function FunnelStat({
  label,
  value,
  detail,
  icon: Icon,
  tone = 'default',
}: {
  label: string
  value: string
  detail: string
  icon: typeof Users
  tone?: 'default' | 'accent' | 'success' | 'warning'
}) {
  const toneClass = tone === 'accent'
    ? 'border-brand-cyan/20 bg-brand-cyan/10 text-brand-cyan'
    : tone === 'success'
      ? 'border-success/20 bg-success/10 text-success'
      : tone === 'warning'
        ? 'border-warning/20 bg-warning/10 text-warning'
        : 'border-border/60 bg-secondary/15 text-foreground'

  return (
    <div className={`rounded-2xl border p-4 ${toneClass}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
          <p className="mt-2 text-xl font-semibold tracking-tight text-foreground">{value}</p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{detail}</p>
        </div>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-black/20 text-inherit">
          <Icon className="size-4.5" aria-hidden="true" />
        </span>
      </div>
    </div>
  )
}

export function FunnelView() {
  const { data, error, mutate, isLoading } = useStats()
  const { data: settings } = useAccountSettings()
  const accountTimeZone = settings?.timezone || 'America/Sao_Paulo'
  const [period, setPeriod] = useState<Period>('7d')

  const [linkFilter, setLinkFilter] = useState('')
  const [campaignFilter, setCampaignFilter] = useState('')

  const filterOptions = useMemo(() => {
    const links = new Set<string>()
    const campaigns = new Set<string>()
    for (const lead of data?.leads ?? []) {
      if (lead.linkSlug) links.add(lead.linkSlug)
      if (lead.utm?.campaign && !isMacroCampaign(lead.utm.campaign)) campaigns.add(lead.utm.campaign)
    }
    return {
      links: [...links].sort(),
      campaigns: [...campaigns].sort(),
    }
  }, [data])

  const hasFilter = Boolean(linkFilter || campaignFilter)
  const filteredData = useMemo(() => {
    if (!data || !hasFilter) return data
    return {
      ...data,
      leads: data.leads.filter(
        (lead) =>
          (!linkFilter || lead.linkSlug === linkFilter) &&
          (!campaignFilter || lead.utm?.campaign === campaignFilter),
      ),
    }
  }, [data, hasFilter, linkFilter, campaignFilter])

  const rangeStart = useMemo(
    () => periodStart(period, new Date(), accountTimeZone),
    [period, accountTimeZone],
  )

  const metrics = useMemo(() => {
    if (!filteredData) return null
    return aggregate(filteredData, rangeStart, null, accountTimeZone)
  }, [filteredData, rangeStart, accountTimeZone])

  const periodLeads = useMemo(() => {
    if (!filteredData) return []
    const start = rangeStart?.getTime() ?? 0
    return filteredData.leads.filter((lead) => new Date(lead.at).getTime() >= start)
  }, [filteredData, rangeStart])

  const activeCheckoutLeads = useMemo(
    () => periodLeads.filter((lead) => lead.stage !== 'purchased' && (lead.stage === 'checkout' || lead.paymentStartedAt)).length,
    [periodLeads],
  )

  const purchasedValue = metrics ? (metrics.rev[metrics.mainCur] ?? 0) : 0
  const visitToCheckout = metrics && metrics.visits ? +((metrics.reachedCheckout / metrics.visits) * 100).toFixed(1) : 0
  const checkoutToPurchase = metrics && metrics.reachedCheckout ? +((metrics.purchased / metrics.reachedCheckout) * 100).toFixed(1) : 0
  const overallConversion = metrics && metrics.visits ? +((metrics.purchased / metrics.visits) * 100).toFixed(1) : 0

  if (error && !data) return <ErrorState onRetry={() => mutate()} />
  if (isLoading && !data) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {error ? (
        <button type="button" className="btn-ghost self-start text-xs text-warning" onClick={() => void mutate()}>
          Dados não atualizados · tentar novamente
        </button>
      ) : null}

      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 flex-1">
          <div className="inline-flex items-center gap-2 rounded-full border border-brand-cyan/20 bg-brand-cyan/10 px-3 py-1 text-[11px] font-medium text-brand-cyan">
            <Sparkles className="size-3.5" aria-hidden="true" />
            Jornada de conversão
          </div>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-foreground">Funil de vendas</h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Acompanhe onde os visitantes avançam, onde a jornada perde força e quais leads já chegaram perto da compra.
          </p>
        </div>

        <div className="flex flex-col gap-2 xl:items-end">
          <PeriodPicker value={period} onChange={setPeriod} />
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Filter className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <select
                value={linkFilter}
                onChange={(event) => setLinkFilter(event.target.value)}
                className="h-9 min-w-40 rounded-xl border border-border/70 bg-secondary/20 pl-8 pr-8 text-xs text-foreground outline-none transition-colors hover:bg-secondary/30 focus:border-brand-cyan/40"
              >
                <option value="">Todos os links</option>
                {filterOptions.links.map((link) => (
                  <option key={link} value={link}>{link}</option>
                ))}
              </select>
            </div>
            {filterOptions.campaigns.length ? (
              <select
                value={campaignFilter}
                onChange={(event) => setCampaignFilter(event.target.value)}
                className="h-9 min-w-44 rounded-xl border border-border/70 bg-secondary/20 px-3 text-xs text-foreground outline-none transition-colors hover:bg-secondary/30 focus:border-brand-cyan/40"
              >
                <option value="">Todas as campanhas</option>
                {filterOptions.campaigns.map((campaign) => (
                  <option key={campaign} value={campaign}>{campaign}</option>
                ))}
              </select>
            ) : null}
            {hasFilter ? (
              <button
                type="button"
                onClick={() => {
                  setLinkFilter('')
                  setCampaignFilter('')
                }}
                className="btn-ghost px-3 py-2 text-xs"
              >
                <X className="size-3.5" />
                Limpar
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <FunnelStat
          label="Visitantes"
          value={(metrics?.visits ?? 0).toLocaleString('pt-BR')}
          detail="Pessoas que entraram no funil neste período."
          icon={Users}
        />
        <FunnelStat
          label="Em checkout"
          value={activeCheckoutLeads.toLocaleString('pt-BR')}
          detail="Leads que avançaram, mas ainda não confirmaram a compra."
          icon={ShoppingCart}
          tone={activeCheckoutLeads ? 'warning' : 'default'}
        />
        <FunnelStat
          label="Conversão final"
          value={fmtPercent(overallConversion)}
          detail="Visitas que terminaram em compra confirmada."
          icon={CheckCircle2}
          tone={overallConversion > 0 ? 'success' : 'default'}
        />
        <FunnelStat
          label="Receita"
          value={formatMoney(purchasedValue, metrics?.mainCur ?? 'BRL')}
          detail={`${metrics?.purchased ?? 0} compra${(metrics?.purchased ?? 0) === 1 ? '' : 's'} confirmada${(metrics?.purchased ?? 0) === 1 ? '' : 's'}.`}
          icon={DollarSign}
          tone={purchasedValue > 0 ? 'accent' : 'default'}
        />
      </div>

      <GlassCard className="overflow-hidden p-4 sm:p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Fluxo do período</p>
            <h2 className="mt-1 text-sm font-semibold text-foreground">Da visita até a compra</h2>
            <p className="mt-1 text-[11px] text-muted-foreground">Os percentuais mostram a conversão entre cada etapa.</p>
          </div>
          {hasFilter ? (
            <span className="rounded-full border border-brand-cyan/20 bg-brand-cyan/10 px-2.5 py-1 text-[10px] font-medium text-brand-cyan">Filtro aplicado</span>
          ) : null}
        </div>

        <div className="relative mt-5 grid gap-3 lg:grid-cols-3">
          <div className="hidden lg:block absolute left-[16%] right-[16%] top-1/2 h-px -translate-y-1/2 bg-gradient-to-r from-transparent via-border/80 to-transparent" />

          <div className="relative z-10 rounded-[22px] border border-border/60 bg-secondary/15 p-5">
            <div className="flex items-center justify-between gap-3">
              <span className="flex size-10 items-center justify-center rounded-xl border border-border/60 bg-black/20 text-foreground">
                <MousePointerClick className="size-4.5" />
              </span>
              <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Entrada</span>
            </div>
            <p className="mt-6 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Visitantes</p>
            <p className="mt-1 text-3xl font-semibold tracking-tight text-foreground"><CountUp value={metrics?.visits ?? 0} /></p>
          </div>

          <div className="relative z-10 rounded-[22px] border border-brand-cyan/25 bg-brand-cyan/[0.07] p-5">
            <span className="absolute -top-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-brand-cyan/30 bg-background px-2.5 py-1 text-[10px] font-semibold text-brand-cyan shadow-lg">
              {fmtPercent(visitToCheckout)} <ArrowRight className="size-3" />
            </span>
            <div className="flex items-center justify-between gap-3">
              <span className="flex size-10 items-center justify-center rounded-xl border border-brand-cyan/20 bg-brand-cyan/10 text-brand-cyan">
                <ShoppingCart className="size-4.5" />
              </span>
              <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Intenção</span>
            </div>
            <p className="mt-6 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Checkouts abertos</p>
            <p className="mt-1 text-3xl font-semibold tracking-tight text-brand-cyan"><CountUp value={metrics?.reachedCheckout ?? 0} /></p>
          </div>

          <div className="relative z-10 rounded-[22px] border border-success/25 bg-success/[0.07] p-5">
            <span className="absolute -top-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-success/30 bg-background px-2.5 py-1 text-[10px] font-semibold text-success shadow-lg">
              {fmtPercent(checkoutToPurchase)} <ArrowRight className="size-3" />
            </span>
            <div className="flex items-center justify-between gap-3">
              <span className="flex size-10 items-center justify-center rounded-xl border border-success/20 bg-success/10 text-success">
                <CheckCircle2 className="size-4.5" />
              </span>
              <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Resultado</span>
            </div>
            <p className="mt-6 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Compras confirmadas</p>
            <p className="mt-1 text-3xl font-semibold tracking-tight text-success"><CountUp value={metrics?.purchased ?? 0} /></p>
          </div>
        </div>
      </GlassCard>

      <div>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Pessoas no funil</p>
            <h2 className="mt-1 text-base font-semibold text-foreground">Leads e jornadas</h2>
            <p className="mt-1 text-xs text-muted-foreground">Abra uma linha para ver origem, pagamento e caminho completo até a conversão.</p>
          </div>
        </div>
        <LeadsTable leads={filteredData?.leads ?? []} periodStart={rangeStart} />
      </div>
    </div>
  )
}
