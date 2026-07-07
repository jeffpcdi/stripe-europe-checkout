'use client'

import { useMemo, useState } from 'react'
import { GlassCard } from '@/components/glass-card'
import { countryFlag, gwLabel, timeAgo, formatMoney } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Search } from 'lucide-react'
import type { Lead } from '@/lib/types'

const STAGE_LABEL: Record<string, string> = {
  visit: 'Visita',
  checkout: 'Checkout',
  purchased: 'Comprou',
}

const STAGE_CLASS: Record<string, string> = {
  visit: 'bg-primary/10 text-primary',
  checkout: 'bg-warning/10 text-warning',
  purchased: 'bg-success/10 text-success',
}

export function LeadsTable({
  leads,
  periodStart,
}: {
  leads: Lead[]
  periodStart: Date | null
}) {
  const [query, setQuery] = useState('')
  const [stage, setStage] = useState('')
  const [gateway, setGateway] = useState('')

  const gateways = useMemo(() => {
    const seen = new Set<string>()
    for (const l of leads) if (l.gateway) seen.add(l.gateway)
    return [...seen].sort()
  }, [leads])

  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    return leads.filter((l) => {
      if (l.orphan) return false
      if (periodStart && new Date(l.at).getTime() < periodStart.getTime()) return false
      if (stage && l.stage !== stage) return false
      if (gateway && l.gateway !== gateway) return false
      if (q) {
        const hay = [l.id, l.country, l.countryName, l.customer, l.email, l.utm?.source, l.utm?.campaign]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [leads, query, stage, gateway, periodStart])

  return (
    <GlassCard className="p-4">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold text-foreground">Leads</h2>
        <span className="text-xs tabular-nums text-muted-foreground">{filtered.length} leads</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar lead, país, origem…"
              className="h-8 w-52 rounded-md border border-border/60 bg-muted/20 pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
          </div>
          <select
            value={stage}
            onChange={(e) => setStage(e.target.value)}
            aria-label="Filtrar por etapa"
            className="h-8 rounded-md border border-border/60 bg-muted/20 px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
          >
            <option value="">Todas etapas</option>
            <option value="visit">Visita</option>
            <option value="checkout">Checkout</option>
            <option value="purchased">Comprou</option>
          </select>
          <select
            value={gateway}
            onChange={(e) => setGateway(e.target.value)}
            aria-label="Filtrar por gateway"
            className="h-8 rounded-md border border-border/60 bg-muted/20 px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
          >
            <option value="">Todos gateways</option>
            {gateways.map((g) => (
              <option key={g} value={g}>
                {gwLabel(g)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {filtered.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-border/60 text-xs text-muted-foreground">
                <th className="pb-2 pr-3 font-medium">ID</th>
                <th className="pb-2 pr-3 font-medium">Etapa</th>
                <th className="pb-2 pr-3 font-medium">Gateway</th>
                <th className="pb-2 pr-3 font-medium">País</th>
                <th className="pb-2 pr-3 font-medium">Origem</th>
                <th className="pb-2 pr-3 font-medium">Valor</th>
                <th className="pb-2 font-medium">Quando</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 200).map((l) => {
                const origin = l.utm?.source || (l.referer ? 'ref' : 'direto')
                const hits = l.checkoutHits?.length ? `${l.checkoutHits.length}x` : null
                return (
                  <tr key={l.id} className="border-b border-border/30 last:border-b-0">
                    <td className="py-2.5 pr-3 font-mono text-xs text-muted-foreground">
                      {l.id.slice(0, 12)}
                    </td>
                    <td className="py-2.5 pr-3">
                      <span
                        className={cn(
                          'rounded-md px-2 py-0.5 text-xs font-semibold',
                          STAGE_CLASS[l.stage] || 'bg-muted/40 text-muted-foreground'
                        )}
                      >
                        {STAGE_LABEL[l.stage] || l.stage}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 text-xs">
                      {l.gateway ? (
                        <span className="text-foreground">
                          {gwLabel(l.gateway)}
                          {hits ? <span className="ml-1 text-muted-foreground">{hits}</span> : null}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 text-xs">
                      {l.country ? (
                        <span className="text-foreground">
                          <span aria-hidden>{countryFlag(l.country)}</span> {l.countryName || l.country}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 text-xs text-muted-foreground">{origin}</td>
                    <td className="py-2.5 pr-3 text-xs tabular-nums">
                      {l.reportedAmount ? (
                        <span className="font-semibold text-success">
                          {formatMoney(l.reportedAmount, l.reportedCurrency)}
                        </span>
                      ) : l.expectedAmount ? (
                        <span className="text-muted-foreground">
                          {formatMoney(l.expectedAmount, l.expectedCurrency)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-2.5 text-xs tabular-nums text-muted-foreground">{timeAgo(l.at)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="py-10 text-center text-sm text-muted-foreground">
          Nenhum lead encontrado neste período/filtro.
        </p>
      )}
    </GlassCard>
  )
}
