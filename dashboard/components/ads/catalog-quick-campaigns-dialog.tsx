'use client'

import { SavedVideos } from './saved-videos'
import { creativeFileError } from '@/lib/ads-upload'

import { MarketSelector, defaultMarket } from './market-selector'

import { DialogPortal } from '@/components/ui/dialog-portal'

// Fluxo único: vários criativos, quantidade e orçamento. Pixel, evento de Compra,
// catálogo, público, capa e Product Link vêm do backend.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Check, ChevronDown, Loader2, RefreshCw, Rocket, Upload, UserRound, Video, X } from 'lucide-react'
import { ApiError, adsCatalogApiUrl, apiSend, adsCreateCatalogCampaignBatch, adsUpload, useAdsCatalogIdentities } from '@/lib/api'
import { TIKTOK_MIN_BUDGET, tiktokMinimumBudgetMessage } from './tiktok-contracts'
import type { AdsCatalog, AdsCatalogCapabilities } from '@/lib/types'
import { toast } from '@/lib/toast'
import { useModalA11y } from '@/lib/use-modal-a11y'

const COUNT_PRESETS = [1, 5, 10, 25, 50]
const MAX_COUNT = 50

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

  const advancedSummary = `${bidStrategy === 'cost_cap' ? 'Custo-alvo' : 'Máxima entrega'} · ${selectedIdentity ? identityName(selectedIdentity) : 'perfil automático'}`
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

        <fieldset disabled={busy} className="catalog-quick-fieldset flex min-h-0 min-w-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3.5 py-3 sm:px-4 sm:py-3.5">
          {/* Mercado / Onde anunciar */}
          <MarketSelector value={market} onChange={(value) => update(setMarket, value)} languageAvailable={capabilities?.catalogLanguages === true} />

          {/* Quantidade de campanhas e Orçamento lado a lado */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {/* Card: Quantidade de campanhas */}
            <div className="flex flex-col justify-between rounded-lg border border-border/80 bg-secondary/15 p-2.5 gap-1.5">
              <div className="flex items-center justify-between gap-1.5">
                <span className="text-[11px] font-semibold text-foreground">Campanhas</span>
                <label className="flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer select-none">
                  <input type="checkbox" className="accent-primary size-3 rounded" checked={onePerCreative} onChange={(event) => {
                    update(setOnePerCreative, event.target.checked)
                    setCustomCount(count)
                  }} />
                  Uma campanha por criativo
                </label>
              </div>
              <div className="flex items-center gap-1">
                {COUNT_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => { setOnePerCreative(false); update(setCustomCount, preset) }}
                    className={`!min-h-0 h-7 flex-1 rounded border text-[11px] font-semibold transition-colors ${count === preset && !onePerCreative ? 'border-primary bg-primary text-primary-foreground' : 'border-border/80 bg-background/60 text-foreground hover:border-primary/50'}`}
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
              <span className="text-[10px] text-muted-foreground leading-tight truncate">
                {onePerCreative ? '5 criativos = 5 campanhas, cada uma com seu vídeo.' : 'Os vídeos se repetem em ordem quando há mais campanhas que criativos.'}
              </span>
            </div>

            {/* Card: Orçamento diário */}
            <div className="flex flex-col justify-between rounded-lg border border-border/80 bg-secondary/15 p-2.5 gap-1.5">
              <div className="flex items-center justify-between gap-1.5">
                <span className="text-[11px] font-semibold text-foreground">Orçamento / campanha</span>
                <span className="text-[10px] font-medium text-primary">
                  Total: {budgetValid ? money.format(budgetNumber * count) : '—'}/dia
                </span>
              </div>
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] font-medium text-muted-foreground">{advertiserCurrency}</span>
                <input
                  className="input-base !min-h-0 h-7 w-full pl-10 text-xs font-semibold"
                  type="number"
                  inputMode="decimal"
                  min={TIKTOK_MIN_BUDGET}
                  step="1"
                  value={budget}
                  onChange={(event) => update(setBudget, event.target.value)}
                  placeholder={String(TIKTOK_MIN_BUDGET)}
                />
              </div>
              <div className="min-h-[14px]">
                {!budgetValid && budget.trim() !== '' ? (
                  <span className="flex items-center gap-1 text-[10px] text-warning" role="alert">
                    <AlertCircle className="size-2.5 shrink-0" aria-hidden="true" /> Mínimo: {advertiserCurrency} {TIKTOK_MIN_BUDGET}/dia.
                  </span>
                ) : (
                  <span className="text-[10px] text-muted-foreground leading-tight">Mín. {advertiserCurrency} {TIKTOK_MIN_BUDGET}/dia por campanha</span>
                )}
              </div>
            </div>
          </div>

          {/* Vídeos das campanhas */}
          <section className="rounded-lg border border-border/80 bg-secondary/15 p-2.5 sm:p-3" aria-label="Criativos do lote">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <Video className="size-3.5 text-primary" />
                <span className="text-[11px] font-semibold text-foreground">Vídeos das campanhas</span>
                {creatives.length > 0 && (
                  <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary" role="status">
                    {readyCount} de {creatives.length} criativos prontos
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <label className="!min-h-0 h-7 cursor-pointer inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2.5 text-[11px] font-medium text-primary hover:bg-primary/20 transition-colors">
                  {uploading ? <Loader2 className="size-3 animate-spin" /> : <Upload className="size-3" />}
                  {creatives.length ? 'Adicionar criativos' : 'Enviar criativos'}
                  <input className="sr-only" type="file" multiple accept="video/mp4,video/quicktime,.mp4,.mov"
                    aria-label="Enviar criativos" disabled={uploading || busy || creatives.length >= MAX_COUNT}
                    onChange={(event) => { addVideos(Array.from(event.target.files || [])); event.currentTarget.value = '' }} />
                </label>
                <SavedVideos selectedUrls={creatives.map((item) => item.url || '')} disabled={busy || uploading || creatives.length >= MAX_COUNT} onPick={item => { void addSavedVideo(item) }} />
              </div>
            </div>

            <p className="mt-1 text-[10px] text-muted-foreground/90 leading-tight">
              Selecione vários vídeos MP4 ou MOV de uma vez. O áudio é mantido e a capa é automática.
            </p>

            {creatives.length > 0 && (
              <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto pr-0.5">
                {creatives.map((creative, index) => (
                  <li key={creative.id} className="flex items-center gap-2 rounded-md bg-background/70 px-2 py-1 text-xs border border-border/50">
                    {creative.status === 'ready' ? <Check className="size-3 shrink-0 text-success" /> : creative.status === 'error' ? <AlertCircle className="size-3 shrink-0 text-warning" /> : <Loader2 className="size-3 shrink-0 animate-spin text-primary" />}
                    <div className="min-w-0 flex-1 flex items-center gap-1.5">
                      <span className="truncate text-foreground text-[11px]" title={creative.name}>{index + 1}. {creative.name}</span>
                      <span className="text-[10px] text-muted-foreground shrink-0">({creative.status === 'ready' ? 'Pronto' : creative.status === 'uploading' ? 'Enviando…' : creative.status === 'queued' ? 'Na fila' : creative.error})</span>
                    </div>
                    {creative.status === 'error' && <button type="button" className="btn-ghost !min-h-0 !size-6 p-0 shrink-0 text-muted-foreground hover:text-foreground" disabled={uploading} onClick={() => void uploadItems([creative])} aria-label={`Tentar novamente ${creative.name}`}><RefreshCw className="size-3" /></button>}
                    <button type="button" className="btn-ghost !min-h-0 !size-6 p-0 shrink-0 text-muted-foreground hover:text-error" disabled={uploading} onClick={() => update(setCreatives, creatives.filter((c) => c.id !== creative.id))} aria-label={`Remover ${creative.name}`}><X className="size-3" /></button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Resumo e informações do lote */}
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-2 sm:p-2.5 text-[11px] leading-relaxed text-muted-foreground">
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <strong className="text-foreground font-semibold text-xs">
                {count} campanha{count === 1 ? '' : 's'} · {budgetValid ? money.format(budgetNumber * count) : '—'}/dia no total
              </strong>
              {creatives.length > 0 && (
                <details className="text-[11px]">
                  <summary className="cursor-pointer text-primary font-medium">Ver o vídeo de cada campanha</summary>
                  <ol className="mt-1.5 max-h-32 space-y-0.5 overflow-y-auto rounded border border-border/50 bg-background/60 p-1.5 text-[10px]">
                    {Array.from({ length: count }, (_, index) => <li key={index} className="truncate">{sampleName(index + 1)} → {creatives[index % creatives.length].name}</li>)}
                  </ol>
                </details>
              )}
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground/90 leading-tight">
              Pixel da conta TikTok · otimização para Compra · capa gerada do vídeo. Cada produto usa o próprio Link; a estrutura nasce pausada, é conferida e depois ativada.
            </p>
          </div>

          {/* Entrega e perfil (Opções avançadas) */}
          <div className="rounded-lg border border-border/80 bg-secondary/10 px-2.5 py-2">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 text-left text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setAdvancedOpen((current) => !current)}
              aria-expanded={advancedOpen}
              aria-controls="catalog-campaign-delivery-profile"
            >
              <span className="min-w-0">
                <span className="font-semibold text-foreground">Entrega e perfil</span>
                <span className="ml-2 text-[10px] text-muted-foreground">{advancedSummary}</span>
              </span>
              <ChevronDown className={`size-3.5 min-w-3.5 shrink-0 transition-transform ${advancedOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
            </button>
            {advancedOpen && (
            <div className="mt-2.5 flex flex-col gap-2.5 border-t border-border/60 pt-2.5">
              <fieldset className="flex flex-col gap-1.5">
                <legend className="text-[11px] font-medium text-foreground">Como gastar o orçamento</legend>
                <div className={`grid gap-2 ${costCapAvailable ? 'grid-cols-2' : 'grid-cols-1'}`}>
                  <button
                    type="button"
                    className={`!min-h-0 rounded-lg border p-2 text-left text-xs transition-colors ${bidStrategy === 'lowest_cost' ? 'border-primary bg-primary/10 text-foreground' : 'border-border bg-secondary/30 text-muted-foreground hover:border-primary/40'}`}
                    onClick={() => {
                      update(setBidStrategy, 'lowest_cost')
                      setAcceleratedDelivery(false)
                    }}
                    aria-pressed={bidStrategy === 'lowest_cost'}
                  >
                    <strong className="block font-semibold">Máxima entrega</strong>
                    <span className="text-[10px] leading-tight text-muted-foreground">Usa o orçamento para gerar mais compras.</span>
                  </button>
                  {costCapAvailable && (
                    <button
                      type="button"
                      className={`!min-h-0 rounded-lg border p-2 text-left text-xs transition-colors ${bidStrategy === 'cost_cap' ? 'border-primary bg-primary/10 text-foreground' : 'border-border bg-secondary/30 text-muted-foreground hover:border-primary/40'}`}
                      onClick={() => update(setBidStrategy, 'cost_cap')}
                      aria-pressed={bidStrategy === 'cost_cap'}
                    >
                      <strong className="block font-semibold">Custo-alvo</strong>
                      <span className="text-[10px] leading-tight text-muted-foreground">Busca manter o CPA próximo da meta.</span>
                    </button>
                  )}
                </div>

                {bidStrategy === 'cost_cap' && (
                  <div className="rounded-lg border border-border bg-secondary/20 p-2.5 space-y-2">
                    <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
                      <span className="font-medium text-foreground">CPA alvo ({advertiserCurrency})</span>
                      <input
                        className="input-base !min-h-0 h-7 text-xs"
                        type="number"
                        inputMode="decimal"
                        min="0.01"
                        step="0.01"
                        value={bidAmount}
                        onChange={(event) => update(setBidAmount, event.target.value)}
                        placeholder="Ex.: 15,00"
                      />
                      {!bidValid && bidAmount.trim() !== '' && (
                        <span className="text-[10px] text-warning" role="alert">Informe um valor maior que zero.</span>
                      )}
                    </label>
                    {acceleratedDeliveryAvailable && (
                      <label className="flex cursor-pointer items-start gap-2 text-[11px]">
                        <input
                          className="mt-0.5 accent-primary size-3"
                          type="checkbox"
                          checked={acceleratedDelivery}
                          onChange={(event) => update(setAcceleratedDelivery, event.target.checked)}
                        />
                        <span>
                          <strong className="block font-medium text-foreground">Entrega acelerada</strong>
                          <span className="text-[10px] text-muted-foreground leading-tight">Pode gastar mais rápido e alterar o custo por venda.</span>
                        </span>
                      </label>
                    )}
                  </div>
                )}
              </fieldset>

              <label className="flex flex-col gap-1 text-[11px]">
                <span className="flex items-center gap-1.5 font-medium text-foreground">
                  <UserRound className="size-3.5 text-primary" aria-hidden="true" /> Perfil mostrado no anúncio
                </span>
                <select
                  className="input-base !min-h-0 h-7 sm:h-8 text-xs py-0.5"
                  value={identityKey}
                  onChange={(event) => update(setIdentityKey, event.target.value)}
                  disabled={identitiesLoading}
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
                  <button
                    type="button"
                    className="flex w-fit items-center gap-1 text-[10px] text-warning hover:text-foreground"
                    onClick={() => void reloadIdentities()}
                  >
                    <RefreshCw className="size-3" aria-hidden="true" /> Não foi possível carregar. Tentar novamente
                  </button>
                ) : selectedIdentity ? (
                  <span className="flex items-center gap-2 rounded-lg bg-secondary/30 p-1.5">
                    {(selectedIdentity.avatarUrl || selectedIdentity.imageUrl) ? (
                      <img
                        src={selectedIdentity.avatarUrl || selectedIdentity.imageUrl}
                        alt=""
                        className="size-6 rounded-full border border-border object-cover"
                      />
                    ) : (
                      <span className="flex size-6 items-center justify-center rounded-full bg-secondary"><UserRound className="size-3" /></span>
                    )}
                    <span className="min-w-0">
                      <strong className="block truncate font-medium text-foreground text-[11px]">{identityName(selectedIdentity)}</strong>
                      <span className="block truncate text-muted-foreground text-[10px]">{identityHandle(selectedIdentity) || 'Perfil autorizado do Business Center'}</span>
                    </span>
                  </span>
                ) : (
                  <span className="text-[10px] text-muted-foreground">A dashboard escolhe automaticamente um perfil autorizado.</span>
                )}
              </label>

              <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground">Início dos nomes</span>
                <input
                  className="input-base !min-h-0 h-7 text-xs"
                  value={namePrefix}
                  onChange={(event) => update(setNamePrefix, event.target.value)}
                  placeholder={`${catalog.name} — VSA`}
                  maxLength={100}
                />
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
