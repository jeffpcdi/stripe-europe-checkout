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
  /** Item 342: conversão normalizada do webhook (auditoria no feed) */
  raw?: Record<string, unknown>
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
  os?: string
  browser?: string
  checkoutAt?: string
  /** Item 302: quando o gateway registrou a 1ª tentativa de pagamento (aprovada ou não) */
  paymentStartedAt?: string
  purchasedAt?: string
  amount?: number
  currency?: string
  utm?: Record<string, string>
  /** Itens 286/287: página de entrada e link rastreado que originou o lead */
  landing?: string
  linkSlug?: string
  journey?: { p: string; at: string }[]
  customer?: string
  email?: string
  /** Item 310: telefone reportado pelo gateway (quando existe) */
  phone?: string
  referer?: string
  /** Cobertura real do loader em páginas/hospedagens externas. */
  site?: string
  sites?: { host: string; firstAt?: string; lastAt?: string; hits?: number }[]
  pixelSlug?: string
  lastSeen?: string | null
  checkoutHits?: { at: string; gateway?: string }[]
  reportedAmount?: number
  reportedCurrency?: string
  expectedAmount?: number
  expectedCurrency?: string
}

// ── /api/leads/:id — detalhe de um lead com jornada (item 326) ──
export interface LeadDetail extends Lead {
  lastSeen?: string | null
}

