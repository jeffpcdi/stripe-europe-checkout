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

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSWRConfig } from 'swr'
import {
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
import { Skeleton } from '@/components/skeleton'
import { ErrorState } from '@/components/error-state'
import { Switch } from '@/components/switch'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { PilotsPanel } from './pilots-panel'
import { RejectionInbox } from './rejection-inbox'
import { RulesLogList } from './rules-log-list'
import { cn } from '@/lib/utils'
import { apiCacheKeyMatches } from '@/lib/cache-consistency'
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
  if (rule.pilot === 'schedule') return `Horários: ${rule.startTime || '00:00'}–${rule.endTime || '23:59'}`
  if (rule.pilot) return `${METRIC_META[rule.metric]?.name || rule.metric} · ${ACTION_LABEL[rule.action] || rule.action}`

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
    ['roas_scale', 'scheduled_scale', 'self_heal'].includes(r.metric) ? `${ACTION_LABEL[r.action] || r.action} em ${r.pct}% quando ROAS ≥ ${r.threshold}${r.metric === 'scheduled_scale' ? ` às ${r.triggerTime || '18:00'}` : ''}` : `${ACTION_LABEL[r.action] || r.action} ${meta.verb(r, currency).replace(/^age /, '')}`,
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
      cache_unavailable: ['Não é possível salvar agora', 'O motor não roda sem o espelho durável de dados.'],
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
    return { title: 'Avaliando agora', detail: 'Analisando as campanhas desta conta.', tone: 'primary' }
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
  if (engine.executionMode === 'automatic') {
    return { title: 'Aplicando automaticamente', detail: `As regras podem agir dentro dos limites de segurança. ${timing}`, tone: 'primary' }
  }
  return { title: 'Automação ativa', detail: timing, tone: 'primary' }
}

