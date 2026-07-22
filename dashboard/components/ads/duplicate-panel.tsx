'use client'

// Corpo reaproveitável do fluxo de duplicação — usado pela aba "Duplicação"
// (tiktok-ads-view) e pelo DuplicateDialog (ação por-campanha no CampaignTree).
// Duplicação de campanha — 1 a 10 cópias, na MESMA conta. Não há tool nativa
// de duplicar no Pipeboard: o backend CAPTURA a origem (campanha → grupos →
// anúncios) e RECRIA tudo, reaproveitando os criativos (video_id) da conta.
// Entre contas não é suportado (video_id é escopado ao advertiser) — a UI
// bloqueia antes de enviar. Tudo passa pela mesma fila durável do bulk: a UI
// acompanha o progresso aqui dentro (polling que para sozinho ao concluir).

import { useEffect, useMemo, useRef, useState } from 'react'
import { Copy, Loader2, CheckCircle2, XCircle, Clock } from 'lucide-react'
import { apiSend, useAdsBulkJob } from '@/lib/api'
import { toast } from '@/lib/toast'
import type { AdsTreeCampaign, AdsAdvertiser, AdsBulkStartResponse } from '@/lib/types'

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
  /** Presente apenas no modo dialog — mostra Cancelar/Fechar. */
  onClose?: () => void
  /** Avisa o host (dialog) quando há submissão em andamento. */
  onBusyChange?: (busy: boolean) => void
}) {
  // 'copy': cópias exatas (1-10). 'variations': até 50 a partir do template,
  // com overrides opcionais de orçamento/texto aplicados a cada variação.
  const [mode, setMode] = useState<'copy' | 'variations'>('copy')
  const [count, setCount] = useState('1')
  const [target, setTarget] = useState(currentAdvertiserId)
  const [suffix, setSuffix] = useState(' (cópia)')
  const [varBudget, setVarBudget] = useState('')
  const [varText, setVarText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const notifiedRef = useRef(false)
  // Permanece estável em timeout/retry. Date.now() em cada clique criava um
  // job novo e podia duplicar a mesma estrutura duas vezes após uma resposta
  // perdida, apesar da fila durável ser idempotente.
  const idempotencyKeyRef = useRef('')

  const { data: job } = useAdsBulkJob(jobId)
  const jobDone = job?.status === 'done'

  // Reset ao trocar a campanha de origem (a aba permite trocar sem desmontar).
  const campaignId = campaign.platformCampaignId
  useEffect(() => {
    setMode('copy')
    setCount('1')
    setTarget(currentAdvertiserId)
    setSuffix(' (cópia)')
    setVarBudget('')
    setVarText('')
    setJobId(null)
    idempotencyKeyRef.current = ''
    notifiedRef.current = false
  }, [campaignId, currentAdvertiserId])

  const materialKey = [campaignId, target, mode, count, suffix, varBudget, varText].join('\u001f')
  useEffect(() => {
    idempotencyKeyRef.current = ''
  }, [materialKey])

  useEffect(() => {
    onBusyChange?.(submitting)
  }, [submitting, onBusyChange])

  useEffect(() => {
    if (jobDone && !notifiedRef.current) {
      notifiedRef.current = true
      if ((job?.failed ?? 0) > 0) {
        toast.error(`${job!.failed} de ${job!.total} cópia(s) falharam`, {
          hint: job?.items.find((i) => i.error)?.error,
        })
      } else {
        toast.success(`${job!.total} cópia(s) criadas`, { hint: 'As cópias chegam pausadas — revise e ative.' })
      }
      onFinished()
    }
  }, [jobDone, job, onFinished])

  const crossAccount = Boolean(target) && target !== currentAdvertiserId

  const maxCount = mode === 'variations' ? 50 : 10

  const error: string | null = useMemo(() => {
    const n = parseInt(count, 10)
    if (!(n >= 1 && n <= maxCount)) return `Número de ${mode === 'variations' ? 'variações' : 'cópias'} deve ser entre 1 e ${maxCount}`
    if (!target) return 'Selecione a conta destino'
    if (crossAccount) return 'Duplicar para outra conta ainda não é suportado — os criativos são escopados à conta de origem no TikTok'
    if (mode === 'variations' && varBudget && !(parseFloat(varBudget) >= 50)) return 'Orçamento por variação deve ser no mínimo 50 (regra do TikTok)'
    return null
  }, [count, target, crossAccount, mode, maxCount, varBudget])

  async function handleSubmit() {
    setSubmitting(true)
    try {
      const n = parseInt(count, 10)
      // Preflight real antes da fila: falhas de objetivo, Pixel, targeting,
      // criativo, identidade ou catálogo aparecem agora e não como item órfão.
      const preview = await apiSend<{ warnings?: string[] }>('/api/ads/duplicate/preflight', 'POST', {
        sourceId: campaign.platformCampaignId,
        sourceAdAccountId: currentAdvertiserId,
      })
      if (preview.warnings?.length) {
        toast.info('Ajustes aplicados à cópia', { hint: preview.warnings.join(' · ') })
      }
      if (!idempotencyKeyRef.current) {
        const nonce = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`
        idempotencyKeyRef.current = `duplicate:${campaign.platformCampaignId}:${target}:${mode}:${nonce}`
      }
      const body: Record<string, unknown> = {
        sourceType: 'campaign',
        idempotencyKey: idempotencyKeyRef.current,
        sourceId: campaign.platformCampaignId,
        sourceAdAccountId: currentAdvertiserId,
        targetAdAccountId: target,
        nameSuffix: suffix,
      }
      if (mode === 'variations') {
        const budget = parseFloat(varBudget)
        const srcName = campaign.campaignName || campaign.platformCampaignId
        body.variations = Array.from({ length: n }, (_, i) => ({
          name: `${srcName}${suffix} ${i + 1}`.slice(0, 512),
          ...(budget > 0 ? { budgetAmount: budget } : {}),
          ...(varText.trim() ? { adText: varText.trim() } : {}),
        }))
      } else {
        body.count = n
      }
      const res = await apiSend<AdsBulkStartResponse>('/api/ads/duplicate', 'POST', body)
      setJobId(res.jobId)
    } catch (e) {
      toast.error('Falha ao enfileirar a duplicação', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setSubmitting(false)
    }
  }

  const progressPct = job && job.total > 0 ? Math.round(((job.done + job.failed) / job.total) * 100) : 0

  return (
    <div className="flex flex-col gap-4">
      <p className="truncate rounded-lg bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">
        Origem: <strong className="text-foreground">{campaign.campaignName || campaign.platformCampaignId}</strong>
      </p>

      {jobId ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-foreground">{jobDone ? 'Duplicação concluída' : 'Duplicando…'}</span>
            <span className="text-muted-foreground">
              {(job?.done ?? 0) + (job?.failed ?? 0)} de {job?.total ?? count}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-valuenow={progressPct} aria-valuemin={0} aria-valuemax={100}>
            <div
              className={`h-full rounded-full transition-all duration-500 ${(job?.failed ?? 0) > 0 ? 'bg-[color:var(--warning,#f59e0b)]' : 'bg-primary'}`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <ul className="flex max-h-48 flex-col gap-1.5 overflow-y-auto" aria-label="Cópias">
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
              </li>
            ))}
          </ul>
          <div className="flex justify-end">
            {onClose ? (
              <button type="button" className="btn-primary text-xs" onClick={onClose}>
                {jobDone ? 'Fechar' : 'Continuar em segundo plano'}
              </button>
            ) : jobDone ? (
              <button type="button" className="btn-primary text-xs" onClick={() => { idempotencyKeyRef.current = ''; setJobId(null) }}>
                Nova duplicação
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <>
          <div className="flex rounded-lg border border-border bg-secondary/40 p-0.5" role="tablist" aria-label="Modo de duplicação">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'copy'}
              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${mode === 'copy' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'}`}
              onClick={() => { setMode('copy'); setCount('1'); setSuffix(' (cópia)') }}
            >
              Cópias exatas
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'variations'}
              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${mode === 'variations' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'}`}
              onClick={() => { setMode('variations'); setSuffix(' (variação)') }}
            >
              Variações (até 50)
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground">{mode === 'variations' ? 'Número de variações' : 'Número de cópias'}</span>
              <input
                type="number"
                min={1}
                max={maxCount}
                className="input-neon w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                value={count}
                onChange={(e) => setCount(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground">Sufixo do nome</span>
              <input
                className="input-neon w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                value={suffix}
                maxLength={60}
                onChange={(e) => setSuffix(e.target.value)}
                placeholder=" (cópia)"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-foreground">Conta destino</span>
            <select
              className="input-neon w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            >
              {advertisers.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name || a.id}
                  {a.id === currentAdvertiserId ? ' (atual)' : ''}
                </option>
              ))}
            </select>
          </label>

          {crossAccount && (
            <p className="rounded-lg bg-warning/10 px-3 py-2 text-[11px] leading-relaxed text-warning">
              Duplicar para OUTRA conta ainda não é suportado: os criativos (vídeos) são escopados à conta de
              origem no TikTok. Use &quot;Vídeos em massa&quot; com o vídeo da biblioteca na conta destino.
            </p>
          )}
          {mode === 'variations' && (
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-foreground">Orçamento por variação (opcional)</span>
                <input
                  type="number"
                  min={50}
                  step="0.01"
                  className="input-neon w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                  value={varBudget}
                  onChange={(e) => setVarBudget(e.target.value)}
                  placeholder="Herda da origem"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-foreground">Texto do anúncio (opcional)</span>
                <input
                  className="input-neon w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                  value={varText}
                  maxLength={100}
                  onChange={(e) => setVarText(e.target.value)}
                  placeholder="Herda da origem"
                />
              </label>
            </div>
          )}

          {!crossAccount && (
            <p className="rounded-lg bg-secondary/60 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
              {mode === 'variations'
                ? 'Cada variação recria a campanha completa a partir do template, com os overrides acima aplicados. O mínimo de orçamento é 50. Tudo chega pausado — revise e ative.'
                : 'Cópia completa (campanha → grupos → anúncios) na mesma conta. Orçamentos antigos abaixo do mínimo atual são ajustados para 50. As cópias chegam pausadas — revise e ative.'}
            </p>
          )}

          {error && (
            <p className="text-[11px] font-medium text-error" role="alert">
              {error}
            </p>
          )}

          <div className="flex items-center justify-end gap-2">
            {onClose && (
              <button type="button" className="btn-ghost text-xs" onClick={onClose} disabled={submitting}>
                Cancelar
              </button>
            )}
            <button type="button" className="btn-primary text-xs" onClick={handleSubmit} disabled={submitting || Boolean(error)}>
              {submitting ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  Enfileirando…
                </>
              ) : (
                <>
                  <Copy className="size-3.5" aria-hidden="true" />
                  Duplicar
                </>
              )}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
