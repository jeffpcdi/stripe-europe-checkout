'use client'

// Barra de contexto da aba TikTok Ads — navegação BC → Conta.
// Dois seletores segmentados: [ Business Center ▾ ] [ Conta de anúncio ▾ ].
// Trocar o BC recarrega as contas daquele BC (e o backend re-seleciona uma
// conta válida); trocar a conta re-escopa TODA a aba (árvore, ROAS, criação).
// "Criar conta de anúncio" é um DEEP-LINK honesto para a UI do TikTok
// Business Center (não existe API de criação) — ao voltar, "Atualizar"
// re-sincroniza e a conta nova aparece.

import { useState } from 'react'
import { Building2, ExternalLink, RefreshCw, Unplug } from 'lucide-react'
import { apiSend, fetcher } from '@/lib/api'
import { toast } from '@/lib/toast'
import type { AdsAdvertiser, AdsBusinessCenter } from '@/lib/types'

export function AdsContextBar({
  accountLabel,
  businessCenters,
  bcUnsupported,
  selectedBc,
  advertisers,
  selectedAdvertiser,
  refreshing,
  onBcChanged,
  onAdvertiserChanged,
  onRefresh,
  onDisconnect,
}: {
  accountLabel: string
  businessCenters: AdsBusinessCenter[]
  bcUnsupported: boolean
  selectedBc: string
  advertisers: AdsAdvertiser[]
  selectedAdvertiser: string
  refreshing: boolean
  onBcChanged: (bcId: string, advertiserId: string) => void
  onAdvertiserChanged: (id: string) => void
  onRefresh: () => void
  onDisconnect: () => void
}) {
  const [switchingBc, setSwitchingBc] = useState(false)

  async function handleSelectBc(bcId: string) {
    setSwitchingBc(true)
    try {
      const res = await apiSend<{ ok: boolean; businessCenterId: string; advertiserId: string }>(
        '/api/ads/business-centers/select',
        'POST',
        { businessCenterId: bcId },
      )
      onBcChanged(res.businessCenterId, res.advertiserId || '')
    } catch (e) {
      toast.error('Falha ao trocar de Business Center', {
        hint: e instanceof Error ? e.message : undefined,
      })
    } finally {
      setSwitchingBc(false)
    }
  }

  async function handleSelectAdvertiser(id: string) {
    onAdvertiserChanged(id)
    // "__all__" é um modo de visualização (agregado) — não vira o advertiser
    // default do backend, senão os fluxos de criação quebrariam.
    if (id === '__all__') return
    try {
      await apiSend('/api/ads/accounts/select', 'POST', { advertiserId: id })
    } catch {
      // seleção local continua valendo; o backend só perde o default salvo
    }
  }

  async function openCreateAccount() {
    try {
      const data = await fetcher<{ url: string }>(
        `/api/ads/deeplink/create-account${selectedBc ? `?businessCenterId=${encodeURIComponent(selectedBc)}` : ''}`,
      )
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
      aria-label="Contexto do TikTok Ads: Business Center e conta de anúncio"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border bg-card/60 px-4 py-2.5 text-xs"
    >
      <span className="flex items-center gap-1.5 font-semibold text-success">
        <span className="size-2 animate-pulse rounded-full bg-[color:var(--success)]" aria-hidden="true" />
        Conectado
      </span>
      <span className="hidden text-muted-foreground sm:inline">
        Conta: <strong className="text-foreground">{accountLabel}</strong>
      </span>

      {/* Seletor de Business Center — escondido se a Zernio não suporta */}
      {!bcUnsupported && businessCenters.length > 0 && (
        <label className="flex items-center gap-2 text-muted-foreground">
          <Building2 className="size-3.5" aria-hidden="true" />
          <span className="sr-only sm:not-sr-only">Business Center:</span>
          <select
            className="input-neon rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
            value={selectedBc}
            disabled={switchingBc}
            onChange={(e) => handleSelectBc(e.target.value)}
            aria-label="Selecionar Business Center"
          >
            {!selectedBc && <option value="">Selecione…</option>}
            {businessCenters.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name || b.id}
              </option>
            ))}
          </select>
        </label>
      )}

      {/* Seletor de conta de anúncio (advertiser) do BC atual */}
      <label className="flex items-center gap-2 text-muted-foreground">
        <span>Conta de anúncio:</span>
        <select
          className="input-neon rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
          value={selectedAdvertiser}
          disabled={switchingBc}
          onChange={(e) => handleSelectAdvertiser(e.target.value)}
          aria-label="Selecionar conta de anúncio (advertiser)"
        >
          {!selectedAdvertiser && <option value="">Selecione…</option>}
          {advertisers.length > 1 && <option value="__all__">Todas as contas ({advertisers.length})</option>}
          {advertisers.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name || a.id}
              {a.currency ? ` · ${a.currency}` : ''}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        className="btn-ghost px-2 py-1 text-xs"
        onClick={openCreateAccount}
        title="Abre o TikTok Business Center em nova aba — a criação de conta não tem API"
      >
        <ExternalLink className="size-3.5" aria-hidden="true" />
        Criar conta de anúncio
      </button>

      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          className="btn-ghost px-2 py-1 text-xs"
          onClick={onRefresh}
          aria-label="Atualizar dados"
        >
          <RefreshCw className={`size-3.5 ${refreshing || switchingBc ? 'animate-spin' : ''}`} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="btn-ghost px-2 py-1 text-xs text-muted-foreground"
          onClick={onDisconnect}
        >
          <Unplug className="size-3.5" aria-hidden="true" />
          Desconectar
        </button>
      </div>
    </div>
  )
}