export interface LeadDetailResponse {
  ok: boolean
  lead: LeadDetail
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

// ── /api/overview/health — confiança e cobertura da Visão Geral ──
export interface OverviewHealthAction {
  id: string
  severity: 'critical' | 'warning'
  title: string
  detail: string
  href: string
}

export interface OverviewHealthResponse {
  ok: boolean
  status: 'healthy' | 'warning' | 'critical'
  freshness: {
    lastDataAt: string | null
    lastTrafficAt: string | null
    lastPaymentAt: string | null
    pollSeconds: number
    timezone: 'America/Sao_Paulo'
  }
  setup: {
    links: { total: number; active: number }
    pixels: { total: number; active: number; ready: number; incomplete: number }
    gateways: { total: number; lastEventAt: string | null }
  }
  coverage: {
    purchases: { total: number; tracked: number; orphan: number; rate: number | null }
    attribution: { total: number; identified: number; rate: number | null }
    geography: { total: number; identified: number; rate: number | null }
    hosts: {
      total: number
      uncovered: number
      items: { host: string; visits: number; lastAt: string | null; pixels: string[] }[]
    }
  }
  actions: OverviewHealthAction[]
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
  // Item 249: migrações novas rodaram no boot? false = boot com Neon degradado
  migrations?: boolean
  // Item 263: resumo consolidado das filas duráveis para o badge do cabeçalho
  queues?: {
    conv: { queue: number; processing: number } | null
    capiRetry: number
  }
  // Item 177: latência do julgamento do cloaker (p50/p95/deadlineRate)
  cloakerLatency?: { count: number; p50: number; p95: number; deadlineRate: number }
  uptimeSec: number
  /** Item 443: versão do app (package.json) para a seção Sobre */
  version: string | null
  ts: string
}

// ── /api/ops — observabilidade das filas duráveis (Leva 5, bloco I) ──
export interface OpsResponse {
  redisEnabled: boolean
  convQueue: { queue: number; processing: number } // pendentes + em processamento
  reclaim: { at: number; moved: number }           // último reprocessamento de itens órfãos
  convLatency: { count: number; p50: number; p95: number; max: number } // webhook→disparo (ms)
  worker: { at: number; active: boolean }           // heartbeat do drain worker
  capiRetry: { count: number; oldestAgeMs: number } // fila de retry da CAPI
  webhookDedup: number                              // reentregas de webhook ignoradas
  // Item 225: disparos CAPI deduplicados (beacon+servidor) desde o boot
  pixelDedup?: { deduped: number; sinceMs: number }
  // Itens 220/226: presença ao vivo com teto + distribuição por entrada do funil
  presence?: { online: number; limit: number; near: boolean; byEntry: { entry: string; count: number }[] }
  // Item 223: cobertura do cache de ASN (hit-rate = mem+redis / total)
  asnCache?: { memHits: number; redisHits: number; liveLookups: number; total: number; hitRate: number; entries: number }
  // Item 224: TTLs efetivos das camadas de cache (segundos)
  cacheTtls?: Record<string, number>
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
  /** Item 531: arquivado = fora da lista padrão e do /go, histórico preservado */
  arquivado?: boolean
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
  // Railway legado usa host; Cloudflare for SaaS usa name. Aceitamos ambos
  // durante a migração para manter os domínios já salvos reabrindo o tutorial.
  cname: { host?: string; name?: string; target: string } | null
  txt?: { host: string; value: string } | null
  ownership?: { type: string; name: string; value: string } | null
  certificate?: { type: string; name: string; value: string } | null
}

// Uso do domínio: onde ele vale — links de checkout, cloaker ou ambos
export type DomainUso = 'checkout' | 'cloaker' | 'ambos'

// Estado de provisionamento persistido pelo backend (B1.4):
// pending_dns → pending_ssl → active | error
export type DomainStatus = 'pending_dns' | 'pending_ssl' | 'active' | 'error'

export interface CustomDomain {
  host: string
  uso?: DomainUso
  verificado: boolean
  verificadoEm?: string | null
  criadoEm: string
  providerId?: string
  provider?: 'cloudflare' | 'railway' | string
  dns?: DomainDnsRecords | null
  // B1.4: estados explícitos de provisionamento (alimentam o stepper A9.1)
  status?: DomainStatus
  sslStatus?: string | null
  lastCheckedAt?: string | null
  lastError?: string | null
}

export interface DomainsResponse {
  domains: CustomDomain[]
  appHost: string
  // Provisionamento automático na hospedagem ativo? Quando false, cada domínio
  // exige adição manual no painel da hospedagem — a UI mostra um aviso.
  autoProvision?: boolean
  domainProvider?: string | null
  // Modo degradado do provider Cloudflare (sem CLOUDFLARE_CNAME_TARGET)
  providerDegraded?: boolean
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
  // A hospedagem já validou o DNS deste domínio (fonte da verdade do roteamento)
  providerVerified?: boolean
  certificateStatus?: string | null
  // B1.4: estado de provisionamento reportado pela Cloudflare neste verify
  providerStatus?: DomainStatus
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
  /** Vínculo pixel↔gateway. Com múltiplos pixels, vazio não autoriza fan-out ambíguo. */
  gatewayIds?: string[]
  scriptUrl: string | null
  scriptTag: string | null
  scriptTagTracker?: string | null
  scriptTagNative?: string | null
  scriptTagEnrich?: string | null
  updatedAt: string
}

export interface PixelsResponse {
  pixels: Pixel[]
  meta?: {
    strictIsolation?: boolean
    paymentNote?: string
  }
}

// ── /api/pixels/log — disparos CAPI recentes ──
export interface PixelLogRow {
  id: string
  at: string
  pixel: string
  event: string
  eventId?: string
  leadId?: string
  status: 'ok' | 'erro' | 'descartado' | 'bloqueado' | 'ignorado' | string
  emq?: number | null
  emqFields?: string[]
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
  source?: 'memory' | 'neon' | 'memory+neon'
  coverage?: PixelCoverage[]
}

export interface PixelCoverage {
  slug: string
  name: string
  active: boolean
  status: 'saudavel' | 'atencao' | 'sem_dados' | 'pausado'
  lastBrowserAt: string | null
  lastCapiAt: string | null
  lastCapiStatus: string | null
  domains: { host: string; visits: number; lastAt: string | null }[]
  signals: Record<'ttclid' | 'email' | 'phone' | 'external_id' | 'ttp', number | null>
  recommendations: string[]
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
  strictIsolation?: boolean
  ambiguousSaleRouting?: boolean
  unboundSalePixels?: { slug: string; name: string }[]
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
  /** true = gateway envia o valor JÁ em centavos (ex.: 9500 = €95,00) */
  amountInCents?: boolean
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
  // Resultado do disparo CAPI POR PIXEL (explica o "erro em 1/2" sem caçar o
  // motivo no log da aba Pixels): nome do pixel + ok + código/motivo do TikTok.
  capi?: { pixel: string; ok: boolean; code?: number; message?: string }[]
  [k: string]: unknown
}

export interface ConversionLogResponse {
  configured: boolean
  secret: string
  log: ConversionLogRow[]
}

// ── /api/conversion/quarantine — webhooks REJEITADOS com payload cru ──
// Todo webhook recusado (segredo/assinatura inválida, amount inválido, formato
// desconhecido) tem o corpo original preservado aqui para diagnóstico, em vez
// de ser descartado. Retenção de 30 dias no Neon.
export interface QuarantineItem {
  id: number
  received_at: string
  account_id: string | null
  route: string | null
  raw_payload: unknown
  headers: Record<string, string> | null
  rejection_reason: string | null
  gateway_hint: string | null
  resolved: boolean
  resolved_at: string | null
}

export interface QuarantineResponse {
  ok: boolean
  enabled: boolean
  pending: number
  items: QuarantineItem[]
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
  // Itens 254/261: camada de velocity (anti device-farm) configurável por conta
  velocityLimit?: number
  velocityWindowSec?: number
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
  // Item 165/208: eco do perfil simulado (null = request real do admin)
  profile?: CloakTestProfileMeta | null
  // Item 257: previsão da camada de velocity (anti device-farm)
  velocity?: {
    limit: number
    windowSec: number
    blockedAtHit: number
    note: string
  }
}

// ── /api/cloak/test/profiles — catálogo do simulador (item 165/208) ──
export interface CloakTestProfileMeta {
  id: string
  label: string
  expected: 'real' | 'bot'
  hint: string
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
  // Item 201: visitantes atualmente em cache como bot (sticky 6h)
  sticky?: { available: boolean; count: number; truncated?: boolean }
  // Item 203: acessos barrados por replay de ttclid (contador 30d)
  ttclidReplays?: number
  // Item 209: beacons do challenge JS recebidos (0 = snippet /t.js ausente)
  challenge?: { beacons: number; lastAt: number | null }
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
  // Item 212: top sinais do judge nesta decisão (só quando reason='score')
  signals?: string[]
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
  trackerScoped?: boolean // /t.js?px=TOKEN aponta para este pixel
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
  /** Item 442: aviso de novo login no painel (opt-in) */
  login: boolean
  /** Item 464: alerta de anomalia — zero vendas em 6h com histórico ativo (opt-in) */
  watchdog: boolean
}

export interface PushcutConfig {
  url: string // mascarada
  hasUrl: boolean
  events: PushcutEvents
}

// ─────────────────────────────────────────────────────────────────────────────
// TikTok Ads (via Pipeboard) — contratos de /api/ads/* (ads-routes.js)
// ─────────────────────────────────────────────────────────────────────────────

// F6 — o que o backend REALMENTE suporta via Pipeboard. A UI esconde (não
// desabilita com promessa vaga) tudo que estiver false.
export interface AdsCapabilities {
  createCampaign: boolean
  bulkCreate: boolean
  duplicateSameAccount: boolean
  duplicateCrossAccount: boolean
  variations: boolean
  sparkAds: boolean
  sparkCodeRedeem: boolean
  customIdentity: boolean
  businessCenters: boolean
  oauthConnect: boolean
  appPromotion: boolean
}

// ── /api/ads/status — estado da integração ──
export interface AdsStatusResponse {
  enabled: boolean // PIPEBOARD_API_KEY presente no servidor
  connected: boolean
  account?: { id: string; username: string; displayName: string }
  businessCenterId?: string
  advertiserId?: string
  identity?: AdsIdentity | null
  capabilities?: AdsCapabilities
}

export interface AdsIdentity {
  identityId: string
  displayName: string
  imageUrl: string
}

// ── /api/ads/accounts — advertisers (contas de anúncio) do token ──
export type AdsHealthStatus = "approved" | "banned" | "limited" | "in_review" | "unknown"

export interface AdsAdvertiser {
  id: string // advertiser_id do TikTok
  name: string
  currency?: string
  status?: string
  rawStatus?: string // código cru do TikTok (ex.: STATUS_DISABLE)
  healthStatus?: AdsHealthStatus // normalizado pelo backend
}

export interface AdsAccountsResponse {
  accounts: AdsAdvertiser[]
  selected: string
}

export interface AdsSyncAdvertiserState {
  advertiserId: string
  status: 'never' | 'syncing' | 'ok' | 'error' | 'blocked' | 'unauthorized' | string
  lastSyncedAt: string | null
  lastDurationMs?: number | null
  callsUsed?: number | null
  windowFrom?: string | null
  windowTo?: string | null
  lastError?: string | null
  requestedAt?: string | null
}

export interface AdsSyncStatusResponse {
  cacheEnabled: boolean
  advertisers: AdsSyncAdvertiserState[]
}

// ── /api/ads/health — saúde das contas + tickets de desbanimento ──
export interface AdsAccountHealth {
  advertiser_id: string
  advertiser_name: string | null
  status: AdsHealthStatus
  raw_status: string | null
  status_reason: string | null
  first_seen_banned_at: string | null
  last_checked_at: string
}

export type AdsTicketStatus = "open" | "submitted" | "resolved" | "dismissed"

export interface AdsUnbanTicket {
  id: string
  advertiser_id: string
  advertiser_name: string | null
  status: AdsTicketStatus
  appeal_text: string | null
  appeal_url: string | null
  notes: string | null
  created_at: string
  updated_at: string
  submitted_at: string | null
  resolved_at: string | null
}

export interface AdsHealthResponse {
  enabled: boolean
  health: AdsAccountHealth[]
  tickets: AdsUnbanTicket[]
  appealUrl: string
}

// ── Métricas roladas em cada nível da árvore ──
export interface AdsMetrics {
  impressions?: number
  clicks?: number
  spend?: number
  ctr?: number
  cpm?: number
  cpc?: number
  conversions?: number
  videoViews?: number
  reach?: number
}

export type AdsNodeStatus =
  | 'active'
  | 'paused'
  | 'pending_review'
  | 'error'
  | 'completed'
  | 'cancelled'
  | 'rejected'
  | string

// ── Smart+ (campanhas automatizadas do TikTok) ─────────────────────────────
export interface SmartPlusCampaign {
  campaignId: string
  name: string
  objective: string
  budget: number
  budgetMode: string
  status: AdsNodeStatus
  rawStatus: string
  secondaryStatus: string
}

export interface SmartPlusAd {
  adId: string
  name: string
  campaignId: string
  status: AdsNodeStatus
  rejected: boolean
  rejectionReason?: string
}

export interface AdsSmartPlusResponse {
  advertiserId: string
  campaigns: SmartPlusCampaign[]
}

export interface AdsSmartPlusAdsResponse {
  advertiserId: string
  ads: SmartPlusAd[]
}

export interface AdsBudget {
  amount?: number
  type?: 'daily' | 'lifetime' | string
}

// ── /api/ads/tree — campanha → ad group → ad ──
export interface AdsTreeAd {
  _id?: string
  platformAdId?: string
  name?: string
  status?: AdsNodeStatus
  // Product Link não possui URL no nível do anúncio: o destino é o campo
  // Link do produto no catálogo. A árvore expõe a semântica para que a UI não
  // ofereça uma edição de URL que quebraria esse contrato.
  catalogId?: string
  websiteType?: string
  adType?: 'boost' | 'standalone' | string
  goal?: string
  isExternal?: boolean
  budget?: AdsBudget | null
  metrics?: AdsMetrics
  creative?: { body?: string; linkUrl?: string; videoUrl?: string; imageUrl?: string } | null
  rejectionReason?: string
  createdAt?: string
}

export interface AdsTreeAdSet {
  platformAdSetId?: string
  adSetName?: string
  name?: string
  status?: AdsNodeStatus
  budget?: AdsBudget | null
  metrics?: AdsMetrics
  ads?: AdsTreeAd[]
}

export interface AdsTreeCampaign {
  platformCampaignId: string
  campaignName?: string
  status?: AdsNodeStatus
  // Status derivado dos anúncios filhos, preservado pelo backend quando ele
  // diverge do status real da campanha na plataforma (ex.: campanha ativa
  // com todos os anúncios pausados). Presente só quando divergem.
  childStatus?: AdsNodeStatus
  // Origem da campanha: 'auction' (leilão padrão) ou 'smart_plus' (mesclada pelo
  // espelho). O motor de automação pausa Smart+ mas não ajusta seu orçamento.
  campaignKind?: 'auction' | 'smart_plus'
  platformCampaignStatus?: string | null
  reviewStatus?: 'in_review' | 'approved' | 'rejected' | 'with_issues' | null
  adCount?: number
  adSetCount?: number
  budget?: AdsBudget | null
  currency?: string | null
  metrics?: AdsMetrics
  platformAdAccountId?: string
  platformAdAccountName?: string | null
  adSets?: AdsTreeAdSet[]
  daily?: AdsMetrics[] // presente quando timeIncrement=1
}

export interface AdsTreeResponse {
  campaigns: AdsTreeCampaign[]
  backfillPending?: boolean
  pagination?: { page: number; limit: number; total: number; pages: number }
  /** Motivo pelo qual a sincronização com o TikTok falhou (ex.: conta bloqueada
   *  pelo limite mensal de contas do Pipeboard). Presente = mostrar aviso. */
  syncError?: {
    code: 'ACCOUNT_BLOCKED' | 'SYNC_ERROR'
    message: string
    blockedUntil?: string | null
    advertiserId?: string
  }
}

// ── /api/ads/campaigns/:id/analytics ──
export interface AdsCampaignAnalyticsResponse {
  summary?: AdsMetrics
  daily?: ({ date?: string } & AdsMetrics)[]
  backfillPending?: boolean
}

// ── POST /api/ads/create / boost — resposta ──
export interface AdsCreateResponse {
  ads?: { _id?: string; platformAdId?: string; status?: string }[]
  platformCampaignId?: string
  platformAdSetId?: string
  message?: string
}

// ── POST /api/ads/campaigns/bulk-status ──
export interface AdsBulkStatusResponse {
  status: 'active' | 'paused'
  totals?: { updated: number; skipped: number; failed: number }
  results?: { platformCampaignId: string; updated?: number; skipped?: number; error?: string }[]
}

// ── POST /api/ads/upload — criativo → Vercel Blob ──
export interface AdsUploadResponse {
  ok: boolean
  url: string
}

// Objetivos suportados no TikTok (o backend valida a mesma lista)
export type AdsGoal =
  | 'engagement'
  | 'traffic'
  | 'awareness'
  | 'video_views'
  | 'lead_generation'
  | 'conversions'
  | 'app_promotion'

// ── GET /api/ads/roas — gasto TikTok × vendas reais dos gateways ──
export interface AdsRoasDaily {
  date: string // YYYY-MM-DD
  spend: number // moeda do advertiser
  revenueCents: number // centavos (fonte: leads convertidos)
  sales: number
}

// F4: proposta do motor de regras aguardando decisão humana (modo proposta,
// Fase 3). Vem de /api/ads/proposals — linhas de ads_rule_proposals no Neon.
export interface AdsRuleProposal {
  id: string
  rule_id: string
  metric: string
  action: string
  advertiser_id: string | null
  campaign_id: string
  campaign_name: string | null
  detail: string | null
  plan: Record<string, unknown>
  status: 'pending' | 'approved' | 'rejected' | 'expired' | 'executed' | 'failed'
  error: string | null
  created_at: string
  decided_at: string | null
  executed_at: string | null
}

export interface AdsProposalsResponse {
  enabled: boolean
  items: AdsRuleProposal[]
}

export interface AdsRoasResponse {
  fromDate: string
  toDate: string
  currency: string
  /** F2: moeda dominante da RECEITA (dos gateways) — pode divergir da conta */
  revenueCurrency?: string | null
  /** F2: true quando receita e gasto estão em moedas diferentes → roas=null */
  currencyMismatch?: boolean
  spend: number
  conversions: number
  revenueCents: number
  sales: number
  roas: number | null // receita/gasto — null sem gasto OU moedas divergentes
  cpa: number | null // gasto/vendas — null sem vendas
  daily: AdsRoasDaily[]
}

// ── GET /api/ads/library — criativos já enviados ao Blob ──
export interface AdsLibraryItem {
  url: string
  name: string
  size: number
  uploadedAt: string | null
}

export interface AdsLibraryResponse {
  items: AdsLibraryItem[]
}

// ── GET/PUT /api/ads/alerts — regras de alerta de performance ──
export interface AdsAlertsConfig {
  enabled: boolean
  spendNoConv: number // gasto mínimo sem conversão que dispara (0 = off)
  cpaMax: number // teto de CPA (0 = off)
  lookbackDays: number
  rejectedAds?: boolean // avisa quando um criativo é reprovado na revisão
  autoAppealSmartPlus?: boolean // recorre sozinho 1× de anúncio Smart+ reprovado (ação real; respeita kill switch/dry-run)
  advertiserId?: string
  revision?: number
  autonomy?: AdsAutomationAutonomy | 'custom'
  updatedAt?: string
}

export interface AdsAlertFinding {
  rule: 'spend_no_conv' | 'cpa_max' | 'rejected_ads' | 'smart_plus_rejected'
  campaignId: string
  campaignName: string
  spend?: number
  conversions?: number
  cpa?: number
  text: string
  muted?: boolean // em cooldown — detectado mas sem notificação nova
}

export interface AdsAlertCheckResponse {
  findings: AdsAlertFinding[]
  checkedAt?: string
  skipped?: boolean
}

// ── GET /api/ads/attribution — vendas reais POR CAMPANHA ──
// utm_campaign=__CAMPAIGN_ID__ (macro do TikTok) liga o lead à campanha.
export interface AdsAttributionEntry {
  revenueCents: number
  sales: number
}

export interface AdsAttributionResponse {
  fromDate: string
  toDate: string
  byCampaign: Record<string, AdsAttributionEntry>
  unattributed: AdsAttributionEntry // veio do TikTok mas sem ID de campanha
}

// ── GET/PUT /api/ads/rules — regras automáticas de otimização ──
export type AdsRuleMetric =
  | 'cpa_max'
  | 'spend_no_conv'
  | 'roas_min'
  | 'ctr_min' // CTR abaixo do piso (c/ mínimo de impressões)
  | 'cpm_max' // CPM acima do teto (c/ mínimo de gasto)
  | 'cpc_max' // CPC acima do teto (c/ mínimo de cliques)
  | 'roas_scale' // escala vencedoras: ROAS ≥ X → +orçamento (teto obrigatório)
  | 'schedule' // dayparting: ativa/pausa por dia da semana + janela de horário
// 'activate' só aparece no LOG (dayparting religando campanha própria)
export type AdsRuleAction = 'pause' | 'budget_down' | 'budget_up' | 'activate'

export interface AdsRule {
  id: string
  enabled: boolean
  // Nome/descrição legíveis (presets de fábrica trazem; regras antigas não)
  name?: string
  description?: string
  preset?: boolean // regra semeada de fábrica (badge na UI)
  metric: AdsRuleMetric
  threshold: number
  lookbackDays: number
  action: AdsRuleAction
  pct: number // % de ajuste de orçamento (budget_up/down)
  // F3 — modo da regra: 'proposal' (default do motor) grava proposta para
  // aprovação humana; 'execute' age direto. Antes invisível na UI.
  mode?: 'proposal' | 'execute'
  // guardas dos tipos novos (opcionais — regras antigas não os têm)
  minClicks?: number // cpa_max/spend_no_conv: piso de cliques (ruído não é sinal)
  minImpressions?: number // ctr_min: não age com menos impressões que isso
  minSpend?: number // cpm_max: não age com menos gasto que isso
  minSales?: number // roas_scale: vendas atribuídas mínimas p/ escalar
  budgetCap?: number // roas_scale: teto absoluto de orçamento por grupo
  // dayparting
  days?: number[] // 0=domingo … 6=sábado
  startTime?: string // 'HH:MM'
  endTime?: string // 'HH:MM' (pode cruzar meia-noite)
  timezone?: string // IANA, default Europe/Lisbon
  // Camada de PILOTOS (apresentação): regra pertence a uma estratégia de
  // gestor. Preservados pelo backend (whitelist em validateRules).
  pilot?: 'protector' | 'scaler' | 'schedule'
  intensity?: 'conservador' | 'normal' | 'agressivo'
}

export interface AdsRuleLogEntry {
  at: string
  ruleId: string
  metric: AdsRuleMetric
  action: AdsRuleAction
  campaignId: string
  campaignName: string
  detail: string
  ok: boolean
  result?: string
  // Flags da F3 que o motor grava no log (a UI usa para badges por tipo)
  proposed?: boolean // regra em modo proposta: gravou intenção, não executou
  simulated?: boolean // dry-run ativo: nada tocou a plataforma
  approvedProposal?: boolean // execução veio de uma aprovação humana
}

export interface AdsRulesResponse {
  advertiserId: string
  revision: number
  autonomy: AdsAutomationAutonomy | 'custom'
  updatedAt: string
  rules: AdsRule[]
  log: AdsRuleLogEntry[]
  alerts: AdsAlertsConfig
  engine: AdsAutomationEngine
}

export type AdsAutomationAutonomy = 'notify' | 'propose' | 'auto'

export interface AdsAutomationEngine {
  advertiserId: string
  revision: number
  autonomy: AdsAutomationAutonomy | 'custom'
  updatedAt: string
  status: 'active' | 'idle'
  lastSweepAt: string | null
  lastScheduleSweepAt: string | null
  nextSweepAt: string | null
  rulesEnabled: number
  schedulesEnabled: number
  alertsEnabled: boolean
  lastAction: { at: string; result?: string; campaignName?: string; ok: boolean } | null
}

export interface AdsRulesRunResponse {
  executed: AdsRuleLogEntry[]
  checkedAt?: string
  skipped?: boolean
}

// ── GET /api/ads/mcp/status — diagnóstico da conexão MCP Pipeboard ──
export interface AdsMcpStatusResponse {
  enabled: boolean
  connected: boolean
  error: string | null
  checkedAt: string | null
  cached: boolean
  toolCount: number
  calls: {
    total: number
    lastMinute: number
    lastHour: number
    errorsLastHour: number
    lastError: { at: string; tool: string; message: string; code: string | null } | null
  }
  accounts: {
    synced: number
    blocked: { advertiserId: string; blockedUntil: string | null }[]
    lastSyncAt: string | null
  }
  automation: {
    advertiserId?: string
    revision?: number
    autonomy?: AdsAutomationAutonomy | 'custom'
    updatedAt?: string
    status?: 'active' | 'idle'
    lastSweepAt: string | null
    lastScheduleSweepAt: string | null
    nextSweepAt?: string | null
    rulesEnabled: number
    schedulesEnabled: number
    alertsEnabled: boolean
    lastAction: { at: string; result?: string; campaignName?: string; ok: boolean } | null
  }
  // telemetria da camada de IA (Vercel AI Gateway ≠ chamadas Pipeboard)
  ai?: { calls: number; errors: number; lastAt: string | null; lastError: string | null }
}

// ── GET /api/ads/kpis — totais agregados com comparação de período ──
export interface AdsKpiTotals {
  spend: number
  impressions: number
  clicks: number
  conversions: number
  ctr: number
  cpm: number
}

export interface AdsKpisResponse {
  fromDate?: string
  toDate?: string
  prevFrom?: string
  prevTo?: string
  current: AdsKpiTotals | null
  previous: AdsKpiTotals | null
  // % vs. período anterior; null quando a base é 0 (a UI oculta a seta)
  deltas: Record<'spend' | 'impressions' | 'clicks' | 'conversions' | 'ctr' | 'cpm', number | null> | null
}

// ── IA: copiloto, briefing, criativos, realocação (/api/ads/copilot etc.) ──

// Evento SSE do copiloto (data: {...}\n\n)
export type CopilotEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string }
  | { type: 'action'; action: ProposedAction }
  | { type: 'error'; error: string }
  | { type: 'done' }

