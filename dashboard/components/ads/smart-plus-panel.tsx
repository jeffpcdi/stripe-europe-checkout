'use client'

// Aba Smart+ — campanhas automatizadas do TikTok (IA cuida de targeting, lance,
// orçamento e criativo). Aqui o gestor VÊ e OPERA as campanhas Smart+ sem entrar
// no Ads Manager: pausar/ativar, e RECORRER de anúncios reprovados (o único
// appeal com API é o de anúncio Smart+). Conta suspensa não tem API de recurso.

import { useMemo, useState } from 'react'
import {
  Sparkles, Loader2, Play, Pause, ShieldQuestion, RefreshCw, AlertCircle, Info, Plus,
} from 'lucide-react'
import { useAdsSmartPlus, useAdsSmartPlusAds, apiSend } from '@/lib/api'
import { toast } from '@/lib/toast'
import { fmtSpend } from '@/lib/format'
import type { SmartPlusAd } from '@/lib/types'
import { GlassCard } from '@/components/glass-card'
import { Skeleton } from '@/components/skeleton'
import { ErrorState } from '@/components/error-state'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { SmartPlusCreateDialog } from './smart-plus-create-dialog'

const OBJECTIVE_LABEL: Record<string, string> = {
  WEB_CONVERSIONS: 'Conversões no site',
  TRAFFIC: 'Tráfego',
  REACH: 'Alcance',
  VIDEO_VIEWS: 'Visualizações',
  ENGAGEMENT: 'Engajamento',
  LEAD_GENERATION: 'Geração de leads',
  APP_PROMOTION: 'Promoção de app',
  BRAND_CONSIDERATION: 'Consideração de marca',
}

const STATUS_META: Record<string, { label: string; cls: string; dot: string }> = {
  active: { label: 'Ativa', cls: 'text-success', dot: 'bg-[color:var(--success)]' },
  paused: { label: 'Pausada', cls: 'text-muted-foreground', dot: 'bg-muted-foreground' },
  pending_review: { label: 'Em revisão', cls: 'text-warning', dot: 'bg-[color:var(--warning)]' },
  rejected: { label: 'Reprovada', cls: 'text-error', dot: 'bg-[color:var(--error)]' },
}

