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
import type { AdsAdvertiser, AdsBusinessCenter, AdsHealthStatus } from '@/lib/types'

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
  // F6: null esconde o botão — com Pipeboard a conexão é chave de servidor,
  // não há "desconectar" por usuário (a revogação é no painel do Pipeboard).
  onDisconnect: (() => void) | null
}) {
  const [switchingBc, setSwitchingBc] = useState(false)
  const [switchingAdvertiser, setSwitchingAdvertiser] = useState(false)

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
    if (!id || switchingAdvertiser) return
    setSwitchingAdvertiser(true)
    try {
      const res = await apiSend<{ ok: boolean; advertiserId: string }>(
        '/api/ads/accounts/select',
        'POST',
        { advertiserId: id, businessCenterId: selectedBc },
      )
      // Só troca o contexto visual depois que o backend confirmou que a conta
      // pertence ao BC atual; assim nenhuma consulta usa um ID não persistido.
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
          disabled={switchingBc || switchingAdvertiser || advertisers.length === 0}
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
        {onDisconnect && (
          <button
            type="button"
            className="btn-ghost px-2 py-1 text-xs text-muted-foreground"
            onClick={onDisconnect}
          >
            <Unplug className="size-3.5" aria-hidden="true" />
            Desconectar
          </button>
        )}
      </div>
    </div>
  )
}
