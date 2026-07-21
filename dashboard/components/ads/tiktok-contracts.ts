// Contratos visíveis compartilhados pelos fluxos TikTok Ads. Manter as opções
// em um único lugar evita que criação, Smart+ e edição enviem enums diferentes.

export const TIKTOK_MIN_BUDGET = 50

export function tiktokMinimumBudgetMessage(currency: string, suffix = '') {
  return `O orçamento mínimo do TikTok é ${currency} ${TIKTOK_MIN_BUDGET}${suffix}`
}

const TIKTOK_INTEREST_ALIASES: Record<string, string[]> = {
  animais: ['animals', 'pets'],
  beleza: ['beauty', 'cosmetics', 'skincare'],
  comida: ['food', 'cooking'],
  compras: ['shopping', 'retail'],
  culinaria: ['food', 'cooking'],
  educacao: ['education'],
  esportes: ['sport', 'sports'],
  financas: ['finance', 'investment'],
  games: ['game', 'gaming', 'esports'],
  jogos: ['game', 'gaming', 'esports'],
  maquiagem: ['makeup', 'beauty', 'cosmetics'],
  moda: ['fashion', 'clothing'],
  musica: ['music'],
  negocios: ['business', 'entrepreneurship'],
  saude: ['health', 'wellness'],
  tecnologia: ['technology', 'tech', 'electronics'],
  viagem: ['travel', 'tourism'],
  viagens: ['travel', 'tourism'],
}

function normalizeTikTokSearch(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
}

export function matchesTikTokInterest(name: string, query: string) {
  const normalizedQuery = normalizeTikTokSearch(query)
  if (!normalizedQuery) return false
  const terms = new Set([normalizedQuery])
  for (const [alias, translations] of Object.entries(TIKTOK_INTEREST_ALIASES)) {
    if (alias.includes(normalizedQuery) || normalizedQuery.includes(alias)) {
      translations.forEach((term) => terms.add(term))
    }
  }
  const normalizedName = normalizeTikTokSearch(name)
  return [...terms].some((term) => normalizedName.includes(term))
}

export const TIKTOK_CTA_OPTIONS = [
  { value: 'LEARN_MORE', label: 'Saiba mais' },
  { value: 'SHOP_NOW', label: 'Compre agora' },
  { value: 'SIGN_UP', label: 'Cadastre-se' },
  { value: 'DOWNLOAD_NOW', label: 'Baixe agora' },
  { value: 'CONTACT_US', label: 'Fale conosco' },
  { value: 'BOOK_NOW', label: 'Reserve agora' },
  { value: 'ORDER_NOW', label: 'Peça agora' },
  { value: 'GET_QUOTE', label: 'Solicite orçamento' },
] as const

export const TIKTOK_PIXEL_EVENTS = [
  { value: 'ON_WEB_ORDER', label: 'Compra concluída' },
  { value: 'INITIATE_ORDER', label: 'Iniciou checkout' },
  { value: 'ON_WEB_CART', label: 'Adicionou ao carrinho' },
  { value: 'ON_WEB_DETAIL', label: 'Visualizou produto' },
  { value: 'ON_WEB_REGISTER', label: 'Cadastro concluído' },
  { value: 'LANDING_PAGE_VIEW', label: 'Visualizou página' },
] as const

export function toLocalIsoDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function tomorrowLocalIsoDate() {
  const date = new Date()
  date.setDate(date.getDate() + 1)
  return toLocalIsoDate(date)
}
