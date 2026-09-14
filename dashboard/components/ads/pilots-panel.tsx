'use client'

import { useState } from 'react'
import {
  Check,
  ChevronDown,
  Clock3,
  Settings2,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react'
import type { AdsAutomationAutonomy, AdsRule } from '@/lib/types'
import {
  PILOTS,
  INTENSITIES,
  detectPilots,
  buildPilotRules,
  type PilotId,
  type Intensity,
} from '@/lib/pilots'
import { fmtSpend } from '@/lib/format'
import { GlassCard } from '@/components/glass-card'
import { Switch } from '@/components/switch'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { cn } from '@/lib/utils'

const MODES = [
  { value: 'notify' as const, label: 'Só avisar', hint: 'Você faz os ajustes.' },
  { value: 'propose' as const, label: 'Pedir aprovação', hint: 'O ROINADOS propõe cada ação.' },
  { value: 'auto' as const, label: 'Aplicar sozinho', hint: 'Age dentro dos limites definidos.' },
]

const INFO = {
  protector: {
    title: 'Proteger orçamento',
    detail: 'Corta desperdício quando os limites são ultrapassados.',
    icon: ShieldCheck,
  },
  scaler: {
    title: 'Escalar vencedores',
    detail: 'Aumenta orçamento quando o retorno bate a meta.',
    icon: TrendingUp,
  },
  schedule: {
    title: 'Horários',
    detail: 'Mantém campanhas apenas nos horários escolhidos.',
    icon: Clock3,
  },
}

const DAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const WORK_DAYS = '1,2,3,4,5'
const EVERY_DAY = '0,1,2,3,4,5,6'

function formatDays(days?: number[]) {
  const key = (days ?? []).slice().sort((a, b) => a - b).join(',')
  if (!key) return 'todos os dias'
  if (key === EVERY_DAY) return 'todos os dias'
  if (key === WORK_DAYS) return 'seg–sex'
  return (days ?? []).map((day) => DAYS[day] ?? day).join(', ')
}

function summarizeRule(rule: AdsRule, currency: string) {
  if (rule.metric === 'schedule') {
    return `${formatDays(rule.days)} · ${rule.startTime || '00:00'}–${rule.endTime || '23:59'}`
  }
  if (rule.metric === 'spend_no_conv') return `Gasto sem venda > ${fmtSpend(rule.threshold, currency)}`
  if (rule.metric === 'cpa_max') return `CPA > ${fmtSpend(rule.threshold, currency)}`
  if (rule.metric === 'cpc_max') return `CPC > ${fmtSpend(rule.threshold, currency)}`
  if (rule.metric === 'roas_scale') {
    return `ROAS ≥ ${rule.threshold.toLocaleString('pt-BR')}x · +${rule.pct}%${rule.budgetCap ? ` · teto ${fmtSpend(rule.budgetCap, currency)}/dia` : ''}`
  }
  if (rule.metric === 'scheduled_scale') {
    return `ROAS ≥ ${rule.threshold.toLocaleString('pt-BR')}x às ${rule.triggerTime || '18:00'} · +${rule.pct}%`
  }
  return rule.name || rule.metric
}

function pilotSummary(pilot: PilotId, rules: AdsRule[], stateIntensity: Intensity | 'custom', currency: string) {
  const mine = rules.filter((rule) => rule.pilot === pilot)
  const fallbackIntensity: Intensity = stateIntensity === 'custom' ? 'normal' : stateIntensity
  const display = mine.length ? mine : buildPilotRules(pilot, fallbackIntensity)

  if (pilot === 'protector') {
    const cpa = display.find((rule) => rule.metric === 'cpa_max')
    const noConv = display.find((rule) => rule.metric === 'spend_no_conv')
    const cpc = display.find((rule) => rule.metric === 'cpc_max')
    return [
      cpa ? `CPA > ${fmtSpend(cpa.threshold, currency)}` : '',
      noConv ? `gasto sem venda > ${fmtSpend(noConv.threshold, currency)}` : '',
      cpc ? `CPC > ${fmtSpend(cpc.threshold, currency)}${cpc.action === 'budget_down' ? ` · reduz orçamento em ${cpc.pct}%` : ''}` : '',
    ].filter(Boolean).join(' · ')
  }

  if (pilot === 'scaler') {
    const scale = display.find((rule) => rule.metric === 'roas_scale' || rule.metric === 'scheduled_scale')
    if (!scale) return 'Escala campanhas com melhor retorno.'
    return `ROAS ≥ ${scale.threshold.toLocaleString('pt-BR')}x · aumenta ${scale.pct}%${scale.budgetCap ? ` · teto ${fmtSpend(scale.budgetCap, currency)}/dia` : ''}`
  }

  const schedule = display.find((rule) => rule.metric === 'schedule')
  if (!schedule) return 'Rodar continuamente'
  return `${formatDays(schedule.days)} · ${schedule.startTime || '00:00'}–${schedule.endTime || '23:59'}`
}

export function PilotsPanel({
  currency,
  rules,
  autonomy,
  saving,
  onSetPilot,
  onSetAutonomy,
  automaticBlockedReason,
  onOpenLimits,
}: {
  currency: string
  rules: AdsRule[]
  autonomy: AdsAutomationAutonomy | 'custom'
  saving: boolean
  onSetPilot: (pilot: PilotId, opts: { enabled: boolean; intensity: Intensity; toggleOnly?: boolean }) => Promise<void>
  onSetAutonomy: (autonomy: AdsAutomationAutonomy) => Promise<boolean>
  automaticBlockedReason?: string | null
  onOpenLimits?: () => void
}) {
  const [confirmAuto, setConfirmAuto] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [expandedPilot, setExpandedPilot] = useState<PilotId | null>(null)
  const pilots = detectPilots(rules)

  const modeLabel = MODES.find((mode) => mode.value === autonomy)?.label ?? 'Personalizado'

  return (
    <div className="space-y-4 operation-settings" data-tour="ads-pilots">
      <GlassCard className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">Modo da automação</h3>

            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {MODES.find(mode => mode.value === autonomy)?.hint || 'Escolha como cada regra pode agir.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1 rounded-xl border border-border bg-background p-1" aria-label="Modo de execução">
              {MODES.map((mode) => {
                const active = autonomy === mode.value
                return (
                  <button
                    key={mode.value}
                    type="button"
                    aria-pressed={active}
                    disabled={saving}
                    onClick={() => {
                      if (mode.value === autonomy) return
                      if (mode.value === 'auto') {
                        if (automaticBlockedReason) setBlocked(true)
                        else setConfirmAuto(true)
                        return
                      }
                      setBlocked(false)
                      void onSetAutonomy(mode.value)
                    }}
                    className={cn(
                      'rounded-lg px-3 py-2 text-left transition-colors',
                      active ? 'bg-[var(--accent-light)] text-brand-cyan' : 'text-muted-foreground hover:bg-[var(--hover)] hover:text-foreground',
                    )}
                    title={mode.hint}
                  >
                    <span className="block text-xs font-medium">{mode.label}</span>
                  </button>
                )
              })}
            </div>
            {onOpenLimits ? (
              <button type="button" onClick={onOpenLimits} className="btn-secondary text-xs">
                <Settings2 className="size-3.5" />
                Limites
              </button>
            ) : null}
          </div>
        </div>

        {autonomy === 'custom' ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Algumas automações estão em modos diferentes. Se quiser unificar tudo, escolha um modo acima.
          </p>
        ) : null}

        {blocked && automaticBlockedReason ? (
          <div role="alert" className="mt-3 rounded-xl border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
            {automaticBlockedReason}
            {onOpenLimits ? (
              <button type="button" onClick={onOpenLimits} className="ml-2 underline">
                Ajustar limites
              </button>
            ) : null}
          </div>
        ) : null}
      </GlassCard>

      <GlassCard className="p-2 sm:p-3">
        <div className="px-2 py-2 sm:px-3">
          <h3 className="text-sm font-semibold text-foreground">Proteções e escala</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Ative só o que deve rodar continuamente.
          </p>
        </div>

        <div className="divide-y divide-border/60">
          {(['protector', 'scaler', 'schedule'] as PilotId[]).map((pilotId) => {
            const state = pilots[pilotId]
            const fallbackIntensity: Intensity = state.intensity === 'custom' ? 'normal' : state.intensity
            const mine = rules.filter((rule) => rule.pilot === pilotId)
            const displayRules = mine.length ? mine : buildPilotRules(pilotId, fallbackIntensity)
            const info = INFO[pilotId]
            const Icon = info.icon
            const open = expandedPilot === pilotId
            const stateLabel = !mine.length
              ? 'Sugestão pronta'
              : state.intensity === 'custom'
                ? 'Personalizada'
                : INTENSITIES.find((item) => item.value === fallbackIntensity)?.label ?? 'Normal'

            return (
              <div key={pilotId} className="px-2 py-2.5 sm:px-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-light)] text-brand-cyan">
                        <Icon className="size-4.5" aria-hidden="true" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="text-sm font-medium text-foreground">{info.title}</h4>
                          <span className="rounded-full bg-[var(--hover)] px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                            {stateLabel}
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] leading-relaxed text-foreground/85">
                          {state.active ? pilotSummary(pilotId, rules, state.intensity, currency) : info.detail}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2 self-end sm:self-start">
                    <button
                      type="button"
                      onClick={() => setExpandedPilot(open ? null : pilotId)}
                      aria-expanded={open}
                      className="btn-ghost px-3 py-1.5 text-xs"
                    >
                      Ajustar
                      <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} aria-hidden="true" />
                    </button>
                    <Switch
                      checked={state.active}
                      disabled={saving}
                      onCheckedChange={(enabled) => onSetPilot(pilotId, { enabled, intensity: fallbackIntensity, toggleOnly: true })}
                      aria-label={`${state.active ? 'Desligar' : 'Ligar'} ${info.title.toLowerCase()}`}
                    />
                  </div>
                </div>

                {open ? (
                  <div className="mt-3 rounded-xl border border-border bg-background p-3">
                    <div className="flex flex-col gap-3">
                      <div>
                        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                          Ajuste rápido
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {INTENSITIES.map((intensity) => {
                            const selected = state.intensity !== 'custom' && state.intensity === intensity.value && mine.length > 0
                            return (
                              <button
                                type="button"
                                key={intensity.value}
                                disabled={saving}
                                aria-pressed={selected}
                                className={cn(
                                  'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                                  selected
                                    ? 'border-brand-cyan/50 bg-[var(--accent-light)] text-brand-cyan'
                                    : 'border-border bg-background text-muted-foreground hover:text-foreground',
                                )}
                                onClick={() => void onSetPilot(pilotId, { enabled: true, intensity: intensity.value })}
                              >
                                {intensity.label}
                              </button>
                            )
                          })}
                        </div>
                        <p className="mt-2 text-[11px] text-muted-foreground">
                          Escolha um perfil pronto para evitar configuração manual. Se quiser, depois você pode refinar tudo em Configurações avançadas.
                        </p>
                      </div>

                      <div>
                        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                          O que esta automação faz
                        </p>
                        <ul className="mt-2 space-y-2">
                          {displayRules.map((rule) => (
                            <li key={rule.id} className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground">
                              <span className="block">{summarizeRule(rule, currency)}</span>
                              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                                {rule.enabled ? 'Ligada' : 'Desligada'}
                                {rule.action.startsWith('budget_') ? ` · ajuste de ${rule.pct}%` : ''}
                                {rule.minClicks ? ` · mínimo ${rule.minClicks} cliques` : ''}
                                {rule.minSales ? ` · mínimo ${rule.minSales} vendas` : ''}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      </GlassCard>

      <ConfirmDialog
        tone="default"
        open={confirmAuto}
        title="Aplicar ações automaticamente?"
        description="As automações poderão pausar campanhas e alterar orçamentos dentro dos limites definidos. Você pode voltar a pedir aprovação a qualquer momento."
        confirmLabel="Aplicar sozinho"
        busy={saving}
        onConfirm={async () => {
          if (await onSetAutonomy('auto')) setConfirmAuto(false)
        }}
        onClose={() => setConfirmAuto(false)}
      />
    </div>
  )
}
