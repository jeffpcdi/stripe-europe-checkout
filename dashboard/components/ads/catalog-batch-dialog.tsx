'use client'

import { useMemo, useRef, useState } from 'react'
import { AlertCircle, Check, Loader2, PackageOpen, Rocket, UploadCloud } from 'lucide-react'
import { adsCreateCatalogBatch, adsPreviewCatalogBatch } from '@/lib/api'
import type { AdsCatalogBatchPreviewResponse } from '@/lib/types'
import { toast } from '@/lib/toast'

type BatchCatalog = {
  key: string
  name: string
  currency: string
  country: string
  catalogType: string
  products: { data: Record<string, string> }[]
  campaigns: Record<string, unknown>[]
}

const HEADERS: Record<string, string[]> = {
  catalog: ['catalogo', 'catálogo', 'catalog', 'catalog_name', 'nome_catalogo'],
  sku: ['sku', 'sku_id', 'id', 'id_produto'],
  title: ['titulo', 'título', 'title', 'nome', 'nome_produto'],
  description: ['descricao', 'descrição', 'description'],
  price: ['preco', 'preço', 'price', 'valor'],
  link: ['link', 'url_produto', 'product_link', 'url'],
  image: ['imagem', 'image', 'image_link', 'link_imagem', 'url_imagem'],
  campaign: ['campanha', 'campaign', 'campaign_name', 'nome_campanha'],
  budget: ['orcamento', 'orçamento', 'budget', 'daily_budget', 'orcamento_diario'],
}

function normalizeHeader(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
}

function parseDelimited(raw: string) {
  const input = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const firstLine = input.split('\n').find((line) => line.trim()) || ''
  const delimiter = firstLine.includes('\t') ? '\t' : firstLine.includes(';') ? ';' : ','
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (char === '"') quoted = false
      else field += char
      continue
    }
    if (char === '"') quoted = true
    else if (char === delimiter) {
      row.push(field.trim())
      field = ''
    } else if (char === '\n') {
      row.push(field.trim())
      if (row.some((value) => value)) rows.push(row)
      row = []
      field = ''
    } else field += char
  }
  row.push(field.trim())
  if (row.some((value) => value)) rows.push(row)
  return rows
}

function slug(value: string, fallback: string) {
  const out = normalizeHeader(value).replace(/[^a-z0-9_]+/g, '-').replace(/^[-_]+|[-_]+$/g, '')
  return out || fallback
}

function price(value: string, currency: string) {
  const raw = value.trim()
  if (!raw) return ''
  if (/\b[A-Za-z]{3}\b/.test(raw)) return raw.replace(',', '.')
  const withoutSymbol = raw.replace(/^R\$\s*/i, '')
  const number = withoutSymbol.includes(',')
    ? withoutSymbol.replace(/\./g, '').replace(',', '.')
    : withoutSymbol
  return `${number} ${currency}`
}

function budget(value: string) {
  const raw = value.trim()
  if (!raw) return undefined
  const normalized = raw.includes(',')
    ? raw.replace(/\./g, '').replace(',', '.')
    : raw
  return Number(normalized) || undefined
}

function buildPlan(raw: string, currency: string) {
  const rows = parseDelimited(raw)
  if (rows.length < 2) return { catalogs: [] as BatchCatalog[], rows: 0, message: 'Cole o cabeçalho e pelo menos uma linha de produto.' }
  const header = rows[0].map(normalizeHeader)
  const indexFor = (field: keyof typeof HEADERS) => header.findIndex((value) => HEADERS[field].map(normalizeHeader).includes(value))
  const idx = {
    catalog: indexFor('catalog'), sku: indexFor('sku'), title: indexFor('title'), description: indexFor('description'),
    price: indexFor('price'), link: indexFor('link'), image: indexFor('image'), campaign: indexFor('campaign'), budget: indexFor('budget'),
  }
  const valueAt = (row: string[], index: number) => index >= 0 ? String(row[index] || '').trim() : ''
  const byKey = new Map<string, BatchCatalog>()
  const campaignKeys = new Set<string>()
  rows.slice(1).forEach((row, position) => {
    const catalogName = valueAt(row, idx.catalog) || `Catálogo ${position + 1}`
    const keyBase = slug(catalogName, `catalogo-${position + 1}`)
    const key = keyBase
    let catalog = byKey.get(key)
    if (!catalog) {
      catalog = { key, name: catalogName, currency, country: 'BR', catalogType: 'ECOM', products: [], campaigns: [] }
      byKey.set(key, catalog)
    }
    const title = valueAt(row, idx.title)
    catalog.products.push({
      data: {
        sku_id: valueAt(row, idx.sku),
        title,
        description: valueAt(row, idx.description) || title,
        availability: 'in stock',
        condition: 'new',
        price: price(valueAt(row, idx.price), currency),
        link: valueAt(row, idx.link),
        image_link: valueAt(row, idx.image),
      },
    })
    const campaignName = valueAt(row, idx.campaign)
    const campaignKey = `${key}:${campaignName}`
    if (campaignName && !campaignKeys.has(campaignKey)) {
      campaignKeys.add(campaignKey)
      catalog.campaigns.push({
        name: campaignName,
        budgetAmount: budget(valueAt(row, idx.budget)),
        budgetType: 'daily',
        productScope: 'all',
      })
    }
  })
  return { catalogs: [...byKey.values()], rows: Math.max(0, rows.length - 1), message: '' }
}

