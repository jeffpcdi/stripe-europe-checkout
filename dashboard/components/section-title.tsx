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
    /* V2-70: eyebrow agora usa o gradiente ciano→rosa da marca */
    <div className={cn('section-title-shell min-w-0', className)}>
      <span className="section-orbit" aria-hidden="true" />
      {eyebrow ? <p className="label-mono label-mono--gradient section-eyebrow mb-0.5">{eyebrow}</p> : null}
      <Tag className="section-head section-head--universe text-balance text-sm font-semibold">
        <span className="text-gradient-metallic">{children}</span>
      </Tag>
    </div>
  )
}
