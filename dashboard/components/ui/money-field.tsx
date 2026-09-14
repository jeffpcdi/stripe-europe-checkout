'use client'

import { useId } from 'react'

// A moeda ocupa uma coluna própria e nunca sobrepõe o valor digitado.
export function MoneyField({ label, currency, value, onChange, min = 0, hint, error, disabled }: {
  label: string; currency: string; value: string; onChange: (value: string) => void
  min?: number; hint?: string; error?: string; disabled?: boolean
}) {
  const id = useId()
  return <div className="money-field">
    <label htmlFor={id}>{label}</label>
    <div className="money-field-control">
      <span aria-hidden="true">{currency}</span>
      <input id={id} type="number" inputMode="decimal" step="0.01" min={min}
        aria-label={`${label} (${currency})`} aria-invalid={Boolean(error)}
        aria-describedby={hint || error ? `${id}-hint` : undefined}
        value={value} onChange={event => onChange(event.target.value)} disabled={disabled} />
    </div>
    {(error || hint) && <p id={`${id}-hint`} role={error ? 'alert' : undefined} className={error ? 'text-warning' : 'text-muted-foreground'}>{error || hint}</p>}
  </div>
}
