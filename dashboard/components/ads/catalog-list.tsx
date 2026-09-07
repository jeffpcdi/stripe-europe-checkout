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
    if (catalog.productCount === 0) {
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
// ── Tela 1: lista + criação ──────────────────────────────────────────────
export function CatalogList({
  catalogs,
  advertiserId,
  advertiserCurrency,
  spec,
  loading,
  onOpen,
  onChanged,
}: {
  catalogs: AdsCatalog[]
  advertiserId: string
  advertiserCurrency: string
  spec: CatalogSpec | null
  loading: boolean
  onOpen: (id: string) => void
  onChanged: () => void
}) {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState('BRL')
  const catalogType = 'ECOM'
  const [country, setCountry] = useState('BR')
  const [busy, setBusy] = useState(false)
  const [cloningId, setCloningId] = useState<string | null>(null)
  const countries = spec?.countries ?? [{ code: 'BR', name: 'Brasil' }]

  async function handleCreate() {
    if (!name.trim()) return
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

  const [magicUrl, setMagicUrl] = useState('')
  const [magicBusy, setMagicBusy] = useState(false)

  async function handleMagicImport() {
    if (!magicUrl.trim() || magicBusy) return
    setMagicBusy(true)
    try {
      const res = await apiSend<{ catalog: AdsCatalog; syncStarted: boolean }>(
        adsCatalogApiUrl('/api/ads/catalogs/magic-import', advertiserId), 'POST', { url: magicUrl.trim() }
      )
      toast.success('Catálogo criado', {
        hint: res.syncStarted ? 'A sincronização com o TikTok já começou.' : 'O produto foi extraído e o catálogo criado.',
      })
      setMagicUrl('')
      onChanged()
      onOpen(res.catalog.id)
    } catch (e) {
      toast.error('Não foi possível importar', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setMagicBusy(false)
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

  return (
    <div className="flex flex-col gap-4">
      {/* Header com Ações Rápidas */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-bold text-foreground">Catálogos</h2>
          <p className="text-xs text-muted-foreground">Seus produtos para anunciar no TikTok.</p>
        </div>

        {!creating && (
          <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
            <CatalogBatchDialog advertiserId={advertiserId} advertiserCurrency={advertiserCurrency} onCreated={onChanged} />
            <button type="button" className="btn-primary shrink-0 text-xs font-semibold px-3.5 py-1.5 shadow-xs" onClick={() => setCreating(true)}>
              <Plus className="size-3.5" aria-hidden="true" />
              Novo catálogo
            </button>
          </div>
        )}
      </div>

      {/* Caixa de Importação Mágica Expressa */}
      {!creating && (
        <div className="rounded-xl border border-border bg-card p-3 sm:p-4 shadow-xs">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <Sparkles className="size-3.5 text-primary" aria-hidden="true" />
              <span>Importar pelo link do produto</span>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                type="url"
                className="input-base flex-1 text-xs"
                placeholder="Cole o link do produto ou loja (ex: Shopify, Yampi, WooCommerce)..."
                value={magicUrl}
                onChange={(e) => setMagicUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleMagicImport()
                }}
                disabled={magicBusy}
              />
              <button
                type="button"
                className="btn-primary shrink-0 text-xs font-semibold px-4 py-2 bg-gradient-to-r from-indigo-500 to-purple-600 border-none text-white hover:opacity-90 shadow-xs"
                onClick={handleMagicImport}
                disabled={magicBusy || !magicUrl.trim()}
              >
                {magicBusy ? <Loader2 className="size-3.5 animate-spin mr-1.5" aria-hidden="true" /> : <Sparkles className="size-3.5 mr-1.5" aria-hidden="true" />}
                Extrair e Criar
              </button>
            </div>
          </div>
        </div>
      )}

      {creating && (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
          <label className="flex flex-col gap-1.5 text-xs">
            <span className="font-semibold text-foreground">Nome do catálogo</span>
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
          <div className="flex items-center justify-end gap-2 mt-2">
            <button type="button" className="btn-ghost text-xs" onClick={() => setCreating(false)} disabled={busy}>
              Cancelar
            </button>
            <button type="button" className="btn-primary text-xs font-semibold px-4 py-1.5" onClick={handleCreate} disabled={busy || !name.trim()}>
              {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Plus className="size-3.5" aria-hidden="true" />}
              Criar Catálogo
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" aria-hidden="true" />
        </div>
      ) : catalogs.length === 0 && !creating ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-card/50 p-8 text-center">
          <PackageOpen className="size-7 text-muted-foreground/60" aria-hidden="true" />
          <p className="text-sm font-semibold text-foreground">Nenhum catálogo criado ainda</p>
          <p className="text-xs text-muted-foreground max-w-sm">
            Cole o link do seu produto acima para criar automaticamente ou clique em "Novo catálogo".
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {catalogs.map((c) => {
            const status = catalogStatusMeta(c)
            const remoteCount = Math.max(0, Number(c.audit?.total) || 0)
            const displayCount = remoteCount > 0 ? remoteCount : c.productCount
            const isCloning = cloningId === c.id
            return <li key={c.id}>
              <div className="flex w-full items-center gap-2 rounded-xl border border-border bg-card transition-all hover:border-primary/50 hover:shadow-xs">
                <button
                  type="button"
                  onClick={() => onOpen(c.id)}
                  className="flex min-w-0 flex-1 items-center justify-between gap-3 px-4 py-3.5 text-left"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-foreground">{c.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {displayCount} produto{displayCount === 1 ? '' : 's'}{remoteCount > 0 ? ' no TikTok' : ''} · {c.currency}
                      {c.country ? ` · ${c.country}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${status.className}`}>
                      {status.label}
                    </span>
                    <span className="text-xs font-medium text-primary flex items-center gap-1 hover:underline">
                      Gerenciar →
                    </span>
                  </div>
                </button>
                <div className="flex items-center pr-3 shrink-0">
                  <button
                    type="button"
                    title="Clonar catálogo"
                    className="btn-ghost p-1.5 text-muted-foreground hover:text-foreground"
                    disabled={isCloning}
                    onClick={(e) => { e.stopPropagation(); handleCloneFromList(c.id) }}
                  >
                    {isCloning
                      ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                      : <CopyPlus className="size-3.5" aria-hidden="true" />}
                  </button>
                </div>
              </div>
            </li>
          })}
        </ul>
      )}
    </div>
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
        <details className="group rounded-xl border border-border bg-background px-3 py-2">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-2"><Check className="size-3.5 text-success" aria-hidden="true" /> Conexão TikTok pronta</span>
            <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
          </summary>
          <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-2">
            <code className="truncate text-[11px] text-muted-foreground">Business Center {bcId}{fromEnv ? ' · servidor' : autoDetected ? ' · detectado automaticamente' : ''}</code>
            <button type="button" className="btn-ghost text-xs" onClick={() => { setValue(bcId); setEditing(true) }}>
              <Pencil className="size-3.5" aria-hidden="true" /> Alterar
            </button>
          </div>
        </details>
      )
    }
    if (loading) {
      return (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-background p-3 text-xs text-muted-foreground">
          <Loader2 className="size-4 animate-spin text-primary" aria-hidden="true" /> Detectando a conexão TikTok
        </div>
      )
    }
    if (candidates.length > 1) {
      return (
        <div className="rounded-xl border border-border bg-background p-3">
          <p className="text-xs font-medium text-foreground">Escolha a organização deste catálogo</p>
          <p className="mt-1 text-[11px] text-muted-foreground">O TikTok devolveu mais de um organização autorizada para esta conta.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {candidates.map((candidate) => (
              <button key={candidate.id} type="button" className="btn-ghost text-xs" onClick={() => save(candidate.id)} disabled={busy}>
                <Building2 className="size-3.5" aria-hidden="true" /> {candidate.label || candidate.id}
              </button>
            ))}
          </div>
        </div>
      )
    }
    return (
      <div className="rounded-xl border border-warning/30 bg-warning/5 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2 text-xs">
            <Building2 className="size-4 text-warning" aria-hidden="true" />
            <span className="text-pretty text-muted-foreground">{discoveryError ? 'Não foi possível detectar a organização agora.' : 'Nenhuma organização autorizada foi encontrada nesta conta.'}</span>
          </div>
          <button type="button" className="btn-ghost text-xs" onClick={onChanged}>
            <RefreshCw className="size-3.5" aria-hidden="true" /> Tentar novamente
          </button>
        </div>
        <details className="mt-2 border-t border-warning/20 pt-2">
          <summary className="cursor-pointer text-[10px] font-medium text-muted-foreground">Detalhes da conexão</summary>
          <button type="button" className="btn-ghost mt-2 text-xs" onClick={() => { setValue(''); setEditing(true) }}>
            Informar ID do Business Center
          </button>
        </details>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-background p-3">
      <label className="flex flex-col gap-1 text-xs">
        <span className="font-medium text-foreground">ID do Business Center</span>
        <input
          autoFocus
          className="input-base"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Ex.: 7012345678901234567"
          inputMode="numeric"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) save()
          }}
        />
      </label>
      <p className="text-pretty text-[11px] leading-relaxed text-muted-foreground">
        Use somente se a detecção automática não encontrar a organização correta. O ID deve pertencer ao mesmo
        Business Center que autorizou a identidade e o catálogo desta conta de anúncios.
      </p>
      <div className="flex items-center justify-end gap-2">
        <button type="button" className="btn-ghost text-xs" onClick={() => setEditing(false)} disabled={busy}>
          Cancelar
        </button>
        <button type="button" className="btn-primary text-xs" onClick={() => save()} disabled={busy}>
          {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Check className="size-3.5" aria-hidden="true" />}
          Salvar
        </button>
      </div>
    </div>
  )
}
