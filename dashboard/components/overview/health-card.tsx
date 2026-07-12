'use client'

import { GlassCard } from '@/components/glass-card'
import { Skeleton } from '@/components/skeleton'
import { useHealth } from '@/lib/api'
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

      {/* Item 280: linha de veredito agregado no topo do card */}
      {agg && (
        <div
          className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2"
          role="status"
          aria-label={`Estado geral: ${agg.label}`}
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
        </ul>
      ) : null}
    </GlassCard>
  )
}
