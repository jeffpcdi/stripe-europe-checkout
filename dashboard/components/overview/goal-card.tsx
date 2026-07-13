'use client'

import { useMemo } from 'react'
import useSWR from 'swr'
import { Target } from 'lucide-react'
import { fetcher, useStats } from '@/lib/api'
import { aggregate, money } from '@/lib/metrics'
import { fmtPercent } from '@/lib/format'
import { GlassCard } from '@/components/glass-card'

/*
 * Itens 271 + 276: meta de receita mensal com barra de progresso e projeção
 * linear de fim de mês. A meta vem de /api/settings (revenueGoal, em
 * centavos — configurada em Config > Preferências da conta). A projeção é
 * ritmo médio diário × dias do mês, com disclaimer explícito de que é
 * estimativa. O card só existe quando há meta (> 0): sem meta, sem ruído.
 */
export function GoalCard() {
  const { data: settings } = useSWR<{ revenueGoal?: number; timezone?: string }>(
    '/api/settings',
    fetcher,
    { revalidateOnFocus: false },
  )
  const { data } = useStats()

  const goal = settings?.revenueGoal || 0
  const tz = settings?.timezone || 'America/Sao_Paulo'

  const month = useMemo(() => {
    if (!data || !goal) return null
    // "Hoje" no fuso da CONTA (não do browser) — evita o card pular de dia à
    // meia-noite UTC enquanto o resto do painel ainda mostra o dia anterior.
    let y: number
    let m: number
    let dayOfMonth: number
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date())
      ;[y, m, dayOfMonth] = parts.split('-').map(Number)
    } catch {
      const now = new Date()
      y = now.getFullYear()
      m = now.getMonth() + 1
      dayOfMonth = now.getDate()
    }
    const monthStart = new Date(y, m - 1, 1)
    const agg = aggregate(data, monthStart)
    const mtd = agg.rev[agg.mainCur] || 0
    const daysInMonth = new Date(y, m, 0).getDate()
    // Projeção linear: ritmo médio até agora estendido ao mês inteiro.
    const projected = dayOfMonth > 0 ? Math.round((mtd / dayOfMonth) * daysInMonth) : 0
    return { mtd, projected, cur: agg.mainCur, dayOfMonth, daysInMonth }
  }, [data, goal, tz])

  if (!goal || !month) return null

  const pct = Math.min(100, (month.mtd / goal) * 100)
  const projPct = Math.min(100, (month.projected / goal) * 100)
  const onTrack = month.projected >= goal
  const barColor = pct >= 100 ? '#22c55e' : onTrack ? '#25f4ee' : '#fbbf24'

  return (
    <GlassCard
      className="anim-kpi-in flex flex-col gap-3 p-5"
      role="group"
      aria-label={`Meta mensal: ${fmtPercent(pct)} atingida — ${money(month.mtd, month.cur)} de ${money(goal, month.cur)}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span
            className="flex size-8 items-center justify-center rounded-[10px]"
            style={{ color: barColor, background: 'rgba(37,244,238,.1)' }}
            aria-hidden="true"
          >
            <Target className="size-4" />
          </span>
          <span className="label-mono">Meta do mês</span>
        </div>
        <p className="font-mono text-sm font-semibold" style={{ color: barColor }}>
          <span data-sensitive>{money(month.mtd, month.cur)}</span>
          <span className="text-muted-foreground font-normal">
            {' / '}
            <span data-sensitive>{money(goal, month.cur)}</span>
          </span>
        </p>
      </div>

      {/* V2-63: barra com glow na ponta + preenchimento gradiente — o
          marcador fantasma da projeção continua atrás */}
      <div
        className="relative h-2 overflow-hidden rounded-full bg-secondary"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Progresso da meta mensal"
      >
        <div
          className={pct > 3 && pct < 100 ? 'progress-glow absolute inset-y-0 left-0 rounded-full transition-[width] duration-700' : 'absolute inset-y-0 left-0 rounded-full transition-[width] duration-700'}
          style={{
            width: `${pct}%`,
            background: `linear-gradient(90deg, ${barColor}88, ${barColor})`,
          }}
        />
        {projPct > pct && (
          <div
            className="absolute inset-y-0 rounded-full opacity-30"
            style={{ left: `${pct}%`, width: `${projPct - pct}%`, background: barColor }}
            aria-hidden="true"
          />
        )}
      </div>

      <p className="text-xs text-muted-foreground text-pretty">
        {fmtPercent(pct)} da meta no dia {month.dayOfMonth} de {month.daysInMonth}.{' '}
        {pct >= 100 ? (
          <span className="text-success font-medium">Meta batida — parabéns.</span>
        ) : (
          <>
            Projeção de fim de mês:{' '}
            <span data-sensitive className={onTrack ? 'text-brand-cyan font-medium' : 'text-warning font-medium'}>
              {money(month.projected, month.cur)}
            </span>{' '}
            ({onTrack ? 'no ritmo para bater a meta' : 'abaixo do necessário'}).
          </>
        )}{' '}
        <span className="opacity-70">Estimativa linear — não é garantia.</span>
      </p>
    </GlassCard>
  )
}
