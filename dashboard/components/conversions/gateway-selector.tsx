'use client'
import type { Gateway } from '@/lib/types'

export function GatewaySelector({ gateways, selected, onChange, disabled = false }: { gateways: Gateway[]; selected: string[]; onChange: (ids: string[]) => void; disabled?: boolean }) {
  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="text-sm font-semibold text-foreground">Checkouts deste pixel</legend>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
        Selecione quais checkouts enviam vendas para este pixel. Sem seleção, ele não recebe eventos de checkout.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button"
          className="min-h-9 text-sm font-medium text-brand-cyan transition-colors hover:text-brand-cyan/80 disabled:opacity-50"
          onClick={() => onChange(gateways.map(g => g.id))}
        >
          Selecionar todos
        </button>
        <span className="text-muted-foreground/50" aria-hidden="true">·</span>
        <button
          type="button"
          className="min-h-9 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          onClick={() => onChange([])}
        >
          Limpar
        </button>
      </div>

      {!gateways.length && (
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Cadastre um checkout para receber compras. O script do site pode ser instalado agora.
        </p>
      )}

      {!!gateways.length && (
        <div className="mt-2 max-h-56 overflow-y-auto border-y border-border/60">
          {gateways.map((gateway, index) => {
            const checked = selected.includes(gateway.id)
            return (
              <label
                key={gateway.id}
                className={`flex min-h-12 cursor-pointer items-center gap-3 py-2.5 transition-colors hover:bg-secondary/20 ${index > 0 ? 'border-t border-border/50' : ''}`}
              >
                <input
                  type="checkbox"
                  className="size-4 shrink-0 accent-brand-cyan"
                  checked={checked}
                  onChange={() => onChange(checked ? selected.filter(id => id !== gateway.id) : [...selected, gateway.id])}
                />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{gateway.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{gateway.provider}</span>
              </label>
            )
          })}
        </div>
      )}
    </fieldset>
  )
}
