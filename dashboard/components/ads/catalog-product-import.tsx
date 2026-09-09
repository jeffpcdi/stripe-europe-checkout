'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertCircle, ArrowRight, Link2, Loader2, PackageCheck, X } from 'lucide-react'
import { ApiError, adsCatalogApiUrl, apiSend } from '@/lib/api'
import type { AdsCatalog, AdsCatalogCreative } from '@/lib/types'
import { toast } from '@/lib/toast'
import { CatalogCreatives } from './catalog-creatives'

const LABELS: Record<string, string> = { title: 'Nome do produto', description: 'Descrição', brand: 'Marca', price: 'Preço', image_link: 'Link da imagem' }

export function CatalogProductImport({ advertiserId, countries, onCreated, onClose, onBusyChange }: {
  advertiserId: string
  countries: { code: string; name: string }[]
  onCreated: (catalog: AdsCatalog) => void
  onClose: () => void
  onBusyChange: (busy: boolean) => void
}) {
  const [url, setUrl] = useState('')
  const [country, setCountry] = useState('BR')
  const [creatives, setCreatives] = useState<AdsCatalogCreative[]>([])
  const [product, setProduct] = useState<Record<string, string>>({})
  const [fields, setFields] = useState<{ field: string; message: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [pending, setPending] = useState(0)
  const [failure, setFailure] = useState('')
  const requestKey = useRef<string | null>(null)
  const submitting = useRef(false)
  const working = busy || uploading
  useEffect(() => { onBusyChange(working); return () => onBusyChange(false) }, [working, onBusyChange])
  function changed() { requestKey.current = null; setFailure('') }

  async function create() {
    if (submitting.current || working || pending || !url.trim()) return
    submitting.current = true
    setBusy(true)
    setFailure('')
    try {
      const result = await apiSend<{ catalog: AdsCatalog; syncStarted: boolean; syncIssue?: { message: string } | null }>(
        adsCatalogApiUrl('/api/ads/catalogs/magic-import', advertiserId), 'POST', {
          url: url.trim(), country, product, creatives,
          idempotencyKey: requestKey.current || (requestKey.current = crypto.randomUUID()),
        },
      )
      if (result.syncIssue) toast.info('Catálogo salvo', { hint: result.syncIssue.message })
      else toast.success('Catálogo criado', { hint: result.syncStarted ? '4 itens preparados. Acompanhe o envio ao TikTok.' : '4 itens preparados.' })
      onCreated(result.catalog)
    } catch (error) {
      if (error instanceof ApiError && error.code === 'CATALOG_PRODUCT_INCOMPLETE') {
        setFields((error.fields || []).filter(item => LABELS[item.field]))
        // Preenche somente os campos que a página deixou incompletos.
        setProduct(current => Object.fromEntries((error.fields || []).filter(item => LABELS[item.field]).map(item => [item.field, current[item.field] || error.product?.[item.field] || ''])))
        requestKey.current = null
      }
      setFailure(error instanceof ApiError ? error.display : error instanceof Error ? error.message : 'Não foi possível criar. Tente novamente.')
    } finally { submitting.current = false; setBusy(false) }
  }

  return <div className="surface-card m-3 flex flex-col gap-5 rounded-2xl p-4 sm:m-4 sm:p-5 motion-safe:animate-in motion-safe:fade-in">
    <div className="flex items-start justify-between gap-3">
      <div><h2 className="flex items-center gap-2 text-base font-semibold"><PackageCheck size={20} className="text-primary" /> Catálogo pelo link</h2><p className="mt-1 text-sm text-muted-foreground">Um produto. Quatro itens preparados. Vídeos prontos para reutilizar.</p></div>
      <button type="button" className="btn-ghost min-h-11 min-w-11" disabled={working} onClick={onClose} aria-label="Fechar criação"><X size={18} /></button>
    </div>
    <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
      <label className="flex min-w-0 flex-col gap-2 text-sm font-medium">Link do produto
        <div className="flex items-center gap-2 rounded-xl border border-border bg-background/70 px-3 focus-within:border-primary"><Link2 size={17} className="shrink-0 text-primary" /><input type="url" autoFocus value={url} disabled={working} onChange={event => { setUrl(event.target.value); setProduct({}); setFields([]); changed() }} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void create() } }} placeholder="https://sualoja.com/produto" className="min-h-12 w-full min-w-0 bg-transparent text-sm font-normal outline-none" /></div>
      </label>
      <label className="flex flex-col gap-2 text-sm font-medium">País do catálogo<select className="input-base min-h-12" value={country} disabled={working} onChange={event => { setCountry(event.target.value); changed() }}>{countries.map(item => <option key={item.code} value={item.code}>{item.name || item.code}</option>)}</select></label>
    </div>
    {fields.length > 0 && <div className="grid gap-3 rounded-xl border border-warning/30 bg-warning/5 p-4 sm:grid-cols-2">{fields.map(item => <label key={item.field} className="flex flex-col gap-2 text-sm">{LABELS[item.field]}<input className="input-base min-h-11" value={product[item.field] || ''} disabled={working} onChange={event => { setProduct(current => ({ ...current, [item.field]: event.target.value })); changed() }} inputMode={item.field === 'price' ? 'decimal' : undefined} type={item.field === 'image_link' ? 'url' : 'text'} /><span className="text-xs text-muted-foreground">{item.message}</span></label>)}</div>}
    <CatalogCreatives value={creatives} disabled={busy} onBusyChange={setUploading} onPendingChange={setPending}
      onAdd={async creative => { setCreatives(current => current.some(item => item.url === creative.url) ? current : [...current, creative].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))); changed() }}
      onRemove={async creative => { setCreatives(current => current.filter(item => item.id !== creative.id)); changed() }} />
    {failure && <p role="alert" className="flex gap-2 rounded-xl border border-warning/30 bg-warning/5 p-3 text-sm"><AlertCircle size={17} className="shrink-0 text-warning" />{failure}</p>}
    <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-xs text-muted-foreground">{pending ? 'Conclua ou remova os vídeos pendentes.' : `${creatives.length} vídeo${creatives.length === 1 ? '' : 's'} · 4 itens com o mesmo link. A aprovação depende do TikTok.`}</p>
      <button type="button" className="btn-primary min-h-12 gap-2 px-5 text-sm font-semibold" onClick={() => void create()} disabled={working || pending > 0 || !url.trim()}>{busy ? <Loader2 size={17} className="animate-spin" /> : <ArrowRight size={17} />}{busy ? 'Preparando catálogo…' : 'Criar e sincronizar'}</button>
    </div>
  </div>
}
