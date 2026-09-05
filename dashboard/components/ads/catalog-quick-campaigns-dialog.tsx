'use client'

// Fluxo único: quantidade, orçamento e um ou vários vídeos. Pixel, evento de
// Compra, catálogo, público, capa e Product Link vêm do backend.

import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, ChevronDown, Loader2, RefreshCw, Rocket, Upload, UserRound, Video, X } from 'lucide-react'
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
  const [videos, setVideos] = useState<{ url: string; name: string }[]>(
    initialVideoUrl ? [{ url: initialVideoUrl, name: 'Vídeo já enviado' }] : []
  )
  const [bidAmount, setBidAmount] = useState('')
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
  
  // Strategy selection
  const [strategy, setStrategy] = useState<'abo' | 'cbo' | null>(null)
  const [investmentProfile, setInvestmentProfile] = useState<'conservative' | 'aggressive'>('aggressive')
  
  const selectedIdentity = useMemo(
    () => identities.find((identity) => `${identity.identityId}:${identity.identityType}` === identityKey) ?? null,
    [identities, identityKey],
  )
  useEffect(() => {
    if (!open) return
    setCount(1)
    setBudget(String(TIKTOK_MIN_BUDGET))
    setNamePrefix('')
    setVideos(initialVideoUrl ? [{ url: initialVideoUrl, name: 'Vídeo já enviado' }] : [])
    setBidAmount('')
    setIdentityKey('')
    setAdvancedOpen(false)
    setUploading(false)
    setBusy(false)
    setStrategy(null)
    setInvestmentProfile('aggressive')
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

  const submitHint = !countValid
    ? `Escolha de 1 a ${MAX_COUNT} campanhas`
    : !budgetValid
      ? `Orçamento mínimo: ${advertiserCurrency} ${TIKTOK_MIN_BUDGET}/dia`
      : videos.length === 0
        ? 'Envie os vídeos criativos para liberar a criação'
        : `${count} campanha${count === 1 ? '' : 's'} pronta${count === 1 ? '' : 's'} para criar`

  async function create() {
    if (!countValid) return toast.error(`Escolha de 1 a ${MAX_COUNT} campanhas`)
    if (!budgetValid) return toast.error(tiktokMinimumBudgetMessage(advertiserCurrency, ' por dia'))
    if (videos.length === 0) return toast.error('Envie os vídeos das campanhas')
    
    // Map simplified investment profile to TikTok API fields if CBO
    const finalBidStrategy = strategy === 'cbo' && investmentProfile === 'conservative' ? 'cost_cap' : 'lowest_cost'
    const finalBidAmount = finalBidStrategy === 'cost_cap' ? bidAmountNumber || budgetNumber / 2 : undefined
    
    setBusy(true)
    try {
      const result = await adsCreateCatalogCampaignBatch(catalog.id, advertiserId, {
        count,
        budgetAmount: budgetNumber,
        budgetType: 'daily',
        budgetOptimization: strategy === 'cbo' ? 'campaign' : 'adgroup',
        bidStrategy: finalBidStrategy,
        bidAmount: finalBidAmount,
        deliveryMode: 'standard',
        productScope: 'all',
        videoUrl: videos[0].url,
        videoUrls: videos.map(v => v.url),
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
    if (videos.length >= MAX_COUNT) return toast.error(`Limite máximo de ${MAX_COUNT} vídeos`)
    setUploading(true)
    try {
      const result = await adsUpload(file, 'video')
      setVideos((current) => current.length >= MAX_COUNT ? current : [...current, { url: result.url, name: file.name }])
      idempotencyKeyRef.current = null
      toast.success('Vídeo adicionado')
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
        className="flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-primary/40 bg-background shadow-[0_0_50px_rgba(37,244,238,0.16)] sm:max-w-xl sm:rounded-2xl"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3.5 sm:px-5">
          <div>
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <Rocket className="size-4 text-primary" aria-hidden="true" /> {strategy ? 'Configurar Campanha' : 'Escolha sua Estratégia'}
            </h3>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              {strategy ? 'Informe o orçamento e envie os vídeos criativos.' : 'Qual é o seu objetivo principal hoje?'}
            </p>
          </div>
          <button type="button" className="btn-ghost size-8 shrink-0 justify-center p-0" onClick={() => strategy ? setStrategy(null) : onClose()} disabled={busy} aria-label={strategy ? 'Voltar' : 'Fechar'}>
            <X className="size-4 min-w-4 shrink-0" aria-hidden="true" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4 sm:px-5">
        
        {!strategy ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button type="button" onClick={() => setStrategy('abo')} className="flex flex-col items-start p-4 rounded-2xl border border-border bg-card hover:border-brand-cyan/50 hover:bg-brand-cyan/5 transition-colors text-left shadow-sm">
              <div className="size-8 rounded-full bg-brand-cyan/20 flex items-center justify-center mb-3">
                <Video className="size-4 text-brand-cyan" />
              </div>
              <span className="text-sm font-bold text-foreground">Teste de Criativos</span>
              <span className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">Crie de 1 a 50 campanhas ABO com um ou vários vídeos.</span>
            </button>
            <button type="button" onClick={() => setStrategy('cbo')} className="flex flex-col items-start p-4 rounded-2xl border border-border bg-card hover:border-warning/50 hover:bg-warning/5 transition-colors text-left shadow-sm">
              <div className="size-8 rounded-full bg-warning/20 flex items-center justify-center mb-3">
                <Rocket className="size-4 text-warning" />
              </div>
              <span className="text-sm font-bold text-foreground">Escala (CBO)</span>
              <span className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">Crie de 1 a 50 campanhas CBO e distribua o orçamento.</span>
            </button>
          </div>
        ) : (
          <>
        <fieldset className="rounded-xl border border-primary/40 bg-primary/[0.06] p-3">
          <legend className="px-1 text-xs font-semibold text-foreground">Quantidade de campanhas</legend>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {COUNT_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => update(setCount, preset)}
                className={`min-w-10 rounded-lg border px-3 py-2 text-xs font-bold transition-colors ${count === preset ? 'border-primary bg-primary text-black shadow-[var(--glow-cyan-soft)]' : 'border-border bg-background text-foreground hover:border-primary/60'}`}
                aria-pressed={count === preset}
              >
                {preset}
              </button>
            ))}
            <input
              className="input-base w-20 text-center text-xs font-semibold"
              type="number"
              min={1}
              max={MAX_COUNT}
              value={count}
              onChange={(event) => update(setCount, Math.trunc(Number(event.target.value) || 0))}
              aria-label="Quantidade de campanhas"
            />
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">Um vídeo pode ser reutilizado no lote. Com vários vídeos, a distribuição é automática.</p>
        </fieldset>

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

        <label className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <span className="flex items-center gap-2 text-xs font-medium text-foreground"><Video className="size-4 text-primary" /> Vídeos do lote ({videos.length})</span>
          <span className="mt-1 block text-[10px] leading-relaxed text-muted-foreground">Um vídeo será usado nas {count} campanhas. Se enviar vários, eles serão distribuídos entre elas.</span>
          
          {videos.length > 0 && (
            <div className="mt-3 flex flex-col gap-2">
              {videos.map((vid, idx) => (
                <div key={`${vid.url}-${idx}`} className="flex items-center justify-between rounded-md border border-border bg-secondary/20 p-2">
                  <span className="max-w-[200px] truncate text-[11px] font-medium sm:max-w-xs">{vid.name}</span>
                  <button
                    type="button"
                    className="text-muted-foreground transition-colors hover:text-error"
                    onClick={() => update(setVideos, videos.filter((_, i) => i !== idx))}
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <span className="mt-3 flex flex-wrap items-center gap-2">
            <span className="btn-ghost cursor-pointer text-xs">
              {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
              {videos.length > 0 ? 'Adicionar mais criativos' : 'Enviar vídeo(s)'}
              <input
                className="sr-only"
                type="file"
                multiple
                accept="video/mp4,video/quicktime,.mp4,.mov"
                disabled={uploading}
                onChange={(event) => {
                  const files = event.target.files
                  if (!files || files.length === 0) return
                  const fileList = Array.from(files).slice(0, Math.max(0, MAX_COUNT - videos.length))
                  
                  // Para uploads múltiplos sequenciais, criamos uma fila ou promises
                  const startUpload = async () => {
                    for (const file of fileList) {
                      await uploadVideo(file)
                    }
                  }
                  void startUpload()
                  event.currentTarget.value = ''
                }}
              />
            </span>
          </span>
        </label>

        <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-[11px] leading-relaxed text-muted-foreground">
          <strong className="block text-foreground">
            {count} campanha{count === 1 ? '' : 's'} · {budgetValid ? money.format(budgetNumber * count) : '—'}/dia no total
          </strong>
          Pixel, Compra e capa são automáticos. Cada produto usa o próprio Link; a estrutura nasce pausada, é conferida e depois ativada.
        </div>

        <div className="rounded-xl border border-border px-3 py-2 shadow-sm">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 text-left text-[11px] text-muted-foreground"
            onClick={() => setAdvancedOpen((current) => !current)}
            aria-expanded={advancedOpen}
            aria-controls="catalog-campaign-delivery-profile"
          >
            <span className="min-w-0">
              <span className="font-medium text-foreground">Configurações Avançadas</span>
              <span className="ml-2 text-[10px]">{strategy === 'cbo' ? 'Perfil e Entrega' : 'Perfil'}</span>
            </span>
            <ChevronDown className={`size-3.5 min-w-3.5 shrink-0 transition-transform ${advancedOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
          </button>
          {advancedOpen && (
          <div className="mt-3 flex flex-col gap-4">
            {strategy === 'cbo' && (
            <fieldset className="flex flex-col gap-2">
              <legend className="text-[11px] font-medium text-foreground">Perfil de Investimento</legend>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className={`rounded-lg border p-2 text-left text-[11px] transition-colors ${investmentProfile === 'aggressive' ? 'border-primary bg-primary/10 text-foreground' : 'border-border bg-secondary/30 text-muted-foreground hover:border-primary/40'}`}
                  onClick={() => setInvestmentProfile('aggressive')}
                >
                  <strong className="block font-semibold">Agressivo 🔥</strong>
                  Máxima entrega. Foca em volume rápido.
                </button>
                <button
                  type="button"
                  className={`rounded-lg border p-2 text-left text-[11px] transition-colors ${investmentProfile === 'conservative' ? 'border-brand-cyan bg-brand-cyan/10 text-foreground' : 'border-border bg-secondary/30 text-muted-foreground hover:border-brand-cyan/40'}`}
                  onClick={() => setInvestmentProfile('conservative')}
                >
                  <strong className="block font-semibold">Conservador ❄️</strong>
                  Controla CPA. Foca em eficiência.
                </button>
              </div>

              {investmentProfile === 'conservative' && costCapAvailable && (
                <div className="rounded-lg border border-border bg-secondary/20 p-3 mt-2">
                  <label className="flex flex-col gap-1.5 text-[11px] text-muted-foreground">
                    <span className="font-medium text-foreground">Meta de CPA (Opcional)</span>
                    <input
                      className="input-base"
                      type="number"
                      inputMode="decimal"
                      min="0.01"
                      step="0.01"
                      value={bidAmount}
                      onChange={(event) => update(setBidAmount, event.target.value)}
                      placeholder="Deixe em branco para usar 50% do orçamento"
                    />
                  </label>
                </div>
              )}
            </fieldset>
            )}


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
        </>
        )}
        </div>

        {strategy && (
        <footer className="flex shrink-0 flex-col gap-2 border-t border-primary/25 bg-background/95 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <p className={`text-[10px] ${videos.length > 0 && budgetValid ? 'text-success' : 'text-muted-foreground'}`}>{submitHint}</p>
          <button type="button" className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-extrabold text-black shadow-[var(--glow-cyan)] transition-all hover:-translate-y-px hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto" onClick={create} disabled={!countValid || !budgetValid || videos.length === 0 || uploading || busy}>
            {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Rocket className="size-3.5" aria-hidden="true" />}
            Criar e ativar {count} campanha{count === 1 ? '' : 's'}
          </button>
        </footer>
        )}
      </div>
    </div>
  )
}
