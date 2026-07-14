'use client'

import { useHealth } from '@/lib/api'
import { cn } from '@/lib/utils'

function aggregateHealth(d: {
  db: boolean
  migrations?: boolean
  redis: boolean
  redisEnabled: boolean
  queues?: { conv: { queue: number; processing: number } | null; capiRetry: number }
}): { level: 'ok' | 'warn' | 'crit'; label: string } {
  if (!d.db || d.migrations === false) return { level: 'crit', label: 'Crítico' }
  const convQueue = d.queues?.conv?.queue ?? 0
  const capiRetry = d.queues?.capiRetry ?? 0
  if ((d.redisEnabled && !d.redis) || convQueue > 20 || capiRetry > 0)
    return { level: 'warn', label: 'Atenção' }
  return { level: 'ok', label: 'Operacional' }
}

const AGG_STYLE = {
  ok: { dot: 'svc-dot svc-dot--ok', text: 'text-success' },
  warn: { dot: 'svc-dot svc-dot--off', text: 'text-warning' },
  crit: { dot: 'svc-dot svc-dot--off', text: 'text-error' },
} as const

export function HealthDot() {
  const { data, error } = useHealth()
  const agg = data ? aggregateHealth(data) : null

  const level = error ? 'warn' : !data ? 'ok' : (agg?.level ?? 'warn')
  const label = error ? 'Indisponível' : (agg?.label ?? 'Verificando…')

  return (
    <div
      className="glass flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium cursor-default"
      title={`Saúde do sistema: ${label}`}
    >
      <span className={AGG_STYLE[level].dot} aria-hidden="true" />
      <span className={cn('font-mono text-[11px] font-semibold', AGG_STYLE[level].text)}>
        {label}
      </span>
    </div>
  )
}
