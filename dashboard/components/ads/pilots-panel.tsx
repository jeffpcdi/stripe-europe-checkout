'use client'

import { useEffect, useMemo, useState } from 'react'
import { Settings2 } from 'lucide-react'
import type { AdsAutomationAutonomy, AdsRule } from '@/lib/types'
import { INTENSITIES, detectPilots, buildPilotRules, type PilotId, type Intensity } from '@/lib/pilots'
import { fmtSpend } from '@/lib/format'
import { Switch } from '@/components/switch'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { cn } from '@/lib/utils'

const MODES = [
  { value: 'notify' as const, label: 'Só avisar', hint: 'Mantém os alertas, mas não permite que regras criem propostas ou executem ações. As regras ativas ficam temporariamente suspensas.' },
  { value: 'propose' as const, label: 'Pedir aprovação', hint: 'As regras monitoram as campanhas e criam propostas. Nenhuma mudança chega ao TikTok sem sua aprovação.' },
  { value: 'auto' as const, label: 'Aplicar sozinho', hint: 'As regras ativas podem pausar campanhas e ajustar orçamentos sem aprovação individual, sempre dentro dos limites de segurança.' },
]

const INFO: Record<PilotId, { title: string; detail: string }> = {
  protector: { title: 'Proteger orçamento', detail: 'Corta desperdício quando os limites são ultrapassados.' },
  scaler: { title: 'Escalar vencedores', detail: 'Aumenta orçamento quando o retorno bate a meta.' },
  schedule: { title: 'Horários', detail: 'Mantém campanhas apenas nos horários escolhidos.' },
}

const DAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
function formatDays(days?: number[]) { return (days?.length ? days.map((d) => DAYS[d] ?? d).join(', ') : 'todos os dias') }
function summarizeRule(rule: AdsRule, currency: string) {
  if (rule.metric === 'schedule') return `${formatDays(rule.days)} · ${rule.startTime || '00:00'}–${rule.endTime || '23:59'}`
  if (rule.metric === 'spend_no_conv') return `Gasto sem venda > ${fmtSpend(rule.threshold, currency)} → ${rule.action === 'pause' ? 'pausar' : `reduzir orçamento em ${rule.pct}%`}`
  if (rule.metric === 'cpa_max') return `CPA > ${fmtSpend(rule.threshold, currency)} → ${rule.action === 'pause' ? 'pausar' : 'agir'}`
  if (rule.metric === 'cpc_max') return `CPC > ${fmtSpend(rule.threshold, currency)} → ${rule.action === 'budget_down' ? `reduzir orçamento em ${rule.pct}%` : 'agir'}`
  if (rule.metric === 'roas_scale') return `ROAS ≥ ${rule.threshold.toLocaleString('pt-BR')}x com ${rule.minSales || 0} vendas → aumentar ${rule.pct}%${rule.budgetCap ? ` · teto ${fmtSpend(rule.budgetCap, currency)}/dia` : ''}`
  if (rule.metric === 'scheduled_scale') return `ROAS ≥ ${rule.threshold.toLocaleString('pt-BR')}x às ${rule.triggerTime || '18:00'} → aumentar ${rule.pct}%`
  return rule.name || rule.metric
}

