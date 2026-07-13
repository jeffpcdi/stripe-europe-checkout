import { cn } from '@/lib/utils'

/**
 * Skeleton fiel e parametrizado — substitui blocos genéricos nas abas.
 * Usa a classe .skeleton (shimmer ciano) já definida em globals.css.
 */
export function SkeletonCard({
  lines = 3,
  header = true,
  height,
  className,
}: {
  /** Quantidade de linhas de texto simuladas */
  lines?: number
  /** Mostra a linha de título mais larga no topo */
  header?: boolean
  /** Altura fixa opcional (ex.: gráficos) — ignora lines */
  height?: number
  className?: string
}) {
  return (
    <div
      className={cn('glass rounded-xl border border-border p-4', className)}
      role="status"
      aria-label="Carregando"
    >
      {height ? (
        <div className="skeleton w-full rounded-lg" style={{ height }} />
      ) : (
        <div className="flex flex-col gap-2.5">
          {header && <div className="skeleton h-4 w-1/3 rounded" />}
          {Array.from({ length: lines }).map((_, i) => (
            <div
              key={i}
              className="skeleton h-3 rounded"
              style={{ width: `${88 - i * 14}%` }}
            />
          ))}
        </div>
      )}
      <span className="sr-only">Carregando conteúdo…</span>
    </div>
  )
}
