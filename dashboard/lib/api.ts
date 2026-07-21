'use client'

import useSWR from 'swr'
import type {
  StatsResponse,
  OverviewHealthResponse,
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
  QuarantineResponse,
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
  AdsBulkJob,
  AdsTreeResponse,
  AdsCampaignAnalyticsResponse,
  AdsRoasResponse,
  AdsLibraryResponse,
  AdsAlertsConfig,
  AdsAttributionResponse,
  AdsRulesResponse,
  AdsProposalsResponse,
  AdsTemplatesResponse,
  AdsOpsJobsResponse,
  AdsSafetyPolicyResponse,
  AdsHealthResponse,
  AdsCatalogsResponse,
  AdsCatalogDetailResponse,
  AdsCatalogSpecResponse,
  AdsCatalogBusinessCenter,
  AdsCatalogBatchPreviewResponse,
  AdsCatalogBatchExecutionResponse,
  AdsSmartPlusResponse,
  AdsSmartPlusAdsResponse,
  AdsMcpStatusResponse,
  AdsKpisResponse,
  AdsBriefingResponse,
  AdsCreativeInsights,
  AdsBudgetProposal,
  CopilotEvent,
} from './types'

// Item 181: contrato unificado de erro da API — { ok:false, error, code, hint }.
// `hint` traz a orientação pt-BR do que fazer; `code` é estável para lógica.
// Rotas ainda não migradas simplesmente não trazem code/hint (retrocompatível).
export class ApiError extends Error {
  status: number
  code?: string
  hint?: string
  stage?: string
  retryable?: boolean
  providerRequestId?: string
  createdIds?: Record<string, string>
  constructor(status: number, message: string, opts?: { code?: string; hint?: string; stage?: string; retryable?: boolean; providerRequestId?: string; createdIds?: Record<string, string> }) {
    super(message)
    this.status = status
    this.code = opts?.code
    this.hint = opts?.hint
    this.stage = opts?.stage
    this.retryable = opts?.retryable
    this.providerRequestId = opts?.providerRequestId
    this.createdIds = opts?.createdIds
  }
  // Mensagem pronta para exibir: prioriza a orientação (hint) quando existe.
  get display(): string {
    return this.hint ? `${this.message} ${this.hint}`.trim() : this.message
  }
}

