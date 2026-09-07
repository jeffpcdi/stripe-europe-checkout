'use client'

import { useState } from 'react'
import { Bell, Check, Settings2, ShieldCheck, TrendingUp, Clock3 } from 'lucide-react'
import type { AdsAutomationAutonomy, AdsRule } from '@/lib/types'
import { PILOTS, INTENSITIES, detectPilots, buildPilotRules, type PilotId, type Intensity } from '@/lib/pilots'
import { fmtSpend } from '@/lib/format'
import { GlassCard } from '@/components/glass-card'
import { Switch } from '@/components/switch'
import { ConfirmDialog } from '@/components/confirm-dialog'

const MODES = [
  { value: 'notify' as const, label: 'Só avisar', hint: 'Você faz os ajustes.' },
  { value: 'propose' as const, label: 'Pedir aprovação', hint: 'Você aprova cada ação.' },
  { value: 'auto' as const, label: 'Aplicar sozinho', hint: 'Segue as regras e os limites.' },
]
const INFO = {
  protector: { title: 'Proteger orçamento', detail: 'Define quando pausar ou reduzir o investimento.', icon: ShieldCheck },
  scaler: { title: 'Aumentar investimento', detail: 'Ajusta o orçamento quando o retorno atinge a meta.', icon: TrendingUp },
  schedule: { title: 'Horários das campanhas', detail: 'Pausa fora dos dias e horários definidos.', icon: Clock3 },
}
const ACTIONS: Record<string, string> = { pause: 'Pausar', activate: 'Ativar', budget_down: 'Reduzir orçamento', budget_up: 'Aumentar orçamento' }
const DAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

function RuleSummary({ rule, currency, preview }: { rule: AdsRule; currency: string; preview: boolean }) {
  const money = (value: number) => fmtSpend(value, currency)
  const condition = rule.metric === 'spend_no_conv' ? `Gasto sem venda: ${money(rule.threshold)}`
    : rule.metric === 'cpa_max' ? `Custo por venda acima de ${money(rule.threshold)}`
    : rule.metric === 'cpc_max' ? `Custo por clique acima de ${money(rule.threshold)}`
    : rule.metric === 'roas_scale' ? `Retorno a partir de ${rule.threshold.toLocaleString('pt-BR')}×`
    : rule.metric === 'schedule' ? `${(rule.days ?? []).map(day => DAYS[day]).join(', ')} · ${rule.startTime}–${rule.endTime}`
    : rule.name
  const limits = [
    rule.minClicks ? `${rule.minClicks} cliques` : '',
    rule.minImpressions ? `${rule.minImpressions.toLocaleString('pt-BR')} exibições` : '',
    rule.minSales ? `${rule.minSales} vendas` : '',
    rule.minSpend ? `${money(rule.minSpend)} de gasto` : '',
  ].filter(Boolean)
  return <li className="min-w-0 rounded-xl border border-border bg-background p-3">
    <p className="text-xs font-medium text-foreground">{condition}</p>
    <p className="mt-1 text-xs text-muted-foreground">{ACTIONS[rule.action] || rule.action}{rule.action.startsWith('budget_') ? ` em ${rule.pct}%` : ''}{rule.budgetCap ? ` · teto ${money(rule.budgetCap)}/dia` : ''}{!preview && !rule.enabled ? ' · desligada' : ''}</p>
    <details className="mt-2 text-[11px] text-muted-foreground">
      <summary className="cursor-pointer">Condições</summary>
      <p className="mt-1">{rule.metric === 'schedule' ? 'Usa o fuso da conta de anúncios.' : `Período: ${rule.lookbackDays || 1} dia(s). ${limits.length ? `Mínimo: ${limits.join(', ')}.` : 'Sem volume mínimo adicional.'}`}</p>
    </details>
  </li>
}

