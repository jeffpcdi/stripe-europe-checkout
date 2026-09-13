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
  Link2, ChevronDown, History, CopyPlus, SearchCheck, RotateCcw, Sparkles,
  LayoutList, LayoutGrid, Search, ArrowUpDown,
} from 'lucide-react'
import { GlassCard } from '@/components/glass-card'
import {
  useAdsCatalogs, useAdsCatalogDetail, useAdsCatalogSpec, useAdsCatalogBusinessCenter,
  useAdsCatalogPublications, useAdsCatalogReadiness, useAdsCatalogCapabilities, adsCatalogImportCsv,
  adsCatalogApiUrl, apiSend, ApiError,
} from '@/lib/api'
import { catalogProductCount } from '@/lib/catalog-display'
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
}) {
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table')
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
  const countries = spec?.countries ?? [{ code: 'BR', name: 'Brasil' }]

  const [showMagicImport, setShowMagicImport] = useState(false)
  const [magicBusy, setMagicBusy] = useState(false)

  // Persistência da preferência de visualização
  useEffect(() => {
    try {
      const saved = localStorage.getItem('roi:catalogs:viewMode')
      if (saved === 'table' || saved === 'cards') {
        setViewMode(saved)
      } else if (typeof window !== 'undefined' && window.innerWidth < 768) {
        setViewMode('cards')
      }
    } catch {}
  }, [])

  const [batchRequest, setBatchRequest] = useState(0)
  useEffect(() => {
    if (!request || busy || magicBusy) return
    setCreating(request.action === 'create')
    setShowMagicImport(request.action === 'magic')
    if (request.action === 'batch') setBatchRequest(value => value + 1)
    onRequestHandled?.()
  }, [request, busy, magicBusy, onRequestHandled])

  const handleViewModeChange = (mode: 'table' | 'cards') => {
    setViewMode(mode)
    try {
      localStorage.setItem('roi:catalogs:viewMode', mode)
    } catch {}
  }

  async function handleCreate() {
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      const res = await apiSend<{ catalog: AdsCatalog }>(adsCatalogApiUrl('/api/ads/catalogs', advertiserId), 'POST', {
        name: name.trim(),
        currency,
        catalogType,
        country,
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

  async function handleCloneFromList(catalogId: string) {
    if (cloningId) return
    setCloningId(catalogId)
    try {
      const res = await apiSend<{ catalog: AdsCatalog; productCount: number; syncStarted: boolean }>(
        adsCatalogApiUrl(`/api/ads/catalogs/${encodeURIComponent(catalogId)}/clone`, advertiserId), 'POST', {},
      )
      if (res.syncStarted) {
        toast.success(`Catálogo clonado com ${res.productCount} produto(s) — publicação iniciada`)
      } else {
        toast.success(`Catálogo clonado com ${res.productCount} produto(s)`)
      }
      onChanged()
      onOpen(res.catalog.id)
    } catch (e) {
      toast.error('Falha ao clonar', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setCloningId(null)
    }
  }

  // Contagem em tempo real de catálogos por categoria de status
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {
      all: catalogs.length,
      linked: 0,
      in_review: 0,
      needs_attention: 0,
      draft: 0,
    }
    for (const c of catalogs) {
      const cat = getCatalogCategory(c)
      counts[cat] = (counts[cat] || 0) + 1
    }
    return counts
  }, [catalogs])

  // Filtros de busca, categoria e ordenação
  const filteredCatalogs = useMemo(() => {
    return catalogs
      .filter((c) => {
        if (statusFilter) {
          if (getCatalogCategory(c) !== statusFilter) return false
        }
        if (search.trim()) {
          const q = search.toLowerCase().trim()
          const matchName = (c.name || '').toLowerCase().includes(q)
          const matchTtId = (c.tiktokCatalogId || '').toLowerCase().includes(q)
          const matchId = (c.id || '').toLowerCase().includes(q)
          const matchCountry = (c.country || '').toLowerCase().includes(q)
          const matchCurrency = (c.currency || '').toLowerCase().includes(q)
          if (!matchName && !matchTtId && !matchId && !matchCountry && !matchCurrency) {
            return false
          }
        }
        return true
      })
      .sort((a, b) => {
        if (sort === 'products') {
          const countA = catalogProductCount(a).count
          const countB = catalogProductCount(b).count
          return countB - countA
        }
        if (sort === 'name') {
          return a.name.localeCompare(b.name, 'pt-BR')
        }
        const dateA = new Date(a.createdAt || a.updatedAt || 0).getTime()
        const dateB = new Date(b.createdAt || b.updatedAt || 0).getTime()
        return dateB - dateA
      })
  }, [catalogs, statusFilter, search, sort])

  return (
    <GlassCard className="campaign-workspace min-w-0 overflow-hidden p-0">
      {/* 1. Toolbar Unificada */}
      <div className="campaign-toolbar">
        <div className="campaign-toolbar-title flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-foreground">Catálogos</h2>
            <span className="rounded-full bg-secondary/80 border border-border/50 px-2 py-0.5 text-xs font-medium text-muted-foreground tabular-nums">
              {filteredCatalogs.length}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="flex items-center rounded-lg border border-border/60 bg-secondary/40 p-0.5" role="group" aria-label="Modo de visualização">
              <button
                type="button"
                onClick={() => handleViewModeChange('table')}
                aria-pressed={viewMode === 'table'}
                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-all cursor-pointer ${
                  viewMode === 'table'
                    ? 'bg-background text-foreground shadow-xs font-semibold'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                title="Tabela"
              >
                <LayoutList className="size-3.5" />
                <span className="hidden sm:inline">Tabela</span>
              </button>
              <button
                type="button"
                onClick={() => handleViewModeChange('cards')}
                aria-pressed={viewMode === 'cards'}
                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-all cursor-pointer ${
                  viewMode === 'cards'
                    ? 'bg-background text-foreground shadow-xs font-semibold'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                title="Cards"
              >
                <LayoutGrid className="size-3.5" />
                <span className="hidden sm:inline">Cards</span>
              </button>
            </div>
          </div>
        </div>

        {/* Status Filters */}
        <div className="campaign-status-filters" role="group" aria-label="Filtrar por status">
          {STATUS_FILTERS.map((filter) => {
            const count = filter.value === '' ? statusCounts.all : (statusCounts[filter.value] ?? 0)
            const isSelected = statusFilter === filter.value
            return (
              <button
                key={filter.value}
                type="button"
                onClick={() => setStatusFilter(filter.value)}
                aria-pressed={isSelected}
                className="inline-flex items-center gap-1.5 cursor-pointer"
              >
                <span>{filter.label}</span>
                <span
                  className={`inline-flex items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums transition-colors ${
                    isSelected ? 'bg-primary/20 text-primary' : 'bg-secondary text-muted-foreground'
                  }`}
                >
                  {count}
                </span>
              </button>
            )
          })}
        </div>

        {/* Search & Actions Row */}
        <div className="campaign-search-row flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="campaign-search flex-1">
            <Search size={15} className="text-muted-foreground shrink-0" aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar catálogo..."
              aria-label="Buscar catálogo"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="text-muted-foreground hover:text-foreground p-1 cursor-pointer"
                title="Limpar busca"
              >
                <X size={14} />
              </button>
            )}
          </label>

          <div className="flex flex-wrap items-center gap-1.5 self-start sm:self-auto shrink-0">
            {/* Sort Dropdown */}
            <div className="flex items-center gap-1 rounded-lg border border-border/80 bg-background px-2 py-1.5 text-xs text-muted-foreground">
              <ArrowUpDown className="size-3.5 text-muted-foreground" />
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as 'newest' | 'products' | 'name')}
                className="bg-transparent text-foreground text-xs font-medium outline-none cursor-pointer"
                aria-label="Ordenar"
              >
                <option value="newest">Recentes</option>
                <option value="products">Mais produtos</option>
                <option value="name">Nome (A-Z)</option>
              </select>
            </div>

            {/* Quick Action: Import Link */}
            <button
              type="button"
              onClick={() => {
                if (magicBusy) return
                setShowMagicImport(!showMagicImport)
                setCreating(false)
              }}
              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all cursor-pointer ${
                showMagicImport
                  ? 'border-primary/50 bg-primary/10 text-primary'
                  : 'border-border/80 bg-secondary/50 text-foreground hover:bg-secondary'
              }`}
              title="Importar link do produto"
            >
              <Sparkles className="size-3.5 text-primary" />
              <span>Importar link</span>
            </button>

            {/* Quick Action: Batch Dialog */}
            <CatalogBatchDialog openRequest={batchRequest} advertiserId={advertiserId} advertiserCurrency={advertiserCurrency} onCreated={onChanged} />

            {/* Quick Action: New Catalog */}
            <button
              type="button"
              className="btn-primary shrink-0 text-xs font-semibold px-3 py-1.5 shadow-xs cursor-pointer"
              onClick={() => {
                if (magicBusy) return
                setCreating(true)
                setShowMagicImport(false)
              }}
            >
              <Plus className="size-3.5 mr-1" aria-hidden="true" />
              Novo catálogo
            </button>
          </div>
        </div>
      </div>

      {showMagicImport && <CatalogProductImport key={advertiserId} advertiserId={advertiserId}
        countries={countries.map(item => ({ code: item.code, name: item.name || item.code }))}
        onBusyChange={setMagicBusy} onClose={() => setShowMagicImport(false)}
        onCreated={catalog => { setShowMagicImport(false); onChanged(); onOpen(catalog.id) }} />}

      {/* 3. Caixa Expansível de Criação Manual */}
      {creating && (
        <div className="border-b border-border/70 bg-secondary/20 p-4 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex flex-col gap-3 max-w-xl">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-foreground text-xs">Novo catálogo manual</span>
              <button
                type="button"
                disabled={busy}
                aria-label="Fechar criação de catálogo"
                onClick={() => setCreating(false)}
                className="text-muted-foreground hover:text-foreground text-xs p-1 cursor-pointer"
              >
                <X className="size-3.5" />
              </button>
            </div>
            <label className="flex flex-col gap-1.5 text-xs">
              <span className="text-muted-foreground font-medium">Nome do catálogo</span>
              <input
                autoFocus
                className="input-base text-sm"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex.: Loja Verão 2026"
                maxLength={200}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) handleCreate()
                }}
              />
            </label>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <label className="flex flex-col gap-1">
                <span className="text-muted-foreground font-medium">Moeda</span>
                <select
                  className="input-base text-xs"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                >
                  {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-muted-foreground font-medium">País de destino</span>
                <select
                  className="input-base text-xs"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                >
                  {countries.map((c) => <option key={c.code} value={c.code}>{c.name || c.code}</option>)}
                </select>
              </label>
            </div>
            <div className="flex items-center justify-end gap-2 mt-1">
              <button type="button" className="btn-ghost text-xs cursor-pointer" onClick={() => setCreating(false)} disabled={busy}>
                Cancelar
              </button>
              <button type="button" className="btn-primary text-xs font-semibold px-4 py-1.5 cursor-pointer" onClick={handleCreate} disabled={busy || !name.trim()}>
                {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Plus className="size-3.5" aria-hidden="true" />}
                Criar Catálogo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. Lista Principal (Tabela ou Cards) */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
          <Loader2 className="size-6 animate-spin text-primary" aria-hidden="true" />
          <span className="text-xs font-medium">Carregando catálogos...</span>
        </div>
      ) : catalogs.length === 0 && !creating ? (
        <div className="flex flex-col items-center gap-3 p-10 text-center">
          <div className="rounded-full bg-secondary/80 p-3 text-muted-foreground/60">
            <PackageOpen className="size-7" aria-hidden="true" />
          </div>
          <div className="max-w-md">
            <p className="text-sm font-semibold text-foreground">Nenhum catálogo criado ainda</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Cole o link de um produto para preparar o catálogo e vincular seus vídeos.
            </p>
          </div>
          <div className="flex items-center gap-2 mt-2">
            <button
              type="button"
              className="btn-primary text-xs font-semibold px-4 py-2 cursor-pointer"
              onClick={() => setShowMagicImport(true)}
            >
              <Sparkles className="size-3.5 mr-1.5" />
              Importar por link
            </button>
            <button
              type="button"
              className="btn-ghost text-xs font-medium px-4 py-2 border border-border/80 cursor-pointer"
              onClick={() => setCreating(true)}
            >
              <Plus className="size-3.5 mr-1.5" />
              Criar manual
            </button>
          </div>
        </div>
      ) : filteredCatalogs.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <SearchCheck className="size-8 text-muted-foreground/40" />
          <div className="max-w-sm">
            <p className="text-sm font-semibold text-foreground">Nenhum catálogo encontrado</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Não encontramos nenhum catálogo que corresponda aos filtros aplicados.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setSearch('')
              setStatusFilter('')
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-secondary/60 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary transition-colors cursor-pointer"
          >
            <RotateCcw className="size-3.5" />
            <span>Limpar filtros de busca</span>
          </button>
        </div>
      ) : viewMode === 'table' ? (
        /* MODO TABELA: ALTA DENSIDADE */
        <div className="campaign-table-container overflow-x-auto" style={{ overflowX: 'auto' }}>
          <table className="w-full text-left text-xs border-collapse" style={{ minWidth: '840px' }}>
            <thead className="bg-secondary/40 text-muted-foreground border-b border-border/70 sticky top-0 z-10 select-none backdrop-blur-xs">
              <tr>
                <th className="px-4 py-2.5 font-semibold text-[11px] uppercase tracking-wider w-[130px]">Status</th>
                <th className="px-4 py-2.5 font-semibold text-[11px] uppercase tracking-wider min-w-[240px]">Catálogo</th>
                <th className="px-4 py-2.5 font-semibold text-[11px] uppercase tracking-wider min-w-[200px]">Produtos</th>
                <th className="px-4 py-2.5 font-semibold text-[11px] uppercase tracking-wider w-[130px]">Mercado</th>
                <th className="px-4 py-2.5 font-semibold text-[11px] uppercase tracking-wider w-[160px]">Sincronização</th>
                <th className="px-4 py-2.5 font-semibold text-[11px] uppercase tracking-wider text-right w-[120px]">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {filteredCatalogs.map((c) => {
                const status = catalogStatusMeta(c)
                const remoteCount = Math.max(0, Number(c.audit?.total) || 0)
                const productSummary = catalogProductCount(c)
                const displayCount = productSummary.count
                const isCloning = cloningId === c.id

                return (
                  <tr
                    key={c.id}
                    onClick={() => onOpen(c.id)}
                    className="hover:bg-secondary/30 transition-colors cursor-pointer group"
                  >
                    {/* 1. Status */}
                    <td className="px-4 py-3 align-middle whitespace-nowrap">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${status.className}`}>
                        {status.label}
                      </span>
                    </td>

                    {/* 2. Catálogo & Identificadores */}
                    <td className="px-4 py-3 align-middle">
                      <div className="flex flex-col min-w-0">
                        <span className="font-bold text-foreground text-sm truncate group-hover:text-primary transition-colors" title={c.name}>
                          {c.name}
                        </span>
                        <div className="flex flex-wrap items-center gap-1.5 mt-0.5 text-[11px] text-muted-foreground">
                          {c.tiktokCatalogId ? (
                            <span className="inline-flex items-center gap-1 font-mono text-[11px] text-foreground bg-secondary/80 px-1.5 py-0.5 rounded border border-border/50">
                              <span className="text-muted-foreground">TT:</span> {c.tiktokCatalogId}
                            </span>
                          ) : (
                            <span className="text-[11px] text-warning font-medium">Sem ID TikTok</span>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* 3. Produtos & Auditoria */}
                    <td className="px-4 py-3 align-middle">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-semibold text-foreground tabular-nums">
                          {displayCount} {displayCount === 1 ? 'produto' : 'produtos'}
                        </span>
                        {c.audit && (
                          <div className="flex items-center gap-1 text-[11px] tabular-nums">
                            {Number(c.audit.approved) > 0 && (
                              <span className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 font-medium bg-success/15 text-success">
                                <Check className="size-2.5" /> {c.audit.approved}
                              </span>
                            )}
                            {Number(c.audit.rejected) > 0 && (
                              <span className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 font-medium bg-error/15 text-error">
                                <AlertCircle className="size-2.5" /> {c.audit.rejected}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </td>

                    {/* 4. Mercado */}
                    <td className="px-4 py-3 align-middle whitespace-nowrap">
                      <span className="font-semibold text-foreground text-xs">{c.currency}</span>
                      <span className="text-muted-foreground text-xs ml-1.5">· {c.country || 'BR'}</span>
                    </td>

                    {/* 5. Sincronização */}
                    <td className="px-4 py-3 align-middle whitespace-nowrap text-xs">
                      {c.syncedAt ? (
                        <span className="inline-flex items-center gap-1 text-success font-medium">
                          <Check className="size-3" /> {formatTimestamp(c.syncedAt)}
                        </span>
                      ) : c.feedUrl ? (
                        <span className="inline-flex items-center gap-1 text-primary font-medium">
                          <UploadCloud className="size-3" /> Pronto
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Pendente</span>
                      )}
                    </td>

                    {/* 6. Ações */}
                    <td className="px-4 py-3 align-middle text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            onOpen(c.id)
                          }}
                          className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold bg-primary/10 text-primary hover:bg-primary/20 transition-colors cursor-pointer"
                        >
                          Gerenciar <span aria-hidden="true">→</span>
                        </button>
                        <button
                          type="button"
                          title="Clonar catálogo"
                          aria-label={`Clonar ${c.name}`}
                          disabled={Boolean(cloningId)}
                          onClick={(e) => {
                            e.stopPropagation()
                            handleCloneFromList(c.id)
                          }}
                          className="btn-ghost p-1 text-muted-foreground hover:text-foreground cursor-pointer rounded-md"
                        >
                          {isCloning ? <Loader2 className="size-3.5 animate-spin" /> : <CopyPlus className="size-3.5" />}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        /* MODO CARDS */
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5 p-4">
          {filteredCatalogs.map((c) => {
            const status = catalogStatusMeta(c)
            const remoteCount = Math.max(0, Number(c.audit?.total) || 0)
            const productSummary = catalogProductCount(c)
                const displayCount = productSummary.count
            const isCloning = cloningId === c.id

            return (
              <div
                key={c.id}
                className="flex flex-col justify-between rounded-xl border border-border/80 bg-card/60 p-4 transition-all hover:border-primary/50 hover:bg-card/90 hover:shadow-xs group"
              >
                <div>
                  {/* Card Top: Status & Badges */}
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${status.className}`}>
                      {status.label}
                    </span>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground font-semibold">
                      <span className="text-foreground">{c.currency}</span>
                      <span>·</span>
                      <span>{c.country || 'BR'}</span>
                    </div>
                  </div>

                  {/* Title & TikTok ID */}
                  <h3 className="font-bold text-foreground text-sm truncate group-hover:text-primary transition-colors" title={c.name}>
                    {c.name}
                  </h3>
                  {c.tiktokCatalogId ? (
                    <div className="mt-1">
                      <span className="font-mono text-[11px] text-muted-foreground bg-secondary/80 px-1.5 py-0.5 rounded border border-border/40">
                        TT: {c.tiktokCatalogId}
                      </span>
                    </div>
                  ) : null}

                  {/* Product Summary */}
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs border-t border-border/40 pt-2.5">
                    <span className="font-semibold text-foreground tabular-nums">
                      {displayCount} {displayCount === 1 ? 'produto' : 'produtos'}
                    </span>
                    {c.audit && (
                      <>
                        {Number(c.audit.approved) > 0 && (
                          <span className="text-success font-medium tabular-nums">
                            · {c.audit.approved} no TikTok
                          </span>
                        )}
                        {Number(c.audit.rejected) > 0 && (
                          <span className="text-error font-medium tabular-nums">
                            · {c.audit.rejected} com erro
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {/* Footer Actions */}
                <div className="mt-3.5 flex items-center justify-between border-t border-border/50 pt-2.5">
                  <span className="text-[11px] text-muted-foreground">
                    {c.syncedAt ? `Sincronizado ${formatTimestamp(c.syncedAt)}` : 'Aguardando envio'}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      title="Clonar catálogo"
                      aria-label={`Clonar ${c.name}`}
                      disabled={Boolean(cloningId)}
                      onClick={(e) => {
                        e.stopPropagation()
                        handleCloneFromList(c.id)
                      }}
                      className="btn-ghost p-1 text-muted-foreground hover:text-foreground"
                    >
                      {isCloning ? <Loader2 className="size-3.5 animate-spin" /> : <CopyPlus className="size-3.5" />}
                    </button>
                    <span className="text-xs font-semibold text-primary flex items-center gap-0.5">
                      Gerenciar <span aria-hidden="true">→</span>
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </GlassCard>
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
      toast.success('Conexão TikTok pronta')
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
            <span className="font-semibold text-foreground">TikTok conectado</span>
            <span className="font-mono text-[11px] text-muted-foreground truncate hidden sm:inline">BC: {bcId}</span>
          </div>
          <button
            type="button"
            className="btn-ghost py-1 px-2 text-xs text-muted-foreground hover:text-foreground h-auto"
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
          <p className="text-xs font-semibold text-foreground">Selecione a organização TikTok</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {candidates.map((candidate) => (
              <button key={candidate.id} type="button" className="btn-secondary text-xs py-1 px-2.5" onClick={() => save(candidate.id)} disabled={busy}>
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
          <span>{discoveryError ? 'Falha ao detectar organização TikTok.' : 'Organização TikTok não detectada.'}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" className="btn-ghost py-1 px-2 text-xs h-auto" onClick={onChanged}>
            <RefreshCw className="size-3 mr-1" aria-hidden="true" /> Repetir
          </button>
          <button type="button" className="btn-secondary py-1 px-2 text-xs h-auto" onClick={() => { setValue(''); setEditing(true) }}>
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
        className="input-base text-xs flex-1"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="ID do Business Center (ex.: 7012345678901234567)"
        inputMode="numeric"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) save()
        }}
      />
      <button type="button" className="btn-ghost text-xs py-1.5 px-2.5 h-auto" onClick={() => setEditing(false)} disabled={busy}>
        Cancelar
      </button>
      <button type="button" className="btn-primary text-xs py-1.5 px-3 h-auto" onClick={() => save()} disabled={busy}>
        {busy ? <Loader2 className="size-3.5 animate-spin mr-1" /> : <Check className="size-3.5 mr-1" />}
        Salvar
      </button>
    </div>
  )
}
