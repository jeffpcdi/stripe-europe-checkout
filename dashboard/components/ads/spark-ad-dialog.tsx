'use client'

// Spark Ads — impulsiona um post orgânico do TikTok como anúncio (F5, via
// Pipeboard). Fluxo: seleciona a IDENTIDADE autorizada (TT_USER = conta
// vinculada; AUTH_CODE = criador cujo Spark Code já foi resgatado no Ads
// Manager) → seleciona o POST da identidade → cria via POST /api/ads/boost.
// Colar Spark Code cru não é suportado pela API — o aviso explica o resgate.

import { useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import { X, Zap, Loader2, RefreshCw } from 'lucide-react'
import { apiSend, fetcher } from '@/lib/api'
import { toast } from '@/lib/toast'
import { GlassCard } from '@/components/glass-card'
import { useModalA11y } from '@/lib/use-modal-a11y'
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
  const ref = useRef<HTMLDivElement>(null)
  const [name, setName] = useState('')
  const [identityKey, setIdentityKey] = useState('') // identityId:identityType
  const [itemId, setItemId] = useState('')
  const [budget, setBudget] = useState('')
  const [budgetType, setBudgetType] = useState<'daily' | 'lifetime'>('daily')
  const [endDate, setEndDate] = useState('')
  const [countries, setCountries] = useState('BR')
  const [linkUrl, setLinkUrl] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useModalA11y(open, ref, submitting ? () => {} : onClose)

  useEffect(() => {
    if (open) {
      setName('')
      setIdentityKey('')
      setItemId('')
      setBudget('')
      setBudgetType('daily')
      setEndDate('')
      setCountries('BR')
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

  // Troca de identidade invalida o post selecionado.
  useEffect(() => {
    setItemId('')
  }, [identityKey])

  const error: string | null = useMemo(() => {
    if (!name.trim()) return 'Dê um nome à campanha'
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
      const countryList = countries
        .split(/[,\s]+/)
        .map((c) => c.trim().toUpperCase())
        .filter((c) => /^[A-Z]{2}$/.test(c))
      const payload: Record<string, unknown> = {
        adAccountId: advertiserId,
        name: name.trim(),
        goal: 'conversions',
        budget: { amount: Number(budget), type: budgetType },
        identityId: identity.identityId,
        identityType: identity.identityType,
        itemId,
      }
      if (identity.bcId) payload.bcId = identity.bcId
      if (budgetType === 'lifetime') payload.endDate = endDate
      if (countryList.length) payload.countries = countryList
      payload.linkUrl = linkUrl.trim()

      await apiSend('/api/ads/boost', 'POST', payload)
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
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose()
      }}
    >
      <div ref={ref} role="dialog" aria-modal="true" aria-label="Usar publicação · Spark" tabIndex={-1} className="w-full max-w-md outline-none">
        <GlassCard className="anim-pop-in flex max-h-[calc(100dvh-2rem)] flex-col gap-4 overflow-y-auto overscroll-contain p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Zap className="size-4 text-primary" aria-hidden="true" />
              Usar publicação · Spark
            </h2>
            <button type="button" className="btn-ghost px-2 py-1" onClick={onClose} disabled={submitting} aria-label="Fechar">
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>

          {/* Identidade (conta vinculada ou criador autorizado) */}
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-foreground">Perfil da publicação</span>
            {identLoading ? (
              <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                Carregando identidades…
              </div>
            ) : identError ? (
              <button
                type="button"
                onClick={() => reloadIdentities()}
                className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-left text-xs text-error"
              >
                <RefreshCw className="size-3.5" aria-hidden="true" />
                Falha ao carregar — tocar para tentar de novo
              </button>
            ) : identities.length === 0 ? (
              <p className="rounded-lg bg-warning/10 px-3 py-2 text-[11px] leading-relaxed text-warning">
                Nenhuma identidade autorizada para Spark nesta conta. Vincule sua conta TikTok ou resgate um Spark Code
                no TikTok Ads Manager (Ativos → Criativo → Autorização de post).
              </p>
            ) : (
              <select
                className="input-neon w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                value={identityKey}
                onChange={(e) => setIdentityKey(e.target.value)}
              >
                <option value="">Selecione…</option>
                {identities.map((i) => (
                  <option key={`${i.identityId}:${i.identityType}`} value={`${i.identityId}:${i.identityType}`}>
                    {(i.displayName || i.identityId) + ' — ' + IDENTITY_TYPE_LABEL[i.identityType]}
                  </option>
                ))}
              </select>
            )}
            <span className="text-[11px] text-muted-foreground">
              Criador de fora? Resgate o Spark Code dele no TikTok Ads Manager — ele aparece aqui como &quot;Criador
              autorizado&quot;.
            </span>
          </label>

          {/* Post da identidade */}
          {identity && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground">Post a impulsionar</span>
              {videosLoading ? (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  Carregando posts…
                </div>
              ) : videosError ? (
                <p className="rounded-lg bg-error/10 px-3 py-2 text-[11px] text-error">Falha ao carregar os posts desta identidade.</p>
              ) : videos.length === 0 ? (
                <p className="rounded-lg bg-secondary/60 px-3 py-2 text-[11px] text-muted-foreground">
                  Esta identidade não tem posts disponíveis para impulsionar.
                </p>
              ) : (
                <div className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-lg border border-border p-1" role="listbox" aria-label="Posts disponíveis">
                  {videos.map((v) => (
                    <button
                      key={v.itemId}
                      type="button"
                      role="option"
                      aria-selected={itemId === v.itemId}
                      onClick={() => setItemId(v.itemId)}
                      className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                        itemId === v.itemId ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-secondary/50'
                      }`}
                    >
                      {v.coverUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={v.coverUrl || "/placeholder.svg"} alt="" className="size-9 shrink-0 rounded object-cover" />
                      ) : (
                        <span className="flex size-9 shrink-0 items-center justify-center rounded bg-secondary text-[10px] text-muted-foreground">
                          vídeo
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{v.text || v.itemId}</span>
                        {v.duration ? <span className="text-[10px] text-muted-foreground">{Math.round(v.duration)}s</span> : null}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-foreground">Nome da campanha</span>
            <input
              className="input-neon w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              placeholder="Ex.: Spark — vídeo viral 02"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
              Conversão · compra · Pixel automático
            </div>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground">Países (ex.: BR, PT)</span>
              <input
                className="input-neon w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                value={countries}
                onChange={(e) => setCountries(e.target.value)}
                placeholder="BR"
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground">Orçamento ({currency})</span>
              <input
                type="number"
                min={TIKTOK_MIN_BUDGET}
                step="0.01"
                className="input-neon w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                placeholder="50,00"
              />
              <span className="text-[10px] text-muted-foreground">Mínimo: {currency} {TIKTOK_MIN_BUDGET}.</span>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground">Tipo</span>
              <select
                className="input-neon w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                value={budgetType}
                onChange={(e) => setBudgetType(e.target.value as 'daily' | 'lifetime')}
              >
                <option value="daily">Diário</option>
                <option value="lifetime">Total</option>
              </select>
            </label>
          </div>

          {budgetType === 'lifetime' && (
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground">Data de término</span>
              <input
                type="date"
                min={tomorrowLocalIsoDate()}
                className="input-neon w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </label>
          )}

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-foreground">Página de destino</span>
            <input
              className="input-neon w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="https://sualoja.com/oferta"
            />
          </label>

          {error && (
            <p className="text-[11px] font-medium text-error" role="alert">
              {error}
            </p>
          )}

          <div className="flex items-center justify-end gap-2">
            <button type="button" className="btn-ghost text-xs" onClick={onClose} disabled={submitting}>
              Cancelar
            </button>
            <button type="button" className="btn-primary text-xs" onClick={handleSubmit} disabled={submitting || Boolean(error)}>
              {submitting ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  Impulsionando…
                </>
              ) : (
                <>
                  <Zap className="size-3.5" aria-hidden="true" />
                  Impulsionar
                </>
              )}
            </button>
          </div>
        </GlassCard>
      </div>
    </div>
  )
}
