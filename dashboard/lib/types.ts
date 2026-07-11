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
// Registros DNS que o lojista cria no registrador do domínio dele. Shape vem
// do domain-provider (pickCname): CNAME principal + TXT opcional de verificação.
export interface DomainDnsRecords {
  cname: { host: string; target: string } | null
  txt: { host: string; value: string } | null
}

// Uso do domínio: onde ele vale — links de checkout, cloaker ou ambos
export type DomainUso = 'checkout' | 'cloaker' | 'ambos'

export interface CustomDomain {
  host: string
  uso?: DomainUso
  verificado: boolean
  verificadoEm?: string | null
  criadoEm: string
  providerId?: string
  dns?: DomainDnsRecords | null
}

export interface DomainsResponse {
  domains: CustomDomain[]
  appHost: string
}

export interface DomainAddResponse {
  ok: boolean
  host: string
  dnsRecords: DomainDnsRecords | null
  managed: boolean
  providerNote: string | null
}

export interface DomainVerifyResult {
  host: string
  appHost: string
  dnsOk: boolean
  dnsDetail: string
  // Item 175: registro já visível nos resolvers públicos (DoH) mas não no
  // resolver local = propagação em curso, não erro de configuração
  dnsPropagating?: boolean
  httpOk: boolean
  httpDetail: string
  verified?: boolean
  cloudflareProxy?: boolean
  reconectado?: boolean
  dnsRecords?: DomainDnsRecords | null
  // Item 127: marcado no CLIENTE quando o próprio fetch de verify falhou
  // (rede/servidor fora) — a UI oferece retry em vez de "DNS pendente"
  networkError?: boolean
}

// ── /api/pixels — pixels TikTok + CAPI (pixel-store.js) ──
export interface PixelEvents {
  ViewContent: boolean
  InitiateCheckout: boolean
  AddPaymentInfo: boolean
  CompletePayment: boolean
  AddToCart: boolean
}

export interface Pixel {
  slug: string
  acc?: string | null
  token: string
  name: string
  pixelCode: string
  accessToken: string // mascarado na listagem: "••••abcd"
  hasToken: boolean
  testEventCode?: string
  active: boolean
  events: PixelEvents
  scriptUrl: string | null
  scriptTag: string | null
  updatedAt: string
}

export interface PixelsResponse {
  pixels: Pixel[]
}

// ── /api/pixels/log — disparos CAPI recentes ──
export interface PixelLogRow {
  id: string
  at: string
  pixel: string
  event: string
  eventId?: string
  leadId?: string
  status: 'ok' | 'error' | string
  emq?: number | null
  response?: { code?: number; message?: string } | null
}

export interface PixelLogResponse {
  log: PixelLogRow[]
  source: 'redis' | 'neon'
}

// ── /api/pixels/health — saúde da CAPI ──
export interface PixelEventHealth {
  event: string
  total: number
  ok: number
  rate: number
  emq: number | null
}

export interface PixelHealthResponse {
  ok: boolean
  total: number
  success: number
  rate: number | null
  emq: number | null
  events: PixelEventHealth[]
  errors: { at: string; pixel: string; event: string; message: string }[]
  retryQueue: number
}

// ── /api/pixels/durability — por que a config pode não estar disparando ──
export interface PixelDurabilityResponse {
  durable: boolean
  dbEnabled: boolean
  redisEnabled: boolean
  lastOk: string | null
  lastError: string | null
  trustedGateways: number
  salePixels: number
  incomplete: { slug: string; name: string; missing: string[] }[]
  warnings: string[]
}

// ── /api/pixels/emq-trend — tendência de EMQ com alerta de queda ──
export interface EmqTrendDay {
  day: string
  avg: number
  count: number
}

export interface PixelEmqTrend {
  pixel: string
  pixelCode: string
  trend: EmqTrendDay[]
  recentAvg: number | null
  baseAvg: number | null
  alert: 'baixo' | 'queda' | null
}

export interface EmqTrendResponse {
  ok: boolean
  pixels: PixelEmqTrend[]
  alerts: number
}

// ── /api/gateways — webhooks de conversão (gateway-store.js) ──
export interface GatewayProvider {
  id: string
  label: string
  secretLabel: string
  docs: string
}

export interface Gateway {
  id: string
  provider: string
  name: string
  webhookUrl: string
  hasSecret: boolean
  lastEventAt?: string | null
  lastEventStatus?: string | null
  createdAt: string
}

export interface GatewaysResponse {
  providers: GatewayProvider[]
  gateways: Gateway[]
}

// ── /api/conversion/log — webhooks recebidos ──
export interface ConversionLogRow {
  id?: string
  at: string
  acc?: string | null
  gateway?: string
  event?: string
  status?: string
  orderId?: string
  amount?: number | string
  currency?: string
  email?: string
  matched?: boolean
  [k: string]: unknown
}

export interface ConversionLogResponse {
  configured: boolean
  secret: string
  log: ConversionLogRow[]
}