export function SmartPlusPanel({
  active,
  adAccountId,
  currency,
}: {
  active: boolean
  adAccountId: string
  currency: string
}) {
  const { data, mutate, isLoading, error } = useAdsSmartPlus(active, adAccountId)
  const { data: adsData, mutate: mutateAds } = useAdsSmartPlusAds(active, adAccountId)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [appealTarget, setAppealTarget] = useState<SmartPlusAd | null>(null)
  const [appealReason, setAppealReason] = useState('')
  const [appealBusy, setAppealBusy] = useState(false)

  const campaigns = data?.campaigns ?? []
  const rejectedAds = useMemo(() => (adsData?.ads ?? []).filter((a) => a.rejected), [adsData])

  async function setStatus(campaignId: string, status: 'active' | 'paused') {
    setBusyId(campaignId)
    try {
      const res = await apiSend<{ dryRun?: boolean }>(
        `/api/ads/smart-plus/${encodeURIComponent(campaignId)}/status`, 'POST',
        { status, adAccountId },
      )
      if (res.dryRun) toast.info('Modo simulação: nada foi alterado no TikTok')
      else toast.success(status === 'active' ? 'Campanha Smart+ ativada' : 'Campanha Smart+ pausada')
      mutate()
    } catch (e) {
      toast.error('Falha ao alterar status', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setBusyId(null)
    }
  }

  async function submitAppeal() {
    if (!appealTarget) return
    setAppealBusy(true)
    try {
      const res = await apiSend<{ dryRun?: boolean }>(
        `/api/ads/smart-plus/ads/${encodeURIComponent(appealTarget.adId)}/appeal`, 'POST',
        { reason: appealReason.trim(), adAccountId },
      )
      if (res.dryRun) toast.info('Modo simulação: recurso não enviado ao TikTok')
      else toast.success('Recurso enviado ao TikTok', { hint: 'A revisão pode levar algumas horas.' })
      setAppealTarget(null)
      setAppealReason('')
      mutateAds()
    } catch (e) {
      toast.error('Falha ao enviar recurso', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setAppealBusy(false)
    }
  }

  if (error && !data) {
    return <ErrorState title="Falha ao carregar campanhas Smart+" onRetry={() => mutate()} />
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Recurso de anúncios reprovados — só aparece quando há o que recorrer */}
      {rejectedAds.length > 0 && (
        <GlassCard className="flex flex-col gap-3 border-error/30 bg-error/5 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <ShieldQuestion className="size-4 text-error" aria-hidden="true" />
            {rejectedAds.length} anúncio{rejectedAds.length === 1 ? '' : 's'} Smart+ reprovado{rejectedAds.length === 1 ? '' : 's'}
          </p>
          <ul className="flex flex-col gap-2">
            {rejectedAds.map((ad) => (
              <li key={ad.adId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-foreground">{ad.name}</p>
                  {ad.rejectionReason && (
                    <p className="truncate text-[11px] text-error" title={ad.rejectionReason}>{ad.rejectionReason}</p>
                  )}
                </div>
                <button type="button" className="btn-ghost shrink-0 text-xs" onClick={() => { setAppealTarget(ad); setAppealReason('') }}>
                  <ShieldQuestion className="size-3.5" aria-hidden="true" />
                  Recorrer
                </button>
              </li>
            ))}
          </ul>
        </GlassCard>
      )}

      <GlassCard className="flex flex-col gap-4 p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Sparkles className="size-4 text-primary" aria-hidden="true" />
            Campanhas Smart+
          </h2>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-ghost text-xs" onClick={() => { mutate(); mutateAds() }}>
              <RefreshCw className="size-3.5" aria-hidden="true" />
              Atualizar
            </button>
            <button
              type="button"
              className="btn-primary text-xs"
              onClick={() => { if (!adAccountId) { toast.info('Selecione uma conta de anúncio primeiro.'); return } setCreateOpen(true) }}
            >
              <Plus className="size-3.5" aria-hidden="true" />
              Nova Smart+
            </button>
          </div>
        </div>

        {isLoading && !data ? (
          <div className="flex flex-col gap-2">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 rounded-xl" />)}
          </div>
        ) : campaigns.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-background p-8 text-center">
            <Sparkles className="size-6 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm font-medium text-foreground">Nenhuma campanha Smart+</p>
            <p className="max-w-md text-pretty text-xs text-muted-foreground">
              Smart+ é o tipo de campanha em que o TikTok automatiza targeting, lance, orçamento e criativo.
              Clique em <strong className="text-foreground">Nova Smart+</strong> para criar uma direto por aqui —
              e depois pause, escale e recorra de anúncios reprovados sem entrar no Ads Manager.
            </p>
            <button type="button" className="btn-primary mt-1 text-xs" onClick={() => setCreateOpen(true)}>
              <Plus className="size-3.5" aria-hidden="true" />
              Nova campanha Smart+
            </button>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {campaigns.map((c) => {
              const meta = STATUS_META[c.status] ?? { label: c.status, cls: 'text-muted-foreground', dot: 'bg-muted-foreground' }
              const busy = busyId === c.campaignId
              return (
                <li key={c.campaignId} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground" title={c.name}>{c.name}</p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span className={`size-1.5 rounded-full ${meta.dot}`} aria-hidden="true" />
                      <span className={meta.cls}>{meta.label}</span>
                      <span>· {OBJECTIVE_LABEL[c.objective] || c.objective || '—'}</span>
                      {c.budget > 0 && <span>· {fmtSpend(c.budget, currency)}{c.budgetMode?.includes('DAY') ? '/dia' : ''}</span>}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {busy ? (
                      <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />
                    ) : c.status === 'active' ? (
                      <button type="button" className="btn-ghost text-xs" onClick={() => setStatus(c.campaignId, 'paused')}>
                        <Pause className="size-3.5" aria-hidden="true" /> Pausar
                      </button>
                    ) : (
                      <button type="button" className="btn-ghost text-xs" onClick={() => setStatus(c.campaignId, 'active')}>
                        <Play className="size-3.5" aria-hidden="true" /> Ativar
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        <p className="flex items-start gap-2 rounded-lg bg-secondary/60 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden="true" />
          As campanhas Smart+ nascem pausadas — nada veicula até você revisar e ativar. O TikTok cuida de
          targeting, lance, orçamento e criativo; você só define objetivo, orçamento e o vídeo.
        </p>
      </GlassCard>

      {/* Diálogo de recurso */}
      <ConfirmDialog
        open={Boolean(appealTarget)}
        title="Recorrer da reprovação do anúncio?"
        description={
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">
              Envia um recurso ao TikTok para revisar a reprovação de{' '}
              <strong className="text-foreground">{appealTarget?.name}</strong>. Use quando acreditar que foi
              engano e tiver como justificar.
            </p>
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium text-foreground">Motivo (opcional)</span>
              <textarea
                className="input-base min-h-16 resize-y"
                value={appealReason}
                onChange={(e) => setAppealReason(e.target.value)}
                placeholder="Ex.: o criativo cumpre as políticas; a landing page corresponde ao anúncio."
                maxLength={500}
              />
            </label>
          </div>
        }
        confirmLabel="Enviar recurso"
        busy={appealBusy}
        onConfirm={submitAppeal}
        onClose={() => { setAppealTarget(null); setAppealReason('') }}
      />

      {!isLoading && campaigns.length > 0 && rejectedAds.length === 0 && (
        <p className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
          <AlertCircle className="size-3" aria-hidden="true" />
          Nenhum anúncio Smart+ reprovado no momento.
        </p>
      )}

      <SmartPlusCreateDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        advertiserId={adAccountId}
        currency={currency}
        onCreated={() => { mutate(); mutateAds() }}
      />
    </div>
  )
}
