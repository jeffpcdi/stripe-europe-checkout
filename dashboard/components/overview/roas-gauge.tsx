'use client'

import { useMemo } from 'react'

interface RoasGaugeProps {
  roas: number | null
  spend?: number
  currency?: string
  currencyMismatch?: boolean
}

export function RoasGauge({
  roas,
  spend = 0,
  currency = 'BRL',
  currencyMismatch = false,
}: RoasGaugeProps) {
  // Escala de 0 a 4.0x (ROAS 4.0+ é excelente)
  const maxScale = 4.0
  const normalizedRoas = roas !== null ? Math.min(Math.max(roas, 0), maxScale) : 0
  const pct = roas !== null ? normalizedRoas / maxScale : 0

  // Ângulo de 180 a 0 graus para o arco semicircular
  // Com raio 70, centro (90, 85)
  const radius = 62
  const cx = 90
  const cy = 80
  const circumference = Math.PI * radius
  const strokeDashoffset = circumference * (1 - pct)

  // Classificação do status visual
  const status = useMemo(() => {
    if (currencyMismatch) {
      return { label: 'Moedas divergentes', color: 'text-warning', bg: 'bg-warning/10 border-warning/20' }
    }
    if (roas === null || spend === 0) {
      return { label: 'Sem dados de ads', color: 'text-white/40', bg: 'bg-white/5 border-white/10' }
    }
    if (roas >= 2.5) {
      return { label: 'Alta Lucratividade', color: 'text-emerald-400', bg: 'bg-emerald-500/15 border-emerald-500/30' }
    }
    if (roas >= 1.5) {
      return { label: 'Lucro Estável', color: 'text-cyan-400', bg: 'bg-cyan-500/15 border-cyan-500/30' }
    }
    if (roas >= 1.0) {
      return { label: 'Equilíbrio (Breakeven)', color: 'text-amber-400', bg: 'bg-amber-500/15 border-amber-500/30' }
    }
    return { label: 'Ajustar Tráfego', color: 'text-rose-400', bg: 'bg-rose-500/15 border-rose-500/30' }
  }, [roas, spend, currencyMismatch])

  const formattedValue = useMemo(() => {
    if (currencyMismatch || roas === null) return '—'
    return `${roas.toFixed(2).replace('.', ',')}x`
  }, [roas, currencyMismatch])

  return (
    <div className="relative flex flex-col items-center justify-center pt-1">
      {/* Mostrador semicircular SVG */}
      <div className="relative h-[88px] w-[180px]">
        <svg viewBox="0 0 180 100" className="h-full w-full overflow-visible">
          <defs>
            <linearGradient id="roasGradient" x1="0%" y1="100%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#f43f5e" />
              <stop offset="35%" stopColor="#fbbf24" />
              <stop offset="65%" stopColor="#22d3ee" />
              <stop offset="100%" stopColor="#10b981" />
            </linearGradient>
            <filter id="roasGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Trilho de fundo */}
          <path
            d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
            fill="none"
            stroke="rgba(255, 255, 255, 0.08)"
            strokeWidth="10"
            strokeLinecap="round"
          />

          {/* Marcadores de marcação (ticks) */}
          <circle cx={cx - radius} cy={cy} r="1.5" fill="rgba(255,255,255,0.2)" />
          <circle cx={cx} cy={cy - radius} r="1.5" fill="rgba(255,255,255,0.2)" />
          <circle cx={cx + radius} cy={cy} r="1.5" fill="rgba(255,255,255,0.2)" />

          {/* Arco colorido de progresso */}
          {roas !== null && roas > 0 && !currencyMismatch && (
            <path
              d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
              fill="none"
              stroke="url(#roasGradient)"
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              filter="url(#roasGlow)"
              className="transition-all duration-1000 ease-out"
            />
          )}
        </svg>

        {/* Valor no centro do arco */}
        <div className="absolute inset-x-0 bottom-1 flex flex-col items-center justify-end text-center">
          <span className="font-mono text-2xl font-bold tracking-tight text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">
            {formattedValue}
          </span>
        </div>
      </div>

      {/* Rótulo de status estético e compacto */}
      <div className="mt-1 flex items-center justify-center">
        <span
          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-semibold tracking-wide ${status.bg} ${status.color}`}
        >
          {status.label}
        </span>
      </div>
    </div>
  )
}
