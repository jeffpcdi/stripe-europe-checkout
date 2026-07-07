'use client'

import { useState } from 'react'
import { useStats } from '@/lib/api'
import { GlassCard } from '@/components/glass-card'
import { Skeleton } from '@/components/skeleton'
import { formatMoney, formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  CheckCircle2,
  XCircle,
  UserPlus,
  Eye,
  RotateCcw,
  ShieldAlert,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import type { StatsEvent } from '@/lib/types'

// Mapa tipo → ícone/cor, espelhando o feed legado
const EVENT_STYLE: Record<string, { icon: LucideIcon; className: string }> = {
  sale: { icon: CheckCircle2, className: 'text-success bg-success/10' },
  failed: { icon: XCircle, className: 'text-destructive bg-destructive/10' },
  lead: { icon: UserPlus, className: 'text-accent bg-accent/10' },
  visit: { icon: Eye, className: 'text-primary bg-primary/10' },
  refund: { icon: RotateCcw, className: 'text-warning bg-warning/10' },
  dispute: { icon: ShieldAlert, className: 'text-destructive bg-destructive/10' },
  info: { icon: Zap, className: 'text-muted-foreground bg-muted/40' },
}

const FILTERS: { value: string | null; label: string }[] = [
  { value: null, label: 'Tudo' },
  { value: 'sale', label: 'Vendas' },
  { value: 'failed', label: 'Recusadas' },
  { value: 'visit', label: 'Visitas' },
  { value: 'refund', label: 'Reembolsos' },
  { value: 'dispute', label: 'Disputas' },
  { value: 'info', label: 'Sistema' },
]

function EventRow({ e }: { e: StatsEvent }) {
  const style = EVENT_STYLE[e.type] || EVENT_STYLE.info
  const Icon = style.icon
  const meta: string[] = []
  if (e.customer) meta.push(e.customer)
  if (e.email) meta.push(e.email)
  if (e.gateway) meta.push(e.gateway)
  if (e.country) meta.push(e.country)
  if (e.card) meta.push(e.card)
  if (e.landing) meta.push(e.landing)
  if (e.reason) meta.push(e.reason)

  return (
    <div className="flex items-start gap-3 border-b border-border/40 px-1 py-3 last:border-b-0">
      <span
        className={cn('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg', style.className)}
      >
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{e.title || e.type}</p>
        {meta.length > 0 ? (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{meta.join(' · ')}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-0.5">
        {e.amount ? (
          <span className="text-sm font-bold tabular-nums text-success">
            {formatMoney(e.amount, e.currency)}
          </span>
        ) : null}
        <span className="whitespace-nowrap text-[11px] tabular-nums text-muted-foreground">
          {formatDateTime(e.at)}
        </span>
      </div>
    </div>
  )
}

export function ActivityView() {
  const { data, isLoading, error } = useStats()
  const [filter, setFilter] = useState<string | null>(null)

  const all = data?.events ?? []
  const events = filter ? all.filter((e) => e.type === filter) : all

  return (
    <div className="flex flex-col gap-4">
      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Filtrar eventos">
        {FILTERS.map((f) => (
          <button
            key={f.label}
            type="button"
            role="tab"
            aria-selected={filter === f.value}
            onClick={() => setFilter(f.value)}
            className={cn(
              'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
              filter === f.value
                ? 'border-primary/40 bg-primary/10 text-primary'
                : 'border-border/60 bg-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {events.length} evento{events.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Feed */}
      <GlassCard className="p-4">
        {isLoading && !data ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </div>
        ) : error ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Não foi possível carregar os eventos.
          </p>
        ) : events.length > 0 ? (
          <div className="flex flex-col">
            {events.slice(0, 150).map((e) => (
              <EventRow key={e.id} e={e} />
            ))}
          </div>
        ) : (
          <p className="py-12 text-center text-sm text-muted-foreground">Nenhum evento ainda.</p>
        )}
      </GlassCard>
    </div>
  )
}
