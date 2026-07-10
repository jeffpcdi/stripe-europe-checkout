'use client'

import useSWR from 'swr'
import type {
  StatsResponse,
  HealthResponse,
  LiveResponse,
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
  Account,
  PushcutConfig,
  AccountSettings,
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

export function useLinks() {
  return useSWR<LinksResponse>('/api/links', fetcher, {
    revalidateOnFocus: true,
    keepPreviousData: true,
  })
}

export function useDomains() {
  return useSWR<DomainsResponse>('/api/domains', fetcher, {
    revalidateOnFocus: true,
    keepPreviousData: true,
  })
}

export function usePixels() {
  return useSWR<PixelsResponse>('/api/pixels', fetcher, {
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
    revalidateOnFocus: true,
    keepPreviousData: true,
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

// ── Mutações — POST/DELETE com o mesmo contrato de erro do Express ──
export async function apiSend<T = unknown>(
  path: string,
  method: 'POST' | 'DELETE' | 'PUT',
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
