'use client'

import { SavedVideos } from './saved-videos'
import { AdDestinationField } from './ad-destination-field'
import { creativeFileError } from '@/lib/ads-upload'

import { MarketSelector, defaultMarket } from './market-selector'

import { Modal } from '@/components/ui/modal'
import { MoneyField } from '@/components/ui/money-field'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  UploadCloud,
  Loader2,
  Trash2,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  AlertCircle,
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
  onConfigurePixel,
}: {
  open: boolean
  onClose: () => void
  advertiserId: string
  currency: string
  onFinished?: () => void
  onSuccess?: () => void
  onSmartPlus?: () => void
  onSpark?: () => void
  onConfigurePixel?: () => void
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
  const [jobDryRun, setJobDryRun] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [launchError, setLaunchError] = useState<string | null>(null)
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
      setJobDryRun(false)
      setLaunchError(null)
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
      if (jobDryRun) {
        toast.info(`Simulação concluída: ${job!.total} campanha(s) processada(s)`, {
          hint: 'Nada foi criado no TikTok.',
        })
      } else if ((job?.failed ?? 0) > 0) {
        toast.error(`${job!.failed} de ${job!.total} falharam`, {
          hint: 'Revise os erros abaixo e tente reprocessar as falhas.',
        })
      } else {
        toast.success(`${job!.total} campanha(s) criada(s) e pausada(s)`, {
          hint: 'Todas criadas pausadas para sua revisão antes de ativar.',
        })
      }
      if (!jobDryRun) handleDone()
    }
  }, [jobDone, job, jobDryRun])

  const uploadingCount = items.filter((i) => i.uploading).length
  const localUploadBusy = uploadingCount > 0
  const requestClose = useCallback(() => { if (!submitting && !localUploadBusy) onClose() }, [localUploadBusy, onClose, submitting])
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
      key: crypto.randomUUID(), name: file.name.replace(/\.[^.]+$/, '').slice(0, 120),
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
    setLaunchError(null)

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
            callToAction: cta === 'AUTO' ? undefined : cta,
            dynamicCallToAction: cta === 'AUTO',
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

        setJobDryRun(Boolean(res.dryRun))
        setJobId(res.jobId)
        toast.info(res.dryRun ? `Simulação iniciada: ${res.total} campanhas` : `Lote iniciado: ${res.total} campanhas enfileiradas`, {
          hint: res.dryRun ? 'Nada será criado no TikTok.' : 'Cada anúncio é criado pausado respeitando o limite do TikTok.',
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
        callToAction: cta === 'AUTO' ? undefined : cta,
        dynamicCallToAction: cta === 'AUTO',
      }

      const signature = JSON.stringify(payload)
      if (idempotencyRef.current?.signature !== signature) idempotencyRef.current = { signature, key: `quick:${advertiserId}:${crypto.randomUUID()}` }
      const request = { ...payload, idempotencyKey: idempotencyRef.current.key }
      await apiSend('/api/ads/create/preflight', 'POST', request)
      const result = await apiSend<{ dryRun?: boolean }>('/api/ads/create', 'POST', request)
      if (result.dryRun) { toast.info('Simulação concluída. Nenhuma campanha foi criada.'); onClose(); return }

      toast.success('Campanha criada e pausada', {
        hint: 'Revise a campanha antes de ativar.',
      })
      handleDone()
      onClose()
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Falha inesperada ao criar a campanha'
      setLaunchError(message)
      toast.error('Não foi possível lançar a campanha', { hint: message })
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

  const completedCount = (job?.done ?? 0) + (job?.failed ?? 0)
  const queuePaused = Boolean(job?.queue?.paused)
  const retryTime = (value?: string | null) => {
    if (!value) return null
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  }
  const pixelName = pixelState?.binding?.pixelName || pixelState?.binding?.pixelId || ''
  const budgetTotal = Number(budget) > 0 && items.length > 0 ? Number(budget) * items.length : 0
  const destinationInvalid = Boolean(linkUrl) && !/^https:\/\/\S+/.test(linkUrl.trim())
  const budgetInvalid = Boolean(budget) && (!(Number(budget) >= TIKTOK_MIN_BUDGET) || !Number.isFinite(Number(budget)))

  return (
    <Modal
      isOpen={open}
      onClose={requestClose}
      busy={submitting || localUploadBusy}
      title="Criar campanha"
      description="Escolha o formato, configure o essencial e revise o impacto antes de enviar ao TikTok."
      maxWidth="max-w-5xl"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 text-xs text-muted-foreground">
            {jobId ? (
              <span className={jobDone ? 'text-success' : queuePaused ? 'text-warning' : 'text-muted-foreground'}>
                {jobDone
                  ? `${job?.done ?? 0} criada(s)${(job?.failed ?? 0) ? ` · ${job?.failed} falharam` : ''}`
                  : queuePaused
                    ? `Fila temporariamente pausada${retryTime(job?.queue?.pausedUntil) ? ` · retoma às ${retryTime(job?.queue?.pausedUntil)}` : ''}`
                    : 'Fechar esta janela não cancela a criação. A fila continua no servidor.'}
              </span>
            ) : validationError ? (
              <span className="flex items-center gap-1.5 text-warning"><AlertCircle className="size-3.5 shrink-0" />{validationError}</span>
            ) : (
              <span className="flex items-center gap-1.5 text-success"><CheckCircle2 className="size-3.5 shrink-0" />Revisão pronta · tudo será criado pausado.</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button type="button" className="btn-ghost text-xs" onClick={requestClose} disabled={submitting || localUploadBusy}>{jobId ? 'Fechar' : 'Cancelar'}</button>
            {!jobId && (
              <button type="button" className="btn-primary px-4 py-2 text-xs font-semibold" disabled={Boolean(validationError) || submitting} onClick={handleLaunch}>
                {submitting ? <><Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> Criando...</> : <>{isBulk ? `Criar ${items.length} campanhas pausadas` : 'Criar campanha pausada'}</>}
              </button>
            )}
          </div>
        </div>
      }
    >
      <div className="tiktok-create-flow">
        {jobId && job ? (
          <div className="space-y-5">
            <section className="border-b border-border/60 pb-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Criando campanhas</h3>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{completedCount} de {job.total} concluídas. {jobDryRun ? 'Modo simulação: nada será criado no TikTok.' : 'Todas nascem pausadas para sua revisão.'}</p>
                </div>
                <span className="text-sm font-medium tabular-nums text-foreground">{completedCount}/{job.total}</span>
              </div>
              <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-secondary/70">
                <div className="h-full bg-primary transition-all duration-300" style={{ width: `${job.total > 0 ? (completedCount / job.total) * 100 : 0}%` }} />
              </div>
            </section>

            {queuePaused && (
              <div className="flex gap-2 border-l-2 border-warning pl-3 text-xs leading-relaxed text-warning">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <div><strong className="block font-semibold">Fila temporariamente pausada pelo TikTok</strong><span>{job.queue?.reason ? `${job.queue.reason} ` : ''}{retryTime(job.queue?.pausedUntil) ? `Retomada automática às ${retryTime(job.queue?.pausedUntil)}.` : 'A fila retoma automaticamente quando o limite temporário terminar.'}</span></div>
              </div>
            )}

            <div className="divide-y divide-border/60 border-y border-border/60">
              {(job.items ?? []).map((it) => {
                const when = retryTime(it.retryAt)
                const state = it.status === 'done' ? (jobDryRun ? 'Simulada' : 'Criada') : it.status === 'failed' ? 'Falhou' : it.status === 'running' ? (jobDryRun ? 'Simulando' : 'Criando') : 'Na fila'
                const tone = it.status === 'done' ? 'text-success' : it.status === 'failed' ? 'text-error' : it.status === 'running' ? 'text-primary' : 'text-muted-foreground'
                return <div key={it.idx} className="flex min-h-14 items-start justify-between gap-4 py-3 text-xs">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">{it.ref || `Campanha #${it.idx + 1}`}</p>
                    {it.error && <p className={`mt-1 leading-relaxed ${it.status === 'failed' ? 'text-error' : 'text-warning'}`}>{it.error}</p>}
                    {when && it.status === 'queued' && <p className="mt-1 text-muted-foreground">Nova tentativa prevista às {when}{it.attempts ? ` · ${it.attempts} tentativa(s)` : ''}</p>}
                  </div>
                  <span className={`shrink-0 font-medium ${tone}`}>{state}</span>
                </div>
              })}
            </div>

            <p className="text-xs leading-relaxed text-muted-foreground">Fechar esta janela não cancela a criação. A fila é durável e continua no servidor.</p>

            {jobDone && (job.failed ?? 0) > 0 && (
              <button type="button" className="btn-secondary min-h-10 w-full justify-center gap-2 text-xs" onClick={handleRetryFailed} disabled={retrying}>
                <RotateCcw className={`size-3.5 ${retrying ? 'animate-spin' : ''}`} /> Reprocessar {job.failed} falha(s)
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-5">
            {(onSmartPlus || onSpark) && (
              <section className="border-b border-border/60 pb-4">
                <h3 className="text-sm font-semibold text-foreground">Formato da campanha</h3>
                <p className="mt-1 text-xs text-muted-foreground">Escolha pelo nível de controle que você precisa. Cada formato mantém as regras próprias do TikTok.</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  <div className="launch-format-option" data-active="true"><strong>Conversão (CBO)</strong><span>Mais controle · orçamento diário por campanha.</span></div>
                  {onSmartPlus && <button type="button" className="launch-format-option" onClick={onSmartPlus} disabled={submitting || localUploadBusy}><strong>Smart+</strong><span>O TikTok automatiza público, lance e distribuição.</span></button>}
                  {onSpark && <button type="button" className="launch-format-option" onClick={onSpark} disabled={submitting || localUploadBusy}><strong>Spark Ads</strong><span>Impulsione uma publicação existente e autorizada.</span></button>}
                </div>
              </section>
            )}

            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-4 text-xs">
              <div><span className="font-medium text-foreground">Pixel da conta</span><span className="ml-2 text-muted-foreground">{pixelLoading ? 'Conferindo…' : pixelReady ? `● Pronto · ${pixelName || 'vinculado'} · Compra` : 'Necessário para Conversão'}</span></div>
              {!pixelReady && !pixelLoading && onConfigurePixel && <button type="button" className="min-h-9 font-medium text-primary hover:underline" onClick={onConfigurePixel} disabled={submitting || localUploadBusy}>Configurar Pixel</button>}
            </div>

            <div className="launch-composer-grid">
              <fieldset disabled={submitting || !pixelReady} className="launch-composer-main border-0 p-0">
                <section className="launch-section-card">
                  <div className="launch-section-heading">
                    <div><h3 className="launch-section-title">Criativos</h3><p className="launch-section-copy">Envie até 20 vídeos ou escolha arquivos já salvos. Cada vídeo cria uma campanha própria.</p></div>
                    {items.length > 0 && <span className="text-xs text-muted-foreground">{items.filter(item => item.videoUrl && !item.error).length}/{items.length} prontos</span>}
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div
                      className={`flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed p-4 text-center ${isDragging ? 'border-primary bg-primary/5' : 'border-border/80 bg-secondary/10 hover:border-primary/50'}`}
                      role="button" tabIndex={0} aria-label="Enviar vídeos"
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click() } }}
                      onClick={() => fileInputRef.current?.click()}
                      onDragOver={e => { e.preventDefault(); e.stopPropagation(); setIsDragging(true) }}
                      onDragEnter={e => { e.preventDefault(); e.stopPropagation(); setIsDragging(true) }}
                      onDragLeave={e => { e.preventDefault(); e.stopPropagation(); setIsDragging(false) }}
                      onDrop={e => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); if (e.dataTransfer.files) void handleFiles(e.dataTransfer.files) }}
                    >
                      <input ref={fileInputRef} aria-label="Selecionar vídeos para as campanhas" type="file" accept=".mp4,.mov,video/mp4,video/quicktime" multiple className="sr-only" onChange={e => { if (e.target.files) void handleFiles(e.target.files); e.target.value = '' }} />
                      <UploadCloud className="size-5 text-muted-foreground" aria-hidden="true" />
                      <p className="mt-2 text-xs font-semibold text-foreground">Enviar vídeos</p>
                      <p className="mt-1 text-xs text-muted-foreground">MP4 ou MOV · até 500 MB</p>
                    </div>
                    <div className="flex min-h-28 flex-col justify-center rounded-xl border border-border/70 bg-secondary/10 p-4">
                      <p className="text-xs font-semibold text-foreground">Biblioteca</p>
                      <p className="mt-1 mb-3 text-xs leading-relaxed text-muted-foreground">Reutilize vídeos enviados anteriormente sem duplicar ou excluir arquivos.</p>
                      <SavedVideos appearance="creation" selectedUrls={items.map(item => item.videoUrl)} disabled={submitting || uploadingCount > 0 || items.length >= 20} onPick={item => setItems(current => [...current, { key: crypto.randomUUID(), name: item.name.replace(/\.[^.]+$/, '').slice(0, 120), fileName: item.name, videoUrl: item.url, uploading: false }])} />
                    </div>
                  </div>

                  {items.length > 0 && <p className="mt-3 text-xs font-medium text-foreground">{items.length} vídeo(s) selecionado(s) → {items.length} campanha(s)</p>}

                  {items.length > 0 && (
                    <div className="mt-3 divide-y divide-border/60 border-y border-border/60">
                      {items.map((it, idx) => (
                        <div key={it.key} className="py-3">
                          <div className="flex items-center justify-between gap-3 text-xs">
                            <div className="flex min-w-0 items-center gap-2">
                              {it.uploading ? <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" /> : it.error ? <AlertCircle className="size-3.5 shrink-0 text-error" /> : <CheckCircle2 className="size-3.5 shrink-0 text-success" />}
                              <span className="truncate font-medium text-foreground">{it.fileName || it.name}</span>
                              {it.sizeMb && <span className="shrink-0 text-xs text-muted-foreground">{it.sizeMb} MB</span>}
                            </div>
                            <button type="button" className="btn-ghost min-h-10 min-w-10 p-2 text-muted-foreground hover:text-error" onClick={() => removeItem(it.key)} aria-label="Remover vídeo" disabled={uploadingCount > 0 || submitting}><Trash2 className="size-3.5" /></button>
                          </div>
                          {it.error && <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-error"><span>{it.error}</span><button type="button" className="btn-secondary min-h-10 text-xs" disabled={uploadingCount > 0} onClick={() => void uploadItems([it])}>Tentar novamente</button></div>}
                          <label className="mt-2 block">
                            <span className="mb-1.5 block text-xs font-medium text-foreground">Nome da campanha</span>
                            <input type="text" maxLength={120} value={it.name} onChange={e => { const value = e.target.value; setItems(prev => prev.map((item, i) => i === idx ? { ...item, name: value } : item)) }} placeholder="Nome da campanha" className="launch-input" />
                            {campaignPrefix.trim() && <span className="mt-1 block text-xs text-muted-foreground">Nome final: {campaignPrefix.trim()} - {it.name || '—'}</span>}
                          </label>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <section className="launch-section-card">
                  <h3 className="launch-section-title">Destino e mercado</h3>
                  <p className="launch-section-copy">Defina para onde o clique vai e em qual mercado a campanha poderá entregar.</p>
                  <div className="mt-4 space-y-4">
                    <AdDestinationField
                      id="launcher-link"
                      value={linkUrl}
                      onChange={(value) => { setLinkUrl(value); setLaunchError(null) }}
                      disabled={submitting || localUploadBusy}
                      label="Página de vendas"
                      cloakTrafficSource="tiktok_standard"
                    />
                    {destinationInvalid && <span className="-mt-2 block text-xs text-error">Use uma URL HTTPS válida.</span>}
                    <MarketSelector appearance="creation" value={market} onChange={setMarket} disabled={submitting} />
                  </div>
                </section>

                <section className="launch-section-card">
                  <h3 className="launch-section-title">Investimento</h3>
                  <p className="launch-section-copy">Este valor é aplicado a cada campanha. Com vários vídeos, o total potencial aumenta proporcionalmente.</p>
                  <div className="mt-4"><MoneyField label="Orçamento diário por campanha" currency={currency} value={budget} onChange={value => { setBudget(value); setLaunchError(null) }} min={TIKTOK_MIN_BUDGET} hint={`Mínimo: ${fmtSpend(TIKTOK_MIN_BUDGET, currency)} por campanha/dia.`} /></div>
                  {budgetInvalid && <p className="mt-2 text-xs text-error">{tiktokMinimumBudgetMessage(currency, isBulk ? ' para cada campanha' : '')}</p>}
                </section>

                <section className="launch-section-card">
                  <button type="button" aria-expanded={showAdvanced} onClick={() => setShowAdvanced(!showAdvanced)} className="flex w-full min-h-11 items-center justify-between gap-3 text-left">
                    <span><span className="launch-section-title block">Personalização</span><span className="launch-section-copy block">Opcional. Ajuste prefixo, texto e botão se não quiser usar os padrões.</span></span>
                    {showAdvanced ? <ChevronUp className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
                  </button>
                  {showAdvanced && <div className="mt-4 space-y-3 border-t border-border/60 pt-4">
                    <label className="block"><span className="mb-1.5 block text-xs font-medium text-foreground">Prefixo do nome</span><input type="text" value={campaignPrefix} onChange={e => setCampaignPrefix(e.target.value)} placeholder="Ex.: [Escala BR]" className="launch-input" /></label>
                    <label className="block"><span className="mb-1.5 block text-xs font-medium text-foreground">Texto do anúncio</span><input type="text" value={bodyText} onChange={e => setBodyText(e.target.value)} placeholder="Ex.: Frete grátis apenas hoje." className="launch-input" /></label>
                    <label className="block"><span className="mb-1.5 block text-xs font-medium text-foreground">Botão</span><select value={cta} onChange={e => setCta(e.target.value)} className="launch-input"><option value="AUTO">Automático · TikTok otimiza</option><option value="SHOP_NOW">Comprar agora</option><option value="LEARN_MORE">Saiba mais</option><option value="ORDER_NOW">Pedir agora</option></select></label>
                  </div>}
                </section>
              </fieldset>

              <aside className="launch-review" aria-label="Revisão da campanha">
                <div className="launch-review-head"><div><p className="launch-review-title">Revisão</p><p className="launch-review-copy">Conversão (CBO) · será criada pausada</p></div></div>
                <div className="launch-context-line">
                  <span>Pixel da conta</span>
                  {pixelLoading ? <strong>Conferindo…</strong> : pixelReady ? <strong className="text-success">● Pronto · {pixelName || 'vinculado'} · Compra</strong> : <strong className="text-warning">Necessário</strong>}
                </div>
                {!pixelReady && !pixelLoading && <div className="launch-inline-warning"><span>Configure o Pixel da conta antes de criar campanhas de conversão.</span>{onConfigurePixel && <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={onConfigurePixel} disabled={submitting || localUploadBusy}>Configurar Pixel</button>}</div>}
                <div className="launch-review-list">
                  <div className="launch-review-row"><span>Formato</span><strong>Conversão (CBO)</strong></div>
                  <div className="launch-review-row"><span>Campanhas</span><strong>{items.length || 0}</strong></div>
                  <div className="launch-review-row"><span>Mercado</span><strong>{market.countries.join(', ') || '—'}</strong></div>
                  <div className="launch-review-row"><span>Idioma</span><strong>{market.languages.join(', ') || 'Todos'}</strong></div>
                  <div className="launch-review-row"><span>Destino</span><strong>{linkUrl ? linkUrl.replace(/^https?:\/\//, '').split('/')[0] : '—'}</strong></div>
                  <div className="launch-review-row"><span>Orçamento</span><strong>{Number(budget) > 0 ? `${fmtSpend(Number(budget), currency)}/dia` : '—'}</strong></div>
                </div>
                <div className="launch-review-total">
                  <span className="text-xs text-muted-foreground">Gasto diário total potencial</span>
                  <strong>{budgetTotal > 0 ? fmtSpend(budgetTotal, currency) : '—'}</strong>
                  <p className="mt-1 text-xs text-muted-foreground">{items.length || 0} campanha(s) × {Number(budget) > 0 ? `${fmtSpend(Number(budget), currency)}/dia` : '—'}</p>
                </div>
                {launchError ? <div className="launch-review-error"><AlertCircle className="mt-0.5 size-4 shrink-0" /><span>{launchError}</span></div> : validationError ? <div className="launch-review-warning"><AlertCircle className="mt-0.5 size-4 shrink-0" /><span>{validationError}</span></div> : <div className="launch-review-ready"><CheckCircle2 className="mt-0.5 size-4 shrink-0" /><span>Tudo pronto. O ROINADOS fará o preflight e enviará a estrutura pausada ao TikTok.</span></div>}
              </aside>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
