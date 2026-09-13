'use client'

import { ArrowDownRight, CheckCircle2, Funnel } from 'lucide-react'
import { CountUp } from '@/components/count-up'

interface FunnelGaugeProps { visits: number; checkout: number; payment: number; purchased: number }
const percent = (value: number) => value.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%'

export function FunnelGauge({ visits, checkout, payment, purchased }: FunnelGaugeProps) {
  const steps = [
    { label: 'Visitas', value: visits, detail: 'Acessaram a página' },
    { label: 'Checkout', value: checkout, detail: 'Abriram o checkout' },
    { label: 'Pagamento', value: payment, detail: 'Iniciaram o pagamento' },
    { label: 'Compras', value: purchased, detail: 'Pagamento aprovado' },
  ]
  const convRate = visits > 0 ? (purchased / visits) * 100 : 0

  return (
    <section className="journey-funnel surface-card" aria-label="Funil de vendas">
      <header className="overview-section-heading">
        <h2><span className="overview-section-icon"><Funnel size={17} aria-hidden="true" /></span>Funil de vendas</h2>
        <span className="overview-summary-badge" title="Compras divididas por visitas">
          <strong>{visits > 0 ? percent(convRate) : '—'}</strong> conversão
        </span>
      </header>
      <ol className="flex flex-col gap-2.5">
        {steps.map((step, index) => {
          const previous = index > 0 ? steps[index - 1].value : 0
          const width = visits > 0 ? Math.min(100, Math.max(0, (step.value / visits) * 100)) : 0

          return (
            <li
              key={step.label}
              className="journey-step"
              data-final={index === 3}
            >
              <div className="journey-step-head">
                <span
                  className="journey-step-number"
                  aria-hidden="true"
                >
                  {index === 3 && step.value > 0 ? (
                    <CheckCircle2 size={13} className="text-success" />
                  ) : (
                    `0${index + 1}`
                  )}
                </span>
                <span title={step.detail} className="font-medium text-foreground text-xs">
                  {step.label}
                </span>
                <strong className="font-mono text-sm sm:text-base font-bold text-foreground">
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
              <div className="journey-step-track" aria-hidden="true">
                <span
                  style={{ width: `${width}%` }}
                />
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
