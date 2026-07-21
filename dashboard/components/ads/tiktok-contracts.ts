// Contratos visíveis compartilhados pelos fluxos TikTok Ads. Manter as opções
// em um único lugar evita que criação, Smart+ e edição enviem enums diferentes.

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