// Proposta de ação da IA — vira card de aprovação; executa via /copilot/execute
export interface ProposedAction {
  proposed: true
  type: 'pause' | 'activate' | 'budget' | 'create_rule'
  params: {
    campaignIds?: string[]
    campaignId?: string
    budget?: number
    rule?: Partial<AdsRule>
  }
  summary: string
}

export interface AdsAnomaly {
  metric: 'spend' | 'cpa' | 'ctr' | 'cpm'
  day: string
  value: number
  mean: number
  z: number
  direction: 'up' | 'down'
  severity: 'bad' | 'good'
}

export interface AdsBriefing {
  date: string
  kind: string
  content: string
  meta: { anomalies?: AdsAnomaly[]; usedAi?: boolean; advertiserId?: string }
  createdAt: string
}

export interface AdsBriefingResponse {
  ai: boolean
  briefings: AdsBriefing[]
}

export interface AdsCreativeInsights {
  cached?: boolean
  stale?: boolean
  insufficient?: boolean
  adCount?: number
  windowDays?: number // 1 = análise de hoje; 7 = fallback (dia sem 3 anúncios com gasto)
  content?: string
  patterns?: string
  topAds?: {
    adId: string
    name: string
    campaignName: string
    spend: number
    conversions: number
    ctr: number
  }[]
  variations?: { basedOn: string; copies: string[] }[]
}

