'use client'

// Slide-over de criação de campanha TikTok Ads — wizard de 5 etapas:
// 1) Objetivo  2) Orçamento  3) Público  4) Criativo (vídeo)  5) Revisão.
// Espelha as validações do backend (/api/ads/create) para dar feedback
// imediato, e envia Idempotency-Key para retry seguro de rede.

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  X,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Rocket,
  Target,
  Wallet,
  Users,
  Clapperboard,
  CheckCircle2,
  UploadCloud,
  Link2,
} from 'lucide-react'
import { apiSend, adsUpload } from '@/lib/api'
import { toast } from '@/lib/toast'
import type { AdsGoal, AdsIdentity } from '@/lib/types'
import { useModalA11y } from '@/lib/use-modal-a11y'

const GOALS: { value: AdsGoal; label: string; hint: string }[] = [
  { value: 'traffic', label: 'Tráfego', hint: 'Levar cliques para sua página' },
  { value: 'conversions', label: 'Conversões', hint: 'Otimizar por eventos do Pixel TikTok' },
  { value: 'video_views', label: 'Views de vídeo', hint: 'Maximizar visualizações' },
  { value: 'awareness', label: 'Alcance', hint: 'Mostrar para o máximo de pessoas' },
  { value: 'engagement', label: 'Engajamento', hint: 'Curtidas, comentários e follows' },
  { value: 'lead_generation', label: 'Leads', hint: 'Formulários nativos do TikTok' },
]

const CTAS = [
  { value: '', label: 'Automático' },
  { value: 'LEARN_MORE', label: 'Saiba mais' },
  { value: 'SHOP_NOW', label: 'Compre agora' },
  { value: 'SIGN_UP', label: 'Cadastre-se' },
  { value: 'DOWNLOAD_NOW', label: 'Baixe agora' },
  { value: 'CONTACT_US', label: 'Fale conosco' },
  { value: 'BOOK_NOW', label: 'Reserve agora' },
  { value: 'ORDER_NOW', label: 'Peça agora' },
]

const STEPS = [
  { label: 'Objetivo', icon: Target },
  { label: 'Orçamento', icon: Wallet },
  { label: 'Público', icon: Users },
  { label: 'Criativo', icon: Clapperboard },
  { label: 'Revisão', icon: CheckCircle2 },
]

interface FormState {
  name: string
  goal: AdsGoal
  budgetAmount: string
  budgetType: 'daily' | 'lifetime'
  endDate: string
  countries: string
  languages: string
  ageMin: string
  ageMax: string
  pixelId: string
  customEventType: string
  videoUrl: string
  body: string
  linkUrl: string
  callToAction: string
  useIdentity: boolean
}

const INITIAL: FormState = {
  name: '',
  goal: 'traffic',
  budgetAmount: '',
  budgetType: 'daily',
  endDate: '',
  countries: 'BR',
  languages: 'pt',
  ageMin: '',
  ageMax: '',
  pixelId: '',
  customEventType: '',
  videoUrl: '',
  body: '',
  linkUrl: '',
  callToAction: '',
  useIdentity: true,
}

