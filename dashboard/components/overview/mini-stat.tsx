'use client'

import type { LucideIcon } from 'lucide-react'
import Link from 'next/link'
import { GlassCard } from '@/components/glass-card'

// Réplica do mstat() legado: chip compacto com ícone tintado, valor e contexto.
// Item 292: com `href`, o chip inteiro vira link (drill-down para a aba filtrada).
export function MiniStat({
  icon: Icon,
  color,
  bg,
  label,
  value,
  sub,
  extra,
  index = 0,
  href,
}: {
  icon: LucideIcon
  color: string
  bg: string
  label: string
  value: React.ReactNode
  sub: string
  extra?: React.ReactNode
  index?: number
  href?: string
}) {
  const body = (
    <>
      <div className="group flex min-w-0 items-center gap-3">
        {/* V2-62: tile do ícone com glow da própria cor + tilt no hover */}
        <span
          className="icon-tilt flex size-8 shrink-0 items-center justify-center rounded-[10px]"
          style={{ color, background: bg, boxShadow: `0 0 12px ${bg}` }}
          aria-hidden="true"
        >
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="truncate font-mono text-base font-semibold" style={{ color }}>
            {value}
          </p>
          <p className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">{sub}</p>
        </div>
      </div>
      {extra}
    </>
  )

  if (href) {
    return (
      <Link
        href={href}
        aria-label={`${label}: ${typeof value === 'string' || typeof value === 'number' ? value : ''} — ver detalhes`}
        className="rounded-[var(--radius)] focus-visible:outline-2 focus-visible:outline-ring"
      >
        <GlassCard
          variant="clear"
          hover
          className="anim-kpi-in flex h-full items-center justify-between gap-3 p-4"
          style={{ animationDelay: `${index * 60}ms` }}
        >
          {body}
        </GlassCard>
      </Link>
    )
  }

  return (
    <GlassCard
      variant="clear"
      className="anim-kpi-in flex items-center justify-between gap-3 p-4"
      style={{ animationDelay: `${index * 60}ms` }}
    >
      {body}
    </GlassCard>
  )
}