export interface AdsBudgetProposal {
  insufficient?: boolean
  eligibleCount?: number
  noChange?: boolean
  message?: string
  totalBudget?: number
  currency?: string
  /** Janela de atribuição usada no cálculo (dias) — a UI avisa quando < 3 */
  windowDays?: number
  rationale?: string
  changes?: {
    campaignId: string
    name: string
    roas: number | null
    sales: number
    current: number
    proposed: number
    deltaPct: number
  }[]
  unchanged?: { id: string; name: string }[]
  excluded?: { id: string; name: string; reason: string }[]
  actions?: ProposedAction[]
}

// ── /api/ads/templates — configurações de campanha reutilizáveis ──
export interface AdsTemplatePayload {
  goal?: string
  budgetAmount?: number
  budgetType?: 'daily' | 'lifetime'
  body?: string
  linkUrl?: string
  callToAction?: string
  countries?: string[]
  languages?: string[]
  ageMin?: number
  ageMax?: number
  pixelId?: string
  customEventType?: string
  gender?: 'all' | 'male' | 'female'
  interestIds?: string[]
  placements?: string[]
}

export interface AdsTemplate {
  id: string
  name: string
  payload: AdsTemplatePayload
  advertiserId?: string
  createdAt: string
}

export interface AdsTemplatesResponse {
  items: AdsTemplate[]
}

