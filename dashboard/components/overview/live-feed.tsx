'use client'

import Link from 'next/link'
import { ArrowUpRight, History, MapPin, CheckCircle2, ShoppingCart, CreditCard, Eye } from 'lucide-react'
import type { Lead } from '@/lib/types'
import { countryFlag, timeAgo, fmtCurrency } from '@/lib/format'
import { countryName } from '@/lib/countries'

const STAGES: Record<string, { label: string; icon: typeof Eye; badgeClass: string }> = {
  visit: {
    label: 'Visitou a página',
    icon: Eye,
    badgeClass: 'text-muted-foreground bg-secondary/50 border-border/50',
  },
  checkout: {
    label: 'Abriu checkout',
    icon: ShoppingCart,
    badgeClass: 'text-brand-cyan bg-brand-cyan/10 border-brand-cyan/25',
  },
  payment: {
    label: 'Iniciou pagamento',
    icon: CreditCard,
    badgeClass: 'text-warning bg-warning/10 border-warning/25',
  },
  purchased: {
    label: 'Compra aprovada',
    icon: CheckCircle2,
    badgeClass: 'text-success bg-success/15 border-success/30 font-semibold shadow-[0_0_10px_rgba(34,197,94,0.2)]',
  },
}

export function LiveFeed({ leads }: { leads: Lead[] }) {
  const rows = [...leads]
    .filter((lead) => Number.isFinite(Date.parse(lead.at)))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, 4)

  return (
    <section className="recent-visits" aria-label="Últimas visitas">
      <header className="overview-section-heading">
        <h2 className="flex items-center gap-2">
          <span className="relative flex size-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
          </span>
          <History size={16} className="text-foreground" aria-hidden="true" />
          <span>Atividade recente</span>
        </h2>
        <Link href="/activity" className="text-xs font-medium text-brand-cyan hover:underline flex items-center gap-1">
          Histórico <ArrowUpRight size={13} aria-hidden="true" />
        </Link>
      </header>
      {!rows.length ? (
        <div className="recent-visits-empty">
          <MapPin size={24} strokeWidth={1.3} aria-hidden="true" />
          <p>As próximas visitas aparecem aqui.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {rows.map((lead) => {
            const stageInfo = STAGES[lead.stage] || STAGES.visit
            const StageIcon = stageInfo.icon
            const isPurchased = lead.stage === 'purchased'

            return (
              <li
                key={lead.id}
                className={`recent-visit-row group transition-all duration-200 hover:translate-x-1 hover:bg-secondary/30 rounded-xl px-2.5 py-2 border ${
                  isPurchased
                    ? 'border-success/30 bg-success/5 shadow-[0_0_12px_rgba(34,197,94,0.08)]'
                    : 'border-border/60 bg-transparent'
                }`}
              >
                <span className="recent-visit-place shadow-sm" aria-hidden="true">
                  {lead.country ? countryFlag(lead.country) : <MapPin size={16} />}
                </span>
                <div className="recent-visit-detail min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <strong className="truncate text-xs font-semibold text-foreground">
                      {lead.city || (lead.country ? countryName(lead.country) : lead.countryName) || 'Local não informado'}
                    </strong>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.2 text-[10px] ${stageInfo.badgeClass}`}
                    >
                      <StageIcon size={10} aria-hidden="true" />
                      {stageInfo.label}
                    </span>
                  </div>
                </div>
                <div className="recent-visit-time flex flex-col items-end gap-0.5">
                  {isPurchased && Number(lead.amount) > 0 && (
                    <strong
                      data-sensitive
                      className="font-mono text-xs font-bold text-success"
                    >
                      {fmtCurrency(lead.amount as number, lead.currency)}
                    </strong>
                  )}
                  <time
                    dateTime={lead.at}
                    className="text-[10px] text-muted-foreground font-mono"
                    title={new Date(lead.at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
                  >
                    {timeAgo(lead.at)}
                  </time>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