const ENGINE_MODE_LABEL: Record<AdsAutomationEngine['executionMode'], string> = {
  notify: 'Só avisa',
  proposal: 'Aguarda aprovação',
  simulation: 'Modo teste',
  automatic: 'Aplica sozinho',
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
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1">
        <input
          type="number"
          inputMode="decimal"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
          className="h-10 w-full min-w-0 rounded-lg border border-border bg-background px-3 text-sm tabular-nums text-foreground outline-none transition-colors focus:border-brand-cyan/60"
        />
        {suffix ? <span className="shrink-0 text-xs text-muted-foreground">{suffix}</span> : null}
      </span>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
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
  automaticBlockedReason,
  onOpenLimits,
  onDirtyChange,
}: {
  rule: AdsRule
  currency: string
  onSave: (r: AdsRule) => Promise<boolean>
  onCancel: () => void
  onDelete?: () => void
  saving: boolean
  automaticBlockedReason?: string | null
  onOpenLimits?: () => void
  onDirtyChange?: (ruleId: string, dirty: boolean) => void
}) {
  const [draft, setDraft] = useState<AdsRule>(rule)
  const [baseline, setBaseline] = useState<AdsRule>(rule)
  const [confirmEscapeDiscard, setConfirmEscapeDiscard] = useState(false)
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline)
  const incomingSignature = JSON.stringify(rule)
  const meta = METRIC_META[draft.metric]
  const set = (patch: Partial<AdsRule>) => setDraft((d) => ({ ...d, ...patch }))
  const isSchedule = draft.metric === 'schedule'
  const isBudget = draft.action === 'budget_up' || draft.action === 'budget_down' || ['roas_scale', 'scheduled_scale', 'self_heal'].includes(draft.metric)

  useEffect(() => {
    const incoming = JSON.stringify(rule)
    const current = JSON.stringify(draft)
    const saved = JSON.stringify(baseline)
    if (current === saved || current === incoming) {
      setDraft(rule)
      setBaseline(rule)
    }
  }, [incomingSignature])
  useEffect(() => { onDirtyChange?.(rule.id, dirty) }, [dirty, onDirtyChange, rule.id])
  function cancelEditing() {
    setDraft(baseline)
    onDirtyChange?.(rule.id, false)
    onCancel()
  }
  async function saveEditing() {
    const next = clampRule(draft)
    const ok = await onSave(next)
    if (!ok) return
    setDraft(next)
    setBaseline(next)
    onDirtyChange?.(rule.id, false)
  }

  // ESC recolhe uma regra limpa; com draft, pede confirmação antes de descartar.
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      if (dirty) setConfirmEscapeDiscard(true)
      else cancelEditing()
    }
    el.addEventListener('keydown', onKey)
    return () => el.removeEventListener('keydown', onKey)
  }, [dirty, baseline, onCancel])

  return (
    <div ref={ref} className="flex flex-col gap-3 border-t border-border/60 pt-3">
      {/* Modo Propor vs. Executar — a decisão mais importante da regra (F3),
          antes invisível. Par de rádios com consequência explícita. */}
      <fieldset>
        <legend className="mb-2 text-xs font-medium text-foreground">
          Quando disparar
        </legend>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {(
            [
              ['proposal', 'Pedir aprovação', 'Nada muda no TikTok até você aprovar.'],
              ['execute', 'Executar automaticamente', 'A ação é enviada automaticamente quando a condição for atingida.'],
            ] as const
          ).map(([value, label, desc]) => {
            const selected = (draft.mode ?? 'proposal') === value
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={value === 'execute' && !!automaticBlockedReason}
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
                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{desc}</span>
              </button>
            )
          })}
        </div>
        {automaticBlockedReason ? <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-warning"><span>{automaticBlockedReason}</span>{onOpenLimits ? <button type="button" className="btn-ghost min-h-10 text-xs" onClick={onOpenLimits}>Ajustar limites</button> : null}</div> : null}
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
            hint={draft.lookbackDays < 3 ? 'Períodos curtos podem ter poucos dados' : '1–30'}
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
              hint="Recomendado para impedir aumentos acima de um valor definido"
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
                    'min-h-10 rounded-lg border px-3 py-2 text-xs font-medium transition-colors',
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
              <span className="text-xs font-medium text-muted-foreground">Início</span>
              <input
                type="time"
                value={draft.startTime ?? '08:00'}
                onChange={(e) => set({ startTime: e.target.value })}
                className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-brand-cyan/60"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">Fim</span>
              <input
                type="time"
                value={draft.endTime ?? '23:00'}
                onChange={(e) => set({ endTime: e.target.value })}
                className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-brand-cyan/60"
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
              return <button key={day} type="button" aria-pressed={selected} onClick={() => set({ days: selected ? (draft.days || []).filter((value) => value !== index) : [...(draft.days || []), index].sort() })} className={cn('min-h-10 rounded-lg border px-3 py-2 text-xs', selected ? 'border-primary/60 bg-primary/10 text-primary' : 'border-border text-muted-foreground')}>{day}</button>
            })}
          </div>
          <label className="flex max-w-[180px] flex-col gap-1 text-xs font-medium text-muted-foreground">
            Horário no fuso do TikTok
            <input type="time" value={draft.triggerTime || '18:00'} onChange={(event) => set({ triggerTime: event.target.value })} className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-brand-cyan/60" />
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
            className="btn-ghost min-h-10 gap-1 px-3 text-xs text-muted-foreground hover:bg-error/10 hover:text-error"
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
          <button type="button" className="btn-ghost min-h-10 px-3 text-xs" onClick={cancelEditing} disabled={saving}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn-primary min-h-10 px-3.5 text-xs"
            onClick={() => void saveEditing()}
            disabled={saving}
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : null}
            Salvar
          </button>
        </div>
      </div>
      <ConfirmDialog
        open={confirmEscapeDiscard}
        title="Descartar alterações desta regra?"
        description="As mudanças feitas nesta regra ainda não foram salvas."
        confirmLabel="Descartar"
        appearance="quiet"
        tone="danger"
        onConfirm={() => { setConfirmEscapeDiscard(false); cancelEditing() }}
        onClose={() => setConfirmEscapeDiscard(false)}
      />
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
export function AutomationPanel({
  active,
  currency = 'BRL',
  adAccountId = '',
  onOpenLimits,
  onDirtyChange,
  focusAlertsRequest = 0,
}: {
  active: boolean
  currency?: string
  adAccountId?: string
  onOpenLimits?: () => void
  onDirtyChange?: (dirty: boolean) => void
  focusAlertsRequest?: number
}) {
  const rulesQuery = useAdsRules(active, adAccountId)
  const { mutate, isLoading, isValidating, error } = rulesQuery
  const lastDataRef = useRef<AdsRulesResponse | null>(null)
  if (rulesQuery.data) lastDataRef.current = rulesQuery.data
  const data = rulesQuery.data ?? lastDataRef.current ?? undefined
  const { data: safetyData, error: safetyError } = useAdsSafetyPolicy(active)
  const { mutate: mutateCache } = useSWRConfig()

  const [newRule, setNewRule] = useState<AdsRule | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [alertsExpanded, setAlertsExpanded] = useState(false)
  const [alertsDraft, setAlertsDraft] = useState<AdsAlertsConfig | null>(null)
  const alertsButtonRef = useRef<HTMLButtonElement>(null)
  const lastAlertsFocusRequestRef = useRef(0)
  const [historyExpanded, setHistoryExpanded] = useState(false)
  const [confirmAutomaticRun, setConfirmAutomaticRun] = useState(false)
  const [deleteRuleId, setDeleteRuleId] = useState<string | null>(null)
  const [confirmRuleEnable, setConfirmRuleEnable] = useState<AdsRule | null>(null)
  const [pilotDirty, setPilotDirty] = useState(false)
  const [dirtyRuleIds, setDirtyRuleIds] = useState<Set<string>>(() => new Set())
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
  const alertsDirty = Boolean(alertsDraft && alertsCfg && (Number(alertsDraft.spendNoConv) !== Number(alertsCfg.spendNoConv) || Number(alertsDraft.cpaMax) !== Number(alertsCfg.cpaMax) || Number(alertsDraft.lookbackDays) !== Number(alertsCfg.lookbackDays) || Boolean(alertsDraft.enabled) !== Boolean(alertsCfg.enabled)))
  useEffect(() => {
    if (!active || !focusAlertsRequest || focusAlertsRequest === lastAlertsFocusRequestRef.current) return
    setAlertsExpanded(true)
    requestAnimationFrame(() => {
      alertsButtonRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      alertsButtonRef.current?.focus({ preventScroll: true })
    })
    if (!alertsCfg) return
    lastAlertsFocusRequestRef.current = focusAlertsRequest
    if (!alertsDraft) setAlertsDraft(alertsCfg)
  }, [active, alertsCfg, alertsDraft, focusAlertsRequest])
  const markRuleDirty = useCallback((ruleId: string, dirty: boolean) => {
    setDirtyRuleIds((current) => {
      const next = new Set(current)
      if (dirty) next.add(ruleId)
      else next.delete(ruleId)
      return next
    })
  }, [])
  const localDirty = alertsDirty || pilotDirty || dirtyRuleIds.size > 0 || Boolean(newRule)
  useEffect(() => { onDirtyChange?.(localDirty) }, [localDirty, onDirtyChange])
  const enabledCount = rules.filter((r) => r.enabled).length
  const automaticBlockedReason = (() => {
    const policy = safetyData?.policy
    if (safetyError || !policy) return 'Aguarde a confirmação dos limites de segurança. Se a conexão falhar, tente novamente.'
    if (!policy.enabled) return 'Ative a política de segurança antes de liberar ações automáticas.'
    if ((policy.blockedAdvertiserIds ?? []).map(String).includes(String(adAccountId))) {
      return 'Esta conta de anúncio está bloqueada pela política de segurança.'
    }
    if (!(policy.maxActionsPerHour > 0)) {
      return 'Defina pelo menos 1 ação por hora para manter o anti-loop ativo.'
    }
    return null
  })()

  async function refreshAutomationDependents(options: { campaigns?: boolean; proposals?: boolean; alerts?: boolean } = {}) {
    const paths = [
      '/api/ads/campaign-decisions',
      ...(options.proposals ? ['/api/ads/proposals'] : []),
      ...(options.alerts ? ['/api/ads/alerts'] : []),
      ...(options.campaigns ? ['/api/ads/tree', '/api/ads/kpis', '/api/ads/roas', '/api/ads/sync-status'] : []),
    ]
    await mutateCache((key) => apiCacheKeyMatches(key, paths))
  }

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
    if (!data || saving) return false
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
      // A mesma automação alimenta a coluna de decisão em Campanhas/Overview.
      // Revalida esse contrato derivado imediatamente para não esperar 60s.
      void refreshAutomationDependents().catch(() => {})
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
    return saveRules(
      rules.map((r) => (r.id === rule.id ? { ...r, enabled: on } : r)),
      on ? `Regra ativada: ${ruleTitle(rule)}` : `Regra pausada: ${ruleTitle(rule)}`,
    )
  }

  async function setPilot(pilot: PilotId, opts: { enabled: boolean; intensity: Intensity; toggleOnly?: boolean }) {
    const mode = data?.autonomy === 'auto' ? 'execute' as const : 'proposal' as const
    const next = opts.toggleOnly && rules.some(rule => rule.pilot === pilot)
      ? rules.map(rule => rule.pilot === pilot ? { ...rule, enabled: opts.enabled } : rule)
      : applyPilot(rules, pilot, { ...opts, mode })
    const title = PILOTS.find((item) => item.id === pilot)?.title ?? pilot
    return saveRules(next, opts.enabled ? `${title} ligado` : `${title} desligado`)
  }

  async function setAutonomy(autonomy: AdsAutomationAutonomy) {
    if (!data || saving || autonomy === data.autonomy) return false
    setSaving(true)
    try {
      const next = await apiSend<AdsRulesResponse>('/api/ads/automation/autonomy', 'PUT', {
        adAccountId,
        revision: data.revision,
        autonomy,
      })
      mutate(next, { revalidate: false })
      void refreshAutomationDependents().catch(() => {})
      toast.success({
        notify: 'Só avisar: nenhuma regra pode agir; alertas estão ligados',
        propose: 'Pedir aprovação: as regras aguardam sua decisão',
        auto: 'Aplicar sozinho: as regras seguem os limites definidos',
      }[autonomy])
      return true
    } catch (error) {
      await handleSaveError(error, 'Falha ao alterar a autonomia')
      return false
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
    if (ok) { setExpandedId(null); setNewRule(null); markRuleDirty(updated.id, false) }
    return ok
  }

  async function deleteRule(id: string) {
    if (newRule?.id === id) { setNewRule(null); setExpandedId(null); markRuleDirty(id, false); return }
    const ok = await saveRules(rules.filter((r) => r.id !== id), 'Regra removida')
    if (ok) { markRuleDirty(id, false); setExpandedId(null) }
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
    setNewRule(draft)
    setExpandedId(draft.id)
  }

  const runLabel = data?.engine.executionMode === 'notify' ? 'Verificar agora'
    : data?.engine.executionMode === 'proposal' ? 'Avaliar e gerar propostas'
      : data?.engine.executionMode === 'simulation' ? 'Simular agora'
        : data?.engine.executionMode === 'automatic' ? 'Executar avaliação agora'
          : 'Avaliar agora'

  function requestRun() {
    if (data?.engine.executionMode === 'automatic') { setConfirmAutomaticRun(true); return }
    void testNow()
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
        r.skipped ? 'A avaliação não foi executada neste momento. Confira o estado do motor e os limites.' : executed.length === 0
          ? (data?.engine.executionMode === 'simulation' ? 'Simulação concluída · nenhuma regra dispararia agora.' : 'Avaliação concluída · nenhuma regra disparou agora.')
          : `${executed.length} ${executed.length === 1 ? 'disparo' : 'disparos'}${proposals ? ` (${proposals} proposta${proposals > 1 ? 's' : ''} criada${proposals > 1 ? 's' : ''})` : ''} — veja o log abaixo.`,
      )
      // A avaliação pode criar propostas OU executar pause/budget. Atualize
      // as outras superfícies afetadas no mesmo ciclo, sem esperar polling.
      await Promise.allSettled([
        mutate(),
        refreshAutomationDependents({ campaigns: executed.some((entry) => !entry.proposed && !entry.simulated), proposals: true }),
      ])
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
      // deduzimos otimisticamente só pelo switch salvo. O NeedsYouInbox usa
      // /api/ads/alerts separado, então ele também precisa ser revalidado.
      void Promise.allSettled([mutate(), refreshAutomationDependents({ alerts: true })])
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
  const engineNeedsSafetyReview = Boolean(data && ['kill_switch', 'policy_disabled', 'advertiser_blocked', 'action_cap_disabled'].includes(String(data.engine.reasonCode || '')))

  return (
    <div className="flex flex-col gap-3">
      <section className="border-b border-border/60 pb-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <h2 className="text-base font-semibold text-foreground">Automação</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Monitore campanhas, peça aprovação ou delegue ações ao ROI-NADOS dentro dos limites de segurança.</p>
          </div>
          <button type="button" className="btn-primary min-h-10 self-start px-4 text-xs" onClick={requestRun} disabled={testing || !data} title="Executa uma avaliação imediata usando as regras e a autonomia atuais">
            {testing ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Activity className="size-3.5" aria-hidden="true" />}
            {testing ? 'Avaliando…' : runLabel}
          </button>
        </div>
        {testResult ? <p className="mt-3 border-l-2 border-brand-cyan pl-3 text-xs text-muted-foreground">{testResult}</p> : null}
      </section>

      {/* ── Pilotos: a cara padrão da automação (linguagem de gestor) ── */}


      {/* Um único estado operacional. Revisão/IDs ficam fora do fluxo normal. */}
      {data && engineView && (
        <div
          className={cn(
            'flex flex-col gap-2 border-b border-border/60 py-4 sm:flex-row sm:items-center',
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
                
              )}
              aria-hidden="true"
            />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">{engineView.title}</p>
              <p className="text-xs leading-relaxed text-muted-foreground">{engineView.detail}</p>
              <p className="mt-1 text-xs text-muted-foreground">{enabledCount} {enabledCount === 1 ? 'regra ativa' : 'regras ativas'} · {alertsCfg?.enabled ? 'alertas ativos' : 'alertas desligados'}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 sm:pl-3">
            <Clock3 className="size-3.5 text-muted" aria-hidden="true" />
            <span className="text-xs text-muted-foreground">{ENGINE_MODE_LABEL[data.engine.executionMode]}</span>
            {engineNeedsSafetyReview && onOpenLimits ? <button type="button" className="btn-ghost min-h-10 px-3 text-xs text-warning" onClick={onOpenLimits}>Revisar segurança</button> : null}
            {error && (
              <button
                type="button"
                onClick={() => mutate()}
                disabled={isValidating}
                className="btn-ghost min-h-10 px-3 text-xs text-error disabled:opacity-60"
              >
                {isValidating ? 'Atualizando…' : 'Tentar novamente'}
              </button>
            )}
          </div>
        </div>
      )}

      <PilotsPanel
        currency={currency}
        rules={rules}
        autonomy={data?.autonomy ?? 'custom'}
        saving={saving}
        onSetPilot={setPilot}
        onSetAutonomy={setAutonomy}
        automaticBlockedReason={automaticBlockedReason}
        onOpenLimits={onOpenLimits}
        onDirtyChange={setPilotDirty}
      />

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

      {/* ── Alertas: mesma linguagem — switch + expansão inline ── */}
      <section className="border-b border-border/60 pb-4">
        <div className="flex items-start justify-between gap-3">
          <button
            ref={alertsButtonRef}
            type="button"
            aria-expanded={alertsExpanded}
            onClick={() => {
              if (!alertsExpanded && !alertsDraft) setAlertsDraft(alertsCfg ?? { enabled: false, spendNoConv: 10, cpaMax: 0, lookbackDays: 2 })
              setAlertsExpanded((v) => !v)
            }}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left transition-colors hover:bg-[var(--hover)]/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-foreground">Alertas de performance</span>
              <span className="block text-xs text-muted-foreground">
                {alertsCfg?.enabled
                  ? `Ativos · performance${alertsCfg.rejectedAds ? ' + reprovações' : ''}`
                  : 'Desligados'}
              </span>
              {alertsDirty && !alertsExpanded ? <span className="mt-1 block text-xs font-medium text-warning">Alterações não salvas</span> : null}
            </span>
          </button>
          <Switch
            checked={!!alertsCfg?.enabled}
            disabled={saving || !alertsCfg}
            onCheckedChange={(on) => alertsCfg && saveAlerts({ ...(alertsDraft ?? alertsCfg), enabled: on })}
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
                hint={alertsDraft.lookbackDays < 3 ? 'Janelas curtas podem ter poucos dados' : '1–30 dias'}
              />
            </div>
            {alertsDirty ? <p className="text-xs text-warning">Alterações não salvas</p> : null}
            <div className="flex items-center justify-end gap-1.5">
              <button
                type="button"
                className="btn-ghost min-h-10 px-3 text-xs"
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
                className="btn-primary min-h-10 px-3.5 text-xs"
                onClick={() => saveAlerts({ ...alertsDraft, enabled: true })}
                disabled={saving || !alertsDirty}
              >
                {saving ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : null}
                {alertsCfg?.enabled ? 'Salvar alterações' : 'Salvar e ativar'}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ── Histórico de ações ── */}
      <section className="border-b border-border/60 pb-4">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div><h3 className="text-sm font-semibold text-foreground">Atividade recente</h3><p className="mt-1 text-xs text-muted-foreground">Últimas decisões, propostas, simulações e execuções da automação.</p></div>
          {log.length > 3 ? <button type="button" onClick={() => setHistoryExpanded((value) => !value)} className="btn-ghost min-h-10 self-start px-3 text-xs">{historyExpanded ? 'Mostrar menos' : 'Ver histórico completo'}</button> : null}
        </div>
        <RulesLogList log={log} limit={historyExpanded ? 12 : 3} filterable={historyExpanded} emptyText="Nenhuma automação executada neste período." />
      </section>
      {/* ── Alterna o editor técnico de regras (escondido por padrão) ── */}
      <button
        type="button"
        onClick={() => setAdvanced(!advanced)}
        aria-expanded={advanced}
        data-tour="ads-advanced"
        className="btn-ghost min-h-10 self-start px-3 text-xs"
      >
        <SlidersHorizontal className="size-3" aria-hidden="true" />
        {advanced ? 'Fechar configurações avançadas' : 'Configurações avançadas'}
        <ChevronDown className={cn('size-3 transition-transform', advanced && 'rotate-180')} aria-hidden="true" />
      </button>

      {/* ── Regras: linhas expansíveis com switch (só no modo avançado) ── */}
      <section className={cn('border-b border-border/60 pb-4', !advanced && 'hidden')} aria-hidden={!advanced}>
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">Regras personalizadas</h3>
            <span className="text-xs text-muted-foreground">{enabledCount} de {rules.length} ativas</span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center sm:gap-1.5">
            <button type="button" className="btn-primary min-h-10 justify-center gap-1 text-xs" onClick={addRule} disabled={saving || !!newRule || rules.length >= 12} title={rules.length >= 12 ? 'Limite de 12 regras por conta' : undefined}>
              <Plus className="size-3.5" aria-hidden="true" />
              Nova regra
            </button>
          </div>
        </div>

        {rules.length === 0 && !newRule ? (
          <p className="py-6 text-center text-xs text-muted">
            Nenhuma regra personalizada ainda. Crie a primeira com &quot;Nova regra&quot;. Ela nasce em modo
            &quot;Propõe&quot;: nada é executado sem a sua aprovação.
          </p>
        ) : (
          <ul className="flex flex-col gap-2 mt-2">
            {[...rules, ...(newRule ? [newRule] : [])].map((r) => {
              const open = expandedId === r.id
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
                            'text-xs font-medium',
                            executes ? 'border-primary/20 bg-primary/10 text-primary' : 'border-warning/20 bg-warning/10 text-warning',
                          )}
                          title={
                            executes
                              ? 'Age sozinha quando dispara — registrado na auditoria'
                              : 'Grava proposta — você aprova antes de agir'
                          }
                        >
                          <span className={cn('size-1.5 rounded-full', executes ? 'bg-primary' : 'bg-warning')} aria-hidden="true" />
                          {executes ? 'Executar automaticamente' : 'Pedir aprovação'}
                        </span>
                        {r.pilot && (
                          <span
                            className="text-xs text-muted-foreground"
                            title="Regra gerada por um piloto — controlada na visão simples acima"
                          >
                            piloto
                          </span>
                        )}
                        {r.preset && !r.pilot && (
                          <span
                            className="text-xs text-muted-foreground"
                            title="Regra pré-configurada de fábrica"
                          >
                            <Sparkles className="size-2.5" aria-hidden="true" />
                            padrão
                          </span>
                        )}
                      </span>
                      <span className="mt-1 block text-pretty text-xs leading-relaxed text-muted-foreground">
                        {summarize(r, currency)}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {last || 'nunca disparou'}
                      </span>
                    </button>
                    <Switch
                      checked={r.enabled}
                      disabled={saving || (!r.enabled && data?.autonomy === 'notify')}
                      onCheckedChange={(on) => {
                        if (newRule?.id === r.id) { setNewRule({ ...r, enabled: on }); return }
                        if (on && r.mode === 'execute') {
                          if (automaticBlockedReason) {
                            setExpandedId(r.id)
                            toast.info('Ajuste os limites de segurança antes de ativar esta regra.', { hint: automaticBlockedReason })
                            return
                          }
                          setConfirmRuleEnable(r)
                          return
                        }
                        void toggleRule(r, on)
                      }}
                      aria-label={`${r.enabled ? 'Pausar' : 'Ativar'} regra: ${ruleTitle(r)}`}
                      className="mt-0.5"
                    />
                  </div>
                  <div className={cn('mt-3 border-t border-border/60 pt-3', !open && 'hidden')} aria-hidden={!open}>
                      <RuleForm
                        rule={r}
                        currency={currency}
                        saving={saving}
                        automaticBlockedReason={automaticBlockedReason}
                        onOpenLimits={onOpenLimits}
                        onDirtyChange={markRuleDirty}
                        onSave={saveRule}
                        onCancel={() => {
                          setExpandedId(null)
                          setNewRule(null)
                        }}
                        onDelete={() => setDeleteRuleId(r.id)}
                      />
                    </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* Limites de segurança + modo teste — atalho para a política da conta */}
      {advanced && onOpenLimits && (
        <button
          type="button"
          onClick={onOpenLimits}
          className="flex min-h-10 items-center gap-2 self-start rounded-xl border border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:border-primary/40"
        >
          <ShieldCheck className="size-3.5 text-primary" aria-hidden="true" />
          Limites de segurança
        </button>
      )}



      <ConfirmDialog open={Boolean(confirmRuleEnable)} title="Ativar regra automática?" description={confirmRuleEnable ? `${ruleTitle(confirmRuleEnable)} · ${summarize(confirmRuleEnable, currency)}. Quando a condição for atingida, esta regra poderá executar a ação automaticamente dentro dos limites de segurança. Dependendo das demais regras ativas, a configuração efetiva da automação também pode passar a incluir execução automática.` : ''} confirmLabel="Ativar regra" appearance="quiet" tone="default" busy={saving} onConfirm={() => { const rule = confirmRuleEnable; if (!rule) return; void toggleRule(rule, true).then((ok) => { if (ok) setConfirmRuleEnable(null) }) }} onClose={() => !saving && setConfirmRuleEnable(null)} />
      <ConfirmDialog open={confirmAutomaticRun} title="Executar avaliação agora?" description="As regras automáticas poderão pausar campanhas e alterar orçamentos imediatamente, respeitando os limites de segurança configurados." confirmLabel="Executar avaliação" appearance="quiet" tone="default" busy={testing} onConfirm={() => { setConfirmAutomaticRun(false); void testNow() }} onClose={() => !testing && setConfirmAutomaticRun(false)} />
      <ConfirmDialog open={Boolean(deleteRuleId)} title="Remover esta regra?" description="Ela deixará de monitorar e agir sobre as campanhas. O histórico já registrado será preservado." confirmLabel="Remover regra" appearance="quiet" tone="danger" busy={saving} onConfirm={() => { const id = deleteRuleId; if (!id) return; void deleteRule(id).finally(() => setDeleteRuleId(null)) }} onClose={() => !saving && setDeleteRuleId(null)} />
    </div>
  )
}
