'use client'

// Redesign: feed "CHEGANDO AGORA" na coluna direita do BLOCO HERO — sem card
// próprio (o hero é um bloco só; o que separa as colunas é o espaço). Consome
// os leads que o OverviewView JÁ tem de /api/stats (poll de 12s): atualiza
// sozinho conforme novos leads chegam, SEM nenhuma request nova. Cada linha é
// chaveada pelo id do lead — novo lead no topo anima a entrada (anim-row-in).

import Link from 'next/link'
import type { Lead } from '@/lib/types'
import { countryFlag, timeAgo, fmtCurrency } from '@/lib/format'

const MAX_ROWS = 5

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
      <h3 className="flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/45">
        <span className="live-dot" aria-hidden="true" />
        Chegando agora
      </h3>

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
                className="anim-row-in flex items-center justify-between gap-3 border-b border-white/[0.05] py-2.5 last:border-b-0"
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className="text-base leading-none" aria-hidden="true">
                    {countryFlag(lead.country)}
                  </span>
                  <span className="truncate text-xs font-medium text-foreground">
                    {label(lead)}
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
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-faint">
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
