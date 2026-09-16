'use client'

import { CountUp } from '@/components/count-up'

interface FunnelGaugeProps { visits: number; checkout: number; payment: number; purchased: number }
const percent = (value: number) => value.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%'

export function FunnelGauge({ visits, checkout, payment, purchased }: FunnelGaugeProps) {
  const steps = [
    { label: 'Visitas', value: visits },
    { label: 'Checkout', value: checkout },
    { label: 'Pagamento', value: payment },
    { label: 'Compras', value: purchased },
  ]
  const convRate = visits > 0 ? (purchased / visits) * 100 : 0

  return (
    <section className="journey-funnel surface-card" aria-label="Funil de vendas">
      <header className="overview-section-heading overview-section-heading--plain">
        <h2>Funil</h2>
        <span className="funnel-conversion" title="Compras divididas por visitas">
          {visits > 0 ? `${percent(convRate)} conversão` : 'Sem conversão'}
        </span>
      </header>

      <ol className="journey-funnel-flow">
        {steps.map((step, index) => {
          const previous = index > 0 ? steps[index - 1].value : 0
          const rate = index === 0 ? null : previous > 0 ? (step.value / previous) * 100 : null

          return (
            <li key={step.label} className="journey-flow-item" data-final={index === steps.length - 1}>
              {index > 0 && (
                <span
                  className="journey-flow-rate"
                  title="Percentual que avançou da etapa anterior"
                  aria-label={rate === null ? 'Taxa indisponível' : `${percent(rate)} avançaram da etapa anterior`}
                >
                  <span className="journey-flow-line" aria-hidden="true" />
                  <span>{rate === null ? '—' : percent(rate)}</span>
                </span>
              )}
              <div className="journey-flow-stage">
                <strong className="journey-flow-value"><CountUp value={step.value} /></strong>
                <span className="journey-flow-label">{step.label}</span>
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
