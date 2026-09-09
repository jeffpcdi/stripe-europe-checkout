'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Film, Loader2, RotateCcw, Upload, X } from 'lucide-react'
import { adsUpload } from '@/lib/api'
import { creativeFileError } from '@/lib/ads-upload'
import type { AdsCatalogCreative } from '@/lib/types'
import { toast } from '@/lib/toast'

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
    onBusyChange?.(true)
    try { await onRemove(creative) }
    catch (error) { toast.error('Não foi possível remover o vínculo', { hint: error instanceof Error ? error.message : undefined }) }
    finally { if (alive.current) { setRemoving(''); onBusyChange?.(false) } }
  }

  return (
    <section className="flex flex-col gap-3" aria-label="Criativos do catálogo" aria-busy={busy}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold"><Film size={17} className="text-primary" /> Vídeos do produto <span className="rounded-md bg-secondary px-2 py-0.5 tabular-nums text-xs">{value.length}/50</span></h3>
          <p className="mt-1 text-xs text-muted-foreground">Todos usam este catálogo. Um vídeo por campanha.</p>
        </div>
        <button type="button" className="btn-secondary min-h-11 gap-2 px-4 text-sm" disabled={disabled || busy || !!removing || value.length + pending.length >= 50} onClick={() => input.current?.click()}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />} {busy ? 'Enviando vídeos…' : 'Adicionar vídeos'}
        </button>
        <input ref={input} type="file" multiple accept="video/mp4,video/quicktime,.mp4,.mov" className="hidden" aria-label="Selecionar vídeos" onChange={event => { select(event.target.files); event.currentTarget.value = '' }} />
      </div>
      {!value.length && !pending.length && <div className="rounded-xl border border-dashed border-border bg-secondary/20 p-5 text-center text-sm text-muted-foreground">Adicione agora ou depois. MP4 ou MOV, até 500 MB por vídeo.</div>}
      {(value.length > 0 || pending.length > 0) && <div className="grid max-h-72 gap-2 overflow-y-auto sm:grid-cols-2">
        {value.map(creative => <div key={creative.id} className="flex min-w-0 items-center gap-2 rounded-xl border border-border bg-background/50 py-1 pl-3 pr-1">
          <Check size={15} className="shrink-0 text-primary" /><span className="min-w-0 flex-1 truncate text-sm" title={creative.name}>{creative.name}</span>
          <button type="button" className="btn-ghost min-h-11 min-w-11" disabled={disabled || busy || !!removing} onClick={() => void remove(creative)} aria-label={`Remover ${creative.name}`}>
            {removing === creative.id ? <Loader2 size={15} className="animate-spin" /> : <X size={15} />}
          </button>
        </div>)}
        {pending.map(item => <div key={item.id} className={`flex min-w-0 items-center gap-2 rounded-xl border py-1 pl-3 pr-1 ${item.status === 'error' ? 'border-error/40 bg-error/5' : 'border-border bg-secondary/30'}`}>
          {item.status !== 'error' && <Loader2 size={15} className="shrink-0 animate-spin text-primary" />}
          <div className="min-w-0 flex-1"><p className="truncate text-sm">{item.file.name}</p><p className="text-xs text-muted-foreground" role="status">{item.error || (item.status === 'saving' ? 'Salvando vínculo…' : item.status === 'queued' ? 'Na fila' : 'Enviando…')}</p></div>
          {item.status === 'error' && <><button type="button" className="btn-ghost min-h-11 min-w-11" disabled={busy || disabled} onClick={() => void upload([item])} aria-label={`Reenviar ${item.file.name}`}><RotateCcw size={15} /></button><button type="button" className="btn-ghost min-h-11 min-w-11" disabled={busy || disabled} onClick={() => setPending(rows => rows.filter(row => row.id !== item.id))} aria-label={`Remover ${item.file.name}`}><X size={15} /></button></>}
        </div>)}
      </div>}
    </section>
  )
}
