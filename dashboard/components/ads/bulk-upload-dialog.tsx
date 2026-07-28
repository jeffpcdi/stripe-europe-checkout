'use client'

// Criação em massa com vídeos TikTok — até 20 vídeos de uma vez.
// Fluxo: solta N vídeos → cada um vira um item (upload → URL) → configurações
// comuns de conversão → POST /api/ads/bulk enfileira tudo
// no backend (fila durável, 1 criação por vez respeitando rate limit) → a UI
// faz polling do progresso e permite REPROCESSAR só os itens que falharam.

import { useEffect, useMemo, useRef, useState } from 'react'
import { X, Layers, Loader2, UploadCloud, Trash2, CheckCircle2, XCircle, RotateCcw, Clock } from 'lucide-react'
import { apiSend, adsUpload, useAdsBulkJob, useAdsTikTokPixels } from '@/lib/api'
import { toast } from '@/lib/toast'
import type { AdsBulkStartResponse } from '@/lib/types'
import { useModalA11y } from '@/lib/use-modal-a11y'
import {
  TIKTOK_MIN_BUDGET,
  tiktokMinimumBudgetMessage,
  tomorrowLocalIsoDate,
  toLocalIsoDate,
} from './tiktok-contracts'

interface BulkFormItem {
  key: string
  name: string
  videoUrl: string // vazio enquanto o upload roda
  uploading: boolean
  fileName: string
}

