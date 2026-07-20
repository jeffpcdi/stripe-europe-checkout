// Camada de PILOTOS — estratégias de automação em linguagem de gestor.
//
// Um piloto é uma VIEW sobre a lista de regras existente do motor
// (ads-automation.js): ativar um piloto materializa 1–3 regras tagueadas com
// `pilot`/`intensity` (whitelisted no validateRules) e gravadas pelo MESMO
// PUT /api/ads/rules de sempre. Nada aqui fala com a rede — módulo puro,
// testável, sem React. Quem orquestra as escritas é o pilots-panel.
//
// Regras SEM tag `pilot` (criadas no Modo avançado) NUNCA são tocadas por
// estas funções — o gestor avançado não perde nada ao usar pilotos.
//
// LIMITE DE 10 REGRAS (validateRules faz slice(0,10) silencioso): contas
// semeadas já têm 9 presets de fábrica. Ao ativar um piloto, applyPilot
// REMOVE os presets que ele substitui (CONSUMED_PRESETS) — ativar os três
// pilotos nunca estoura o teto.

import type { AdsRule } from './types'

export type PilotId = 'protector' | 'scaler' | 'schedule'
export type Intensity = 'conservador' | 'normal' | 'agressivo'
export type Autonomy = 'notify' | 'propose' | 'auto'

export const INTENSITIES: { value: Intensity; label: string }[] = [
  { value: 'conservador', label: 'Conservador' },
  { value: 'normal', label: 'Normal' },
  { value: 'agressivo', label: 'Agressivo' },
]

export const PILOTS: { id: PilotId; title: string; desc: string }[] = [
  {
    id: 'protector',
    title: 'Protetor de orçamento',
    desc: 'Corta o que queima dinheiro: CPA estourado, gasto sem venda e clique caro demais. Pausa também campanhas Smart+ (o TikTok não deixa ajustar o orçamento delas por fora — só pausar).',
  },
  {
    id: 'scaler',
    title: 'Escalador de vencedoras',
    desc: 'Aumenta o orçamento das campanhas com ROAS comprovado — sempre com teto por dia.',
  },
  {
    id: 'schedule',
    title: 'Horário de funcionamento',
    desc: 'Liga e pausa as campanhas nos dias e horários que você definir.',
  },
]

// Presets de fábrica que cada piloto substitui (removidos ao ativar — ver
// nota do limite de 10 regras no topo).
export const CONSUMED_PRESETS: Record<PilotId, string[]> = {
  protector: ['preset_cpa', 'preset_noconv', 'preset_cpc'],
  scaler: ['preset_scale'],
  schedule: ['preset_schedule'],
}

// ── Mapeamento intensidade → parâmetros (moeda = a da conta; fuso Brasília) ──
type ProtectorParams = {
  cpa: { threshold: number; minClicks: number; minImpressions: number }
  noconv: { threshold: number; minClicks: number; minImpressions: number }
  cpc: { threshold: number; pct: number; minClicks: number }
}
const PROTECTOR: Record<Intensity, ProtectorParams> = {
  conservador: {
    cpa: { threshold: 20, minClicks: 50, minImpressions: 2000 },
    noconv: { threshold: 30, minClicks: 50, minImpressions: 2000 },
    cpc: { threshold: 1.5, pct: 15, minClicks: 50 },
  },
  normal: {
    cpa: { threshold: 15, minClicks: 30, minImpressions: 1000 },
    noconv: { threshold: 20, minClicks: 30, minImpressions: 1000 },
    cpc: { threshold: 1, pct: 20, minClicks: 30 },
  },
  agressivo: {
    cpa: { threshold: 12, minClicks: 20, minImpressions: 800 },
    noconv: { threshold: 15, minClicks: 20, minImpressions: 800 },
    cpc: { threshold: 0.8, pct: 25, minClicks: 20 },
  },
}

const SCALER: Record<Intensity, { threshold: number; minSales: number; pct: number; budgetCap: number }> = {
  conservador: { threshold: 3, minSales: 3, pct: 10, budgetCap: 50 },
  normal: { threshold: 2, minSales: 2, pct: 20, budgetCap: 100 },
  agressivo: { threshold: 1.8, minSales: 2, pct: 30, budgetCap: 200 },
}

const SCHEDULE: Record<Intensity, { days: number[]; startTime: string; endTime: string }> = {
  conservador: { days: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '18:00' },
  normal: { days: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '23:00' },
  agressivo: { days: [0, 1, 2, 3, 4, 5, 6], startTime: '08:00', endTime: '00:00' },
}

// Fuso do projeto (Brasília) — NÃO herdar o Europe/Lisbon do preset legado.
const PILOT_TIMEZONE = 'America/Sao_Paulo'

