'use client'

// "O que o robô fez" — feed das últimas ações/propostas do motor de automação.
// Extraído do automation-panel para ser reusado na aba Hoje (limit menor, sem
// filtros) e em Automações (com filtros). Puro de apresentação: recebe o log.

import { useState } from 'react'
import { timeAgo, cleanCampaignName } from '@/lib/format'
import type { AdsRuleLogEntry } from '@/lib/types'
import { cn } from '@/lib/utils'

function logBadge(l: AdsRuleLogEntry): { label: string; cls: string } {
  if (l.simulated) return { label: 'teste', cls: 'bg-[var(--hover)] text-muted-foreground' }
  if (l.proposed) return { label: 'proposta', cls: 'bg-warning/15 text-warning' }
  if (l.approvedProposal) return { label: 'aprovada por você', cls: 'bg-success/15 text-success' }
  if (!l.ok) return { label: 'falhou', cls: 'bg-error/15 text-error' }
  return { label: 'feito', cls: 'bg-[var(--accent-light)] text-brand-cyan' }
}

type LogFilter = 'all' | 'proposed' | 'executed' | 'failed'
const LOG_FILTERS: [LogFilter, string][] = [
  ['all', 'Todas'],
  ['proposed', 'Propostas'],
  ['executed', 'Feitas'],
  ['failed', 'Falhas'],
]

export function RulesLogList({
  log,
  limit = 12,
  filterable = false,
  emptyText = 'Nada por aqui ainda. O robô avalia suas automações a cada poucos minutos.',
}: {
  log: AdsRuleLogEntry[]
  limit?: number
  filterable?: boolean
  emptyText?: string
}) {
  const [filter, setFilter] = useState<LogFilter>('all')

  const filtered = (log ?? [])
    .filter((l) => {
      if (filter === 'proposed') return !!l.proposed
      if (filter === 'failed') return !l.ok && !l.proposed
      if (filter === 'executed') return l.ok && !l.proposed && !l.simulated
      return true
    })
    .slice(0, limit)

  return (
    <div className="flex flex-col gap-2">
      {filterable && (
        <div className="flex flex-wrap gap-1">
          {LOG_FILTERS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
              className={cn(
                'rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors',
                filter === key ? 'bg-[var(--accent-light)] text-brand-cyan' : 'text-muted-foreground hover:text-sub',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {filtered.length === 0 ? (
        <p className="py-4 text-center text-xs leading-relaxed text-muted-foreground">
          {(log ?? []).length === 0 ? emptyText : 'Nada neste filtro.'}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border/60">
          {filtered.map((l, i) => {
            const badge = logBadge(l)
            return (
              <li key={`${l.at}-${i}`} className="flex items-start gap-2 py-2">
                <span className={cn('mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium', badge.cls)}>
                  {badge.label}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] text-sub">
                    <span className="font-medium text-foreground">
                      {cleanCampaignName(l.campaignName || l.campaignId)}
                    </span>
                    {' — '}
                    {l.result || l.detail}
                  </p>
                </div>
                <span
                  className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground"
                  title={new Date(l.at).toLocaleString('pt-BR')}
                >
                  {timeAgo(l.at)}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
