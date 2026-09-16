'use client'

import { MarketSelector, defaultMarket } from './market-selector'
import { Modal } from '@/components/ui/modal'
import { MoneyField } from '@/components/ui/money-field'
import { useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import { AlertCircle, CheckCircle2, ClipboardPaste, Loader2, Play, RefreshCw, UserRound } from 'lucide-react'
import { apiSend, fetcher } from '@/lib/api'
import { toast } from '@/lib/toast'
import { fmtSpend } from '@/lib/format'
import { TIKTOK_MIN_BUDGET, tiktokMinimumBudgetMessage, tomorrowLocalIsoDate } from './tiktok-contracts'

type SparkIdentity = {
  identityId: string
  identityType: 'TT_USER' | 'AUTH_CODE' | 'BC_AUTH_TT'
  displayName?: string
  avatarUrl?: string
  bcId?: string
}

type SparkVideo = {
  itemId: string
  text?: string
  coverUrl?: string
  duration?: number
}

const IDENTITY_TYPE_LABEL: Record<SparkIdentity['identityType'], string> = {
  TT_USER: 'Conta vinculada',
  AUTH_CODE: 'Criador autorizado',
  BC_AUTH_TT: 'Business Center',
}

export function SparkAdDialog({
  open,
  onClose,
  advertiserId,
  currency,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  advertiserId: string
  currency: string
  onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [identityKey, setIdentityKey] = useState('')
  const [itemId, setItemId] = useState('')
  const [budget, setBudget] = useState('')
  const [budgetType, setBudgetType] = useState<'daily' | 'lifetime'>('daily')
  const [endDate, setEndDate] = useState('')
  const [market, setMarket] = useState(() => defaultMarket())
  const [linkUrl, setLinkUrl] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setName('')
      setIdentityKey('')
      setItemId('')
      setBudget('')
      setBudgetType('daily')
      setEndDate('')
      setMarket(defaultMarket())
      setLinkUrl('')
      setSubmitError(null)
    }
  }, [open])

  const { data: identData, isLoading: identLoading, error: identError, mutate: reloadIdentities } = useSWR<{
    identities: SparkIdentity[]
  }>(open && advertiserId ? `/api/ads/spark/identities?adAccountId=${encodeURIComponent(advertiserId)}` : null, fetcher)
  const identities = identData?.identities ?? []
  const identity = useMemo(
    () => identities.find((i) => `${i.identityId}:${i.identityType}` === identityKey) ?? null,
    [identities, identityKey]
  )

  const videosKey = open && advertiserId && identity
    ? `/api/ads/spark/videos?adAccountId=${encodeURIComponent(advertiserId)}&identityId=${encodeURIComponent(identity.identityId)}&identityType=${encodeURIComponent(identity.identityType)}${identity.bcId ? `&bcId=${encodeURIComponent(identity.bcId)}` : ''}`
    : null
  const { data: videoData, isLoading: videosLoading, error: videosError, mutate: reloadVideos } = useSWR<{ videos: SparkVideo[] }>(videosKey, fetcher)
  const videos = videoData?.videos ?? []
  const selectedVideo = useMemo(() => videos.find((video) => video.itemId === itemId) ?? null, [videos, itemId])

  useEffect(() => {
    setItemId('')
    setSubmitError(null)
  }, [identityKey])

  const destinationInvalid = Boolean(linkUrl) && !/^https:\/\/\S+/.test(linkUrl.trim())
  const budgetInvalid = Boolean(budget) && !(Number(budget) >= TIKTOK_MIN_BUDGET)
  const endDateInvalid = budgetType === 'lifetime' && Boolean(endDate) && new Date(`${endDate}T23:59:59`).getTime() <= Date.now() + 60 * 60 * 1000

  const error: string | null = useMemo(() => {
    if (!identity) return 'Selecione a identidade que aparecerá no anúncio'
    if (!itemId) return 'Selecione a publicação que será impulsionada'
    if (!/^https:\/\/\S+/.test(linkUrl.trim())) return 'Informe a página HTTPS de destino'
    if (!(Number(budget) >= TIKTOK_MIN_BUDGET)) return tiktokMinimumBudgetMessage(currency)
    if (budgetType === 'lifetime') {
      if (!endDate) return 'Informe a data de término'
      if (new Date(`${endDate}T23:59:59`).getTime() <= Date.now() + 60 * 60 * 1000) return 'A data de término precisa estar no futuro'
    }
    return null
  }, [identity, itemId, linkUrl, budget, budgetType, endDate, currency])

  async function handleSubmit() {
    if (!identity || error) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const payload: Record<string, unknown> = {
        adAccountId: advertiserId,
        name: name.trim() || ('Spark — ' + (selectedVideo?.text || itemId)).slice(0, 120),
        goal: 'conversions',
        budget: { amount: Number(budget), type: budgetType },
        identityId: identity.identityId,
        identityType: identity.identityType,
        itemId,
      }
      if (identity.bcId) payload.bcId = identity.bcId
      if (budgetType === 'lifetime') payload.endDate = endDate
      payload.countries = market.countries
      payload.linkUrl = linkUrl.trim()

      const result = await apiSend<{ dryRun?: boolean }>('/api/ads/boost', 'POST', payload)
      if (result.dryRun) {
        toast.info('Simulação concluída. Nenhum Spark Ad foi criado.')
        onClose()
        return
      }
      toast.success('Spark Ad criado e pausado', { hint: 'Revise antes de ativar. O TikTok ainda fará a revisão da publicação.' })
      onCreated()
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Falha inesperada ao criar Spark Ad'
      setSubmitError(message)
      toast.error('Falha ao criar Spark Ad', { hint: message })
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  const field = 'launch-input'

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      busy={submitting}
      title="Criar Spark Ad"
      description="Escolha a identidade autorizada, a publicação e o investimento. Nada é selecionado automaticamente."
      maxWidth="max-w-5xl"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <p className={`text-xs ${error || submitError ? 'text-warning' : 'text-success'}`}>{submitError || error || 'Tudo pronto · o Spark será criado pausado.'}</p>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-ghost text-xs" onClick={onClose} disabled={submitting}>Cancelar</button>
            <button type="button" className="btn-primary text-xs" onClick={handleSubmit} disabled={submitting || Boolean(error)}>{submitting && <Loader2 className="size-3.5 animate-spin" />} Criar Spark pausado</button>
          </div>
        </div>
      }
    >
      <div className="tiktok-create-flow">
        <section className="mb-5 border-b border-border/60 pb-4">
          <h3 className="text-sm font-semibold text-foreground">Spark Ads</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Impulsione uma publicação TikTok existente. Você escolhe manualmente a identidade e o post que serão usados.</p>
        </section>

        <div className="launch-composer-grid">
          <fieldset disabled={submitting} className="launch-composer-main border-0 p-0">
            <section className="launch-section-card">
              <h3 className="launch-section-title">Identidade</h3>
              <p className="launch-section-copy">Escolha quem aparecerá como autor do anúncio: conta vinculada, criador autorizado ou identidade do Business Center.</p>

              <div className="mt-4">
                {identLoading ? (
                  <div className="flex min-h-11 items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Carregando identidades…</div>
                ) : identError ? (
                  <button type="button" onClick={() => void reloadIdentities()} className="flex min-h-11 w-full items-center gap-2 border-l-2 border-error pl-3 text-left text-xs text-error"><RefreshCw className="size-3.5" /> Não foi possível carregar as identidades. Tentar novamente.</button>
                ) : identities.length === 0 ? (
                  <div className="border-l-2 border-warning pl-3 text-xs leading-relaxed text-warning">Nenhuma identidade autorizada. Para um criador externo, resgate o Spark Code no TikTok Ads Manager. Depois disso, a identidade autorizada aparecerá aqui.</div>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {identities.map(i => {
                      const key = `${i.identityId}:${i.identityType}`
                      return <button key={key} type="button" aria-pressed={identityKey === key} onClick={() => setIdentityKey(key)} className="launch-choice flex min-h-14 items-center gap-3">
                        {i.avatarUrl ? <img src={i.avatarUrl} alt="" className="size-9 shrink-0 rounded-full object-cover" /> : <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary"><UserRound className="size-4" /></span>}
                        <span className="min-w-0"><strong className="truncate">{i.displayName || 'Identidade TikTok'}</strong><span>{IDENTITY_TYPE_LABEL[i.identityType]}</span></span>
                      </button>
                    })}
                  </div>
                )}
              </div>

              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">O ROI-NADOS não resgata Spark Code. Esse passo continua sendo feito no TikTok Ads Manager.</p>
            </section>

            <section className="launch-section-card">
              <h3 className="launch-section-title">Publicação</h3>
              <p className="launch-section-copy">Escolha o post que será impulsionado. O criativo permanece vinculado à publicação original.</p>

              {!identity ? (
                <p className="mt-4 text-xs text-muted-foreground">Selecione uma identidade para carregar as publicações disponíveis.</p>
              ) : videosLoading ? (
                <div className="mt-4 flex min-h-11 items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Carregando publicações…</div>
              ) : videosError ? (
                <button type="button" onClick={() => void reloadVideos()} className="mt-4 flex min-h-11 w-full items-center gap-2 border-l-2 border-error pl-3 text-left text-xs text-error"><RefreshCw className="size-3.5" /> Não foi possível carregar as publicações. Tentar novamente.</button>
              ) : videos.length === 0 ? (
                <p className="mt-4 text-xs text-muted-foreground">Esta identidade não tem publicações disponíveis para impulsionar.</p>
              ) : (
                <div className="mt-4 grid max-h-72 gap-2 overflow-y-auto pr-1 sm:grid-cols-2" role="listbox" aria-label="Publicações disponíveis">
                  {videos.map(v => <button key={v.itemId} type="button" role="option" aria-selected={itemId === v.itemId} onClick={() => { setItemId(v.itemId); setSubmitError(null) }} className="launch-choice flex min-h-[76px] items-center gap-3">
                    {v.coverUrl ? <img src={v.coverUrl} alt="" className="size-12 shrink-0 rounded-lg object-cover" /> : <span className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-secondary"><Play className="size-4" /></span>}
                    <span className="min-w-0"><strong className="line-clamp-2">{v.text || 'Publicação TikTok'}</strong><span>{v.duration ? `${Math.round(v.duration)}s` : 'Publicação disponível'}</span></span>
                  </button>)}
                </div>
              )}
            </section>

            <section className="launch-section-card">
              <h3 className="launch-section-title">Destino e mercado</h3>
              <p className="launch-section-copy">Defina para onde o clique levará e o mercado onde o Spark poderá entregar.</p>
              <div className="mt-4 space-y-4">
                <label className="block"><span className="mb-1.5 block text-xs font-medium text-foreground">Nome da campanha <span className="text-muted-foreground">(opcional)</span></span><input className={field} value={name} onChange={e => setName(e.target.value)} maxLength={120} placeholder="Ex.: Spark — vídeo viral 02" /></label>
                <MarketSelector appearance="creation" value={market} onChange={setMarket} languageAvailable={false} />
                <label className="block">
                  <div className="mb-1.5 flex items-center justify-between gap-2"><span className="text-xs font-medium text-foreground">Página de destino</span><button type="button" onClick={async () => { try { const value = await navigator.clipboard.readText(); if (value && /^https?:\/\//i.test(value.trim())) { setLinkUrl(value.trim()); setSubmitError(null) } else toast.info('Nenhuma URL válida copiada') } catch { toast.error('Permissão negada para ler a área de transferência') } }} className="flex min-h-10 items-center gap-1 text-xs font-medium text-primary hover:underline"><ClipboardPaste className="size-3.5" /> Colar</button></div>
                  <input className={field} value={linkUrl} onChange={e => { setLinkUrl(e.target.value); setSubmitError(null) }} placeholder="https://sualoja.com/oferta" />
                  {destinationInvalid && <span className="mt-1.5 block text-xs text-error">Use uma URL HTTPS válida.</span>}
                </label>
              </div>
            </section>

            <section className="launch-section-card">
              <h3 className="launch-section-title">Investimento</h3>
              <p className="launch-section-copy">Escolha orçamento diário ou total do período. Os dois modos continuam com regras distintas.</p>
              <div className="mt-4 space-y-4">
                <div className="launch-field-grid">
                  <div><MoneyField label={budgetType === 'daily' ? 'Orçamento diário' : 'Orçamento total'} currency={currency} value={budget} onChange={value => { setBudget(value); setSubmitError(null) }} min={TIKTOK_MIN_BUDGET} hint={`Mínimo: ${fmtSpend(TIKTOK_MIN_BUDGET, currency)}.`} />{budgetInvalid && <p className="mt-1.5 text-xs text-error">{tiktokMinimumBudgetMessage(currency)}</p>}</div>
                  <label className="block"><span className="mb-1.5 block text-xs font-medium text-foreground">Tipo de orçamento</span><select className={field} value={budgetType} onChange={e => { setBudgetType(e.target.value as 'daily' | 'lifetime'); setSubmitError(null) }}><option value="daily">Diário</option><option value="lifetime">Total do período</option></select></label>
                </div>
                {budgetType === 'lifetime' && <label className="block"><span className="mb-1.5 block text-xs font-medium text-foreground">Data de término</span><input type="date" min={tomorrowLocalIsoDate()} className={field} value={endDate} onChange={e => { setEndDate(e.target.value); setSubmitError(null) }} />{endDateInvalid && <span className="mt-1.5 block text-xs text-error">Escolha uma data futura.</span>}</label>}
              </div>
            </section>
          </fieldset>

          <aside className="launch-review" aria-label="Revisão Spark">
            <div className="launch-review-head"><div><p className="launch-review-title">Revisão</p><p className="launch-review-copy">Spark Ads · será criado pausado</p></div></div>

            <div className="launch-preview-card">
              <div className="launch-preview-media">{selectedVideo?.coverUrl ? <img src={selectedVideo.coverUrl} alt="Prévia da publicação selecionada" /> : <Play className="size-7 text-muted-foreground" />}</div>
              <div className="launch-preview-body"><strong>{selectedVideo?.text || 'Selecione uma publicação'}</strong><p>{identity?.displayName || 'A identidade aparecerá aqui'}{selectedVideo?.duration ? ` · ${Math.round(selectedVideo.duration)}s` : ''}</p></div>
            </div>

            <div className="launch-review-list">
              <div className="launch-review-row"><span>Formato</span><strong>Spark Ads</strong></div>
              <div className="launch-review-row"><span>Identidade</span><strong>{identity?.displayName || (identity ? 'Identidade selecionada' : '—')}</strong></div>
              <div className="launch-review-row"><span>Publicação</span><strong>{selectedVideo ? 'Selecionada' : '—'}</strong></div>
              <div className="launch-review-row"><span>Mercado</span><strong>{market.countries.join(', ') || '—'}</strong></div>
              <div className="launch-review-row"><span>Destino</span><strong>{linkUrl ? linkUrl.replace(/^https?:\/\//, '').split('/')[0] : '—'}</strong></div>
              <div className="launch-review-row"><span>Orçamento</span><strong>{budgetType === 'daily' ? 'Diário' : 'Total do período'}</strong></div>
            </div>

            <div className="launch-review-total"><span className="text-xs text-muted-foreground">{budgetType === 'daily' ? 'Investimento diário' : 'Investimento total'}</span><strong>{Number(budget) > 0 ? fmtSpend(Number(budget), currency) : '—'}</strong><p className="mt-1 text-xs text-muted-foreground">{budgetType === 'lifetime' ? (endDate ? `Até ${endDate}` : 'Defina a data final') : 'Valor por dia'}</p></div>

            {submitError ? <div className="launch-review-error"><AlertCircle className="mt-0.5 size-4 shrink-0" /><span>{submitError}</span></div> : error ? <div className="launch-review-warning"><AlertCircle className="mt-0.5 size-4 shrink-0" /><span>{error}</span></div> : <div className="launch-review-ready"><CheckCircle2 className="mt-0.5 size-4 shrink-0" /><span>Pronto para criar pausado. Identidade e publicação permanecem exatamente como você selecionou.</span></div>}
          </aside>
        </div>
      </div>
    </Modal>
  )
}
