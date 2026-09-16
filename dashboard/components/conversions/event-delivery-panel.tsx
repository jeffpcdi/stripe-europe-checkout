'use client'

import { useState } from 'react'
import { usePixelLog, usePixelHealth } from '@/lib/api'
import { conversionEvent } from '@/lib/conversion-status'
import { timeAgo } from '@/lib/format'
import type { Pixel } from '@/lib/types'

export function EventDeliveryPanel({ pixels }: { pixels: Pixel[] }) {
  const { data, error, mutate } = usePixelLog()
  const { data: health } = usePixelHealth()
  const [slug, setSlug] = useState('')
  const rows = (data?.log || []).filter(
    row => !slug || row.pixel === slug || row.pixel === pixels.find(pixel => pixel.slug === slug)?.name,
  )
  const retryQueue = Number(health?.retryQueue || 0)

  return (
    <section className="flex min-w-0 flex-col gap-4" aria-label="Envios ao TikTok">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <label className="flex w-full flex-col gap-1.5 sm:w-56">
          <span className="text-xs font-medium text-muted-foreground">Pixel</span>
          <select
            aria-label="Filtrar envios por pixel"
            className="h-10 w-full rounded-lg border border-border/70 bg-background/60 px-3 text-sm text-foreground outline-none transition-colors hover:border-border focus-visible:border-primary/70 focus-visible:ring-1 focus-visible:ring-primary/30"
            value={slug}
            onChange={event => setSlug(event.target.value)}
          >
            <option value="">Todos os pixels</option>
            {pixels.map(pixel => (
              <option key={pixel.slug} value={pixel.slug}>{pixel.name}</option>
            ))}
          </select>
        </label>

        {retryQueue > 0 ? (
          <p className="flex items-center gap-2 text-xs leading-5 text-muted-foreground">
            <span className="size-1.5 shrink-0 rounded-full bg-warning" aria-hidden="true" />
            <span>
              <span className="font-medium text-warning">{retryQueue}</span>{' '}
              {retryQueue === 1 ? 'evento aguardando nova tentativa' : 'eventos aguardando nova tentativa'}
            </span>
          </p>
        ) : null}
      </div>

      {error ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <p className="text-destructive">Não foi possível atualizar os envios.</p>
          <button
            type="button"
            className="font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
            onClick={() => void mutate()}
          >
            Tentar novamente
          </button>
        </div>
      ) : null}

      {!data && !error ? (
        <p className="text-xs text-muted-foreground">Buscando eventos…</p>
      ) : !rows.length ? (
        <p className="text-xs text-muted-foreground">Nenhum envio recente para este filtro.</p>
      ) : (
        <div className="divide-y divide-border/60 border-y border-border/60">
          {rows.slice(0, 15).map((row, index) => {
            const pixelName = pixels.find(pixel => pixel.slug === row.pixel)?.name || row.pixel
            const statusLabel = row.status === 'ok'
              ? 'TikTok confirmou'
              : row.status === 'erro'
                ? 'Envio falhou'
                : 'Não enviado'
            const statusTextClass = row.status === 'ok'
              ? 'text-success'
              : row.status === 'erro'
                ? 'text-destructive'
                : 'text-muted-foreground'
            const statusDotClass = row.status === 'ok'
              ? 'bg-success'
              : row.status === 'erro'
                ? 'bg-destructive'
                : 'bg-muted-foreground/70'

            return (
              <details key={row.id || index} className="group">
                <summary className="cursor-pointer list-none py-3.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/35 [&::-webkit-details-marker]:hidden">
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-5">
                    <div className="min-w-0">
                      <div className="flex items-baseline justify-between gap-3 sm:block">
                        <strong className="text-sm font-medium text-foreground">{conversionEvent(row.event)}</strong>
                        <span className="shrink-0 text-xs text-muted-foreground sm:hidden">{timeAgo(row.at)}</span>
                      </div>
                      <p className="mt-1 truncate text-xs text-muted-foreground">{pixelName}</p>
                    </div>

                    <div className="flex items-center justify-between gap-4 sm:justify-end">
                      <span className={`inline-flex items-center gap-2 text-xs font-medium ${statusTextClass}`}>
                        <span className={`size-1.5 shrink-0 rounded-full ${statusDotClass}`} aria-hidden="true" />
                        {statusLabel}
                      </span>
                      <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{timeAgo(row.at)}</span>
                      <span className="shrink-0 text-xs text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true">⌄</span>
                    </div>
                  </div>
                </summary>

                <div className="grid gap-3 pb-4 pt-1 text-xs">
                  <div>
                    <p className="font-medium text-muted-foreground">Resposta</p>
                    <p className="mt-1 break-words leading-5 text-foreground/85">{row.response?.message || 'Sem mensagem adicional.'}</p>
                  </div>
                  <div>
                    <p className="font-medium text-muted-foreground">Event ID</p>
                    <p className="mt-1 break-all font-mono text-xs leading-5 text-muted-foreground">{row.eventId}</p>
                  </div>
                </div>
              </details>
            )
          })}
        </div>
      )}
    </section>
  )
}
