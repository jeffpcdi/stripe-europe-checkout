'use client'

// Fluxo único: um vídeo, quantidade e orçamento. Pixel, evento de Compra,
// catálogo, público, capa e Product Link vêm do backend.

import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Check, ChevronDown, Loader2, RefreshCw, Rocket, Upload, UserRound, Video, X } from 'lucide-react'
import { ApiError, adsCreateCatalogCampaignBatch, adsUpload, useAdsCatalogIdentities } from '@/lib/api'
import { TIKTOK_MIN_BUDGET, tiktokMinimumBudgetMessage } from './tiktok-contracts'
import type { AdsCatalog, AdsCatalogCapabilities } from '@/lib/types'
import { toast } from '@/lib/toast'
import { useModalA11y } from '@/lib/use-modal-a11y'

const COUNT_PRESETS = [1, 5, 10, 25, 50]
const MAX_COUNT = 50

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
  const [count, setCount] = useState(1)
  const [budget, setBudget] = useState('50')
  const [namePrefix, setNamePrefix] = useState('')
  const [videoUrl, setVideoUrl] = useState(initialVideoUrl || '')
  const [videoName, setVideoName] = useState(initialVideoUrl ? 'Vídeo já enviado' : '')
  const [bidStrategy, setBidStrategy] = useState<'lowest_cost' | 'cost_cap'>('lowest_cost')
  const [bidAmount, setBidAmount] = useState('')
  const [acceleratedDelivery, setAcceleratedDelivery] = useState(false)
  const [identityKey, setIdentityKey] = useState('')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [busy, setBusy] = useState(false)
  const idempotencyKeyRef = useRef<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  useModalA11y(open, dialogRef, onClose)
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
    if (!open) return
    setCount(1)
    setBudget(String(TIKTOK_MIN_BUDGET))
    setNamePrefix('')
    setVideoUrl(initialVideoUrl || '')
    setVideoName(initialVideoUrl ? 'Vídeo já enviado' : '')
    setBidStrategy('lowest_cost')
    setBidAmount('')
    setAcceleratedDelivery(false)
    setIdentityKey('')
    setAdvancedOpen(false)
    setUploading(false)
    setBusy(false)
    idempotencyKeyRef.current = null
  }, [open, advertiserId, catalog.id, initialVideoUrl])

  function update<T>(setter: (value: T) => void, value: T) {
    setter(value)
    idempotencyKeyRef.current = null
  }

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
      : !videoUrl
        ? 'Envie o vídeo para liberar a criação'
        : `${count} campanha${count === 1 ? '' : 's'} pronta${count === 1 ? '' : 's'} para criar`

  async function create() {
    if (!countValid) return toast.error(`Escolha de 1 a ${MAX_COUNT} campanhas`)
    if (!budgetValid) return toast.error(tiktokMinimumBudgetMessage(advertiserCurrency, ' por dia'))
    if (!bidValid) return toast.error('Informe um CPA alvo maior que zero')
    if (!videoUrl) return toast.error('Envie o vídeo das campanhas')
    setBusy(true)
    try {
      const result = await adsCreateCatalogCampaignBatch(catalog.id, advertiserId, {
        count,
        budgetAmount: budgetNumber,
        budgetType: 'daily',
        budgetOptimization: 'adgroup',
        bidStrategy,
        bidAmount: bidStrategy === 'cost_cap' ? bidAmountNumber : undefined,
        deliveryMode: acceleratedDelivery && bidStrategy === 'cost_cap' ? 'accelerated' : 'standard',
        productScope: 'all',
        videoUrl,
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

  async function uploadVideo(file: File) {
    if (!/\.(mp4|mov)$/i.test(file.name)) return toast.error('Envie um vídeo MP4 ou MOV')
    setUploading(true)
    try {
      const result = await adsUpload(file, 'video')
      update(setVideoUrl, result.url)
      setVideoName(file.name)
      toast.success('Vídeo pronto')
    } catch (error) {
      toast.error('Não foi possível enviar o vídeo', { hint: error instanceof Error ? error.message : undefined })
    } finally {
      setUploading(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center sm:p-4" role="presentation">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Criar campanhas do catálogo ${catalog.name}`}
        aria-busy={busy}
        className="flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-border bg-background shadow-2xl sm:max-w-xl sm:rounded-2xl"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3.5 sm:px-5">
          <div>
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <Rocket className="size-4 text-primary" aria-hidden="true" /> Criar campanhas
            </h3>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              Informe quantidade, orçamento e vídeo. A dashboard valida e ativa tudo.
            </p>
          </div>
          <button type="button" className="btn-ghost size-8 shrink-0 justify-center p-0" onClick={onClose} disabled={busy} aria-label="Fechar">
            <X className="size-4 min-w-4 shrink-0" aria-hidden="true" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-foreground">Quantidade</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {COUNT_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => update(setCount, preset)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${count === preset ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-secondary/40 text-foreground hover:border-primary/50'}`}
              >
                {preset}
              </button>
            ))}
            <input
              className="input-base w-20 text-center text-xs"
              type="number"
              min={1}
              max={MAX_COUNT}
              value={count}
              onChange={(event) => update(setCount, Math.max(1, Math.min(MAX_COUNT, Math.trunc(Number(event.target.value) || 1))))}
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

        <label className="rounded-lg border border-border bg-card p-3">
          <span className="flex items-center gap-2 text-xs font-medium text-foreground"><Video className="size-4 text-primary" /> Vídeo das campanhas</span>
          <span className="mt-1 block text-[10px] leading-relaxed text-muted-foreground">O mesmo vídeo com áudio será usado nas campanhas; a capa é automática.</span>
          <span className="mt-3 flex flex-wrap items-center gap-2">
            <span className="btn-ghost cursor-pointer text-xs">
              {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
              {videoUrl ? 'Trocar vídeo' : 'Enviar vídeo'}
              <input
                className="sr-only"
                type="file"
                accept="video/mp4,video/quicktime,.mp4,.mov"
                disabled={uploading}
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void uploadVideo(file)
                  event.currentTarget.value = ''
                }}
              />
            </span>
            {videoName && <span className="max-w-full truncate text-[10px] text-success"><Check className="mr-1 inline size-3" />{videoName}</span>}
          </span>
        </label>

        <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-[11px] leading-relaxed text-muted-foreground">
          <strong className="block text-foreground">
            {count} campanha{count === 1 ? '' : 's'} · {budgetValid ? money.format(budgetNumber * count) : '—'}/dia no total
          </strong>
          Pixel, Compra e capa são automáticos. Cada produto usa o próprio Link; a estrutura nasce pausada, é conferida e depois ativada.
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
                        <span className="text-muted-foreground">Pode gastar mais rápido e oscilar o CPA nos primeiros dias.</span>
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
              <span className="font-medium text-foreground">Prefixo dos nomes</span>
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
        </div>

        <footer className="flex shrink-0 flex-col gap-2 border-t border-border bg-background/95 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <p className={`text-[10px] ${videoUrl && budgetValid && bidValid ? 'text-success' : 'text-muted-foreground'}`}>{submitHint}</p>
          <button type="button" className="btn-primary w-full justify-center text-xs disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto" onClick={create} disabled={!countValid || !budgetValid || !bidValid || !videoUrl || uploading || busy}>
            {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Rocket className="size-3.5" aria-hidden="true" />}
            Criar e ativar {count} campanha{count === 1 ? '' : 's'}
          </button>
        </footer>
      </div>
    </div>
  )
}
