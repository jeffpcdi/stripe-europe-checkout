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
  Link2, ChevronDown, History, CopyPlus, SearchCheck, RotateCcw, GripVertical, OctagonAlert,
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
  const [productOrder, setProductOrder] = useState<string[]>([])
  const [dragProductId, setDragProductId] = useState<string | null>(null)
  const [showDeadStockOnly, setShowDeadStockOnly] = useState(false)
  
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
    
  // Mock condition for Dead Stock: Products with price > 100 for demonstration purposes
  const isDeadStock = (p: AdsCatalogProduct) => Number(p.data.price || 0) > 100
  
  const displayedProducts = showDeadStockOnly ? orderedProducts.filter(isDeadStock) : orderedProducts

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
          <div className="px-1 py-1">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">{catalog?.name}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {remoteProductCount > 0
                  ? `${remoteProductCount} produto${remoteProductCount === 1 ? '' : 's'} no TikTok`
                  : `${validCount} produto${validCount === 1 ? '' : 's'} pronto${validCount === 1 ? '' : 's'} para enviar`}
                {' · '}{catalog?.currency}
                {localOnlyCount > 0 && <span className="font-semibold text-warning"> · {localOnlyCount} salvo{localOnlyCount === 1 ? '' : 's'} apenas na dashboard</span>}
                {remoteProductCount === 0 && hasUnpublishedChanges && <span className="font-semibold text-warning"> · aguardando sincronização</span>}
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
                {publishFailureHint || 'Os produtos permanecem salvos. Corrija o requisito indicado e tente novamente.'}
              </p>
              <button type="button" className="btn-primary w-fit text-xs" onClick={handleSyncTiktok} disabled={syncing}>
                {syncing ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <RotateCcw className="size-3.5" aria-hidden="true" />} Tentar sincronização automática
              </button>
            </div>
          )}

          <CatalogReadinessCard
            readiness={readinessData?.readiness}
            loading={readinessLoading}
            onAction={readinessData?.readiness.nextAction === 'create_campaign'
              ? undefined
              : handleReadinessAction}
          />


          <CatalogSyncStatus catalogId={catalogId} advertiserId={advertiserId} refreshToken={syncStatusVersion} />

          {catalog && !bcConfigured && (
            <details open={!bcConfigured} className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-xl border border-border bg-background px-3 py-2.5 text-xs font-semibold text-foreground">
                <span className="flex items-center gap-1.5">
                  <AlertCircle className="size-3.5 text-warning" aria-hidden="true" />
                  Conexão com o TikTok · configurar
                </span>
                <ChevronDown className="size-3.5 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              <div className="mt-2">
                <CatalogConnectionCard
                  catalog={catalog}
                  advertiserId={advertiserId}
                  bcId={bcId}
                  onChanged={() => Promise.all([mutate(), mutateReadiness(), onBusinessCenterChanged()])}
                />
              </div>
            </details>
          )}

          {/* STEP 1: Origem dos Produtos */}
          <div className="flex flex-col gap-4 rounded-2xl border border-white/5 bg-background/40 backdrop-blur-md p-5 shadow-lg">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <SearchCheck className="size-4 text-primary" /> Importar Produtos
              </h3>
              
              <div className="flex items-center gap-2">
                <button type="button" className="btn-ghost text-[10px] h-7 px-2 hover:bg-secondary/50 text-muted-foreground hover:text-foreground" onClick={() => setEditing('new')}>
                  <Plus className="size-3" aria-hidden="true" /> Manual
                </button>
                <input ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) handleImport(file) }} />
                <button type="button" className="btn-ghost text-[10px] h-7 px-2 hover:bg-secondary/50 text-muted-foreground hover:text-foreground" onClick={() => fileRef.current?.click()} disabled={importing}>
                  {importing ? <Loader2 className="size-3 animate-spin" aria-hidden="true" /> : <UploadCloud className="size-3" aria-hidden="true" />} CSV
                </button>
                <a className="btn-ghost text-[10px] h-7 px-2 hover:bg-secondary/50 text-muted-foreground hover:text-foreground" href={adsCatalogApiUrl(`/api/ads/catalogs/${encodeURIComponent(catalogId)}/export.csv`, advertiserId)}>
                  <Download className="size-3" aria-hidden="true" /> Template
                </a>
              </div>
            </div>
            
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                className="input-base min-w-0 flex-1 bg-background/50 border-border/50 text-sm focus:bg-background"
                value={urlValue}
                onChange={(event) => setUrlValue(event.target.value)}
                placeholder="Cole o link da sua loja ou coleção (ex: https://sualoja.com/collections/verao)"
                inputMode="url"
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) handleUrlPreview()
                }}
              />
              <button type="button" className="btn-primary shrink-0 text-xs px-6" onClick={handleUrlPreview} disabled={urlImporting || !urlValue.trim()}>
                {urlImporting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <SearchCheck className="size-4" aria-hidden="true" />}
                Importar
              </button>
            </div>
          </div>

          {/* STEP 2: Saúde do Catálogo */}
          <div className="flex flex-col gap-4 rounded-2xl border border-white/5 bg-background/40 backdrop-blur-md p-5 shadow-lg mt-1">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Check className="size-4 text-primary" /> Status e Sincronização
              </h3>
              
              <button 
                type="button" 
                className="btn-primary bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 border-none shadow-xl text-white font-bold py-2.5 px-6 rounded-xl transition-transform hover:scale-[1.02] disabled:opacity-50 disabled:hover:scale-100" 
                onClick={handlePublish} 
                disabled={publishing || validCount === 0}
              >
                {publishing ? <Loader2 className="size-4 animate-spin mr-2" aria-hidden="true" /> : <UploadCloud className="size-4 mr-2" aria-hidden="true" />} 
                Enviar {validCount} Produtos para o TikTok
              </button>
            </div>
            
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1 rounded-xl bg-success/5 border border-success/10 p-3 flex items-center gap-4">
                <div className="flex size-10 items-center justify-center rounded-full bg-success/10 text-success">
                  <Check className="size-5" />
                </div>
                <div>
                  <span className="block text-2xl font-bold text-foreground">{validCount}</span>
                  <span className="block text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Prontos p/ TikTok</span>
                </div>
              </div>
              <div className={`flex-1 rounded-xl p-3 flex items-center gap-4 border ${
                products.length - validCount > 0 ? 'bg-error/5 border-error/10' : 'bg-background/50 border-border/30'
              }`}>
                <div className={`flex size-10 items-center justify-center rounded-full ${
                  products.length - validCount > 0 ? 'bg-error/10 text-error' : 'bg-secondary text-muted-foreground'
                }`}>
                  {products.length - validCount > 0 ? <AlertCircle className="size-5" /> : <Check className="size-5" />}
                </div>
                <div>
                  <span className={`block text-2xl font-bold ${products.length - validCount > 0 ? 'text-error' : 'text-foreground'}`}>
                    {products.length - validCount}
                  </span>
                  <span className="block text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Com Erros</span>
                </div>
              </div>
            </div>

            {products.some(p => !p.valid || (p.errors && p.errors.length > 0)) && (
              <button type="button" className="btn-secondary w-full text-xs py-2 bg-secondary/50 border-border/50 hover:bg-secondary/70 transition-colors" onClick={handleMagicFix} disabled={fixing}>
                {fixing ? <Loader2 className="size-4 animate-spin mr-2" aria-hidden="true" /> : <RotateCcw className="size-4 mr-2" aria-hidden="true" />}
                Resolver erros automaticamente ✨
              </button>
            )}
          </div>

          {/* A ausência de BC bloqueia a publicação, mas nunca perde produtos. */}
          {!bcConfigured && (
            <div className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/5 p-3 text-[11px] text-muted-foreground">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden="true" />
              <span className="text-pretty">
                A conexão com a organização TikTok ainda não foi detectada. Tente novamente no topo; seus produtos permanecem salvos.
              </span>
            </div>
          )}

          {/* Status detalhado no TikTok (quando já publicado): recolhido quando
              tudo está aprovado (o cabeçalho já mostra "X produtos no TikTok");
              abre sozinho quando há pendência/reprovação, que é acionável. */}
          {catalog?.tiktokCatalogId && catalog.linkStatus === 'verified' && (() => {
            const a = catalog.audit
            const healthy = Boolean(a && (a.total ?? 0) > 0 && (a.approved ?? 0) > 0 && (a.pending ?? 0) === 0 && (a.rejected ?? 0) === 0)
            return (
              <details open={!healthy} className="group">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-xl border border-border bg-background px-3 py-2.5 text-xs font-semibold text-foreground">
                  <span className="flex items-center gap-1.5">
                    {healthy ? <ShieldCheck className="size-3.5 text-success" aria-hidden="true" /> : <Clock className="size-3.5 text-warning" aria-hidden="true" />}
                    Status no TikTok {healthy ? `· ${a?.total} aprovado${(a?.total ?? 0) === 1 ? '' : 's'}` : '· requer atenção'}
                  </span>
                  <ChevronDown className="size-3.5 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
                </summary>
                <div className="mt-2">
                  <TiktokStatusPanel
                    catalog={catalog}
                    localProductCount={validCount}
                    auditing={auditing}
                    autoChecking={autoChecking}
                    catalogCampaignSupported={catalogCapabilities?.catalogSingleVideoCampaign === true}
                    onRefresh={handleRefreshAudit}
                  />
                </div>
              </details>
            )
          })()}

          {catalog && (
            <CatalogCampaignWizard
              catalog={catalog}
              advertiserId={advertiserId}
              advertiserCurrency={advertiserCurrency}
              ready={Boolean(readinessData?.readiness.readyForCampaign)}
              capabilities={catalogCapabilities}
            />
          )}

          {/* Tabela de produtos (Avançado) */}
          {products.length > 0 && (() => {
            // Só exibe colunas que tenham valor em pelo menos 1 produto
            const activeCols = PRIMARY_COLS.filter(col => products.some(p => p.data[col] && p.data[col].trim() !== ''))
            return (
              <details className="group mt-1 px-4">
                <summary className="flex cursor-pointer list-none items-center justify-center gap-2 py-3 text-xs font-semibold text-muted-foreground hover:text-foreground">
                  <span>Visualizar todos os produtos (Avançado)</span>
                  <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
                </summary>
                
                <div className="flex items-center justify-end mt-2 mb-1">
                  <button 
                    type="button" 
                    onClick={() => setShowDeadStockOnly(!showDeadStockOnly)} 
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold transition-colors ${showDeadStockOnly ? 'bg-error/15 text-error border border-error/30' : 'bg-secondary/50 text-muted-foreground border border-transparent hover:bg-secondary'}`}
                  >
                    <OctagonAlert className="size-3" />
                    Estoque Morto
                  </button>
                </div>

                <div className="overflow-x-auto rounded-xl border border-border bg-background">
                  <table className="w-full text-left text-xs">
                  <thead className="bg-secondary/50 text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Status</th>
                      {activeCols.map((col) => (
                        <th key={col} className="whitespace-nowrap px-3 py-2 font-medium">{col}</th>
                      ))}
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {displayedProducts.map((p) => (
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
                        className={`group border-b border-border/50 text-xs transition-colors hover:bg-secondary/20 ${dragProductId === p.id ? 'opacity-40' : ''}`}
                      >
                        <td className="px-3 py-2">
                          <div className="flex flex-col gap-1 items-start">
                            <div className="flex items-center gap-1">
                              <GripVertical className="mr-1 inline size-3.5 cursor-grab text-muted-foreground" aria-label="Arraste para reorganizar" />
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
                            </div>
                            {isDeadStock(p) && (
                              <span className="inline-flex items-center gap-1 rounded-md bg-error/10 border border-error/20 px-1.5 py-0.5 text-[9px] font-bold text-error uppercase mt-1">
                                <OctagonAlert className="size-2.5" /> Estoque Morto
                              </span>
                            )}
                          </div>
                        </td>
                        {activeCols.map((col) => (
                          <td key={col} className="max-w-[180px] truncate px-3 py-2 text-foreground" title={p.data[col] || ''}>
                            {p.data[col] || <span className="text-muted-foreground">—</span>}
                          </td>
                        ))}
                        <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
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
            </details>
            )
          })()}

          {publications.length > 0 && (
            <details className="mt-2 text-center">
              <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-[10px] font-medium text-muted-foreground hover:text-foreground">
                <History className="size-3" aria-hidden="true" /> Ver histórico de sincronização ({publications.length})
              </summary>
              <ol className="mt-4 flex flex-col gap-2 text-left">
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
