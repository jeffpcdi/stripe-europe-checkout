'use client'

// Regras automáticas de otimização do TikTok Ads. Diferente dos alertas
// (que só avisam), aqui o servidor AGE: pausa a campanha, ajusta o orçamento,
// escala vencedoras ou aplica agendamento (dayparting). O motor roda 24/7 no
// servidor (tick do ads-sync) — não depende da dashboard aberta. Botão
// "executar agora" + histórico das últimas ações.

import { useEffect, useState } from 'react'
import { Bot, Loader2, Play, Plus, Trash2, History, CheckCircle2, XCircle } from 'lucide-react'
import { useAdsRules, apiSend } from '@/lib/api'
import { toast } from '@/lib/toast'
import type { AdsRule, AdsRulesResponse, AdsRulesRunResponse, AdsRuleMetric, AdsRuleAction } from '@/lib/types'

const METRIC_LABELS: Record<AdsRuleMetric, string> = {
  cpa_max: 'CPA acima de',
  spend_no_conv: 'Gasto sem conversão ≥',
  roas_min: 'ROAS real abaixo de',
  ctr_min: 'CTR abaixo de',
  cpm_max: 'CPM acima de',
  roas_scale: 'Escalar se ROAS real ≥',
  schedule: 'Agendamento (dias/horário)',
}

const ACTION_LABELS: Record<AdsRuleAction, string> = {
  pause: 'Pausar campanha',
  budget_down: 'Reduzir orçamento',
  budget_up: 'Aumentar orçamento',
  activate: 'Reativar campanha',
}

const DAY_LABELS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

// Unidade do campo "Limite" por métrica (o que o número significa)
function thresholdUnit(metric: AdsRuleMetric, currency: string): string {
  if (metric === 'roas_min' || metric === 'roas_scale') return '(ROAS)'
  if (metric === 'ctr_min') return '(%)'
  return `(${currency})`
}

// Defaults seguros ao trocar o tipo da regra — espelham a validação do servidor
function metricDefaults(metric: AdsRuleMetric): Partial<AdsRule> {
  if (metric === 'ctr_min') return { action: 'pause', minImpressions: 1000, threshold: 0 }
  if (metric === 'cpm_max') return { action: 'pause', minSpend: 1, threshold: 0 }
  if (metric === 'roas_scale') return { action: 'budget_up', minSales: 2, pct: 20, budgetCap: 0, threshold: 0 }
  if (metric === 'schedule')
    return { action: 'pause', days: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '23:00', timezone: 'Europe/Lisbon', threshold: 1 }
  return { action: 'pause', threshold: 0 }
}

function newRule(): AdsRule {
  return {
    id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    enabled: true,
    metric: 'cpa_max',
    threshold: 0,
    lookbackDays: 2,
    action: 'pause',
    pct: 20,
  }
}

function fmtWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}

