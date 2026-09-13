'use client'

import Link from 'next/link'
import { ArrowRight, Check, ChevronDown, Circle, Link2, Radio, WalletCards, Wrench } from 'lucide-react'
import type { OverviewHealthResponse } from '@/lib/types'

const ICONS = { link: Link2, pixel: Radio, gateway: WalletCards }

/** Um próximo passo real; detalhes de cobertura ficam recolhidos. */
export function SetupGuide({ health }: { health?: OverviewHealthResponse }) {
  const guide = health?.guide
  const action = guide?.nextAction ?? health?.actions[0]
  if (!health?.ok || !action) return null
  const pendingSetup = guide && guide.configured < guide.total

  return (
    <section className="setup-guide" aria-label="Próximo passo da conta" data-severity={action.severity}>
      <div className="setup-guide-main">
        <span className="setup-guide-icon" aria-hidden="true"><Wrench size={20} /></span>
        <div className="setup-guide-title">
          <span>{pendingSetup ? `Configuração · ${guide.configured}/${guide.total}` : 'Revisar rastreamento'}</span>
          <h2>{action.title}</h2>
        </div>
        <Link href={action.href} className="btn-secondary setup-guide-action">{pendingSetup ? 'Configurar' : 'Revisar'}<ArrowRight size={16} aria-hidden="true" /></Link>
      </div>
      <details className="setup-guide-details">
        <summary><ChevronDown size={14} aria-hidden="true" />Ver detalhes{health.actions.length > 1 ? ` · ${health.actions.length} pendências` : ''}</summary>
        <p>{action.detail}</p>
        {guide && <ol className="setup-guide-steps">
          {guide.steps.map(step => {
            const Icon = ICONS[step.id as keyof typeof ICONS] || Circle
            return <li key={step.id}><Link href={step.href} data-configured={step.configured}>
              <Icon size={18} aria-hidden="true" /><span>{step.label}</span>
              {step.configured ? <Check size={16} aria-label="Cadastrado" /> : <ArrowRight size={16} aria-label="Configurar" />}
            </Link></li>
          })}
        </ol>}
        {health.actions.length > 1 && <ul className="setup-guide-pending">{health.actions.filter(item => item.id !== action.id).map(item => <li key={item.id}><Link href={item.href}>{item.title}<ArrowRight size={14} aria-hidden="true" /></Link></li>)}</ul>}
        <small>Cadastros não confirmam a entrega de eventos. Confira o recebimento em Conversões.</small>
      </details>
    </section>
  )
}
