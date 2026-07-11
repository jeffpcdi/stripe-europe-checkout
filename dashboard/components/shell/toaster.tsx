'use client'

// Item 183: renderização do toaster global. Montado uma vez no layout da
// Gestão. Região aria-live="polite" (assertiva para erros) anuncia cada toast
// para leitores de tela; visualmente empilha no canto inferior direito.

import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react'
import { useToasts, toast, type ToastKind } from '@/lib/toast'

const ICON: Record<ToastKind, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: AlertTriangle,
  info: Info,
}

const TONE: Record<ToastKind, string> = {
  success: 'border-success/40 text-success',
  error: 'border-destructive/50 text-destructive',
  info: 'border-brand-cyan/40 text-brand-cyan',
}

export function Toaster() {
  const toasts = useToasts()

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:items-end"
      // Região viva: leitores de tela anunciam novos toasts sem roubar foco.
      role="region"
      aria-label="Notificações"
    >
      <ol className="flex w-full max-w-sm flex-col gap-2" aria-live="polite" aria-relevant="additions">
        {toasts.map((t) => {
          const Icon = ICON[t.kind]
          return (
            <li
              key={t.id}
              // erro = assertivo (interrompe); sucesso/info = polido
              role={t.kind === 'error' ? 'alert' : 'status'}
              className={`pointer-events-auto flex items-start gap-2.5 rounded-xl border bg-card/95 px-3.5 py-3 text-sm shadow-lg backdrop-blur ${TONE[t.kind]}`}
            >
              <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-foreground text-pretty">{t.message}</p>
                {t.hint && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground text-pretty">{t.hint}</p>}
              </div>
              <button
                type="button"
                onClick={() => toast.dismiss(t.id)}
                aria-label="Dispensar notificação"
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
