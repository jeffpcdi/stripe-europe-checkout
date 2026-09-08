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
  const rows = (data?.log || []).filter(row => !slug || row.pixel === slug || row.pixel === pixels.find(p => p.slug === slug)?.name)
  return <section className="rounded-2xl border border-border bg-card p-5 flex flex-col gap-4" aria-label="Envios ao TikTok">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-sm font-semibold">Envios ao TikTok</h2><select aria-label="Filtrar envios por pixel" className="rounded-lg border border-border bg-background p-2 text-xs" value={slug} onChange={e => setSlug(e.target.value)}><option value="">Todos os pixels</option>{pixels.map(p => <option key={p.slug} value={p.slug}>{p.name}</option>)}</select></div>
    {!!health?.retryQueue && <p className="text-xs text-warning">{health.retryQueue} evento(s) aguardando nova tentativa.</p>}
    {error && <button className="btn-ghost self-start" onClick={() => void mutate()}>Não foi possível atualizar · tentar novamente</button>}
    {!data && !error ? <p className="text-xs text-muted-foreground">Buscando eventos…</p> : !rows.length ? <p className="text-xs text-muted-foreground">Nenhum envio recente para este filtro.</p> : <div className="flex flex-col gap-2">
      {rows.slice(0, 15).map((row, index) => <details key={row.id || index} className="rounded-xl border border-border px-3 py-2 text-xs">
        <summary className="cursor-pointer flex flex-wrap items-center gap-3 min-h-9"><strong>{conversionEvent(row.event)}</strong><span className="text-muted-foreground">{pixels.find(p => p.slug === row.pixel)?.name || row.pixel}</span><span className={row.status === 'ok' ? 'text-success' : row.status === 'erro' ? 'text-destructive' : 'text-muted-foreground'}>{row.status === 'ok' ? 'TikTok confirmou' : row.status === 'erro' ? 'Envio falhou' : 'Não enviado'}</span><span className="ml-auto text-muted-foreground">{timeAgo(row.at)}</span></summary>
        <p className="py-2 text-muted-foreground break-words">{row.response?.message || 'Sem mensagem adicional.'}</p><p className="font-mono text-[11px] break-all text-muted-foreground">{row.eventId}</p>
      </details>)}
    </div>}
  </section>
}
