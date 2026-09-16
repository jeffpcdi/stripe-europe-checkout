'use client'

import { useState } from 'react'
import { useSWRConfig } from 'swr'
import { Bell, Check, ChevronRight, CircleAlert, ListTodo, Pause, ShieldAlert, TrendingDown, TrendingUp, X, Inbox } from 'lucide-react'
import { useAdsProposals, useAdsOpsJobs, useAdsHealth, useAdsAlerts, apiSend } from '@/lib/api'
import type { AdsRuleProposal } from '@/lib/types'
import { cleanCampaignName, timeAgo } from '@/lib/format'
import { toast } from '@/lib/toast'
import { GlassCard } from '@/components/glass-card'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { cn } from '@/lib/utils'
import { apiCacheKeyMatches } from '@/lib/cache-consistency'

const ACTION_META: Record<string, { label: string; Icon: typeof Pause }> = {
  pause: { label: 'Pausar', Icon: Pause },
  activate: { label: 'Reativar', Icon: TrendingUp },
  budget_up: { label: 'Aumentar orçamento', Icon: TrendingUp },
  budget_down: { label: 'Reduzir orçamento', Icon: TrendingDown },
}

type InboxAppearance = 'card' | 'embedded' | 'automation'

function money(value: unknown, currency: string) {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n)
}

function proposalImpact(p: AdsRuleProposal, currency: string): string | null {
  const before = p.plan?.beforeState as any
  const after = p.plan?.afterState as any
  if (!before || !after) return null
  if (before.kind === 'status' && after.kind === 'status') {
    const label = (v: unknown) => String(v || '').toLowerCase().includes('active') ? 'Ativa' : String(v || '').toLowerCase().includes('pause') ? 'Pausada' : String(v || '')
    return `${label(before.value)} → ${label(after.value)}`
  }
  if (before.kind === 'budget' && after.kind === 'budget') {
    const a = Array.isArray(before.targets) ? before.targets : []
    const b = Array.isArray(after.targets) ? after.targets : []
    if (a.length === 1 && b.length === 1) {
      const from = money(a[0]?.amount, currency)
      const to = money(b[0]?.amount, currency)
      if (from && to) return `${from}/dia → ${to}/dia`
    }
    if (a.length && b.length) return `${Math.min(a.length, b.length)} ${Math.min(a.length, b.length) === 1 ? 'conjunto será alterado' : 'conjuntos serão alterados'}`
  }
  return null
}

