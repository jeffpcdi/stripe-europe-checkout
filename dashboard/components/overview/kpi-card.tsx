'use client'

import type { LucideIcon } from 'lucide-react'
import { TrendingUp, TrendingDown } from 'lucide-react'
import { GlassCard } from '@/components/glass-card'
import { cn } from '@/lib/utils'

export type KpiTint = 'green' | 'cyan' | 'amber' | 'neutral'

const tintText: Record<KpiTint, string> = {
  green: 'text-success',
  cyan: 'text-brand-cyan',
  amber: 'text-warning',
  neutral: 'text-muted-foreground',
}

const tintBg: Record<KpiTint, string> = {
  green: 'bg-[var(--success-light)]',
  cyan: 'bg-[var(--accent-light)]',
  amber: 'bg-[var(--warning-light)]',
  neutral: 'bg-[var(--hover)]',
}

export function DeltaChip({ delta, invert = false }: { delta: number | null; invert?: boolean }) {
  if (delta === null) return null
  const good = invert ? delta < 0 : delta > 0
  const Icon = delta >= 0 ? TrendingUp : TrendingDown
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium',
        delta === 0
          ? 'bg-[var(--hover)] text-muted-foreground'
          : good
            ? 'bg-[var(--success-light)] text-success'
            : 'bg-[var(--error-light)] text-error',
      )}
    >
      <Icon className="size-3" aria-hidden="true" />
      {Math.abs(delta)}%
    </span>
  )
}

export function KpiCard({
  icon: Icon,
  tint,
  label,
  value,
  sub,
  delta,
  deltaInvert,
  spark,
  hero = false,
  index = 0,
}: {
  icon: LucideIcon
  tint: KpiTint
  label: string
  value: React.ReactNode
  sub: React.ReactNode
  delta?: number | null
  deltaInvert?: boolean
  spark?: React.ReactNode
  hero?: boolean
  index?: number
}) {
  return (
    <GlassCard
      className={cn('anim-kpi-in relative overflow-hidden p-5', hero && 'kpi-hero')}
      style={{ animationDelay: `${index * 70}ms` }}
    >
      {hero ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
          style={{ background: 'var(--brand-grad)' }}
        />
      ) : null}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span
            className={cn(
              'flex size-8 items-center justify-center rounded-[10px]',
              tintBg[tint],
              tintText[tint],
            )}
            aria-hidden="true"
          >
            <Icon className="size-4" />
          </span>
          <span className="text-[13px] font-medium text-sub">{label}</span>
        </div>
        {delta !== undefined ? <DeltaChip delta={delta} invert={deltaInvert} /> : null}
      </div>

      <div className="mt-4 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-2xl font-semibold tracking-tight">{value}</div>
          <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
        </div>
        {spark}
      </div>
    </GlassCard>
  )
}
