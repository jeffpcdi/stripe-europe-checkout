'use client'

// Item 184 (extensão): hook que remove o boilerplate de estado do ConfirmDialog.
// Cada view chama `confirm({ title, description, run })` e renderiza
// `<ConfirmDialog {...dialogProps} />` uma vez. O `run` roda com `busy=true`
// (spinner no botão, ESC/backdrop travados) e o diálogo fecha ao terminar.

import { useCallback, useState } from 'react'

export interface ConfirmRequest {
  title: string
  description: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** Se definido, exige digitar exatamente este texto (nome do item com tráfego). */
  confirmText?: string
  tone?: 'danger' | 'default'
  /** Retorne `false` para manter o diálogo aberto após uma falha tratada. */
  run: () => void | boolean | Promise<void | boolean>
}

export function useConfirm() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null)
  const [busy, setBusy] = useState(false)

  const confirm = useCallback((req: ConfirmRequest) => setRequest(req), [])

  const close = useCallback(() => {
    setBusy((b) => {
      if (!b) setRequest(null)
      return b
    })
  }, [])

  const onConfirm = useCallback(async () => {
    if (!request) return
    setBusy(true)
    try {
      const completed = await request.run()
      if (completed !== false) setRequest(null)
    } finally {
      setBusy(false)
    }
  }, [request])

  const dialogProps = {
    open: request !== null,
    title: request?.title ?? '',
    description: request?.description ?? null,
    confirmLabel: request?.confirmLabel,
    cancelLabel: request?.cancelLabel,
    confirmText: request?.confirmText,
    tone: request?.tone,
    busy,
    onConfirm,
    onClose: close,
  }

  return { confirm, dialogProps }
}
