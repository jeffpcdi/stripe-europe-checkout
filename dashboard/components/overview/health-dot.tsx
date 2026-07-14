'use client'

// Fase 3: veredito de saúde condensado num único dot com popover. Antes era um
// GlassCard inteiro (health-card.tsx) ocupando uma coluna do overview; agora o
// estado geral cabe no header e o detalhe (serviços + EMQ) abre sob demanda.
// Reusa exatamente os mesmos hooks/chaves SWR do antigo card — /api/health e
// /api/pixels/emq-trend, esta última adiada para pós-first-paint — então NÃO
// adiciona nenhuma request ao load (o header já consome /api/health).

import { useEffect, useId, useRef, useState } from 'react'
import { TrendingDown, TrendingUp, Minus } from 'lucide-react'
import { useHealth, useEmqTrend } from '@/lib/api'
import { useAfterFirstPaint } from '@/lib/use-after-first-paint'
import { cn } from '@/lib/utils'

const CHECKS: { key: 'db' | 'redis' | 'conversionWebhook' | 'tiktok' | 'pushcut'; label: string }[] = [
  { key: 'db', label: 'Banco de dados' },
  { key: 'redis', label: 'Redis' },
  { key: 'conversionWebhook', label: 'Webhook de conversão' },
  { key: 'tiktok', label: 'TikTok CAPI' },
  { key: 'pushcut', label: 'Pushcut' },
]

function fmtUptime(sec: number) {
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}min`
  return `${m}min`
}

/* Mesmo veredito do health-card original (item 280):
   crítico (rosa): banco fora OU migrações falharam — dados em risco.
   atenção (âmbar): redis fora com fila, ou fila de retry > 0.
   ok (verde): resto. Integrações opcionais não rebaixam. */
function aggregateHealth(d: {
  db: boolean
  migrations?: boolean
  redis: boolean
  redisEnabled: boolean
  queues?: { conv: { queue: number; processing: number } | null; capiRetry: number }
}): { level: 'ok' | 'warn' | 'crit'; label: string } {
  if (!d.db || d.migrations === false) return { level: 'crit', label: 'Crítico' }
  const convQueue = d.queues?.conv?.queue ?? 0
  const capiRetry = d.queues?.capiRetry ?? 0
  if ((d.redisEnabled && !d.redis) || convQueue > 20 || capiRetry > 0)
    return { level: 'warn', label: 'Atenção' }
  return { level: 'ok', label: 'Operacional' }
}

const AGG_STYLE = {
  ok: { dot: 'svc-dot svc-dot--ok', text: 'text-success' },
  warn: { dot: 'svc-dot svc-dot--off', text: 'text-warning' },
  crit: { dot: 'svc-dot svc-dot--off', text: 'text-error' },
} as const

export function HealthDot() {
  const { data, error } = useHealth()
  const agg = data ? aggregateHealth(data) : null

  // EMQ dos pixels — secundário, adiado para pós-first-paint (item 297 / Fase 4).
  const afterFirstPaint = useAfterFirstPaint()
  const { data: emqData } = useEmqTrend(afterFirstPaint)
  const emq = (() => {
    const pixels = emqData?.pixels?.filter((p) => p.recentAvg != null) ?? []
    if (pixels.length === 0) return null
    const recent = pixels.reduce((s, p) => s + (p.recentAvg ?? 0), 0) / pixels.length
    const withBase = pixels.filter((p) => p.baseAvg != null)
    const base = withBase.length
      ? withBase.reduce((s, p) => s + (p.baseAvg ?? 0), 0) / withBase.length
      : null
    const dir: 'up' | 'down' | 'flat' =
      base == null || Math.abs(recent - base) < 0.15 ? 'flat' : recent > base ? 'up' : 'down'
    return { recent, dir, alerts: emqData?.alerts ?? 0 }
  })()

  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const panelId = useId()

  // Popover leve: fecha ao clicar fora ou apertar Esc (sem dependência nova).
  useEffect(() => {
    if (!open) return
    function onPointer(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const level = agg?.level ?? 'ok'
  const label = error ? 'Indisponível' : (agg?.label ?? 'Verificando…')

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`Saúde do sistema: ${label}. Clique para detalhes.`}
        className={cn(
          'glass flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
          'hover:text-foreground',
        )}
      >
        <span className={AGG_STYLE[level].dot} aria-hidden="true" />
        <span className={cn('font-mono text-[11px] font-semibold', AGG_STYLE[level].text)}>
          {label}
        </span>
      </button>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label="Detalhe da saúde do sistema"
          className="glass anim-content-in absolute right-0 top-[calc(100%+8px)] z-50 w-72 rounded-xl border border-border p-4 shadow-xl"
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="section-head text-sm font-semibold text-foreground">Saúde do sistema</h3>
            {data ? (
              <span className="font-mono text-[10.5px] text-muted-foreground">
                uptime {fmtUptime(data.uptimeSec)}
                {data.dbLatencyMs !== null ? ` · db ${data.dbLatencyMs}ms` : ''}
              </span>
            ) : null}
          </div>

          {error ? (
            <p className="text-sm text-error">Não foi possível carregar a saúde do sistema.</p>
          ) : data ? (
            <ul className="flex flex-col gap-2.5">
              {CHECKS.map((c) => {
                const ok = data[c.key]
                return (
                  <li key={c.key} className="flex items-center justify-between gap-3">
                    <span className="text-sm text-sub">{c.label}</span>
                    <span className="flex items-center gap-2">
                      <span
                        className={ok ? 'svc-dot svc-dot--ok' : 'svc-dot svc-dot--off'}
                        aria-hidden="true"
                      />
                      <span className={cn('font-mono text-[11px]', ok ? 'text-success' : 'text-warning')}>
                        {ok ? 'Ativo' : 'Inativo'}
                      </span>
                    </span>
                  </li>
                )
              })}
              {emq ? (
                <li className="flex items-center justify-between gap-3 border-t border-border/40 pt-2.5">
                  <a
                    href="/dashboard/pixels"
                    className="text-sm text-sub underline-offset-2 hover:text-foreground hover:underline"
                    title="Ver tendência completa na aba Pixels"
                  >
                    EMQ dos pixels
                  </a>
                  <span className="flex items-center gap-1.5">
                    {emq.dir === 'down' ? (
                      <TrendingDown className="size-3.5 text-warning" aria-hidden="true" />
                    ) : emq.dir === 'up' ? (
                      <TrendingUp className="size-3.5 text-success" aria-hidden="true" />
                    ) : (
                      <Minus className="size-3.5 text-muted-foreground" aria-hidden="true" />
                    )}
                    <span
                      className={cn(
                        'font-mono text-[11px] tabular-nums',
                        emq.alerts > 0 || emq.dir === 'down'
                          ? 'text-warning'
                          : emq.dir === 'up'
                            ? 'text-success'
                            : 'text-muted-foreground',
                      )}
                    >
                      {emq.recent.toFixed(1)}
                      {emq.alerts > 0 ? ` · ${emq.alerts} em alerta` : ''}
                    </span>
                  </span>
                </li>
              ) : null}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Verificando serviços…</p>
          )}
        </div>
      )}
    </div>
  )
}
