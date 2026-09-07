'use client'

import Link from 'next/link'

interface EmqGaugeProps {
  score: number | null
  dir?: 'up' | 'down' | 'flat'
  alerts?: number
}

export function EmqGauge({ score, dir = 'flat', alerts = 0 }: EmqGaugeProps) {
  const max = 10
  const available = score !== null && Number.isFinite(score)
  const normalized = available ? Math.min(Math.max(score, 0), max) : 0
  const pct = normalized / max

  // Raio 32, circunvolução 2 * PI * 32 ~= 201
  const radius = 32
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = circumference * (1 - pct)

  const isGood = normalized >= 7
  const isMed = normalized >= 4 && normalized < 7
  const color = !available ? 'var(--text-muted)' : isGood ? '#10b981' : isMed ? '#f59e0b' : '#f43f5e'
  const statusLabel = !available ? 'Sem dados recentes' : isGood ? 'Boa cobertura' : isMed ? 'Cobertura parcial' : 'Poucos dados'
  const tooltipText = 'Estimativa de completude dos dados enviados. Não é a nota oficial do TikTok nem uma garantia de correspondência.'

  return (
    <Link
      href="/conversions?tab=pixels"
      data-tooltip={tooltipText}
      className="group flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 transition-all duration-200 hover:border-white/15 hover:bg-white/[0.05] cursor-help"
    >
      <div className="flex min-w-0 items-center gap-3">
        {/* Mostrador circular SVG */}
        <div className="relative flex size-14 shrink-0 items-center justify-center">
          <svg className="size-full -rotate-90" viewBox="0 0 80 80">
            <circle
              cx="40"
              cy="40"
              r={radius}
              fill="none"
              stroke="rgba(255, 255, 255, 0.08)"
              strokeWidth="6"
            />
            {normalized > 0 && (
              <circle
                cx="40"
                cy="40"
                r={radius}
                fill="none"
                stroke={color}
                strokeWidth="6"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                className="transition-all duration-1000 ease-out"
                style={{
                  filter: `drop-shadow(0 0 6px ${color}80)`,
                }}
              />
            )}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-mono text-sm font-bold tabular-nums text-white">
              {available ? normalized.toFixed(1).replace('.', ',') : '—'}
            </span>
          </div>
        </div>

        {/* Textos informativos concisos */}
        <div className="flex flex-col">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-white group-hover:text-cyan-400 transition-colors">
              Dados enviados
            </span>
            {alerts > 0 && (
              <span className="rounded-full bg-rose-500/20 px-1.5 py-0.2 font-mono text-[9px] font-bold text-rose-400">
                {alerts}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[11px] font-medium" style={{ color }}>
              {statusLabel}
            </span>
            <span className="text-[10px] text-white/40">
              {available ? (dir === 'up' ? '↑ Subindo' : dir === 'down' ? '↓ Caindo' : '→ Estável') : 'Aguardando eventos'}
            </span>
          </div>
        </div>
      </div>

      <span className="shrink-0 text-muted-foreground" aria-hidden="true">→</span>
    </Link>
  )
}