function ProposalRow({ p, onDecided, appearance, currency }: { p: AdsRuleProposal; onDecided: () => void; appearance: InboxAppearance; currency: string }) {
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null)
  const [confirmApprove, setConfirmApprove] = useState(false)
  const meta = ACTION_META[p.action] ?? { label: p.action, Icon: CircleAlert }
  const impact = proposalImpact(p, currency)
  const needsFinancialConfirm = p.action === 'activate' || p.action === 'budget_up'

  async function decide(kind: 'approve' | 'reject') {
    if (busy) return
    setBusy(kind)
    try {
      const r = await apiSend<{ ok?: boolean; result?: string; warning?: string }>(`/api/ads/proposals/${p.id}/${kind}`, 'POST')
      if (r.ok === false) toast.error('A ação não foi concluída', { hint: r.result })
      else if (r.warning) toast.info('Ação enviada. Atualização dos dados pendente.', { hint: r.warning })
      else toast.success(kind === 'approve' ? r.result || 'Proposta aprovada' : 'Proposta rejeitada')
      onDecided()
    } catch (e) {
      toast.error('Não foi possível decidir', { hint: e instanceof Error ? e.message : undefined })
      onDecided()
    } finally {
      setBusy(null)
      setConfirmApprove(false)
    }
  }

  const compact = appearance === 'card'
  return (
    <li className={cn('flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3', compact && 'stagger-fade')}>
      <div className="flex min-w-0 items-start gap-2.5">
        <meta.Icon className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
        <div className="min-w-0">
          <p className={cn('font-medium text-foreground', compact ? 'text-xs' : 'text-sm')} title={p.campaign_name || p.campaign_id}>
            {meta.label} — {cleanCampaignName(p.campaign_name || p.campaign_id)}
          </p>
          {impact ? <p className="mt-1 text-sm font-medium text-foreground/90">{impact}</p> : null}
          <p className={cn('mt-0.5 text-muted-foreground', compact ? 'text-[11px]' : 'text-xs')}>
            {p.detail || p.metric} · sugerida {timeAgo(p.created_at)}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button type="button" className={cn('btn-ghost gap-1 px-2.5 text-success hover:bg-success/10 disabled:opacity-50', compact ? 'py-1 text-[11px]' : 'min-h-10 py-1.5 text-xs')} disabled={busy !== null} onClick={() => needsFinancialConfirm ? setConfirmApprove(true) : void decide('approve')}>
          <Check className="size-3.5" aria-hidden="true" />{busy === 'approve' ? 'Enviando…' : 'Aprovar'}
        </button>
        <button type="button" className={cn('btn-ghost gap-1 px-2.5 text-muted-foreground hover:bg-error/10 hover:text-error disabled:opacity-50', compact ? 'py-1 text-[11px]' : 'min-h-10 py-1.5 text-xs')} disabled={busy !== null} onClick={() => void decide('reject')}>
          <X className="size-3.5" aria-hidden="true" />Rejeitar
        </button>
      </div>
      <ConfirmDialog
        open={confirmApprove}
        title={p.action === 'budget_up' ? 'Aprovar aumento de orçamento?' : 'Aprovar ativação?'}
        description={`${impact ? `${impact}. ` : ''}A alteração será enviada ao TikTok.`}
        confirmLabel="Aprovar"
        appearance="quiet"
        tone="default"
        busy={busy === 'approve'}
        onConfirm={() => void decide('approve')}
        onClose={() => !busy && setConfirmApprove(false)}
      />
    </li>
  )
}

function AlarmAction({ tone, Icon, label, onClick, appearance }: { tone: 'warning' | 'error'; Icon: typeof Bell; label: string; onClick: () => void; appearance: InboxAppearance }) {
  if (appearance === 'embedded' || appearance === 'automation') {
    return <button type="button" onClick={onClick} className={cn('flex min-h-10 w-full items-center justify-between gap-3 border-b border-border/50 py-2.5 text-left text-xs font-medium transition-colors last:border-b-0 hover:text-foreground', tone === 'error' ? 'text-error' : 'text-warning')}><span className="flex items-center gap-2"><Icon className="size-4" aria-hidden="true" />{label}</span><ChevronRight className="size-3.5 text-muted-foreground" aria-hidden="true" /></button>
  }
  return <button type="button" onClick={onClick} className={cn('flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors', tone === 'error' ? 'border-error/40 bg-error/10 text-error hover:bg-error/20' : 'border-warning/40 bg-warning/10 text-warning hover:bg-warning/20')}><Icon className="size-3.5" aria-hidden="true" />{label}<ChevronRight className="size-3" aria-hidden="true" /></button>
}

