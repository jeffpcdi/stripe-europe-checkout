'use client'

import { Filter, RotateCcw } from 'lucide-react'
import { useCloakStats, apiSend } from '@/lib/api'
import { GlassCard } from '@/components/glass-card'
import { StatusBadge } from '@/components/status-badge'

// Rótulos amigáveis para os motivos de bloqueio do motor
const REASON_LABELS: Record<string, string> = {
  'bot-ua': 'UA de bot',
  pais: 'país fora da lista',
  idioma: 'idioma bloqueado',
  score: 'score alto',
  'rate-limit': 'rate-limit',
  datacenter: 'datacenter',
  headless: 'headless',
  webview: 'webview',
}

// Item 144: mini-gráfico diário offer×white por link (o backend já devolve
// `daily`, mas nunca era plotado). Barras verticais empilhadas com os mesmos
// tokens das barras agregadas — offer (verde) embaixo, white (âmbar) em cima.
function DailyMiniChart({ daily }: { daily: { day: string; offer: number; white: number }[] }) {
  const days = daily.slice(-14) // últimas 2 semanas
  const max = Math.max(1, ...days.map((d) => d.offer + d.white))
  if (!days.some((d) => d.offer + d.white > 0)) return null
  return (
    <div className="mt-2.5">
      <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-muted-foreground">
        <span>Últimos {days.length} dias</span>
        <span className="flex items-center gap-2">
          <span className="flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-success" aria-hidden="true" /> offer
          </span>
          <span className="flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-warning" aria-hidden="true" /> white
          </span>
        </span>
      </div>
      <div className="flex h-12 items-end gap-0.5" role="img" aria-label="Gráfico diário de decisões offer contra white page">
        {days.map((d) => {
          const total = d.offer + d.white
          const h = total ? Math.max(6, Math.round((total / max) * 100)) : 2
          const offerPct = total ? (d.offer / total) * 100 : 0
          const label = new Date(d.day).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
          return (
            <div
              key={d.day}
              className="flex flex-1 flex-col justify-end"
              style={{ height: '100%' }}
              title={`${label}: ${d.offer} offer · ${d.white} white`}
            >
              <div className="flex w-full flex-col overflow-hidden rounded-sm" style={{ height: `${h}%` }}>
                <div className="w-full bg-warning" style={{ height: `${100 - offerPct}%` }} aria-hidden="true" />
                <div className="w-full bg-success" style={{ height: `${offerPct}%` }} aria-hidden="true" />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function CloakStatsPanel() {
  const { data, mutate } = useCloakStats()

  const agg = data?.aggregate
  const links = data?.links ?? []
  const blockPct = agg && agg.total ? Math.round(agg.blockRate * 100) : 0

  async function handleReset(key?: string) {
    const msg = key ? 'Zerar os contadores deste link?' : 'Zerar TODOS os contadores de cloaking?'
    if (!window.confirm(msg)) return
    await apiSend('/api/cloak/stats/reset', 'POST', key ? { key } : {})
    mutate()
  }

  const reasonsSorted = agg
    ? Object.entries(agg.reasons).sort((a, b) => b[1] - a[1])
    : []

  return (
    <GlassCard className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span
            className="flex size-8 items-center justify-center rounded-[10px] text-[color:var(--brand-cyan)]"
            style={{ background: 'color-mix(in oklab, var(--brand-cyan) 14%, transparent)' }}
            aria-hidden="true"
          >
            <Filter className="size-4" />
          </span>
          <div>
            <h2 className="section-head text-sm font-semibold text-foreground">Offer vs White</h2>
            <p className="text-xs text-muted-foreground">Decisões do cloaker por link</p>
          </div>
        </div>
        {agg && agg.total > 0 && (
          <button
            type="button"
            onClick={() => handleReset()}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <RotateCcw className="size-3.5" /> Zerar tudo
          </button>
        )}
      </div>

      {/* Barra agregada offer/white */}
      {agg && agg.total > 0 ? (
        <>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="text-success">Offer {agg.offer}</span>
            <span className="text-muted-foreground">{blockPct}% bloqueado</span>
            <span className="text-warning">White {agg.white}</span>
          </div>
          <div className="mb-4 flex h-2.5 overflow-hidden rounded-full bg-muted">
            <div
              className="bg-success transition-all"
              style={{ width: `${100 - blockPct}%` }}
              aria-hidden="true"
            />
            <div className="bg-warning transition-all" style={{ width: `${blockPct}%` }} aria-hidden="true" />
          </div>

          {/* Motivos de bloqueio */}
          {reasonsSorted.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-1.5">
              {reasonsSorted.map(([reason, count]) => (
                <StatusBadge key={reason} status="neutral">
                  {REASON_LABELS[reason] ?? reason}: {count}
                </StatusBadge>
              ))}
            </div>
          )}
        </>
      ) : (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Sem decisões registradas ainda. Os contadores aparecem quando o tráfego chega nos links protegidos.
        </p>
      )}

      {/* Por link */}
      {links.filter((l) => l.total > 0).length > 0 && (
        <ul className="flex flex-col gap-2 border-t border-border pt-3">
          {links
            .filter((l) => l.total > 0)
            .sort((a, b) => b.total - a.total)
            .map((l) => {
              const pct = l.total ? Math.round(l.blockRate * 100) : 0
              return (
                <li key={l.tipo + l.slug} className="rounded-lg border border-border bg-secondary/40 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <StatusBadge status={l.tipo === 'cloak' ? 'info' : 'neutral'}>
                        {l.tipo === 'cloak' ? '/c' : '/go'}
                      </StatusBadge>
                      <span className="truncate text-sm text-foreground">{l.nome}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => handleReset(l.tipo === 'cloak' ? 'cloak:' + l.slug : l.slug)}
                      className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                      aria-label={`Zerar ${l.nome}`}
                    >
                      <RotateCcw className="size-3.5" />
                    </button>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="text-success">offer {l.offer}</span>
                    <span className="text-warning">white {l.white}</span>
                    <span className="ml-auto">{pct}% bloqueado</span>
                  </div>
                  <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="bg-success" style={{ width: `${100 - pct}%` }} aria-hidden="true" />
                    <div className="bg-warning" style={{ width: `${pct}%` }} aria-hidden="true" />
                  </div>
                  {/* Item 144: evolução diária offer×white */}
                  {Array.isArray(l.daily) && <DailyMiniChart daily={l.daily} />}
                </li>
              )
            })}
        </ul>
      )}
    </GlassCard>
  )
}
