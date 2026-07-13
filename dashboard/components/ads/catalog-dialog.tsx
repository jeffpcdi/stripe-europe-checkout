'use client'

// Gerenciador de catálogos de produtos do TikTok.
// A Zernio (integração de Ads) NÃO publica campanhas de catálogo — então o
// fluxo aqui é: editar produtos na dashboard → publicar um feed CSV
// TikTok-ready numa URL pública (Blob) → o usuário cola essa URL UMA vez no
// Catalog Manager do TikTok como feed agendado. Toda edição aqui atualiza o
// feed (mesma URL), e o TikTok re-puxa no próximo ciclo.
//
// Telas: (1) lista de catálogos da conta; (2) detalhe com tabela de produtos
// editável, importação de CSV, download e publicação + passo a passo guiado.

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  X, ShoppingBag, Loader2, Plus, Trash2, UploadCloud, Download, Rocket,
  Copy, Check, AlertCircle, ChevronLeft, ExternalLink, PackageOpen,
} from 'lucide-react'
import {
  useAdsCatalogs, useAdsCatalogDetail, useAdsCatalogSpec, adsCatalogImportCsv, apiSend,
} from '@/lib/api'
import { toast } from '@/lib/toast'
import type { AdsCatalog, AdsCatalogProduct } from '@/lib/types'
import { useModalA11y } from '@/lib/use-modal-a11y'

const CURRENCIES = ['USD', 'BRL', 'EUR', 'GBP', 'MXN', 'CAD', 'AUD', 'JPY']

// Colunas prioritárias mostradas na tabela compacta (o restante fica no editor
// lateral). São as que o TikTok exige + as de maior uso.
const PRIMARY_COLS = ['sku_id', 'title', 'availability', 'condition', 'price', 'image_link', 'link']

export function CatalogDialog({
  open,
  onClose,
  advertiserId,
  advertiserLabel,
}: {
  open: boolean
  onClose: () => void
  advertiserId: string
  advertiserLabel: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  useModalA11y(open, ref, onClose)

  const { data: list, mutate: mutateList, isLoading: listLoading } = useAdsCatalogs(open)
  const { data: spec } = useAdsCatalogSpec(open)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) setSelectedId(null)
  }, [open])

  if (!open) return null

  const enabled = list?.enabled !== false

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div ref={ref} role="dialog" aria-modal="true" aria-label="Catálogos de produtos" tabIndex={-1} className="w-full max-w-4xl outline-none">
        <div className="anim-pop-in flex max-h-[88vh] flex-col gap-4 overflow-hidden rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <ShoppingBag className="size-4 text-primary" aria-hidden="true" />
              Catálogos de produtos
              <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-normal text-muted-foreground">
                {advertiserLabel || advertiserId}
              </span>
            </h2>
            <button type="button" className="btn-ghost px-2 py-1" onClick={onClose} aria-label="Fechar">
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>

          {!enabled ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-background p-8 text-center">
              <AlertCircle className="size-6 text-warning" aria-hidden="true" />
              <p className="text-sm font-medium text-foreground">Persistência indisponível</p>
              <p className="max-w-md text-pretty text-xs text-muted-foreground">
                O banco de dados (Neon) não está configurado, então catálogos não podem ser salvos. Conecte o
                Neon nas configurações do projeto para usar este recurso.
              </p>
            </div>
          ) : selectedId ? (
            <CatalogDetail
              catalogId={selectedId}
              spec={spec ?? null}
              onBack={() => {
                setSelectedId(null)
                mutateList()
              }}
              onDeleted={() => {
                setSelectedId(null)
                mutateList()
              }}
            />
          ) : (
            <CatalogList
              catalogs={list?.catalogs ?? []}
              loading={listLoading && !list}
              advertiserId={advertiserId}
              onOpen={setSelectedId}
              onChanged={mutateList}
            />
          )}
        </div>
      </div>
    </div>
  )
}

