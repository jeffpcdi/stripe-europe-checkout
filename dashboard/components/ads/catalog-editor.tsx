'use client'

// Orquestrador visual do domínio de catálogos. As responsabilidades de conexão,
// prontidão e criação de campanha ficam em componentes próprios; esta tela
// concentra produtos, importação e histórico.

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  X, Loader2, Plus, Trash2, UploadCloud, Download,
  Copy, Check, AlertCircle, ChevronLeft, PackageOpen,
  Building2, Clock, ShieldCheck, RefreshCw, Pencil, ImageIcon,
  Link2, ChevronDown, History, CopyPlus, SearchCheck, RotateCcw,
} from 'lucide-react'
import {
  useAdsCatalogs, useAdsCatalogDetail, useAdsCatalogSpec, useAdsCatalogBusinessCenter,
  useAdsCatalogPublications, useAdsCatalogReadiness, useAdsCatalogCapabilities, adsCatalogImportCsv,
  adsCatalogApiUrl, apiSend, ApiError,
} from '@/lib/api'
import { toast } from '@/lib/toast'
import type { AdsCatalog, AdsCatalogCapabilities, AdsCatalogProduct, AdsCatalogSpecResponse, AdsCatalogSyncResponse } from '@/lib/types'
import { useModalA11y } from '@/lib/use-modal-a11y'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { ErrorState } from '@/components/error-state'
import { CatalogReadinessCard } from './catalog-readiness-card'
import { CatalogConnectionCard } from './catalog-connection-card'
import { CatalogCampaignWizard } from './catalog-campaign-wizard'
import { CatalogBatchDialog } from './catalog-batch-dialog'
import { CatalogSyncStatus } from './catalog-sync-status'


const FIELD_LABELS: Record<string, string> = {
  sku_id: 'ID do produto (SKU)',
  title: 'Título',
  description: 'Descrição',
  availability: 'Disponibilidade',
  condition: 'Condição',
  price: 'Preço',
  link: 'Link do produto',
  image_link: 'Link da imagem',
  brand: 'Marca',
  video_link: 'Link do vídeo',
  additional_image_link: 'Imagens adicionais',
  age_group: 'Faixa etária',
  color: 'Cor',
  gender: 'Gênero',
  google_product_category: 'Categoria (Google)',
  product_type: 'Tipo de produto',
  sale_price: 'Preço promocional',
  size: 'Tamanho',
  gtin: 'GTIN (código de barras)',
  mpn: 'Código do fabricante (MPN)',
}
const FIELD_PLACEHOLDERS: Record<string, string> = {
  sku_id: 'Ex.: SKU-001',
  title: 'Ex.: Camiseta branca algodão',
  description: 'Descrição curta do produto',
  price: 'Ex.: 9.99 BRL',
  link: 'https://sualoja.com/produto',
  image_link: 'https://sualoja.com/foto.jpg (≥ 500×500)',
  sale_price: 'Ex.: 7.99 BRL',
}

