'use client'

import Link from 'next/link'
import type { Lead } from '@/lib/types'
import { countryFlag, timeAgo, fmtCurrency } from '@/lib/format'
import { cn } from '@/lib/utils'

const MAX_ROWS = 5

const STAGE_CONFIG: Record<
  string,
  { label: string; badge: string; tooltip: string }
> = {
  visit: {
    label: 'Visita',
    badge: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
    tooltip: 'Visitante acessou uma página ou link',
  },
  checkout: {
    label: 'Checkout',
    badge: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    tooltip: 'Visitante abriu a tela de checkout',
  },
  purchased: {
    label: 'Venda',
    badge: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30 shadow-[0_0_8px_rgba(16,185,129,0.3)]',
    tooltip: 'Pedido confirmado e pago com sucesso',
  },
}

function label(lead: Lead): string {
  const place = lead.city || lead.countryName || lead.country || ''
  return place || 'Visitante'
}

export function LiveFeed({ leads }: { leads: Lead[] }) {
  const rows = [...(leads ?? [])]
    .filter((l) => l.at)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, MAX_ROWS)

  return (
    <div className="flex h-full flex-col justify-between gap-3">
      {/* Cabeçalho minimalista */}
      <div className="flex items-center justify-between">
        <div
          data-tooltip="Últimas visitas e compras registradas. Este é o histórico, não a presença online."
          className="flex items-center gap-2 cursor-help"
        >
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70">
            Últimas visitas
          </span>
        </div>
        <Link
          href="/activity"
          data-tooltip="Ver histórico completo de atividades e leads."
          className="text-[10px] font-medium text-white/40 transition-colors hover:text-cyan-300"
        >
          Ver histórico →
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center py-6 text-center">
          <p className="text-xs text-white/40">Nenhuma visita registrada ainda.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {rows.map((lead) => {
            const bought = lead.stage === 'purchased' && lead.amount
            const config = STAGE_CONFIG[lead.stage] || {
              label: lead.stage,
              badge: 'bg-white/5 text-white/60 border-white/10',
            }

            return (
              <li
                key={lead.id}
                className="group flex items-center justify-between gap-2 rounded-xl border border-white/[0.04] bg-white/[0.02] px-3 py-2 transition-all hover:border-white/10 hover:bg-white/[0.05]"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="text-base leading-none" aria-hidden="true">
                    {countryFlag(lead.country)}
                  </span>
                  <span className="truncate text-xs font-medium text-white/90">
                    {label(lead)}
                  </span>
                  <span
                    data-tooltip={config.tooltip}
                    className={cn(
                      'inline-flex items-center rounded-md border px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider cursor-help',
                      config.badge,
                    )}
                  >
                    {config.label}
                  </span>
                </div>

                <div className="flex shrink-0 items-center gap-2 text-right">
                  {bought ? (
                    <span
                      className="font-mono text-xs font-bold text-emerald-400"
                      data-sensitive
                    >
                      {fmtCurrency(lead.amount as number, lead.currency)}
                    </span>
                  ) : null}
                  <span className="font-mono text-[10px] text-white/40">
                    {timeAgo(lead.at)}
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
