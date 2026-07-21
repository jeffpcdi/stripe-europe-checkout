'use client'

// Redesign: feed "CHEGANDO AGORA" na coluna direita do BLOCO HERO — sem card
// próprio (o hero é um bloco só; o que separa as colunas é o espaço). Consome
// os leads que o OverviewView JÁ tem de /api/stats (poll de 12s): atualiza
// sozinho conforme novos leads chegam, SEM nenhuma request nova. Cada linha é
// chaveada pelo id do lead — novo lead no topo anima a entrada (anim-row-in).

import Link from 'next/link'
import type { Lead } from '@/lib/types'
import { countryFlag, timeAgo, fmtCurrency } from '@/lib/format'
import { cn } from '@/lib/utils'
import { SectionTitle } from '@/components/section-title'

const MAX_ROWS = 5

const STAGE_LABEL: Record<string, string> = {
  visit: 'visita',
  checkout: 'checkout',
  purchased: 'compra',
}

function label(lead: Lead): string {
  const place = lead.city || lead.countryName || lead.country || ''
  return place || 'Visitante'
}

export function LiveFeed({ leads }: { leads: Lead[] }) {
  // Mais recentes primeiro; guarda contra `at` ausente/inválido.
  const rows = [...(leads ?? [])]
    .filter((l) => l.at)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, MAX_ROWS)

  return (
    <div className="flex h-full flex-col justify-center gap-3">
      <div className="flex items-center gap-2">
        <span className="live-dot" aria-hidden="true" />
        <SectionTitle>Chegando agora</SectionTitle>
      </div>

      {rows.length === 0 ? (
        <p className="py-4 text-xs text-pretty text-muted-foreground">
          Aguardando os primeiros visitantes.
        </p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((lead) => {
            const bought = lead.stage === 'purchased' && lead.amount
            return (
              <li
                key={lead.id}
                className="anim-feed-row group flex items-center justify-between gap-3 border-b border-white/[0.05] py-3 last:border-b-0 hover:bg-white/5 px-2 -mx-2 rounded-lg transition-colors cursor-default"
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className="text-lg leading-none drop-shadow-md" aria-hidden="true">
                    {countryFlag(lead.country)}
                  </span>
                  <span className="truncate text-xs font-medium text-foreground">
                    {label(lead)}
                  </span>
                  <span className={cn(
                    "rounded-md px-1.5 py-0.5 text-[10px] font-mono font-semibold uppercase tracking-wider",
                    lead.stage === 'purchased' ? "bg-success/15 text-success drop-shadow-[0_0_8px_rgba(34,197,94,0.6)] border border-success/30" :
                    lead.stage === 'checkout' ? "bg-warning/15 text-warning drop-shadow-[0_0_8px_rgba(251,191,36,0.6)] border border-warning/30" :
                    "bg-primary/15 text-primary drop-shadow-[0_0_8px_rgba(37,244,238,0.6)] border border-primary/30"
                  )}>
                    {STAGE_LABEL[lead.stage] || lead.stage}
                  </span>
                  {bought ? (
                    <span
                      className="shrink-0 font-mono text-[11px] font-semibold tabular-nums text-success"
                      data-sensitive
                    >
                      {fmtCurrency(lead.amount as number, lead.currency)}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground group-hover:text-foreground group-hover:drop-shadow-[0_0_5px_rgba(255,255,255,0.5)] transition-all">
                  {timeAgo(lead.at)}
                </span>
              </li>
            )
          })}
        </ul>
      )}

      <Link
        href="/activity"
        className="inline-flex items-center gap-1 text-[11px] text-brand-cyan transition-opacity hover:opacity-80"
      >
        Ver todos os eventos {'\u2192'}
      </Link>
    </div>
  )
}
