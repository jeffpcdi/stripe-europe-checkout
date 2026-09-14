'use client'

import { MarketSelector, defaultMarket } from './market-selector'

import { Modal } from '@/components/ui/modal'
import { MoneyField } from '@/components/ui/money-field'

// Spark Ads — impulsiona um post orgânico do TikTok como anúncio (F5, via
// Pipeboard). Fluxo: seleciona a IDENTIDADE autorizada (TT_USER = conta
// vinculada; AUTH_CODE = criador cujo Spark Code já foi resgatado no Ads
// Manager) → seleciona o POST da identidade → cria via POST /api/ads/boost.
// Colar Spark Code cru não é suportado pela API — o aviso explica o resgate.

import { useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import { Zap, Loader2, RefreshCw, ClipboardPaste, CheckCircle2, AlertCircle, Play, UserRound, ExternalLink } from 'lucide-react'
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
  const [identityKey, setIdentityKey] = useState('') // identityId:identityType
  const [itemId, setItemId] = useState('')
  const [budget, setBudget] = useState('')
  const [budgetType, setBudgetType] = useState<'daily' | 'lifetime'>('daily')
  const [endDate, setEndDate] = useState('')
  const [market, setMarket] = useState(() => defaultMarket())
  const [linkUrl, setLinkUrl] = useState('')
  const [submitting, setSubmitting] = useState(false)


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
    }
  }, [open])

  // Identidades autorizadas p/ Spark (carrega ao abrir).
  const { data: identData, isLoading: identLoading, error: identError, mutate: reloadIdentities } = useSWR<{
    identities: SparkIdentity[]
  }>(open && advertiserId ? `/api/ads/spark/identities?adAccountId=${encodeURIComponent(advertiserId)}` : null, fetcher)
  const identities = identData?.identities ?? []
  const identity = useMemo(
    () => identities.find((i) => `${i.identityId}:${i.identityType}` === identityKey) ?? null,
    [identities, identityKey]
  )

  // Posts da identidade selecionada — fonte do tiktok_item_id.
  const videosKey =
    open && advertiserId && identity
      ? `/api/ads/spark/videos?adAccountId=${encodeURIComponent(advertiserId)}&identityId=${encodeURIComponent(identity.identityId)}&identityType=${encodeURIComponent(identity.identityType)}${identity.bcId ? `&bcId=${encodeURIComponent(identity.bcId)}` : ''}`
      : null
  const { data: videoData, isLoading: videosLoading, error: videosError } = useSWR<{ videos: SparkVideo[] }>(videosKey, fetcher)
  const videos = videoData?.videos ?? []
  const selectedVideo = useMemo(() => videos.find((video) => video.itemId === itemId) ?? null, [videos, itemId])

  // Troca de identidade invalida o post selecionado.
  useEffect(() => {
    setItemId('')
  }, [identityKey])

  const error: string | null = useMemo(() => {
    if (!identity) return 'Selecione a identidade (conta ou criador autorizado)'
    if (!itemId) return 'Selecione o post a impulsionar'
    if (!/^https:\/\/\S+/.test(linkUrl.trim())) return 'Informe a página HTTPS de destino'
    if (!(Number(budget) >= TIKTOK_MIN_BUDGET)) return tiktokMinimumBudgetMessage(currency)
    if (budgetType === 'lifetime') {
      if (!endDate) return 'Informe a data de término'
      if (new Date(`${endDate}T23:59:59`).getTime() <= Date.now() + 60 * 60 * 1000) {
        return 'A data de término precisa estar no futuro'
      }
    }
    return null
  }, [name, identity, itemId, linkUrl, budget, budgetType, endDate])

  async function handleSubmit() {
    if (!identity) return
    setSubmitting(true)
    try {
      const payload: Record<string, unknown> = {
        adAccountId: advertiserId,
        name: name.trim() || ('Spark — ' + (videos.find((video) => video.itemId === itemId)?.text || itemId)).slice(0, 120),
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
      if (result.dryRun) { toast.info('Simulação concluída. Nenhum anúncio foi criado.'); return }
      toast.success('Spark Ad criado (pausado)', { hint: 'Revise na dashboard e ative — o TikTok ainda revisa antes de veicular.' })
      onCreated()
    } catch (e) {
      toast.error('Falha ao criar Spark Ad', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      busy={submitting}
      title="Criar Spark Ad"
      description="Escolha quem aparece no anúncio, selecione o post e revise a campanha antes de criar."
      maxWidth="max-w-5xl"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <p className={`text-[11px] ${error ? 'text-warning' : 'text-success'}`}>{error || 'Tudo pronto · o anúncio será criado pausado.'}</p>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-ghost text-xs" onClick={onClose} disabled={submitting}>Cancelar</button>
            <button type="button" className="btn-primary text-xs" onClick={handleSubmit} disabled={submitting || Boolean(error)}>
              {submitting ? <><Loader2 className="size-3.5 animate-spin" /> Criando…</> : <><Zap className="size-3.5" /> Criar Spark pausado</>}
            </button>
          </div>
        </div>
      }
    >
      <div className="launch-composer-grid">
        <fieldset disabled={submitting} className="launch-composer-main border-0 p-0">
          <section className="launch-section-card">
            <span className="launch-section-kicker">1 · Identidade</span>
            <h3 className="launch-section-title">Quem aparece como autor do anúncio</h3>
            <p className="launch-section-copy">Use a conta vinculada, um criador autorizado ou uma identidade do Business Center.</p>

            <div className="mt-4">
              {identLoading ? (
                <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-3 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Carregando identidades…</div>
              ) : identError ? (
                <button type="button" onClick={() => reloadIdentities()} className="flex w-full items-center gap-2 rounded-xl border border-error/30 bg-error/5 px-3 py-3 text-left text-xs text-error"><RefreshCw className="size-3.5" /> Falha ao carregar — tentar novamente</button>
              ) : identities.length === 0 ? (
                <div className="rounded-xl border border-warning/30 bg-warning/5 p-3 text-[11px] leading-relaxed text-warning">
                  Nenhuma identidade autorizada. Vincule sua conta TikTok ou resgate o Spark Code do criador no TikTok Ads Manager.
                </div>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {identities.map(i => {
                    const key = `${i.identityId}:${i.identityType}`
                    return (
                      <button
                        key={key}
                        type="button"
                        aria-pressed={identityKey === key}
                        onClick={() => setIdentityKey(key)}
                        className="launch-choice flex items-center gap-3"
                      >
                        {i.avatarUrl ? <img src={i.avatarUrl} alt="" className="size-9 shrink-0 rounded-full object-cover" /> : <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary"><UserRound className="size-4" /></span>}
                        <span className="min-w-0"><strong className="truncate">{i.displayName || i.identityId}</strong><span>{IDENTITY_TYPE_LABEL[i.identityType]}</span></span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            <p className="mt-3 text-[11px] text-muted-foreground">Criador externo? Depois de resgatar o Spark Code no Ads Manager, ele aparece automaticamente nesta lista.</p>
          </section>

          <section className="launch-section-card">
            <span className="launch-section-kicker">2 · Publicação</span>
            <h3 className="launch-section-title">Escolha o post que será impulsionado</h3>
            <p className="launch-section-copy">O criativo permanece vinculado ao post original e mantém a identidade selecionada.</p>

            {!identity ? (
              <div className="mt-4 rounded-xl border border-border/60 bg-secondary/10 p-3 text-xs text-muted-foreground">Selecione uma identidade para carregar os posts disponíveis.</div>
            ) : videosLoading ? (
              <div className="mt-4 flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-3 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Carregando posts…</div>
            ) : videosError ? (
              <div className="mt-4 rounded-xl border border-error/30 bg-error/5 p-3 text-[11px] text-error">Não foi possível carregar os posts desta identidade.</div>
            ) : videos.length === 0 ? (
              <div className="mt-4 rounded-xl border border-border/60 bg-secondary/10 p-3 text-[11px] text-muted-foreground">Esta identidade não tem posts disponíveis para impulsionar.</div>
            ) : (
              <div className="mt-4 grid max-h-64 gap-2 overflow-y-auto pr-1 sm:grid-cols-2" role="listbox" aria-label="Posts disponíveis">
                {videos.map(v => (
                  <button
                    key={v.itemId}
                    type="button"
                    role="option"
                    aria-selected={itemId === v.itemId}
                    onClick={() => setItemId(v.itemId)}
                    className="launch-choice flex min-h-[72px] items-center gap-3"
                  >
                    {v.coverUrl ? <img src={v.coverUrl} alt="" className="size-12 shrink-0 rounded-lg object-cover" /> : <span className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-secondary"><Play className="size-4" /></span>}
                    <span className="min-w-0"><strong className="truncate">{v.text || 'Publicação TikTok'}</strong><span>{v.duration ? `${Math.round(v.duration)}s · ` : ''}{v.itemId}</span></span>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="launch-section-card">
            <span className="launch-section-kicker">3 · Campanha</span>
            <h3 className="launch-section-title">Destino, mercado e investimento</h3>
            <div className="mt-4 space-y-4">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-foreground">Nome da campanha <span className="text-muted-foreground">(opcional)</span></span>
                <input className="input-neon w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" value={name} onChange={e => setName(e.target.value)} maxLength={120} placeholder="Ex.: Spark — vídeo viral 02" />
              </label>

              <MarketSelector value={market} onChange={setMarket} languageAvailable={false} />

              <div className="launch-field-grid">
                <MoneyField label={budgetType === 'daily' ? 'Orçamento diário' : 'Orçamento total'} currency={currency} value={budget} onChange={setBudget} min={TIKTOK_MIN_BUDGET} hint={`Mínimo: ${fmtSpend(TIKTOK_MIN_BUDGET, currency)}.`} />
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-foreground">Tipo de orçamento</span>
                  <select className="input-neon w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" value={budgetType} onChange={e => setBudgetType(e.target.value as 'daily' | 'lifetime')}>
                    <option value="daily">Diário</option>
                    <option value="lifetime">Total do período</option>
                  </select>
                </label>
              </div>

              {budgetType === 'lifetime' && (
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-foreground">Data de término</span>
                  <input type="date" min={tomorrowLocalIsoDate()} className="input-neon w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" value={endDate} onChange={e => setEndDate(e.target.value)} />
                </label>
              )}

              <label className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-foreground">Página de destino</span>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const value = await navigator.clipboard.readText()
                        if (value && /^https?:\/\//i.test(value.trim())) { setLinkUrl(value.trim()); toast.success('Link colado') }
                        else toast.info('Nenhuma URL válida copiada')
                      } catch { toast.error('Permissão negada para ler a área de transferência') }
                    }}
                    className="flex items-center gap-1 text-[11px] text-primary hover:underline"
                  >
                    <ClipboardPaste className="size-3" /> Colar
                  </button>
                </div>
                <input className="input-neon w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" value={linkUrl} onChange={e => setLinkUrl(e.target.value)} placeholder="https://sualoja.com/oferta" />
              </label>
            </div>
          </section>
        </fieldset>

        <aside className="launch-review" aria-label="Revisão Spark">
          <div className="launch-review-head">
            <div>
              <p className="launch-review-title">Revisão Spark</p>
              <p className="launch-review-copy">Confira identidade, post e investimento antes de criar.</p>
            </div>
            <span className="launch-review-badge">Pausado</span>
          </div>

          <div className="launch-preview-card">
            <div className="launch-preview-media">
              {selectedVideo?.coverUrl ? <img src={selectedVideo.coverUrl} alt="Prévia do post selecionado" /> : <Play className="size-7 text-muted-foreground" />}
            </div>
            <div className="launch-preview-body">
              <strong>{selectedVideo?.text || 'Selecione uma publicação'}</strong>
              <p>{identity?.displayName || 'A identidade aparecerá aqui'}{selectedVideo?.duration ? ` · ${Math.round(selectedVideo.duration)}s` : ''}</p>
            </div>
          </div>

          <div className="launch-review-list">
            <div className="launch-review-row"><span>Identidade</span><strong>{identity?.displayName || identity?.identityId || '—'}</strong></div>
            <div className="launch-review-row"><span>Tipo</span><strong>{identity ? IDENTITY_TYPE_LABEL[identity.identityType] : '—'}</strong></div>
            <div className="launch-review-row"><span>Mercado</span><strong>{market.countries.join(', ') || '—'}</strong></div>
            <div className="launch-review-row"><span>Destino</span><strong>{linkUrl ? linkUrl.replace(/^https?:\/\//, '').split('/')[0] : '—'}</strong></div>
            <div className="launch-review-row"><span>Objetivo</span><strong>Conversões</strong></div>
          </div>

          <div className="launch-review-total">
            <span className="text-[11px] text-muted-foreground">{budgetType === 'daily' ? 'Investimento diário' : 'Investimento total'}</span>
            <strong>{Number(budget) > 0 ? fmtSpend(Number(budget), currency) : '—'}</strong>
            <p className="mt-1 text-[10px] text-muted-foreground">{budgetType === 'lifetime' ? (endDate ? `Até ${endDate}` : 'Defina a data final') : 'Orçamento por dia'}</p>
          </div>

          {error ? (
            <div className="launch-review-warning"><AlertCircle className="mt-0.5 size-3.5 shrink-0" /><span>{error}</span></div>
          ) : (
            <div className="launch-review-ready"><CheckCircle2 className="mt-0.5 size-3.5 shrink-0" /><span>Pronto para criar o Spark Ad pausado.</span></div>
          )}

          {linkUrl && <div className="flex items-center gap-2 text-[10px] text-muted-foreground"><ExternalLink className="size-3" /> O clique continuará levando para sua página de destino.</div>}
        </aside>
      </div>
    </Modal>
  )
}