export function CreateAdPanel({
  open,
  onClose,
  advertiserId,
  currency,
  identity,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  advertiserId: string
  currency: string
  identity: AdsIdentity | null
  onCreated: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [step, setStep] = useState(0)
  const [form, setForm] = useState<FormState>(INITIAL)
  const [submitting, setSubmitting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadPct, setUploadPct] = useState(0)
  const idemKey = useMemo(() => (open ? `ttads-${Date.now()}-${Math.random().toString(36).slice(2, 10)}` : ''), [open])

  useModalA11y(open, ref, submitting ? () => {} : onClose)

  // Reset ao reabrir
  useEffect(() => {
    if (open) {
      setStep(0)
      setForm(INITIAL)
      setUploadPct(0)
    }
  }, [open])

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  // ── Validação por etapa (espelha o backend) ──
  const stepError: string | null = useMemo(() => {
    if (step === 0) {
      if (!form.name.trim()) return 'Dê um nome à campanha'
      return null
    }
    if (step === 1) {
      if (!(Number(form.budgetAmount) > 0)) return 'Informe o orçamento'
      if (form.budgetType === 'lifetime' && !/^\d{4}-\d{2}-\d{2}/.test(form.endDate))
        return 'Orçamento total exige data de término'
      return null
    }
    if (step === 2) {
      if (form.goal === 'conversions' && !/^\d{5,30}$/.test(form.pixelId.trim()))
        return 'Conversões exigem o Pixel ID numérico do TikTok'
      return null
    }
    if (step === 3) {
      if (!/^https:\/\/\S+/.test(form.videoUrl.trim())) return 'Adicione o vídeo do anúncio (URL https ou upload)'
      return null
    }
    return null
  }, [step, form])

  async function handleUpload(file: File) {
    if (!file.type.startsWith('video/')) {
      toast.error('Envie um arquivo de vídeo (MP4)')
      return
    }
    if (file.size > 500 * 1024 * 1024) {
      toast.error('Vídeo acima de 500 MB', { hint: 'O TikTok aceita vídeos de até 500 MB.' })
      return
    }
    setUploading(true)
    setUploadPct(30) // upload é uma request única; barra é indicativa
    try {
      const { url } = await adsUpload(file, 'video')
      setUploadPct(100)
      set('videoUrl', url)
      toast.success('Vídeo enviado', { hint: 'URL preenchida automaticamente.' })
    } catch (e) {
      toast.error('Falha no upload do vídeo', { hint: e instanceof Error ? e.message : undefined })
      setUploadPct(0)
    } finally {
      setUploading(false)
    }
  }

  async function handleSubmit() {
    setSubmitting(true)
    try {
      const countries = form.countries
        .split(/[,\s]+/)
        .map((c) => c.trim().toUpperCase())
        .filter((c) => /^[A-Z]{2}$/.test(c))
      const languages = form.languages
        .split(/[,\s]+/)
        .map((c) => c.trim().toLowerCase())
        .filter((c) => /^[a-z]{2}$/.test(c))
      const payload: Record<string, unknown> = {
        adAccountId: advertiserId,
        name: form.name.trim(),
        goal: form.goal,
        budgetAmount: Number(form.budgetAmount),
        budgetType: form.budgetType,
        videoUrl: form.videoUrl.trim(),
        idempotencyKey: idemKey,
      }
      if (form.budgetType === 'lifetime') payload.endDate = form.endDate
      if (countries.length) payload.countries = countries
      if (languages.length) payload.languages = languages
      if (Number(form.ageMin) >= 13) payload.ageMin = Number(form.ageMin)
      if (Number(form.ageMax) >= 13) payload.ageMax = Number(form.ageMax)
      if (form.body.trim()) payload.body = form.body.trim()
      if (/^https?:\/\//.test(form.linkUrl.trim())) payload.linkUrl = form.linkUrl.trim()
      if (form.callToAction) payload.callToAction = form.callToAction
      if (form.goal === 'conversions') {
        payload.promotedObject = {
          pixelId: form.pixelId.trim(),
          ...(form.customEventType.trim() ? { customEventType: form.customEventType.trim().toUpperCase() } : {}),
        }
      }
      if (form.useIdentity && identity) {
        payload.identityType = 'CUSTOMIZED_USER'
        payload.brandIdentity = { displayName: identity.displayName, imageUrl: identity.imageUrl }
      }

      await apiSend('/api/ads/create', 'POST', payload)
      toast.success('Campanha criada no TikTok Ads', {
        hint: 'Ela entra em revisão do TikTok antes de veicular.',
      })
      onCreated()
    } catch (e) {
      toast.error('Falha ao criar a campanha', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  const isLast = step === STEPS.length - 1

  return (
    <div
      className="fixed inset-0 z-[60] flex justify-end bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose()
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="Nova campanha TikTok Ads"
        tabIndex={-1}
        className="anim-drawer-in flex h-full w-full max-w-xl flex-col border-l border-border bg-card outline-none"
      >
        {/* Header + stepper */}
        <div className="border-b border-border px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Rocket className="size-4 text-primary" aria-hidden="true" />
              Nova campanha
            </h2>
            <button
              type="button"
              className="btn-ghost px-2 py-1"
              onClick={onClose}
              disabled={submitting}
              aria-label="Fechar"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
          <ol className="mt-3 flex items-center gap-1" aria-label="Etapas">
            {STEPS.map((s, i) => {
              const Icon = s.icon
              const active = i === step
              const done = i < step
              return (
                <li key={s.label} className="flex flex-1 items-center gap-1">
                  <span
                    className={`flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-medium transition-colors ${
                      active
                        ? 'bg-primary/15 text-primary'
                        : done
                          ? 'text-success'
                          : 'text-muted-foreground'
                    }`}
                    aria-current={active ? 'step' : undefined}
                  >
                    <Icon className="size-3" aria-hidden="true" />
                    <span className="hidden sm:inline">{s.label}</span>
                  </span>
                  {i < STEPS.length - 1 && <span className="h-px flex-1 bg-border" aria-hidden="true" />}
                </li>
              )
            })}
          </ol>
        </div>

        {/* Corpo da etapa */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {step === 0 && (
            <div className="anim-content-in flex flex-col gap-4">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-foreground">Nome da campanha</span>
                <input
                  className="input-neon w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                  value={form.name}
                  onChange={(e) => set('name', e.target.value)}
                  maxLength={120}
                  placeholder="Ex.: Lançamento — vídeo 01"
                />
              </label>
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-xs font-medium text-foreground">Objetivo</legend>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {GOALS.map((g) => (
                    <label
                      key={g.value}
                      className={`flex cursor-pointer flex-col gap-0.5 rounded-xl border px-3 py-2.5 transition-colors ${
                        form.goal === g.value
                          ? 'border-primary/60 bg-primary/10'
                          : 'border-border bg-background hover:bg-secondary/50'
                      }`}
                    >
                      <input
                        type="radio"
                        name="goal"
                        value={g.value}
                        checked={form.goal === g.value}
                        onChange={() => set('goal', g.value)}
                        className="sr-only"
                      />
                      <span className="text-xs font-semibold text-foreground">{g.label}</span>
                      <span className="text-[11px] text-muted-foreground">{g.hint}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
          )}

          {step === 1 && (
            <div className="anim-content-in flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-foreground">Orçamento ({currency})</span>
                  <input
                    type="number"
                    min={1}
                    step="0.01"
                    className="input-neon w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                    value={form.budgetAmount}
                    onChange={(e) => set('budgetAmount', e.target.value)}
                    placeholder="50,00"
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-foreground">Tipo</span>
                  <select
                    className="input-neon w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                    value={form.budgetType}
                    onChange={(e) => set('budgetType', e.target.value as 'daily' | 'lifetime')}
                  >
                    <option value="daily">Diário</option>
                    <option value="lifetime">Total (lifetime)</option>
                  </select>
                </label>
              </div>
              {form.budgetType === 'lifetime' && (
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-foreground">Data de término</span>
                  <input
                    type="date"
                    className="input-neon w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                    value={form.endDate}
                    onChange={(e) => set('endDate', e.target.value)}
                  />
                </label>
              )}
              <p className="rounded-lg bg-secondary/60 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                O TikTok exige orçamento mínimo por campanha (geralmente {currency} 50/dia no nível de grupo).
                Valores muito baixos podem ser rejeitados na criação.
              </p>
            </div>
          )}

          {step === 2 && (
            <div className="anim-content-in flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-foreground">Países (ISO-2)</span>
                  <input
                    className="input-neon w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                    value={form.countries}
                    onChange={(e) => set('countries', e.target.value)}
                    placeholder="BR, PT, US"
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-foreground">Idiomas</span>
                  <input
                    className="input-neon w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                    value={form.languages}
                    onChange={(e) => set('languages', e.target.value)}
                    placeholder="pt, en"
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-foreground">Idade mínima</span>
                  <input
                    type="number"
                    min={13}
                    max={65}
                    className="input-neon w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                    value={form.ageMin}
                    onChange={(e) => set('ageMin', e.target.value)}
                    placeholder="18"
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-foreground">Idade máxima</span>
                  <input
                    type="number"
                    min={13}
                    max={65}
                    className="input-neon w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                    value={form.ageMax}
                    onChange={(e) => set('ageMax', e.target.value)}
                    placeholder="55"
                  />
                </label>
              </div>
              {form.goal === 'conversions' && (
                <div className="flex flex-col gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-foreground">Pixel ID do TikTok (numérico)</span>
                    <input
                      className="input-neon w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                      value={form.pixelId}
                      onChange={(e) => set('pixelId', e.target.value.replace(/\D/g, ''))}
                      inputMode="numeric"
                      placeholder="7123456789012345678"
                    />
                    <span className="text-[11px] text-muted-foreground">
                      É o ID numérico do pixel — não o código alfanumérico (CJ0D3…) do Events Manager.
                    </span>
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-foreground">Evento de otimização (opcional)</span>
                    <input
                      className="input-neon w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                      value={form.customEventType}
                      onChange={(e) => set('customEventType', e.target.value.toUpperCase())}
                      placeholder="COMPLETE_PAYMENT"
                    />
                  </label>
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="anim-content-in flex flex-col gap-4">
              {/* Vídeo: URL ou upload */}
              <div className="flex flex-col gap-2">
                <span className="text-xs font-medium text-foreground">Vídeo do anúncio</span>
                <label className="flex items-center gap-2">
                  <Link2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <input
                    className="input-neon w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                    value={form.videoUrl}
                    onChange={(e) => set('videoUrl', e.target.value)}
                    placeholder="https://…/video.mp4"
                    aria-label="URL pública do vídeo MP4"
                  />
                </label>
                <div className="relative">
                  <label
                    className={`flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border border-dashed px-4 py-5 text-center transition-colors ${
                      uploading ? 'border-primary/50 bg-primary/5' : 'border-border hover:border-primary/40 hover:bg-secondary/40'
                    }`}
                  >
                    <input
                      type="file"
                      accept="video/mp4,video/*"
                      className="sr-only"
                      disabled={uploading}
                      onChange={(e) => {
                        const f = e.target.files?.[0]
                        if (f) handleUpload(f)
                        e.target.value = ''
                      }}
                    />
                    {uploading ? (
                      <Loader2 className="size-5 animate-spin text-primary" aria-hidden="true" />
                    ) : (
                      <UploadCloud className="size-5 text-muted-foreground" aria-hidden="true" />
                    )}
                    <span className="text-xs font-medium text-foreground">
                      {uploading ? 'Enviando vídeo…' : 'ou envie o MP4 (até 500 MB)'}
                    </span>
                    <span className="text-[11px] text-muted-foreground">Vertical 9:16 · 5 a 60 segundos</span>
                  </label>
                  {uploadPct > 0 && uploadPct < 100 && (
                    <div className="absolute inset-x-4 bottom-2 h-1 overflow-hidden rounded-full bg-secondary">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${uploadPct}%` }}
                      />
                    </div>
                  )}
                </div>
              </div>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-foreground">Legenda (até 100 caracteres)</span>
                <textarea
                  className="input-neon min-h-16 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm leading-relaxed text-foreground"
                  value={form.body}
                  onChange={(e) => set('body', e.target.value)}
                  maxLength={100}
                  placeholder="Texto que aparece sobre o vídeo"
                />
                <span className="self-end text-[11px] tabular-nums text-muted-foreground">{form.body.length}/100</span>
              </label>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-foreground">Página de destino</span>
                  <input
                    className="input-neon w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                    value={form.linkUrl}
                    onChange={(e) => set('linkUrl', e.target.value)}
                    placeholder="https://sualoja.com/oferta"
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-foreground">Botão (CTA)</span>
                  <select
                    className="input-neon w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                    value={form.callToAction}
                    onChange={(e) => set('callToAction', e.target.value)}
                  >
                    {CTAS.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {identity && (
                <label className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={form.useIdentity}
                    onChange={(e) => set('useIdentity', e.target.checked)}
                    className="size-4 accent-[color:var(--primary)]"
                  />
                  <img
                    src={identity.imageUrl || '/dashboard/roi-nados-logo.png'}
                    alt=""
                    className="size-6 rounded-full object-cover"
                  />
                  <span className="text-xs text-foreground">
                    Anunciar como <strong>{identity.displayName}</strong>
                  </span>
                </label>
              )}
            </div>
          )}

          {step === 4 && (
            <div className="anim-content-in flex flex-col gap-3">
              <p className="text-xs text-muted-foreground">Confira tudo antes de publicar:</p>
              <dl className="flex flex-col divide-y divide-border rounded-xl border border-border bg-background text-xs">
                {[
                  ['Campanha', form.name],
                  ['Objetivo', GOALS.find((g) => g.value === form.goal)?.label ?? form.goal],
                  [
                    'Orçamento',
                    `${currency} ${form.budgetAmount} / ${form.budgetType === 'daily' ? 'dia' : `total até ${form.endDate}`}`,
                  ],
                  ['Países', form.countries || '—'],
                  ['Idiomas', form.languages || '—'],
                  [
                    'Idade',
                    form.ageMin || form.ageMax ? `${form.ageMin || '13'}–${form.ageMax || '65'}` : 'Todas',
                  ],
                  ...(form.goal === 'conversions' ? [['Pixel', form.pixelId] as [string, string]] : []),
                  ['Vídeo', form.videoUrl.length > 48 ? form.videoUrl.slice(0, 48) + '…' : form.videoUrl],
                  ['Destino', form.linkUrl || '—'],
                  [
                    'Identidade',
                    form.useIdentity && identity ? identity.displayName : 'Conta conectada (TT_USER)',
                  ],
                ].map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between gap-4 px-3 py-2">
                    <dt className="shrink-0 text-muted-foreground">{k}</dt>
                    <dd className="truncate font-medium text-foreground">{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="rounded-lg bg-warning/10 px-3 py-2 text-[11px] leading-relaxed text-warning">
                Ao publicar, a campanha é criada no TikTok e entra na revisão deles (normalmente até 24h).
                Ela nasce ativa e começa a gastar assim que aprovada.
              </p>
            </div>
          )}
        </div>

        {/* Footer: erro da etapa + navegação */}
        <div className="border-t border-border px-5 py-3">
          {stepError && (
            <p className="mb-2 text-[11px] font-medium text-error" role="alert">
              {stepError}
            </p>
          )}
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={() => (step === 0 ? onClose() : setStep(step - 1))}
              disabled={submitting}
            >
              <ChevronLeft className="size-3.5" aria-hidden="true" />
              {step === 0 ? 'Cancelar' : 'Voltar'}
            </button>
            {isLast ? (
              <button
                type="button"
                className="btn-primary text-xs"
                onClick={handleSubmit}
                disabled={submitting || Boolean(stepError)}
              >
                {submitting ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                    Publicando…
                  </>
                ) : (
                  <>
                    <Rocket className="size-3.5" aria-hidden="true" />
                    Publicar campanha
                  </>
                )}
              </button>
            ) : (
              <button
                type="button"
                className="btn-primary text-xs"
                onClick={() => setStep(step + 1)}
                disabled={Boolean(stepError) || uploading}
              >
                Avançar
                <ChevronRight className="size-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
