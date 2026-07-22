// O backend preserva o tipo do último evento depois do prefixo (`ok: Evento`).
// Reentregas deduplicadas também são recebimentos válidos, não falhas.
export function gatewayEventSucceeded(status: string | null | undefined): boolean {
  const value = String(status || '').trim().toLowerCase()
  return value === 'ok' || value.startsWith('ok:') || value.startsWith('reentrega ignorada:')
}
