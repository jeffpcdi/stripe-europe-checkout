'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  MousePointerClick,
  RefreshCcw,
  ShoppingCart,
  Sparkles,
} from 'lucide-react'
import { useAccountSettings, useStats } from '@/lib/api'
import { GlassCard } from '@/components/glass-card'
import { Skeleton } from '@/components/skeleton'
import { ErrorState } from '@/components/error-state'
import { formatMoney, formatDateTime } from '@/lib/format'
import { periodStart } from '@/lib/metrics'
import { useOverviewPeriod } from '@/lib/overview-period'

const LABELS: Record<string, string> = {
  sale: 'Venda aprovada',
  failed: 'Pagamento não concluído',
  refund: 'Reembolso',
  dispute: 'Contestação',
  checkout: 'Checkout aberto',
  lead: 'Novo visitante',
  visit: 'Visita',
  info: 'Atualização',
}

function EventIcon({ type }: { type: string }) {
  switch (type) {
    case 'sale':
      return (
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-400">
          <CheckCircle2 className="size-4" />
        </span>
      )
    case 'checkout':
      return (
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-brand-cyan/20 bg-brand-cyan/10 text-brand-cyan">
          <ShoppingCart className="size-4" />
        </span>
      )
    case 'visit':
    case 'lead':
      return (
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-brand-cyan/20 bg-brand-cyan/10 text-brand-cyan">
          <MousePointerClick className="size-4" />
        </span>
      )
    case 'failed':
      return (
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-rose-500/20 bg-rose-500/10 text-rose-400">
          <AlertCircle className="size-4" />
        </span>
      )
    case 'refund':
    case 'dispute':
      return (
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-amber-500/20 bg-amber-500/10 text-amber-400">
          <RefreshCcw className="size-4" />
        </span>
      )
    default:
      return (
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-secondary/30 text-muted-foreground">
          <Clock className="size-4" />
        </span>
      )
  }
}

function Summary({ label, value, tone = 'default' }: { label: string; value: number; tone?: 'default' | 'success' | 'accent' | 'error' }) {
  const cls = tone === 'success'
    ? 'border-success/20 bg-success/10 text-success'
    : tone === 'accent'
      ? 'border-brand-cyan/20 bg-brand-cyan/10 text-brand-cyan'
      : tone === 'error'
        ? 'border-destructive/20 bg-destructive/10 text-destructive'
        : 'border-border/60 bg-secondary/15 text-foreground'
  return (
    <div className={`rounded-2xl border px-4 py-3 ${cls}`}>
      <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tracking-tight text-foreground">{value.toLocaleString('pt-BR')}</p>
    </div>
  )
}

type ActivityFilter = 'all' | 'sale' | 'checkout' | 'visit' | 'failed' | 'refund' | 'dispute'

const ACTIVITY_FILTERS: { value: ActivityFilter; label: string }[] = [
  { value: 'all', label: 'Tudo' },
  { value: 'sale', label: 'Vendas' },
  { value: 'checkout', label: 'Checkouts' },
  { value: 'visit', label: 'Visitas' },
  { value: 'failed', label: 'Falhas' },
  { value: 'refund', label: 'Reembolsos' },
  { value: 'dispute', label: 'Contestações' },
]

function activityFilterFromQuery(value: string | null): ActivityFilter {
  return ACTIVITY_FILTERS.some((item) => item.value === value) ? value as ActivityFilter : 'all'
}

