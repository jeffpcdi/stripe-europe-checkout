'use client'

import { useMemo, useState } from 'react'
import { Filter, ArrowRight, DollarSign, MousePointerClick, ShoppingCart, CheckCircle2 } from 'lucide-react'
import { useStats } from '@/lib/api'
import { aggregate, periodStart, isMacroCampaign } from '@/lib/metrics'
import { GlassCard } from '@/components/glass-card'
import { Skeleton } from '@/components/skeleton'
import { CountUp } from '@/components/count-up'
import { PeriodPicker } from '@/components/overview/period-picker'
import { fmtPercent, formatMoney } from '@/lib/format'
import type { Period } from '@/lib/types'

export function FunnelView() {
  const { data, isLoading } = useStats()
  const [period, setPeriod] = useState<Period>('7d')

  const [linkFilter, setLinkFilter] = useState('')
  const [campaignFilter, setCampaignFilter] = useState('')

  const filterOptions = useMemo(() => {
    const links = new Set<string>()
    const campaigns = new Set<string>()
    for (const l of data?.leads ?? []) {
      if (l.linkSlug) links.add(l.linkSlug)
      if (l.utm?.campaign && !isMacroCampaign(l.utm.campaign)) campaigns.add(l.utm.campaign)
    }
    return {
      links: [...links].sort(),
      campaigns: [...campaigns].sort(),
    }
  }, [data])

  const hasFilter = !!(linkFilter || campaignFilter)
  const filteredData = useMemo(() => {
    if (!data || !hasFilter) return data
    return {
      ...data,
      leads: data.leads.filter(
        (l) =>
          (!linkFilter || l.linkSlug === linkFilter) &&
          (!campaignFilter || l.utm?.campaign === campaignFilter),
      ),
    }
  }, [data, hasFilter, linkFilter, campaignFilter])

  const m = useMemo(() => {
    if (!filteredData) return null
    return aggregate(filteredData, periodStart(period))
  }, [filteredData, period])

  const purchasedValue = m ? (m.rev[m.mainCur] ?? 0) : 0

  if (isLoading && !data) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-40" />
        <Skeleton className="h-64" />
      </div>
    )
  }

  const v2c = m && m.visits ? +((m.reachedCheckout / m.visits) * 100).toFixed(1) : 0
  const c2p = m && m.reachedCheckout ? +((m.purchased / m.reachedCheckout) * 100).toFixed(1) : 0

  return (
    <div className="flex flex-col gap-6 pt-2 pb-20">
      
      {/* ── HEADER MÁGICO DO FUNIL ── */}
      <GlassCard className="relative overflow-hidden p-6 sm:p-8 border-[color:var(--brand-cyan)]/30 shadow-[0_0_40px_rgba(37,244,238,0.05)]">
        <div className="pointer-events-none absolute -right-20 -top-20 size-64 rounded-full bg-[color:var(--brand-cyan)]/10 blur-[80px]" />
        
        <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex flex-col">
            <div className="flex items-center gap-3 mb-2">
              <div className="flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[color:var(--brand-cyan)]/20 to-[color:var(--brand-cyan)]/5 shadow-inner">
                <DollarSign className="size-6 text-[color:var(--brand-cyan)] drop-shadow-[0_0_8px_rgba(37,244,238,0.8)]" />
              </div>
              <h2 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-white to-white/70">
                O Pipeline Financeiro
              </h2>
            </div>
            <p className="text-sm text-muted-foreground text-balance max-w-md">
              Diga adeus às tabelas cruas. Acompanhe a jornada visual de quem clicou no seu anúncio até gerar receita na sua conta.
            </p>
          </div>

          <div className="flex flex-col gap-3 min-w-[200px]">
            <PeriodPicker value={period} onChange={setPeriod} />
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Filter className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
                <select
                  value={linkFilter}
                  onChange={(e) => setLinkFilter(e.target.value)}
                  className="w-full rounded-lg border border-border bg-input/50 py-2 pl-8 pr-3 text-xs text-foreground focus:outline-none focus:border-[color:var(--brand-cyan)]/50 focus:shadow-[0_0_15px_rgba(37,244,238,0.25)]"
                >
                  <option value="">Link Mágico (Todos)</option>
                  {filterOptions.links.map((l) => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>
      </GlassCard>

      {/* ── PIPELINE FLOW (Sankey Style) ── */}
      <GlassCard className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative">
          {/* Background Connector Lines (Desktop only) */}
          <div className="hidden md:block absolute top-1/2 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-border to-transparent -translate-y-1/2" />

          {/* Visitas */}
          <div className="relative z-10 flex flex-col items-center justify-center p-6 rounded-2xl bg-secondary/30 border border-border/50 hover:border-[color:var(--brand-cyan)]/40 transition-colors">
            <div className="flex size-14 items-center justify-center rounded-full bg-secondary/80 text-foreground mb-4">
              <MousePointerClick className="size-6" />
            </div>
            <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider mb-2">Visitas Únicas</h3>
            <span className="text-4xl font-black text-foreground drop-shadow-md">
              <CountUp value={m?.visits ?? 0} />
            </span>
          </div>

          {/* Checkout */}
          <div className="relative z-10 flex flex-col items-center justify-center p-6 rounded-2xl bg-secondary/30 border border-border/50 hover:border-[color:var(--brand-cyan)]/40 transition-colors">
            {/* V2C Rate Badge */}
            <div className="absolute -top-3 right-1/2 translate-x-1/2 md:-left-5 md:top-1/2 md:-translate-y-1/2 flex items-center justify-center bg-[color:var(--brand-cyan)] text-black font-bold text-[10px] px-2 py-1 rounded-full shadow-[0_0_10px_rgba(37,244,238,0.4)]">
              {fmtPercent(v2c)} <ArrowRight className="size-3 ml-1" />
            </div>
            
            <div className="flex size-14 items-center justify-center rounded-full bg-[color:var(--brand-cyan)]/20 text-[color:var(--brand-cyan)] mb-4">
              <ShoppingCart className="size-6" />
            </div>
            <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider mb-2">Checkouts Abertos</h3>
            <span className="text-4xl font-black text-[color:var(--brand-cyan)] drop-shadow-[0_0_15px_rgba(37,244,238,0.3)]">
              <CountUp value={m?.reachedCheckout ?? 0} />
            </span>
          </div>

          {/* Compras */}
          <div className="relative z-10 flex flex-col items-center justify-center p-6 rounded-2xl bg-secondary/30 border border-border/50 hover:border-success/40 transition-colors">
            {/* C2P Rate Badge */}
            <div className="absolute -top-3 right-1/2 translate-x-1/2 md:-left-5 md:top-1/2 md:-translate-y-1/2 flex items-center justify-center bg-success text-white font-bold text-[10px] px-2 py-1 rounded-full shadow-[0_0_10px_rgba(34,197,94,0.4)]">
              {fmtPercent(c2p)} <ArrowRight className="size-3 ml-1" />
            </div>

            <div className="flex size-14 items-center justify-center rounded-full bg-success/20 text-success mb-4">
              <CheckCircle2 className="size-6" />
            </div>
            <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider mb-2">Vendas Fechadas</h3>
            <span className="text-4xl font-black text-success drop-shadow-[0_0_15px_rgba(34,197,94,0.3)]">
              <CountUp value={m?.purchased ?? 0} />
            </span>
          </div>
        </div>

        {/* REVENUE CALLOUT */}
        <div className="mt-8 pt-8 border-t border-border/50 flex flex-col items-center text-center">
          <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">Receita Gerada no Período</span>
          <span className="text-5xl font-black tabular-nums tracking-tighter text-transparent bg-clip-text bg-gradient-to-br from-white to-white/70 drop-shadow-[0_0_15px_rgba(255,255,255,0.1)]">
            {formatMoney(purchasedValue, m?.mainCur ?? 'BRL')}
          </span>
        </div>
      </GlassCard>
    </div>
  )
}
