'use client'

import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
// Só o diálogo superior recebe teclado; o último fechado libera a rolagem.
const dialogs: symbol[] = []
let originalOverflow = ''

export function useModalA11y(open: boolean, containerRef: RefObject<HTMLElement | null>, onClose: () => void, opts: { autoFocus?: boolean } = {}) {
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose }, [onClose])
  const autoFocus = opts.autoFocus !== false
  useEffect(() => {
    if (!open) return
    const container = containerRef.current
    if (!container) return
    const token = Symbol('dialog')
    const previous = document.activeElement as HTMLElement | null
    if (!dialogs.length) originalOverflow = document.body.style.overflow
    dialogs.push(token)
    document.body.style.overflow = 'hidden'
    if (!container.hasAttribute('tabindex')) container.tabIndex = -1
    const items = () => Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => el.getClientRects().length > 0 && !el.closest('[inert]'))
    if (autoFocus) (items()[0] ?? container).focus({ preventScroll: true })
    function onKeyDown(e: KeyboardEvent) {
      if (dialogs.at(-1) !== token) return
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        closeRef.current()
      }
      if (e.key !== 'Tab') return
      const list = items()
      const active = document.activeElement
      if (!list.length) { e.preventDefault(); container!.focus(); return }
      if (e.shiftKey && (active === list[0] || !list.includes(active as HTMLElement))) {
        e.preventDefault(); list.at(-1)!.focus()
      } else if (!e.shiftKey && (active === list.at(-1) || !list.includes(active as HTMLElement))) {
        e.preventDefault(); list[0].focus()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      const wasTop = dialogs.at(-1) === token
      const index = dialogs.indexOf(token)
      if (index >= 0) dialogs.splice(index, 1)
      if (!dialogs.length) document.body.style.overflow = originalOverflow
      if (wasTop && previous?.isConnected) previous.focus({ preventScroll: true })
    }
  }, [open, containerRef, autoFocus])
}