// SKU legível e único o suficiente para um catálogo manual: base36 do
// timestamp + 2 chars aleatórios (ex.: "SKU-MDQ3K2-7F").
export function generateSku(): string {
  const rand = Math.random().toString(36).slice(2, 4).toUpperCase()
  return `SKU-${Date.now().toString(36).toUpperCase()}-${rand}`
}
// "9.99", "9,99" ou "1.234,56" → "9.99 BRL" (formato exigido pelo TikTok:
// número + espaço + moeda do catálogo). Valores já formatados passam direto.
export function formatPriceForFeed(input: string, currency: string): string {
  const raw = String(input || '').trim()
  if (!raw) return ''
  // Já está no formato final ("9.99 BRL")? Normaliza só a moeda p/ maiúscula.
  const done = raw.match(/^(\d+(?:\.\d{1,2})?)\s+([A-Za-z]{3})$/)
  if (done) return `${done[1]} ${done[2].toUpperCase()}`
  // Aceita vírgula decimal pt-BR e separadores de milhar.
  let n = raw.replace(/\s/g, '')
  if (/,\d{1,2}$/.test(n)) n = n.replace(/\./g, '').replace(',', '.')
  else n = n.replace(/,/g, '')
  if (!/^\d+(?:\.\d{1,2})?$/.test(n)) return raw // deixa a validação apontar
  return `${n} ${currency.toUpperCase()}`
}
// Para editar um produto existente: "9.99 BRL" → "9.99" (o sufixo de moeda é
// re-anexado no salvar; o usuário só vê o número).
export function stripCurrency(price: string): string {
  const m = String(price || '').trim().match(/^(\d+(?:\.\d{1,2})?)\s+[A-Za-z]{3}$/)
  return m ? m[1] : String(price || '')
}
export function ProductEditor({
  catalogId,
  advertiserId,
  spec,
  product,
  currency,
  onClose,
  onSaved,
}: {
  catalogId: string
  advertiserId: string
  spec: { columns: string[]; required: string[]; enums: Record<string, string[]>; fields: { key: string; required: boolean; enum: string[] | null }[] } | null
  product: AdsCatalogProduct | null
  currency: string
  onClose: () => void
  onSaved: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  // Menos preenchimento manual: produto novo já nasce com SKU gerado,
  // condição "new" e disponibilidade "in stock" (tudo editável).
  const [form, setForm] = useState<Record<string, string>>((): Record<string, string> => {
    if (product?.data) return { ...product.data, price: stripCurrency(product.data.price || ''), sale_price: stripCurrency(product.data.sale_price || '') }
    return { sku_id: generateSku(), condition: 'new', availability: 'in stock' }
  })
  const [busy, setBusy] = useState(false)
  const [showOptional, setShowOptional] = useState(false)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  useModalA11y(true, ref, onClose)

  const fields = spec?.fields ?? []
  const required = useMemo(() => new Set(spec?.required ?? []), [spec])

  // Obrigatórios sempre visíveis; os ~36 opcionais ficam recolhidos (o muro de
  // 44 campos era o maior atrito — a maioria dos catálogos usa só os 8 exigidos).
  const requiredFields = useMemo(() => fields.filter((f) => f.required), [fields])
  const optionalFields = useMemo(() => fields.filter((f) => !f.required), [fields])

  async function handleSave() {
    setBusy(true)
    try {
      // Preços viram "9.99 BRL" (moeda do catálogo) na hora de salvar — o
      // usuário digita só o número, com ponto ou vírgula.
      const data: Record<string, string> = { ...form }
      if (data.price) data.price = formatPriceForFeed(data.price, currency)
      if (data.sale_price) data.sale_price = formatPriceForFeed(data.sale_price, currency)
      await apiSend(
        adsCatalogApiUrl(`/api/ads/catalogs/${encodeURIComponent(catalogId)}/products`, advertiserId),
        'POST',
        { data },
      )
      toast.success('Produto salvo como rascunho', { hint: 'Use Sincronizar quando quiser enviar as alterações ao TikTok.' })
      onSaved()
    } catch (e) {
      toast.error('Falha ao salvar produto', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setBusy(false)
    }
  }

  const missingRequired = [...required].filter((k) => !String(form[k] || '').trim())

  function renderField(f: { key: string; required: boolean; enum: string[] | null }) {
    const common = { value: form[f.key] ?? '', onChange: (v: string) => setForm((s) => ({ ...s, [f.key]: v })) }
    if (f.key === 'price' || f.key === 'sale_price') return <PriceField key={f.key} field={f} currency={currency} {...common} />
    if (f.key === 'image_link' || f.key === 'additional_image_link') return <ImageField key={f.key} field={f} videoUrl={form['video_link']} {...common} />
    return <ProductField key={f.key} field={f} {...common} />
  }

  if (!mounted) return null

  return createPortal(
    <div
      className="ads-dialog fixed inset-0 z-[70] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:overflow-y-auto sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div ref={ref} role="dialog" aria-modal="true" aria-label="Editar produto" tabIndex={-1} className="w-full outline-none sm:max-w-lg">
        {/* Mobile: bottom sheet colado na base com cantos superiores redondos e
            safe-area; desktop: card centrado */}
        <div className="anim-pop-in flex max-h-[88dvh] flex-col gap-4 overflow-hidden rounded-t-2xl border border-border bg-card p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:max-h-[85vh] sm:rounded-2xl sm:pb-5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-foreground">
              {product?.id === 'preview' ? 'Revisar dados importados' : product?.id === 'duplicate' ? 'Revisar produto duplicado' : product ? 'Editar produto' : 'Novo produto'}
            </h3>
            <button type="button" className="btn-ghost px-2 py-1" onClick={onClose} aria-label="Fechar">
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>

          <div className="flex flex-col gap-3 overflow-y-auto pr-1">
            {requiredFields.map(renderField)}

            <div className="grid gap-2 rounded-lg border border-border bg-background p-3 sm:grid-cols-2" aria-label="Verificação preventiva">
              {[
                { label: 'Campos obrigatórios', ok: missingRequired.length === 0 },
                { label: 'Página HTTPS', ok: /^https:\/\//i.test(form.link || '') },
                { label: 'Imagem HTTPS', ok: /^https:\/\//i.test(form.image_link || '') },
                { label: `Preço em ${currency}`, ok: Boolean(formatPriceForFeed(form.price || '', currency).match(/^\d+(?:\.\d{1,2})?\s+[A-Z]{3}$/)) },
              ].map((item) => (
                <span key={item.label} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  {item.ok ? <Check className="size-3 text-success" aria-hidden="true" /> : <AlertCircle className="size-3 text-warning" aria-hidden="true" />}
                  {item.label}
                </span>
              ))}
            </div>

            {optionalFields.length > 0 && (
              <button
                type="button"
                className="btn-ghost w-fit text-xs"
                onClick={() => setShowOptional((v) => !v)}
                aria-expanded={showOptional}
              >
                {showOptional ? <ChevronLeft className="size-3.5 rotate-90" aria-hidden="true" /> : <Plus className="size-3.5" aria-hidden="true" />}
                {showOptional ? 'Ocultar campos opcionais' : `Mostrar campos opcionais (${optionalFields.length})`}
              </button>
            )}
            {showOptional && optionalFields.map(renderField)}
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
            <div className="text-[11px] text-muted-foreground min-w-0">
              {missingRequired.length > 0 ? (
                <span className="text-warning">Campos obrigatórios: {missingRequired.map((k) => FIELD_LABELS[k] || k).join(', ')}</span>
              ) : null}
            </div>
            <button type="button" className="btn-primary shrink-0 text-xs" onClick={handleSave} disabled={busy || missingRequired.length > 0}>
              {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Check className="size-3.5" aria-hidden="true" />}
              Salvar produto
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
// Um campo do editor de produto: rótulo pt-BR.
export function ProductField({
  field,
  value,
  onChange,
}: {
  field: { key: string; required: boolean; enum: string[] | null }
  value: string
  onChange: (v: string) => void
}) {
  const label = FIELD_LABELS[field.key] || field.key
  const isMissing = field.required && !String(value).trim()
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="flex items-baseline gap-1.5">
        <span className="font-medium text-foreground">{label}</span>
        {field.required && <span className="text-error font-bold">*</span>}
      </span>
      {field.enum ? (
        <select className="input-base" value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {field.enum.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      ) : (
        <input
          className={`input-base ${isMissing ? 'border-error/50' : ''}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={FIELD_PLACEHOLDERS[field.key]}
        />
      )}
    </label>
  )
}
// ── Campo de preço simplificado ────────────────────────────────────────────
// O usuário digita só o número (9.99 ou 9,99); a moeda do catálogo aparece
// como sufixo fixo e é anexada automaticamente no salvar.
export function PriceField({
  field,
  currency,
  value,
  onChange,
}: {
  field: { key: string; required: boolean }
  currency: string
  value: string
  onChange: (v: string) => void
}) {
  const label = FIELD_LABELS[field.key] || field.key
  const isMissing = field.required && !String(value).trim()
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="flex items-baseline gap-1.5">
        <span className="font-medium text-foreground">{label}</span>
        {field.required && <span className="text-error font-bold">*</span>}
      </span>
      <span className="relative flex items-center">
        <input
          className={`input-base w-full pr-14 ${isMissing ? 'border-error/50' : ''}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Ex.: 9.99"
          inputMode="decimal"
        />
        <span className="pointer-events-none absolute right-3 text-[11px] font-semibold text-muted-foreground">
          {currency.toUpperCase()}
        </span>
      </span>
    </label>
  )
}
// ── Campo de imagem com upload ─────────────────────────────────────────────
// Botão "Enviar foto" usa /api/ads/upload, que abstrai o storage público do
// servidor, e preenche a URL sozinho; colar URL continua funcionando.
// Preview aparece quando a URL é válida.
export function ImageField({
  field,
  value,
  videoUrl,
  onChange,
}: {
  field: { key: string; required: boolean }
  value: string
  videoUrl?: string
  onChange: (v: string) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [generatingImage, setGeneratingImage] = useState(false)
  const label = FIELD_LABELS[field.key] || field.key
  const isMissing = field.required && !String(value).trim()
  const showPreview = /^https?:\/\/.+/i.test(String(value).trim())

  async function handleUpload(file: File) {
    setUploading(true)
    try {
      if (!['image/png', 'image/jpeg'].includes(file.type)) throw new Error('Use uma imagem PNG ou JPEG')
      if (file.size > 10 * 1024 * 1024) throw new Error('A imagem deve ter no máximo 10 MB')
      const bitmap = await createImageBitmap(file)
      const dimensions = { width: bitmap.width, height: bitmap.height }
      bitmap.close()
      if (dimensions.width < 500 || dimensions.height < 500) {
        throw new Error(`A imagem tem ${dimensions.width}×${dimensions.height}px; o mínimo é 500×500px`)
      }
      const res = await fetch(
        `/api/ads/upload?kind=image&filename=${encodeURIComponent(file.name)}`,
        { method: 'POST', body: file, credentials: 'include' },
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Erro ${res.status}`)
      onChange(data.url)
      toast.success('Foto enviada — URL preenchida')
    } catch (e) {
      toast.error('Falha ao enviar a foto', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function handleGenerateThumbnail() {
    if (!videoUrl) return
    setGeneratingImage(true)
    try {
      const video = document.createElement('video')
      video.crossOrigin = 'anonymous'
      video.src = videoUrl
      video.muted = true
      video.playsInline = true
      
      await new Promise((resolve, reject) => {
        video.onloadeddata = () => {
          video.currentTime = Math.min(1, video.duration || 1)
        }
        video.onseeked = () => resolve(true)
        video.onerror = () => reject(new Error('Bloqueado pelo provedor do vídeo (CORS) ou formato não suportado.'))
        setTimeout(() => reject(new Error('Tempo limite excedido ao ler o vídeo.')), 10000)
      })
      
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Falha interna ao desenhar imagem.')
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8))
      if (!blob) throw new Error('Falha ao exportar arquivo da imagem.')
      
      const file = new File([blob], `thumb_${Date.now()}.jpg`, { type: 'image/jpeg' })
      await handleUpload(file)
    } catch (e) {
      toast.error('Falha ao gerar thumbnail automaticamente', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setGeneratingImage(false)
    }
  }

  return (
    <div className="flex flex-col gap-1 text-xs">
      <span className="flex items-baseline gap-1.5">
        <span className="font-medium text-foreground">{label}</span>
        {field.required && <span className="text-error">*</span>}
        <span className="text-[10px] text-muted-foreground">{field.key}</span>
      </span>
      <div className="flex items-center gap-2">
        {/* Preview compacto (o TikTok exige ≥ 500×500 na origem) */}
        {showPreview && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={value || "/placeholder.svg"}
            alt="Preview do produto"
            className="size-10 shrink-0 rounded-lg border border-border object-cover"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
        )}
        <input
          className={`input-base min-w-0 flex-1 ${isMissing ? 'border-error/50' : ''}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={FIELD_PLACEHOLDERS[field.key] || 'https://… (≥ 500×500)'}
        />
        {videoUrl && !value && (
          <button
            type="button"
            className="btn-ghost shrink-0 text-xs text-primary"
            onClick={handleGenerateThumbnail}
            disabled={generatingImage}
            title="Extrair frame do vídeo para usar como foto"
          >
            {generatingImage ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : 'Gerar do Vídeo'}
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) handleUpload(f)
          }}
        />
        <button
          type="button"
          className="btn-ghost shrink-0 text-xs"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <ImageIcon className="size-3.5" aria-hidden="true" />}
          Enviar foto
        </button>
      </div>
    </div>
  )
}
