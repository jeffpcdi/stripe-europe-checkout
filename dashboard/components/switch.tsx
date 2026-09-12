'use client'

// Switch acessível padrão do projeto — nasceu no redesenho da aba Automações
// (o pill "Pausada" parecia badge, não controle). role="switch" + aria-checked
// dão a semântica; track + thumb animado dão a affordance visual óbvia.

import { cn } from '@/lib/utils'

export function Switch({
  checked,
  onCheckedChange,
  disabled,
  'aria-label': ariaLabel,
  className,
}: {
  checked: boolean
  onCheckedChange: (next: boolean) => void
  disabled?: boolean
  'aria-label': string
  className?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={(e) => {
        // O switch vive dentro de linhas clicáveis (acordeão) — o toggle não
        // pode expandir/recolher a linha junto.
        e.stopPropagation()
        onCheckedChange(!checked)
      }}
      className={cn(
        'app-switch relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-200',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'is-checked border-brand-cyan/60 bg-brand-cyan/30' : 'border-border bg-[var(--hover)]',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none block size-3.5 rounded-full shadow-sm transition-transform duration-300 ease-[var(--spring)]',
          checked ? 'translate-x-[18px] bg-brand-cyan' : 'translate-x-[3px] bg-muted-foreground',
        )}
      />
    </button>
  )
}
