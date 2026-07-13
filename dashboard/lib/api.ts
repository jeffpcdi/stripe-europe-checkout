'use client'

import useSWR from 'swr'
import type {
  StatsResponse,
  HealthResponse,
  OpsResponse,
  LiveResponse,
  LeadDetailResponse,
  LinksResponse,
  DomainsResponse,
  PixelsResponse,
  PixelLogResponse,
  PixelHealthResponse,
  PixelDurabilityResponse,
  EmqTrendResponse,
  GatewaysResponse,
  ConversionLogResponse,
  CloakConfig,
  CloakStatsResponse,
  CloakEntriesResponse,
  CloakDecisionsResponse,
  CloakTestProfileMeta,
  Account,
  PushcutConfig,
  AccountSettings,
  AdsStatusResponse,
  AdsAccountsResponse,
  AdsBusinessCentersResponse,
  AdsBulkJob,
  AdsTreeResponse,
  AdsCampaignAnalyticsResponse,
  AdsRoasResponse,
  AdsLibraryResponse,
  AdsAlertsConfig,
  AdsAttributionResponse,
  AdsRulesResponse,
  AdsTemplatesResponse,
} from './types'

// Item 181: contrato unificado de erro da API — { ok:false, error, code, hint }.
// `hint` traz a orientação pt-BR do que fazer; `code` é estável para lógica.
// Rotas ainda não migradas simplesmente não trazem code/hint (retrocompatível).
export class ApiError extends Error {
  status: number
  code?: string
  hint?: string
  constructor(status: number, message: string, opts?: { code?: string; hint?: string }) {
    super(message)
    this.status = status
    this.code = opts?.code
    this.hint = opts?.hint
  }
  // Mensagem pronta para exibir: prioriza a orientação (hint) quando existe.
  get display(): string {
    return this.hint ? `${this.message} ${this.hint}`.trim() : this.message
  }
}

// Extrai { error, code, hint } de um corpo de resposta em qualquer formato.
function parseApiError(status: number, data: unknown): ApiError {
  const d = (data ?? {}) as { error?: string; message?: string; code?: string; hint?: string }
  const msg = d.error || d.message || `Falha na API (${status})`
  return new ApiError(status, msg, { code: d.code, hint: d.hint })
}

// Sessão expirada (cookie presente mas inválido no Express) → login
const LOGIN_URL = process.env.NEXT_PUBLIC_LOGIN_URL || 'http://localhost:3000/login'

function handleUnauthorized() {
  if (typeof window !== 'undefined') window.location.href = LOGIN_URL
}

export async function fetcher<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: 'include' })
  if (!res.ok) {
    if (res.status === 401) handleUnauthorized()
    const data = await res.json().catch(() => ({}))
    throw parseApiError(res.status, data)
  }
  return res.json() as Promise<T>
}

// Mesmo ritmo de polling da dashboard legada (12s)
const POLL_MS = 12_000

// Itens 378/407: com a aba OCULTA o SWR já suspende TODO o polling por padrão
// (`refreshWhenHidden: false`) e revalida na volta via `revalidateOnFocus`.
// Isso supera o backoff 5s→30s pedido no plano (zero requests em segundo
// plano). Os hooks abaixo NÃO devem definir `refreshWhenHidden: true`.

// Item 187: listas de gestão (links/domínios/pixels/gateways/entries) mudam
// pouco, mas precisam refletir edições feitas em OUTRA aba do navegador sem
// F5 — revalidação em foco + intervalo suave (30s, só com a aba visível).
const LIST_POLL_MS = 30_000

export function useStats() {
  return useSWR<StatsResponse>('/api/stats', fetcher, {
    refreshInterval: POLL_MS,
    revalidateOnFocus: true,
    keepPreviousData: true,
  })
}

// Presença ao vivo: ritmo mais rápido (5s), como a aba Ao Vivo legada
export function useLive() {
  return useSWR<LiveResponse>('/api/live', fetcher, {
    refreshInterval: 5_000,
    revalidateOnFocus: true,
    keepPreviousData: true,
  })
}

