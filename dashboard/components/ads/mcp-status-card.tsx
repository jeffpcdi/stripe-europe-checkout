'use client'

// Painel de diagnóstico da integração MCP Pipeboard: conexão real, volume de
// chamadas/erros na última hora, contas bloqueadas pelo limite mensal e o
// pulso do motor de automações 24/7 (última varredura + última ação).
// Colapsado por padrão numa linha fina — diagnóstico não disputa atenção com
// as campanhas; expande no clique.

import { useState } from 'react'
import { ChevronDown, Plug, RefreshCw, ShieldAlert } from 'lucide-react'
import { useSWRConfig } from 'swr'
import { useAdsMcpStatus } from '@/lib/api'
import { GlassCard } from '@/components/glass-card'
import { toast } from '@/lib/toast'

function timeAgo(iso: string | null): string {
  if (!iso) return 'nunca'
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 90) return 'agora há pouco'
  if (s < 3600) return `há ${Math.round(s / 60)} min`
  if (s < 86_400) return `há ${Math.round(s / 3600)} h`
  return `há ${Math.round(s / 86_400)} d`
}

export function McpStatusCard({ active }: { active: boolean }) {
  const { data, isLoading } = useAdsMcpStatus(active)
  const { mutate } = useSWRConfig()
  const [open, setOpen] = useState(false)
  const [testing, setTesting] = useState(false)

  if (!active || (!data && !isLoading)) return null

  const connected = Boolean(data?.connected)
  const blocked = data?.accounts?.blocked ?? []
  const auto = data?.automation

  async function testConnection() {
    if (testing) return
    setTesting(true)
    try {
      const res = await fetch('/api/ads/mcp/status?force=1', { credentials: 'include' })
      const fresh = await res.json()
      // injeta a resposta forçada no cache do SWR (sem segunda chamada)
      mutate('/api/ads/mcp/status', fresh, { revalidate: false })
      if (fresh.connected) toast.success(`Pipeboard conectado · ${fresh.toolCount} tools`)
      else toast.error('Pipeboard fora do ar', { hint: fresh.error || undefined })
    } catch {
      toast.error('Falha ao testar a conexão')
    } finally {
      // throttle de 30s no botão: evita rajada de tools/list sem cache
      setTimeout(() => setTesting(false), 30_000)
    }
  }

  return (
    <GlassCard className="p-0 border border-brand-cyan/20 bg-background/30 shadow-[0_0_10px_rgba(37,244,238,0.1)] overflow-hidden transition-all hover:border-brand-cyan/40 hover:shadow-[0_0_15px_rgba(37,244,238,0.2)]">
      {/* Linha compacta sempre visível */}
      <button
        type="button"
        className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span
          className={`size-2 shrink-0 rounded-full ${
            connected ? 'bg-brand-cyan shadow-[0_0_8px_rgba(37,244,238,0.6)] animate-pulse' : 'bg-error shadow-[0_0_6px_var(--error)]'
          }`}
          aria-hidden="true"
        />
        <Plug className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="text-xs font-medium text-foreground">
          Pipeboard MCP {connected ? 'conectado' : data ? 'com problema' : '…'}
        </span>
        {data && connected && (
          <span className="hidden text-[11px] text-muted-foreground sm:inline">
            {data.toolCount} tools · {data.calls.lastHour} chamada{data.calls.lastHour === 1 ? '' : 's'}/h
            {data.calls.errorsLastHour > 0 ? ` · ${data.calls.errorsLastHour} erro(s)/h` : ''}
          </span>
        )}
        {blocked.length > 0 && (
          <span className="flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-semibold text-warning">
            <ShieldAlert className="size-3" aria-hidden="true" />
            {blocked.length} bloqueada{blocked.length === 1 ? '' : 's'}
          </span>
        )}
        <ChevronDown
          className={`ml-auto size-3.5 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      {/* Detalhe expandido */}
      {open && data && (
        <div className="border-t border-[var(--border)] px-4 py-3">
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[11px] sm:grid-cols-4">
            <div>
              <p className="label-mono text-[10px]">Chamadas (1h)</p>
              <p className="mt-0.5 font-semibold tabular-nums text-foreground">{data.calls.lastHour}</p>
            </div>
            <div>
              <p className="label-mono text-[10px]">Erros (1h)</p>
              <p className={`mt-0.5 font-semibold tabular-nums ${data.calls.errorsLastHour > 0 ? 'text-warning' : 'text-foreground'}`}>
                {data.calls.errorsLastHour}
              </p>
            </div>
            <div>
              <p className="label-mono text-[10px]">Último sync</p>
              <p className="mt-0.5 font-semibold text-foreground">{timeAgo(data.accounts.lastSyncAt)}</p>
            </div>
            <div>
              <p className="label-mono text-[10px]">Automações 24/7</p>
              <p className="mt-0.5 font-semibold text-foreground">
                {auto && (auto.rulesEnabled > 0 || auto.schedulesEnabled > 0 || auto.alertsEnabled)
                  ? `varreu ${timeAgo(auto.lastSweepAt)}`
                  : 'nenhuma regra ativa'}
              </p>
            </div>
          </div>

          {auto?.lastAction && (
            <p className="mt-2.5 text-[11px] text-muted-foreground">
              Última ação: <span className={auto.lastAction.ok ? 'text-success' : 'text-warning'}>{auto.lastAction.result}</span>
              {auto.lastAction.campaignName ? ` — "${auto.lastAction.campaignName}"` : ''} · {timeAgo(auto.lastAction.at)}
            </p>
          )}

          {data.calls.lastError && data.calls.errorsLastHour > 0 && (
            <p className="mt-1.5 truncate text-[11px] text-warning" title={data.calls.lastError.message}>
              Último erro ({data.calls.lastError.tool}): {data.calls.lastError.message}
            </p>
          )}

          {blocked.length > 0 && (
            <div className="mt-2.5 rounded-lg bg-warning/10 px-3 py-2 text-[11px] text-muted-foreground">
              <p className="font-semibold text-warning">Limite mensal de contas (10/time) atingido:</p>
              {blocked.map((b) => (
                <p key={b.advertiserId} className="mt-0.5 tabular-nums">
                  {b.advertiserId}
                  {b.blockedUntil ? ` — libera em ${b.blockedUntil}` : ''}
                </p>
              ))}
            </div>
          )}

          <div className="mt-3 flex items-center gap-2">
            <button type="button" className="btn-ghost text-[11px]" onClick={testConnection} disabled={testing}>
              <RefreshCw className={`size-3 ${testing ? 'animate-spin' : ''}`} aria-hidden="true" />
              {testing ? 'Aguarde 30s…' : 'Testar conexão'}
            </button>
            {data.checkedAt && (
              <span className="text-[10px] text-muted-foreground">
                verificado {timeAgo(data.checkedAt)}
                {data.cached ? ' (cache)' : ''}
              </span>
            )}
          </div>
        </div>
      )}
    </GlassCard>
  )
}
