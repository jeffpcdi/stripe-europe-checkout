'use client'

// TutorialModal — tutorial passo a passo reutilizável para qualquer aba.
// Uso: mantenha um estado `open` na view e renderize
//   <TutorialModal open={open} onClose={...} title="..." steps={STEPS} />
// Cada passo tem título, corpo (texto ou JSX) e uma dica opcional.
// O botão de gatilho padrão está em <TutorialButton />.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, CircleHelp, Lightbulb, X } from 'lucide-react'
import { GlassCard } from '@/components/glass-card'
import { useModalA11y } from '@/lib/use-modal-a11y'

export interface TutorialStep {
  title: string
  body: ReactNode
  tip?: string
}

export function TutorialButton({ onClick, label }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-brand-cyan/50 hover:bg-brand-cyan/10 hover:text-brand-cyan"
    >
      <CircleHelp className="size-3.5" aria-hidden="true" />
      {label ?? 'Como funciona'}
    </button>
  )
}

export function TutorialModal({
  open,
  onClose,
  title,
  steps,
}: {
  open: boolean
  onClose: () => void
  title: string
  steps: TutorialStep[]
}) {
  const [idx, setIdx] = useState(0)
  const dialogRef = useRef<HTMLDivElement>(null)

  // Item 189: foco preso, ESC e retorno de foco centralizados no hook.
  useModalA11y(open, dialogRef, onClose)

  // Reabrir sempre começa do passo 1.
  useEffect(() => {
    if (open) setIdx(0)
  }, [open])

  // Navegação por setas (específica deste modal, não faz parte da a11y base).
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowRight') setIdx((i) => Math.min(i + 1, steps.length - 1))
      if (e.key === 'ArrowLeft') setIdx((i) => Math.max(i - 1, 0))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, steps.length])

  if (!open || steps.length === 0) return null

  const step = steps[idx]
  const last = idx === steps.length - 1

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm md:items-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <GlassCard
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        variant="thick"
        className="my-8 w-full max-w-lg p-6 outline-none"
      >
        <div className="mb-1 flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-brand-cyan">
              Tutorial · passo {idx + 1} de {steps.length}
            </p>
            <h2 className="mt-0.5 text-base font-semibold text-foreground text-balance">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar tutorial"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Barra de progresso */}
        <div className="mb-4 mt-3 flex gap-1" aria-hidden="true">
          {steps.map((_, i) => (
            <span
              key={i}
              className={`h-1 flex-1 rounded-full transition-colors ${i <= idx ? 'bg-brand-cyan' : 'bg-secondary'}`}
            />
          ))}
        </div>

        <div className="min-h-32">
          <h3 className="mb-2 text-sm font-semibold text-foreground text-pretty">{step.title}</h3>
          <div className="text-sm leading-relaxed text-muted-foreground [&_code]:rounded [&_code]:bg-secondary [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12px] [&_code]:text-brand-cyan [&_strong]:text-foreground">
            {step.body}
          </div>
          {step.tip && (
            <p className="mt-3 flex items-start gap-2 rounded-lg border border-brand-cyan/25 bg-brand-cyan/8 px-3 py-2 text-xs leading-relaxed text-brand-cyan">
              <Lightbulb className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span className="text-pretty">{step.tip}</span>
            </p>
          )}
        </div>

        <div className="mt-5 flex items-center justify-between gap-2 border-t border-border pt-4">
          <button
            type="button"
            onClick={() => setIdx((i) => Math.max(i - 1, 0))}
            disabled={idx === 0}
            className="flex items-center gap-1 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
          >
            <ChevronLeft className="size-4" aria-hidden="true" /> Anterior
          </button>
          <button
            type="button"
            onClick={() => (last ? onClose() : setIdx((i) => Math.min(i + 1, steps.length - 1)))}
            className="flex items-center gap-1.5 rounded-lg bg-brand-cyan px-4 py-2 text-sm font-semibold text-black shadow-[var(--glow-cyan-soft)] transition-all hover:-translate-y-px hover:brightness-105 active:scale-[0.98]"
          >
            {last ? 'Entendi' : 'Próximo'}
            {!last && <ChevronRight className="size-4" aria-hidden="true" />}
          </button>
        </div>
      </GlassCard>
    </div>
  )
}
