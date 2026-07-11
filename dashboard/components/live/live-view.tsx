'use client'

import { memo, useEffect, useRef, useState } from 'react'
import { useLive } from '@/lib/api'
import { GlassCard } from '@/components/glass-card'
import { Skeleton } from '@/components/skeleton'
import { countryFlag, pageLabel, liveDuration, isCheckoutVisitor, plural } from '@/lib/format'
import { ShoppingCart, Radio, Users, Globe2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { LiveVisitor } from '@/lib/types'

/* Item 64: odômetro — dígitos rolantes que deslizam a cada mudança */
function OdometerDigit({ digit }: { digit: number }) {
  return (
    <span className="inline-block h-[1em] overflow-hidden align-baseline">
      <span
        className="flex flex-col transition-transform duration-500 ease-out"
        style={{ transform: `translateY(-${digit}em)` }}
        aria-hidden="true"
      >
        {Array.from({ length: 10 }).map((_, n) => (
          <span key={n} className="h-[1em] leading-none">
            {n}
          </span>
        ))}
      </span>
    </span>
  )
}

function Odometer({ value }: { value: number }) {
  const digits = String(Math.max(0, value)).split('').map(Number)
  const prev = useRef(value)
  const [pulse, setPulse] = useState(false)

  // Ring de pulso a cada incremento
  useEffect(() => {
    if (value > prev.current) {
      setPulse(true)
      const t = window.setTimeout(() => setPulse(false), 900)
      prev.current = value
      return () => window.clearTimeout(t)
    }
    prev.current = value
  }, [value])

  return (
    <span className="relative inline-flex items-baseline">
      {pulse ? (
        <span
          className="absolute -inset-2 animate-ping rounded-full bg-[var(--accent)]/15"
          aria-hidden="true"
        />
      ) : null}
      <span className="sr-only">{value}</span>
      {digits.map((d, i) => (
        <OdometerDigit key={`${digits.length}-${i}`} digit={d} />
      ))}
    </span>
  )
}

/* Item 67: indicador de conexão com 3 estados */
function ConnectionDot({ state }: { state: 'ok' | 'reconnecting' | 'down' }) {
  const map = {
    ok: { color: 'var(--success)', label: 'Conectado', anim: 'animate-pulse' },
    reconnecting: { color: 'var(--warning)', label: 'Reconectando', anim: 'animate-ping' },
    down: { color: 'var(--destructive)', label: 'Sem conexão', anim: '' },
  } as const
  const s = map[state]
  return (
    <span className="inline-flex items-center gap-1.5" title={s.label}>
      <span className="relative flex size-2">
        {s.anim ? (
          <span
            className={cn('absolute inline-flex size-full rounded-full opacity-60', s.anim)}
            style={{ background: s.color }}
            aria-hidden="true"
          />
        ) : null}
        <span
          className="relative inline-flex size-2 rounded-full"
          style={{ background: s.color, boxShadow: `0 0 6px ${s.color}` }}
          aria-hidden="true"
        />
      </span>
      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {s.label}
      </span>
    </span>
  )
}

// Item 547: memoizado — a lista "ao vivo" re-renderiza a cada poll; o memo
// evita re-render das linhas cujo visitante não mudou entre polls.
const VisitorRow = memo(function VisitorRow({ v, isNew }: { v: LiveVisitor; isNew?: boolean }) {
  const idle = (v.idleMs || 0) > 20_000
  const inCheckout = isCheckoutVisitor(v.page)
  return (
    <div
      className={cn(
        // Item 66: linha do tempo — dot alinhado ao hairline vertical do feed
        'relative flex items-center gap-3 rounded-lg border border-transparent py-2.5 pl-7 pr-3 transition-colors',
        inCheckout && 'border-primary/20 bg-primary/5',
        idle && 'opacity-55',
        // Item 63: entrada em cascata com flash ciano para visitantes novos
        isNew && 'anim-live-row',
      )}
    >
      <span
        className={cn(
          'absolute left-[9px] top-1/2 size-2 -translate-y-1/2 rounded-full',
          idle ? 'bg-muted-foreground/40' : 'bg-success shadow-[0_0_8px_var(--success)]',
          !idle && 'animate-pulse',
        )}
        aria-hidden
      />
      {/* Item 65: bandeira entra com pop + ring ciano quando novo */}
      <span
        className={cn(
          'relative text-base leading-none',
          isNew && 'anim-pop-in',
        )}
        aria-hidden
      >
        {isNew ? (
          <span className="absolute -inset-1.5 animate-ping rounded-full border border-[var(--brand-cyan)]/40" />
        ) : null}
        {countryFlag(v.country)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">
          {v.countryName || v.country || 'Local desconhecido'}
          {v.city ? <span className="font-normal text-muted-foreground"> · {v.city}</span> : null}
        </p>
        <p className="truncate text-xs text-muted-foreground">{pageLabel(v.page)}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2.5 text-xs text-muted-foreground">
        {inCheckout ? (
          <span className="inline-flex items-center gap-1 font-semibold text-primary">
            <ShoppingCart className="size-3.5" aria-hidden />
            no checkout
          </span>
        ) : null}
        {(v.pageviews || 1) > 1 ? (
          <span title="páginas vistas nesta sessão">{v.pageviews} págs</span>
        ) : null}
        <span className="font-mono tabular-nums">{liveDuration(v.durationMs)}</span>
      </div>
    </div>
  )
})

export function LiveView() {
  const { data, isLoading, error, isValidating } = useLive()

  // Item 63/65: rastreia ids já vistos — novos ganham animação de entrada
  const seenIds = useRef<Set<string> | null>(null)
  const newIds = useRef<Set<string>>(new Set())

  const visitors = data?.visitors ?? []
  // Dedupe defensivo por id. Item 367 (bug): o fallback antigo incluía
  // durationMs, que muda a cada poll — o MESMO visitante sem id aparecia
  // 2x quando o backend o listava com durações diferentes. A chave de
  // fallback precisa ser estável entre amostras: país + página.
  const seen = new Set<string>()
  const unique = visitors.filter((v) => {
    const id = v.id || `${v.country}-${v.page}`
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })

  useEffect(() => {
    if (!data) return
    const ids = (data.visitors ?? []).map((v) => v.id).filter(Boolean) as string[]
    if (seenIds.current === null) {
      seenIds.current = new Set(ids)
      return
    }
    const fresh = ids.filter((id) => !seenIds.current!.has(id))
    for (const id of fresh) {
      seenIds.current.add(id)
      newIds.current.add(id)
      // remove o realce depois da animação
      window.setTimeout(() => newIds.current.delete(id), 4000)
    }
    // Item 346 (vazamento leve): em sessões longas o Set cresceria sem limite.
    // Acima de 2000 ids, mantém só os visitantes atuais — quem saiu da lista
    // não volta a "piscar" mesmo se reaparecer, custo aceitável.
    if (seenIds.current.size > 2000) {
      seenIds.current = new Set(ids)
    }
  }, [data])

  // checkout primeiro (mais quentes no topo), depois por atividade
  const sorted = unique.toSorted((a, b) => {
    const ac = isCheckoutVisitor(a.page) ? 1 : 0
    const bc = isCheckoutVisitor(b.page) ? 1 : 0
    if (ac !== bc) return bc - ac
    return (a.idleMs || 0) - (b.idleMs || 0)
  })
  const inCheckoutCount = unique.filter((v) => isCheckoutVisitor(v.page)).length
  const online = data?.summary.online ?? 0
  const countries = data?.summary.countries ?? []

  // Item 67: estado da conexão a partir do ciclo do SWR
  const connState: 'ok' | 'reconnecting' | 'down' = error
    ? data && isValidating
      ? 'reconnecting'
      : 'down'
    : 'ok'

  return (
    <div className="flex flex-col gap-4">
      {/* Resumo do topo */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <GlassCard className="flex items-center gap-3 p-4" data-tour="live-counter">
          <span className="flex size-9 items-center justify-center rounded-lg bg-success/10 text-success">
            <Radio className="size-4.5" aria-hidden />
          </span>
          <div>
            {/* Itens 64/101: odômetro com dígitos rolantes + aria-live para leitores */}
            <p
              className="font-mono text-2xl font-semibold tabular-nums text-foreground"
              aria-live="polite"
              aria-atomic="true"
            >
              <Odometer value={online} />
            </p>
            <p className="label-mono">Online agora</p>
          </div>
        </GlassCard>
        <GlassCard className="flex items-center gap-3 p-4">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ShoppingCart className="size-4.5" aria-hidden />
          </span>
          <div>
            <p className="font-mono text-2xl font-semibold tabular-nums text-foreground">
              {inCheckoutCount + (data?.checkout.externalEst ?? 0)}
            </p>
            <p className="label-mono">No checkout (est.)</p>
          </div>
        </GlassCard>
        <GlassCard className="flex items-center gap-3 p-4" data-tour="live-countries">
          <span className="flex size-9 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <Globe2 className="size-4.5" aria-hidden />
          </span>
          <div>
            <p className="font-mono text-2xl font-semibold tabular-nums text-foreground">
              {countries.length}
            </p>
            <p className="label-mono">Países ativos</p>
          </div>
        </GlassCard>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_300px]">
        {/* Lista de visitantes */}
        <GlassCard className="p-4" data-tour="live-sessions">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <h2 className="section-head text-sm font-semibold text-foreground">
                Visitantes agora
              </h2>
              {/* Item 67: indicador de conexão do feed */}
              <ConnectionDot state={connState} />
            </div>
            {inCheckoutCount > 0 ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                <span className="size-1.5 animate-pulse rounded-full bg-primary" aria-hidden />
                {plural(inCheckoutCount, 'lead')} no checkout agora
              </span>
            ) : null}
          </div>
          {isLoading && !data ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          ) : error && !data ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Não foi possível carregar a presença ao vivo.
            </p>
          ) : sorted.length > 0 ? (
            /* Item 66: hairline vertical conectando os eventos */
            <div className="relative flex flex-col gap-1">
              <span
                className="pointer-events-none absolute bottom-3 left-[12px] top-3 w-px"
                style={{
                  background:
                    'linear-gradient(180deg, transparent, rgba(37,244,238,.25) 15%, rgba(37,244,238,.25) 85%, transparent)',
                }}
                aria-hidden="true"
              />
              {sorted.map((v) => (
                <VisitorRow key={v.id} v={v} isNew={!!v.id && newIds.current.has(v.id)} />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Users className="size-8 text-muted-foreground/40" aria-hidden />
              <p className="text-sm text-muted-foreground">
                Ninguém navegando agora.
                <br />
                Assim que alguém abrir o site, aparece aqui em tempo real.
              </p>
            </div>
          )}
        </GlassCard>

        {/* Países online */}
        <GlassCard className="h-fit p-4">
          <h2 className="section-head mb-3 text-sm font-semibold text-foreground">Países online</h2>
          {countries.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {countries.map((c) => (
                <li key={c.code} className="flex items-center gap-2.5 text-sm">
                  <span aria-hidden>{countryFlag(c.code)}</span>
                  <span className="min-w-0 flex-1 truncate text-foreground">{c.name}</span>
                  <span className="font-mono font-semibold tabular-nums text-primary">
                    {c.count}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-6 text-center text-xs text-muted-foreground">aguardando visitantes</p>
          )}
        </GlassCard>
      </div>
    </div>
  )
}
