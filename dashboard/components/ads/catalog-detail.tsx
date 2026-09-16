'use client'

// Orquestrador visual do domínio de catálogos. As responsabilidades de conexão,
// prontidão e criação de campanha ficam em componentes próprios; esta tela
// concentra produtos, importação e histórico.

import { catalogDisplayPrice } from '@/lib/catalog-display'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  X, Loader2, Plus, Trash2, UploadCloud, Download,
  Copy, Check, AlertCircle, ChevronLeft, PackageOpen,
  Building2, Clock, ShieldCheck, RefreshCw, Pencil, ImageIcon,
  Link2, ChevronDown, History, CopyPlus, SearchCheck, RotateCcw, GripVertical,
  Rocket, SlidersHorizontal, Sparkles, MoreHorizontal,
} from 'lucide-react'
import {
  useAdsCatalogs, useAdsCatalogDetail, useAdsCatalogSpec, useAdsCatalogBusinessCenter,
  useAdsCatalogPublications, useAdsCatalogReadiness, useAdsCatalogCapabilities, adsCatalogImportCsv,
  adsCatalogApiUrl, apiSend, fetcher, ApiError,
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
import { CatalogCreatives } from './catalog-creatives'
import { CatalogQuickCampaignsDialog } from './catalog-quick-campaigns-dialog'

import { ProductEditor, generateSku, formatPriceForFeed } from './catalog-editor'

type CatalogSpec = AdsCatalogSpecResponse
const CURRENCIES = ['USD', 'BRL', 'EUR', 'GBP', 'MXN', 'CAD', 'AUD', 'JPY']
const PRIMARY_COLS = ['sku_id', 'title', 'availability', 'condition', 'price', 'image_link', 'link']
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
// ── Tela 2: detalhe (produtos + import + publicar) ────────────────────────
export function CatalogDetail({
  catalogId,
  advertiserId,
  advertiserLabel,
  advertiserCurrency,
  spec,
  bcId,
  bcConfigured,
  catalogCapabilities,
  onBusinessCenterChanged,
  onBack,
  onDeleted,
  onCloned,
  onLocalWorkStateChange,
}: {
  catalogId: string
  spec: CatalogSpec | null
  advertiserId: string
  advertiserLabel: string
  advertiserCurrency: string
  bcId: string
  bcConfigured: boolean
  catalogCapabilities: AdsCatalogCapabilities | null
  onBusinessCenterChanged: () => void | Promise<unknown>
  onBack: () => void
  onDeleted: () => void
  onCloned: (cloneId: string) => void
  onLocalWorkStateChange?: (state: { uploading: boolean; pending: number }) => void
}) {
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
  const [syncStatusVersion, setSyncStatusVersion] = useState(0)
  const [auditing, setAuditing] = useState(false)
  const [autoChecking, setAutoChecking] = useState(false)
  const [importing, setImporting] = useState(false)
  const [copied, setCopied] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<
    { kind: 'catalog'; name: string } | { kind: 'product'; id: string; name: string } | null
  >(null)
  const [deleting, setDeleting] = useState(false)
  const [cloning, setCloning] = useState(false)
  const [confirmClone, setConfirmClone] = useState(false)
  const [confirmBack, setConfirmBack] = useState(false)
  const cloneRequestKeyRef = useRef<string | null>(null)
  const [fixing, setFixing] = useState(false)
  const [quickCampaignsOpen, setQuickCampaignsOpen] = useState(false)
  const [creativeBusy, setCreativeBusy] = useState(false)
  const [creativePending, setCreativePending] = useState(0)
  const [quickCampaignWork, setQuickCampaignWork] = useState({ uploading: false, pending: 0 })
  const localUploading = creativeBusy || quickCampaignWork.uploading
  const localPending = creativePending + quickCampaignWork.pending
  useEffect(() => { onLocalWorkStateChange?.({ uploading: localUploading, pending: localPending }) }, [localPending, localUploading, onLocalWorkStateChange])
  useEffect(() => () => onLocalWorkStateChange?.({ uploading: false, pending: 0 }), [onLocalWorkStateChange])
  const [productOrder, setProductOrder] = useState<string[]>([])
  const [dragProductId, setDragProductId] = useState<string | null>(null)
  // Quando a sincronização falha, preservamos o estado e oferecemos retomada
  // automática sem obrigar o usuário a reconstruir o catálogo no TikTok.
  const [publishFailed, setPublishFailed] = useState(false)
  const [publishFailureHint, setPublishFailureHint] = useState('')
  // A cadeia do TikTok roda em 2º plano; enquanto true, acompanhamos o log de
  // publicações para trazer o resultado real (sucesso ou motivo do erro).
  const [bgPublishing, setBgPublishing] = useState(false)
  const bgPublishSinceRef = useRef(0)
  // Ref síncrona: impede dois syncs concorrentes mesmo antes do React
  // aplicar setSyncing(true) (duplo toque no iPhone / salvar + botão manual).
  const syncLockRef = useRef(false)
  const autoSyncQueuedRef = useRef(false)
  const auditAttemptsRef = useRef(0)
  const refreshProgress = useCallback(() => { void mutate(); void mutateReadiness() }, [mutate, mutateReadiness])

  const catalog = data?.catalog
  const products = data?.products ?? []
  useEffect(() => {
    setProductOrder((current) => {
      const ids = products.map((product) => product.id)
      const kept = current.filter((id) => ids.includes(id))
      const added = ids.filter((id) => !kept.includes(id))
      return kept.concat(added)
    })
  }, [data?.products])
  const orderedProducts = productOrder.length
    ? productOrder.map((id) => products.find((product) => product.id === id)).filter(Boolean) as AdsCatalogProduct[]
    : products
  const publications = publicationData?.publications ?? []
  const validCount = products.filter((p) => p.valid).length
  const remoteProductCount = Math.max(0, Number(catalog?.audit?.total) || 0)
  const localOnlyCount = remoteProductCount > 0 ? Math.max(0, validCount - remoteProductCount) : 0
  const hasUnpublishedChanges = Boolean(catalog?.syncedAt && products.some((p) => new Date(p.updatedAt).getTime() > new Date(catalog.syncedAt as string).getTime()))
  const invalidCount = products.filter((p) => !p.valid).length
  const reviewIssueCount = (catalog?.audit?.pending ?? 0) + (catalog?.audit?.rejected ?? 0)
  const displayedRemoteCount = remoteProductCount > 0 ? remoteProductCount : catalog?.audit?.approved ?? 0

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
    const skuId = generateSku()
    // "Duplicar" cria outro produto independente. Preservar item_group_id
    // fazia cópias novas continuarem agrupadas ao SKU original e deixava a
    // contagem local diferente do catálogo mostrado pelo TikTok.
    const data = {
      ...product.data,
      sku_id: skuId,
      item_group_id: skuId,
      title: `${product.data.title || 'Produto'} — cópia`,
    }
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
      await refreshAndAutoSync()
    } catch (e) {
      toast.error('Falha ao importar CSV', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function persistProductOrder(next: string[]) {
    setProductOrder(next)
    try {
      await apiSend(
        adsCatalogApiUrl(`/api/ads/catalogs/${encodeURIComponent(catalogId)}/products/reorder`, advertiserId),
        'PUT', { productIds: next },
      )
      toast.success('Ordem dos produtos salva')
      await mutate()
    } catch (error) {
      toast.error('Não foi possível salvar a ordem', { hint: error instanceof Error ? error.message : undefined })
      setProductOrder(products.map((product) => product.id))
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
  async function handleSyncTiktok(options: { silent?: boolean } = {}) {
    const silent = options.silent === true
    if (syncLockRef.current) {
      if (silent) autoSyncQueuedRef.current = true
      return
    }
    if (!bcConfigured) {
      toast.info('A conexão TikTok ainda está sendo resolvida', {
        hint: 'Tente a detecção novamente no topo da aba. Seus produtos continuam salvos.',
      })
      return
    }
    syncLockRef.current = true
    setSyncing(true)
    setPublishFailed(false)
    setPublishFailureHint('')
    try {
      const res = await apiSend<AdsCatalogSyncResponse>(
        adsCatalogApiUrl(`/api/ads/catalogs/${encodeURIComponent(catalogId)}/sync-tiktok`, advertiserId), 'POST', {},
      )
      // O hook de status pode ter carregado uma lista vazia antes deste run.
      // Força uma leitura imediata para o painel realmente acompanhar a tarefa
      // que o toast acabou de anunciar, sem polling ocioso quando nada existe.
      setSyncStatusVersion((value) => value + 1)
      if (res.dryRun) {
        if (!silent) toast.info('Modo simulação: feed publicado, mas nada foi enviado ao TikTok', {
          hint: 'Desative o modo simulação em Operações para publicar de verdade.',
        })
      } else if (res.pending) {
        // A cadeia do TikTok (criar catálogo + subir produtos + auditoria) roda
        // em 2º plano para não estourar o tempo de borda. O resultado real
        // (sucesso ou o motivo do erro) aparece no "Progresso da publicação".
        if (!silent) toast.info(`Publicando no TikTok em segundo plano — ${res.published} produto(s) no feed`, {
          hint: 'Acompanhe o resultado no "Progresso da publicação" logo abaixo.',
        })
        auditAttemptsRef.current = 0
        bgPublishSinceRef.current = Date.now()
        setBgPublishing(true)
      } else {
        if (!silent) toast.success(`Envio aceito pelo TikTok para ${res.published} produto(s)`, {
          hint: res.audit && res.audit.pending > 0 ? 'A análise será acompanhada automaticamente nesta tela.' : undefined,
        })
        // Um novo envio reinicia a janela de acompanhamento (até 12 consultas).
        auditAttemptsRef.current = 0
      }
      await Promise.all([mutate(), mutatePublications(), mutateReadiness()])
    } catch (e) {
      setPublishFailed(true)
      const hint = e instanceof ApiError ? e.display : e instanceof Error ? e.message : undefined
      setPublishFailureHint(hint || 'Verifique a conexão e tente novamente.')
      toast.error(silent ? 'A sincronização automática precisa de atenção' : 'Não foi possível iniciar a sincronização automática', { hint })
    } finally {
      syncLockRef.current = false
      setSyncing(false)
      if (autoSyncQueuedRef.current) {
        autoSyncQueuedRef.current = false
        window.setTimeout(() => { void handleSyncTiktok({ silent: true }) }, 300)
      }
    }
  }

  async function refreshAndAutoSync() {
    const refreshed = await mutate()
    await mutateReadiness()
    const refreshedProducts = refreshed?.products ?? []
    if (bcConfigured && refreshedProducts.some((product) => product.valid)) {
      void handleSyncTiktok({ silent: true })
    }
    return refreshed
  }

  async function handleRefreshAudit() {
    setAuditing(true)
    try {
      await fetcher(adsCatalogApiUrl(`/api/ads/catalogs/${encodeURIComponent(catalogId)}/audit`, advertiserId))
      await Promise.all([mutate(), mutateReadiness()])
    } catch (e) {
      toast.error('Falha ao atualizar status', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setAuditing(false)
    }
  }

  async function handleMagicFix() {
    setFixing(true)
    try {
      const data = await apiSend<{ fixedCount?: number }>(adsCatalogApiUrl(`/api/ads/catalogs/${encodeURIComponent(catalogId)}/magic-fix`, advertiserId), 'POST', {})
      if ((data.fixedCount ?? 0) > 0) {
        toast.success(`${data.fixedCount} produto(s) corrigido(s) com sucesso!`)
        await refreshAndAutoSync()
      } else {
        toast.info('Nenhum erro conhecido pôde ser corrigido automaticamente.')
      }
    } catch (e) {
      toast.error('Falha na Auto-Correção', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setFixing(false)
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
        await fetcher(adsCatalogApiUrl(`/api/ads/catalogs/${encodeURIComponent(catalogId)}/audit`, advertiserId))
        if (!cancelled) await Promise.all([mutate(), mutateReadiness()])
      } catch {
        // Falha silenciosa no polling: a atualização sob demanda continua disponível e
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
    if (!target || deleting) return
    setDeleting(true)
    try {
      if (target.kind === 'catalog') {
        await apiSend(adsCatalogApiUrl(`/api/ads/catalogs/${encodeURIComponent(catalogId)}`, advertiserId), 'DELETE')
        setDeleteTarget(null)
        toast.success('Catálogo local excluído', { hint: 'O catálogo remoto do TikTok não foi apagado.' })
        onDeleted()
      } else {
        await apiSend(
          adsCatalogApiUrl(`/api/ads/catalogs/${encodeURIComponent(catalogId)}/products/${encodeURIComponent(target.id)}`, advertiserId),
          'DELETE',
        )
        // A exclusão já foi confirmada pelo backend; uma falha posterior de
        // refresh/sincronização não pode ser apresentada como se o produto
        // tivesse sido preservado.
        setDeleteTarget(null)
        toast.success('Produto removido')
        try {
          await refreshAndAutoSync()
        } catch (refreshError) {
          toast.info('Produto removido, mas a tela não atualizou completamente', {
            hint: refreshError instanceof Error ? refreshError.message : 'Atualize a página para conferir o estado mais recente.',
          })
        }
      }
    } catch (e) {
      // Falha da exclusão em si: mantém o diálogo/contexto aberto para retry.
      toast.error(target.kind === 'catalog' ? 'Falha ao excluir catálogo' : 'Falha ao remover produto', {
        hint: e instanceof Error ? e.message : undefined,
      })
    } finally {
      setDeleting(false)
    }
  }

  function copyFeedUrl() {
    if (!catalog?.feedUrl) return
    navigator.clipboard?.writeText(catalog.feedUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  function openTechnicalDetails() {
    const element = document.getElementById('catalog-technical-details')
    if (element instanceof HTMLDetailsElement) element.open = true
    window.setTimeout(() => element?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
  }

  function handleReadinessAction(action: NonNullable<typeof readinessData>['readiness']['nextAction']) {
    if (action === 'add_products') setShowUrlImport(true)
    else if (action === 'fix_products' && products[0]) setEditing(products.find((product) => !product.valid) || products[0])
    else if (action === 'sync') void handleSyncTiktok()
    else if (action === 'refresh_audit') void handleRefreshAudit()
    else if (action === 'select_advertiser') toast.info('Selecione uma conta de anúncios no topo da aba TikTok Ads.')
    else if (action === 'connect_tiktok' || action === 'verify_link') openTechnicalDetails()
    else if (action === 'create_campaign') {
      if (catalogCapabilities?.catalogSingleVideoCampaign !== true) {
        toast.info('Criação de campanhas de catálogo indisponível para esta conta no momento.')
        return
      }
      setQuickCampaignsOpen(true)
    }
  }

  const hasCreativeLocalWork = localUploading || localPending > 0
  function requestBack() {
    if (hasCreativeLocalWork) {
      setConfirmBack(true)
      return
    }
    onBack()
  }

  async function handleClone() {
    if (cloning || hasCreativeLocalWork) return
    setCloning(true)
    const idempotencyKey = cloneRequestKeyRef.current || crypto.randomUUID()
    cloneRequestKeyRef.current = idempotencyKey
    try {
      const res = await apiSend<{ catalog: AdsCatalog; productCount: number; syncStarted: boolean }>(
        adsCatalogApiUrl(`/api/ads/catalogs/${encodeURIComponent(catalogId)}/clone`, advertiserId), 'POST', { idempotencyKey },
      )
      cloneRequestKeyRef.current = null
      setConfirmClone(false)
      if (res.syncStarted) {
        toast.success(`Catálogo clonado com ${res.productCount} produto(s) — publicação iniciada`, {
          hint: 'Acompanhe o progresso no catálogo clonado.',
        })
      } else {
        toast.success(`Catálogo clonado com ${res.productCount} produto(s)`, {
          hint: 'O clone ficou salvo localmente. A sincronização começará quando a conexão estiver pronta.',
        })
      }
      onCloned(res.catalog.id)
    } catch (e) {
      toast.error('Falha ao clonar o catálogo', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setCloning(false)
    }
  }

  if (detailError) {
    return (
      <div className="flex flex-col gap-3">
        <button type="button" className="btn-ghost w-fit text-xs" onClick={requestBack}>
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

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <button type="button" className="btn-ghost text-xs" onClick={requestBack}>
          <ChevronLeft className="size-3.5" aria-hidden="true" />
          Voltar
        </button>
        <details className="catalog-actions-menu relative">
          <summary className="btn-ghost !size-10 cursor-pointer list-none justify-center p-0" aria-label="Mais ações do catálogo" title="Mais ações">
            <MoreHorizontal className="size-4" aria-hidden="true" />
          </summary>
          <div className="catalog-actions-popover">
            {hasCreativeLocalWork ? <p className="px-3 py-2 text-xs leading-relaxed text-muted-foreground">{localUploading ? 'Conclua ou cancele o envio atual antes de clonar ou excluir o catálogo.' : 'Resolva ou remova os envios pendentes antes de clonar. Eles serão descartados se o catálogo for excluído.'}</p> : null}
            <button type="button" onClick={() => void handleSyncTiktok()} disabled={syncing || validCount === 0}>
              {syncing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} Sincronizar agora
            </button>
            <button type="button" onClick={() => setConfirmClone(true)} disabled={cloning || !catalog || hasCreativeLocalWork} title={hasCreativeLocalWork ? 'Conclua ou remova os envios pendentes antes de clonar.' : undefined}>
              {cloning ? <Loader2 className="size-3.5 animate-spin" /> : <CopyPlus className="size-3.5" />} Clonar catálogo
            </button>
            {publications.length > 0 && (
              <button type="button" onClick={() => {
                const element = document.getElementById('catalog-technical-details')
                if (element instanceof HTMLDetailsElement) element.open = true
                element?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }}>
                <History className="size-3.5" /> Histórico de sincronização
              </button>
            )}
            <button type="button" className="text-error" onClick={() => setDeleteTarget({ kind: 'catalog', name: catalog?.name || 'catálogo' })} disabled={localUploading} title={localUploading ? 'Conclua ou cancele o envio atual antes de excluir o catálogo.' : undefined}>
              <Trash2 className="size-3.5" /> Excluir catálogo
            </button>
          </div>
        </details>
      </div>

      {isLoading && !data ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" aria-hidden="true" />
        </div>
      ) : (
        <>
          {/* ── CABEÇALHO ENXUTO: estado normal vira uma linha, não três cartões ── */}
          <section className="catalog-detail-hero">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-base font-bold text-foreground">{catalog?.name || 'Catálogo'}</h2>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">{catalog?.currency || 'BRL'}</span>
                  {catalog?.linkStatus === 'verified' ? <><span>·</span><span className="inline-flex items-center gap-1"><span className="size-1.5 rounded-full bg-success" /> Sincronizado</span></> : <><span>·</span><span className="text-warning">TikTok não vinculado</span></>}
                  {catalog?.automation?.sourceUrl && <><span>·</span><a href={catalog.automation.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline"><Link2 className="size-3" /> Página original</a></>}
                </div>
              </div>

              {readinessData?.readiness?.readyForCampaign && (
                <button
                  type="button"
                  className="btn-primary min-h-10 shrink-0 gap-1.5 px-3.5 text-sm font-semibold"
                  onClick={async () => {
                    try { await mutate(); setQuickCampaignsOpen(true) }
                    catch (error) { toast.error('Não foi possível atualizar os vídeos', { hint: error instanceof Error ? error.message : undefined }) }
                  }}
                  disabled={localUploading || localPending > 0 || !catalog || catalogCapabilities?.catalogSingleVideoCampaign !== true}
                  title="Criar campanhas de conversão"
                >
                  <Rocket className="size-3.5" aria-hidden="true" /> Criar campanha
                </button>
              )}
            </div>

            <div className={`catalog-healthline ${publishFailed || invalidCount > 0 || reviewIssueCount > 0 ? 'catalog-healthline--warning' : ''}`}>
              {syncing || bgPublishing ? (
                <><Loader2 className="size-3.5 animate-spin text-primary" /><span><strong>Sincronizando alterações…</strong> você pode continuar trabalhando.</span></>
              ) : publishFailed || catalog?.automation?.syncIssue ? (
                <><AlertCircle className="size-3.5 text-warning" /><span className="min-w-0 flex-1">{publishFailureHint || catalog?.automation?.syncIssue?.message || 'A sincronização precisa ser retomada.'}</span><button type="button" className="text-xs font-semibold text-primary" onClick={() => void handleSyncTiktok()}>Tentar novamente</button></>
              ) : invalidCount > 0 ? (
                <><AlertCircle className="size-3.5 text-warning" /><span><strong>{invalidCount} produto{invalidCount === 1 ? '' : 's'} precisa{invalidCount === 1 ? '' : 'm'} de correção.</strong></span><button type="button" className="text-xs font-semibold text-primary" onClick={handleMagicFix} disabled={fixing}>{fixing ? 'Corrigindo…' : 'Corrigir automaticamente'}</button></>
              ) : reviewIssueCount > 0 ? (
                <><AlertCircle className="size-3.5 text-warning" /><span><strong>{reviewIssueCount} item{reviewIssueCount === 1 ? '' : 's'} em análise ou com erro no TikTok.</strong></span></>
              ) : (
                <><Check className="size-3.5 text-success" /><span><strong>{displayedRemoteCount > 0 && !hasUnpublishedChanges ? 'Produtos confirmados no TikTok' : 'Produtos cadastrados'}</strong> · {validCount} produto{validCount === 1 ? '' : 's'}{hasUnpublishedChanges ? ' · sincronização automática pendente' : ''}</span></>
              )}
            </div>
          </section>

          <CatalogReadinessCard
            readiness={readinessData?.readiness}
            loading={readinessLoading}
            onAction={handleReadinessAction}
          />

          <CatalogSyncStatus catalogId={catalogId} advertiserId={advertiserId} refreshToken={syncStatusVersion} onProgress={refreshProgress} />

          {catalog && (
            <section className="catalog-detail-section">
              <CatalogCreatives
                key={catalog.id + advertiserId}
                value={catalog.creatives || []}
                onBusyChange={setCreativeBusy}
                onPendingChange={setCreativePending}
                onAdd={async creative => {
                  await apiSend(adsCatalogApiUrl(`/api/ads/catalogs/${encodeURIComponent(catalogId)}/creatives`, advertiserId), 'POST', { creatives: [creative] })
                  await mutate()
                }}
                onRemove={async creative => {
                  await apiSend(adsCatalogApiUrl(`/api/ads/catalogs/${encodeURIComponent(catalogId)}/creatives/${encodeURIComponent(creative.id)}`, advertiserId), 'DELETE')
                  await mutate()
                }}
              />
            </section>
          )}

          {/* ── PRODUTOS: uma lista, uma ação principal e exceções visíveis ── */}
          <section className="catalog-detail-section">
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2"><h3 className="text-sm font-semibold text-foreground">Produtos</h3><span className="text-xs tabular-nums text-muted-foreground">{products.length}</span></div>
                  <p className="mt-1 text-xs text-muted-foreground">Quando a conexão estiver pronta, alterações válidas são sincronizadas automaticamente com o TikTok.</p>
                </div>
                <details className="catalog-actions-menu relative">
                  <summary className="btn-ghost !size-10 cursor-pointer list-none justify-center p-0" aria-label="Mais opções de produtos" title="Mais opções">
                    <MoreHorizontal className="size-4" aria-hidden="true" />
                  </summary>
                  <div className="catalog-actions-popover">
                    <button type="button" onClick={() => setEditing('new')}><Plus className="size-3.5" /> Adicionar manualmente</button>
                    <input ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) handleImport(file) }} />
                    <button type="button" onClick={() => fileRef.current?.click()} disabled={importing}>
                      {importing ? <Loader2 className="size-3.5 animate-spin" /> : <UploadCloud className="size-3.5" />} Importar CSV
                    </button>
                    <a href={adsCatalogApiUrl(`/api/ads/catalogs/${encodeURIComponent(catalogId)}/export.csv`, advertiserId)}>
                      <Download className="size-3.5" /> Baixar modelo CSV
                    </a>
                  </div>
                </details>
              </div>

              <div className="flex gap-2">
                <input
                  className="input-base min-h-10 min-w-0 flex-1 text-sm"
                  value={urlValue}
                  onChange={(event) => setUrlValue(event.target.value)}
                  placeholder="Cole o link de um produto para adicionar automaticamente…"
                  inputMode="url"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) handleUrlPreview()
                  }}
                />
                <button type="button" className="btn-secondary min-h-10 shrink-0 px-3 text-sm font-semibold" onClick={handleUrlPreview} disabled={urlImporting || !urlValue.trim()}>
                  {urlImporting ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Plus className="size-3.5" aria-hidden="true" />}
                  Adicionar
                </button>
              </div>
            </div>

            {!bcConfigured && (
              <div className="catalog-healthline catalog-healthline--warning mt-3">
                <AlertCircle className="size-3.5 shrink-0 text-warning" aria-hidden="true" />
                <span>Business Center não configurado. Os produtos continuam salvos localmente.</span>
              </div>
            )}

            {products.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
                <PackageOpen className="size-7 text-muted-foreground/40" aria-hidden="true" />
                <p className="text-xs font-semibold text-foreground">Nenhum produto cadastrado</p>
                <p className="max-w-sm text-xs text-muted-foreground">Cole um link acima ou use o menu para adicionar manualmente.</p>
              </div>
            ) : (
              <div className="catalog-product-table mt-3 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr>
                      <th className="px-2 py-2 text-xs font-semibold text-muted-foreground">Produto</th>
                      <th className="w-28 px-2 py-2 text-xs font-semibold text-muted-foreground">Preço</th>
                      <th className="hidden w-28 px-2 py-2 text-xs font-semibold text-muted-foreground md:table-cell">Estoque</th>
                      <th className="w-10 px-2 py-2"><span className="sr-only">Ações</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {orderedProducts.map((p) => {
                      const title = p.data.title || p.skuId || 'Sem título'
                      const image = p.data.image_link
                      const price = p.data.price
                      return (
                        <tr
                          key={p.id}
                          draggable
                          onClick={() => setEditing(p)}
                          onDragStart={() => setDragProductId(p.id)}
                          onDragEnd={() => setDragProductId(null)}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={() => {
                            if (!dragProductId || dragProductId === p.id) return
                            const next = productOrder.filter((id) => id !== dragProductId)
                            next.splice(next.indexOf(p.id), 0, dragProductId)
                            setDragProductId(null)
                            void persistProductOrder(next)
                          }}
                          className={`group cursor-pointer transition-colors ${dragProductId === p.id ? 'opacity-40' : ''}`}
                          title="Clique para editar"
                        >
                          <td className="px-2 py-2.5 max-w-[360px]">
                            <div className="flex min-w-0 items-center gap-2.5">
                              <span className="shrink-0 cursor-grab text-muted-foreground/45 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100" onClick={(event) => event.stopPropagation()}><GripVertical className="size-3.5" aria-label="Arraste para reorganizar" /></span>
                              {image ? (
                                <img src={image} alt="" className="size-8 shrink-0 rounded object-cover border border-border/70 bg-secondary" onError={(e) => { (e.target as HTMLElement).style.display = 'none' }} />
                              ) : (
                                <div className="flex size-8 shrink-0 items-center justify-center rounded border border-border/70 bg-secondary/50 text-muted-foreground"><ImageIcon className="size-4" /></div>
                              )}
                              <div className="min-w-0">
                                <div className="flex min-w-0 items-center gap-2">
                                  <p className="truncate font-medium text-foreground" title={title}>{title}</p>
                                  {!p.valid && <span className="shrink-0 text-xs font-medium text-warning" title={p.errors.map((e) => `${e.field}: ${e.message}`).join('\n')}>{p.errors.length} erro{p.errors.length === 1 ? '' : 's'}</span>}
                                </div>
                                <p className="truncate text-xs text-muted-foreground">{p.skuId}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-2 py-2.5 font-medium text-foreground whitespace-nowrap">{catalogDisplayPrice(price, catalog?.currency || 'BRL')}</td>
                          <td className="hidden px-2 py-2.5 text-muted-foreground whitespace-nowrap md:table-cell">{p.data.availability === 'in stock' ? 'Em estoque' : p.data.availability || 'Em estoque'}</td>
                          <td className="px-2 py-2.5 text-right" onClick={(event) => event.stopPropagation()}>
                            <details className="catalog-row-menu relative inline-block">
                              <summary className="btn-ghost !size-10 cursor-pointer list-none justify-center p-0 text-muted-foreground" aria-label={`Ações de ${title}`}><MoreHorizontal className="size-3.5" /></summary>
                              <div className="catalog-row-popover">
                                <button type="button" onClick={() => handleDuplicate(p)}><CopyPlus className="size-3.5" /> Duplicar</button>
                                <button type="button" className="text-error" onClick={() => setDeleteTarget({ kind: 'product', id: p.id, name: p.data.title || p.skuId })}><Trash2 className="size-3.5" /> Remover</button>
                              </div>
                            </details>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* ── LANÇAMENTO DE CAMPANHAS DE CATÁLOGO ── */}
          {catalog && (
            <CatalogCampaignWizard
              catalog={catalog}
              advertiserId={advertiserId}
              advertiserCurrency={advertiserCurrency}
              hideLaunchButton
              ready={Boolean(readinessData?.readiness?.readyForCampaign)}
              capabilities={catalogCapabilities}
            />
          )}

          {/* ── DIAGNÓSTICO TÉCNICO & CONEXÕES (Recolhido para máxima limpeza visual) ── */}
          <details id="catalog-technical-details" className="group rounded-2xl border border-border/80 bg-card/40 p-4 shadow-sm">
            <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-semibold text-muted-foreground hover:text-foreground">
              <span className="flex items-center gap-2">
                <SlidersHorizontal className="size-4" aria-hidden="true" />
                Diagnóstico e detalhes técnicos
              </span>
              <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <div className="mt-4 flex flex-col gap-4 border-t border-border/50 pt-4">
              {catalog && (
                <CatalogConnectionCard
                  catalog={catalog}
                  advertiserId={advertiserId}
                  bcId={bcId}
                  onChanged={() => Promise.all([mutate(), mutateReadiness(), onBusinessCenterChanged()])}
                />
              )}
              {catalog?.tiktokCatalogId && catalog.linkStatus === 'verified' && (
                <TiktokStatusPanel
                  catalog={catalog}
                  localProductCount={validCount}
                  auditing={auditing}
                  autoChecking={autoChecking}
                  catalogCampaignSupported={catalogCapabilities?.catalogSingleVideoCampaign === true}
                  onRefresh={handleRefreshAudit}
                />
              )}
              {publications.length > 0 && (
                <div className="flex flex-col gap-2">
                  <h4 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <History className="size-3.5 text-muted-foreground" aria-hidden="true" /> Histórico de sincronização ({publications.length})
                  </h4>
                  <ol className="flex flex-col gap-2">
                    {publications.slice(0, 10).map((publication) => (
                      <li key={publication.id} className="flex items-start justify-between gap-3 border-t border-border/45 py-3 first:border-0">
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-foreground">
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
                          <p className={`text-xs ${publication.status === 'error' ? 'text-error' : publication.kind === 'tiktok' && publication.published === 0 ? 'text-warning' : 'text-muted-foreground'}`}>
                            {publication.status === 'error'
                              ? publication.error || 'O TikTok recusou o envio.'
                              : publication.published > 0
                                ? `${publication.published} enviado(s)${publication.skipped > 0 ? ` · ${publication.skipped} ignorado(s)` : ''}`
                                : 'Nenhum produto foi enviado'}
                          </p>
                        </div>
                        <time className="shrink-0 text-xs text-muted-foreground" dateTime={publication.createdAt}>
                          {new Date(publication.createdAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })}
                        </time>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          </details>
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
            await refreshAndAutoSync()
            toast.success('Produto salvo', { hint: bcConfigured ? 'Sincronização iniciada automaticamente quando o produto estiver válido.' : 'Salvo localmente. A sincronização começará quando a conexão estiver pronta.' })
          }}
        />
      )}
      {catalog && (
        <CatalogQuickCampaignsDialog
          catalog={catalog}
          advertiserId={advertiserId}
          advertiserCurrency={advertiserCurrency || 'BRL'}
          capabilities={catalogCapabilities}
          open={quickCampaignsOpen}
          onClose={() => { setQuickCampaignsOpen(false); void mutate() }}
          onAssetsChanged={() => { void mutate() }}
          onLocalWorkStateChange={setQuickCampaignWork}
          onCreated={() => {
            void mutate()
          }}
        />
      )}

      <ConfirmDialog
        open={confirmBack}
        appearance="quiet"
        title={localUploading ? 'Voltar e cancelar o envio?' : 'Voltar e descartar os envios pendentes?'}
        description={localUploading
          ? 'Há vídeos sendo enviados. Voltar para a lista cancela os uploads ainda não concluídos. Vídeos já enviados permanecem vinculados.'
          : 'Há vídeos que ainda não foram concluídos ou que aguardam nova tentativa. Voltar descartará esse estado local. Vídeos já enviados permanecem vinculados.'}
        confirmLabel={localUploading ? 'Voltar e cancelar' : 'Voltar'}
        tone="danger"
        onConfirm={() => { setConfirmBack(false); onBack() }}
        onClose={() => setConfirmBack(false)}
      />

      <ConfirmDialog
        open={confirmClone}
        appearance="quiet"
        title="Clonar este catálogo?"
        description="Será criada uma cópia independente com os mesmos produtos. Se a conexão com o TikTok estiver pronta, a sincronização do novo catálogo poderá começar automaticamente."
        confirmLabel="Clonar catálogo"
        busy={cloning}
        onConfirm={handleClone}
        onClose={() => { if (!cloning) setConfirmClone(false) }}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={deleteTarget?.kind === 'catalog' ? 'Excluir catálogo local?' : 'Remover produto do catálogo?'}
        description={deleteTarget?.kind === 'catalog'
          ? <>Todos os produtos e o histórico local serão removidos. O catálogo remoto no TikTok não será apagado.{localPending > 0 && !localUploading ? ' Os envios locais pendentes e as tentativas disponíveis também serão descartados.' : ''} Essa ação não pode ser desfeita.</>
          : <>O produto <strong className="text-foreground">{deleteTarget?.name}</strong> será removido do catálogo local. Se a conexão com o TikTok estiver pronta, a sincronização da alteração será iniciada automaticamente.</>}
        confirmLabel={deleteTarget?.kind === 'catalog' ? 'Excluir catálogo' : 'Remover produto'}
        appearance="quiet"
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
export function TiktokStatusPanel({
  catalog,
  localProductCount,
  auditing,
  autoChecking,
  catalogCampaignSupported,
  onRefresh,
}: {
  catalog: AdsCatalog
  localProductCount: number
  auditing: boolean
  autoChecking: boolean
  catalogCampaignSupported: boolean
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
  const localOnlyCount = total > 0 ? Math.max(0, localProductCount - total) : 0
  const syncedAt = catalog.syncedAt ? new Date(catalog.syncedAt) : null

  function copyId() {
    if (!catalog.tiktokCatalogId) return
    navigator.clipboard?.writeText(catalog.tiktokCatalogId).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <section className="border-y border-border/60 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            {catalogSynced ? (
              <ShieldCheck className="size-4 text-success" aria-hidden="true" />
            ) : (
              <Clock className="size-4 text-warning" aria-hidden="true" />
            )}
            {catalogSynced
              ? `${total} produto${total === 1 ? '' : 's'} pronto${total === 1 ? '' : 's'} no TikTok`
              : productsNotConfirmed
                ? 'Catálogo vinculado — produtos ainda não confirmados'
                : pending > 0
                  ? 'TikTok analisando os produtos'
                  : rejected > 0
                    ? 'Revisão concluída com reprovações'
                    : 'Status dos produtos requer atenção'}
          </p>
          {autoChecking && (
            <p className="flex items-center gap-1 text-xs text-muted-foreground" role="status">
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

      {audit && total > 0 && (
        <p className="text-xs text-muted-foreground">
          <span className="text-success">{approved} aprovado{approved === 1 ? '' : 's'}</span>
          {pending > 0 && <> · <span className="text-warning">{pending} em análise</span></>}
          {rejected > 0 && <> · <span className="text-error">{rejected} reprovado{rejected === 1 ? '' : 's'}</span></>}
        </p>
      )}
    </section>
  )
}
