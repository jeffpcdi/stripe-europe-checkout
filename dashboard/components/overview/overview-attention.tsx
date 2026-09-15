'use client'

import Link from 'next/link'
import {
  ArrowUpRight,
  CheckCircle2,
  CircleAlert,
} from 'lucide-react'
import type { OverviewHealthResponse } from '@/lib/types'

export function OverviewAttention({
  health,
  pendingAutomation = 0,
  loading = false,
}: {
  health?: OverviewHealthResponse | null
  pendingAutomation?: number
  loading?: boolean
}) {
  const healthActions = health?.actions ?? []
  const issueCount = healthActions.length + pendingAutomation
  const critical = healthActions.some((item) => item.severity === 'critical')
  const state = issueCount > 0 ? (critical ? 'critical' : 'warning') : 'healthy'

  if (loading && !health) {
    return (
      <section className="overview-attention overview-attention--loading" aria-busy="true" aria-label="Verificando operação">
        <div className="overview-attention-status" />
        <div className="min-w-0 flex-1">
          <div className="overview-attention-skeleton overview-attention-skeleton--title" />
        </div>
      </section>
    )
  }

  return (
    <section className="overview-attention" data-state={state} aria-label={issueCount > 0 ? 'Pontos que precisam de atenção' : 'Estado da operação'}>
      <div className="overview-attention-summary">
        <span className="overview-attention-status" aria-hidden="true">
          {issueCount > 0 ? <CircleAlert size={17} /> : <CheckCircle2 size={17} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="overview-attention-title-row">
            <h2>{issueCount > 0 ? 'Atenção' : 'Operação estável'}</h2>
            <span>{issueCount > 0 ? `${issueCount} ${issueCount === 1 ? 'ponto' : 'pontos'}` : 'sem pendências'}</span>
          </div>
        </div>
      </div>

      {issueCount > 0 ? (
        <div className="overview-attention-actions">
          {healthActions.slice(0, Math.max(0, 3 - (pendingAutomation > 0 ? 1 : 0))).map((item) => (
            <Link key={item.id} href={item.href} className="overview-attention-action" data-severity={item.severity}>
              <span className="overview-attention-action-dot" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <strong>{item.title}</strong>
                <small>{item.detail}</small>
              </span>
              <ArrowUpRight size={14} aria-hidden="true" />
            </Link>
          ))}
          {pendingAutomation > 0 ? (
            <Link href="/ads/tiktok?tab=automation" className="overview-attention-action" data-severity="warning">
              <span className="overview-attention-action-dot" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <strong>{pendingAutomation} {pendingAutomation === 1 ? 'ação aguardando decisão' : 'ações aguardando decisão'}</strong>
                <small>Revise as propostas pendentes.</small>
              </span>
              <ArrowUpRight size={14} aria-hidden="true" />
            </Link>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