export function BulkUploadDialog({
  open,
  onClose,
  advertiserId,
  currency,
  onFinished,
}: {
  open: boolean
  onClose: () => void
  advertiserId: string
  currency: string
  onFinished: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const idempotencyRef = useRef<{ signature: string; key: string } | null>(null)

  // Configurações comuns a todos os anúncios do lote
  const [budget, setBudget] = useState(String(TIKTOK_MIN_BUDGET))
  const [budgetType, setBudgetType] = useState<'daily' | 'lifetime'>('daily')
  const [endDate, setEndDate] = useState('')
  const [countries, setCountries] = useState('BR')
  const [linkUrl, setLinkUrl] = useState('')
  const [body, setBody] = useState('')

  const [items, setItems] = useState<BulkFormItem[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [retrying, setRetrying] = useState(false)

  // Polling do progresso — para sozinho quando o job conclui
  const { data: job, mutate: mutateJob } = useAdsBulkJob(jobId)
  const {
    data: pixelState,
    error: pixelError,
    isLoading: pixelLoading,
  } = useAdsTikTokPixels(open && Boolean(advertiserId), advertiserId)
  const pixelReady = Boolean(pixelState?.ready && pixelState.binding)
  const jobDone = job?.status === 'done'
  const notifiedRef = useRef(false)

  useModalA11y(open, ref, submitting ? () => {} : onClose)

  useEffect(() => {
    if (open) {
      setBudget(String(TIKTOK_MIN_BUDGET))
      setBudgetType('daily')
      setEndDate('')
      setCountries('BR')
      setLinkUrl('')
      setBody('')
      setItems([])
      setJobId(null)
      idempotencyRef.current = null
      notifiedRef.current = false
    }
  }, [open])

  // Toast único quando o job termina + revalida a árvore
  useEffect(() => {
    if (jobDone && !notifiedRef.current) {
      notifiedRef.current = true
      if ((job?.failed ?? 0) > 0) {
        toast.error(`${job!.failed} de ${job!.total} falharam`, {
          hint: 'Revise os erros abaixo e reprocesse só as falhas.',
        })
      } else {
        toast.success(`${job!.total} campanha(s) criada(s)`, {
          hint: 'Anúncios criados pausados para você revisar antes de ativar.',
        })
      }
      onFinished()
    }
  }, [jobDone, job, onFinished])

  const uploadingCount = items.filter((i) => i.uploading).length

  const error: string | null = useMemo(() => {
    if (pixelLoading) return 'Aguarde a verificação do Pixel desta conta'
    if (pixelError) return 'Não foi possível verificar o Pixel desta conta agora'
    if (!pixelReady) return 'Vincule o Pixel da conta em Conversões antes de enviar os vídeos'
    if (!items.length) return 'Adicione pelo menos 1 vídeo'
    if (uploadingCount > 0) return `Aguarde: ${uploadingCount} upload(s) em andamento`
    if (items.some((i) => !i.videoUrl)) return 'Há vídeos sem URL (upload falhou) — remova-os ou re-envie'
    if (items.some((i) => !i.name.trim())) return 'Todo anúncio precisa de um nome'
    if (!(Number(budget) >= TIKTOK_MIN_BUDGET)) return tiktokMinimumBudgetMessage(currency, ' para cada campanha')
    if (budgetType === 'lifetime' && !/^\d{4}-\d{2}-\d{2}/.test(endDate)) return 'Orçamento total exige data de término'
    if (budgetType === 'lifetime' && endDate <= toLocalIsoDate(new Date())) return 'A data de término precisa ser futura'
    if (!countries.split(/[,\s]+/).some((country) => /^[A-Za-z]{2}$/.test(country.trim()))) return 'Informe pelo menos um país válido'
    if (!/^https:\/\/\S+/.test(linkUrl.trim())) return 'Informe a página HTTPS para onde os anúncios levarão'
    return null
  }, [pixelLoading, pixelError, pixelReady, items, uploadingCount, budget, currency, budgetType, endDate, countries, linkUrl])

  async function handleFiles(files: FileList | File[]) {
    if (!pixelReady) {
      toast.error('Vincule o Pixel da conta antes de enviar os vídeos', {
        hint: 'O vínculo é feito uma única vez na aba Conversões.',
      })
      return
    }
    const list = Array.from(files).slice(0, 20 - items.length)
    for (const file of list) {
      if (!file.type.startsWith('video/')) {
        toast.error(`"${file.name}" não é vídeo — ignorado`)
        continue
      }
      if (file.size > 500 * 1024 * 1024) {
        toast.error(`"${file.name}" acima de 500 MB — ignorado`)
        continue
      }
      const key = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const baseName = file.name.replace(/\.[^.]+$/, '').slice(0, 100)
      setItems((prev) => [...prev, { key, name: baseName, videoUrl: '', uploading: true, fileName: file.name }])
      try {
        const { url } = await adsUpload(file, 'video')
        setItems((prev) => prev.map((it) => (it.key === key ? { ...it, videoUrl: url, uploading: false } : it)))
      } catch (e) {
        setItems((prev) => prev.map((it) => (it.key === key ? { ...it, uploading: false } : it)))
        toast.error(`Falha no upload de "${file.name}"`, { hint: e instanceof Error ? e.message : undefined })
      }
    }
  }

  async function handleSubmit() {
    setSubmitting(true)
    try {
      const countryList = countries
        .split(/[,\s]+/)
        .map((c) => c.trim().toUpperCase())
        .filter((c) => /^[A-Z]{2}$/.test(c))
      const common: Record<string, unknown> = {
        goal: 'conversions',
        budgetAmount: Number(budget),
        budgetType,
        linkUrl: linkUrl.trim(),
      }
      if (budgetType === 'lifetime') common.endDate = endDate
      if (countryList.length) common.countries = countryList
      if (body.trim()) common.body = body.trim()

      const request = {
        adAccountId: advertiserId,
        common,
        items: items.map((it) => ({ name: it.name.trim(), videoUrl: it.videoUrl })),
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
      toast.info(res.dryRun ? `Simulação concluída: ${res.total} anúncio(s)` : `Lote enfileirado: ${res.total} anúncio(s)`, {
        hint: res.dryRun
          ? 'Nenhuma campanha foi publicada porque a política está em modo de simulação.'
          : 'A fila cria um por vez respeitando o rate limit do TikTok.',
      })
    } catch (e) {
      toast.error('Falha ao iniciar o lote', { hint: e instanceof Error ? e.message : undefined })
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
    } catch (e) {
      toast.error('Falha ao reprocessar', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setRetrying(false)
    }
  }

  if (!open) return null

  const progressPct = job && job.total > 0 ? Math.round(((job.done + job.failed) / job.total) * 100) : 0

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose()
      }}
    >
      <div ref={ref} role="dialog" aria-modal="true" aria-label="Criar anúncios com vídeos em massa" tabIndex={-1} className="w-full max-w-2xl outline-none">
        <div className="anim-pop-in flex max-h-[85vh] flex-col gap-4 overflow-y-auto rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Layers className="size-4 text-primary" aria-hidden="true" />
              Vídeos em massa
            </h2>
            <button type="button" className="btn-ghost px-2 py-1" onClick={onClose} disabled={submitting} aria-label="Fechar">
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>

          {/* ── Fase 2: progresso do job ── */}
          {jobId ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-foreground">
                  {jobDone ? 'Lote concluído' : 'Criando anúncios…'}
                </span>
                <span className="text-muted-foreground">
                  {(job?.done ?? 0) + (job?.failed ?? 0)} de {job?.total ?? items.length}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-valuenow={progressPct} aria-valuemin={0} aria-valuemax={100}>
                <div
                  className={`h-full rounded-full transition-all duration-500 ${(job?.failed ?? 0) > 0 ? 'bg-[color:var(--warning,#f59e0b)]' : 'bg-primary'}`}
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <ul className="flex max-h-72 flex-col gap-1.5 overflow-y-auto" aria-label="Itens do lote">
                {(job?.items ?? []).map((it) => (
                  <li key={it.idx} className="flex items-start gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs">
                    {it.status === 'done' ? (
                      <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden="true" />
                    ) : it.status === 'failed' ? (
                      <XCircle className="mt-0.5 size-3.5 shrink-0 text-error" aria-hidden="true" />
                    ) : it.status === 'running' ? (
                      <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-primary" aria-hidden="true" />
                    ) : (
                      <Clock className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-foreground">{it.ref}</p>
                      {it.error && <p className="mt-0.5 text-pretty text-[11px] text-error">{it.error}</p>}
                    </div>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {it.status === 'done' ? 'criado' : it.status === 'failed' ? 'falhou' : it.status === 'running' ? 'criando…' : 'na fila'}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="flex items-center justify-end gap-2">
                {jobDone && (job?.failed ?? 0) > 0 && (
                  <button type="button" className="btn-ghost text-xs" onClick={handleRetryFailed} disabled={retrying}>
                    {retrying ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <RotateCcw className="size-3.5" aria-hidden="true" />}
                    Reprocessar falhas
                  </button>
                )}
                <button type="button" className="btn-primary text-xs" onClick={onClose}>
                  {jobDone ? 'Fechar' : 'Continuar em segundo plano'}
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* ── Fase 1: vídeos + configurações comuns ── */}
              <button
                type="button"
                className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-background px-4 py-6 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => fileRef.current?.click()}
                disabled={!pixelReady || pixelLoading}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files)
                }}
              >
                <UploadCloud className="size-6" aria-hidden="true" />
                <span className="font-medium">Solte até 20 vídeos aqui ou clique para escolher</span>
                <span>MP4 vertical 9:16 · 5–60s · até 500 MB cada</span>
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="video/*"
                multiple
                className="sr-only"
                onChange={(e) => {
                  if (e.target.files?.length) handleFiles(e.target.files)
                  e.target.value = ''
                }}
              />

              <div
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-[11px] ${
                  pixelReady
                    ? 'border-success/25 bg-success/5 text-muted-foreground'
                    : 'border-warning/30 bg-warning/5 text-warning'
                }`}
                role="status"
              >
                {pixelLoading ? (
                  <>
                    <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
                    Conferindo o Pixel da conta…
                  </>
                ) : pixelReady ? (
                  <>
                    <CheckCircle2 className="size-3.5 shrink-0 text-success" aria-hidden="true" />
                    Conversão · Compra · Pixel: {pixelState?.binding?.pixelName || 'vinculado'} · TikTok · criação pausada
                  </>
                ) : (
                  <>
                    <XCircle className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      Vincule o Pixel uma única vez em Conversões antes de enviar os vídeos.
                    </span>
                    <a className="shrink-0 font-semibold underline underline-offset-2" href="/dashboard/pixels">
                      Abrir Conversões
                    </a>
                  </>
                )}
              </div>

              {items.length > 0 && (
                <ul className="flex max-h-56 flex-col gap-1.5 overflow-y-auto" aria-label="Vídeos do lote">
                  {items.map((it) => (
                    <li key={it.key} className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
                      {it.uploading ? (
                        <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" aria-hidden="true" />
                      ) : it.videoUrl ? (
                        <CheckCircle2 className="size-3.5 shrink-0 text-success" aria-hidden="true" />
                      ) : (
                        <XCircle className="size-3.5 shrink-0 text-error" aria-hidden="true" />
                      )}
                      <input
                        className="input-neon min-w-0 flex-1 rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground"
                        value={it.name}
                        maxLength={120}
                        onChange={(e) =>
                          setItems((prev) => prev.map((p) => (p.key === it.key ? { ...p, name: e.target.value } : p)))
                        }
                        aria-label={`Nome do anúncio (${it.fileName})`}
                      />
                      <button
                        type="button"
                        className="btn-ghost !p-1 text-muted-foreground"
                        onClick={() => setItems((prev) => prev.filter((p) => p.key !== it.key))}
                        aria-label={`Remover ${it.fileName}`}
                      >
                        <Trash2 className="size-3.5" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <fieldset className="flex flex-col gap-3">
                <legend className="text-xs font-semibold text-foreground">Configuração do lote</legend>
                <p className="text-[11px] text-muted-foreground">
                  Cada vídeo cria uma campanha de conversão com conjunto e anúncio próprios, todos preparados para revisão.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-foreground">Orçamento por campanha ({currency})</span>
                    <input
                      type="number"
                      min={TIKTOK_MIN_BUDGET}
                      step="0.01"
                      className="input-neon w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                      value={budget}
                      onChange={(e) => setBudget(e.target.value)}
                      placeholder="50,00"
                    />
                    <span className="text-[10px] text-muted-foreground">Mínimo por campanha: {currency} {TIKTOK_MIN_BUDGET}.</span>
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
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-foreground">Países (ISO-2)</span>
                    <input
                      className="input-neon w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                      value={countries}
                      onChange={(e) => setCountries(e.target.value)}
                      placeholder="BR"
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-foreground">Página de destino</span>
                    <input
                      type="url"
                      className="input-neon w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                      value={linkUrl}
                      onChange={(e) => setLinkUrl(e.target.value)}
                      placeholder="https://sualoja.com/oferta"
                      required
                    />
                  </label>
                </div>
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-foreground">Texto do anúncio (opcional, até 100 caracteres)</span>
                  <input
                    className="input-neon w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                    value={body}
                    maxLength={100}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder="Ex.: Frete grátis hoje"
                  />
                </label>
              </fieldset>

              {error && (
                <p className="text-[11px] font-medium text-error" role="alert">
                  {error}
                </p>
              )}

              <div className="flex items-center justify-end gap-2">
                <button type="button" className="btn-ghost text-xs" onClick={onClose} disabled={submitting}>
                  Cancelar
                </button>
                <button
                  type="button"
                  className="btn-primary text-xs disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={handleSubmit}
                  disabled={submitting || Boolean(error)}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                      Enfileirando…
                    </>
                  ) : (
                    <>
                      <Layers className="size-3.5" aria-hidden="true" />
                      Criar {items.length || ''} campanha{items.length === 1 ? '' : 's'}
                    </>
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
