'use client'

import Link from 'next/link'
import { useHealth, useOverviewHealth } from '@/lib/api'

/** Cadastro pronto não garante entrega de cada evento; o link abre o diagnóstico. */
export function TrackingStatus() {
  const { data, error } = useOverviewHealth()
  const { data: health, error: healthError } = useHealth()
  const unavailable = error || healthError || !data || !health
  const ready = !unavailable && data.ok && data.status === 'healthy' && health.db
    && data.setup?.pixels.ready > 0 && data.setup?.links.active > 0 && data.setup?.gateways.total > 0
  const label = unavailable ? 'Tracking indisponível' : ready ? 'Tracking Ativo' : 'Revisar tracking'
  return (
    <Link href="/conversions" className="premium-navbar__status" data-active={Boolean(ready)}
      title={ready ? 'Rastreamento configurado e painel saudável. Ver entregas e diagnósticos.' : label}
      aria-label={label}>
      <span className="premium-navbar__status-dot" aria-hidden="true" /><span>{label}</span>
    </Link>
  )
}
