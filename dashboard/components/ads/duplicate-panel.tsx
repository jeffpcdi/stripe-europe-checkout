'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, Clock, Loader2, XCircle } from 'lucide-react'
import { apiSend, useAdsBulkJob } from '@/lib/api'
import { toast } from '@/lib/toast'
import type { AdsTreeCampaign, AdsAdvertiser, AdsBulkStartResponse } from '@/lib/types'

type Preflight = {
  ok: true
  campaignKind: 'smart_plus' | 'auction'
  objectiveType: string
  budgetOwner: 'campaign' | 'adgroup'
  adGroups: number
  ads: number
  productScopes?: string[]
  normalizedEvent?: string
  warnings?: string[]
}

function when(value?: string | null) {
  if (!value) return ''
  try { return new Date(value).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) } catch { return value }
}

export function DuplicatePanel({
  campaign,
  advertisers,
  currentAdvertiserId,
  onFinished,
  onClose,
  onBusyChange,
}: {
  campaign: AdsTreeCampaign
  advertisers: AdsAdvertiser[]
  currentAdvertiserId: string
  onFinished: () => void
  onClose?: () => void
  onBusyChange?: (busy: boolean) => void
}) {
  const [mode, setMode] = useState<'copy' | 'variations'>('copy')
  const [count, setCount] = useState('1')
  const [suffix, setSuffix] = useState(' (cópia)')
  const [varBudget, setVarBudget] = useState('')
  const [varText, setVarText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [preflight, setPreflight] = useState<Preflight | null>(null)
  const [preflightError, setPreflightError] = useState<string | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [jobDryRun, setJobDryRun] = useState(false)
  const notifiedRef = useRef(false)
  const idempotencyKeyRef = useRef('')

  const { data: job } = useAdsBulkJob(jobId)
  const jobDone = job?.status === 'done'
  const campaignId = campaign.platformCampaignId
  const currentAdvertiser = advertisers.find((a) => String(a.id) === String(currentAdvertiserId))
  const srcName = campaign.campaignName || campaign.platformCampaignId
  const maxCount = mode === 'variations' ? 50 : 10
  const n = parseInt(count, 10)

  useEffect(() => {
    setMode('copy'); setCount('1'); setSuffix(' (cópia)'); setVarBudget(''); setVarText(''); setPreflight(null); setPreflightError(null); setJobId(null); setJobDryRun(false); idempotencyKeyRef.current = ''; notifiedRef.current = false
  }, [campaignId, currentAdvertiserId])

  const materialKey = [campaignId, mode, count, suffix, varBudget, varText].join('\u001f')
  useEffect(() => { idempotencyKeyRef.current = ''; setPreflight(null); setPreflightError(null) }, [materialKey])
  useEffect(() => { onBusyChange?.(submitting || reviewing) }, [submitting, reviewing, onBusyChange])

  useEffect(() => {
    if (!jobDone || notifiedRef.current) return
    notifiedRef.current = true
    if ((job?.failed ?? 0) > 0) toast.error(`${job!.failed} de ${job!.total} item(ns) falharam`, { hint: job?.items.find((i) => i.error)?.error })
    else toast.success(jobDryRun ? 'Simulação concluída' : `${job!.total} cópia(s) criadas`, { hint: jobDryRun ? 'Nada foi criado no TikTok.' : 'As cópias chegam pausadas — revise e ative.' })
    onFinished()
  }, [jobDone, job, jobDryRun, onFinished])

  const error = useMemo(() => {
    if (!(n >= 1 && n <= maxCount)) return `Número de ${mode === 'variations' ? 'variações' : 'cópias'} deve ser entre 1 e ${maxCount}`
    if (mode === 'variations' && varBudget && !(parseFloat(varBudget) >= 50)) return 'Orçamento por variação deve ser no mínimo 50 (regra do TikTok)'
    return null
  }, [n, maxCount, mode, varBudget])

  async function reviewDuplication() {
    if (error) return
    setReviewing(true); setPreflightError(null)
    try {
      const preview = await apiSend<Preflight>('/api/ads/duplicate/preflight', 'POST', { sourceId: campaign.platformCampaignId, sourceAdAccountId: currentAdvertiserId })
      setPreflight(preview)
    } catch (e) {
      setPreflight(null)
      setPreflightError(e instanceof Error ? e.message : 'Não foi possível revisar a duplicação.')
    } finally { setReviewing(false) }
  }

  async function createDuplication() {
    if (!preflight || error) return
    setSubmitting(true)
    try {
      if (!idempotencyKeyRef.current) {
        const nonce = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
        idempotencyKeyRef.current = `duplicate:${campaign.platformCampaignId}:${currentAdvertiserId}:${mode}:${nonce}`
      }
      const body: Record<string, unknown> = {
        sourceType: 'campaign', idempotencyKey: idempotencyKeyRef.current, sourceId: campaign.platformCampaignId,
        sourceAdAccountId: currentAdvertiserId, targetAdAccountId: currentAdvertiserId, nameSuffix: suffix,
      }
      if (mode === 'variations') {
        const budget = parseFloat(varBudget)
        body.variations = Array.from({ length: n }, (_, i) => ({
          name: `${srcName}${suffix} ${i + 1}`.slice(0, 512),
          ...(budget > 0 ? { budgetAmount: budget } : {}),
          ...(varText.trim() ? { adText: varText.trim() } : {}),
        }))
      } else body.count = n
      const res = await apiSend<AdsBulkStartResponse>('/api/ads/duplicate', 'POST', body)
      setJobDryRun(Boolean(res.dryRun)); setJobId(res.jobId)
    } catch (e) {
      toast.error('Falha ao enfileirar a duplicação', { hint: e instanceof Error ? e.message : undefined })
    } finally { setSubmitting(false) }
  }

  const progressPct = job && job.total > 0 ? Math.round(((job.done + job.failed) / job.total) * 100) : 0
  const firstNames = Array.from({ length: Math.min(n || 1, 2) }, (_, i) => `${srcName}${suffix}${mode === 'variations' || n > 1 ? ` ${i + 1}` : ''}`)

  if (jobId) return <div className="flex flex-col gap-4">
    <div className="flex items-center justify-between text-xs"><span className="font-medium text-foreground">{jobDone ? (jobDryRun ? 'Simulação concluída' : 'Duplicação concluída') : (jobDryRun ? 'Simulando duplicação' : 'Duplicando campanhas')}</span><span className="text-muted-foreground">{(job?.done ?? 0) + (job?.failed ?? 0)} de {job?.total ?? n}</span></div>
    <div className="h-1.5 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-valuenow={progressPct} aria-valuemin={0} aria-valuemax={100}><div className={`h-full rounded-full ${(job?.failed ?? 0) > 0 ? 'bg-warning' : 'bg-primary'}`} style={{ width: `${progressPct}%` }} /></div>
    {job?.queue?.paused && <div className="border-y border-warning/30 py-3"><p className="text-sm font-medium text-warning">Fila temporariamente pausada pelo TikTok</p><p className="mt-1 text-xs text-muted-foreground">{job.queue.pausedUntil ? `Retomada automática às ${when(job.queue.pausedUntil)}.` : 'A fila retomará automaticamente quando o TikTok liberar novas requisições.'}</p></div>}
    <ul className="max-h-56 divide-y divide-border/50 overflow-y-auto border-y border-border/60">{(job?.items ?? []).map((it) => {
      const label = it.status === 'done' ? (jobDryRun ? 'Simulada' : 'Criada') : it.status === 'failed' ? 'Falhou' : it.status === 'running' ? (jobDryRun ? 'Simulando' : 'Duplicando') : 'Na fila'
      return <li key={it.idx} className="flex items-start gap-3 py-3 text-xs">{it.status === 'done' ? <CheckCircle2 className="mt-0.5 size-4 text-success" /> : it.status === 'failed' ? <XCircle className="mt-0.5 size-4 text-error" /> : it.status === 'running' ? <Loader2 className="mt-0.5 size-4 animate-spin text-primary" /> : <Clock className="mt-0.5 size-4 text-muted-foreground" />}<div className="min-w-0 flex-1"><p className="truncate font-medium text-foreground">{it.ref}</p><p className="mt-1 text-muted-foreground">{label}{(it.attempts ?? 0) > 1 ? ` · ${it.attempts} tentativas` : ''}{it.retryAt ? ` · nova tentativa às ${when(it.retryAt)}` : ''}</p>{it.error && <p className="mt-1 text-error">{it.error}</p>}</div></li>
    })}</ul>
    {!jobDone && <p className="text-xs leading-relaxed text-muted-foreground">Fechar esta janela não cancela a duplicação. A fila continua no servidor.</p>}
    <div className="flex justify-end">{onClose ? <button type="button" className="btn-primary min-h-10 text-xs" onClick={onClose}>{jobDone ? 'Fechar' : 'Continuar em segundo plano'}</button> : jobDone ? <button type="button" className="btn-primary min-h-10 text-xs" onClick={() => { idempotencyKeyRef.current = ''; setJobId(null); setPreflight(null) }}>Nova duplicação</button> : null}</div>
  </div>

  return <div className="flex flex-col gap-5">
    <div className="border-b border-border/60 pb-3"><p className="text-xs text-muted-foreground">Origem</p><p className="mt-1 truncate text-sm font-medium text-foreground">{srcName}</p></div>

    <div className="flex gap-5 border-b border-border/60" role="tablist" aria-label="Modo de duplicação">{([['copy','Cópias exatas'],['variations','Variações']] as const).map(([value,label]) => <button key={value} type="button" role="tab" aria-selected={mode === value} className={`border-b-2 pb-2 text-sm font-medium ${mode === value ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'}`} onClick={() => { setMode(value); setCount('1'); setSuffix(value === 'copy' ? ' (cópia)' : ' (variação)') }}>{label}</button>)}</div>
    <p className="-mt-3 text-xs leading-relaxed text-muted-foreground">{mode === 'copy' ? 'Replica campanha, conjuntos e anúncios mantendo a estrutura original.' : 'Replica a estrutura e permite alterar orçamento e texto em cada nova campanha.'}</p>

    <div className="rounded-xl border border-border/70 bg-secondary/10 p-3"><p className="text-xs font-medium text-foreground">Conta</p><p className="mt-1 text-sm text-foreground">{currentAdvertiser?.name || currentAdvertiserId}</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">A duplicação permanece nesta conta. Criativos do TikTok não podem ser transferidos diretamente entre contas neste fluxo.</p></div>

    <div className="grid gap-3 sm:grid-cols-2">
      <label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-foreground">{mode === 'variations' ? 'Número de variações' : 'Número de cópias'}</span><input type="number" min={1} max={maxCount} className="input-base min-h-10 rounded-lg border border-border bg-background px-3 text-sm" value={count} onChange={(e) => setCount(e.target.value)} /><span className="text-xs text-muted-foreground">1 a {maxCount}</span></label>
      <label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-foreground">Sufixo do nome</span><input className="input-base min-h-10 rounded-lg border border-border bg-background px-3 text-sm" value={suffix} maxLength={60} onChange={(e) => setSuffix(e.target.value)} placeholder=" (cópia)" /></label>
    </div>

    <div className="rounded-xl border border-border/70 bg-secondary/10 p-3"><p className="text-xs font-medium text-foreground">Preview dos nomes</p>{firstNames.map((name) => <p key={name} className="mt-1 truncate text-xs text-muted-foreground">{name}</p>)}{n > 2 && <p className="mt-1 text-xs text-muted-foreground">… +{n - 2} nomes</p>}</div>

    {mode === 'variations' && <div className="grid gap-3 sm:grid-cols-2">
      <label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-foreground">Orçamento por variação — opcional</span><input type="number" min={50} step="0.01" className="input-base min-h-10 rounded-lg border border-border bg-background px-3 text-sm" value={varBudget} onChange={(e) => setVarBudget(e.target.value)} placeholder="Mantém o original" /><span className="text-xs text-muted-foreground">Se vazio, mantém o orçamento original. Se preenchido, será aplicado a cada variação.</span></label>
      <label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-foreground">Texto do anúncio — opcional</span><input className="input-base min-h-10 rounded-lg border border-border bg-background px-3 text-sm" value={varText} maxLength={100} onChange={(e) => setVarText(e.target.value)} placeholder="Mantém o original" /><span className="text-xs text-muted-foreground">Se vazio, mantém o texto original.</span></label>
    </div>}

    {error && <p className="text-xs font-medium text-error" role="alert">{error}</p>}
    {preflightError && <div className="border-y border-error/30 py-3" role="alert"><p className="text-sm font-medium text-error">Não é possível duplicar esta campanha</p><p className="mt-1 text-xs text-muted-foreground">{preflightError}</p></div>}

    {preflight && <section className="border-y border-border/60 py-4"><h3 className="text-sm font-semibold text-foreground">Compatibilidade</h3><p className="mt-2 text-xs text-muted-foreground">{preflight.campaignKind === 'smart_plus' ? 'Smart+' : preflight.objectiveType === 'PRODUCT_SALES' ? 'Product Sales' : 'Conversão'} · {preflight.budgetOwner === 'campaign' ? 'CBO' : 'ABO'} · {preflight.adGroups} conjuntos · {preflight.ads} anúncios</p>{preflight.warnings?.length ? <div className="mt-3"><p className="text-xs font-medium text-warning">Ajustes necessários</p><ul className="mt-1 space-y-1 text-xs leading-relaxed text-muted-foreground">{preflight.warnings.map((warning) => <li key={warning}>• {warning}</li>)}</ul></div> : <p className="mt-3 flex items-center gap-1.5 text-xs text-success"><span className="size-2 rounded-full bg-success" />Estrutura compatível</p>}<p className="mt-3 text-xs text-muted-foreground">{n} {mode === 'variations' ? 'variação' : 'cópia'}{n === 1 ? '' : mode === 'variations' ? 'ões' : 's'} será{n === 1 ? '' : 'ão'} criada{n === 1 ? '' : 's'} pausada{n === 1 ? '' : 's'}.</p></section>}

    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{onClose && <button type="button" className="btn-ghost min-h-10 text-xs" onClick={onClose} disabled={submitting || reviewing}>Cancelar</button>}{!preflight ? <button type="button" className="btn-primary min-h-10 text-xs" onClick={reviewDuplication} disabled={reviewing || Boolean(error)}>{reviewing && <Loader2 className="size-3.5 animate-spin" />}Revisar duplicação</button> : <button type="button" className="btn-primary min-h-10 text-xs" onClick={createDuplication} disabled={submitting || Boolean(error)}>{submitting && <Loader2 className="size-3.5 animate-spin" />}{preflight.warnings?.length ? `Continuar com os ajustes e criar ${n} ${mode === 'variations' ? 'variação' : 'cópia'}${n === 1 ? '' : mode === 'variations' ? 'ões' : 's'} pausada${n === 1 ? '' : 's'}` : `Criar ${n} ${mode === 'variations' ? 'variação' : 'cópia'}${n === 1 ? '' : mode === 'variations' ? 'ões' : 's'} pausada${n === 1 ? '' : 's'}`}</button>}</div>
  </div>
}