// Constrói as regras de um piloto na intensidade pedida. `mode` default é
// 'proposal' (autonomia "Propor e eu aprovo" — decisão de produto).
export function buildPilotRules(
  pilot: PilotId,
  intensity: Intensity,
  mode: 'proposal' | 'execute' = 'proposal',
): AdsRule[] {
  const base = { enabled: true, lookbackDays: 1, mode, pilot, intensity } as const
  if (pilot === 'protector') {
    const p = PROTECTOR[intensity]
    return [
      {
        ...base,
        id: 'pilot_protector_cpa',
        name: `Protetor: CPA acima de ${p.cpa.threshold} → pausar`,
        metric: 'cpa_max', threshold: p.cpa.threshold, action: 'pause', pct: 20,
        minClicks: p.cpa.minClicks, minImpressions: p.cpa.minImpressions,
      },
      {
        ...base,
        id: 'pilot_protector_noconv',
        name: `Protetor: gastou ${p.noconv.threshold} sem venda → pausar`,
        metric: 'spend_no_conv', threshold: p.noconv.threshold, action: 'pause', pct: 20,
        minClicks: p.noconv.minClicks, minImpressions: p.noconv.minImpressions,
      },
      {
        ...base,
        id: 'pilot_protector_cpc',
        name: `Protetor: CPC acima de ${p.cpc.threshold} → reduzir orçamento`,
        metric: 'cpc_max', threshold: p.cpc.threshold, action: 'budget_down', pct: p.cpc.pct,
        minClicks: p.cpc.minClicks,
      },
    ]
  }
  if (pilot === 'scaler') {
    const s = SCALER[intensity]
    return [
      {
        ...base,
        id: 'pilot_scaler',
        name: `Escalador: ROAS ≥ ${s.threshold} → +${s.pct}% (teto ${s.budgetCap}/dia)`,
        metric: 'roas_scale', threshold: s.threshold, action: 'budget_up',
        pct: s.pct, minSales: s.minSales, budgetCap: s.budgetCap,
      },
    ]
  }
  const h = SCHEDULE[intensity]
  return [
    {
      ...base,
      id: 'pilot_schedule',
      name: `Horário: ${h.startTime}–${h.endTime}`,
      metric: 'schedule', threshold: 1, action: 'pause', pct: 20,
      days: h.days, startTime: h.startTime, endTime: h.endTime, timezone: PILOT_TIMEZONE,
    },
  ]
}

export interface PilotState {
  active: boolean
  intensity: Intensity | 'custom'
  ruleIds: string[]
}

// Lê o estado dos pilotos a partir da lista de regras do servidor. Um piloto
// está ativo se TODAS as regras dele existem habilitadas; intensidade é a das
// regras quando unânime, senão 'custom' (regra editada no Modo avançado).
export function detectPilots(rules: AdsRule[]): Record<PilotId, PilotState> {
  const out = {} as Record<PilotId, PilotState>
  for (const p of PILOTS) {
    const mine = (rules || []).filter((r) => r.pilot === p.id)
    const enabled = mine.filter((r) => r.enabled)
    const intensities = new Set(mine.map((r) => r.intensity ?? 'custom'))
    out[p.id] = {
      active: mine.length > 0 && enabled.length === mine.length,
      intensity: mine.length === 0
        ? 'custom'
        : intensities.size === 1
          ? ([...intensities][0] as Intensity | 'custom')
          : 'custom',
      ruleIds: mine.map((r) => r.id),
    }
  }
  return out
}

// Liga/desliga/ajusta um piloto. Retorna a NOVA lista completa de regras para
// enviar no PUT /api/ads/rules (o chamador decide quando gravar).
//  - enabled:true  → remove regras antigas do piloto + presets consumidos e
//    anexa as regras recém-construídas;
//  - enabled:false → remove as regras do piloto (presets consumidos NÃO
//    voltam — o gestor optou pelo piloto; o avançado pode recriá-los).
export function applyPilot(
  rules: AdsRule[],
  pilot: PilotId,
  opts: { enabled: boolean; intensity: Intensity; mode?: 'proposal' | 'execute' },
): AdsRule[] {
  const keep = (rules || []).filter(
    (r) => r.pilot !== pilot && !CONSUMED_PRESETS[pilot].includes(r.id),
  )
  if (!opts.enabled) return keep
  return [...keep, ...buildPilotRules(pilot, opts.intensity, opts.mode ?? 'proposal')]
}

// Autonomia efetiva a partir das regras-piloto + config de alertas:
//  - notify  → nenhum piloto habilitado e alertas ligados (o robô só avisa);
//  - propose → todo piloto habilitado propõe;
//  - auto    → todo piloto habilitado executa;
//  - custom  → mistura (ou nada configurado).
export function detectAutonomy(rules: AdsRule[], alertsEnabled: boolean): Autonomy | 'custom' {
  const pilotRules = (rules || []).filter((r) => r.pilot)
  const enabled = pilotRules.filter((r) => r.enabled)
  if (!enabled.length) return alertsEnabled && pilotRules.length > 0 ? 'notify' : 'custom'
  const modes = new Set(enabled.map((r) => (r.mode === 'execute' ? 'execute' : 'proposal')))
  if (modes.size > 1) return 'custom'
  return modes.has('execute') ? 'auto' : 'propose'
}

// Aplica o seletor de autonomia SOBRE AS REGRAS-PILOTO (as demais ficam):
//  - notify  → desabilita as regras-piloto (quem avisa são os alertas);
//  - propose → habilita (as de reenableIds, se vier de notify) com mode proposal;
//  - auto    → idem com mode execute.
export function applyAutonomy(rules: AdsRule[], autonomy: Autonomy, reenableIds?: string[]): AdsRule[] {
  const reenable = new Set(reenableIds ?? [])
  return (rules || []).map((r) => {
    if (!r.pilot) return r
    if (autonomy === 'notify') return { ...r, enabled: false }
    const enabled = r.enabled || reenable.size === 0 || reenable.has(r.id)
    return { ...r, enabled, mode: autonomy === 'auto' ? 'execute' as const : 'proposal' as const }
  })
}
