'use client'
import type { Gateway } from '@/lib/types'

export function GatewaySelector({ gateways, selected, onChange, disabled = false }: { gateways: Gateway[]; selected: string[]; onChange: (ids: string[]) => void; disabled?: boolean }) {
  return <fieldset disabled={disabled} className="flex flex-col gap-3 rounded-xl border border-border p-4">
    <legend className="px-1 text-sm font-semibold">Checkouts deste pixel</legend>
    <p className="text-xs text-muted-foreground">Selecione um ou mais. Sem seleção, este pixel não recebe eventos de checkout.</p>
    <div className="flex gap-3"><button type="button" className="text-xs text-brand-cyan min-h-9" onClick={() => onChange(gateways.map(g => g.id))}>Selecionar todos</button><button type="button" className="text-xs text-muted-foreground min-h-9" onClick={() => onChange([])}>Limpar</button></div>
    {!gateways.length && <p className="text-xs text-muted-foreground">Cadastre um checkout para receber compras. O script do site pode ser instalado agora.</p>}
    <div className="flex flex-col gap-2 max-h-56 overflow-y-auto">
      {gateways.map(g => <label key={g.id} className="flex min-h-11 items-center gap-3 rounded-lg border border-border bg-secondary/30 px-3 cursor-pointer">
        <input type="checkbox" className="size-4 accent-brand-cyan" checked={selected.includes(g.id)} onChange={() => onChange(selected.includes(g.id) ? selected.filter(id => id !== g.id) : [...selected, g.id])} />
        <span className="min-w-0 flex-1 text-sm truncate">{g.name}</span><span className="text-xs text-muted-foreground">{g.provider}</span>
      </label>)}
    </div>
  </fieldset>
}
