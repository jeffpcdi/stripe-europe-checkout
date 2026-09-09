'use client'

import { cn } from '@/lib/utils'

type GlassVariant = 'default' | 'thick' | 'clear' | 'brand'

const variantClass: Record<GlassVariant, string> = {
  default: '',
  thick: 'glass-thick',
  clear: 'glass-clear',
  brand: 'glass-brand',
}

/* V2-82: spotlight — brilho radial ciano que segue o cursor dentro do card.
   Só escreve CSS vars no mousemove (sem re-render); opt-in via prop. */
function trackSpotlight(e: React.MouseEvent<HTMLDivElement>) {
  const el = e.currentTarget
  const rect = el.getBoundingClientRect()
  el.style.setProperty('--mx', `${e.clientX - rect.left}px`)
  el.style.setProperty('--my', `${e.clientY - rect.top}px`)
}

export function GlassCard({
  variant = 'default',
  hover = false,
  sheen = false,
  spotlight = false,
  className,
  children,
  ref,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  variant?: GlassVariant
  hover?: boolean
  sheen?: boolean
  /** V2-82: brilho radial que segue o cursor */
  spotlight?: boolean
  // React 19 ref-as-prop: permite que modais (item 189) prendam o foco no card.
  ref?: React.Ref<HTMLDivElement>
}) {
  return (
    <div
      ref={ref}
      className={cn(
        'glass relative overflow-hidden rounded-2xl border border-border/80 shadow-sm transition-all duration-200 before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-white/12 before:to-transparent',
        variantClass[variant],
        hover && 'surface-hover',
        sheen && 'sheen',
        spotlight && 'spotlight-card',
        className,
      )}
      onMouseMove={spotlight ? trackSpotlight : undefined}
      {...props}
    >
      {children}
    </div>
  )
}

export function GlassCardHeader({
  className,
  children,
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('flex items-start justify-between gap-3 p-5 sm:p-6 pb-0', className)}>
      {children}
    </div>
  )
}

export function GlassCardTitle({
  className,
  children,
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 className={cn('text-sm font-semibold tracking-tight text-foreground text-pretty', className)}>
      {children}
    </h3>
  )
}

export function GlassCardContent({
  className,
  children,
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5 sm:p-6 pt-3.5', className)}>{children}</div>
}
