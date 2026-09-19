'use client'

// Orquestrador visual do domínio de catálogos. As responsabilidades de conexão,
// prontidão e criação de campanha ficam em componentes próprios; esta tela
// concentra produtos, importação e histórico.

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  X,
  Loader2,
  Plus,
  Trash2,
  UploadCloud,
  Check,
  AlertCircle,
  PackageOpen,
  Building2,
  Clock,
  RefreshCw,
  Pencil,
  CopyPlus,
  SearchCheck,
  RotateCcw,
  Sparkles,
  Search,
  ArrowUpDown,
  MoreHorizontal,
  SlidersHorizontal,
} from 'lucide-react'
import { adsCatalogApiUrl, apiSend } from '@/lib/api'
import { catalogProductCount } from '@/lib/catalog-display'
import { toast } from '@/lib/toast'
import type { AdsCatalog, AdsCatalogSpecResponse, AdsCatalogSyncResponse } from '@/lib/types'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { CatalogBatchDialog } from './catalog-batch-dialog'
import { CatalogProductImport } from './catalog-product-import'


type CatalogSpec = AdsCatalogSpecResponse
const CURRENCIES = ['USD', 'BRL', 'EUR', 'GBP', 'MXN', 'CAD', 'AUD', 'JPY']
export function catalogStatusMeta(catalog: AdsCatalog) {
  if (catalog.linkStatus === 'verified') {
    const rejected = Number(catalog.audit?.rejected) || 0
    const pending = Number(catalog.audit?.pending) || 0
    if (rejected > 0) {
      return { label: 'Requer atenção', summary: `${rejected} produto(s) reprovado(s)`, className: 'bg-error/15 text-error' }
    }
    if (pending > 0) {
      return { label: 'Em análise', summary: `${pending} produto(s) em análise`, className: 'bg-warning/15 text-warning' }
    }
    if (catalogProductCount(catalog).count === 0) {
      return { label: 'Sem produtos', summary: 'adicione o primeiro produto', className: 'bg-warning/15 text-warning' }
    }
    return { label: 'Vinculado', summary: 'vínculo TikTok verificado', className: 'bg-success/15 text-success' }
  }
  if (catalog.linkStatus === 'error') {
    return { label: 'Vínculo com erro', summary: 'vínculo requer correção', className: 'bg-error/15 text-error' }
  }
  if (catalog.tiktokCatalogId) {
    return { label: 'A verificar', summary: 'vínculo não verificado', className: 'bg-warning/15 text-warning' }
  }
  if (catalog.feedUrl) {
    return { label: 'Feed pronto', summary: 'feed atualizado', className: 'bg-primary/15 text-primary' }
  }
  return { label: 'Rascunho', summary: 'rascunho', className: 'bg-secondary text-muted-foreground' }
}
function formatTimestamp(isoString: string | null | undefined): string {
  if (!isoString) return '—'
  try {
    const d = new Date(isoString)
    if (isNaN(d.getTime())) return '—'
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Sao_Paulo',
    }).format(d)
  } catch {
    return '—'
  }
}

function getCatalogCategory(c: AdsCatalog): 'linked' | 'in_review' | 'needs_attention' | 'draft' {
  if (c.linkStatus === 'error' || (Number(c.audit?.rejected) || 0) > 0) {
    return 'needs_attention'
  }
  if ((Number(c.audit?.pending) || 0) > 0) {
    return 'in_review'
  }
  if (catalogProductCount(c).count === 0) {
    return 'draft'
  }
  if (c.linkStatus === 'verified' && c.tiktokCatalogId) {
    return 'linked'
  }
  return 'draft'
}

const STATUS_FILTERS = [
  { value: '', label: 'Todos' },
  { value: 'linked', label: 'Vinculados' },
  { value: 'in_review', label: 'Em análise' },
  { value: 'needs_attention', label: 'Requer atenção' },
  { value: 'draft', label: 'Rascunhos' },
] as const

