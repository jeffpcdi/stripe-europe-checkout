'use client'

// Pilotos de automação — Os 3 cartões objetivos da aba Automações:
// 1. Piloto Automático Principal (Ligar/desligar autonomia, teto de ações e status operacional)
// 2. Regras de Proteção (Pausar se gastar R$ X sem conversão, limites de CPA e CPC)
// 3. Regras de Escala (Aumentar orçamento em X% se o CPA/ROAS for bom, com teto diário)

import { useState } from 'react'
import {
  Bell, MessagesSquare, Rocket, ShieldCheck, TrendingUp, Clock3,
  Loader2, Zap, AlertTriangle, ChevronDown, Check,
  Settings2,
} from 'lucide-react'
import type { AdsAutomationAutonomy, AdsRule } from '@/lib/types'
import {
  PILOTS, INTENSITIES, detectPilots,
  type PilotId, type Intensity,
} from '@/lib/pilots'
import { GlassCard } from '@/components/glass-card'
import { Switch } from '@/components/switch'
import { ConfirmDialog } from '@/components/confirm-dialog'

// Frase-resumo do que o piloto FAZ na intensidade escolhida
function pilotSummary(pilot: PilotId, intensity: Intensity | 'custom', cur: string): string {
  if (intensity === 'custom') return 'Configuração personalizada ativa.'
  if (pilot === 'protector') {
    const t = { conservador: [20, 30, 1.5], normal: [15, 20, 1], agressivo: [12, 15, 0.8] }[intensity]
    return `Pausa anúncio se gastar ${t[1]} ${cur} sem conversão; pausa com CPA > ${t[0]} ${cur}; reduz orçamento com CPC > ${t[2]} ${cur}.`
  }
  if (pilot === 'scaler') {
    const t = { conservador: [3, 10, 50], normal: [2, 20, 100], agressivo: [1.8, 30, 200] }[intensity]
    return `Aumenta orçamento em +${t[1]}% quando ROAS ≥ ${t[0]}x, até o teto de ${t[2]} ${cur}/dia.`
  }
  const t = { conservador: 'seg–sex, 09:00–18:00', normal: 'seg–sex, 09:00–23:00', agressivo: 'todos os dias, 08:00–00:00' }[intensity]
  return `Ativas ${t}; pausadas fora desse horário.`
}

