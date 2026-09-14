import { cn } from '@/lib/utils'

/**
 * Título de seção padronizado.
 * Mantém a identidade cósmica pela pequena marca lateral, mas evita texto
 * excessivamente decorativo para melhorar leitura em telas densas.
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
    <div className={cn('section-title-v1 min-w-0', className)}>
      {eyebrow ? <p className="section-title-v1__eyebrow mb-1">{eyebrow}</p> : null}
      <Tag className="section-title-v1__heading text-balance">
        <span>{children}</span>
      </Tag>
    </div>
  )
}
