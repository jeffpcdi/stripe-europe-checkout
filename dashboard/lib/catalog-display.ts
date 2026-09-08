import { fmtSpend } from './format'

// O feed armazena preço e moeda juntos: "79.90 BRL".
export function catalogDisplayPrice(input: string | undefined, currency: string) {
  const match = String(input || '').trim().match(/^(\d+(?:[.,]\d{1,2})?)\s*([A-Z]{3})?$/)
  if (!match) return input?.trim() || '—'
  return fmtSpend(Number(match[1].replace(',', '.')), match[2] || currency)
}

// Zero confirmado no TikTok não pode ser substituído pelo total salvo localmente.
export function catalogProductCount(catalog: { productCount: number; audit?: { total?: number } | null }) {
  const total = catalog.audit?.total
  const hasRemoteCount = typeof total === 'number' && Number.isFinite(total) && total >= 0
  return { count: hasRemoteCount ? total : catalog.productCount, source: hasRemoteCount ? 'TikTok' : 'local', hasRemoteCount }
}
