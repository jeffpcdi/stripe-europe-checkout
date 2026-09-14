'use client'

import { SavedVideos } from './saved-videos'
import { creativeFileError } from '@/lib/ads-upload'

import { MarketSelector, defaultMarket } from './market-selector'

import { DialogPortal } from '@/components/ui/dialog-portal'

// Fluxo único: vários criativos, quantidade e orçamento. Pixel, evento de Compra,
// catálogo, público, capa e Product Link vêm do backend.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Check, ChevronDown, Globe2, Loader2, RefreshCw, Rocket, SlidersHorizontal, Upload, UserRound, Video, X } from 'lucide-react'
import { ApiError, adsCatalogApiUrl, apiSend, adsCreateCatalogCampaignBatch, adsUpload, useAdsCatalogIdentities } from '@/lib/api'
import { TIKTOK_MIN_BUDGET, tiktokMinimumBudgetMessage } from './tiktok-contracts'
import type { AdsCatalog, AdsCatalogCapabilities } from '@/lib/types'
import { toast } from '@/lib/toast'
import { useModalA11y } from '@/lib/use-modal-a11y'

const COUNT_PRESETS = [1, 5, 10, 25, 50]
const MAX_COUNT = 50
const MARKET_NAMES: Record<string, string> = { BR: 'Brasil', PT: 'Portugal', US: 'Estados Unidos', GB: 'Reino Unido', CA: 'Canadá', AU: 'Austrália', ES: 'Espanha', MX: 'México', AR: 'Argentina', CL: 'Chile', CO: 'Colômbia', FR: 'França', DE: 'Alemanha', IT: 'Itália', JP: 'Japão' }
const LANGUAGE_NAMES: Record<string, string> = { pt: 'Português', en: 'Inglês', es: 'Espanhol', fr: 'Francês', de: 'Alemão', it: 'Italiano', ja: 'Japonês' }

type Creative = {
  id: string
  name: string
  file?: File
  url?: string
  status: 'queued' | 'uploading' | 'ready' | 'error'
  error?: string
}

