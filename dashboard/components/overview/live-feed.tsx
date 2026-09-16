'use client'

import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import type { Lead } from '@/lib/types'
import { countryFlag, timeAgo, fmtCurrency } from '@/lib/format'
import { countryName } from '@/lib/countries'

const STAGES: Record<string, { label: string; tone: 'neutral' | 'cyan' | 'warning' | 'success' }> = {
  visit: { label: 'Visita', tone: 'neutral' },
  checkout: { label: 'Checkout', tone: 'cyan' },
  payment: { label: 'Pagamento', tone: 'warning' },
  purchased: { label: 'Compra', tone: 'success' },
}

function activityAt(lead: Lead): string {
  if (lead.stage === 'purchased') return lead.convertedAt || lead.purchasedAt || lead.paymentStartedAt || lead.checkoutAt || lead.at
  if (lead.stage === 'payment') return lead.paymentStartedAt || lead.checkoutAt || lead.at
  if (lead.stage === 'checkout') return lead.checkoutAt || lead.at
  return lead.at
}

export function LiveFeed({ leads, timeZone = 'America/Sao_Paulo' }: { leads: Lead[]; timeZone?: string }) {
  const rows = leads
    .map((lead) => ({ lead, eventAt: activityAt(lead) }))
    .filter(({ eventAt }) => Number.isFinite(Date.parse(eventAt)))
    .sort((a, b) => Date.parse(b.eventAt) - Date.parse(a.eventAt))
    .slice(0, 4)

  return (
    <section className="recent-visits surface-card" aria-label="Atividade recente">
      <header className="overview-section-heading overview-section-heading--plain">
        <h2>Atividade</h2>
        <Link href="/activity" className="overview-section-link">Ver tudo <ArrowUpRight size={13} aria-hidden="true" /></Link>
      </header>

      {!rows.length ? (
        <div className="recent-visits-empty">
          <p>Nenhuma atividade recente</p>
        </div>
      ) : (
        <ul className="recent-visits-list">
          {rows.map(({ lead, eventAt }) => {
            const stageInfo = STAGES[lead.stage] || STAGES.visit
            const isPurchased = lead.stage === 'purchased'
            const place = lead.city || (lead.country ? countryName(lead.country) : lead.countryName) || 'Local não informado'

            return (
              <li key={lead.id} className="recent-visit-row" data-purchased={isPurchased}>
                <span className="recent-visit-place" aria-hidden="true">
                  {lead.country ? countryFlag(lead.country) : '•'}
                </span>
                <strong className="recent-visit-location" title={place}>{place}</strong>
                <span className="recent-visit-stage" data-tone={stageInfo.tone}>
                  {stageInfo.label}
                  {isPurchased && typeof lead.amount === 'number' && Number.isFinite(lead.amount) && lead.amount >= 0 && (
                    <span data-sensitive className="recent-visit-amount"> · {fmtCurrency(lead.amount, lead.currency)}</span>
                  )}
                </span>
                <time
                  dateTime={eventAt}
                  className="recent-visit-time"
                  title={new Date(eventAt).toLocaleString('pt-BR', { timeZone })}
                >
                  {timeAgo(eventAt)}
                </time>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
