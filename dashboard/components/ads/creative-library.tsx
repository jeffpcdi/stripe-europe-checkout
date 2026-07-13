'use client'

// Biblioteca de criativos — vídeos já enviados ao Vercel Blob desta conta.
// Usada dentro do editor de campanha e do Spark Ads para reaproveitar um
// vídeo sem precisar subir de novo. Popover inline (não é rota própria).

import { useState } from 'react'
import { Clapperboard, Loader2, Trash2, Check, X } from 'lucide-react'
import { useAdsLibrary, apiErrorHint } from '@/lib/api'
import { toast } from '@/lib/toast'
import type { AdsLibraryItem } from '@/lib/types'

function fmtSize(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(0)} KB`
  return `${bytes} B`
}

function fmtDate(iso: string | null): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
  } catch {
    return ''
  }
}

export function CreativeLibrary({
  open,
  onClose,
  onPick,
  selectedUrl,
}: {
  open: boolean
  onClose: () => void
  onPick: (item: AdsLibraryItem) => void
  selectedUrl?: string
}) {
  const { data, mutate, isLoading } = useAdsLibrary(open)
  const [deletingUrl, setDeletingUrl] = useState<string | null>(null)

  if (!open) return null

  async function handleDelete(item: AdsLibraryItem) {
    setDeletingUrl(item.url)
    try {
      const res = await fetch(`/api/ads/library?url=${encodeURIComponent(item.url)}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      toast.success('Criativo removido da biblioteca')
      mutate()
    } catch (e) {
      toast.error('Falha ao remover criativo', { hint: apiErrorHint(e) })
    } finally {
      setDeletingUrl(null)
    }
  }

  const items = data?.items ?? []

  return (
    <div className="anim-content-in flex flex-col gap-2 rounded-xl border border-border bg-secondary/30 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
          <Clapperboard className="size-3.5 text-muted-foreground" aria-hidden="true" />
          Biblioteca de criativos
        </span>
        <button
          type="button"
          className="btn-ghost !p-1 text-muted-foreground"
          onClick={onClose}
          aria-label="Fechar biblioteca"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Carregando vídeos…
        </div>
      ) : items.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">
          Nenhum vídeo na biblioteca ainda. Os uploads feitos aqui ficam salvos para reutilizar.
        </p>
      ) : (
        <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto" aria-label="Vídeos disponíveis">
          {items.map((item) => {
            const isSelected = selectedUrl === item.url
            const isDeleting = deletingUrl === item.url
            return (
              <li key={item.url}>
                <div
                  className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 transition-colors ${
                    isSelected ? 'border-primary/60 bg-primary/5' : 'border-transparent hover:bg-secondary/60'
                  }`}
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    onClick={() => onPick(item)}
                    aria-label={`Usar o vídeo ${item.name}`}
                  >
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-secondary">
                      {isSelected ? (
                        <Check className="size-3.5 text-primary" aria-hidden="true" />
                      ) : (
                        <Clapperboard className="size-3.5 text-muted-foreground" aria-hidden="true" />
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium text-foreground">{item.name}</span>
                      <span className="block text-[11px] text-muted-foreground">
                        {fmtSize(item.size)}
                        {item.uploadedAt ? ` · ${fmtDate(item.uploadedAt)}` : ''}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="btn-ghost !p-1 text-muted-foreground hover:text-destructive"
                    onClick={() => handleDelete(item)}
                    disabled={isDeleting}
                    aria-label={`Excluir ${item.name} da biblioteca`}
                  >
                    {isDeleting ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Trash2 className="size-3.5" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
