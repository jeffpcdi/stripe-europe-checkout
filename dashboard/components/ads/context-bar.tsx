'use client'

// Barra de contexto da aba TikTok Ads — seleção de conta de anúncio.
// Trocar a conta re-escopa TODA a aba (árvore, ROAS, criação). O Pipeboard
// não expõe Business Centers — o seletor de BC da era Zernio foi removido.
// "Criar conta de anúncio" é um DEEP-LINK honesto para a UI do TikTok
// Business Center (não existe API de criação) — ao voltar, "Atualizar"
// re-sincroniza e a conta nova aparece.

import { useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { ExternalLink, MoreHorizontal, RefreshCw, Unplug } from 'lucide-react'
import { apiSend, fetcher } from '@/lib/api'
import { toast } from '@/lib/toast'
import type { AdsAdvertiser, AdsHealthStatus, AdsSyncAdvertiserState } from '@/lib/types'
import { McpStatusDot } from './mcp-status-dot'

// Sufixo textual no <option> (options não renderizam markup) + ponto colorido
// ao lado do seletor para a conta selecionada.
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
  // null esconde o botão — com Pipeboard a conexão é chave de servidor,
  // não há "desconectar" por usuário (a revogação é no painel do Pipeboard).
  onDisconnect: (() => void) | null
}) {
  const [switchingAdvertiser, setSwitchingAdvertiser] = useState(false)

  const syncMeta = (() => {
    if (!selectedAdvertiser) return { label: 'Selecione uma conta', tone: 'text-muted-foreground' }
    if (refreshing || syncState?.status === 'syncing') return { label: 'Sincronizando…', tone: 'text-primary' }
    if (syncState?.status === 'blocked') return { label: 'Acesso bloqueado', tone: 'text-warning' }
    if (syncState?.status === 'unauthorized') return { label: 'Sem acesso', tone: 'text-error' }
    if (syncState?.status === 'error') return { label: 'Sincronização falhou', tone: 'text-error' }
    if (!syncState?.lastSyncedAt) return { label: 'Aguardando 1ª sincronização', tone: 'text-muted-foreground' }
    const elapsed = Math.max(0, Date.now() - new Date(syncState.lastSyncedAt).getTime())
    const minutes = Math.floor(elapsed / 60_000)
    const label = minutes < 1 ? 'Sincronizado agora' : minutes < 60 ? `Sincronizado há ${minutes} min` : `Sincronizado há ${Math.floor(minutes / 60)} h`
    return { label, tone: minutes >= 10 ? 'text-warning' : 'text-muted-foreground' }
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
      // Só troca o contexto visual depois que o backend confirmou a seleção;
      // assim nenhuma consulta usa um ID não persistido.
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
        hint: 'A criação de conta é feita na UI do TikTok. Ao terminar, volte e clique em Atualizar para a conta nova aparecer.',
      })
    } catch (e) {
      toast.error('Falha ao montar o link do Business Center', {
        hint: e instanceof Error ? e.message : undefined,
      })
    }
  }

  return (
    <div
      role="toolbar"
      aria-label="Contexto do TikTok Ads"
      data-tour="ads-context"
      className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-xl border border-border bg-card p-3 text-xs sm:flex sm:gap-x-4 sm:px-4 sm:py-2.5"
    >
      {/* Um único indicador substitui os três estados redundantes antigos. */}
      <McpStatusDot active />

      <span
        className={`hidden shrink-0 lg:inline ${syncMeta.tone}`}
        title={syncState?.lastError || syncMeta.label}
        aria-live="polite"
      >
        {syncMeta.label}
      </span>

      {/* Seletor de conta de anúncio (advertiser) */}
      <label className="col-span-2 flex min-w-0 items-center gap-2 text-muted-foreground sm:col-span-1 sm:flex-1">
        <span className="shrink-0 sm:hidden">Conta</span>
        <span className="hidden shrink-0 sm:inline">Conta de anúncio</span>
        <select
          className="input-neon w-0 min-w-0 max-w-full flex-1 truncate rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground sm:max-w-xl"
          value={selectedAdvertiser}
          disabled={switchingAdvertiser || advertisers.length === 0}
          onChange={(e) => handleSelectAdvertiser(e.target.value)}
          aria-label="Selecionar conta de anúncio (advertiser)"
        >
          {!selectedAdvertiser && <option value="">Selecione uma conta…</option>}
          {advertisers.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name || a.id}
              {a.currency ? ` · ${a.currency}` : ''}
              {STATUS_SUFFIX[a.healthStatus ?? 'unknown']}
            </option>
          ))}
        </select>
        {/* Ponto de status da conta selecionada (options não aceitam cor) */}
        {(() => {
          const sel = advertisers.find((a) => a.id === selectedAdvertiser)
          if (!sel?.healthStatus || sel.healthStatus === 'unknown') return null
          const dot = STATUS_DOT[sel.healthStatus]
          if (!dot) return null
          return (
            <span
              className={`size-2 shrink-0 rounded-full ${dot.className}`}
              title={dot.label}
              aria-label={`Status da conta: ${dot.label}`}
            />
          )
        })()}
      </label>

      <label className="flex min-w-0 items-center gap-2 text-muted-foreground">
        <span className="shrink-0">Período</span>
        <select
          className="input-neon min-w-0 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground sm:text-sm"
          value={rangeDays}
          onChange={(event) => onRangeDays(Number(event.target.value))}
          aria-label="Período global das métricas"
        >
          <option value={1}>Hoje</option>
          <option value={7}>7 dias</option>
          <option value={14}>14 dias</option>
          <option value={30}>30 dias</option>
          <option value={90}>90 dias</option>
          <option value={365}>1 ano</option>
        </select>
      </label>

      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          className="btn-ghost size-8 p-0 text-xs"
          onClick={onRefresh}
          disabled={refreshing || !selectedAdvertiser}
          aria-label={syncMeta.label}
          title={`${syncMeta.label}. Atualizar dados do TikTok agora.`}
        >
          <RefreshCw className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
        </button>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button type="button" className="btn-ghost size-8 p-0 text-xs" aria-label="Mais ações da conta">
              <MoreHorizontal className="size-3.5" aria-hidden="true" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" sideOffset={8} className="glass glass-thick anim-pop-in z-50 min-w-52 rounded-[12px] p-1.5">
              <DropdownMenu.Item
                className="flex cursor-pointer items-center gap-2 rounded-[8px] px-2.5 py-2 text-xs text-sub outline-none data-[highlighted]:bg-[var(--hover)] data-[highlighted]:text-foreground"
                onSelect={openCreateAccount}
              >
                <ExternalLink className="size-3.5" aria-hidden="true" />
                Criar conta no TikTok
              </DropdownMenu.Item>
              {onDisconnect && (
                <DropdownMenu.Item
                  className="flex cursor-pointer items-center gap-2 rounded-[8px] px-2.5 py-2 text-xs text-muted-foreground outline-none data-[highlighted]:bg-[var(--hover)] data-[highlighted]:text-error"
                  onSelect={onDisconnect}
                >
                  <Unplug className="size-3.5" aria-hidden="true" />
                  Desconectar
                </DropdownMenu.Item>
              )}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </div>
  )
}
