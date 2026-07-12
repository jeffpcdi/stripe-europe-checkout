'use client'

/**
 * Bloco H (itens 44/49/50): tour interativo com spotlight.
 * - Popup glass ancorado ao elemento data-tour do passo atual
 * - Backdrop escuro com recorte radial (spotlight) sobre o alvo
 * - Navegação por botões e teclado (setas/ESC), passo X/Y
 * - Botão "?" flutuante reabre o tour da página atual
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { HelpCircle, X } from 'lucide-react'
import { tourForPath, markTourDone, type Tour } from '@/lib/tour'

interface Rect {
  top: number
  left: number
  width: number
  height: number
}

function targetRect(target: string): Rect | null {
  const el = document.querySelector(`[data-tour="${target}"]`)
  if (!el) return null
  const r = el.getBoundingClientRect()
  if (r.width === 0 && r.height === 0) return null
  return { top: r.top, left: r.left, width: r.width, height: r.height }
}

export function TourGuide() {
  const pathname = usePathname()
  const [tour, setTour] = useState<Tour | null>(null)
  const [step, setStep] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)
  const openerRef = useRef<HTMLElement | null>(null)

  const active = tour !== null
  const currentTour = tourForPath(pathname)

  const close = useCallback(
    (completed: boolean) => {
      if (tour && completed) markTourDone(tour.key)
      setTour(null)
      setStep(0)
      // Item 103: devolve o foco a quem abriu o tour
      openerRef.current?.focus()
      openerRef.current = null
    },
    [tour],
  )

  const start = useCallback((t: Tour) => {
    openerRef.current = (document.activeElement as HTMLElement) ?? null
    setStep(0)
    setTour(t)
  }, [])

  // Decisão de produto: o tour NÃO inicia mais sozinho na primeira visita —
  // interrompia o usuário em toda aba nova. Ele fica disponível apenas sob
  // demanda, pelo botão "?" flutuante abaixo.

  // Mede o alvo do passo atual; refaz em scroll/resize
  useEffect(() => {
    if (!tour) return
    const measure = () => {
      const s = tour.steps[step]
      const r = s ? targetRect(s.target) : null
      setRect(r)
      if (r && (r.top < 0 || r.top > window.innerHeight - 160)) {
        document
          .querySelector(`[data-tour="${s.target}"]`)
          ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      }
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [tour, step])

  // Item 45: navegação por teclado — no último passo, avançar conclui
  useEffect(() => {
    if (!tour) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(false)
      if (e.key === 'ArrowRight' || e.key === 'Enter') {
        setStep((s) => {
          if (s >= tour.steps.length - 1) {
            close(true)
            return s
          }
          return s + 1
        })
      }
      if (e.key === 'ArrowLeft') setStep((s) => Math.max(0, s - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tour, close])

  // Pula passos cujo alvo não existe na tela atual
  useEffect(() => {
    if (!tour) return
    const s = tour.steps[step]
    if (s && !targetRect(s.target)) {
      if (step < tour.steps.length - 1) setStep(step + 1)
      else close(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tour, step])

  const s = tour?.steps[step]
  const isLast = tour ? step === tour.steps.length - 1 : false

  // Posiciona o popover abaixo ou acima do alvo, sem sair da viewport
  let popStyle: React.CSSProperties = {}
  if (rect) {
    const vw = window.innerWidth
    const below = rect.top + rect.height + 240 < window.innerHeight
    const top = below ? rect.top + rect.height + 12 : Math.max(12, rect.top - 196)
    const left = Math.min(Math.max(12, rect.left + rect.width / 2 - 150), vw - 312)
    popStyle = { top, left }
  }

  return (
    <>
      {/* Item 49: botão "?" flutuante reabre o tour da página */}
      {currentTour && !active && (
        <button
          type="button"
          onClick={() => start(currentTour)}
          className="glass fixed bottom-20 right-4 z-40 flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-brand-cyan md:bottom-6 md:right-6"
          aria-label={`Rever tour da página ${currentTour.label}`}
          title="Rever o tour desta página"
        >
          <HelpCircle className="size-5" aria-hidden="true" />
        </button>
      )}

      {active && s && rect && (
        <div className="fixed inset-0 z-[90]" role="dialog" aria-modal="true" aria-label={`Tour: ${s.title}`}>
          {/* Item 44: spotlight — backdrop com recorte no alvo */}
          <div
            className="tour-spotlight absolute inset-0"
            style={{
              ['--sx' as string]: `${rect.left + rect.width / 2}px`,
              ['--sy' as string]: `${rect.top + rect.height / 2}px`,
              ['--sr' as string]: `${Math.max(rect.width, rect.height) / 2 + 24}px`,
            }}
            onClick={() => close(false)}
            aria-hidden="true"
          />
          {/* Moldura ciano em volta do alvo */}
          <div
            className="pointer-events-none absolute rounded-xl border-2 border-brand-cyan/70 transition-all duration-300"
            style={{
              top: rect.top - 6,
              left: rect.left - 6,
              width: rect.width + 12,
              height: rect.height + 12,
              boxShadow: '0 0 24px rgba(37, 244, 238, 0.25)',
            }}
            aria-hidden="true"
          />

          {/* Popover do passo */}
          <div
            key={step}
            className="glass glass-thick anim-pop-in absolute w-[300px] p-4 transition-all duration-300"
            style={popStyle}
          >
            <div className="mb-1 flex items-start justify-between gap-2">
              <h3 className="text-sm font-semibold text-foreground">{s.title}</h3>
              <button
                type="button"
                onClick={() => close(false)}
                className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                aria-label="Fechar tour"
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">{s.body}</p>
            <div className="mt-3 flex items-center justify-between">
              <span className="font-mono text-[10px] tabular-nums text-faint">
                {step + 1}/{tour!.steps.length}
              </span>
              <div className="flex items-center gap-1.5">
                {step > 0 && (
                  <button
                    type="button"
                    onClick={() => setStep(step - 1)}
                    className="rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  >
                    Anterior
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => (isLast ? close(true) : setStep(step + 1))}
                  className="rounded-md bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground transition-transform active:scale-95"
                >
                  {isLast ? 'Concluir' : 'Próximo'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
