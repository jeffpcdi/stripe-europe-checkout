'use client'

// Aba Automações redesenhada — interação DIRETA nos elementos, sem diálogos:
//   • cada regra tem um Switch real (salva na hora, rollback em erro) e a
//     linha expande em acordeão para editar limiar/guardas/modo inline;
//   • a linha fechada é um resumo vivo: modo (Propõe/Executa) + sentença
//     humana + última ação real da regra (derivada do log já carregado);
//   • "+ Nova regra" e "Testar agora" no cabeçalho substituem o diálogo de
//     531 linhas; alertas seguem a mesma linguagem (switch + expansão).
// Contratos intocados: PUT /api/ads/rules (lista completa), PUT
// /api/ads/alerts, POST /api/ads/rules/run. Zero requests novas no load.

import { useEffect, useRef, useState } from 'react'
import {
  Bell,
  ClipboardList,
  FlaskConical,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { useAdsRules, useAdsAlerts, apiSend } from '@/lib/api'
import { toast } from '@/lib/toast'
import type {
  AdsAlertsConfig,
  AdsRule,
  AdsRuleLogEntry,
  AdsRuleMetric,
  AdsRulesResponse,
  AdsRulesRunResponse,
} from '@/lib/types'
import { timeAgo, cleanCampaignName } from '@/lib/format'
import { GlassCard } from '@/components/glass-card'
import { Skeleton } from '@/components/skeleton'
import { Switch } from '@/components/switch'
import { cn } from '@/lib/utils'

// ── Metadados por métrica: rótulo do limiar + unidade + guardas visíveis ────
const METRIC_META: Record<
  AdsRuleMetric,
  { name: string; thresholdLabel: string; unit: '€' | '%' | 'x' | '' ; verb: (r: AdsRule, cur: string) => string }
> = {
  cpa_max: {
    name: 'CPA acima do limite',
    thresholdLabel: 'CPA máximo',
    unit: '€',
    verb: (r, c) => `age se CPA > ${r.threshold}${c}`,
  },
  spend_no_conv: {
    name: 'Gasto sem conversão',
    thresholdLabel: 'Gasto sem venda',
    unit: '€',
    verb: (r, c) => `age se gastar ${r.threshold}${c} sem venda`,
  },
  roas_min: {
    name: 'ROAS abaixo do mínimo',
    thresholdLabel: 'ROAS mínimo',
    unit: 'x',
    verb: (r) => `age se ROAS < ${r.threshold}`,
  },
  ctr_min: {
    name: 'CTR abaixo do mínimo',
    thresholdLabel: 'CTR mínimo',
    unit: '%',
    verb: (r) => `age se CTR < ${r.threshold}%`,
  },
  cpm_max: {
    name: 'CPM acima do limite',
    thresholdLabel: 'CPM máximo',
    unit: '€',
    verb: (r, c) => `age se CPM > ${r.threshold}${c}`,
  },
  roas_scale: {
    name: 'ROAS bom → escalar',
    thresholdLabel: 'ROAS a partir de',
    unit: 'x',
    verb: (r) => `escala +${r.pct}% se ROAS ≥ ${r.threshold}`,
  },
  schedule: {
    name: 'Agendamento (dayparting)',
    thresholdLabel: '',
    unit: '',
    verb: (r) => `roda ${r.startTime || '00:00'}–${r.endTime || '23:59'}`,
  },
}

const ACTION_LABEL: Record<string, string> = {
  pause: 'pausa a campanha',
  budget_down: 'reduz o orçamento',
  budget_up: 'aumenta o orçamento',
  activate: 'reativa a campanha',
}

const DAY_LABELS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

// Sentença humana da linha fechada: "pausa a campanha se CPA > 15€ · janela 2d
// · min. 30 cliques". Uma linha, escaneável — o design inteiro depende dela.
function summarize(r: AdsRule, currency: string): string {
  const meta = METRIC_META[r.metric]
  if (!meta) return r.metric
  if (r.metric === 'schedule') {
    const days = (r.days || []).map((d) => DAY_LABELS[d] ?? d).join(', ')
    return `${meta.verb(r, currency)}${days ? ` · ${days}` : ' · todos os dias'}`
  }
  const parts = [
    `${ACTION_LABEL[r.action] || r.action} ${r.metric === 'roas_scale' ? '' : ''}${meta.verb(r, currency).replace(/^age /, '')}`,
    `janela ${r.lookbackDays}d`,
  ]
  if (r.minClicks) parts.push(`min. ${r.minClicks} cliques`)
  if (r.minImpressions) parts.push(`min. ${r.minImpressions} impr.`)
  if (r.minSpend) parts.push(`min. ${r.minSpend}${currency} gastos`)
  if (r.minSales) parts.push(`min. ${r.minSales} vendas`)
  if (r.budgetCap) parts.push(`teto ${r.budgetCap}${currency}/dia`)
  return parts.join(' · ')
}

// Última ação REAL da regra, derivada do log que a resposta já traz — zero
// requests novas. O log vem do motor em ordem cronológica inversa.
function lastAction(ruleId: string, log: AdsRuleLogEntry[]): string | null {
  const e = log.find((l) => l.ruleId === ruleId)
  if (!e) return null
  const kind = e.proposed ? 'propôs' : e.simulated ? 'simulou' : e.ok ? 'executou' : 'falhou ao'
  const what = ACTION_LABEL[e.action]?.replace('a campanha', '').trim() || e.action
  return `disparou ${timeAgo(e.at)} — ${kind} ${what} "${cleanCampaignName(e.campaignName || e.campaignId)}"`
}

// Clamps do motor espelhados no cliente (validateRules): salvar nunca
// surpreende — o valor que aparece é o valor que vale.
function clampRule(r: AdsRule): AdsRule {
  return {
    ...r,
    threshold: Math.max(0, Math.min(100000, Number(r.threshold) || 0)),
    lookbackDays: Math.max(1, Math.min(30, Math.round(Number(r.lookbackDays) || 2))),
    pct: Math.max(5, Math.min(50, Number(r.pct) || 20)),
  }
}

// ── Campo numérico compacto do formulário inline ────────────────────────────
function NumField({
  label,
  value,
  onChange,
  suffix,
  hint,
}: {
  label: string
  value: number | undefined
  onChange: (v: number | undefined) => void
  suffix?: string
  hint?: string
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1">
        <input
          type="number"
          inputMode="decimal"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
          className="input-neon w-full min-w-0 rounded-lg border border-border bg-background px-2.5 py-1.5 font-mono text-xs tabular-nums text-foreground"
        />
        {suffix ? <span className="shrink-0 text-[11px] text-muted-foreground">{suffix}</span> : null}
      </span>
      {hint ? <span className="text-[10px] text-muted-foreground">{hint}</span> : null}
    </label>
  )
}

// ── Formulário inline de UMA regra (o acordeão aberto) ──────────────────────
function RuleForm({
  rule,
  currency,
  onSave,
  onCancel,
  onDelete,
  saving,
}: {
  rule: AdsRule
  currency: string
  onSave: (r: AdsRule) => void
  onCancel: () => void
  onDelete?: () => void
  saving: boolean
}) {
  const [draft, setDraft] = useState<AdsRule>(rule)
  const meta = METRIC_META[draft.metric]
  const set = (patch: Partial<AdsRule>) => setDraft((d) => ({ ...d, ...patch }))
  const isSchedule = draft.metric === 'schedule'
  const isBudget = draft.action === 'budget_up' || draft.action === 'budget_down' || draft.metric === 'roas_scale'

  // ESC cancela — metade da promessa "teclado navega tudo".
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    el.addEventListener('keydown', onKey)
    return () => el.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div ref={ref} className="flex flex-col gap-3 border-t border-border/60 pt-3">
      {/* Modo Propor vs. Executar — a decisão mais importante da regra (F3),
          antes invisível. Par de rádios com consequência explícita. */}
      <fieldset>
        <legend className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Quando disparar
        </legend>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {(
            [
              ['proposal', 'Propõe', 'Grava uma proposta — você aprova antes de qualquer ação'],
              ['execute', 'Executa', 'Age sozinha na hora e registra na auditoria'],
            ] as const
          ).map(([value, label, desc]) => {
            const selected = (draft.mode ?? 'proposal') === value
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => set({ mode: value })}
                className={cn(
                  'rounded-xl border px-3 py-2 text-left transition-colors',
                  selected
                    ? value === 'execute'
                      ? 'border-brand-cyan/60 bg-[var(--accent-light)]'
                      : 'border-warning/50 bg-warning/10'
                    : 'border-border bg-[var(--hover)] hover:border-border/80',
                )}
              >
                <span className={cn('text-xs font-semibold', selected ? 'text-foreground' : 'text-sub')}>
                  {label}
                </span>
                <span className="mt-0.5 block text-[10px] leading-relaxed text-muted-foreground">{desc}</span>
              </button>
            )
          })}
        </div>
      </fieldset>

      {/* Limiar + janela + ajuste — só os campos que a métrica usa */}
      {!isSchedule && (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <NumField
            label={meta.thresholdLabel || 'Limiar'}
            value={draft.threshold}
            onChange={(v) => set({ threshold: v ?? 0 })}
            suffix={meta.unit === '€' ? currency : meta.unit || undefined}
          />
          <NumField
            label="Janela"
            value={draft.lookbackDays}
            onChange={(v) => set({ lookbackDays: v ?? 1 })}
            suffix="dias"
            hint={draft.lookbackDays < 3 ? '⚠ Janela curta — o TikTok recomenda ~7d' : '1–30'}
          />
          {isBudget && (
            <NumField
              label="Ajuste"
              value={draft.pct}
              onChange={(v) => set({ pct: v ?? 20 })}
              suffix="%"
              hint="5–50"
            />
          )}
          {draft.metric === 'roas_scale' && (
            <NumField
              label="Teto de orçamento"
              value={draft.budgetCap}
              onChange={(v) => set({ budgetCap: v })}
              suffix={`${currency}/dia`}
              hint="escala sem teto é o risco nº 1"
            />
          )}
        </div>
      )}

      {/* Guardas de volume — ruído não é sinal */}
      {!isSchedule && (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {(draft.metric === 'cpa_max' || draft.metric === 'spend_no_conv') && (
            <NumField label="Min. cliques" value={draft.minClicks} onChange={(v) => set({ minClicks: v })} />
          )}
          {draft.metric !== 'cpm_max' && (
            <NumField
              label="Min. impressões"
              value={draft.minImpressions}
              onChange={(v) => set({ minImpressions: v })}
            />
          )}
          {draft.metric === 'cpm_max' && (
            <NumField
              label="Min. gasto"
              value={draft.minSpend}
              onChange={(v) => set({ minSpend: v })}
              suffix={currency}
            />
          )}
          {draft.metric === 'roas_scale' && (
            <NumField label="Min. vendas" value={draft.minSales} onChange={(v) => set({ minSales: v })} />
          )}
        </div>
      )}

      {/* Dayparting — absorvido do diálogo antigo */}
      {isSchedule && (
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Dias da semana">
            {DAY_LABELS.map((d, i) => {
              const on = (draft.days ?? []).includes(i)
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    set({ days: on ? (draft.days ?? []).filter((x) => x !== i) : [...(draft.days ?? []), i].sort() })
                  }
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
                    on
                      ? 'border-brand-cyan/60 bg-[var(--accent-light)] text-brand-cyan'
                      : 'border-border bg-[var(--hover)] text-muted-foreground hover:text-sub',
                  )}
                >
                  {d}
                </button>
              )
            })}
          </div>
          <div className="grid grid-cols-2 gap-2.5 sm:max-w-xs">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Início</span>
              <input
                type="time"
                value={draft.startTime ?? '08:00'}
                onChange={(e) => set({ startTime: e.target.value })}
                className="input-neon rounded-lg border border-border bg-background px-2.5 py-1.5 font-mono text-xs text-foreground"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Fim</span>
              <input
                type="time"
                value={draft.endTime ?? '23:00'}
                onChange={(e) => set({ endTime: e.target.value })}
                className="input-neon rounded-lg border border-border bg-background px-2.5 py-1.5 font-mono text-xs text-foreground"
              />
            </label>
          </div>
        </div>
      )}

      {/* Rodapé: Salvar/Cancelar (+ remover) */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {onDelete ? (
          <button
            type="button"
            className="btn-ghost gap-1 px-2 py-1 text-[11px] text-muted-foreground hover:bg-error/10 hover:text-error"
            onClick={onDelete}
            disabled={saving}
          >
            <Trash2 className="size-3" aria-hidden="true" />
            Remover regra
          </button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-1.5">
          <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={onCancel} disabled={saving}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn-primary px-3.5 py-1.5 text-xs"
            onClick={() => onSave(clampRule(draft))}
            disabled={saving}
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : null}
            Salvar
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Badges do log por tipo de ação ──────────────────────────────────────────
function logBadge(l: AdsRuleLogEntry): { label: string; cls: string } {
  if (l.simulated) return { label: 'simulada', cls: 'bg-[var(--hover)] text-muted-foreground' }
  if (l.proposed) return { label: 'proposta', cls: 'bg-warning/15 text-warning' }
  if (l.approvedProposal) return { label: 'aprovada por você', cls: 'bg-success/15 text-success' }
  if (!l.ok) return { label: 'falhou', cls: 'bg-error/15 text-error' }
  return { label: 'executada', cls: 'bg-[var(--accent-light)] text-brand-cyan' }
}

type LogFilter = 'all' | 'proposed' | 'executed' | 'failed'
const LOG_FILTERS: [LogFilter, string][] = [
  ['all', 'Todas'],
  ['proposed', 'Propostas'],
  ['executed', 'Executadas'],
  ['failed', 'Falhas'],
]

// ═════════════════════════════════════════════════════════════════════════════
export function AutomationPanel({
  active,
  currency = '€',
  alertsFocusRef,
}: {
  active: boolean
  currency?: string
  /** A AttentionStrip rola até aqui quando o chip "Alertas desligados" é clicado. */
  alertsFocusRef?: React.RefObject<HTMLDivElement | null>
}) {
  const { data, mutate, isLoading } = useAdsRules(active)
  const { data: alertsCfg, mutate: mutateAlerts } = useAdsAlerts(active)

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [logFilter, setLogFilter] = useState<LogFilter>('all')
  const [alertsExpanded, setAlertsExpanded] = useState(false)
  const [alertsDraft, setAlertsDraft] = useState<AdsAlertsConfig | null>(null)

  const rules = data?.rules ?? []
  const log = data?.log ?? []
  const enabledCount = rules.filter((r) => r.enabled).length

  // PUT da lista COMPLETA (contrato da rota) com update otimista + rollback.
  async function saveRules(next: AdsRule[], okMsg: string) {
    setSaving(true)
    const prev = data
    mutate(prev ? { ...prev, rules: next } : undefined, { revalidate: false })
    try {
      const r = await apiSend<AdsRulesResponse>('/api/ads/rules', 'PUT', { rules: next })
      mutate(r, { revalidate: false })
      toast.success(okMsg)
      return true
    } catch (e) {
      mutate(prev, { revalidate: false }) // rollback — a UI nunca mente
      toast.error('Falha ao salvar', { hint: e instanceof Error ? e.message : undefined })
      return false
    } finally {
      setSaving(false)
    }
  }

  async function toggleRule(rule: AdsRule, on: boolean) {
    await saveRules(
      rules.map((r) => (r.id === rule.id ? { ...r, enabled: on } : r)),
      on ? `Regra ativada: ${rule.name || METRIC_META[rule.metric]?.name}` : `Regra pausada: ${rule.name || METRIC_META[rule.metric]?.name}`,
    )
  }

  async function saveRule(updated: AdsRule) {
    const exists = rules.some((r) => r.id === updated.id)
    const ok = await saveRules(
      exists ? rules.map((r) => (r.id === updated.id ? updated : r)) : [...rules, updated],
      'Regra salva',
    )
    if (ok) setExpandedId(null)
  }

  async function deleteRule(id: string) {
    const ok = await saveRules(rules.filter((r) => r.id !== id), 'Regra removida')
    if (ok) setExpandedId(null)
  }

  function addRule() {
    const draft: AdsRule = {
      id: `rule_${Date.now().toString(36)}`,
      enabled: false,
      metric: 'cpa_max',
      threshold: 15,
      lookbackDays: 2,
      action: 'pause',
      pct: 20,
      mode: 'proposal',
      minClicks: 30,
      minImpressions: 1000,
    }
    // Entra direto expandida — o formulário É o fluxo de criação.
    mutate(data ? { ...data, rules: [...rules, draft] } : undefined, { revalidate: false })
    setExpandedId(draft.id)
  }

  // "Testar agora" — roda o sweep completo (rules + schedule) e resume o
  // resultado inline. O poder antes enterrado no diálogo.
  async function testNow() {
    if (testing) return
    setTesting(true)
    setTestResult(null)
    try {
      const r = await apiSend<AdsRulesRunResponse>('/api/ads/rules/run', 'POST')
      const executed = r.executed ?? []
      const proposals = executed.filter((e) => e.proposed).length
      setTestResult(
        executed.length === 0
          ? 'Avaliação completa — nenhuma regra disparou agora.'
          : `${executed.length} ${executed.length === 1 ? 'disparo' : 'disparos'}${proposals ? ` (${proposals} proposta${proposals > 1 ? 's' : ''} criada${proposals > 1 ? 's' : ''})` : ''} — veja o log abaixo.`,
      )
      mutate()
    } catch (e) {
      toast.error('Falha ao rodar a avaliação', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setTesting(false)
    }
  }

  async function saveAlerts(cfg: AdsAlertsConfig) {
    setSaving(true)
    try {
      await apiSend<AdsAlertsConfig>('/api/ads/alerts', 'PUT', cfg)
      mutateAlerts(cfg, { revalidate: false })
      toast.success(cfg.enabled ? 'Alertas ativados' : 'Alertas desligados')
      setAlertsExpanded(false)
      setAlertsDraft(null)
    } catch (e) {
      toast.error('Falha ao salvar alertas', { hint: e instanceof Error ? e.message : undefined })
      mutateAlerts()
    } finally {
      setSaving(false)
    }
  }

  const filteredLog = log
    .filter((l) => {
      if (logFilter === 'proposed') return !!l.proposed
      if (logFilter === 'failed') return !l.ok && !l.proposed
      if (logFilter === 'executed') return l.ok && !l.proposed && !l.simulated
      return true
    })
    .slice(0, 12)

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
      {/* ── Regras: linhas expansíveis com switch ── */}
      <GlassCard className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">Regras automáticas</h3>
            <span className="rounded-full bg-[var(--hover)] px-2 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
              {enabledCount} de {rules.length} ativas
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <button type="button" className="btn-ghost gap-1 text-xs" onClick={testNow} disabled={testing}>
              {testing ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <FlaskConical className="size-3.5" aria-hidden="true" />
              )}
              Testar agora
            </button>
            <button type="button" className="btn-primary gap-1 text-xs shadow-[0_0_15px_rgba(37,244,238,0.4)] ring-1 ring-brand-cyan hover:shadow-[0_0_25px_rgba(37,244,238,0.6)]" onClick={addRule} disabled={saving}>
              <Plus className="size-3.5" aria-hidden="true" />
              Nova regra
            </button>
          </div>
        </div>

        {testResult ? (
          <p className="mb-2 rounded-lg bg-[var(--accent-light)] px-3 py-1.5 text-[11px] text-brand-cyan">
            {testResult}
          </p>
        ) : null}

        {rules.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            Nenhuma regra. Crie a primeira com &quot;Nova regra&quot; — ela nasce em modo
            &quot;Propõe&quot;: nada é executado sem a sua aprovação.
          </p>
        ) : (
          <ul className="flex flex-col gap-2 mt-2">
            {rules.map((r) => {
              const open = expandedId === r.id
              const meta = METRIC_META[r.metric]
              const last = lastAction(r.id, log)
              const executes = r.mode === 'execute'
              return (
                <GlassCard key={r.id} hover className="p-3 relative overflow-hidden group border border-white/5 bg-background/20 transition-all duration-300 hover:shadow-[0_4px_20px_rgba(0,0,0,0.5)]">
                  <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-brand-cyan/0 transition-colors duration-300 group-hover:bg-brand-cyan/50" aria-hidden="true" />
                  <div className="flex items-start justify-between gap-3 relative">
                    {/* Cabeçalho da linha = botão do acordeão */}
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => setExpandedId(open ? null : r.id)}
                      className="min-w-0 flex-1 rounded-lg text-left transition-colors hover:bg-[var(--hover)]/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs font-medium text-foreground">
                          {r.name || meta?.name || r.metric}
                        </span>
                        <span
                          className={cn(
                            'flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide border',
                            executes ? 'bg-brand-cyan/15 text-brand-cyan border-brand-cyan/20 shadow-[0_0_10px_rgba(37,244,238,0.15)]' : 'bg-warning/15 text-warning border-warning/20 shadow-[0_0_10px_rgba(234,179,8,0.15)]',
                          )}
                          title={
                            executes
                              ? 'Age sozinha quando dispara — registrado na auditoria'
                              : 'Grava proposta — você aprova antes de agir'
                          }
                        >
                          {executes ? (
                            <span className="relative flex size-1.5">
                              <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 bg-brand-cyan" aria-hidden="true" />
                              <span className="relative inline-flex size-1.5 rounded-full bg-brand-cyan drop-shadow-md" aria-hidden="true" />
                            </span>
                          ) : (
                            <span className="size-1.5 rounded-full bg-warning" aria-hidden="true" />
                          )}
                          {executes ? 'Executa' : 'Propõe'}
                        </span>
                        {r.preset && (
                          <span
                            className="flex items-center gap-1 rounded-full bg-[var(--hover)] px-1.5 py-0.5 text-[10px] text-muted-foreground"
                            title="Regra pré-configurada de fábrica"
                          >
                            <Sparkles className="size-2.5" aria-hidden="true" />
                            padrão
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block text-pretty text-[11px] leading-relaxed text-muted-foreground">
                        {summarize(r, currency)}
                      </span>
                      <span className="mt-0.5 block text-[10px] text-muted-foreground/80">
                        {last || 'nunca disparou'}
                      </span>
                    </button>
                    <Switch
                      checked={r.enabled}
                      disabled={saving}
                      onCheckedChange={(on) => toggleRule(r, on)}
                      aria-label={`${r.enabled ? 'Pausar' : 'Ativar'} regra: ${r.name || meta?.name || r.metric}`}
                      className="mt-0.5"
                    />
                  </div>
                  {open && (
                    <div className="mt-3 border-t border-white/5 pt-3">
                      <RuleForm
                        rule={r}
                        currency={currency}
                        saving={saving}
                        onSave={saveRule}
                        onCancel={() => {
                          setExpandedId(null)
                          mutate() // descarta rascunho de regra nova não salva
                        }}
                        onDelete={() => deleteRule(r.id)}
                      />
                    </div>
                  )}
                </GlassCard>
              )
            })}
          </ul>
        )}
      </GlassCard>

      {/* ── Alertas: mesma linguagem — switch + expansão inline ── */}
      <GlassCard className="p-4" ref={alertsFocusRef}>
        <div className="flex items-start justify-between gap-3">
          <button
            type="button"
            aria-expanded={alertsExpanded}
            onClick={() => {
              setAlertsExpanded((v) => !v)
              setAlertsDraft(alertsCfg ?? { enabled: false, spendNoConv: 10, cpaMax: 0, lookbackDays: 2 })
            }}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left transition-colors hover:bg-[var(--hover)]/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-light)] text-brand-cyan">
              <Bell className="size-4.5" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-semibold text-foreground">Alertas de performance</span>
              <span className="block text-[11px] text-muted-foreground">
                {alertsCfg?.enabled
                  ? `Avisam com ${alertsCfg.spendNoConv}${currency} gastos sem venda ou CPA acima de ${alertsCfg.cpaMax}${currency} — só notificam, nunca agem`
                  : 'Desligados — você não recebe aviso de campanha queimando dinheiro'}
              </span>
            </span>
          </button>
          <Switch
            checked={!!alertsCfg?.enabled}
            disabled={saving || !alertsCfg}
            onCheckedChange={(on) => alertsCfg && saveAlerts({ ...alertsCfg, enabled: on })}
            aria-label={alertsCfg?.enabled ? 'Desligar alertas de performance' : 'Ligar alertas de performance'}
            className="mt-1"
          />
        </div>
        {alertsExpanded && alertsDraft && (
          <div className="mt-3 flex flex-col gap-3 border-t border-border/60 pt-3">
            <div className="grid grid-cols-2 gap-2.5 sm:max-w-md sm:grid-cols-3">
              <NumField
                label="Gasto sem venda"
                value={alertsDraft.spendNoConv}
                onChange={(v) => setAlertsDraft({ ...alertsDraft, spendNoConv: v ?? 0 })}
                suffix={currency}
                hint="0 = desliga esta checagem"
              />
              <NumField
                label="CPA máximo"
                value={alertsDraft.cpaMax}
                onChange={(v) => setAlertsDraft({ ...alertsDraft, cpaMax: v ?? 0 })}
                suffix={currency}
                hint="0 = desliga esta checagem"
              />
              <NumField
                label="Janela"
                value={alertsDraft.lookbackDays}
                onChange={(v) => setAlertsDraft({ ...alertsDraft, lookbackDays: v ?? 1 })}
                suffix="dias"
                hint={alertsDraft.lookbackDays < 3 ? '⚠ Janela curta' : '1–30'}
              />
            </div>
            <div className="flex items-center justify-end gap-1.5">
              <button
                type="button"
                className="btn-ghost px-3 py-1.5 text-xs"
                onClick={() => {
                  setAlertsExpanded(false)
                  setAlertsDraft(null)
                }}
                disabled={saving}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primary px-3.5 py-1.5 text-xs"
                onClick={() => saveAlerts({ ...alertsDraft, enabled: true })}
                disabled={saving}
              >
                {saving ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : null}
                Salvar e ligar
              </button>
            </div>
          </div>
        )}
      </GlassCard>

      {/* ── Histórico do motor: badges por tipo + filtro client-side ── */}
      <GlassCard className="p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ClipboardList className="size-4 text-muted-foreground" aria-hidden="true" />
            <h3 className="text-sm font-semibold text-foreground">Últimas ações do motor</h3>
          </div>
          {log.length > 0 && (
            <div className="flex items-center gap-1" role="group" aria-label="Filtrar histórico">
              {LOG_FILTERS.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={logFilter === key}
                  onClick={() => setLogFilter(key)}
                  className={cn(
                    'rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors',
                    logFilter === key
                      ? 'bg-[var(--accent-light)] text-brand-cyan'
                      : 'text-muted-foreground hover:text-sub',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
        {filteredLog.length === 0 ? (
          <p className="py-4 text-center text-xs leading-relaxed text-muted-foreground">
            {log.length === 0
              ? 'O motor avalia suas regras a cada 10 min. Nenhuma disparou ainda — use "Testar agora" para rodar uma avaliação imediata.'
              : 'Nada neste filtro.'}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border/60">
            {filteredLog.map((l, i) => {
              const badge = logBadge(l)
              return (
                <li key={`${l.at}-${i}`} className="flex items-start gap-2 py-2">
                  <span
                    className={cn(
                      'mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                      badge.cls,
                    )}
                  >
                    {badge.label}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11px] text-sub">
                      <span className="font-medium text-foreground">
                        {cleanCampaignName(l.campaignName || l.campaignId)}
                      </span>
                      {' — '}
                      {l.result || l.detail}
                    </p>
                  </div>
                  <span
                    className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground"
                    title={new Date(l.at).toLocaleString('pt-PT')}
                  >
                    {timeAgo(l.at)}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </GlassCard>
    </div>
  )
}
