'use client'

// Orquestrador visual do domínio de catálogos. As responsabilidades de conexão,
// prontidão e criação de campanha ficam em componentes próprios; esta tela
// concentra produtos, importação e histórico.

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  X, Loader2, Plus, Trash2, UploadCloud, Download, Rocket,
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

const CURRENCIES = ['USD', 'BRL', 'EUR', 'GBP', 'MXN', 'CAD', 'AUD', 'JPY']

// Colunas prioritárias mostradas na tabela compacta (o restante fica no editor
// lateral). São as que o TikTok exige + as de maior uso.
const PRIMARY_COLS = ['sku_id', 'title', 'availability', 'condition', 'price', 'image_link', 'link']

// Rótulos amigáveis em pt-BR para o editor (a chave crua do CSV vira só uma
// dica pequena). Mantém intuitivo para quem vende, sem esconder o nome técnico.
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
// Exemplos de preenchimento para os campos que mais confundem.
const FIELD_PLACEHOLDERS: Record<string, string> = {
  sku_id: 'Ex.: SKU-001',
  title: 'Ex.: Camiseta branca algodão',
  description: 'Descrição curta do produto',
  price: 'Ex.: 9.99 BRL',
  link: 'https://sualoja.com/produto',
  image_link: 'https://sualoja.com/foto.jpg (≥ 500×500)',
  sale_price: 'Ex.: 7.99 BRL',
}

type CatalogSpec = AdsCatalogSpecResponse

