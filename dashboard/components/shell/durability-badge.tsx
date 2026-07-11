'use client'

import Link from 'next/link'
import { AlertTriangle, DatabaseZap } from 'lucide-react'
import { useHealth } from '@/lib/api'
import { cn } from '@/lib/utils'

/**
 * Item 186: indicador global de durabilidade no cabeçalho da Gestão.
 * Consolida banco (Neon) + Redis num só lugar e classifica se a configuração
 * está durável, degradada ou volátil. Fica OCULTO no caminho saudável (banco
 * no ar) — o `LiveBadge` já sinaliza a saúde geral; este só chama a atenção
 * quando há risco real de perda de configuração, com link para o diagnóstico.
 */
export function DurabilityBadge() {
  const { data: health } = useHealth()

  // Sem dados ainda ou banco no ar = config durável (Neon é a fonte da verdade).
  if (!health || health.db) return null

  // Banco fora. O Redis ainda salva os snapshots? Então é degradado, não volátil.
  const redisCobre = health.redisEnabled && health.redis
  const volatil = !redisCobre

  const label = volatil ? 'Config volátil' : 'Persistência degradada'
  const detalhe = volatil
    ? 'Banco e Redis fora — alterações podem se perder ao reiniciar. Veja o que resolver.'
    : 'Banco fora — rodando pelo snapshot do Redis. As alterações seguem salvas. Veja detalhes.'
  const Icon = volatil ? AlertTriangle : DatabaseZap

  return (
    <Link
      href="/"
      title={detalhe}
      aria-label={`${label}. ${detalhe}`}
      className={cn(
        'flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-80',
        volatil
          ? 'bg-[var(--error-light)] text-error'
          : 'bg-[var(--warning-light)] text-warning',
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <span>{label}</span>
    </Link>
  )
}
