'use client'

import { GlassCard } from '@/components/glass-card'
import { StatusBadge } from '@/components/status-badge'
import { Skeleton } from '@/components/skeleton'
import { useHealth } from '@/lib/api'

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

export function HealthCard() {
  const { data, error, isLoading } = useHealth()

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

      {isLoading ? (
        <div className="flex flex-col gap-2.5">
          {CHECKS.map((c) => (
            <Skeleton key={c.key} className="h-6" />
          ))}
        </div>
      ) : error ? (
        <p className="text-sm text-error">Não foi possível carregar a saúde do sistema.</p>
      ) : data ? (
        <ul className="flex flex-col gap-2.5">
          {CHECKS.map((c) => {
            const ok = data[c.key]
            return (
              <li key={c.key} className="flex items-center justify-between gap-3">
                <span className="text-sm text-sub">{c.label}</span>
                <StatusBadge status={ok ? 'success' : 'warning'}>
                  {ok ? 'Ativo' : 'Inativo'}
                </StatusBadge>
              </li>
            )
          })}
        </ul>
      ) : null}
    </GlassCard>
  )
}
