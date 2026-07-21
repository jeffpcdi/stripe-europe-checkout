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

// Escolhe automaticamente o melhor Pixel da conta: prioriza pixels ativos e,
// entre eles, o que registrou mais compras nos últimos 30 dias. Retorna o valor
// numérico pronto para usar como pixel_id, ou '' quando nenhum pixel é utilizável.
export function pickDefaultCatalogPixel(pixels: AdsTikTokPixel[]) {
  const usable = (Array.isArray(pixels) ? pixels : [])
    .map((pixel) => ({ pixel, value: catalogPixelValue(pixel) }))
    .filter((option) => option.value)
  if (!usable.length) return ''
  const isActive = (pixel: AdsTikTokPixel) => String(pixel.status || '').trim().toLowerCase() === 'active'
  const purchases = (pixel: AdsTikTokPixel) => Math.max(0, Number(pixel.purchaseCount) || 0)
  usable.sort((a, b) => {
    const activeDiff = Number(isActive(b.pixel)) - Number(isActive(a.pixel))
    if (activeDiff !== 0) return activeDiff
    return purchases(b.pixel) - purchases(a.pixel)
  })
  return usable[0].value
}
