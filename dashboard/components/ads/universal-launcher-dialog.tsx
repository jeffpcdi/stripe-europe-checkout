'use client'

import { SavedVideos } from './saved-videos'
import { creativeFileError } from '@/lib/ads-upload'

import { MarketSelector, defaultMarket } from './market-selector'

import { Modal } from '@/components/ui/modal'
import { MoneyField } from '@/components/ui/money-field'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  X,
  Rocket,
  UploadCloud,
  Loader2,
  Trash2,
  Sparkles,
  Layers,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  AlertCircle,
  Link as LinkIcon,
  Play,
  RotateCcw,
} from 'lucide-react'
import { apiSend, adsUpload, useAdsBulkJob, useAdsTikTokPixels } from '@/lib/api'
import { toast } from '@/lib/toast'
import { TIKTOK_MIN_BUDGET, tiktokMinimumBudgetMessage } from './tiktok-contracts'
import { fmtSpend } from '@/lib/format'
import type { AdsBulkStartResponse } from '@/lib/types'

interface VideoItem {
  key: string
  name: string
  videoUrl: string
  uploading: boolean
  fileName: string
  sizeMb?: string
  file?: File
  error?: string
}

export function UniversalLauncherDialog({
  open,
  onClose,
  advertiserId,
  currency,
  onFinished,
  onSuccess,
  onSmartPlus,
  onSpark,
}: {
  open: boolean
  onClose: () => void
  advertiserId: string
  currency: string
  onFinished?: () => void
  onSuccess?: () => void
  onSmartPlus?: () => void
  onSpark?: () => void
}) {
  const handleDone = () => {
    onSuccess?.()
    onFinished?.()
  }
  const uploadController = useRef<AbortController | null>(null)
  const uploadGeneration = useRef(0)
  const uploadLock = useRef(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const idempotencyRef = useRef<{ signature: string; key: string } | null>(null)

  // 2 Campos Essenciais
  const [linkUrl, setLinkUrl] = useState('')
  const [market, setMarket] = useState(() => defaultMarket())
  const [budget, setBudget] = useState(String(Math.max(TIKTOK_MIN_BUDGET, 60)))
  const [isDragging, setIsDragging] = useState(false)

  // Opções Avançadas (recolhidas por padrão)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [campaignPrefix, setCampaignPrefix] = useState('')
  const [bodyText, setBodyText] = useState('')
  const [cta, setCta] = useState('SHOP_NOW')

  // Lista de vídeos
  const [items, setItems] = useState<VideoItem[]>([])
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [retrying, setRetrying] = useState(false)
  const retryingRef = useRef(false)

  // Polling para lote
  const { data: job, mutate: mutateJob } = useAdsBulkJob(jobId)
  const {
    data: pixelState,
    error: pixelError,
    isLoading: pixelLoading,
  } = useAdsTikTokPixels(open && Boolean(advertiserId), advertiserId)

  const pixelReady = Boolean(pixelState?.ready && pixelState.binding)
  const jobDone = job?.status === 'done'
  const notifiedRef = useRef(false)


  useEffect(() => {
    if (open) {
      setShowAdvanced(false)
      setItems([])
      setJobId(null)
      idempotencyRef.current = null
      notifiedRef.current = false
    }
    return () => {
      uploadGeneration.current += 1
      uploadController.current?.abort()
      uploadLock.current = false
    }
  }, [open, advertiserId])

  // Notificação de conclusão de lote
  useEffect(() => {
    if (jobDone && !notifiedRef.current) {
      notifiedRef.current = true
      if ((job?.failed ?? 0) > 0) {
        toast.error(`${job!.failed} de ${job!.total} falharam`, {
          hint: 'Revise os erros abaixo e tente reprocessar as falhas.',
        })
      } else {
        toast.success(`${job!.total} campanha(s) criada(s) e pausada(s)`, {
          hint: 'Todas criadas pausadas para sua revisão antes de ativar.',
        })
      }
      handleDone()
    }
  }, [jobDone, job])

  const uploadingCount = items.filter((i) => i.uploading).length
  const isBulk = items.length > 1

  // Validação simplificada
  const validationError: string | null = useMemo(() => {
    if (pixelLoading) return 'Conferindo vínculo do Pixel...'
    if (pixelError) return 'Falha temporária ao verificar Pixel da conta'
    if (!pixelReady) return 'Escolha o Pixel da conta na aba TikTok Ads antes de criar campanhas'
    if (items.length === 0) return 'Selecione ou arraste pelo menos 1 arquivo de vídeo'
    if (uploadingCount > 0) return `Enviando vídeo(s)... (${uploadingCount} restante(s))`
    if (items.some((i) => !i.videoUrl)) return 'Upload falhou em um dos vídeos. Remova ou envie novamente.'
    if (!/^https:\/\/\S+/.test(linkUrl.trim())) return 'Informe o link HTTPS da sua página de vendas'
    const b = Number(budget)
    if (!Number.isFinite(b) || b < TIKTOK_MIN_BUDGET) {
      return tiktokMinimumBudgetMessage(currency, isBulk ? ' para cada campanha' : '')
    }
    return null
  }, [pixelLoading, pixelError, pixelReady, items, uploadingCount, linkUrl, budget, currency, isBulk])

  // Reserva o lote inteiro antes do primeiro envio e mantém o arquivo em falha.
  async function uploadItems(batch: VideoItem[]) {
    if (uploadLock.current || submitting) return
    uploadLock.current = true
    const generation = uploadGeneration.current
    const controller = new AbortController()
    uploadController.current = controller
    try {
      for (const item of batch) {
        if (generation !== uploadGeneration.current) return
        setItems((current) => current.map((entry) => entry.key === item.key ? { ...entry, uploading: true, error: undefined } : entry))
        try {
          const { url } = await adsUpload(item.file!, 'video', { signal: controller.signal })
          if (generation !== uploadGeneration.current) return
          setItems((current) => current.map((entry) => entry.key === item.key ? { ...entry, videoUrl: url, uploading: false } : entry))
        } catch (error) {
          if (generation !== uploadGeneration.current) return
          setItems((current) => current.map((entry) => entry.key === item.key ? { ...entry, uploading: false, error: error instanceof Error ? error.message : 'Falha no envio' } : entry))
        }
      }
    } finally {
      if (generation === uploadGeneration.current) uploadLock.current = false
    }
  }

  async function handleFiles(files: FileList | File[]) {
    if (uploadLock.current || submitting) return
    if (!pixelReady) return toast.error('Escolha o Pixel da conta antes de enviar vídeos')
    const incoming = Array.from(files)
    if (incoming.length + items.length > 20) return toast.error('Selecione no máximo 20 vídeos por lote')
    const invalid = incoming.find((file) => creativeFileError(file, 'video'))
    if (invalid) return toast.error(invalid.name, { hint: creativeFileError(invalid, 'video')! })
    const batch: VideoItem[] = incoming.filter((file) => !items.some((item) => item.file && item.file.name === file.name && item.file.size === file.size && item.file.lastModified === file.lastModified)).map((file) => ({
      key: crypto.randomUUID(), name: file.name.replace(/\.[^.]+$/, '').slice(0, 80),
      file, fileName: file.name, sizeMb: (file.size / (1024 * 1024)).toFixed(1), videoUrl: '', uploading: true,
    }))
    setItems((current) => [...current, ...batch])
    await uploadItems(batch)
  }

  function removeItem(key: string) {
    setItems((prev) => prev.filter((it) => it.key !== key))
  }

  // Lançamento
  async function handleLaunch() {
    if (validationError || submittingRef.current) return
    submittingRef.current = true
    setSubmitting(true)

    try {
      const budgetNum = Number(budget)
      const cleanLink = linkUrl.trim()
      const cleanBody = bodyText.trim() || undefined

      // Caso 1: Lote de vídeos (2 a 20) -> fila durável /api/ads/bulk
      if (isBulk) {
        const request = {
          adAccountId: advertiserId,
          common: {
            goal: 'conversions',
            budgetAmount: budgetNum,
            budgetType: 'daily',
            linkUrl: cleanLink,
            countries: market.countries,
            languages: market.languages,
            body: cleanBody,
            callToAction: cta,
          },
          items: items.map((it) => ({
            name: campaignPrefix ? `${campaignPrefix.trim()} - ${it.name}` : it.name,
            videoUrl: it.videoUrl,
          })),
        }

        const signature = JSON.stringify(request)
        if (!idempotencyRef.current || idempotencyRef.current.signature !== signature) {
          idempotencyRef.current = {
            signature,
            key: `bulk:${advertiserId}:${crypto.randomUUID()}`,
          }
        }

        const res = await apiSend<AdsBulkStartResponse>('/api/ads/bulk', 'POST', {
          ...request,
          idempotencyKey: idempotencyRef.current.key,
        })

        setJobId(res.jobId)
        toast.info(`Lote iniciado: ${res.total} campanhas enfileiradas`, {
          hint: 'Cada anúncio é criado pausado respeitando o limite do TikTok.',
        })
        return
      }

      // Caso 2: 1 Vídeo - Smart+ IA
      const singleItem = items[0]
      const campaignName = campaignPrefix
        ? `${campaignPrefix.trim()} - ${singleItem.name}`
        : singleItem.name

      // Caso 3: 1 Vídeo - Campanha Rápida Otimizada (CBO / Conversão)
      const payload = {
        adAccountId: advertiserId,
        goal: 'conversions',
        name: campaignName,
        budgetAmount: budgetNum,
        budgetType: 'daily',
        budgetOptimization: 'campaign',
        bidStrategy: 'lowest_cost',
        countries: market.countries,
            languages: market.languages,
        videoUrl: singleItem.videoUrl,
        body: cleanBody,
        linkUrl: cleanLink,
        callToAction: cta,
      }

      const signature = JSON.stringify(payload)
      if (idempotencyRef.current?.signature !== signature) idempotencyRef.current = { signature, key: `quick:${advertiserId}:${crypto.randomUUID()}` }
      const request = { ...payload, idempotencyKey: idempotencyRef.current.key }
      await apiSend('/api/ads/create/preflight', 'POST', request)
      const result = await apiSend<{ dryRun?: boolean }>('/api/ads/create', 'POST', request)
      if (result.dryRun) { toast.info('Simulação concluída. Nenhuma campanha foi criada.'); return }

      toast.success('Campanha criada e pausada', {
        hint: 'Revise a campanha antes de ativar.',
      })
      handleDone()
      onClose()
    } catch (e) {
      toast.error('Não foi possível lançar a campanha', {
        hint: e instanceof Error ? e.message : undefined,
      })
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  async function handleRetryFailed() {
    if (!jobId || retryingRef.current) return
    retryingRef.current = true
    setRetrying(true)
    notifiedRef.current = false
    try {
      await apiSend(`/api/ads/bulk/${encodeURIComponent(jobId)}/retry`, 'POST', {})
      mutateJob()
      toast.info('Reprocessando itens com falha...')
    } catch (e) {
      toast.error('Falha ao reprocessar', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      retryingRef.current = false
      setRetrying(false)
    }
  }

  if (!open) return null

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      busy={submitting}
      title="Criar campanha"
      description="Monte a campanha com o essencial e revise o que será publicado antes de enviar ao TikTok."
      maxWidth="max-w-5xl"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 text-[11px] text-muted-foreground">
            {jobId ? (
              <span className={jobDone ? 'text-success' : 'text-primary'}>
                {jobDone
                  ? `${job?.done ?? 0} concluída(s)${(job?.failed ?? 0) ? ` · ${job?.failed} com falha` : ''}`
                  : 'A criação continua em segundo plano. Você pode acompanhar o progresso acima.'}
              </span>
            ) : validationError ? (
              <span className="flex items-center gap-1 text-warning">
                <AlertCircle className="size-3 shrink-0" />
                {validationError}
              </span>
            ) : (
              <span className="flex items-center gap-1 text-success">
                <CheckCircle2 className="size-3 shrink-0" />
                Revisão pronta · tudo será criado pausado para conferência.
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button type="button" className="btn-ghost text-xs" onClick={onClose} disabled={submitting}>
              {jobId ? 'Fechar' : 'Cancelar'}
            </button>
            {!jobId && (
              <button
                type="button"
                className="btn-primary px-4 py-2 text-xs font-semibold"
                disabled={Boolean(validationError) || submitting}
                onClick={handleLaunch}
              >
                {submitting ? (
                  <><Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> Criando...</>
                ) : (
                  <><Rocket className="size-3.5" aria-hidden="true" /> {isBulk ? `Criar ${items.length} campanhas` : 'Criar campanha pausada'}</>
                )}
              </button>
            )}
          </div>
        </div>
      }
    >
      {jobId && job ? (
        <div className="space-y-4">
          <div className="rounded-2xl border border-border/60 bg-secondary/15 p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Layers className="size-4 text-primary" />
                  Criação em andamento
                </span>
                <p className="mt-1 text-xs text-muted-foreground">Cada campanha passa pela fila durável e nasce pausada para revisão.</p>
              </div>
              <span className="rounded-full border border-border/60 bg-background/60 px-2.5 py-1 font-mono text-[11px] tabular-nums text-muted-foreground">
                {(job.done ?? 0) + (job.failed ?? 0)} / {job.total}
              </span>
            </div>
            <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-secondary/60">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${job.total > 0 ? (((job.done ?? 0) + (job.failed ?? 0)) / job.total) * 100 : 0}%` }}
              />
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            {(job.items ?? []).map((it, idx) => (
              <div key={idx} className="flex items-center justify-between gap-3 rounded-xl border border-border/50 bg-background/50 px-3 py-2.5 text-xs">
                <span className="min-w-0 truncate text-muted-foreground">{it.ref || `Campanha #${it.idx + 1}`}</span>
                {it.status === 'done' ? (
                  <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-success"><CheckCircle2 className="size-3.5" /> Criada</span>
                ) : it.status === 'failed' ? (
                  <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-error" title={it.error}><AlertCircle className="size-3.5" /> Falhou</span>
                ) : (
                  <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-primary"><Loader2 className="size-3.5 animate-spin" /> Criando...</span>
                )}
              </div>
            ))}
          </div>

          {jobDone && (job.failed ?? 0) > 0 && (
            <button type="button" className="btn-secondary w-full justify-center gap-2 text-xs" onClick={handleRetryFailed} disabled={retrying}>
              <RotateCcw className={`size-3.5 ${retrying ? 'animate-spin' : ''}`} />
              Reprocessar falhas ({job.failed})
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {(onSmartPlus || onSpark) && (
            <div className="launch-section-card">
              <span className="launch-section-kicker">Formato da campanha</span>
              <div className="mt-3 launch-kind-grid">
                <div className="launch-kind-card" data-active="true">
                  <Rocket className="size-4 shrink-0" />
                  <span><strong>Direta</strong><small>Conversão com CBO. Mais controle e uma campanha por vídeo.</small></span>
                </div>
                {onSmartPlus && (
                  <button type="button" className="launch-kind-card" data-active="false" onClick={onSmartPlus}>
                    <Sparkles className="size-4 shrink-0" />
                    <span><strong>Smart+</strong><small>Automação do TikTok para público, lance e entrega.</small></span>
                  </button>
                )}
                {onSpark && (
                  <button type="button" className="launch-kind-card" data-active="false" onClick={onSpark}>
                    <Play className="size-4 shrink-0" />
                    <span><strong>Spark Ads</strong><small>Impulsione uma publicação orgânica autorizada.</small></span>
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="launch-composer-grid">
            <fieldset disabled={submitting} className="launch-composer-main border-0 p-0">
              <section className="launch-section-card">
                <span className="launch-section-kicker">1 · Criativo</span>
                <div className="launch-section-heading mt-1">
                  <div>
                    <h3 className="launch-section-title">Vídeos da campanha</h3>
                    <p className="launch-section-copy">Envie até 20 vídeos. Com mais de um vídeo, o ROINADOS cria uma campanha separada para cada criativo.</p>
                  </div>
                  {items.length > 0 && <span className="launch-review-badge">{items.filter(item => item.videoUrl).length}/{items.length} prontos</span>}
                </div>

                <div
                  className={`group relative mt-3 flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed p-5 text-center transition-all ${
                    isDragging ? 'border-primary bg-primary/10' : 'border-border/70 bg-secondary/10 hover:border-primary/40 hover:bg-primary/5'
                  }`}
                  role="button"
                  tabIndex={0}
                  aria-label="Adicionar vídeos"
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click() } }}
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); e.stopPropagation(); setIsDragging(true) }}
                  onDragEnter={e => { e.preventDefault(); e.stopPropagation(); setIsDragging(true) }}
                  onDragLeave={e => { e.preventDefault(); e.stopPropagation(); setIsDragging(false) }}
                  onDrop={e => {
                    e.preventDefault(); e.stopPropagation(); setIsDragging(false)
                    if (e.dataTransfer.files) void handleFiles(e.dataTransfer.files)
                  }}
                >
                  <input
                    ref={fileInputRef}
                    aria-label="Selecionar vídeos para as campanhas"
                    type="file"
                    accept=".mp4,.mov,video/mp4,video/quicktime"
                    multiple
                    className="sr-only"
                    onChange={e => { if (e.target.files) void handleFiles(e.target.files); e.target.value = '' }}
                  />
                  <div className="flex size-11 items-center justify-center rounded-xl border border-border/60 bg-background/70 text-muted-foreground transition-colors group-hover:text-primary">
                    <UploadCloud className="size-5" aria-hidden="true" />
                  </div>
                  <p className="mt-2 text-xs font-semibold text-foreground">Arraste vídeos ou clique para selecionar</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">MP4 ou MOV · até 500 MB por arquivo</p>
                </div>

                <div className="mt-3">
                  <SavedVideos
                    selectedUrls={items.map(item => item.videoUrl)}
                    disabled={submitting || uploadingCount > 0 || items.length >= 20}
                    onPick={item => setItems(current => [...current, { key: crypto.randomUUID(), name: item.name.replace(/\.[^.]+$/, '').slice(0, 80), fileName: item.name, videoUrl: item.url, uploading: false }])}
                  />
                </div>

                {items.length > 0 && (
                  <div className="mt-3 max-h-52 space-y-2 overflow-y-auto pr-1">
                    {items.map((it, idx) => (
                      <div key={it.key} className="rounded-xl border border-border/50 bg-secondary/15 p-3 text-xs">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            {it.uploading ? <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" /> : it.error ? <AlertCircle className="size-3.5 shrink-0 text-error" /> : <CheckCircle2 className="size-3.5 shrink-0 text-success" />}
                            <span className="truncate font-medium text-foreground">{it.fileName || it.name}</span>
                            {it.sizeMb && <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{it.sizeMb} MB</span>}
                          </div>
                          <button type="button" className="btn-ghost p-1 text-muted-foreground hover:text-error" onClick={() => removeItem(it.key)} aria-label="Remover vídeo" disabled={uploadingCount > 0 || submitting}>
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                        {it.error && (
                          <div className="mt-2 flex items-center justify-between gap-2 text-error">
                            <span>{it.error}</span>
                            <button type="button" className="btn-secondary text-xs" disabled={uploadingCount > 0} onClick={() => void uploadItems([it])}>Tentar novamente</button>
                          </div>
                        )}
                        {items.length === 1 && (
                          <label className="mt-2 block border-t border-border/30 pt-2">
                            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Nome no TikTok</span>
                            <input
                              type="text"
                              value={it.name}
                              onChange={e => {
                                const value = e.target.value
                                setItems(prev => prev.map((item, i) => i === idx ? { ...item, name: value } : item))
                              }}
                              placeholder="Nome da campanha"
                              className="input-neon w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground"
                            />
                          </label>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="launch-section-card">
                <span className="launch-section-kicker">2 · Destino e público</span>
                <h3 className="launch-section-title">Para onde e para quem</h3>
                <p className="launch-section-copy">O pixel selecionado na conta será usado para otimizar a conversão.</p>
                <div className="mt-4 space-y-4">
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-semibold text-foreground">Página de vendas</span>
                    <div className="relative">
                      <LinkIcon className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                      <input
                        id="launcher-link"
                        type="url"
                        value={linkUrl}
                        onChange={e => setLinkUrl(e.target.value)}
                        placeholder="https://meusite.com/produto"
                        className="input-neon w-full rounded-xl border border-border bg-background py-2 pl-9 pr-14 text-xs text-foreground placeholder:text-muted-foreground"
                      />
                      {!linkUrl ? (
                        <button
                          type="button"
                          onClick={async () => { try { const value = await navigator.clipboard.readText(); if (value) setLinkUrl(value.trim()) } catch {} }}
                          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md bg-secondary/80 px-2 py-0.5 text-[10px] font-medium text-muted-foreground hover:text-foreground"
                        >Colar</button>
                      ) : (
                        <button type="button" onClick={() => setLinkUrl('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground" aria-label="Limpar link"><X className="size-3.5" /></button>
                      )}
                    </div>
                  </label>
                  <MarketSelector value={market} onChange={setMarket} disabled={submitting} />
                </div>
              </section>

              <section className="launch-section-card">
                <span className="launch-section-kicker">3 · Orçamento</span>
                <h3 className="launch-section-title">Quanto cada campanha pode gastar</h3>
                <div className="mt-4">
                  <MoneyField label="Orçamento diário por campanha" currency={currency} value={budget} onChange={setBudget} min={TIKTOK_MIN_BUDGET} hint={`Mínimo: ${fmtSpend(TIKTOK_MIN_BUDGET, currency)} por campanha/dia.`} />
                </div>
              </section>

              <section className="launch-section-card">
                <button type="button" aria-expanded={showAdvanced} onClick={() => setShowAdvanced(!showAdvanced)} className="flex w-full items-center justify-between gap-3 text-left">
                  <span>
                    <span className="launch-section-kicker">Opcional</span>
                    <span className="launch-section-title block">Nome, texto e botão</span>
                    <span className="launch-section-copy block">Personalize somente se precisar fugir dos padrões recomendados.</span>
                  </span>
                  {showAdvanced ? <ChevronUp className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
                </button>
                {showAdvanced && (
                  <div className="mt-4 space-y-3 border-t border-border/40 pt-4">
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-medium text-muted-foreground">Prefixo do nome</span>
                      <input type="text" value={campaignPrefix} onChange={e => setCampaignPrefix(e.target.value)} placeholder="Ex.: [Escala BR]" className="input-neon w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground" />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-medium text-muted-foreground">Texto do anúncio</span>
                      <input type="text" value={bodyText} onChange={e => setBodyText(e.target.value)} placeholder="Ex.: Frete grátis apenas hoje." className="input-neon w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground" />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-medium text-muted-foreground">Botão</span>
                      <select value={cta} onChange={e => setCta(e.target.value)} className="input-neon w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground">
                        <option value="SHOP_NOW">Comprar agora</option>
                        <option value="LEARN_MORE">Saiba mais</option>
                        <option value="ORDER_NOW">Pedir agora</option>
                      </select>
                    </label>
                  </div>
                )}
              </section>
            </fieldset>

            <aside className="launch-review" aria-label="Revisão da campanha">
              <div className="launch-review-head">
                <div>
                  <p className="launch-review-title">Revisão antes de publicar</p>
                  <p className="launch-review-copy">Confirme a estrutura que será enviada ao TikTok.</p>
                </div>
                <span className="launch-review-badge">Pausada</span>
              </div>
              <div className="launch-review-list">
                <div className="launch-review-row"><span>Formato</span><strong>Direta · CBO</strong></div>
                <div className="launch-review-row"><span>Campanhas</span><strong>{items.length || 0}</strong></div>
                <div className="launch-review-row"><span>Criativos prontos</span><strong>{items.filter(item => item.videoUrl && !item.error).length}/{items.length || 0}</strong></div>
                <div className="launch-review-row"><span>Mercado</span><strong>{market.countries.join(', ') || '—'}</strong></div>
                <div className="launch-review-row"><span>Idioma</span><strong>{market.languages.join(', ') || 'Automático'}</strong></div>
                <div className="launch-review-row"><span>Destino</span><strong>{linkUrl ? linkUrl.replace(/^https?:\/\//, '').split('/')[0] : '—'}</strong></div>
                <div className="launch-review-row"><span>Estratégia</span><strong>Menor custo</strong></div>
              </div>
              <div className="launch-review-total">
                <span className="text-[11px] text-muted-foreground">Orçamento diário total</span>
                <strong>{Number(budget) > 0 && items.length > 0 ? fmtSpend(Number(budget) * items.length, currency) : '—'}</strong>
                <p className="mt-1 text-[10px] text-muted-foreground">{items.length || 0} × {Number(budget) > 0 ? fmtSpend(Number(budget), currency) : '—'} por campanha</p>
              </div>
              {validationError ? (
                <div className="launch-review-warning"><AlertCircle className="mt-0.5 size-3.5 shrink-0" /><span>{validationError}</span></div>
              ) : (
                <div className="launch-review-ready"><CheckCircle2 className="mt-0.5 size-3.5 shrink-0" /><span>Tudo pronto. O ROINADOS fará o preflight e criará a estrutura pausada.</span></div>
              )}
            </aside>
          </div>
        </div>
      )}
    </Modal>
  )
}
