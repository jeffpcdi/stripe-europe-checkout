'use client'

import { useLive } from '@/lib/api'
import { GlassCard } from '@/components/glass-card'
import { Skeleton } from '@/components/skeleton'
import { countryFlag, pageLabel, liveDuration, isCheckoutVisitor } from '@/lib/format'
import { ShoppingCart, Radio, Users, Globe2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { LiveVisitor } from '@/lib/types'

function VisitorRow({ v }: { v: LiveVisitor }) {
  const idle = (v.idleMs || 0) > 20_000
  const inCheckout = isCheckoutVisitor(v.page)
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 transition-colors',
        inCheckout && 'border-primary/20 bg-primary/5',
        idle && 'opacity-55'
      )}
    >
      <span
        className={cn(
          'size-2 shrink-0 rounded-full',
          idle ? 'bg-muted-foreground/40' : 'bg-success shadow-[0_0_8px_var(--success)]',
          !idle && 'animate-pulse'
        )}
        aria-hidden
      />
      <span className="text-base leading-none" aria-hidden>
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
        <span className="tabular-nums">{liveDuration(v.durationMs)}</span>
      </div>
    </div>
  )
}

export function LiveView() {
  const { data, isLoading, error } = useLive()

  const visitors = data?.visitors ?? []
  // dedupe defensivo por id (mesma lógica do legado)
  const seen = new Set<string>()
  const unique = visitors.filter((v) => {
    const id = v.id || `${v.country}-${v.page}-${v.durationMs}`
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
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

  return (
    <div className="flex flex-col gap-4">
      {/* Resumo do topo */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <GlassCard className="flex items-center gap-3 p-4">
          <span className="flex size-9 items-center justify-center rounded-lg bg-success/10 text-success">
            <Radio className="size-4.5" aria-hidden />
          </span>
          <div>
            <p className="font-mono text-xl font-semibold text-foreground">{online}</p>
            <p className="label-mono">Online agora</p>
          </div>
        </GlassCard>
        <GlassCard className="flex items-center gap-3 p-4">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ShoppingCart className="size-4.5" aria-hidden />
          </span>
          <div>
            <p className="font-mono text-xl font-semibold text-foreground">
              {inCheckoutCount + (data?.checkout.externalEst ?? 0)}
            </p>
            <p className="label-mono">No checkout (est.)</p>
          </div>
        </GlassCard>
        <GlassCard className="flex items-center gap-3 p-4">
          <span className="flex size-9 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <Globe2 className="size-4.5" aria-hidden />
          </span>
          <div>
            <p className="font-mono text-xl font-semibold text-foreground">{countries.length}</p>
            <p className="label-mono">Países ativos</p>
          </div>
        </GlassCard>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_300px]">
        {/* Lista de visitantes */}
        <GlassCard className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="section-head text-sm font-semibold text-foreground">Visitantes agora</h2>
            {inCheckoutCount > 0 ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                <span className="size-1.5 animate-pulse rounded-full bg-primary" aria-hidden />
                {inCheckoutCount} lead{inCheckoutCount > 1 ? 's' : ''} no checkout agora
              </span>
            ) : null}
          </div>
          {isLoading && !data ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          ) : error ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Não foi possível carregar a presença ao vivo.
            </p>
          ) : sorted.length > 0 ? (
            <div className="flex flex-col gap-1">
              {sorted.map((v) => (
                <VisitorRow key={v.id} v={v} />
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
                  <span className="font-semibold tabular-nums text-primary">{c.count}</span>
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
