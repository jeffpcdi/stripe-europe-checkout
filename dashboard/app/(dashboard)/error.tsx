'use client'

import { useEffect } from 'react'
import { TriangleAlert, RotateCcw } from 'lucide-react'

// Item 397: error boundary por rota na identidade do painel. Qualquer erro de
// render numa página do grupo (dashboard) cai aqui SEM derrubar o shell
// (sidebar/header continuam funcionando). O reset() re-renderiza só o segmento.
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Vai para o coletor de erros de front (item 561) via console interceptado.
    console.error('[dashboard-error-boundary]', error)
  }, [error])

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4" role="alert">
      <div className="glass w-full max-w-md rounded-2xl p-8 text-center">
        <span
          className="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl bg-destructive/10 text-destructive"
          aria-hidden="true"
        >
          <TriangleAlert className="size-6" />
        </span>
        <h1 className="text-lg font-semibold text-foreground text-balance">
          Algo quebrou nesta página
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground text-pretty">
          O resto do painel continua funcionando. Tente recarregar esta seção —
          se persistir, os detalhes já foram registrados.
        </p>
        {error.digest && (
          <p className="mt-2 font-mono text-[11px] text-muted-foreground">
            ref: {error.digest}
          </p>
        )}
        <button
          type="button"
          onClick={reset}
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-[color:var(--brand-cyan)] px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90"
        >
          <RotateCcw className="size-4" />
          Tentar de novo
        </button>
      </div>
    </div>
  )
}