// ── POST /api/ads/bulk + GET /api/ads/bulk/:jobId — fila com progresso ──
export interface AdsBulkItem {
  idx: number
  ref: string // nome do anúncio / rótulo da cópia
  status: 'queued' | 'running' | 'done' | 'failed'
  error?: string
  resultId?: string // platformCampaignId criado
}

export interface AdsBulkJob {
  jobId: string
  kind: 'bulk_create' | 'duplicate'
  status: 'queued' | 'running' | 'done'
  total: number
  done: number
  failed: number
  createdAt: string
  items: AdsBulkItem[]
}

export interface AdsBulkStartResponse {
  jobId: string
  total: number
  dryRun?: boolean
  reused?: boolean
}

// ── Fundação operacional (jobs duráveis + guardrails) ──────────────────────

// Job durável persistido no Neon (linha de /api/ads/ops/jobs)
export interface AdsOpsJob {
  id: string
  kind: string
  status: 'queued' | 'running' | 'retrying' | 'completed' | 'partial' | 'failed' | 'cancelled'
  advertiser_id: string | null
  progress: { total?: number; completed?: number; failed?: number }
  error: string | null
  attempts: number
  created_at: string
  updated_at: string
  completed_at: string | null
}

export interface AdsOpsJobsResponse {
  enabled: boolean
  jobs: AdsOpsJob[]
}

