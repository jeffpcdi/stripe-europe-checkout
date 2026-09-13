'use client'

import { DialogPortal } from '@/components/ui/dialog-portal'

import { useId, useRef } from 'react'
import { X } from 'lucide-react'
import { useModalA11y } from '@/lib/use-modal-a11y'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  description?: string
  children: React.ReactNode
  maxWidth?: string
  busy?: boolean
}

export function Modal({ isOpen, onClose, title, description, children, maxWidth = 'max-w-md', busy = false }: ModalProps) {
  const id = useId()
  const ref = useRef<HTMLDivElement>(null)
  useModalA11y(isOpen, ref, busy ? () => {} : onClose)
  if (!isOpen) return null
  return (
    <DialogPortal><div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-2.5 backdrop-blur-sm sm:p-6" onClick={e => { if (!busy && e.target === e.currentTarget) onClose() }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-busy={busy || undefined} aria-labelledby={`${id}-title`} aria-describedby={description ? `${id}-description` : undefined} tabIndex={-1}
        className={`dialog-surface relative flex max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)] w-full ${maxWidth} flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl`}>
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border p-4 sm:p-5">
          <div className="min-w-0">
            <h2 id={`${id}-title`} className="text-base font-semibold text-foreground">{title}</h2>
            {description && <p id={`${id}-description`} className="mt-1 text-sm text-muted-foreground">{description}</p>}
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="flex size-9 sm:size-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed" aria-label="Fechar"><X className="size-4" /></button>
        </div>
        <div className="min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-5">{children}</div>
      </div>
    </div></DialogPortal>
  )
}
