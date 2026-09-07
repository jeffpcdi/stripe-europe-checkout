'use client'

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
  DollarSign,
  Play,
  RotateCcw,
} from 'lucide-react'
import { apiSend, adsUpload, useAdsBulkJob, useAdsTikTokPixels } from '@/lib/api'
import { toast } from '@/lib/toast'
import { useModalA11y } from '@/lib/use-modal-a11y'
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
}

export function UniversalLauncherDialog({
  open,
  onClose,
  advertiserId,
  currency,
  onFinished,
  onSuccess,
}: {
  open: boolean
  onClose: () => void
  advertiserId: string
  currency: string
  onFinished?: () => void
  onSuccess?: () => void
}) {
  const handleDone = () => {
    onSuccess?.()
    onFinished?.()
  }
  const dialogRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const idempotencyRef = useRef<{ signature: string; key: string } | null>(null)

  // Modos de criação: 'standard' (Campanha Rápida CBO), 'smart_plus' (Smart+ IA), 'bulk' (Lote automático)
  const [singleMode, setSingleMode] = useState<'standard' | 'smart_plus'>('standard')

  // 2 Campos Essenciais
  const [linkUrl, setLinkUrl] = useState('')
  const [budget, setBudget] = useState(String(Math.max(TIKTOK_MIN_BUDGET, 60)))

  // Opções Avançadas (recolhidas por padrão)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [campaignPrefix, setCampaignPrefix] = useState('')
  const [bodyText, setBodyText] = useState('')
  const [cta, setCta] = useState('SHOP_NOW')

  // Lista de vídeos
  const [items, setItems] = useState<VideoItem[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [retrying, setRetrying] = useState(false)

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

  useModalA11y(open, dialogRef, submitting ? () => {} : onClose)

  useEffect(() => {
    if (open) {
      setSingleMode('standard')
      setLinkUrl('')
      setBudget(String(Math.max(TIKTOK_MIN_BUDGET, 60)))
      setShowAdvanced(false)
      setCampaignPrefix('')
      setBodyText('')
      setCta('SHOP_NOW')
      setItems([])
      setJobId(null)
      idempotencyRef.current = null
      notifiedRef.current = false
    }
  }, [open])

  // Notificação de conclusão de lote
  useEffect(() => {
    if (jobDone && !notifiedRef.current) {
      notifiedRef.current = true
      if ((job?.failed ?? 0) > 0) {
        toast.error(`${job!.failed} de ${job!.total} falharam`, {
          hint: 'Revise os erros abaixo e tente reprocessar as falhas.',
        })
      } else {
        toast.success(`${job!.total} campanha(s) criada(s) com sucesso! 🚀`, {
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
    if (!pixelReady) return 'Vincule o Pixel da conta em Conversões antes de criar campanhas'
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

  // Upload de arquivos
  async function handleFiles(files: FileList | File[]) {
    if (!pixelReady) {
      toast.error('Vincule o Pixel da conta antes de enviar vídeos', {
        hint: 'O Pixel é configurado uma única vez e garante o evento de Compra.',
      })
      return
    }

    const availableSlots = 20 - items.length
    if (availableSlots <= 0) {
      toast.info('Limite máximo de 20 vídeos por lote atingido')
      return
    }

    const list = Array.from(files).slice(0, availableSlots)
    for (const file of list) {
      if (!file.type.startsWith('video/')) {
        toast.error(`"${file.name}" não é um arquivo de vídeo válido`)
        continue
      }
      if (file.size > 500 * 1024 * 1024) {
        toast.error(`"${file.name}" ultrapassa o limite de 500 MB`)
        continue
      }

      const key = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const baseName = file.name.replace(/\.[^.]+$/, '').slice(0, 80)
      const sizeMb = (file.size / (1024 * 1024)).toFixed(1)

      setItems((prev) => [
        ...prev,
        {
          key,
          name: baseName,
          videoUrl: '',
          uploading: true,
          fileName: file.name,
          sizeMb,
        },
      ])

      try {
        const { url } = await adsUpload(file, 'video')
        setItems((prev) =>
          prev.map((it) => (it.key === key ? { ...it, videoUrl: url, uploading: false } : it))
        )
      } catch (e) {
        setItems((prev) => prev.map((it) => (it.key === key ? { ...it, uploading: false } : it)))
        toast.error(`Falha no upload de "${file.name}"`, {
          hint: e instanceof Error ? e.message : undefined,
        })
      }
    }
  }

  function removeItem(key: string) {
    setItems((prev) => prev.filter((it) => it.key !== key))
  }

  // Lançamento
  async function handleLaunch() {
    if (validationError) return
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
            countries: ['BR'],
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

      if (singleMode === 'smart_plus') {
        const payload = {
          adAccountId: advertiserId,
          name: campaignName,
          goal: 'conversions',
          budgetAmount: budgetNum,
          countries: ['BR'],
          videoUrl: singleItem.videoUrl,
          linkUrl: cleanLink,
          body: cleanBody,
          callToAction: cta,
        }
        await apiSend('/api/ads/smart-plus', 'POST', payload)
        toast.success('Campanha Smart+ criada (Pausada)', {
          hint: 'O algoritmo do TikTok otimizará criativo e público automaticamente.',
        })
        handleDone()
        onClose()
        return
      }

      // Caso 3: 1 Vídeo - Campanha Rápida Otimizada (CBO / Conversão)
      const payload = {
        adAccountId: advertiserId,
        goal: 'conversions',
        name: campaignName,
        budgetAmount: budgetNum,
        budgetType: 'daily',
        budgetOptimization: 'campaign',
        bidStrategy: 'lowest_cost',
        countries: ['BR'],
        videoUrl: singleItem.videoUrl,
        body: cleanBody,
        linkUrl: cleanLink,
        callToAction: cta,
        idempotencyKey: `quick-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      }

      await apiSend('/api/ads/create/preflight', 'POST', payload)
      await apiSend('/api/ads/create', 'POST', payload)

      toast.success('Campanha de Conversão Criada! 🚀', {
        hint: 'Nascida pausada com Pixel de Compra vinculado. Ative quando desejar.',
      })
      handleDone()
      onClose()
    } catch (e) {
      toast.error('Não foi possível lançar a campanha', {
        hint: e instanceof Error ? e.message : undefined,
      })
    } finally {
      setSubmitting(false)
    }
  }

  async function handleRetryFailed() {
    if (!jobId) return
    setRetrying(true)
    notifiedRef.current = false
    try {
      await apiSend(`/api/ads/bulk/${encodeURIComponent(jobId)}/retry`, 'POST', {})
      mutateJob()
      toast.info('Reprocessando itens com falha...')
    } catch (e) {
      toast.error('Falha ao reprocessar', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setRetrying(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-black/80 p-3 sm:p-5 backdrop-blur-md"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting && !jobId) onClose()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Lançador de Campanhas"
        tabIndex={-1}
        className="anim-pop-in flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#09090b]/95 shadow-[0_0_60px_rgba(0,0,0,0.85)] outline-none"
      >
        {/* Cabeçalho Minimalista */}
        <div className="flex items-center justify-between border-b border-border/40 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Rocket className="size-4" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-foreground">Lançador Rápido de Anúncios</h2>
              <p className="text-[11px] text-muted-foreground">
                {isBulk
                  ? `Lote de ${items.length} campanhas com 1 clique`
                  : 'Criar campanha de conversão pausada'}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="btn-ghost size-8 p-0 text-muted-foreground hover:text-foreground"
            onClick={onClose}
            disabled={submitting}
            aria-label="Fechar"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        {/* Corpo do Modal */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Se houver job em andamento (Modo progresso do lote) */}
          {jobId && job ? (
            <div className="space-y-4 rounded-xl border border-border/50 bg-secondary/15 p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground flex items-center gap-2">
                  <Layers className="size-4 text-primary" />
                  Progresso da Criação em Lote
                </span>
                <span className="text-xs font-mono tabular-nums text-muted-foreground">
                  {(job.done ?? 0) + (job.failed ?? 0)} / {job.total}
                </span>
              </div>

              {/* Barra de progresso */}
              <div className="h-2 w-full overflow-hidden rounded-full bg-secondary/50">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${job.total > 0 ? (((job.done ?? 0) + (job.failed ?? 0)) / job.total) * 100 : 0}%` }}
                />
              </div>

              {/* Lista dos itens do job */}
              <div className="max-h-48 space-y-1.5 overflow-y-auto pr-1">
                {(job.items ?? []).map((it, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between rounded-lg bg-background/50 px-3 py-2 text-xs border border-border/30"
                  >
                    <span className="truncate max-w-[280px] text-muted-foreground">{it.ref || `Campanha #${it.idx + 1}`}</span>
                    {it.status === 'done' ? (
                      <span className="flex items-center gap-1 text-success text-[11px] font-medium">
                        <CheckCircle2 className="size-3.5" /> Criada
                      </span>
                    ) : it.status === 'failed' ? (
                      <span className="flex items-center gap-1 text-error text-[11px] font-medium" title={it.error}>
                        <AlertCircle className="size-3.5" /> Falhou
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-primary text-[11px] font-medium">
                        <Loader2 className="size-3.5 animate-spin" /> Criando...
                      </span>
                    )}
                  </div>
                ))}
              </div>

              {jobDone && (job.failed ?? 0) > 0 && (
                <button
                  type="button"
                  className="btn-secondary w-full text-xs justify-center gap-2"
                  onClick={handleRetryFailed}
                  disabled={retrying}
                >
                  <RotateCcw className={`size-3.5 ${retrying ? 'animate-spin' : ''}`} />
                  Reprocessar falhas ({job.failed})
                </button>
              )}
            </div>
          ) : (
            <>
              {/* 1. SELEÇÃO / UPLOAD DE VÍDEOS */}
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1.5">
                  1. Vídeos do Anúncio (1 a 20 vídeos)
                </label>

                {/* Dropzone */}
                <div
                  className="group relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border/60 bg-secondary/10 p-5 text-center transition-colors hover:border-primary/40 hover:bg-primary/5 cursor-pointer"
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    if (e.dataTransfer.files) handleFiles(e.dataTransfer.files)
                  }}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="video/mp4,video/quicktime,video/webm"
                    multiple
                    className="sr-only"
                    onChange={(e) => {
                      if (e.target.files) handleFiles(e.target.files)
                      e.target.value = ''
                    }}
                  />
                  <div className="flex size-10 items-center justify-center rounded-xl bg-secondary/80 text-muted-foreground group-hover:bg-primary/20 group-hover:text-primary transition-colors">
                    <UploadCloud className="size-5" aria-hidden="true" />
                  </div>
                  <p className="mt-2 text-xs font-semibold text-foreground">
                    Clique para selecionar ou arraste vídeos aqui
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Formatos MP4 ou MOV · Até 500 MB cada · 1 vídeo = campanha única | 2+ = lote automático
                  </p>
                </div>

                {/* Lista de vídeos adicionados */}
                {items.length > 0 && (
                  <div className="mt-3 space-y-2">
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground px-0.5">
                      <span>{items.length} vídeo(s) pronto(s)</span>
                      {items.length > 1 && (
                        <span className="text-primary font-semibold">Modo Lote Ativo 🚀</span>
                      )}
                    </div>
                    <div className="max-h-40 space-y-1.5 overflow-y-auto pr-1">
                      {items.map((it) => (
                        <div
                          key={it.key}
                          className="flex items-center justify-between rounded-lg border border-border/40 bg-secondary/20 px-3 py-2 text-xs"
                        >
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            {it.uploading ? (
                              <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
                            ) : (
                              <Play className="size-3.5 shrink-0 text-success" />
                            )}
                            <span className="truncate font-medium text-foreground">{it.name}</span>
                            {it.sizeMb && (
                              <span className="text-[10px] text-muted-foreground shrink-0">{it.sizeMb} MB</span>
                            )}
                          </div>
                          <button
                            type="button"
                            className="btn-ghost p-1 text-muted-foreground hover:text-error shrink-0"
                            onClick={() => removeItem(it.key)}
                            aria-label="Remover vídeo"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Alternância se for apenas 1 vídeo: Campanha Rápida vs Smart+ */}
                {items.length === 1 && (
                  <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-secondary/20 p-1 border border-border/40">
                    <button
                      type="button"
                      className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition-all ${
                        singleMode === 'standard'
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                      onClick={() => setSingleMode('standard')}
                    >
                      <Rocket className="size-3.5 text-primary" />
                      Campanha Padrão CBO
                    </button>
                    <button
                      type="button"
                      className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition-all ${
                        singleMode === 'smart_plus'
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                      onClick={() => setSingleMode('smart_plus')}
                    >
                      <Sparkles className="size-3.5 text-primary" />
                      Smart+ Inteligente
                    </button>
                  </div>
                )}
              </div>

              {/* 2. DESTINO (PÁGINA DE VENDAS) */}
              <div>
                <label htmlFor="launcher-link" className="block text-xs font-semibold text-foreground mb-1.5">
                  2. Link da Página de Vendas (Destino)
                </label>
                <div className="relative">
                  <LinkIcon className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    id="launcher-link"
                    type="url"
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    placeholder="https://meusite.com/produto"
                    className="input-neon w-full rounded-xl border border-border bg-background py-2 pl-9 pr-3 text-xs text-foreground placeholder:text-muted-foreground"
                  />
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Para onde o usuário vai ao clicar no anúncio.
                </p>
              </div>

              {/* 3. ORÇAMENTO DIÁRIO */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="launcher-budget" className="text-xs font-semibold text-foreground">
                    3. Orçamento Diário {isBulk ? '(por campanha)' : ''}
                  </label>
                  <span className="text-[11px] text-muted-foreground font-mono">
                    Mínimo: {fmtSpend(TIKTOK_MIN_BUDGET, currency)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <DollarSign className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <input
                      id="launcher-budget"
                      type="number"
                      min={TIKTOK_MIN_BUDGET}
                      step="1"
                      value={budget}
                      onChange={(e) => setBudget(e.target.value)}
                      className="input-neon w-full rounded-xl border border-border bg-background py-2 pl-9 pr-3 text-xs font-mono font-semibold text-foreground"
                    />
                  </div>
                  {/* Atalhos Rápidos */}
                  <div className="flex items-center gap-1.5">
                    {[60, 100, 150, 200].map((val) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setBudget(String(val))}
                        className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                          budget === String(val)
                            ? 'border-primary/40 bg-primary/15 text-primary'
                            : 'border-border/50 bg-secondary/20 text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {val}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* 4. OPÇÕES AVANÇADAS (OPCIONAL) */}
              <div className="border-t border-border/30 pt-3">
                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="flex items-center justify-between w-full text-xs font-medium text-muted-foreground hover:text-foreground py-1"
                >
                  <span>Configurações adicionais (opcional)</span>
                  {showAdvanced ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                </button>

                {showAdvanced && (
                  <div className="mt-3 space-y-3 rounded-xl border border-border/40 bg-secondary/10 p-3.5 anim-content-in">
                    <div>
                      <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                        Prefixo no Nome da Campanha
                      </label>
                      <input
                        type="text"
                        value={campaignPrefix}
                        onChange={(e) => setCampaignPrefix(e.target.value)}
                        placeholder="Ex.: [Escala BR] ou [Teste Criativos]"
                        className="input-neon w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                        Texto da Legenda / Copy
                      </label>
                      <input
                        type="text"
                        value={bodyText}
                        onChange={(e) => setBodyText(e.target.value)}
                        placeholder="Ex.: Frete grátis apenas hoje! Clique e garanta o seu."
                        className="input-neon w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                        Chamada para Ação (Botão)
                      </label>
                      <select
                        value={cta}
                        onChange={(e) => setCta(e.target.value)}
                        className="input-neon w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground"
                      >
                        <option value="SHOP_NOW">Comprar agora (SHOP_NOW)</option>
                        <option value="LEARN_MORE">Saiba mais (LEARN_MORE)</option>
                        <option value="ORDER_NOW">Pedir agora (ORDER_NOW)</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Rodapé com Ação Principal */}
        <div className="flex items-center justify-between border-t border-border/40 bg-secondary/10 px-5 py-3.5">
          <div className="text-[11px] text-muted-foreground">
            {validationError ? (
              <span className="text-warning flex items-center gap-1">
                <AlertCircle className="size-3 shrink-0" />
                {validationError}
              </span>
            ) : (
              <span className="text-success flex items-center gap-1">
                <CheckCircle2 className="size-3 shrink-0" />
                Pronto para criar {items.length} campanha(s) pausada(s)
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={onClose}
              disabled={submitting}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="btn-primary text-xs font-semibold px-4 py-2"
              disabled={Boolean(validationError) || submitting || Boolean(jobId && !jobDone)}
              onClick={handleLaunch}
            >
              {submitting ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  Criando...
                </>
              ) : (
                <>
                  <Rocket className="size-3.5" aria-hidden="true" />
                  {isBulk ? `Lançar ${items.length} Campanhas` : 'Lançar Campanha'}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
