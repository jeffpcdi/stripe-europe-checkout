'use client'

// Item 182: estado de erro consistente para falha de fetch nas abas de Gestão.
// Todas as listas/painéis usam o mesmo visual + botão "Tentar novamente" que
// dispara o mutate() do SWR (revalida sem recarregar a página).

import { AlertTriangle, RotateCw } from 'lucide-react'
import { GlassCard } from '@/components/glass-card'

export function ErrorState({
  title = 'Não foi possível carregar',
  description = 'Confira sua conexão e tente novamente.',
  onRetry,
  retrying = false,
}: {
  title?: string
  description?: string
  onRetry?: () => void
  retrying?: boolean
}) {
  return (
    <GlassCard
      role="alert"
      className="flex min-h-48 flex-col items-center justify-center gap-3 p-8 text-center"
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle className="h-5 w-5" aria-hidden="true" />
      </span>
      <div className="flex flex-col gap-1">
        <p className="text-base font-semibold text-destructive text-balance">{title}</p>
        <p className="max-w-sm text-sm text-muted-foreground text-pretty">{description}</p>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="mt-1 inline-flex items-center gap-2 rounded-full border border-border bg-secondary px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary/70 disabled:opacity-60"
        >
          <RotateCw className={retrying ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} aria-hidden="true" />
          {retrying ? 'Recarregando…' : 'Tentar novamente'}
        </button>
      )}
    </GlassCard>
  )
}
