'use client'

// Fase 3: feed "Chegando agora" — os últimos leads no hero, ao lado do globo.
// Consome os leads que o OverviewView JÁ tem de /api/stats (poll de 12s), então
// atualiza sozinho conforme novos leads chegam SEM nenhuma request nova. Cada
// linha é chaveada pelo id do lead: quando um novo entra no topo, ele anima a
// entrada (anim-row-in) — o "chegando" fica literal.

import Link from 'next/link'
import { Radio } from 'lucide-react'
import type { Lead } from '@/lib/types'
import { countryFlag, timeAgo, fmtCurrency, STAGE_LABEL, STAGE_CLASS } from '@/lib/format'
import { GlassCard } from '@/components/glass-card'

const MAX_ROWS = 5

function label(lead: Lead): string {
  const place = lead.city || lead.countryName || lead.country || ''
  return place || 'Visitante'
}

function stageMeta(stage: string): { label: string; cls: string } {
  return {
    label: STAGE_LABEL[stage] ?? 'Visita',
    cls: STAGE_CLASS[stage] ?? STAGE_CLASS.visit,
  }
}

export function LiveFeed({ leads }: { leads: Lead[] }) {
  // Mais recentes primeiro; guarda contra `at` ausente/ inválido.
  const rows = [...(leads ?? [])]
    .filter((l) => l.at)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, MAX_ROWS)

  return (
    <GlassCard className="flex h-full flex-col p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="section-head flex items-center gap-2 text-sm font-semibold text-foreground">
          <span className="live-dot" aria-hidden="true" />
          Chegando agora
        </h3>
        <Link
          href="/activity"
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          ver todos
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center">
          <Radio className="size-5 text-muted-foreground" aria-hidden="true" />
          <p className="text-xs text-pretty text-muted-foreground">
            Aguardando os primeiros visitantes do período.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {rows.map((lead) => {
            const st = stageMeta(lead.stage)
            const bought = lead.stage === 'purchased' && lead.amount
            return (
              <li
                key={lead.id}
                className="anim-row-in flex items-center gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-white/[0.02]"
              >
                <span className="text-base leading-none" aria-hidden="true">
                  {countryFlag(lead.country)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-foreground">{label(lead)}</p>
                  <p className="font-mono text-[10.5px] tabular-nums text-faint">{timeAgo(lead.at)}</p>
                </div>
                {bought ? (
                  <span
                    className="shrink-0 font-mono text-[11px] font-semibold tabular-nums text-success"
                    data-sensitive
                  >
                    {fmtCurrency(lead.amount as number, lead.currency)}
                  </span>
                ) : (
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${st.cls}`}
                  >
                    {st.label}
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </GlassCard>
  )
}