// Política de segurança normalizada (contrato camelCase de GET e PUT)
export interface AdsSafetyPolicy {
  enabled: boolean
  dryRun: boolean
  killSwitch: boolean
  dailySpendCap: number | null
  maxBudgetChangePct: number
  /** Cap global de ações reais do motor por hora (anti-loop). 0 = desligado. */
  maxActionsPerHour: number
  cooldownMinutes: number
  allowedHours: Record<string, unknown>
  blockedAdvertiserIds: string[]
  circuitBreakerErrorPct: number
}

export interface AdsSafetyPolicyResponse {
  enabled: boolean
  policy: AdsSafetyPolicy
}

export interface AdsWorkspace {
  goals: { roasMin: number; cpaMax: number; dailySpendCap: number; conversionsTarget: number; revenueTarget: number }
  favorites: { type: 'campaign' | 'product' | 'rule'; id: string; label: string }[]
  columns: string[]
  memory: Record<string, string>
  governance: {
    actorRole: 'viewer' | 'analyst' | 'operator' | 'admin'
    requiredApprovals: 1
    dualApprovalEnabled: false
    maxTargetsPerAction: number
    maxTotalBudget: number
  }
  updatedAt?: string | null
}

export interface AdsWorkspaceResponse { workspace: AdsWorkspace }

