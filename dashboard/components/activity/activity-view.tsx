'use client'

import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useStats } from '@/lib/api'
import { usePersistedState } from '@/lib/use-persisted-state'
import { GlassCard } from '@/components/glass-card'
import { Skeleton } from '@/components/skeleton'
import { formatMoney, formatDateTime, timeAgo, dayLabel, plural, gwLabel } from '@/lib/format'
import { countryLabel } from '@/lib/countries'
import { copyText } from '@/lib/clipboard'
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
  Search,
  Link2,
  X,
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

// Item 333: filtro de período local do feed (independente do período global
// da Overview — quem audita o feed quer recortar sem mexer no resto).
const FEED_PERIODS: { value: 'today' | '7d' | '30d' | null; label: string }[] = [
  { value: null, label: 'Tudo' },
  { value: 'today', label: 'Hoje' },
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
]

function feedPeriodStart(p: 'today' | '7d' | '30d' | null): number | null {
  if (!p) return null
  const now = new Date()
  if (p === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  return now.getTime() - (p === '7d' ? 7 : 30) * 86400e3
}

/* Item 158: copia um resumo JSON do evento.
   Item 347: via copyText (fallback p/ HTTP/iframe) e reporta sucesso real. */
function copyEventDetails(e: StatsEvent): Promise<boolean> {
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
  return copyText(JSON.stringify(detail, null, 2))
}

// Item 547: memoizado — o feed re-renderiza a cada poll de 12s; sem isso,
// TODAS as linhas re-renderizam mesmo quando nada mudou. SWR mantém a
// referência do evento estável quando os dados não mudam, então o memo corta
// o re-render das linhas antigas (só a nova e as com estado local mudam).
const EventRow = memo(function EventRow({
  e,
  isNew,
  highlight,
}: {
  e: StatsEvent
  isNew?: boolean
  /* Item 343: evento alvo do permalink chega destacado */
  highlight?: boolean
}) {
  const style = EVENT_STYLE[e.type] || EVENT_STYLE.info
  const Icon = style.icon
  // Item 155: expansão inline com detalhes
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)

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
      id={`evt-${e.id}`}
      className={cn(
        'border-b border-border/40 last:border-b-0',
        isNew && 'anim-cell-flash',
        highlight && 'anim-cell-flash rounded-lg outline outline-1 outline-[var(--accent)]/50',
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
            <div className="mt-1 flex items-center justify-end gap-1.5">
              {/* Item 343: permalink do evento (?e=<id>) para compartilhar */}
              <button
                type="button"
                onClick={() => {
                  const url = new URL(window.location.href)
                  url.searchParams.set('e', e.id)
                  void copyText(url.toString()).then((ok) => {
                    if (!ok) return
                    setLinkCopied(true)
                    window.setTimeout(() => setLinkCopied(false), 1600)
                  })
                }}
                className="btn-ghost !px-2.5 !py-1 text-[11px]"
              >
                {linkCopied ? (
                  <>
                    <Check className="size-3 text-success" aria-hidden /> Copiado
                  </>
                ) : (
                  <>
                    <Link2 className="size-3" aria-hidden /> Copiar link
                  </>
                )}
              </button>
              {/* Item 158: copiar resumo do evento */}
              <button
                type="button"
                onClick={() => {
                  // Item 347: só mostra "Copiado" se a cópia de fato aconteceu
                  void copyEventDetails(e).then((ok) => {
                    if (!ok) return
                    setCopied(true)
                    window.setTimeout(() => setCopied(false), 1600)
                  })
                }}
                className="btn-ghost !px-2.5 !py-1 text-[11px]"
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
    </div>
  )
})

export function ActivityView() {
  const { data, isLoading, error } = useStats()
  // Item 185: o filtro de tipo de evento persiste entre navegações
  const [filter, setFilter] = usePersistedState<string | null>('activity:filter', null)
  // Item 331: busca textual efêmera (não persiste — busca é da sessão)
  const [query, setQuery] = useState('')
  // Item 332: filtro por gateway, derivado dos eventos presentes
  const [gwFilter, setGwFilter] = useState<string | null>(null)
  // Item 333: recorte de período local do feed
  const [feedPeriod, setFeedPeriod] = useState<'today' | '7d' | '30d' | null>(null)

  // Item 292: deep-link ?f=refund vindo do drill-down da Overview tem
  // precedência sobre o filtro persistido. useSearchParams (e não
  // window.location) porque na navegação client-side do Next a URL do
  // history só é atualizada depois do commit — o hook é a fonte confiável.
  // Depois de aplicar, limpa o ?f para o filtro não "grudar" na URL.
  const searchParams = useSearchParams()
  const deepLink = searchParams.get('f')
  useEffect(() => {
    if (deepLink && FILTERS.some((x) => x.value === deepLink)) {
      setFilter(deepLink)
      const url = new URL(window.location.href)
      url.searchParams.delete('f')
      window.history.replaceState(null, '', url)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLink])
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

  // Item 332: gateways presentes nos eventos (para o seletor)
  const gateways = useMemo(() => {
    const s = new Set<string>()
    for (const e of all) if (e.gateway) s.add(e.gateway)
    return [...s].sort()
  }, [all])

  // Itens 331/332/333: busca + gateway + período compõem com o filtro de tipo
  const events = useMemo(() => {
    const q = query.trim().toLowerCase()
    const from = feedPeriodStart(feedPeriod)
    return all.filter((e) => {
      if (filter && e.type !== filter) return false
      if (gwFilter && e.gateway !== gwFilter) return false
      if (from && new Date(e.at).getTime() < from) return false
      if (q) {
        const hay = `${e.customer || ''} ${e.email || ''} ${e.gateway || ''} ${e.title || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [all, filter, gwFilter, feedPeriod, query])

  const visible = events.slice(0, limit)
  const hasMore = events.length > limit

  // Item 340: resumo por dia no separador — vendas, receita e recusadas do
  // dia INTEIRO filtrado (não só das linhas visíveis na página atual)
  const daySummary = useMemo(() => {
    const map = new Map<string, { sales: number; revenue: number; cur: string; failed: number }>()
    for (const e of events) {
      const label = dayLabel(e.at)
      if (!label) continue
      const r = map.get(label) ?? { sales: 0, revenue: 0, cur: e.currency || 'BRL', failed: 0 }
      if (e.type === 'sale') {
        r.sales++
        r.revenue += e.amount || 0
        if (e.currency) r.cur = e.currency
      } else if (e.type === 'failed') r.failed++
      map.set(label, r)
    }
    return map
  }, [events])

  // Item 343: permalink ?e=<id> — garante o evento na página, rola até ele
  // e destaca. Limpa o param depois para o destaque não "grudar".
  const targetId = searchParams.get('e')
  const [highlightId, setHighlightId] = useState<string | null>(null)
  useEffect(() => {
    if (!targetId || all.length === 0) return
    const idx = events.findIndex((e) => e.id === targetId)
    if (idx < 0) {
      // evento fora dos filtros ativos: zera filtros para ele aparecer
      if (filter || gwFilter || feedPeriod || query) {
        setFilter(null)
        setGwFilter(null)
        setFeedPeriod(null)
        setQuery('')
      }
      return
    }
    if (idx >= limit) setLimit(Math.ceil((idx + 1) / PAGE_SIZE) * PAGE_SIZE)
    setHighlightId(targetId)
    const t = window.setTimeout(() => {
      document.getElementById(`evt-${targetId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      const url = new URL(window.location.href)
      url.searchParams.delete('e')
      window.history.replaceState(null, '', url)
    }, 120)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId, all.length, events, limit])

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

      {/* Itens 331/332/333: busca + gateway + período do feed */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            type="search"
            value={query}
            onChange={(ev) => {
              setQuery(ev.target.value)
              setLimit(PAGE_SIZE)
            }}
            placeholder="Buscar por cliente, e-mail ou gateway…"
            aria-label="Buscar eventos"
            className="w-full rounded-lg border border-border/60 bg-transparent py-1.5 pl-9 pr-8 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Limpar busca"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          ) : null}
        </div>

        {gateways.length > 1 ? (
          <select
            value={gwFilter ?? ''}
            onChange={(ev) => {
              setGwFilter(ev.target.value || null)
              setLimit(PAGE_SIZE)
            }}
            aria-label="Filtrar por gateway"
            className="rounded-lg border border-border/60 bg-transparent px-2.5 py-1.5 text-xs text-foreground focus:border-primary/40 focus:outline-none [&>option]:bg-background"
          >
            <option value="">Todos os gateways</option>
            {gateways.map((g) => (
              <option key={g} value={g}>
                {gwLabel(g)}
              </option>
            ))}
          </select>
        ) : null}

        <div className="flex items-center gap-1" role="group" aria-label="Período do feed">
          {FEED_PERIODS.map((p) => (
            <button
              key={p.label}
              type="button"
              aria-pressed={feedPeriod === p.value}
              onClick={() => {
                setFeedPeriod(p.value)
                setLimit(PAGE_SIZE)
              }}
              className={cn(
                'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
                feedPeriod === p.value
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-border/60 text-muted-foreground hover:text-foreground',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
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
                      {/* Item 340: resumo do dia inteiro filtrado no separador */}
                      {(() => {
                        const s = daySummary.get(label)
                        if (!s || (s.sales === 0 && s.failed === 0)) return null
                        return (
                          <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                            {s.sales > 0 ? (
                              <>
                                {plural(s.sales, 'venda')} ·{' '}
                                <span data-sensitive>{formatMoney(s.revenue, s.cur)}</span>
                              </>
                            ) : null}
                            {s.sales > 0 && s.failed > 0 ? ' · ' : null}
                            {s.failed > 0 ? `${s.failed} recusadas` : null}
                          </span>
                        )
                      })()}
                    </div>
                  ) : null}
                  <EventRow e={e} isNew={isNew} highlight={e.id === highlightId} />
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
        ) : all.length > 0 ? (
          /* Item 331: distinção entre "sem eventos" e "filtros sem resultado" */
          <div className="flex flex-col items-center gap-3 py-12">
            <p className="text-sm text-muted-foreground">
              Nenhum evento corresponde aos filtros ativos.
            </p>
            <button
              type="button"
              onClick={() => {
                setFilter(null)
                setGwFilter(null)
                setFeedPeriod(null)
                setQuery('')
                setLimit(PAGE_SIZE)
              }}
              className="btn-ghost !px-4"
            >
              Limpar filtros
            </button>
          </div>
        ) : (
          <p className="py-12 text-center text-sm text-muted-foreground">Nenhum evento ainda.</p>
        )}
      </GlassCard>
    </div>
  )
}
