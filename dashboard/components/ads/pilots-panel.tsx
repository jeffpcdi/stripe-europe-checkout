'use client'

// Pilotos de automação — a cara NOVA da aba Automações. Três estratégias em
// linguagem de gestor (Protetor / Escalador / Horário), cada uma com switch e
// intensidade, mais UM seletor de autonomia no topo. Tudo é uma view sobre a
// lista de regras existente (lib/pilots.ts): as escritas usam o MESMO
// PUT /api/ads/rules + PUT /api/ads/alerts de sempre — o motor 24/7, os
// guardrails e as propostas continuam exatamente como são.

import { useState } from 'react'
import { Bell, MessagesSquare, Rocket, ShieldCheck, TrendingUp, Clock3, Loader2, Zap } from 'lucide-react'
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
  if (intensity === 'custom') return 'Configuração personalizada no modo avançado.'
  if (pilot === 'protector') {
    const t = { conservador: [20, 30, 1.5], normal: [15, 20, 1], agressivo: [12, 15, 0.8] }[intensity]
    return `Pausa acima de ${t[0]} ${cur} de CPA ou ${t[1]} ${cur} sem venda; reduz com CPC acima de ${t[2]} ${cur}.`
  }
  if (pilot === 'scaler') {
    const t = { conservador: [3, 10, 50], normal: [2, 20, 100], agressivo: [1.8, 30, 200] }[intensity]
    return `Escala ${t[1]}% com ROAS ≥ ${t[0]}, até ${t[2]} ${cur}/dia.`
  }
  const t = { conservador: 'seg–sex, 09:00–18:00', normal: 'seg–sex, 09:00–23:00', agressivo: 'todos os dias, 08:00–00:00' }[intensity]
  return `Ativas ${t}; pausadas fora desse horário.`
}

const AUTONOMY_OPTIONS: { value: AdsAutomationAutonomy; label: string; hint: string; icon: typeof Bell }[] = [
  { value: 'notify', label: 'Só avisar', hint: 'Apenas notifica', icon: Bell },
  { value: 'propose', label: 'Propor', hint: 'Aguarda seu OK', icon: MessagesSquare },
  { value: 'auto', label: 'Agir sozinho', hint: 'Age nos limites', icon: Rocket },
]

export function PilotsPanel({
  currency,
  rules,
  autonomy,
  saving,
  onSetPilot,
  onSetAutonomy,
  onProtectNow,
}: {
  currency: string
  rules: AdsRule[]
  autonomy: AdsAutomationAutonomy | 'custom'
  saving: boolean
  onSetPilot: (pilot: PilotId, opts: { enabled: boolean; intensity: Intensity }) => Promise<void>
  onSetAutonomy: (autonomy: AdsAutomationAutonomy) => Promise<void>
  onProtectNow?: () => Promise<void>
}) {
  const [confirmAuto, setConfirmAuto] = useState(false)
  const [confirmProtect, setConfirmProtect] = useState(false)
  const pilots = detectPilots(rules)
  // O Protetor JÁ está agindo sozinho? (regras do piloto ligadas e em executar).
  // Se sim, some o CTA de 1 clique — não faz sentido oferecer o que já está no ar.
  const protectorActing =
    (rules || []).some((r) => r.pilot === 'protector' && r.enabled && r.mode === 'execute')

  async function setAutonomy(next: AdsAutomationAutonomy) {
    if (next === autonomy) return
    if (next === 'auto') { setConfirmAuto(true); return }
    await onSetAutonomy(next)
  }

  return (
    <GlassCard className="flex flex-col gap-4 p-4" data-tour="ads-pilots">
      {/* ── Modo protetor: 1 clique liga a defesa AGINDO SOZINHA ──
          Responde ao "automações não fazem diferença": de fábrica as regras
          nascem desligadas e em modo propor, então nada acontece. Este atalho
          liga o Protetor já em executar, sem o gestor precisar achar o switch +
          a autonomia em dois cantos. Some quando já está no ar. */}
      {onProtectNow && !protectorActing && (
        <div className="flex flex-col gap-2.5 rounded-xl border border-brand-cyan/30 bg-brand-cyan/8 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-cyan/15 text-brand-cyan">
              <ShieldCheck className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-foreground">Ligar a proteção agora</p>
              <p className="text-pretty text-[11px] leading-relaxed text-muted-foreground">
                O robô passa a <strong className="text-foreground">pausar sozinho</strong> campanhas que gastam sem retorno e a segurar CPC caro — dentro dos limites de segurança.
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={() => setConfirmProtect(true)}
            className="btn-shine flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-brand-cyan px-3 py-2 text-xs font-semibold text-black transition-all hover:brightness-105 active:scale-[0.98] disabled:opacity-50"
          >
            <Zap className="size-3.5" aria-hidden="true" /> Ativar proteção
          </button>
        </div>
      )}

      {/* ── Seletor único de autonomia ── */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">Autonomia</h3>
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
                className={`flex flex-col gap-0.5 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                  selected ? 'border-primary/50 bg-primary/10 shadow-[inset_0_0_0_1px_rgba(37,244,238,0.08)]' : 'border-border bg-background hover:border-primary/40'
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
                    <p className="line-clamp-2 text-pretty text-[11px] leading-relaxed text-muted-foreground">
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
                <div className="grid grid-cols-3 items-center gap-1.5 sm:flex sm:flex-wrap sm:pl-10">
                  {INTENSITIES.map((i) => (
                    <button
                      key={i.value}
                      type="button"
                      disabled={saving}
                      aria-pressed={st.intensity === i.value}
                      onClick={() => onSetPilot(p.id, { enabled: true, intensity: i.value })}
                      className={`w-full rounded-lg px-2 py-1.5 text-[10px] font-medium transition-colors sm:w-auto sm:rounded-full sm:px-2.5 sm:py-1 sm:text-[11px] ${
                        st.intensity === i.value
                          ? 'bg-primary/15 text-primary ring-1 ring-primary/20'
                          : 'bg-secondary/70 text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {i.label}
                    </button>
                  ))}
                  {st.intensity === 'custom' && (
                    <span className="col-span-3 text-[10px] text-muted-foreground">Personalizado no modo avançado</span>
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

      {/* Confirmação do Modo protetor — liga o piloto defensivo agindo sozinho */}
      <ConfirmDialog
        open={confirmProtect}
        title="Ativar a proteção automática?"
        description={
          <>
            O <strong>Protetor de orçamento</strong> passa a agir sozinho: pausa campanhas que
            gastam sem venda ou com CPA alto e reduz o orçamento de CPC caro — só com volume mínimo
            e dentro dos limites de segurança. Ele nunca aumenta gasto. Você pode desligar quando quiser.
          </>
        }
        confirmLabel="Ativar proteção"
        busy={saving}
        onConfirm={async () => {
          await onProtectNow?.()
          setConfirmProtect(false)
        }}
        onClose={() => setConfirmProtect(false)}
      />
    </GlassCard>
  )
}
