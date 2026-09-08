'use client'

import { ArrowDownRight, CheckCircle2, Funnel } from 'lucide-react'
import { CountUp } from '@/components/count-up'

interface FunnelGaugeProps { visits: number; checkout: number; payment: number; purchased: number }
const percent = (value: number) => value.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%'

const STEP_STYLES = [
  {
    gradient: 'linear-gradient(90deg, #38bdf8, #25f4ee)',
    glow: 'rgba(37, 244, 238, 0.4)',
    badgeBg: 'rgba(37, 244, 238, 0.12)',
    badgeText: '#25f4ee',
  },
  {
    gradient: 'linear-gradient(90deg, #25f4ee, #818cf8)',
    glow: 'rgba(129, 140, 248, 0.4)',
    badgeBg: 'rgba(129, 140, 248, 0.12)',
    badgeText: '#a5b4fc',
  },
  {
    gradient: 'linear-gradient(90deg, #a855f7, #ec4899)',
    glow: 'rgba(236, 72, 153, 0.4)',
    badgeBg: 'rgba(236, 72, 153, 0.12)',
    badgeText: '#f472b6',
  },
  {
    gradient: 'linear-gradient(90deg, #10b981, #22c55e, #4ade80)',
    glow: 'rgba(34, 197, 94, 0.5)',
    badgeBg: 'rgba(34, 197, 94, 0.15)',
    badgeText: '#4ade80',
  },
]

export function FunnelGauge({ visits, checkout, payment, purchased }: FunnelGaugeProps) {
  const steps = [
    { label: 'Visitas', value: visits, detail: 'Acessaram a página' },
    { label: 'Checkout', value: checkout, detail: 'Abriram o checkout' },
    { label: 'Pagamento', value: payment, detail: 'Iniciaram o pagamento' },
    { label: 'Compras', value: purchased, detail: 'Pagamento aprovado' },
  ]
  const convRate = visits > 0 ? (purchased / visits) * 100 : 0

  return (
    <section className="journey-funnel" aria-label="Funil de vendas">
      <header className="overview-section-heading">
        <h2>
          <Funnel size={16} className="text-brand-cyan" aria-hidden="true" />
          Funil de vendas
        </h2>
        <span title="Compras divididas por visitas" className="font-medium text-foreground">
          {visits > 0 ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/15 px-2 py-0.5 font-mono text-xs font-bold text-success shadow-[0_0_10px_rgba(34,197,94,0.15)]">
              {percent(convRate)}
            </span>
          ) : (
            '—'
          )}{' '}
          <span className="text-muted-foreground text-xs">conversão</span>
        </span>
      </header>
      <ol className="flex flex-col gap-4">
        {steps.map((step, index) => {
          const previous = index > 0 ? steps[index - 1].value : 0
          const width = visits > 0 ? Math.min(100, Math.max(0, (step.value / visits) * 100)) : 0
          const style = STEP_STYLES[index]

          return (
            <li key={step.label} className="journey-step" data-final={index === 3}>
              <div className="journey-step-head">
                <span
                  className="journey-step-number flex size-5 items-center justify-center rounded-md font-mono text-[10px] font-bold"
                  style={{ backgroundColor: style.badgeBg, color: style.badgeText }}
                  aria-hidden="true"
                >
                  {index === 3 && step.value > 0 ? (
                    <CheckCircle2 size={12} className="text-success" />
                  ) : (
                    `0${index + 1}`
                  )}
                </span>
                <span title={step.detail} className="font-medium text-foreground text-xs">
                  {step.label}
                </span>
                <strong className="font-mono text-sm font-bold text-foreground">
                  <CountUp value={step.value} />
                </strong>
                <span
                  className="journey-step-rate text-[11px] font-medium"
                  title={index > 0 ? 'Percentual que avançou da etapa anterior' : 'Base de visitantes'}
                >
                  {index > 0 && <ArrowDownRight size={12} aria-hidden="true" className="text-muted-foreground" />}
                  {index === 0 ? 'Base' : previous > 0 ? percent((step.value / previous) * 100) : '—'}
                </span>
              </div>
              <div className="journey-step-track relative overflow-hidden" aria-hidden="true">
                <span
                  style={{
                    width: `${width}%`,
                    background: style.gradient,
                    boxShadow: width > 0 ? `0 0 12px ${style.glow}` : 'none',
                  }}
                />
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
