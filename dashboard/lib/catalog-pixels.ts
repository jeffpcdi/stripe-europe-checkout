import type { AdsTikTokPixel } from './types'

export function catalogPixelValue(pixel: AdsTikTokPixel) {
  const candidates = [pixel.id, pixel.code]
  return candidates.map((value) => String(value || '').trim()).find((value) => /^\d{6,30}$/.test(value)) || ''
}

export function catalogPixelLabel(pixel: AdsTikTokPixel) {
  const value = catalogPixelValue(pixel)
  const name = String(pixel.name || pixel.code || pixel.id || 'Pixel TikTok').trim()
  const purchases = Math.max(0, Number(pixel.purchaseCount) || 0)
  return `${name} · ${purchases} ${purchases === 1 ? 'compra' : 'compras'} em 30d${value ? ` · ID ${value}` : ''}`
}
