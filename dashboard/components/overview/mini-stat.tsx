'use client'

import type { LucideIcon } from 'lucide-react'
import { GlassCard } from '@/components/glass-card'

// Réplica do mstat() legado: chip compacto com ícone tintado, valor e contexto.
export function MiniStat({
  icon: Icon,
  color,
  bg,
  label,
  value,
  sub,
  extra,
  index = 0,
}: {
  icon: LucideIcon
  color: string
  bg: string
  label: string
  value: React.ReactNode
  sub: string
  extra?: React.ReactNode
  index?: number
}) {
  return (
    <GlassCard
      variant="clear"
      className="anim-kpi-in flex items-center justify-between gap-3 p-4"
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span
          className="flex size-8 shrink-0 items-center justify-center rounded-[10px]"
          style={{ color, background: bg }}
          aria-hidden="true"
        >
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="truncate font-mono text-base font-semibold" style={{ color }}>
            {value}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">{sub}</p>
        </div>
      </div>
      {extra}
    </GlassCard>
  )
}
