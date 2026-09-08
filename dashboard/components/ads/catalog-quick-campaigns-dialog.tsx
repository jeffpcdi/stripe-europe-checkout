'use client'

import { SavedVideos } from './saved-videos'
import { creativeFileError } from '@/lib/ads-upload'

import { MarketSelector, defaultMarket } from './market-selector'

import { DialogPortal } from '@/components/ui/dialog-portal'

// Fluxo único: vários criativos, quantidade e orçamento. Pixel, evento de Compra,
// catálogo, público, capa e Product Link vêm do backend.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Check, ChevronDown, Loader2, RefreshCw, Rocket, Upload, UserRound, Video, X } from 'lucide-react'
import { ApiError, adsCreateCatalogCampaignBatch, adsUpload, useAdsCatalogIdentities } from '@/lib/api'
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
}: {
  catalog: AdsCatalog
  advertiserId: string
  advertiserCurrency: string
  capabilities: AdsCatalogCapabilities | null
  open: boolean
  initialVideoUrl?: string
  onClose: () => void
  onCreated: () => void
}) {
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
    setCreatives(initialVideoUrl ? [{ id: randomKey(), name: 'Vídeo já enviado', url: initialVideoUrl, status: 'ready' }] : [])
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

  if (!open) return null

  return (
    <DialogPortal><div className="ads-dialog fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center sm:p-4" role="presentation">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Criar campanhas do catálogo ${catalog.name}`}
        aria-busy={busy || uploading}
        className="flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-border bg-background shadow-2xl sm:max-w-xl sm:rounded-2xl"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3.5 sm:px-5">
          <div>
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <Rocket className="size-4 text-primary" aria-hidden="true" /> Criar campanhas
            </h3>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              Envie os criativos e escolha o orçamento. A dashboard valida e ativa tudo.
            </p>
          </div>
          <button type="button" className="btn-ghost size-8 shrink-0 justify-center p-0" onClick={close} disabled={busy} aria-label="Fechar">
            <X className="size-4 min-w-4 shrink-0" aria-hidden="true" />
          </button>
        </header>

        <fieldset disabled={busy} className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4 sm:px-5">
        <SavedVideos selectedUrls={creatives.map((item) => item.url || '')} disabled={busy || uploading || creatives.length >= MAX_COUNT} onPick={(item) => update(setCreatives, [...creatives, { id: randomKey(), name: item.name, url: item.url, status: 'ready' }])} />
        <MarketSelector value={market} onChange={(value) => update(setMarket, value)} languageAvailable={capabilities?.catalogLanguages === true} />
        <div className="flex flex-col gap-1.5">
          <label className="flex items-center gap-2 text-xs font-medium text-foreground">
            <input type="checkbox" className="accent-primary" checked={onePerCreative} onChange={(event) => {
              update(setOnePerCreative, event.target.checked)
              setCustomCount(count)
            }} />
            Uma campanha por criativo
          </label>
          <span className="text-[11px] text-muted-foreground">{onePerCreative ? '5 criativos = 5 campanhas, cada uma com seu vídeo.' : 'Os vídeos se repetem em ordem quando há mais campanhas que criativos.'}</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {COUNT_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => { setOnePerCreative(false); update(setCustomCount, preset) }}
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${count === preset ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-secondary/40 text-foreground hover:border-primary/50'}`}
              >
                {preset}
              </button>
            ))}
            <input
              className="input-base w-20 text-center text-xs"
              type="number"
              min={Math.max(1, creatives.length)}
              max={MAX_COUNT}
              value={count}
              onChange={(event) => { setOnePerCreative(false); update(setCustomCount, Math.max(1, Math.min(MAX_COUNT, Math.trunc(Number(event.target.value) || 1)))) }}
              aria-label="Quantidade de campanhas"
            />
          </div>
        </div>

        <label className="flex flex-col gap-1.5 text-xs">
          <span className="font-medium text-foreground">Orçamento diário por campanha ({advertiserCurrency})</span>
          <input
            className="input-base"
            type="number"
            inputMode="decimal"
            min={TIKTOK_MIN_BUDGET}
            step="1"
            value={budget}
            onChange={(event) => update(setBudget, event.target.value)}
          />
          {!budgetValid && budget.trim() !== '' && (
            <span className="flex items-center gap-1 text-[10px] text-warning" role="alert">
              <AlertCircle className="size-3" aria-hidden="true" /> Mínimo: {advertiserCurrency} {TIKTOK_MIN_BUDGET}/dia.
            </span>
          )}
        </label>

        <section className="rounded-lg border border-border bg-card p-3" aria-label="Criativos do lote">
          <span className="flex items-center gap-2 text-xs font-medium text-foreground"><Video className="size-4 text-primary" /> Vídeos das campanhas</span>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">Selecione vários vídeos MP4 ou MOV de uma vez. O áudio é mantido e a capa é automática.</p>
          <label className="btn-ghost mt-3 w-fit cursor-pointer text-xs">
            {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
            {creatives.length ? 'Adicionar criativos' : 'Enviar criativos'}
            <input className="sr-only" type="file" multiple accept="video/mp4,video/quicktime,.mp4,.mov"
              aria-label="Enviar criativos" disabled={uploading || busy || creatives.length >= MAX_COUNT}
              onChange={(event) => { addVideos(Array.from(event.target.files || [])); event.currentTarget.value = '' }} />
          </label>
          {creatives.length > 0 && <p className="mt-2 text-[11px] text-muted-foreground" role="status">{readyCount} de {creatives.length} criativos prontos</p>}
          <ul className="mt-2 max-h-48 space-y-2 overflow-y-auto">
            {creatives.map((creative, index) => (
              <li key={creative.id} className="flex items-start gap-2 rounded-lg bg-secondary/30 p-2 text-[11px]">
                {creative.status === 'ready' ? <Check className="mt-0.5 size-3.5 shrink-0 text-success" /> : creative.status === 'error' ? <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-warning" /> : <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-primary" />}
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-foreground" title={creative.name}>{index + 1}. {creative.name}</span>
                  <span className="block text-muted-foreground">{creative.status === 'ready' ? 'Pronto' : creative.status === 'uploading' ? 'Enviando…' : creative.status === 'queued' ? 'Na fila' : creative.error}</span>
                </div>
                {creative.status === 'error' && <button type="button" className="btn-ghost shrink-0 p-1" disabled={uploading} onClick={() => void uploadItems([creative])} aria-label={`Tentar novamente ${creative.name}`}><RefreshCw className="size-3.5" /></button>}
                <button type="button" className="btn-ghost shrink-0 p-1" disabled={uploading} onClick={() => update(setCreatives, creatives.filter((c) => c.id !== creative.id))} aria-label={`Remover ${creative.name}`}><X className="size-3.5" /></button>
              </li>
            ))}
          </ul>
        </section>

        <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-[11px] leading-relaxed text-muted-foreground">
          <strong className="block text-foreground">
            {count} campanha{count === 1 ? '' : 's'} · {budgetValid ? money.format(budgetNumber * count) : '—'}/dia no total
          </strong>
          {creatives.length > 0 && (
            <details className="my-2">
              <summary className="cursor-pointer text-primary">Ver o vídeo de cada campanha</summary>
              <ol className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                {Array.from({ length: count }, (_, index) => <li key={index} className="break-words">{sampleName(index + 1)} → {creatives[index % creatives.length].name}</li>)}
              </ol>
            </details>
          )}
          Pixel da conta TikTok · otimização para Compra · capa gerada do vídeo. Cada produto usa o próprio Link; a estrutura nasce pausada, é conferida e depois ativada.
        </div>

        <div className="rounded-lg border border-border px-3 py-2">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 text-left text-[11px] text-muted-foreground"
            onClick={() => setAdvancedOpen((current) => !current)}
            aria-expanded={advancedOpen}
            aria-controls="catalog-campaign-delivery-profile"
          >
            <span className="min-w-0">
              <span className="font-medium text-foreground">Entrega e perfil</span>
              <span className="ml-2 text-[10px]">{advancedSummary}</span>
            </span>
            <ChevronDown className={`size-3.5 min-w-3.5 shrink-0 transition-transform ${advancedOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
          </button>
          {advancedOpen && (
          <div className="mt-3 flex flex-col gap-4">
            <fieldset className="flex flex-col gap-2">
              <legend className="text-[11px] font-medium text-foreground">Como gastar o orçamento</legend>
              <div className={`grid gap-2 ${costCapAvailable ? 'grid-cols-2' : 'grid-cols-1'}`}>
                <button
                  type="button"
                  className={`rounded-lg border p-2 text-left text-[11px] transition-colors ${bidStrategy === 'lowest_cost' ? 'border-primary bg-primary/10 text-foreground' : 'border-border bg-secondary/30 text-muted-foreground hover:border-primary/40'}`}
                  onClick={() => {
                    update(setBidStrategy, 'lowest_cost')
                    setAcceleratedDelivery(false)
                  }}
                  aria-pressed={bidStrategy === 'lowest_cost'}
                >
                  <strong className="block font-semibold">Máxima entrega</strong>
                  Usa o orçamento para gerar mais compras.
                </button>
                {costCapAvailable && (
                  <button
                    type="button"
                    className={`rounded-lg border p-2 text-left text-[11px] transition-colors ${bidStrategy === 'cost_cap' ? 'border-primary bg-primary/10 text-foreground' : 'border-border bg-secondary/30 text-muted-foreground hover:border-primary/40'}`}
                    onClick={() => update(setBidStrategy, 'cost_cap')}
                    aria-pressed={bidStrategy === 'cost_cap'}
                  >
                    <strong className="block font-semibold">Custo-alvo</strong>
                    Busca manter o CPA próximo da meta.
                  </button>
                )}
              </div>

              {bidStrategy === 'cost_cap' && (
                <div className="rounded-lg border border-border bg-secondary/20 p-3">
                  <label className="flex flex-col gap-1.5 text-[11px] text-muted-foreground">
                    <span className="font-medium text-foreground">CPA alvo ({advertiserCurrency})</span>
                    <input
                      className="input-base"
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
                    <label className="mt-3 flex cursor-pointer items-start gap-2 text-[11px]">
                      <input
                        className="mt-0.5 accent-primary"
                        type="checkbox"
                        checked={acceleratedDelivery}
                        onChange={(event) => update(setAcceleratedDelivery, event.target.checked)}
                      />
                      <span>
                        <strong className="block font-medium text-foreground">Entrega acelerada</strong>
                        <span className="text-muted-foreground">Pode gastar mais rápido e alterar o custo por venda.</span>
                      </span>
                    </label>
                  )}
                </div>
              )}
            </fieldset>

            <label className="flex flex-col gap-1.5 text-[11px]">
              <span className="flex items-center gap-1.5 font-medium text-foreground">
                <UserRound className="size-3.5 text-primary" aria-hidden="true" /> Perfil mostrado no anúncio
              </span>
              <select
                className="input-base text-xs"
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
                <span className="flex items-center gap-1 text-muted-foreground"><Loader2 className="size-3 animate-spin" /> Carregando perfis…</span>
              ) : identitiesError ? (
                <button
                  type="button"
                  className="flex w-fit items-center gap-1 text-warning hover:text-foreground"
                  onClick={() => void reloadIdentities()}
                >
                  <RefreshCw className="size-3" aria-hidden="true" /> Não foi possível carregar. Tentar novamente
                </button>
              ) : selectedIdentity ? (
                <span className="flex items-center gap-2 rounded-lg bg-secondary/30 p-2">
                  {(selectedIdentity.avatarUrl || selectedIdentity.imageUrl) ? (
                    <img
                      src={selectedIdentity.avatarUrl || selectedIdentity.imageUrl}
                      alt=""
                      className="size-7 rounded-full border border-border object-cover"
                    />
                  ) : (
                    <span className="flex size-7 items-center justify-center rounded-full bg-secondary"><UserRound className="size-3.5" /></span>
                  )}
                  <span className="min-w-0">
                    <strong className="block truncate font-medium text-foreground">{identityName(selectedIdentity)}</strong>
                    <span className="block truncate text-muted-foreground">{identityHandle(selectedIdentity) || 'Perfil autorizado do Business Center'}</span>
                  </span>
                </span>
              ) : (
                <span className="text-muted-foreground">A dashboard escolhe automaticamente um perfil autorizado.</span>
              )}
            </label>

            <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
              <span className="font-medium text-foreground">Início dos nomes</span>
              <input
                className="input-base text-xs"
                value={namePrefix}
                onChange={(event) => update(setNamePrefix, event.target.value)}
                placeholder={`${catalog.name} — VSA`}
                maxLength={100}
              />
              <span>Ex.: “{sampleName(1)}”{count > 1 ? ` até “${sampleName(count)}”` : ''}</span>
            </label>
          </div>
          )}
        </div>
        </fieldset>

        <footer className="flex shrink-0 flex-col gap-2 border-t border-border bg-background/95 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <p className={`text-[10px] ${videosReady && !unusedCreatives && budgetValid && bidValid ? 'text-success' : 'text-muted-foreground'}`}>{submitHint}</p>
          <button type="button" className="btn-primary w-full justify-center text-xs disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto" onClick={create} disabled={!countValid || !budgetValid || !bidValid || !videosReady || unusedCreatives || uploading || busy}>
            {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Rocket className="size-3.5" aria-hidden="true" />}
            Criar e ativar {count} campanha{count === 1 ? '' : 's'}
          </button>
        </footer>
      </div>
    </div></DialogPortal>
  )
}