function catalogStatusMeta(catalog: AdsCatalog) {
  if (catalog.linkStatus === 'verified') {
    return { label: 'Conectado', summary: 'TikTok verificado', className: 'bg-success/15 text-success' }
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

export function CatalogManager({
  advertiserId,
  advertiserLabel,
}: {
  advertiserId: string
  advertiserLabel: string
}) {
  const { data: list, mutate: mutateList, isLoading: listLoading, error: listError } = useAdsCatalogs(true, advertiserId)
  const { data: spec } = useAdsCatalogSpec(true, advertiserId)
  const { data: bc, mutate: mutateBc } = useAdsCatalogBusinessCenter(true, advertiserId)
  const { data: capabilitiesData } = useAdsCatalogCapabilities(true, advertiserId)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Um catalogId só é válido dentro do advertiser que o criou. Ao trocar a
  // seleção global, voltamos à lista antes de qualquer request de detalhe.
  useEffect(() => setSelectedId(null), [advertiserId])

  const enabled = list?.enabled !== false

  if (!enabled) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-background p-8 text-center">
        <AlertCircle className="size-6 text-warning" aria-hidden="true" />
        <p className="text-sm font-medium text-foreground">Persistência indisponível</p>
        <p className="max-w-md text-pretty text-xs text-muted-foreground">
          O banco de dados (Neon) não está configurado, então catálogos não podem ser salvos. Conecte o
          Neon nas configurações do projeto para usar este recurso.
        </p>
      </div>
    )
  }

  if (listError) {
    return (
      <ErrorState
        title="Não foi possível carregar os catálogos"
        description="A seleção da conta foi preservada. Tente novamente sem criar ou apagar nada."
        onRetry={() => mutateList()}
      />
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {(!bc?.bcId || !selectedId) && (
        <BusinessCenterBar advertiserId={advertiserId} bcId={bc?.bcId ?? ''} fromEnv={Boolean(bc?.fromEnv)} onChanged={mutateBc} />
      )}
      {selectedId ? (
        <CatalogDetail
          catalogId={selectedId}
          spec={spec ?? null}
          advertiserId={advertiserId}
          advertiserLabel={advertiserLabel}
          bcId={bc?.bcId ?? ''}
          bcConfigured={Boolean(bc?.bcId)}
          catalogCapabilities={capabilitiesData?.capabilities ?? null}
          onBusinessCenterChanged={mutateBc}
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
          advertiserId={advertiserId}
          spec={spec ?? null}
          loading={listLoading && !list}
          onOpen={setSelectedId}
          onChanged={mutateList}
        />
      )}
    </div>
  )
}

// ── Business Center (obrigatório para publicar no TikTok) ──────────────────
// O TikTok prende catálogos ao Business Center, não ao advertiser, e não há
// API para listar BCs — então o usuário informa o ID uma vez (persistido).
function BusinessCenterBar({
  advertiserId,
  bcId,
  fromEnv,
  onChanged,
}: {
  advertiserId: string
  bcId: string
  fromEnv: boolean
  onChanged: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(bcId)
  const [busy, setBusy] = useState(false)
  const configured = Boolean(bcId)

  async function save() {
    setBusy(true)
    try {
      await apiSend(adsCatalogApiUrl('/api/ads/catalogs/business-center', advertiserId), 'POST', { bcId: value.trim() })
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
        <details className="group rounded-xl border border-border bg-background px-3 py-2">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-2"><Check className="size-3.5 text-success" aria-hidden="true" /> Conexão TikTok pronta</span>
            <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
          </summary>
          <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-2">
            <code className="truncate text-[11px] text-muted-foreground">Business Center {bcId}{fromEnv ? ' · servidor' : ''}</code>
            <button type="button" className="btn-ghost text-xs" onClick={() => { setValue(bcId); setEditing(true) }}>
              <Pencil className="size-3.5" aria-hidden="true" /> Alterar
            </button>
          </div>
        </details>
      )
    }
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-background p-3">
        <div className="flex min-w-0 items-center gap-2 text-xs">
          <Building2 className={`size-4 ${configured ? 'text-primary' : 'text-muted-foreground'}`} aria-hidden="true" />
          <span className="text-pretty text-muted-foreground">Configure uma vez para publicar catálogos no TikTok.</span>
        </div>
        <button
          type="button"
          className="btn-primary text-xs"
          onClick={() => {
            setValue(bcId)
            setEditing(true)
          }}
        >
          <Building2 className="size-3.5" aria-hidden="true" /> Configurar
        </button>
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
        Encontre em <strong className="text-foreground">TikTok Business Center → Configurações</strong>: o ID
        numérico aparece na URL (<code className="rounded bg-secondary px-1 py-0.5">bc_id=…</code>) e nos detalhes
        da conta. É o mesmo BC que contém sua conta de anúncio.
      </p>
      <div className="flex items-center justify-end gap-2">
        <button type="button" className="btn-ghost text-xs" onClick={() => setEditing(false)} disabled={busy}>
          Cancelar
        </button>
        <button type="button" className="btn-primary text-xs" onClick={save} disabled={busy}>
          {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Check className="size-3.5" aria-hidden="true" />}
          Salvar
        </button>
      </div>
    </div>
  )
}

// ── Tela 1: lista + criação ──────────────────────────────────────────────
function CatalogList({
  catalogs,
  advertiserId,
  spec,
  loading,
  onOpen,
  onChanged,
}: {
  catalogs: AdsCatalog[]
  advertiserId: string
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

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          Produtos, feed e vínculo com o TikTok em um só lugar.
        </p>
        {!creating && (
          <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
            <CatalogBatchDialog advertiserId={advertiserId} onCreated={onChanged} />
            <button type="button" className="btn-primary shrink-0 text-xs" onClick={() => setCreating(true)}>
              <Plus className="size-3.5" aria-hidden="true" />
              Novo catálogo
            </button>
          </div>
        )}
      </div>

      {creating && (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4">
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
          <details className="rounded-lg border border-border p-3">
            <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground">País e moeda · Brasil · BRL</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs">
                <span className="font-medium text-foreground">País principal</span>
                <select className="input-base" value={country} onChange={(e) => setCountry(e.target.value)}>
                  {countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span className="font-medium text-foreground">Moeda</span>
                <select className="input-base" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
            </div>
          </details>
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
          {catalogs.map((c) => {
            const status = catalogStatusMeta(c)
            return <li key={c.id}>
              <button
                type="button"
                onClick={() => onOpen(c.id)}
                className="flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-background px-4 py-3 text-left transition-colors hover:border-primary/50"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{c.name}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {c.productCount} produto{c.productCount === 1 ? '' : 's'} · {c.currency}
                    {c.country ? ` · ${c.country}` : ''}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${status.className}`}>
                  {status.label}
                </span>
              </button>
            </li>
          })}
        </ul>
      )}
    </div>
  )
}

// ── Tela 2: detalhe (produtos + import + publicar) ────────────────────────
function CatalogDetail({
  catalogId,
  advertiserId,
  advertiserLabel,
  spec,
  bcId,
  bcConfigured,
  catalogCapabilities,
  onBusinessCenterChanged,
  onBack,
  onDeleted,
}: {
  catalogId: string
  spec: CatalogSpec | null
  advertiserId: string
  advertiserLabel: string
  bcId: string
  bcConfigured: boolean
  catalogCapabilities: AdsCatalogCapabilities | null
  onBusinessCenterChanged: () => void | Promise<unknown>
  onBack: () => void
  onDeleted: () => void
}) {
  const campaignCreateSupported = catalogCapabilities?.manualCatalogCampaign === true
  const { data, mutate, isLoading, error: detailError } = useAdsCatalogDetail(catalogId, advertiserId)
  const { data: publicationData, mutate: mutatePublications } = useAdsCatalogPublications(catalogId, advertiserId)
  const { data: readinessData, mutate: mutateReadiness, isLoading: readinessLoading } = useAdsCatalogReadiness(catalogId, advertiserId)
  const fileRef = useRef<HTMLInputElement>(null)
  const [editing, setEditing] = useState<AdsCatalogProduct | 'new' | null>(null)
  const [urlValue, setUrlValue] = useState('')
  const [urlImporting, setUrlImporting] = useState(false)
  const [showUrlImport, setShowUrlImport] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [auditing, setAuditing] = useState(false)
  const [autoChecking, setAutoChecking] = useState(false)
  const [importing, setImporting] = useState(false)
  const [copied, setCopied] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<
    { kind: 'catalog'; name: string } | { kind: 'product'; id: string; name: string } | null
  >(null)
  const [deleting, setDeleting] = useState(false)
  // Quando o publish automático falha (502/BC/permissão), destacamos o caminho
  // garantido: baixar o CSV e subir manualmente no Catalog Manager.
  const [publishFailed, setPublishFailed] = useState(false)
  // A cadeia do TikTok roda em 2º plano; enquanto true, acompanhamos o log de
  // publicações para trazer o resultado real (sucesso ou motivo do erro).
  const [bgPublishing, setBgPublishing] = useState(false)
  const bgPublishSinceRef = useRef(0)
  // Ref síncrona: impede dois syncs concorrentes mesmo antes do React
  // aplicar setSyncing(true) (duplo toque no iPhone / salvar + botão manual).
  const syncLockRef = useRef(false)
  const auditAttemptsRef = useRef(0)

  const catalog = data?.catalog
  const products = data?.products ?? []
  const publications = publicationData?.publications ?? []
  const validCount = products.filter((p) => p.valid).length
  const hasUnpublishedChanges = Boolean(catalog?.syncedAt && products.some((p) => new Date(p.updatedAt).getTime() > new Date(catalog.syncedAt as string).getTime()))

  if (detailError) {
    return (
      <div className="flex flex-col gap-3">
        <button type="button" className="btn-ghost w-fit text-xs" onClick={onBack}>
          <ChevronLeft className="size-3.5" aria-hidden="true" /> Voltar aos catálogos
        </button>
        <ErrorState
          title="Não foi possível carregar este catálogo"
          description="Nenhum produto foi alterado. Confirme a conta de anúncio selecionada e tente novamente."
          onRetry={() => mutate()}
        />
      </div>
    )
  }

  async function handleUrlPreview() {
    if (!urlValue.trim()) return
    setUrlImporting(true)
    try {
      const preview = await apiSend<{ product: Record<string, string> }>(
        adsCatalogApiUrl(`/api/ads/catalogs/${encodeURIComponent(catalogId)}/product-preview`, advertiserId), 'POST', { url: urlValue.trim() },
      )
      const productData: Record<string, string> = {
        ...preview.product,
        sku_id: generateSku(),
        condition: 'new',
        availability: preview.product.availability || 'in stock',
      }
      setEditing({ id: 'preview', catalogId, skuId: productData.sku_id, data: productData, valid: false, errors: [], createdAt: '', updatedAt: '' })
      setShowUrlImport(false)
      setUrlValue('')
      const missing = [!productData.price && 'preço', !productData.image_link && 'imagem'].filter(Boolean)
      if (missing.length) {
        toast.info('Importação parcial — revise antes de salvar', {
          hint: `A página não expôs ${missing.join(' e ')} no HTML. Preencha manualmente no editor.`,
        })
      } else {
        toast.success('Dados encontrados — revise antes de salvar')
      }
    } catch (e) {
      toast.error('Não foi possível importar a página', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setUrlImporting(false)
    }
  }

  function handleDuplicate(product: AdsCatalogProduct) {
    const data = { ...product.data, sku_id: generateSku(), title: `${product.data.title || 'Produto'} — cópia` }
    setEditing({ ...product, id: 'duplicate', skuId: data.sku_id, data, createdAt: '', updatedAt: '' })
  }

  async function handleImport(file: File) {
    setImporting(true)
    try {
      const text = await file.text()
      const { summary } = await adsCatalogImportCsv(catalogId, advertiserId, text)
      toast.success(`${summary.imported} produto(s) importado(s)`, {
        hint: summary.invalid > 0 ? `${summary.invalid} com erros de validação — revise na tabela.` : undefined,
      })
      await Promise.all([mutate(), mutateReadiness()])
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
        adsCatalogApiUrl(`/api/ads/catalogs/${encodeURIComponent(catalogId)}/publish`, advertiserId), 'POST', {},
      )
      toast.success(`Feed publicado com ${res.published} produto(s)`, {
        hint: res.skipped > 0 ? `${res.skipped} pulado(s) por erros de validação.` : undefined,
      })
      await Promise.all([mutate(), mutatePublications()])
      await mutateReadiness()
    } catch (e) {
      toast.error('Falha ao publicar o feed', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setPublishing(false)
    }
  }

  // Publica direto no TikTok: cria o catálogo (se preciso) e sobe os produtos.
  async function handleSyncTiktok() {
    if (syncLockRef.current) return
    if (!bcConfigured) {
      toast.info('Produto salvo, mas ainda não publicado', {
        hint: 'Configure o Business Center no topo da aba para publicar no TikTok.',
      })
      return
    }
    syncLockRef.current = true
    setSyncing(true)
    setPublishFailed(false)
    try {
      const res = await apiSend<AdsCatalogSyncResponse>(
        adsCatalogApiUrl(`/api/ads/catalogs/${encodeURIComponent(catalogId)}/sync-tiktok`, advertiserId), 'POST', {},
      )
      if (res.dryRun) {
        toast.info('Modo simulação: feed publicado, mas nada foi enviado ao TikTok', {
          hint: 'Desative o modo simulação em Operações para publicar de verdade.',
        })
      } else if (res.pending) {
        // A cadeia do TikTok (criar catálogo + subir produtos + auditoria) roda
        // em 2º plano para não estourar o tempo de borda. O resultado real
        // (sucesso ou o motivo do erro) aparece no "Progresso da publicação".
        toast.info(`Publicando no TikTok em segundo plano — ${res.published} produto(s) no feed`, {
          hint: 'Acompanhe o resultado no "Progresso da publicação" logo abaixo.',
        })
        auditAttemptsRef.current = 0
        bgPublishSinceRef.current = Date.now()
        setBgPublishing(true)
      } else {
        toast.success(`Envio aceito pelo TikTok para ${res.published} produto(s)`, {
          hint: res.audit && res.audit.pending > 0 ? 'A análise será acompanhada automaticamente nesta tela.' : undefined,
        })
        // Um novo envio reinicia a janela de acompanhamento (até 12 consultas).
        auditAttemptsRef.current = 0
      }
      await Promise.all([mutate(), mutatePublications(), mutateReadiness()])
    } catch (e) {
      setPublishFailed(true)
      const hint = e instanceof ApiError ? e.display : e instanceof Error ? e.message : undefined
      toast.error('Não foi possível iniciar a sincronização automática', { hint })
    } finally {
      syncLockRef.current = false
      setSyncing(false)
    }
  }

  async function handleRefreshAudit() {
    setAuditing(true)
    try {
      const res = await fetch(adsCatalogApiUrl(`/api/ads/catalogs/${encodeURIComponent(catalogId)}/audit`, advertiserId), { credentials: 'include' })
      if (!res.ok) {
        const auditData = await res.json().catch(() => ({}))
        throw new Error(auditData.error || `Erro ${res.status}`)
      }
      await Promise.all([mutate(), mutateReadiness()])
    } catch (e) {
      toast.error('Falha ao atualizar status', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setAuditing(false)
    }
  }

  // Acompanha a análise agregada do TikTok sem exigir recarregar a página.
  // Intervalo conservador de 20 s, no máximo 12 tentativas (~4 min). Para ao
  // sair da tela, quando não há pendentes, quando atinge o limite ou em erro.
  useEffect(() => {
    const hasTikTokCatalog = Boolean(catalog?.tiktokCatalogId && catalog.linkStatus === 'verified')
    const needsCheck = hasTikTokCatalog && (
      !catalog?.audit || (catalog.audit.total ?? 0) === 0 || (catalog.audit.pending ?? 0) > 0
    )
    if (!needsCheck || auditAttemptsRef.current >= 12) {
      setAutoChecking(false)
      return
    }

    setAutoChecking(true)
    let cancelled = false
    const timer = window.setTimeout(async () => {
      try {
        auditAttemptsRef.current += 1
        const res = await fetch(adsCatalogApiUrl(`/api/ads/catalogs/${encodeURIComponent(catalogId)}/audit`, advertiserId), { credentials: 'include' })
        if (!res.ok) throw new Error(`Erro ${res.status}`)
        if (!cancelled) await Promise.all([mutate(), mutateReadiness()])
      } catch {
        // Falha silenciosa no polling: o botão manual continua disponível e
        // evita uma sequência de toasts por instabilidade temporária da API.
        if (!cancelled) setAutoChecking(false)
      }
    }, 20_000)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [catalogId, catalog?.tiktokCatalogId, catalog?.linkStatus, catalog?.audit?.pending, catalog?.audit?.at, mutate, mutateReadiness])

  // Acompanha a publicação em 2º plano: a rota responde na hora (pending) e a
  // cadeia do TikTok grava sucesso/erro no log de publicações depois. Aqui
  // revalidamos o log a cada 8 s (até ~4 min) até aparecer um registro tiktok
  // terminal (success/error) posterior ao início do envio — e então mostramos
  // o resultado real (não mais um timeout opaco).
  useEffect(() => {
    if (!bgPublishing) return
    const since = bgPublishSinceRef.current
    const terminal = publications.find(
      (p) => p.kind === 'tiktok' && (p.status === 'success' || p.status === 'error') && new Date(p.createdAt).getTime() >= since,
    )
    if (terminal) {
      setBgPublishing(false)
      if (terminal.status === 'success') {
        setPublishFailed(false)
        toast.success(`Envio aceito pelo TikTok para ${terminal.published} produto(s)`)
      } else {
        setPublishFailed(true)
        toast.error('A sincronização automática precisa ser retomada', { hint: terminal.error || undefined })
      }
      return
    }
    // Desiste depois de ~4 min: o registro terminal aparecerá no log mesmo assim.
    if (Date.now() - since > 240_000) {
      setBgPublishing(false)
      return
    }
    const timer = window.setTimeout(() => { void mutatePublications() }, 8_000)
    return () => window.clearTimeout(timer)
  }, [bgPublishing, publications, mutatePublications])

  async function confirmDelete() {
    const target = deleteTarget
    if (!target) return
    setDeleting(true)
    try {
      if (target.kind === 'catalog') {
        await apiSend(adsCatalogApiUrl(`/api/ads/catalogs/${encodeURIComponent(catalogId)}`, advertiserId), 'DELETE')
        toast.success('Catálogo local excluído', { hint: 'O catálogo remoto do TikTok não foi apagado.' })
        onDeleted()
      } else {
        await apiSend(
          adsCatalogApiUrl(`/api/ads/catalogs/${encodeURIComponent(catalogId)}/products/${encodeURIComponent(target.id)}`, advertiserId),
          'DELETE',
        )
        toast.success('Produto removido')
        await Promise.all([mutate(), mutateReadiness()])
      }
    } catch (e) {
      toast.error(target.kind === 'catalog' ? 'Falha ao excluir catálogo' : 'Falha ao remover produto', {
        hint: e instanceof Error ? e.message : undefined,
      })
    } finally {
      setDeleting(false)
      setDeleteTarget(null)
    }
  }

  function copyFeedUrl() {
    if (!catalog?.feedUrl) return
    navigator.clipboard?.writeText(catalog.feedUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  function handleReadinessAction(action: NonNullable<typeof readinessData>['readiness']['nextAction']) {
    if (action === 'add_products') setShowUrlImport(true)
    else if (action === 'fix_products' && products[0]) setEditing(products.find((product) => !product.valid) || products[0])
    else if (action === 'sync') void handleSyncTiktok()
    else if (action === 'refresh_audit') void handleRefreshAudit()
    else if (action === 'select_advertiser') toast.info('Selecione uma conta de anúncios no topo da aba TikTok Ads.')
    else if (action === 'connect_tiktok' || action === 'verify_link') toast.info('Use o cartão Conexão com o TikTok logo abaixo.')
    else if (action === 'create_campaign') document.getElementById('catalog-campaign-wizard')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <button type="button" className="btn-ghost text-xs" onClick={onBack}>
          <ChevronLeft className="size-3.5" aria-hidden="true" />
          Voltar
        </button>
        <button type="button" className="btn-ghost text-xs text-error" onClick={() => setDeleteTarget({ kind: 'catalog', name: catalog?.name || 'catálogo' })}>
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
          <div className="px-1 py-1">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">{catalog?.name}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {products.length} produto{products.length === 1 ? '' : 's'} · {validCount} válido{validCount === 1 ? '' : 's'} · {catalog?.currency}
                {hasUnpublishedChanges && <span className="font-semibold text-warning"> · alterações não publicadas</span>}
              </p>
            </div>
          </div>

          {/* Falha de início não apaga o catálogo nem o feed; o usuário pode
              reenfileirar a automação sem reimportar os produtos. */}
          {publishFailed && validCount > 0 && (
            <div className="flex flex-col gap-2 rounded-xl border border-warning/40 bg-warning/5 p-4">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <AlertCircle className="size-4 text-warning" aria-hidden="true" />
                Sincronização automática não iniciada
              </p>
              <p className="text-pretty text-[11px] leading-relaxed text-muted-foreground">
                Os produtos e o feed permanecem salvos. Tente novamente para recolocar a automação na fila.
              </p>
              <button type="button" className="btn-primary w-fit text-xs" onClick={handleSyncTiktok} disabled={syncing}>
                {syncing ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <RotateCcw className="size-3.5" aria-hidden="true" />} Tentar sincronização automática
              </button>
            </div>
          )}

          <CatalogReadinessCard
            readiness={readinessData?.readiness}
            loading={readinessLoading}
            onAction={readinessData?.readiness.nextAction === 'create_campaign' && !campaignCreateSupported
              ? undefined
              : handleReadinessAction}
          />

          <CatalogSyncStatus catalogId={catalogId} advertiserId={advertiserId} />

          {catalog && (
            <CatalogConnectionCard
              catalog={catalog}
              advertiserId={advertiserId}
              bcId={bcId}
              // O cartão também pode salvar/corrigir o BC. Revalida o estado
              // pai junto do catálogo para `bcConfigured` não continuar falso
              // e bloquear a sincronização até um reload.
              onChanged={() => Promise.all([mutate(), mutateReadiness(), onBusinessCenterChanged()])}
            />
          )}

          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <button type="button" className="btn-ghost justify-center text-xs" onClick={() => setShowUrlImport((value) => !value)} aria-expanded={showUrlImport}>
              <Link2 className="size-3.5" aria-hidden="true" /> Importar pela URL
            </button>
            <button type="button" className="btn-ghost justify-center text-xs" onClick={() => setEditing('new')}>
              <Plus className="size-3.5" aria-hidden="true" /> Adicionar manualmente
            </button>
          </div>

          {showUrlImport && (
            <section className="flex flex-col gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4" aria-labelledby="url-import-title">
              <div className="flex flex-col gap-1">
                <h3 id="url-import-title" className="text-xs font-semibold text-foreground">Preencher pela página do produto</h3>
                <p className="text-pretty text-[11px] text-muted-foreground">Buscamos título, descrição, imagem e preço. Você revisa tudo antes de salvar.</p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  className="input-base min-w-0 flex-1"
                  value={urlValue}
                  onChange={(event) => setUrlValue(event.target.value)}
                  placeholder="https://sualoja.com/produto"
                  inputMode="url"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) handleUrlPreview()
                  }}
                />
                <button type="button" className="btn-primary shrink-0 text-xs" onClick={handleUrlPreview} disabled={urlImporting || !urlValue.trim()}>
                  {urlImporting ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <SearchCheck className="size-3.5" aria-hidden="true" />}
                  Buscar dados
                </button>
              </div>
            </section>
          )}

          <details className="rounded-xl border border-border bg-background p-3">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs font-semibold text-foreground">
              Opções avançadas <ChevronDown className="size-3.5" aria-hidden="true" />
            </summary>
            <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
              <input ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) handleImport(file) }} />
              <button type="button" className="btn-ghost text-xs" onClick={() => fileRef.current?.click()} disabled={importing}>
                {importing ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <UploadCloud className="size-3.5" aria-hidden="true" />} Importar CSV
              </button>
              <a className="btn-ghost text-xs" href={adsCatalogApiUrl(`/api/ads/catalogs/${encodeURIComponent(catalogId)}/export.csv`, advertiserId)}>
                <Download className="size-3.5" aria-hidden="true" /> Baixar CSV
              </a>
              <button type="button" className="btn-ghost text-xs" onClick={handlePublish} disabled={publishing || validCount === 0}>
                <UploadCloud className="size-3.5" aria-hidden="true" /> Atualizar só o feed
              </button>
            </div>
          </details>

          {/* Aviso: BC não configurado bloqueia a publicação no TikTok */}
          {!bcConfigured && (
            <div className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/5 p-3 text-[11px] text-muted-foreground">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden="true" />
              <span className="text-pretty">
                Configure o <strong className="text-foreground">Business Center</strong> para enviar direto ao TikTok.
                Sem ele, o <strong className="text-foreground">feed manual</strong> continua disponível.
              </span>
            </div>
          )}

          {/* Status do catálogo no TikTok (quando já publicado) */}
          {catalog?.tiktokCatalogId && catalog.linkStatus === 'verified' && (
            <TiktokStatusPanel
              catalog={catalog}
              auditing={auditing}
              autoChecking={autoChecking}
              onRefresh={handleRefreshAudit}
            />
          )}

          {catalog && (
            <CatalogCampaignWizard
              catalog={catalog}
              advertiserId={advertiserId}
              ready={Boolean(readinessData?.readiness.readyForCampaign)}
              capabilities={catalogCapabilities}
            />
          )}

          {/* URL técnica: é consumida pela automação e pode ser copiada apenas
              para diagnóstico; nunca é URL de anúncio. */}
          {catalog?.feedUrl && (
            <details className="rounded-xl border border-border bg-background p-4">
              <summary className="cursor-pointer text-xs font-semibold text-foreground">
                URL técnica do feed
              </summary>
              <div className="mt-3 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-lg bg-secondary px-3 py-2 text-[11px] text-muted-foreground">
                    {catalog.feedUrl}
                  </code>
                  <button type="button" className="btn-ghost shrink-0 px-2 py-2" onClick={copyFeedUrl} aria-label="Copiar URL">
                    {copied ? <Check className="size-3.5 text-success" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
                  </button>
                </div>
                <p className="text-pretty text-[11px] leading-relaxed text-muted-foreground">
                  Esta URL é usada automaticamente para sincronizar os produtos. Ela não é usada no anúncio e não precisa ser preenchida em nenhuma campanha.
                </p>
              </div>
            </details>
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
                          <button type="button" className="btn-ghost px-2 py-1" onClick={() => handleDuplicate(p)} aria-label="Duplicar e revisar">
                            <CopyPlus className="size-3.5" aria-hidden="true" />
                          </button>
                          <button type="button" className="btn-ghost px-2 py-1 text-error" onClick={() => setDeleteTarget({ kind: 'product', id: p.id, name: p.data.title || p.skuId })} aria-label="Remover">
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

          {publications.length > 0 && (
            <details className="rounded-xl border border-border bg-background p-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs font-semibold text-foreground">
                <span className="flex items-center gap-2"><History className="size-3.5" aria-hidden="true" /> Histórico de publicações</span>
                <span className="text-[10px] font-normal text-muted-foreground">{publications.length} registro{publications.length === 1 ? '' : 's'}</span>
              </summary>
              <ol className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
                {publications.slice(0, 10).map((publication) => (
                  <li key={publication.id} className="flex items-start justify-between gap-3 rounded-lg bg-secondary/40 p-3">
                    <div className="min-w-0">
                      <p className="text-[11px] font-medium text-foreground">
                        {publication.kind === 'tiktok' ? 'TikTok' : 'Feed'} · {
                          publication.status === 'simulated'
                            ? 'simulação'
                            : publication.status === 'error'
                              ? 'falhou'
                              : publication.kind === 'tiktok'
                                ? 'envio aceito'
                                : 'atualizado'
                        }
                      </p>
                      <p className={`text-[10px] ${publication.status === 'error' ? 'text-error' : publication.kind === 'tiktok' && publication.published === 0 ? 'text-warning' : 'text-muted-foreground'}`}>
                        {publication.status === 'error'
                          ? publication.error || 'O TikTok recusou o envio.'
                          : publication.published > 0
                            ? `${publication.published} enviado(s)${publication.skipped > 0 ? ` · ${publication.skipped} ignorado(s)` : ''}`
                            : 'Nenhum produto foi enviado'}
                      </p>
                    </div>
                    <time className="shrink-0 text-[10px] text-muted-foreground" dateTime={publication.createdAt}>
                      {new Date(publication.createdAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })}
                    </time>
                  </li>
                ))}
              </ol>
            </details>
          )}
        </>
      )}

      {editing && (
        <ProductEditor
          catalogId={catalogId}
          advertiserId={advertiserId}
          spec={spec}
          product={editing === 'new' ? null : editing}
          currency={catalog?.currency || 'BRL'}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            await Promise.all([mutate(), mutateReadiness()])
          }}
        />
      )}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={deleteTarget?.kind === 'catalog' ? 'Excluir catálogo local?' : 'Remover produto do catálogo?'}
        description={deleteTarget?.kind === 'catalog'
          ? <>Todos os produtos e o histórico local serão removidos. O catálogo remoto no TikTok não será apagado. Essa ação não pode ser desfeita.</>
          : <>O produto <strong className="text-foreground">{deleteTarget?.name}</strong> será removido deste catálogo. O catálogo remoto só muda na próxima sincronização.</>}
        confirmLabel={deleteTarget?.kind === 'catalog' ? 'Excluir catálogo' : 'Remover produto'}
        confirmText={deleteTarget?.kind === 'catalog' ? deleteTarget.name : undefined}
        busy={deleting}
        onConfirm={confirmDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  )
}

// ── Painel de status do catálogo no TikTok ────────────────────────────────
// Mostra somente o que o provider confirma: ID real e contagens agregadas.
function TiktokStatusPanel({
  catalog,
  auditing,
  autoChecking,
  onRefresh,
}: {
  catalog: AdsCatalog
  auditing: boolean
  autoChecking: boolean
  onRefresh: () => void
}) {
  const [copied, setCopied] = useState(false)
  const audit = catalog.audit
  const approved = audit?.approved ?? 0
  const pending = audit?.pending ?? 0
  const rejected = audit?.rejected ?? 0
  const total = audit?.total ?? approved + pending + rejected
  const catalogSynced = total > 0 && approved > 0 && pending === 0 && rejected === 0
  const productsNotConfirmed = Boolean(audit && total === 0)
  const syncedAt = catalog.syncedAt ? new Date(catalog.syncedAt) : null

  function copyId() {
    if (!catalog.tiktokCatalogId) return
    navigator.clipboard?.writeText(catalog.tiktokCatalogId).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className={`flex flex-col gap-3 rounded-xl border p-4 ${catalogSynced ? 'border-success/30 bg-success/5' : 'border-warning/30 bg-warning/5'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            {catalogSynced ? (
              <ShieldCheck className="size-4 text-success" aria-hidden="true" />
            ) : (
              <Clock className="size-4 text-warning" aria-hidden="true" />
            )}
            {catalogSynced
              ? 'Produtos confirmados no TikTok'
              : productsNotConfirmed
                ? 'Catálogo conectado — produtos ainda não confirmados'
                : 'TikTok analisando os produtos'}
          </p>
          {autoChecking && (
            <p className="flex items-center gap-1 text-[10px] text-muted-foreground" role="status">
              <Loader2 className="size-3 animate-spin" aria-hidden="true" />
              Verificando a análise automaticamente
            </p>
          )}
        </div>
        <button type="button" className="btn-ghost text-xs" onClick={onRefresh} disabled={auditing}>
          {auditing ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="size-3.5" aria-hidden="true" />}
          Atualizar status
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="text-muted-foreground">ID do catálogo:</span>
        <code className="rounded bg-background px-2 py-1 text-foreground">{catalog.tiktokCatalogId}</code>
        <button type="button" className="btn-ghost px-1.5 py-1" onClick={copyId} aria-label="Copiar ID do catálogo">
          {copied ? <Check className="size-3 text-success" aria-hidden="true" /> : <Copy className="size-3" aria-hidden="true" />}
        </button>
      </div>

      {/* Auditoria dos produtos */}
      {audit && total > 0 ? (
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2.5 py-1 text-[11px] font-semibold text-success">
            {approved} aprovado{approved === 1 ? '' : 's'}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2.5 py-1 text-[11px] font-semibold text-warning">
            {pending} em análise
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-error/15 px-2.5 py-1 text-[11px] font-semibold text-error">
            {rejected} reprovado{rejected === 1 ? '' : 's'}
          </span>
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          {productsNotConfirmed
            ? 'O TikTok ainda não devolveu nenhum produto para este catálogo. Sincronize novamente ou atualize o status; “0” não significa que a publicação foi concluída.'
            : 'O envio foi aceito, mas a auditoria ainda não retornou contagens. Clique em “Atualizar status”.'}
        </p>
      )}

      <p className="text-pretty text-[11px] leading-relaxed text-muted-foreground">
        {catalogSynced
          ? 'O vínculo e os produtos foram confirmados. Assim que o conector validar Product Link, a campanha poderá ser criada aqui sem URL no anúncio.'
          : rejected > 0
            ? 'Há produtos reprovados. O provider retorna somente as contagens, sem o motivo individual; revise imagem (≥ 500×500), link HTTPS e moeda, depois republique.'
            : productsNotConfirmed
              ? 'Nenhum produto remoto foi confirmado ainda. Seus produtos locais continuam preservados; tente sincronizar novamente antes de criar a campanha.'
              : 'O TikTok ainda está processando os produtos. Esta tela atualiza as contagens automaticamente enquanto houver itens pendentes.'}
      </p>

      {syncedAt && (
        <p className="text-[10px] text-muted-foreground">
          Última publicação: {syncedAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
          {audit?.at ? ` · Status consultado: ${new Date(audit.at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}` : ''}
        </p>
      )}
    </div>
  )
}

// Um campo do editor de produto: rótulo pt-BR + chave técnica como dica.
function ProductField({
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
        {field.required && <span className="text-error">*</span>}
        {FIELD_LABELS[field.key] && <span className="text-[10px] text-muted-foreground">{field.key}</span>}
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

// ── Editor de um produto (sobreposto) ─────────────────────────────────────
// Renderizado via createPortal no <body>: o editor vivia DENTRO de um card com
// backdrop-filter/transform, que vira "containing block" e prende o
// position:fixed ao card — era o popup quebrado/transparente no iPhone.
// Mobile: bottom sheet (desliza de baixo, largura total, respeitando a
// safe-area). Desktop: modal centrado como antes.

// SKU legível e único o suficiente para um catálogo manual: base36 do
// timestamp + 2 chars aleatórios (ex.: "SKU-MDQ3K2-7F").
function generateSku(): string {
  const rand = Math.random().toString(36).slice(2, 4).toUpperCase()
  return `SKU-${Date.now().toString(36).toUpperCase()}-${rand}`
}

// "9.99", "9,99" ou "1.234,56" → "9.99 BRL" (formato exigido pelo TikTok:
// número + espaço + moeda do catálogo). Valores já formatados passam direto.
function formatPriceForFeed(input: string, currency: string): string {
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
function stripCurrency(price: string): string {
  const m = String(price || '').trim().match(/^(\d+(?:\.\d{1,2})?)\s+[A-Za-z]{3}$/)
  return m ? m[1] : String(price || '')
}

function ProductEditor({
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
    if (f.key === 'image_link' || f.key === 'additional_image_link') return <ImageField key={f.key} field={f} {...common} />
    return <ProductField key={f.key} field={f} {...common} />
  }

  if (!mounted) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:overflow-y-auto sm:p-4"
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
            <p className="text-[11px] text-muted-foreground">
              {missingRequired.length > 0
                ? `Faltam obrigatórios: ${missingRequired.map((k) => FIELD_LABELS[k] || k).join(', ')}`
                : 'Todos os campos obrigatórios preenchidos'}
            </p>
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

// ── Campo de preço simplificado ────────────────────────────────────────────
// O usuário digita só o número (9.99 ou 9,99); a moeda do catálogo aparece
// como sufixo fixo e é anexada automaticamente no salvar.
function PriceField({
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
        {field.required && <span className="text-error">*</span>}
        <span className="text-[10px] text-muted-foreground">{field.key}</span>
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
function ImageField({
  field,
  value,
  onChange,
}: {
  field: { key: string; required: boolean }
  value: string
  onChange: (v: string) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
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
