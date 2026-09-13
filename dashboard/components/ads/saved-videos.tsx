'use client'

import { useState } from 'react'
import { useAdsLibrary } from '@/lib/api'
import type { AdsLibraryItem } from '@/lib/types'
import { Check, Film, Loader2 } from 'lucide-react'

// Seleção sem exclusão: reutilizar um vídeo nunca altera a biblioteca.
export function SavedVideos({ selectedUrls, onPick, disabled }: {
  selectedUrls: string[]; onPick: (item: AdsLibraryItem) => void; disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const { data, error, isLoading, mutate } = useAdsLibrary(open)
  const items = data?.items ?? []
  return <div className="space-y-1.5">
    <button type="button" className="btn-secondary !min-h-0 h-7 text-[11px] px-2.5 rounded-md inline-flex items-center gap-1.5 font-medium" disabled={disabled} aria-expanded={open} onClick={() => setOpen(!open)}>
      <Film className="size-3.5" aria-hidden="true" /> Usar vídeos já enviados
    </button>
    {open && <div className="rounded-lg border border-border bg-card/95 p-2 shadow-md">
      {isLoading ? <p className="flex items-center gap-2 text-xs py-1"><Loader2 className="size-3.5 animate-spin" />Carregando vídeos…</p>
        : error ? <button type="button" className="btn-ghost !min-h-0 h-7 text-xs" onClick={() => void mutate()}>Não foi possível carregar. Tentar novamente</button>
        : items.length === 0 ? <p className="text-xs text-muted-foreground py-1">Seus próximos uploads aparecerão aqui.</p>
        : <ul className="max-h-40 space-y-0.5 overflow-y-auto" aria-label="Vídeos salvos">
          {items.map((item) => {
            const selected = selectedUrls.includes(item.url)
            return <li key={item.url}><button type="button" disabled={disabled || selected} onClick={() => onPick(item)} className="flex w-full items-center justify-between gap-2.5 rounded-md p-1.5 text-left text-xs hover:bg-secondary/70 disabled:opacity-60">
              <span className="truncate">{item.name}</span>
              {selected ? <Check className="size-3.5 shrink-0 text-primary" /> : <span className="text-[11px] font-medium text-primary">Adicionar</span>}
            </button></li>
          })}
        </ul>}
    </div>}
  </div>
}
