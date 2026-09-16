'use client'

/**
 * Tour interativo com spotlight.
 * - Abre somente sob demanda pelo botão de ajuda da página atual.
 * - Passos podem preparar o contexto (por exemplo, trocar uma tab) antes da medição.
 * - Navegação por botões e teclado, com retorno de foco ao acionador.
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
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
  const [search, setSearch] = useState('')
  const [tour, setTour] = useState<Tour | null>(null)
  const [step, setStep] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)
  const openerRef = useRef<HTMLElement | null>(null)

  const active = tour !== null
  const currentTour = tourForPath(pathname, search)

  useEffect(() => {
    const read = () => setSearch(window.location.search)
    read()
    window.addEventListener('popstate', read)
    window.addEventListener('roinados:conversions-tab', read)
    return () => {
      window.removeEventListener('popstate', read)
      window.removeEventListener('roinados:conversions-tab', read)
    }
  }, [pathname])

  const close = useCallback(
    (completed: boolean) => {
      if (tour && completed) markTourDone(tour.key)
      setTour(null)
      setStep(0)
      setRect(null)
      openerRef.current?.focus()
      openerRef.current = null
    },
    [tour],
  )

  const start = useCallback((nextTour: Tour) => {
    openerRef.current = (document.activeElement as HTMLElement) ?? null
    setStep(0)
    setRect(null)
    setTour(nextTour)
  }, [])

  // Prepara o contexto do passo (quando necessário) e só então mede o alvo.
  // Dois frames permitem que Radix monte o conteúdo da nova tab antes da busca.
  useEffect(() => {
    if (!tour) return
    const current = tour.steps[step]
    if (!current) return

    let cancelled = false
    let raf1 = 0
    let raf2 = 0
    let listenersAttached = false

    const measure = () => {
      if (cancelled) return
      const nextRect = targetRect(current.target)
      setRect(nextRect)
      if (nextRect && (nextRect.top < 0 || nextRect.top > window.innerHeight - 160)) {
        document
          .querySelector(`[data-tour="${current.target}"]`)
          ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      }
      return nextRect
    }

    setRect(null)
    if (current.activate) {
      window.dispatchEvent(new CustomEvent(current.activate.event, { detail: current.activate.value }))
    }

    raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => {
        if (cancelled) return
        const nextRect = measure()
        if (!nextRect) {
          if (step < tour.steps.length - 1) setStep((value) => value + 1)
          else close(true)
          return
        }
        window.addEventListener('resize', measure)
        window.addEventListener('scroll', measure, true)
        listenersAttached = true
      })
    })

    return () => {
      cancelled = true
      window.cancelAnimationFrame(raf1)
      window.cancelAnimationFrame(raf2)
      if (listenersAttached) {
        window.removeEventListener('resize', measure)
        window.removeEventListener('scroll', measure, true)
      }
    }
  }, [tour, step, close])

  useEffect(() => {
    if (!tour) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close(false)
      if (event.key === 'ArrowRight' || event.key === 'Enter') {
        setStep((value) => {
          if (value >= tour.steps.length - 1) {
            close(true)
            return value
          }
          return value + 1
        })
      }
      if (event.key === 'ArrowLeft') setStep((value) => Math.max(0, value - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tour, close])

  const currentStep = tour?.steps[step]
  const isLast = tour ? step === tour.steps.length - 1 : false
  const quiet = tour?.appearance === 'quiet'

  let popStyle: CSSProperties = {}
  if (rect) {
    const vw = window.innerWidth
    const popWidth = quiet ? 320 : 300
    const estimatedHeight = quiet ? 250 : 196
    const below = rect.top + rect.height + estimatedHeight + 24 < window.innerHeight
    const top = below
      ? rect.top + rect.height + 12
      : quiet
        ? Math.max(12, rect.top - estimatedHeight - 12)
        : Math.max(12, rect.top - 196)
    const left = Math.min(Math.max(12, rect.left + rect.width / 2 - popWidth / 2), vw - popWidth - 12)
    popStyle = { top, left }
  }

  return (
    <>
      {!active && currentTour && (
        <button
          type="button"
          onClick={() => start(currentTour)}
          className="fixed bottom-5 right-5 z-50 inline-flex size-10 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-md transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan/25"
          aria-label={`Abrir guia de ${currentTour.label}`}
          title={`Abrir guia de ${currentTour.label}`}
        >
          <HelpCircle className="size-4.5" aria-hidden="true" />
        </button>
      )}

      {active && currentStep && rect && (
        <div className="fixed inset-0 z-[90]" role="dialog" aria-modal="true" aria-label={`Tour: ${currentStep.title}`}>
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

          <div
            className={`pointer-events-none absolute transition-all duration-300 ${
              quiet ? 'rounded-lg border border-brand-cyan/70' : 'rounded-xl border-2 border-brand-cyan/70'
            }`}
            style={{
              top: rect.top - 6,
              left: rect.left - 6,
              width: rect.width + 12,
              height: rect.height + 12,
              boxShadow: quiet ? 'none' : '0 0 24px rgba(37, 244, 238, 0.25)',
            }}
            aria-hidden="true"
          />

          <div
            key={step}
            className={
              quiet
                ? 'absolute w-[320px] max-w-[calc(100vw-24px)] rounded-lg border border-border bg-card p-4 shadow-lg'
                : 'glass glass-thick anim-pop-in absolute w-[300px] p-4 transition-all duration-300'
            }
            style={popStyle}
          >
            <div className="mb-1 flex items-start justify-between gap-2">
              <h3 className={quiet ? 'text-sm font-semibold text-foreground' : 'text-sm font-semibold text-foreground'}>
                {currentStep.title}
              </h3>
              <button
                type="button"
                onClick={() => close(false)}
                className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan/20"
                aria-label="Fechar tour"
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </div>
            <p className={quiet ? 'text-[13px] leading-relaxed text-muted-foreground' : 'text-xs leading-relaxed text-muted-foreground'}>
              {currentStep.body}
            </p>
            <div className="mt-3 flex items-center justify-between gap-3">
              <span className={quiet ? 'text-xs tabular-nums text-muted-foreground' : 'font-mono text-[10px] tabular-nums text-faint'}>
                {step + 1}/{tour!.steps.length}
              </span>
              <div className="flex items-center gap-1.5">
                {step > 0 && (
                  <button
                    type="button"
                    onClick={() => setStep(step - 1)}
                    className={
                      quiet
                        ? 'rounded-md px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan/20'
                        : 'rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground'
                    }
                  >
                    Anterior
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => (isLast ? close(true) : setStep(step + 1))}
                  className={
                    quiet
                      ? 'rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan/20'
                      : 'rounded-md bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground transition-transform active:scale-95'
                  }
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
