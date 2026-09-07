'use client'

import { useMemo, useState } from 'react'
import { useStats } from '@/lib/api'
import { GlassCard } from '@/components/glass-card'
import { Skeleton } from '@/components/skeleton'
import { ErrorState } from '@/components/error-state'
import { formatMoney, formatDateTime } from '@/lib/format'

const LABELS: Record<string, string> = { sale: 'Venda', failed: 'Pagamento não concluído', refund: 'Reembolso', dispute: 'Contestação', checkout: 'Checkout aberto', lead: 'Novo visitante', visit: 'Visita', info: 'Atualização' }
export function ActivityView() {
  const { data, error, mutate, isLoading } = useStats()
  const [filter, setFilter] = useState('all')
  const events = useMemo(() => (data?.events ?? []).filter(event => filter === 'all' || event.type === filter).slice().sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 100), [data, filter])
  if (error && !data) return <ErrorState onRetry={() => mutate()} />
  if (isLoading && !data) return <Skeleton className="h-64 rounded-2xl" />
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-base font-semibold">Atividade recente</h2><p className="mt-1 text-xs text-muted-foreground">Últimos registros recebidos.</p></div>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">Mostrar<select className="input" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">Tudo</option><option value="sale">Vendas</option><option value="checkout">Checkouts</option><option value="visit">Visitas</option><option value="failed">Falhas</option></select></label>
    </div>
    {error && <button className="btn-ghost text-xs text-warning" onClick={() => void mutate()}>Histórico não atualizado · tentar novamente</button>}
    <GlassCard className="p-0">
      {!events.length ? <p className="p-8 text-center text-sm text-muted-foreground">Nenhum registro neste filtro.</p> : <ul className="divide-y divide-border">
        {events.map(event => <li key={event.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
          <div className="min-w-0"><p className="text-sm font-medium">{LABELS[event.type] || event.title || 'Atualização'}</p><p className="mt-0.5 truncate text-xs text-muted-foreground">{event.customer || event.gateway || event.ref || event.country || 'Registro recebido'}</p></div>
          <div className="text-right">{typeof event.amount === 'number' && <p className="text-sm font-semibold tabular-nums text-success" data-sensitive>{formatMoney(event.amount, event.currency || 'BRL')}</p>}<time dateTime={event.at} className="text-xs text-muted-foreground">{formatDateTime(event.at)}</time></div>
        </li>)}
      </ul>}
    </GlassCard>
    {events.length === 100 && <p className="text-xs text-muted-foreground">Exibindo os 100 registros mais recentes deste filtro.</p>}
  </div>
}
