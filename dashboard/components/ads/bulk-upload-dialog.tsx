'use client'

// Subida em massa de anúncios TikTok — até 20 vídeos de uma vez.
// Fluxo: solta N vídeos → cada um vira um item (upload → URL) → configurações
// comuns (objetivo, orçamento, países…) → POST /api/ads/bulk enfileira tudo
// no backend (fila durável, 1 criação por vez respeitando rate limit) → a UI
// faz polling do progresso e permite REPROCESSAR só os itens que falharam.

import { useEffect, useMemo, useRef, useState } from 'react'
import { X, Layers, Loader2, UploadCloud, Trash2, CheckCircle2, XCircle, RotateCcw, Clock } from 'lucide-react'
import { apiSend, adsUpload, useAdsBulkJob } from '@/lib/api'
import { toast } from '@/lib/toast'
import type { AdsGoal, AdsBulkStartResponse } from '@/lib/types'
import { useModalA11y } from '@/lib/use-modal-a11y'

const GOALS: { value: AdsGoal; label: string }[] = [
  { value: 'traffic', label: 'Tráfego' },
  { value: 'conversions', label: 'Conversões' },
  { value: 'video_views', label: 'Views de vídeo' },
  { value: 'awareness', label: 'Alcance' },
  { value: 'engagement', label: 'Engajamento' },
  { value: 'lead_generation', label: 'Leads' },
]

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

  // Configurações comuns a todos os anúncios do lote
  const [goal, setGoal] = useState<AdsGoal>('traffic')
  const [budget, setBudget] = useState('')
  const [budgetType, setBudgetType] = useState<'daily' | 'lifetime'>('daily')
  const [endDate, setEndDate] = useState('')
  const [countries, setCountries] = useState('BR')
  const [linkUrl, setLinkUrl] = useState('')
  const [body, setBody] = useState('')
  const [pixelId, setPixelId] = useState('')

  const [items, setItems] = useState<BulkFormItem[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [retrying, setRetrying] = useState(false)

  // Polling do progresso — para sozinho quando o job conclui
  const { data: job, mutate: mutateJob } = useAdsBulkJob(jobId)
  const jobDone = job?.status === 'done'
  const notifiedRef = useRef(false)

  useModalA11y(open, ref, submitting ? () => {} : onClose)

  useEffect(() => {
    if (open) {
      setGoal('traffic')
      setBudget('')
      setBudgetType('daily')
      setEndDate('')
      setCountries('BR')
      setLinkUrl('')
      setBody('')
      setPixelId('')
      setItems([])
      setJobId(null)
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
        toast.success(`${job!.total} anúncio(s) criados`, {
          hint: 'Eles entram em revisão do TikTok antes de veicular.',
        })
      }
      onFinished()
    }
  }, [jobDone, job, onFinished])

  const uploadingCount = items.filter((i) => i.uploading).length

  const error: string | null = useMemo(() => {
    if (!items.length) return 'Adicione pelo menos 1 vídeo'
    if (uploadingCount > 0) return `Aguarde: ${uploadingCount} upload(s) em andamento`
    if (items.some((i) => !i.videoUrl)) return 'Há vídeos sem URL (upload falhou) — remova-os ou re-envie'
    if (items.some((i) => !i.name.trim())) return 'Todo anúncio precisa de um nome'
    if (!(Number(budget) > 0)) return 'Informe o orçamento (vale para cada anúncio)'
    if (budgetType === 'lifetime' && !/^\d{4}-\d{2}-\d{2}/.test(endDate)) return 'Orçamento total exige data de término'
    if (goal === 'conversions' && !/^\d{5,30}$/.test(pixelId.trim())) return 'Conversões exigem o Pixel ID numérico'
    return null
  }, [items, uploadingCount, budget, budgetType, endDate, goal, pixelId])

  async function handleFiles(files: FileList | File[]) {
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
        goal,
        budgetAmount: Number(budget),
        budgetType,
      }
      if (budgetType === 'lifetime') common.endDate = endDate
      if (countryList.length) common.countries = countryList
      if (/^https?:\/\//.test(linkUrl.trim())) common.linkUrl = linkUrl.trim()
      if (body.trim()) common.body = body.trim()
      if (goal === 'conversions') common.pixelId = pixelId.trim()

      const idempotencyKey = `bulk:${advertiserId}:${Date.now()}:${items.map((item) => item.key).join(',')}`
      const res = await apiSend<AdsBulkStartResponse>('/api/ads/bulk', 'POST', {
        adAccountId: advertiserId,
        idempotencyKey,
        common,
        items: items.map((it) => ({ name: it.name.trim(), videoUrl: it.videoUrl })),
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
      <div ref={ref} role="dialog" aria-modal="true" aria-label="Subir anúncios em massa" tabIndex={-1} className="w-full max-w-2xl outline-none">
        <div className="anim-pop-in flex max-h-[85vh] flex-col gap-4 overflow-y-auto rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Layers className="size-4 text-primary" aria-hidden="true" />
              Subir anúncios em massa
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
                className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-background px-4 py-6 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                onClick={() => fileRef.current?.click()}
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
                <legend className="text-xs font-semibold text-foreground">Configurações comuns (valem para cada anúncio)</legend>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
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
                {budgetType === 'lifetime' && (
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-foreground">Data de término</span>
                    <input
                      type="date"
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
                      className="input-neon w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                      value={linkUrl}
                      onChange={(e) => setLinkUrl(e.target.value)}
                      placeholder="https://sualoja.com/oferta"
                    />
                  </label>
                </div>
                {goal === 'conversions' && (
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-foreground">Pixel ID numérico do TikTok</span>
                    <input
                      className="input-neon w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                      value={pixelId}
                      onChange={(e) => setPixelId(e.target.value)}
                      placeholder="7012345678901234567"
                    />
                  </label>
                )}
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
                <button type="button" className="btn-primary text-xs" onClick={handleSubmit} disabled={submitting || Boolean(error)}>
                  {submitting ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                      Enfileirando…
                    </>
                  ) : (
                    <>
                      <Layers className="size-3.5" aria-hidden="true" />
                      Subir {items.length || ''} anúncio{items.length === 1 ? '' : 's'}
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