export function AutomationDialog({
  open,
  onClose,
  currency,
  onExecuted,
}: {
  open: boolean
  onClose: () => void
  currency: string
  // chamado quando regras executam ações (revalida a árvore de campanhas)
  onExecuted?: () => void
}) {
  const { data, mutate } = useAdsRules(open)

  const [rules, setRules] = useState<AdsRule[]>([])
  const [tab, setTab] = useState<'rules' | 'log'>('rules')
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)

  // Sincroniza quando as regras salvas chegam
  useEffect(() => {
    if (data) setRules(data.rules)
  }, [data])

  useEffect(() => {
    if (!open) setTab('rules')
  }, [open])

  if (!open) return null

  function patchRule(id: string, patch: Partial<AdsRule>) {
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  async function handleSave(close = true) {
    setSaving(true)
    try {
      const r = await apiSend<AdsRulesResponse>('/api/ads/rules', 'PUT', { rules })
      mutate(r, { revalidate: false })
      toast.success('Regras salvas', {
        hint: r.rules.some((x) => x.enabled) ? 'O servidor executa 24/7, mesmo com o painel fechado.' : 'Nenhuma regra ativa.',
      })
      if (close) onClose()
    } catch (e) {
      toast.error('Falha ao salvar regras', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setSaving(false)
    }
  }

  async function handleRunNow() {
    setRunning(true)
    try {
      // salva antes: a execução usa o que está em tela
      await apiSend<AdsRulesResponse>('/api/ads/rules', 'PUT', { rules })
      const r = await apiSend<AdsRulesRunResponse>('/api/ads/rules/run', 'POST')
      mutate()
      if (r.executed?.length) {
        toast.success(`${r.executed.length} ação(ões) executada(s)`, { hint: 'Veja o histórico para detalhes.' })
        setTab('log')
        onExecuted?.()
      } else {
        toast.success('Nenhuma campanha disparou as regras')
      }
    } catch (e) {
      toast.error('Falha ao executar', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setRunning(false)
    }
  }

  const log = data?.log ?? []

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ads-rules-title"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
        aria-label="Fechar"
        tabIndex={-1}
      />
      <div className="anim-pop-in relative flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-border/50 px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10">
              <Bot className="size-4 text-primary" aria-hidden="true" />
            </span>
            <div>
              <h2 id="ads-rules-title" className="text-sm font-semibold text-foreground">
                Regras automáticas
              </h2>
              <p className="text-[11px] text-muted-foreground">
                Pausa ou ajusta orçamento sozinho quando a métrica cruza o limite
              </p>
            </div>
          </div>
          <div className="flex gap-0.5 rounded-full bg-[var(--hover)] p-0.5" role="tablist" aria-label="Seções">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'rules'}
              onClick={() => setTab('rules')}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${tab === 'rules' ? 'bg-[var(--active)] text-foreground' : 'text-muted-foreground'}`}
            >
              Regras
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'log'}
              onClick={() => setTab('log')}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${tab === 'log' ? 'bg-[var(--active)] text-foreground' : 'text-muted-foreground'}`}
            >
              Histórico{log.length > 0 && ` (${log.length})`}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {tab === 'rules' ? (
            <div className="flex flex-col gap-3">
              {rules.length === 0 && (
                <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-xs leading-relaxed text-muted-foreground">
                  Nenhuma regra ainda. Exemplo: {'"'}se o CPA passar de 50 {currency}, pausar a campanha{'"'}.
                </p>
              )}
              {rules.map((r) => (
                <div key={r.id} className="anim-row-in flex flex-col gap-2.5 rounded-xl border border-border bg-secondary/30 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <label className="flex items-center gap-2 text-xs font-medium text-foreground">
                      <input
                        type="checkbox"
                        checked={r.enabled}
                        onChange={(e) => patchRule(r.id, { enabled: e.target.checked })}
                        className="size-3.5 accent-[color:var(--primary)]"
                        aria-label="Ativar regra"
                      />
                      {r.enabled ? 'Ativa' : 'Desativada'}
                    </label>
                    <button
                      type="button"
                      className="btn-ghost !p-1.5 text-[color:var(--error)]"
                      onClick={() => setRules((prev) => prev.filter((x) => x.id !== r.id))}
                      aria-label="Remover regra"
                      title="Remover"
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] text-muted-foreground">Se</span>
                      <select
                        className="input-neon rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground"
                        value={r.metric}
                        onChange={(e) => {
                          const metric = e.target.value as AdsRuleMetric
                          patchRule(r.id, { metric, ...metricDefaults(metric) })
                        }}
                      >
                        <option value="cpa_max">{METRIC_LABELS.cpa_max}</option>
                        <option value="spend_no_conv">{METRIC_LABELS.spend_no_conv}</option>
                        <option value="roas_min">{METRIC_LABELS.roas_min}</option>
                        <option value="ctr_min">{METRIC_LABELS.ctr_min}</option>
                        <option value="cpm_max">{METRIC_LABELS.cpm_max}</option>
                        <option value="roas_scale">{METRIC_LABELS.roas_scale}</option>
                        <option value="schedule">{METRIC_LABELS.schedule}</option>
                      </select>
                    </label>

                    {r.metric !== 'schedule' && (
                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] text-muted-foreground">
                          Limite {thresholdUnit(r.metric, currency)}
                        </span>
                        <input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step={r.metric === 'roas_min' || r.metric === 'roas_scale' || r.metric === 'ctr_min' ? '0.1' : '1'}
                          className="input-neon rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs tabular-nums text-foreground"
                          value={r.threshold || ''}
                          onChange={(e) => patchRule(r.id, { threshold: Number(e.target.value.replace(',', '.')) || 0 })}
                          placeholder={
                            r.metric === 'roas_min' ? '1.5' : r.metric === 'roas_scale' ? '3' : r.metric === 'ctr_min' ? '0.5' : '50'
                          }
                        />
                      </label>
                    )}

                    {r.metric !== 'schedule' && r.metric !== 'roas_scale' && (
                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] text-muted-foreground">Então</span>
                        <select
                          className="input-neon rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground"
                          value={r.action}
                          onChange={(e) => patchRule(r.id, { action: e.target.value as AdsRuleAction })}
                        >
                          <option value="pause">{ACTION_LABELS.pause}</option>
                          <option value="budget_down">{ACTION_LABELS.budget_down}</option>
                          <option value="budget_up">{ACTION_LABELS.budget_up}</option>
                        </select>
                      </label>
                    )}

                    {r.metric !== 'schedule' &&
                      r.metric !== 'roas_scale' &&
                      (r.action === 'pause' ? (
                        <label className="flex flex-col gap-1">
                          <span className="text-[11px] text-muted-foreground">Janela (dias)</span>
                          <select
                            className="input-neon rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground"
                            value={String(r.lookbackDays)}
                            onChange={(e) => patchRule(r.id, { lookbackDays: parseInt(e.target.value, 10) || 2 })}
                          >
                            <option value="1">Último dia</option>
                            <option value="2">Últimos 2 dias</option>
                            <option value="3">Últimos 3 dias</option>
                            <option value="7">Últimos 7 dias</option>
                          </select>
                        </label>
                      ) : (
                        <label className="flex flex-col gap-1">
                          <span className="text-[11px] text-muted-foreground">Ajuste (%)</span>
                          <input
                            type="number"
                            inputMode="numeric"
                            min={5}
                            max={50}
                            className="input-neon rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs tabular-nums text-foreground"
                            value={r.pct}
                            onChange={(e) => patchRule(r.id, { pct: parseInt(e.target.value, 10) || 20 })}
                          />
                        </label>
                      ))}

                    {/* Guardas específicas por métrica — espelham a validação do servidor */}
                    {r.metric === 'ctr_min' && (
                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] text-muted-foreground">Mín. de impressões</span>
                        <input
                          type="number"
                          inputMode="numeric"
                          min={100}
                          className="input-neon rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs tabular-nums text-foreground"
                          value={r.minImpressions ?? 1000}
                          onChange={(e) => patchRule(r.id, { minImpressions: parseInt(e.target.value, 10) || 1000 })}
                        />
                      </label>
                    )}
                    {r.metric === 'cpm_max' && (
                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] text-muted-foreground">Gasto mínimo ({currency})</span>
                        <input
                          type="number"
                          inputMode="decimal"
                          min={0.5}
                          step="0.5"
                          className="input-neon rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs tabular-nums text-foreground"
                          value={r.minSpend ?? 1}
                          onChange={(e) => patchRule(r.id, { minSpend: Number(e.target.value.replace(',', '.')) || 1 })}
                        />
                      </label>
                    )}
                    {r.metric === 'roas_scale' && (
                      <>
                        <label className="flex flex-col gap-1">
                          <span className="text-[11px] text-muted-foreground">Vendas mínimas</span>
                          <input
                            type="number"
                            inputMode="numeric"
                            min={1}
                            className="input-neon rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs tabular-nums text-foreground"
                            value={r.minSales ?? 2}
                            onChange={(e) => patchRule(r.id, { minSales: parseInt(e.target.value, 10) || 2 })}
                          />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="text-[11px] text-muted-foreground">Aumento (%)</span>
                          <input
                            type="number"
                            inputMode="numeric"
                            min={5}
                            max={50}
                            className="input-neon rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs tabular-nums text-foreground"
                            value={r.pct}
                            onChange={(e) => patchRule(r.id, { pct: parseInt(e.target.value, 10) || 20 })}
                          />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className={`text-[11px] ${!(Number(r.budgetCap) > 0) ? 'font-semibold text-warning' : 'text-muted-foreground'}`}>
                            Teto de orçamento ({currency}) — obrigatório
                          </span>
                          <input
                            type="number"
                            inputMode="decimal"
                            min={1}
                            className="input-neon rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs tabular-nums text-foreground"
                            value={r.budgetCap || ''}
                            onChange={(e) => patchRule(r.id, { budgetCap: Number(e.target.value.replace(',', '.')) || 0 })}
                            placeholder="ex.: 200"
                          />
                        </label>
                      </>
                    )}
                  </div>

                  {r.metric === 'roas_scale' && !(Number(r.budgetCap) > 0) && (
                    <p className="text-[11px] leading-relaxed text-warning">
                      Sem teto de orçamento a regra fica desativada — escala sem limite é o maior risco deste motor.
                    </p>
                  )}

                  {/* Dayparting: dias da semana + janela de horário + fuso */}
                  {r.metric === 'schedule' && (
                    <div className="flex flex-col gap-2.5">
                      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Dias da semana">
                        {DAY_LABELS.map((d, di) => {
                          const on = (r.days ?? []).includes(di)
                          return (
                            <button
                              key={d}
                              type="button"
                              aria-pressed={on}
                              onClick={() =>
                                patchRule(r.id, {
                                  days: on ? (r.days ?? []).filter((x) => x !== di) : [...(r.days ?? []), di].sort(),
                                })
                              }
                              className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                                on
                                  ? 'bg-primary/15 text-primary'
                                  : 'bg-[var(--hover)] text-muted-foreground'
                              }`}
                            >
                              {d}
                            </button>
                          )
                        })}
                      </div>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        <label className="flex flex-col gap-1">
                          <span className="text-[11px] text-muted-foreground">Ligar às</span>
                          <input
                            type="time"
                            className="input-neon rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs tabular-nums text-foreground"
                            value={r.startTime ?? '09:00'}
                            onChange={(e) => patchRule(r.id, { startTime: e.target.value })}
                          />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="text-[11px] text-muted-foreground">Pausar às</span>
                          <input
                            type="time"
                            className="input-neon rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs tabular-nums text-foreground"
                            value={r.endTime ?? '23:00'}
                            onChange={(e) => patchRule(r.id, { endTime: e.target.value })}
                          />
                        </label>
                        <label className="col-span-2 flex flex-col gap-1 sm:col-span-1">
                          <span className="text-[11px] text-muted-foreground">Fuso</span>
                          <select
                            className="input-neon rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground"
                            value={r.timezone ?? 'Europe/Lisbon'}
                            onChange={(e) => patchRule(r.id, { timezone: e.target.value })}
                          >
                            <option value="Europe/Lisbon">Lisboa</option>
                            <option value="Europe/Madrid">Madrid</option>
                            <option value="America/Sao_Paulo">São Paulo</option>
                            <option value="UTC">UTC</option>
                          </select>
                        </label>
                      </div>
                      <p className="text-[11px] leading-relaxed text-muted-foreground">
                        Fora da janela as campanhas pausam; dentro, religam — mas só as que o próprio agendamento
                        pausou (nunca reativa campanha pausada por outra regra ou por você).
                        {(r.startTime ?? '') > (r.endTime ?? '') ? ' Janela cruza a meia-noite.' : ''}
                      </p>
                    </div>
                  )}
                </div>
              ))}

              {rules.length < 10 && (
                <button
                  type="button"
                  className="btn-ghost self-start text-xs"
                  onClick={() => setRules((prev) => [...prev, newRule()])}
                >
                  <Plus className="size-3.5" aria-hidden="true" />
                  Adicionar regra
                </button>
              )}

              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Roda 24/7 no servidor, mesmo com o painel fechado. Uma ação por campanha a cada 12h (escala: 1×/dia,
                sem loop) — o cooldown sobrevive a reinícios. O ROAS real usa as vendas dos seus gateways atribuídas
                via utm_campaign. Você recebe um Pushcut a cada ação executada.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {log.length === 0 ? (
                <p className="flex items-center gap-2 rounded-xl border border-dashed border-border px-4 py-6 text-xs text-muted-foreground">
                  <History className="size-4" aria-hidden="true" />
                  Nenhuma ação executada ainda.
                </p>
              ) : (
                log.map((e, i) => (
                  <div key={i} className="flex items-start gap-2 rounded-xl border border-border bg-secondary/30 px-3 py-2.5">
                    {e.ok ? (
                      <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-[color:var(--success)]" aria-hidden="true" />
                    ) : (
                      <XCircle className="mt-0.5 size-3.5 shrink-0 text-[color:var(--error)]" aria-hidden="true" />
                    )}
                    <div className="min-w-0 text-xs leading-relaxed">
                      <p className="text-foreground">
                        <span className="font-medium">{e.result || ACTION_LABELS[e.action]}</span> —{' '}
                        <span className="truncate">{e.campaignName}</span>
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {fmtWhen(e.at)} · {e.detail}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border/50 px-5 py-3.5">
          <button type="button" className="btn-ghost text-xs" onClick={handleRunNow} disabled={running || saving}>
            {running ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Play className="size-3.5" aria-hidden="true" />
            )}
            Executar agora
          </button>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-ghost text-xs" onClick={onClose} disabled={saving}>
              Cancelar
            </button>
            <button type="button" className="btn-primary text-xs" onClick={() => handleSave(true)} disabled={saving || running}>
              {saving && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
              Salvar
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
