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
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  SlidersHorizontal,
  ChevronDown,
  ShieldCheck,
  Activity,
  Clock3,
} from 'lucide-react'
import { ApiError, useAdsRules, useAdsSafetyPolicy, apiSend } from '@/lib/api'
import { toast } from '@/lib/toast'
import type {
  AdsAlertsConfig,
  AdsRule,
  AdsRuleLogEntry,
  AdsRuleMetric,
  AdsRulesResponse,
  AdsRulesRunResponse,
  AdsAutomationAutonomy,
  AdsAutomationEngine,
} from '@/lib/types'
import { timeAgo, cleanCampaignName } from '@/lib/format'
import { usePersistedState } from '@/lib/use-persisted-state'
import { GlassCard } from '@/components/glass-card'
import { Skeleton } from '@/components/skeleton'
import { ErrorState } from '@/components/error-state'
import { Switch } from '@/components/switch'
import { PilotsPanel } from './pilots-panel'
import { RejectionInbox } from './rejection-inbox'
import { RulesLogList } from './rules-log-list'
import { cn } from '@/lib/utils'
import { applyPilot, PILOTS, type Intensity, type PilotId } from '@/lib/pilots'

// ── Metadados por métrica: rótulo do limiar + unidade + guardas visíveis ────
const METRIC_META: Record<
  AdsRuleMetric,
  { name: string; thresholdLabel: string; unit: '€' | '%' | 'x' | '' ; verb: (r: AdsRule, cur: string) => string }
