'use client'

import { useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { ExternalLink, MoreHorizontal, RefreshCw, Unplug } from 'lucide-react'
import { fetcher } from '@/lib/api'
import { toast } from '@/lib/toast'
import type { AdsAdvertiser, AdsSyncAdvertiserState } from '@/lib/types'
import { timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'

const STATUS_SUFFIX: Record<string, string> = {
  approved: '',
  banned: ' — BANIDA',
  limited: ' — limitada',
  in_review: ' — em revisão',
  unknown: '',
}

function syncPresentation(syncState: AdsSyncAdvertiserState | undefined, refreshing: boolean) {
  if (refreshing || syncState?.status === 'syncing') {
    return { label: 'Sincronizando…', tone: 'text-muted-foreground', title: 'Atualizando os dados desta conta.' }
  }
  if (!syncState) return { label: 'Status da sincronização indisponível', tone: 'text-muted-foreground', title: undefined }
  if (syncState.status === 'ok') {
    return {
      label: syncState.lastSyncedAt ? `Atualizado ${timeAgo(syncState.lastSyncedAt)}` : 'Sincronização concluída',
      tone: 'text-success',
      title: syncState.lastSyncedAt ? `Última sincronização: ${syncState.lastSyncedAt}` : undefined,
    }
  }
  if (syncState.status === 'never') return { label: 'Aguardando primeira sincronização', tone: 'text-warning', title: syncState.lastError || undefined }
  if (syncState.status === 'error') return { label: 'Falha na última sincronização', tone: 'text-error', title: syncState.lastError || undefined }
  if (syncState.status === 'blocked') return { label: 'Sincronização bloqueada', tone: 'text-error', title: syncState.lastError || undefined }
  if (syncState.status === 'unauthorized') return { label: 'Sincronização sem autorização', tone: 'text-error', title: syncState.lastError || undefined }
  return { label: `Sincronização · ${syncState.status}`, tone: 'text-muted-foreground', title: syncState.lastError || undefined }
}

/** Conta do TikTok. O período vem exclusivamente do calendário global. */
export function AdsContextBar({
  advertisers,
  selectedAdvertiser,
  refreshing,
  syncState,
  onAdvertiserChangeRequested,
  switching = false,
  onRefresh,
  onDisconnect,
}: {
  advertisers: AdsAdvertiser[]
  selectedAdvertiser: string
  refreshing: boolean
  syncState?: AdsSyncAdvertiserState
  onAdvertiserChangeRequested: (id: string) => void | Promise<void>
  switching?: boolean
  onRefresh: () => void
  onDisconnect: (() => void) | null
}) {
  const [switchingAdvertiser, setSwitchingAdvertiser] = useState(false)
  const sync = syncPresentation(syncState, refreshing)

  async function handleSelectAdvertiser(id: string) {
    if (!id || switchingAdvertiser || switching || id === selectedAdvertiser) return
    setSwitchingAdvertiser(true)
    try {
      await onAdvertiserChangeRequested(id)
    } finally {
      setSwitchingAdvertiser(false)
    }
  }

  async function openCreateAccount() {
    try {
      const data = await fetcher<{ url: string }>('/api/ads/deeplink/create-account')
      window.open(data.url, '_blank', 'noopener,noreferrer')
    } catch (e) {
      toast.error('Falha ao abrir o TikTok Business Center', { hint: e instanceof Error ? e.message : undefined })
    }
  }

  return (
    <div role="toolbar" aria-label="Conta do TikTok Ads" data-tour="ads-context" className="ads-account-context flex flex-col gap-2 border-b border-border/60 pb-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 flex-1">
        <label htmlFor="ads-account-select" className="mb-1.5 block text-xs font-medium text-muted-foreground">Conta de anúncios</label>
        <select
          id="ads-account-select"
          className="h-10 w-full min-w-0 max-w-xl truncate rounded-lg border border-border/70 bg-background px-3 text-sm font-medium text-foreground transition-colors hover:border-border focus:border-primary/60 focus:outline-none focus:ring-1 focus:ring-primary/30"
          value={selectedAdvertiser}
          disabled={switchingAdvertiser || switching || advertisers.length === 0}
          onChange={(e) => handleSelectAdvertiser(e.target.value)}
          aria-label="Selecionar conta de anúncio"
        >
          {!selectedAdvertiser && <option value="">Selecione uma conta…</option>}
          {advertisers.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name || a.id}{a.currency ? ` · ${a.currency}` : ''}{STATUS_SUFFIX[a.healthStatus ?? 'unknown']}
            </option>
          ))}
        </select>
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">
        {selectedAdvertiser ? (
          <span className={cn('min-w-0 truncate text-xs font-medium', sync.tone)} title={sync.title}>
            {sync.label}
          </span>
        ) : null}
        <button
          type="button"
          className="inline-flex size-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          onClick={onRefresh}
          disabled={refreshing || !selectedAdvertiser}
          aria-label="Atualizar dados do TikTok"
          title="Atualizar dados do TikTok"
        >
          <RefreshCw className={`size-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
        </button>

        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              className="inline-flex size-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Mais ações da conta"
              title="Mais ações da conta"
            >
              <MoreHorizontal className="size-4" aria-hidden="true" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" sideOffset={6} className="z-50 min-w-52 rounded-lg border border-border bg-background p-1.5 shadow-lg">
              <DropdownMenu.Item className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2.5 text-sm text-foreground outline-none data-[highlighted]:bg-secondary" onSelect={openCreateAccount}>
                <ExternalLink className="size-4" aria-hidden="true" />Criar conta no TikTok
              </DropdownMenu.Item>
              {onDisconnect ? <DropdownMenu.Item className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2.5 text-sm text-error outline-none data-[highlighted]:bg-error/10" onSelect={onDisconnect}>
                <Unplug className="size-4" aria-hidden="true" />Desconectar
              </DropdownMenu.Item> : null}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </div>
  )
}
