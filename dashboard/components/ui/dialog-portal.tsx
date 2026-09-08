'use client'

import { createPortal } from 'react-dom'

// Mantém os popups fora de cards com transform, filtro ou overflow.
export function DialogPortal({ children }: { children: React.ReactNode }) {
  return typeof document === 'undefined' ? null : createPortal(children, document.body)
}
