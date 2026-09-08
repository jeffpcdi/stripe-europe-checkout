import { fmtSpend } from './format'

// O feed armazena preço e moeda juntos: "79.90 BRL".
export function catalogDisplayPrice(input: string | undefined, currency: string) {
  const match = String(input || '').trim().match(/^(\d+(?:[.,]\d{1,2})?)\s*([A-Z]{3})?$/)
  if (!match) return input?.trim() || '—'
  return fmtSpend(Number(match[1].replace(',', '.')), match[2] || currency)
}
