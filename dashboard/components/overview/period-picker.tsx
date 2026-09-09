'use client'

import type { Period } from '@/lib/types'
import { useRef, type KeyboardEvent } from 'react'

const PERIODS: { id: Period; label: string }[] = [
  { id: 'today', label: 'Hoje' },
  { id: '7d', label: '7 dias' },
  { id: '30d', label: '30 dias' },
  { id: 'all', label: 'Tudo' },
]

export function PeriodPicker({
  value,
  onChange,
}: {
  value: Period
  onChange: (p: Period) => void
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index
    if (event.key === 'ArrowRight') next = (index + 1) % PERIODS.length
    else if (event.key === 'ArrowLeft') next = (index + PERIODS.length - 1) % PERIODS.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = PERIODS.length - 1
    else return
    event.preventDefault()
    buttons.current[next]?.focus()
    onChange(PERIODS[next].id)
  }
  return (
    <div
      className="overview-period-picker"
      role="tablist"
      aria-label="Período das métricas"
    >
      {PERIODS.map((p, index) => (
        <button
          key={p.id}
          type="button"
          role="tab"
          aria-selected={value === p.id}
          onClick={() => onChange(p.id)}
          ref={element => { buttons.current[index] = element }}
          tabIndex={value === p.id ? 0 : -1}
          onKeyDown={event => onKeyDown(event, index)}
        >
          {p.label}
        </button>
      ))}
    </div>
  )
}
