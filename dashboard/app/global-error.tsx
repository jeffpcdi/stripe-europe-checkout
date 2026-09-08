'use client'

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="pt-BR">
      <body className="flex min-h-dvh items-center justify-center bg-[#0a0f16] text-[#e2e8f0] px-4 font-sans antialiased">
        <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0d1622]/90 p-8 text-center shadow-2xl backdrop-blur-xl">
          <span
            className="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl bg-red-500/10 text-red-400 border border-red-500/20"
            aria-hidden="true"
          >
            <svg className="size-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </span>
          <h1 className="text-lg font-semibold text-white">
            Ocorreu um erro inesperado
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">
            Houve uma falha ao carregar a interface. Tente recarregar ou voltar para a visão geral.
          </p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => reset()}
              className="inline-flex items-center gap-2 rounded-lg bg-[#25f4ee] px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90 cursor-pointer"
            >
              <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </svg>
              Tentar novamente
            </button>
            <a
              href="/dashboard"
              className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/10"
            >
              Visão geral
            </a>
          </div>
        </div>
      </body>
    </html>
  )
}