export function useHealth() {
  return useSWR<HealthResponse>('/api/health', fetcher, {
    refreshInterval: 30_000,
    keepPreviousData: true,
  })
}

// Item 326: detalhe de um lead para o drawer de perfil. Condicional — só
// busca com o drawer aberto (id nulo = sem request). Poll no ritmo do stats
// para o "visto por último" acompanhar enquanto o drawer está aberto.
export function useLead(id: string | null) {
  return useSWR<LeadDetailResponse>(id ? `/api/leads/${encodeURIComponent(id)}` : null, fetcher, {
    refreshInterval: POLL_MS,
    revalidateOnFocus: true,
    keepPreviousData: true,
  })
}

// Observabilidade das filas duráveis (item 191–200). Poll no ritmo do stats.
export function useOps() {
  return useSWR<OpsResponse>('/api/ops', fetcher, {
    refreshInterval: POLL_MS,
    keepPreviousData: true,
  })
}

export function useLinks() {
  return useSWR<LinksResponse>('/api/links', fetcher, {
    refreshInterval: LIST_POLL_MS,
    revalidateOnFocus: true,
    keepPreviousData: true,
  })
}

export function useDomains() {
  return useSWR<DomainsResponse>('/api/domains', fetcher, {
    refreshInterval: LIST_POLL_MS,
    revalidateOnFocus: true,
    keepPreviousData: true,
  })
}

export function usePixels() {
  return useSWR<PixelsResponse>('/api/pixels', fetcher, {
    refreshInterval: LIST_POLL_MS,
    revalidateOnFocus: true,
    keepPreviousData: true,
  })
}

// Log de disparos CAPI: poll no mesmo ritmo do stats (12s)
export function usePixelLog() {
  return useSWR<PixelLogResponse>('/api/pixels/log', fetcher, {
    refreshInterval: POLL_MS,
    keepPreviousData: true,
  })
}

export function usePixelHealth() {
  return useSWR<PixelHealthResponse>('/api/pixels/health', fetcher, {
    refreshInterval: POLL_MS,
    keepPreviousData: true,
  })
}

// Diagnóstico de PERSISTÊNCIA/config: por que o pixel pode não estar disparando
// (config não durável, sem gateway trusted, credencial incompleta).
export function usePixelDurability() {
  return useSWR<PixelDurabilityResponse>('/api/pixels/durability', fetcher, {
    refreshInterval: POLL_MS,
    keepPreviousData: true,
  })
}

// Tendência de EMQ muda no máximo 1x/dia — sem polling agressivo
export function useEmqTrend() {
  return useSWR<EmqTrendResponse>('/api/pixels/emq-trend', fetcher, {
    refreshInterval: 60_000,
    keepPreviousData: true,
  })
}

export function useGateways() {
  return useSWR<GatewaysResponse>('/api/gateways', fetcher, {
    refreshInterval: LIST_POLL_MS,
    revalidateOnFocus: true,
    keepPreviousData: true,
  })
}

export function useConversionLog() {
  return useSWR<ConversionLogResponse>('/api/conversion/log', fetcher, {
    refreshInterval: POLL_MS,
    keepPreviousData: true,
  })
}

export function useCloakConfig() {
  return useSWR<CloakConfig>('/api/cloak-config', fetcher, {
    revalidateOnFocus: true,
    keepPreviousData: true,
  })
}

export function useCloakStats() {
  return useSWR<CloakStatsResponse>('/api/cloak/stats', fetcher, {
    refreshInterval: POLL_MS,
    keepPreviousData: true,
  })
}

export function useCloakEntries() {
  return useSWR<CloakEntriesResponse>('/api/cloak/entries', fetcher, {
    refreshInterval: LIST_POLL_MS,
    revalidateOnFocus: true,
    keepPreviousData: true,
  })
}

// Item 170: log das últimas decisões de um link. `key` nulo = hook inativo
// (SWR não dispara com chave null), usado quando nenhum link está expandido.
export function useCloakDecisions(key: string | null) {
  return useSWR<CloakDecisionsResponse>(
    key ? '/api/cloak/decisions?key=' + encodeURIComponent(key) : null,
    fetcher,
    { refreshInterval: POLL_MS, keepPreviousData: true },
  )
}