// ── Tela 1: lista + criação ──────────────────────────────────────────────
export function CatalogList({
  request,
  onRequestHandled,
  catalogs,
  advertiserId,
  advertiserCurrency,
  spec,
  loading,
  onOpen,
  onChanged,
  onLocalWorkStateChange,
}: {
  request?: { action: 'create' | 'magic' | 'batch'; id: number } | null
  onRequestHandled?: () => void
  catalogs: AdsCatalog[]
  advertiserId: string
  advertiserCurrency: string
  spec: CatalogSpec | null
  loading: boolean
  onOpen: (id: string) => void
  onChanged: () => void
  onLocalWorkStateChange?: (state: { uploading: boolean; pending: number }) => void
}) {
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<'newest' | 'products' | 'name'>('newest')
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState(advertiserCurrency || 'BRL')
  const catalogType = 'ECOM'
  const [country, setCountry] = useState('BR')
  const [busy, setBusy] = useState(false)
  const [cloningId, setCloningId] = useState<string | null>(null)
  const [cloneTarget, setCloneTarget] = useState<AdsCatalog | null>(null)
  const [syncingId, setSyncingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AdsCatalog | null>(null)
  const [deleting, setDeleting] = useState(false)
  const countries = spec?.countries ?? [{ code: 'BR', name: 'Brasil' }]
  const [showMagicImport, setShowMagicImport] = useState(false)
  const [magicBusy, setMagicBusy] = useState(false)
  const [batchRequest, setBatchRequest] = useState(0)
  const manualCreateRef = useRef<{ signature: string; key: string } | null>(null)
  const manualCreateBusyRef = useRef(false)
  const cloneRequestKeysRef = useRef<Record<string, string>>({})

  useEffect(() => {
    if (!request || busy || magicBusy) return
    setCreating(request.action === 'create')
    setShowMagicImport(request.action === 'magic')
    if (request.action === 'batch') setBatchRequest(value => value + 1)
    onRequestHandled?.()
  }, [request, busy, magicBusy, onRequestHandled])

  async function handleCreate() {
    if (!name.trim() || busy || manualCreateBusyRef.current) return
    const signature = JSON.stringify({ advertiserId, name: name.trim(), currency, catalogType, country })
    if (!manualCreateRef.current || manualCreateRef.current.signature !== signature) {
      manualCreateRef.current = { signature, key: `manual:${crypto.randomUUID()}` }
    }
    manualCreateBusyRef.current = true
    setBusy(true)
    try {
      const res = await apiSend<{ catalog: AdsCatalog }>(adsCatalogApiUrl('/api/ads/catalogs', advertiserId), 'POST', {
        name: name.trim(),
        currency,
        catalogType,
        country,
        // createCatalog já possui unicidade durável por batchKey. Reusar a
        // mesma chave em retry evita dois catálogos quando a resposta se perde.
        batchKey: manualCreateRef.current.key,
      })
      manualCreateRef.current = null
      toast.success('Catálogo criado')
      setName('')
      setCreating(false)
      onChanged()
      onOpen(res.catalog.id)
    } catch (e) {
      toast.error('Falha ao criar catálogo', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      manualCreateBusyRef.current = false
      setBusy(false)
    }
  }

  async function handleCloneFromList(catalogId: string) {
    if (cloningId) return
    setCloningId(catalogId)
    const idempotencyKey = cloneRequestKeysRef.current[catalogId] || crypto.randomUUID()
    cloneRequestKeysRef.current[catalogId] = idempotencyKey
    try {
      const res = await apiSend<{ catalog: AdsCatalog; productCount: number; syncStarted: boolean }>(
        adsCatalogApiUrl(`/api/ads/catalogs/${encodeURIComponent(catalogId)}/clone`, advertiserId), 'POST', { idempotencyKey },
      )
      // Só libera uma nova chave depois de o servidor confirmar o clone. Se a
      // resposta se perder, o retry usa a mesma chave e o backend reaproveita
      // o clone que já foi persistido.
      delete cloneRequestKeysRef.current[catalogId]
      toast.success(
        res.syncStarted
          ? `Catálogo clonado com ${res.productCount} produto(s) — publicação iniciada`
          : `Catálogo clonado com ${res.productCount} produto(s)`,
      )
      setCloneTarget(null)
      onChanged()
      onOpen(res.catalog.id)
    } catch (e) {
      toast.error('Falha ao clonar', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setCloningId(null)
    }
  }

  async function handleSyncFromList(catalogId: string) {
    if (syncingId) return
    setSyncingId(catalogId)
    try {
      const res = await apiSend<AdsCatalogSyncResponse>(
        adsCatalogApiUrl(`/api/ads/catalogs/${encodeURIComponent(catalogId)}/sync-tiktok`, advertiserId), 'POST', {},
      )
      if (res.dryRun) toast.info('Modo simulação: a sincronização foi validada sem publicar no TikTok')
      else if (res.pending) toast.info('Sincronização iniciada em segundo plano')
      else toast.success(`Sincronização enviada para ${res.published} produto(s)`)
      onChanged()
    } catch (e) {
      toast.error('Não foi possível sincronizar', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setSyncingId(null)
    }
  }

  async function handleDeleteFromList() {
    if (!deleteTarget || deleting) return
    setDeleting(true)
    try {
      await apiSend(adsCatalogApiUrl(`/api/ads/catalogs/${encodeURIComponent(deleteTarget.id)}`, advertiserId), 'DELETE')
      toast.success('Catálogo local excluído', { hint: 'O catálogo remoto do TikTok não foi apagado.' })
      setDeleteTarget(null)
      onChanged()
    } catch (e) {
      toast.error('Falha ao excluir catálogo', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setDeleting(false)
    }
  }

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: catalogs.length, linked: 0, in_review: 0, needs_attention: 0, draft: 0 }
    for (const c of catalogs) {
      const cat = getCatalogCategory(c)
      counts[cat] = (counts[cat] || 0) + 1
    }
    return counts
  }, [catalogs])

  const catalogSummary = useMemo(() => ({
    linked: statusCounts.linked || 0,
    attention: statusCounts.needs_attention || 0,
    review: statusCounts.in_review || 0,
    products: catalogs.reduce((sum, catalog) => sum + catalogProductCount(catalog).count, 0),
  }), [catalogs, statusCounts])

  const nextCatalogAction = useMemo(() => {
    if (!catalogs.length) return { label: 'Crie o primeiro catálogo', detail: 'Um link de produto é o caminho mais rápido para começar.', action: 'magic' as const }
    if (catalogSummary.attention > 0) return { label: 'Revise catálogos com atenção', detail: `${catalogSummary.attention} catálogo${catalogSummary.attention === 1 ? '' : 's'} precisa${catalogSummary.attention === 1 ? '' : 'm'} de ajuste antes de anunciar.`, action: 'attention' as const }
    const empty = catalogs.find((catalog) => catalogProductCount(catalog).count === 0)
    if (empty) return { label: 'Adicione produtos', detail: 'Há catálogo sem produto; ele ainda não está pronto para sincronizar.', action: 'open' as const, id: empty.id }
    if (catalogSummary.review > 0) return { label: 'Acompanhe a análise do TikTok', detail: `${catalogSummary.review} catálogo${catalogSummary.review === 1 ? '' : 's'} ainda em processamento.`, action: 'review' as const }
    if (catalogSummary.linked === catalogs.length) return { label: 'Catálogos prontos para anunciar', detail: 'Produtos e vínculo com o TikTok estão sincronizados.', action: 'none' as const }
    return { label: 'Conclua a sincronização', detail: 'Abra um catálogo pendente para revisar produtos e publicar no TikTok.', action: 'draft' as const }
  }, [catalogs, catalogSummary])

  const filteredCatalogs = useMemo(() => {
    return catalogs
      .filter((c) => {
        if (statusFilter && getCatalogCategory(c) !== statusFilter) return false
        if (search.trim()) {
          const q = search.toLowerCase().trim()
          const haystack = [c.name, c.tiktokCatalogId, c.id, c.country, c.currency].filter(Boolean).join(' ').toLowerCase()
          if (!haystack.includes(q)) return false
        }
        return true
      })
      .sort((a, b) => {
        if (sort === 'products') return catalogProductCount(b).count - catalogProductCount(a).count
        if (sort === 'name') return a.name.localeCompare(b.name, 'pt-BR')
        const dateA = new Date(a.updatedAt || a.createdAt || 0).getTime()
        const dateB = new Date(b.updatedAt || b.createdAt || 0).getTime()
        return dateB - dateA
      })
  }, [catalogs, statusFilter, search, sort])

  const selectedFilterLabel = statusFilter === 'linked'
    ? 'Vinculados'
    : statusFilter === 'in_review'
      ? 'Em análise'
      : statusFilter === 'draft'
        ? 'Rascunhos'
        : 'Filtros'

  function renderStatus(c: AdsCatalog) {
    const productCount = catalogProductCount(c).count
    if (productCount === 0) return <span className="inline-flex items-center gap-1.5 text-warning"><AlertCircle className="size-3.5" /> Sem produtos</span>
    const category = getCatalogCategory(c)
    const rejected = Math.max(0, Number(c.audit?.rejected) || 0)
    const pending = Math.max(0, Number(c.audit?.pending) || 0)
    if (category === 'needs_attention') {
      return <span className="inline-flex items-center gap-1.5 font-medium text-error"><AlertCircle className="size-3.5" /> {rejected > 0 ? `${rejected} com problema` : 'Precisa de atenção'}</span>
    }
    if (category === 'in_review') {
      return <span className="inline-flex items-center gap-1.5 font-medium text-warning"><Clock className="size-3.5" /> {pending > 0 ? `${pending} em análise` : 'Em análise'}</span>
    }
    if (category === 'linked') {
      return <span className="inline-flex items-center gap-1.5 text-muted-foreground"><Check className="size-3.5 text-success" /> Sincronizado</span>
    }
    if (c.tiktokCatalogId) return <span className="inline-flex items-center gap-1.5 text-muted-foreground"><Clock className="size-3.5" /> A verificar</span>
    if (c.feedUrl) return <span className="inline-flex items-center gap-1.5 text-muted-foreground"><UploadCloud className="size-3.5" /> Pronto para sincronizar</span>
    return <span className="text-muted-foreground">Rascunho</span>
  }

  function catalogActions(c: AdsCatalog) {
    const isCloning = cloningId === c.id
    const isSyncing = syncingId === c.id
    return (
      <details className="catalog-row-menu relative inline-block" onClick={(event) => event.stopPropagation()}>
        <summary className="btn-ghost !size-10 cursor-pointer list-none justify-center p-0 text-muted-foreground" aria-label={`Ações de ${c.name}`} title="Mais ações">
          <MoreHorizontal className="size-3.5" />
        </summary>
        <div className="catalog-row-popover">
          <button type="button" disabled={Boolean(syncingId) || catalogProductCount(c).count === 0} onClick={() => void handleSyncFromList(c.id)}>
            {isSyncing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} Sincronizar novamente
          </button>
          <button type="button" disabled={Boolean(cloningId)} onClick={() => setCloneTarget(c)}>
            {isCloning ? <Loader2 className="size-3.5 animate-spin" /> : <CopyPlus className="size-3.5" />} Clonar catálogo
          </button>
          <button type="button" className="text-error" onClick={() => setDeleteTarget(c)}>
            <Trash2 className="size-3.5" /> Excluir catálogo
          </button>
        </div>
      </details>
    )
  }

  return (
    <>
      <section className="min-w-0 overflow-visible border-y border-border/60 bg-card/20">
        <div className="campaign-toolbar !gap-3 px-0">
          <div className="campaign-toolbar-title flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-foreground">Catálogos</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {catalogs.length} catálogo{catalogs.length === 1 ? '' : 's'} · {catalogSummary.linked} sincronizado{catalogSummary.linked === 1 ? '' : 's'}
                {catalogSummary.review > 0 ? ` · ${catalogSummary.review} em análise` : ''}
                {catalogSummary.attention > 0 ? ` · ${catalogSummary.attention} precisa${catalogSummary.attention === 1 ? '' : 'm'} de atenção` : ''}
              </p>
            </div>
          </div>

          {catalogs.length > 0 ? <div className="flex flex-col gap-2 border-y border-border/50 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-foreground">{nextCatalogAction.label}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{nextCatalogAction.detail}</p>
            </div>
            <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
              <span><strong className="font-semibold text-foreground">{catalogSummary.products}</strong> produtos</span>
              {nextCatalogAction.action === 'attention' ? <button type="button" onClick={() => setStatusFilter('needs_attention')} className="font-semibold text-warning hover:underline">Revisar</button> : null}
              {nextCatalogAction.action === 'open' ? <button type="button" onClick={() => nextCatalogAction.id && onOpen(nextCatalogAction.id)} className="font-semibold text-primary hover:underline">Adicionar produtos</button> : null}
              {nextCatalogAction.action === 'review' ? <button type="button" onClick={() => setStatusFilter('in_review')} className="font-semibold text-primary hover:underline">Ver análise</button> : null}
              {nextCatalogAction.action === 'draft' ? <button type="button" onClick={() => setStatusFilter('draft')} className="font-semibold text-primary hover:underline">Continuar</button> : null}
            </div>
          </div> : null}

          <div className="campaign-search-row flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="campaign-search flex-1">
              <Search size={15} className="shrink-0 text-muted-foreground" aria-hidden="true" />
              <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar catálogo..." aria-label="Buscar catálogo" />
              {search && (
                <button type="button" onClick={() => setSearch('')} className="p-1 text-muted-foreground hover:text-foreground" title="Limpar busca">
                  <X size={14} />
                </button>
              )}
            </label>

            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
              <button type="button" onClick={() => setStatusFilter('')} aria-pressed={statusFilter === ''} className={`catalog-compact-filter min-h-10 ${statusFilter === '' ? 'catalog-compact-filter--active' : ''}`}>
                Todos <span>{statusCounts.all}</span>
              </button>
              {statusCounts.needs_attention > 0 && (
                <button type="button" onClick={() => setStatusFilter(statusFilter === 'needs_attention' ? '' : 'needs_attention')} aria-pressed={statusFilter === 'needs_attention'} className={`catalog-compact-filter catalog-compact-filter--warning min-h-10 ${statusFilter === 'needs_attention' ? 'catalog-compact-filter--active' : ''}`}>
                  <AlertCircle className="size-3.5" /> Atenção <span>{statusCounts.needs_attention}</span>
                </button>
              )}
              <details className="catalog-actions-menu relative">
                <summary className={`catalog-icon-filter min-h-10 cursor-pointer list-none ${['linked', 'in_review', 'draft'].includes(statusFilter) ? 'catalog-icon-filter--active' : ''}`} aria-label="Outros filtros" title={selectedFilterLabel}>
                  <SlidersHorizontal className="size-3.5" /><span className="hidden lg:inline">{selectedFilterLabel}</span>
                </summary>
                <div className="catalog-actions-popover">
                  <button type="button" onClick={() => setStatusFilter('linked')}><Check className="size-3.5" /> Vinculados <span className="ml-auto tabular-nums">{statusCounts.linked}</span></button>
                  <button type="button" onClick={() => setStatusFilter('in_review')}><Clock className="size-3.5" /> Em análise <span className="ml-auto tabular-nums">{statusCounts.in_review}</span></button>
                  <button type="button" onClick={() => setStatusFilter('draft')}><PackageOpen className="size-3.5" /> Rascunhos <span className="ml-auto tabular-nums">{statusCounts.draft}</span></button>
                  {statusFilter && statusFilter !== 'needs_attention' && <button type="button" onClick={() => setStatusFilter('')}><RotateCcw className="size-3.5" /> Limpar filtro</button>}
                </div>
              </details>
              <details className="catalog-actions-menu relative">
                <summary className="catalog-icon-filter min-h-10 cursor-pointer list-none" aria-label="Ordenar catálogos" title="Ordenar"><ArrowUpDown className="size-3.5" /></summary>
                <div className="catalog-actions-popover">
                  <button type="button" onClick={() => setSort('newest')}>{sort === 'newest' ? <Check className="size-3.5 text-primary" /> : <Clock className="size-3.5" />} Recentes</button>
                  <button type="button" onClick={() => setSort('products')}>{sort === 'products' ? <Check className="size-3.5 text-primary" /> : <PackageOpen className="size-3.5" />} Mais produtos</button>
                  <button type="button" onClick={() => setSort('name')}>{sort === 'name' ? <Check className="size-3.5 text-primary" /> : <ArrowUpDown className="size-3.5" />} Nome (A-Z)</button>
                </div>
              </details>
            </div>
          </div>
        </div>

        <CatalogBatchDialog hideTrigger openRequest={batchRequest} advertiserId={advertiserId} advertiserCurrency={advertiserCurrency} onCreated={onChanged} onLocalWorkStateChange={onLocalWorkStateChange} />

        {showMagicImport && (
          <CatalogProductImport
            key={advertiserId}
            advertiserId={advertiserId}
            countries={countries.map(item => ({ code: item.code, name: item.name || item.code }))}
            onBusyChange={setMagicBusy}
            onClose={() => setShowMagicImport(false)}
            onCreated={catalog => { setShowMagicImport(false); onChanged(); onOpen(catalog.id) }}
          />
        )}

        {creating && (
          <div className="border-b border-border/70 bg-secondary/15 p-4 animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="flex max-w-xl flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground">Novo catálogo manual</span>
                <button type="button" disabled={busy} aria-label="Fechar criação de catálogo" onClick={() => setCreating(false)} className="p-1 text-xs text-muted-foreground hover:text-foreground">
                  <X className="size-3.5" />
                </button>
              </div>
              <label className="flex flex-col gap-1.5 text-xs">
                <span className="font-medium text-muted-foreground">Nome do catálogo</span>
                <input
                  autoFocus
                  className="input-base text-sm"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Ex.: Loja Verão 2026"
                  maxLength={200}
                  onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) void handleCreate() }}
                />
              </label>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <label className="flex flex-col gap-1"><span className="font-medium text-muted-foreground">Moeda</span><select className="input-base text-xs" value={currency} onChange={(event) => setCurrency(event.target.value)}>{CURRENCIES.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
                <label className="flex flex-col gap-1"><span className="font-medium text-muted-foreground">País de destino</span><select className="input-base text-xs" value={country} onChange={(event) => setCountry(event.target.value)}>{countries.map(item => <option key={item.code} value={item.code}>{item.name || item.code}</option>)}</select></label>
              </div>
              <div className="mt-1 flex items-center justify-end gap-2">
                <button type="button" className="btn-ghost text-xs" onClick={() => setCreating(false)} disabled={busy}>Cancelar</button>
                <button type="button" className="btn-primary min-h-10 px-4 text-sm font-semibold" onClick={() => void handleCreate()} disabled={busy || !name.trim()}>
                  {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} Criar catálogo
                </button>
              </div>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground"><Loader2 className="size-6 animate-spin text-primary" /><span className="text-xs font-medium">Carregando catálogos...</span></div>
        ) : catalogs.length === 0 && !creating ? (
          <div className="flex flex-col items-center gap-3 p-10 text-center">
            <div className="rounded-full bg-secondary/70 p-3 text-muted-foreground/60"><PackageOpen className="size-7" /></div>
            <div className="max-w-md"><p className="text-sm font-semibold text-foreground">Nenhum catálogo criado ainda</p><p className="mt-1 text-xs text-muted-foreground">Cole o link de um produto e deixe o ROINADOS preparar o catálogo automaticamente.</p></div>
            <button type="button" className="btn-primary mt-1 px-4 py-2 text-xs font-semibold" onClick={() => setShowMagicImport(true)}><Sparkles className="mr-1.5 size-3.5" /> Criar pelo link</button>
          </div>
        ) : filteredCatalogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <SearchCheck className="size-8 text-muted-foreground/40" />
            <div className="max-w-sm"><p className="text-sm font-semibold text-foreground">Nenhum catálogo encontrado</p><p className="mt-1 text-xs text-muted-foreground">Ajuste a busca ou limpe o filtro atual.</p></div>
            <button type="button" onClick={() => { setSearch(''); setStatusFilter('') }} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-border bg-secondary/60 px-3 text-xs font-medium text-foreground"><RotateCcw className="size-3.5" /> Limpar filtros</button>
          </div>
        ) : (
          <>
            <div className="campaign-table-container hidden overflow-x-auto md:block">
              <table className="w-full border-collapse text-left text-xs" style={{ minWidth: '720px' }}>
                <thead className="border-b border-border/60 bg-secondary/25 text-muted-foreground">
                  <tr>
                    <th className="min-w-[280px] px-4 py-2.5 text-xs font-semibold">Catálogo</th>
                    <th className="w-[130px] px-4 py-2.5 text-xs font-semibold">Produtos</th>
                    <th className="w-[190px] px-4 py-2.5 text-xs font-semibold">Status</th>
                    <th className="w-[160px] px-4 py-2.5 text-xs font-semibold">Atualização</th>
                    <th className="w-12 px-4 py-2.5"><span className="sr-only">Ações</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/35">
                  {filteredCatalogs.map((c) => {
                    const displayCount = catalogProductCount(c).count
                    return (
                      <tr key={c.id} onClick={() => onOpen(c.id)} className="group cursor-pointer transition-colors hover:bg-secondary/25">
                        <td className="px-4 py-3 align-middle">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-foreground transition-colors group-hover:text-primary" title={c.name}>{c.name}</p>
                            <p className="mt-0.5 truncate text-xs text-muted-foreground">
                              {c.currency} · {c.country || 'BR'}{c.tiktokCatalogId ? ` · TikTok ${c.tiktokCatalogId}` : ''}
                            </p>
                          </div>
                        </td>
                        <td className="px-4 py-3 align-middle font-medium tabular-nums text-foreground">{displayCount} {displayCount === 1 ? 'produto' : 'produtos'}</td>
                        <td className="px-4 py-3 align-middle text-xs">{renderStatus(c)}</td>
                        <td className="px-4 py-3 align-middle text-xs text-muted-foreground">{formatTimestamp(c.syncedAt || c.updatedAt || c.createdAt)}</td>
                        <td className="px-4 py-3 text-right align-middle">{catalogActions(c)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-1 gap-2 p-3 md:hidden">
              {filteredCatalogs.map((c) => {
                const displayCount = catalogProductCount(c).count
                return (
                  <div key={c.id} onClick={() => onOpen(c.id)} className="group cursor-pointer rounded-xl border border-border/65 bg-card/45 p-3 transition-colors hover:border-primary/35 hover:bg-card/70">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-foreground" title={c.name}>{c.name}</p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">{c.currency} · {c.country || 'BR'}{c.tiktokCatalogId ? ` · TikTok ${c.tiktokCatalogId}` : ''}</p>
                      </div>
                      {catalogActions(c)}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border/40 pt-2.5 text-xs">
                      <span className="font-medium text-foreground">{displayCount} {displayCount === 1 ? 'produto' : 'produtos'}</span>
                      <span>{renderStatus(c)}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </section>

      <ConfirmDialog
        open={Boolean(cloneTarget)}
        appearance="quiet"
        title="Clonar este catálogo?"
        description={<>Será criada uma cópia independente de <strong className="text-foreground">{cloneTarget?.name}</strong> com os mesmos produtos. Se a conexão com o TikTok estiver pronta, a sincronização do novo catálogo poderá começar automaticamente.</>}
        confirmLabel="Clonar catálogo"
        busy={Boolean(cloningId)}
        onConfirm={() => { if (cloneTarget) return handleCloneFromList(cloneTarget.id) }}
        onClose={() => { if (!cloningId) setCloneTarget(null) }}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Excluir catálogo local?"
        description={<>O catálogo <strong className="text-foreground">{deleteTarget?.name}</strong>, seus produtos e o histórico local serão removidos. O catálogo remoto no TikTok não será apagado.</>}
        confirmLabel="Excluir catálogo"
        confirmText={deleteTarget?.name}
        appearance="quiet"
        busy={deleting}
        onConfirm={handleDeleteFromList}
        onClose={() => { if (!deleting) setDeleteTarget(null) }}
      />
    </>
  )
}

// ── Business Center (obrigatório para publicar no TikTok) ──────────────────
// A dashboard descobre o BC pelas identidades BC_AUTH_TT. Digitar o ID fica
// restrito à recuperação avançada quando o TikTok não devolve nenhuma opção.
export function BusinessCenterBar({
  advertiserId,
  bcId,
  fromEnv,
  autoDetected,
  discoveryError,
  candidates,
  loading,
  onChanged,
}: {
  advertiserId: string
  bcId: string
  fromEnv: boolean
  autoDetected: boolean
  discoveryError: boolean
  candidates: { id: string; identityCount: number; label?: string }[]
  loading: boolean
  onChanged: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(bcId)
  const [busy, setBusy] = useState(false)
  const configured = Boolean(bcId)

  async function save(selectedId = value.trim()) {
    setBusy(true)
    try {
      await apiSend(adsCatalogApiUrl('/api/ads/catalogs/business-center', advertiserId), 'POST', { bcId: selectedId })
      toast.success('Business Center salvo')
      setEditing(false)
      onChanged()
    } catch (e) {
      toast.error('Falha ao salvar', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setBusy(false)
    }
  }

  if (!editing) {
    if (configured) {
      return (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-border/60 bg-card/40 px-3.5 py-2 text-xs">
          <div className="flex items-center gap-2 min-w-0">
            <span className="size-2 rounded-full bg-success shrink-0" />
            <span className="font-semibold text-foreground">Business Center</span>
            <span className="text-xs text-muted-foreground truncate hidden sm:inline">{autoDetected ? 'Detectado automaticamente' : fromEnv ? 'Configurado para a conta' : `ID ${bcId}`}</span>
          </div>
          <button
            type="button"
            className="btn-ghost min-h-10 px-3 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => { setValue(bcId); setEditing(true) }}
            title="Alterar Business Center"
          >
            <Pencil className="size-3 mr-1" aria-hidden="true" /> Alterar
          </button>
        </div>
      )
    }
    if (loading) {
      return (
        <div className="flex items-center gap-2 rounded-xl border border-border/50 bg-card/30 px-3.5 py-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin text-primary" aria-hidden="true" /> Conectando ao TikTok...
        </div>
      )
    }
    if (candidates.length > 1) {
      return (
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="text-xs font-semibold text-foreground">Escolha o Business Center usado pelos catálogos</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {candidates.map((candidate) => (
              <button key={candidate.id} type="button" className="btn-secondary min-h-10 px-3 text-xs" onClick={() => save(candidate.id)} disabled={busy}>
                <Building2 className="size-3.5 mr-1" aria-hidden="true" /> {candidate.label || candidate.id}
              </button>
            ))}
          </div>
        </div>
      )
    }
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-warning/30 bg-warning/5 px-3.5 py-2 text-xs">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Building2 className="size-3.5 text-warning shrink-0" aria-hidden="true" />
          <span>{discoveryError ? 'Falha ao detectar o Business Center.' : 'Business Center não detectado.'}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" className="btn-ghost min-h-10 px-3 text-xs" onClick={onChanged}>
            <RefreshCw className="size-3 mr-1" aria-hidden="true" /> Repetir
          </button>
          <button type="button" className="btn-secondary min-h-10 px-3 text-xs" onClick={() => { setValue(''); setEditing(true) }}>
            Informar ID
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-2.5">
      <input
        autoFocus
        className="input-base min-h-10 flex-1 text-sm"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="ID do Business Center"
        inputMode="numeric"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) save()
        }}
      />
      <button type="button" className="btn-ghost min-h-10 px-3 text-sm" onClick={() => setEditing(false)} disabled={busy}>
        Cancelar
      </button>
      <button type="button" className="btn-primary min-h-10 px-3 text-sm" onClick={() => save()} disabled={busy}>
        {busy ? <Loader2 className="size-3.5 animate-spin mr-1" /> : <Check className="size-3.5 mr-1" />}
        Salvar
      </button>
    </div>
  )
}