export function PilotsPanel({ currency, rules, autonomy, saving, onSetPilot, onSetAutonomy, automaticBlockedReason, onOpenLimits }: {
  currency: string; rules: AdsRule[]; autonomy: AdsAutomationAutonomy | 'custom'; saving: boolean
  onSetPilot: (pilot: PilotId, opts: { enabled: boolean; intensity: Intensity; toggleOnly?: boolean }) => Promise<void>
  onSetAutonomy: (autonomy: AdsAutomationAutonomy) => Promise<void>
  automaticBlockedReason?: string | null; onOpenLimits?: () => void
}) {
  const [confirmAuto, setConfirmAuto] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const pilots = detectPilots(rules)
  return <div className="space-y-4" data-tour="ads-pilots">
    <GlassCard className="p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div><h3 className="text-sm font-semibold">Como agir</h3><p className="mt-1 text-xs text-muted-foreground">Escolha quanto controle deseja manter.</p></div>
        {onOpenLimits && <button type="button" onClick={onOpenLimits} className="btn-secondary text-xs"><Settings2 className="size-3.5" />Limites e segurança</button>}
      </div>
      <div className="grid gap-2 sm:grid-cols-3" aria-label="Modo de execução">
        {MODES.map(mode => <button key={mode.value} type="button" aria-pressed={autonomy === mode.value} disabled={saving} onClick={() => {
          if (mode.value === autonomy) return
          if (mode.value === 'auto') { if (automaticBlockedReason) setBlocked(true); else setConfirmAuto(true) }
          else { setBlocked(false); void onSetAutonomy(mode.value) }
        }} className={`rounded-xl border p-3 text-left transition-colors ${autonomy === mode.value ? 'border-primary/50 bg-primary/10' : 'border-border hover:bg-secondary'}`}>
          <span className="flex items-center justify-between gap-2 text-sm font-medium">{mode.label}{autonomy === mode.value && <Check className="size-4 text-primary" />}</span>
          <span className="mt-1 block text-xs text-muted-foreground">{mode.hint}</span>
        </button>)}
      </div>
      {autonomy === 'custom' && <p className="mt-3 text-xs text-muted-foreground">As regras usam modos diferentes. Confira em Personalizar regras.</p>}
      {blocked && automaticBlockedReason && <div role="alert" className="mt-3 rounded-xl border border-warning/30 p-3 text-xs text-warning">{automaticBlockedReason}{onOpenLimits && <button type="button" onClick={onOpenLimits} className="ml-2 underline">Ajustar limites</button>}</div>}
    </GlassCard>
    <div className="grid items-start gap-4 xl:grid-cols-2">
      {PILOTS.filter(p => p.id !== 'schedule').map(p => {
        const state = pilots[p.id]
        const mine = rules.filter(rule => rule.pilot === p.id)
        const intensity = state.intensity === 'custom' ? 'normal' : state.intensity
        const display = mine.length ? mine : buildPilotRules(p.id, intensity)
        const info = INFO[p.id]
        return <GlassCard key={p.id} className="p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div><h3 className="flex items-center gap-2 text-sm font-semibold"><info.icon className="size-4 text-primary" />{info.title}</h3><p className="mt-1 text-xs text-muted-foreground">{info.detail}</p></div>
            <Switch checked={state.active} disabled={saving} onCheckedChange={enabled => onSetPilot(p.id, { enabled, intensity, toggleOnly: true })} aria-label={`${state.active ? 'Desligar' : 'Ligar'} ${info.title.toLowerCase()}`} />
          </div>
          <p className="my-3 text-xs text-muted-foreground">{!mine.length ? 'Sugestão para ativar' : state.intensity === 'custom' ? 'Regras personalizadas' : state.active ? 'Regras ligadas' : 'Regras desligadas'}</p>
          <ul className="space-y-2">{display.map(rule => <RuleSummary key={rule.id} rule={rule} currency={currency} preview={!mine.length} />)}</ul>
          <details className="mt-4 text-xs">
            <summary className="cursor-pointer text-muted-foreground">Usar um ajuste pronto</summary>
            <p className="my-2 text-muted-foreground">Substitui as regras deste grupo.</p>
            <div className="flex flex-wrap gap-2">{INTENSITIES.map(i => <button type="button" key={i.value} disabled={saving} aria-pressed={state.intensity === i.value && !!mine.length} className="btn-secondary text-xs" onClick={() => void onSetPilot(p.id, { enabled: true, intensity: i.value })}>{i.label}</button>)}</div>
          </details>
        </GlassCard>
      })}
    </div>
    <details className="rounded-2xl border border-border bg-card p-4">
      <summary className="cursor-pointer text-sm font-medium">Horários das campanhas{pilots.schedule.active ? ' · ligado' : ''}</summary>
      <div className="mt-3 space-y-3">
        <div className="flex items-center justify-between gap-3"><p className="text-xs text-muted-foreground">Pausa fora do horário definido, no fuso da conta.</p><Switch checked={pilots.schedule.active} disabled={saving} aria-label="Ativar horários das campanhas" onCheckedChange={enabled => onSetPilot('schedule', { enabled, intensity: pilots.schedule.intensity === 'custom' ? 'normal' : pilots.schedule.intensity, toggleOnly: true })} /></div>
        <ul className="space-y-2">{rules.filter(rule => rule.pilot === 'schedule').map(rule => <RuleSummary key={rule.id} rule={rule} currency={currency} preview={false} />)}</ul>
        {!rules.some(rule => rule.pilot === 'schedule') && <p className="text-xs text-muted-foreground">Ao ativar: seg–sex, das 09:00 às 23:00.</p>}
        <div className="flex flex-wrap gap-2">{INTENSITIES.map(i => <button key={i.value} type="button" disabled={saving} className="btn-secondary text-xs" onClick={() => void onSetPilot('schedule', { enabled: true, intensity: i.value })}>{i.label}</button>)}</div>
      </div>
    </details>
    <ConfirmDialog open={confirmAuto} title="Aplicar ações automaticamente?" description="As regras poderão pausar campanhas e alterar orçamentos dentro dos limites definidos. Você pode voltar a pedir aprovação a qualquer momento." confirmLabel="Aplicar sozinho" busy={saving} onConfirm={async () => { await onSetAutonomy('auto'); setConfirmAuto(false) }} onClose={() => setConfirmAuto(false)} />
  </div>
}
