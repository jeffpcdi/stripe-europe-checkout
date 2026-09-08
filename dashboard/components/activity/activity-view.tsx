'use client'

import { useMemo, useState } from 'react'
import {
  CheckCircle2,
  ShoppingCart,
  MousePointerClick,
  AlertCircle,
  RefreshCcw,
  Clock,
  Filter,
} from 'lucide-react'
import { useStats } from '@/lib/api'
import { GlassCard } from '@/components/glass-card'
import { Skeleton } from '@/components/skeleton'
import { ErrorState } from '@/components/error-state'
import { formatMoney, formatDateTime } from '@/lib/format'

const LABELS: Record<string, string> = {
  sale: 'Venda',
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
        <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20 shadow-[0_0_12px_rgba(16,185,129,0.15)]">
          <CheckCircle2 className="size-4" />
        </span>
      )
    case 'checkout':
      return (
        <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-[color:var(--brand-cyan)]/10 text-[color:var(--brand-cyan)] ring-1 ring-[color:var(--brand-cyan)]/20 shadow-[0_0_12px_rgba(37,244,238,0.15)]">
          <ShoppingCart className="size-4" />
        </span>
      )
    case 'visit':
    case 'lead':
      return (
        <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-400 ring-1 ring-indigo-500/20">
          <MousePointerClick className="size-4" />
        </span>
      )
    case 'failed':
      return (
        <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-rose-500/10 text-rose-400 ring-1 ring-rose-500/20">
          <AlertCircle className="size-4" />
        </span>
      )
    case 'refund':
    case 'dispute':
      return (
        <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/20">
          <RefreshCcw className="size-4" />
        </span>
      )
    default:
      return (
        <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-secondary text-muted-foreground ring-1 ring-border/50">
          <Clock className="size-4" />
        </span>
      )
  }
}

export function ActivityView() {
  const { data, error, mutate, isLoading } = useStats()
  const [filter, setFilter] = useState('all')
  const events = useMemo(
    () =>
      (data?.events ?? [])
        .filter((event) => filter === 'all' || event.type === filter)
        .slice()
        .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
        .slice(0, 100),
    [data, filter],
  )

  if (error && !data) return <ErrorState onRetry={() => mutate()} />
  if (isLoading && !data) return <Skeleton className="h-64 rounded-2xl" />

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">Atividade recente</h2>
          <p className="mt-1 text-xs text-muted-foreground">Últimos registros recebidos.</p>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Mostrar
          <div className="relative">
            <select
              className="input rounded-xl border border-border/80 bg-secondary/40 py-1.5 pl-3 pr-8 text-xs font-medium text-foreground outline-none transition-all hover:bg-secondary/60 focus:border-primary/50"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">Tudo</option>
              <option value="sale">Vendas</option>
              <option value="checkout">Checkouts</option>
              <option value="visit">Visitas</option>
              <option value="failed">Falhas</option>
            </select>
          </div>
        </label>
      </div>

      {error && (
        <button
          type="button"
          className="btn-ghost text-xs text-warning"
          onClick={() => void mutate()}
        >
          Histórico não atualizado · tentar novamente
        </button>
      )}

      <GlassCard variant="thick" className="p-0 border border-border/70 shadow-sm overflow-hidden">
        {!events.length ? (
          <p className="p-8 text-center text-sm text-muted-foreground">Nenhum registro neste filtro.</p>
        ) : (
          <ul className="divide-y divide-border/40">
            {events.map((event, idx) => (
              <li
                key={event.id}
                className="anim-row-in flex flex-wrap items-center justify-between gap-3.5 px-4 py-3 sm:px-5 hover:bg-white/[0.025] transition-colors duration-150"
                style={{ animationDelay: `${Math.min(idx * 25, 600)}ms` }}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <EventIcon type={event.type} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {LABELS[event.type] || event.title || 'Atualização'}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {event.customer || event.gateway || event.ref || event.country || 'Registro recebido'}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  {typeof event.amount === 'number' && (
                    <p className="text-sm font-semibold tabular-nums text-success drop-shadow-[0_0_8px_rgba(34,197,94,0.2)]" data-sensitive>
                      {formatMoney(event.amount, event.currency || 'BRL')}
                    </p>
                  )}
                  <time dateTime={event.at} className="text-xs text-muted-foreground block">
                    {formatDateTime(event.at)}
                  </time>
                </div>
              </li>
            ))}
          </ul>
        )}
      </GlassCard>

      {events.length === 100 && (
        <p className="text-xs text-muted-foreground">
          Exibindo os 100 registros mais recentes deste filtro.
        </p>
      )}
    </div>
  )
}

