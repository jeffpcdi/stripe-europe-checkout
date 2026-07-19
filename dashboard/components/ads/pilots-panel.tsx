'use client'

// Pilotos de automação — a cara NOVA da aba Automações. Três estratégias em
// linguagem de gestor (Protetor / Escalador / Horário), cada uma com switch e
// intensidade, mais UM seletor de autonomia no topo. Tudo é uma view sobre a
// lista de regras existente (lib/pilots.ts): as escritas usam o MESMO
// PUT /api/ads/rules + PUT /api/ads/alerts de sempre — o motor 24/7, os
// guardrails e as propostas continuam exatamente como são.

import { useState } from 'react'
import { Bell, MessagesSquare, Rocket, ShieldCheck, TrendingUp, Clock3, Loader2 } from 'lucide-react'
import { useAdsRules, useAdsAlerts, apiSend } from '@/lib/api'
import { toast } from '@/lib/toast'
import { usePersistedState } from '@/lib/use-persisted-state'
import type { AdsRule, AdsRulesResponse, AdsAlertsConfig } from '@/lib/types'
import {
  PILOTS, INTENSITIES, detectPilots, detectAutonomy, applyPilot, applyAutonomy,
  type PilotId, type Intensity, type Autonomy,
} from '@/lib/pilots'
import { GlassCard } from '@/components/glass-card'
import { Skeleton } from '@/components/skeleton'
import { Switch } from '@/components/switch'
import { ConfirmDialog } from '@/components/confirm-dialog'

const PILOT_ICONS: Record<PilotId, typeof ShieldCheck> = {
  protector: ShieldCheck,
  scaler: TrendingUp,
  schedule: Clock3,
}

// Frase-resumo do que o piloto FAZ na intensidade escolhida — em linguagem de
// gestor, com a moeda da conta (nunca símbolo fixo).
function pilotSummary(pilot: PilotId, intensity: Intensity | 'custom', cur: string): string {
  if (intensity === 'custom') return 'Configuração personalizada (editada no Modo avançado).'
  if (pilot === 'protector') {
    const t = { conservador: [20, 30, 1.5], normal: [15, 20, 1], agressivo: [12, 15, 0.8] }[intensity]
    return `Pausa com CPA acima de ${t[0]} ${cur} ou ${t[1]} ${cur} gastos sem venda; reduz orçamento com clique acima de ${t[2]} ${cur}.`
  }
  if (pilot === 'scaler') {
    const t = { conservador: [3, 10, 50], normal: [2, 20, 100], agressivo: [1.8, 30, 200] }[intensity]
    return `Aumenta ${t[1]}% o orçamento quando o ROAS passa de ${t[0]} — teto de ${t[2]} ${cur}/dia por campanha.`
  }
  const t = { conservador: 'seg–sex, 09:00–18:00', normal: 'seg–sex, 09:00–23:00', agressivo: 'todos os dias, 08:00–00:00' }[intensity]
  return `Campanhas ligadas ${t} (horário de Brasília); fora disso, pausadas.`
}

const AUTONOMY_OPTIONS: { value: Autonomy; label: string; hint: string; icon: typeof Bell }[] = [
  { value: 'notify', label: 'Só avisar', hint: 'O robô nunca mexe — só notifica', icon: Bell },
  { value: 'propose', label: 'Propor e eu aprovo', hint: 'Sugere e espera seu OK de 1 toque', icon: MessagesSquare },
  { value: 'auto', label: 'Agir sozinho', hint: 'Age nos limites e avisa depois', icon: Rocket },
]

