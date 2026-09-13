'use client'

import { DialogPortal } from '@/components/ui/dialog-portal'

// Item 184: confirmação destrutiva padronizada (excluir link/pixel/gateway/
// domínio/entry) num único componente. Quando `confirmText` é passado, exige
// digitar exatamente aquele texto (nome do item) para habilitar o botão —
// usado em itens com tráfego, como já fazia a exclusão de links (item 76).
// A11y via useModalA11y (foco preso, ESC, retorno de foco) — item 189.

import { useEffect, useId, useRef, useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { GlassCard } from '@/components/glass-card'
import { useModalA11y } from '@/lib/use-modal-a11y'
import { cn } from '@/lib/utils'

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Excluir',
  cancelLabel = 'Cancelar',
  confirmText,
  tone = 'danger',
  busy = false,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  description: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** Se definido, o usuário precisa digitar exatamente este texto para confirmar. */
  confirmText?: string
  tone?: 'danger' | 'default'
  busy?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  const id = useId()
  const ref = useRef<HTMLDivElement>(null)
  const [typed, setTyped] = useState('')
  useModalA11y(open, ref, busy ? () => {} : onClose)

  // Limpa o campo sempre que reabrir.
  useEffect(() => {
    if (open) setTyped('')
  }, [open])

  if (!open) return null

  const needsMatch = Boolean(confirmText)
  const matched = !needsMatch || typed.trim() === confirmText!.trim()
  const canConfirm = matched && !busy

  return (
    <DialogPortal><div
      className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-black/80 p-4 backdrop-blur-xl"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div ref={ref} role="alertdialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} tabIndex={-1} className="dialog-surface w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain rounded-2xl outline-none">
        <GlassCard variant="thick" className={cn(
          "p-6 border shadow-2xl transition-all",
          tone === 'danger' 
            ? "border-destructive/30 shadow-[0_0_40px_rgba(239,68,68,0.15)]" 
            : "border-primary/30 shadow-[0_0_40px_rgba(37,244,238,0.15)]"
        )}>
          <div className="flex items-start gap-3">
            {tone === 'danger' && (
              <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-destructive/15 text-destructive">
                <AlertTriangle className="size-5" aria-hidden="true" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <h2 id={`${id}-title`} className="text-base font-semibold text-foreground text-balance">{title}</h2>
              <div id={`${id}-description`} className="mt-1.5 text-sm leading-relaxed text-muted-foreground text-pretty">{description}</div>
            </div>
          </div>

          {needsMatch && (
            <label className="mt-4 block">
              <span className="text-xs text-muted-foreground">
                Para confirmar, digite <strong className="text-foreground">{confirmText}</strong>
              </span>
              <input
                type="text"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                className="mt-1.5 w-full rounded-lg border border-border bg-secondary/40 input-neon px-3 py-2 text-sm text-foreground outline-none focus:border-destructive/60 focus:shadow-[0_0_15px_rgba(239,68,68,0.3)]"
                aria-label={`Digite ${confirmText} para confirmar`}
              />
            </label>
          )}

          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="min-h-11 rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={!canConfirm}
              className={`flex items-center gap-1.5 min-h-11 rounded-lg px-4 py-2 text-sm font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
                tone === 'danger'
                  ? 'bg-destructive text-destructive-foreground hover:brightness-110'
                  : 'bg-brand-cyan text-black hover:brightness-105'
              }`}
            >
              {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
              {confirmLabel}
            </button>
          </div>
        </GlassCard>
      </div>
    </div></DialogPortal>
  )
}
