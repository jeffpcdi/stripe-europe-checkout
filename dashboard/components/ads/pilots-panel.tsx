'use client'

// Pilotos de automação — a cara NOVA da aba Automações. Três estratégias em
// linguagem de gestor (Protetor / Escalador / Horário), cada uma com switch e
// intensidade, mais UM seletor de autonomia no topo. Tudo é uma view sobre a
// lista de regras existente (lib/pilots.ts): as escritas usam o MESMO
// PUT /api/ads/rules + PUT /api/ads/alerts de sempre — o motor 24/7, os
// guardrails e as propostas continuam exatamente como são.

import { useState } from 'react'
import { Bell, MessagesSquare, Rocket, ShieldCheck, TrendingUp, Clock3, Loader2 } from 'lucide-react'
import type { AdsAutomationAutonomy, AdsRule } from '@/lib/types'
import {
  PILOTS, INTENSITIES, detectPilots,
  type PilotId, type Intensity,
} from '@/lib/pilots'
import { GlassCard } from '@/components/glass-card'
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

const AUTONOMY_OPTIONS: { value: AdsAutomationAutonomy; label: string; hint: string; icon: typeof Bell }[] = [
  { value: 'notify', label: 'Só avisar', hint: 'O robô nunca mexe — só notifica', icon: Bell },
  { value: 'propose', label: 'Propor e eu aprovo', hint: 'Sugere e espera seu OK de 1 toque', icon: MessagesSquare },
  { value: 'auto', label: 'Agir sozinho', hint: 'Age nos limites e avisa depois', icon: Rocket },
]

export function PilotsPanel({
  currency,
  rules,
  autonomy,
  saving,
  onSetPilot,
  onSetAutonomy,
}: {
  currency: string
  rules: AdsRule[]
  autonomy: AdsAutomationAutonomy | 'custom'
  saving: boolean
  onSetPilot: (pilot: PilotId, opts: { enabled: boolean; intensity: Intensity }) => Promise<void>
  onSetAutonomy: (autonomy: AdsAutomationAutonomy) => Promise<void>
}) {
  const [confirmAuto, setConfirmAuto] = useState(false)
  const pilots = detectPilots(rules)

  async function setAutonomy(next: AdsAutomationAutonomy) {
    if (next === autonomy) return
    if (next === 'auto') { setConfirmAuto(true); return }
    await onSetAutonomy(next)
  }

  return (
    <GlassCard className="flex flex-col gap-4 p-4" data-tour="ads-pilots">
      {/* ── Seletor único de autonomia ── */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold text-foreground">Como o robô deve trabalhar?</h3>
          {saving && <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden="true" />}
          {autonomy === 'custom' && (
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
                  onCheckedChange={(on) => onSetPilot(p.id, { enabled: on, intensity: effective })}
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
                      onClick={() => onSetPilot(p.id, { enabled: true, intensity: i.value })}
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
          await onSetAutonomy('auto')
          setConfirmAuto(false)
        }}
        onClose={() => setConfirmAuto(false)}
      />
    </GlassCard>
  )
}
