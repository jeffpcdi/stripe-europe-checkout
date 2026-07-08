// Nomes de países em PT-BR + bandeiras (itens 113 e 160 do plano).
// Usa Intl.DisplayNames com cache; fallback para o código cru.

import { countryFlag } from './format'

let displayNames: Intl.DisplayNames | null | undefined

function getDisplayNames(): Intl.DisplayNames | null {
  if (displayNames !== undefined) return displayNames
  try {
    displayNames = new Intl.DisplayNames(['pt-BR'], { type: 'region' })
  } catch {
    displayNames = null
  }
  return displayNames
}

/** Nome do país em PT-BR a partir do código ISO ("BR" → "Brasil"). */
export function countryName(code?: string | null): string {
  if (!code) return 'Desconhecido'
  const c = code.toUpperCase()
  if (c.length !== 2) return code
  try {
    return getDisplayNames()?.of(c) ?? c
  } catch {
    return c
  }
}

/** Bandeira + nome PT-BR ("BR" → "🇧🇷 Brasil"). */
export function countryLabel(code?: string | null): string {
  if (!code) return '🌐 Desconhecido'
  return `${countryFlag(code)} ${countryName(code)}`
}
