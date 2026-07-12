import Link from 'next/link'
import { Compass } from 'lucide-react'

// Item 398: 404 do dashboard na identidade do painel (dark + glass),
// em vez do 404 genérico do Next. Server component puro — sem JS extra.
export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="glass w-full max-w-md rounded-2xl p-8 text-center">
        <span
          className="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl bg-secondary text-[color:var(--brand-cyan)]"
          aria-hidden="true"
        >
          <Compass className="size-6" />
        </span>
        <p className="font-mono text-5xl font-bold text-foreground">404</p>
        <h1 className="mt-2 text-lg font-semibold text-foreground text-balance">
          Essa página não existe
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground text-pretty">
          O endereço pode ter mudado ou nunca existiu. Volte para a visão geral
          e siga a partir de lá.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-[color:var(--brand-cyan)] px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90"
        >
          Ir para a visão geral
        </Link>
      </div>
    </main>
  )
}
