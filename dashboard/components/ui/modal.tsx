import { useEffect } from 'react'
import { X } from 'lucide-react'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  description?: string
  children: React.ReactNode
  maxWidth?: string
}

export function Modal({ isOpen, onClose, title, description, children, maxWidth = 'max-w-md' }: ModalProps) {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = 'unset'
    }
    return () => {
      document.body.style.overflow = 'unset'
    }
  }, [isOpen])

  // Fecha no ESC
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose()
    }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className={`w-full ${maxWidth} relative animate-in fade-in zoom-in-95 duration-200 rounded-xl border border-white/10 bg-black/50 p-5 shadow-[0_0_40px_rgba(0,0,0,0.5)] backdrop-blur-xl`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div className="mb-4 flex items-start justify-between gap-3 border-b border-white/10 pb-4">
          <div>
            <h3 id="modal-title" className="text-sm font-semibold text-white">
              {title}
            </h3>
            {description && <p className="mt-1 text-xs text-white/50">{description}</p>}
          </div>
          <button
            onClick={onClose}
            className="flex shrink-0 items-center justify-center rounded-full bg-white/5 p-1.5 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Fechar"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="mt-2">{children}</div>
      </div>
    </div>
  )
}
