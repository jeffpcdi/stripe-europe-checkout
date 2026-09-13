'use client'

import Link from 'next/link'
import { ArrowRight, CheckCircle2, Circle } from 'lucide-react'

export interface OverviewHealthData {
  setup?: {
    links?: { total?: number; active?: number }
    pixels?: { total?: number; active?: number; ready?: number; incomplete?: number }
    gateways?: { total?: number; lastEventAt?: string | null }
  }
  guide?: {
    completed?: number
    total?: number
    next?: { id: string; label: string; href: string }
  }
}

export function SetupGuide({ health }: { health?: OverviewHealthData | null }) {
  if (!health || !health.setup) return null

  const hasLink = (health.setup.links?.total ?? 0) > 0
  const hasPixel = (health.setup.pixels?.ready ?? 0) > 0
  const hasGateway = (health.setup.gateways?.total ?? 0) > 0

  const steps = [
    {
      id: 'link',
      label: 'Crie um link rastreado',
      desc: 'Direciona seu tráfego com parâmetros e cloaker.',
      done: hasLink,
      href: '/links',
    },
    {
      id: 'pixel',
      label: 'Configure um pixel',
      desc: 'Vincula o TikTok Ads para envio de conversões via CAPI.',
      done: hasPixel,
      href: '/conversions?tab=pixels',
    },
    {
      id: 'gateway',
      label: 'Conecte um gateway',
      desc: 'Receba confirmações de pagamento dos checkouts.',
      done: hasGateway,
      href: '/conversions?tab=gateways',
    },
  ]

  const completed = steps.filter((s) => s.done).length

  // Conta pronta não vê onboarding repetido
  if (completed === steps.length) return null

  const nextStep = steps.find((s) => !s.done) || steps[0]

  return (
    <section className="setup-guide rounded-2xl border border-border/70 bg-card/60 p-4 sm:p-5 backdrop-blur-md" aria-label="Guia de configuração inicial">
      <div className="setup-guide-main flex items-center justify-between gap-4">
        <div className="setup-guide-title min-w-0">
          <span className="text-[11px] font-medium tracking-wide uppercase text-muted-foreground">
            Configuração · {completed}/3
          </span>
          <h2 className="mt-0.5 text-sm sm:text-base font-semibold text-foreground truncate">
            {nextStep.label}
          </h2>
        </div>

        <Link
          href={nextStep.href}
          className="setup-guide-action btn-primary inline-flex items-center gap-1.5 text-xs py-2 px-3.5 shrink-0"
        >
          <span>Continuar</span>
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      </div>

      <details className="setup-guide-details mt-3 text-xs text-muted-foreground">
        <summary className="cursor-pointer font-medium hover:text-foreground select-none">
          Ver etapas da configuração
        </summary>
        <div className="mt-3 space-y-2 border-t border-border/40 pt-3">
          <p className="text-[11px] text-muted-foreground">
            Cadastros não confirmam a entrega de eventos até o primeiro teste real de disparo.
          </p>
          <ul className="setup-guide-steps grid gap-2 sm:grid-cols-3">
            {steps.map((step) => (
              <li
                key={step.id}
                className="flex items-start gap-2 rounded-xl border border-border/40 bg-secondary/20 p-2.5"
              >
                {step.done ? (
                  <CheckCircle2 className="size-4 shrink-0 text-emerald-400 mt-0.5" aria-hidden="true" />
                ) : (
                  <Circle className="size-4 shrink-0 text-muted-foreground mt-0.5" aria-hidden="true" />
                )}
                <div className="min-w-0 flex-1">
                  <Link
                    href={step.href}
                    className="font-medium text-foreground hover:underline block truncate text-xs"
                  >
                    {step.label}
                  </Link>
                  <p className="text-[10px] text-muted-foreground line-clamp-2 mt-0.5">
                    {step.desc}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </details>
    </section>
  )
}
