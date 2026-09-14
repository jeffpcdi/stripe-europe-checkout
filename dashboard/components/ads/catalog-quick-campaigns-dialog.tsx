'use client'

import { SavedVideos } from './saved-videos'
import { creativeFileError } from '@/lib/ads-upload'

import { MarketSelector, defaultMarket } from './market-selector'

import { Modal } from '@/components/ui/modal'
import { MoneyField } from '@/components/ui/money-field'

// Fluxo único: vários criativos, quantidade e orçamento. Pixel, evento de Compra,
// catálogo, público, capa e Product Link vêm do backend.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Loader2, Video, X } from 'lucide-react'
import { ApiError, adsCatalogApiUrl, apiSend, adsCreateCatalogCampaignBatch, adsUpload, useAdsCatalogIdentities } from '@/lib/api'
import { TIKTOK_MIN_BUDGET, tiktokMinimumBudgetMessage } from './tiktok-contracts'
import type { AdsCatalog, AdsCatalogCapabilities } from '@/lib/types'
import { toast } from '@/lib/toast'

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
  const [showAllVideos, setShowAllVideos] = useState(false)
  const [showVideoSources, setShowVideoSources] = useState(false)
  const [submissionError, setSubmissionError] = useState('')
  const [accepted, setAccepted] = useState('')
  const [uploading, setUploading] = useState(false)
  const [busy, setBusy] = useState(false)
  const idempotencyKeyRef = useRef<string | null>(null)
  const uploadGeneration = useRef(0)
  const uploadLock = useRef(false)
  const close = useCallback(() => { if (!busy) onClose() }, [busy, onClose])
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
    setShowAllVideos(false)
    setShowVideoSources(false)
    setSubmissionError('')
    setAccepted('')
    setUploading(false)
    setBusy(false)
    idempotencyKeyRef.current = null
    uploadLock.current = false
    return () => { uploadController.current?.abort(); uploadGeneration.current += 1; uploadLock.current = false }
  }, [open, advertiserId, catalog.id, initialVideoUrl])

  function update<T>(setter: (value: T) => void, value: T) {
    setter(value)
    setSubmissionError('')
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

  const advancedSummary = [bidStrategy === 'cost_cap' ? `Custo-alvo: ${bidValid ? money.format(bidAmountNumber) : 'informar valor'}` : 'Máxima entrega', acceleratedDelivery ? 'Acelerada' : '', namePrefix.trim() ? 'Nome personalizado' : ''].filter(Boolean).join(' · ')
  const marketSummary = `${MARKET_NAMES[market.countries[0]] || market.countries[0]} · ${market.languages[0] ? LANGUAGE_NAMES[market.languages[0]] || market.languages[0] : 'idioma automático'}`
  const submitHint = !budgetValid
    ? `Orçamento mínimo: ${advertiserCurrency} ${TIKTOK_MIN_BUDGET}/dia`
    : !bidValid
      ? 'Informe o CPA alvo para continuar'
      : !videosReady
        ? uploading ? `Enviando criativos: ${readyCount}/${creatives.length}` : 'Envie os criativos ou remova os que falharam'
        : unusedCreatives
          ? 'A quantidade deve incluir todos os criativos'
        : ''

  async function create() {
    if (!countValid) return toast.error(`Escolha de 1 a ${MAX_COUNT} campanhas`)
    if (!budgetValid) return toast.error(tiktokMinimumBudgetMessage(advertiserCurrency, ' por dia'))
    if (!bidValid) return toast.error('Informe um CPA alvo maior que zero')
    if (busy || uploadLock.current) return
    if (!videosReady) return toast.error('Conclua o envio de todos os criativos')
    if (unusedCreatives) return toast.error('Escolha ao menos uma campanha por criativo')
    setBusy(true)
    setSubmissionError('')
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
      setAccepted(result.dryRun ? 'Simulação concluída. Nenhuma campanha foi publicada.' : result.waitingForPixel ? 'Solicitação salva. Aguardando o TikTok reconhecer a atividade do Pixel para iniciar e ativar as campanhas.' : 'Solicitação recebida. As campanhas serão conferidas e ativadas automaticamente. Acompanhe o resultado no catálogo.')
      onCreated()
    } catch (error) {
      setSubmissionError(error instanceof ApiError ? error.display : error instanceof Error ? error.message : 'Tente novamente. Sua configuração foi preservada.')
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

  return (
    <Modal isOpen={open} onClose={close} busy={busy} title="Criar campanhas"
      description={`${catalog.name} · produtos, criativos e entrega em uma única revisão`} maxWidth="max-w-5xl" className="catalog-compose"
      footer={accepted ? <button type="button" className="btn-primary" onClick={close}>Ver acompanhamento no catálogo</button> : <div className="flex w-full flex-wrap items-center justify-between gap-3">
        <p className={`text-[11px] ${submitHint || submissionError ? 'text-warning' : 'text-success'}`} role={submissionError ? 'alert' : 'status'}>
          {submissionError || submitHint || `${count} campanha${count === 1 ? '' : 's'} pronta${count === 1 ? '' : 's'} para entrar na fila.`}
        </p>
        <div className="flex items-center gap-2">
          <button type="button" className="btn-ghost text-xs" onClick={close} disabled={busy}>Cancelar</button>
          <button type="button" className="btn-primary text-xs" onClick={create}
            disabled={!countValid || !budgetValid || !bidValid || !videosReady || unusedCreatives || uploading || busy}>
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {busy ? 'Enviando solicitação…' : `Criar e ativar ${count} campanha${count === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>}>
      {accepted ? <div className="launch-accepted" role="status"><Check aria-hidden="true" /><h3>Solicitação registrada</h3><p>{accepted}</p></div> :
      <div className="launch-composer-grid"><fieldset disabled={busy} className="launch-composer-main border-0 p-0">
        <section className="launch-section-card" aria-label="Vídeos da campanha"><span className="launch-section-kicker">1 · Criativos</span><p className="launch-section-copy mb-3">Cada vídeo pode originar uma campanha própria, mantendo o catálogo e os produtos sincronizados.</p>
          <div className="launch-section-heading">
            <h3>Vídeos <span>{creatives.length}</span></h3>
            <button type="button" className="btn-secondary" aria-expanded={showVideoSources}
              disabled={uploading || creatives.length >= MAX_COUNT} onClick={() => setShowVideoSources(!showVideoSources)}>Adicionar vídeos</button>
          </div>
          {(showVideoSources || !creatives.length) && <div className="launch-video-sources">
            <label className="btn-secondary cursor-pointer">Enviar do computador
              <input className="sr-only" type="file" multiple accept="video/mp4,video/quicktime,.mp4,.mov"
                aria-label="Enviar criativos" disabled={uploading || busy || creatives.length >= MAX_COUNT}
                onChange={event => { addVideos(Array.from(event.target.files || [])); event.currentTarget.value = '' }} />
            </label>
            <SavedVideos selectedUrls={creatives.map(item => item.url || '')} disabled={busy || uploading || creatives.length >= MAX_COUNT}
              onPick={item => { void addSavedVideo(item) }} />
          </div>}
          {!creatives.length && <p className="launch-help">Selecione ao menos um vídeo MP4 ou MOV.</p>}
          <ul className="launch-videos">
            {(showAllVideos ? creatives : creatives.filter((creative, index) => index < 3 || creative.status === 'error')).map(creative => <li key={creative.id}>
              <Video className="size-4 shrink-0" aria-hidden="true" />
              <div className="min-w-0 flex-1"><span className="launch-video-name" title={creative.name}>{creative.name}</span>
                {creative.status !== 'ready' && <p role={creative.status === 'error' ? 'alert' : 'status'}>{creative.status === 'error' ? creative.error || 'Falha no envio' : creative.status === 'queued' ? 'Na fila' : 'Enviando…'}</p>}
              </div>
              {creative.status === 'error' && <button type="button" className="btn-ghost" aria-label={`Tentar novamente ${creative.name}`} disabled={uploading} onClick={() => void uploadItems([creative])}>Tentar novamente</button>}
              <button type="button" className="btn-ghost launch-icon" disabled={uploading} onClick={() => update(setCreatives, creatives.filter(item => item.id !== creative.id))} aria-label={`Remover ${creative.name}`}><X className="size-4" /></button>
            </li>)}
          </ul>
          {creatives.length > 3 && <button type="button" className="btn-ghost" onClick={() => setShowAllVideos(!showAllVideos)}>{showAllVideos ? 'Mostrar menos' : `Ver todos os ${creatives.length} vídeos`}</button>}
          <details className="launch-quantity">
            <summary>{onePerCreative ? 'Uma campanha por vídeo' : `${count} campanhas, vídeos distribuídos em rodízio`} <span>Alterar quantidade</span></summary>
            <label><input type="checkbox" checked={onePerCreative} onChange={event => { update(setOnePerCreative, event.target.checked); setCustomCount(count) }} /> Uma campanha por vídeo</label>
            {!onePerCreative && <label>Quantidade de campanhas
              <input className="input-base" aria-label="Quantidade de campanhas" type="number" min={Math.max(1, creatives.length)} max={MAX_COUNT} value={customCount}
                onChange={event => update(setCustomCount, Number(event.target.value))} />
            </label>}
            {!countValid || unusedCreatives ? <p role="alert">Escolha entre {Math.max(1, creatives.length)} e {MAX_COUNT} campanhas para incluir todos os vídeos.</p> : null}
          </details>
        </section>
        <section className="launch-section-card"><span className="launch-section-kicker">2 · Investimento</span><h3 className="launch-section-title">Orçamento por campanha</h3><div className="mt-4"><MoneyField label="Orçamento diário por campanha" currency={advertiserCurrency} value={budget}
            min={TIKTOK_MIN_BUDGET} onChange={value => update(setBudget, value)}
            hint={`Mínimo de ${money.format(TIKTOK_MIN_BUDGET)} por campanha/dia.`}
            error={!budgetValid && budget.trim() !== '' ? `Informe ao menos ${money.format(TIKTOK_MIN_BUDGET)}.` : undefined} /></div>
        </section>
        <section className="launch-section-card launch-targeting"><span className="launch-section-kicker">3 · Público e identidade</span>
          <details>
            <summary><span><strong>Público</strong><span className="launch-help">{marketSummary}</span></span><span>Alterar</span></summary>
            <MarketSelector value={market} onChange={value => update(setMarket, value)} languageAvailable={capabilities?.catalogLanguages === true} />
          </details>
          <label className="launch-profile"><span>Perfil do anúncio</span>
            <select className="input-base" value={identityKey} onChange={event => update(setIdentityKey, event.target.value)} disabled={identitiesLoading} aria-label="Perfil mostrado no anúncio">
              <option value="">Automático (recomendado)</option>
              {identities.map(identity => <option key={`${identity.identityId}:${identity.identityType}`} value={`${identity.identityId}:${identity.identityType}`}>{identity.displayName || identity.username || identity.identityId}</option>)}
            </select>
          </label>
          {identitiesLoading ? <p className="launch-help" role="status">Carregando perfis…</p> : identitiesError ? <button type="button" className="btn-ghost text-warning" onClick={() => void reloadIdentities()}>Falha ao consultar perfis. Tentar novamente</button> : selectedIdentity ? <p className="launch-help">{identityHandle(selectedIdentity) || identityName(selectedIdentity)}</p> : null}
        </section>
        <section className="launch-section-card launch-advanced">
          <button type="button" aria-expanded={advancedOpen} className="launch-advanced-toggle" onClick={() => setAdvancedOpen(!advancedOpen)}>
            <span>Mais configurações <small>{advancedSummary}</small></span><ChevronDown className="size-4" aria-hidden="true" />
          </button>
          {advancedOpen && <div className="launch-advanced-body">
            <label>Estratégia de entrega<select className="input-base" value={bidStrategy}
              onChange={event => { update(setBidStrategy, event.target.value as 'lowest_cost' | 'cost_cap'); setAcceleratedDelivery(false) }}>
              <option value="lowest_cost">Máxima entrega</option>{costCapAvailable && <option value="cost_cap">Custo-alvo</option>}
            </select></label>
            {bidStrategy === 'cost_cap' && <>
              <MoneyField label="CPA alvo" currency={advertiserCurrency} value={bidAmount} min={0.01} onChange={value => update(setBidAmount, value)} error={!bidValid ? 'Informe um valor maior que zero.' : undefined} />
              {acceleratedDeliveryAvailable && <label className="launch-checkbox"><input type="checkbox" checked={acceleratedDelivery} onChange={event => update(setAcceleratedDelivery, event.target.checked)} /> Entrega acelerada — gasta o orçamento mais rapidamente</label>}
            </>}
            <label>Início dos nomes<input className="input-base" value={namePrefix} onChange={event => update(setNamePrefix, event.target.value)} placeholder={`${catalog.name} — VSA`} maxLength={100} /></label>
            <p className="launch-help">Exemplo: {sampleName(1)}</p>
          </div>}
        </section>
      </fieldset>
      <aside className="launch-review" aria-label="Revisão das campanhas de catálogo">
        <div className="launch-review-head">
          <div><p className="launch-review-title">Revisão do lote</p><p className="launch-review-copy">Estrutura que será enviada para o TikTok.</p></div>
          <span className="launch-review-badge">Catálogo</span>
        </div>
        <div className="launch-review-list">
          <div className="launch-review-row"><span>Catálogo</span><strong>{catalog.name}</strong></div>
          <div className="launch-review-row"><span>Campanhas</span><strong>{count}</strong></div>
          <div className="launch-review-row"><span>Criativos</span><strong>{readyCount}/{creatives.length || 0}</strong></div>
          <div className="launch-review-row"><span>Produtos</span><strong>Todo o catálogo</strong></div>
          <div className="launch-review-row"><span>Mercado</span><strong>{marketSummary}</strong></div>
          <div className="launch-review-row"><span>Perfil</span><strong>{selectedIdentity ? identityName(selectedIdentity) : 'Automático'}</strong></div>
          <div className="launch-review-row"><span>Entrega</span><strong>{bidStrategy === 'cost_cap' ? `CPA alvo ${bidValid ? money.format(bidAmountNumber) : '—'}` : 'Máxima entrega'}</strong></div>
          <div className="launch-review-row"><span>Nomes</span><strong>{sampleName(1)}</strong></div>
        </div>
        <div className="launch-review-total">
          <span className="text-[11px] text-muted-foreground">Orçamento diário do lote</span>
          <strong>{budgetValid && countValid ? money.format(budgetNumber * count) : '—'}</strong>
          <p className="mt-1 text-[10px] text-muted-foreground">{count} × {budgetValid ? money.format(budgetNumber) : '—'} por campanha/dia</p>
        </div>
        {(submitHint || submissionError) ? <div className="launch-review-warning"><span>{submissionError || submitHint}</span></div> : <div className="launch-review-ready"><Check className="mt-0.5 size-3.5 shrink-0" /><span>Pronto para entrar na fila. A estrutura será validada e ativada automaticamente.</span></div>}
      </aside></div>}
    </Modal>
  )
}
