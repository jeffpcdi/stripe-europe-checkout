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
  footer?: React.ReactNode
}

export function Modal({ isOpen, onClose, title, description, children, maxWidth = 'max-w-md', busy = false, footer }: ModalProps) {
  const id = useId()
  const ref = useRef<HTMLDivElement>(null)
  const requestClose = () => { if (!busy) onClose() }
  useModalA11y(isOpen, ref, requestClose)
  if (!isOpen) return null
  return (
    <DialogPortal><div className="universe-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-2.5 backdrop-blur-sm sm:p-6" onClick={e => { if (e.target === e.currentTarget) requestClose() }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-busy={busy} aria-labelledby={`${id}-title`} aria-describedby={description ? `${id}-description` : undefined} tabIndex={-1}
        className={`universe-modal dialog-surface relative flex max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)] w-full ${maxWidth} flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl`}>
        <div className="dialog-header flex shrink-0 items-start justify-between gap-4 border-b border-border p-4 sm:p-5">
          <div className="min-w-0">
            <h2 id={`${id}-title`} className="text-base font-semibold text-foreground">{title}</h2>
            {description && <p id={`${id}-description`} className="mt-1 text-sm text-muted-foreground">{description}</p>}
          </div>
          <button type="button" disabled={busy} onClick={requestClose} className="dialog-close flex size-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40" aria-label="Fechar"><X className="size-4" /></button>
        </div>
        <div className="dialog-body min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-5">{children}</div>
        {footer && <div className="dialog-footer shrink-0 border-t border-border p-4 sm:p-5">{footer}</div>}
      </div>
    </div></DialogPortal>
  )
}