export function PilotsPanel({ currency, rules, autonomy, saving, onSetPilot, onSetAutonomy, automaticBlockedReason, onOpenLimits, onDirtyChange }: {
  currency: string
  rules: AdsRule[]
  autonomy: AdsAutomationAutonomy | 'custom'
  saving: boolean
  onSetPilot: (pilot: PilotId, opts: { enabled: boolean; intensity: Intensity; toggleOnly?: boolean }) => Promise<boolean>
  onSetAutonomy: (autonomy: AdsAutomationAutonomy) => Promise<boolean>
  automaticBlockedReason?: string | null
  onOpenLimits?: () => void
  onDirtyChange?: (dirty: boolean) => void
}) {
  const detected = detectPilots(rules)
  const [confirmAuto, setConfirmAuto] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [expandedPilot, setExpandedPilot] = useState<PilotId | null>(null)
  const [draftIntensity, setDraftIntensity] = useState<Partial<Record<PilotId, Intensity>>>({})
  const [confirmPilot, setConfirmPilot] = useState<PilotId | null>(null)
  const pilotDirty = (pilotId: PilotId) => {
    const draft = draftIntensity[pilotId]
    if (!draft) return false
    const saved = detected[pilotId].intensity
    return saved === 'custom' || draft !== saved
  }
  const dirty = (Object.keys(draftIntensity) as PilotId[]).some(pilotDirty)
  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])

  const modeText = autonomy === 'custom' ? 'Configuração mista · algumas regras pedem aprovação e outras executam.' : MODES.find((m) => m.value === autonomy)?.hint

  async function togglePilot(pilotId: PilotId, enabled: boolean, intensity: Intensity) {
    if (enabled && autonomy === 'notify') return
    if (enabled && autonomy === 'auto') { setConfirmPilot(pilotId); return }
    await onSetPilot(pilotId, { enabled, intensity, toggleOnly: true })
  }

  return <section className="space-y-5" data-tour="ads-pilots">
    <div className="border-b border-border/60 pb-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-2xl">
          <h3 className="text-sm font-semibold text-foreground">Como o ROI-NADOS pode agir</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{modeText}</p>
          {autonomy === 'notify' ? <p className="mt-2 text-xs text-muted-foreground">Quando você mudar de modo, as regras que estavam ativas antes poderão ser restauradas.</p> : null}
        </div>
        {onOpenLimits ? <button type="button" onClick={onOpenLimits} className="btn-secondary min-h-10 text-xs"><Settings2 className="size-3.5" />Limites de segurança</button> : null}
      </div>
      <div className="mt-4 grid gap-2 md:grid-cols-3">
        {MODES.map((mode) => {
          const active = autonomy === mode.value
          const unavailable = mode.value === 'auto' && !!automaticBlockedReason
          return <button key={mode.value} type="button" aria-pressed={active} disabled={saving} onClick={() => {
            if (active) return
            if (mode.value === 'auto') { unavailable ? setBlocked(true) : setConfirmAuto(true); return }
            void onSetAutonomy(mode.value)
          }} className={cn('min-h-20 rounded-xl border p-3 text-left transition-colors', active ? 'border-brand-cyan/50 bg-brand-cyan/5' : 'border-border bg-background hover:border-border/90', unavailable && 'opacity-70')}>
            <span className="block text-sm font-medium text-foreground">{mode.label}</span>
            <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{mode.hint}</span>
          </button>
        })}
      </div>
      {blocked && automaticBlockedReason ? <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-l-2 border-warning pl-3"><p className="text-xs text-warning">{automaticBlockedReason}</p>{onOpenLimits ? <button className="btn-ghost min-h-10 text-xs" onClick={onOpenLimits}>Ajustar limites</button> : null}</div> : null}
    </div>

    <div>
      <div className="mb-2"><h3 className="text-sm font-semibold text-foreground">Automações prontas</h3><p className="mt-1 text-xs text-muted-foreground">Configure os comportamentos mais comuns sem montar regras manualmente.</p></div>
      <div className="divide-y divide-border/60 border-y border-border/60">
        {(Object.keys(INFO) as PilotId[]).map((pilotId) => {
          const state = detected[pilotId]
          const info = INFO[pilotId]
          const fallback: Intensity = state.intensity === 'custom' ? 'normal' : state.intensity
          const draft = draftIntensity[pilotId] || fallback
          const previewRules = buildPilotRules(pilotId, draft)
          const open = expandedPilot === pilotId
          const label = state.intensity === 'custom' ? 'Personalizada' : INTENSITIES.find((i) => i.value === fallback)?.label || 'Normal'
          return <div key={pilotId} className="py-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h4 className="text-sm font-medium text-foreground">{info.title}</h4><span className="text-xs text-muted-foreground">{state.active ? `Ativo · ${label}` : label}</span></div><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{state.active ? previewRules.map((r) => summarizeRule(r, currency)).slice(0, 2).join(' · ') : info.detail}</p>{pilotDirty(pilotId) ? <p className="mt-1 text-xs font-medium text-warning">Alterações não aplicadas</p> : null}</div>
              <div className="flex items-center gap-2 self-end sm:self-auto"><button type="button" className="btn-ghost min-h-10 px-3 text-xs" onClick={() => setExpandedPilot(open ? null : pilotId)}>Ajustar</button><Switch checked={state.active} disabled={saving || (!state.active && autonomy === 'notify')} onCheckedChange={(enabled) => void togglePilot(pilotId, enabled, fallback)} aria-label={`${state.active ? 'Desligar' : 'Ligar'} ${info.title.toLowerCase()}`} /></div>
            </div>
            {!state.active && autonomy === 'notify' ? <p className="mt-2 text-xs text-muted-foreground">Escolha “Pedir aprovação” ou “Aplicar sozinho” antes de ativar uma automação.</p> : null}
            {open ? <div className="mt-4 border-t border-border/60 pt-4">
              <p className="text-xs font-medium text-foreground">Perfil</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">{INTENSITIES.map((intensity) => <label key={intensity.value} className={cn('flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-xs', draft === intensity.value ? 'border-brand-cyan/50 bg-brand-cyan/5 text-foreground' : 'border-border text-muted-foreground')}><input type="radio" name={`pilot-${pilotId}`} checked={draft === intensity.value} onChange={() => setDraftIntensity((current) => {
                const next = { ...current }
                if (state.intensity !== 'custom' && intensity.value === state.intensity) delete next[pilotId]
                else next[pilotId] = intensity.value
                return next
              })} />{intensity.label}</label>)}</div>
              {state.intensity === 'custom' ? <p className="mt-2 text-xs text-warning">Esta automação foi refinada nas Configurações avançadas. Aplicar um perfil pronto substituirá esses ajustes do piloto.</p> : null}
              <div className="mt-4"><p className="text-xs font-medium text-foreground">O que será aplicado</p><ul className="mt-2 divide-y divide-border/50 border-y border-border/50">{previewRules.map((rule) => <li key={rule.id} className="py-2 text-xs text-muted-foreground">{summarizeRule(rule, currency)}</li>)}</ul></div>
              <div className="mt-4 flex justify-end gap-2"><button type="button" className="btn-ghost min-h-10 text-xs" onClick={() => { setDraftIntensity((current) => { const next = { ...current }; delete next[pilotId]; return next }); setExpandedPilot(null) }}>Cancelar</button><button type="button" className="btn-primary min-h-10 text-xs" disabled={saving || autonomy === 'notify'} onClick={() => void onSetPilot(pilotId, { enabled: true, intensity: draft }).then((ok) => { if (!ok) return; setDraftIntensity((current) => { const next = { ...current }; delete next[pilotId]; return next }); setExpandedPilot(null) })}>{state.active ? 'Aplicar ajustes' : 'Aplicar e ativar'}</button></div>
            </div> : null}
          </div>
        })}
      </div>
    </div>

    <ConfirmDialog open={confirmAuto} title="Permitir ações automáticas?" description="As regras ativas poderão pausar campanhas e alterar orçamentos sem aprovação individual, sempre dentro dos limites de segurança. Configurações automáticas anteriormente habilitadas poderão ser restauradas." confirmLabel="Aplicar sozinho" appearance="quiet" tone="default" busy={saving} onConfirm={async () => { if (await onSetAutonomy('auto')) setConfirmAuto(false) }} onClose={() => setConfirmAuto(false)} />
    <ConfirmDialog open={Boolean(confirmPilot)} title={confirmPilot ? `Ativar ${INFO[confirmPilot].title}?` : 'Ativar automação?'} description="Este piloto passará a executar ações automaticamente quando suas condições forem atendidas." confirmLabel="Ativar automação" appearance="quiet" tone="default" busy={saving} onConfirm={() => { const id = confirmPilot; if (!id) return; const state = detected[id]; const intensity: Intensity = state.intensity === 'custom' ? 'normal' : state.intensity; void onSetPilot(id, { enabled: true, intensity, toggleOnly: true }).finally(() => setConfirmPilot(null)) }} onClose={() => setConfirmPilot(null)} />
  </section>
}
