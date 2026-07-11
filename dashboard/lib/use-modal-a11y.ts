'use client'

// Item 189: acessibilidade completa de modais/popups num só lugar.
// Dá a qualquer diálogo: foco preso (focus trap), fechar com ESC, retorno de
// foco ao elemento que abriu e trava de scroll do body. Todos os popups da
// Gestão (TutorialModal, ConfirmDialog, editores) devem usar este hook para
// não reimplementar a11y (e errar) caso a caso.
//
// Uso:
//   const ref = useRef<HTMLDivElement>(null)
//   useModalA11y(open, ref, onClose)
//   return open ? <div ref={ref} role="dialog" aria-modal="true">…</div> : null

import { useEffect, type RefObject } from 'react'

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function useModalA11y(
  open: boolean,
  containerRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  opts: { autoFocus?: boolean } = {},
) {
  const autoFocus = opts.autoFocus !== false

  useEffect(() => {
    if (!open) return
    const container = containerRef.current
    // Guarda quem tinha o foco para devolver ao fechar (retorno de foco).
    const previouslyFocused = document.activeElement as HTMLElement | null

    // Trava o scroll do body enquanto o modal está aberto.
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    // Foca o primeiro elemento focável (ou o próprio container).
    if (autoFocus && container) {
      const first = container.querySelector<HTMLElement>(FOCUSABLE)
      ;(first ?? container).focus()
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key !== 'Tab' || !container) return
      // Focus trap: mantém o Tab ciclando dentro do modal.
      const items = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      )
      if (items.length === 0) {
        e.preventDefault()
        container.focus()
        return
      }
      const firstEl = items[0]
      const lastEl = items[items.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (e.shiftKey && (active === firstEl || active === container)) {
        e.preventDefault()
        lastEl.focus()
      } else if (!e.shiftKey && active === lastEl) {
        e.preventDefault()
        firstEl.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.body.style.overflow = prevOverflow
      // Devolve o foco ao gatilho, se ainda estiver no documento.
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus()
      }
    }
  }, [open, containerRef, onClose, autoFocus])
}
