'use client'

// Slide-over de criação de campanha TikTok Ads — wizard de 6 etapas:
// objetivo, orçamento, público, Pixel, criativo e revisão.
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
  BookmarkPlus,
  FlaskConical,
  Trash2,
} from 'lucide-react'
import { apiSend, adsUpload, useAdsTemplates, useAdsInterests, useAdsCatalogs, useAdsCatalogCapabilities, adsCreateCatalogCampaign } from '@/lib/api'
import { toast } from '@/lib/toast'
import type { AdsGoal, AdsTemplate } from '@/lib/types'
import { useModalA11y } from '@/lib/use-modal-a11y'
import { CreativeLibrary } from './creative-library'
import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  TIKTOK_CTA_OPTIONS,
  TIKTOK_MIN_BUDGET,
  TIKTOK_PIXEL_EVENTS,
  matchesTikTokInterest,
  tiktokMinimumBudgetMessage,
  tomorrowLocalIsoDate,
  toLocalIsoDate,
} from './tiktok-contracts'

const GOALS: { value: AdsGoal; label: string; hint: string }[] = [
  { value: 'traffic', label: 'Tráfego', hint: 'Levar cliques para sua página' },
  { value: 'conversions', label: 'Conversões', hint: 'Otimizar por eventos do Pixel TikTok' },
  { value: 'video_views', label: 'Views de vídeo', hint: 'Maximizar visualizações' },
  { value: 'awareness', label: 'Alcance', hint: 'Mostrar para o máximo de pessoas' },
  { value: 'engagement', label: 'Engajamento', hint: 'Curtidas, comentários e follows' },
  { value: 'lead_generation', label: 'Leads', hint: 'Captar leads no site usando o Pixel' },
]

const CTAS = [
  { value: '', label: 'Automático' },
  ...TIKTOK_CTA_OPTIONS,
]

const GENDERS: { value: 'all' | 'male' | 'female'; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'male', label: 'Homens' },
  { value: 'female', label: 'Mulheres' },
]

// Posicionamentos suportados na criação (whitelist espelhada no backend).
const PLACEMENTS: { value: string; label: string }[] = [
  { value: 'PLACEMENT_TIKTOK', label: 'TikTok' },
  { value: 'PLACEMENT_PANGLE', label: 'Pangle (rede de apps)' },
  { value: 'PLACEMENT_GLOBAL_APP_BUNDLE', label: 'Global App Bundle' },
]

const STEPS = [
  { label: 'Objetivo', icon: Target },
  { label: 'Orçamento', icon: Wallet },
  { label: 'Público', icon: Users },
  { label: 'Pixel', icon: Link2 },
  { label: 'Criativo', icon: Clapperboard },
  { label: 'Revisão', icon: CheckCircle2 },
]

interface FormState {
  name: string
  goal: AdsGoal
  budgetAmount: string
  budgetType: 'daily' | 'lifetime'
  budgetOptimization: 'adgroup' | 'campaign'
  bidStrategy: 'lowest_cost' | 'cost_cap'
  bidAmount: string
  endDate: string
  countries: string
  languages: string
  ageMin: string
  ageMax: string
  gender: 'all' | 'male' | 'female'
  placementMode: 'automatic' | 'custom'
  placements: string[]
  interestIds: string[]
  pixelId: string
  customEventType: string
  videoUrl: string
  body: string
  linkUrl: string
  callToAction: string
  // Campanha de catálogo (DPA): quando preenchido, criativo/produtos/destino
  // vêm TODOS do catálogo — a URL do site fica indisponível por construção.
  catalogId: string
}

const INITIAL: FormState = {
  name: '',
  goal: 'traffic',
  budgetAmount: '',
  budgetType: 'daily',
  budgetOptimization: 'adgroup',
  bidStrategy: 'lowest_cost',
  bidAmount: '',
  endDate: '',
  countries: 'BR',
  languages: 'pt',
  ageMin: '',
  ageMax: '',
  gender: 'all',
  placementMode: 'automatic',
  placements: [],
  interestIds: [],
  pixelId: '',
  customEventType: '',
  videoUrl: '',
  body: '',
  linkUrl: '',
  callToAction: '',
  catalogId: '',
}

