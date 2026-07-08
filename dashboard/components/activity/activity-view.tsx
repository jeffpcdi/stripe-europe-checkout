'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useStats } from '@/lib/api'
import { GlassCard } from '@/components/glass-card'
import { Skeleton } from '@/components/skeleton'
import { formatMoney, formatDateTime, timeAgo, dayLabel, plural, gwLabel } from '@/lib/format'
import { countryLabel } from '@/lib/countries'
import { cn } from '@/lib/utils'
import {
  CheckCircle2,
  XCircle,
  UserPlus,
  Eye,
  RotateCcw,
  ShieldAlert,
  Zap,
  Copy,
  Check,
  ChevronDown,
  type LucideIcon,
} from 'lucide-react'
import type { StatsEvent } from '@/lib/types'

// Mapa tipo → ícone/cor, espelhando o feed legado.
// Item 153: borda esquerda por tipo para leitura rápida por cor.
const EVENT_STYLE: Record<
  string,
  { icon: LucideIcon; className: string; edge: string }
> = {
  sale: { icon: CheckCircle2, className: 'text-success bg-success/10', edge: '#22c55e' },
  failed: { icon: XCircle, className: 'text-destructive bg-destructive/10', edge: '#fe2c55' },
  lead: { icon: UserPlus, className: 'text-accent bg-accent/10', edge: '#25f4ee' },
  visit: { icon: Eye, className: 'text-primary bg-primary/10', edge: '#25f4ee' },
  refund: { icon: RotateCcw, className: 'text-warning bg-warning/10', edge: '#fbbf24' },
  dispute: { icon: ShieldAlert, className: 'text-destructive bg-destructive/10', edge: '#fe2c55' },
  info: { icon: Zap, className: 'text-muted-foreground bg-muted/40', edge: 'rgba(255,255,255,.2)' },
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

const PAGE_SIZE = 60

/* Item 158: copia um resumo JSON do evento */
function copyEventDetails(e: StatsEvent) {
  const detail = {
    tipo: e.type,
    titulo: e.title,
    valor: e.amount ? formatMoney(e.amount, e.currency) : undefined,
    gateway: e.gateway || undefined,
    cliente: e.customer || undefined,
    email: e.email || undefined,
    pais: e.country || undefined,
    quando: formatDateTime(e.at),
  }
  navigator.clipboard?.writeText(JSON.stringify(detail, null, 2)).catch(() => {})
}

function EventRow({ e, isNew }: { e: StatsEvent; isNew?: boolean }) {
  const style = EVENT_STYLE[e.type] || EVENT_STYLE.info
  const Icon = style.icon
  // Item 155: expansão inline com detalhes
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const meta: string[] = []
  if (e.customer) meta.push(e.customer)
  if (e.gateway) meta.push(gwLabel(e.gateway))
  if (e.country) meta.push(countryLabel(e.country))

  const details: { label: string; value: string }[] = []
  if (e.email) details.push({ label: 'E-mail', value: e.email })
  if (e.card) details.push({ label: 'Cartão', value: e.card })
  if (e.landing) details.push({ label: 'Página', value: e.landing })
  if (e.reason) details.push({ label: 'Motivo', value: e.reason })
  if (e.gateway) details.push({ label: 'Gateway', value: gwLabel(e.gateway) })

  const hasDetails = details.length > 0

  return (
    <div
      className={cn(
        'border-b border-border/40 last:border-b-0',
        isNew && 'anim-cell-flash',
      )}
      style={{ boxShadow: `inset 2px 0 0 ${style.edge}` }}
    >
      <button
        type="button"
        onClick={() => hasDetails && setOpen(!open)}
        className={cn(
          'flex w-full items-start gap-3 px-2.5 py-3 text-left',
          hasDetails && 'cursor-pointer transition-colors hover:bg-[var(--hover)]',
        )}
        aria-expanded={hasDetails ? open : undefined}
      >
        <span
          className={cn(
            'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg',
            style.className,
          )}
        >
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm font-medium text-foreground">
            {e.title || e.type}
            {/* Item 156: badge "novo" nos eventos que chegam ao vivo */}
            {isNew ? (
              <span className="rounded-full bg-[var(--accent-light)] px-1.5 py-px font-mono text-[9px] font-semibold uppercase tracking-wider text-[var(--accent)]">
                novo
              </span>
            ) : null}
          </p>
          {meta.length > 0 ? (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{meta.join(' · ')}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          {e.amount ? (
            <span className="font-mono text-sm font-bold tabular-nums text-success">
              {formatMoney(e.amount, e.currency)}
            </span>
          ) : null}
          {/* Item 152: relativo com absoluto no hover */}
          <span
            className="whitespace-nowrap font-mono text-[11px] tabular-nums text-muted-foreground"
            title={formatDateTime(e.at)}
          >
            {timeAgo(e.at)}
          </span>
        </div>
        {hasDetails ? (
          <ChevronDown
            className={cn(
              'mt-1 size-3.5 shrink-0 text-muted-foreground transition-transform duration-200',
              open && 'rotate-180',
            )}
            aria-hidden
          />
        ) : null}
      </button>

      {/* Item 155: detalhes expandem suavemente via grid-rows */}
      <div
        className="grid transition-[grid-template-rows] duration-300 ease-out"
        style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="mx-2.5 mb-3 flex flex-col gap-1.5 rounded-lg bg-[var(--hover)] p-3">
            {details.map((d) => (
              <p key={d.label} className="flex justify-between gap-3 text-xs">
                <span className="text-muted-foreground">{d.label}</span>
                <span className="truncate font-mono text-foreground">{d.value}</span>
              </p>
            ))}
            {/* Item 158: copiar resumo do evento */}
            <button
              type="button"
              onClick={() => {
                copyEventDetails(e)
                setCopied(true)
                window.setTimeout(() => setCopied(false), 1600)
              }}
              className="btn-ghost mt-1 self-end !px-2.5 !py-1 text-[11px]"
            >
              {copied ? (
                <>
                  <Check className="size-3 text-success" aria-hidden /> Copiado
                </>
              ) : (
                <>
                  <Copy className="size-3" aria-hidden /> Copiar detalhes
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function ActivityView() {
  const { data, isLoading, error } = useStats()
  const [filter, setFilter] = useState<string | null>(null)
  // Item 157: paginação incremental com "carregar mais"
  const [limit, setLimit] = useState(PAGE_SIZE)
  // Item 152: re-renderiza a cada minuto para atualizar tempos relativos
  const [, setTick] = useState(0)
  // Item 156: ids vistos no primeiro load — os demais são "novos"
  const seenIds = useRef<Set<string> | null>(null)

  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 60_000)
    return () => window.clearInterval(t)
  }, [])

  const all = useMemo(() => data?.events ?? [], [data])

  useEffect(() => {
    if (all.length > 0 && seenIds.current === null) {
      seenIds.current = new Set(all.map((e) => e.id))
    }
  }, [all])

  // Item 154: contagem por tipo para os chips
  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const e of all) c[e.type] = (c[e.type] ?? 0) + 1
    return c
  }, [all])

  const events = filter ? all.filter((e) => e.type === filter) : all
  const visible = events.slice(0, limit)
  const hasMore = events.length > limit

  return (
    <div className="flex flex-col gap-4">
      {/* Item 154: filtros com contagem */}
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Filtrar eventos">
        {FILTERS.map((f) => {
          const count = f.value === null ? all.length : (counts[f.value] ?? 0)
          return (
            <button
              key={f.label}
              type="button"
              role="tab"
              aria-selected={filter === f.value}
              onClick={() => {
                setFilter(f.value)
                setLimit(PAGE_SIZE)
              }}
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                filter === f.value
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-border/60 bg-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {f.label}
              {count > 0 ? (
                <span className="font-mono text-[10px] tabular-nums opacity-70">{count}</span>
              ) : null}
            </button>
          )
        })}
        <span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground">
          {plural(events.length, 'evento')}
        </span>
      </div>

      {/* Feed */}
      <GlassCard className="p-4">
        {isLoading && !data ? (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-start gap-3 px-1 py-1">
                <Skeleton className="size-8 rounded-lg" />
                <div className="flex flex-1 flex-col gap-1.5">
                  <Skeleton className="h-3.5 w-2/5" />
                  <Skeleton className="h-3 w-3/5" />
                </div>
                <Skeleton className="h-3 w-14" />
              </div>
            ))}
          </div>
        ) : error ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Não foi possível carregar os eventos.
          </p>
        ) : visible.length > 0 ? (
          <div className="anim-content-in flex flex-col">
            {visible.map((e, i) => {
              // Item 151: separador de dia quando o dia muda
              const label = dayLabel(e.at)
              const prevLabel = i > 0 ? dayLabel(visible[i - 1].at) : null
              const isNew =
                seenIds.current !== null && !seenIds.current.has(e.id)
              return (
                <div key={e.id}>
                  {label && label !== prevLabel ? (
                    <div className="flex items-center gap-3 px-1 pb-1 pt-4 first:pt-1">
                      <span className="label-mono text-[10px]">{label}</span>
                      <span
                        className="h-px flex-1"
                        style={{
                          background:
                            'linear-gradient(90deg, rgba(37,244,238,.2), transparent 70%)',
                        }}
                        aria-hidden="true"
                      />
                    </div>
                  ) : null}
                  <EventRow e={e} isNew={isNew} />
                </div>
              )
            })}
            {/* Item 157: carregar mais estilizado */}
            {hasMore ? (
              <button
                type="button"
                onClick={() => setLimit((l) => l + PAGE_SIZE)}
                className="btn-ghost mx-auto mt-4 !px-4"
              >
                Carregar mais ({events.length - limit} restantes)
              </button>
            ) : null}
          </div>
        ) : (
          <p className="py-12 text-center text-sm text-muted-foreground">Nenhum evento ainda.</p>
        )}
      </GlassCard>
    </div>
  )
}
