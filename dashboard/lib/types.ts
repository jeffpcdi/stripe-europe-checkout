// Tipos espelhando o contrato REAL das APIs do Express (stats.js / server.js).
// Nunca alterar aqui sem conferir o backend — o Express é a fonte de verdade.

export interface StatsEvent {
  id: string
  type: 'sale' | 'failed' | 'refund' | 'dispute' | 'checkout' | 'lead' | 'visit' | 'info' | string
  at: string
  acc?: string | null
  title?: string
  ref?: string
  amount?: number // centavos
  currency?: string
  customer?: string
  email?: string
  gateway?: string
  country?: string
  card?: string
  landing?: string
  practice?: string
  reason?: string
}

// ── /api/live — presença em tempo real (presence.js) ──
export interface LiveVisitor {
  id: string
  acc?: string | null
  page?: string
  referrer?: string
  country?: string
  countryName?: string
  city?: string
  variant?: string
  ua?: string
  pageviews: number
  durationMs: number
  idleMs: number
}

export interface LiveCountry {
  code: string
  name: string
  count: number
}

export interface LiveResponse {
  visitors: LiveVisitor[]
  summary: { online: number; countries: LiveCountry[] }
  checkout: { externalEst: number }
  ts: string
}

export interface Lead {
  id: string
  at: string
  acc?: string | null
  stage: 'visit' | 'checkout' | 'purchased' | string
  status?: string
  gateway?: string | null
  orphan?: boolean
  country?: string
  countryName?: string
  city?: string
  device?: string
  browser?: string
  checkoutAt?: string
  purchasedAt?: string
  amount?: number
  currency?: string
  utm?: Record<string, string>
  journey?: { p: string; at: string }[]
  customer?: string
  email?: string
  referer?: string
  checkoutHits?: { at: string }[]
  reportedAmount?: number
  reportedCurrency?: string
  expectedAmount?: number
  expectedCurrency?: string
}

export interface CountryStat {
  code: string
  name: string
  count: number
  purchased: number
}

export interface StatsResponse {
  events: StatsEvent[]
  updatedAt?: string
  totals: {
    revenue: Record<string, number> // { EUR: centavos, ... }
    sales: number
    failed: number
    refunds: number
    disputes: number
    approvalRate: number
  }
  funnel: {
    visits: number
    reachedCheckout: number
    purchased: number
    visitToCheckout: number
    checkoutToPurchase: number
    overall: number
    byGateway: Record<string, { checkout: number; purchased: number }>
    byDevice: Record<string, { visits: number; purchased: number }>
    byBrowser: Record<string, number>
  }
  countries: CountryStat[]
  leads: Lead[]
}

export interface HealthResponse {
  conversionWebhook: boolean
  tiktok: boolean
  pushcut: boolean
  dashboard: boolean
  db: boolean
  dbLatencyMs: number | null
  redis: boolean
  redisEnabled: boolean
  uptimeSec: number
  ts: string
}

export type Period = 'today' | '7d' | '30d' | 'all'

// ── /api/links — links de checkout (link-store.js) ──
export interface LinkVariant {
  id: string
  nome: string
  url: string
  urlMobile?: string | null
  urlWhitePage?: string | null
  peso: number
  clicks: number
  conversions: number
  revenue: Record<string, number>
}

export interface CheckoutLink {
  slug: string
  acc?: string | null
  nome: string
  dominio?: string | null
  dominioValidado: boolean
  dominioValidadoEm?: string | null
  variantes: LinkVariant[]
  urlWhitePage?: string | null
  paises: string[]
  idiomas: string[]
  pixelSlug: string
  ativo: boolean
  criadoEm: string
  updatedAt: string
}

export interface LinksResponse {
  links: CheckoutLink[]
}

// ── /api/domains — domínios personalizados (server.js) ──
export interface CustomDomain {
  host: string
  verificado: boolean
  verificadoEm?: string | null
  criadoEm: string
  providerId?: string
}

export interface DomainsResponse {
  domains: CustomDomain[]
  appHost: string
}

export interface DomainVerifyResult {
  host: string
  appHost: string
  dnsOk: boolean
  dnsDetail: string
  httpOk: boolean
  httpDetail: string
  verified?: boolean
  cloudflareProxy?: boolean
  reconectado?: boolean
  dnsRecords?: { type: string; name: string; value: string }[] | null
}