function randomKey() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `catalog-batch-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function CatalogQuickCampaignsDialog({
  catalog,
  advertiserId,
  advertiserCurrency,
  capabilities,
  open,
  initialVideoUrl,
  onClose,
  onCreated,
  onAssetsChanged,
}: {
  catalog: AdsCatalog
  advertiserId: string
  advertiserCurrency: string
  capabilities: AdsCatalogCapabilities | null
  open: boolean
  initialVideoUrl?: string
  onClose: () => void
  onCreated: () => void
  onAssetsChanged?: () => void
}) {
  const linkedCreatives = useRef(catalog.creatives || [])
  linkedCreatives.current = catalog.creatives || []
  const uploadController = useRef<AbortController | null>(null)
  const [customCount, setCustomCount] = useState(1)
  const [onePerCreative, setOnePerCreative] = useState(true)
  const [market, setMarket] = useState(() => defaultMarket(catalog.country || 'BR'))
  const [budget, setBudget] = useState('50')
  const [namePrefix, setNamePrefix] = useState('')
  const [creatives, setCreatives] = useState<Creative[]>([])
  const [bidStrategy, setBidStrategy] = useState<'lowest_cost' | 'cost_cap'>('lowest_cost')
  const [bidAmount, setBidAmount] = useState('')
  const [acceleratedDelivery, setAcceleratedDelivery] = useState(false)
  const [identityKey, setIdentityKey] = useState('')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [busy, setBusy] = useState(false)
  const idempotencyKeyRef = useRef<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const uploadGeneration = useRef(0)
  const uploadLock = useRef(false)
  const close = useCallback(() => { if (!busy) onClose() }, [busy, onClose])
  useModalA11y(open, dialogRef, close)
  const {
    data: identityData,
    isLoading: identitiesLoading,
    error: identitiesError,
    mutate: reloadIdentities,
  } = useAdsCatalogIdentities(open, catalog.id, advertiserId)
  const identities = useMemo(() => identityData?.identities ?? [], [identityData])
  const costCapAvailable = capabilities?.catalogCostCap === true
  const acceleratedDeliveryAvailable = capabilities?.catalogAcceleratedDelivery === true
  const selectedIdentity = useMemo(
    () => identities.find((identity) => `${identity.identityId}:${identity.identityType}` === identityKey) ?? null,
    [identities, identityKey],
  )
  useEffect(() => {
    if (costCapAvailable) return
    setBidStrategy('lowest_cost')
    setBidAmount('')
    setAcceleratedDelivery(false)
  }, [costCapAvailable])
  useEffect(() => {
    setMarket(defaultMarket(catalog.country || 'BR'))
    setBudget(String(TIKTOK_MIN_BUDGET))
    setNamePrefix('')
  }, [catalog.id, advertiserId])

  useEffect(() => {
    if (!open) return
    setCustomCount(1)
    setOnePerCreative(true)
    setCreatives(initialVideoUrl ? [{ id: randomKey(), name: 'Vídeo já enviado', url: initialVideoUrl, status: 'ready' }] : linkedCreatives.current.map(item => ({ ...item, status: 'ready' })))
    setBidStrategy('lowest_cost')
    setBidAmount('')
    setAcceleratedDelivery(false)
    setIdentityKey('')
    setAdvancedOpen(false)
    setUploading(false)
    setBusy(false)
    idempotencyKeyRef.current = null
    uploadLock.current = false
    return () => { uploadController.current?.abort(); uploadGeneration.current += 1; uploadLock.current = false }
  }, [open, advertiserId, catalog.id, initialVideoUrl])

  function update<T>(setter: (value: T) => void, value: T) {
    setter(value)
    idempotencyKeyRef.current = null
  }

  const count = onePerCreative ? Math.max(1, creatives.length) : customCount
  const videosReady = creatives.length > 0 && creatives.every((creative) => creative.status === 'ready' && creative.url)
  const readyCount = creatives.filter((creative) => creative.status === 'ready').length
  const unusedCreatives = count < creatives.length

  const budgetNumber = Number(String(budget).replace(',', '.'))
  const budgetValid = Number.isFinite(budgetNumber) && budgetNumber >= TIKTOK_MIN_BUDGET
  const countValid = Number.isInteger(count) && count >= 1 && count <= MAX_COUNT
  const bidAmountNumber = Number(String(bidAmount).replace(',', '.'))
  const bidValid = bidStrategy === 'lowest_cost' || (Number.isFinite(bidAmountNumber) && bidAmountNumber > 0)
  const effectivePrefix = namePrefix.trim() || `${catalog.name} — VSA`
  const pad = Math.max(2, String(count).length)
  const sampleName = (index: number) => `${effectivePrefix} ${String(index).padStart(pad, '0')}`
  const money = useMemo(() => new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: advertiserCurrency || 'USD', maximumFractionDigits: 2,
  }), [advertiserCurrency])

  function identityName(identity: NonNullable<typeof selectedIdentity>) {
    return identity.displayName || identity.username || identity.identityId
  }

  function identityHandle(identity: NonNullable<typeof selectedIdentity>) {
    if (!identity.username) return ''
    return identity.username.startsWith('@') ? identity.username : `@${identity.username}`
  }

  const advancedSummary = bidStrategy === 'cost_cap' ? 'Custo-alvo' : 'Máxima entrega'
  const marketSummary = `${MARKET_NAMES[market.countries[0]] || market.countries[0]} · ${market.languages[0] ? LANGUAGE_NAMES[market.languages[0]] || market.languages[0] : 'idioma automático'}`
  const submitHint = !budgetValid
    ? `Orçamento mínimo: ${advertiserCurrency} ${TIKTOK_MIN_BUDGET}/dia`
    : !bidValid
      ? 'Informe o CPA alvo para continuar'
      : !videosReady
        ? uploading ? `Enviando criativos: ${readyCount}/${creatives.length}` : 'Envie os criativos ou remova os que falharam'
        : unusedCreatives
          ? 'A quantidade deve incluir todos os criativos'
        : `${count} campanha${count === 1 ? '' : 's'} pronta${count === 1 ? '' : 's'} para criar`

  async function create() {
    if (!countValid) return toast.error(`Escolha de 1 a ${MAX_COUNT} campanhas`)
    if (!budgetValid) return toast.error(tiktokMinimumBudgetMessage(advertiserCurrency, ' por dia'))
    if (!bidValid) return toast.error('Informe um CPA alvo maior que zero')
    if (busy || uploadLock.current) return
    if (!videosReady) return toast.error('Conclua o envio de todos os criativos')
    if (unusedCreatives) return toast.error('Escolha ao menos uma campanha por criativo')
    setBusy(true)
    try {
      const result = await adsCreateCatalogCampaignBatch(catalog.id, advertiserId, {
        count,
        budgetAmount: budgetNumber,
        budgetType: 'daily',
        budgetOptimization: 'adgroup',
        countries: market.countries,
        languages: market.languages,
        bidStrategy,
        bidAmount: bidStrategy === 'cost_cap' ? bidAmountNumber : undefined,
        deliveryMode: acceleratedDelivery && bidStrategy === 'cost_cap' ? 'accelerated' : 'standard',
        productScope: 'all',
        videoUrls: creatives.map((creative) => creative.url!),
        namePrefix: effectivePrefix,
        identityId: selectedIdentity?.identityId,
        identityType: selectedIdentity?.identityType,
        identityBcId: selectedIdentity?.identityBcId || selectedIdentity?.bcId,
        autoActivate: true,
        idempotencyKey: idempotencyKeyRef.current || (idempotencyKeyRef.current = randomKey()),
      })
      idempotencyKeyRef.current = null
      if (result.dryRun) {
        toast.info('Modo teste: criação validada sem publicar', { hint: `${result.count ?? count} campanha(s) simulada(s).` })
      } else if (result.waitingForPixel) {
        toast.info(`${result.count ?? count} campanha(s) salva(s)`, { hint: 'A dashboard iniciará e ativará tudo automaticamente assim que o TikTok reconhecer o Pixel.' })
      } else {
        toast.success(`${result.count ?? count} campanha(s) na fila`, { hint: 'A dashboard validará a estrutura e ativará os três níveis automaticamente.' })
      }
      onClose()
      onCreated()
    } catch (error) {
      toast.error('Não foi possível criar as campanhas', { hint: error instanceof ApiError ? error.display : error instanceof Error ? error.message : undefined })
    } finally {
      setBusy(false)
    }
  }

  async function uploadItems(items: Creative[]) {
    if (uploadLock.current || busy) return
    uploadLock.current = true
    setUploading(true)
    idempotencyKeyRef.current = null
    const generation = uploadGeneration.current
    const controller = new AbortController()
    uploadController.current = controller
    try {
      // Concorrência de um upload evita saturar a conexão com vídeos grandes.
      // A ordem da seleção é mantida mesmo quando um arquivo precisa de retry.
      for (const item of items) {
        if (generation !== uploadGeneration.current) return
        setCreatives((current) => current.map((c) => c.id === item.id ? { ...c, status: 'uploading', error: undefined } : c))
        try {
          const file = item.file!
          const result = await adsUpload(file, 'video', { signal: controller.signal })
          if (generation !== uploadGeneration.current) return
          if (!result.url) throw new Error('O envio não retornou o vídeo. Tente novamente.')
          await apiSend(adsCatalogApiUrl(`/api/ads/catalogs/${encodeURIComponent(catalog.id)}/creatives`, advertiserId), 'POST', { creatives: [{ name: item.name, url: result.url }] })
          onAssetsChanged?.()
          if (generation !== uploadGeneration.current) return
          setCreatives((current) => current.map((c) => c.id === item.id ? { ...c, status: 'ready', url: result.url } : c))
        } catch (error) {
          if (generation !== uploadGeneration.current) return
          setCreatives((current) => current.map((c) => c.id === item.id ? { ...c, status: 'error', error: error instanceof Error ? error.message : 'Falha no envio' } : c))
        }
      }
    } finally {
      if (generation === uploadGeneration.current) {
        uploadLock.current = false
        setUploading(false)
      }
    }
  }

  function addVideos(files: File[]) {
    if (!files.length || uploadLock.current || busy) return
    if (creatives.length + files.length > MAX_COUNT) return toast.error('Envie no máximo 50 criativos por lote')
    const invalid = files.find((file) => creativeFileError(file, 'video'))
    if (invalid) return toast.error(invalid.name, { hint: creativeFileError(invalid, 'video')! })
    const items: Creative[] = files.map((file) => ({ id: randomKey(), name: file.name, file, status: 'queued' }))
    update(setCreatives, [...creatives, ...items])
    void uploadItems(items)
  }

  async function addSavedVideo(item: { name: string; url: string }) {
    if (busy || uploadLock.current || creatives.length >= MAX_COUNT || creatives.some(creative => creative.url === item.url)) return
    uploadLock.current = true
    setUploading(true)
    const generation = uploadGeneration.current
    try {
      await apiSend(adsCatalogApiUrl(`/api/ads/catalogs/${encodeURIComponent(catalog.id)}/creatives`, advertiserId), 'POST', { creatives: [item] })
      onAssetsChanged?.()
      if (generation !== uploadGeneration.current) return
      idempotencyKeyRef.current = null
      setCreatives(current => [...current, { id: randomKey(), name: item.name, url: item.url, status: 'ready' }])
    } catch (error) {
      if (generation === uploadGeneration.current) toast.error('Não foi possível vincular o vídeo', { hint: error instanceof Error ? error.message : undefined })
    } finally {
      if (generation === uploadGeneration.current) { uploadLock.current = false; setUploading(false) }
    }
  }

  if (!open) return null

  return (
    <DialogPortal><div className="ads-dialog fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center sm:p-4" role="presentation">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Criar campanhas do catálogo ${catalog.name}`}
        aria-busy={busy || uploading}
        className="catalog-quick-dialog flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-border bg-background shadow-2xl sm:max-w-lg lg:max-w-xl sm:rounded-2xl"
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <Rocket className="size-4 text-primary" aria-hidden="true" /> Criar campanhas
            </h3>
            <p className="mt-0.5 text-[11px] leading-tight text-muted-foreground truncate">
              {catalog.name} · Os vídeos salvos já estão selecionados. Escolha o orçamento para lançar.
            </p>
          </div>
          <button type="button" className="btn-ghost !min-h-0 !size-7 shrink-0 justify-center p-0 rounded-lg" onClick={close} disabled={busy} aria-label="Fechar">
            <X className="size-4 min-w-4 shrink-0" aria-hidden="true" />
          </button>
        </header>

        <fieldset disabled={busy} className="catalog-quick-fieldset flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-3.5 py-2.5 sm:px-4 sm:py-3">
          {/* O mercado vem do catálogo por padrão. Só abrimos os campos quando o usuário quiser substituir. */}
          <details className="catalog-launch-disclosure group">
            <summary className="catalog-launch-disclosure-summary">
              <span className="flex min-w-0 items-center gap-2">
                <Globe2 className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
                <span className="truncate"><strong className="font-semibold text-foreground">Mercado</strong> <span className="ml-1 text-muted-foreground">{marketSummary}</span></span>
              </span>
              <span className="flex items-center gap-1 text-[10px] font-medium text-primary">Alterar <ChevronDown className="size-3 transition-transform group-open:rotate-180" /></span>
            </summary>
            <div className="pt-2">
              <MarketSelector value={market} onChange={(value) => update(setMarket, value)} languageAvailable={capabilities?.catalogLanguages === true} />
            </div>
          </details>

          {/* Decisões principais: quantidade derivada dos criativos e orçamento. */}
          <section className="catalog-launch-primary" aria-label="Configuração principal da campanha">
            <div className="catalog-launch-control">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold text-foreground">Campanhas</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {onePerCreative ? `${Math.max(1, creatives.length)} campanha${Math.max(1, creatives.length) === 1 ? '' : 's'} · 1 por criativo` : `${count} campanha${count === 1 ? '' : 's'} personalizadas`}
                  </p>
                </div>
                <strong className="text-lg font-semibold tabular-nums text-foreground">{count}</strong>
              </div>

              <details className="mt-2 group">
                <summary className="cursor-pointer list-none text-[10px] font-medium text-primary hover:text-foreground">Personalizar quantidade</summary>
                <div className="mt-2 rounded-lg border border-border/70 bg-background/35 p-2">
                  <label className="mb-2 flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer select-none">
                    <input type="checkbox" className="accent-primary size-3 rounded" checked={onePerCreative} onChange={(event) => {
                      update(setOnePerCreative, event.target.checked)
                      setCustomCount(count)
                    }} />
                    Uma campanha por criativo
                  </label>
                  <div className="flex items-center gap-1">
                    {COUNT_PRESETS.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => { setOnePerCreative(false); update(setCustomCount, preset) }}
                        className={`!min-h-0 h-7 flex-1 rounded border text-[11px] font-semibold transition-colors ${count === preset && !onePerCreative ? 'border-primary bg-primary/15 text-primary' : 'border-border/70 bg-background/50 text-muted-foreground hover:text-foreground hover:border-primary/40'}`}
                      >
                        {preset}
                      </button>
                    ))}
                    <input
                      className="input-base !min-h-0 h-7 w-12 text-center text-[11px] px-1 font-semibold"
                      type="number"
                      min={Math.max(1, creatives.length)}
                      max={MAX_COUNT}
                      value={count}
                      onChange={(event) => { setOnePerCreative(false); update(setCustomCount, Math.max(1, Math.min(MAX_COUNT, Math.trunc(Number(event.target.value) || 1)))) }}
                      aria-label="Quantidade de campanhas"
                    />
                  </div>
                </div>
              </details>
            </div>

            <label className="catalog-launch-control">
              <span className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-foreground">Orçamento diário</span>
                <span className="text-[10px] font-medium text-muted-foreground">Total {budgetValid ? money.format(budgetNumber * count) : '—'}/dia</span>
              </span>
              <div className="relative mt-2">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] font-medium text-muted-foreground">{advertiserCurrency}</span>
                <input
                  className="input-base !min-h-0 h-8 w-full pl-10 text-xs font-semibold"
                  type="number"
                  inputMode="decimal"
                  min={TIKTOK_MIN_BUDGET}
                  step="1"
                  value={budget}
                  onChange={(event) => update(setBudget, event.target.value)}
                  placeholder={String(TIKTOK_MIN_BUDGET)}
                />
              </div>
              {!budgetValid && budget.trim() !== '' && (
                <span className="mt-1 flex items-center gap-1 text-[10px] text-warning" role="alert">
                  <AlertCircle className="size-2.5 shrink-0" aria-hidden="true" /> Mínimo: {advertiserCurrency} {TIKTOK_MIN_BUDGET}/dia.
                </span>
              )}
            </label>
          </section>

          {/* Criativos compactos. Upload e biblioteca ficam juntos no mesmo ponto de decisão. */}
          <section className="catalog-launch-section" aria-label="Criativos do lote">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Video className="size-3.5 text-primary" aria-hidden="true" />
                <span className="text-[11px] font-semibold text-foreground">Criativos</span>
                <span className={`text-[10px] ${creatives.length && readyCount === creatives.length ? 'text-success' : 'text-muted-foreground'}`}>{readyCount}/{creatives.length || 0} prontos</span>
              </div>
              <div className="flex items-center gap-1.5">
                <label className="!min-h-0 h-7 cursor-pointer inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/8 px-2.5 text-[11px] font-medium text-primary hover:bg-primary/15 transition-colors">
                  {uploading ? <Loader2 className="size-3 animate-spin" /> : <Upload className="size-3" />}
                  Adicionar
                  <input className="sr-only" type="file" multiple accept="video/mp4,video/quicktime,.mp4,.mov"
                    aria-label="Enviar criativos" disabled={uploading || busy || creatives.length >= MAX_COUNT}
                    onChange={(event) => { addVideos(Array.from(event.target.files || [])); event.currentTarget.value = '' }} />
                </label>
                <SavedVideos selectedUrls={creatives.map((item) => item.url || '')} disabled={busy || uploading || creatives.length >= MAX_COUNT} onPick={item => { void addSavedVideo(item) }} />
              </div>
            </div>

            {creatives.length === 0 ? (
              <p className="mt-2 text-[10px] text-muted-foreground">Adicione ao menos um vídeo MP4 ou MOV.</p>
            ) : (
              <ul className="catalog-launch-creative-list mt-2 max-h-28 overflow-y-auto">
                {creatives.map((creative, index) => (
                  <li key={creative.id} className="catalog-launch-creative-row">
                    {creative.status === 'ready' ? <Check className="size-3 shrink-0 text-success" /> : creative.status === 'error' ? <AlertCircle className="size-3 shrink-0 text-warning" /> : <Loader2 className="size-3 shrink-0 animate-spin text-primary" />}
                    <span className="min-w-0 flex-1 truncate text-[11px] text-foreground" title={creative.name}>{creative.name}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">{creative.status === 'ready' ? 'Pronto' : creative.status === 'uploading' ? 'Enviando…' : creative.status === 'queued' ? 'Na fila' : 'Erro'}</span>
                    {creative.status === 'error' && <button type="button" className="btn-ghost !min-h-0 !size-6 p-0 shrink-0 text-muted-foreground hover:text-foreground" disabled={uploading} onClick={() => void uploadItems([creative])} aria-label={`Tentar novamente ${creative.name}`}><RefreshCw className="size-3" /></button>}
                    <button type="button" className="btn-ghost !min-h-0 !size-6 p-0 shrink-0 text-muted-foreground hover:text-error" disabled={uploading} onClick={() => update(setCreatives, creatives.filter((c) => c.id !== creative.id))} aria-label={`Remover ${creative.name}`}><X className="size-3" /></button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* O perfil continua explícito, como solicitado. */}
          <label className="catalog-launch-section flex flex-col gap-1.5 text-[11px]">
            <span className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 font-semibold text-foreground">
                <UserRound className="size-3.5 text-primary" aria-hidden="true" /> Perfil do anúncio
              </span>
              <span className="text-[10px] text-muted-foreground">TikTok</span>
            </span>
            <select
              className="input-base !min-h-0 h-8 text-xs py-0.5"
              value={identityKey}
              onChange={(event) => update(setIdentityKey, event.target.value)}
              disabled={identitiesLoading}
              aria-label="Perfil mostrado no anúncio"
            >
              <option value="">Automático (recomendado)</option>
              {identities.map((identity) => (
                <option key={`${identity.identityId}:${identity.identityType}`} value={`${identity.identityId}:${identity.identityType}`}>
                  {identity.displayName || identity.username || identity.identityId}{identity.username ? ` · ${identity.username.startsWith('@') ? identity.username : `@${identity.username}`}` : ''}
                </option>
              ))}
            </select>
            {identitiesLoading ? (
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground"><Loader2 className="size-3 animate-spin" /> Carregando perfis…</span>
            ) : identitiesError ? (
              <button type="button" className="flex w-fit items-center gap-1 text-[10px] text-warning hover:text-foreground" onClick={() => void reloadIdentities()}>
                <RefreshCw className="size-3" aria-hidden="true" /> Tentar carregar novamente
              </button>
            ) : selectedIdentity ? (
              <span className="flex items-center gap-2 text-[10px] text-muted-foreground">
                {(selectedIdentity.avatarUrl || selectedIdentity.imageUrl) ? <img src={selectedIdentity.avatarUrl || selectedIdentity.imageUrl} alt="" className="size-5 rounded-full border border-border object-cover" /> : null}
                <span className="truncate">{identityName(selectedIdentity)}{identityHandle(selectedIdentity) ? ` · ${identityHandle(selectedIdentity)}` : ''}</span>
              </span>
            ) : null}
          </label>

          {/* Resumo sem card extra: só o que muda a decisão final. */}
          <div
            className="catalog-launch-summary"
            title="Pixel da conta TikTok · otimização para Compra · capa gerada do vídeo. Cada produto usa o próprio Link; a estrutura nasce pausada, é conferida e depois ativada."
          >
            <strong>{count} campanha{count === 1 ? '' : 's'} · {budgetValid ? money.format(budgetNumber * count) : '—'}/dia</strong>
            <span>Compra · Pixel automático · Product Link automático</span>
          </div>

          {/* Entrega e nomes ficam recolhidos; perfil permanece visível acima. */}
          <div className="catalog-launch-disclosure">
            <button
              type="button"
              className="catalog-launch-disclosure-summary w-full"
              onClick={() => setAdvancedOpen((current) => !current)}
              aria-expanded={advancedOpen}
              aria-controls="catalog-campaign-delivery-profile"
              title="Entrega e perfil avançados"
            >
              <span className="flex min-w-0 items-center gap-2"><SlidersHorizontal className="size-3.5 shrink-0 text-muted-foreground" /><span><strong className="font-semibold text-foreground">Opções avançadas</strong> <span className="ml-1 text-[10px] text-muted-foreground">{advancedSummary}</span></span></span>
              <ChevronDown className={`size-3.5 shrink-0 transition-transform ${advancedOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
            </button>
            {advancedOpen && (
              <div id="catalog-campaign-delivery-profile" className="mt-2 flex flex-col gap-2.5 border-t border-border/50 pt-2.5">
                <fieldset className="flex flex-col gap-1.5">
                  <legend className="text-[11px] font-medium text-foreground">Entrega e perfil</legend>
                  <div className={`grid gap-2 ${costCapAvailable ? 'grid-cols-2' : 'grid-cols-1'}`}>
                    <button
                      type="button"
                      className={`!min-h-0 rounded-lg border p-2 text-left text-xs transition-colors ${bidStrategy === 'lowest_cost' ? 'border-primary/60 bg-primary/8 text-foreground' : 'border-border bg-secondary/20 text-muted-foreground hover:border-primary/40'}`}
                      onClick={() => { update(setBidStrategy, 'lowest_cost'); setAcceleratedDelivery(false) }}
                      aria-pressed={bidStrategy === 'lowest_cost'}
                    >
                      <strong className="block font-semibold">Máxima entrega</strong>
                      <span className="text-[10px] leading-tight text-muted-foreground">Prioriza volume de compras.</span>
                    </button>
                    {costCapAvailable && (
                      <button
                        type="button"
                        className={`!min-h-0 rounded-lg border p-2 text-left text-xs transition-colors ${bidStrategy === 'cost_cap' ? 'border-primary/60 bg-primary/8 text-foreground' : 'border-border bg-secondary/20 text-muted-foreground hover:border-primary/40'}`}
                        onClick={() => update(setBidStrategy, 'cost_cap')}
                        aria-pressed={bidStrategy === 'cost_cap'}
                      >
                        <strong className="block font-semibold">Custo-alvo</strong>
                        <span className="text-[10px] leading-tight text-muted-foreground">Tenta manter o CPA próximo da meta.</span>
                      </button>
                    )}
                  </div>

                  {bidStrategy === 'cost_cap' && (
                    <div className="grid gap-2 rounded-lg border border-border/70 bg-secondary/15 p-2.5 sm:grid-cols-2">
                      <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
                        <span className="font-medium text-foreground">CPA alvo ({advertiserCurrency})</span>
                        <input className="input-base !min-h-0 h-7 text-xs" type="number" inputMode="decimal" min="0.01" step="0.01" value={bidAmount} onChange={(event) => update(setBidAmount, event.target.value)} placeholder="Ex.: 15,00" />
                        {!bidValid && bidAmount.trim() !== '' && <span className="text-[10px] text-warning" role="alert">Informe um valor maior que zero.</span>}
                      </label>
                      {acceleratedDeliveryAvailable && (
                        <label className="flex cursor-pointer items-center gap-2 text-[11px]">
                          <input className="accent-primary size-3" type="checkbox" checked={acceleratedDelivery} onChange={(event) => update(setAcceleratedDelivery, event.target.checked)} />
                          <span><strong className="block font-medium text-foreground">Entrega acelerada</strong><span className="text-[10px] text-muted-foreground">Gasta o orçamento mais rapidamente.</span></span>
                        </label>
                      )}
                    </div>
                  )}
                </fieldset>

                <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
                  <span className="font-medium text-foreground">Início dos nomes</span>
                  <input className="input-base !min-h-0 h-7 text-xs" value={namePrefix} onChange={(event) => update(setNamePrefix, event.target.value)} placeholder={`${catalog.name} — VSA`} maxLength={100} />
                  <span className="text-[10px]">Ex.: “{sampleName(1)}”{count > 1 ? ` até “${sampleName(count)}”` : ''}</span>
                </label>
              </div>
            )}
          </div>
        </fieldset>

        <footer className="flex shrink-0 flex-col gap-2 border-t border-border bg-background/95 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <p className={`text-[10px] ${videosReady && !unusedCreatives && budgetValid && bidValid ? 'text-success' : 'text-muted-foreground'}`}>{submitHint}</p>
          <button type="button" className="btn-primary !min-h-0 h-9 w-full justify-center text-xs disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto px-4" onClick={create} disabled={!countValid || !budgetValid || !bidValid || !videosReady || unusedCreatives || uploading || busy}>
            {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Rocket className="size-3.5" aria-hidden="true" />}
            Criar e ativar {count} campanha{count === 1 ? '' : 's'}
          </button>
        </footer>
      </div>
    </div></DialogPortal>
  )
}