> = {
  cpa_max: {
    name: 'CPA acima do limite',
    thresholdLabel: 'CPA máximo',
    unit: '€',
    verb: (r, c) => `age se CPA > ${r.threshold} ${c}`,
  },
  spend_no_conv: {
    name: 'Gasto sem conversão',
    thresholdLabel: 'Gasto sem venda',
    unit: '€',
    verb: (r, c) => `age se gastar ${r.threshold} ${c} sem venda`,
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
    verb: (r, c) => `age se CPM > ${r.threshold} ${c}`,
  },
  cpc_max: {
    name: 'CPC acima do limite',
    thresholdLabel: 'CPC máximo',
    unit: '€',
    verb: (r, c) => `age se CPC > ${r.threshold} ${c}`,
  },
  roas_scale: {
    name: 'ROAS bom → escalar',
    thresholdLabel: 'ROAS a partir de',
    unit: 'x',
    verb: (r) => `escala +${r.pct}% se ROAS ≥ ${r.threshold}`,
  },
  scheduled_scale: {
    name: 'Escala agendada com ROAS',
    thresholdLabel: 'ROAS a partir de',
    unit: 'x',
    verb: (r) => `escala +${r.pct}% às ${r.triggerTime || '18:00'} se ROAS ≥ ${r.threshold}`,
  },
  self_heal: {
    name: 'Autocura de orçamento',
    thresholdLabel: 'ROAS vencedor a partir de',
    unit: 'x',
    verb: (r) => `move até ${r.pct}% para vencedora com ROAS ≥ ${r.threshold}`,
  },
  schedule: {
    name: 'Horário de funcionamento',
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

function ruleTitle(rule: AdsRule): string {
  if (rule.pilot === 'protector') {
    if (rule.metric === 'cpa_max') return `Protetor: CPA acima de ${rule.threshold} → pausar`
    if (rule.metric === 'spend_no_conv') return `Protetor: gastou ${rule.threshold} sem venda → pausar`
    if (rule.metric === 'cpc_max') return `Protetor: CPC acima de ${rule.threshold} → reduzir orçamento`
  }
  if (rule.pilot === 'scaler') {
    return `Escalador: ROAS ≥ ${rule.threshold} → +${rule.pct}% (teto ${rule.budgetCap || 0}/dia)`
  }
  if (rule.pilot === 'schedule') return `Horário: ${rule.startTime || '00:00'}–${rule.endTime || '23:59'}`
  return rule.name || METRIC_META[rule.metric]?.name || rule.metric
}

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
  if (r.minSpend) parts.push(`min. ${r.minSpend} ${currency} gastos`)
  if (r.minSales) parts.push(`min. ${r.minSales} vendas`)
  if (r.budgetCap) parts.push(`teto ${r.budgetCap} ${currency}/dia`)
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

function timeUntil(iso: string | null): string {
  if (!iso) return 'ciclo automático'
  const seconds = Math.max(0, (new Date(iso).getTime() - Date.now()) / 1000)
  if (seconds < 60) return 'menos de 1 min'
  if (seconds < 3600) return `${Math.ceil(seconds / 60)} min`
  return `${Math.ceil(seconds / 3600)} h`
}

type EngineTone = 'primary' | 'warning' | 'error' | 'muted'

function engineStatusView(engine: AdsAutomationEngine, loadFailed = false): {
  title: string
  detail: string
  tone: EngineTone
} {
  if (loadFailed) {
    return {
      title: 'Estado indisponível',
      detail: 'Não foi possível atualizar a situação da automação. A última leitura pode estar desatualizada.',
      tone: 'error',
    }
  }

  if (engine.state === 'idle') {
    return {
      title: 'Automação desligada',
      detail: 'Nenhum piloto, regra, agendamento ou alerta está ativo.',
      tone: 'muted',
    }
  }

  if (engine.state === 'blocked') {
    const blockedCopy: Record<string, [string, string]> = {
      provider_unavailable: ['Conexão indisponível', 'O motor aguarda a conexão com o TikTok voltar.'],
      cache_unavailable: ['Persistência indisponível', 'O motor não roda sem o espelho durável de dados.'],
      worker_stopped: ['Motor parado', 'O processo automático não está em execução no servidor.'],
      worker_stale: ['Motor sem resposta', 'O processo automático deixou de confirmar atividade.'],
      policy_unavailable: ['Proteção indisponível', 'O motor não age sem conseguir ler os limites de segurança.'],
      policy_disabled: ['Proteção desligada', 'Ative a política de segurança antes de liberar ações automáticas.'],
      advertiser_blocked: ['Conta bloqueada pela proteção', 'Remova esta conta da lista de bloqueio para liberar ações automáticas.'],
      action_cap_disabled: ['Anti-loop desativado', 'Defina pelo menos 1 ação por hora nos limites de segurança.'],
    }
    const copy = blockedCopy[engine.reasonCode || ''] || ['Automação indisponível', 'O motor não pode operar neste momento.']
    return { title: copy[0], detail: copy[1], tone: 'error' }
  }

  if (engine.state === 'paused') {
    if (engine.reasonCode === 'kill_switch') {
      return {
        title: 'Novas ações bloqueadas',
        detail: 'O bloqueio de segurança impede novas alterações; campanhas atuais continuam como estão.',
        tone: 'error',
      }
    }
    return {
      title: 'Pausada por segurança',
      detail: 'Muitas ações falharam recentemente. O motor interrompeu novas tentativas.',
      tone: 'warning',
    }
  }

  if (engine.state === 'degraded') {
    const degradedCopy: Record<string, [string, string]> = {
      account_unauthorized: ['Conta sem acesso', 'A conexão não tem permissão para atualizar esta conta de anúncios.'],
      account_blocked: ['Conta temporariamente bloqueada', 'A automação aguarda o acesso aos dados voltar.'],
      sync_stale: ['Dados desatualizados', 'O motor não age com dados antigos e aguarda uma nova sincronização.'],
      sync_error: ['Falha na sincronização', 'Os dados não puderam ser atualizados; nenhuma ação usa esse snapshot.'],
      worker_error: ['Falha no último ciclo', 'O processo automático encontrou um erro e tentará novamente.'],
      last_run_error: ['Última avaliação com falha', engine.lastError || 'Uma ação da avaliação não foi concluída.'],
    }
    const copy = degradedCopy[engine.reasonCode || ''] || ['Automação com atenção', 'O motor aguarda uma condição segura para continuar.']
    return { title: copy[0], detail: copy[1], tone: 'warning' }
  }

  if (engine.state === 'starting') {
    return {
      title: 'Preparando automação',
      detail: engine.reasonCode === 'sync_never'
        ? 'Aguardando a primeira sincronização desta conta.'
        : 'Dados prontos; aguardando a primeira avaliação do motor.',
      tone: 'primary',
    }
  }

  if (engine.running || engine.reasonCode === 'evaluation_running') {
    return { title: 'Avaliando agora', detail: 'O motor está analisando esta conta.', tone: 'primary' }
  }

  const timing = engine.lastCompletedAt
    ? `Última avaliação ${timeAgo(engine.lastCompletedAt)}${engine.nextSweepAt ? ` · próxima em ${timeUntil(engine.nextSweepAt)}` : ''}.`
    : 'Aguardando a primeira avaliação.'
  if (engine.executionMode === 'simulation') {
    return { title: 'Modo teste ativo', detail: `Avalia e registra sem alterar o TikTok. ${timing}`, tone: 'warning' }
  }
  if (engine.executionMode === 'notify') {
    return { title: 'Monitorando', detail: `Apenas avisa quando algo precisa de atenção. ${timing}`, tone: 'primary' }
  }
  if (engine.executionMode === 'proposal') {
    return { title: 'Monitorando e propondo', detail: `Toda mudança aguarda sua aprovação. ${timing}`, tone: 'primary' }
  }
  return { title: 'Automação ativa', detail: timing, tone: 'primary' }
}

const ENGINE_MODE_LABEL: Record<AdsAutomationEngine['executionMode'], string> = {
  notify: 'Só avisa',
  proposal: 'Aguarda aprovação',
  simulation: 'Modo teste',
  automatic: 'Modo real',
  custom: 'Personalizado',
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
  const isBudget = draft.action === 'budget_up' || draft.action === 'budget_down' || ['roas_scale', 'scheduled_scale', 'self_heal'].includes(draft.metric)

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
          {['roas_scale', 'scheduled_scale', 'self_heal'].includes(draft.metric) && (
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
          {(draft.metric === 'cpa_max' || draft.metric === 'spend_no_conv' || draft.metric === 'cpc_max') && (
            <NumField label="Min. cliques" value={draft.minClicks} onChange={(v) => set({ minClicks: v })} />
          )}
          {draft.metric !== 'cpm_max' && draft.metric !== 'cpc_max' && (
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
          {['roas_scale', 'scheduled_scale', 'self_heal'].includes(draft.metric) && (
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

      {draft.metric === 'scheduled_scale' && (
        <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-[var(--hover)] p-3">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Dias da escala agendada">
            {DAY_LABELS.map((day, index) => {
              const selected = (draft.days || []).includes(index)
              return <button key={day} type="button" aria-pressed={selected} onClick={() => set({ days: selected ? (draft.days || []).filter((value) => value !== index) : [...(draft.days || []), index].sort() })} className={cn('rounded-full border px-2.5 py-1 text-[11px]', selected ? 'border-primary/60 bg-primary/10 text-primary' : 'border-border text-muted-foreground')}>{day}</button>
            })}
          </div>
          <label className="flex max-w-[180px] flex-col gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            Horário no fuso do TikTok
            <input type="time" value={draft.triggerTime || '18:00'} onChange={(event) => set({ triggerTime: event.target.value })} className="input-neon rounded-lg border border-border bg-background px-2.5 py-1.5 font-mono text-xs text-foreground" />
          </label>
        </div>
      )}

      {draft.metric === 'self_heal' && (
        <div className="grid grid-cols-2 gap-2.5 rounded-xl border border-border bg-[var(--hover)] p-3 sm:grid-cols-3">
          <NumField label="ROAS máx. doadora" value={draft.donorRoasMax} onChange={(value) => set({ donorRoasMax: value })} suffix="x" />
          <NumField label="Uso do orçamento" value={draft.budgetUtilizationPct} onChange={(value) => set({ budgetUtilizationPct: value })} suffix="%" hint="vencedora perto de esgotar" />
          <NumField label="Min. gasto doadora" value={draft.minSpend} onChange={(value) => set({ minSpend: value })} suffix={currency} />
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

// ═════════════════════════════════════════════════════════════════════════════
export function AutomationPanel({
  active,
  currency = '€',
  adAccountId = '',
  onOpenLimits,
}: {
  active: boolean
  currency?: string
  adAccountId?: string
  onOpenLimits?: () => void
}) {
  const { data, mutate, isLoading, isValidating, error } = useAdsRules(active, adAccountId)
  const { data: safetyData } = useAdsSafetyPolicy(active)

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [alertsExpanded, setAlertsExpanded] = useState(false)
  const [alertsDraft, setAlertsDraft] = useState<AdsAlertsConfig | null>(null)
  // Modo avançado: esconde o editor técnico de regras por padrão — pilotos
  // resolvem o dia a dia; o gestor abre isto só quando quer o controle fino.
  const [advanced, setAdvanced] = usePersistedState('ads:automation:advanced', false)
  const [, setRelativeClock] = useState(0)

  // timeAgo/timeUntil também precisam continuar verdadeiros com a tela aberta.
  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => setRelativeClock((value) => value + 1), 60_000)
    return () => window.clearInterval(timer)
  }, [active])

  const rules = data?.rules ?? []
  const log = data?.log ?? []
  const alertsCfg = data?.alerts
  const enabledCount = rules.filter((r) => r.enabled).length
  const automaticBlockedReason = (() => {
    const policy = safetyData?.policy
    if (!policy) return null
    if (!policy.enabled) return 'Ative a política de segurança antes de liberar ações automáticas.'
    if (policy.blockedAdvertiserIds.map(String).includes(String(adAccountId))) {
      return 'Esta conta de anúncio está bloqueada pela política de segurança.'
    }
    if (!(policy.maxActionsPerHour > 0)) {
      return 'Defina pelo menos 1 ação por hora para manter o anti-loop ativo.'
    }
    return null
  })()

  async function handleSaveError(error: unknown, fallback: string) {
    if (error instanceof ApiError && error.code === 'AUTOMATION_REVISION_CONFLICT') {
      await mutate()
      toast.error('Configuração atualizada em outra aba', { hint: 'Recarregamos a versão mais recente. Revise e tente novamente.' })
      return
    }
    toast.error(fallback, { hint: error instanceof Error ? error.message : undefined })
  }

  // PUT da lista COMPLETA (contrato da rota) com update otimista + rollback.
  async function saveRules(next: AdsRule[], okMsg: string) {
    setSaving(true)
    const prev = data
    mutate(prev ? { ...prev, rules: next } : undefined, { revalidate: false })
    try {
      const r = await apiSend<AdsRulesResponse>('/api/ads/rules', 'PUT', {
        adAccountId,
        revision: data?.revision,
        rules: next,
      })
      mutate(r, { revalidate: false })
      toast.success(okMsg)
      return true
    } catch (e) {
      mutate(prev, { revalidate: false }) // rollback — a UI nunca mente
      await handleSaveError(e, 'Falha ao salvar')
      return false
    } finally {
      setSaving(false)
    }
  }

  async function toggleRule(rule: AdsRule, on: boolean) {
    await saveRules(
      rules.map((r) => (r.id === rule.id ? { ...r, enabled: on } : r)),
      on ? `Regra ativada: ${ruleTitle(rule)}` : `Regra pausada: ${ruleTitle(rule)}`,
    )
  }

  async function setPilot(pilot: PilotId, opts: { enabled: boolean; intensity: Intensity }) {
    const mode = data?.autonomy === 'auto' ? 'execute' as const : 'proposal' as const
    const next = applyPilot(rules, pilot, { ...opts, mode })
    const title = PILOTS.find((item) => item.id === pilot)?.title ?? pilot
    await saveRules(next, opts.enabled ? `${title} ligado (${opts.intensity})` : `${title} desligado`)
  }

  async function setAutonomy(autonomy: AdsAutomationAutonomy) {
    if (!data || saving || autonomy === data.autonomy) return
    setSaving(true)
    try {
      const next = await apiSend<AdsRulesResponse>('/api/ads/automation/autonomy', 'PUT', {
        adAccountId,
        revision: data.revision,
        autonomy,
      })
      mutate(next, { revalidate: false })
      toast.success({
        notify: 'Só avisar: nenhuma regra pode agir; alertas estão ligados',
        propose: 'Propor: toda regra aguarda sua aprovação',
        auto: 'Agir sozinho: toda regra executa dentro dos limites',
      }[autonomy])
    } catch (error) {
      await handleSaveError(error, 'Falha ao alterar a autonomia')
    } finally {
      setSaving(false)
    }
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
    if (rules.length >= 12) {
      toast.error('Limite de 12 regras atingido', { hint: 'Remova uma regra que não usa antes de criar outra.' })
      return
    }
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

  // “Avaliar agora” roda o ciclo REAL conforme a autonomia atual: em Propor,
  // cria propostas; em Agir sozinho, pode executar. O nome evita a falsa
  // promessa de simulação que o antigo “Testar agora” transmitia.
  async function testNow() {
    if (testing) return
    setTesting(true)
    setTestResult(null)
    try {
      const r = await apiSend<AdsRulesRunResponse>('/api/ads/rules/run', 'POST', { adAccountId })
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
      const saved = await apiSend<AdsAlertsConfig>('/api/ads/alerts', 'PUT', {
        ...cfg,
        adAccountId,
        revision: data?.revision,
      })
      if (data) {
        mutate({
          ...data,
          alerts: saved,
          revision: saved.revision ?? data.revision,
          autonomy: saved.autonomy ?? data.autonomy,
          updatedAt: saved.updatedAt ?? data.updatedAt,
        }, { revalidate: false })
      }
      // O estado operacional depende de worker, sync e política; nunca o
      // deduzimos otimisticamente só pelo switch salvo.
      mutate().catch(() => {})
      toast.success(cfg.enabled ? 'Alertas ativados' : 'Alertas desligados')
      setAlertsExpanded(false)
      setAlertsDraft(null)
    } catch (e) {
      await handleSaveError(e, 'Falha ao salvar alertas')
    } finally {
      setSaving(false)
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

  if (error && !data) {
    return (
      <ErrorState
        title="Não foi possível consultar a automação"
        description="O estado do motor não será presumido. Tente carregar novamente."
        onRetry={() => mutate()}
        retrying={isValidating}
      />
    )
  }

  const engineView = data ? engineStatusView(data.engine, !!error) : null
  const engineTone = engineView?.tone

  return (
    <div className="flex flex-col gap-3">
      {/* ── Pilotos: a cara padrão da automação (linguagem de gestor) ── */}
      <PilotsPanel
        currency={currency}
        rules={rules}
        autonomy={data?.autonomy ?? 'custom'}
        saving={saving}
        onSetPilot={setPilot}
        onSetAutonomy={setAutonomy}
        automaticBlockedReason={automaticBlockedReason}
        onOpenLimits={onOpenLimits}
      />

      {/* Um único estado operacional. Revisão/IDs ficam fora do fluxo normal. */}
      {data && engineView && (
        <div
          className={cn(
            'flex flex-col gap-2 rounded-xl border bg-card px-3 py-2.5 sm:flex-row sm:items-center',
            engineTone === 'primary' && 'border-primary/30',
            engineTone === 'warning' && 'border-warning/40',
            engineTone === 'error' && 'border-error/40',
            engineTone === 'muted' && 'border-border',
          )}
          aria-label={`Estado da automação da conta ${data.advertiserId}: ${engineView.title}`}
          title={`Configuração salva ${timeAgo(data.updatedAt)} · revisão ${data.revision}`}
        >
          <div className="flex min-w-0 flex-1 items-start gap-2">
            <span
              className={cn(
                'mt-1 size-2 shrink-0 rounded-full',
                engineTone === 'primary' && 'bg-primary',
                engineTone === 'warning' && 'bg-warning',
                engineTone === 'error' && 'bg-error',
                engineTone === 'muted' && 'bg-muted-foreground',
                data.engine.running && 'animate-pulse',
              )}
              aria-hidden="true"
            />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-foreground">{engineView.title}</p>
              <p className="text-[11px] leading-relaxed text-muted">{engineView.detail}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 sm:pl-3">
            <Clock3 className="size-3.5 text-muted" aria-hidden="true" />
            <span className="rounded-full bg-secondary px-2 py-1 text-[10px] font-medium text-muted">
              {ENGINE_MODE_LABEL[data.engine.executionMode]}
            </span>
            {error && (
              <button
                type="button"
                onClick={() => mutate()}
                disabled={isValidating}
                className="rounded-full px-2 py-1 text-[10px] font-medium text-error transition-colors hover:bg-error/10 disabled:opacity-60"
              >
                {isValidating ? 'Atualizando…' : 'Tentar novamente'}
              </button>
            )}
          </div>
        </div>
      )}

      <RejectionInbox
        active={active}
        adAccountId={adAccountId}
        autoAppeal={alertsCfg?.autoAppealSmartPlus === true}
        canAutoAppeal={data?.autonomy === 'auto'}
        saving={saving || !alertsCfg}
        onAutoAppealChange={(enabled) => {
          if (!alertsCfg) return
          saveAlerts({ ...alertsCfg, enabled: true, rejectedAds: true, autoAppealSmartPlus: enabled })
        }}
      />

      {/* ── Alterna o editor técnico de regras (escondido por padrão) ── */}
      <button
        type="button"
        onClick={() => setAdvanced(!advanced)}
        aria-expanded={advanced}
        data-tour="ads-advanced"
        className="flex items-center justify-center gap-1.5 self-start rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-muted transition-colors hover:bg-secondary hover:text-foreground"
      >
        <SlidersHorizontal className="size-3" aria-hidden="true" />
        {advanced ? 'Ocultar configurações' : 'Configurações avançadas'}
        <ChevronDown className={cn('size-3 transition-transform', advanced && 'rotate-180')} aria-hidden="true" />
      </button>

      {/* ── Regras: linhas expansíveis com switch (só no modo avançado) ── */}
      {advanced && (
      <GlassCard className="p-4">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">Regras automáticas</h3>
            <span className="rounded-full bg-[var(--hover)] px-2 py-0.5 font-mono text-[10px] tabular-nums text-muted">
              {enabledCount} de {rules.length} ativas
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center sm:gap-1.5">
            <button type="button" className="btn-ghost justify-center gap-1 text-xs" onClick={testNow} disabled={testing}>
              {testing ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Activity className="size-3.5" aria-hidden="true" />
              )}
              Avaliar agora
            </button>
            <button type="button" className="btn-primary justify-center gap-1 text-xs" onClick={addRule} disabled={saving || rules.length >= 12} title={rules.length >= 12 ? 'Limite de 12 regras por conta' : undefined}>
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
          <p className="py-6 text-center text-xs text-muted">
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
                <li key={r.id} className="rounded-xl border border-border bg-background p-3">
                  <div className="flex items-start justify-between gap-3">
                    {/* Cabeçalho da linha = botão do acordeão */}
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => setExpandedId(open ? null : r.id)}
                      className="min-w-0 flex-1 rounded-lg text-left transition-colors hover:bg-[var(--hover)]/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs font-medium text-foreground">
                          {ruleTitle(r)}
                        </span>
                        <span
                          className={cn(
                            'flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold',
                            executes ? 'border-primary/20 bg-primary/10 text-primary' : 'border-warning/20 bg-warning/10 text-warning',
                          )}
                          title={
                            executes
                              ? 'Age sozinha quando dispara — registrado na auditoria'
                              : 'Grava proposta — você aprova antes de agir'
                          }
                        >
                          <span className={cn('size-1.5 rounded-full', executes ? 'bg-primary' : 'bg-warning')} aria-hidden="true" />
                          {executes ? 'Executa' : 'Propõe'}
                        </span>
                        {r.pilot && (
                          <span
                            className="flex items-center gap-1 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary"
                            title="Regra gerada por um piloto — controlada na visão simples acima"
                          >
                            piloto
                          </span>
                        )}
                        {r.preset && !r.pilot && (
                          <span
                            className="flex items-center gap-1 rounded-full bg-[var(--hover)] px-1.5 py-0.5 text-[10px] text-muted"
                            title="Regra pré-configurada de fábrica"
                          >
                            <Sparkles className="size-2.5" aria-hidden="true" />
                            padrão
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block text-pretty text-[11px] leading-relaxed text-muted">
                        {summarize(r, currency)}
                      </span>
                      <span className="mt-0.5 block text-[10px] text-faint">
                        {last || 'nunca disparou'}
                      </span>
                    </button>
                    <Switch
                      checked={r.enabled}
                      disabled={saving}
                      onCheckedChange={(on) => toggleRule(r, on)}
                      aria-label={`${r.enabled ? 'Pausar' : 'Ativar'} regra: ${ruleTitle(r)}`}
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
                </li>
              )
            })}
          </ul>
        )}
      </GlassCard>
      )}

      {/* Limites de segurança + modo teste — atalho para a política da conta */}
      {advanced && onOpenLimits && (
        <button
          type="button"
          onClick={onOpenLimits}
          className="flex items-center gap-2 self-start rounded-xl border border-border bg-background px-3 py-2 text-xs font-medium text-foreground transition-colors hover:border-primary/40"
        >
          <ShieldCheck className="size-3.5 text-primary" aria-hidden="true" />
          Limites de segurança
        </button>
      )}

      {/* ── Alertas: mesma linguagem — switch + expansão inline ── */}
      <GlassCard className="p-4">
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
                  ? `Ativos · gasto sem venda, CPA${alertsCfg.rejectedAds ? ' e reprovações' : ''}`
                  : 'Desligados · nenhuma notificação de performance'}
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

      {/* ── O que o robô fez: feed reutilizável (Hoje reusa) ── */}
      <GlassCard className="p-4">
        <div className="mb-2 flex items-center gap-2">
          <ClipboardList className="size-4 text-muted-foreground" aria-hidden="true" />
          <h3 className="text-sm font-semibold text-foreground">O que o robô fez</h3>
        </div>
        <RulesLogList
          log={log}
          limit={12}
          filterable
          emptyText='Nenhuma automação executada neste período.'
        />
      </GlassCard>

    </div>
  )
}
