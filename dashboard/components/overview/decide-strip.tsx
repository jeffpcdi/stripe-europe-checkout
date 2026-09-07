'use client'

// F4 — "O que preciso decidir": faixa na home com as propostas PENDENTES do
// motor de regras (Fase 3, modo proposta). Aprovar/rejeitar inline usa as
// MESMAS rotas da página de Ads (/api/ads/proposals/:id/*) — mesma trilha de
// auditoria, mesmos guards (bloqueio de ações, cap/hora, breaker, re-validação).
// Renderiza null sem propostas: quem não usa regras nunca vê a faixa.

import { Component, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { Check, CircleAlert, Pause, TrendingDown, TrendingUp, X } from 'lucide-react'
import { useAdsProposals, apiSend } from '@/lib/api'
import type { AdsRuleProposal } from '@/lib/types'
import { cleanCampaignName, timeAgo } from '@/lib/format'
import { toast } from '@/lib/toast'
import { SectionTitle } from '@/components/section-title'

// Boundary próprio (exigência do plano): se a faixa quebrar, o globo e o
// resto da home continuam de pé. Sem fallback visual — decisão falha em
// silêncio na home (a página de Ads continua sendo o caminho completo).
class StripBoundary extends Component<{ children: ReactNode }, { broken: boolean }> {
  state = { broken: false }
  static getDerivedStateFromError() {
    return { broken: true }
  }
  componentDidCatch(error: Error) {
    console.error('[decide-strip]', error)
  }
  render() {
    return this.state.broken ? null : this.props.children
  }
}

const ACTION_META: Record<string, { label: string; Icon: typeof Pause }> = {
  pause: { label: 'Pausar', Icon: Pause },
  budget_up: { label: 'Aumentar orçamento', Icon: TrendingUp },
  budget_down: { label: 'Reduzir orçamento', Icon: TrendingDown },
}

function ProposalRow({
  p,
  onDecided,
}: {
  p: AdsRuleProposal
  onDecided: () => void
}) {
  // 'approve' | 'reject' em voo — trava os DOIS botões (dupla decisão é o
  // bug clássico aqui; o servidor também protege com transição atômica).
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null)
  const meta = ACTION_META[p.action] ?? { label: p.action, Icon: CircleAlert }

  async function decide(kind: 'approve' | 'reject') {
    if (busy) return
    setBusy(kind)
    try {
      const r = await apiSend<{ ok?: boolean; result?: string }>(
        `/api/ads/proposals/${p.id}/${kind}`,
        'POST',
      )
      toast.success(
        kind === 'approve'
          ? r.result || 'Proposta aprovada e executada'
          : 'Proposta rejeitada',
      )
      onDecided()
    } catch (e) {
      // 409 = expirada/estado mudou/guard ativo — a mensagem do servidor já
      // explica (ex.: "Orçamento mudou desde a proposta"). Refetch para o
      // status real aparecer em vez de um botão que "não funciona".
      toast.error('Não foi possível decidir', {
        hint: e instanceof Error ? e.message : undefined,
      })
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
            {p.detail || p.metric} · proposta {timeAgo(p.created_at)}
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

function DecideStripInner({ active }: { active: boolean }) {
  const { data, mutate } = useAdsProposals(active)
  const pending = data?.items ?? []
  // Sem propostas = sem faixa. Nada de card vazio ocupando a home.
  if (pending.length === 0) return null

  return (
    <div className="hero-glass-panel border-l-2 border-l-warning p-5">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <SectionTitle>O que preciso decidir</SectionTitle>
        <Link
          href="/ads/tiktok?tab=automation"
          className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          ver automações →
        </Link>
      </div>
      <p className="mb-1 text-[11px] leading-relaxed text-muted-foreground">
        O motor de regras sugere {pending.length === 1 ? 'esta ação' : 'estas ações'} — nada
        é executado sem a sua aprovação. Propostas expiram em 6h.
      </p>
      <ul className="flex flex-col divide-y divide-border/60">
        {pending.slice(0, 5).map((p) => (
          <ProposalRow key={p.id} p={p} onDecided={() => mutate()} />
        ))}
      </ul>
      {pending.length > 5 ? (
        <p className="pt-2 text-[11px] text-muted-foreground">
          + {pending.length - 5} outras na página de automações
        </p>
      ) : null}
    </div>
  )
}

export function DecideStrip({ active }: { active: boolean }) {
  return (
    <StripBoundary>
      <DecideStripInner active={active} />
    </StripBoundary>
  )
}
