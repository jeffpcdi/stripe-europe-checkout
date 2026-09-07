'use client'

import Link from 'next/link'
import {
  ArrowUpRight,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Link2,
  ServerCog,
  ShieldCheck,
} from 'lucide-react'
import { useOverviewHealth } from '@/lib/api'
import { useAfterFirstPaint } from '@/lib/use-after-first-paint'
import { timeAgo } from '@/lib/format'
import { GlassCard } from '@/components/glass-card'
import { Skeleton } from '@/components/skeleton'
import { cn } from '@/lib/utils'

function CoverageItem({
  icon: Icon,
  label,
  value,
  detail,
  warning,
}: {
  icon: typeof ShieldCheck
  label: string
  value: string
  detail: string
  warning?: boolean
}) {
  return (
    <div
      className="flex min-w-0 items-start gap-2.5 rounded-xl p-1.5 transition-colors hover:bg-white/[0.03] cursor-help"
      data-tooltip={detail}
    >
      <span
        className={cn(
          'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg',
          warning ? 'bg-warning/10 text-warning' : 'bg-primary/10 text-primary',
        )}
      >
        <Icon className="size-3.5" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {label}
        </span>
        <span className={cn('mt-0.5 block font-mono text-sm font-semibold tabular-nums', warning ? 'text-warning' : 'text-foreground')}>
          {value}
        </span>
      </span>
    </div>
  )
}

export function DataConfidence() {
  const afterFirstPaint = useAfterFirstPaint()
  const { data, error, mutate } = useOverviewHealth(afterFirstPaint)

  if (!afterFirstPaint || (!data && !error)) {
    return <Skeleton className="h-[98px] w-full rounded-2xl" />
  }

  if (error || !data) {
    return (
      <GlassCard className="flex items-center justify-between gap-3 px-4 py-3">
        <span className="flex items-center gap-2 text-xs text-warning">
          <CircleAlert className="size-4" aria-hidden="true" />
          Diagnóstico de cobertura indisponível
        </span>
        <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => mutate()}>
          Tentar novamente
        </button>
      </GlassCard>
    )
  }

  const critical = data.status === 'critical'
  const warning = data.status === 'warning'
  const issues = data.actions.length
  const purchases = data.coverage.purchases
  const attribution = data.coverage.attribution
  const hosts = data.coverage.hosts
  const pixels = data.setup.pixels
  const statusLabel = critical
    ? 'Configuração incompleta'
    : warning
      ? `${issues} ${issues === 1 ? 'ponto para revisar' : 'pontos para revisar'}`
      : 'Dados bem cobertos'

  return (
    <GlassCard className="p-0" role="region" aria-label="Confiança dos dados" data-tour="confidence">
      <details className="group">
        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-4 py-3 marker:hidden focus-visible:outline-2 focus-visible:outline-ring">
          <span className="flex min-w-0 items-center gap-2.5">
            <span
              className={cn(
                'flex size-8 shrink-0 items-center justify-center rounded-[10px]',
                critical
                  ? 'bg-error/10 text-error'
                  : warning
                    ? 'bg-warning/10 text-warning'
                    : 'bg-success/10 text-success',
              )}
            >
              {critical || warning ? (
                <CircleAlert className="size-4" aria-hidden="true" />
              ) : (
                <ShieldCheck className="size-4" aria-hidden="true" />
              )}
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-semibold text-foreground">Confiança dos dados</span>
              <span className={cn('block truncate text-[11px]', critical ? 'text-error' : warning ? 'text-warning' : 'text-success')}>
                {statusLabel} · cobertura histórica
              </span>
            </span>
          </span>
          <span className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className="hidden items-center gap-1 sm:inline-flex">
              <Clock3 className="size-3" aria-hidden="true" />
              {data.freshness.lastDataAt ? `último dado ${timeAgo(data.freshness.lastDataAt)}` : 'aguardando o primeiro dado'}
            </span>
            <span className="rounded-full border border-border px-2 py-1 transition-colors group-open:border-primary/30 group-open:text-primary">
              {issues ? 'Ver diagnóstico' : 'Ver cobertura'}
            </span>
          </span>
        </summary>

        <div className="border-t border-border/70 px-4 py-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <CoverageItem
              icon={CheckCircle2}
              label="Vendas ligadas"
              value={purchases.rate == null ? 'Sem vendas' : `${purchases.rate}%`}
              detail={
                purchases.total
                  ? `${purchases.tracked} de ${purchases.total} com jornada rastreada`
                  : 'Aparece após o primeiro webhook de venda'
              }
              warning={purchases.orphan > 0}
            />
            <CoverageItem
              icon={Link2}
              label="Origem identificada"
              value={attribution.rate == null ? 'Sem visitas' : `${attribution.rate}%`}
              detail={
                attribution.total
                  ? `${attribution.identified} de ${attribution.total} com campanha ou link`
                  : 'Aparece após a primeira visita'
              }
              warning={attribution.total >= 10 && (attribution.rate ?? 0) < 50}
            />
            <CoverageItem
              icon={ServerCog}
              label="Hospedagens"
              value={hosts.total ? `${hosts.total} ${hosts.total === 1 ? 'domínio' : 'domínios'}` : 'Ainda sem sinal'}
              detail={hosts.uncovered ? `${hosts.uncovered} sem pixel identificado` : 'Cobertura observada pelo loader'}
              warning={hosts.uncovered > 0}
            />
            <CoverageItem
              icon={ShieldCheck}
              label="Integrações prontas"
              value={`${pixels.ready} pixel${pixels.ready === 1 ? '' : 's'} · ${data.setup.gateways.total} gateway${data.setup.gateways.total === 1 ? '' : 's'}`}
              detail={`${data.setup.links.active} link${data.setup.links.active === 1 ? '' : 's'} ativo${data.setup.links.active === 1 ? '' : 's'} · atualização automática a cada ${data.freshness.pollSeconds}s`}
              warning={pixels.ready === 0 || data.setup.gateways.total === 0 || data.setup.links.active === 0}
            />
          </div>

          {data.actions.length > 0 ? (
            <div className="mt-4 border-t border-border/70 pt-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Próximas correções
              </p>
              <div className="grid gap-2 lg:grid-cols-2">
                {data.actions.slice(0, 4).map((action) => (
                  <Link
                    key={action.id}
                    href={action.href}
                    className="group/action flex min-w-0 items-center justify-between gap-3 rounded-xl border border-border/80 bg-white/[0.02] px-3 py-2.5 transition-colors hover:border-primary/30 hover:bg-primary/[0.04]"
                  >
                    <span className="min-w-0">
                      <span className={cn('block text-xs font-medium', action.severity === 'critical' ? 'text-error' : 'text-warning')}>
                        {action.title}
                      </span>
                      <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{action.detail}</span>
                    </span>
                    <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover/action:text-primary" aria-hidden="true" />
                  </Link>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </details>
    </GlassCard>
  )
}
