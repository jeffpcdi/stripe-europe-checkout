import type { LiveResponse } from './types'

// O globo representa presença confirmada, nunca histórico de visitas/compras.
export function liveGlobeData(data: LiveResponse | undefined, now: number, failed = false) {
  const at = data ? Date.parse(data.ts) : NaN
  const fresh = !failed && Number.isFinite(at) && now - at <= 20_000 && at <= now + 5_000
  const grouped = new Map<string, { code: string; name: string; count: number; purchased: number }>()
  if (fresh) for (const country of data?.summary.countries ?? []) {
    const count = Math.floor(Number(country.count))
    const code = country.code?.toUpperCase()
    if (!code || !Number.isFinite(count) || count <= 0) continue
    const previous = grouped.get(code)
    grouped.set(code, { code, name: country.name || code, count: (previous?.count || 0) + Math.floor(count), purchased: 0 })
  }
  return {
    fresh,
    online: fresh && Number.isFinite(Number(data?.summary.online)) ? Math.max(0, Math.floor(Number(data?.summary.online))) : null,
    countries: Array.from(grouped.values()).sort((a, b) => b.count - a.count),
  }
}

// A primeira leitura estabelece a base. Um pulso indica aumento, nunca uma entrada inferida no carregamento.
export function presenceIncreases(previous: { code: string; count: number }[] | null, current: { code: string; count: number }[]) {
  if (!previous) return []
  const counts = new Map(previous.map(country => [country.code, country.count]))
  return current.filter(country => country.count > (counts.get(country.code) || 0)).map(country => country.code)
}