export function NeedsYouInbox({ active, adAccountId, currency, onOpenOps, onOpenHealth, onOpenAlerts, appearance = 'card', showHealthAlarm = true }: { active: boolean; adAccountId: string; currency: string; onOpenOps: () => void; onOpenHealth: () => void; onOpenAlerts: () => void; appearance?: InboxAppearance; showHealthAlarm?: boolean }) {
  const { data: proposals, mutate, error, isLoading } = useAdsProposals(active, 'pending', adAccountId)
  const { mutate: mutateCache } = useSWRConfig()
  const { data: jobs } = useAdsOpsJobs(active, adAccountId)
  const { data: health } = useAdsHealth(active)
  const { data: alertsCfg } = useAdsAlerts(active, adAccountId)
  const pending = proposals?.items ?? []
  const activeJobs = (jobs?.jobs ?? []).filter((j) => ['queued', 'running', 'retrying'].includes(j.status)).length
  const banned = showHealthAlarm ? (health?.health ?? []).filter((h) => h.status === 'banned').length : 0
  const alertsOff = alertsCfg ? !alertsCfg.enabled : false
  const hasAlarms = activeJobs > 0 || banned > 0 || alertsOff

  async function refreshAfterDecision() {
    await Promise.allSettled([mutate(), mutateCache((key) => apiCacheKeyMatches(key, ['/api/ads/campaign-decisions', '/api/ads/rules', '/api/ads/tree', '/api/ads/kpis', '/api/ads/roas']))])
  }

  if (isLoading && !proposals) return <p className="text-xs text-muted-foreground" role="status">Buscando aprovações…</p>
  if (error) return <button type="button" className="btn-ghost self-start text-xs text-warning" onClick={() => void mutate()}>Não foi possível atualizar as aprovações · tentar novamente</button>
  if (!pending.length && !hasAlarms) return null

  const automation = appearance === 'automation'
  const body = <>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className={cn('text-sm font-semibold text-foreground', appearance === 'card' && 'flex items-center gap-1.5')}>{appearance === 'card' && <Inbox className="size-4 text-primary" aria-hidden="true" />}{appearance === 'embedded' ? 'Aguardando aprovação' : 'Aguardando você'}</h3>
      {appearance === 'card' && hasAlarms ? <div className="flex flex-wrap items-center gap-1.5">{activeJobs > 0 && <AlarmAction appearance="card" tone="warning" Icon={ListTodo} label={activeJobs === 1 ? '1 tarefa na fila' : `${activeJobs} tarefas na fila`} onClick={onOpenOps} />}{banned > 0 && <AlarmAction appearance="card" tone="error" Icon={ShieldAlert} label={banned === 1 ? '1 conta banida' : `${banned} contas banidas`} onClick={onOpenHealth} />}{alertsOff && <AlarmAction appearance="card" tone="warning" Icon={Bell} label="Alertas desligados" onClick={onOpenAlerts} />}</div> : null}
    </div>
    {(appearance === 'embedded' || automation) && hasAlarms ? <div className="mt-2 border-y border-border/50">{activeJobs > 0 && <AlarmAction appearance={appearance} tone="warning" Icon={ListTodo} label={activeJobs === 1 ? '1 tarefa na fila' : `${activeJobs} tarefas na fila`} onClick={onOpenOps} />}{banned > 0 && <AlarmAction appearance={appearance} tone="error" Icon={ShieldAlert} label={banned === 1 ? '1 conta banida' : `${banned} contas banidas`} onClick={onOpenHealth} />}{alertsOff && <AlarmAction appearance={appearance} tone="warning" Icon={Bell} label="Alertas desligados" onClick={onOpenAlerts} />}</div> : null}
    {pending.length === 0 ? (appearance === 'card' ? <p className="mt-1.5 text-[11px] text-muted-foreground">Nenhuma aprovação pendente.</p> : null) : <><p className={cn('mt-1 leading-relaxed text-muted-foreground', appearance === 'card' ? 'text-[11px]' : 'text-xs')}>A automação sugeriu {pending.length === 1 ? 'esta ação' : 'estas ações'}. Nenhuma mudança chega ao TikTok sem a sua aprovação.</p><ul className={cn('flex flex-col divide-y divide-border/60', appearance === 'card' && 'stagger-fade')}>{pending.map((p) => <ProposalRow key={p.id} p={p} appearance={appearance} currency={currency} onDecided={() => void refreshAfterDecision()} />)}</ul></>}
  </>

  if (appearance === 'embedded' || automation) return <section className="border-b border-border/60 pb-4" data-tour="ads-inbox">{body}</section>
  return <GlassCard className={cn('p-3.5 sm:p-4', pending.length > 0 && 'border-l-4 border-l-warning')} data-tour="ads-inbox">{body}</GlassCard>
}
