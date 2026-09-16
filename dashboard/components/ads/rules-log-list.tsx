'use client'

import { useState } from 'react'
import { timeAgo, cleanCampaignName } from '@/lib/format'
import type { AdsRuleLogEntry } from '@/lib/types'
import { cn } from '@/lib/utils'

function logState(l: AdsRuleLogEntry): { label: string; dot: string } {
  if (l.simulated) return { label: 'Simulação', dot: 'bg-muted-foreground' }
  if (l.proposed) return { label: 'Proposta', dot: 'bg-warning' }
  if (l.approvedProposal) return { label: 'Aprovada por você', dot: 'bg-success' }
  if (!l.ok) return { label: 'Falhou', dot: 'bg-error' }
  return { label: 'Executada', dot: 'bg-brand-cyan' }
}

type LogFilter = 'all' | 'proposed' | 'executed' | 'failed'
const LOG_FILTERS: [LogFilter, string][] = [
  ['all', 'Todas'],
  ['proposed', 'Propostas'],
  ['executed', 'Executadas'],
  ['failed', 'Falhas'],
]

export function RulesLogList({ log, limit = 12, filterable = false, emptyText = 'Nada por aqui ainda. A automação avalia suas regras periodicamente.' }: { log: AdsRuleLogEntry[]; limit?: number; filterable?: boolean; emptyText?: string }) {
  const [filter, setFilter] = useState<LogFilter>('all')
  const filtered = (log ?? []).filter((l) => {
    if (filter === 'proposed') return !!l.proposed
    if (filter === 'failed') return !l.ok && !l.proposed
    if (filter === 'executed') return l.ok && !l.proposed && !l.simulated
    return true
  }).slice(0, limit)

  return <div className="flex flex-col gap-2">
    {filterable ? <div className="flex flex-wrap gap-4 border-b border-border/60" role="tablist" aria-label="Filtrar histórico">{LOG_FILTERS.map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={filter === key} onClick={() => setFilter(key)} className={cn('min-h-10 border-b-2 px-0 text-xs font-medium transition-colors', filter === key ? 'border-brand-cyan text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}>{label}</button>)}</div> : null}
    {filtered.length === 0 ? <p className="py-4 text-center text-xs leading-relaxed text-muted-foreground">{(log ?? []).length === 0 ? emptyText : 'Nada neste filtro.'}</p> : <ul className="flex flex-col divide-y divide-border/60">{filtered.map((l, i) => {
      const state = logState(l)
      return <li key={`${l.at}-${i}`} className="flex items-start gap-3 py-3">
        <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', state.dot)} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-xs font-medium text-foreground">{state.label}</span>
            <span className="text-xs text-muted-foreground">{timeAgo(l.at)}</span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-sub"><span className="font-medium text-foreground">{cleanCampaignName(l.campaignName || l.campaignId)}</span>{' — '}{l.result || l.detail}</p>
        </div>
      </li>
    })}</ul>}
  </div>
}
