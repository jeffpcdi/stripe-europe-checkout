'use client'

import { useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { ExternalLink, MoreHorizontal, RefreshCw, Unplug, ChevronDown, Clock3 } from 'lucide-react'
import { apiSend, fetcher } from '@/lib/api'
import { toast } from '@/lib/toast'
import type { AdsAdvertiser, AdsHealthStatus, AdsSyncAdvertiserState } from '@/lib/types'
import { McpStatusDot } from './mcp-status-dot'

const STATUS_SUFFIX: Record<AdsHealthStatus, string> = {
  approved: '',
  banned: ' — BANIDA',
  limited: ' — limitada',
  in_review: ' — em revisão',
  unknown: '',
}

const STATUS_DOT: Partial<Record<AdsHealthStatus, { className: string; label: string }>> = {
  approved: { className: 'bg-[color:var(--success)]', label: 'aprovada' },
  banned: { className: 'bg-[color:var(--error)]', label: 'banida' },
  limited: { className: 'bg-[color:var(--warning)]', label: 'limitada' },
  in_review: { className: 'bg-[color:var(--warning)]', label: 'em revisão' },
}

const RANGE_OPTIONS = [
  { value: 1, label: 'Hoje' },
  { value: 7, label: '7 dias' },
  { value: 14, label: '14 dias' },
  { value: 30, label: '30 dias' },
  { value: 90, label: '90 dias' },
  { value: 365, label: '1 ano' },
] as const

export function AdsContextBar({
  advertisers,
  selectedAdvertiser,
  syncState,
  refreshing,
  rangeDays,
  onRangeDays,
  onAdvertiserChanged,
  onRefresh,
  onDisconnect,
}: {
  advertisers: AdsAdvertiser[]
  selectedAdvertiser: string
  syncState?: AdsSyncAdvertiserState
  refreshing: boolean
  rangeDays: number
  onRangeDays: (days: number) => void
  onAdvertiserChanged: (id: string) => void
  onRefresh: () => void
  onDisconnect: (() => void) | null
}) {
  const [switchingAdvertiser, setSwitchingAdvertiser] = useState(false)

  const syncMeta = (() => {
    if (!selectedAdvertiser) return { label: 'Selecione uma conta', state: 'idle', tone: 'text-muted-foreground' }
    if (refreshing || syncState?.status === 'syncing') return { label: 'Sincronizando dados…', state: 'syncing', tone: 'text-primary' }
    if (syncState?.status === 'blocked') return { label: 'Acesso bloqueado', state: 'error', tone: 'text-warning' }
    if (syncState?.status === 'unauthorized') return { label: 'Sem acesso', state: 'error', tone: 'text-error' }
    if (syncState?.status === 'error') return { label: 'Sincronização falhou', state: 'error', tone: 'text-error' }
    if (!syncState?.lastSyncedAt) return { label: 'Aguardando 1ª sincronização', state: 'idle', tone: 'text-muted-foreground' }
    const elapsed = Math.max(0, Date.now() - new Date(syncState.lastSyncedAt).getTime())
    const minutes = Math.floor(elapsed / 60_000)
    const label = minutes < 1 ? 'Sincronizado agora' : minutes < 60 ? `Sincronizado há ${minutes} min` : `Sincronizado há ${Math.floor(minutes / 60)} h`
    return { label, state: minutes >= 10 ? 'stale' : 'fresh', tone: minutes >= 10 ? 'text-warning' : 'text-muted-foreground' }
  })()

  async function handleSelectAdvertiser(id: string) {
    if (!id || switchingAdvertiser) return
    setSwitchingAdvertiser(true)
    try {
      const res = await apiSend<{ ok: boolean; advertiserId: string }>(
        '/api/ads/accounts/select',
        'POST',
        { advertiserId: id },
      )
      onAdvertiserChanged(res.advertiserId)
    } catch (e) {
      toast.error('Falha ao selecionar a conta de anúncio', {
        hint: e instanceof Error ? e.message : undefined,
      })
    } finally {
      setSwitchingAdvertiser(false)
    }
  }

  async function openCreateAccount() {
    try {
      const data = await fetcher<{ url: string }>('/api/ads/deeplink/create-account')
      window.open(data.url, '_blank', 'noopener,noreferrer')
      toast.info('Criando no TikTok Business Center', {
        hint: 'Ao terminar, volte e atualize para a conta nova aparecer.',
      })
    } catch (e) {
      toast.error('Falha ao montar o link do Business Center', {
        hint: e instanceof Error ? e.message : undefined,
      })
    }
  }

  const selected = advertisers.find((a) => a.id === selectedAdvertiser)
  const selectedStatus = selected?.healthStatus ? STATUS_DOT[selected.healthStatus] : null

  return (
    <section role="toolbar" aria-label="Contexto do TikTok Ads" data-tour="ads-context" className="ads-command-bar">
      <div className="ads-command-account">
        <div className="ads-command-connection">
          <McpStatusDot active compact />
          <div className="min-w-0">
            <span className="ads-command-kicker">TikTok Ads</span>
            <span className={`ads-command-sync ${syncMeta.tone}`} data-state={syncMeta.state} title={syncState?.lastError || syncMeta.label} aria-live="polite">
              <span className="ads-command-sync-dot" aria-hidden="true" />
              {syncMeta.label}
            </span>
          </div>
        </div>

        <label className="ads-account-select-wrap">
          <span className="sr-only">Conta de anúncios</span>
          <select
            className="ads-account-select"
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
          {selectedStatus ? <span className={`ads-account-health-dot ${selectedStatus.className}`} title={selectedStatus.label} /> : null}
          <ChevronDown className="ads-account-select-chevron size-3.5" aria-hidden="true" />
        </label>
      </div>

      <div className="ads-command-actions">
        <div className="ads-range-switch" role="group" aria-label="Período global das métricas">
          <Clock3 className="ads-range-icon size-3.5" aria-hidden="true" />
          {RANGE_OPTIONS.map(option => (
            <button
              key={option.value}
              type="button"
              aria-pressed={rangeDays === option.value}
              data-active={rangeDays === option.value ? 'true' : 'false'}
              onClick={() => onRangeDays(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <label className="ads-range-mobile">
          <span className="sr-only">Período</span>
          <select value={rangeDays} onChange={event => onRangeDays(Number(event.target.value))} aria-label="Período global das métricas">
            {RANGE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>

        <button
          type="button"
          className="ads-refresh-button"
          onClick={onRefresh}
          disabled={refreshing || !selectedAdvertiser}
          aria-label={syncMeta.label}
          title={`${syncMeta.label}. Atualizar dados do TikTok agora.`}
        >
          <RefreshCw className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
          <span className="hidden xl:inline">Atualizar</span>
        </button>

        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button type="button" className="ads-more-button" aria-label="Mais ações da conta">
              <MoreHorizontal className="size-4" aria-hidden="true" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" sideOffset={8} className="glass glass-thick anim-pop-in z-50 min-w-52 rounded-[12px] p-1.5">
              <DropdownMenu.Item className="flex cursor-pointer items-center gap-2 rounded-[8px] px-2.5 py-2 text-xs text-sub outline-none data-[highlighted]:bg-[var(--hover)] data-[highlighted]:text-foreground" onSelect={openCreateAccount}>
                <ExternalLink className="size-3.5" aria-hidden="true" /> Criar conta no TikTok
              </DropdownMenu.Item>
              {onDisconnect && (
                <DropdownMenu.Item className="flex cursor-pointer items-center gap-2 rounded-[8px] px-2.5 py-2 text-xs text-muted-foreground outline-none data-[highlighted]:bg-[var(--hover)] data-[highlighted]:text-error" onSelect={onDisconnect}>
                  <Unplug className="size-3.5" aria-hidden="true" /> Desconectar
                </DropdownMenu.Item>
              )}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </section>
  )
}
