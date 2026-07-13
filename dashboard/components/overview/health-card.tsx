'use client'

import { GlassCard } from '@/components/glass-card'
import { Skeleton } from '@/components/skeleton'
import { useHealth, useEmqTrend } from '@/lib/api'
import { cn } from '@/lib/utils'
import { TrendingDown, TrendingUp, Minus } from 'lucide-react'

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

/* Item 280: veredito agregado — um olhar diz se está tudo bem.
   crítico (rosa): banco fora OU migrações falharam — dados em risco.
   atenção (âmbar): redis fora com fila acumulando, ou fila de retry > 0.
   ok (verde): resto. Integrações opcionais (tiktok/pushcut) não rebaixam. */
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

export function HealthCard() {
  const { data, error, isLoading } = useHealth()
  const agg = data ? aggregateHealth(data) : null

  // Item 297: tendência de EMQ dos pixels — média recente vs. base e alerta
  // de queda/baixo já calculados pela rota /api/pixels/emq-trend.
  const { data: emqData } = useEmqTrend()
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

  return (
    <GlassCard className="anim-kpi-in p-5" style={{ animationDelay: '340ms' }}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="section-head text-sm font-semibold text-foreground">Saúde do sistema</h3>
        {data ? (
          <span className="font-mono text-[11px] text-muted-foreground">
            uptime {fmtUptime(data.uptimeSec)}
            {data.dbLatencyMs !== null ? ` · db ${data.dbLatencyMs}ms` : ''}
          </span>
        ) : null}
      </div>

      {/* V2-69: veredito com fundo tintado pela severidade (verde/âmbar/rosa 4%) */}
      {agg && (
        <div
          className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2"
          role="status"
          aria-label={`Estado geral: ${agg.label}`}
          style={{
            background:
              agg.level === 'ok'
                ? 'rgba(34,197,94,0.04)'
                : agg.level === 'warn'
                  ? 'rgba(251,191,36,0.05)'
                  : 'rgba(254,44,85,0.06)',
            borderColor:
              agg.level === 'ok'
                ? 'rgba(34,197,94,0.2)'
                : agg.level === 'warn'
                  ? 'rgba(251,191,36,0.25)'
                  : 'rgba(254,44,85,0.3)',
          }}
        >
          <span className="text-sm font-medium text-foreground">Estado geral</span>
          <span className="flex items-center gap-2">
            <span className={AGG_STYLE[agg.level].dot} aria-hidden="true" />
            <span className={cn('font-mono text-[11px] font-semibold', AGG_STYLE[agg.level].text)}>
              {agg.label}
            </span>
          </span>
        </div>
      )}

      {isLoading ? (
        <div className="flex flex-col gap-2.5">
          {CHECKS.map((c) => (
            <Skeleton key={c.key} className="h-6" />
          ))}
        </div>
      ) : error ? (
        <p className="text-sm text-error">Não foi possível carregar a saúde do sistema.</p>
      ) : data ? (
        // Item 137: dots pulsantes nos ativos, âmbar estático nos inativos
        <ul className="anim-content-in flex flex-col gap-2.5">
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
                  <span
                    className={cn(
                      'font-mono text-[11px]',
                      ok ? 'text-success' : 'text-warning',
                    )}
                  >
                    {ok ? 'Ativo' : 'Inativo'}
                  </span>
                </span>
              </li>
            )
          })}
          {/* Item 297: qualidade de correspondência (EMQ) com tendência —
              queda de EMQ encarece o CPA sem nenhum outro sinal visível */}
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
      ) : null}
    </GlassCard>
  )
}
