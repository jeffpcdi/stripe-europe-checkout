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

// Aceita o que o gestor colar — ID numérico OU o código alfanumérico do
// Events Manager (ex.: D9F2J3JC77U5KEVKQB80) — e resolve para o pixel_id
// numérico que a API do TikTok exige. Sem conversão manual.
export type CatalogPixelResolution = {
  // ID numérico pronto para a API ('' quando não resolvido)
  id: string
  // Como o valor foi interpretado
  kind: 'numeric' | 'code' | 'empty' | 'unresolved'
  // Mensagem amigável quando o código não pôde ser convertido
  error?: string
}

export function resolveCatalogPixelInput(raw: string, pixels: AdsTikTokPixel[]): CatalogPixelResolution {
  const value = String(raw || '').trim()
  if (!value) return { id: '', kind: 'empty' }
  if (/^\d{6,30}$/.test(value)) return { id: value, kind: 'numeric' }
  // Código do Events Manager: alfanumérico com pelo menos uma letra.
  if (/^[A-Za-z0-9]{10,30}$/.test(value) && /[A-Za-z]/.test(value)) {
    const needle = value.toUpperCase()
    const match = (Array.isArray(pixels) ? pixels : []).find(
      (pixel) => String(pixel.code || '').trim().toUpperCase() === needle,
    )
    const matchId = match ? catalogPixelValue(match) : ''
    if (matchId) return { id: matchId, kind: 'code' }
    return {
      id: '',
      kind: 'unresolved',
      error: `“${value}” é o código do Events Manager, mas não encontrei esse Pixel na conta de anúncio conectada. Confira se o Pixel pertence a esta conta ou informe o ID numérico (Ads Manager → Ferramentas → Eventos).`,
    }
  }
  return {
    id: '',
    kind: 'unresolved',
    error: 'Informe o ID numérico do Pixel (6 a 30 dígitos) ou o código do Events Manager (letras e números).',
  }
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