// ── /api/cloak-config — configuração global do filtro de bots ──
export type CloakSensitivity = 'strict' | 'balanced' | 'loose' | 'custom'

export interface CloakConfig {
  enabled: boolean
  threshold: number
  deadlineMs: number
  sensitivity?: CloakSensitivity
  defaultWhitePage?: string
  blockDatacenter: boolean
  blockHeadless: boolean
  checkHeaders: boolean
  requireJsChallenge: boolean
  checkWebgl: boolean
  checkTimezone: boolean
  checkBehavior: boolean
  blockZhLang: boolean
  checkWebview: boolean
  checkCoherence: boolean
  checkEntropy: boolean
  sensitivityThresholds: Record<string, number>
}

// ── /api/cloak/test — julgamento do request atual ──
// Item 134: 'off' = gate desligado; 'pass'/'block' = decisão com o request atual
export type CloakGateState = 'off' | 'pass' | 'block'
export interface CloakTestResult {
  verdict: string
  score: number
  threshold: number
  signals: string[]
  ip: string
  ua: string
  slug?: string
  gates?: {
    mobile: CloakGateState
    adClick: CloakGateState
    pais: CloakGateState
    idioma: CloakGateState
  } | null
  // Itens 163/164/210: infraestrutura resolvida (ASN/org) e tempo do julgamento
  asn?: number
  org?: string
  resolvedAt?: number
}

// ── /api/cloak/stats — offer vs white por link ──
export interface CloakStatItem {
  tipo: 'go' | 'cloak'
  slug: string
  nome: string
  offer: number
  white: number
  total: number
  blockRate: number
  reasons: Record<string, number>
  daily: { day: string; offer: number; white: number }[]
}

export interface CloakStatsResponse {
  ok: boolean
  redis: boolean
  aggregate: {
    offer: number
    white: number
    total: number
    blockRate: number
    reasons: Record<string, number>
  }
  links: CloakStatItem[]
}

// ── /api/cloak/entries — links de cloaking dedicados (/c/:slug) ──
export interface CloakEntry {
  slug: string
  nome: string
  dominio?: string
  offerUrl: string
  whitePageUrl: string
  enabled: boolean
  mobileOnly: boolean
  requireAdClick: boolean
  sensitivity?: CloakSensitivity
  threshold?: number
  deadlineMs?: number
  paisPreset?: string
  paises: string[]
  idiomas: string[]
  criadoEm: string
  updatedAt: string
}

export interface CloakEntriesResponse {
  entries: CloakEntry[]
  baseUrl: string
}

// ── /api/cloak/decisions — histórico das últimas N decisões por link (item 170) ──
// IP já vem MASCARADO do backend (último octeto → x); nunca há PII aqui.
export interface CloakDecisionRow {
  at: number // epoch ms
  decision: 'offer' | 'white'
  reason: string // '' para offer; motivo do desvio para white (mobile, score…)
  score: number | null
  ip: string // mascarado: 1.2.3.x
  ua: string
  country: string // ISO-2
}

export interface CloakDecisionsResponse {
  ok: boolean
  key: string
  log: CloakDecisionRow[]
  source: 'redis' | 'memory'
}

// ── /api/me — conta logada ──
export interface Account {
  email: string
  name: string
  role: string
}

// ── /api/settings — configurações da conta (moeda padrão) ──
export interface AccountSettings {
  defaultCurrency: string // ex.: 'BRL' — fallback de moeda dos disparos/testes
}

// ── /api/pixels/test — resultado do teste de disparo ──
export interface PixelTestResult {
  ok: boolean
  event?: string // evento realmente testado (ViewContent, CompletePayment…)
  eventId?: string
  code?: number
  message?: string
  messagePtBr?: string | null // tradução amigável do erro (null = sucesso)
  error?: string
  response?: unknown
}

// ── /api/pixels/verify-url — verificação de instalação por URL externa ──
export interface PixelVerifyUrlPixel {
  slug: string
  name: string
  scriptOk: boolean // script /px/<token>.js presente na página
  nativeOk: boolean // pixelCode nativo (ttq) presente
  instalado: boolean // scriptOk || nativeOk
}
export interface PixelVerifyUrlResult {
  ok: boolean
  url?: string // URL final após redirects
  algumInstalado?: boolean
  pixels?: PixelVerifyUrlPixel[]
  error?: string
}

// ── /api/gateways/:id/test — teste por gateway ──
export interface GatewayTestResult {
  ok: boolean
  gateway?: { id: string; name: string; provider: string }
  signatureNote?: string
  receipt?: unknown
  error?: string
}

// ── /api/gateways/:id/rotate — rotação do webhook token ──
export interface GatewayRotateResult {
  ok: boolean
  webhookUrl: string
}

// ── /api/pushcut-config — notificações push ──
export interface PushcutEvents {
  sale: boolean
  failed: boolean
  refund: boolean
  dispute: boolean
  checkout: boolean
  daily: boolean
}

export interface PushcutConfig {
  url: string // mascarada
  hasUrl: boolean
  events: PushcutEvents
}
