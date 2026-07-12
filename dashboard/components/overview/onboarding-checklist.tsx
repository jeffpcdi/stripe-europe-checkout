'use client'

import Link from 'next/link'
import { CircleCheck, Circle, ArrowRight, Rocket } from 'lucide-react'
import { useLinks, usePixels, useGateways } from '@/lib/api'
import { GlassCard } from '@/components/glass-card'
import { cn } from '@/lib/utils'

/* Item 288: estado vazio guiado — em vez de KPIs zerados e gráfico chapado,
   a conta nova vê um checklist de onboarding cujo progresso é derivado de
   dados REAIS (links/pixels/gateways cadastrados, primeira visita, primeira
   venda), não de flags manuais. Cada passo pendente vira atalho direto. */

interface Step {
  label: string
  desc: string
  done: boolean
  href: string
}

export function OnboardingChecklist({
  hasVisits,
  hasSales,
}: {
  hasVisits: boolean
  hasSales: boolean
}) {
  const { data: links } = useLinks()
  const { data: pixels } = usePixels()
  const { data: gateways } = useGateways()

  const steps: Step[] = [
    {
      label: 'Crie um link rastreado',
      desc: 'É por ele que o tráfego entra com atribuição',
      done: (links?.links?.length ?? 0) > 0,
      href: '/links',
    },
    {
      label: 'Configure um pixel',
      desc: 'Envia conversões para a plataforma de anúncios',
      done: (pixels?.pixels?.length ?? 0) > 0,
      href: '/pixels',
    },
    {
      label: 'Conecte um gateway',
      desc: 'Recebe os webhooks de pagamento',
      done: (gateways?.gateways?.length ?? 0) > 0,
      href: '/gateways',
    },
    {
      label: 'Receba a primeira visita',
      desc: 'Divulgue o link rastreado e acompanhe aqui',
      done: hasVisits,
      href: '/live',
    },
    {
      label: 'Registre a primeira venda',
      desc: 'O webhook do gateway fecha o ciclo de atribuição',
      done: hasSales,
      href: '/activity',
    },
  ]

  const doneCount = steps.filter((s) => s.done).length
  const pct = Math.round((doneCount / steps.length) * 100)

  return (
    <GlassCard className="p-6" role="region" aria-label="Primeiros passos">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-[10px] bg-[rgba(37,244,238,.1)] text-[#25f4ee]">
            <Rocket className="size-4.5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-sm font-semibold">Primeiros passos</h2>
            <p className="text-xs text-muted-foreground">
              {doneCount} de {steps.length} concluídos — complete para ver as métricas ganharem vida
            </p>
          </div>
        </div>

        {/* Barra de progresso real */}
        <div
          className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/5"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Onboarding ${pct}% concluído`}
        >
          <div
            className="h-full rounded-full bg-[#25f4ee] transition-[width] duration-700"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <ul className="mt-4 flex flex-col">
        {steps.map((s) => (
          <li key={s.label}>
            <Link
              href={s.href}
              className={cn(
                'group flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-white/[.04]',
                s.done && 'opacity-55',
              )}
            >
              {s.done ? (
                <CircleCheck className="size-4.5 shrink-0 text-success" aria-hidden="true" />
              ) : (
                <Circle className="size-4.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              )}
              <span className="flex min-w-0 flex-1 flex-col">
                <span className={cn('text-sm', s.done && 'line-through')}>{s.label}</span>
                <span className="truncate text-xs text-muted-foreground">{s.desc}</span>
              </span>
              <span className="sr-only">{s.done ? 'concluído' : 'pendente'}</span>
              {!s.done && (
                <ArrowRight
                  className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                  aria-hidden="true"
                />
              )}
            </Link>
          </li>
        ))}
      </ul>
    </GlassCard>
  )
}
