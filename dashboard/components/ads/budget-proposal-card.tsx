'use client'

/**
 * Realocação inteligente de orçamento — proposta DETERMINÍSTICA calculada no
 * servidor a partir do ROAS real (vendas dos gateways via atribuição local);
 * a IA entra só para justificar em linguagem natural.
 *
 * Guardas aplicadas no backend (não confiamos na UI): mín. 2 vendas por
 * campanha, mudança máx. ±30%, total proposto nunca excede o total atual.
 * Cada mudança vira uma ação 'budget' individual executada via
 * /copilot/execute — o mesmo caminho auditado do copiloto.
 */

import { useState } from 'react'
import { useAdsBudgetProposal, apiSend } from '@/lib/api'
import type { AdsBudgetProposal } from '@/lib/types'
import { GlassCard } from '@/components/glass-card'
import { fmtSpend } from '@/lib/format'

type ApplyState = 'idle' | 'applying' | 'done' | 'error'

export function BudgetProposalCard({
  adAccountId,
  currency,
  onApplied,
}: {
  adAccountId: string
  currency: string
  onApplied?: () => void
}) {
  const [open, setOpen] = useState(false)
  const { data, error, mutate, isValidating } = useAdsBudgetProposal(open, adAccountId, currency)
  const [applyState, setApplyState] = useState<ApplyState>('idle')
  const [applyMsg, setApplyMsg] = useState<string | null>(null)

  const aiOff = error != null && /não configurada|AI_NOT_CONFIGURED/i.test(String(error.message ?? error))
  if (aiOff) return null

  async function applyAll(proposal: AdsBudgetProposal) {
    if (!proposal.actions?.length) return
    setApplyState('applying')
    setApplyMsg(null)
    let ok = 0
    const failures: string[] = []
    // sequencial de propósito: 1 chamada Pipeboard por vez, sem rajada
    for (const action of proposal.actions) {
      try {
        await apiSend('/api/ads/copilot/execute', 'POST', { action, adAccountId })
        ok++
      } catch (err) {
        failures.push(err instanceof Error ? err.message : 'erro')
      }
    }
    if (failures.length === 0) {
      setApplyState('done')
      setApplyMsg(`${ok} orçamento(s) atualizado(s)`)
      onApplied?.()
      await mutate()
    } else {
      setApplyState('error')
      setApplyMsg(`${ok} ok, ${failures.length} falha(s): ${failures[0]}`)
    }
  }

  return (
    <GlassCard className="p-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          <p className="label-mono">Realocação de orçamento (IA)</p>
          <span className="text-[10px] text-muted-foreground">{open ? '▾' : '▸'}</span>
        </div>
        {open && isValidating && <span className="text-[10px] text-muted-foreground">calculando…</span>}
      </button>

      {open && (
        <div className="mt-3">
          {!data && !error && <p className="text-xs text-muted-foreground">Calculando proposta…</p>}
          {error && !aiOff && (
            <p className="text-xs text-red-400">Falha: {String(error.message ?? error)}</p>
          )}

          {data?.insufficient && (
            <p className="text-xs text-muted-foreground">
              {data.message ??
                'Dados insuficientes: preciso de pelo menos 2 campanhas ativas com orçamento e vendas atribuídas (7d).'}
            </p>
          )}

          {data?.noChange && (
            <p className="text-xs text-muted-foreground">
              {data.message ?? 'A distribuição atual já está alinhada com o ROAS — nenhuma mudança recomendada.'}
            </p>
          )}

          {data && !data.insufficient && !data.noChange && data.changes && (
            <div className="flex flex-col gap-3">
              {data.rationale && (
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground/90">
                  {data.rationale}
                </p>
              )}

              <div className="overflow-x-auto">
                <table className="w-full min-w-[420px] text-left">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="pb-1.5 pr-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        Campanha
                      </th>
                      <th className="pb-1.5 pr-2 text-right text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        ROAS 7d
                      </th>
                      <th className="pb-1.5 pr-2 text-right text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        Atual
                      </th>
                      <th className="pb-1.5 pr-2 text-right text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        Proposto
                      </th>
                      <th className="pb-1.5 text-right text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        Δ
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.changes.map((c) => {
                      const up = c.deltaPct > 0
                      return (
                        <tr key={c.campaignId} className="border-b border-border/40">
                          <td className="max-w-[180px] truncate py-1.5 pr-2 text-xs text-foreground" title={c.name}>
                            {c.name}
                          </td>
                          <td className="py-1.5 pr-2 text-right text-xs tabular-nums text-muted-foreground">
                            {c.roas == null ? '—' : `${c.roas.toFixed(2)}x`}
                            <span className="text-[10px]"> ({c.sales}v)</span>
                          </td>
                          <td className="py-1.5 pr-2 text-right text-xs tabular-nums text-muted-foreground">
                            {fmtSpend(c.current, data.currency ?? currency)}
                          </td>
                          <td className="py-1.5 pr-2 text-right text-xs font-medium tabular-nums text-foreground">
                            {fmtSpend(c.proposed, data.currency ?? currency)}
                          </td>
                          <td
                            className={
                              'py-1.5 text-right text-xs font-medium tabular-nums ' +
                              (up ? 'text-emerald-400' : 'text-red-400')
                            }
                          >
                            {up ? '+' : ''}
                            {c.deltaPct}%
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {data.excluded && data.excluded.length > 0 && (
                <p className="text-[10px] text-muted-foreground">
                  Fora da proposta: {data.excluded.map((e) => `${e.name} (${e.reason})`).join(' · ')}
                </p>
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => applyAll(data)}
                  disabled={applyState === 'applying' || applyState === 'done'}
                  className="rounded-lg bg-primary px-3 py-1.5 text-[11px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {applyState === 'applying'
                    ? 'Aplicando…'
                    : applyState === 'done'
                      ? 'Aplicado'
                      : `Aplicar ${data.changes.length} mudança(s)`}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setApplyState('idle')
                    setApplyMsg(null)
                    mutate()
                  }}
                  disabled={applyState === 'applying'}
                  className="rounded-lg border border-border bg-secondary px-3 py-1.5 text-[11px] font-medium text-secondary-foreground transition-colors hover:bg-secondary/70 disabled:opacity-50"
                >
                  Recalcular
                </button>
                {applyMsg && (
                  <span
                    className={
                      'text-[11px] ' + (applyState === 'error' ? 'text-red-400' : 'text-emerald-400')
                    }
                  >
                    {applyMsg}
                  </span>
                )}
              </div>
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                Guardas: mín. 2 vendas atribuídas, mudança máx. ±30% por campanha, total proposto ≤ total
                atual. Nada é aplicado sem o seu clique.
              </p>
            </div>
          )}
        </div>
      )}
    </GlassCard>
  )
}
