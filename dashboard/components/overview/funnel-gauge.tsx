'use client'

import { useState } from 'react'
import { CountUp } from '@/components/count-up'

interface FunnelGaugeProps {
  visits: number
  checkout: number
  payment: number
  purchased: number
}

export function FunnelGauge({ visits, checkout, payment, purchased }: FunnelGaugeProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)

  const steps = [
    {
      id: 'visits',
      label: 'Visitas',
      shortLabel: 'Visitas',
      value: visits,
      color: 'bg-cyan-500',
      glow: 'shadow-[0_0_12px_rgba(6,182,212,0.4)]',
      textColor: 'text-cyan-400',
      borderColor: 'border-cyan-500/30',
      tooltip: 'Pessoas que acessaram sua página de vendas.',
    },
    {
      id: 'checkout',
      label: 'Checkout',
      shortLabel: 'Checkout',
      value: checkout,
      color: 'bg-amber-400',
      glow: 'shadow-[0_0_12px_rgba(251,191,36,0.4)]',
      textColor: 'text-amber-400',
      borderColor: 'border-amber-500/30',
      tooltip: 'Visitantes que clicaram em comprar e abriram o checkout.',
    },
    {
      id: 'payment',
      label: 'Pagamento',
      shortLabel: 'Pagamento',
      value: payment,
      color: 'bg-violet-400',
      glow: 'shadow-[0_0_12px_rgba(167,139,250,0.4)]',
      textColor: 'text-violet-400',
      borderColor: 'border-violet-500/30',
      tooltip: 'Clientes que preencheram dados e geraram Pix ou Cartão.',
    },
    {
      id: 'purchased',
      label: 'Compras',
      shortLabel: 'Compras',
      value: purchased,
      color: 'bg-emerald-400',
      glow: 'shadow-[0_0_12px_rgba(52,211,153,0.4)]',
      textColor: 'text-emerald-400',
      borderColor: 'border-emerald-500/30',
      tooltip: 'Pedidos com pagamento confirmado e aprovado.',
    },
  ]

  const maxVal = Math.max(visits, 1)
  const overallRate = visits > 0 ? ((purchased / visits) * 100).toFixed(1) : '0.0'

  return (
    <div className="flex flex-col gap-3">
      {/* Cabeçalho do Funil com Taxa Geral */}
      <div className="flex items-center justify-between">
        <div
          data-tooltip="Acompanhamento passo a passo dos visitantes até a compra final."
          className="flex items-center gap-2 cursor-help"
        >
          <span className="flex size-2 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70">
            Pipeline de Conversão
          </h3>
        </div>
        <div
          data-tooltip="Taxa de Conversão Final: percentual de visitantes que viraram compradores."
          className="flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 cursor-help"
        >
          <span className="text-[10px] text-white/50">Geral:</span>
          <span className="font-mono text-xs font-bold text-emerald-400">{overallRate}%</span>
        </div>
      </div>

      {/* Grid horizontal de etapas interativas */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {steps.map((step, idx) => {
          const isHovered = hoveredIdx === idx
          const prevVal = idx > 0 ? steps[idx - 1].value : 0
          const stepConversion =
            idx > 0 && prevVal > 0 ? ((step.value / prevVal) * 100).toFixed(1) : null

          return (
            <div
              key={step.id}
              data-tooltip={step.tooltip}
              onMouseEnter={() => setHoveredIdx(idx)}
              onMouseLeave={() => setHoveredIdx(null)}
              className={`group relative flex flex-col justify-between rounded-xl border p-2.5 transition-all duration-200 cursor-help ${
                isHovered
                  ? `border-white/25 bg-white/[0.07] ${step.glow}`
                  : `border-white/[0.06] bg-white/[0.02] hover:border-white/15`
              }`}
            >
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10.5px] font-medium text-white/60 group-hover:text-white">
                  {step.shortLabel}
                </span>
                {stepConversion && (
                  <span className="rounded bg-white/[0.06] px-1.5 py-0.2 font-mono text-[9px] font-semibold text-white/50">
                    {stepConversion}%
                  </span>
                )}
              </div>

              <div className="my-1">
                <span className="font-mono text-lg font-bold tracking-tight text-white sm:text-xl">
                  <CountUp value={step.value} />
                </span>
              </div>

              {/* Mini barra de proporção visual */}
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className={`h-full rounded-full ${step.color} transition-all duration-700 ease-out`}
                  style={{
                    width: `${Math.max(2, Math.min(100, (step.value / maxVal) * 100))}%`,
                  }}
                />
              </div>
            </div>
          )
        })}
      </div>

      {/* Conexão visual elegante das taxas de passagem (Fluxo de Retenção) */}
      <div className="hidden sm:flex items-center justify-between rounded-lg border border-white/[0.04] bg-white/[0.02] px-3 py-1.5 text-[10.5px] font-mono">
        <span
          data-tooltip="Taxa de passagem de cada etapa do funil para a próxima."
          className="text-white/40 cursor-help"
        >
          Retenção de Funil:
        </span>
        <div className="flex items-center gap-1.5 text-white/70">
          <span className="text-cyan-400">Visitas</span>
          <span className="text-white/30">→</span>
          <span
            data-tooltip="De cada 100 visitas, quantos abriram o checkout."
            className="text-amber-400 cursor-help"
          >
            {visits > 0 ? ((checkout / visits) * 100).toFixed(1) : '0.0'}% checkout
          </span>
          <span className="text-white/30">→</span>
          <span
            data-tooltip="De quem abriu o checkout, quantos inseriram dados para pagar."
            className="text-violet-400 cursor-help"
          >
            {checkout > 0 ? ((payment / checkout) * 100).toFixed(1) : '0.0'}% pgto
          </span>
          <span className="text-white/30">→</span>
          <span
            data-tooltip="De quem gerou pagamento, quantos tiveram a compra aprovada."
            className="font-semibold text-emerald-400 cursor-help"
          >
            {payment > 0 ? ((purchased / payment) * 100).toFixed(1) : '0.0'}% aprovadas
          </span>
        </div>
      </div>
    </div>
  )
}