export function ActivityView() {
  const { data, error, mutate, isLoading } = useStats()
  const { data: settings } = useAccountSettings()
  const { period } = useOverviewPeriod()
  const accountTimeZone = settings?.timezone || 'America/Sao_Paulo'
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const requestedFilter = activityFilterFromQuery(searchParams.get('f'))
  const [filter, setFilter] = useState<ActivityFilter>(requestedFilter)
  const seenEventIdsRef = useRef<Set<string> | null>(null)
  const [freshSaleIds, setFreshSaleIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    setFilter((current) => current === requestedFilter ? current : requestedFilter)
  }, [requestedFilter])

  useEffect(() => {
    const rows = data?.events ?? []
    const currentIds = new Set(rows.map((event) => String(event.id)))
    const previousIds = seenEventIdsRef.current
    seenEventIdsRef.current = currentIds

    // Primeira carga apenas estabelece a base; histórico não deve parecer novo.
    if (!previousIds) return

    const fresh = rows
      .filter((event) => event.type === 'sale' && !previousIds.has(String(event.id)))
      .map((event) => String(event.id))

    if (!fresh.length) return
    setFreshSaleIds(new Set(fresh))
    const timer = window.setTimeout(() => setFreshSaleIds(new Set()), 1200)
    return () => window.clearTimeout(timer)
  }, [data?.events])

  function selectFilter(next: ActivityFilter) {
    setFilter(next)
    const params = new URLSearchParams(searchParams.toString())
    if (next === 'all') params.delete('f')
    else params.set('f', next)
    const query = params.toString()
    router.replace(pathname + (query ? `?${query}` : ''), { scroll: false })
  }

  const periodEvents = useMemo(() => {
    const now = new Date()
    const start = periodStart(period, now, accountTimeZone).getTime()
    const end = now.getTime()
    return (data?.events ?? []).filter(event => {
      const at = Date.parse(event.at)
      return Number.isFinite(at) && at >= start && at <= end
    })
  }, [data, period, accountTimeZone])

  const summary = useMemo(() => {
    const rows = periodEvents
    return {
      sale: rows.filter((event) => event.type === 'sale').length,
      checkout: rows.filter((event) => event.type === 'checkout').length,
      visit: rows.filter((event) => event.type === 'visit' || event.type === 'lead').length,
      failed: rows.filter((event) => event.type === 'failed').length,
    }
  }, [periodEvents])

  const events = useMemo(
    () =>
      periodEvents
        .filter((event) => filter === 'all' || event.type === filter || (filter === 'visit' && event.type === 'lead'))
        .slice()
        .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
        .slice(0, 100),
    [periodEvents, filter],
  )

  if (error && !data) return <ErrorState onRetry={() => mutate()} />
  if (isLoading && !data) return <Skeleton className="h-64 rounded-2xl" />

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-brand-cyan/20 bg-brand-cyan/10 px-3 py-1 text-[11px] font-medium text-brand-cyan">
            <Sparkles className="size-3.5" />
            Movimento do negócio
          </div>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-foreground">Atividade recente</h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Uma linha do tempo dos eventos que realmente estão movimentando seu funil: visitas, checkouts, vendas e falhas.
          </p>
        </div>
        <button type="button" className="btn-ghost self-start px-3 py-2 text-xs" onClick={() => void mutate()}>
          <RefreshCcw className="size-3.5" />
          Atualizar
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Summary label="Vendas" value={summary.sale} tone="success" />
        <Summary label="Checkouts" value={summary.checkout} tone="accent" />
        <Summary label="Visitas" value={summary.visit} />
        <Summary label="Falhas" value={summary.failed} tone={summary.failed ? 'error' : 'default'} />
      </div>

      {error ? (
        <button type="button" className="btn-ghost text-xs text-warning" onClick={() => void mutate()}>
          Histórico não atualizado · tentar novamente
        </button>
      ) : null}

      <GlassCard className="overflow-hidden p-0">
        <div className="flex flex-col gap-3 border-b border-border/50 bg-secondary/[0.08] p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Linha do tempo</h2>
            <p className="mt-1 text-[11px] text-muted-foreground">Mostrando os registros mais recentes primeiro.</p>
          </div>
          <div className="flex flex-wrap items-center gap-1 rounded-xl border border-border/60 bg-background/40 p-1">
            {ACTIVITY_FILTERS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => selectFilter(value)}
                aria-pressed={filter === value}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${filter === value ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {!events.length ? (
          <div className="p-10 text-center">
            <Clock className="mx-auto size-8 text-muted-foreground/50" />
            <p className="mt-3 text-sm font-medium text-foreground">Nenhum registro neste filtro</p>
            <p className="mt-1 text-xs text-muted-foreground">Troque o filtro para ver outros movimentos recentes.</p>
          </div>
        ) : (
          <ul className="divide-y divide-border/35">
            {events.map((event, idx) => (
              <li
                key={event.id}
                className={`activity-event-row anim-row-in flex flex-col gap-3 px-4 py-3.5 transition-colors hover:bg-white/[0.025] sm:flex-row sm:items-center sm:justify-between sm:px-5 ${freshSaleIds.has(String(event.id)) ? 'activity-sale-arrival' : ''}`}
                data-event-type={event.type}
                style={{ animationDelay: `${Math.min(idx * 20, 240)}ms` }}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <EventIcon type={event.type} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-medium text-foreground">{LABELS[event.type] || event.title || 'Atualização'}</p>
                      {event.gateway ? <span className="rounded-md bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground">{event.gateway}</span> : null}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {event.customer || event.ref || event.country || 'Registro recebido'}
                    </p>
                  </div>
                </div>
                <div className="flex items-end justify-between gap-4 sm:flex-col sm:items-end">
                  {typeof event.amount === 'number' ? (
                    <p className="text-sm font-semibold tabular-nums text-success" data-sensitive>
                      {formatMoney(event.amount, event.currency || 'BRL')}
                    </p>
                  ) : <span />}
                  <time dateTime={event.at} className="text-[11px] text-muted-foreground">
                    {formatDateTime(event.at, accountTimeZone)}
                  </time>
                </div>
              </li>
            ))}
          </ul>
        )}
      </GlassCard>

      {events.length === 100 ? (
        <p className="text-xs text-muted-foreground">Exibindo os 100 registros mais recentes deste filtro.</p>
      ) : null}
    </div>
  )
}
