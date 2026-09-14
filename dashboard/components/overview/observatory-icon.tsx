import type { ReactNode } from 'react'

type Instrument = 'revenue' | 'spend' | 'conversion' | 'return' | 'live' | 'countries' | 'purchases'

/** Símbolos duotone do observatório; a placa e a iluminação pertencem ao CSS. */
export function ObservatoryIcon({ name }: { name: Instrument }) {
  const drawings: Record<Instrument, ReactNode> = {
    revenue: <><path d="M4 7h16v13H4z" fill="currentColor" fillOpacity=".12" /><path d="M4 7V5l13-2v4M4 7h16v13H4zM16 11h5v5h-5a2.5 2.5 0 0 1 0-5Z" /><path d="M6 17h4M17 13.5h.01" /></>,
    spend: <><path d="m4 9 13-5v14L4 14Z" fill="currentColor" fillOpacity=".12" /><path d="m4 9 13-5v14L4 14Zm2 6 2 6h3l-2-5M20 7l2-1M20 11h2M20 15l2 1M3 9v5" /></>,
    conversion: <><path d="M3 4h18l-7 9v6l-4 2v-8Z" fill="currentColor" fillOpacity=".12" /><path d="M3 4h18l-7 9v6l-4 2v-8ZM7 8h10" /></>,
    return: <><path d="M4 20V13h4v7m3 0V9h4v11m3 0V4h4v16" fill="currentColor" fillOpacity=".12" /><path d="M3 21h19M5 15v3m6-7v7m6-12v12M3 10l6-6 4 2 6-4M16 2h3v3" /></>,
    live: <><circle cx="12" cy="8" r="3" fill="currentColor" fillOpacity=".15" /><path d="M9 8a3 3 0 1 0 6 0 3 3 0 0 0-6 0ZM6 21v-2a6 6 0 0 1 12 0v2M4 5a8 8 0 0 0 0 7M20 5a8 8 0 0 1 0 7M1 3a12 12 0 0 0 0 11M23 3a12 12 0 0 1 0 11" /></>,
    countries: <><circle cx="12" cy="12" r="9" fill="currentColor" fillOpacity=".1" /><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18M5 6.5c4 2 10 2 14 0M5 17.5c4-2 10-2 14 0" /></>,
    purchases: <><path d="m5 7-2 14h18L19 7Z" fill="currentColor" fillOpacity=".12" /><path d="m5 7-2 14h18L19 7ZM8 8V6a4 4 0 0 1 8 0v2m-8 6 3 3 5-5" /></>,
  }
  return <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{drawings[name]}</svg>
}
