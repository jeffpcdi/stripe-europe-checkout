'use client'

import Link from 'next/link'
import { ArrowUpRight, History, MapPin } from 'lucide-react'
import type { Lead } from '@/lib/types'
import { countryFlag, timeAgo, fmtCurrency } from '@/lib/format'
import { countryName } from '@/lib/countries'

const STAGES: Record<string, string> = { visit: 'Visitou a página', checkout: 'Abriu o checkout', payment: 'Iniciou o pagamento', purchased: 'Compra aprovada' }

export function LiveFeed({ leads }: { leads: Lead[] }) {
  const rows = [...leads].filter(lead => Number.isFinite(Date.parse(lead.at))).sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 4)
  return (
    <section className="recent-visits" aria-label="Últimas visitas">
      <header className="overview-section-heading"><h2><History size={16} aria-hidden="true" />Últimas visitas</h2><Link href="/activity">Histórico <ArrowUpRight size={13} aria-hidden="true" /></Link></header>
      {!rows.length ? <div className="recent-visits-empty"><MapPin size={24} strokeWidth={1.3} aria-hidden="true" /><p>As próximas visitas aparecem aqui.</p></div> : <ul>
        {rows.map(lead => <li key={lead.id} className="recent-visit-row">
          <span className="recent-visit-place" aria-hidden="true">{lead.country ? countryFlag(lead.country) : <MapPin size={17} />}</span>
          <div className="recent-visit-detail"><strong>{lead.city || (lead.country ? countryName(lead.country) : lead.countryName) || 'Local não informado'}</strong><span data-purchased={lead.stage === 'purchased'}>{STAGES[lead.stage] || 'Visita registrada'}</span></div>
          <div className="recent-visit-time">{lead.stage === 'purchased' && Number(lead.amount) > 0 && <strong data-sensitive>{fmtCurrency(lead.amount as number, lead.currency)}</strong>}<time dateTime={lead.at} title={new Date(lead.at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}>{timeAgo(lead.at)}</time></div>
        </li>)}
      </ul>}
    </section>
  )
}