export interface AdsAuditEvent {
  id: string
  action: string
  target_type: string | null
  target_id: string | null
  advertiser_id: string | null
  before_state: Record<string, unknown> | null
  after_state: Record<string, unknown> | null
  reason: string | null
  metadata: Record<string, unknown>
  created_at: string
}

export interface AdsAuditResponse { enabled: boolean; events: AdsAuditEvent[] }

export interface AdsInternalReport {
  id: string
  advertiser_id: string
  kind: 'daily' | 'weekly' | 'monthly'
  title: string
  content: Record<string, unknown>
  created_at: string
}

export interface AdsReportsResponse { reports: AdsInternalReport[] }

// ── Catálogos de produtos (TikTok Shopping/Catalog) ────────────────────────
// O módulo gerencia produtos, conexão verificada com o catálogo remoto, jobs de
// sincronização e a hierarquia completa campanha → conjunto → anúncio.
export interface AdsCatalogAudit {
  approved: number
  pending: number
  rejected: number
  total: number
  at?: string
}

export interface AdsCatalog {
  id: string
  accountId: string
  advertiserId: string
  name: string
  currency: string
  catalogType: string
  country: string | null
  bcId: string | null
  tiktokCatalogId: string | null
  linkStatus: 'unlinked' | 'unverified' | 'verified' | 'error'
  linkVerifiedAt: string | null
  linkError: string | null
  remoteSnapshot: {
    id: string
    name: string
    currency: string
    country: string
    catalogType: string
    productCount: number
  } | null
  syncedAt: string | null
  audit: AdsCatalogAudit | null
  feedUrl: string | null
  feedPublishedAt: string | null
  productCount: number
  createdAt: string
  updatedAt: string
}

export interface AdsCatalogProductError {
  field: string
  message: string
}

export interface AdsCatalogProduct {
  id: string
  catalogId: string
  skuId: string
  data: Record<string, string>
  valid: boolean
  errors: AdsCatalogProductError[]
  createdAt: string
  updatedAt: string
}

export interface AdsCatalogsResponse {
  enabled: boolean
  catalogs: AdsCatalog[]
}

export interface AdsCatalogDetailResponse {
  catalog: AdsCatalog
  products: AdsCatalogProduct[]
}

export interface AdsCatalogFieldMeta {
  key: string
  label: string
  required: boolean
  enum: string[] | null
}

export interface AdsCatalogSpecResponse {
  columns: string[]
  required: string[]
  enums: Record<string, string[]>
  fields: AdsCatalogFieldMeta[]
  catalogTypes: { value: string; label: string }[]
  countries: { code: string; name: string }[]
}

export interface AdsCatalogBusinessCenter {
  enabled: boolean
  bcId: string
  fromEnv: boolean
}

export interface AdsCatalogCapabilities {
  catalogCreate: boolean
  catalogUpload: boolean
  catalogUploadStatus: boolean
  catalogAudit: boolean
  catalogFeedRead: boolean
  catalogLinkVerify: boolean
  manualCatalogCampaign: boolean
  productSets: boolean
  specificProducts: boolean
  catalogVideoTemplates: boolean
  adText: boolean
  callToAction: boolean
  optimizationEvents: string[]
  callToActions: string[]
  structuralReadback: boolean
  shoppingAdsType: string | null
  adFormat: string | null
  note: string
}

export interface AdsCatalogCapabilitiesResponse {
  capabilities: AdsCatalogCapabilities
}

export interface AdsCatalogSyncResponse {
  ok?: boolean
  dryRun?: boolean
  simulated?: boolean
  // A cadeia do TikTok roda em 2º plano (para não estourar o tempo de borda);
  // quando pending=true, o resultado real aparece no log de publicações.
  pending?: boolean
  run?: AdsCatalogSyncRun
  catalog: AdsCatalog
  feedUrl: string
  feedRevision?: string
  published: number
  skipped?: number
  audit?: AdsCatalogAudit | null
}