const AUTONOMY_OPTIONS: { value: AdsAutomationAutonomy; label: string; hint: string; icon: typeof Bell }[] = [
  { value: 'notify', label: 'Só avisar', hint: 'Apenas notifica no painel', icon: Bell },
  { value: 'propose', label: 'Propor', hint: 'Cria propostas para seu OK', icon: MessagesSquare },
  { value: 'auto', label: '100% Autônomo', hint: 'Executa dentro dos limites', icon: Rocket },
]

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
  onSetPilot: (pilot: PilotId, opts: { enabled: boolean; intensity: Intensity }) => Promise<void>
  onSetAutonomy: (autonomy: AdsAutomationAutonomy) => Promise<void>
  automaticBlockedReason?: string | null
  onOpenLimits?: () => void
}) {
  const [confirmAuto, setConfirmAuto] = useState(false)
  const [showSafetyWarning, setShowSafetyWarning] = useState(false)
  const [scheduleExpanded, setScheduleExpanded] = useState(false)
  const pilots = detectPilots(rules)

  async function setAutonomy(next: AdsAutomationAutonomy) {
    if (next === autonomy) return
    if (next === 'auto') {
      if (automaticBlockedReason) {
        setShowSafetyWarning(true)
        return
      }
      setConfirmAuto(true)
      return
    }
    setShowSafetyWarning(false)
    await onSetAutonomy(next)
  }

  const protector = pilots.protector
  const scaler = pilots.scaler
  const schedule = pilots.schedule

  const effectiveProtectorIntensity: Intensity = protector.intensity === 'custom' ? 'normal' : protector.intensity
  const effectiveScalerIntensity: Intensity = scaler.intensity === 'custom' ? 'normal' : scaler.intensity
  const effectiveScheduleIntensity: Intensity = schedule.intensity === 'custom' ? 'normal' : schedule.intensity

  // Valores dinâmicos da intensidade atual para os cards objetivos
  const protectorValues = {
    conservador: { spendNoConv: 30, cpaMax: 20, cpcMax: 1.5 },
    normal: { spendNoConv: 20, cpaMax: 15, cpcMax: 1.0 },
    agressivo: { spendNoConv: 15, cpaMax: 12, cpcMax: 0.8 },
  }[effectiveProtectorIntensity]

  const scalerValues = {
    conservador: { pct: 10, roasMin: 3.0, budgetCap: 50 },
    normal: { pct: 20, roasMin: 2.0, budgetCap: 100 },
    agressivo: { pct: 30, roasMin: 1.8, budgetCap: 200 },
  }[effectiveScalerIntensity]

  return (
    <div className="flex flex-col gap-4" data-tour="ads-pilots">
      {/* ══════════════════════════════════════════════════════════════════
          CARTÃO 1: PILOTO AUTOMÁTICO PRINCIPAL
          ══════════════════════════════════════════════════════════════════ */}
      <GlassCard className="flex flex-col gap-4 p-4 sm:p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary shadow-sm">
              <Zap className="size-5" aria-hidden="true" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-foreground">Piloto Automático Principal</h3>
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  autonomy === 'auto'
                    ? 'bg-success/15 text-success border border-success/30'
                    : autonomy === 'propose'
                    ? 'bg-primary/15 text-primary border border-primary/30'
                    : 'bg-secondary text-muted-foreground border border-border'
                }`}>
                  <span className={`size-1.5 rounded-full ${
                    autonomy === 'auto' ? 'bg-success animate-pulse' : autonomy === 'propose' ? 'bg-primary' : 'bg-muted-foreground'
                  }`} />
                  {autonomy === 'auto' ? '100% Autônomo' : autonomy === 'propose' ? 'Modo Proposta' : 'Apenas Avisos'}
                </span>
              </div>
              <p className="text-xs text-muted">
                Controle geral de autonomia e limites de execução do robô 24/7.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-center">
            {saving && <Loader2 className="size-4 animate-spin text-muted" aria-hidden="true" />}
            {onOpenLimits && (
              <button
                type="button"
                className="btn-secondary gap-1.5 text-xs"
                onClick={onOpenLimits}
                title="Configurar teto de ações por hora, kill switch e limites de proteção"
              >
                <Settings2 className="size-3.5" aria-hidden="true" />
                Teto de Ações & Segurança
              </button>
            )}
          </div>
        </div>

        {/* Seleção de Nível de Autonomia */}
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3" role="radiogroup" aria-label="Nível de Autonomia do Piloto">
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
                className={`flex flex-col gap-1 rounded-xl border p-3 text-left transition-all ${
                  selected
                    ? 'border-primary/60 bg-primary/10 shadow-[inset_0_0_0_1px_rgba(37,244,238,0.12)]'
                    : 'border-border bg-background hover:border-primary/30 hover:bg-secondary/30'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-bold text-foreground">
                    <o.icon className={`size-4 ${selected ? 'text-primary' : 'text-muted'}`} aria-hidden="true" />
                    {o.label}
                  </span>
                  {selected && <Check className="size-3.5 text-primary" aria-hidden="true" />}
                </div>
                <span className="text-[11px] text-muted">{o.hint}</span>
              </button>
            )
          })}
        </div>

        {/* Alerta de bloqueio de segurança */}
        {showSafetyWarning && automaticBlockedReason && (
          <div className="flex flex-col gap-2 rounded-xl border border-warning/40 bg-warning/5 p-3 text-xs text-muted sm:flex-row sm:items-center sm:justify-between" role="alert">
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-4 shrink-0 text-warning" aria-hidden="true" />
              <span className="text-pretty">{automaticBlockedReason}</span>
            </div>
            {onOpenLimits && (
              <button
                type="button"
                className="btn-ghost shrink-0 text-xs font-semibold text-warning"
                onClick={() => {
                  setShowSafetyWarning(false)
                  onOpenLimits()
                }}
              >
                Ajustar limites
              </button>
            )}
          </div>
        )}
      </GlassCard>

      {/* ══════════════════════════════════════════════════════════════════
          CARTÃO 2: REGRAS DE PROTEÇÃO (Stop-Loss de Anúncios)
          ══════════════════════════════════════════════════════════════════ */}
      <GlassCard className={`flex flex-col gap-4 p-4 sm:p-5 transition-colors ${
        protector.active ? 'border-border' : 'opacity-80 border-border/60 bg-card/60'
      }`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-error/10 text-error shadow-sm">
              <ShieldCheck className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-foreground">Regras de Proteção</h3>
                {protector.active ? (
                  <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold text-success border border-success/30">
                    Ativo
                  </span>
                ) : (
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold text-muted border border-border">
                    Pausado
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-muted">
                Pausa anúncios ruins e protege seu orçamento antes de queimar caixa.
              </p>
            </div>
          </div>
          <Switch
            checked={protector.active}
            disabled={saving}
            onCheckedChange={(on) => onSetPilot('protector', { enabled: on, intensity: effectiveProtectorIntensity })}
            aria-label={protector.active ? 'Desligar Regras de Proteção' : 'Ligar Regras de Proteção'}
          />
        </div>

        {/* Métricas Objetivas da Regra de Proteção */}
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          {/* Pausar se gastar R$ X sem conversão */}
          <div className="flex flex-col gap-1 rounded-xl border border-border bg-background/80 p-3">
            <span className="text-[11px] font-semibold text-muted">Sem conversão</span>
            <div className="flex items-baseline gap-1 text-sm font-bold text-foreground">
              Pausar se gastar <span className="text-error font-extrabold">{protectorValues.spendNoConv} {currency}</span>
            </div>
            <span className="text-[10px] text-faint">Pausa imediata após 0 vendas</span>
          </div>

          {/* Pausar se CPA ultrapassar R$ X */}
          <div className="flex flex-col gap-1 rounded-xl border border-border bg-background/80 p-3">
            <span className="text-[11px] font-semibold text-muted">Teto de CPA</span>
            <div className="flex items-baseline gap-1 text-sm font-bold text-foreground">
              Pausar com CPA &gt; <span className="text-error font-extrabold">{protectorValues.cpaMax} {currency}</span>
            </div>
            <span className="text-[10px] text-faint">Custo por venda acima da meta</span>
          </div>

          {/* Reduzir orçamento se CPC ultrapassar R$ X */}
          <div className="flex flex-col gap-1 rounded-xl border border-border bg-background/80 p-3">
            <span className="text-[11px] font-semibold text-muted">Teto de CPC</span>
            <div className="flex items-baseline gap-1 text-sm font-bold text-foreground">
              Reduzir com CPC &gt; <span className="text-warning font-extrabold">{protectorValues.cpcMax.toFixed(2)} {currency}</span>
            </div>
            <span className="text-[10px] text-faint">Corta 20% do orçamento do anúncio</span>
          </div>
        </div>

        {/* Seletor de Calibração / Intensidade */}
        <div className="flex flex-col gap-2 rounded-xl border border-border/60 bg-secondary/30 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-foreground">Intensidade de Proteção:</span>
            <div className="flex items-center gap-1.5">
              {INTENSITIES.map((i) => (
                <button
                  key={i.value}
                  type="button"
                  disabled={saving || !protector.active}
                  aria-pressed={protector.intensity === i.value}
                  onClick={() => onSetPilot('protector', { enabled: true, intensity: i.value })}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-all ${
                    protector.intensity === i.value
                      ? 'btn-primary px-2.5 py-1 text-xs shadow-sm'
                      : 'bg-background text-muted hover:text-foreground border border-border'
                  }`}
                >
                  {i.label}
                </button>
              ))}
            </div>
          </div>
          <p className="text-[11px] leading-relaxed text-muted">
            {protector.active ? pilotSummary('protector', protector.intensity, currency) : 'Ligue as regras para aplicar a proteção contra desperdício.'}
          </p>
        </div>
      </GlassCard>

      {/* ══════════════════════════════════════════════════════════════════
          CARTÃO 3: REGRAS DE ESCALA (Aumento Inteligente de Orçamento)
          ══════════════════════════════════════════════════════════════════ */}
      <GlassCard className={`flex flex-col gap-4 p-4 sm:p-5 transition-colors ${
        scaler.active ? 'border-border' : 'opacity-80 border-border/60 bg-card/60'
      }`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-success/10 text-success shadow-sm">
              <TrendingUp className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-foreground">Regras de Escala</h3>
                {scaler.active ? (
                  <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold text-success border border-success/30">
                    Ativo
                  </span>
                ) : (
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold text-muted border border-border">
                    Pausado
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-muted">
                Aumenta o investimento automaticamente nas campanhas campeãs com ROI comprovado.
              </p>
            </div>
          </div>
          <Switch
            checked={scaler.active}
            disabled={saving}
            onCheckedChange={(on) => onSetPilot('scaler', { enabled: on, intensity: effectiveScalerIntensity })}
            aria-label={scaler.active ? 'Desligar Regras de Escala' : 'Ligar Regras de Escala'}
          />
        </div>

        {/* Métricas Objetivas da Regra de Escala */}
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          {/* Aumentar orçamento em X% */}
          <div className="flex flex-col gap-1 rounded-xl border border-border bg-background/80 p-3">
            <span className="text-[11px] font-semibold text-muted">Aumento de Escala</span>
            <div className="flex items-baseline gap-1 text-sm font-bold text-foreground">
              Aumentar em <span className="text-success font-extrabold">+{scalerValues.pct}%</span>
            </div>
            <span className="text-[10px] text-faint">Ajuste gradual de orçamento</span>
          </div>

          {/* Condição de ROAS / CPA bom */}
          <div className="flex flex-col gap-1 rounded-xl border border-border bg-background/80 p-3">
            <span className="text-[11px] font-semibold text-muted">Gatilho de Lucro</span>
            <div className="flex items-baseline gap-1 text-sm font-bold text-foreground">
              Se ROAS &ge; <span className="text-success font-extrabold">{scalerValues.roasMin.toFixed(1)}x</span>
            </div>
            <span className="text-[10px] text-faint">Retorno mínimo comprovado</span>
          </div>

          {/* Teto Diário de Segurança */}
          <div className="flex flex-col gap-1 rounded-xl border border-border bg-background/80 p-3">
            <span className="text-[11px] font-semibold text-muted">Teto Diário Máximo</span>
            <div className="flex items-baseline gap-1 text-sm font-bold text-foreground">
              Até <span className="text-foreground font-extrabold">{scalerValues.budgetCap} {currency}/dia</span>
            </div>
            <span className="text-[10px] text-faint">Limite diário de proteção</span>
          </div>
        </div>

        {/* Seletor de Calibração / Intensidade */}
        <div className="flex flex-col gap-2 rounded-xl border border-border/60 bg-secondary/30 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-foreground">Intensidade de Escala:</span>
            <div className="flex items-center gap-1.5">
              {INTENSITIES.map((i) => (
                <button
                  key={i.value}
                  type="button"
                  disabled={saving || !scaler.active}
                  aria-pressed={scaler.intensity === i.value}
                  onClick={() => onSetPilot('scaler', { enabled: true, intensity: i.value })}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-all ${
                    scaler.intensity === i.value
                      ? 'btn-primary px-2.5 py-1 text-xs shadow-sm'
                      : 'bg-background text-muted hover:text-foreground border border-border'
                  }`}
                >
                  {i.label}
                </button>
              ))}
            </div>
          </div>
          <p className="text-[11px] leading-relaxed text-muted">
            {scaler.active ? pilotSummary('scaler', scaler.intensity, currency) : 'Ligue as regras para escalar anúncios lucrativos com segurança.'}
          </p>
        </div>
      </GlassCard>

      {/* Regra de Horário de Operação (Opcional / Recolhível) */}
      <details
        className="group rounded-xl border border-border bg-card/60 p-3.5"
        open={scheduleExpanded}
        onToggle={(e) => setScheduleExpanded((e.target as HTMLDetailsElement).open)}
      >
        <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-semibold text-foreground">
          <span className="flex items-center gap-2">
            <Clock3 className="size-4 text-muted" aria-hidden="true" />
            Horário de Funcionamento das Campanhas (Dayparting)
            {schedule.active && (
              <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold text-success border border-success/30">
                Ativo
              </span>
            )}
          </span>
          <ChevronDown className="size-4 text-muted transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="mt-3 flex flex-col gap-3 border-t border-border/50 pt-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted">
              {schedule.active ? pilotSummary('schedule', schedule.intensity, currency) : 'Pausa automaticamente campanhas fora dos horários de pico.'}
            </p>
            <Switch
              checked={schedule.active}
              disabled={saving}
              onCheckedChange={(on) => onSetPilot('schedule', { enabled: on, intensity: effectiveScheduleIntensity })}
              aria-label={schedule.active ? 'Desligar Horário' : 'Ligar Horário'}
            />
          </div>
          {schedule.active && (
            <div className="flex items-center gap-1.5">
              {INTENSITIES.map((i) => (
                <button
                  key={i.value}
                  type="button"
                  disabled={saving}
                  aria-pressed={schedule.intensity === i.value}
                  onClick={() => onSetPilot('schedule', { enabled: true, intensity: i.value })}
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                    schedule.intensity === i.value
                      ? 'btn-primary px-2.5 py-1 text-xs'
                      : 'bg-secondary/70 text-muted hover:text-foreground'
                  }`}
                >
                  {i.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </details>

      {/* Confirmação para autonomia total */}
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
        confirmLabel="Ativar Autonomia"
        busy={saving}
        onConfirm={async () => {
          await onSetAutonomy('auto')
          setConfirmAuto(false)
        }}
        onClose={() => setConfirmAuto(false)}
      />
    </div>
  )
}

