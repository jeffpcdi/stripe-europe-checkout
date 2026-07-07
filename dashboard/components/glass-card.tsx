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
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { variant?: GlassVariant }) {
  return (
    <div className={cn('glass', variantClass[variant], className)} {...props}>
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