export function PilotsPanel({ active, currency }: { active: boolean; currency: string }) {
  const { data, mutate, isLoading } = useAdsRules(active)
  const { data: alertsCfg, mutate: mutateAlerts } = useAdsAlerts(active)
  const [saving, setSaving] = useState(false)
  const [confirmAuto, setConfirmAuto] = useState(false)
  // Memoriza quais regras-piloto estavam ativas antes de "Só avisar", para o
  // retorno a propor/agir religar exatamente elas (best-effort, por navegador).
  const [lastActive, setLastActive] = usePersistedState<string[]>('ads:pilots:last-active', [])

  const rules = data?.rules ?? []
  const pilots = detectPilots(rules)
  const autonomy = detectAutonomy(rules, alertsCfg?.enabled ?? false)
  const anyPilot = rules.some((r) => r.pilot)

  // Mesmo padrão otimista do automation-panel: PUT da lista completa + rollback.
  async function saveRules(next: AdsRule[], okMsg: string): Promise<boolean> {
    setSaving(true)
    const prev = data
    mutate(prev ? { ...prev, rules: next } : undefined, { revalidate: false })
    try {
      const r = await apiSend<AdsRulesResponse>('/api/ads/rules', 'PUT', { rules: next })
      mutate(r, { revalidate: false })
      toast.success(okMsg)
      return true
    } catch (e) {
      mutate(prev, { revalidate: false })
      toast.error('Falha ao salvar', { hint: e instanceof Error ? e.message : undefined })
      return false
    } finally {
      setSaving(false)
    }
  }

  async function setPilot(pilot: PilotId, opts: { enabled: boolean; intensity: Intensity }) {
    const mode = autonomy === 'auto' ? 'execute' as const : 'proposal' as const
    const next = applyPilot(rules, pilot, { ...opts, mode })
    const title = PILOTS.find((p) => p.id === pilot)?.title ?? pilot
    await saveRules(next, opts.enabled ? `${title} ligado (${opts.intensity})` : `${title} desligado`)
  }

  async function setAutonomy(next: Autonomy) {
    if (next === autonomy) return
    if (next === 'auto') { setConfirmAuto(true); return }
    await applyAutonomyNow(next)
  }

  async function applyAutonomyNow(next: Autonomy) {
    if (next === 'notify') {
      // guarda o que estava ligado para o caminho de volta
      setLastActive(rules.filter((r) => r.pilot && r.enabled).map((r) => r.id))
    }
    const nextRules = applyAutonomy(rules, next, next === 'notify' ? undefined : lastActive)
    const ok = await saveRules(nextRules, {
      notify: 'Modo "Só avisar": o robô não mexe em nada',
      propose: 'Modo "Propor": o robô sugere e você aprova',
      auto: 'Modo "Agir sozinho": o robô age dentro dos limites',
    }[next])
    // Só avisar exige os alertas LIGADOS (senão vira "nem avisa").
    if (ok && next === 'notify' && alertsCfg && !alertsCfg.enabled) {
      try {
        const cfg: AdsAlertsConfig = { ...alertsCfg, enabled: true }
        await apiSend('/api/ads/alerts', 'PUT', cfg)
        mutateAlerts(cfg, { revalidate: false })
      } catch { /* alertas seguem como estavam; o card abaixo permite ligar */ }
    }
  }

  if (isLoading && !data) {
    return <Skeleton className="h-56 rounded-2xl" />
  }

  return (
    <GlassCard className="flex flex-col gap-4 p-4" data-tour="ads-pilots">
      {/* ── Seletor único de autonomia ── */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold text-foreground">Como o robô deve trabalhar?</h3>
          {saving && <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden="true" />}
          {autonomy === 'custom' && anyPilot && (
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
              Personalizado
            </span>
          )}
        </div>
        <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Autonomia do robô">
          {AUTONOMY_OPTIONS.map((o) => {
            const selected = autonomy === o.value
            return (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={saving}
                onClick={() => setAutonomy(o.value)}
                className={`flex flex-col gap-0.5 rounded-xl border px-3 py-2 text-left transition-colors ${
                  selected ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/40'
                }`}
              >
                <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                  <o.icon className={`size-3.5 ${selected ? 'text-primary' : 'text-muted-foreground'}`} aria-hidden="true" />
                  {o.label}
                </span>
                <span className="text-[11px] text-muted-foreground">{o.hint}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Os 3 pilotos ── */}
      <div className="flex flex-col gap-2">
        {PILOTS.map((p) => {
          const st = pilots[p.id]
          const Icon = PILOT_ICONS[p.id]
          const effective: Intensity = st.intensity === 'custom' ? 'normal' : st.intensity
          return (
            <div key={p.id} className="flex flex-col gap-2 rounded-xl border border-border bg-background p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-2.5">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-light)] text-brand-cyan">
                    <Icon className="size-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-foreground">{p.title}</p>
                    <p className="text-pretty text-[11px] leading-relaxed text-muted-foreground">
                      {st.active ? pilotSummary(p.id, st.intensity, currency) : p.desc}
                    </p>
                  </div>
                </div>
                <Switch
                  checked={st.active}
                  disabled={saving}
                  onCheckedChange={(on) => setPilot(p.id, { enabled: on, intensity: effective })}
                  aria-label={st.active ? `Desligar ${p.title}` : `Ligar ${p.title}`}
                />
              </div>
              {st.active && (
                <div className="flex flex-wrap items-center gap-1.5 pl-10">
                  {INTENSITIES.map((i) => (
                    <button
                      key={i.value}
                      type="button"
                      disabled={saving}
                      aria-pressed={st.intensity === i.value}
                      onClick={() => setPilot(p.id, { enabled: true, intensity: i.value })}
                      className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                        st.intensity === i.value
                          ? 'bg-primary/15 text-primary'
                          : 'bg-secondary text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {i.label}
                    </button>
                  ))}
                  {st.intensity === 'custom' && (
                    <span className="text-[10px] text-muted-foreground">personalizado no Modo avançado</span>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Os valores usam a moeda da conta ({currency}). Regras criadas no Modo avançado não são
        alteradas pelos pilotos nem pelo seletor acima.
      </p>

      {/* Confirmação para autonomia total — é a única escolha que age sem OK */}
      <ConfirmDialog
        open={confirmAuto}
        title="Deixar o robô agir sozinho?"
        description={
          <>
            As automações passam a <strong>executar direto</strong> (pausar campanhas e ajustar
            orçamentos) dentro dos limites de segurança, avisando depois. Você pode voltar para
            &quot;Propor e eu aprovo&quot; a qualquer momento.
          </>
        }
        confirmLabel="Ativar"
        busy={saving}
        onConfirm={async () => {
          await applyAutonomyNow('auto')
          setConfirmAuto(false)
        }}
        onClose={() => setConfirmAuto(false)}
      />
    </GlassCard>
  )
}
