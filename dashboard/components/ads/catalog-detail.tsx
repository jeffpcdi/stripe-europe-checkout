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
  Link2, ChevronDown, History, CopyPlus, SearchCheck, RotateCcw, GripVertical,
  Rocket, SlidersHorizontal, Sparkles,
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
  const [fixing, setFixing] = useState(false)
  const [quickCampaignsOpen, setQuickCampaignsOpen] = useState(false)
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
  const auditAttemptsRef = useRef(0)

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
      await Promise.all([mutate(), mutateReadiness()])
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
  async function handleSyncTiktok() {
    if (syncLockRef.current) return
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
      setPublishFailureHint(hint || 'Verifique a conexão e tente novamente.')
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

  async function handleMagicFix() {
    setFixing(true)
    try {
      const res = await fetch(adsCatalogApiUrl(`/api/ads/catalogs/${encodeURIComponent(catalogId)}/magic-fix`, advertiserId), {
        method: 'POST',
        credentials: 'include',
      })
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        throw new Error(errorData.error || `Erro ${res.status}`)
      }
      const data = await res.json()
      if (data.fixedCount > 0) {
        toast.success(`${data.fixedCount} produto(s) corrigido(s) com sucesso!`)
        await mutate()
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
        const res = await fetch(adsCatalogApiUrl(`/api/ads/catalogs/${encodeURIComponent(catalogId)}/audit`, advertiserId), { credentials: 'include' })
        if (!res.ok) throw new Error(`Erro ${res.status}`)
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

  async function handleClone() {
    if (cloning) return
    setCloning(true)
    try {
      const res = await apiSend<{ catalog: AdsCatalog; productCount: number; syncStarted: boolean }>(
        adsCatalogApiUrl(`/api/ads/catalogs/${encodeURIComponent(catalogId)}/clone`, advertiserId), 'POST', {},
      )
      if (res.syncStarted) {
        toast.success(`Catálogo clonado com ${res.productCount} produto(s) — publicação iniciada`, {
          hint: 'Acompanhe o progresso no catálogo clonado.',
        })
      } else {
        toast.success(`Catálogo clonado com ${res.productCount} produto(s)`, {
          hint: 'Sincronize ao TikTok manualmente quando estiver pronto.',
        })
      }
      onCloned(res.catalog.id)
    } catch (e) {
      toast.error('Falha ao clonar o catálogo', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setCloning(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <button type="button" className="btn-ghost text-xs" onClick={onBack}>
          <ChevronLeft className="size-3.5" aria-hidden="true" />
          Voltar
        </button>
        <div className="flex items-center gap-1">
          <button type="button" className="btn-ghost text-xs" onClick={handleClone} disabled={cloning || !catalog}>
            {cloning ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <CopyPlus className="size-3.5" aria-hidden="true" />}
            Clonar
          </button>
          <button type="button" className="btn-ghost text-xs text-error" onClick={() => setDeleteTarget({ kind: 'catalog', name: catalog?.name || 'catálogo' })}>
            <Trash2 className="size-3.5" aria-hidden="true" />
            Excluir
          </button>
        </div>
      </div>

      {isLoading && !data ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" aria-hidden="true" />
        </div>
      ) : (
        <>
          {/* ── CARD DE STATUS DE SAÚDE CONSOLIDADO ── */}
          <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 sm:p-5 shadow-sm">
            {/* Header & Ações Rápidas de Alto Contraste */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col gap-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-bold text-foreground truncate">{catalog?.name || 'Catálogo'}</h2>
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    catalog?.linkStatus === 'verified' && (catalog.audit?.approved ?? 0) > 0
                      ? 'bg-success/15 text-success border border-success/30'
                      : catalog?.linkStatus === 'verified' && (catalog.audit?.pending ?? 0) > 0
                      ? 'bg-warning/15 text-warning border border-warning/30'
                      : hasUnpublishedChanges
                      ? 'bg-warning/15 text-warning border border-warning/30'
                      : 'bg-secondary text-muted-foreground border border-border'
                  }`}>
                    <span className={`size-1.5 rounded-full ${
                      catalog?.linkStatus === 'verified' && (catalog.audit?.approved ?? 0) > 0
                        ? 'bg-success'
                        : catalog?.linkStatus === 'verified' && (catalog.audit?.pending ?? 0) > 0
                        ? 'bg-warning animate-pulse'
                        : 'bg-muted-foreground'
                    }`} />
                    {catalog?.linkStatus === 'verified' && (catalog.audit?.approved ?? 0) > 0
                      ? 'Saudável'
                      : catalog?.linkStatus === 'verified' && (catalog.audit?.pending ?? 0) > 0
                      ? 'Sincronizando'
                      : hasUnpublishedChanges
                      ? 'Aguardando sincronização'
                      : 'Vinculado'}
                  </span>
                </div>
                <p className="text-xs text-muted">
                  Moeda: <strong className="text-foreground">{catalog?.currency || 'BRL'}</strong>
                  {catalog?.tiktokCatalogId ? (
                    <span> · ID TikTok: <span className="font-mono text-foreground">{catalog.tiktokCatalogId}</span></span>
                  ) : (
                    <span> · <span className="text-warning font-medium">Não vinculado ao TikTok</span></span>
                  )}
                </p>
              </div>

              {/* Botões de Ação de Alto Contraste (Mais Utilizados) */}
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  className="btn-secondary gap-2 text-xs font-semibold px-3.5 py-2 border-border/80 shadow-xs hover:bg-secondary"
                  onClick={handleSyncTiktok}
                  disabled={syncing || validCount === 0}
                  title="Sincroniza os produtos com o TikTok"
                >
                  {syncing ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="size-4 text-primary" aria-hidden="true" />}
                  Sincronizar Feed
                </button>

                <button
                  type="button"
                  className="btn-primary gap-2 text-xs font-semibold px-4 py-2"
                  onClick={() => setQuickCampaignsOpen(true)}
                  disabled={!catalog || validCount === 0}
                  title="Cria campanhas de conversão em lote para este catálogo"
                >
                  <Rocket className="size-4" aria-hidden="true" />
                  Criar Campanhas em Massa
                </button>
              </div>
            </div>

            {/* Falha de início */}
            {publishFailed && validCount > 0 && (
              <div className="flex flex-col gap-2 rounded-xl border border-warning/40 bg-warning/5 p-3 sm:p-4">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                  <AlertCircle className="size-4 text-warning" aria-hidden="true" />
                  Sincronização automática não iniciada
                </p>
                <p className="text-pretty text-[11px] leading-relaxed text-muted-foreground">
                  {publishFailureHint || 'Os produtos permanecem salvos. Corrija o requisito indicado e tente novamente.'}
                </p>
                <button type="button" className="btn-primary w-fit text-xs" onClick={handleSyncTiktok} disabled={syncing}>
                  {syncing ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <RotateCcw className="size-3.5" aria-hidden="true" />} Tentar sincronização automática
                </button>
              </div>
            )}

            {/* Métricas de Saúde Objetivas */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {/* Produtos Ativos */}
              <div className="flex items-center gap-3 rounded-xl border border-success/20 bg-success/5 p-3.5">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-success/15 text-success">
                  <Check className="size-5" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <div className="text-lg font-bold text-foreground">{validCount}</div>
                  <div className="text-xs font-medium text-success">Produtos Ativos</div>
                </div>
              </div>

              {/* Sincronizados */}
              <div className="flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 p-3.5">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                  <UploadCloud className="size-5" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <div className="text-lg font-bold text-foreground">
                    {remoteProductCount > 0 ? remoteProductCount : catalog?.audit?.approved ?? 0}
                  </div>
                  <div className="text-xs font-medium text-primary">Sincronizados no TikTok</div>
                </div>
              </div>

              {/* Pendentes / Erros */}
              <div className="flex items-center gap-3 rounded-xl border border-warning/20 bg-warning/5 p-3.5">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-warning/15 text-warning">
                  <AlertCircle className="size-5" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <div className="text-lg font-bold text-foreground">
                    {localOnlyCount + (products.length - validCount)}
                  </div>
                  <div className="text-xs font-medium text-warning">
                    Pendentes / Com Erros
                  </div>
                </div>
              </div>
            </div>

            {/* Auto-Correção expressa com IA */}
            {products.some((p) => !p.valid || (p.errors && p.errors.length > 0)) && (
              <button
                type="button"
                className="btn-primary w-full text-xs py-2.5"
                onClick={handleMagicFix}
                disabled={fixing}
              >
                {fixing ? <Loader2 className="size-4 animate-spin mr-2" aria-hidden="true" /> : <Sparkles className="size-4 mr-2" aria-hidden="true" />}
                Resolver erros dos produtos automaticamente ✨
              </button>
            )}
          </div>

          {/* ── GESTÃO DIRETA DE PRODUTOS ── */}
          <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 sm:p-5 shadow-sm">
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-foreground">Produtos do Catálogo</h3>
                  <p className="text-xs text-muted-foreground">
                    {products.length} {products.length === 1 ? 'produto cadastrado' : 'produtos cadastrados'}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" className="btn-secondary text-xs" onClick={() => setEditing('new')}>
                    <Plus className="size-3.5" aria-hidden="true" /> Novo Produto
                  </button>
                  <input ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) handleImport(file) }} />
                  <button type="button" className="btn-ghost text-xs" onClick={() => fileRef.current?.click()} disabled={importing}>
                    {importing ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <UploadCloud className="size-3.5" aria-hidden="true" />} Enviar CSV
                  </button>
                  <a className="btn-ghost text-xs" href={adsCatalogApiUrl(`/api/ads/catalogs/${encodeURIComponent(catalogId)}/export.csv`, advertiserId)}>
                    <Download className="size-3.5" aria-hidden="true" /> Baixar Modelo
                  </a>
                </div>
              </div>

              {/* Importação Rápida por Link */}
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  className="input-base min-w-0 flex-1 text-xs"
                  value={urlValue}
                  onChange={(event) => setUrlValue(event.target.value)}
                  placeholder="Cole o link do produto (ex: https://sualoja.com/produto-exemplo) para importar com IA..."
                  inputMode="url"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) handleUrlPreview()
                  }}
                />
                <button
                  type="button"
                  className="btn-primary shrink-0 text-xs font-semibold px-4"
                  onClick={handleUrlPreview}
                  disabled={urlImporting || !urlValue.trim()}
                >
                  {urlImporting ? <Loader2 className="size-3.5 animate-spin mr-1.5" aria-hidden="true" /> : <SearchCheck className="size-3.5 mr-1.5" aria-hidden="true" />}
                  Importar Link
                </button>
              </div>
            </div>

            {/* A ausência de BC bloqueia a publicação, mas nunca perde produtos */}
            {!bcConfigured && (
              <div className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/5 p-3 text-[11px] text-muted-foreground">
                <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden="true" />
                <span className="text-pretty">
                  A conexão com a organização TikTok ainda não foi detectada. Seus produtos permanecem salvos localmente.
                </span>
              </div>
            )}

            {/* Lista/Tabela de Produtos Clara e Visível */}
            {products.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-10 text-center">
                <PackageOpen className="size-8 text-muted-foreground/60" aria-hidden="true" />
                <p className="text-sm font-semibold text-foreground">Nenhum produto cadastrado</p>
                <p className="text-xs text-muted-foreground max-w-sm">
                  Cole o link de uma página da sua loja acima para importar automaticamente ou adicione manualmente.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border bg-background">
                <table className="w-full text-left text-xs">
                  <thead className="bg-secondary/50 text-muted-foreground border-b border-border">
                    <tr>
                      <th className="px-3 py-2.5 font-medium w-24">Status</th>
                      <th className="px-3 py-2.5 font-medium">Produto / SKU</th>
                      <th className="px-3 py-2.5 font-medium">Preço</th>
                      <th className="px-3 py-2.5 font-medium hidden md:table-cell">Disponibilidade</th>
                      <th className="px-3 py-2.5 font-medium text-right w-28">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {orderedProducts.map((p) => {
                      const title = p.data.title || p.skuId || 'Sem título'
                      const image = p.data.image_link
                      const price = p.data.price
                      return (
                        <tr
                          key={p.id}
                          draggable
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
                          className={`group text-xs transition-colors hover:bg-secondary/20 ${dragProductId === p.id ? 'opacity-40' : ''}`}
                        >
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            <GripVertical className="mr-1.5 inline size-3.5 cursor-grab text-muted-foreground/60 hover:text-foreground" aria-label="Arraste para reorganizar" />
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
                          <td className="px-3 py-2.5 max-w-[280px]">
                            <div className="flex items-center gap-2.5 min-w-0">
                              {image ? (
                                <img src={image} alt="" className="size-8 rounded object-cover border border-border shrink-0 bg-secondary" onError={(e) => { (e.target as HTMLElement).style.display = 'none' }} />
                              ) : (
                                <div className="flex size-8 items-center justify-center rounded border border-border bg-secondary text-muted-foreground shrink-0">
                                  <ImageIcon className="size-4" />
                                </div>
                              )}
                              <div className="min-w-0">
                                <p className="truncate font-medium text-foreground" title={title}>{title}</p>
                                <p className="text-[10px] text-muted-foreground font-mono">{p.skuId}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2.5 font-medium text-foreground whitespace-nowrap">
                            {price ? `${catalog?.currency || 'BRL'} ${price}` : <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="px-3 py-2.5 text-muted-foreground hidden md:table-cell whitespace-nowrap">
                            {p.data.availability === 'in stock' ? 'Em estoque' : p.data.availability || 'Em estoque'}
                          </td>
                          <td className="px-3 py-2.5 text-right whitespace-nowrap">
                            <div className="flex items-center justify-end gap-1">
                              <button type="button" className="btn-ghost p-1.5 text-xs text-muted-foreground hover:text-foreground" onClick={() => setEditing(p)} title="Editar produto">
                                <Pencil className="size-3.5" aria-hidden="true" />
                              </button>
                              <button type="button" className="btn-ghost p-1.5 text-xs text-muted-foreground hover:text-foreground" onClick={() => handleDuplicate(p)} title="Duplicar produto">
                                <CopyPlus className="size-3.5" aria-hidden="true" />
                              </button>
                              <button type="button" className="btn-ghost p-1.5 text-xs text-error hover:bg-error/10" onClick={() => setDeleteTarget({ kind: 'product', id: p.id, name: p.data.title || p.skuId })} title="Remover produto">
                                <Trash2 className="size-3.5" aria-hidden="true" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── LANÇAMENTO DE CAMPANHAS DE CATÁLOGO ── */}
          {catalog && (
            <CatalogCampaignWizard
              catalog={catalog}
              advertiserId={advertiserId}
              advertiserCurrency={advertiserCurrency}
              ready={Boolean(readinessData?.readiness.readyForCampaign)}
              capabilities={catalogCapabilities}
            />
          )}

          {/* ── DIAGNÓSTICO TÉCNICO & CONEXÕES (Recolhido para máxima limpeza visual) ── */}
          <details className="group rounded-2xl border border-border/80 bg-card/40 p-4 shadow-sm">
            <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-semibold text-muted-foreground hover:text-foreground">
              <span className="flex items-center gap-2">
                <SlidersHorizontal className="size-4" aria-hidden="true" />
                Diagnóstico técnico, feeds e detalhes de conexão
              </span>
              <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <div className="mt-4 flex flex-col gap-4 border-t border-border/50 pt-4">
              <CatalogReadinessCard
                readiness={readinessData?.readiness}
                loading={readinessLoading}
                onAction={readinessData?.readiness.nextAction === 'create_campaign'
                  ? undefined
                  : handleReadinessAction}
              />
              <CatalogSyncStatus catalogId={catalogId} advertiserId={advertiserId} refreshToken={syncStatusVersion} />
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
            await Promise.all([mutate(), mutateReadiness()])
          }}
        />
      )}
      {catalog && (
        <CatalogQuickCampaignsDialog
          catalog={catalog}
          advertiserId={advertiserId}
          advertiserCurrency={catalog.currency || 'BRL'}
          capabilities={catalogCapabilities}
          open={quickCampaignsOpen}
          onClose={() => setQuickCampaignsOpen(false)}
          onCreated={() => {
            setQuickCampaignsOpen(false)
            void mutate()
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

      {/* Auditoria dos produtos */}
      {audit && total > 0 && (
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2.5 py-1 text-[11px] font-semibold text-success">
            {approved} aprovado{approved === 1 ? '' : 's'}
          </span>
          {pending > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2.5 py-1 text-[11px] font-semibold text-warning">
              {pending} em análise
            </span>
          )}
          {rejected > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-error/15 px-2.5 py-1 text-[11px] font-semibold text-error">
              {rejected} reprovado{rejected === 1 ? '' : 's'}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
