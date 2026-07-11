import { cn } from '@/lib/utils'

type GlassVariant = 'default' | 'thick' | 'clear' | 'brand'

const variantClass: Record<GlassVariant, string> = {
  default: '',
  thick: 'glass-thick',
  clear: 'glass-clear',
  brand: 'glass-brand',
}

export function GlassCard({
  variant = 'default',
  hover = false,
  sheen = false,
  className,
  children,
  ref,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  variant?: GlassVariant
  hover?: boolean
  sheen?: boolean
  // React 19 ref-as-prop: permite que modais (item 189) prendam o foco no card.
  ref?: React.Ref<HTMLDivElement>
}) {
  return (
    <div
      ref={ref}
      className={cn(
        'glass surface',
        variantClass[variant],
        hover && 'surface-hover',
        sheen && 'sheen',
        className,
      )}
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
    <div className={cn('flex items-start justify-between gap-3 p-5 pb-0', className)}>
      {children}
    </div>
  )
}

export function GlassCardTitle({
  className,
  children,
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 className={cn('text-sm font-medium text-sub text-pretty', className)}>
      {children}
    </h3>
  )
}

export function GlassCardContent({
  className,
  children,
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5', className)}>{children}</div>
}