export function CreateAdPanel({
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
  const [step, setStep] = useState(0)
  const [form, setForm] = useState<FormState>(INITIAL)
  const [submitting, setSubmitting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadPct, setUploadPct] = useState(0)
  const [libraryOpen, setLibraryOpen] = useState(false)
  // Templates: configurações salvas (sem vídeo) para pré-preencher o wizard
  const { data: templatesData, mutate: mutateTemplates } = useAdsTemplates(open, advertiserId)
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [templateNaming, setTemplateNaming] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [deleteTemplate, setDeleteTemplate] = useState<{ id: string; name: string } | null>(null)
  const [deletingTemplate, setDeletingTemplate] = useState(false)
  const [nestedModalOpen, setNestedModalOpen] = useState(false)
  // Variações A/B: vídeos EXTRAS além do principal → 1 campanha por vídeo
  const [variantUrls, setVariantUrls] = useState<string[]>([])
  const [variantsOpen, setVariantsOpen] = useState(false)
  const idemKey = useMemo(() => (open ? `ttads-${Date.now()}-${Math.random().toString(36).slice(2, 10)}` : ''), [open])
  // Interesses: só busca com o passo Público aberto (lista grande, cacheada).
  const [interestQuery, setInterestQuery] = useState('')
  const { data: interestsData } = useAdsInterests(open && step === 2, advertiserId)
  const interestMatches = useMemo(() => {
    const all = interestsData?.interests ?? []
    if (!interestQuery.trim()) return [] as { id: string; name: string }[]
    return all.filter((interest) => matchesTikTokInterest(interest.name, interestQuery)).slice(0, 8)
  }, [interestsData, interestQuery])
  const interestName = (id: string) => interestsData?.interests.find((i) => i.id === id)?.name ?? id
  // Catálogos publicados no TikTok (fluxo CSV manual): só os vinculados a um
  // catálogo do TikTok (tiktokCatalogId + bcId) podem virar campanha DPA.
  const { data: catalogsData } = useAdsCatalogs(open, advertiserId)
  const { data: catalogCapabilitiesData } = useAdsCatalogCapabilities(open, advertiserId)
  const catalogs = catalogsData?.catalogs ?? []
  const catalogCampaignSupported = catalogCapabilitiesData?.capabilities.manualCatalogCampaign === true
  const selectedCatalog = catalogs.find((c) => c.id === form.catalogId) ?? null

  useModalA11y(open && !deleteTemplate && !nestedModalOpen, ref, submitting ? () => {} : onClose)

  // Reset ao reabrir
  useEffect(() => {
    if (open) {
      setStep(0)
      setForm(INITIAL)
      setUploadPct(0)
      setVariantUrls([])
      setVariantsOpen(false)
      setTemplateNaming(false)
      setTemplateName('')
      setDeleteTemplate(null)
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
      if (!(Number(form.budgetAmount) >= TIKTOK_MIN_BUDGET)) return tiktokMinimumBudgetMessage(currency)
      if (form.budgetType === 'lifetime' && !/^\d{4}-\d{2}-\d{2}/.test(form.endDate))
        return 'Orçamento total exige data de término'
      if (form.budgetType === 'lifetime' && form.endDate <= toLocalIsoDate(new Date()))
        return 'A data de término precisa ser futura'
      if (form.bidStrategy === 'cost_cap' && !(Number(form.bidAmount) > 0))
        return 'Custo-alvo exige um valor de lance maior que zero'
      return null
    }
    if (step === 2) {
      if (Number(form.ageMin) >= 13 && Number(form.ageMax) >= 13 && Number(form.ageMin) > Number(form.ageMax))
        return 'A idade mínima não pode ser maior que a máxima'
      if (form.placementMode === 'custom' && form.placements.length === 0)
        return 'Escolha ao menos um posicionamento ou use o modo automático'
      return null
    }
    if (step === 3) {
      if (form.goal === 'conversions' || form.goal === 'lead_generation') {
        if (!/^\d{5,30}$/.test(form.pixelId.trim()))
          return `${form.goal === 'lead_generation' ? 'Leads' : 'Conversões'} exige o Pixel ID numérico do TikTok`
        if (!TIKTOK_PIXEL_EVENTS.some((event) => event.value === form.customEventType))
          return 'Selecione o evento do Pixel usado para otimização'
      }
      return null
    }
    if (step === 4) {
      // Catálogo selecionado: o criativo é gerado dos produtos (DPA) — vídeo
      // e URL do site não se aplicam.
      if (form.catalogId) {
        return null
      }
      if (!/^https:\/\/\S+/.test(form.videoUrl.trim())) return 'Adicione o vídeo do anúncio (URL https ou upload)'
      if (form.goal === 'lead_generation' && !/^https:\/\/\S+/.test(form.linkUrl.trim()))
        return 'Leads exige a URL HTTPS da página de captura'
      return null
    }
    return null
  }, [step, form, currency])

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

  // Preenche o wizard com um template salvo (mantém o vídeo em branco)
  function applyTemplate(t: AdsTemplate) {
    const p = t.payload
    setForm((f) => ({
      ...f,
      goal: (p.goal as AdsGoal) || f.goal,
      budgetAmount: p.budgetAmount ? String(p.budgetAmount) : f.budgetAmount,
      budgetType: p.budgetType || f.budgetType,
      body: p.body ?? f.body,
      linkUrl: p.linkUrl ?? f.linkUrl,
      callToAction: p.callToAction ?? f.callToAction,
      countries: p.countries?.join(', ') || f.countries,
      languages: p.languages?.join(', ') || f.languages,
      ageMin: p.ageMin ? String(p.ageMin) : f.ageMin,
      ageMax: p.ageMax ? String(p.ageMax) : f.ageMax,
      gender: p.gender ?? f.gender,
      interestIds: p.interestIds ?? f.interestIds,
      placements: p.placements ?? f.placements,
      placementMode: p.placements && p.placements.length ? 'custom' : f.placementMode,
      pixelId: p.pixelId ?? f.pixelId,
      customEventType: p.customEventType ?? f.customEventType,
    }))
    toast.success('Template aplicado', { hint: `"${t.name}" — só falta o vídeo e o nome.` })
  }

  async function handleSaveTemplate() {
    if (!templateName.trim()) return
    setSavingTemplate(true)
    try {
      await apiSend('/api/ads/templates', 'POST', {
        adAccountId: advertiserId,
        name: templateName.trim(),
        payload: {
          goal: form.goal,
          budgetAmount: Number(form.budgetAmount) || undefined,
          budgetType: form.budgetType,
          body: form.body.trim() || undefined,
          linkUrl: form.linkUrl.trim() || undefined,
          callToAction: form.callToAction || undefined,
          countries: form.countries.split(/[,\s]+/).filter(Boolean),
          languages: form.languages.split(/[,\s]+/).filter(Boolean),
          ageMin: Number(form.ageMin) || undefined,
          ageMax: Number(form.ageMax) || undefined,
          gender: form.gender !== 'all' ? form.gender : undefined,
          interestIds: form.interestIds.length ? form.interestIds : undefined,
          placements: form.placementMode === 'custom' && form.placements.length ? form.placements : undefined,
          pixelId: form.pixelId.trim() || undefined,
          customEventType: form.customEventType.trim() || undefined,
        },
      })
      mutateTemplates()
      toast.success('Template salvo', { hint: 'Disponível na próxima campanha.' })
      setTemplateNaming(false)
      setTemplateName('')
    } catch (e) {
      toast.error('Falha ao salvar template', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setSavingTemplate(false)
    }
  }

  async function handleDeleteTemplate() {
    if (!deleteTemplate) return
    setDeletingTemplate(true)
    try {
      await apiSend(
        `/api/ads/templates?id=${encodeURIComponent(deleteTemplate.id)}&adAccountId=${encodeURIComponent(advertiserId)}`,
        'DELETE',
      )
      mutateTemplates()
      toast.success('Template excluído')
    } catch (error) {
      toast.error('Falha ao excluir template', { hint: error instanceof Error ? error.message : undefined })
    } finally {
      setDeletingTemplate(false)
      setDeleteTemplate(null)
    }
  }

  async function handleSubmit() {
    setSubmitting(true)
    try {
      const countries = form.countries
        .split(/[,\s]+/)
        .map((c) => c.trim().toUpperCase())
        .filter((c) => /^[A-Z]{2}$/.test(c))

      // ── Campanha de CATÁLOGO (DPA): criativo, produtos e destino vêm 100%
      // do catálogo — nada de vídeo/URL manual. Usa a rota dedicada.
      if (form.catalogId) {
        await adsCreateCatalogCampaign(form.catalogId, advertiserId, {
          adAccountId: advertiserId,
          name: form.name.trim(),
          budgetAmount: Number(form.budgetAmount),
          budgetType: form.budgetType,
          ...(form.budgetType === 'lifetime' ? { endDate: form.endDate } : {}),
          budgetOptimization: form.budgetOptimization,
          bidStrategy: form.bidStrategy,
          ...(form.bidStrategy === 'cost_cap' ? { bidAmount: Number(form.bidAmount) } : {}),
          ...(countries.length ? { country: countries[0] } : {}),
          productScope: 'all',
        })
        toast.success('Criação da campanha de catálogo iniciada', {
          hint: 'A campanha, o conjunto e o anúncio serão verificados e permanecerão pausados.',
        })
        onCreated()
        return
      }
      const languages = form.languages
        .split(/[,\s]+/)
        .map((c) => c.trim().toLowerCase())
        .filter((c) => /^[a-z]{2}$/.test(c))
      const basePayload: Record<string, unknown> = {
        adAccountId: advertiserId,
        goal: form.goal,
        budgetAmount: Number(form.budgetAmount),
        budgetType: form.budgetType,
        budgetOptimization: form.budgetOptimization,
        bidStrategy: form.bidStrategy,
      }
      if (form.bidStrategy === 'cost_cap') basePayload.bidAmount = Number(form.bidAmount)
      if (form.budgetType === 'lifetime') basePayload.endDate = form.endDate
      if (countries.length) basePayload.countries = countries
      if (languages.length) basePayload.languages = languages
      if (Number(form.ageMin) >= 13) basePayload.ageMin = Number(form.ageMin)
      if (Number(form.ageMax) >= 13) basePayload.ageMax = Number(form.ageMax)
      if (form.gender !== 'all') basePayload.gender = form.gender
      if (form.interestIds.length) basePayload.interestIds = form.interestIds
      if (form.placementMode === 'custom' && form.placements.length) basePayload.placements = form.placements
      if (form.body.trim()) basePayload.body = form.body.trim()
      if (/^https?:\/\//.test(form.linkUrl.trim())) basePayload.linkUrl = form.linkUrl.trim()
      if (form.callToAction) basePayload.callToAction = form.callToAction
      if (form.goal === 'conversions' || form.goal === 'lead_generation') {
        basePayload.promotedObject = {
          pixelId: form.pixelId.trim(),
          customEventType: form.customEventType.trim().toUpperCase(),
        }
      }
      // Variações A/B: vídeo principal + extras = 1 campanha por vídeo
      // (sufixo A/B/C… no nome). Sequencial para respeitar rate limits.
      const videos = [form.videoUrl.trim(), ...variantUrls.filter((u) => /^https:\/\/\S+/.test(u))]
      await apiSend('/api/ads/create/preflight', 'POST', {
        ...basePayload,
        name: form.name.trim(),
        videoUrl: videos[0],
      })
      const results: { ok: boolean; label: string; error?: string }[] = []
      for (let i = 0; i < videos.length; i++) {
        const label = videos.length > 1 ? String.fromCharCode(65 + i) : ''
        const name = label ? `${form.name.trim()} — ${label}` : form.name.trim()
        try {
          await apiSend('/api/ads/create', 'POST', {
            ...basePayload,
            name,
            videoUrl: videos[i],
            idempotencyKey: `${idemKey}-${i}`,
          })
          results.push({ ok: true, label: name })
        } catch (e) {
          results.push({ ok: false, label: name, error: e instanceof Error ? e.message : 'erro' })
        }
      }

      const okCount = results.filter((r) => r.ok).length
      const failed = results.filter((r) => !r.ok)
      if (okCount === results.length) {
        toast.success(
          results.length > 1 ? `${okCount} campanhas criadas (teste A/B)` : 'Campanha criada no TikTok Ads',
          { hint: 'Elas entram em revisão do TikTok antes de veicular.' },
        )
        onCreated()
      } else if (okCount > 0) {
        toast.error(`${okCount} de ${results.length} criadas`, { hint: failed[0]?.error })
        onCreated()
      } else {
        throw new Error(failed[0]?.error || 'Falha ao criar')
      }
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
              {/* Templates salvos: pré-preenche tudo menos nome e vídeo */}
              {(templatesData?.items?.length ?? 0) > 0 && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-foreground">Começar de um template</span>
                  <div className="flex flex-wrap gap-1.5">
                    {templatesData!.items.map((t) => (
                      <span
                        key={t.id}
                        className="inline-flex items-center gap-0.5 rounded-full border border-border bg-secondary/40 pl-2.5 pr-1 py-0.5"
                      >
                        <button
                          type="button"
                          className="text-[11px] font-medium text-foreground transition-colors hover:text-primary"
                          onClick={() => applyTemplate(t)}
                          title={`Aplicar "${t.name}"`}
                        >
                          {t.name}
                        </button>
                        <button
                          type="button"
                          className="btn-ghost !p-0.5 text-muted-foreground"
                          onClick={() => setDeleteTemplate({ id: t.id, name: t.name })}
                          aria-label={`Excluir template ${t.name}`}
                          title="Excluir template"
                        >
                          <Trash2 className="size-3" aria-hidden="true" />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )}
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
                    min={50}
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
                    min={tomorrowLocalIsoDate()}
                    className="input-neon w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                    value={form.endDate}
                    onChange={(e) => set('endDate', e.target.value)}
                  />
                </label>
              )}

              {/* Otimização de orçamento: ABO (grupo) × CBO (campanha) */}
              <fieldset className="flex flex-col gap-1.5">
                <legend className="text-xs font-medium text-foreground">Otimização de orçamento</legend>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { value: 'adgroup', label: 'ABO', hint: 'Orçamento no grupo de anúncios' },
                    { value: 'campaign', label: 'CBO', hint: 'TikTok distribui na campanha' },
                  ].map((o) => (
                    <label
                      key={o.value}
                      className={`flex cursor-pointer flex-col gap-0.5 rounded-lg border px-3 py-2 transition-colors ${
                        form.budgetOptimization === o.value ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/40'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="budgetOptimization"
                          className="accent-primary"
                          checked={form.budgetOptimization === o.value}
                          onChange={() => set('budgetOptimization', o.value as 'adgroup' | 'campaign')}
                        />
                        <span className="text-xs font-semibold text-foreground">{o.label}</span>
                      </span>
                      <span className="pl-6 text-[11px] text-muted-foreground">{o.hint}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              {/* Estratégia de lance: máxima entrega × teto de custo */}
              <fieldset className="flex flex-col gap-1.5">
                <legend className="text-xs font-medium text-foreground">Estratégia de lance</legend>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { value: 'lowest_cost', label: 'Menor custo', hint: 'Máxima entrega (sem lance)' },
                    { value: 'cost_cap', label: 'Custo-alvo', hint: 'Teto de custo por resultado' },
                  ].map((o) => (
                    <label
                      key={o.value}
                      className={`flex cursor-pointer flex-col gap-0.5 rounded-lg border px-3 py-2 transition-colors ${
                        form.bidStrategy === o.value ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/40'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="bidStrategy"
                          className="accent-primary"
                          checked={form.bidStrategy === o.value}
                          onChange={() => set('bidStrategy', o.value as 'lowest_cost' | 'cost_cap')}
                        />
                        <span className="text-xs font-semibold text-foreground">{o.label}</span>
                      </span>
                      <span className="pl-6 text-[11px] text-muted-foreground">{o.hint}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              {form.bidStrategy === 'cost_cap' && (
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-foreground">
                    Custo-alvo por {form.goal === 'conversions' ? 'conversão' : 'resultado'} ({currency})
                  </span>
                  <input
                    type="number"
                    min={0.01}
                    step="0.01"
                    className="input-neon w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                    value={form.bidAmount}
                    onChange={(e) => set('bidAmount', e.target.value)}
                    placeholder="Ex.: 8,00"
                  />
                  <span className="text-[11px] text-muted-foreground">
                    O TikTok tenta manter o custo médio abaixo deste valor. Muito baixo pode travar a entrega.
                  </span>
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
              {/* Gênero */}
              <fieldset className="flex flex-col gap-1.5">
                <legend className="text-xs font-medium text-foreground">Gênero</legend>
                <div className="grid grid-cols-3 gap-2">
                  {GENDERS.map((g) => (
                    <label
                      key={g.value}
                      className={`flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                        form.gender === g.value ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:border-primary/40'
                      }`}
                    >
                      <input
                        type="radio"
                        name="gender"
                        className="sr-only"
                        checked={form.gender === g.value}
                        onChange={() => set('gender', g.value)}
                      />
                      {g.label}
                    </label>
                  ))}
                </div>
              </fieldset>

              {/* Posicionamento */}
              <fieldset className="flex flex-col gap-1.5">
                <legend className="text-xs font-medium text-foreground">Posicionamento</legend>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { value: 'automatic', label: 'Automático', hint: 'TikTok escolhe (recomendado)' },
                    { value: 'custom', label: 'Escolher', hint: 'Selecionar manualmente' },
                  ].map((o) => (
                    <label
                      key={o.value}
                      className={`flex cursor-pointer flex-col gap-0.5 rounded-lg border px-3 py-2 transition-colors ${
                        form.placementMode === o.value ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/40'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="placementMode"
                          className="accent-primary"
                          checked={form.placementMode === o.value}
                          onChange={() => set('placementMode', o.value as 'automatic' | 'custom')}
                        />
                        <span className="text-xs font-semibold text-foreground">{o.label}</span>
                      </span>
                      <span className="pl-6 text-[11px] text-muted-foreground">{o.hint}</span>
                    </label>
                  ))}
                </div>
                {form.placementMode === 'custom' && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {PLACEMENTS.map((p) => {
                      const on = form.placements.includes(p.value)
                      return (
                        <button
                          key={p.value}
                          type="button"
                          onClick={() =>
                            set(
                              'placements',
                              on ? form.placements.filter((x) => x !== p.value) : [...form.placements, p.value],
                            )
                          }
                          className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                            on ? 'border-primary bg-primary/15 text-primary' : 'border-border text-muted-foreground hover:border-primary/40'
                          }`}
                        >
                          {p.label}
                        </button>
                      )
                    })}
                  </div>
                )}
              </fieldset>

              {/* Interesses (opcional) */}
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-foreground">Interesses <span className="font-normal text-muted-foreground">(opcional)</span></span>
                {form.interestIds.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {form.interestIds.map((id) => (
                      <span key={id} className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 py-0.5 pl-2.5 pr-1 text-[11px] font-medium text-primary">
                        {interestName(id)}
                        <button
                          type="button"
                          className="btn-ghost !p-0.5"
                          onClick={() => set('interestIds', form.interestIds.filter((x) => x !== id))}
                          aria-label={`Remover ${interestName(id)}`}
                        >
                          <X className="size-3" aria-hidden="true" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <input
                  className="input-neon w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                  value={interestQuery}
                  onChange={(e) => setInterestQuery(e.target.value)}
                  placeholder="Buscar interesse (ex.: beleza, games, fitness)…"
                  aria-label="Buscar categoria de interesse"
                />
                <span className="text-[10px] text-muted-foreground">
                  O TikTok pode devolver nomes em inglês; buscas comuns em português são traduzidas automaticamente.
                </span>
                {interestQuery.trim() && (
                  <div className="flex flex-wrap gap-1.5">
                    {interestMatches.length === 0 ? (
                      <span className="text-[11px] text-muted-foreground">
                        {interestsData ? 'Nenhum interesse encontrado.' : 'Carregando categorias…'}
                      </span>
                    ) : (
                      interestMatches
                        .filter((m) => !form.interestIds.includes(m.id))
                        .map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            className="rounded-full border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                            onClick={() => {
                              if (form.interestIds.length >= 20) {
                                toast.error('Máximo de 20 interesses')
                                return
                              }
                              set('interestIds', [...form.interestIds, m.id])
                              setInterestQuery('')
                            }}
                          >
                            + {m.name}
                          </button>
                        ))
                    )}
                  </div>
                )}
                <span className="text-[11px] text-muted-foreground">Sem interesses = público aberto (o TikTok otimiza sozinho).</span>
              </div>

            </div>
          )}

          {step === 3 && (
            <div className="anim-content-in flex flex-col gap-4">
              {form.goal === 'conversions' || form.goal === 'lead_generation' ? (
                <div className="flex flex-col gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Rastreamento e otimização</h3>
                    <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                      O TikTok usa este evento para otimizar a entrega. Confirme os dados antes de publicar.
                    </p>
                  </div>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-foreground">Pixel ID do TikTok</span>
                    <input
                      className="input-neon w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                      value={form.pixelId}
                      onChange={(e) => set('pixelId', e.target.value.replace(/\D/g, ''))}
                      inputMode="numeric"
                      placeholder="7123456789012345678"
                    />
                    <span className="text-[11px] text-muted-foreground">Use o ID numérico exibido no Events Manager.</span>
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-foreground">Evento de otimização</span>
                    <select
                      className="input-neon w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                      value={form.customEventType}
                      onChange={(e) => set('customEventType', e.target.value)}
                    >
                      <option value="">Selecione o evento…</option>
                      {TIKTOK_PIXEL_EVENTS.map((event) => (
                        <option key={event.value} value={event.value}>{event.label}</option>
                      ))}
                    </select>
                  </label>
                  {form.goal === 'lead_generation' && (
                    <p className="rounded-lg bg-secondary/60 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                      Leads usa a página de captura do seu site. Formulários nativos não estão disponíveis nesta integração.
                    </p>
                  )}
                </div>
              ) : (
                <div className="rounded-xl border border-border bg-secondary/30 p-4">
                  <h3 className="text-sm font-semibold text-foreground">Pixel não é necessário</h3>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    Este objetivo otimiza entrega e engajamento diretamente no TikTok. Você pode avançar sem configurar evento.
                  </p>
                </div>
              )}
            </div>
          )}

          {step === 4 && (
            <div className="anim-content-in flex flex-col gap-4">
              {/* Catálogo (DPA): quando selecionado, TODO o criativo/destino vem
                  do catálogo — vídeo, legenda e URL manuais ficam indisponíveis. */}
              {catalogCampaignSupported && (
              <div className="flex flex-col gap-2 rounded-xl border border-border bg-secondary/20 p-3">
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-foreground">Catálogo de produtos (opcional)</span>
                  <select
                    className="input-neon w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                    value={form.catalogId}
                    onChange={(e) => {
                      const v = e.target.value
                      // Zera a URL manual ao entrar no modo catálogo — o destino
                      // passa a ser 100% definido pelos produtos do catálogo.
                      setForm((f) => ({ ...f, catalogId: v, ...(v ? { linkUrl: '' } : {}) }))
                    }}
                  >
                    <option value="">Nenhum — anúncio com vídeo e URL própria</option>
                    {catalogs.map((c) => {
                      const ready = Boolean(c.tiktokCatalogId && c.bcId && c.linkStatus === 'verified' && (c.audit?.approved ?? 0) > 0)
                      return <option key={c.id} value={c.id} disabled={!ready}>
                        {c.name} · {c.productCount} produto{c.productCount === 1 ? '' : 's'}
                        {!ready ? ' — conclua a sincronização na aba Catálogo' : ''}
                      </option>
                    })}
                  </select>
                </label>
                {form.catalogId ? (
                  <div className="flex flex-col gap-2">
                    <p className="rounded-lg bg-primary/10 px-3 py-2 text-[11px] font-medium leading-relaxed text-primary">
                      A campanha usará todos os produtos aprovados. O destino vem do link de cada produto; não há URL nem template obrigatório neste nível.
                    </p>
                  </div>
                ) : (
                  <span className="text-[11px] text-muted-foreground">
                    Só aparecem habilitados os catálogos já publicados no TikTok (aba Catálogo → CSV manual).
                  </span>
                )}
              </div>
              )}

              {!form.catalogId && (
              <>
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

                {/* Biblioteca: reaproveitar vídeos já enviados ao Blob */}
                {libraryOpen ? (
                  <CreativeLibrary
                    open={libraryOpen}
                    onClose={() => setLibraryOpen(false)}
                    selectedUrl={form.videoUrl}
                    onConfirmOpenChange={setNestedModalOpen}
                    onPick={(item) => {
                      set('videoUrl', item.url)
                      toast.success('Criativo selecionado', { hint: item.name })
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="btn-ghost self-start text-[11px]"
                    onClick={() => setLibraryOpen(true)}
                  >
                    <Clapperboard className="size-3.5" aria-hidden="true" />
                    Escolher da biblioteca
                  </button>
                )}
              </div>

              {/* Variações A/B: vídeos extras → 1 campanha idêntica por vídeo */}
              <div className="flex flex-col gap-2 rounded-xl border border-border bg-secondary/20 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                    <FlaskConical className="size-3.5 text-primary" aria-hidden="true" />
                    Teste A/B de criativos
                    {variantUrls.length > 0 && (
                      <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-primary">
                        {variantUrls.length + 1} campanhas
                      </span>
                    )}
                  </span>
                  {!variantsOpen && variantUrls.length === 0 && (
                    <button type="button" className="btn-ghost !py-1 text-[11px]" onClick={() => setVariantsOpen(true)}>
                      Adicionar variações
                    </button>
                  )}
                </div>
                {(variantsOpen || variantUrls.length > 0) && (
                  <>
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      Cada vídeo extra cria uma campanha idêntica (sufixo A/B/C…) — mesma verba, público e
                      destino. Compare o desempenho e pause as perdedoras.
                    </p>
                    {variantUrls.map((u, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="w-5 shrink-0 text-center text-[11px] font-bold text-primary">
                          {String.fromCharCode(66 + i)}
                        </span>
                        <input
                          className="input-neon w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground"
                          value={u}
                          onChange={(e) =>
                            setVariantUrls((prev) => prev.map((x, xi) => (xi === i ? e.target.value : x)))
                          }
                          placeholder="https://…/video-b.mp4"
                          aria-label={`URL do vídeo da variação ${String.fromCharCode(66 + i)}`}
                        />
                        <button
                          type="button"
                          className="btn-ghost !p-1.5 text-muted-foreground"
                          onClick={() => setVariantUrls((prev) => prev.filter((_, xi) => xi !== i))}
                          aria-label={`Remover variação ${String.fromCharCode(66 + i)}`}
                        >
                          <X className="size-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    ))}
                    {variantUrls.length < 2 && (
                      <button
                        type="button"
                        className="btn-ghost self-start text-[11px]"
                        onClick={() => setVariantUrls((prev) => [...prev, ''])}
                      >
                        + Vídeo {String.fromCharCode(66 + variantUrls.length)}
                      </button>
                    )}
                  </>
                )}
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
              </>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-foreground">
                    Página de destino{form.goal === 'lead_generation' ? ' (obrigatória)' : ''}
                  </span>
                  <input
                    className="input-neon w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                    value={form.catalogId ? '' : form.linkUrl}
                    onChange={(e) => set('linkUrl', e.target.value)}
                    placeholder={form.catalogId ? 'Indisponível — definido pelo catálogo' : 'https://sualoja.com/oferta'}
                    disabled={!!form.catalogId}
                    aria-disabled={!!form.catalogId}
                  />
                  {form.catalogId && (
                    <span className="text-[11px] text-muted-foreground">
                      O destino de cada anúncio é o link do produto no catálogo.
                    </span>
                  )}
                </label>
                {!form.catalogId && (
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
                )}
              </div>

            </div>
          )}

          {step === 5 && (
            <div className="anim-content-in flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">Confira tudo antes de publicar:</p>
                <button
                  type="button"
                  className="btn-ghost !py-1 text-[11px]"
                  onClick={() => {
                    setTemplateName(form.name || '')
                    setTemplateNaming(true)
                  }}
                  disabled={savingTemplate}
                >
                  {savingTemplate ? (
                    <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                  ) : (
                    <BookmarkPlus className="size-3" aria-hidden="true" />
                  )}
                  Salvar como template
                </button>
              </div>
              {templateNaming && (
                <div className="flex flex-col gap-2 rounded-xl border border-primary/30 bg-primary/5 p-3 sm:flex-row sm:items-end">
                  <label className="min-w-0 flex-1 text-[11px] text-muted-foreground">
                    Nome do template
                    <input
                      autoFocus
                      className="input-base mt-1 w-full"
                      value={templateName}
                      onChange={(event) => setTemplateName(event.target.value)}
                      maxLength={60}
                      placeholder="Ex.: Conversões BR 50/dia"
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.nativeEvent.isComposing) void handleSaveTemplate()
                        if (event.key === 'Escape') setTemplateNaming(false)
                      }}
                    />
                  </label>
                  <div className="flex justify-end gap-2">
                    <button type="button" className="btn-ghost text-xs" onClick={() => setTemplateNaming(false)} disabled={savingTemplate}>Cancelar</button>
                    <button type="button" className="btn-primary text-xs" onClick={handleSaveTemplate} disabled={savingTemplate || !templateName.trim()}>
                      {savingTemplate && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />} Salvar template
                    </button>
                  </div>
                </div>
              )}
              {variantUrls.filter((u) => /^https:\/\/\S+/.test(u)).length > 0 && (
                <p className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-[11px] font-medium leading-relaxed text-primary">
                  Teste A/B: serão criadas{' '}
                  {variantUrls.filter((u) => /^https:\/\/\S+/.test(u)).length + 1} campanhas idênticas, uma
                  por vídeo (sufixos A, B{variantUrls.length > 1 ? ', C' : ''}).
                </p>
              )}
              <dl className="flex flex-col divide-y divide-border rounded-xl border border-border bg-background text-xs">
                {[
                  ['Campanha', form.name],
                  ['Objetivo', GOALS.find((g) => g.value === form.goal)?.label ?? form.goal],
                  [
                    'Orçamento',
                    `${currency} ${form.budgetAmount} / ${form.budgetType === 'daily' ? 'dia' : `total até ${form.endDate}`} · ${form.budgetOptimization === 'campaign' ? 'CBO' : 'ABO'}`,
                  ],
                  [
                    'Lance',
                    form.bidStrategy === 'cost_cap' ? `Custo-alvo ${currency} ${form.bidAmount}` : 'Menor custo (máx. entrega)',
                  ],
                  ['Países', form.countries || '—'],
                  ['Idiomas', form.languages || '—'],
                  [
                    'Idade',
                    form.ageMin || form.ageMax ? `${form.ageMin || '13'}–${form.ageMax || '65'}` : 'Todas',
                  ],
                  ['Gênero', GENDERS.find((g) => g.value === form.gender)?.label ?? 'Todos'],
                  [
                    'Posicionamento',
                    form.placementMode === 'custom' && form.placements.length
                      ? form.placements.map((p) => PLACEMENTS.find((x) => x.value === p)?.label ?? p).join(', ')
                      : 'Automático',
                  ],
                  ...(form.interestIds.length
                    ? [['Interesses', form.interestIds.map(interestName).join(', ')] as [string, string]]
                    : []),
                  ...(form.goal === 'conversions' || form.goal === 'lead_generation'
                    ? [
                        ['Pixel', form.pixelId] as [string, string],
                        ['Evento', TIKTOK_PIXEL_EVENTS.find((event) => event.value === form.customEventType)?.label || form.customEventType] as [string, string],
                      ]
                    : []),
                  ...(selectedCatalog
                    ? [
                        ['Catálogo', `${selectedCatalog.name} (${selectedCatalog.productCount} produtos)`] as [string, string],
                        ['Criativo', 'Gerado do catálogo (DPA)'] as [string, string],
                        ['Destino', 'Links dos produtos do catálogo'] as [string, string],
                      ]
                    : [
                        ['Vídeo', form.videoUrl.length > 48 ? form.videoUrl.slice(0, 48) + '…' : form.videoUrl] as [string, string],
                        ['Destino', form.linkUrl || '—'] as [string, string],
                      ]),
                ].map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between gap-4 px-3 py-2">
                    <dt className="shrink-0 text-muted-foreground">{k}</dt>
                    <dd className="truncate font-medium text-foreground">{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="rounded-lg bg-warning/10 px-3 py-2 text-[11px] leading-relaxed text-warning">
                {selectedCatalog
                  ? 'A campanha de catálogo nasce PAUSADA — revise no TikTok Ads Manager e ative quando estiver pronta. O criativo e o destino vêm dos produtos do catálogo.'
                  : 'A campanha é criada pausada. Revise a estrutura e ative somente quando estiver pronta para veicular.'}
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
      <ConfirmDialog
        open={Boolean(deleteTemplate)}
        title="Excluir template?"
        description={<>O template <strong className="text-foreground">{deleteTemplate?.name}</strong> será removido. Campanhas já criadas não serão alteradas.</>}
        confirmLabel="Excluir template"
        busy={deletingTemplate}
        onConfirm={handleDeleteTemplate}
        onClose={() => setDeleteTemplate(null)}
      />
    </div>
  )
}
