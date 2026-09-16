'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2, Plus, RotateCcw, X } from 'lucide-react'
import { adsUpload } from '@/lib/api'
import { creativeFileError } from '@/lib/ads-upload'
import type { AdsCatalogCreative } from '@/lib/types'
import { toast } from '@/lib/toast'
import { ConfirmDialog } from '@/components/confirm-dialog'

type Pending = { id: string; file: File; sortOrder: number; status: 'queued' | 'uploading' | 'saving' | 'error'; error?: string }

export function CatalogCreatives({ value, onAdd, onRemove, disabled = false, onBusyChange, onPendingChange }: {
  value: AdsCatalogCreative[]
  onAdd: (creative: AdsCatalogCreative) => Promise<void>
  onRemove: (creative: AdsCatalogCreative) => Promise<void>
  disabled?: boolean
  onBusyChange?: (busy: boolean) => void
  onPendingChange?: (count: number) => void
}) {
  const [pending, setPending] = useState<Pending[]>([])
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState('')
  const [removeTarget, setRemoveTarget] = useState<AdsCatalogCreative | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const controller = useRef<AbortController | null>(null)
  const lock = useRef(false)
  const alive = useRef(true)
  const nextOrder = useRef(Math.max(-1, ...value.map((item, index) => item.sortOrder ?? index)) + 1)
  useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort() } }, [])
  useEffect(() => { onPendingChange?.(pending.length) }, [pending.length, onPendingChange])
  const update = (id: string, patch: Partial<Pending>) => {
    if (alive.current) setPending(rows => rows.map(row => row.id === id ? { ...row, ...patch } : row))
  }

  async function upload(items: Pending[]) {
    if (lock.current || disabled) return
    lock.current = true
    setBusy(true)
    onBusyChange?.(true)
    const abort = new AbortController()
    controller.current = abort
    let next = 0
    const worker = async () => {
      while (next < items.length && !abort.signal.aborted) {
        const item = items[next++]
        try {
          const invalid = creativeFileError(item.file, 'video')
          if (invalid) throw new Error(invalid)
          update(item.id, { status: 'uploading', error: undefined })
          const result = await adsUpload(item.file, 'video', { signal: abort.signal })
          if (abort.signal.aborted) return
          update(item.id, { status: 'saving' })
          await onAdd({ id: item.id, name: item.file.name, url: result.url, sortOrder: item.sortOrder })
          if (alive.current) setPending(rows => rows.filter(row => row.id !== item.id))
        } catch (error) {
          if (!abort.signal.aborted) update(item.id, { status: 'error', error: error instanceof Error ? error.message : 'Tente enviar novamente.' })
        }
      }
    }
    // A ordem dos vínculos acompanha a seleção, inclusive após envio lento.
    try { await worker() }
    finally {
      lock.current = false
      if (alive.current) { setBusy(false); onBusyChange?.(false) }
    }
  }

  function select(files: FileList | null) {
    if (!files || lock.current) return
    if (value.length + pending.length + files.length > 50) return toast.error('O limite é de 50 vídeos por catálogo')
    nextOrder.current = Math.max(nextOrder.current, Math.max(-1, ...value.map((item, index) => item.sortOrder ?? index)) + 1)
    const items: Pending[] = Array.from(files).map(file => ({ id: crypto.randomUUID(), file, sortOrder: nextOrder.current++, status: 'queued' }))
    setPending(rows => [...rows, ...items])
    void upload(items)
  }

  async function remove(creative: AdsCatalogCreative) {
    if (removing || busy || disabled) return
    setRemoving(creative.id)
    try { await onRemove(creative); setRemoveTarget(null) }
    catch (error) { toast.error('Não foi possível remover o vínculo', { hint: error instanceof Error ? error.message : undefined }) }
    finally { if (alive.current) setRemoving('') }
  }

  return (
    <section className="catalog-creatives-compact" aria-label="Criativos do catálogo" aria-busy={busy}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">
            Criativos
          </h3>
          <span className="text-xs tabular-nums text-muted-foreground">{value.length + pending.length}/50</span>
        </div>
        <button
          type="button"
          className="btn-secondary min-h-10 px-3 text-sm"
          disabled={disabled || busy || !!removing || value.length + pending.length >= 50}
          onClick={() => input.current?.click()}
        >
          {busy ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />}
          {busy ? 'Enviando…' : 'Adicionar vídeos'}
        </button>
        <input ref={input} type="file" multiple accept="video/mp4,video/quicktime,.mp4,.mov" className="hidden" aria-label="Selecionar vídeos" onChange={event => { select(event.target.files); event.currentTarget.value = '' }} />
      </div>

      {!value.length && !pending.length ? (
        <p className="mt-2 text-xs text-muted-foreground">Nenhum vídeo vinculado. Adicione MP4 ou MOV.</p>
      ) : (
        <div className="catalog-creatives-list mt-2 max-h-52 overflow-y-auto">
          {value.map(creative => (
            <div key={creative.id} className="catalog-creatives-row">
              <span className="min-w-0 flex-1 truncate text-xs text-foreground" title={creative.name}>{creative.name}</span>
              <span className="text-xs text-success">Pronto</span>
              <button type="button" className="btn-ghost !size-10 p-0 text-muted-foreground hover:text-error" disabled={disabled || busy || !!removing} onClick={() => setRemoveTarget(creative)} aria-label={`Remover ${creative.name}`}>
                {removing === creative.id ? <Loader2 className="size-3 animate-spin" /> : <X className="size-3" />}
              </button>
            </div>
          ))}
          {pending.map(item => (
            <div key={item.id} className={`catalog-creatives-row ${item.status === 'error' ? 'catalog-creatives-row--error' : ''}`}>
              {item.status !== 'error' && <Loader2 className="size-3 shrink-0 animate-spin text-primary" />}
              <span className="min-w-0 flex-1 truncate text-xs text-foreground" title={item.file.name}>{item.file.name}</span>
              <span className={`text-xs ${item.status === 'error' ? 'text-error' : 'text-muted-foreground'}`}>{item.error || (item.status === 'saving' ? 'Salvando…' : item.status === 'queued' ? 'Na fila' : 'Enviando…')}</span>
              {item.status === 'error' && <button type="button" className="btn-ghost !size-10 p-0" disabled={busy || disabled} onClick={() => void upload([item])} aria-label={`Reenviar ${item.file.name}`}><RotateCcw className="size-3" /></button>}
              {item.status === 'error' && <button type="button" className="btn-ghost !size-10 p-0" disabled={busy || disabled} onClick={() => setPending(rows => rows.filter(row => row.id !== item.id))} aria-label={`Remover ${item.file.name}`}><X className="size-3" /></button>}
            </div>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={Boolean(removeTarget)}
        title="Remover este criativo do catálogo?"
        description="O vídeo deixará de ficar vinculado a este catálogo. O arquivo enviado não será apagado da biblioteca."
        confirmLabel="Remover criativo"
        appearance="quiet"
        tone="danger"
        busy={Boolean(removing)}
        onConfirm={() => { if (removeTarget) void remove(removeTarget) }}
        onClose={() => { if (!removing) setRemoveTarget(null) }}
      />
    </section>
  )
}