// ── Tela 1: lista + criação ──────────────────────────────────────────────
function CatalogList({
  catalogs,
  loading,
  advertiserId,
  onOpen,
  onChanged,
}: {
  catalogs: AdsCatalog[]
  loading: boolean
  advertiserId: string
  onOpen: (id: string) => void
  onChanged: () => void
}) {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [busy, setBusy] = useState(false)

  async function handleCreate() {
    if (!name.trim()) return
    setBusy(true)
    try {
      const res = await apiSend<{ catalog: AdsCatalog }>('/api/ads/catalogs', 'POST', {
        name: name.trim(),
        currency,
      })
      toast.success('Catálogo criado')
      setName('')
      setCreating(false)
      onChanged()
      onOpen(res.catalog.id)
    } catch (e) {
      toast.error('Falha ao criar catálogo', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 overflow-y-auto">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Cada catálogo gera um feed CSV que você conecta ao TikTok Catalog Manager.
        </p>
        {!creating && (
          <button type="button" className="btn-primary shrink-0 text-xs" onClick={() => setCreating(true)}>
            <Plus className="size-3.5" aria-hidden="true" />
            Novo catálogo
          </button>
        )}
      </div>

      {creating && (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium text-foreground">Nome do catálogo</span>
              <input
                autoFocus
                className="input-base"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex.: Loja Verão 2026"
                maxLength={200}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) handleCreate()
                }}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium text-foreground">Moeda</span>
              <select className="input-base" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>
          </div>
          <p className="text-[11px] text-muted-foreground">
            A moeda precisa bater com a moeda padrão do catálogo no TikTok. Todos os preços usarão ela.
          </p>
          <div className="flex items-center justify-end gap-2">
            <button type="button" className="btn-ghost text-xs" onClick={() => setCreating(false)} disabled={busy}>
              Cancelar
            </button>
            <button type="button" className="btn-primary text-xs" onClick={handleCreate} disabled={busy || !name.trim()}>
              {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Plus className="size-3.5" aria-hidden="true" />}
              Criar
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" aria-hidden="true" />
        </div>
      ) : catalogs.length === 0 && !creating ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-background p-8 text-center">
          <PackageOpen className="size-6 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-medium text-foreground">Nenhum catálogo ainda</p>
          <p className="max-w-md text-pretty text-xs text-muted-foreground">
            Crie um catálogo, adicione ou importe produtos e publique o feed para conectar ao TikTok.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {catalogs.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onOpen(c.id)}
                className="flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-background px-4 py-3 text-left transition-colors hover:border-primary/50"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{c.name}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {c.productCount} produto{c.productCount === 1 ? '' : 's'} · {c.currency}
                    {c.feedUrl ? ' · feed publicado' : ' · não publicado'}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${c.feedUrl ? 'bg-success/15 text-success' : 'bg-secondary text-muted-foreground'}`}>
                  {c.feedUrl ? 'Ativo' : 'Rascunho'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── Tela 2: detalhe (produtos + import + publicar) ────────────────────────
function CatalogDetail({
  catalogId,
  spec,
  onBack,
  onDeleted,
}: {
  catalogId: string
  spec: { columns: string[]; required: string[]; enums: Record<string, string[]>; fields: { key: string; required: boolean; enum: string[] | null }[] } | null
  onBack: () => void
  onDeleted: () => void
}) {
  const { data, mutate, isLoading } = useAdsCatalogDetail(catalogId)
  const fileRef = useRef<HTMLInputElement>(null)
  const [editing, setEditing] = useState<AdsCatalogProduct | 'new' | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [copied, setCopied] = useState(false)

  const catalog = data?.catalog
  const products = data?.products ?? []
  const validCount = products.filter((p) => p.valid).length

  async function handleImport(file: File) {
    setImporting(true)
    try {
      const text = await file.text()
      const { summary } = await adsCatalogImportCsv(catalogId, text)
      toast.success(`${summary.imported} produto(s) importado(s)`, {
        hint: summary.invalid > 0 ? `${summary.invalid} com erros de validação — revise na tabela.` : undefined,
      })
      mutate()
    } catch (e) {
      toast.error('Falha ao importar CSV', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function handlePublish() {
    setPublishing(true)
    try {
      const res = await apiSend<{ feedUrl: string; published: number; skipped: number }>(
        `/api/ads/catalogs/${encodeURIComponent(catalogId)}/publish`, 'POST', {},
      )
      toast.success(`Feed publicado com ${res.published} produto(s)`, {
        hint: res.skipped > 0 ? `${res.skipped} pulado(s) por erros de validação.` : undefined,
      })
      mutate()
    } catch (e) {
      toast.error('Falha ao publicar o feed', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setPublishing(false)
    }
  }

  async function handleDelete() {
    if (!confirm('Excluir este catálogo e todos os produtos? Isso não pode ser desfeito.')) return
    try {
      await apiSend(`/api/ads/catalogs/${encodeURIComponent(catalogId)}`, 'DELETE')
      toast.success('Catálogo excluído')
      onDeleted()
    } catch (e) {
      toast.error('Falha ao excluir', { hint: e instanceof Error ? e.message : undefined })
    }
  }

  async function handleDeleteProduct(productId: string) {
    try {
      await apiSend(`/api/ads/catalogs/${encodeURIComponent(catalogId)}/products/${encodeURIComponent(productId)}`, 'DELETE')
      mutate()
    } catch (e) {
      toast.error('Falha ao remover produto', { hint: e instanceof Error ? e.message : undefined })
    }
  }

  function copyFeedUrl() {
    if (!catalog?.feedUrl) return
    navigator.clipboard?.writeText(catalog.feedUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="flex flex-col gap-3 overflow-y-auto">
      <div className="flex items-center justify-between gap-2">
        <button type="button" className="btn-ghost text-xs" onClick={onBack}>
          <ChevronLeft className="size-3.5" aria-hidden="true" />
          Voltar
        </button>
        <button type="button" className="btn-ghost text-xs text-error" onClick={handleDelete}>
          <Trash2 className="size-3.5" aria-hidden="true" />
          Excluir catálogo
        </button>
      </div>

      {isLoading && !data ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" aria-hidden="true" />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background p-4">
            <div>
              <p className="text-sm font-semibold text-foreground">{catalog?.name}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {products.length} produto{products.length === 1 ? '' : 's'} · {validCount} válido{validCount === 1 ? '' : 's'} · {catalog?.currency}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) handleImport(f)
                }}
              />
              <button type="button" className="btn-ghost text-xs" onClick={() => fileRef.current?.click()} disabled={importing}>
                {importing ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <UploadCloud className="size-3.5" aria-hidden="true" />}
                Importar CSV
              </button>
              <a
                className="btn-ghost text-xs"
                href={`/api/ads/catalogs/${encodeURIComponent(catalogId)}/export.csv`}
              >
                <Download className="size-3.5" aria-hidden="true" />
                Baixar CSV
              </a>
              <button type="button" className="btn-ghost text-xs" onClick={() => setEditing('new')}>
                <Plus className="size-3.5" aria-hidden="true" />
                Produto
              </button>
              <button type="button" className="btn-primary text-xs" onClick={handlePublish} disabled={publishing || validCount === 0}>
                {publishing ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Rocket className="size-3.5" aria-hidden="true" />}
                Publicar feed
              </button>
            </div>
          </div>

          {/* Feed publicado + handoff guiado */}
          {catalog?.feedUrl && (
            <div className="flex flex-col gap-2 rounded-xl border border-success/30 bg-success/5 p-4">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <Check className="size-3.5 text-success" aria-hidden="true" />
                Feed pronto para o TikTok
              </p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg bg-background px-3 py-2 text-[11px] text-muted-foreground">
                  {catalog.feedUrl}
                </code>
                <button type="button" className="btn-ghost shrink-0 px-2 py-2" onClick={copyFeedUrl} aria-label="Copiar URL">
                  {copied ? <Check className="size-3.5 text-success" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
                </button>
              </div>
              <ol className="ml-4 list-decimal text-pretty text-[11px] leading-relaxed text-muted-foreground">
                <li>Abra o <strong className="text-foreground">TikTok Business Center → Catalog Manager</strong> e crie/abra um catálogo.</li>
                <li>Em <strong className="text-foreground">Data source → Scheduled feed</strong>, cole a URL acima e defina a frequência de atualização.</li>
                <li>Cada vez que você editar produtos aqui e clicar em <strong className="text-foreground">Publicar feed</strong>, a URL continua a mesma — o TikTok re-puxa sozinho.</li>
                <li>Crie a campanha com objetivo <strong className="text-foreground">Product Sales</strong> e selecione este catálogo.</li>
              </ol>
              <a
                className="btn-ghost w-fit text-xs"
                href="https://ads.tiktok.com/help/article?aid=10001006"
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink className="size-3.5" aria-hidden="true" />
                Guia oficial do TikTok
              </a>
            </div>
          )}

          {/* Tabela de produtos */}
          {products.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-background p-8 text-center">
              <PackageOpen className="size-6 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm font-medium text-foreground">Nenhum produto</p>
              <p className="max-w-md text-pretty text-xs text-muted-foreground">
                Importe o CSV do template do TikTok ou adicione produtos manualmente.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-left text-xs">
                <thead className="bg-secondary/50 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Status</th>
                    {PRIMARY_COLS.map((col) => (
                      <th key={col} className="whitespace-nowrap px-3 py-2 font-medium">{col}</th>
                    ))}
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {products.map((p) => (
                    <tr key={p.id} className="border-t border-border hover:bg-secondary/30">
                      <td className="px-3 py-2">
                        {p.valid ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold text-success">
                            <Check className="size-3" aria-hidden="true" /> ok
                          </span>
                        ) : (
                          <span
                            className="inline-flex items-center gap-1 rounded-full bg-error/15 px-2 py-0.5 text-[10px] font-semibold text-error"
                            title={p.errors.map((e) => `${e.field}: ${e.message}`).join('\n')}
                          >
                            <AlertCircle className="size-3" aria-hidden="true" /> {p.errors.length} erro{p.errors.length === 1 ? '' : 's'}
                          </span>
                        )}
                      </td>
                      {PRIMARY_COLS.map((col) => (
                        <td key={col} className="max-w-[180px] truncate px-3 py-2 text-foreground" title={p.data[col] || ''}>
                          {p.data[col] || <span className="text-muted-foreground">—</span>}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button type="button" className="btn-ghost px-2 py-1" onClick={() => setEditing(p)} aria-label="Editar">
                            Editar
                          </button>
                          <button type="button" className="btn-ghost px-2 py-1 text-error" onClick={() => handleDeleteProduct(p.id)} aria-label="Remover">
                            <Trash2 className="size-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {editing && (
        <ProductEditor
          catalogId={catalogId}
          spec={spec}
          product={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            mutate()
          }}
        />
      )}
    </div>
  )
}

// ── Editor de um produto (sobreposto) ─────────────────────────────────────
function ProductEditor({
  catalogId,
  spec,
  product,
  onClose,
  onSaved,
}: {
  catalogId: string
  spec: { columns: string[]; required: string[]; enums: Record<string, string[]>; fields: { key: string; required: boolean; enum: string[] | null }[] } | null
  product: AdsCatalogProduct | null
  onClose: () => void
  onSaved: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [form, setForm] = useState<Record<string, string>>(product?.data ?? {})
  const [busy, setBusy] = useState(false)
  useModalA11y(true, ref, onClose)

  const fields = spec?.fields ?? []
  const required = useMemo(() => new Set(spec?.required ?? []), [spec])

  // Campos obrigatórios primeiro, depois o restante — form mais rápido de preencher.
  const ordered = useMemo(() => {
    const req = fields.filter((f) => f.required)
    const opt = fields.filter((f) => !f.required)
    return [...req, ...opt]
  }, [fields])

  async function handleSave() {
    setBusy(true)
    try {
      await apiSend(`/api/ads/catalogs/${encodeURIComponent(catalogId)}/products`, 'POST', { data: form })
      toast.success('Produto salvo')
      onSaved()
    } catch (e) {
      toast.error('Falha ao salvar produto', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setBusy(false)
    }
  }

  const missingRequired = [...required].filter((k) => !String(form[k] || '').trim())

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div ref={ref} role="dialog" aria-modal="true" aria-label="Editar produto" tabIndex={-1} className="w-full max-w-lg outline-none">
        <div className="anim-pop-in flex max-h-[85vh] flex-col gap-4 overflow-hidden rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-foreground">
              {product ? 'Editar produto' : 'Novo produto'}
            </h3>
            <button type="button" className="btn-ghost px-2 py-1" onClick={onClose} aria-label="Fechar">
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>

          <div className="flex flex-col gap-3 overflow-y-auto pr-1">
            {ordered.map((f) => {
              const val = form[f.key] ?? ''
              const isMissing = f.required && !String(val).trim()
              return (
                <label key={f.key} className="flex flex-col gap-1 text-xs">
                  <span className="font-medium text-foreground">
                    {f.key}
                    {f.required && <span className="ml-1 text-error">*</span>}
                  </span>
                  {f.enum ? (
                    <select
                      className="input-base"
                      value={val}
                      onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
                    >
                      <option value="">—</option>
                      {f.enum.map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className={`input-base ${isMissing ? 'border-error/50' : ''}`}
                      value={val}
                      onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
                      placeholder={f.key === 'price' ? 'Ex.: 9.99 USD' : undefined}
                    />
                  )}
                </label>
              )
            })}
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
            <p className="text-[11px] text-muted-foreground">
              {missingRequired.length > 0
                ? `Faltam obrigatórios: ${missingRequired.join(', ')}`
                : 'Todos os campos obrigatórios preenchidos'}
            </p>
            <button type="button" className="btn-primary shrink-0 text-xs" onClick={handleSave} disabled={busy || missingRequired.length > 0}>
              {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Check className="size-3.5" aria-hidden="true" />}
              Salvar
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
