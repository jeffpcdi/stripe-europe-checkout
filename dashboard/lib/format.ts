// Helpers de formatação espelhando o comportamento da dashboard legada.

/** Bandeira emoji a partir do código ISO do país (ex.: "BR" → 🇧🇷) */
export function countryFlag(code?: string): string {
  if (!code || code.length !== 2) return '🌐'
  const base = 0x1f1e6
  const a = code.toUpperCase().charCodeAt(0) - 65
  const b = code.toUpperCase().charCodeAt(1) - 65
  if (a < 0 || a > 25 || b < 0 || b > 25) return '🌐'
  return String.fromCodePoint(base + a, base + b)
}

/** Rótulo amigável da página (pageLabel legado) */
export function pageLabel(p?: string): string {
  if (!p) return '—'
  const path = String(p).split('?')[0]
  if (path === '/' || path === '') return 'Página inicial'
  if (path.includes('checkout')) return 'Checkout'
  return path
}

/** Duração ao vivo compacta (liveDur legado): 45s, 3min, 2h */
export function liveDuration(ms?: number): string {
  const s = Math.floor((ms || 0) / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}min`
  return `${Math.floor(s / 3600)}h`
}

/** Visitante no checkout (isCheckoutLead legado) */
export function isCheckoutVisitor(page?: string): boolean {
  return !!(page && page.includes('checkout'))
}

/** Dinheiro em centavos → string localizada (money legado) */
export function formatMoney(cents?: number, currency = 'EUR'): string {
  const value = (cents || 0) / 100
  return value.toLocaleString('pt-PT', { style: 'currency', currency })
}

/** Hora local compacta a partir de ISO */
export function formatTime(iso?: string): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return ''
  }
}

/** Rótulo amigável do gateway (gwLabel legado): "link:oferta-es" → "Link oferta-es" */
export function gwLabel(g?: string | null): string {
  if (!g) return '—'
  if (g.startsWith('link:')) return `Link ${g.slice(5)}`
  return g.charAt(0).toUpperCase() + g.slice(1)
}

/** Tempo relativo compacto: "há 5min", "há 2h", "há 3d" */
export function timeAgo(iso?: string): string {
  if (!iso) return ''
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'agora'
  if (s < 3600) return `há ${Math.floor(s / 60)}min`
  if (s < 86400) return `há ${Math.floor(s / 3600)}h`
  return `há ${Math.floor(s / 86400)}d`
}

/** Data + hora local a partir de ISO */
export function formatDateTime(iso?: string): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString('pt-PT', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}
