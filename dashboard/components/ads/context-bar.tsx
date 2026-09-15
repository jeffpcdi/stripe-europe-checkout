'use client'

import { useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Building2, ExternalLink, MoreHorizontal, RefreshCw, Unplug } from 'lucide-react'
import { apiSend, fetcher } from '@/lib/api'
import { toast } from '@/lib/toast'
import type { AdsAdvertiser } from '@/lib/types'

const STATUS_SUFFIX: Record<string, string> = {
  approved: '',
  banned: ' — BANIDA',
  limited: ' — limitada',
  in_review: ' — em revisão',
  unknown: '',
}

/** Conta do TikTok. O período vem exclusivamente do calendário global. */
export function AdsContextBar({
  advertisers,
  selectedAdvertiser,
  refreshing,
  onAdvertiserChanged,
  onRefresh,
  onDisconnect,
}: {
  advertisers: AdsAdvertiser[]
  selectedAdvertiser: string
  refreshing: boolean
  onAdvertiserChanged: (id: string) => void
  onRefresh: () => void
  onDisconnect: (() => void) | null
}) {
  const [switchingAdvertiser, setSwitchingAdvertiser] = useState(false)

  async function handleSelectAdvertiser(id: string) {
    if (!id || switchingAdvertiser) return
    setSwitchingAdvertiser(true)
    try {
      const res = await apiSend<{ ok: boolean; advertiserId: string }>('/api/ads/accounts/select', 'POST', { advertiserId: id })
      onAdvertiserChanged(res.advertiserId)
    } catch (e) {
      toast.error('Falha ao selecionar a conta de anúncio', { hint: e instanceof Error ? e.message : undefined })
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
    <div role="toolbar" aria-label="Conta do TikTok Ads" data-tour="ads-context" className="ads-account-context flex items-center gap-2 rounded-xl border border-border/70 bg-card/60 px-3 py-2.5 text-xs backdrop-blur-md">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Building2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <select
          className="w-full min-w-0 max-w-xl truncate rounded-lg border border-border/60 bg-background/80 px-3 py-2 text-xs font-medium text-foreground transition-colors hover:border-border focus:border-primary/50 focus:outline-none"
          value={selectedAdvertiser}
          disabled={switchingAdvertiser || advertisers.length === 0}
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

      <button type="button" className="ads-context-icon" onClick={onRefresh} disabled={refreshing || !selectedAdvertiser} aria-label="Atualizar dados do TikTok" title="Atualizar dados do TikTok">
        <RefreshCw className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
      </button>

      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button type="button" className="ads-context-icon" aria-label="Mais ações da conta" title="Mais ações da conta">
            <MoreHorizontal className="size-3.5" aria-hidden="true" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="end" sideOffset={6} className="glass glass-thick anim-pop-in z-50 min-w-52 rounded-xl border border-border/70 bg-background/95 p-1.5 shadow-2xl backdrop-blur-xl">
            <DropdownMenu.Item className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-foreground outline-none data-[highlighted]:bg-secondary" onSelect={openCreateAccount}>
              <ExternalLink className="size-3.5" aria-hidden="true" />Criar conta no TikTok
            </DropdownMenu.Item>
            {onDisconnect ? <DropdownMenu.Item className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-error outline-none data-[highlighted]:bg-error/10" onSelect={onDisconnect}>
              <Unplug className="size-3.5" aria-hidden="true" />Desconectar
            </DropdownMenu.Item> : null}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  )
}
