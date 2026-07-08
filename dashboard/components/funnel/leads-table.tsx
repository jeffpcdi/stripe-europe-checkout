'use client'

import { useMemo, useState } from 'react'
import { GlassCard } from '@/components/glass-card'
import { countryFlag, gwLabel, timeAgo, formatMoney, plural } from '@/lib/format'
import { cn } from '@/lib/utils'
import { ChevronLeft, ChevronRight, Download, Search, X } from 'lucide-react'
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

const PAGE_SIZE = 20

/** Item 149: destaca o termo buscado em ciano dentro do texto. */
function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return <>{text}</>
  return (
    <>
      {text.slice(0, idx)}
      <mark className="search-hit">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  )
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
  const [page, setPage] = useState(0)

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

  // Item 150: paginação com clamp quando o filtro muda
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const pageRows = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE)
  const from = filtered.length === 0 ? 0 : safePage * PAGE_SIZE + 1
  const to = Math.min(filtered.length, (safePage + 1) * PAGE_SIZE)

  // Item 148: chips removíveis dos filtros ativos
  const chips: { label: string; clear: () => void }[] = []
  if (stage) chips.push({ label: `Etapa: ${STAGE_LABEL[stage] ?? stage}`, clear: () => setStage('') })
  if (gateway) chips.push({ label: `Gateway: ${gwLabel(gateway)}`, clear: () => setGateway('') })
  if (query) chips.push({ label: `Busca: "${query}"`, clear: () => setQuery('') })

  function resetPage() {
    setPage(0)
  }

  // Item 130: exporta os leads filtrados como CSV, client-side
  function exportCsv() {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const header = ['id', 'etapa', 'pais', 'gateway', 'valor', 'quando']
    const rows = filtered.map((l) =>
      [
        l.id,
        STAGE_LABEL[l.stage] ?? l.stage,
        l.countryName || l.country || '',
        l.gateway ? gwLabel(l.gateway) : '',
        l.amount ? formatMoney(l.amount, l.currency) : '',
        l.at,
      ].map(esc).join(','),
    )
    const blob = new Blob(['\uFEFF' + [header.join(','), ...rows].join('\n')], {
      type: 'text/csv;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <GlassCard className="p-4">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h2 className="section-head text-sm font-semibold text-foreground">Leads</h2>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {plural(filtered.length, 'lead')}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {/* Item 130: exportar CSV discreto no canto do card */}
          <button
            type="button"
            onClick={exportCsv}
            disabled={filtered.length === 0}
            className="flex h-8 items-center gap-1.5 rounded-md border border-border/60 px-2.5 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
            title="Exportar leads filtrados como CSV"
          >
            <Download className="size-3.5" aria-hidden="true" />
            CSV
          </button>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <input
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                resetPage()
              }}
              placeholder="Buscar lead, país, origem…"
              className="h-8 w-52 rounded-md border border-border/60 bg-muted/20 pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
          </div>
          <select
            value={stage}
            onChange={(e) => {
              setStage(e.target.value)
              resetPage()
            }}
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
            onChange={(e) => {
              setGateway(e.target.value)
              resetPage()
            }}
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

      {/* Item 148: chips dos filtros ativos, removíveis com X */}
      {chips.length > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <button
              key={c.label}
              type="button"
              onClick={() => {
                c.clear()
                resetPage()
              }}
              className="anim-pop-in flex items-center gap-1 rounded-full border border-[rgba(37,244,238,0.3)] bg-[rgba(37,244,238,0.08)] px-2.5 py-0.5 text-[11px] font-medium text-primary transition-colors hover:bg-[rgba(37,244,238,0.15)]"
            >
              {c.label}
              <X className="size-3" aria-hidden="true" />
              <span className="sr-only">Remover filtro</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="mb-2" />
      )}

      {filtered.length > 0 ? (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-border/60">
                  <th className="label-mono pb-2 pr-3">ID</th>
                  <th className="label-mono pb-2 pr-3">Etapa</th>
                  <th className="label-mono pb-2 pr-3">Gateway</th>
                  <th className="label-mono pb-2 pr-3">País</th>
                  <th className="label-mono pb-2 pr-3">Origem</th>
                  <th className="label-mono pb-2 pr-3">Valor</th>
                  <th className="label-mono pb-2">Quando</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((l) => {
                  const origin = l.utm?.source || (l.referer ? 'ref' : 'direto')
                  const hits = l.checkoutHits?.length ? `${l.checkoutHits.length}x` : null
                  return (
                    <tr
                      key={l.id}
                      className="tr-hover border-b border-border/30 last:border-b-0"
                    >
                      <td className="py-2.5 pr-3 font-mono text-xs text-muted-foreground">
                        <Highlight text={l.id.slice(0, 12)} query={query} />
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
                            <span aria-hidden>{countryFlag(l.country)}</span>{' '}
                            <Highlight text={l.countryName || l.country} query={query} />
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 text-xs text-muted-foreground">
                        <Highlight text={origin} query={query} />
                      </td>
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

          {/* Item 150: paginação glass com contagem mono */}
          {pageCount > 1 ? (
            <div className="mt-3 flex items-center justify-between border-t border-border/40 pt-3">
              <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                {from}–{to} de {filtered.length}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  className="btn-ghost !px-2"
                  disabled={safePage === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  aria-label="Página anterior"
                  style={safePage === 0 ? { opacity: 0.4, pointerEvents: 'none' } : undefined}
                >
                  <ChevronLeft className="size-3.5" aria-hidden="true" />
                </button>
                <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                  {safePage + 1}/{pageCount}
                </span>
                <button
                  type="button"
                  className="btn-ghost !px-2"
                  disabled={safePage >= pageCount - 1}
                  onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                  aria-label="Próxima página"
                  style={
                    safePage >= pageCount - 1 ? { opacity: 0.4, pointerEvents: 'none' } : undefined
                  }
                >
                  <ChevronRight className="size-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <p className="py-10 text-center text-sm text-muted-foreground">
          Nenhum lead encontrado neste período/filtro.
        </p>
      )}
    </GlassCard>
  )
}
