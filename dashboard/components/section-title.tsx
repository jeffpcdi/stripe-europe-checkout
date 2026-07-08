import { cn } from '@/lib/utils'

/**
 * Título de seção padronizado — barra de marca + título + eyebrow opcional.
 * Substitui os h2 ad-hoc para consistência entre as 11 telas.
 */
export function SectionTitle({
  children,
  eyebrow,
  className,
  as: Tag = 'h2',
}: {
  children: React.ReactNode
  eyebrow?: string
  className?: string
  as?: 'h2' | 'h3'
}) {
  return (
    <div className={cn('min-w-0', className)}>
      {eyebrow ? <p className="label-mono mb-0.5">{eyebrow}</p> : null}
      <Tag className="section-head text-sm font-semibold text-foreground">
        {children}
      </Tag>
    </div>
  )
}
