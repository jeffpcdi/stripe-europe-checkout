'use client'

// "Precisa de você" — caixa de entrada unificada de decisões. Generaliza a
// antiga AttentionStrip para viver na aba Hoje: aqui aparece SÓ o que exige
// ação humana — propostas do robô (Aprovar/Rejeitar de 1 toque) + chips de
// alarme (jobs na fila, conta banida, alertas desligados). É o ÚNICO lugar de
// decisão do fluxo padrão (acaba com a aprovação de orçamento triplicada).
// Custo: zero requests novas — todos os hooks já eram pagos pela aba.

import { useState } from 'react'
import {
  Bell, Check, ChevronRight, CircleAlert, ListTodo, Pause, ShieldAlert,
  TrendingDown, TrendingUp, X, Inbox,
} from 'lucide-react'
import { useAdsProposals, useAdsOpsJobs, useAdsHealth, useAdsAlerts, apiSend } from '@/lib/api'
import type { AdsRuleProposal } from '@/lib/types'
import { cleanCampaignName, timeAgo } from '@/lib/format'
import { toast } from '@/lib/toast'
import { GlassCard } from '@/components/glass-card'
import { cn } from '@/lib/utils'

const ACTION_META: Record<string, { label: string; Icon: typeof Pause }> = {
  pause: { label: 'Pausar', Icon: Pause },
  activate: { label: 'Reativar', Icon: TrendingUp },
  budget_up: { label: 'Aumentar orçamento', Icon: TrendingUp },
  budget_down: { label: 'Reduzir orçamento', Icon: TrendingDown },
}

function ProposalRow({ p, onDecided }: { p: AdsRuleProposal; onDecided: () => void }) {
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null)
  const meta = ACTION_META[p.action] ?? { label: p.action, Icon: CircleAlert }

  async function decide(kind: 'approve' | 'reject') {
    if (busy) return
    setBusy(kind)
    try {
      const r = await apiSend<{ ok?: boolean; result?: string }>(`/api/ads/proposals/${p.id}/${kind}`, 'POST')
      toast.success(kind === 'approve' ? r.result || 'Proposta aprovada e executada' : 'Proposta rejeitada')
      onDecided()
    } catch (e) {
      toast.error('Não foi possível decidir', { hint: e instanceof Error ? e.message : undefined })
      onDecided()
    } finally {
      setBusy(null)
    }
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <meta.Icon className="size-4 shrink-0 text-warning" aria-hidden="true" />
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-foreground" title={p.campaign_name || p.campaign_id}>
            {meta.label}: {cleanCampaignName(p.campaign_name || p.campaign_id)}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            {p.detail || p.metric} · sugerida {timeAgo(p.created_at)} · expira em 6h
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          className="btn-ghost gap-1 px-2.5 py-1 text-[11px] text-success hover:bg-success/10 disabled:opacity-50"
          disabled={busy !== null}
          onClick={() => decide('approve')}
        >
          <Check className="size-3.5" aria-hidden="true" />
          {busy === 'approve' ? 'Executando…' : 'Aprovar'}
        </button>
        <button
          type="button"
          className="btn-ghost gap-1 px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-error/10 hover:text-error disabled:opacity-50"
          disabled={busy !== null}
          onClick={() => decide('reject')}
        >
          <X className="size-3.5" aria-hidden="true" />
          Rejeitar
        </button>
      </div>
    </li>
  )
}

function AlarmChip({
  tone, Icon, label, onClick,
}: {
  tone: 'warning' | 'error'
  Icon: typeof Bell
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors',
        tone === 'error'
          ? 'border-error/40 bg-error/10 text-error hover:bg-error/20'
          : 'border-warning/40 bg-warning/10 text-warning hover:bg-warning/20',
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {label}
      <ChevronRight className="size-3" aria-hidden="true" />
    </button>
  )
}

export function NeedsYouInbox({
  active,
  adAccountId,
  onOpenOps,
  onOpenHealth,
  onGoAutomations,
}: {
  active: boolean
  adAccountId: string
  onOpenOps: () => void
  onOpenHealth: () => void
  /** Leva à aba Automações (onde se religa os alertas). */
  onGoAutomations: () => void
}) {
  const { data: proposals, mutate } = useAdsProposals(active, 'pending', adAccountId)
  const { data: jobs } = useAdsOpsJobs(active)
  const { data: health } = useAdsHealth(active)
  const { data: alertsCfg } = useAdsAlerts(active, adAccountId)

  const pending = proposals?.items ?? []
  const activeJobs = (jobs?.jobs ?? []).filter((j) => ['queued', 'running', 'retrying'].includes(j.status)).length
  const banned = (health?.health ?? []).filter((h) => h.status === 'banned').length
  const alertsOff = alertsCfg ? !alertsCfg.enabled : false
  const hasAlarms = activeJobs > 0 || banned > 0 || alertsOff

  return (
    <GlassCard
      className={cn('p-3.5 sm:p-4', pending.length > 0 && 'border-l-4 border-l-warning')}
      data-tour="ads-inbox"
    >
      <div className="relative flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <Inbox className="size-4 text-primary" aria-hidden="true" />
          Precisa de você
        </h3>
        {hasAlarms && (
          <div className="flex flex-wrap items-center gap-1.5">
            {activeJobs > 0 && (
              <AlarmChip tone="warning" Icon={ListTodo} label={activeJobs === 1 ? '1 tarefa na fila' : `${activeJobs} tarefas na fila`} onClick={onOpenOps} />
            )}
            {banned > 0 && (
              <AlarmChip tone="error" Icon={ShieldAlert} label={banned === 1 ? '1 conta banida' : `${banned} contas banidas`} onClick={onOpenHealth} />
            )}
            {alertsOff && (
              <AlarmChip tone="warning" Icon={Bell} label="Alertas desligados" onClick={onGoAutomations} />
            )}
          </div>
        )}
      </div>

      {pending.length === 0 ? (
        <p className="mt-1.5 text-[11px] text-muted-foreground">Tudo em dia. Nenhuma decisão pendente.</p>
      ) : (
        <>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            O robô sugere {pending.length === 1 ? 'esta ação' : 'estas ações'} — nada acontece sem o seu OK.
          </p>
          <ul className="flex flex-col divide-y divide-border/60">
            {pending.map((p) => (
              <ProposalRow key={p.id} p={p} onDecided={() => mutate()} />
            ))}
          </ul>
        </>
      )}
    </GlassCard>
  )
}
