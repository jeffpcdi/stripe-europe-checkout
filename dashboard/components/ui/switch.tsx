'use client'

/**
 * Switch único do painel — substitui os toggles ad-hoc que quebravam porque
 * o thumb usava `absolute` sem `left`, herdando a posição estática (padding
 * do botão) e vazando do trilho. Aqui o thumb é ancorado em left + top-1/2
 * e o trilho zera qualquer padding herdado com p-0.
 */
export function Switch({
  checked,
  onChange,
  label,
  size = 'md',
  disabled,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  /** aria-label — obrigatório quando não há <label> visível associado */
  label?: string
  size?: 'sm' | 'md'
  disabled?: boolean
}) {
  const sm = size === 'sm'
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex shrink-0 cursor-pointer items-center rounded-full border-0 p-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${
        sm ? 'h-4 w-7' : 'h-5 w-9'
      } ${checked ? 'bg-brand-cyan shadow-[0_0_10px_rgba(37,244,238,0.4)]' : 'bg-muted'}`}
    >
      <span
        className={`pointer-events-none absolute left-0.5 top-1/2 -translate-y-1/2 rounded-full bg-white shadow transition-transform ${
          sm ? 'size-3' : 'size-4'
        } ${checked ? (sm ? 'translate-x-3' : 'translate-x-4') : 'translate-x-0'}`}
      />
    </button>
  )
}
