'use client'

// Página Catálogo (menu Gestão) — replica o shell mínimo de contexto do
// TikTokAdsView: verificação de conexão, seleção de advertiser e então o
// CatalogManager (o mesmo corpo do antigo modal, agora em página própria).

import { useState } from 'react'
import { ShoppingBag } from 'lucide-react'
import { useAdsStatus, useAdsAccounts, apiSend } from '@/lib/api'
import { GlassCard } from '@/components/glass-card'
import { Skeleton } from '@/components/skeleton'
import { ErrorState } from '@/components/error-state'
import { AdsConnectCard } from './connect-card'
import { AdsContextBar } from './context-bar'
import { CatalogManager } from './catalog-manager'

export function CatalogPageView() {
  const { data: status, mutate: mutateStatus, isLoading: statusLoading, error: statusError } = useAdsStatus()
  const connected = Boolean(status?.connected)

  const { data: accounts, mutate: mutateAccounts } = useAdsAccounts(connected)

  // Mesmo padrão do TikTokAdsView: null = usa a conta salva no servidor.
  const [advertiserId, setAdvertiserId] = useState<string | null>(null)
  const effectiveAdvertiser = advertiserId ?? accounts?.selected ?? ''

  // ── Estado: chave ausente no servidor ────────────────────────────────────
  if (status && !status.enabled) {
    return (
      <div className="flex flex-col gap-5">
        <ErrorState
          title="Integração não configurada no servidor"
          description="A variável PIPEBOARD_API_KEY não está definida no servidor. Gere o token no painel do Pipeboard (pipeboard.co), adicione às variáveis de ambiente e tente novamente."
          onRetry={() => mutateStatus()}
        />
      </div>
    )
  }

  if (statusError) {
    return (
      <div className="flex flex-col gap-5">
        <ErrorState onRetry={() => mutateStatus()} />
      </div>
    )
  }

  if (statusLoading && !status) {
    return (
      <div className="flex flex-col gap-5">
        <Skeleton className="h-16 rounded-2xl bg-brand-cyan/5 shadow-[0_0_15px_rgba(37,244,238,0.1)] border border-brand-cyan/10" />
        <Skeleton className="h-64 rounded-2xl bg-brand-cyan/5 shadow-[0_0_15px_rgba(37,244,238,0.1)] border border-brand-cyan/10" />
      </div>
    )
  }

  // ── Estado: não conectado → card de verificação de conexão ───────────────
  if (!connected) {
    return (
      <div className="flex flex-col gap-5">
        <AdsConnectCard onConnected={() => mutateStatus()} />
      </div>
    )
  }

  const advertisers = accounts?.accounts ?? []
  const advertiserLabel = advertisers.find((a) => String(a.id) === String(effectiveAdvertiser))?.name || ''

  return (
    <div className="flex flex-col gap-5">
      {/* Barra de contexto: conta de anúncio (sem desconectar — isso vive na
          página TikTok Ads; aqui é só seleção de contexto) */}
      <AdsContextBar
        accountLabel={status?.account?.displayName || status?.account?.username || status?.account?.id || ''}
        advertisers={advertisers}
        selectedAdvertiser={effectiveAdvertiser}
        refreshing={false}
        onAdvertiserChanged={(id) => {
          setAdvertiserId(id)
          mutateAccounts()
        }}
        onRefresh={async () => {
          try {
            await apiSend('/api/ads/tree/refresh', 'POST', {})
          } catch {
            /* cache-bust é melhor-esforço */
          }
          mutateAccounts()
        }}
        onDisconnect={null}
      />

      {!effectiveAdvertiser ? (
        <GlassCard className="flex flex-col items-center gap-3 p-10 text-center">
          <span className="empty-icon flex size-14 items-center justify-center rounded-xl bg-gradient-to-br from-brand-cyan/20 to-purple-500/10 text-brand-cyan shadow-[0_0_30px_rgba(37,244,238,0.3)] border border-brand-cyan/30">
            <ShoppingBag className="size-6 drop-shadow-[0_0_8px_rgba(37,244,238,0.8)]" aria-hidden="true" />
          </span>
          <p className="text-sm font-medium text-foreground">Selecione um advertiser</p>
          <p className="max-w-md text-pretty text-xs text-muted-foreground">
            Escolha acima qual conta de anúncio do TikTok você quer gerenciar. Os catálogos e feeds valem
            para a conta selecionada.
          </p>
        </GlassCard>
      ) : (
        <GlassCard className="flex flex-col gap-4 p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <ShoppingBag className="size-4 text-primary" aria-hidden="true" />
            Catálogos de produtos
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-normal text-muted-foreground">
              {advertiserLabel || effectiveAdvertiser}
            </span>
          </h2>
          <CatalogManager advertiserId={effectiveAdvertiser} advertiserLabel={advertiserLabel} />
        </GlassCard>
      )}
    </div>
  )
}
