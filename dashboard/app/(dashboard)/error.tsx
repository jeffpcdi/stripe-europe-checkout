'use client'

import { useEffect } from 'react'
import { TriangleAlert, RotateCcw } from 'lucide-react'

// Chunk velho após deploy/restart do servidor: o HTML aberto referencia um
// bundle que não existe mais. Um reload completo resolve sozinho — sem isso o
// operador vê "Algo quebrou" para um problema que se cura com F5.
function isStaleChunkError(message: string) {
  return /ChunkLoadError|Loading chunk|dynamically imported module|Importing a module script failed/i.test(
    message,
  )
}

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
    console.error('[dashboard-error-boundary]', error)

    // Erros pegos por boundary NÃO passam por window.onerror — o
    // ClientErrorReporter nunca os via e o "já foram registrados" era falso.
    // Reporta direto no coletor (sendBeacon sobrevive a reload/unload).
    try {
      const payload = JSON.stringify({
        message: `[boundary] ${error.message || 'Erro desconhecido'}`.slice(0, 300),
        stack: (error.stack || '').slice(0, 800),
        url: window.location.pathname,
      })
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/client-error', new Blob([payload], { type: 'text/plain' }))
      } else {
        fetch('/api/client-error', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: true,
        }).catch(() => {})
      }
    } catch {
      /* o boundary nunca pode quebrar por causa do reporte */
    }

    // Auto-recuperação de chunk velho — no máximo 1 reload por sessão para
    // nunca entrar em loop se o erro persistir após recarregar.
    if (isStaleChunkError(error.message || '')) {
      const KEY = 'v0-chunk-reload'
      if (!sessionStorage.getItem(KEY)) {
        sessionStorage.setItem(KEY, '1')
        window.location.reload()
      }
    }
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
        {/* Mensagem real do erro — sem ela o operador só podia dizer "quebrou",
            impossível diagnosticar por screenshot. */}
        {error.message && (
          <p className="mt-3 break-words rounded-lg bg-secondary/50 px-3 py-2 text-left font-mono text-[11px] leading-relaxed text-muted-foreground">
            {error.message.slice(0, 220)}
          </p>
        )}
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
