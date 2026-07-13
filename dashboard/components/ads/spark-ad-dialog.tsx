'use client'

// Spark Ads — impulsiona um vídeo orgânico do TikTok como anúncio.
// Aceita o ID do vídeo da conta conectada (platformPostId) OU um Spark Code
// gerado por outro criador. Cria via POST /api/ads/boost.

import { useEffect, useMemo, useRef, useState } from 'react'
import { X, Zap, Loader2 } from 'lucide-react'
import { apiSend, apiErrorHint } from '@/lib/api'
import { toast } from '@/lib/toast'
import type { AdsGoal } from '@/lib/types'
import { GlassCard } from '@/components/glass-card'
import { useModalA11y } from '@/lib/use-modal-a11y'

const GOALS: { value: AdsGoal; label: string }[] = [
  { value: 'engagement', label: 'Engajamento' },
  { value: 'traffic', label: 'Tráfego' },
  { value: 'video_views', label: 'Views de vídeo' },
  { value: 'awareness', label: 'Alcance' },
]

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
  const [source, setSource] = useState<'own' | 'creator'>('own')
  const [name, setName] = useState('')
  const [goal, setGoal] = useState<AdsGoal>('engagement')
  const [videoId, setVideoId] = useState('')
  const [sparkCode, setSparkCode] = useState('')
  const [budget, setBudget] = useState('')
  const [budgetType, setBudgetType] = useState<'daily' | 'lifetime'>('daily')
  const [countries, setCountries] = useState('BR')
  const [linkUrl, setLinkUrl] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useModalA11y(open, ref, submitting ? () => {} : onClose)

  useEffect(() => {
    if (open) {
      setSource('own')
      setName('')
      setGoal('engagement')
      setVideoId('')
      setSparkCode('')
      setBudget('')
      setBudgetType('daily')
      setCountries('BR')
      setLinkUrl('')
    }
  }, [open])

  const error: string | null = useMemo(() => {
    if (!name.trim()) return 'Dê um nome à campanha'
    if (source === 'own' && !videoId.trim()) return 'Informe o ID do vídeo'
    if (source === 'creator' && !sparkCode.trim()) return 'Cole o Spark Code do criador'
    if (!(Number(budget) > 0)) return 'Informe o orçamento'
    return null
  }, [name, source, videoId, sparkCode, budget])

  async function handleSubmit() {
    setSubmitting(true)
    try {
      const countryList = countries
        .split(/[,\s]+/)
        .map((c) => c.trim().toUpperCase())
        .filter((c) => /^[A-Z]{2}$/.test(c))
      const payload: Record<string, unknown> = {
        adAccountId: advertiserId,
        name: name.trim(),
        goal,
        budget: { amount: Number(budget), type: budgetType },
      }
      if (source === 'own') payload.platformPostId = videoId.trim()
      else payload.sparkAuthCode = sparkCode.trim()
      if (countryList.length) payload.countries = countryList
      if (/^https?:\/\//.test(linkUrl.trim())) payload.linkUrl = linkUrl.trim()

      await apiSend('/api/ads/boost', 'POST', payload)
      toast.success('Spark Ad criado', { hint: 'O vídeo entra em revisão do TikTok antes de veicular.' })
      onCreated()
    } catch (e) {
      toast.error('Falha ao criar Spark Ad', { hint: apiErrorHint(e) })
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
      <div ref={ref} role="dialog" aria-modal="true" aria-label="Impulsionar vídeo (Spark Ads)" tabIndex={-1} className="w-full max-w-md outline-none">
        <GlassCard className="anim-pop-in flex flex-col gap-4 p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Zap className="size-4 text-primary" aria-hidden="true" />
              Impulsionar vídeo (Spark Ads)
            </h2>
            <button type="button" className="btn-ghost px-2 py-1" onClick={onClose} disabled={submitting} aria-label="Fechar">
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>

          {/* Fonte do vídeo */}
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Fonte do vídeo">
            <button
              type="button"
              onClick={() => setSource('own')}
              aria-pressed={source === 'own'}
              className={`rounded-xl border px-3 py-2 text-xs font-medium transition-colors ${
                source === 'own' ? 'border-primary/60 bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-secondary/50'
              }`}
            >
              Meu vídeo
            </button>
            <button
              type="button"
              onClick={() => setSource('creator')}
              aria-pressed={source === 'creator'}
              className={`rounded-xl border px-3 py-2 text-xs font-medium transition-colors ${
                source === 'creator' ? 'border-primary/60 bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-secondary/50'
              }`}
            >
              Vídeo de criador
            </button>
          </div>

          {source === 'own' ? (
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground">ID do vídeo (da conta conectada)</span>
              <input
                className="input-neon w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                value={videoId}
                onChange={(e) => setVideoId(e.target.value)}
                placeholder="7234567890123456789"
              />
              <span className="text-[11px] text-muted-foreground">
                É o número no final da URL do vídeo: tiktok.com/@conta/video/<strong>723456…</strong>
              </span>
            </label>
          ) : (
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground">Spark Code do criador</span>
              <input
                className="input-neon w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                value={sparkCode}
                onChange={(e) => setSparkCode(e.target.value)}
                placeholder="Cole o código de autorização"
              />
              <span className="text-[11px] text-muted-foreground">
                O criador gera em: TikTok → Configurações → Criador → Autorização de anúncio.
              </span>
            </label>
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
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground">Objetivo</span>
              <select
                className="input-neon w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                value={goal}
                onChange={(e) => setGoal(e.target.value as AdsGoal)}
              >
                {GOALS.map((g) => (
                  <option key={g.value} value={g.value}>
                    {g.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground">Países (ISO-2)</span>
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
                min={1}
                step="0.01"
                className="input-neon w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                placeholder="50,00"
              />
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

          {goal === 'traffic' && (
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground">Página de destino (opcional)</span>
              <input
                className="input-neon w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="https://sualoja.com/oferta"
              />
            </label>
          )}

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
