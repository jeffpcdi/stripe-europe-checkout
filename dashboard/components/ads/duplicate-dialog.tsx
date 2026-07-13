'use client'

// Duplicação de campanha — 1 a 10 cópias, na MESMA conta (endpoint nativo de
// duplicate da Zernio) ou em OUTRA conta do BC (o backend reconstrói via
// /ads/create). Tudo passa pela mesma fila do bulk: a UI acompanha o
// progresso aqui dentro (polling que para sozinho ao concluir).

import { useEffect, useMemo, useRef, useState } from 'react'
import { X, Copy, Loader2, CheckCircle2, XCircle, Clock } from 'lucide-react'
import { apiSend, useAdsBulkJob } from '@/lib/api'
import { toast } from '@/lib/toast'
import type { AdsTreeCampaign, AdsAdvertiser, AdsBulkStartResponse } from '@/lib/types'
import { GlassCard } from '@/components/glass-card'
import { useModalA11y } from '@/lib/use-modal-a11y'

export function DuplicateDialog({
  campaign,
  onClose,
  advertisers,
  currentAdvertiserId,
  onFinished,
}: {
  campaign: AdsTreeCampaign | null
  onClose: () => void
  advertisers: AdsAdvertiser[]
  currentAdvertiserId: string
  onFinished: () => void
}) {
  const open = Boolean(campaign)
  const ref = useRef<HTMLDivElement>(null)
  const [count, setCount] = useState('1')
  const [target, setTarget] = useState('')
  const [suffix, setSuffix] = useState(' (cópia)')
  const [submitting, setSubmitting] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const notifiedRef = useRef(false)

  const { data: job } = useAdsBulkJob(jobId)
  const jobDone = job?.status === 'done'

  useModalA11y(open, ref, submitting ? () => {} : onClose)

  useEffect(() => {
    if (open) {
      setCount('1')
      setTarget(currentAdvertiserId)
      setSuffix(' (cópia)')
      setJobId(null)
      notifiedRef.current = false
    }
  }, [open, currentAdvertiserId])

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

  const error: string | null = useMemo(() => {
    const n = parseInt(count, 10)
    if (!(n >= 1 && n <= 10)) return 'Número de cópias deve ser entre 1 e 10'
    if (!target) return 'Selecione a conta destino'
    return null
  }, [count, target])

  async function handleSubmit() {
    if (!campaign) return
    setSubmitting(true)
    try {
      const idempotencyKey = `duplicate:${campaign.platformCampaignId}:${target}:${count}:${Date.now()}`
      const res = await apiSend<AdsBulkStartResponse>('/api/ads/duplicate', 'POST', {
        sourceType: 'campaign',
        idempotencyKey,
        sourceId: campaign.platformCampaignId,
        sourceAdAccountId: currentAdvertiserId,
        targetAdAccountId: target,
        count: parseInt(count, 10),
        nameSuffix: suffix,
      })
      setJobId(res.jobId)
    } catch (e) {
      toast.error('Falha ao enfileirar a duplicação', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setSubmitting(false)
    }
  }

  if (!open || !campaign) return null

  const progressPct = job && job.total > 0 ? Math.round(((job.done + job.failed) / job.total) * 100) : 0

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose()
      }}
    >
      <div ref={ref} role="dialog" aria-modal="true" aria-label="Duplicar campanha" tabIndex={-1} className="w-full max-w-md outline-none">
        <GlassCard className="anim-pop-in flex flex-col gap-4 p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Copy className="size-4 text-primary" aria-hidden="true" />
              Duplicar campanha
            </h2>
            <button type="button" className="btn-ghost px-2 py-1" onClick={onClose} disabled={submitting} aria-label="Fechar">
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>

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
                <button type="button" className="btn-primary text-xs" onClick={onClose}>
                  {jobDone ? 'Fechar' : 'Continuar em segundo plano'}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-foreground">Número de cópias</span>
                  <input
                    type="number"
                    min={1}
                    max={10}
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
                  Duplicar para outra conta RECRIA a campanha (o TikTok não copia entre contas): o vídeo, textos e
                  segmentação são reaproveitados, mas o histórico de aprendizado não migra. Orçamento lifetime vira
                  diário. A cópia chega pausada.
                </p>
              )}
              {!crossAccount && (
                <p className="rounded-lg bg-secondary/60 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                  Cópia completa (campanha → grupos → anúncios) na mesma conta. As cópias chegam pausadas — revise e
                  ative.
                </p>
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
        </GlassCard>
      </div>
    </div>
  )
}
