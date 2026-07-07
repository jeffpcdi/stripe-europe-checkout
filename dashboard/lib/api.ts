'use client'

import useSWR from 'swr'
import type { StatsResponse, HealthResponse, LiveResponse } from './types'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function fetcher<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: 'include' })
  if (!res.ok) {
    throw new ApiError(res.status, `Falha na API (${res.status})`)
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