// Extrai { error, code, hint } de um corpo de resposta em qualquer formato.
// Quando o corpo NÃO é o JSON do nosso app (ex.: 502/504 de borda do Railway por
// timeout/crash), `d.error` vem vazio — em vez de um "Falha na API (502)" cru,
// damos uma mensagem e um hint acionáveis por status.
function parseApiError(status: number, data: unknown): ApiError {
  const d = (data ?? {}) as { error?: string; message?: string; userMessage?: string; code?: string; hint?: string; suggestedAction?: string; step?: string; stage?: string; retryable?: boolean; providerRequestId?: string; createdIds?: Record<string, string> }
  const bodyMsg = d.userMessage || d.error || d.message || ''
  let hint = d.suggestedAction || d.hint
  let msg = bodyMsg
  if (!msg) {
    if (status === 502 || status === 503 || status === 504) {
      msg = 'O servidor ou o TikTok demorou a responder'
      hint = hint || 'Tente de novo em instantes. Se persistir, use "Baixar CSV" e suba o catálogo manualmente.'
    } else if (status >= 500) {
      msg = 'Erro no servidor'
      hint = hint || 'Tente de novo; se continuar, reporte o horário para investigarmos.'
    } else {
      msg = `Falha na requisição (${status})`
    }
  }
  return new ApiError(status, msg, {
    code: d.code, hint, stage: d.stage || d.step, retryable: d.retryable,
    providerRequestId: d.providerRequestId, createdIds: d.createdIds,
  })
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

export function useOverviewHealth(active = true) {
  return useSWR<OverviewHealthResponse>(active ? '/api/overview/health' : null, fetcher, {
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

// Tendência de EMQ muda no máximo 1x/dia — sem polling agressivo.
// Fase 4: `active` permite adiar o fetch (chave null = SWR não dispara). No
// overview a Saúde só busca EMQ pós-first-paint — não conta no orçamento de
// requests simultâneas do carregamento inicial (padrão useLead/useCloakDecisions).
export function useEmqTrend(active = true) {
  return useSWR<EmqTrendResponse>(active ? '/api/pixels/emq-trend' : null, fetcher, {
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

// Quarentena de webhooks rejeitados (payload cru preservado). Poll no ritmo
// do stats para o badge acompanhar novas rejeições com o painel aberto.
export function useQuarantine() {
  return useSWR<QuarantineResponse>('/api/conversion/quarantine', fetcher, {
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
// TikTok Ads (via Pipeboard) — /api/ads/*
// ─────────────────────────────────────────────────────────────────────────────

// Estado da integração (conectado? advertiser? identity?). Sem polling — a
// view revalida via mutate() após conectar/desconectar.
// Fase 4: `active` permite adiar o fetch (chave null = SWR não dispara). No
// overview o card de Ads só resolve o status pós-first-paint.
export function useAdsStatus(active = true) {
  return useSWR<AdsStatusResponse>(active ? '/api/ads/status' : null, fetcher, {
    revalidateOnFocus: true,
    keepPreviousData: true,
  })
}

// Advertisers do token — só busca depois de conectado (connected = true).
// Pipeboard não tem Business Centers: as contas vêm direto do token.
export function useAdsAccounts(connected: boolean) {
  return useSWR<AdsAccountsResponse>(connected ? '/api/ads/accounts' : null, fetcher, {
    revalidateOnFocus: true,
    // Nunca reutiliza a lista/seleção anterior durante a troca de conta.
    keepPreviousData: false,
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
  // Cada polling automático pede uma leitura fresca ao backend. Sem isso, o
  // intervalo de 60s ainda podia receber o snapshot antigo do cache local.
  params.set('fresh', '1')
  const qs = params.toString()
  return useSWR<AdsTreeResponse>(active ? `/api/ads/tree${qs ? `?${qs}` : ''}` : null, fetcher, {
    // Status de campanha é operacional: 15s visível; 5s durante backfill.
    refreshInterval: (data) => (data?.backfillPending ? 5_000 : 15_000),
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    refreshWhenHidden: false,
    // Continua tentando após falhas transitórias do backend, sem congelar a UI.
    shouldRetryOnError: true,
    errorRetryInterval: 10_000,
    errorRetryCount: 6,
    // Não exibe campanhas da conta/página anterior enquanto a nova chave carrega:
    // isso evitaria ações acidentais sobre dados fora do contexto selecionado.
    keepPreviousData: false,
  })
}

// Analytics de uma campanha (drawer de detalhe). id nulo = hook inativo.
export function useAdsCampaignAnalytics(
  id: string | null,
  adAccountId: string,
  range?: { fromDate?: string; toDate?: string },
) {
  const params = new URLSearchParams()
  if (adAccountId) params.set('adAccountId', adAccountId)
  if (range?.fromDate) params.set('fromDate', range.fromDate)
  if (range?.toDate) params.set('toDate', range.toDate)
  const qs = params.toString()
  return useSWR<AdsCampaignAnalyticsResponse>(
    id && adAccountId ? `/api/ads/campaigns/${encodeURIComponent(id)}/analytics?${qs}` : null,
    fetcher,
    { refreshInterval: 60_000, keepPreviousData: false },
  )
}

// ROAS/CPA — gasto do TikTok cruzado com as vendas reais dos gateways.
export function useAdsRoas(active: boolean, adAccountId: string, range?: { fromDate?: string; toDate?: string }) {
  const params = new URLSearchParams()
  if (adAccountId) params.set('adAccountId', adAccountId)
  if (range?.fromDate) params.set('fromDate', range.fromDate)
  if (range?.toDate) params.set('toDate', range.toDate)
  const qs = params.toString()
  return useSWR<AdsRoasResponse>(active && adAccountId ? `/api/ads/roas?${qs}` : null, fetcher, {
    refreshInterval: 60_000,
    keepPreviousData: false,
  })
}

// Biblioteca de criativos — vídeos já enviados ao Blob desta conta.
export function useAdsLibrary(active: boolean) {
  return useSWR<AdsLibraryResponse>(active ? '/api/ads/library' : null, fetcher, {
    revalidateOnFocus: false,
  })
}

// Config de alertas de performance da conta.
export function useAdsAlerts(active: boolean, adAccountId = '') {
  const key = active && adAccountId ? `/api/ads/alerts?adAccountId=${encodeURIComponent(adAccountId)}` : null
  return useSWR<AdsAlertsConfig>(key, fetcher, {
    revalidateOnFocus: false,
  })
}

// Atribuição por campanha — vendas reais casadas com o platformCampaignId
// (via macro utm_campaign=__CAMPAIGN_ID__ que o TikTok substitui na entrega).
export function useAdsAttribution(
  active: boolean,
  adAccountId: string,
  range?: { fromDate?: string; toDate?: string },
) {
  const params = new URLSearchParams()
  if (adAccountId) params.set('adAccountId', adAccountId)
  if (range?.fromDate) params.set('fromDate', range.fromDate)
  if (range?.toDate) params.set('toDate', range.toDate)
  const qs = params.toString()
  return useSWR<AdsAttributionResponse>(
    active && adAccountId ? `/api/ads/attribution?${qs}` : null,
    fetcher,
    { refreshInterval: 60_000, keepPreviousData: false },
  )
}

// Regras automáticas de otimização (config + histórico de execuções).
export function useAdsRules(active: boolean, adAccountId = '') {
  const key = active && adAccountId ? `/api/ads/rules?adAccountId=${encodeURIComponent(adAccountId)}` : null
  return useSWR<AdsRulesResponse>(key, fetcher, {
    revalidateOnFocus: false,
  })
}

// F4: propostas pendentes do motor (modo proposta). Chave null enquanto
// inactive — na home só resolve pós-first-paint E com Ads conectado, para
// não entrar no orçamento de requests do load de quem não usa Ads.
export function useAdsProposals(active: boolean, status: 'pending' | '' = 'pending', adAccountId = '') {
  const params = new URLSearchParams()
  if (status) params.set('status', status)
  if (adAccountId) params.set('adAccountId', adAccountId)
  return useSWR<AdsProposalsResponse>(active ? `/api/ads/proposals?${params.toString()}` : null, fetcher, {
    refreshInterval: 60_000,
    revalidateOnFocus: false,
    keepPreviousData: false,
  })
}

// Diagnóstico da conexão MCP Pipeboard (conexão, tools, chamadas/erros 1h,
// contas bloqueadas, estado do motor de automações). O backend cacheia o
// ping por 5min — o refresh de 60s aqui não gera chamadas reais extras.
export function useAdsMcpStatus(active: boolean, adAccountId = '') {
  const key = active ? `/api/ads/mcp/status${adAccountId ? `?adAccountId=${encodeURIComponent(adAccountId)}` : ''}` : null
  return useSWR<AdsMcpStatusResponse>(key, fetcher, {
    refreshInterval: 60_000,
    revalidateOnFocus: false,
    keepPreviousData: false,
  })
}

// ── IA: briefing, criativos, realocação, copiloto ────────────────────────────

// Briefing diário (gerado 1×/dia pelo servidor; histórico 7d). Sem polling —
// muda 1×/dia; o botão "Gerar agora" revalida via mutate().
export function useAdsBriefing(active: boolean, adAccountId: string) {
  const key = active && adAccountId ? `/api/ads/briefing?adAccountId=${encodeURIComponent(adAccountId)}` : null
  return useSWR<AdsBriefingResponse>(key, fetcher, {
    revalidateOnFocus: false,
    keepPreviousData: false,
  })
}

// Análise de criativos com IA (cache 24h no servidor). Condicional: só busca
// com o painel aberto. 503 = IA não configurada (a UI esconde o recurso).
export function useAdsCreativeInsights(active: boolean, adAccountId: string) {
  const qs = adAccountId ? `?adAccountId=${encodeURIComponent(adAccountId)}` : ''
  return useSWR<AdsCreativeInsights>(
    active && adAccountId ? `/api/ads/creatives/insights${qs}` : null,
    fetcher,
    { revalidateOnFocus: false, keepPreviousData: false, shouldRetryOnError: false },
  )
}

// Proposta de realocação de orçamento (determinística; IA só justifica).
export function useAdsBudgetProposal(active: boolean, adAccountId: string, currency: string, days = 1) {
  const params = new URLSearchParams()
  if (adAccountId) params.set('adAccountId', adAccountId)
  if (currency) params.set('currency', currency)
  if (days !== 1) params.set('days', String(days))
  return useSWR<AdsBudgetProposal>(
    active && adAccountId ? `/api/ads/budget/proposal?${params.toString()}` : null,
    fetcher,
    { revalidateOnFocus: false, keepPreviousData: false, shouldRetryOnError: false },
  )
}

// Chat do copiloto — POST + parse do SSE manualmente (fetch streaming).
// onEvent recebe cada evento na ordem; a promise resolve no fim do stream.
export async function copilotSend(
  body: { message: string; sessionId: string; adAccountId?: string; currency?: string },
  onEvent: (ev: CopilotEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch('/api/ads/copilot', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok || !res.body) {
    if (res.status === 401) handleUnauthorized()
    const data = await res.json().catch(() => ({}))
    throw parseApiError(res.status, data)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    // eventos SSE separados por linha em branco; cada um é "data: {json}"
    const chunks = buffer.split('\n\n')
    buffer = chunks.pop() || ''
    for (const chunk of chunks) {
      const line = chunk.split('\n').find((l) => l.startsWith('data: '))
      if (!line) continue
      try {
        onEvent(JSON.parse(line.slice(6)) as CopilotEvent)
      } catch {
        // evento malformado — ignora e segue o stream
      }
    }
  }
}

// KPIs agregados do advertiser com delta vs. período anterior (espelho Neon).
export function useAdsKpis(
  active: boolean,
  adAccountId: string,
  range?: { fromDate?: string; toDate?: string },
) {
  const params = new URLSearchParams()
  if (adAccountId) params.set('adAccountId', adAccountId)
  if (range?.fromDate) params.set('fromDate', range.fromDate)
  if (range?.toDate) params.set('toDate', range.toDate)
  return useSWR<AdsKpisResponse>(
    active && adAccountId ? `/api/ads/kpis?${params.toString()}` : null,
    fetcher,
    { revalidateOnFocus: false, keepPreviousData: false },
  )
}

// Templates de campanha salvos da conta.
export function useAdsTemplates(active: boolean, adAccountId: string) {
  const key = active && adAccountId ? `/api/ads/templates?adAccountId=${encodeURIComponent(adAccountId)}` : null
  return useSWR<AdsTemplatesResponse>(key, fetcher, {
    revalidateOnFocus: false,
    keepPreviousData: false,
  })
}

// Jobs duráveis (bulk/duplicação) persistidos no Neon — histórico com
// progresso e erros por job. Poll no ritmo padrão só com o painel aberto.
export function useAdsOpsJobs(active: boolean, adAccountId: string) {
  const key = active && adAccountId ? `/api/ads/ops/jobs?adAccountId=${encodeURIComponent(adAccountId)}` : null
  return useSWR<AdsOpsJobsResponse>(key, fetcher, {
    refreshInterval: POLL_MS,
    revalidateOnFocus: true,
    keepPreviousData: false,
  })
}

// Estado do espelho Pipeboard -> Neon para a conta atualmente selecionada.
// Fica separado da arvore para o operador enxergar atraso/erro mesmo quando o
// ultimo snapshot ainda pode ser exibido normalmente.
export function useAdsSyncStatus(active: boolean, adAccountId: string) {
  const key = active && adAccountId ? `/api/ads/sync-status?adAccountId=${encodeURIComponent(adAccountId)}` : null
  return useSWR<import('./types').AdsSyncStatusResponse>(key, fetcher, {
    refreshInterval: 15_000,
    revalidateOnFocus: true,
    keepPreviousData: false,
  })
}

// Saúde das contas de anúncio + tickets de desbanimento. O GET já roda a
// varredura no backend (dados frescos) — poll no ritmo padrão alimenta o
// badge "conta banida" do cabeçalho mesmo com o diálogo fechado.
export function useAdsHealth(active: boolean) {
  return useSWR<AdsHealthResponse>(active ? '/api/ads/health' : null, fetcher, {
    refreshInterval: POLL_MS,
    revalidateOnFocus: true,
    keepPreviousData: true,
  })
}

// Política de segurança da conta (dry-run, kill switch, tetos). Ativa na
// view inteira: alimenta o badge "modo simulação" e o editor.
export function useAdsSafetyPolicy(active: boolean) {
  return useSWR<AdsSafetyPolicyResponse>(active ? '/api/ads/ops/safety-policy' : null, fetcher, {
    revalidateOnFocus: true,
    keepPreviousData: true,
  })
}

export function useAdsWorkspace(active: boolean, advertiserId: string) {
  return useSWR<import('./types').AdsWorkspaceResponse>(
    active && advertiserId ? `/api/ads/workspace?advertiserId=${encodeURIComponent(advertiserId)}` : null,
    fetcher,
    { revalidateOnFocus: false, keepPreviousData: false },
  )
}

export function useAdsAudit(active: boolean) {
  return useSWR<import('./types').AdsAuditResponse>(active ? '/api/ads/ops/audit?limit=40' : null, fetcher, {
    refreshInterval: 60_000,
    revalidateOnFocus: true,
  })
}

export function useAdsReports(active: boolean, advertiserId: string) {
  return useSWR<import('./types').AdsReportsResponse>(
    active && advertiserId ? `/api/ads/reports?advertiserId=${encodeURIComponent(advertiserId)}` : null,
    fetcher,
    { revalidateOnFocus: false },
  )
}

// ── Smart+ (campanhas automatizadas do TikTok) ──
export function useAdsSmartPlus(active: boolean, adAccountId: string) {
  const key = active && adAccountId ? `/api/ads/smart-plus?adAccountId=${encodeURIComponent(adAccountId)}` : null
  return useSWR<AdsSmartPlusResponse>(key, fetcher, { revalidateOnFocus: true, keepPreviousData: false })
}

export function useAdsSmartPlusAds(active: boolean, adAccountId: string) {
  const key = active && adAccountId ? `/api/ads/smart-plus/ads?adAccountId=${encodeURIComponent(adAccountId)}` : null
  return useSWR<AdsSmartPlusAdsResponse>(key, fetcher, { revalidateOnFocus: true, keepPreviousData: false })
}

// ── Catálogos de produtos (TikTok Shopping/Catalog) ──
// Toda URL carrega o advertiser selecionado explicitamente. O backend valida
// esse valor no Pipeboard e combina conta+advertiser antes de tocar catálogo,
// produto ou feed.
export function adsCatalogApiUrl(path: string, adAccountId: string) {
  const separator = path.includes('?') ? '&' : '?'
  return `${path}${separator}adAccountId=${encodeURIComponent(adAccountId)}`
}

// Lista de catálogos do advertiser. `active` suspende quando a aba está fechada.
export function useAdsCatalogs(active: boolean, adAccountId: string) {
  return useSWR<AdsCatalogsResponse>(
    active && adAccountId ? adsCatalogApiUrl('/api/ads/catalogs', adAccountId) : null,
    fetcher,
    {
      revalidateOnFocus: true,
      // Nunca mantenha a lista do advertiser anterior visível durante a troca.
      keepPreviousData: false,
    },
  )
}

// Detalhe de um catálogo (metadados + produtos). null = suspende.
export function useAdsCatalogDetail(catalogId: string | null, adAccountId: string) {
  return useSWR<AdsCatalogDetailResponse>(
    catalogId && adAccountId
      ? adsCatalogApiUrl(`/api/ads/catalogs/${encodeURIComponent(catalogId)}`, adAccountId)
      : null,
    fetcher,
    { revalidateOnFocus: true, keepPreviousData: false },
  )
}

export function useAdsCatalogPublications(catalogId: string | null, adAccountId: string) {
  return useSWR<{ publications: import('./types').AdsCatalogPublication[] }>(
    catalogId && adAccountId ? adsCatalogApiUrl(`/api/ads/catalogs/${encodeURIComponent(catalogId)}/publications`, adAccountId) : null,
    fetcher,
    { revalidateOnFocus: true, keepPreviousData: false },
  )
}

export function useAdsCatalogReadiness(catalogId: string | null, adAccountId: string) {
  return useSWR<{ readiness: import('./types').AdsCatalogReadiness }>(
    catalogId && adAccountId ? adsCatalogApiUrl(`/api/ads/catalogs/${encodeURIComponent(catalogId)}/readiness`, adAccountId) : null,
    fetcher,
    { revalidateOnFocus: true, keepPreviousData: false },
  )
}

export function useAdsCatalogCapabilities(active: boolean, adAccountId: string) {
  return useSWR<{ capabilities: Record<string, boolean | string> }>(
    active && adAccountId ? adsCatalogApiUrl('/api/ads/catalogs/capabilities', adAccountId) : null,
    fetcher,
    { revalidateOnFocus: false, revalidateIfStale: false },
  )
}

export function useAdsCatalogSyncRuns(catalogId: string | null, adAccountId: string) {
  return useSWR<{ runs: import('./types').AdsCatalogSyncRun[] }>(
    catalogId && adAccountId ? adsCatalogApiUrl(`/api/ads/catalogs/${encodeURIComponent(catalogId)}/sync-runs`, adAccountId) : null,
    fetcher,
    {
      refreshInterval: (latest) => latest?.runs.some((run) => ['queued', 'waiting_connector_confirmation', 'running', 'retrying'].includes(run.status)) ? 4000 : 0,
      revalidateOnFocus: true, keepPreviousData: false,
    },
  )
}

export function useAdsCatalogCampaignRuns(catalogId: string | null, adAccountId: string) {
  return useSWR<{ runs: import('./types').AdsCatalogCampaignRun[] }>(
    catalogId && adAccountId ? adsCatalogApiUrl(`/api/ads/catalogs/${encodeURIComponent(catalogId)}/campaign-runs`, adAccountId) : null,
    fetcher,
    {
      refreshInterval: (latest) => latest?.runs.some((run) => ['queued', 'waiting_connector_confirmation', 'waiting_catalog_review', 'running', 'retrying'].includes(run.status)) ? 4000 : 0,
      revalidateOnFocus: true, keepPreviousData: false,
    },
  )
}

// Spec das colunas/campos — estável; carrega uma vez enquanto o dialog abre.
export function useAdsCatalogSpec(active: boolean, adAccountId: string) {
  return useSWR<AdsCatalogSpecResponse>(
    active && adAccountId ? adsCatalogApiUrl('/api/ads/catalogs/spec', adAccountId) : null,
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateIfStale: false,
    },
  )
}

// Business Center usado para publicar catálogos no TikTok (persistido por conta).
export function useAdsCatalogBusinessCenter(active: boolean, adAccountId: string) {
  return useSWR<AdsCatalogBusinessCenter>(active && adAccountId ? adsCatalogApiUrl('/api/ads/catalogs/business-center', adAccountId) : null, fetcher, {
    revalidateOnFocus: false,
  })
}

// Categorias de interesse para o direcionamento na criação (cacheadas no server).
// Só busca com o passo Público aberto; a lista é grande e estável.
export function useAdsInterests(active: boolean, adAccountId: string) {
  const qs = adAccountId ? `?adAccountId=${encodeURIComponent(adAccountId)}` : ''
  return useSWR<{ interests: { id: string; name: string }[] }>(
    active && adAccountId ? `/api/ads/targeting/interests${qs}` : null,
    fetcher,
    { revalidateOnFocus: false, revalidateIfStale: false, shouldRetryOnError: false, keepPreviousData: false },
  )
}

// Lança a campanha de catálogo (DPA) a partir de um catálogo já sincronizado.
export async function adsCreateCatalogCampaign(
  catalogId: string,
  adAccountId: string,
  body: Record<string, unknown>,
): Promise<import('./types').AdsCatalogCampaignResponse> {
  return apiSend<import('./types').AdsCatalogCampaignResponse>(
    adsCatalogApiUrl(`/api/ads/catalogs/${encodeURIComponent(catalogId)}/campaign`, adAccountId),
    'POST',
    body,
  )
}

export async function adsPreflightCatalogCampaign(
  catalogId: string,
  adAccountId: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; readiness: import('./types').AdsCatalogReadiness; spec: Record<string, unknown>; capabilities: Record<string, boolean | string> }> {
  return apiSend(
    adsCatalogApiUrl(`/api/ads/catalogs/${encodeURIComponent(catalogId)}/campaign-preflight`, adAccountId),
    'POST',
    body,
  )
}

// Lote rápido: primeiro valida o plano e depois grava/enfileira tudo com a
// mesma chave de idempotência. Nenhum campo de URL do anúncio existe neste
// contrato; o destino vem do `link` de cada produto.
export async function adsPreviewCatalogBatch(
  adAccountId: string,
  body: Record<string, unknown>,
): Promise<AdsCatalogBatchPreviewResponse> {
  return apiSend<AdsCatalogBatchPreviewResponse>(
    adsCatalogApiUrl('/api/ads/catalogs/batch/preview', adAccountId),
    'POST',
    body,
  )
}

export async function adsCreateCatalogBatch(
  adAccountId: string,
  body: Record<string, unknown>,
): Promise<AdsCatalogBatchExecutionResponse> {
  return apiSend<AdsCatalogBatchExecutionResponse>(
    adsCatalogApiUrl('/api/ads/catalogs/batch', adAccountId),
    'POST',
    body,
  )
}

// Importa um CSV (texto cru) para um catálogo. Devolve o resumo da importação.
export async function adsCatalogImportCsv(catalogId: string, adAccountId: string, csv: string) {
  const res = await fetch(
    adsCatalogApiUrl(`/api/ads/catalogs/${encodeURIComponent(catalogId)}/import`, adAccountId),
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'text/csv' },
      body: csv,
    },
  )
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (res.status === 401) handleUnauthorized()
    throw parseApiError(res.status, data)
  }
  return data as { summary: import('./types').AdsCatalogImportSummary }
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
