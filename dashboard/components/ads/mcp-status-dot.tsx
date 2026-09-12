'use client'

// Indicador discreto de conexão com o TikTok (via Pipeboard) para a barra de
// contexto. Substitui o McpStatusCard técnico que poluía todas as abas: aqui é
// só um pontinho verde/vermelho com resumo no hover. O diagnóstico completo
// (tools, chamadas/h, sync, erros) vive no Modo avançado da aba Automações.

import { useAdsMcpStatus } from '@/lib/api'

export function McpStatusDot({ active, compact = false }: { active: boolean; compact?: boolean }) {
  const { data } = useAdsMcpStatus(active)
  if (!data) return null

  const ok = data.connected
  const errors = data.calls?.errorsLastHour ?? 0
  const tone = !ok ? 'error' : errors > 0 ? 'warning' : 'success'
  const label = !ok ? 'TikTok offline' : errors > 0 ? 'TikTok instável' : 'TikTok ok'
  const title = !ok
    ? `Sem conexão com o TikTok${data.error ? `: ${data.error}` : ''}. Veja detalhes no Modo avançado (Automações).`
    : errors > 0
      ? `Conexão ativa, mas ${errors} erro(s) na última hora. Detalhes no Modo avançado (Automações).`
      : `Conexão com o TikTok ativa · ${data.toolCount} recursos disponíveis.`

  const dot = tone === 'error' ? 'bg-error' : tone === 'warning' ? 'bg-warning' : 'bg-success'
  const text = tone === 'error' ? 'text-error' : tone === 'warning' ? 'text-warning' : 'text-muted-foreground'

  if (compact) {
    return (
      <span className={`ads-mcp-dot ${text}`} title={title} aria-label={label}>
        <span className={`size-2 rounded-full ${dot}`} aria-hidden="true" />
      </span>
    )
  }

  return (
    <span className={`hidden items-center gap-1.5 sm:inline-flex ${text}`} title={title}>
      <span className={`size-1.5 rounded-full ${dot}`} aria-hidden="true" />
      <span className="text-[11px]">{label}</span>
    </span>
  )
}
