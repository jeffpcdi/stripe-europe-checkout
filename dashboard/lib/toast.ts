'use client'

// Item 183: toaster global de feedback. Store mínimo (sem dependência externa)
// com um hook de subscrição. Substitui os savedAt/copied/erro improvisados em
// cada view por um canal único, anunciado via aria-live no <Toaster>.
//
// Uso em qualquer client component:
//   import { toast } from '@/lib/toast'
//   toast.success('Pixel salvo')
//   toast.error('Falha ao salvar', { hint: 'Verifique o Access Token.' })
//   toast.info('Copiado')

import { useEffect, useState } from 'react'

export type ToastKind = 'success' | 'error' | 'info'

export interface Toast {
  id: number
  kind: ToastKind
  message: string
  hint?: string
  /** ms até sumir sozinho; 0 = não some automaticamente */
  duration: number
}

type Listener = (toasts: Toast[]) => void

let _toasts: Toast[] = []
let _seq = 0
const _listeners = new Set<Listener>()

function emit() {
  for (const l of _listeners) l(_toasts)
}

function remove(id: number) {
  _toasts = _toasts.filter((t) => t.id !== id)
  emit()
}

function push(kind: ToastKind, message: string, opts?: { hint?: string; duration?: number }) {
  const id = ++_seq
  // erro fica mais tempo (usuário precisa ler a orientação); demais 3.5s
  const duration = opts?.duration ?? (kind === 'error' ? 6000 : 3500)
  const t: Toast = { id, kind, message, hint: opts?.hint, duration }
  // no máx 4 na tela — descarta o mais antigo
  _toasts = [..._toasts.slice(-3), t]
  emit()
  if (duration > 0 && typeof window !== 'undefined') {
    window.setTimeout(() => remove(id), duration)
  }
  return id
}

export const toast = {
  success: (message: string, opts?: { hint?: string; duration?: number }) => push('success', message, opts),
  error: (message: string, opts?: { hint?: string; duration?: number }) => push('error', message, opts),
  info: (message: string, opts?: { hint?: string; duration?: number }) => push('info', message, opts),
  dismiss: remove,
}

/** Assina a fila de toasts. Usado só pelo <Toaster>. */
export function useToasts(): Toast[] {
  const [toasts, setToasts] = useState<Toast[]>(_toasts)
  useEffect(() => {
    _listeners.add(setToasts)
    setToasts(_toasts)
    return () => {
      _listeners.delete(setToasts)
    }
  }, [])
  return toasts
}