// Item 165/208: catálogo de perfis do simulador de bots. Estático na prática —
// revalida só ao focar, sem polling.
export function useCloakTestProfiles() {
  return useSWR<{ ok: boolean; profiles: CloakTestProfileMeta[] }>('/api/cloak/test/profiles', fetcher, {
    revalidateOnFocus: false,
    revalidateIfStale: false,
  })
}

export function useAccount() {
  return useSWR<Account>('/api/me', fetcher, {
    revalidateOnFocus: false,
  })
}

// Configurações da conta (moeda padrão dos disparos/testes)
export function useAccountSettings() {
  return useSWR<AccountSettings>('/api/settings', fetcher, {
    revalidateOnFocus: false,
    keepPreviousData: true,
  })
}

export function usePushcutConfig() {
  return useSWR<PushcutConfig>('/api/pushcut-config', fetcher, {
    revalidateOnFocus: true,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// TikTok Ads (via Zernio) — /api/ads/*
// ─────────────────────────────────────────────────────────────────────────────

// Estado da integração (conectado? advertiser? identity?). Sem polling — a
// view revalida via mutate() após conectar/desconectar.
export function useAdsStatus() {
  return useSWR<AdsStatusResponse>('/api/ads/status', fetcher, {
    revalidateOnFocus: true,
    keepPreviousData: true,
  })
}

// Business Centers do token — camada acima dos advertisers. Só busca depois
// de conectado. `unsupported: true` na resposta = Zernio sem o endpoint.
export function useAdsBusinessCenters(connected: boolean) {
  return useSWR<AdsBusinessCentersResponse>(connected ? '/api/ads/business-centers' : null, fetcher, {
    revalidateOnFocus: true,
    keepPreviousData: true,
  })
}

// Advertisers do token — só busca depois de conectado (connected = true).
// `businessCenterId` entra na CHAVE do SWR: trocar de BC recarrega a lista.
export function useAdsAccounts(connected: boolean, businessCenterId?: string) {
  const qs = businessCenterId ? `?businessCenterId=${encodeURIComponent(businessCenterId)}` : ''
  return useSWR<AdsAccountsResponse>(connected ? `/api/ads/accounts${qs}` : null, fetcher, {
    revalidateOnFocus: true,
    keepPreviousData: true,
  })
}

// Progresso do job de bulk/duplicação — polling curto que PARA sozinho
// quando o job termina (refreshInterval devolve 0).
export function useAdsBulkJob(jobId: string | null) {
  return useSWR<AdsBulkJob>(jobId ? `/api/ads/bulk/${encodeURIComponent(jobId)}` : null, fetcher, {
    refreshInterval: (data) => (data && data.status === 'done' ? 0 : 2_500),
    revalidateOnFocus: true,
    keepPreviousData: true,
  })
}

// Árvore campanha → ad group → ad. A chave inclui os filtros; `active` = false
// suspende o hook (aba desconectada). Métricas do TikTok mudam devagar → 60s.
// limit=100 sempre: o default antigo (20) escondia campanhas de contas grandes.
export function useAdsTree(
  active: boolean,
  filters: { adAccountId?: string; status?: string; fromDate?: string; toDate?: string; sort?: string; page?: number },
) {
  const params = new URLSearchParams()
  if (filters.adAccountId) params.set('adAccountId', filters.adAccountId)
  if (filters.status) params.set('status', filters.status)
  if (filters.fromDate) params.set('fromDate', filters.fromDate)
  if (filters.toDate) params.set('toDate', filters.toDate)
  if (filters.sort) params.set('sort', filters.sort)
  if (filters.page && filters.page > 1) params.set('page', String(filters.page))
  params.set('limit', '100')
  params.set('daily', '1') // sparkline de tendência por campanha
  const qs = params.toString()
  return useSWR<AdsTreeResponse>(active ? `/api/ads/tree${qs ? `?${qs}` : ''}` : null, fetcher, {
    refreshInterval: 60_000,
    revalidateOnFocus: true,
    keepPreviousData: true,
  })
}

// Analytics de uma campanha (drawer de detalhe). id nulo = hook inativo.
export function useAdsCampaignAnalytics(id: string | null, range?: { fromDate?: string; toDate?: string }) {
  const params = new URLSearchParams()
  if (range?.fromDate) params.set('fromDate', range.fromDate)
  if (range?.toDate) params.set('toDate', range.toDate)
  const qs = params.toString()
  return useSWR<AdsCampaignAnalyticsResponse>(
    id ? `/api/ads/campaigns/${encodeURIComponent(id)}/analytics${qs ? `?${qs}` : ''}` : null,
    fetcher,
    { refreshInterval: 60_000, keepPreviousData: true },
  )
}

// ROAS/CPA — gasto do TikTok cruzado com as vendas reais dos gateways.
export function useAdsRoas(active: boolean, range?: { fromDate?: string; toDate?: string }) {
  const params = new URLSearchParams()
  if (range?.fromDate) params.set('fromDate', range.fromDate)
  if (range?.toDate) params.set('toDate', range.toDate)
  const qs = params.toString()
  return useSWR<AdsRoasResponse>(active ? `/api/ads/roas${qs ? `?${qs}` : ''}` : null, fetcher, {
    refreshInterval: 60_000,
    keepPreviousData: true,
  })
}

// Biblioteca de criativos — vídeos já enviados ao Blob desta conta.
export function useAdsLibrary(active: boolean) {
  return useSWR<AdsLibraryResponse>(active ? '/api/ads/library' : null, fetcher, {
    revalidateOnFocus: false,
  })
}

// Config de alertas de performance da conta.
export function useAdsAlerts(active: boolean) {
  return useSWR<AdsAlertsConfig>(active ? '/api/ads/alerts' : null, fetcher, {
    revalidateOnFocus: false,
  })
}

// Atribuição por campanha — vendas reais casadas com o platformCampaignId
// (via macro utm_campaign=__CAMPAIGN_ID__ que o TikTok substitui na entrega).
export function useAdsAttribution(active: boolean, range?: { fromDate?: string; toDate?: string }) {
  const params = new URLSearchParams()
  if (range?.fromDate) params.set('fromDate', range.fromDate)
  if (range?.toDate) params.set('toDate', range.toDate)
  const qs = params.toString()
  return useSWR<AdsAttributionResponse>(
    active ? `/api/ads/attribution${qs ? `?${qs}` : ''}` : null,
    fetcher,
    { refreshInterval: 60_000, keepPreviousData: true },
  )
}

// Regras automáticas de otimização (config + histórico de execuções).
export function useAdsRules(active: boolean) {
  return useSWR<AdsRulesResponse>(active ? '/api/ads/rules' : null, fetcher, {
    revalidateOnFocus: false,
  })
}

// Templates de campanha salvos da conta.
export function useAdsTemplates(active: boolean) {
  return useSWR<AdsTemplatesResponse>(active ? '/api/ads/templates' : null, fetcher, {
    revalidateOnFocus: false,
  })
}

// Upload de criativo (vídeo/imagem) → Vercel Blob. Binário puro no corpo,
// metadados na querystring (o Express usa express.raw nesta rota).
export async function adsUpload(file: File, kind: 'video' | 'image'): Promise<{ ok: boolean; url: string }> {
  const qs = new URLSearchParams({ kind, filename: file.name }).toString()
  const res = await fetch(`/api/ads/upload?${qs}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: file,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (res.status === 401) handleUnauthorized()
    throw parseApiError(res.status, data)
  }
  return data as { ok: boolean; url: string }
}

// ── Mutações — POST/DELETE com o mesmo contrato de erro do Express ──
export async function apiSend<T = unknown>(
  path: string,
  method: 'POST' | 'DELETE' | 'PUT' | 'PATCH',
  body?: unknown,
): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'include',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (res.status === 401) handleUnauthorized()
    throw parseApiError(res.status, data)
  }
  return data as T
}
