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
  return <div className="space-y-2">
    <button type="button" className="btn-secondary text-xs" disabled={disabled} aria-expanded={open} onClick={() => setOpen(!open)}>
      <Film className="size-4" aria-hidden="true" /> Usar vídeos já enviados
    </button>
    {open && <div className="rounded-xl border border-border bg-secondary/20 p-3">
      {isLoading ? <p className="flex items-center gap-2 text-xs"><Loader2 className="size-4 animate-spin" />Carregando vídeos…</p>
        : error ? <button type="button" className="btn-ghost text-xs" onClick={() => void mutate()}>Não foi possível carregar. Tentar novamente</button>
        : !data?.items.length ? <p className="text-xs text-muted-foreground">Seus próximos uploads aparecerão aqui.</p>
        : <ul className="max-h-48 space-y-1 overflow-y-auto" aria-label="Vídeos salvos">
          {data.items.map((item) => {
            const selected = selectedUrls.includes(item.url)
            return <li key={item.url}><button type="button" disabled={disabled || selected} onClick={() => onPick(item)} className="flex w-full items-center justify-between gap-3 rounded-lg p-2 text-left text-xs hover:bg-secondary disabled:opacity-60">
              <span className="truncate">{item.name}</span>
              {selected ? <Check className="size-4 shrink-0 text-primary" /> : <span className="text-primary">Adicionar</span>}
            </button></li>
          })}
        </ul>}
    </div>}
  </div>
}
