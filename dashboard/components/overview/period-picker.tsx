'use client'

import type { Period } from '@/lib/types'
import { cn } from '@/lib/utils'

const PERIODS: { id: Period; label: string }[] = [
  { id: 'today', label: 'Hoje' },
  { id: '7d', label: '7 dias' },
  { id: '30d', label: '30 dias' },
  { id: 'all', label: 'Tudo' },
]

export function PeriodPicker({
  value,
  onChange,
}: {
  value: Period
  onChange: (p: Period) => void
}) {
  return (
    <div
      className="glass flex items-center gap-0.5 rounded-full p-1"
      role="tablist"
      aria-label="Período das métricas"
    >
      {PERIODS.map((p) => (
        <button
          key={p.id}
          type="button"
          role="tab"
          aria-selected={value === p.id}
          onClick={() => onChange(p.id)}
          className={cn(
            'rounded-full px-3 py-1 text-xs font-medium transition-colors duration-150',
            value === p.id
              ? 'bg-[var(--active)] text-foreground'
              : 'text-muted-foreground hover:text-sub',
          )}
        >
          {p.label}
        </button>
      ))}
    </div>
  )
}