// POST /api/ads/catalogs/:id/campaign — lançar campanha de catálogo (DPA)
export interface AdsCatalogCampaignResponse {
  ok?: boolean
  dryRun?: boolean
  simulated?: boolean
  pending?: boolean
  run?: AdsCatalogCampaignRun
  name: string
  campaignId?: string
  adGroupId?: string
  adId?: string
  warnings?: string[]
}

export type AdsCatalogStepState = 'done' | 'active' | 'waiting' | 'blocked'

export interface AdsCatalogReadiness {
  state: 'draft' | 'needs_review' | 'ready_local' | 'verifying_link' | 'ready_to_sync' | 'processing_tiktok' | 'ready_tiktok' | 'ready_for_campaign' | 'blocked'
  readyForCampaign: boolean
  hasUnpublishedChanges: boolean
  nextAction: 'add_products' | 'fix_products' | 'connect_tiktok' | 'verify_link' | 'sync' | 'refresh_audit' | 'select_advertiser' | 'create_campaign'
  counts: { total: number; valid: number; invalid: number; approved: number; pending: number; rejected: number }
  steps: { id: string; label: string; state: AdsCatalogStepState; detail: string }[]
}

export interface AdsCatalogStructuredError {
  code: string
  stage: string
  message: string
  userMessage: string
  retryable: boolean
  suggestedAction: string | null
  providerRequestId: string | null
  createdIds: Record<string, string> | null
}

export interface AdsTikTokPixel {
  id: string
  code: string
  name: string
  status: string
  purchaseCount: number
}

export interface AdsCatalogSyncRun {
  id: string
  catalogId: string
  advertiserId: string
  status: 'queued' | 'waiting_connector_confirmation' | 'waiting_tiktok_processing' | 'running' | 'retrying' | 'completed' | 'partial' | 'failed' | 'cancelled'
  stage: string
  payload: Record<string, unknown>
  progress: Record<string, unknown>
  error: AdsCatalogStructuredError | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export interface AdsCatalogCampaignRun {
  id: string
  catalogId: string
  advertiserId: string
  status: 'queued' | 'waiting_connector_confirmation' | 'waiting_catalog_review' | 'running' | 'retrying' | 'completed' | 'partial' | 'failed' | 'cancelled'
  stage: string
  spec: Record<string, unknown>
  createdIds: { campaignId?: string; adGroupId?: string; adId?: string }
  result: Record<string, unknown> | null
  error: AdsCatalogStructuredError | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export interface AdsCatalogImportSummary {
  imported: number
  valid: number
  invalid: number
  skipped: { reason?: string }[]
}

export interface AdsCatalogPublishResponse {
  catalog: AdsCatalog
  feedUrl: string
  feedRevision: string
  published: number
  skipped: number
}

export interface AdsCatalogPublication {
  id: string
  kind: 'feed' | 'tiktok'
  status: 'success' | 'simulated' | 'error'
  published: number
  skipped: number
  feedUrl: string | null
  tiktokCatalogId: string | null
  audit: AdsCatalogAudit | null
  error: string | null
  createdAt: string
}

export interface AdsCatalogProductPreview {
  product: Record<string, string>
  finalUrl: string
}

// Lote rápido: o plano usa apenas o Link de cada produto. A API devolve este
// preview antes de qualquer persistência para a tela apontar exatamente a
// linha/coluna que precisa de correção.
export interface AdsCatalogBatchIssue {
  code: string
  message: string
  field?: string
  path?: string | null
  source?: string
  index?: number | null
  catalogKey?: string | null
}

export interface AdsCatalogBatchPreview {
  ok: boolean
  summary: {
    catalogs: { total: number; valid: number; invalid: number }
    products: { total: number; valid: number; invalid: number }
    campaigns: { total: number; valid: number; invalid: number }
    errors: number
    valid: boolean
    normalizedCatalogs: number
    normalizedProducts: number
    normalizedCampaigns: number
  }
  errors: AdsCatalogBatchIssue[]
  plan: { catalogs: Record<string, unknown>[] }
}

export interface AdsCatalogBatchAutomation {
  catalogSync: boolean
  catalogCreationStatus: 'ready' | 'awaiting_connector_confirmation'
  catalogCreationNote: string
  productLinkCampaign: boolean
  businessCenterConfigured: boolean
  productLinkStatus: 'ready' | 'awaiting_connector_confirmation'
  productLinkNote: string
}

export interface AdsCatalogBatchPreviewResponse {
  ok: boolean
  preview: AdsCatalogBatchPreview
  campaignSpecErrors?: AdsCatalogBatchIssue[]
  limits: { catalogs: number; products: number; campaigns: number }
  tooLarge: { counts: Record<string, number>; problems: string[] } | null
  automation: AdsCatalogBatchAutomation
}

export interface AdsCatalogBatchExecutionResponse {
  ok: boolean
  batchId: string
  preview: AdsCatalogBatchPreview
  automation: AdsCatalogBatchAutomation
  execution?: {
    summary: {
      catalogs: { total: number; completed: number; failed: number }
      products: { total: number; upserted: number; failed: number; skipped: number }
      sync: { requested: number; queued: number; failed: number }
      campaigns: { total: number; queued: number; failed: number; skipped: number }
    }
    results: Record<string, unknown>[]
  }
  dryRun?: boolean
  simulated?: boolean
}
