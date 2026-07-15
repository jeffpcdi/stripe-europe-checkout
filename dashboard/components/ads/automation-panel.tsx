'use client'

// Painel INLINE da aba Automações — o coração da reestruturação: as regras
// pré-geradas ficam visíveis de cara com toggle de 1 clique, em vez de
// enterradas atrás de um botão num diálogo. A edição fina (thresholds,
// dayparting) continua no AutomationDialog; alertas no AlertsDialog.

import { useState } from 'react'
import { Bell, ClipboardList, Pause, Play, Settings2, Sparkles } from 'lucide-react'
import { useAdsRules, useAdsAlerts, apiSend } from '@/lib/api'
import { toast } from '@/lib/toast'
import type { AdsRule, AdsRuleMetric, AdsRulesResponse } from '@/lib/types'
import { GlassCard } from '@/components/glass-card'
import { Skeleton } from '@/components/skeleton'
import { cn } from '@/lib/utils'

// Mesmos rótulos técnicos do automation-dialog — fallback p/ regras sem nome.
const METRIC_FALLBACK: Record<AdsRuleMetric, string> = {
  cpa_max: 'CPA acima do limite → agir',
  spend_no_conv: 'Gasto sem conversão → agir',
  roas_min: 'ROAS abaixo do mínimo → agir',
  ctr_min: 'CTR abaixo do mínimo → agir',
  cpm_max: 'CPM acima do limite → agir',
  roas_scale: 'ROAS bom → escalar orçamento',
  schedule: 'Dayparting (janela de veiculação)',
}

export function AutomationPanel({
  active,
  onOpenRulesEditor,
  onOpenAlertsEditor,
}: {
  active: boolean
  onOpenRulesEditor: () => void
  onOpenAlertsEditor: () => void
}) {
  const { data, mutate, isLoading } = useAdsRules(active)
  const { data: alertsCfg } = useAdsAlerts(active)
  const [busyId, setBusyId] = useState<string | null>(null)

  const rules = data?.rules ?? []
  const log = (data?.log ?? []).slice(0, 8)
  const enabledCount = rules.filter((r) => r.enabled).length

  // Liga/desliga UMA regra com 1 clique — o PUT manda a lista inteira (o
  // contrato da rota é a lista completa validada no motor).
  async function toggleRule(rule: AdsRule) {
    if (busyId) return
    setBusyId(rule.id)
    const next = rules.map((r) => (r.id === rule.id ? { ...r, enabled: !r.enabled } : r))
    try {
      const r = await apiSend<AdsRulesResponse>('/api/ads/rules', 'PUT', { rules: next })
      mutate(r, { revalidate: false })
      toast.success(
        rule.enabled
          ? `Regra pausada: ${rule.name || METRIC_FALLBACK[rule.metric]}`
          : `Regra ativada: ${rule.name || METRIC_FALLBACK[rule.metric]}`,
      )
    } catch (e) {
      toast.error('Falha ao salvar a regra', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setBusyId(null)
    }
  }

  if (isLoading && !data) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-24 rounded-2xl" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {/* ── Regras: lista com toggle direto ── */}
      <GlassCard className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">Regras automáticas</h3>
            <span className="rounded-full bg-[var(--hover)] px-2 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
              {enabledCount} de {rules.length} ativas
            </span>
          </div>
          <button type="button" className="btn-ghost text-xs" onClick={onOpenRulesEditor}>
            <Settings2 className="size-3.5" aria-hidden="true" />
            Editar regras
          </button>
        </div>

        {rules.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            Nenhuma regra configurada. Abra o editor para adicionar do pacote pronto.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border/60">
            {rules.map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="text-xs font-medium text-foreground">
                      {r.name || METRIC_FALLBACK[r.metric] || r.metric}
                    </p>
                    {r.preset && (
                      <span
                        className="flex items-center gap-1 rounded-full bg-[var(--accent-light)] px-1.5 py-0.5 text-[10px] font-medium text-brand-cyan"
                        title="Regra pré-configurada de fábrica — revise o valor e ative"
                      >
                        <Sparkles className="size-2.5" aria-hidden="true" />
                        Pronta
                      </span>
                    )}
                  </div>
                  {r.description && (
                    <p className="mt-0.5 text-pretty text-[11px] leading-relaxed text-muted-foreground">
                      {r.description}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  disabled={busyId === r.id}
                  onClick={() => toggleRule(r)}
                  className={cn(
                    'flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors',
                    r.enabled
                      ? 'border-success/40 bg-success/10 text-success'
                      : 'border-border bg-[var(--hover)] text-muted-foreground hover:text-sub',
                  )}
                  title={r.enabled ? 'Clique para pausar esta regra' : 'Clique para ativar esta regra'}
                >
                  {r.enabled ? (
                    <>
                      <Play className="size-3" aria-hidden="true" />
                      Ativa
                    </>
                  ) : (
                    <>
                      <Pause className="size-3" aria-hidden="true" />
                      Pausada
                    </>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </GlassCard>

      {/* ── Alertas: resumo + atalho ── */}
      <GlassCard className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-xl bg-[var(--accent-light)] text-brand-cyan">
            <Bell className="size-4.5" aria-hidden="true" />
          </span>
          <div>
            <p className="text-xs font-semibold text-foreground">Alertas de performance</p>
            <p className="text-[11px] text-muted-foreground">
              {alertsCfg?.enabled
                ? `Ligados — avisam com ${alertsCfg.spendNoConv ?? 20}€ gastos sem venda ou CPA acima de ${alertsCfg.cpaMax ?? 15}€ (só notificam, nunca agem)`
                : 'Desligados — você não recebe aviso de campanha queimando dinheiro'}
            </p>
          </div>
        </div>
        <button type="button" className="btn-ghost text-xs" onClick={onOpenAlertsEditor}>
          <Settings2 className="size-3.5" aria-hidden="true" />
          Configurar
        </button>
      </GlassCard>

      {/* ── Histórico: o que o motor fez de verdade ── */}
      <GlassCard className="p-4">
        <div className="mb-2 flex items-center gap-2">
          <ClipboardList className="size-4 text-muted-foreground" aria-hidden="true" />
          <h3 className="text-sm font-semibold text-foreground">Últimas ações do motor</h3>
        </div>
        {log.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            Nenhuma ação registrada ainda — o motor só age quando uma regra ativa dispara.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border/60">
            {log.map((l, i) => (
              <li key={`${l.at}-${i}`} className="flex items-start gap-2 py-2">
                <span
                  className={cn('mt-1 size-1.5 shrink-0 rounded-full', l.ok ? 'bg-success' : 'bg-error')}
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <p className="truncate text-[11px] text-sub">
                    <span className="font-medium text-foreground">{l.campaignName || l.campaignId}</span>
                    {' — '}
                    {l.detail}
                  </p>
                  <p className="font-mono text-[10px] tabular-nums text-muted-foreground">
                    {new Date(l.at).toLocaleString('pt-PT')}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </GlassCard>
    </div>
  )
}
