'use client'

import type { LucideIcon } from 'lucide-react'
import Link from 'next/link'
import { TrendingUp, TrendingDown } from 'lucide-react'
import { GlassCard } from '@/components/glass-card'
import { fmtDelta } from '@/lib/format'
import { useValueFlash } from '@/lib/motion'
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

// Item 20: glow neon da cor da métrica na cápsula do ícone
const tintGlow: Record<KpiTint, string> = {
  green: '0 0 14px rgba(34,197,94,.35)',
  cyan: '0 0 14px rgba(37,244,238,.35)',
  amber: '0 0 14px rgba(251,191,36,.35)',
  neutral: 'none',
}

export function DeltaChip({
  delta,
  invert = false,
  unit = 'pct',
}: {
  delta: number | null
  invert?: boolean
  /* Item 291: 'pp' = pontos percentuais (delta de métricas que JÁ são %) */
  unit?: 'pct' | 'pp'
}) {
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
            ? 'bg-[var(--success-light)] text-success border border-success/30 shadow-[0_0_10px_rgba(34,197,94,0.2)]'
            : 'bg-[var(--error-light)] text-error border border-error/30 shadow-[0_0_10px_rgba(239,68,68,0.2)]',
      )}
    >
      {/* Item 21: seta entra com spring */}
      <Icon className="delta-icon size-3" aria-hidden="true" />
      <span className="font-mono tabular-nums">
        {unit === 'pp'
          ? `${delta > 0 ? '+' : ''}${delta.toFixed(1).replace('.', ',')} p.p.`
          : fmtDelta(delta)}
      </span>
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
  deltaUnit,
  spark,
  hero = false,
  index = 0,
  ariaLabel,
  href,
  watch,
}: {
  icon: LucideIcon
  tint: KpiTint
  label: string
  value: React.ReactNode
  sub: React.ReactNode
  delta?: number | null
  deltaInvert?: boolean
  deltaUnit?: 'pct' | 'pp'
  spark?: React.ReactNode
  hero?: boolean
  index?: number
  /* Item 299: frase única para leitores de tela (valor + delta + período),
     em vez de o leitor soletrar CountUp, chip e sparkline separadamente. */
  ariaLabel?: string
  /* Item 279: com href o card inteiro vira drill-down para a aba filtrada */
  href?: string
  /* A1.2: valor numérico observado — quando muda entre polls, a borda do
     card dá um tick de brilho ciano (400ms) sinalizando dado vivo. */
  watch?: number
}) {
  const flashing = useValueFlash(watch, 400)
  const card = (
    /* V2-59: hover-glow + tilt 3D no hero; V2-83: spotlight segue o cursor */
    <GlassCard
      hover
      sheen
      spotlight
      role="group"
      aria-label={ariaLabel}
      className={cn(
        'anim-kpi-in hover-glow group relative h-full overflow-hidden p-5 transition-shadow duration-300',
        hero && 'kpi-hero hover-tilt',
        flashing && 'kpi-tick',
        tint === 'green' && 'hover:shadow-[0_0_25px_rgba(34,197,94,0.15)]',
        tint === 'cyan' && 'hover:shadow-[0_0_25px_rgba(37,244,238,0.15)]',
        tint === 'amber' && 'hover:shadow-[0_0_25px_rgba(251,191,36,0.15)]',
      )}
      style={{ animationDelay: `${index * 70}ms` }}
    >
      {/* Item 117: hairline gradiente padronizada em todos os KPIs (mais forte no hero) */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{ background: 'var(--brand-grad)', opacity: hero ? 1 : 0.35 }}
      />
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {/* V2-60: ícone inclina no hover do card (micro personalidade) */}
          <span
            className={cn(
              'icon-tilt flex size-8 items-center justify-center rounded-[10px]',
              tintBg[tint],
              tintText[tint],
            )}
            style={{ boxShadow: tintGlow[tint] }}
            aria-hidden="true"
          >
            <Icon className="size-4" />
          </span>
          <span className="label-mono">{label}</span>
        </div>
        {delta !== undefined ? <DeltaChip delta={delta} invert={deltaInvert} unit={deltaUnit} /> : null}
      </div>

      <div className="mt-4 flex items-end justify-between gap-3">
        <div className="min-w-0">
          {/* V2-61: hero usa tipografia display fluida (clamp por viewport) */}
          <div
            className={cn(
              'font-mono tracking-tight transition-all duration-300 origin-left',
              hero ? 'kpi-value-hero text-display' : 'text-2xl font-semibold',
              flashing && 'scale-[1.03] text-brand-cyan'
            )}
          >
            {value}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
        </div>
        {spark}
      </div>
    </GlassCard>
  )

  if (href) {
    return (
      <Link
        href={href}
        aria-label={ariaLabel ? `${ariaLabel} — ver detalhes` : `${label} — ver detalhes`}
        className="block h-full rounded-[var(--radius)] focus-visible:outline-2 focus-visible:outline-ring"
      >
        {card}
      </Link>
    )
  }

  return card
}