function randomKey() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `catalog-batch-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function CatalogBatchDialog({
  advertiserId,
  onCreated,
}: {
  advertiserId: string
  onCreated: () => void
}) {
  const [open, setOpen] = useState(false)
  const [source, setSource] = useState('')
  const [currency, setCurrency] = useState('BRL')
  const [syncToTikTok, setSyncToTikTok] = useState(true)
  const [scheduleCampaigns, setScheduleCampaigns] = useState(false)
  const [preview, setPreview] = useState<AdsCatalogBatchPreviewResponse | null>(null)
  const [busy, setBusy] = useState<'preview' | 'create' | null>(null)
  const idempotencyKeyRef = useRef<string | null>(null)

  const plan = useMemo(() => buildPlan(source, currency), [source, currency])
  const campaignCount = plan.catalogs.reduce((total, catalog) => total + catalog.campaigns.length, 0)
  const canSubmit = plan.catalogs.length > 0 && !busy

  function dirty(next?: string) {
    if (next !== undefined) setSource(next)
    idempotencyKeyRef.current = null
    setPreview(null)
  }

  function invalidatePlan() {
    idempotencyKeyRef.current = null
    setPreview(null)
  }

  async function validate() {
    if (!plan.catalogs.length) return toast.error(plan.message || 'Cole as linhas do lote primeiro')
    setBusy('preview')
    try {
      const response = await adsPreviewCatalogBatch(advertiserId, {
        plan: { catalogs: plan.catalogs }, syncToTikTok, scheduleCampaigns,
      })
      setPreview(response)
      if (response.ok) toast.success('Lote validado', { hint: `${response.preview.summary.normalizedProducts} produto(s) prontos para criar.` })
      else toast.error('Há itens para corrigir no lote')
    } catch (error) {
      toast.error('Não foi possível validar o lote', { hint: error instanceof Error ? error.message : undefined })
    } finally {
      setBusy(null)
    }
  }

  async function create() {
    if (!preview?.ok) return void validate()
    setBusy('create')
    try {
      const result = await adsCreateCatalogBatch(advertiserId, {
        plan: { catalogs: plan.catalogs }, syncToTikTok, scheduleCampaigns,
        idempotencyKey: idempotencyKeyRef.current || (idempotencyKeyRef.current = randomKey()),
      })
      if (result.dryRun) {
        toast.info('Modo simulação: lote validado sem criar recursos no TikTok')
        return
      }
      const summary = result.execution?.summary
      if (!summary) throw new Error('O servidor não devolveu o resumo da execução do lote.')
      toast.success(`${summary.catalogs.completed} catálogo(s) criado(s) no lote`, {
        hint: summary.sync.queued > 0 ? `${summary.sync.queued} sincronização(ões) foram colocadas na fila.` : undefined,
      })
      setOpen(false)
      setSource('')
      idempotencyKeyRef.current = null
      setPreview(null)
      onCreated()
    } catch (error) {
      toast.error('O lote não foi concluído', { hint: error instanceof Error ? error.message : undefined })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="relative w-full sm:w-auto">
      <button type="button" className="btn-ghost shrink-0 self-start text-xs sm:self-auto" onClick={() => setOpen((value) => !value)}>
        <UploadCloud className="size-3.5" aria-hidden="true" /> Lote rápido
      </button>
      {open && (
        <section className="mt-3 w-full rounded-xl border border-primary/30 bg-background p-4 text-left shadow-xl sm:absolute sm:right-0 sm:z-20 sm:mt-2 sm:w-[min(760px,calc(100vw-2rem))]">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Lote rápido de catálogos</h3>
              <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-muted-foreground">
                Cole uma planilha. O <strong className="text-foreground">Link do produto</strong> é o único destino usado; não existe campo de URL no nível do anúncio.
              </p>
            </div>
            <button type="button" className="btn-ghost text-xs" onClick={() => setOpen(false)}>Fechar</button>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
            <label className="text-[11px] text-muted-foreground">
              Cole TSV do Excel/Sheets ou CSV (vírgula ou ponto e vírgula)
              <textarea
                className="input-base mt-1 min-h-44 w-full resize-y font-mono text-[11px]"
                value={source}
                onChange={(event) => dirty(event.target.value)}
                placeholder={'catalogo\tsku\ttitulo\tpreco\tlink\timagem\tcampanha\torcamento\nLoja Verão\tSKU-001\tCamiseta\t79,90\thttps://loja.com/camiseta\thttps://cdn.com/camiseta.jpg\tVerão — todos\t50'}
              />
            </label>
            <div className="flex gap-3 sm:flex-col">
              <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">Moeda
                <select className="input-base" value={currency} onChange={(event) => { setCurrency(event.target.value); invalidatePlan() }}>
                  <option>BRL</option><option>USD</option><option>EUR</option><option>MXN</option>
                </select>
              </label>
              <div className="rounded-lg bg-secondary/50 p-2 text-[10px] text-muted-foreground">
                <strong className="block text-foreground">{plan.catalogs.length} catálogo(s)</strong>
                {plan.rows} linha(s) · {plan.catalogs.reduce((total, catalog) => total + catalog.products.length, 0)} produto(s)
              </div>
            </div>
          </div>

          <div className="mt-3 grid gap-2 rounded-lg border border-border bg-secondary/20 p-3 text-[11px]">
            <label className="flex items-start gap-2 text-muted-foreground">
              <input className="mt-0.5 accent-primary" type="checkbox" checked={syncToTikTok} onChange={(event) => { setSyncToTikTok(event.target.checked); invalidatePlan() }} />
              <span><strong className="text-foreground">Sincronizar automaticamente com o TikTok</strong><br />{preview?.automation.catalogCreationNote || 'Publica o feed e cria o job durável de catálogo. Tudo fica sem veiculação até revisão.'}</span>
            </label>
            <label className="flex items-start gap-2 text-muted-foreground">
              <input className="mt-0.5 accent-primary" type="checkbox" checked={scheduleCampaigns} onChange={(event) => { setScheduleCampaigns(event.target.checked); invalidatePlan() }} />
              <span><strong className="text-foreground">Preparar campanhas Product Link pausadas</strong><br />{preview?.automation.productLinkNote || 'Valide o lote para consultar o conector Product Link.'}</span>
            </label>
            {scheduleCampaigns && <p className="rounded-md bg-background/70 px-2 py-1.5 text-[10px] text-muted-foreground">O lote prepara somente o Product Link. Nenhuma URL ou template é obrigatório no nível do anúncio.</p>}
          </div>

          {preview && (
            <div className={`mt-3 rounded-lg border p-3 text-[11px] ${preview.ok ? 'border-success/30 bg-success/5' : 'border-error/30 bg-error/5'}`}>
              <p className="flex items-center gap-1.5 font-semibold text-foreground">
                {preview.ok ? <Check className="size-3.5 text-success" /> : <AlertCircle className="size-3.5 text-error" />}
                {preview.preview.summary.normalizedCatalogs} catálogo(s) · {preview.preview.summary.normalizedProducts} produto(s) · {preview.preview.summary.normalizedCampaigns} campanha(s) no plano
              </p>
              {!preview.ok && <ul className="mt-2 space-y-1 text-error">
                {[...preview.preview.errors, ...(preview.campaignSpecErrors || [])].slice(0, 5).map((error, index) => <li key={`${error.code}-${index}`}>• {error.path || 'Lote'}: {error.message}</li>)}
              </ul>}
              {preview.tooLarge && <p className="mt-2 text-error">{preview.tooLarge.problems.join(' · ')}</p>}
              {preview.ok && !preview.automation.catalogSync && syncToTikTok && <p className="mt-2 text-warning">Configure o Business Center antes de iniciar a sincronização automática.</p>}
            </div>
          )}

          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button type="button" className="btn-ghost text-xs" onClick={() => setOpen(false)} disabled={Boolean(busy)}>Cancelar</button>
            <button type="button" className="btn-ghost text-xs" onClick={validate} disabled={!canSubmit}>
              {busy === 'preview' ? <Loader2 className="size-3.5 animate-spin" /> : <PackageOpen className="size-3.5" />} Validar lote
            </button>
            <button type="button" className="btn-primary text-xs" onClick={create} disabled={!canSubmit || !preview?.ok}>
              {busy === 'create' ? <Loader2 className="size-3.5 animate-spin" /> : <Rocket className="size-3.5" />} Criar lote
            </button>
          </div>
          {campaignCount > 0 && <p className="mt-2 text-[10px] text-muted-foreground">As campanhas do lote usam todos os produtos do catálogo e sempre nascem pausadas.</p>}
        </section>
      )}
    </div>
  )
}
